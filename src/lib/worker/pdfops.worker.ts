/// <reference lib="webworker" />
/**
 * Off-main-thread PDF assembly.
 *
 * Writing a large PDF is a long synchronous CPU burst (object graph walking,
 * deflate, font subsetting). Doing it here keeps the editor responsive and lets
 * the UI show real progress. Operations that need a canvas stay on the main
 * thread — see `lib/pdf/raster.ts`.
 */
import { PDFDocument } from '@cantoo/pdf-lib';
import { buildPdf, type BuildOptions } from '../pdf/export';
import type { EditorDocument } from '../../types/document';

export type WorkerRequest =
  | {
      id: number;
      type: 'build';
      doc: EditorDocument;
      options: Omit<BuildOptions, 'rasterize' | 'onProgress' | 'signal'>;
    }
  | { id: number; type: 'repairStructure'; bytes: Uint8Array }
  | { id: number; type: 'cancel' };

export type WorkerResponse =
  | { id: number; type: 'progress'; fraction: number; label: string }
  | { id: number; type: 'done'; result: unknown }
  | { id: number; type: 'error'; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

const post = (message: WorkerResponse, transfer?: Transferable[]) =>
  transfer ? scope.postMessage(message, transfer) : scope.postMessage(message);

scope.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case 'build': {
        const result = await buildPdf(request.doc, {
          ...request.options,
          onProgress: (fraction, label) =>
            post({ id: request.id, type: 'progress', fraction, label }),
        });
        post({ id: request.id, type: 'done', result }, [result.bytes.buffer as ArrayBuffer]);
        break;
      }
      case 'repairStructure': {
        const doc = await PDFDocument.load(request.bytes, {
          ignoreEncryption: true,
          throwOnInvalidObject: false,
          updateMetadata: false,
          capNumbers: true,
        });
        const pageCount = doc.getPageCount();
        const bytes = await doc.save({ useObjectStreams: true });
        post({ id: request.id, type: 'done', result: { bytes, pageCount } }, [
          bytes.buffer as ArrayBuffer,
        ]);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    post({ id: request.id, type: 'error', message: (error as Error).message });
  }
});
