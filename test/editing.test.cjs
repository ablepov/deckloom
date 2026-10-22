const test = require('node:test'), assert = require('node:assert/strict');
const { templates, editing } = require('../src/index.cjs'); const library = require('../examples/engine-library.cjs');
function setup() { const catalog = templates.createCatalog([library]), editor = editing.createEditor(catalog), doc = editor.create({ projectId: 'p', id: 'd', width: 960, height: 540 }); return { editor, doc }; }
const ref = { libraryId: library.id, templateId: 'summary', revision: '1' };
test('F4 create/add/duplicate/reorder/edit/remove keep independent immutable instances', () => {
  const { editor, doc: draft } = setup(); let doc = editor.addTemplate(draft, ref, 'a');
  doc = editor.addTemplate(doc, ref, 'b'); const before = structuredClone(doc);
  doc = editor.editFields(doc, 'a', { title: 'Правка — один' }); assert.equal(doc.slides[1].content.data.title, 'Нейтральный шаблон');
  doc = editor.duplicate(doc, 'a', 'copy'); doc = editor.setTheme(doc, 'copy', 'dark'); doc = editor.rename(doc, 'copy', 'Копия');
  doc = editor.reorder(doc, ['b', 'copy', 'a']); assert.deepEqual(doc.slides.map(s => s.id), ['b', 'copy', 'a']);
  doc = editor.remove(doc, 'copy'); assert.deepEqual(doc.slides.map(s => s.id), ['b', 'a']);
  assert.equal(before.slides[0].content.data.title, 'Нейтральный шаблон'); assert.deepEqual(draft.slides, []);
});
test('F4 failures and cancellation are transactional, field/theme and exact order errors reject', () => {
  const { editor, doc } = setup(); const first = editor.addTemplate(doc, ref, 'a'), before = structuredClone(first);
  for (const operation of [d => editor.editFields(d, 'a', { title: '' }), d => editor.editFields(d, 'a', { typo: 1 }), d => editor.setTheme(d, 'a', 'missing'), d => editor.reorder(d, []), d => editor.duplicate(d, 'a', 'A'), d => editor.remove(d, 'missing'), d => editor.editBlock(d, 'a', 'title', { x: 50 })]) assert.throws(() => operation(first));
  const controller = new AbortController(); controller.abort(); assert.throws(() => editor.remove(first, 'a', { signal: controller.signal }), { code: 'CANCELLED' });
  assert.deepEqual(first, before);
});
test('F4 authored block operations protect stable IDs, required slots and semantic slot order', () => {
  const { editor, doc } = setup(); const definition = structuredClone(library.templates[0].definition), values = structuredClone(library.templates[0].defaults);
  let d = editor.addAuthored(doc, 'custom', definition, values); const before = structuredClone(d);
  d = editor.editBlock(d, 'custom', 'body', { x: 100, w: 580 }); d = editor.setBlockVisible(d, 'custom', 'body', false);
  assert.equal(d.slides[0].content.data.values.body, values.body);
  assert.throws(() => editor.setBlockVisible(d, 'custom', 'title', false));
  assert.throws(() => editor.removeBlock(d, 'custom', 'title'));
  assert.throws(() => editor.editBlock(d, 'custom', 'title', { id: 'new' }));
  assert.throws(() => editor.reorderBlocks(d, 'custom', ['body', 'title', 'panel', 'picture']));
  d = editor.addBlock(d, 'custom', { id: 'extra', type: 'rect', x: 10, y: 500, w: 20, h: 20, fill: '#2456a6' });
  d = editor.removeBlock(d, 'custom', 'extra'); assert.equal(d.slides[0].content.data.definition.blocks.length, definition.blocks.length);
  assert.deepEqual(before.slides[0].content.data.definition, definition);
});
