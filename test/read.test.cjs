const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require('playwright');
const { scanDecks, scanSlides, createReviewServer, createRenderer } = require('../src/index.cjs');

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>';
const html = text => `<!doctype html><html><meta charset="utf-8"><style>html,body{margin:0}.slide{width:800px;height:450px;font:32px Arial;background:#eee}</style><body><main class="slide"><h1>${text}</h1><img src="local.svg" alt="Local resource"></main></body></html>`;

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-b3-'));
  t.after(async () => {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}
async function write(root, file, data) {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data, typeof data === 'string' ? 'utf8' : undefined);
}
async function stableFixture(t) {
  const root = path.join(await temporary(t), 'artifacts');
  const data = { secret: 'ADAPTER_SECRET', callback() {} }; data.self = data;
  const input = { contractVersion: 1, id: 'neutral-read', mode: 'registered', root, data,
    decks: [
      { id: 'first', label: 'Нейтральная презентация', width: 800, height: 450, slides: [
        { id: 'last', name: 'Сначала последний', data }, { id: 'repeat', name: 'Обложка' }, { id: 'pending' },
      ] },
      { id: '__proto__', label: 'Другая колода', width: 800, height: 450, slides: [{ id: 'repeat' }] },
      { id: 'draft', label: 'Черновик', slides: [] },
    ] };
  for (const [deck, slide, title] of [['first', 'last', 'Презентация «Deckloom» — порядок'], ['first', 'repeat', 'Первая обложка'], ['__proto__', 'repeat', 'Вторая обложка'], ['first', 'deleted', 'Удалённый слайд']]) {
    await write(root, `deck-${deck}/slide-${slide}/render.html`, html(title));
    await write(root, `deck-${deck}/slide-${slide}/local.svg`, svg);
  }
  await write(root, 'deck-first/slide-repeat/generated-html.png', pixel);
  await write(root, 'secret.txt', 'FILESYSTEM_SECRET');
  return input;
}
async function serve(t, input) {
  const server = createReviewServer(input);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    // Browser cleanup is registered later; its polling must not hold this hook open.
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('registered v1 projects preserve authored identity/order and never merge disk leftovers', async t => {
  const input = await stableFixture(t);
  const before = await scanDecks(input);
  assert.equal(before.contractVersion, 1);
  assert.deepEqual(before.project, { id: 'neutral-read', mode: 'registered' });
  assert.deepEqual(before.decks[0].slides.map(s => [s.id, s.index, s.number]), [['last', 0, 1], ['repeat', 1, 2], ['pending', 2, 3]]);
  assert.deepEqual(before.decks[0].slides[2].artifacts, { html: { state: 'missing' }, png: { state: 'missing' } });
  assert.equal(before.decks[0].slides[0].artifacts.html.state, 'available');
  assert.equal(before.decks[0].slides[0].artifacts.png.state, 'missing');
  assert.deepEqual(before.decks[2].slides, []);
  const serialized = JSON.stringify(before);
  for (const secret of ['ADAPTER_SECRET', 'FILESYSTEM_SECRET', input.root, 'callback', '"no":', '"data":']) assert(!serialized.includes(secret), secret);
  const selected = await scanSlides(input, { id: 'first', slides: [{ id: 'override' }] });
  assert.equal(selected.deck.id, 'first');
  assert.equal(selected.deck.slides.length, 3);
  await assert.rejects(scanSlides(input, 'FIRST'), { code: 'UNKNOWN_DECK', field: 'deckId' });
  assert.equal((await scanSlides(input, '__proto__')).deck.slides[0].id, 'repeat');
  input.decks[0].slides.reverse();
  const after = await scanDecks(input);
  assert.equal(after.decks[0].slides[2].artifacts.html.url, before.decks[0].slides[0].artifacts.html.url);
  assert.equal(after.decks[0].slides[2].number, 3);
  input.decks[0].slides = input.decks[0].slides.filter(slide => slide.id !== 'last');
  assert(!(await scanDecks(input)).decks[0].slides.some(slide => slide.id === 'last'));
  assert((await fs.stat(path.join(input.root, 'deck-first/slide-last/render.html'))).isFile());
  await assert.rejects(createRenderer(input).renderDeck(null, 'first'), { code: 'MISSING_RENDERER' });
});

test('legacy projection retains file IDs/no/URLs while adopting registered composition', async t => {
  const root = await temporary(t);
  const input = { root, decks: [{ id: 'main', label: 'Legacy', artifactPrefix: 'old', slides: [{ no: '02' }, { no: '01' }, { no: '03' }] }] };
  for (const no of ['01', '02', '99']) {
    await write(root, `old-${no}/old-${no}-render.html`, html(no));
    await write(root, `old-${no}/generated-html.png`, pixel);
  }
  const result = await scanDecks(input);
  assert(!Object.hasOwn(result, 'contractVersion'));
  assert.deepEqual(result.decks[0].slides.map(s => [s.id, s.no]), [['old-02', '02'], ['old-01', '01'], ['old-03', '03']]);
  assert(result.decks[0].slides[0].htmlUrl.startsWith('/old-02/old-02-render.html?v='));
  assert.equal(result.decks[0].slides[0].file, 'generated-html.png');
  assert.equal(result.decks[0].slides[2].url, null);
  assert(!Object.hasOwn(result.decks[0].slides[0], 'number'));
  await write(root, 'old-02/generated-complete.png', pixel);
  await write(root, 'old-01/generated-hybrid.png', pixel);
  await fs.unlink(path.join(root, 'old-01/generated-html.png'));
  const ranked = await scanDecks(input);
  assert.deepEqual(ranked.decks[0].slides.map(slide => slide.file), ['generated-complete.png', 'generated-hybrid.png', null]);
  const single = await scanSlides(input, input.decks[0]);
  assert.equal(single.id, 'main'); assert(!Object.hasOwn(single, 'deck'));
  const origin = await serve(t, input);
  assert.equal((await fetch(origin + '/old-99/old-99-render.html')).status, 404);
  const discovery = { root, decks: [{ id: 'main', label: 'Archive', artifactPrefix: 'old' }] };
  assert.deepEqual((await scanDecks(discovery)).decks[0].slides.map(s => s.no), ['01', '02', '99']);
});

test('discovery is explicit, deterministic, read-only and retains legacy image ranking', async t => {
  const root = await temporary(t);
  const input = { contractVersion: 1, id: 'neutral-archive', mode: 'discovery', root,
    artifacts: { layout: 'legacy' }, decks: [{ id: 'archive', label: 'Архив', artifactPrefix: 'archive' }], renderDocument() { throw new Error('must never render'); } };
  for (const no of ['10', '2', '1', '01', '9007199254740993', '9007199254740992']) await write(root, `archive-${no}/archive-${no}-render.html`, html(no));
  await write(root, 'archive-2/generated-html.png', pixel);
  await write(root, 'archive-2/generated-complete.png', pixel);
  await write(root, 'archive-2/attempt-99.png', pixel);
  await write(root, 'archive-3/only-qa.md', 'No artifact');
  await write(root, 'foreign-4/foreign-4-render.html', html('foreign'));
  const deck = (await scanSlides(input, 'archive')).deck;
  assert.deepEqual(deck.slides.map(s => s.id), ['archive-01', 'archive-1', 'archive-2', 'archive-10', 'archive-9007199254740992', 'archive-9007199254740993']);
  assert.deepEqual(deck.slides.map(s => s.number), [1, 2, 3, 4, 5, 6]);
  assert(deck.slides[2].artifacts.png.url.includes('/artifacts/archive-2/generated-complete.png?'));
  assert.throws(() => createRenderer(input), { code: 'READ_ONLY_PROJECT' });
  const origin = await serve(t, input);
  await write(root, 'archive-4/archive-4-render.html', html('Added to archive'));
  const refreshed = await (await fetch(origin + '/api/decks')).json();
  assert(refreshed.decks[0].slides.some(slide => slide.id === 'archive-4'));
  input.decks[0].slides = [];
  await assert.rejects(scanDecks(input), { code: 'SOURCE_CONFLICT' });
});

test('server uses a fixed registry, safe artifact routes and versioned single-deck responses', async t => {
  const input = await stableFixture(t);
  const origin = await serve(t, input);
  const original = await (await fetch(origin + '/api/decks')).json();
  input.decks[0].slides.reverse();
  input.decks[0].label = 'Changed';
  input.decks.push({ id: 'new', label: 'New', slides: [] });
  const again = await (await fetch(origin + '/api/decks')).json();
  assert.deepEqual(again.decks, original.decks);
  const single = await (await fetch(origin + '/api/slides?deck=first')).json();
  assert.deepEqual(single.project, original.project);
  assert.deepEqual(single.deck, original.decks[0]);
  const unknown = await fetch(origin + '/api/slides?deck=FIRST');
  assert.equal(unknown.status, 404); assert.equal((await unknown.json()).code, 'UNKNOWN_DECK');
  assert.equal((await fetch(origin + '/api/slides?deck=')).status, 404);
  const artifact = single.deck.slides[0].artifacts.html.url;
  assert(artifact.startsWith('/artifacts/deck-first/slide-last/'));
  assert((await (await fetch(origin + artifact)).text()).includes('Презентация «Deckloom» — порядок'));
  assert.equal((await fetch(origin + '/artifacts/deck-first/slide-last/local.svg')).status, 200);
  assert.equal((await fetch(origin + artifact, { method: 'HEAD' })).status, 200);
  await write(input.root, 'deck-first/slide-last/render.html', html('Обновлённый файл с более длинным заголовком — новый preview'));
  const refreshed = await (await fetch(origin + '/api/decks')).json();
  assert.notEqual(refreshed.decks[0].slides[0].artifacts.html.version, single.deck.slides[0].artifacts.html.version);
  assert.deepEqual(refreshed.decks.map(deck => deck.id), original.decks.map(deck => deck.id));
  assert.equal(refreshed.decks[0].label, original.decks[0].label);
  for (const url of ['/secret.txt', '/artifacts/secret.txt', '/artifacts/deck-first/slide-deleted/render.html', '/deck-first/slide-last/render.html', '/artifacts/deck-first/slide-last/%2e%2e%5Csecret.txt', '/artifacts/deck-first/slide-last/%2f..%2fsecret.txt']) {
    assert.equal((await fetch(origin + url)).status, 404, url);
  }
  assert.equal((await fetch(origin + '/%XX')).status, 400);
  assert.equal((await fetch(origin + '/api/decks', { method: 'POST' })).status, 405);
  const outside = await temporary(t);
  await write(outside, 'secret.txt', 'OUTSIDE_SECRET');
  await fs.symlink(outside, path.join(input.root, 'deck-first/slide-last/escape'), 'junction');
  assert.equal((await fetch(origin + '/artifacts/deck-first/slide-last/escape/secret.txt')).status, 404);
});

test('v1 legacy layout keeps disk names and serves namespaced URLs plus old file aliases', async t => {
  const root = await temporary(t);
  const input = { contractVersion: 1, id: 'legacy-layout', mode: 'registered', root, artifacts: { layout: 'legacy' },
    decks: [{ id: 'main', label: 'Main', artifactPrefix: 'old', slides: [{ id: 'cover', artifactNo: '02' }] }],
    staticMounts: { '/assets': path.join(root, 'assets') } };
  await write(root, 'old-02/old-02-render.html', html('Existing HTML').replace('src="local.svg"', 'src="../assets/marker.svg"'));
  await write(root, 'assets/marker.svg', svg);
  const origin = await serve(t, input);
  const slide = (await scanSlides(input)).deck.slides[0];
  assert.equal(slide.id, 'cover'); assert.equal(slide.number, 1);
  assert(slide.artifacts.html.url.startsWith('/artifacts/old-02/old-02-render.html?'));
  assert.equal((await fetch(origin + slide.artifacts.html.url)).status, 200);
  assert.equal((await fetch(origin + '/old-02/old-02-render.html')).status, 200);
  assert.equal((await fetch(origin + '/assets/marker.svg')).status, 200);
  assert.equal((await fetch(origin + '/artifacts/assets/marker.svg')).status, 200);
  assert.equal((await fetch(origin + '/artifacts/unmounted/secret.txt')).status, 404);
});

test('empty registered projects and missing roots remain read-only drafts', async t => {
  const root = path.join(await temporary(t), 'not-created');
  const input = { contractVersion: 1, id: 'draft', mode: 'registered', root, decks: [] };
  assert.deepEqual((await scanDecks(input)).decks, []);
  await assert.rejects(scanSlides(input), { code: 'UNKNOWN_DECK' });
  const origin = await serve(t, input);
  assert.equal((await fetch(origin + '/api/slides')).status, 404);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(origin);
  await page.waitForSelector('.empty');
  assert.equal(await page.locator('.empty').textContent(), 'This project has no presentations.');
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
});

test('viewer consumes v1 identities, preserves scoped links, shows placeholders and keeps legacy hashes', async t => {
  const input = await stableFixture(t);
  const origin = await serve(t, input);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.frameLocator('.html-document-frame').first().locator('.slide').waitFor();
  assert.equal(await page.locator('.slide-tab').count(), 3);
  assert.deepEqual(await page.locator('.slide-number').allTextContents(), ['1', '2', '3']);
  assert.equal(new URL(page.url()).hash, '#project/neutral-read/deck/first/slide/last');
  assert.equal(await page.frameLocator('.html-document-frame').first().locator('h1').textContent(), 'Презентация «Deckloom» — порядок');
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(frame => [...(frame.contentDocument?.images || [])].every(img => img.complete && img.naturalWidth > 0)));
  await page.keyboard.press('ArrowRight');
  assert.equal(new URL(page.url()).hash, '#project/neutral-read/deck/first/slide/repeat');
  await page.locator('#deckSelect').selectOption('__proto__');
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('h1')?.textContent === 'Вторая обложка');
  assert.equal(new URL(page.url()).hash, '#project/neutral-read/deck/__proto__/slide/repeat');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#deckSelect').value === '__proto__');
  assert.equal(await page.locator('.slide-tab').count(), 1);
  await page.evaluate(() => { location.hash = '#project/neutral-read/deck/first/slide/repeat'; });
  await page.waitForFunction(() => document.querySelector('#deckSelect').value === 'first');
  await page.keyboard.press('ArrowRight');
  assert.equal(new URL(page.url()).hash, '#project/neutral-read/deck/first/slide/pending');
  assert.equal(await page.locator('.slide-card.is-active [role=status]').textContent(), 'Preview has not been generated.');
  assert.equal(await page.locator('.slide-card.is-active img').count(), 0);
  await page.locator('#deckMode').click();
  assert.equal(await page.locator('.slide-card').count(), 3);
  await page.setViewportSize({ width: 400, height: 800 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#deckSelect').selectOption('draft');
  await page.waitForSelector('.empty');
  assert.equal(await page.locator('.empty').textContent(), 'This presentation has no slides.');
  assert.equal(new URL(page.url()).hash, '#project/neutral-read/deck/draft');
  assert(await page.evaluate(() => localStorage.getItem('deckloom:neutral-readDeck') === 'draft'));
  assert.deepEqual(errors, []);
  const legacy = { root: input.root, decks: [{ id: 'old', label: 'Old', artifactPrefix: 'old', slides: [{ no: '02' }, { no: '01' }] }] };
  await write(input.root, 'old-02/old-02-render.html', '<main class="slide">Legacy HTML only</main>');
  const legacyOrigin = await serve(t, legacy);
  await page.goto(legacyOrigin);
  await page.waitForSelector('.html-inline-holder .slide');
  assert.deepEqual(await page.locator('.slide-number').allTextContents(), ['02', '01']);
  assert.equal(new URL(page.url()).hash, '#old-02');
  assert.deepEqual(errors, []);
});
