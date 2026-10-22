const test = require('node:test');
const assert = require('node:assert/strict');
const { presentation: api } = require('../src/index.cjs');
const fixture = require('../examples/presentation-document.cjs');
const fresh = () => structuredClone(fixture);
const error = (code, field) => thrown => {
  assert.equal(thrown.code, code, thrown.stack);
  if (field) assert.equal(thrown.field, field, thrown.stack);
  return true;
};

test('presentation JSON round trip preserves all content variants, pinned references, scoped IDs and inherited dimensions', () => {
  const doc = fresh(), before = structuredClone(doc);
  const saved = api.serialize(doc), loaded = api.deserialize(saved);
  assert.deepEqual(loaded, before);
  assert.deepEqual(doc, before);
  assert.deepEqual(loaded.slides.map(s => s.id), ['cover', 'cards', 'notes']);
  assert.deepEqual(loaded.slides.map(s => s.content.kind), ['template', 'local', 'authored']);
  assert(!Object.hasOwn(loaded.slides[1], 'name'));
  assert(!Object.hasOwn(loaded.slides[1], 'width'));
  assert(!Object.hasOwn(loaded.slides[1], 'height'));
  assert(!Object.hasOwn(loaded.slides[0], 'index'));
  assert.deepEqual(loaded.slides[1].content.ref, { compositionId: 'two-cards', revision: '1' });
  loaded.slides[1].content.data.left.title = 'Правка — ёжик';
  assert.equal(doc.slides[1].content.data.left.title, 'Первая карточка');
  loaded.width = 1280;
  assert(!Object.hasOwn(api.deserialize(api.serialize(loaded)).slides[1], 'width'));
  const elsewhere = fresh(); elsewhere.projectId = 'another-project'; elsewhere.id = 'another-deck';
  assert.equal(api.normalize(elsewhere).slides[0].id, doc.slides[0].id, 'slide IDs are scoped, not globally rewritten');
  const reordered = fresh(); reordered.slides.reverse();
  assert.deepEqual(api.deserialize(api.serialize(reordered)).slides.map(s => s.id), ['notes', 'cards', 'cover']);
  const draft = { documentVersion: 1, projectId: 'p', id: 'draft', width: 960, height: 540, slides: [] };
  assert.deepEqual(api.deserialize('\uFEFF' + api.serialize(draft)), draft);
  assert(Object.isFrozen(api) && Object.isFrozen(api.limits));
});

test('rename and duplicate preserve document/source identity and pinned revisions while isolating slide data', () => {
  for (const sourceId of ['cover', 'cards', 'notes']) {
    const doc = fresh(), before = structuredClone(doc), newId = sourceId + '-copy';
    const renamed = api.renameSlide(doc, sourceId, 'Новое имя «ёжик»');
    assert.equal(renamed.slides.find(s => s.id === sourceId).name, 'Новое имя «ёжик»');
    assert.deepEqual(renamed.slides.map(s => s.id), before.slides.map(s => s.id));
    const copied = api.duplicateSlide(doc, sourceId, newId), sourceIndex = doc.slides.findIndex(s => s.id === sourceId);
    assert.deepEqual(copied.slides.map(s => s.id), [...doc.slides.slice(0, sourceIndex + 1).map(s => s.id), newId, ...doc.slides.slice(sourceIndex + 1).map(s => s.id)]);
    const original = copied.slides[sourceIndex], duplicate = copied.slides[sourceIndex + 1];
    assert.deepEqual({ ...duplicate, id: sourceId }, original);
    duplicate.content.data.added = { value: true };
    assert(!Object.hasOwn(original.content.data, 'added'));
    assert.deepEqual(copied.compositions, doc.compositions, 'duplicate does not fork shared composition definitions');
    assert.equal(copied.projectId, doc.projectId); assert.equal(copied.id, doc.id);
    assert.deepEqual(doc, before);
    assert.deepEqual(api.deserialize(api.serialize(copied)), copied);
  }
  assert.throws(() => api.duplicateSlide(fresh(), 'cover', 'COVER'), error('DUPLICATE_DOCUMENT_ID', 'newId'));
  assert.throws(() => api.renameSlide(fresh(), 'Cover', 'x'), error('DOCUMENT_SLIDE_NOT_FOUND', 'slideId'));
  assert.throws(() => api.renameSlide(fresh(), 'cover', ''), error('INVALID_DOCUMENT', 'name'));
  assert.throws(() => api.duplicateSlide(fresh(), 'cover', '../x'), error('INVALID_DOCUMENT_ID', 'newId'));
});

