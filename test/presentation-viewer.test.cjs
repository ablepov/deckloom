const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const { chromium } = require('playwright');
const sharedViewer = require('../src/viewer.cjs');
const { normalizeProject } = require('../src/project.cjs');

function png(width, height, color) {
  const crc = bytes => { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; } return (n ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(name, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([...color, 255], y * (width * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
async function fixture(t, { published = true, html = false, legacy = false } = {}) {
  const files = new Map();
  const slides = [[960, 540, [180, 70, 40]], [540, 960, [40, 120, 160]], [800, 600, [40, 140, 90]]].map(([width, height, color], index) => {
    const id = ['first', 'portrait', 'last'][index], bytes = png(width, height, color), url = `/slides/${id}.png`;
    files.set(url, bytes);
    return { id, index, number: index + 1, name: id, width, height, artifacts: { png: { state: 'available', url, version: createHash('sha256').update(bytes).digest('hex') }, html: { state: 'missing' } } };
  });
  if (html) {
    slides[0].artifacts.png = { state: 'missing' }; slides[0].artifacts.html = { state: 'available', url: '/slides/first.html', version: 'one' };
    files.set('/slides/first.html', '<!doctype html><style>body{margin:0;background:#c75;font:40px Arial}input{font:inherit}</style><p>Статический слайд — «пример»</p><input aria-label="Поле внутри слайда"><input aria-label="Второе поле">');
  }
  const model = { contractVersion: 1, project: { id: 'presentation-fixture' }, generatedAt: '2026-10-23T10:00:00Z', decks: [{ id: 'demo', label: 'Показ — «пример»', width: 960, height: 540, slides }] };
  if (legacy) {
    delete model.contractVersion; delete model.project;
    const build = '9b7f3974-4615-48f7-8371-7cc06d8deaa5';
    model.decks[0].slides = slides.map(slide => {
      const htmlUrl = `/slides/${slide.id}.html`;
      files.set(htmlUrl, '<!doctype html><canvas></canvas><script>window.unsupportedExecuted=true</script>');
      return { id: slide.id, no: String(slide.number).padStart(2, '0'), name: slide.name, width: slide.width, height: slide.height,
        url: `${slide.artifacts.png.url}?v=${build}&build=${build}`, version: build, imageError: null,
        htmlUrl: `${htmlUrl}?v=${build}&build=${build}`, htmlVersion: build, htmlError: null };
    });
  }
  const control = { model, files, pngReads: 0, reads: 0, gate: null };
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://fixture').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(sharedViewer.renderPage({ config: { apiBase: '/show/api', published, storagePrefix: 'show-fixture' } })); }
    if (pathname === '/embed') { res.setHeader('Content-Type', 'text/html'); return res.end('<iframe title="Viewer" src="/" allow="fullscreen" style="width:95vw;height:85vh"></iframe>'); }
    if (pathname === '/embed-denied') { res.setHeader('Content-Type', 'text/html'); return res.end('<iframe title="Viewer" src="/" allow="fullscreen \'none\'" style="width:95vw;height:85vh"></iframe>'); }
    if (pathname === '/show/api/decks') {
      control.reads++; const snapshot = JSON.stringify(control.model); const gate = control.gate;
      if (gate) await gate;
      res.setHeader('Content-Type', 'application/json'); return res.end(snapshot);
    }
    if (pathname === '/show/api/downloads') { res.setHeader('Content-Type', 'application/json'); return res.end('{"decks":[]}'); }
    if (control.files.has(pathname)) {
      if (pathname.endsWith('.png')) control.pngReads++;
      res.setHeader('Content-Type', pathname.endsWith('.png') ? 'image/png' : 'text/html'); return res.end(control.files.get(pathname));
    }
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); });
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await page.waitForFunction(() => window.deckloomViewer.state.slides.length === 3);
  return { ...control, control, page, context, browser, url };
}
const counter = (page, value) => page.waitForFunction(value => document.querySelector('.presentation-counter').textContent === value, value);
const start = async page => { await page.locator('#presentationButton').click(); await page.locator('.presentation-controls').waitFor(); };

test('PNG presentation: selected start, native fullscreen, offline, boundaries, fit, exit and touch', { timeout: 90000 }, async t => {
  const { page, context, browser, url } = await fixture(t);
  await page.locator('#deckMode').click(); await page.evaluate(() => window.deckloomViewer.setIndex(1));
  await start(page); await counter(page, '2 / 3');
  assert.equal(await page.evaluate(() => document.fullscreenElement?.id), 'presentation');
  assert.equal(await page.locator('#app').evaluate(el => el.inert), true);
  const fit = await page.locator('.presentation-canvas').boundingBox(); assert.ok(fit.height <= 800 && fit.width / fit.height === 540 / 960);
  await context.setOffline(true);
  await page.keyboard.press('ArrowRight'); await counter(page, '3 / 3');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('PageDown'); await counter(page, '3 / 3');
  await page.keyboard.press('PageUp'); await counter(page, '2 / 3');
  await page.keyboard.press('ArrowLeft'); await counter(page, '1 / 3');
  await page.keyboard.press('ArrowLeft'); await counter(page, '1 / 3');
  await page.keyboard.press('Space'); await counter(page, '2 / 3');
  const blobUrl = await page.locator('.presentation-content img').getAttribute('src');
  await page.keyboard.press('Escape'); await page.locator('#presentation').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.deckloomViewer.state.mode), 'deck');
  assert.equal(await page.evaluate(() => window.deckloomViewer.state.index), 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'presentationButton');
  assert.equal(await page.evaluate(url => fetch(url).then(() => false, () => true), blobUrl), true, 'exit releases retained PNG URLs');
  await context.setOffline(false);
  await start(page); await page.evaluate(() => document.exitFullscreen()); await page.locator('#presentation').waitFor({ state: 'hidden' });
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const touch = await mobile.newPage();
  // Rotate the mobile fallback viewport; desktop native fullscreen is checked above.
  // Browser.setWindowBounds cannot resize a fullscreen window in headless Chromium.
  await touch.addInitScript(() => { Element.prototype.requestFullscreen = undefined; });
  await touch.goto(url); await touch.locator('#presentationButton:not(:disabled)').waitFor();
  await touch.locator('#presentationButton').tap(); await touch.locator('.presentation-controls').waitFor();
  await touch.getByRole('button', { name: 'Следующий слайд', exact: true }).tap(); await counter(touch, '2 / 3');
  assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await touch.setViewportSize({ width: 812, height: 375 });
  await touch.waitForFunction(() => {
    const canvas = document.querySelector('.presentation-canvas').getBoundingClientRect();
    const controls = document.querySelector('.presentation-controls').getBoundingClientRect();
    return canvas.bottom <= controls.top && canvas.left >= 0 && canvas.right <= innerWidth;
  });
  await touch.getByRole('button', { name: 'Выйти', exact: true }).tap(); await touch.locator('#presentation').waitFor({ state: 'hidden' }); await mobile.close();
});

