/**
 * pdf.js setup and a small cache of open documents.
 *
 * Every asset pdf.js may fetch at runtime (worker, CMaps, standard fonts, image
 * decoder wasm) is served from our own origin so the app keeps working with the
 * network switched off.
 */
// The legacy build is transpiled and polyfilled, so rendering works in
// browsers a release or two behind the very newest.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
  TextContent,
} from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assetBase = `${import.meta.env.BASE_URL}pdfjs/`;

export const PDFJS_ASSETS = {
  cMapUrl: `${assetBase}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${assetBase}standard_fonts/`,
  wasmUrl: `${assetBase}wasm/`,
  iccUrl: `${assetBase}iccs/`,
};

export class PasswordRequiredError extends Error {
  readonly wrongPassword: boolean;

  constructor(wrongPassword: boolean) {
    super(wrongPassword ? 'Incorrect password' : 'This PDF is password protected');
    this.name = 'PasswordRequiredError';
    this.wrongPassword = wrongPassword;
  }
}

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  numPages: number;
}

interface CacheEntry {
  task: ReturnType<typeof pdfjs.getDocument>;
  doc: Promise<PDFDocumentProxy>;
}

const cache = new Map<string, CacheEntry>();

/**
 * Open a PDF for rendering. `bytes` is copied because pdf.js transfers the
 * buffer to its worker, and we need to keep the originals for export.
 */
export async function openPdf(
  key: string,
  bytes: Uint8Array,
  password?: string,
): Promise<PDFDocumentProxy> {
  const existing = cache.get(key);
  if (existing) return existing.doc;

  const task = pdfjs.getDocument({ data: bytes.slice(), password, ...PDFJS_ASSETS });
  const doc = task.promise.catch((error: unknown) => {
    const err = error as { name?: string; code?: number };
    if (err?.name === 'PasswordException') throw new PasswordRequiredError(err.code === 2);
    throw error;
  });

  cache.set(key, { task, doc });
  doc.catch(() => cache.delete(key));
  return doc;
}

export function evictPdf(key: string) {
  const entry = cache.get(key);
  cache.delete(key);
  entry?.task.destroy().catch(() => undefined);
}

export function evictAll() {
  for (const key of [...cache.keys()]) evictPdf(key);
}

/** Load a PDF outside the shared cache (one-off inspection, e.g. import dialogs). */
export interface DetachedPdf {
  doc: PDFDocumentProxy;
  /** Tears down the dedicated worker this document owns. */
  close: () => Promise<void>;
}

export async function openPdfDetached(bytes: Uint8Array, password?: string): Promise<DetachedPdf> {
  const task = pdfjs.getDocument({ data: bytes.slice(), password, ...PDFJS_ASSETS });
  try {
    const doc = await task.promise;
    return { doc, close: () => task.destroy() };
  } catch (error) {
    const err = error as { name?: string; code?: number };
    if (err?.name === 'PasswordException') throw new PasswordRequiredError(err.code === 2);
    throw error;
  }
}

export interface RenderOptions {
  scale: number;
  /** Absolute rotation to render at; defaults to the page's own /Rotate. */
  rotation?: number;
  canvas: HTMLCanvasElement;
  signal?: AbortSignal;
}

/** Render a page into a canvas, sized for the current device pixel ratio. */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  { scale, rotation, canvas, signal }: RenderOptions,
): Promise<{ width: number; height: number }> {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: scale * dpr, rotation });
  const cssViewport = page.getViewport({ scale, rotation });

  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.width = `${Math.floor(cssViewport.width)}px`;
  canvas.style.height = `${Math.floor(cssViewport.height)}px`;

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is unavailable in this browser');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const task: RenderTask = page.render({ canvas, canvasContext: context, viewport });
  const onAbort = () => task.cancel();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  return { width: cssViewport.width, height: cssViewport.height };
}

/** Render a page to an offscreen canvas — used for thumbnails and rasterising. */
export async function renderPageToBitmap(
  page: PDFPageProxy,
  scale: number,
  rotation?: number,
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is unavailable in this browser');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas;
}

export const getTextContent = (page: PDFPageProxy): Promise<TextContent> =>
  page.getTextContent();

export type { PDFDocumentProxy, PDFPageProxy };