test('closed document schema rejects unknown versions, fields and conflicting identity without changing inputs', () => {
  const cases = [
    [d => { d.documentVersion = 2; }, 'UNSUPPORTED_DOCUMENT_VERSION', 'document.documentVersion'],
    [d => { delete d.documentVersion; }, 'UNSUPPORTED_DOCUMENT_VERSION', 'document.documentVersion'],
    [d => { d.contractVersion = 1; }, 'UNKNOWN_DOCUMENT_FIELD', 'document["contractVersion"]'],
    [d => { d.projectId = '../project'; }, 'INVALID_DOCUMENT_ID', 'document.projectId'],
    [d => { d.id = ''; }, 'INVALID_DOCUMENT_ID', 'document.id'],
    [d => { d.width = 0; }, 'INVALID_DOCUMENT', 'document.width'],
    [d => { d.slides[0].height = 0.5; }, 'INVALID_DOCUMENT', 'document.slides[0].height'],
    [d => { delete d.slides; }, 'INVALID_DOCUMENT', 'document.slides'],
    [d => { d.slides[1].id = 'COVER'; }, 'DUPLICATE_DOCUMENT_ID', 'document.slides[1].id'],
    [d => { d.slides[0].index = 0; }, 'UNKNOWN_DOCUMENT_FIELD', 'document.slides[0]["index"]'],
    [d => { d.slides[0].content.kind = 'html'; }, 'INVALID_DOCUMENT_CONTENT', 'document.slides[0].content.kind'],
    [d => { d.slides[0].content.data = []; }, 'INVALID_DOCUMENT', 'document.slides[0].content.data'],
    [d => { d.slides[2].content.ref = {}; }, 'INVALID_DOCUMENT_REFERENCE', 'document.slides[2].content.ref'],
  ];
  for (const [mutate, code, field] of cases) {
    const doc = fresh(); mutate(doc);
    const before = structuredClone(doc);
    for (const action of [api.normalize, api.serialize, d => api.deserialize(JSON.stringify(d))]) assert.throws(() => action(doc), error(code, field));
    assert.deepEqual(doc, before);
  }
  for (const json of ['', '{', 'null', '[]']) assert.throws(() => api.deserialize(json));
  assert.throws(() => api.deserialize({}), error('INVALID_DOCUMENT_JSON', 'json'));
});

test('local composition references resolve exact ID/revision; external template availability is left to F2', () => {
  const bad = [
    d => { d.slides[1].content.ref.revision = 'latest'; },
    d => { d.slides[1].content.ref.compositionId = 'Two-Cards'; },
    d => { d.slides[1].content.ref.compositionId = 'missing'; },
    d => { delete d.compositions; },
  ];
  for (const mutate of bad) { const d = fresh(); mutate(d); assert.throws(() => api.serialize(d), error('UNKNOWN_DOCUMENT_COMPOSITION', 'document.slides[1].content.ref')); }
  const duplicate = fresh(); duplicate.compositions.push(structuredClone(duplicate.compositions[0]));
  assert.throws(() => api.normalize(duplicate), error('DUPLICATE_DOCUMENT_COMPOSITION'));
  const alias = fresh(); alias.compositions[1].id = 'Two-Cards';
  assert.throws(() => api.normalize(alias), error('DOCUMENT_COMPOSITION_ID_CASE'));
  const pinned = fresh(); pinned.slides[1].content.ref.revision = '2';
  assert.equal(api.deserialize(api.serialize(pinned)).slides[1].content.ref.revision, '2');
  const external = fresh(); external.slides[0].content.ref.revision = 'not-installed';
  assert.equal(api.normalize(external).slides[0].content.ref.revision, 'not-installed');
  const invalidRevision = fresh(); invalidRevision.slides[0].content.ref.revision = 1;
  assert.throws(() => api.normalize(invalidRevision), error('INVALID_DOCUMENT'));
});