test('fallback, static HTML iframe focus/input, failed preparation and retry, fullscreen embed', { timeout: 90000 }, async t => {
  const { page, url, control } = await fixture(t, { html: true });
  await page.evaluate(() => { Element.prototype.requestFullscreen = () => Promise.reject(new Error('Denied')); });
  control.files.delete('/slides/portrait.png');
  await page.locator('#presentationButton').click();
  await page.getByRole('button', { name: 'Повторить подготовку' }).waitFor();
  assert.match(await page.locator('.presentation-message').innerText(), /Слайд 2/);
  control.files.set('/slides/portrait.png', png(540, 960, [40, 120, 160]));
  await page.getByRole('button', { name: 'Повторить подготовку' }).click(); await page.locator('.presentation-controls').waitFor();
  assert.match(await page.locator('.presentation-hint').innerText(), /Показ в области окна/);
  const frame = page.frameLocator('.presentation-content iframe');
  assert.equal(await page.locator('.presentation-content iframe').getAttribute('sandbox'), 'allow-same-origin');
  await frame.getByLabel('Поле внутри слайда').fill('Текст'); await page.keyboard.press('ArrowRight'); await counter(page, '1 / 3');
  await page.keyboard.press('Tab'); assert.equal(await frame.getByLabel('Второе поле').evaluate(el => el === el.ownerDocument.activeElement), true);
  await frame.locator('p').click(); await page.keyboard.press('ArrowRight'); await counter(page, '2 / 3');
  await page.keyboard.press('Control+ArrowRight'); await counter(page, '2 / 3');
  await page.locator('#presentation').press('ArrowRight'); await counter(page, '3 / 3');
  await page.keyboard.press('Escape');
  await page.goto(url + '/embed');
  const embedded = page.frameLocator('iframe[title=Viewer]'); await embedded.locator('#presentationButton:not(:disabled)').waitFor();
  await embedded.locator('#presentationButton').click(); await embedded.locator('.presentation-controls').waitFor();
  assert.equal(await embedded.locator('#presentation').evaluate(el => el.ownerDocument.fullscreenElement === el), true);
  await embedded.getByRole('button', { name: 'Выйти', exact: true }).click();
  await embedded.locator('#presentation').waitFor({ state: 'hidden' });
  await page.goto(url + '/embed-denied');
  const denied = page.frameLocator('iframe[title=Viewer]'); await denied.locator('#presentationButton:not(:disabled)').waitFor();
  await denied.locator('#presentationButton').click(); await denied.locator('.presentation-controls').waitFor();
  assert.match(await denied.locator('.presentation-hint').innerText(), /Показ в области окна/);
  await denied.getByRole('button', { name: 'Выйти', exact: true }).click();
});

