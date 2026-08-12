/**
 * Application-level commands shared by the toolbar, menus, keyboard shortcuts
 * and dialogs. Everything here runs locally: files are read from disk into
 * memory, processed in the tab, and written straight back out to disk.
 */
import type { EditorDocument, PageState } from '../types/document';
import { useEditorStore } from '../state/editorStore';
import { useUiStore, withProgress } from '../state/uiStore';
import { usePasswordStore } from '../state/passwordStore';
import { useSecurityStore } from '../state/securityStore';
import { PasswordRequiredError, evictAll } from '../lib/pdf/pdfjs';
import {
  documentFromImages,
  documentFromOpenedPdfs,
  readPdfFile,
  type ImagesToPdfOptions,
} from '../lib/ops/documentFactory';
import { subsetDocument } from '../lib/ops/pages';
import { createImageAsset } from '../lib/ops/assets';
import { exportPdf } from '../lib/worker/client';
import type { BuildOptions } from '../lib/pdf/export';
import { downloadBytes, downloadZip, isImageFile, isPdfFile, pickFiles } from '../lib/util/file';
import { formatBytes, sanitizeFilename, stripExtension } from '../lib/util/misc';
import { composePage, canvasToBytes } from '../lib/pdf/raster';
import { putRecent, clearSession } from '../lib/storage/db';

export const PDF_ACCEPT = 'application/pdf,.pdf';
export const IMAGE_ACCEPT = 'image/*';

/** Read a PDF, prompting for a password as many times as the user needs. */
async function readPdfWithPassword(file: File) {
  let password: string | undefined;
  let wrong = false;
  for (;;) {
    try {
      return await readPdfFile(file, password);
    } catch (error) {
      if (!(error instanceof PasswordRequiredError)) throw error;
      const entered = await usePasswordStore.getState().ask(file.name, wrong);
      if (entered === null) return null;
      password = entered;
      wrong = true;
    }
  }
}

async function buildDocumentFromPdfFiles(files: File[]): Promise<EditorDocument | null> {
  const opened: Awaited<ReturnType<typeof readPdfFile>>[] = [];
  for (const file of files) {
    const result = await readPdfWithPassword(file);
    if (!result) return null; // the user dismissed the password prompt
    opened.push(result);
  }
  const name = files.length === 1 ? stripExtension(files[0].name) : 'Merged document';
  return documentFromOpenedPdfs(opened, name);
}

async function rememberRecent(doc: EditorDocument) {
  try {
    const first = doc.pages[0];
    let thumbnail: string | undefined;
    if (first) {
      const canvas = await composePage(doc, first, { scale: 0.16 });
      thumbnail = canvas.toDataURL('image/jpeg', 0.6);
    }
    await putRecent({
      id: doc.id,
      name: doc.name,
      pageCount: doc.pages.length,
      openedAt: Date.now(),
      thumbnail,
    });
  } catch {
    // Recents are a convenience; never let them break opening a file.
  }
}

export async function openPdfFiles(files: File[]): Promise<void> {
  const pdfs = files.filter(isPdfFile);
  if (pdfs.length === 0) return;

  await withProgress(
    pdfs.length > 1 ? `Opening ${pdfs.length} files` : `Opening ${pdfs[0].name}`,
    async (report) => {
      report(0.1, 'Reading file');
      const doc = await buildDocumentFromPdfFiles(pdfs);
      if (!doc) return null;
      report(0.9, 'Preparing pages');
      evictAll();
      useEditorStore.getState().setDocument(doc, { markClean: true });
      useUiStore.getState().setShowHomeScreen(false);
      void rememberRecent(doc);
      if (pdfs.length > 1) {
        useUiStore.getState().toast({
          kind: 'success',
          title: `Merged ${pdfs.length} files`,
          detail: `${doc.pages.length} pages ready to edit. Nothing was uploaded.`,
        });
      }
      return doc;
    },
    { errorTitle: 'Could not open this PDF' },
  );
}

export async function openImagesAsPdf(files: File[], options?: Partial<ImagesToPdfOptions>) {
  const images = files.filter(isImageFile);
  if (images.length === 0) return;
  await withProgress(
    `Converting ${images.length} image${images.length > 1 ? 's' : ''}`,
    async (report) => {
      const doc = await documentFromImages(
        images,
        { pageSize: 'a4', orientation: 'auto', margin: 36, ...options },
        (done, total) => report(done / total, `Image ${done} of ${total}`),
      );
      useEditorStore.getState().setDocument(doc);
      useUiStore.getState().setShowHomeScreen(false);
      void rememberRecent(doc);
      return doc;
    },
    { successTitle: 'Images converted to PDF', errorTitle: 'Could not convert these images' },
  );
}

/** Route dropped or picked files to the right importer. */
export async function openFiles(files: File[]): Promise<void> {
  const pdfs = files.filter(isPdfFile);
  const images = files.filter(isImageFile);
  if (pdfs.length > 0) {
    await openPdfFiles(pdfs);
    if (images.length > 0) await addImagesToCurrentPage(images);
    return;
  }
  if (images.length > 0) {
    const hasDocument = Boolean(useEditorStore.getState().doc);
    if (hasDocument) await addImagesToCurrentPage(images);
    else await openImagesAsPdf(images);
    return;
  }
  useUiStore.getState().toast({
    kind: 'warning',
    title: 'Unsupported file',
    detail: 'Paperbox opens PDFs and images (PNG, JPG, WebP, GIF, BMP).',
  });
}

