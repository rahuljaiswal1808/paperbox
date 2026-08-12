/**
 * Canvas composition: draws a model page (source content + editor objects) into
 * a bitmap.
 *
 * Used for three things:
 *  - page thumbnails that show annotations,
 *  - PDF → image conversion,
 *  - destructive flattening for redaction and image-based compression, where
 *    the composed pixels *become* the page and the original content is dropped.
 */
import type { EditorDocument, PageObject, PageState, Rect } from '../../types/document';
import type { PageRasterizer, RasterizedPage } from './export';
import { cssFontFamily } from './fonts';
import { layoutText } from './textLayout';
import { openPdf, renderPageToBitmap } from './pdfjs';
import { viewRect } from './geometry';

const bitmapCache = new Map<string, Promise<ImageBitmap>>();

export function getAssetBitmap(doc: EditorDocument, assetId: string): Promise<ImageBitmap> {
  const cached = bitmapCache.get(assetId);
  if (cached) return cached;
  const asset = doc.assets[assetId];
  if (!asset) return Promise.reject(new Error(`Missing image asset ${assetId}`));
  const promise = createImageBitmap(
    new Blob([asset.bytes.slice().buffer as ArrayBuffer], { type: asset.type }),
  );
  bitmapCache.set(assetId, promise);
  promise.catch(() => bitmapCache.delete(assetId));
  return promise;
}

export const forgetAssetBitmap = (assetId: string) => bitmapCache.delete(assetId);

export interface ComposeOptions {
  /** Pixels per point. */
  scale: number;
  /** Draw editor objects on top of the source content. Default true. */
  withObjects?: boolean;
  /** Paint redaction boxes as solid fills. Default true. */
  withRedactions?: boolean;
  /** Skip the source page content (used for annotation-only overlays). */
  sourceOnly?: boolean;
}

