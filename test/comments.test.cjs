const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const api = require('../src/index.cjs').comments;
const now = '2026-10-22T15:00:00.000Z';
const author = { sourceId: 'site', id: 'person1', label: 'Автор — «пример»' };
const other = { sourceId: 'site', id: 'person2', label: 'Участник' };
const opts = { author, now };
const context = api.createContext({ publicationId: randomUUID(), buildId: randomUUID(), slideId: 'stable-slide', label: 'Название',
  width: 1920, height: 1080, generatedAt: now, pngSha256: 'a'.repeat(64) });
const empty = () => api.empty({ sourceId: 'site', projectId: 'project', deckId: 'deck' }, now);
function create(doc = empty(), values = {}) {
  const operation = api.operation('create', { threadId: randomUUID(), messageId: randomUUID(), context, x: 0.2, y: 0.8, text: 'Уточнить источник', ...values });
  return { ...api.apply(doc, operation, opts), operation };
}
const error = code => thrown => { assert.equal(thrown.code, code, thrown.stack); return true; };

test('comments preserve exact context, normalized points, author and separate generation/message times', () => {
  const { document } = create();
  assert.deepEqual(api.parse(api.serialize(document)), document);
  assert.equal(document.threads[0].anchor.contextId, context.id);
  assert.equal(document.threads[0].messages[0].author.label, author.label);
  assert.deepEqual(empty().threads, []);
  const changed = { ...context, pngSha256: 'b'.repeat(64) };
  assert.throws(() => create(empty(), { context: changed }), error('COMMENTS_CONTEXT_CHANGED'));
  for (const x of [-0.01, 1.01, NaN]) assert.throws(() => create(empty(), { x }));
});

test('operation retries are idempotent and an operation ID cannot be reused for different text', () => {
  const { document, operation } = create();
  assert.deepEqual(api.apply(document, operation, opts).document, document);
  assert.equal(api.apply(document, operation, opts).repeated, true);
  assert.throws(() => api.apply(document, { ...operation, text: 'Подмена' }, opts), error('COMMENTS_OPERATION_REUSED'));
});

test('a display rename preserves image identity and does not block another thread or repeat import', () => {
  const first = create().document;
  const next = create(first, { context: { ...context, label: 'Переименованный слайд' } }).document;
  assert.equal(next.contexts.length, 1); assert.equal(next.threads.length, 2);
  assert.equal(next.contexts[0].label, context.label, 'the first captured label is retained');
  const renamed = structuredClone(next); renamed.contexts[0].label = 'Другое отображаемое имя';
  assert.equal(api.merge(next, renamed).document.contexts[0].label, context.label);
});

test('replies append independently, stale edits fail, only author or moderator edits', () => {
  const first = create(), thread = first.document.threads[0];
  const reply = api.operation('reply', { threadId: thread.id, messageId: randomUUID(), text: 'Ответ' });
  const second = api.apply(first.document, reply, { ...opts, author: other }).document;
  const edit = api.operation('edit', { threadId: thread.id, messageId: thread.messages[0].id, expectedRevision: 2, text: 'Правка' });
  assert.throws(() => api.apply(second, { ...edit, expectedRevision: 1 }, opts), error('COMMENTS_CONFLICT'));
  assert.throws(() => api.apply(second, edit, { ...opts, author: other }), error('COMMENTS_FORBIDDEN'));
  assert.equal(api.apply(second, edit, opts).document.threads[0].messages[0].text, 'Правка');
  assert.equal(api.apply(second, edit, { ...opts, author: other, canModerate: true }).document.threads[0].messages[0].text, 'Правка');
});

test('closing purges bodies and keeps only closure receipt; shared image released after last open thread', () => {
  const first = create(), second = create(first.document), a = first.document.threads[0];
  const close = api.operation('close', { threadId: a.id, expectedRevision: 1 });
  const oneLeft = api.apply(second.document, close, opts);
  assert.equal(oneLeft.document.threads.length, 1); assert.deepEqual(oneLeft.releasedImages, []);
  const b = oneLeft.document.threads[0], closed = api.apply(oneLeft.document, api.operation('close', { threadId: b.id, expectedRevision: b.revision }), opts);
  assert.equal(closed.document.threads.length, 0); assert.equal(closed.document.contexts.length, 0);
  assert.deepEqual(closed.releasedImages, [context.pngSha256]);
  assert.equal(api.serialize(closed.document).includes('Уточнить источник'), false);
  assert.deepEqual(Object.keys(closed.document.closed[0]).sort(), ['id', 'revision']);
  assert.equal(api.apply(oneLeft.document, close, opts).repeated, true);
  assert.throws(() => api.apply(closed.document, api.operation('reply', { threadId: a.id, messageId: randomUUID(), text: 'Поздний ответ' }), opts), error('COMMENTS_CLOSED'));
  assert.equal(api.merge(closed.document, second.document).document.threads.length, 0, 'old JSON never resurrects closed threads');
});

test('independent additions and replies merge; repeated import is stable', () => {
  const original = create().document, root = original.threads[0];
  const a = api.apply(original, api.operation('reply', { threadId: root.id, messageId: randomUUID(), text: 'Первый ответ' }), opts).document;
  const b = api.apply(original, api.operation('reply', { threadId: root.id, messageId: randomUUID(), text: 'Второй ответ' }), { ...opts, author: other }).document;
  const result = api.merge(a, b, { base: original });
  assert.equal(result.conflicts.length, 0); assert.equal(result.document.threads[0].messages.length, 3);
  assert.deepEqual(api.merge(result.document, b, { base: original }).document, result.document);
  const two = api.merge(create().document, create().document);
  assert.equal(two.document.threads.length, 2);
});

test('three-way edits merge only against a known base; conflicting variants stay reviewable', () => {
  const original = create().document, thread = original.threads[0];
  const edit = text => api.apply(original, api.operation('edit', { threadId: thread.id, messageId: thread.messages[0].id, expectedRevision: 1, text }), opts).document;
  const a = edit('Вариант А'), b = edit('Вариант Б');
  assert.equal(api.merge(a, original, { base: original }).document.threads[0].messages[0].text, 'Вариант А');
  assert.equal(api.merge(original, a, { base: original }).document.threads[0].messages[0].text, 'Вариант А');
  const result = api.merge(a, b, { base: original });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].incoming.messages[0].text, 'Вариант Б');
  assert.equal(result.document.threads[0].messages[0].text, 'Вариант А');
  assert.throws(() => api.merge(a, { ...b, deckId: 'another' }), error('COMMENTS_SCOPE_MISMATCH'));
});

test('strict contract rejects executable data, unsupported versions, extra fields and missing contexts', () => {
  const doc = create().document;
  assert.throws(() => api.validate({ ...doc, schemaVersion: 2 }), error('COMMENTS_VERSION'));
  assert.throws(() => api.validate({ ...doc, secret: 'not allowed' }), error('COMMENTS_INVALID'));
  assert.throws(() => api.validate({ ...doc, contexts: [] }), error('COMMENTS_CONTEXT_MISSING'));
  assert.throws(() => api.validate({ ...doc, callback: () => {} }));
  assert.throws(() => api.parse('{'), error('COMMENTS_INVALID_JSON'));
  assert.throws(() => api.validate({ ...doc, threads: [doc.threads[0], doc.threads[0]] }), error('COMMENTS_DUPLICATE_ID'));
});
