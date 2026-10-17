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

/**
 * A second fixture shaped like a real statement or receipt: small 8pt type in
 * two columns, padded with runs of spaces the way such files usually are, plus
 * one label deliberately split across two text runs. These are what break naive
 * line detection — the columns must stay separate while the split label joins.
 */
const table = await PDFDocument.create();
const tableFont = await table.embedFont(StandardFonts.Helvetica);
const tablePage = table.addPage([595.28, 841.89]);
table.setTitle('Two column receipt');

const ROWS = [
  ['Reference Number', 'SC1217915292157'],
  ['Merchant Name', 'Example Buyers Project'],
  ['Flat/Unit Number', 'K0605'],
  ['Amount Being Paid Now', '168407'],
  ['Payment Category', 'Installment'],
];

const SIZE = 8;
ROWS.forEach(([label, value], index) => {
  const y = 740 - index * 13.6;
  tablePage.drawText(label, { x: 72, y, size: SIZE, font: tableFont, color: rgb(0.1, 0.1, 0.1) });
  // The padding run that, left in the line, would glue the columns together.
  const labelWidth = tableFont.widthOfTextAtSize(label, SIZE);
  tablePage.drawText(' '.repeat(60), { x: 72 + labelWidth, y, size: SIZE, font: tableFont });
  tablePage.drawText(value, { x: 360, y, size: SIZE, font: tableFont, color: rgb(0.1, 0.1, 0.1) });
});

// A label split into two runs a hair apart: these belong to one line.
const splitY = 740 - ROWS.length * 13.6;
tablePage.drawText('Total', { x: 72, y: splitY, size: SIZE, font: tableFont, color: rgb(0.1, 0.1, 0.1) });
tablePage.drawText('cost of flat', {
  x: 72 + tableFont.widthOfTextAtSize('Total ', SIZE),
  y: splitY,
  size: SIZE,
  font: tableFont,
  color: rgb(0.1, 0.1, 0.1),
});
tablePage.drawText('4447250', { x: 360, y: splitY, size: SIZE, font: tableFont, color: rgb(0.1, 0.1, 0.1) });

writeFileSync(join(out, 'two-column.pdf'), await table.save());
console.log(`[sample] wrote ${join(out, 'two-column.pdf')}`);
