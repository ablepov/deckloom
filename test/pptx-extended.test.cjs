const test = require('node:test'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const pptx = require('../src/pptx.cjs'), pack = require('../src/pptx-package.cjs');
const fixture = require('../examples/pptx-extended.config.cjs');
const { createRenderer } = require('../src/index.cjs');
async function page(t) { const b = await chromium.launch(); t.after(() => b.close()); return b.newPage({ viewport: { width: 960, height: 960 } }); }
const source = id => fixture.renderDocument(null, { id });
test('E4 Flex/table/connectors/crop/opacity/themes/portrait preserve native structure and measured geometry', async t => {
  const p = await page(t);
  for (const id of ['flex', 'table', 'connectors', 'crop', 'opacity', 'theme-dark', 'portrait']) {
    // Resources are prepared data for direct capture; public tests also exercise the resource resolver.
    const image = 'data:image/png;base64,' + (await fs.readFile(path.join(__dirname, '../examples/export-assets/pptx-marker.png'))).toString('base64');
    await p.setContent(source(id).replace('../../export-assets/pptx-marker.png', image)); await p.locator('img').evaluateAll(imgs => Promise.all(imgs.map(i => i.decode())));
    const before = await p.content(), scene = await pptx.capture(p, { id }, []);
    assert.equal(await p.content(), before); assert.equal(scene.height, id === 'portrait' ? 960 : 540);
    const result = await pptx.render([scene]); assert.ok(result.conversion.slides[0].objects.every(o => o.verified));
    const { files } = await pack.load(result.bytes), xml = files.get('ppt/slides/slide1.xml').toString('utf8');
    if (id === 'flex') { assert.equal(scene.conversion.containers[0].kind, 'flex'); assert.equal(scene.objects.length, 10); }
    if (id === 'table') { assert.ok(xml.includes('<a:tbl>')); assert.equal((xml.match(/<a:tc>/g) || []).length, 9); assert.ok(xml.includes('Первая строка')); assert.ok(xml.includes('<a:spcPts val="2250"')); }
    if (id === 'connectors') { assert.ok(xml.includes('<p:cxnSp>')); assert.equal(scene.objects.find(o => o.id === 'link-ab').attached, false); }
    if (id === 'crop') { assert.ok(/<a:srcRect[^>]*[lrtb]="[1-9]/.test(xml)); assert.ok(scene.objects.find(o => o.id === 'crop-image').crop); }
    if (id === 'opacity') { assert.ok(xml.includes('<a:alpha val="30000"')); assert.ok(xml.includes('<a:alpha val="60000"')); }
    if (id === 'portrait') assert.ok(files.get('ppt/presentation.xml').toString().includes('cx="5143500" cy="9144000"'));
    assert.deepEqual(scene.conversion.rasterizedObjects, []);
  }
});
test('E4 explicit decorative raster excludes text and preserves authoring DOM', async t => {
  const p = await page(t); await p.setContent(source('paint')); const before = await p.content();
  const scene = await pptx.capture(p, { id: 'paint' }, []); assert.equal(await p.content(), before);
  assert.deepEqual(scene.conversion.rasterizedObjects.map(o => o.sourceId), ['deckloom-background', 'decoration']);
  assert.ok(scene.conversion.rasterizedObjects.every(o => o.containsText === false));
  assert.equal(scene.objects.find(o => o.id === 'paint-note').kind, 'text');
  const result = await pptx.render([scene]); assert.ok(result.conversion.slides[0].objects.every(o => o.verified));
});
test('E4 SVG cover preserves full primary and compatibility raster aspect before native crop', async t => {
  const p = await page(t), bytes = await fs.readFile(path.join(__dirname, '../examples/export-assets/pptx-marker.svg'));
  await p.setContent(source('crop').replace('../../export-assets/pptx-marker.png', 'data:image/svg+xml;base64,' + bytes.toString('base64'))); await p.locator('img').evaluate(i => i.decode());
  const scene = await pptx.capture(p, { id: 'svg-cover' }, []), object = scene.objects.find(o => o.id === 'crop-image');
  const raster = Buffer.from(object.fallback.split(',')[1], 'base64'); assert.equal(raster.readUInt32BE(16), object.crop.naturalWidth); assert.equal(raster.readUInt32BE(20), object.crop.naturalHeight);
  const result = await pptx.render([scene]), { files } = await pack.load(result.bytes);
  assert.ok([...files.values()].some(value => value.equals(bytes)), 'full SVG primary must be preserved');
  assert.ok(result.conversion.slides[0].objects.find(o => o.sourceId === object.id).verified);
});
test('E4 rejects unsupported reversals/merges/crop positions/group opacity and undeclared paint', async t => {
  const p = await page(t);
  const cases = [source('flex').replace('display:flex;', 'display:flex;flex-direction:row-reverse;'), source('table').replace('<td ', '<td colspan="2" '), source('crop').replace('object-fit:cover', 'object-fit:contain'), source('opacity').replace('data-deckloom-pptx="slide"', 'data-deckloom-pptx="slide" style="opacity:.5"'), source('paint').replace(' data-deckloom-pptx-background="raster"', ''), source('paint').replace('Растр — только декор.', 'Растр — только декор.').replace('data-deckloom-pptx="paint"', 'data-deckloom-pptx="rect"')];
  for (const html of cases) { await p.setContent(html); assert.ok((await p.evaluate(pptx.captureDocument)).error); }
  await p.setContent(source('paint').replace('padding="32"', 'padding="8"')); assert.ok((await p.evaluate(pptx.captureDocument)).error);
  for (const style of ['text-transform:uppercase;', 'letter-spacing:2px;', 'word-spacing:8px;', 'text-indent:20px;', 'direction:rtl;', 'position:relative;left:30px;', 'display:block;']) {
    await p.setContent(source('table').replace('<td style="', '<td style="' + style)); assert.ok((await p.evaluate(pptx.captureDocument)).error, style);
  }
});
test('E4 public matrix and portrait use the common all-format export path', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-matrix-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const deckId of ['main', 'portrait']) {
    const result = await createRenderer(fixture).export({ deckId, ...(deckId === 'main' ? { slideIds: ['flex', 'table', 'connectors', 'crop', 'paint', 'opacity', 'theme-dark'] } : {}), outputRoot: path.join(root, deckId), formats: ['html', 'png', 'pdf', 'pptx'], fonts: { policy: 'allow-substitution' }, pptx: { mode: 'strict', fonts: { mode: 'reference', family: 'Arial', profile: 'windows-installed-v1' } } });
    assert.equal(result.status, 'succeeded', JSON.stringify(result.error || result.diagnostics));
  }
});
