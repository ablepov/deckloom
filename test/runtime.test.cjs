const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { chromium } = require('playwright');
const { createRenderer, createReviewServer, scanDecks } = require('../src/index.cjs');

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>';
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-b4-'));
  t.after(async () => {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  return root;
}
async function write(root, relative, data) {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data, typeof data === 'string' ? 'utf8' : undefined);
}
async function serve(t, project) {
  const server = createReviewServer(project);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    // Hooks run in registration order: polling browser cleanup follows this hook.
    // End test-owned connections so server shutdown cannot wait on that browser.
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}
function fixture(root, layout = 'stable') {
  const example = require('../examples/render-v1.config.cjs');
  const project = { ...example, root, decks: example.decks.map(deck => ({ ...deck, slides: deck.slides.map(slide => ({ ...slide, data: { ...slide.data } })) })) };
  if (layout === 'legacy') {
    project.artifacts = { layout: 'legacy' };
    project.decks.forEach(deck => {
      deck.artifactPrefix = `${deck.id}-slide`;
      deck.slides.forEach((slide, index) => { slide.artifactNo = String(index + 1).padStart(2, '0'); });
    });
  }
  return project;
}
function folder(project, deck, slide) {
  return project.artifacts?.layout === 'legacy' ? `${deck.artifactPrefix}-${slide.artifactNo}` : path.join(`deck-${deck.id}`, `slide-${slide.id}`);
}

test('v1 stable and legacy render use canonical metadata across hooks, PNG, API and viewer', async t => {
  const parent = await temporary(t), browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const layout of ['stable', 'legacy']) {
    const root = path.join(parent, layout), project = fixture(root, layout);
    project.decks[0].slides[0].data.self = project.decks[0].slides[0].data;
    const calls = [], document = project.renderDocument;
    project.renderDocument = async (deck, slide, context) => {
      assert(Object.isFrozen(deck)); assert(Object.isFrozen(slide));
      assert.equal(slide.data, project.decks.find(d => d.id === deck.id).slides.find(s => s.id === slide.id).data);
      calls.push({ deck: deck.id, slide: slide.id, baseUrl: context.baseUrl, width: slide.width, height: slide.height });
      return document(deck, slide, context);
    };
    project.validateDocument = async (html, deck, slide) => {
      await Promise.resolve();
      assert(html.includes(`width:${slide.width}px;height:${slide.height}px`));
      assert(deck.slides.some(item => item.id === slide.id));
    };
    project.renderSpec = async (deck, slide) => `${deck.id}/${slide.id}: ${slide.width}x${slide.height}`;
    const renderer = createRenderer(project);
    const first = await renderer.renderDeck(browser, { id: 'mixed', slides: [{ id: 'injected' }], width: 1 });
    const second = await renderer.renderDeck(browser, 'portrait');
    assert.deepEqual(first.map(r => r.slide), ['default', 'width-only', 'height-only', 'both']);
    assert.deepEqual(first.map(r => [r.width, r.height]), [[800, 450], [600, 450], [800, 700], [450, 800]]);
    assert(first.concat(second).every(r => !r.layoutIssues && !r.missingAssets && !r.consoleMessages));
    const api = await scanDecks(project);
    for (const [di, report] of [first, second].entries()) for (const [si, entry] of report.entries()) {
      const slide = api.decks[di].slides[si];
      const bytes = await fs.readFile(entry.png);
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [slide.width, slide.height]);
      assert.equal(slide.artifacts.html.state, 'available'); assert.equal(slide.artifacts.png.state, 'available');
      assert.equal(await fs.readFile(entry.spec, 'utf8'), `${entry.deck}/${entry.slide}: ${entry.width}x${entry.height}`);
      const qa = JSON.parse(await fs.readFile(entry.qa, 'utf8'));
      assert.equal(qa.slide.id, entry.slide); assert.equal(qa.slide.width, slide.width);
      assert(!Object.hasOwn(qa.slide, 'data')); assert(!Object.hasOwn(qa.deck, 'data'));
      assert.equal(entry.index, si); assert.equal(entry.number, si + 1);
    }
    const origin = await serve(t, project), page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(origin);
    await page.frameLocator('.html-document-frame').first().locator('.slide').waitFor();
    await page.locator('#deckMode').click();
    assert.deepEqual(await page.locator('.html-inline-holder').evaluateAll(nodes => nodes.map(n => [n.offsetWidth, n.offsetHeight])), first.map(r => [r.width, r.height]));
    await page.locator('#focusMode').click();
    for (let index = 0; index < first.length; index++) {
      await page.locator(`.slide-tab[data-index="${index}"]`).click();
      const ratio = await page.locator('.slide-card.is-active .stage').evaluate(el => { const rect = el.getBoundingClientRect(); return rect.width / rect.height; });
      assert(Math.abs(ratio - first[index].width / first[index].height) < 0.02);
    }
    await page.locator('#deckMode').click(); await page.setViewportSize({ width: 400, height: 800 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(pageErrors, []); await page.close();
    const before = await fs.readFile(first[0].html, 'utf8');
    const isolated = path.join(parent, `isolated-${layout}`);
    const copied = await renderer.renderDeck(browser, 'mixed', { outputRoot: isolated });
    assert(copied.every(entry => entry.png.startsWith(isolated + path.sep)));
    assert.equal(calls.at(-4).baseUrl, pathToFileURL(path.join(root, folder(project, project.decks[0], project.decks[0].slides[0])) + path.sep).href);
    assert.equal(await fs.readFile(first[0].html, 'utf8'), before);
    await assert.rejects(renderer.renderDeck(browser, { id: 'MIXED', slides: project.decks[0].slides }), { code: 'UNKNOWN_DECK' });
  }
});

