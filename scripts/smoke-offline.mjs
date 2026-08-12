/**
 * Proves the offline claim: after one visit, the app and pdf.js's runtime assets
 * come from the service-worker cache, so a PDF still opens and renders with the
 * network disconnected.
 *
 * Usage: node scripts/smoke-offline.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.SMOKE_OUT ?? join(root, '.smoke');
const BASE = process.argv[2] ?? 'http://localhost:4173';
const SAMPLE = process.env.SAMPLE_PDF ?? join(OUT, 'sample.pdf');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  check('service worker activates', registered);

  // Give Workbox time to finish precaching before pulling the plug.
  await page.waitForTimeout(6000);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls = [];
    for (const name of names) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return {
      total: urls.length,
      worker: urls.some((u) => /pdf\.worker.*\.mjs/.test(u)),
      fonts: urls.some((u) => /standard_fonts/.test(u)),
      wasm: urls.some((u) => /\.wasm/.test(u)),
    };
  });
  check('assets precached for offline use', cached.total > 100, `${cached.total} cached entries`);
  check(
    'pdf.js runtime assets are cached, not fetched on demand',
    cached.worker && cached.fonts && cached.wasm,
    `worker=${cached.worker} fonts=${cached.fonts} wasm=${cached.wasm}`,
  );

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  check('app shell loads with the network off', await page.getByText('A complete PDF workspace').isVisible());

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
  (await chooser).setFiles(SAMPLE);
  await page.waitForSelector('#page-0 canvas', { timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('#page-0 canvas');
      return canvas && canvas.width > 100;
    },
    { timeout: 30_000 },
  );
  const ink = await page.evaluate(() => {
    const canvas = document.querySelector('#page-0 canvas');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, Math.min(canvas.height, 600));
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 200) dark += 1;
    return dark;
  });
  check('a PDF opens and renders while offline', ink > 500, `${ink} dark pixels`);
  await page.screenshot({ path: join(OUT, '20-offline.png') });
} catch (error) {
  check('offline run completed', false, String(error?.stack ?? error));
  await page.screenshot({ path: join(OUT, '97-offline-failure.png') }).catch(() => undefined);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
