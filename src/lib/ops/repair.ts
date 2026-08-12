/**
 * Best-effort recovery for damaged PDFs.
 *
 * Strategy, in order of increasing damage:
 *  1. Parse leniently with pdf-lib and rewrite the file structure. This fixes
 *     broken cross-reference tables, bad trailers and stray objects.
 *  2. If the object graph itself is unusable, fall back to pdf.js, which is far
 *     more forgiving, and rebuild the document page by page from what it can
 *     still render.
 */
import { PDFDocument } from '@cantoo/pdf-lib';

export interface RepairResult {
  bytes: Uint8Array;
  strategy: 'structure' | 'rasterized';
  pageCount: number;
  notes: string[];
}

export type PageRebuilder = (
  bytes: Uint8Array,
  onProgress?: (fraction: number, label: string) => void,
) => Promise<{ bytes: Uint8Array; pageCount: number }>;

export async function repairPdf(
  bytes: Uint8Array,
  rebuild: PageRebuilder,
  onProgress?: (fraction: number, label: string) => void,
): Promise<RepairResult> {
  const notes: string[] = [];
  onProgress?.(0.1, 'Parsing document structure');

  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false,
      capNumbers: true,
    });
    const pageCount = doc.getPageCount();
    if (pageCount > 0) {
      onProgress?.(0.6, 'Rewriting cross-reference table');
      const out = await doc.save({ useObjectStreams: true });
      return {
        bytes: out,
        strategy: 'structure',
        pageCount,
        notes: [
          'The cross-reference table and trailer were rebuilt.',
          'Page content was preserved as-is.',
        ],
      };
    }
    notes.push('The document reported zero pages; falling back to re-rendering.');
  } catch (error) {
    notes.push(`Structural repair failed: ${(error as Error).message}`);
  }

  onProgress?.(0.5, 'Re-rendering readable pages');
  const rebuilt = await rebuild(bytes, onProgress);
  return {
    bytes: rebuilt.bytes,
    strategy: 'rasterized',
    pageCount: rebuilt.pageCount,
    notes: [
      ...notes,
      'Pages were rebuilt from what could still be rendered, so text is no longer selectable.',
    ],
  };
}
