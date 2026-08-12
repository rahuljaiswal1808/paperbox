/**
 * Second smoke pass: the PDF operations reachable from the home screen and the
 * Tools menu — images→PDF, merge, split, compress, conversion, watermark,
 * headers, signatures, crop and form fields.
 *
 * Usage: node scripts/smoke-tools.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from '@cantoo/pdf-lib';
import { unzipSync } from 'fflate';

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

// The app's own icon doubles as a real PNG for the images→PDF path.
const imagePath = join(OUT, 'square.png');
writeFileSync(imagePath, readFileSync(join(root, 'public', 'icon-512.png')));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 940 }, acceptDownloads: true });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
/** Dialog-scoped locators: the home screen behind the modal has similar labels. */
const modal = () => page.locator('.modal');
/** A reload may offer to restore the autosaved session; start clean instead. */
const dismissRecovery = async () => {
  const restore = page.getByRole('button', { name: 'Discard' });
  if (await restore.count()) {
    await restore.click();
    await page.locator('.modal').waitFor({ state: 'detached' }).catch(() => undefined);
  }
};
const openSample = async () => {
  await dismissRecovery();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
  (await chooser).setFiles(SAMPLE);
  await page.waitForSelector('#page-0 canvas');
  await page.waitForFunction(() => window.__paperbox?.getState().doc?.pages.length === 4);
};
const saveDownload = async (promise, name) => {
  const download = await promise;
  const path = join(OUT, name);
  await download.saveAs(path);
  return readFileSync(path);
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // ------------------------------------------------------- images -> PDF
  {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Images to PDF' }).first().click();
    (await chooser).setFiles(imagePath);
    await page.waitForFunction(() => window.__paperbox?.getState().doc?.pages.length === 1, { timeout: 30_000 });
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Export PDF' }).click();
    const bytes = await saveDownload(download, 'from-image.pdf');
    const doc = await PDFDocument.load(bytes);
    check('images → PDF produces a one-page document', doc.getPageCount() === 1);
    const size = doc.getPage(0).getSize();
    check('image page uses A4 geometry', Math.round(size.width) === 595, `${Math.round(size.width)}×${Math.round(size.height)}`);
  }

  // --------------------------------------------------------------- merge
  await page.reload({ waitUntil: 'networkidle' });
  {
    await page.waitForTimeout(500);
    await dismissRecovery();
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Merge PDFs…' }).click();
    const chooser = page.waitForEvent('filechooser');
    await modal().getByRole('button', { name: 'Choose files' }).click();
    (await chooser).setFiles([SAMPLE, SAMPLE]);
    await modal().getByRole('button', { name: /^Merge/ }).click();
    await page.waitForFunction(() => window.__paperbox?.getState().doc?.pages.length === 8, { timeout: 60_000 });
    check('merge combines both files', true, '8 pages');
    const download = page.waitForEvent('download', { timeout: 90_000 });
    await page.getByRole('button', { name: 'Export PDF' }).click();
    const merged = await PDFDocument.load(await saveDownload(download, 'merged.pdf'));
    check('merged export has every page', merged.getPageCount() === 8, `${merged.getPageCount()} pages`);
  }

  // --------------------------------------------------------------- split
  await page.reload({ waitUntil: 'networkidle' });
  await openSample();
  {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Split…' }).click();
    await modal().getByRole('button', { name: 'Every N pages' }).click();
    await modal().getByLabel('Pages per file').fill('2');
    const download = page.waitForEvent('download', { timeout: 90_000 });
    await modal().getByRole('button', { name: /^Create 2 files/ }).click();
    const zip = unzipSync(new Uint8Array(await saveDownload(download, 'split.zip')));
    const names = Object.keys(zip);
    check('split produces a zip of parts', names.length === 2, names.join(', '));
    const first = await PDFDocument.load(zip[names[0]]);
    check('each split part has the right page count', first.getPageCount() === 2, `${first.getPageCount()} pages`);
  }

  // ------------------------------------------------------------ compress
  {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Compress…' }).click();
    await modal().getByRole('button', { name: /Strong/ }).click();
    await modal().getByRole('button', { name: 'Compress', exact: true }).click();
    await modal().locator('.note').first().waitFor({ timeout: 120_000 });
    const summary = await modal().locator('.note').innerText();
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await modal().getByRole('button', { name: /^Save/ }).click();
    const compressed = await PDFDocument.load(await saveDownload(download, 'compressed.pdf'));
    check('compression reports a result', /→/.test(summary), summary.replace(/\s+/g, ' ').slice(0, 60));
    check('compressed file keeps every page', compressed.getPageCount() === 4);
  }

  // -------------------------------------------------------- PDF -> images
  {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export as images…' }).click();
    const download = page.waitForEvent('download', { timeout: 120_000 });
    await modal().getByRole('button', { name: /^Export 4 images/ }).click();
    const zip = unzipSync(new Uint8Array(await saveDownload(download, 'images.zip')));
    const names = Object.keys(zip);
    check('PDF → images exports one file per page', names.length === 4, names.join(', '));
    const png = zip[names[0]];
    check('exported image is a real PNG', png[0] === 0x89 && png[1] === 0x50, `${png.length} bytes`);
  }

  // ---------------------------------------------------------- PDF -> text
  {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export as text…' }).click();
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await modal().getByRole('button', { name: 'Download .txt' }).click();
    const text = (await saveDownload(download, 'extracted.txt')).toString('utf8');
    check('PDF → text extracts the document text', text.includes('quick brown fox'), `${text.length} chars`);
    check('text export marks page boundaries', (text.match(/--- Page \d+ ---/g) ?? []).length === 4);
  }

  // ----------------------------------------------------------- watermark
  {
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Watermark…' }).click();
    await modal().getByLabel('Text', { exact: true }).fill('DRAFT COPY');
    await modal().getByRole('button', { name: /^Apply to all 4 pages/ }).click();
    const marks = await page.evaluate(
      () =>
        window.__paperbox
          .getState()
          .doc.pages.filter((p) => p.objects.some((o) => o.kind === 'text' && o.text === 'DRAFT COPY')).length,
    );
    check('watermark applied to every page', marks === 4, `${marks} pages`);
  }

  // ------------------------------------------------- header / page numbers
  {
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('menuitem', { name: /Header, footer/ }).click();
    await modal().getByRole('button', { name: /^Apply to 4 pages/ }).click();
    const footers = await page.evaluate(() =>
      window.__paperbox
        .getState()
        .doc.pages.map((p) => p.objects.filter((o) => o.kind === 'text' && /Page \d+ of 4/.test(o.text)).length),
    );
    check('page numbers added to every page', footers.every((n) => n === 1), footers.join(','));
  }

  // ------------------------------------------------------------ signature
  {
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Signatures…' }).click();
    await modal().getByRole('tab', { name: 'Type' }).click();
    await modal().getByLabel('Your name').fill('Alex Morgan');
    await modal().getByRole('button', { name: 'Use this signature' }).click();
    await modal().locator('.signature-preview img').waitFor({ timeout: 15_000 });
    await modal().getByRole('button', { name: 'Use signature' }).click();
    await page.locator('.modal').waitFor({ state: 'detached', timeout: 15_000 });
    const box = await page.locator('#page-0 .page__overlay').boundingBox();
    await page.mouse.click(box.x + 300, box.y + 640);
    const signatures = await page.evaluate(
      () => window.__paperbox.getState().doc.pages[0].objects.filter((o) => o.isSignature).length,
    );
    check('typed signature placed on the page', signatures === 1);
    await shot('10-signature');
  }

  // ----------------------------------------------------------------- crop
  {
    await page.getByRole('button', { name: /^Crop page/ }).click();
    const box = await page.locator('#page-0 .page__overlay').boundingBox();
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 500);
    await page.mouse.up();
    const crop = await page.evaluate(() => window.__paperbox.getState().doc.pages[0].crop);
    check('crop sets a visible region', Boolean(crop) && crop.width > 100, JSON.stringify(crop));

    const download = page.waitForEvent('download', { timeout: 90_000 });
    await page.getByRole('button', { name: 'Export PDF' }).click();
    const cropped = await PDFDocument.load(await saveDownload(download, 'cropped.pdf'));
    const cropBox = cropped.getPage(0).getCropBox();
    check(
      'crop box written to the exported file',
      Math.abs(cropBox.width - crop.width) < 2,
      `${Math.round(cropBox.width)}×${Math.round(cropBox.height)}`,
    );
  }

  // ---------------------------------------------------------- form fields
  await page.reload({ waitUntil: 'networkidle' });
  await openSample();
  {
    await page.getByRole('button', { name: /^Form field/ }).click();
    const box = await page.locator('#page-0 .page__overlay').boundingBox();
    await page.mouse.move(box.x + 80, box.y + 700);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 722);
    await page.mouse.up();
    const fieldId = await page.evaluate(
      () => window.__paperbox.getState().doc.pages[0].objects.find((o) => o.kind === 'field')?.id,
    );
    check('form field created', Boolean(fieldId));

    await page.evaluate((id) => {
      window.__paperbox.getState().selectObjects([id]);
    }, fieldId);
    await page.getByLabel('Field name').fill('applicant_name');
    await page.getByLabel('Value').fill('Alex Morgan');

    const download = page.waitForEvent('download', { timeout: 90_000 });
    await page.getByRole('button', { name: 'Export PDF' }).click();
    const withForm = await PDFDocument.load(await saveDownload(download, 'form.pdf'));
    const fields = withForm.getForm().getFields().map((f) => f.getName());
    check('interactive field written to the PDF', fields.includes('applicant_name'), fields.join(', '));
    const value = withForm.getForm().getTextField('applicant_name').getText();
    check('field carries its value', value === 'Alex Morgan', String(value));
  }

  // --------------------------------------------------------------- repair
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await dismissRecovery();
  {
    // Corrupt the cross-reference table the way a truncated download would.
    const original = readFileSync(SAMPLE);
    const broken = Buffer.from(original);
    const at = broken.lastIndexOf('startxref');
    broken.write('startxref\n999999', at);
    const brokenPath = join(OUT, 'broken.pdf');
    writeFileSync(brokenPath, broken);

    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Repair a PDF…' }).click();
    const chooser = page.waitForEvent('filechooser');
    await modal().getByRole('button', { name: 'Choose file' }).first().click();
    (await chooser).setFiles(brokenPath);
    await modal().locator('.note').first().waitFor({ timeout: 120_000 });
    const download = page.waitForEvent('download', { timeout: 90_000 });
    await modal().getByRole('button', { name: 'Save repaired file' }).click();
    const repaired = await PDFDocument.load(await saveDownload(download, 'repaired.pdf'));
    check('damaged PDF repaired', repaired.getPageCount() === 4, `${repaired.getPageCount()} pages`);
  }

  // ------------------------------------------------ opening a protected PDF
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await dismissRecovery();
  {
    const protectedPath = join(OUT, 'protected.pdf');
    if (existsSync(protectedPath)) {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
      (await chooser).setFiles(protectedPath);
      await page.getByText('This PDF is password protected').waitFor({ timeout: 30_000 });
      check('encrypted PDF asks for its password', true);
      await modal().getByLabel('Password').fill('wrong-one');
      await modal().getByRole('button', { name: 'Unlock' }).click();
      await page.getByText('That password did not work').waitFor({ timeout: 30_000 });
      check('wrong password is reported', true);
      await modal().getByLabel('Password').fill('hunter2');
      await modal().getByRole('button', { name: 'Unlock' }).click();
      await page.waitForFunction(() => window.__paperbox?.getState().doc?.pages.length === 4, { timeout: 30_000 });
      check('correct password opens the document', true);
    }
  }

  const realErrors = consoleErrors.filter((t) => !/favicon|manifest|sw\.js|DevTools/i.test(t));
  check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (error) {
  check('tools smoke run completed', false, String(error?.stack ?? error));
  await shot('98-tools-failure');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
