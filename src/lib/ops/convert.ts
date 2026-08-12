/**
 * Conversions in and out of PDF. Everything runs on the user's machine:
 * rendering uses pdf.js + canvas, encoding uses the browser's own codecs.
 */
import type { EditorDocument } from '../../types/document';
import { canvasToBytes, composePage } from '../pdf/raster';
import { extractPageText, pageTextToPlain } from '../pdf/text';
import { openPdf } from '../pdf/pdfjs';
import { sanitizeFilename } from '../util/misc';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export const IMAGE_MIME: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export interface ImageExportOptions {
  format: ImageFormat;
  dpi: number;
  quality: number;
  pages: number[];
}

export interface ProgressReporter {
  (fraction: number, label: string): void;
}

export async function pdfToImages(
  doc: EditorDocument,
  options: ImageExportOptions,
  onProgress?: ProgressReporter,
  signal?: AbortSignal,
): Promise<{ name: string; bytes: Uint8Array }[]> {
  const out: { name: string; bytes: Uint8Array }[] = [];
  const scale = options.dpi / 72;
  const base = sanitizeFilename(doc.name);

  for (let i = 0; i < options.pages.length; i += 1) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const pageIndex = options.pages[i];
    const page = doc.pages[pageIndex];
    if (!page) continue;
    onProgress?.(i / options.pages.length, `Rendering page ${pageIndex + 1}`);
    const canvas = await composePage(doc, page, { scale });
    const bytes = await canvasToBytes(canvas, IMAGE_MIME[options.format], options.quality);
    out.push({
      name: `${base}-p${String(pageIndex + 1).padStart(3, '0')}.${options.format === 'jpeg' ? 'jpg' : options.format}`,
      bytes,
    });
  }
  onProgress?.(1, 'Done');
  return out;
}

export async function pdfToText(
  doc: EditorDocument,
  pages: number[],
  onProgress?: ProgressReporter,
): Promise<string> {
  const chunks: string[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    const pageIndex = pages[i];
    const page = doc.pages[pageIndex];
    if (!page) continue;
    onProgress?.(i / pages.length, `Extracting page ${pageIndex + 1}`);

    let body = '';
    if (page.sourceId) {
      const source = doc.sources[page.sourceId];
      if (source) {
        const pdf = await openPdf(page.sourceId, source.bytes, source.password);
        if (page.sourceIndex < pdf.numPages) {
          const pdfPage = await pdf.getPage(page.sourceIndex + 1);
          body = pageTextToPlain(await extractPageText(pdfPage, page.rotation));
        }
      }
    }

    // Text the user added in the editor belongs in the output too.
    const added = page.objects
      .filter((o) => o.kind === 'text' || o.kind === 'note')
      .map((o) => (o.kind === 'text' ? o.text : o.kind === 'note' ? `[note] ${o.text}` : ''))
      .filter(Boolean)
      .join('\n');

    chunks.push(
      [`--- Page ${pageIndex + 1} ---`, body, added].filter((part) => part.trim()).join('\n'),
    );
  }
  onProgress?.(1, 'Done');
  return chunks.join('\n\n');
}

/** How many pages have no extractable text — the signal that OCR would help. */
export async function countPagesWithoutText(doc: EditorDocument): Promise<number> {
  let count = 0;
  for (const page of doc.pages) {
    if (!page.sourceId) continue;
    const source = doc.sources[page.sourceId];
    if (!source) continue;
    const pdf = await openPdf(page.sourceId, source.bytes, source.password);
    if (page.sourceIndex >= pdf.numPages) continue;
    const pdfPage = await pdf.getPage(page.sourceIndex + 1);
    const text = await extractPageText(pdfPage, page.rotation);
    if (text.text.trim().length < 8) count += 1;
  }
  return count;
}
