/**
 * Watermarks, headers, footers and page numbers.
 *
 * These are just text/image objects added to the model, which means they are
 * undoable, editable afterwards and visible in the viewer — not a separate
 * one-way "stamp" pipeline.
 */
import type { EditorDocument, PageObject, PageState, TextStyle } from '../../types/document';
import { uid } from '../util/misc';

export const WATERMARK_TAG = 'watermark';

export interface WatermarkTextOptions {
  kind: 'text';
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  rotation: number;
  /** 0..1 of the page width; the block is centred on the page. */
  scale: number;
}

export interface WatermarkImageOptions {
  kind: 'image';
  assetId: string;
  aspect: number;
  opacity: number;
  rotation: number;
  scale: number;
}

export type WatermarkOptions = WatermarkTextOptions | WatermarkImageOptions;

const baseStyle = (size: number, color: string): TextStyle => ({
  size,
  color,
  font: 'Helvetica',
  bold: true,
  italic: false,
  align: 'center',
  lineHeight: 1.15,
});

export function watermarkObject(page: PageState, options: WatermarkOptions): PageObject {
  const width = page.width * options.scale;
  if (options.kind === 'image') {
    const height = width / (options.aspect || 1);
    return {
      id: uid('wm'),
      kind: 'image',
      assetId: options.assetId,
      x: (page.width - width) / 2,
      y: (page.height - height) / 2,
      width,
      height,
      rotation: options.rotation,
      opacity: options.opacity,
    };
  }
  const height = options.fontSize * 1.4;
  return {
    id: uid('wm'),
    kind: 'text',
    text: options.text,
    style: baseStyle(options.fontSize, options.color),
    x: (page.width - width) / 2,
    y: (page.height - height) / 2,
    width,
    height,
    rotation: options.rotation,
    opacity: options.opacity,
  };
}

export type HeaderSlot = 'left' | 'centre' | 'right';
export type HeaderPlacement = 'header' | 'footer';

export interface HeaderFooterOptions {
  placement: HeaderPlacement;
  slots: Record<HeaderSlot, string>;
  fontSize: number;
  color: string;
  margin: number;
  startNumber: number;
  /** Skip the first N pages (e.g. a cover page). */
  skipFirst: number;
}

/**
 * Supported tokens: {page}, {pages}, {n} (page number honouring `startNumber`),
 * {title}, {date}, {time}, {filename}.
 */
export function expandTokens(
  template: string,
  context: { pageIndex: number; pageCount: number; startNumber: number; doc: EditorDocument },
): string {
  const now = new Date();
  return template
    .replace(/\{page\}/gi, String(context.pageIndex + 1))
    .replace(/\{n\}/gi, String(context.pageIndex + context.startNumber))
    .replace(/\{pages\}/gi, String(context.pageCount))
    .replace(/\{title\}/gi, context.doc.metadata.title || context.doc.name)
    .replace(/\{filename\}/gi, context.doc.name)
    .replace(/\{date\}/gi, now.toLocaleDateString())
    .replace(/\{time\}/gi, now.toLocaleTimeString());
}

export function headerFooterObjects(
  doc: EditorDocument,
  page: PageState,
  pageIndex: number,
  options: HeaderFooterOptions,
): PageObject[] {
  if (pageIndex < options.skipFirst) return [];
  const height = options.fontSize * 1.6;
  const y =
    options.placement === 'header'
      ? options.margin
      : page.height - options.margin - height;
  const usable = page.width - options.margin * 2;
  const slotWidth = usable / 3;

  const slots: [HeaderSlot, number, TextStyle['align']][] = [
    ['left', options.margin, 'left'],
    ['centre', options.margin + slotWidth, 'center'],
    ['right', options.margin + slotWidth * 2, 'right'],
  ];

  return slots.flatMap(([slot, x, align]) => {
    const template = options.slots[slot];
    if (!template.trim()) return [];
    const text = expandTokens(template, {
      pageIndex,
      pageCount: doc.pages.length,
      startNumber: options.startNumber,
      doc,
    });
    return [
      {
        id: uid('hf'),
        kind: 'text' as const,
        text,
        style: {
          ...baseStyle(options.fontSize, options.color),
          bold: false,
          align,
        },
        x,
        y,
        width: slotWidth,
        height,
        rotation: 0,
      },
    ];
  });
}
