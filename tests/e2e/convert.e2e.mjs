/**
 * End-to-end: loads dist/chrome into real Chromium, opens the UI in a tab,
 * converts PNG → JPG / WEBP / resized+cropped PNG with the REAL magick.wasm,
 * checks the output bytes, the ZIP, settings persistence and the log.
 *
 *   npm run test:e2e          (builds first)
 *   CHROMIUM_PATH=... node tests/e2e/convert.e2e.mjs
 *
 * On a dev machine run `npx playwright install chromium` once.
 */
import { chromium } from 'playwright';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makePng } from '../fixtures/make-png.mjs';

const EXT = resolve('dist/chrome');
if (!existsSync(join(EXT, 'manifest.json'))) throw new Error('Run `npm run build:chrome` first');

const tmp = mkdtempSync(join(tmpdir(), 'ic-e2e-'));
// Files are passed as buffers: Playwright silently drops non-ASCII *paths*.
// The Cyrillic name is on purpose (ZIP UTF-8 flag, download names).
const pngPath = { name: 'тест gradient.png', mimeType: 'image/png', buffer: makePng(64, 48) };
const png2Path = { name: 'second.png', mimeType: 'image/png', buffer: makePng(40, 40) };

const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};

const ctx = await chromium.launchPersistentContext(join(tmp, 'profile'), {
  executablePath,
  channel: executablePath ? undefined : 'chromium',
  headless: true,
  acceptDownloads: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  check(!!extId, `extension loaded (${extId})`);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`chrome-extension://${extId}/popup.html?view=tab`);

  await page.waitForFunction(() => document.querySelector('#engine-dot')?.classList.contains('ok') || document.querySelector('#engine-dot')?.classList.contains('err'), null, { timeout: 60000 });
  const engineOk = await page.$eval('#engine-dot', (d) => d.classList.contains('ok'));
  check(engineOk, `engine ready: "${await page.textContent('#engine-status')}"`);
  check(await page.$eval('body', (b) => b.classList.contains('is-tab')), 'tab mode layout');

  // Format list comes from the engine's real capabilities.
  const formats = await page.$$eval('#format-select option:not([disabled])', (os) => os.map((o) => o.value));
  check(formats.includes('png') && formats.includes('jpg') && formats.includes('webp'), `format list has png/jpg/webp (${formats.length} formats)`);
  check(!formats.includes('avif') && !formats.includes('heic') && !formats.includes('jxl'), 'fake formats (avif/heic/jxl) not offered');
  const webpRoute = await page.evaluate(() => window.icApp.d.engine.caps.outputs.get('webp'));
  check(webpRoute === 'browser', `webp route: ${webpRoute}`);

  // Helper: read queue records (status + result bytes header) straight from IndexedDB.
  const readQueue = () => page.evaluate(async () => {
    const db = await new Promise((r, j) => { const q = indexedDB.open('image-converter-db', 1); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
    const recs = await new Promise((r) => { const q = db.transaction('queue').objectStore('queue').getAll(); q.onsuccess = () => r(q.result); });
    return Promise.all(recs.map(async (x) => ({
      name: x.name, status: x.status, error: x.error, resultName: x.resultName, resultSize: x.resultSize,
      head: x.resultBlobStored ? Array.from(new Uint8Array(await x.resultBlobStored.slice(0, 16).arrayBuffer())) : [],
      type: x.resultBlobStored?.type,
    })));
  });
  const waitDone = (n) => page.waitForFunction((n) => document.querySelectorAll('.badge.done, .badge.error').length >= n, n, { timeout: 120000 });

  // 1) PNG → JPG via the quick format selector, single "Convert all"
  await page.selectOption('#format-select', 'jpg');
  await page.setInputFiles('#file-input', pngPath);
  await page.waitForSelector('.queue-item');
  await page.click('#btn-convert-all');
  await waitDone(1);
  let q = await readQueue();
  check(q[0]?.status === 'done', `PNG→JPG status ${q[0]?.status} ${q[0]?.error || ''}`);
  check(q[0]?.head[0] === 0xff && q[0]?.head[1] === 0xd8, 'JPG magic bytes FF D8');
  check(q[0]?.type === 'image/jpeg', `JPG mime ${q[0]?.type}`);
  check(q[0]?.resultName === 'тест gradient.jpg', `result name ${q[0]?.resultName}`);
  const deltaText = await page.textContent('.size-delta');
  check(/%/.test(deltaText || ''), `size delta shown (${deltaText})`);

  // 2) Per-item override: WEBP, resize 50%, crop
  await page.click('#btn-clear-all');
  await page.selectOption('#format-select', 'png');
  await page.setInputFiles('#file-input', pngPath);
  await page.click('.queue-item .icon-btn[title]:nth-last-child(2)'); // expand ▸
  await page.selectOption('[data-role="item-format"]', 'webp');
  await page.selectOption('.queue-item-panel select[data-resize="mode"]', 'percent');
  await page.fill('.queue-item-panel input[data-resize="w"]', '50');
  await page.dispatchEvent('.queue-item-panel input[data-resize="w"]', 'change');
  await page.click('.queue-item-panel__convert');
  await waitDone(1);
  q = await readQueue();
  const webpHead = String.fromCharCode(...q[0].head.slice(8, 12));
  check(q[0]?.status === 'done' && webpHead === 'WEBP', `PNG→WEBP (${webpHead}) ${q[0]?.error || ''}`);
  const webpDims = await page.evaluate(async () => {
    const item = window.icApp.queue[0];
    const bmp = await createImageBitmap(item.resultBlob);
    return [bmp.width, bmp.height];
  });
  check(webpDims[0] === 32 && webpDims[1] === 24, `resize 50% → ${webpDims.join('×')}`);

  // 2b) WEBP input (IM can't read it) → browser decode fallback → PNG
  await page.click('#btn-clear-all');
  const webpBytes = await page.evaluate(async () => {
    const c = new OffscreenCanvas(30, 20); const g = c.getContext('2d'); g.fillStyle = '#3a6'; g.fillRect(0, 0, 30, 20);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality: 0.8 })).arrayBuffer()));
  });
  await page.setInputFiles('#file-input', { name: 'in.webp', mimeType: 'image/webp', buffer: Buffer.from(webpBytes) });
  await page.click('#btn-convert-all');
  await waitDone(1);
  q = await readQueue();
  check(q[0]?.status === 'done' && q[0].head[0] === 0x89 && q[0].head[1] === 0x50, `WEBP input → PNG ${q[0]?.status} ${q[0]?.error || ''}`);

  // 2c) Format the build can't write → clear error, nothing mislabeled saved
  await page.click('#btn-clear-all');
  await page.setInputFiles('#file-input', pngPath);
  await page.evaluate(() => { const it = window.icApp.queue[0]; window.icApp.updateOverrides(it, { format: 'avif' }); });
  await page.click('#btn-convert-all');
  await waitDone(1);
  q = await readQueue();
  check(q[0]?.status === 'error' && /AVIF/.test(q[0].error), `AVIF → error "${q[0]?.error}"`);

  // 3) Crop via the crop dialog numbers → PNG
  await page.click('#btn-clear-all');
  await page.setInputFiles('#file-input', pngPath);
  await page.click('.queue-item .icon-btn[title]:nth-last-child(2)');
  await page.click('.crop-row .btn');
  await page.waitForSelector('.crop-modal input[data-crop="w"]');
  await page.fill('.crop-modal input[data-crop="x"]', '16');
  await page.fill('.crop-modal input[data-crop="y"]', '12');
  await page.fill('.crop-modal input[data-crop="w"]', '20');
  await page.fill('.crop-modal input[data-crop="h"]', '10');
  await page.click('.crop-modal .btn-primary');
  check((await page.textContent('.crop-row__status'))?.includes('20×10'), 'crop applied in UI');
  await page.click('.queue-item-panel__convert');
  await waitDone(1);
  const pngDims = await page.evaluate(async () => {
    const bmp = await createImageBitmap(window.icApp.queue[0].resultBlob);
    return [bmp.width, bmp.height];
  });
  check(pngDims[0] === 20 && pngDims[1] === 10, `crop → ${pngDims.join('×')}`);

  // 4) Unsupported-looking input gives a readable error, not a hang
  await page.click('#btn-clear-all');
  const badPath = { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('definitely not a png') };
  await page.setInputFiles('#file-input', badPath);
  await page.click('#btn-convert-all');
  await waitDone(1);
  q = await readQueue();
  check(q[0]?.status === 'error' && q[0].error.length > 0, `broken input → error "${q[0]?.error}"`);

  // 5) Auto-ZIP of two files
  await page.click('#btn-clear-all');
  await page.evaluate(() => window.icApp.updateSettings({ autoZip: true }));
  const zipCapture = page.evaluate(() => new Promise((resolve) => {
    const orig = window.icApp.d.downloads.save;
    window.icApp.d.downloads.save = async (blob, name, saveAs) => {
      const head = Array.from(new Uint8Array(await blob.arrayBuffer()));
      resolve({ name, size: blob.size, head: head.slice(0, 4), text: new TextDecoder().decode(new Uint8Array(head)) });
      return orig(blob, name, saveAs);
    };
  }));
  await page.setInputFiles('#file-input', [pngPath, png2Path]);
  await page.click('#btn-convert-all');
  const zip = await zipCapture;
  check(zip.head[0] === 0x50 && zip.head[1] === 0x4b, `ZIP saved as ${zip.name} (${zip.size} B)`);
  check(zip.text.includes('тест gradient.png') && zip.text.includes('second.png'), 'ZIP contains both entries (UTF-8 name)');

  // 6) Settings persisted across reload (incl. default resize — lost in v1.0)
  await page.evaluate(() => window.icApp.updateSettings({ resize: { mode: 'percent', w: '25', h: '' }, quality: 75 }));
  await page.reload();
  await page.waitForSelector('#engine-dot.ok', { timeout: 60000 });
  const persisted = await page.evaluate(() => ({ r: window.icApp.s.resize, q: window.icApp.s.quality, log: window.icApp.s.log.length, zip: window.icApp.s.autoZip }));
  check(persisted.r.mode === 'percent' && persisted.r.w === '25' && persisted.q === 75 && persisted.zip, `settings persisted ${JSON.stringify(persisted)}`);
  check(persisted.log >= 3, `log has ${persisted.log} entries`);

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
} finally {
  await ctx.close();
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll e2e checks passed');
