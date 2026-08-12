/**
 * Generates the multi-page fixture the smoke tests drive the app with:
 * real text to search and highlight, a rotated page, and a line of "secret"
 * text used to prove redaction destroys content.
 */
import { PDFDocument, StandardFonts, rgb, degrees } from '@cantoo/pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.SMOKE_OUT ?? join(root, '.smoke');
mkdirSync(out, { recursive: true });

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
doc.setTitle('Quarterly Report');
doc.setAuthor('Acme Corp');

for (let i = 0; i < 4; i += 1) {
  const page = doc.addPage([595.28, 841.89]);
  page.drawText('Quarterly Report', { x: 60, y: 760, size: 26, font: bold, color: rgb(0.06, 0.09, 0.13) });
  page.drawText(`Section ${i + 1}: Operations overview`, { x: 60, y: 720, size: 14, font, color: rgb(0.2, 0.25, 0.35) });
  for (let l = 0; l < 18; l += 1) {
    page.drawText(`Line ${l + 1} of page ${i + 1}: the quick brown fox jumps over the lazy dog.`, {
      x: 60,
      y: 670 - l * 22,
      size: 11,
      font,
      color: rgb(0.1, 0.12, 0.16),
    });
  }
  page.drawText('CONFIDENTIAL secret-token-42', { x: 60, y: 230, size: 13, font: bold, color: rgb(0.7, 0.1, 0.1) });
  page.drawRectangle({ x: 60, y: 120, width: 200, height: 80, borderColor: rgb(0.4, 0.5, 0.7), borderWidth: 1 });
  if (i === 2) page.setRotation(degrees(90));
}

writeFileSync(join(out, 'sample.pdf'), await doc.save());
console.log(`[sample] wrote ${join(out, 'sample.pdf')}`);
