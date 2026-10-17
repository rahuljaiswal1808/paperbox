/**
 * Text extraction, search and hit-testing on top of pdf.js text content.
 *
 * Everything here returns display-space rects (points, top-left origin) so the
 * results can be laid straight over the rendered page.
 */
// The legacy build is transpiled and polyfilled, so rendering works in
// browsers a release or two behind the very newest.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import type { Point, Rect } from '../../types/document';
import { boundsOfPoints } from './geometry';

export interface TextItem {
  /** The item's text as it appears in the content stream. */
  str: string;
  rect: Rect;
  /** Approximate font size in points. */
  fontSize: number;
  /** Display-space y of the text baseline — where replacement text must sit. */
  baseline: number;
  /** pdf.js's coarse family guess: "serif", "sans-serif" or "monospace". */
  fontFamily?: string;
  /** Clockwise rotation of the text run, in degrees. */
  angle: number;
  /** Per-character x offsets along the run, in points (length = str.length + 1). */
  offsets: number[];
  hasEol: boolean;
}

export interface PageText {
  items: TextItem[];
  /** Concatenated text with an index map back into `items`. */
  text: string;
  map: { item: number; char: number }[];
}

const EMPTY: PageText = { items: [], text: '', map: [] };

export async function extractPageText(page: PDFPageProxy, rotation?: number): Promise<PageText> {
  const viewport = page.getViewport({ scale: 1, rotation });
  const content = await page.getTextContent();
  const items: TextItem[] = [];

  for (const raw of content.items) {
    if (!('str' in raw)) continue;
    const item = raw;
    if (!item.str) continue;

    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const angle = Math.atan2(tx[1], tx[0]);
    const fontHeight = Math.hypot(tx[2], tx[3]) || item.height || 10;
    const width = item.width || 0;

    const dir: Point = { x: Math.cos(angle), y: Math.sin(angle) };
    // In y-down display space the ascent direction is perpendicular to `dir`.
    const up: Point = { x: Math.sin(angle), y: -Math.cos(angle) };
    const origin: Point = { x: tx[4], y: tx[5] };
    const corners: Point[] = [
      origin,
      { x: origin.x + dir.x * width, y: origin.y + dir.y * width },
      {
        x: origin.x + dir.x * width + up.x * fontHeight,
        y: origin.y + dir.y * width + up.y * fontHeight,
      },
      { x: origin.x + up.x * fontHeight, y: origin.y + up.y * fontHeight },
    ];

    const step = item.str.length ? width / item.str.length : 0;
    const offsets = Array.from({ length: item.str.length + 1 }, (_, i) => i * step);

    items.push({
      str: item.str,
      rect: boundsOfPoints(corners),
      fontSize: fontHeight,
      // `origin` is the baseline-left of the run, which is exactly where a
      // replacement for this text has to put its own baseline.
      baseline: origin.y,
      fontFamily: content.styles?.[item.fontName]?.fontFamily,
      angle: (angle * 180) / Math.PI,
      offsets,
      hasEol: Boolean(item.hasEOL),
    });
  }

  if (items.length === 0) return EMPTY;

  let text = '';
  const map: { item: number; char: number }[] = [];
  items.forEach((item, index) => {
    for (let c = 0; c < item.str.length; c += 1) {
      text += item.str[c];
      map.push({ item: index, char: c });
    }
    if (item.hasEol) {
      text += '\n';
      map.push({ item: index, char: item.str.length });
    }
  });

  return { items, text, map };
}

/** Plain text for export, with line breaks reconstructed from layout. */
export function pageTextToPlain(pageText: PageText): string {
  let out = '';
  let lastBottom: number | null = null;
  for (const item of pageText.items) {
    const bottom = item.rect.y + item.rect.height;
    if (lastBottom !== null && Math.abs(bottom - lastBottom) > item.fontSize * 0.6) out += '\n';
    else if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
    out += item.str;
    if (item.hasEol) out += '\n';
    lastBottom = bottom;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface Match {
  pageIndex: number;
  /** Index of the match within the whole document, for navigation. */
  index: number;
  rects: Rect[];
  preview: string;
}

/** Rects covering `[start, end)` of a page's extracted text. */
export function rectsForRange(pageText: PageText, start: number, end: number): Rect[] {
  const rects: Rect[] = [];
  let runItem = -1;
  let runFrom = 0;
  let runTo = 0;

  const flush = () => {
    if (runItem < 0) return;
    const item = pageText.items[runItem];
    const x0 = item.offsets[Math.min(runFrom, item.offsets.length - 1)];
    const x1 = item.offsets[Math.min(runTo + 1, item.offsets.length - 1)];
    // Offsets run along the text direction; for axis-aligned text this is x.
    const horizontal = Math.abs(item.angle) < 45 || Math.abs(item.angle) > 135;
    rects.push(
      horizontal
        ? { x: item.rect.x + Math.min(x0, x1), y: item.rect.y, width: Math.abs(x1 - x0), height: item.rect.height }
        : { x: item.rect.x, y: item.rect.y + Math.min(x0, x1), width: item.rect.width, height: Math.abs(x1 - x0) },
    );
    runItem = -1;
  };

  for (let i = start; i < end && i < pageText.map.length; i += 1) {
    const pos = pageText.map[i];
    const item = pageText.items[pos.item];
    if (pos.char >= item.str.length) continue; // synthetic newline
    if (pos.item !== runItem) {
      flush();
      runItem = pos.item;
      runFrom = pos.char;
    }
    runTo = pos.char;
  }
  flush();
  return rects;
}

export function findInPage(
  pageText: PageText,
  query: string,
  options: { matchCase?: boolean; wholeWord?: boolean } = {},
): { start: number; end: number; preview: string }[] {
  if (!query) return [];
  const haystack = options.matchCase ? pageText.text : pageText.text.toLowerCase();
  const needle = options.matchCase ? query : query.toLowerCase();
  const results: { start: number; end: number; preview: string }[] = [];
  let from = 0;

  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    from = at + Math.max(1, needle.length);
    if (options.wholeWord) {
      const before = haystack[at - 1];
      const after = haystack[at + needle.length];
      const isWord = (ch?: string) => Boolean(ch && /[\wÀ-ɏ]/.test(ch));
      if (isWord(before) || isWord(after)) continue;
    }
    const previewStart = Math.max(0, at - 32);
    results.push({
      start: at,
      end: at + needle.length,
      preview: pageText.text
        .slice(previewStart, at + needle.length + 32)
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }
  return results;
}

/** The text item under a display-space point, if any. */
export function itemAtPoint(pageText: PageText, point: Point): TextItem | null {
  for (let i = pageText.items.length - 1; i >= 0; i -= 1) {
    const { rect } = pageText.items[i];
    if (
      point.x >= rect.x - 1 &&
      point.x <= rect.x + rect.width + 1 &&
      point.y >= rect.y - 1 &&
      point.y <= rect.y + rect.height + 1
    ) {
      return pageText.items[i];
    }
  }
  return null;
}

/** All text items intersecting a rect, in reading order. */
export function itemsInRect(pageText: PageText, rect: Rect): TextItem[] {
  return pageText.items.filter(
    (item) =>
      item.rect.x < rect.x + rect.width &&
      item.rect.x + item.rect.width > rect.x &&
      item.rect.y < rect.y + rect.height &&
      item.rect.y + item.rect.height > rect.y,
  );
}
