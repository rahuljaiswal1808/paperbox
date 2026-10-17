/**
 * Canvas text measurement, used to match replacement text to the text it covers.
 *
 * A PDF tells us which *kind* of font a run uses (pdf.js reports "serif",
 * "sans-serif" or "monospace") but not its weight — the embedded font's real
 * name is often subsetted or obfuscated. The width of the run, however, is
 * known exactly. So we measure the same string in each candidate style and keep
 * whichever comes closest: a bold run is noticeably wider than its regular
 * counterpart at the same size, which is enough to tell them apart.
 */
import type { FontFamily } from '../../types/document';
import { cssFontFamily } from './fonts';

let context: CanvasRenderingContext2D | null = null;

const getContext = (): CanvasRenderingContext2D | null => {
  if (context) return context;
  if (typeof document === 'undefined') return null;
  context = document.createElement('canvas').getContext('2d');
  return context;
};

export interface MeasureStyle {
  family: FontFamily;
  size: number;
  bold?: boolean;
  italic?: boolean;
}

/** Width of `text` in points, or 0 where no canvas is available. */
export function measureText(text: string, style: MeasureStyle): number {
  const ctx = getContext();
  if (!ctx) return 0;
  ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size}px ${cssFontFamily(style.family)}`;
  return ctx.measureText(text).width;
}

const FAMILY_BY_HINT: Record<string, FontFamily> = {
  serif: 'Times',
  'sans-serif': 'Helvetica',
  monospace: 'Courier',
};

export interface GuessedStyle {
  font: FontFamily;
  bold: boolean;
}

/**
 * Best match for a run of existing text.
 *
 * `familyHint` narrows the search when pdf.js could classify the font; weight
 * is decided by whichever candidate's width is closest to `targetWidth`. The
 * bold candidate has to win by a clear margin, so ordinary measurement noise
 * does not silently embolden body text.
 */
export function guessTextStyle(
  text: string,
  targetWidth: number,
  size: number,
  familyHint?: string,
  fallback: FontFamily = 'Helvetica',
): GuessedStyle {
  const hinted = familyHint ? FAMILY_BY_HINT[familyHint] : undefined;
  const families: FontFamily[] = hinted ? [hinted] : ['Helvetica', 'Times', 'Courier'];
  const result: GuessedStyle = { font: hinted ?? fallback, bold: false };

  if (!text.trim() || targetWidth <= 0 || size <= 0) return result;

  let bestError = Infinity;
  for (const family of families) {
    for (const bold of [false, true]) {
      const width = measureText(text, { family, size, bold });
      if (width <= 0) continue;
      // Favour the regular weight unless bold is a distinctly better fit.
      const error = Math.abs(width - targetWidth) / targetWidth + (bold ? 0.012 : 0);
      if (error < bestError) {
        bestError = error;
        result.font = family;
        result.bold = bold;
      }
    }
  }

  return result;
}