test('cancel slow preparation, reject changed bytes and active HTML, work without browser storage', { timeout: 90000 }, async t => {
  const { page, control, url } = await fixture(t, { html: true });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/slides/portrait.png', async route => { await gate; await route.continue().catch(() => {}); });
  const requested = page.waitForRequest(request => request.url().includes('/slides/portrait.png'));
  await page.locator('#presentationButton').click(); await requested;
  assert.equal(await page.locator('.presentation-controls').isVisible(), false);
  await page.keyboard.press('Escape'); await page.locator('#presentation').waitFor({ state: 'hidden' });
  release(); await page.unroute('**/slides/portrait.png');
  control.files.set('/slides/portrait.png', png(540, 960, [1, 2, 3]));
  await page.locator('#presentationButton').click(); await page.getByRole('button', { name: 'Повторить подготовку' }).waitFor();
  assert.match(await page.locator('.presentation-message').innerText(), /не соответствует выбранной версии/);
  await page.keyboard.press('Escape'); await page.locator('#presentation').waitFor({ state: 'hidden' });
  control.files.set('/slides/first.html', '<script>window.unsupportedExecuted=true</script>');
  await page.locator('#presentationButton').click(); await page.getByRole('button', { name: 'Повторить подготовку' }).waitFor();
  assert.equal(await page.locator('.presentation-controls').isVisible(), false);
  assert.equal(await page.evaluate(() => window.unsupportedExecuted), undefined);
  await page.keyboard.press('Escape'); await page.locator('#presentation').waitFor({ state: 'hidden' });
  control.files.set('/slides/first.html', '<p>Статический текст</p>'); control.files.set('/slides/portrait.png', png(540, 960, [40, 120, 160]));
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } }));
  await page.goto(url); await page.locator('#presentationButton:not(:disabled)').waitFor();
  await start(page); await counter(page, '1 / 3');
  await page.keyboard.press('Shift+Tab'); assert.equal(await page.getByRole('button', { name: 'Выйти', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
});

test('local polling cannot replace a show or a held version, including an in-flight response', { timeout: 90000 }, async t => {
  const { page, control } = await fixture(t, { published: false });
  let release; control.gate = new Promise(resolve => { release = resolve; });
  const requested = page.waitForRequest(request => request.url().includes('/show/api/decks'));
  await requested;
  await start(page); await counter(page, '1 / 3');
  control.model.decks[0].slides.reverse(); control.model.decks[0].label = 'Новая версия';
  control.gate = null; release();
  await page.evaluate(() => window.deckloomViewer.checkUpdates());
  assert.equal(await page.evaluate(() => window.deckloomViewer.state.slides[0].id), 'first');
  await page.keyboard.press('ArrowRight'); await counter(page, '2 / 3');
  await page.keyboard.press('Escape');
  await page.locator('.presentation-update').waitFor();
  assert.equal(await page.evaluate(() => window.deckloomViewer.state.slides[0].id), 'first');
  await page.locator('.presentation-update [data-update]').click();
  await page.waitForFunction(() => window.deckloomViewer.state.slides[0].id === 'last');
  assert.equal(await page.evaluate(() => window.deckloomViewer.state.slides[window.deckloomViewer.state.index].id), 'portrait');
});

test('a late image decode cannot undo reverse navigation or change the last shown slide on exit', { timeout: 90000 }, async t => {
  const { page } = await fixture(t);
  await start(page); await counter(page, '1 / 3');
  const delay = () => page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    window.releaseDecode = release;
    let once = true;
    HTMLImageElement.prototype.decode = function () {
      if (!once) return decode.call(this);
      once = false; window.decodePending = true;
      return gate.then(() => decode.call(this));
    };
  });
  await delay(); await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => window.decodePending);
  await page.keyboard.press('ArrowLeft'); await page.evaluate(() => window.releaseDecode());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await counter(page, '1 / 3');
  await page.evaluate(() => { window.decodePending = false; });
  await delay(); await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => window.decodePending);
  await page.keyboard.press('Escape'); await page.locator('#presentation').waitFor({ state: 'hidden' });
  await page.evaluate(() => window.releaseDecode());
  assert.equal(await page.evaluate(() => window.deckloomViewer.state.index), 0);
});

