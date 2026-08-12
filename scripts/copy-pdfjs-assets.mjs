/**
 * Copies the runtime assets pdf.js needs (standard fonts, CMaps, ICC profiles and
 * the image-decoder wasm bundles) into `public/pdfjs` so they are served locally.
 *
 * Keeping them in `public/` means they get precached by the service worker, which
 * is what makes rendering work with no network connection at all.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'pdfjs-dist');
const to = join(root, 'public', 'pdfjs');

const DIRS = ['standard_fonts', 'cmaps', 'iccs', 'wasm'];

if (!existsSync(from)) {
  console.error('[pdfjs-assets] pdfjs-dist is not installed; run npm install first.');
  process.exit(1);
}

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });

for (const dir of DIRS) {
  const src = join(from, dir);
  if (!existsSync(src)) continue;
  await cp(src, join(to, dir), { recursive: true });
}

console.log(`[pdfjs-assets] copied ${DIRS.join(', ')} -> public/pdfjs`);
