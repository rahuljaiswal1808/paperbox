/**
 * End-to-end smoke test: drives the built app in a real browser, exercises the
 * MVP paths (open, render, annotate, page ops, search, export) and verifies the
 * exported PDF can be parsed back.
 *
 * Usage: node scripts/smoke.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Text of every page of a PDF, read the way any other reader would. */
async function extractText(bytes) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname,
  });
  const pdf = await task.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str ?? '').join(' '));
  }
  await task.destroy();
  return pages;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.SMOKE_OUT ?? join(root, '.smoke');
const BASE = process.argv[2] ?? 'http://localhost:4173';
const SAMPLE = process.env.SAMPLE_PDF ?? join(OUT, 'sample.pdf');

mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 940 }, acceptDownloads: true });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('home screen renders', await page.getByText('A complete PDF workspace').isVisible());
  await shot('01-home');

  // ---------------------------------------------------------------- open
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
  (await chooser).setFiles(SAMPLE);

  await page.waitForSelector('#page-0 canvas', { timeout: 30_000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#page-0 canvas');
    return canvas && canvas.width > 100;
  }, { timeout: 30_000 });
  check('PDF opens and first page renders', true);

  const pageCount = await page.locator('.thumbs .thumb').count();
  check('thumbnails listed', pageCount === 4, `${pageCount} thumbnails`);
  await shot('02-opened');

  // -------------------------------------------------------------- render
  const ink = await page.evaluate(() => {
    const canvas = document.querySelector('#page-0 canvas');
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, Math.min(canvas.height, 600));
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 200) dark += 1;
    return dark;
  });
  check('page canvas contains rendered content', ink > 500, `${ink} dark pixels`);

  // -------------------------------------------------------------- search
  await page.locator('.sidebar__tab[aria-label="Search"]').click();
  await page.locator('#search-input').fill('quick brown fox');
  await page.waitForFunction(
    () => document.querySelectorAll('.sidebar__body .list-row').length > 0,
    { timeout: 20_000 },
  );
  const hits = await page.locator('.sidebar__body .list-row').count();
  check('search finds matches across pages', hits >= 4, `${hits} hits`);
  await shot('03-search');

  // ---------------------------------------------------------- annotation
  await page.locator('.sidebar__tab[aria-label="Page thumbnails"]').click();
  await page.getByRole('button', { name: /^Draw/ }).click();
  const box = await page.locator('#page-0 .page__overlay').boundingBox();
  await page.mouse.move(box.x + 80, box.y + 160);
  await page.mouse.down();
  for (let i = 0; i < 12; i += 1) {
    await page.mouse.move(box.x + 80 + i * 12, box.y + 160 + Math.sin(i / 2) * 22);
  }
  await page.mouse.up();
  check('freehand drawing creates an object', (await page.locator('#page-0 .obj').count()) >= 1);

  // text box
  await page.getByRole('button', { name: /^Text box/ }).click();
  await page.mouse.move(box.x + 120, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 340);
  await page.mouse.up();
  await page.keyboard.type('Reviewed locally by Paperbox');
  await page.keyboard.press('Escape');
  const textObjects = await page.evaluate(() =>
    [...document.querySelectorAll('#page-0 .obj')].filter((el) => el.textContent?.includes('Reviewed locally')).length,
  );
  check('text box accepts typing', textObjects === 1);

  // highlight over existing text
  await page.getByRole('button', { name: /^Highlight/ }).click();
  await page.mouse.move(box.x + 60, box.y + 96);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 112);
  await page.mouse.up();
  const objectCount = await page.locator('#page-0 .obj').count();
  check('highlight added', objectCount >= 3, `${objectCount} objects on page 1`);
  await shot('04-annotated');

  // ----------------------------------------------------------- undo/redo
  await page.getByRole('button', { name: 'Select', exact: false }).first().click();
  await page.keyboard.press('Control+z');
  const afterUndo = await page.locator('#page-0 .obj').count();
  check('undo removes the last annotation', afterUndo === objectCount - 1, `${afterUndo} objects`);
  await page.keyboard.press('Control+Shift+z');
  const afterRedo = await page.locator('#page-0 .obj').count();
  check('redo restores it', afterRedo === objectCount, `${afterRedo} objects`);

  // ------------------------------------------------------- page management
  await page.locator('.thumbs .thumb').nth(1).click();
  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate selected' }).click();
  check('duplicate page', (await page.locator('.thumbs .thumb').count()) === 5);

  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('menuitem', { name: 'Rotate right' }).click();
  const rotated = await page.evaluate(() => {
    const store = window.__paperbox?.getState?.();
    return store?.doc?.pages?.[1]?.rotation;
  });
  check('rotate page updates the model', rotated === 90, `rotation=${rotated}`);

  await page.getByRole('button', { name: 'Pages' }).click();
  await page.getByRole('menuitem', { name: 'Delete selected' }).click();
  check('delete page', (await page.locator('.thumbs .thumb').count()) === 4);
  await shot('05-pages');

  // --------------------------------------------------------------- export
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const file = await download;
  const exported = join(OUT, 'exported.pdf');
  await file.saveAs(exported);
  const bytes = readFileSync(exported);
  check('export downloads a file', bytes.length > 1000, `${bytes.length} bytes`);

  const parsed = await PDFDocument.load(bytes, { throwOnInvalidObject: false });
  check('exported PDF parses', parsed.getPageCount() === 4, `${parsed.getPageCount()} pages`);
  check('exported metadata kept', parsed.getTitle() === 'Quarterly Report', `title=${parsed.getTitle()}`);
  const modelRotations = await page.evaluate(() =>
    window.__paperbox.getState().doc.pages.map((p) => p.rotation),
  );
  const rotations = parsed.getPages().map((p) => p.getRotation().angle);
  check(
    'page rotations written to file match the editor model',
    JSON.stringify(rotations) === JSON.stringify(modelRotations),
    `file=${rotations.join(',')} model=${modelRotations.join(',')}`,
  );

  const exportedText = await extractText(bytes);
  check(
    'exported text survives a round trip',
    exportedText[0].includes('quick brown fox'),
    exportedText[0].slice(0, 40),
  );
  check(
    'annotations added in the editor are in the file',
    exportedText[0].includes('Reviewed locally by Paperbox'),
  );

  // ------------------------------------------------------------- redaction
  // Page 1 must be in view before we can drag on it.
  await page.evaluate(() => window.__paperbox.getState().setCurrentPage(0));
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Redact/ }).click();
  const box2 = await page.locator('#page-0 .page__overlay').boundingBox();
  await page.mouse.move(box2.x + 55, box2.y + 560);
  await page.mouse.down();
  await page.mouse.move(box2.x + 340, box2.y + 585);
  await page.mouse.up();
  const redactObjects = await page.evaluate(
    () => window.__paperbox.getState().doc.pages[0].objects.filter((o) => o.kind === 'redact').length,
  );
  check('redaction area marked on page 1', redactObjects === 1, `${redactObjects} redactions`);

  const redactDownload = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const redacted = await redactDownload;
  const redactedPath = join(OUT, 'redacted.pdf');
  await redacted.saveAs(redactedPath);
  const redactedBytes = readFileSync(redactedPath);
  const flattened = await PDFDocument.load(redactedBytes, { throwOnInvalidObject: false });
  check('redacted export parses', flattened.getPageCount() === 4);

  // The real test of redaction: the covered text must be unrecoverable from the
  // file, not merely hidden behind a black box.
  const redactedText = await extractText(redactedBytes);
  check(
    'redacted content is gone from the file, not just covered',
    !redactedText[0].includes('secret-token-42'),
    `page 1 text length ${redactedText[0].length}`,
  );
  check(
    'other pages keep their selectable text',
    redactedText[1].includes('quick brown fox'),
    `page 2 length ${redactedText[1].length}`,
  );
  await shot('06-redacted');

  // ------------------------------------------------------------- protection
  await page.getByRole('button', { name: 'Tools' }).click();
  await page.getByRole('menuitem', { name: /Password & permissions/ }).click();
  await page.getByLabel('Encrypt this PDF with a password').check();
  await page.getByLabel('Open password (user)').fill('hunter2');
  await page.getByLabel('Confirm').fill('hunter2');
  const protectedDownload = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Save protected copy' }).click();
  const protectedFile = await protectedDownload;
  const protectedPath = join(OUT, 'protected.pdf');
  await protectedFile.saveAs(protectedPath);
  const protectedBytes = readFileSync(protectedPath);
  let encrypted = false;
  try {
    await PDFDocument.load(protectedBytes);
  } catch (error) {
    encrypted = /encrypt/i.test(String(error));
  }
  const opensWithPassword = await PDFDocument.load(protectedBytes, { password: 'hunter2' })
    .then((d) => d.getPageCount() > 0)
    .catch(() => false);
  check('protected file is encrypted', encrypted, 'load without password rejected');
  check('protected file opens with the password', opensWithPassword);

  // --------------------------------------------------------------- console
  const realErrors = consoleErrors.filter(
    (text) => !/favicon|manifest|sw\.js|Download the React DevTools/i.test(text),
  );
  check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
} catch (error) {
  check('smoke run completed', false, String(error?.stack ?? error));
  await shot('99-failure');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