test('JSON validation rejects lossy values, cycles and descriptors without invoking getters or toJSON', () => {
  for (const value of [undefined, () => 1, Symbol('x'), BigInt(1), NaN, Infinity, -Infinity, -0, new Date(), new Map(), /x/, new (class Value {})()]) {
    const doc = fresh(); doc.slides[0].content.data.bad = value;
    assert.throws(() => api.normalize(doc), error('DOCUMENT_NON_JSON_VALUE'));
    assert.throws(() => api.serialize(doc), error('DOCUMENT_NON_JSON_VALUE'));
  }
  for (const values of [new Array(1), Object.assign([], { extra: 'x' })]) {
    const d = fresh(); d.slides[0].content.data.bad = values;
    assert.throws(() => api.serialize(d), error('DOCUMENT_NON_JSON_VALUE'));
  }
  const cyclic = fresh(); cyclic.slides[0].content.data.self = cyclic;
  assert.throws(() => api.serialize(cyclic), error('DOCUMENT_NON_JSON_VALUE'));
  let calls = 0;
  for (const accessor of [true, false]) {
    const d = fresh();
    Object.defineProperty(d.slides[0].content.data, 'unsafe', accessor ? { enumerable: true, get() { calls++; return 'x'; } } : { enumerable: false, value: 'x' });
    assert.throws(() => api.serialize(d), error('DOCUMENT_NON_JSON_VALUE'));
  }
  const transformed = fresh(); transformed.slides[0].content.data.toJSON = () => { calls++; return {}; };
  assert.throws(() => api.serialize(transformed), error('DOCUMENT_NON_JSON_VALUE'));
  assert.equal(calls, 0);
  const symbol = fresh(); symbol.slides[0].content.data[Symbol('hidden')] = 'x';
  assert.throws(() => api.normalize(symbol), error('DOCUMENT_NON_JSON_VALUE'));
  const negativeZero = api.serialize(fresh()).replace('"width":960', '"width":-0');
  assert.throws(() => api.deserialize(negativeZero), error('DOCUMENT_NON_JSON_VALUE'));
});

test('plain JSON payloads preserve special own keys and values without prototype pollution or shared-object identity claims', () => {
  const doc = fresh();
  const payload = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"name":"safe"},"toJSON":"literal","nested":[null,true,1.25,"ё — «кавычки»"]}');
  doc.slides[0].content.data = payload;
  const restored = api.deserialize(api.serialize(doc));
  assert.deepEqual(restored.slides[0].content.data, payload);
  assert.equal({}.polluted, undefined);
  const shared = { title: 'shared' }; const d = fresh(); d.slides[0].content.data = { a: shared, b: shared };
  const loaded = api.deserialize(api.serialize(d));
  assert.deepEqual(loaded.slides[0].content.data.a, loaded.slides[0].content.data.b);
  assert.notEqual(loaded.slides[0].content.data.a, loaded.slides[0].content.data.b);
});

test('document parser and graph traversal enforce bounded size/depth/item counts', () => {
  assert.throws(() => api.deserialize(' '.repeat(api.limits.maxBytes + 1)), error('DOCUMENT_BUDGET_EXCEEDED', 'json'));
  const deep = fresh(); let node = deep.slides[0].content.data;
  for (let i = 0; i <= api.limits.maxDepth; i++) node = node.child = {};
  assert.throws(() => api.normalize(deep), error('DOCUMENT_BUDGET_EXCEEDED'));
  const nodes = fresh(); nodes.slides[0].content.data.items = Array(api.limits.maxNodes).fill(null);
  assert.throws(() => api.normalize(nodes), error('DOCUMENT_BUDGET_EXCEEDED'));
  const huge = fresh(); huge.slides[0].content.data.text = 'ё'.repeat(api.limits.maxBytes / 2);
  assert.throws(() => api.serialize(huge), error('DOCUMENT_BUDGET_EXCEEDED'));
  const many = fresh(); many.slides = Array.from({ length: api.limits.maxSlides + 1 }, (_, i) => ({ id: 's-' + i, content: { kind: 'authored', data: {} } }));
  assert.throws(() => api.normalize(many), error('DOCUMENT_BUDGET_EXCEEDED', 'document.slides'));
});
