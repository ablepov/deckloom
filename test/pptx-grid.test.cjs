const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const pptx = require('../src/pptx.cjs');
const pack = require('../src/pptx-package.cjs');
const { createRenderer } = require('../src/index.cjs');
const fixture = require('../examples/pptx-grid.config.cjs');
const digest = data => createHash('sha256').update(data).digest('hex');
async function page(t) {
  const b = await chromium.launch();
  t.after(() => b.close());
  return b.newPage({ viewport: { width: 960, height: 540 } });
}
const source = id => fixture.renderDocument(null, { id });

test('Grid cards preserve measured geometry, native shape order and original authoring HTML', async t => {
  const p = await page(t);
  for (const id of ['grid', 'grid-wrap']) {
    await p.setContent(source(id));
    const before = await p.content();
    const scene = await p.evaluate(pptx.captureDocument);
    assert(!scene.error, JSON.stringify(scene.error));
    assert.equal(await p.content(), before, 'capture must not flatten/mutate the authoring DOM');
    assert.equal(scene.objects.length, id === 'grid' ? 10 : 13);
    assert.equal(scene.conversion.nativeIndexConvention, 'one-based-slide-shape-order');
    assert.deepEqual(scene.conversion.rasterizedObjects, []);
    assert.deepEqual(scene.conversion.rasterFallbacks, []);
    const cards = scene.conversion.containers.filter(c => c.kind === 'card');
    assert.equal(cards.length, id === 'grid' ? 3 : 4);
    assert.deepEqual(scene.objects.slice(1, 4).map(o => [o.id, o.kind]), [
      ['card-one', 'rect'], ['card-one-title', 'text'], ['card-one-body', 'text'],
    ]);
    assert.equal(cards[0].bounds.x, 48);
    assert.equal(cards[0].bounds.y, id === 'grid' ? 150 : 130);
    if (id === 'grid') assert(Math.abs(cards[1].bounds.x - (48 + 824 / 3 + 20)) < .02);
    else {
      assert.equal(cards[2].bounds.x, cards[0].bounds.x);
      assert.equal(cards[2].bounds.y, 330);
    }
    const actual = await p.evaluate(() => [...document.querySelectorAll('[data-deckloom-pptx]')].map(n => {
      const r = n.getBoundingClientRect();
      const sourcePath = [];
      for (let parent = n; parent?.id; parent = parent.parentElement) sourcePath.unshift(parent.id);
      return { id: n.id, sourcePath, bounds: { x: r.x, y: r.y, w: r.width, h: r.height } };
    }));
    for (const [i, mapping] of scene.conversion.objects.entries()) {
      assert.equal(mapping.nativeIndex, i + 1);
      assert.deepEqual(mapping.bounds, actual.find(n => n.id === mapping.sourceId).bounds);
      assert.deepEqual(mapping.sourcePath, actual.find(n => n.id === mapping.sourceId).sourcePath);
      assert.equal(scene.objects[i].id, mapping.sourceId);
    }
    assert.deepEqual(scene.conversion.containers[0].outputIds, scene.objects.slice(1).map(o => o.id));
    const rendered = await pptx.render([{ ...scene, slideId: id }]);
    const { files } = await pack.load(rendered.bytes);
    const xml = files.get('ppt/slides/slide1.xml').toString('utf8');
    const names = [...xml.matchAll(/<p:cNvPr id="\d+" name="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(names, scene.conversion.objects.map(o => o.sourceId));
    assert(!xml.includes('<p:pic>'), 'Grid/text/rect must not be rasterized');
    assert(rendered.conversion.slides[0].objects.every(o => o.verified && o.nativeShapeId));
    if (id === 'grid') {
      const drifted = structuredClone({ ...scene, slideId: id });
      drifted.conversion.objects[0].nativeIndex = 99;
      await assert.rejects(pptx.render([drifted]), { code: 'PPTX_MAPPING_MISMATCH' });
    }
    const restored = JSON.parse(JSON.stringify({ html: before }));
    await p.setContent(restored.html);
    assert.deepEqual((await p.evaluate(pptx.captureDocument)).objects, scene.objects);
  }
});

test('Grid rejects silent paint loss, escaping/overlapping containers, placement changes and native-object budget overflow', async t => {
  const p = await page(t);
  const original = source('grid');
  const css = rule => original.replace('</style>', rule.replaceAll('}', '!important}') + '</style>');
  const cases = [
    css('#cards{text-decoration:underline}'), css('#card-one{text-decoration:underline}'),
    css('#cards{background:red}'), css('#card-one{background:transparent}'),
    css('#cards{display:flex}'), css('#cards{grid-auto-flow:column}'),
    css('#card-one{position:absolute}'), css('#card-one{left:5px}'),
    css('#card-one{grid-column:2}'), css('#card-one{order:2}'),
    css('#card-one{margin:-10px}'), css('#card-one{padding:10px}'),
    css('#card-one{opacity:.5}'), css('#card-one{overflow:hidden}'),
    css('#card-one{align-self:center}'), css('#cards{grid-template-areas:"a b c"}'),
    css('#cards{grid-template-columns:[a] 1fr [b] 1fr [c] 1fr}'),
    css('#card-one-body{left:250px}'), css('#card-one-body{display:grid}'),
    css('#title{grid-template-columns:1fr}'),
    original.replace('id="card-two"', 'id="card-one-title"'),
    original.replace('data-deckloom-pptx="card"', 'data-deckloom-pptx="grid"'),
    original.replace('data-deckloom-pptx="text"', 'data-deckloom-pptx="unknown"'),
    original.replace('<div id="card-one-title"', 'lost<div id="card-one-title"'),
    original.replace('</main>', '<div id="overlay" data-deckloom-pptx="rect" style="position:absolute;left:50px;top:160px;width:10px;height:10px;background:red"></div></main>'),
    original.replace('<div id="cards"', '<div id="underlay" data-deckloom-pptx="rect" style="position:absolute;left:50px;top:160px;width:10px;height:10px;background:red"></div><div id="cards"'),
  ];
  for (const [i, html] of cases.entries()) {
    await p.setContent(html);
    assert((await p.evaluate(pptx.captureDocument)).error, 'negative case ' + i);
  }
  for (const count of [255, 256]) {
    const many = Array.from({ length: count }, (_, i) => `<div id="rect-${i}" data-deckloom-pptx="rect" style="position:absolute;left:0;top:0;width:1px;height:1px;background:red"></div>`).join('');
    const html = original.replace(/<div id="title"[^]*?<\/div>/, '').replace(/<div id="card-one-title"[^]*?<\/main>/, many + '</div></div></main>');
    await p.setContent(html);
    const budget = await p.evaluate(pptx.captureDocument);
    if (count === 255) { assert(!budget.error, JSON.stringify(budget.error)); assert.equal(budget.objects.length, 256); }
    else assert.match(budget.error.message, /256 native objects/);
  }
});

test('Grid card preserves overlapping native leaves and SVG primary bytes with explicit PNG compatibility fallback', async t => {
  const p = await page(t);
  const bytes = await fs.readFile(path.join(__dirname, '../examples/export-assets/pptx-marker.svg'));
  const extra = '<div id="card-decoration" data-deckloom-pptx="rect" style="position:absolute;left:10px;top:10px;width:100px;height:60px;background:#D0A0EE"></div>' +
    `<img id="card-image" data-deckloom-pptx="image" alt="SVG" src="data:image/svg+xml;base64,${bytes.toString('base64')}" style="position:absolute;left:20px;top:180px;width:40px;height:40px;overflow:visible">`;
  await p.setContent(source('grid').replace('<div id="card-one-title"', extra + '<div id="card-one-title"'));
  await p.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
  const scene = await pptx.capture(p, { id: 'grid-media' }, [{ familyName: 'Arial', isCustomFont: false }]);
  assert.deepEqual(scene.objects.slice(1, 6).map(o => o.id), ['card-one', 'card-decoration', 'card-image', 'card-one-title', 'card-one-body']);
  assert.deepEqual(scene.conversion.rasterizedObjects, []);
  assert.deepEqual(scene.conversion.rasterFallbacks, [{ sourceId: 'card-image', kind: 'svg-png-compatibility', primary: 'image/svg+xml', fallback: 'image/png' }]);
  const rendered = await pptx.render([scene]);
  const { files } = await pack.load(rendered.bytes);
  assert([...files.entries()].some(([name, data]) => name.endsWith('.svg') && digest(data) === digest(bytes)));
  const xml = files.get('ppt/slides/slide1.xml').toString('utf8');
  assert(xml.indexOf('name="card-decoration"') < xml.indexOf('name="card-image"'));
  assert(xml.indexOf('name="card-image"') < xml.indexOf('name="card-one-title"'));
  assert.equal(rendered.verified.svgPairs.length, 1);
});

test('public Grid export links conversion report to intact source and fails atomically for unsupported layout', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-e4-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const b = await chromium.launch();
  t.after(() => b.close());
  const calls = [];
  const project = { ...fixture, renderDocument(d, s) { calls.push(s.id); return fixture.renderDocument(d, s); } };
  const request = { deckId: 'main', outputRoot: path.join(root, 'export'), browser: b, slideIds: ['grid-wrap', 'grid'],
    formats: ['pptx', 'html'], fonts: { policy: 'allow-substitution' },
    pptx: { mode: 'strict', fonts: { mode: 'reference', family: 'Arial', profile: 'windows-installed-v1' } } };
  const result = await createRenderer(project).export(request);
  assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
  assert.deepEqual(calls, ['grid', 'grid-wrap']);
  const manifest = JSON.parse(await fs.readFile(result.bundle.manifest, 'utf8'));
  const verification = JSON.parse(await fs.readFile(path.join(result.bundle.directory, manifest.pptx.report), 'utf8'));
  assert.deepEqual(verification.conversion, manifest.pptx.conversion);
  const scenes = JSON.parse(await fs.readFile(path.join(result.bundle.directory, manifest.pptx.prepared), 'utf8'));
  const p = await b.newPage();
  for (const slide of verification.conversion.slides) {
    const html = await fs.readFile(path.join(result.bundle.directory, slide.sourceDocument.path), 'utf8');
    assert.equal(digest(html), slide.sourceDocument.sha256);
    assert(html.includes('data-deckloom-pptx="grid"'));
    await p.setContent(html);
    assert.deepEqual((await p.evaluate(pptx.captureDocument)).objects, scenes.find(s => s.slideId === slide.slideId).objects);
  }
  const failed = await createRenderer({ ...fixture, renderDocument(d, s) { return fixture.renderDocument(d, s).replace('display:grid', 'display:flex'); } }).export(request);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'PPTX_UNSUPPORTED_HTML');
  assert.deepEqual(failed.outputs, []);
  assert.equal(failed.error.stage, 'pptx-capture');
  const builds = require('../src/builds.cjs');
  assert.equal((await builds.publication(request.outputRoot, 'main')).published.manifest.buildId, result.outputs.find(o => o.format === 'pptx').buildId);
});
