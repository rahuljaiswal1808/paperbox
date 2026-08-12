import type { Asset } from '../../types/document';
import { uid } from '../util/misc';
import { canvasToBytes } from '../pdf/raster';

const SUPPORTED = new Set(['image/png', 'image/jpeg']);

/**
 * Normalise any image the browser can decode into something pdf-lib can embed
 * (PNG or JPEG), keeping its pixel dimensions.
 */
export async function createImageAsset(input: Blob, preferJpeg = false): Promise<Asset> {
  const bitmap = await createImageBitmap(input);
  const type = input.type;
  // Read the dimensions before closing: a closed bitmap reports 0×0.
  const { width, height } = bitmap;

  if (SUPPORTED.has(type) && !(preferJpeg && type === 'image/png')) {
    const bytes = new Uint8Array(await input.arrayBuffer());
    bitmap.close();
    return { id: uid('img'), type, bytes, width, height };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser');
  if (preferJpeg) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const outType = preferJpeg ? 'image/jpeg' : 'image/png';
  const bytes = await canvasToBytes(canvas, outType, 0.92);
  return { id: uid('img'), type: outType, bytes, width: canvas.width, height: canvas.height };
}

/** Trim transparent margins — used so drawn signatures sit tight in their box. */
export async function trimTransparent(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;
  const pad = 4;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const w = Math.min(width, maxX + pad) - x0;
  const h = Math.min(height, maxY + pad) - y0;
  const out = document.createElement('canvas');
  out.width = Math.max(1, w);
  out.height = Math.max(1, h);
  out.getContext('2d')?.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
  return out;
}