test('legacy raw callbacks keep independent axis inheritance in PNG and read projections', async t => {
  const root = await temporary(t), browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const deck = { id: 'legacy', label: 'Legacy', artifactPrefix: 'old', width: 640,
    slides: [{ no: '01', height: 360 }, { no: '02', width: 450, height: 800 }, { no: '03', width: 320 }] };
  const project = { root, decks: [deck], renderDocument(d, s) {
    assert.equal(d, deck); assert(deck.slides.includes(s));
    return `<style>html,body{margin:0}.slide{width:${s.width ?? d.width ?? 1920}px;height:${s.height ?? d.height ?? 1080}px}</style><main class="slide">Legacy</main>`;
  }, async renderQa(context) {
    assert.equal(context.deck, deck); assert(deck.slides.includes(context.slide));
    return JSON.stringify({ issues: context.layoutIssues });
  } };
  const report = await createRenderer(project).renderDeck(browser, deck);
  const payload = await scanDecks(project);
  assert.deepEqual(payload.decks[0].slides.map(s => [s.width, s.height]), [[640, 360], [450, 800], [320, 1080]]);
  for (const [index, entry] of report.entries()) {
    const bytes = await fs.readFile(entry.png);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [payload.decks[0].slides[index].width, payload.decks[0].slides[index].height]);
    assert.equal(entry.slide, deck.slides[index].no);
    assert.equal(JSON.parse(await fs.readFile(entry.qa, 'utf8')).issues, 0);
  }
});

test('v1 render rejects empty/unsupported targets and path conflicts before writing', async t => {
  const parent = await temporary(t), root = path.join(parent, 'no-writes'), project = fixture(root);
  const renderer = createRenderer(project);
  project.decks[0].slides[0].width = 16385;
  await assert.rejects(renderer.renderDeck(null, 'mixed'), { code: 'UNSUPPORTED_CANVAS', deckId: 'mixed', slideId: 'default' });
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  project.decks[0].slides[0].width = 12000; project.decks[0].slides[0].height = 12000;
  await assert.rejects(renderer.run(['--deck=all']), { code: 'UNSUPPORTED_CANVAS' });
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  delete project.decks[0].slides[0].width; delete project.decks[0].slides[0].height;
  project.decks.push({ id: 'draft', label: 'Draft', slides: [] });
  await assert.rejects(renderer.run(['--deck=all']), { code: 'EMPTY_DECK' });
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  project.decks.pop();
  await write(root, 'deck-mixed/slide-default/render.html/occupied.txt', 'A directory is not HTML');
  const before = await scanDecks(project);
  assert.equal(before.decks[0].slides[0].artifacts.html.state, 'unreadable');
  await assert.rejects(renderer.renderDeck(null, 'mixed'), { code: 'PATH_CONFLICT' });
  assert.equal(await fs.readFile(path.join(root, 'deck-mixed/slide-default/render.html/occupied.txt'), 'utf8'), 'A directory is not HTML');
  await assert.rejects(fs.stat(path.join(root, 'deck-mixed/slide-width-only')), { code: 'ENOENT' });
});

