// Portable point discussions. Storage, permissions and trusted actors belong to hosts.
const { createHash, randomUUID } = require('node:crypto');
const { cloneJson } = require('./json-data.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const identifier = /^[A-Za-z0-9_-]{1,128}$/;
function fail(code, message = code) { throw Object.assign(new Error(message), { code }); }
function assert(value, code = 'COMMENTS_INVALID') { if (!value) fail(code); }
function record(value, keys) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert(Object.keys(value).every(key => keys.includes(key)));
}
function text(value, max = 10000) { assert(typeof value === 'string' && value.trim() && value.length <= max && !value.includes('\0')); }
function id(value) { assert(typeof value === 'string' && identifier.test(value)); }
function uid(value) { assert(typeof value === 'string' && uuid.test(value)); }
function sha(value) { assert(typeof value === 'string' && digest.test(value)); }
function time(value) { assert(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value); }
function revision(value) { assert(Number.isSafeInteger(value) && value >= 1); }
function unique(values) { assert(new Set(values).size === values.length, 'COMMENTS_DUPLICATE_ID'); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function actor(value) {
  record(value, ['sourceId', 'id', 'label']); id(value.sourceId); id(value.id); text(value.label, 200);
}
function contextIdentity(context) {
  return hash(canonical(['context-v1', context.publicationId, context.buildId, context.slideId, context.width, context.height, context.generatedAt, context.pngSha256]));
}
function createContext(input) {
  const result = cloneJson(input, 'context');
  result.id = contextIdentity(result); validateContext(result); return result;
}
function validateContext(context) {
  record(context, ['id', 'publicationId', 'buildId', 'slideId', 'label', 'width', 'height', 'generatedAt', 'pngSha256']);
  sha(context.id); uid(context.publicationId); uid(context.buildId); id(context.slideId); text(context.label, 500);
  assert(Number.isSafeInteger(context.width) && context.width > 0 && context.width <= 16384);
  assert(Number.isSafeInteger(context.height) && context.height > 0 && context.height <= 16384);
  time(context.generatedAt); sha(context.pngSha256);
  assert(context.id === contextIdentity(context), 'COMMENTS_CONTEXT_CHANGED');
}
function validate(input) {
  const doc = cloneJson(input, 'comments');
  record(doc, ['format', 'schemaVersion', 'sourceId', 'projectId', 'deckId', 'exportedAt', 'contexts', 'threads', 'closed', 'receipts']);
  assert(doc.format === 'deckloom.comments' && doc.schemaVersion === 1, 'COMMENTS_VERSION');
  id(doc.sourceId); id(doc.projectId); id(doc.deckId); time(doc.exportedAt);
  for (const key of ['contexts', 'threads', 'closed', 'receipts']) assert(Array.isArray(doc[key]));
  assert(doc.contexts.length <= 2000 && doc.threads.length <= 5000 && doc.closed.length <= 50000 && doc.receipts.length <= 50000, 'COMMENTS_BUDGET');
  doc.contexts.forEach(validateContext); unique(doc.contexts.map(context => context.id));
  const contextIds = new Set(doc.contexts.map(context => context.id)), used = new Set(), messageIds = [];
  for (const thread of doc.threads) {
    record(thread, ['id', 'revision', 'status', 'anchor', 'messages', 'createdAt', 'updatedAt']);
    uid(thread.id); revision(thread.revision); assert(thread.status === 'open');
    time(thread.createdAt); time(thread.updatedAt); assert(thread.updatedAt >= thread.createdAt);
    record(thread.anchor, ['contextId', 'x', 'y']); sha(thread.anchor.contextId);
    assert(contextIds.has(thread.anchor.contextId), 'COMMENTS_CONTEXT_MISSING'); used.add(thread.anchor.contextId);
    for (const key of ['x', 'y']) assert(Number.isFinite(thread.anchor[key]) && thread.anchor[key] >= 0 && thread.anchor[key] <= 1);
    assert(Array.isArray(thread.messages) && thread.messages.length > 0 && thread.messages.length <= 1000);
    for (const message of thread.messages) {
      record(message, ['id', 'author', 'text', 'createdAt', 'updatedAt']);
      uid(message.id); actor(message.author); text(message.text); time(message.createdAt); time(message.updatedAt);
      assert(message.updatedAt >= message.createdAt); messageIds.push(message.id);
    }
  }
  unique(doc.threads.map(thread => thread.id)); unique(messageIds);
  for (const entry of doc.closed) { record(entry, ['id', 'revision']); uid(entry.id); revision(entry.revision); }
  unique(doc.closed.map(entry => entry.id));
  const closedIds = new Set(doc.closed.map(entry => entry.id));
  assert(doc.threads.every(thread => !closedIds.has(thread.id)), 'COMMENTS_CLOSED');
  assert(doc.contexts.every(context => used.has(context.id)), 'COMMENTS_UNUSED_CONTEXT');
  for (const receipt of doc.receipts) { record(receipt, ['operationId', 'requestHash']); uid(receipt.operationId); sha(receipt.requestHash); }
  unique(doc.receipts.map(receipt => receipt.operationId));
  return doc;
}
function empty({ sourceId, projectId, deckId }, now = new Date().toISOString()) {
  return validate({ format: 'deckloom.comments', schemaVersion: 1, sourceId, projectId, deckId, exportedAt: now, contexts: [], threads: [], closed: [], receipts: [] });
}
function parse(bytes) {
  assert(typeof bytes === 'string' || Buffer.isBuffer(bytes), 'COMMENTS_INVALID');
  assert(Buffer.byteLength(bytes) <= 8 * 1024 * 1024, 'COMMENTS_BUDGET');
  let value; try { value = JSON.parse(bytes.toString()); } catch { fail('COMMENTS_INVALID_JSON'); }
  return validate(value);
}
function serialize(input) { return JSON.stringify(validate(input), null, 2) + '\n'; }
function collect(doc) {
  const used = new Set(doc.threads.map(thread => thread.anchor.contextId));
  doc.contexts = doc.contexts.filter(context => used.has(context.id));
}
function apply(input, operation, { author, canModerate = false, now = new Date().toISOString() } = {}) {
  const doc = validate(input), op = cloneJson(operation, 'operation'); actor(author); time(now);
  uid(op.operationId); uid(op.threadId); text(op.kind, 20);
  const requestHash = hash(canonical({ operation: op, author, canModerate }));
  const previous = doc.receipts.find(receipt => receipt.operationId === op.operationId);
  if (previous) { assert(previous.requestHash === requestHash, 'COMMENTS_OPERATION_REUSED'); return { document: doc, repeated: true, releasedImages: [] }; }
  const thread = doc.threads.find(thread => thread.id === op.threadId);
  const closed = doc.closed.find(entry => entry.id === op.threadId);
  assert(!closed, 'COMMENTS_CLOSED');
  const beforeImages = new Set(doc.contexts.map(context => context.pngSha256));
  if (op.kind === 'create') {
    record(op, ['kind', 'operationId', 'threadId', 'messageId', 'context', 'x', 'y', 'text']);
    assert(!thread, 'COMMENTS_DUPLICATE_ID'); uid(op.messageId); text(op.text); validateContext(op.context);
    const existing = doc.contexts.find(context => context.id === op.context.id);
    // A display rename is not a new image. Keep the first captured label;
    // validateContext has already pinned every identity-bearing field to id.
    if (!existing) doc.contexts.push(op.context);
    doc.threads.push({ id: op.threadId, revision: 1, status: 'open', anchor: { contextId: op.context.id, x: op.x, y: op.y },
      messages: [{ id: op.messageId, author, text: op.text, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now });
  } else {
    assert(thread, 'COMMENTS_NOT_FOUND');
    if (op.kind === 'reply') {
      record(op, ['kind', 'operationId', 'threadId', 'messageId', 'text']); uid(op.messageId); text(op.text);
      thread.messages.push({ id: op.messageId, author, text: op.text, createdAt: now, updatedAt: now });
    } else {
      revision(op.expectedRevision); assert(thread.revision === op.expectedRevision, 'COMMENTS_CONFLICT');
      if (op.kind === 'edit') {
        record(op, ['kind', 'operationId', 'threadId', 'messageId', 'expectedRevision', 'text']); uid(op.messageId); text(op.text);
        const message = thread.messages.find(message => message.id === op.messageId); assert(message, 'COMMENTS_NOT_FOUND');
        assert(canModerate || message.author.sourceId === author.sourceId && message.author.id === author.id, 'COMMENTS_FORBIDDEN');
        message.text = op.text; message.updatedAt = now;
      } else if (op.kind === 'close') {
        record(op, ['kind', 'operationId', 'threadId', 'expectedRevision']);
        doc.threads = doc.threads.filter(entry => entry.id !== thread.id);
        doc.closed.push({ id: thread.id, revision: thread.revision + 1 });
      } else fail('COMMENTS_INVALID_OPERATION');
    }
    thread.revision++; thread.updatedAt = now;
  }
  doc.receipts.push({ operationId: op.operationId, requestHash }); doc.exportedAt = now; collect(doc);
  const remaining = new Set(doc.contexts.map(context => context.pngSha256));
  return { document: validate(doc), repeated: false, releasedImages: [...beforeImages].filter(sha => !remaining.has(sha)) };
}
// Three-way merge: a snapshot is evidence of state, never permission for last-write-wins.
function merge(input, incoming, { base } = {}) {
  const local = validate(input), remote = validate(incoming), original = base ? validate(base) : null;
  assert(local.sourceId === remote.sourceId && local.projectId === remote.projectId && local.deckId === remote.deckId, 'COMMENTS_SCOPE_MISMATCH');
  if (original) assert(original.sourceId === local.sourceId && original.projectId === local.projectId && original.deckId === local.deckId, 'COMMENTS_SCOPE_MISMATCH');
  const result = cloneJson(local), conflicts = [], closed = new Map(local.closed.map(entry => [entry.id, entry]));
  for (const entry of remote.closed) { const old = closed.get(entry.id); if (!old || old.revision < entry.revision) closed.set(entry.id, entry); }
  result.closed = [...closed.values()];
  const threads = new Map(local.threads.filter(thread => !closed.has(thread.id)).map(thread => [thread.id, thread]));
  for (const next of remote.threads) {
    if (closed.has(next.id)) continue;
    const current = threads.get(next.id), before = original?.threads.find(thread => thread.id === next.id);
    if (!current || canonical(current) === canonical(next)) { threads.set(next.id, next); continue; }
    if (before && canonical(current) === canonical(before)) { threads.set(next.id, next); continue; }
    if (before && canonical(next) === canonical(before)) continue;
    // Concurrent replies can be combined, but edited/deleted messages require a known base.
    if (canonical(current.anchor) !== canonical(next.anchor) || current.createdAt !== next.createdAt || current.messages[0].id !== next.messages[0].id) { conflicts.push({ threadId: next.id, local: current, incoming: next }); continue; }
    const messages = new Map(current.messages.map(message => [message.id, message]));
    let conflict = false;
    for (const message of next.messages) {
      const old = messages.get(message.id), initial = before?.messages.find(item => item.id === message.id);
      if (!old || canonical(old) === canonical(message)) messages.set(message.id, message);
      else if (initial && canonical(old) === canonical(initial)) messages.set(message.id, message);
      else if (!(initial && canonical(message) === canonical(initial))) conflict = true;
    }
    if (conflict) { conflicts.push({ threadId: next.id, local: current, incoming: next }); continue; }
    const rootId = current.messages[0].id;
    const mergedMessages = [...messages.values()].sort((a, b) => a.id === rootId ? -1 : b.id === rootId ? 1 : a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    if (canonical(mergedMessages) === canonical(current.messages)) continue;
    threads.set(next.id, { ...current, revision: Math.max(current.revision, next.revision) + 1,
      updatedAt: current.updatedAt > next.updatedAt ? current.updatedAt : next.updatedAt,
      messages: mergedMessages });
  }
  result.threads = [...threads.values()];
  const contexts = new Map(local.contexts.map(context => [context.id, context]));
  for (const context of remote.contexts) if (!contexts.has(context.id)) contexts.set(context.id, context);
  result.contexts = [...contexts.values()]; collect(result);
  const receipts = new Map(local.receipts.map(receipt => [receipt.operationId, receipt]));
  for (const receipt of remote.receipts) { const old = receipts.get(receipt.operationId); assert(!old || old.requestHash === receipt.requestHash, 'COMMENTS_OPERATION_REUSED'); receipts.set(receipt.operationId, receipt); }
  result.receipts = [...receipts.values()]; result.exportedAt = [local.exportedAt, remote.exportedAt].sort().at(-1);
  return { document: validate(result), conflicts };
}
function operation(kind, values) { return { kind, operationId: randomUUID(), ...values }; }
module.exports = { empty, validate, parse, serialize, createContext, apply, merge, operation, hash,
  exportBundle: (...args) => require('./comments-bundle.cjs').encode(...args),
  importBundle: (...args) => require('./comments-bundle.cjs').decode(...args),
  createStore: (...args) => require('./comments-store.cjs').createStore(...args) };