/** Render one model page into a fresh canvas at `scale` pixels per point. */
export async function composePage(
  doc: EditorDocument,
  page: PageState,
  { scale, withObjects = true, withRedactions = true }: ComposeOptions,
): Promise<HTMLCanvasElement> {
  const view = viewRect(page);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(view.width * scale));
  canvas.height = Math.max(1, Math.round(view.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(-view.x * scale, -view.y * scale);

  if (page.sourceId) {
    const source = doc.sources[page.sourceId];
    if (source) {
      const pdf = await openPdf(page.sourceId, source.bytes, source.password);
      if (page.sourceIndex < pdf.numPages) {
        const pdfPage = await pdf.getPage(page.sourceIndex + 1);
        const rendered = await renderPageToBitmap(pdfPage, scale, page.rotation);
        ctx.drawImage(rendered, 0, 0);
      }
    }
  }

  if (withObjects) {
    for (const object of page.objects) {
      if (object.kind === 'redact' && !withRedactions) continue;
      await drawObjectOnCanvas(ctx, doc, object, scale);
    }
  }

  ctx.restore();
  return canvas;
}

export async function drawObjectOnCanvas(
  ctx: CanvasRenderingContext2D,
  doc: EditorDocument,
  object: PageObject,
  scale: number,
): Promise<void> {
  ctx.save();
  ctx.globalAlpha = object.opacity ?? 1;
  if (object.rotation) {
    const cx = (object.x + object.width / 2) * scale;
    const cy = (object.y + object.height / 2) * scale;
    ctx.translate(cx, cy);
    ctx.rotate((object.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  const x = object.x * scale;
  const y = object.y * scale;
  const w = object.width * scale;
  const h = object.height * scale;

  switch (object.kind) {
    case 'text': {
      if (object.background) {
        ctx.fillStyle = object.background;
        ctx.fillRect(x, y, w, h);
      }
      const style = object.style;
      const font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size * scale}px ${cssFontFamily(style.font)}`;
      ctx.font = font;
      ctx.fillStyle = style.color;
      ctx.textBaseline = 'alphabetic';
      const lines = layoutText(object.text, style, object.width, (text, size) => {
        ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${size * scale}px ${cssFontFamily(style.font)}`;
        return ctx.measureText(text).width / scale;
      });
      ctx.font = font;
      for (const line of lines) {
        if (!line.text) continue;
        ctx.fillText(line.text, x + line.x * scale, y + line.baseline * scale);
      }
      break;
    }
    case 'image': {
      try {
        const bitmap = await getAssetBitmap(doc, object.assetId);
        ctx.drawImage(bitmap, x, y, w, h);
      } catch {
        ctx.strokeStyle = '#94a3b8';
        ctx.strokeRect(x, y, w, h);
      }
      break;
    }
    case 'shape': {
      ctx.strokeStyle = object.stroke;
      ctx.lineWidth = Math.max(0.5, object.strokeWidth * scale);
      ctx.lineCap = 'round';
      if (object.shape === 'rectangle') {
        if (object.fill) {
          ctx.fillStyle = object.fill;
          ctx.fillRect(x, y, w, h);
        }
        if (object.strokeWidth > 0) ctx.strokeRect(x, y, w, h);
      } else if (object.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        if (object.fill) {
          ctx.fillStyle = object.fill;
          ctx.fill();
        }
        if (object.strokeWidth > 0) ctx.stroke();
      } else {
        const from = object.from ?? { x: 0, y: 0.5 };
        const to = object.to ?? { x: 1, y: 0.5 };
        const ax = x + from.x * w;
        const ay = y + from.y * h;
        const bx = x + to.x * w;
        const by = y + to.y * h;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        if (object.shape === 'arrow') {
          const angle = Math.atan2(by - ay, bx - ax);
          const size = Math.max(6, object.strokeWidth * 3.5) * scale;
          ctx.beginPath();
          for (const spread of [Math.PI * 0.82, -Math.PI * 0.82]) {
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(angle + spread) * size, by + Math.sin(angle + spread) * size);
          }
          ctx.stroke();
        }
      }
      break;
    }
    case 'ink': {
      ctx.strokeStyle = object.stroke;
      ctx.lineWidth = Math.max(0.5, object.strokeWidth * scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const stroke of object.strokes) {
        if (stroke.length === 0) continue;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x * scale, stroke[0].y * scale);
        for (const point of stroke.slice(1)) ctx.lineTo(point.x * scale, point.y * scale);
        if (stroke.length === 1) ctx.lineTo(stroke[0].x * scale + 0.1, stroke[0].y * scale);
        ctx.stroke();
      }
      break;
    }
    case 'markup': {
      for (const rect of object.rects) {
        const rx = rect.x * scale;
        const ry = rect.y * scale;
        const rw = rect.width * scale;
        const rh = rect.height * scale;
        if (object.markup === 'highlight') {
          ctx.globalAlpha = (object.opacity ?? 1) * 0.35;
          ctx.fillStyle = object.color;
          ctx.fillRect(rx, ry, rw, rh);
          ctx.globalAlpha = object.opacity ?? 1;
        } else {
          ctx.strokeStyle = object.color;
          ctx.lineWidth = Math.max(0.8, rh * 0.06);
          const ly = object.markup === 'underline' ? ry + rh * 0.94 : ry + rh * 0.55;
          ctx.beginPath();
          ctx.moveTo(rx, ly);
          ctx.lineTo(rx + rw, ly);
          ctx.stroke();
        }
      }
      break;
    }
    case 'note': {
      ctx.fillStyle = object.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 0.5 * scale;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3 * scale);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1f2937';
      ctx.font = `${Math.max(6, 9 * scale)}px ${cssFontFamily('Helvetica')}`;
      ctx.fillText('note', x + 3 * scale, y + h - 4 * scale, w - 6 * scale);
      break;
    }
    case 'redact': {
      ctx.fillStyle = object.fill || '#000000';
      ctx.fillRect(x, y, w, h);
      if (object.overlayText) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.max(6, 9 * scale)}px ${cssFontFamily('Helvetica')}`;
        ctx.fillText(object.overlayText, x + 3 * scale, y + h / 2 + 3 * scale, w - 6 * scale);
      }
      break;
    }
    case 'field': {
      ctx.fillStyle = 'rgba(240,247,255,0.95)';
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = Math.max(0.5, scale);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#0f172a';
      ctx.font = `${Math.max(6, (object.fontSize ?? 11) * scale)}px ${cssFontFamily('Helvetica')}`;
      if (object.field === 'checkbox') {
        if (object.checked) {
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = Math.max(1, 1.5 * scale);
          ctx.beginPath();
          ctx.moveTo(x + w * 0.22, y + h * 0.52);
          ctx.lineTo(x + w * 0.45, y + h * 0.76);
          ctx.lineTo(x + w * 0.8, y + h * 0.25);
          ctx.stroke();
        }
      } else if (object.value) {
        ctx.fillText(object.value, x + 2 * scale, y + h * 0.72, w - 4 * scale);
      }
      break;
    }
    default:
      break;
  }

  ctx.restore();
}

export function canvasToBytes(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`This browser could not encode ${type}`));
          return;
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      type,
      quality,
    );
  });
}

/** Rasteriser for `buildPdf`, bound to a document. */
export function makeRasterizer(doc: EditorDocument): PageRasterizer {
  return async (page, _index, { dpi, quality, format }): Promise<RasterizedPage> => {
    const scale = dpi / 72;
    const canvas = await composePage(doc, page, { scale });
    const type = format === 'png' ? 'image/png' : 'image/jpeg';
    const bytes = await canvasToBytes(canvas, type, quality);
    return { bytes, type, width: canvas.width, height: canvas.height };
  };
}

export const thumbnailScale = (page: PageState, targetWidth: number): number => {
  const view: Rect = viewRect(page);
  return Math.max(0.05, targetWidth / Math.max(1, view.width));
};