test('hosts can disable presentation with a validated optional viewer capability', () => {
  assert.equal(sharedViewer.renderPage({ config: { presentation: false } }).includes('id = \'presentationButton\''), false);
  const project = { contractVersion: 1, id: 'p', root: process.cwd(), mode: 'registered', decks: [], viewer: { presentation: false } };
  assert.equal(normalizeProject(project).viewer.presentation, false);
  assert.throws(() => normalizeProject({ ...project, viewer: { presentation: 'yes' } }), error => error.field === 'project.viewer.presentation');
});

test('legacy PNG takes priority over unsupported or unreadable HTML; build versions are not SHA-256', { timeout: 90000 }, async t => {
  const { page, context, control } = await fixture(t, { legacy: true });
  await start(page); await counter(page, '1 / 3');
  assert.equal(await page.locator('.presentation-content iframe').count(), 0);
  assert.equal(await page.locator('.presentation-content img').count(), 1);
  await context.setOffline(true);
  await page.keyboard.press('ArrowRight'); await counter(page, '2 / 3');
  await page.keyboard.press('ArrowRight'); await counter(page, '3 / 3');
  await page.keyboard.press('Escape'); await page.locator('#presentation').waitFor({ state: 'hidden' });
  await context.setOffline(false);
  control.model.decks[0].slides[0].htmlError = 'unreadable';
  control.model.decks[0].slides[0].version = 'a'.repeat(64); // Legacy cache version, not a declared content digest.
  await page.reload(); await page.locator('#presentationButton:not(:disabled)').waitFor();
  await start(page);
  assert.equal(await page.locator('.presentation-content iframe').count(), 0);
  await page.keyboard.press('Escape'); await page.locator('#presentation').waitFor({ state: 'hidden' });
});

