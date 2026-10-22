const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { normalizeProject, preflightProject } = require('../src/project.cjs');
const { createRenderer, createReviewServer, scanDecks, scanSlides } = require('../src/index.cjs');
const { createContractProject } = require('./fixtures/contract-project.cjs');

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deckloom-b2-'));
  t.after(() => {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return root;
}
function legacy(root) {
  return { root, decks: [{ id: 'demo', label: 'Нейтральная колода', artifactPrefix: 'demo-slide',
    slides: [{ no: '02', name: 'Второй' }, { no: '01', name: 'Первый' }] }],
    renderDocument: (deck, slide) => `<main>${deck.label}: ${slide.name}</main>` };
}
function error(code, field, context = {}) {
  return thrown => {
    assert.equal(thrown.code, code, thrown.stack);
    assert.equal(thrown.field, field, thrown.stack);
    for (const [key, value] of Object.entries(context)) assert.equal(thrown[key], value);
    return true;
  };
}

test('normalization snapshots identity/order/geometry without interpreting or freezing adapter data', t => {
  const root = path.join(temporary(t), 'not-created');
  const input = createContractProject(root);
  const data = { title: 'Презентация «Deckloom» — пример', date: new Date(), callback: () => 'ok' };
  data.self = data;
  input.decks[0].slides[0].data = data;
  const model = normalizeProject(input);
  const prepared = preflightProject(model, { operation: 'render' });
  assert.equal(model.id, 'neutral-project');
  assert.equal(model.viewer.storagePrefix, 'deckloom:neutral-project');
  assert.deepEqual(model.decks[0].slides.map(slide => [slide.id, slide.index, slide.number, slide.width, slide.height]), [
    ['cover-main', 0, 1, 1280, 720], ['cover-meeting', 1, 2, 960, 720],
  ]);
  assert.equal(model.decks[1].slides[0].height, 1200);
  assert.equal(model.decks[0].slides[0].data, data);
  assert(!Object.isFrozen(data));
  assert(Object.isFrozen(model.decks[0].slides));
  assert(model.renderDocument(model.decks[0], model.decks[0].slides[0]).includes('Презентация «Deckloom» — пример'));
  const paths = prepared.selected[0].slides.map(item => item.output.html);
  input.decks[0].slides.reverse();
  input.decks[0].width = 800;
  const reordered = preflightProject(normalizeProject(input));
  assert.deepEqual(reordered.selected[0].slides.map(item => item.output.html), paths.toReversed());
  assert.equal(model.decks[0].slides[0].id, 'cover-main');
  assert.equal(model.decks[0].width, 1280);
  assert.equal(reordered.project.decks[0].slides[1].number, 2);
  assert(!fs.existsSync(root), 'Normalization/preflight must not create output');
});

test('closed v1 fields, types, required values and scope errors have field paths', t => {
  const root = path.join(temporary(t), 'new');
  const cases = [
    [p => { p.contractVersion = 2; }, 'UNSUPPORTED_CONTRACT_VERSION', 'project.contractVersion'],
    [p => { p.contractVersion = null; }, 'UNSUPPORTED_CONTRACT_VERSION', 'project.contractVersion'],
    [p => { p.mode = 'mixed'; }, 'INVALID_MODE', 'project.mode'],
    [p => { p.id = '../escape'; }, 'INVALID_ID', 'project.id'],
    [p => { p.root = 'relative'; }, 'INVALID_PATH', 'project.root'],
    [p => { p.root = null; }, 'INVALID_VALUE', 'project.root'],
    [p => { delete p.decks; }, 'INVALID_TYPE', 'project.decks'],
    [p => { delete p.decks[0].slides; }, 'INVALID_TYPE', 'project.decks[0].slides'],
    [p => { p.decks = new Array(1); }, 'INVALID_TYPE', 'project.decks[0]'],
    [p => { p.decks[0].slides = new Array(1); }, 'INVALID_TYPE', 'project.decks[0].slides[0]'],
    [p => { p.decks[0].label = ''; }, 'INVALID_VALUE', 'project.decks[0].label'],
    [p => { p.typo = true; }, 'UNKNOWN_FIELD', 'project.typo'],
    [p => { p.decks[0].styles = {}; }, 'UNKNOWN_FIELD', 'project.decks[0].styles'],
    [p => { p.decks[0].slides[0].number = 9; }, 'UNKNOWN_FIELD', 'project.decks[0].slides[0].number'],
    [p => { p.decks[0].slides[0].data = []; }, 'INVALID_TYPE', 'project.decks[0].slides[0].data'],
    [p => { p.viewer = null; }, 'INVALID_TYPE', 'project.viewer'],
    [p => { p.viewer = { titlle: 'x' }; }, 'UNKNOWN_FIELD', 'project.viewer.titlle'],
    [p => { p.artifacts = { layout: null }; }, 'INVALID_LAYOUT', 'project.artifacts.layout'],
    [p => { p.renderDocument = 'html'; }, 'INVALID_TYPE', 'project.renderDocument'],
    [p => { p.decks[0].expectedSlides = 1; }, 'EXPECTED_SLIDES_MISMATCH', 'project.decks[0].expectedSlides'],
    [p => { p.decks[0].expectedSlides = -1; }, 'INVALID_VALUE', 'project.decks[0].expectedSlides'],
    [p => { p.decks[0].artifactPrefix = 'old'; }, 'LAYOUT_CONFLICT', 'project.decks[0].artifactPrefix'],
    [p => { p.decks[0].slides[0].artifactNo = '01'; }, 'LAYOUT_CONFLICT', 'project.decks[0].slides[0].artifactNo'],
  ];
  for (const [mutate, code, field] of cases) {
    const input = createContractProject(root);
    mutate(input);
    assert.throws(() => normalizeProject(input), error(code, field));
  }
  for (const value of [null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '720']) {
    const input = createContractProject(root);
    input.decks[0].slides[0].height = value;
    assert.throws(() => normalizeProject(input), error('INVALID_DIMENSION', 'project.decks[0].slides[0].height', { deckId: 'intro', slideId: 'cover-main' }));
  }
  const optional = createContractProject(root);
  optional.viewer = undefined;
  optional.decks[0].slides[0].name = undefined;
  optional.decks[0].width = undefined;
  assert.equal(normalizeProject(optional).decks[0].width, 1920);
  assert.equal(normalizeProject(optional).decks[0].slides[0].name, 'cover-main');
});

test('IDs are case-exact references with case-insensitive uniqueness and prototype-safe scopes', t => {
  const input = createContractProject(path.join(temporary(t), 'new'));
  input.decks[1].id = 'INTRO';
  assert.throws(() => normalizeProject(input), error('DUPLICATE_ID', 'project.decks[1].id'));
  input.decks[1].id = 'portrait';
  input.decks[0].slides[1].id = 'COVER-main';
  assert.throws(() => normalizeProject(input), error('DUPLICATE_ID', 'project.decks[0].slides[1].id'));
  input.decks[0].slides = ['__proto__', 'constructor', 'toString', 'con'].map(id => ({ id }));
  const model = normalizeProject(input);
  assert.equal(model.decks[0].slides.length, 4);
  assert.throws(() => preflightProject(model, { deckId: 'INTRO' }), error('UNKNOWN_DECK', 'deckId'));
  assert(preflightProject(model, { operation: 'render' }).selected[0].slides[3].output.html.endsWith(path.join('deck-intro', 'slide-con', 'render.html')));
});

test('legacy layout separates file keys from display order and preserves callback inputs', t => {
  const input = legacy(path.join(temporary(t), 'new'));
  input.decks[0].slides.push({ no: '1', name: 'Без ведущего нуля' });
  const calls = [];
  input.validateDocument = (html, deck, slide) => calls.push(['validate', html, deck, slide]);
  input.renderSpec = (deck, slide) => [deck, slide];
  input.renderQa = async context => context;
  input.reportName = deck => { assert.equal(deck, input.decks[0]); return 'custom-report.json'; };
  input.viewer = { storagePrefix: 'old-state' };
  const model = normalizeProject(input);
  const deck = model.decks[0], slide = deck.slides[0];
  const prepared = preflightProject(model, { operation: 'render' });
  assert.equal(model.inputVersion, 0);
  assert.equal(model.viewer.storagePrefix, 'old-state');
  assert.deepEqual(deck.slides.map(s => [s.id, s.artifactNo, s.number]), [['02', '02', 1], ['01', '01', 2], ['1', '1', 3]]);
  assert(prepared.selected[0].slides[0].output.html.endsWith(path.join('demo-slide-02', 'demo-slide-02-render.html')));
  assert.equal(model.renderDocument(deck, slide), input.renderDocument(input.decks[0], input.decks[0].slides[0]));
  model.validateDocument('html', deck, slide);
  assert.deepEqual(calls[0], ['validate', 'html', input.decks[0], input.decks[0].slides[0]]);
  assert.deepEqual(model.renderSpec(deck, slide), [input.decks[0], input.decks[0].slides[0]]);
  return model.renderQa({ deck, slide, artifact: 'demo-slide-02' }).then(context => {
    assert.equal(context.deck, input.decks[0]);
    assert.equal(context.slide, input.decks[0].slides[0]);
    assert.equal(context.artifact, 'demo-slide-02');
  });
});

test('legacy classification and unsupported path migrations are explicit', t => {
  const input = legacy(path.join(temporary(t), 'new'));
  input.decks.push({ id: 'archive', label: 'Archive', artifactPrefix: 'archive' });
  assert.throws(() => normalizeProject(input), error('SOURCE_CONFLICT', 'project.decks'));
  input.decks = [];
  assert.throws(() => normalizeProject(input), error('AMBIGUOUS_LEGACY_MODE', 'project.decks'));
  const alpha = legacy(input.root);
  alpha.decks[0].slides[0].no = 'intro';
  assert.throws(() => normalizeProject(alpha), error('INVALID_ARTIFACT_NO', 'project.decks[0].slides[0].no'));
  const relative = legacy('artifacts');
  relative.staticMounts = { '/assets': 'assets' };
  const cwd = temporary(t);
  const model = normalizeProject(relative, { cwd });
  assert.equal(model.root, path.join(cwd, 'artifacts'));
  assert.equal(model.staticMounts['/assets'], path.join(cwd, 'assets'));
  assert.deepEqual(model.diagnostics.map(d => d.field), ['project.root', 'project.staticMounts["/assets"]']);
  assert.equal(relative.root, 'artifacts');
  const absolute = createContractProject(path.join(cwd, 'unchanged'));
  assert.equal(normalizeProject(absolute, { cwd: path.dirname(cwd) }).root, normalizeProject(absolute, { cwd }).root);
});

test('drafts are valid; render selection preflights all selected decks without writes', t => {
  const input = createContractProject(path.join(temporary(t), 'new'));
  input.decks = [];
  const empty = normalizeProject(input);
  assert.equal(preflightProject(empty).selected.length, 0);
  assert.throws(() => preflightProject(empty, { operation: 'render' }), error('EMPTY_TARGET', 'project.decks'));
  input.decks = [{ id: 'all', label: 'Draft', slides: [], expectedSlides: 0 }];
  assert.equal(normalizeProject(input).decks[0].slides.length, 0);
  assert.throws(() => preflightProject(normalizeProject(input), { operation: 'render' }), error('EMPTY_DECK', 'project.decks[0].slides', { deckId: 'all' }));
  input.decks.push({ id: 'ready', label: 'Ready', slides: [{ id: 'one' }] });
  const model = normalizeProject(input);
  assert.equal(preflightProject(model, { operation: 'render', deckId: 'ready' }).selected.length, 1);
  assert.equal(preflightProject(model, { deckId: 'all' }).selected[0].deck.id, 'all');
  assert.throws(() => preflightProject(model, { operation: 'render' }), error('EMPTY_DECK', 'project.decks[0].slides'));
  delete input.renderDocument;
  assert.throws(() => preflightProject(normalizeProject(input), { operation: 'render', deckId: 'ready' }), error('MISSING_RENDERER', 'project.renderDocument'));
  assert(!fs.existsSync(input.root));
});

test('discovery is explicit, read-only and requires an existing readable source', t => {
  const parent = temporary(t), root = path.join(parent, 'archive');
  const input = { contractVersion: 1, id: 'archive', mode: 'discovery', root,
    artifacts: { layout: 'legacy' }, decks: [{ id: 'old', label: 'Архив', artifactPrefix: 'old' }] };
  assert.throws(() => preflightProject(normalizeProject(input)), error('MISSING_ROOT', 'project.root'));
  fs.mkdirSync(root);
  const model = normalizeProject(input);
  assert.equal(preflightProject(model).selected[0].slides.length, 0);
  assert.throws(() => preflightProject(model, { operation: 'render' }), error('READ_ONLY_PROJECT', 'project.mode'));
  input.decks[0].slides = [];
  assert.throws(() => normalizeProject(input), error('SOURCE_CONFLICT', 'project.decks[0].slides'));
  delete input.decks[0].slides;
  delete input.artifacts;
  assert.throws(() => normalizeProject(input), error('INVALID_LAYOUT', 'project.artifacts.layout'));
  const legacyDiscovery = legacy(root);
  delete legacyDiscovery.decks[0].slides;
  assert.equal(normalizeProject(legacyDiscovery).mode, 'discovery');
  const access = fs.accessSync;
  fs.accessSync = () => { throw Object.assign(new Error('Denied'), { code: 'EACCES' }); };
  try { assert.throws(() => preflightProject(model), error('PATH_ACCESS', 'project.root')); }
  finally { fs.accessSync = access; }
});

test('artifact prefixes and report basenames cannot alias even for empty decks or unselected targets', t => {
  const root = path.join(temporary(t), 'new');
  const input = createContractProject(root);
  input.artifacts = { layout: 'legacy' };
  input.decks.forEach((deck, i) => { deck.artifactPrefix = i ? 'TALL' : 'wide'; deck.slides = []; });
  input.decks[1].artifactPrefix = 'WIDE';
  assert.throws(() => normalizeProject(input), error('DUPLICATE_PREFIX', 'project.decks[1].artifactPrefix'));
  input.decks[1].artifactPrefix = 'tall';
  input.decks[0].slides = [{ id: 'one', artifactNo: '01' }, { id: 'two', artifactNo: '01' }];
  assert.throws(() => normalizeProject(input), error('DUPLICATE_ARTIFACT_NO', 'project.decks[0].slides[1].artifactNo'));
  delete input.decks[0].slides[1].artifactNo;
  assert.throws(() => normalizeProject(input), error('INVALID_ARTIFACT_NO', 'project.decks[0].slides[1].artifactNo'));
  input.decks[0].slides = [];
  input.reportName = () => 'report.json';
  assert.throws(() => preflightProject(normalizeProject(input)), error('DUPLICATE_PATH', 'project.decks[1].reportName'));
  input.reportName = deck => deck.id === 'intro' ? 'REPORT.json' : 'report.json';
  assert.throws(() => preflightProject(normalizeProject(input)), error('DUPLICATE_PATH', 'project.decks[1].reportName'));
  input.reportName = () => 'wide-999';
  assert.throws(() => preflightProject(normalizeProject(input)), error('DUPLICATE_PATH', 'project.decks[0].reportName'));
  delete input.artifacts;
  input.decks.forEach(deck => { delete deck.artifactPrefix; });
  for (const name of ['../escape', 'x/y.json', 'x\\y.json', '', null, 'NUL.json', 'report.', 'a:b', 'trailing ', Promise.resolve('x.json')]) {
    input.reportName = () => name;
    assert.throws(() => preflightProject(normalizeProject(input)), error('INVALID_REPORT_NAME', 'project.decks[0].reportName'));
  }
  input.reportName = () => 'deck-PORTRAIT';
  assert.throws(() => preflightProject(normalizeProject(input), { deckId: 'intro' }), error('DUPLICATE_PATH', 'project.decks[0].reportName'));
  assert(!fs.existsSync(root));
});

test('static mounts use absolute paths and cannot shadow engine routes or one another', t => {
  const input = createContractProject(path.join(temporary(t), 'new'));
  for (const mount of ['/', '/api', '/API/slides', '/artifacts', '/slides-review.html', '/a/../b', '/a%2fb', '/a\\b', '/a/']) {
    input.staticMounts = { [mount]: input.root };
    assert.throws(() => normalizeProject(input), thrown => ['INVALID_MOUNT', 'MOUNT_CONFLICT'].includes(thrown.code));
  }
  input.staticMounts = { '/assets': 'relative' };
  assert.throws(() => normalizeProject(input), error('INVALID_PATH', 'project.staticMounts["/assets"]'));
  input.staticMounts = { '/assets': input.root, '/Assets/icons': input.root };
  assert.throws(() => normalizeProject(input), error('MOUNT_CONFLICT', 'project.staticMounts["/Assets/icons"]'));
  input.staticMounts = { '/assets': input.root, '/favicon.ico': path.join(input.root, 'favicon.ico') };
  assert.equal(Object.keys(normalizeProject(input).staticMounts).length, 2);
  const old = legacy(input.root);
  old.staticMounts = { '/demo-slide-01/assets': input.root };
  assert.throws(() => normalizeProject(old), error('MOUNT_CONFLICT', 'project.staticMounts["/demo-slide-01/assets"]'));
});

test('legacy renderer root and server mounts resolve once, independently of later cwd changes', async t => {
  const parent = temporary(t), first = path.join(parent, 'first'), second = path.join(parent, 'second');
  fs.mkdirSync(first); fs.mkdirSync(second);
  fs.mkdirSync(path.join(first, 'assets'));
  fs.writeFileSync(path.join(first, 'assets/marker.txt'), 'original mount', 'utf8');
  const previous = process.cwd();
  let server;
  try {
    process.chdir(first);
    const input = legacy('artifacts');
    input.staticMounts = { '/assets': 'assets' };
    const renderer = createRenderer(input);
    server = createReviewServer(input);
    process.chdir(second);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/assets/marker.txt`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'original mount');
    const report = await renderer.renderDeck(planningBrowser(), input.decks[0]);
    assert(report[0].html.startsWith(path.join(first, 'artifacts') + path.sep));
    assert(!fs.existsSync(path.join(second, 'artifacts')));
  } finally {
    process.chdir(previous);
    if (server) await new Promise(resolve => server.close(resolve));
  }
});

test('source and output path preflight follows links, catches aliases, and creates no files', t => {
  const parent = temporary(t), source = path.join(parent, 'source'), outside = path.join(parent, 'outside');
  fs.mkdirSync(source); fs.mkdirSync(outside);
  const input = createContractProject(source);
  fs.symlinkSync(outside, path.join(source, 'deck-intro'), 'junction');
  assert.throws(() => preflightProject(normalizeProject(input), { operation: 'render' }), error('PATH_ESCAPE', 'project.decks[0].slides[0]'));
  fs.unlinkSync(path.join(source, 'deck-intro'));
  const output = path.join(parent, 'output'); fs.mkdirSync(output);
  fs.symlinkSync(outside, path.join(output, 'deck-intro'), 'junction');
  assert.throws(() => preflightProject(normalizeProject(input), { operation: 'render', outputRoot: output }), error('PATH_ESCAPE', 'project.decks[0].slides[0]'));
  fs.unlinkSync(path.join(output, 'deck-intro'));
  fs.mkdirSync(path.join(output, 'deck-intro'));
  fs.mkdirSync(path.join(output, 'deck-intro/slide-cover-main'));
  fs.symlinkSync(path.join(output, 'deck-intro/slide-cover-main'), path.join(output, 'deck-intro/slide-cover-meeting'), 'junction');
  assert.throws(() => preflightProject(normalizeProject(input), { operation: 'render', outputRoot: output }), error('DUPLICATE_PATH', 'project.decks[0].slides[1]'));
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.writeFileSync(path.join(source, 'render-report-intro.json'), 'sentinel', 'utf8');
  const prepared = preflightProject(normalizeProject(input), { outputRoot: 'isolated', cwd: parent });
  assert.equal(prepared.outputRoot, path.join(parent, 'isolated'));
  assert(!fs.existsSync(prepared.outputRoot));
  assert.equal(fs.readFileSync(path.join(source, 'render-report-intro.json'), 'utf8'), 'sentinel');
  const old = legacy(source);
  old.reportName = () => 'demo-slide-01-render.html';
  assert.throws(() => preflightProject(normalizeProject(old), { operation: 'render', outputRoot: path.join(source, 'demo-slide-01') }), error('DUPLICATE_PATH', 'project.decks[0].reportName'));
  assert(!fs.existsSync(path.join(source, 'demo-slide-01')));
});

test('all public entry points share validation and accept registered v1', async t => {
  const root = path.join(temporary(t), 'new');
  const invalid = legacy(root);
  invalid.decks[0].slides[1].no = '02';
  const expected = error('DUPLICATE_ID', 'project.decks[0].slides[1].no');
  assert.throws(() => createRenderer(invalid), expected);
  assert.throws(() => createReviewServer(invalid), expected);
  await assert.rejects(scanDecks(invalid), expected);
  await assert.rejects(scanSlides(invalid), expected);
  const v1 = createContractProject(root);
  assert.equal(typeof createRenderer(v1).renderDeck, 'function');
  const server = createReviewServer(v1);
  assert.equal(typeof server.listen, 'function');
  assert.equal((await scanDecks(v1)).contractVersion, 1);
  assert.equal((await scanSlides(v1)).contractVersion, 1);
  const invalidV1 = { ...v1, contractVersion: 999 };
  assert.throws(() => createRenderer(invalidV1), error('UNSUPPORTED_CONTRACT_VERSION', 'project.contractVersion'));
  assert(!fs.existsSync(root));
});

test('legacy render validates the whole operation before writes, including later slides and report hooks', async t => {
  const root = path.join(temporary(t), 'new');
  const input = legacy(root);
  const renderer = createRenderer(input);
  input.decks[0].slides[1].no = '../escape';
  await assert.rejects(renderer.renderDeck(null, input.decks[0]), { code: 'INVALID_ID' });
  assert(!fs.existsSync(root));
  input.decks[0].slides[1].no = '01';
  input.reportName = () => '../report.json';
  await assert.rejects(renderer.renderDeck(null, input.decks[0]), { code: 'INVALID_REPORT_NAME' });
  assert(!fs.existsSync(root));
  delete input.reportName;
  input.decks.push({ id: 'draft', label: 'Draft', artifactPrefix: 'draft', slides: [] });
  await assert.rejects(renderer.run(['--deck=all']), { code: 'EMPTY_DECK' });
  assert(!fs.existsSync(root));
});

// Browser behavior is covered by engine.test.cjs; this double isolates operation
// planning and filesystem writes from browser/HTML behavior.
function planningBrowser() {
  const viewports = [];
  return {
    viewports,
    async newPage({ viewport }) {
      viewports.push(viewport);
      return { on() {}, async goto() {}, async setContent() {}, async evaluate(fn) {
        if (fn.name === 'staticInspection') return [];
        if (fn.name === 'readiness') return { images: [], fonts: [] };
        return { overflow: [] };
      },
        async screenshot() { return Buffer.from('planning-test-placeholder'); },
        async $$eval() { return []; }, async close() {} };
    },
    async close() {},
  };
}

test('callback mutation cannot change preflighted paths, order or viewport inside renderDeck', async t => {
  const parent = temporary(t), root = path.join(parent, 'root'), outside = path.join(parent, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, 'demo-slide-99'), 'junction');
  const input = legacy(root);
  input.decks[0].width = 800;
  input.decks[0].height = 600;
  const originalDeck = input.decks[0], originalSlides = originalDeck.slides.slice();
  const calls = [];
  input.renderDocument = (deck, slide) => {
    assert.equal(deck, originalDeck);
    calls.push(slide);
    if (calls.length === 1) {
      originalSlides[1].no = '99';
      originalSlides[1].width = 200;
      deck.artifactPrefix = '../outside';
      deck.width = 0;
      deck.slides.reverse();
      deck.slides.push({ no: '03' });
    }
    return '<main>Neutral snapshot</main>';
  };
  const browser = planningBrowser();
  const report = await createRenderer(input).renderDeck(browser, originalDeck);
  assert.deepEqual(calls, originalSlides);
  assert.deepEqual(report.map(item => item.slide), ['02', '01']);
  assert.deepEqual(browser.viewports, [{ width: 800, height: 600 }, { width: 800, height: 600 }]);
  assert(fs.existsSync(path.join(root, 'demo-slide-01/demo-slide-01-render.html')));
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('CLI all executes one project snapshot and keeps prototype-like deck IDs', async t => {
  const input = legacy(path.join(temporary(t), 'new'));
  input.decks[0].slides = [input.decks[0].slides[0]];
  input.decks.push({ id: '__proto__', label: 'Other', artifactPrefix: 'other', width: 640, height: 480,
    slides: [{ no: '01' }] });
  input.renderDocument = () => {
    input.decks[1].slides.push({ no: '99' });
    input.decks[1].width = 1;
    return '<main>Neutral snapshot</main>';
  };
  const { chromium } = require('playwright');
  const launch = chromium.launch, browser = planningBrowser();
  chromium.launch = async () => browser;
  let reports;
  try { reports = await createRenderer(input).run(['--deck=all']); }
  finally { chromium.launch = launch; }
  assert.deepEqual(Object.keys(reports), ['demo', '__proto__']);
  assert.deepEqual(reports.__proto__.map(item => item.slide), ['01']);
  assert.deepEqual(browser.viewports[1], { width: 640, height: 480 });
  assert(!fs.existsSync(path.join(input.root, 'other-99')));
});

test('atomic writes preserve similarly named reports and never follow an existing temporary file', async t => {
  const root = temporary(t);
  const { writeArtifact } = require('../src/renderer.cjs');
  const report = path.join(root, 'shared.json'), oldTemporaryName = `${report}.${process.pid}.tmp`;
  await writeArtifact(oldTemporaryName, 'first-report', 'utf8');
  await writeArtifact(report, 'second-report', 'utf8');
  assert.equal(fs.readFileSync(oldTemporaryName, 'utf8'), 'first-report');
  assert.equal(fs.readFileSync(report, 'utf8'), 'second-report');
  const sentinel = path.join(root, 'sentinel');
  fs.writeFileSync(sentinel, 'must survive', 'utf8');
  const fsp = require('node:fs/promises'), open = fsp.open;
  let injected;
  fsp.open = async (file, flags) => {
    assert.equal(flags, 'wx');
    injected = file;
    // Model a concurrent pre-existing file alias without requiring symlink rights.
    fs.linkSync(sentinel, file);
    return open(file, flags);
  };
  try { await assert.rejects(writeArtifact(report, 'bad', 'utf8'), { code: 'EEXIST' }); }
  finally { fsp.open = open; }
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'must survive');
  assert(fs.existsSync(injected), 'A failed exclusive open must not clean up someone else’s file');
  assert.equal(fs.readFileSync(report, 'utf8'), 'second-report');
});
