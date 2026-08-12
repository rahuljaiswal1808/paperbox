import { zipSync } from 'fflate';
import { sanitizeFilename } from './misc';

/** Trigger a browser download for bytes we produced locally. Never uploads. */
export function downloadBytes(bytes: Uint8Array | Blob, filename: string, type = 'application/pdf') {
  const blob =
    bytes instanceof Blob
      ? bytes
      : new Blob([bytes.slice().buffer as ArrayBuffer], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadZip(files: { name: string; bytes: Uint8Array }[], filename: string) {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[sanitizeFilename(file.name)] = file.bytes;
  const zipped = zipSync(entries, { level: 6 });
  downloadBytes(zipped, filename, 'application/zip');
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(input.files ? [...input.files] : []));
    // Covers the user dismissing the dialog in browsers that fire `cancel`.
    input.addEventListener('cancel', () => finish([]));
    input.click();
  });
}

export const readFileBytes = async (file: File | Blob): Promise<Uint8Array> =>
  new Uint8Array(await file.arrayBuffer());

export const isPdfFile = (file: File): boolean =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

export const isImageFile = (file: File): boolean =>
  file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(blob);
  });
}