test('HTML and PNG availability is independent, local and diagnostic across API and viewer', async t => {
  const parent = await temporary(t), root = path.join(parent, 'artifacts'), outside = path.join(parent, 'outside');
  const ids = ['html-only', 'png-only', 'both', 'neither', 'html-directory', 'parent-file', 'outside', 'broken', 'denied', 'png-denied', 'corrupt-png', 'empty-html'];
  const project = { contractVersion: 1, id: 'states', mode: 'registered', root, decks: [{ id: 'main', label: 'States', width: 640, height: 360, slides: ids.map(id => ({ id })) }] };
  const html = '<style>html,body{margin:0}.slide{width:640px;height:360px}</style><main class="slide">HTML</main>';
  const leaf = (id, file) => `deck-main/slide-${id}/${file}`;
  for (const id of ['html-only', 'both', 'denied']) await write(root, leaf(id, 'render.html'), html);
  for (const id of ['png-only', 'both', 'html-directory', 'denied', 'png-denied']) await write(root, leaf(id, 'generated-html.png'), pixel);
  await fs.mkdir(path.join(root, leaf('html-directory', 'render.html')));
  await write(root, 'deck-main/slide-parent-file', 'not a directory');
  await write(outside, 'render.html', 'OUTSIDE_SECRET');
  await fs.symlink(outside, path.join(root, 'deck-main/slide-outside'), 'junction');
  await fs.symlink(path.join(parent, 'missing-target'), path.join(root, 'deck-main/slide-broken'), 'junction');
  await write(root, leaf('corrupt-png', 'generated-html.png'), 'invalid PNG bytes');
  await write(root, leaf('empty-html', 'render.html'), '');
  const access = fs.access;
  const denied = new Set([path.join(root, leaf('denied', 'render.html')), path.join(root, leaf('png-denied', 'generated-html.png'))]);
  fs.access = async (file, ...args) => { if (denied.has(file)) throw Object.assign(new Error('Test denied'), { code: 'EACCES' }); return access(file, ...args); };
  t.after(() => { fs.access = access; });
  const payload = await scanDecks(project);
  const states = Object.fromEntries(payload.decks[0].slides.map(s => [s.id, [s.artifacts.html.state, s.artifacts.png.state]]));
  assert.deepEqual(states, {
    'html-only': ['available', 'missing'], 'png-only': ['missing', 'available'], both: ['available', 'available'], neither: ['missing', 'missing'],
    'html-directory': ['unreadable', 'available'], 'parent-file': ['unreadable', 'unreadable'], outside: ['unreadable', 'unreadable'], broken: ['unreadable', 'unreadable'],
    denied: ['unreadable', 'available'], 'png-denied': ['missing', 'unreadable'], 'corrupt-png': ['missing', 'available'], 'empty-html': ['available', 'missing'],
  });
  for (const slide of payload.decks[0].slides) for (const artifact of Object.values(slide.artifacts)) {
    if (artifact.state !== 'available') assert(!Object.hasOwn(artifact, 'url'));
  }
  assert.equal(payload.decks[0].slides.find(s => s.id === 'outside').artifacts.html.diagnostic, 'PATH_ESCAPE');
  assert.equal(payload.decks[0].slides.find(s => s.id === 'broken').artifacts.html.diagnostic, 'BROKEN_LINK');
  assert(!JSON.stringify(payload).includes(root)); assert(!JSON.stringify(payload).includes('OUTSIDE_SECRET'));
  const origin = await serve(t, project);
  assert.deepEqual((await (await fetch(origin + '/api/decks')).json()).decks, payload.decks);
  assert.equal((await fetch(origin + '/artifacts/deck-main/slide-outside/render.html')).status, 404);
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  await page.route('**/slide-both/render.html*', route => route.fulfill({ status: 503, body: 'Test HTML failure' }));
  await page.goto(origin);
  await page.frameLocator('#card-main-html-only iframe').locator('.slide').waitFor();
  await page.locator('#deckMode').click();
  assert.equal(await page.locator('.slide-tab').count(), ids.length);
  await page.waitForSelector('#card-main-png-only img[data-preview-image]');
  await page.waitForFunction(() => document.querySelector('#card-main-png-only img').naturalWidth > 0);
  await page.waitForSelector('#card-main-both [role=alert]');
  assert.equal(await page.locator('#card-main-both [role=alert]').textContent(), 'Failed to load HTML preview.');
  assert.equal(await page.locator('#card-main-both img[data-preview-image]').count(), 0, 'HTML failure must not silently fall back to PNG');
  assert.equal(await page.locator('#card-main-neither [role=status]').textContent(), 'Preview has not been generated.');
  assert.equal(await page.locator('#card-main-denied [role=status]').textContent(), 'HTML preview is unavailable.');
  await page.waitForSelector('#card-main-corrupt-png [role=alert]');
  assert.equal(await page.locator('#card-main-corrupt-png [role=alert]').textContent(), 'Failed to load image preview.');
  await page.waitForSelector('#card-main-empty-html [role=alert]');
  await write(root, leaf('corrupt-png', 'generated-html.png'), pixel);
  await write(root, leaf('empty-html', 'render.html'), html + '<!-- repaired -->');
  await page.waitForFunction(() => document.querySelector('#card-main-corrupt-png img')?.naturalWidth > 0 && !!document.querySelector('#card-main-empty-html iframe')?.contentDocument?.querySelector('.slide'));
  assert.equal(await page.locator('#card-main-corrupt-png [role=alert]').count(), 0);
  assert.equal(await page.locator('.slide-tab').count(), ids.length);
});

