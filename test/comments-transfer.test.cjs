const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const comments = require('../src/index.cjs').comments;
const { JSZip } = require('../src/vendor/pptx/backend.cjs');
const now = '2026-10-22T15:00:00.000Z', scope = { projectId: 'project', deckId: 'deck' };
const author = { sourceId: 'site', id: 'author', label: 'Автор' };
function crc(bytes) { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; } return (n ^ 0xffffffff) >>> 0; }
function png() {
  const chunk = (name, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(name, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b; };
  const h = Buffer.alloc(13); h.writeUInt32BE(2); h.writeUInt32BE(1, 4); h[8] = 8; h[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', h), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
function fixture() {
  const image = png(), sha = comments.hash(image);
  const context = comments.createContext({ publicationId: randomUUID(), buildId: randomUUID(), slideId: 'stable', label: 'Слайд', width: 2, height: 1, generatedAt: now, pngSha256: sha });
  const document = comments.apply(comments.empty({ sourceId: 'monq', ...scope }, now), comments.operation('create', {
    threadId: randomUUID(), messageId: randomUUID(), context, x: 0, y: 1, text: 'Контекст — сохранён' }), { author, now }).document;
  return { document, image, sha, images: new Map([[sha, image]]) };
}
const error = code => e => { assert.equal(e.code, code, e.stack); return true; };
async function removeFixture(root) {
  assert.equal(path.dirname(root), os.tmpdir());
  // Windows can briefly retain a removed directory entry after the last close.
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
}

test('portable ZIP carries only declared PNG and JSON, survives offline round trip and recompression', async () => {
  const f = fixture(), bytes = await comments.exportBundle(f.document, async sha => f.images.get(sha));
  const loaded = comments.importBundle(bytes);
  assert.deepEqual(loaded.document, f.document); assert.deepEqual(loaded.images.get(f.sha), f.image);
  const zip = await JSZip.loadAsync(bytes);
  const compressed = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  assert.deepEqual(comments.importBundle(compressed).document, f.document);
});

test('ZIP rejects changed images, missing context, traversal, CRC and dimensions', async () => {
  const f = fixture();
  await assert.rejects(comments.exportBundle(f.document, async () => null), error('COMMENTS_IMAGE_MISSING'));
  const changed = Buffer.from(f.image); changed[changed.length - 1] ^= 1;
  await assert.rejects(comments.exportBundle(f.document, async () => changed), error('COMMENTS_IMAGE_HASH'));
  const zip = new JSZip(); zip.file('comments.json', comments.serialize(f.document));
  const missing = await zip.generateAsync({ type: 'nodebuffer' });
  assert.throws(() => comments.importBundle(missing), error('COMMENTS_IMAGE_MISSING'));
  zip.file('../escape.png', f.image, { createFolders: false });
  assert.throws(() => comments.importBundle(Buffer.from('bad')), error('COMMENTS_BUNDLE_BUDGET'));
  const traversal = await zip.generateAsync({ type: 'nodebuffer' });
  assert.throws(() => comments.importBundle(traversal), error('COMMENTS_UNSAFE_ZIP'));
  const bytes = await comments.exportBundle(f.document, async () => f.image), corrupt = Buffer.from(bytes);
  corrupt[50] ^= 1;
  assert.throws(() => comments.importBundle(corrupt), error('COMMENTS_ZIP_CRC'));
  const badContext = comments.createContext({ ...f.document.contexts[0], width: 3 });
  const bad = structuredClone(f.document); bad.contexts[0] = badContext; bad.threads[0].anchor.contextId = badContext.id;
  await assert.rejects(comments.exportBundle(bad, async () => f.image), error('COMMENTS_IMAGE_SIZE'));
});

test('file CAS survives a new store instance; conflicting writes cannot lose a concurrent reply', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-comments-')); t.after(() => removeFixture(root));
  const a = comments.createStore({ root }), b = comments.createStore({ root }), f = fixture();
  const first = await a.compareAndSwap(scope, f.document, null, f.images);
  assert.deepEqual((await b.load(scope)).document, f.document);
  const reply = text => comments.apply(first.document, comments.operation('reply', { threadId: f.document.threads[0].id, messageId: randomUUID(), text }), { author, now }).document;
  const results = await Promise.allSettled([a.compareAndSwap(scope, reply('А'), first.token), b.compareAndSwap(scope, reply('Б'), first.token)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert(['COMMENTS_STORAGE_BUSY', 'COMMENTS_STORAGE_CONFLICT'].includes(results.find(r => r.status === 'rejected').reason.code));
  const current = await a.load(scope); assert.equal(current.document.threads[0].messages.length, 2);
  await assert.rejects(b.compareAndSwap(scope, f.document, first.token), error('COMMENTS_STORAGE_CONFLICT'));
  assert.deepEqual(await b.readImage(f.sha), f.image);
});

test('closing removes stored text and unreferenced image; another scope still pins the same PNG', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-comments-')); t.after(() => removeFixture(root));
  const store = comments.createStore({ root }), f = fixture(), secondScope = { ...scope, deckId: 'another' };
  const saved = await store.compareAndSwap(scope, f.document, null, f.images);
  const second = { ...f.document, ...secondScope }; const other = await store.compareAndSwap(secondScope, second, null, f.images);
  const close = document => comments.apply(document, comments.operation('close', { threadId: document.threads[0].id, expectedRevision: 1 }), { author, now }).document;
  await store.compareAndSwap(scope, close(saved.document), saved.token);
  assert.deepEqual(await store.readImage(f.sha), f.image);
  await store.compareAndSwap(secondScope, close(other.document), other.token);
  assert.equal(await store.readImage(f.sha), null);
  assert.equal(JSON.stringify((await store.load(scope)).document).includes('Контекст'), false);
});

test('quota failure leaves no partial document/image; unsafe scope is rejected', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-comments-')); t.after(() => removeFixture(root));
  const f = fixture(), store = comments.createStore({ root, maxImageBytes: 1 });
  await assert.rejects(store.compareAndSwap(scope, f.document, null, f.images), error('COMMENTS_STORAGE_QUOTA'));
  assert.equal(await store.load(scope), null); assert.equal(await store.readImage(f.sha), null);
  await assert.rejects(store.load({ projectId: '../escape', deckId: 'deck' }));
  const bytes = await comments.exportBundle(f.document, async () => f.image);
  assert.equal(comments.importBundle(bytes).images.size, 1);
});
