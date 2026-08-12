/**
 * Thin RPC client for the PDF worker, with a main-thread fallback.
 *
 * Anything that needs page rasterisation (redaction, image compression) cannot
 * run in the worker because it needs a canvas, so `exportPdf` decides where the
 * job goes and both paths report progress the same way.
 */
import type { BuildOptions, BuildResult } from '../pdf/export';
import { buildPdf, pageNeedsFlattening } from '../pdf/export';
import { makeRasterizer } from '../pdf/raster';
import type { EditorDocument } from '../../types/document';
import type { WorkerRequest, WorkerResponse } from './pdfops.worker';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (fraction: number, label: string) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./pdfops.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const entry = pending.get(message.id);
      if (!entry) return;
      if (message.type === 'progress') {
        entry.onProgress?.(message.fraction, message.label);
        return;
      }
      pending.delete(message.id);
      if (message.type === 'error') entry.reject(new Error(message.message));
      else entry.resolve(message.result);
    });
    worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'The PDF worker failed');
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(error);
      }
      worker?.terminate();
      worker = null;
    });
  } catch {
    worker = null;
  }
  return worker;
}

type RequestBody = WorkerRequest extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never;

function call<T>(
  request: RequestBody,
  onProgress?: (fraction: number, label: string) => void,
): Promise<T> {
  const instance = getWorker();
  if (!instance) return Promise.reject(new Error('Web Workers are unavailable'));
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress });
    instance.postMessage({ ...request, id } as WorkerRequest);
  });
}

export interface ExportRequest extends Omit<BuildOptions, 'rasterize'> {
  /** Force main-thread execution (used when a canvas is required). */
  forceMainThread?: boolean;
}

/** Does this export need a canvas, and therefore the main thread? */
export const exportNeedsCanvas = (doc: EditorDocument, options: BuildOptions): boolean =>
  Boolean(options.rasterizeAll) || doc.pages.some(pageNeedsFlattening);

export async function exportPdf(
  doc: EditorDocument,
  options: ExportRequest = {},
): Promise<BuildResult> {
  const { onProgress, signal, forceMainThread, ...rest } = options;

  if (forceMainThread || exportNeedsCanvas(doc, rest)) {
    return buildPdf(doc, { ...rest, onProgress, signal, rasterize: makeRasterizer(doc) });
  }

  try {
    return await call<BuildResult>({ type: 'build', doc, options: rest }, onProgress);
  } catch (error) {
    if ((error as Error).message === 'Web Workers are unavailable') {
      return buildPdf(doc, { ...rest, onProgress, signal, rasterize: makeRasterizer(doc) });
    }
    throw error;
  }
}

export async function repairStructure(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  return call<{ bytes: Uint8Array; pageCount: number }>({ type: 'repairStructure', bytes });
}
