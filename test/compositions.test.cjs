const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const { templates, compositions, createRenderer } = require('../src/index.cjs');
const library = require('../examples/engine-library.cjs');
const ref = { libraryId: library.id, templateId: 'summary', revision: '1' };
const empty = () => ({ documentVersion: 1, projectId: 'p', id: 'main', width: 960, height: 540, slides: [] });
test('F3 field schemas, themes, bindings, slots and metadata share the resolved document', () => {
  const catalog = templates.createCatalog([library]); let doc = catalog.instantiate(empty(), ref, 'a');
  doc = catalog.instantiate(doc, ref, 'b', { title: 'Второй', showBody: false }); doc.slides[1].theme = 'dark';
  const compiled = compositions.validateDocument(doc, catalog);
  assert.equal(compiled.slides[1].theme, 'dark'); assert.equal(compiled.slides[1].palette.background, '#17221c');
  assert.equal(compiled.slides[1].blocks.find(b => b.id === 'body').visible, false);
  assert.equal(doc.slides[1].content.data.body, library.templates[0].defaults.body);
  assert.deepEqual(compiled.slides[0].capabilities.editableFields, ['title', 'body', 'showBody', 'picture']);
  assert.equal(compiled.slides[0].capabilities.formats.pptx.supported, true);
  const project = compositions.createProject(doc, catalog, { root: path.resolve('examples') });
  const html = project.renderDocument(null, { id: 'b' }); assert(html.includes('Второй')); assert(!html.includes('id="body"'));
  doc.slides[1].content.data.title = 'Changed after snapshot'; assert(!project.renderDocument(null, { id: 'b' }).includes('Changed after snapshot'));
});
test('F3 refuses bad instance values/fields/themes and malformed definitions/slots without partial edits', () => {
  const catalog = templates.createCatalog([library]), doc = catalog.instantiate(empty(), ref, 'a');
  for (const mutate of [d => { d.slides[0].content.data.title = ''; }, d => { d.slides[0].content.data.typo = 1; }, d => { d.slides[0].content.data.showBody = 'false'; }, d => { d.slides[0].theme = 'unknown'; }, d => { d.slides[0].content.data.picture.src = 'https://example.com/x.png'; }]) {
    const d = structuredClone(doc); mutate(d); assert.throws(() => compositions.validateDocument(d, catalog));
  }
  for (const mutate of [d => { d.definitionVersion = 2; }, d => { d.fields.title.type = 'function'; }, d => { d.blocks[0].text = { field: ['title'] }; }, d => { d.blocks[0].slot = 'missing'; }, d => { d.blocks.reverse(); }, d => { d.blocks[1].id = 'title'; }]) {
    const definition = structuredClone(library.templates[0].definition); mutate(definition); assert.throws(() => compositions.normalizeDefinition(definition));
  }
  const authored = empty(); authored.slides = [{ id: 'a', content: { kind: 'authored', data: { definition: structuredClone(library.templates[0].definition), values: structuredClone(library.templates[0].defaults) } } }];
  authored.slides[0].content.data.definition.blocks[0].visible = false;
  assert.throws(() => compositions.validateDocument(authored, templates.createCatalog([])), { code: 'INVALID_INSTANCE_DATA' });
  for (const src of [' https://example.com/x.png', ' //example.com/x.png', '../x.png ', '/absolute.png', '..\\x.png', '\\example.com/x.png', '/\\example.com/x.png']) {
    const d = structuredClone(doc); d.slides[0].content.data.picture.src = src; assert.throws(() => compositions.validateDocument(d, catalog), { code: 'INVALID_INSTANCE_DATA' });
  }
});
test('F3 implicit theme selection is deterministic under canonical-equivalent catalog key order', () => {
  const first = structuredClone(library); delete first.templates[0].definition.defaultTheme;
  const second = structuredClone(first); second.templates[0].definition.themes = Object.fromEntries(Object.entries(second.templates[0].definition.themes).reverse());
  const a = templates.createCatalog([first]), b = templates.createCatalog([second]), doc = a.instantiate(empty(), ref, 'a');
  assert.equal(compositions.validateDocument(doc, a).slides[0].theme, compositions.validateDocument(doc, b).slides[0].theme);
  assert.equal(compositions.createProject(doc, a, { root: path.resolve('examples') }).renderDocument(null, { id: 'a' }), compositions.createProject(doc, b, { root: path.resolve('examples') }).renderDocument(null, { id: 'a' }));
});
test('F3 neutral project exports through existing D/C/PPTX pipeline from the same source', { skip: process.platform !== 'win32' }, async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-f3-')); t.after(() => fs.rm(folder, { recursive: true, force: true, maxRetries: 5 }));
  const catalog = templates.createCatalog([library]); const doc = catalog.instantiate(empty(), ref, 'summary', { title: 'Проверка «шаблона»' });
  const project = compositions.createProject(doc, catalog, { root: path.resolve('examples') });
  const result = await createRenderer(project).export({ deckId: 'main', outputRoot: path.join(folder, 'export'), formats: ['html', 'png', 'pdf', 'pptx'], fonts: { policy: 'allow-substitution' }, pptx: { mode: 'strict', fonts: { mode: 'reference', family: 'Arial', profile: 'windows-installed-v1' } } });
  assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
  assert.equal(result.outputs.find(o => o.format === 'pptx').slides[0].objects.find(o => o.id === 'title').text, 'Проверка «шаблона»');
});