test('isolated v1 PNG rendering resolves resources against the original slide folder', async t => {
  const parent = await temporary(t), root = path.join(parent, 'source'), output = path.join(parent, 'isolated');
  const project = fixture(root); project.decks = [project.decks[0]]; project.decks[0].slides = [project.decks[0].slides[0]];
  await write(root, 'deck-mixed/slide-default/marker.svg', svg);
  const document = project.renderDocument;
  project.renderDocument = (deck, slide, context) => document(deck, slide, context).replace('</main>', '<img width="10" height="10" src="marker.svg" alt="Marker"></main>');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const report = await createRenderer(project).renderDeck(browser, 'mixed', { outputRoot: output });
  assert.equal(report[0].missingAssets, 0); assert.equal(report[0].consoleMessages, 0);
  assert((await fs.readFile(report[0].html, 'utf8')).includes(pathToFileURL(path.join(root, 'deck-mixed/slide-default') + path.sep).href));
  await assert.rejects(fs.stat(path.join(root, 'deck-mixed/slide-default/render.html')), { code: 'ENOENT' });
});

test('transient HTML and image failures recover on healthy polls without metadata changes', async t => {
  const root = await temporary(t);
  const project = { contractVersion: 1, id: 'retries', mode: 'registered', root,
    decks: [{ id: 'main', label: 'Retries', width: 640, height: 360, slides: [{ id: 'html' }, { id: 'image' }] }] };
  await write(root, 'deck-main/slide-html/render.html', '<main class="slide">Recovered HTML</main>');
  await write(root, 'deck-main/slide-html/generated-html.png', pixel);
  await write(root, 'deck-main/slide-image/generated-html.png', pixel);
  const before = await scanDecks(project), origin = await serve(t, project);
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); let htmlRequests = 0, imageRequests = 0;
  await page.route('**/slide-html/render.html*', route => ++htmlRequests === 1 ? route.fulfill({ status: 503, body: 'Temporary failure' }) : route.continue());
  await page.route('**/slide-image/generated-html.png*', route => ++imageRequests === 1 ? route.fulfill({ status: 503, body: 'Temporary image failure' }) : route.continue());
  await page.goto(origin);
  await page.locator('#deckMode').click();
  await page.waitForSelector('#card-main-html [role=alert]');
  await page.waitForSelector('#card-main-image [role=alert]');
  assert.equal(await page.locator('#card-main-html img[data-preview-image]').count(), 0);
  await page.waitForFunction(() => !!document.querySelector('#card-main-html iframe')?.contentDocument?.querySelector('.slide') && document.querySelector('#card-main-image img')?.naturalWidth > 0);
  assert.equal(await page.locator('[role=alert]').count(), 0);
  assert.equal(htmlRequests, 2); assert.equal(imageRequests, 2);
  await page.waitForResponse(response => response.url().includes('/api/decks?') && response.ok());
  assert.equal(htmlRequests, 2); assert.equal(imageRequests, 2);
  assert.deepEqual((await scanDecks(project)).decks, before.decks);
});

test('discovery and legacy projection expose unreadable HTML without hiding it behind PNG', async t => {
  const root = await temporary(t);
  await write(root, 'old-01/old-01-render.html/occupied.txt', 'Not an HTML file');
  await write(root, 'old-01/generated-html.png', pixel);
  const v1 = { contractVersion: 1, id: 'archive', mode: 'discovery', root, artifacts: { layout: 'legacy' },
    decks: [{ id: 'main', label: 'Archive', artifactPrefix: 'old' }] };
  const archived = await scanDecks(v1);
  assert.equal(archived.decks[0].slides[0].artifacts.html.state, 'unreadable');
  assert.equal(archived.decks[0].slides[0].artifacts.png.state, 'available');
  await fs.mkdir(path.join(root, 'old-02/generated-html.png'), { recursive: true });
  const legacy = { root, decks: [{ id: 'main', label: 'Old', artifactPrefix: 'old', slides: [{ no: '01' }, { no: '02' }] }] };
  const payload = await scanDecks(legacy);
  assert.equal(payload.decks[0].slides[0].htmlError, 'NOT_FILE');
  assert.equal(payload.decks[0].slides[0].htmlUrl, null);
  assert(payload.decks[0].slides[0].url);
  assert.equal(payload.decks[0].slides[1].imageError, 'NOT_FILE');
  const origin = await serve(t, legacy), browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); await page.goto(origin);
  await page.waitForSelector('.slide-card [role=status]');
  assert.equal(await page.locator('#old-01 [role=status]').textContent(), 'HTML preview is unavailable.');
  assert.equal(await page.locator('#old-02 [role=status]').textContent(), 'Preview is unavailable.');
  assert.equal(await page.locator('.stage > img[data-preview-image]').count(), 0);
});
