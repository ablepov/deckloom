const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require('playwright');
const { createRenderer, createReviewServer, scanDecks } = require('../src/index.cjs');
const builds = require('../src/builds.cjs');

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-c-'));
  t.after(async () => { assert(root.startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  return root;
}
async function write(root, file, value) {
  const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, value, typeof value === 'string' ? 'utf8' : undefined);
}
function fixture(root) {
  return { contractVersion: 1, id: 'runtime-contract', mode: 'registered', root,
    decks: [{ id: 'main', label: 'Contract', width: 480, height: 270, slides: [{ id: 'one', data: { title: 'First' } }, { id: 'two', data: { title: 'Second' } }] }],
    renderDocument(deck, slide) { return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}.slide{width:480px;height:270px;background:#f4f1e9}h1{margin:0;font:30px Arial}</style></head><body><main class="slide"><h1>${slide.data.title}</h1></main></body></html>`; },
  };
}
async function serve(t, project) {
  const server = createReviewServer(project); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
async function browserFor(t) { const browser = await chromium.launch({ headless: true }); t.after(() => browser.close()); return browser; }
const slides = payload => payload.decks[0].slides;

test('static document preserves head CSS/font/SVG/relative resources and matches PNG; inline comparison exposes loss', async t => {
  const root = await temporary(t), project = fixture(root); project.decks[0].slides.length = 1;
  const dir = 'deck-main/slide-one';
  await write(root, `${dir}/neutral.ttf`, await fs.readFile(path.join(__dirname, 'fixtures/neutral.ttf')));
  await write(root, `${dir}/styles/main.css`, '@import "imported.css"; @font-face{font-family:Neutral;src:url("../neutral.ttf")} body{background:rgb(1,2,3)} #probe{font:40px Neutral;color:rgb(14,80,140);width:max-content} .slide{background:#f4f1e9}');
  await write(root, `${dir}/styles/imported.css`, 'img{width:12px;height:12px}');
  await write(root, `${dir}/marker.svg`, '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="green"/></svg>');
  await write(root, `${dir}/marker.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64'));
  const html = '<!doctype html><html><head><meta charset="utf-8"><base href="./"><link rel="stylesheet" href="styles/main.css"><style>html,body{margin:0}.slide{width:480px;height:270px}h1{margin:0}</style></head><body><main class="slide"><h1 id="probe">AAAA</h1><img src="marker.svg" alt="marker"><img src="marker.png" alt="pixel"><svg width="12" height="12"><circle cx="6" cy="6" r="6" fill="red"/></svg></main></body></html>';
  project.renderDocument = () => html;
  project.measureLayout = () => ({ color: getComputedStyle(document.querySelector('#probe')).color, textWidth: document.querySelector('#probe').getBoundingClientRect().width, font: document.fonts.check('40px Neutral'), width: innerWidth, height: innerHeight });
  const browser = await browserFor(t), result = await createRenderer(project).render({ browser });
  assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
  const metric = result.reports.main[0].layoutQa;
  assert.equal(metric.color, 'rgb(14, 80, 140)'); assert.equal(metric.textWidth, 96); assert.equal(metric.font, true);
  const origin = await serve(t, project), page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(origin); const frame = page.frameLocator('.html-document-frame'); await frame.locator('#probe').waitFor();
  await page.waitForFunction(() => document.querySelector('.html-inline')?.dataset.pending !== 'true');
  const documentMetric = await frame.locator('#probe').evaluate(node => ({ color: getComputedStyle(node).color, textWidth: node.getBoundingClientRect().width, font: document.fonts.check('40px Neutral'), width: innerWidth, height: innerHeight }));
  assert.deepEqual(documentMetric, metric);
  assert.equal(await frame.locator('#probe').evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range); return getSelection().toString(); }), 'AAAA');
  assert.notEqual(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(1, 2, 3)');
  const payload = await scanDecks(project), source = origin + slides(payload)[0].artifacts.html.url;
  const inline = await page.evaluate(({ html, source }) => {
    const holder = document.createElement('div'); holder.dataset.slideScope = 'comparison'; holder.innerHTML = normalizeSlideDocument(html, 'comparison', source); document.body.append(holder);
    const value = { color: getComputedStyle(holder.querySelector('#probe')).color, textWidth: holder.querySelector('#probe').getBoundingClientRect().width }; holder.remove(); return value;
  }, { html, source });
  assert.notEqual(inline.color, metric.color);
  const direct = await browser.newPage({ viewport: { width: 480, height: 270 }, javaScriptEnabled: false });
  await direct.goto(source); await direct.evaluate(() => document.fonts.ready);
  const actual = await direct.screenshot({ animations: 'disabled' });
  assert.deepEqual(actual, await fs.readFile(result.reports.main[0].png));
  await frame.locator('#probe').evaluate(() => getSelection().removeAllRanges());
  const evidence = path.resolve('output/validation/c'); await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(evidence, 'profile-comparison.json'), JSON.stringify({ selected: 'isolated-document', renderer: metric, documentPreview: documentMetric, inlinePreview: inline, pixelsEqual: true }, null, 2), 'utf8');
  await fs.writeFile(path.join(evidence, 'profile-render.png'), actual); await page.screenshot({ path: path.join(evidence, 'profile-viewer.png') });
  await direct.close(); await page.close();
});

test('object API has progress, structured failures and no argv/output/exitCode effects; wrappers remain usable', async t => {
  const root = await temporary(t), project = fixture(root), browser = await browserFor(t);
  const events = [], renderer = createRenderer(project), exit = process.exitCode, argv = process.argv;
  const log = console.log; let logged = false; console.log = () => { logged = true; };
  let result;
  try { process.argv = ['node', 'wrong', '--deck=missing']; result = await renderer.render({ browser, onProgress: event => { assert(Object.isFrozen(event)); events.push(event.type); } }); }
  finally { console.log = log; process.argv = argv; }
  assert.equal(result.status, 'succeeded'); assert.equal(result.resultVersion, 1); assert.equal(process.exitCode, exit); assert.equal(logged, false);
  assert.deepEqual(events, ['deck-start', 'slide-start', 'slide-complete', 'slide-start', 'slide-complete', 'deck-ready']);
  assert.equal(Object.values(result.reports).flat().length, 2);
  const exactAll = { ...project, root: path.join(root, 'exact-all'), decks: [{ ...project.decks[0], id: 'all' }, { ...project.decks[0], id: 'other' }] };
  assert.deepEqual(Object.keys((await createRenderer(exactAll).render({ browser, deckId: 'all' })).reports), ['all']);
  for (const value of [{ warnings: 'ignore' }, { hookTimeoutMs: 0 }, { pageTimeoutMs: Infinity }, { signal: {} }, { onProgress: 1 }, { unknown: true }]) await assert.rejects(renderer.render(value), { code: 'INVALID_OPTIONS' });
  await assert.rejects(renderer.render({ deckId: 'absent' }), { code: 'UNKNOWN_DECK' });
  project.renderDocument = () => { throw null; };
  const failed = await createRenderer(project).render({ browser });
  assert.equal(failed.status, 'failed'); assert.equal(failed.error.code, 'HOOK_FAILED'); assert.equal(failed.error.stage, 'renderDocument');
  const state = await builds.publication(root, 'main'); assert.equal(state.latest.manifest.state, 'failed'); assert.equal(state.published.manifest.buildId, result.builds[0].buildId);
  await assert.rejects(createRenderer(project).renderDeck(browser, 'main'), { code: 'HOOK_FAILED' });
});

test('hook types, timeouts, cancellation and warning policy have explicit outcomes and release writers/pages', async t => {
  const root = await temporary(t), browser = await browserFor(t);
  for (const [name, callback, code] of [
    ['renderDocument', () => 42, 'INVALID_HOOK_RESULT'], ['validateDocument', () => false, 'INVALID_HOOK_RESULT'],
    ['renderSpec', () => null, 'INVALID_HOOK_RESULT'], ['renderQa', () => { throw undefined; }, 'HOOK_FAILED'],
    ['measureLayout', () => 1, 'INVALID_HOOK_RESULT'], ['issueCount', async () => 0, 'INVALID_HOOK_RESULT'],
    ['measureLayout', () => { throw new Error('measure failed'); }, 'HOOK_FAILED'], ['issueCount', () => { throw null; }, 'HOOK_FAILED'],
    ['measureLayout', () => new Promise(() => {}), 'TIMEOUT'],
    ['renderDocument', () => new Promise(() => {}), 'TIMEOUT'],
  ]) {
    const project = fixture(path.join(root, `${name}-${code}`)); project.decks[0].slides.length = 1; project[name] = callback;
    const result = await createRenderer(project).render({ browser, hookTimeoutMs: code === 'TIMEOUT' ? 150 : 1000, pageTimeoutMs: 5000 });
    assert.equal(result.status, 'failed'); assert.equal(result.error.code, code, JSON.stringify(result));
    if (code === 'HOOK_FAILED') assert.equal(result.error.stage, name);
    assert.equal(browser.contexts().length, 0); await assert.rejects(fs.stat(path.join(project.root, '.deckloom/write.lock')), { code: 'ENOENT' });
    assert.equal((await builds.publication(project.root, 'main')).latest.manifest.state, 'failed');
  }
  const project = fixture(path.join(root, 'cancel')), controller = new AbortController();
  const cancelled = await createRenderer(project).render({ browser, signal: controller.signal, onProgress: event => { if (event.type === 'slide-complete') controller.abort(); } });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.reports.main.length, 1); assert.equal((await builds.publication(project.root, 'main')).latest.manifest.state, 'cancelled');
  assert(slides(await scanDecks(project)).every(slide => slide.artifacts.html.state === 'missing'));
  const before = new AbortController(); before.abort();
  const empty = path.join(root, 'pre-cancelled'); assert.equal((await createRenderer(fixture(empty)).render({ signal: before.signal })).status, 'cancelled'); await assert.rejects(fs.stat(empty), { code: 'ENOENT' });
  const legacy = { root: path.join(root, 'warnings'), decks: [{ id: 'old', label: 'Old', artifactPrefix: 'old', width: 480, height: 270, slides: [{ no: '01' }] }], renderDocument: () => '<main class="slide">Static text</main><script>console.warn("warning fixture")</script>', measureLayout: () => ({ overflow: [] }) };
  const warning = await createRenderer(legacy).render({ browser, warnings: 'report' });
  assert.equal(warning.status, 'succeeded'); assert(warning.diagnostics.some(item => item.code === 'PAGE_CONSOLE' && item.severity === 'warning'));
  assert.equal((await createRenderer(legacy).render({ browser })).status, 'failed');
});

test('static profile rejects scripts and records CSS/image/font failures; page readiness is bounded', async t => {
  const root = await temporary(t), browser = await browserFor(t), project = fixture(root); project.decks[0].slides.length = 1;
  const document = project.renderDocument;
  project.renderDocument = (d, s) => document(d, s).replace('</body>', '<script>window.executed = true</script></body>');
  const unsupported = await createRenderer(project).render({ browser }); assert.equal(unsupported.error.code, 'UNSUPPORTED_HTML');
  project.renderDocument = (d, s) => document(d, s).replace('</style>', '@keyframes pulse{to{opacity:.5}}h1{animation:pulse 2s infinite}</style>');
  assert.equal((await createRenderer(project).render({ browser })).error.code, 'UNSUPPORTED_HTML');
  project.renderDocument = (d, s) => document(d, s).replace('</main>', '<img src="/unmanaged/root.svg"></main>');
  assert.equal((await createRenderer(project).render({ browser })).error.code, 'UNSUPPORTED_HTML');
  project.renderDocument = (d, s) => document(d, s).replace('</head>', '<base href="/unmanaged/"></head>');
  assert.equal((await createRenderer(project).render({ browser })).error.code, 'UNSUPPORTED_HTML');
  project.renderDocument = (d, s) => document(d, s).replace('</head>', '<link rel="stylesheet" href="missing.css"><style>@font-face{font-family:Missing;src:url(missing.ttf)}h1{font-family:Missing}</style></head>').replace('</main>', '<img src="missing.svg"></main>');
  const broken = await createRenderer(project).render({ browser });
  assert.equal(broken.status, 'failed'); assert(broken.diagnostics.some(item => item.code === 'RESOURCE_FAILED' && item.message.includes('missing.css')));
  assert(broken.diagnostics.some(item => item.code === 'FONT_FAILED')); assert(broken.diagnostics.some(item => item.code === 'IMAGE_FAILED'));
  assert.equal(broken.builds[0].state, 'complete'); // Execution complete; QA failed.
  // A hanging stylesheet prevents load; this is distinct from a hook timeout.
  let stylesheetRequests = 0;
  const server = require('node:http').createServer(() => { stylesheetRequests++; }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  project.renderDocument = (d, s) => document(d, s).replace('</head>', `<link rel="stylesheet" href="http://127.0.0.1:${server.address().port}/hang.css"></head>`);
  const timeout = await createRenderer(project).render({ browser, pageTimeoutMs: 300 });
  assert.equal(timeout.status, 'failed'); assert(['TIMEOUT', 'RENDER_FAILED'].includes(timeout.error.code)); assert.equal(browser.contexts().length, 0);
  assert.equal(stylesheetRequests, 1, 'The timeout must exercise the hanging stylesheet, after page creation');
});

test('publication pins HTML/PNG across new builds, failures, composition changes and corrupt manifests', async t => {
  const root = await temporary(t), project = fixture(root), browser = await browserFor(t), origin = await serve(t, project);
  const first = await createRenderer(project).render({ browser }); assert.equal(first.status, 'succeeded');
  const initial = await scanDecks(project), initialSlide = slides(initial)[0];
  const oldHtml = await (await fetch(origin + initialSlide.artifacts.html.url)).text(), oldPng = Buffer.from(await (await fetch(origin + initialSlide.artifacts.png.url)).arrayBuffer());
  project.decks[0].slides[0].data.title = 'Changed';
  const document = project.renderDocument;
  project.renderDocument = (d, s) => { if (s.id === 'two') throw new Error('Injected second slide failure'); return document(d, s); };
  const failed = await createRenderer(project).render({ browser }); assert.equal(failed.status, 'failed'); assert.equal(failed.reports.main.length, 1);
  const afterFailure = await scanDecks(project); assert.deepEqual(slides(afterFailure), slides(initial)); assert.equal(afterFailure.decks[0].build.latestAttempt.state, 'failed');
  const failedManifest = (await builds.publication(root, 'main')).latest.manifest;
  assert.equal(failedManifest.slides.length, 2); assert(failedManifest.slides[0].artifacts.png); assert(failedManifest.diagnostics.some(item => item.code === 'HOOK_FAILED'));
  project.renderDocument = document; project.decks[0].slides.reverse();
  const second = await createRenderer(project).render({ browser }); assert.equal(second.status, 'succeeded');
  const fresh = await scanDecks(project); assert.notEqual(fresh.decks[0].build.buildId, initial.decks[0].build.buildId); assert.equal(slides(fresh)[0].id, 'two');
  assert.equal(await (await fetch(origin + initialSlide.artifacts.html.url)).text(), oldHtml);
  assert.deepEqual(Buffer.from(await (await fetch(origin + initialSlide.artifacts.png.url)).arrayBuffer()), oldPng);
  assert((await (await fetch(origin + slides(fresh)[1].artifacts.html.url)).text()).includes('Changed'));
  assert.equal((await fetch(origin + initialSlide.artifacts.html.url.replace(/build=[^&]+/, 'build=bad'))).status, 404);
  project.decks[0].slides.length = 1; const removed = await createRenderer(project).render({ browser }); assert.equal(removed.status, 'succeeded');
  const missing = await scanDecks({ ...project, decks: [{ ...project.decks[0], slides: [{ id: 'one' }] }] }); assert.equal(slides(missing)[0].artifacts.html.state, 'missing');
  const pointer = path.join(root, '.deckloom/decks/main.json'), original = await fs.readFile(pointer, 'utf8');
  await fs.writeFile(pointer, '{}', 'utf8');
  const corrupt = await scanDecks(project); assert.equal(slides(corrupt)[0].artifacts.html.diagnostic, 'INVALID_MANIFEST'); assert.equal(corrupt.decks[0].build.state, 'unreadable');
  await fs.writeFile(pointer, original, 'utf8');
  const published = (await builds.publication(root, 'main')).published;
  const manifestFile = path.join(published.directory, '../manifest.json'), manifestText = await fs.readFile(manifestFile, 'utf8');
  await fs.writeFile(manifestFile, JSON.stringify({ ...published.manifest, slides: [{}] }), 'utf8');
  assert.equal(slides(await scanDecks(project))[0].artifacts.html.diagnostic, 'INVALID_MANIFEST');
  await fs.writeFile(manifestFile, manifestText, 'utf8');
  await fs.rm(path.join(published.directory, published.manifest.slides[0].artifacts.html));
  assert.equal(slides(await scanDecks(project))[0].artifacts.html.diagnostic, 'MISSING_BUILD_ARTIFACT');
});

test('writer exclusion and pointer-write failure retain previous publication; final cancellation never commits', async t => {
  const root = await temporary(t), project = fixture(root), browser = await browserFor(t);
  const first = await createRenderer(project).render({ browser }); assert.equal(first.status, 'succeeded');
  const release = await builds.acquire(root);
  try { assert.equal((await createRenderer(project).render({ browser })).error.code, 'BUILD_BUSY'); } finally { await release(); }
  const rename = fs.rename; let pointerWrites = 0;
  fs.rename = async (from, to) => {
    if (to === path.join(root, '.deckloom/decks/main.json') && ++pointerWrites === 2) throw Object.assign(new Error('Injected commit failure'), { code: 'EIO' });
    return rename(from, to);
  };
  let failed;
  try { failed = await createRenderer(project).render({ browser }); } finally { fs.rename = rename; }
  assert.equal(failed.status, 'failed');
  let state = await builds.publication(root, 'main'); assert.equal(state.published.manifest.buildId, first.builds[0].buildId); assert.equal(state.latest.manifest.state, 'failed');
  const controller = new AbortController();
  const cancelled = await createRenderer(project).render({ browser, signal: controller.signal, onProgress: event => { if (event.type === 'deck-ready') controller.abort(); } });
  assert.equal(cancelled.status, 'cancelled'); state = await builds.publication(root, 'main'); assert.equal(state.published.manifest.buildId, first.builds[0].buildId); assert.equal(state.latest.manifest.state, 'cancelled');
  const isolated = path.join(root, 'separate'); const copied = await createRenderer(project).render({ browser, outputRoot: isolated });
  assert.equal(copied.status, 'succeeded'); assert((await builds.publication(isolated, 'main')).published); assert.equal((await builds.publication(root, 'main')).published.manifest.buildId, first.builds[0].buildId);
  let injected = false;
  fs.rename = async (from, to) => {
    if (!injected && to === path.join(root, '.deckloom/decks/main.json')) { injected = true; throw Object.assign(new Error('begin pointer failed'), { code: 'EIO' }); }
    return rename(from, to);
  };
  let beginFailure;
  try { beginFailure = await createRenderer(project).render({ browser }); } finally { fs.rename = rename; }
  assert.equal(beginFailure.status, 'failed'); assert.equal(beginFailure.builds[0].state, 'failed');
  assert.equal(JSON.parse(await fs.readFile(beginFailure.builds[0].manifest, 'utf8')).diagnostics[0].stage, 'begin-build');
  assert.equal((await builds.publication(root, 'main')).published.manifest.buildId, first.builds[0].buildId);
});

test('each artifact write failure remains unpublished with a durable partial composition', async t => {
  const root = await temporary(t), browser = await browserFor(t);
  for (const basename of ['render.html', 'spec.md', 'generated-html.png', 'qa.md', 'render-report-main.json']) {
    const project = fixture(path.join(root, basename)); project.decks[0].slides.length = 1; project.renderSpec = () => 'Neutral spec';
    const rename = fs.rename; let injected = false;
    fs.rename = async (from, to) => {
      if (!injected && to.includes(`${path.sep}files${path.sep}`) && path.basename(to) === basename) { injected = true; throw Object.assign(new Error(`Injected ${basename} failure`), { code: 'EIO' }); }
      return rename(from, to);
    };
    let result;
    try { result = await createRenderer(project).render({ browser }); } finally { fs.rename = rename; }
    assert.equal(injected, true); assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'EIO');
    const state = await builds.publication(project.root, 'main'); assert.equal(state.published, null); assert.equal(state.latest.manifest.state, 'failed'); assert(state.latest.manifest.diagnostics.some(item => item.code === 'EIO'));
    assert(slides(await scanDecks(project)).every(slide => slide.artifacts.html.state === 'missing' && slide.artifacts.png.state === 'missing'));
    await assert.rejects(fs.stat(path.join(project.root, '.deckloom/write.lock')), { code: 'ENOENT' });
  }
});

test('cleanup errors preserve primary failure, lock metadata failure releases ownership, and control links are refused', async t => {
  const root = await temporary(t), project = fixture(path.join(root, 'cleanup')); project.decks[0].slides.length = 1;
  // Deliberately incomplete page exercises a primary document failure followed
  // by cleanup failure, without relying on Playwright implementation details.
  const browser = { async newPage() { return { on() {}, async goto() { throw new Error('primary document error'); }, async close() { throw new Error('secondary close error'); } }; } };
  const failed = await createRenderer(project).render({ browser });
  assert.equal(failed.status, 'failed'); assert.equal(failed.error.message, 'primary document error'); assert(failed.diagnostics.some(item => item.stage === 'closePage' && item.message === 'secondary close error'));
  const manifest = (await builds.publication(project.root, 'main')).latest.manifest; assert.equal(manifest.state, 'failed'); assert(manifest.diagnostics.some(item => item.stage === 'closePage'));
  const open = fs.open, lockRoot = path.join(root, 'lock-failure');
  fs.open = async (file, ...args) => {
    const handle = await open(file, ...args);
    if (file === path.join(lockRoot, '.deckloom/write.lock')) handle.writeFile = async () => { throw new Error('metadata failed'); };
    return handle;
  };
  try { await assert.rejects(builds.acquire(lockRoot), /metadata failed/); } finally { fs.open = open; }
  const release = await builds.acquire(lockRoot); await release();
  const unsafe = path.join(root, 'unsafe'), outside = path.join(root, 'outside'); await fs.mkdir(unsafe); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(unsafe, '.deckloom'), 'junction');
  const rejected = await createRenderer(fixture(unsafe)).render({ browser }); assert.equal(rejected.error.code, 'INVALID_BUILD_PATH'); assert.deepEqual(await fs.readdir(outside), []);
  await assert.rejects(createRenderer(fixture(project.root)).render({ outputRoot: path.join(project.root, '.deckloom/nested') }), { code: 'PATH_CONFLICT' });
});

test('all-deck operations retain completed decks and report a later failure without publishing its partial slides', async t => {
  const root = await temporary(t), project = fixture(root), browser = await browserFor(t);
  project.decks.push({ ...project.decks[0], id: 'later' });
  const document = project.renderDocument; project.renderDocument = (deck, slide) => { if (deck.id === 'later') throw new Error('later deck failed'); return document(deck, slide); };
  const result = await createRenderer(project).render({ browser }); assert.equal(result.status, 'failed');
  assert.deepEqual(result.builds.map(build => build.state), ['complete', 'failed']); assert.equal(result.reports.main.length, 2); assert.equal(result.reports.later.length, 0);
  const payload = await scanDecks(project); assert.equal(payload.decks[0].build.state, 'published'); assert.equal(payload.decks[1].build.state, 'unpublished'); assert(payload.decks[1].slides.every(slide => slide.artifacts.png.state === 'missing'));
});

test('document preview retries failed imported CSS/background resources and keeps the error until readiness', async t => {
  const root = await temporary(t), project = fixture(root); project.decks[0].slides.length = 1;
  const html = '<!doctype html><link rel="stylesheet" href="main.css"><style>html,body{margin:0}.slide{width:480px;height:270px}</style><main class="slide">Resources</main>';
  const dir = 'deck-main/slide-one';
  await write(root, `${dir}/render.html`, html); await write(root, `${dir}/main.css`, '@import "import.css"; .slide{background-image:url(bg.svg)}');
  await write(root, `${dir}/import.css`, '.slide{color:rgb(20,80,140)}'); await write(root, `${dir}/bg.svg`, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const browser = await browserFor(t), origin = await serve(t, project), page = await browser.newPage();
  let imports = 0, backgrounds = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/import.css', async route => {
    if (++imports === 1) return route.fulfill({ status: 503, body: 'temporary CSS failure' });
    await gate; return route.continue();
  });
  await page.route('**/bg.svg', route => ++backgrounds === 1 ? route.fulfill({ status: 503, body: 'temporary background failure' }) : route.continue());
  await page.goto(origin); await page.locator('[role=alert]').waitFor();
  await page.waitForRequest(request => request.url().endsWith('/import.css'));
  assert.equal(await page.locator('[role=alert]').textContent(), 'Failed to load HTML preview.');
  assert.equal(await page.locator('.html-document-frame').evaluate(frame => getComputedStyle(frame).visibility), 'hidden');
  release();
  await page.waitForFunction(() => !document.querySelector('[role=alert]') && document.querySelector('iframe')?.contentDocument?.querySelector('.slide'));
  assert.equal(await page.frameLocator('iframe').locator('.slide').evaluate(node => getComputedStyle(node).color), 'rgb(20, 80, 140)');
  assert.equal(imports, 2); assert.equal(backgrounds, 2); await page.close();
});