test('legacy missing/unreadable PNG retains static HTML fallback and rejects active HTML', { timeout: 90000 }, async t => {
  const { page, control } = await fixture(t, { legacy: true });
  const slide = control.model.decks[0].slides[0];
  const pngUrl = slide.url;
  slide.url = null;
  control.files.set('/slides/first.html', '<!doctype html><p>Статический fallback — «пример»</p>');
  await page.reload(); await page.locator('#presentationButton:not(:disabled)').waitFor();
  await start(page); await counter(page, '1 / 3');
  assert.equal(await page.locator('.presentation-content iframe').count(), 1);
  assert.equal(await page.locator('.presentation-content iframe').getAttribute('sandbox'), 'allow-same-origin');
  assert.match(await page.frameLocator('.presentation-content iframe').locator('body').innerText(), /Статический fallback/);
  await page.keyboard.press('Escape'); await page.locator('#presentation').waitFor({ state: 'hidden' });
  slide.url = pngUrl; slide.imageError = 'unreadable';
  await page.reload(); await page.locator('#presentationButton:not(:disabled)').waitFor();
  await start(page); assert.equal(await page.locator('.presentation-content iframe').count(), 1);
  await page.keyboard.press('Escape'); await page.locator('#presentation').waitFor({ state: 'hidden' });
  control.files.set('/slides/first.html', '<!doctype html><canvas></canvas><script>window.unsupportedExecuted=true</script>');
  await page.locator('#presentationButton').click(); await page.getByRole('button', { name: 'Повторить подготовку' }).waitFor();
  assert.match(await page.locator('.presentation-message').innerText(), /HTML requires static preparation/);
  assert.equal(await page.evaluate(() => window.unsupportedExecuted), undefined);
  await page.keyboard.press('Escape'); await page.locator('#presentation').waitFor({ state: 'hidden' });
});

const chromeQuiet = page => page.waitForFunction(() => {
  const root = document.querySelector('#presentation');
  return root.classList.contains('is-quiet') && getComputedStyle(root.querySelector('.presentation-controls')).opacity === '0' && getComputedStyle(root.querySelector('.presentation-hint')).opacity === '0';
});
const chromeVisible = page => page.waitForFunction(() => {
  const root = document.querySelector('#presentation');
  return !root.classList.contains('is-quiet') && getComputedStyle(root.querySelector('.presentation-controls')).opacity === '1' && getComputedStyle(root.querySelector('.presentation-hint')).opacity === '1';
});

