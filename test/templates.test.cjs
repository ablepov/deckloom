const test = require('node:test'), assert = require('node:assert/strict');
const { templates, presentation } = require('../src/index.cjs');
const library = () => ({ libraryVersion: 1, id: 'neutral', templates: [{ id: 'cover', revision: '1', definition: { layout: 'cover' }, defaults: { title: 'Заголовок', nested: { a: 1, b: 2 }, items: [1, 2] } }] });
const doc = () => ({ documentVersion: 1, projectId: 'p', id: 'd', width: 960, height: 540, slides: [] });
const ref = { libraryId: 'neutral', templateId: 'cover', revision: '1' };
test('F2 independent instances, shallow defaults, immutable catalog and pinned round trip', () => {
  const lib = library(), catalog = templates.createCatalog([lib]);
  lib.templates[0].defaults.title = 'changed';
  let d = catalog.instantiate(doc(), ref, 'a', { nested: { a: 5 }, items: null });
  d = catalog.instantiate(d, ref, 'b');
  assert.deepEqual(d.slides[0].content.data, { title: 'Заголовок', nested: { a: 5 }, items: null });
  d.slides[0].content.data.nested.a = 100;
  assert.equal(d.slides[1].content.data.nested.a, 1);
  const resolved = catalog.resolveDocument(presentation.deserialize(presentation.serialize(d)));
  assert.equal(resolved.slides[0].definition.layout, 'cover');
  resolved.slides[0].definition.layout = 'changed'; catalog.list()[0].templates[0].definition.layout = 'changed';
  assert.equal(catalog.resolve(ref).definition.layout, 'cover');
  assert.equal(catalog.resolveDocument(d).slides[0].data.title, 'Заголовок');
});
test('F2 detects definition/defaults/identity changes and never overwrites a pin', () => {
  const catalog = templates.createCatalog([library()]), pinned = catalog.instantiate(doc(), ref, 'a');
  for (const mutate of [l => { l.templates[0].definition.layout = 'other'; }, l => { l.templates[0].defaults.title = 'other'; }]) {
    const lib = library(); mutate(lib); const replacement = templates.createCatalog([lib]);
    assert.throws(() => replacement.resolveDocument(pinned), { code: 'TEMPLATE_INTEGRITY_MISMATCH' });
    assert.throws(() => replacement.pinReferences(pinned), { code: 'TEMPLATE_INTEGRITY_MISMATCH' });
  }
  const legacy = structuredClone(pinned); delete legacy.slides[0].content.ref.integrity;
  assert.throws(() => catalog.resolveDocument(legacy), { code: 'UNPINNED_TEMPLATE_REFERENCE' });
  assert.deepEqual(catalog.pinReferences(legacy), pinned);
  const reordered = library(); reordered.templates[0].definition = { z: 2, a: 1 };
  const again = library(); again.templates[0].definition = { a: 1, z: 2 };
  assert.equal(templates.createCatalog([reordered]).resolve(ref).integrity, templates.createCatalog([again]).resolve(ref).integrity);
  const aliased = library(); aliased.id = 'another';
  assert.throws(() => templates.createCatalog([aliased]).resolve({ ...ref, libraryId: 'another', integrity: pinned.slides[0].content.ref.integrity }), { code: 'TEMPLATE_INTEGRITY_MISMATCH' });
});
test('F2 local definitions require pins, preserve exact revisions and reject mutations', () => {
  const catalog = templates.createCatalog([]), d = doc();
  d.compositions = [{ id: 'cards', revision: '1', definition: { layout: 'cards' } }];
  d.slides.push({ id: 'a', content: { kind: 'local', ref: { compositionId: 'cards', revision: '1' }, data: {} } });
  const pinned = catalog.pinReferences(d);
  assert.equal(catalog.resolveDocument(pinned).slides[0].definition.layout, 'cards');
  pinned.compositions[0].definition.layout = 'other';
  assert.throws(() => catalog.resolveDocument(pinned), { code: 'TEMPLATE_INTEGRITY_MISMATCH' });
  assert(!d.slides[0].content.ref.integrity);
});
test('F2 invalid libraries/references and aggregate failure leave inputs intact', () => {
  const catalog = templates.createCatalog([library()]);
  for (const bad of [{ ...ref, revision: '2' }, { ...ref, templateId: 'Cover' }]) assert.throws(() => catalog.resolve(bad), { code: 'UNKNOWN_TEMPLATE_REVISION' });
  for (const mutate of [l => { l.libraryVersion = 2; }, l => { l.templates.push(structuredClone(l.templates[0])); }, l => { l.templates[0].defaults.callback = () => 1; }]) {
    const lib = library(); mutate(lib); assert.throws(() => templates.createCatalog([lib]));
  }
  const d = catalog.instantiate(doc(), ref, 'a'), before = structuredClone(d);
  assert.throws(() => catalog.instantiate(d, ref, 'A'), { code: 'DUPLICATE_DOCUMENT_ID' });
  assert.deepEqual(d, before);
  d.slides[0].content.ref.integrity = ['a'.repeat(64)]; assert.throws(() => presentation.normalize(d), { code: 'INVALID_DOCUMENT_REFERENCE' });
});