export async function promptOpenPdf() {
  const files = await pickFiles(PDF_ACCEPT, true);
  if (files.length > 0) await openPdfFiles(files);
}

/** Drop images onto the current page as movable objects. */
export async function addImagesToCurrentPage(files: File[]) {
  const { doc, currentPage, addObject, addAsset } = useEditorStore.getState();
  if (!doc) return;
  const page = doc.pages[currentPage];
  if (!page) return;

  for (const file of files) {
    try {
      const asset = await createImageAsset(file);
      addAsset(asset);
      const maxWidth = page.width * 0.6;
      const scale = Math.min(1, maxWidth / asset.width);
      const width = asset.width * scale;
      const height = asset.height * scale;
      addObject(
        currentPage,
        {
          id: `img_${Math.random().toString(36).slice(2, 9)}`,
          kind: 'image',
          assetId: asset.id,
          x: (page.width - width) / 2,
          y: Math.max(24, (page.height - height) / 2),
          width,
          height,
          rotation: 0,
        },
        'Add image',
      );
    } catch (error) {
      useUiStore.getState().toast({
        kind: 'error',
        title: `Could not add ${file.name}`,
        detail: (error as Error).message,
      });
    }
  }
}

export interface ExportRequestOptions extends Omit<BuildOptions, 'rasterize' | 'onProgress' | 'signal'> {
  filename?: string;
  /** Export only these page indexes. */
  pages?: number[];
  successTitle?: string;
}

export async function exportDocument(options: ExportRequestOptions = {}): Promise<Uint8Array | null> {
  const state = useEditorStore.getState();
  const doc = state.doc;
  if (!doc) return null;

  const { filename, pages, successTitle, ...rest } = options;
  // Password protection is a property of the *file*, not the document, so it is
  // pulled from the security store unless the caller overrode it.
  const buildOptions = {
    ...rest,
    security: rest.security !== undefined ? rest.security : useSecurityStore.getState().forExport(),
  };
  const target =
    pages && pages.length > 0 && pages.length !== doc.pages.length
      ? subsetDocument(doc, pages, doc.name)
      : doc;

  const result = await withProgress(
    'Building PDF',
    async (report, signal) =>
      exportPdf(target, {
        ...buildOptions,
        onProgress: (fraction, label) => report(fraction, label),
        signal,
      }),
    { errorTitle: 'Export failed' },
  );

  if (!result) return null;

  downloadBytes(result.bytes, filename ?? `${sanitizeFilename(doc.name)}.pdf`);
  useEditorStore.getState().markSaved();
  useUiStore.getState().toast({
    kind: result.warnings.length > 0 ? 'warning' : 'success',
    title: successTitle ?? 'PDF saved to your downloads',
    detail: formatBytes(result.bytes.byteLength),
    notes: result.warnings.length > 0 ? [...new Set(result.warnings)] : undefined,
  });
  return result.bytes;
}

/** Extract pages into their own file. */
export async function extractPages(indexes: number[], filename?: string) {
  const doc = useEditorStore.getState().doc;
  if (!doc || indexes.length === 0) return;
  await exportDocument({
    pages: indexes,
    filename: filename ?? `${sanitizeFilename(doc.name)}-extract.pdf`,
    successTitle: `Extracted ${indexes.length} page${indexes.length > 1 ? 's' : ''}`,
  });
}

export interface SplitPart {
  name: string;
  pages: number[];
}

export async function splitDocument(parts: SplitPart[], asZip: boolean) {
  const doc = useEditorStore.getState().doc;
  if (!doc || parts.length === 0) return;

  const files = await withProgress(
    'Splitting document',
    async (report, signal) => {
      const out: { name: string; bytes: Uint8Array }[] = [];
      for (let i = 0; i < parts.length; i += 1) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const part = parts[i];
        report(i / parts.length, `Writing ${part.name}`);
        const subset = subsetDocument(doc, part.pages, part.name);
        const result = await exportPdf(subset, {});
        out.push({ name: `${sanitizeFilename(part.name)}.pdf`, bytes: result.bytes });
      }
      return out;
    },
    { errorTitle: 'Split failed' },
  );

  if (!files) return;
  if (asZip && files.length > 1) {
    downloadZip(files, `${sanitizeFilename(doc.name)}-split.zip`);
  } else {
    for (const file of files) downloadBytes(file.bytes, file.name);
  }
  useUiStore.getState().toast({
    kind: 'success',
    title: `Created ${files.length} file${files.length > 1 ? 's' : ''}`,
    detail: 'Saved to your downloads folder.',
  });
}

/** Render the current page to a PNG for quick visual export. */
export async function exportCurrentPageImage() {
  const { doc, currentPage } = useEditorStore.getState();
  const page: PageState | undefined = doc?.pages[currentPage];
  if (!doc || !page) return;
  const canvas = await composePage(doc, page, { scale: 2 });
  const bytes = await canvasToBytes(canvas, 'image/png', 1);
  downloadBytes(bytes, `${sanitizeFilename(doc.name)}-p${currentPage + 1}.png`, 'image/png');
}

export async function closeDocument() {
  const state = useEditorStore.getState();
  if (state.dirty) {
    const ok = window.confirm('Close this document? Unsaved changes will be lost.');
    if (!ok) return;
  }
  evictAll();
  state.reset();
  await clearSession();
  useUiStore.getState().setShowHomeScreen(true);
}