test('minimal play/chrome: joint timed fade, iframe pointer reveal, keyboard focus and physical RTL boundaries', { timeout: 90000 }, async t => {
  const { page } = await fixture(t, { html: true });
  const launch = page.getByRole('button', { name: 'Запустить презентацию', exact: true });
  assert.equal(await launch.getAttribute('title'), 'Запустить презентацию');
  assert.equal((await launch.textContent()).trim(), ''); assert.equal(await launch.locator('svg').count(), 1);
  assert.equal((await launch.boundingBox()).width, 34);
  await page.evaluate(() => document.documentElement.style.setProperty('--presentation-accent', '#f08020'));
  assert.equal(await launch.evaluate(el => getComputedStyle(el).color), 'rgb(240, 128, 32)');
  await start(page); await counter(page, '1 / 3');
  assert.equal((await page.locator('.presentation-controls button').allTextContents()).join('').trim(), '');
  assert.equal(await page.locator('.presentation-controls button svg').count(), 3);
  assert.equal(await page.locator('.presentation-controls').evaluate(el => getComputedStyle(el).borderTopWidth), '0px');
  const originalCanvas = await page.locator('.presentation-canvas').boundingBox();
  await page.mouse.move(20, 20); const started = Date.now(); await chromeQuiet(page);
  assert.ok(Date.now() - started >= 2300, 'idle delay is about 2.5 seconds before the fade');
  const transforms = await page.evaluate(() => ['.presentation-controls', '.presentation-hint'].map(selector => new DOMMatrix(getComputedStyle(document.querySelector(selector)).transform).m42));
  assert.deepEqual(transforms, [8, -6]);
  assert.deepEqual(await page.locator('.presentation-canvas').boundingBox(), originalCanvas);
  assert.equal(await page.locator('.presentation-canvas').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  await page.frameLocator('.presentation-content iframe').locator('p').hover(); await chromeVisible(page);
  await page.keyboard.press('ArrowRight'); await counter(page, '2 / 3');
  await page.waitForTimeout(2800); assert.equal(await page.locator('#presentation').evaluate(el => el.classList.contains('is-quiet')), false);
  await page.getByRole('button', { name: 'Следующий слайд', exact: true }).focus();
  await page.mouse.move(30, 30); await page.waitForTimeout(2800);
  assert.equal(await page.getByRole('button', { name: 'Следующий слайд', exact: true }).evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('.presentation-controls').evaluate(el => getComputedStyle(el).opacity), '1');
  assert.equal(await page.locator('.presentation-hint').evaluate(el => getComputedStyle(el).opacity), '1');
  await page.mouse.click(30, 30); await chromeQuiet(page); await page.mouse.move(31, 31); await chromeVisible(page);
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
  const boxes = await Promise.all(['previous', null, 'next', 'exit'].map(action => (action ? page.locator(`[data-show-action=${action}]`) : page.locator('.presentation-counter')).boundingBox()));
  assert.ok(boxes.every((box, index) => index === 0 || box.x > boxes[index - 1].x));
  await page.keyboard.press('ArrowLeft'); await counter(page, '1 / 3'); await page.keyboard.press('ArrowLeft'); await counter(page, '1 / 3');
  await page.keyboard.press('Escape'); await page.locator('#presentation').waitFor({ state: 'hidden' });
});

test('minimal chrome touch reveal and reduced motion preserve canvas and exit hit targets', { timeout: 90000 }, async t => {
  const { browser, url } = await fixture(t, { legacy: true });
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await mobile.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { Element.prototype.requestFullscreen = undefined; });
  await page.goto(url); await page.locator('#presentationButton:not(:disabled)').waitFor();
  await page.locator('#presentationButton').tap(); await page.locator('.presentation-controls').waitFor();
  const before = await page.locator('.presentation-canvas').boundingBox();
  const hintBefore = await page.locator('.presentation-hint').boundingBox();
  await chromeQuiet(page);
  assert.equal(await page.locator('.presentation-controls').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  assert.deepEqual(await page.locator('.presentation-hint').boundingBox(), hintBefore);
  assert.deepEqual(await page.locator('.presentation-canvas').boundingBox(), before);
  await page.locator('.presentation-screen').tap({ position: { x: 20, y: 20 } }); await chromeVisible(page); await counter(page, '1 / 3');
  for (const button of await page.locator('.presentation-controls button').all()) { const box = await button.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44); }
  const box = await page.locator('.presentation-controls').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 375);
  await page.getByRole('button', { name: 'Следующий слайд', exact: true }).tap(); await counter(page, '2 / 3');
  assert.equal(await page.locator('.presentation-content iframe').count(), 0);
  await page.locator('.presentation-screen').tap({ position: { x: 20, y: 20 } }); await chromeQuiet(page);
  await page.locator('.presentation-screen').tap({ position: { x: 20, y: 20 } }); await chromeVisible(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).tap(); await page.locator('#presentation').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []); await mobile.close();
});

test('preparation and retry remain visible beyond the chrome idle delay', { timeout: 90000 }, async t => {
  const { page } = await fixture(t, { legacy: true });
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/slides/portrait.png?*', async route => { await gate; await route.fulfill({ status: 404, body: '' }).catch(() => {}); });
  try {
    await page.locator('#presentationButton').click();
    await page.waitForFunction(() => document.querySelector('.presentation-message p').textContent.includes('2 из 3'));
    await page.waitForTimeout(2800);
    assert.equal(await page.locator('.presentation-message').isVisible(), true);
    assert.equal(await page.locator('#presentation').evaluate(el => el.classList.contains('is-quiet')), false);
    release(); await page.getByRole('button', { name: 'Повторить подготовку' }).waitFor();
    await page.waitForTimeout(2800);
    assert.equal(await page.getByRole('button', { name: 'Повторить подготовку' }).isVisible(), true);
    assert.equal(await page.locator('#presentation').evaluate(el => el.classList.contains('is-quiet')), false);
    await page.keyboard.press('Escape'); await page.locator('#presentation').waitFor({ state: 'hidden' });
  } finally { release(); }
});
