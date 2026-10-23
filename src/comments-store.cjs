const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const comments = require('./comments.cjs');
const bundle = require('./comments-bundle.cjs');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const maxDocument = 8 * 1024 * 1024;
function createStore({ root, maxImageBytes = 300 * 1024 * 1024 }) {
  if (!path.isAbsolute(root || '') || !Number.isSafeInteger(maxImageBytes) || maxImageBytes < 1 || maxImageBytes > 300 * 1024 * 1024) fail('COMMENTS_STORAGE_CONFIG');
  root = path.resolve(root);
  const stores = path.join(root, 'stores'), images = path.join(root, 'images');
  const scopeKey = scope => {
    comments.empty({ sourceId: 'scope-check', ...scope });
    return comments.hash(JSON.stringify([scope.projectId, scope.deckId]));
  };
  async function directory(dir, create = false) {
    if (create) await fs.mkdir(dir, { recursive: true });
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('COMMENTS_UNSAFE_PATH');
  }
  async function setup() { await directory(root, true); await directory(stores, true); await directory(images, true); }
  async function read(file, maximum) {
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('COMMENTS_UNSAFE_PATH');
      if (stat.size > maximum) fail('COMMENTS_STORAGE_BUDGET');
      const handle = await fs.open(file, 'r');
      try {
        const bytes = Buffer.alloc(stat.size + 1); let length = 0;
        while (length < bytes.length) { const result = await handle.read(bytes, length, bytes.length - length, length); if (!result.bytesRead) break; length += result.bytesRead; }
        if (length > stat.size) fail('COMMENTS_STORAGE_CONFLICT');
        return bytes.subarray(0, length);
      } finally { await handle.close(); }
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function atomic(file, bytes) {
    const temporary = path.join(path.dirname(file), '.tmp-' + randomUUID());
    let handle;
    try {
      handle = await fs.open(temporary, 'wx'); await handle.writeFile(bytes); await handle.sync();
      await handle.close(); handle = null; await fs.rename(temporary, file);
    } finally { await handle?.close(); await fs.rm(temporary, { force: true }); }
  }
  async function locked(action) {
    await setup(); let handle;
    const file = path.join(root, 'write.lock');
    try { handle = await fs.open(file, 'wx'); }
    catch (error) { if (error.code === 'EEXIST') fail('COMMENTS_STORAGE_BUSY'); throw error; }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid })); return await action(); }
    finally { await handle.close(); await fs.rm(file); }
  }
  async function load(scope) {
    const key = scopeKey(scope);
    try { await directory(root); await directory(stores); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const bytes = await read(path.join(stores, key + '.json'), maxDocument); if (!bytes) return null;
    const document = comments.parse(bytes);
    if (document.projectId !== scope.projectId || document.deckId !== scope.deckId) fail('COMMENTS_SCOPE_MISMATCH');
    return { document, token: comments.hash(bytes) };
  }
  async function liveImages() {
    const live = new Set();
    for (const name of await fs.readdir(stores)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const bytes = await read(path.join(stores, name), maxDocument);
      const document = comments.parse(bytes);
      document.contexts.forEach(context => live.add(context.pngSha256));
    }
    return live;
  }
  async function collectImages() {
    const live = await liveImages(); const removed = [];
    for (const name of await fs.readdir(images)) {
      if (!/^[a-f0-9]{64}\.png$/.test(name) || live.has(name.slice(0, -4))) continue;
      await read(path.join(images, name), 32 * 1024 * 1024);
      await fs.unlink(path.join(images, name)); removed.push(name.slice(0, -4));
    }
    return removed;
  }
  async function compareAndSwap(scope, input, expectedToken, incomingImages = new Map()) {
    const document = comments.validate(input), key = scopeKey(scope);
    if (document.projectId !== scope.projectId || document.deckId !== scope.deckId) fail('COMMENTS_SCOPE_MISMATCH');
    if (expectedToken !== null && !/^[a-f0-9]{64}$/.test(expectedToken || '')) fail('COMMENTS_STORAGE_TOKEN');
    return locked(async () => {
      const current = await load(scope);
      if ((current?.token || null) !== expectedToken) fail('COMMENTS_STORAGE_CONFLICT');
      await collectImages();
      let total = 0;
      for (const name of await fs.readdir(images)) {
        if (/^[a-f0-9]{64}\.png$/.test(name)) total += (await read(path.join(images, name), 32 * 1024 * 1024)).length;
      }
      const pending = [];
      for (const [sha, bytes] of incomingImages) {
        const contexts = document.contexts.filter(context => context.pngSha256 === sha);
        if (!contexts.length) fail('COMMENTS_UNUSED_IMAGE');
        contexts.forEach(context => bundle.verifyImage(bytes, context));
        const old = await read(path.join(images, sha + '.png'), 32 * 1024 * 1024);
        if (old) { contexts.forEach(context => bundle.verifyImage(old, context)); continue; }
        total += bytes.length; if (total > maxImageBytes) fail('COMMENTS_STORAGE_QUOTA'); pending.push([sha, bytes]);
      }
      for (const [sha, bytes] of pending) await atomic(path.join(images, sha + '.png'), bytes);
      const bytes = Buffer.from(comments.serialize(document));
      if (bytes.length > maxDocument) fail('COMMENTS_STORAGE_BUDGET');
      await atomic(path.join(stores, key + '.json'), bytes);
      // The document commit is authoritative. Cleanup failure must never invite a
      // blind retry of an already committed edit; a later write retries cleanup.
      let cleanupPending = false;
      try { await collectImages(); } catch { cleanupPending = true; }
      return { document, token: comments.hash(bytes), cleanupPending };
    });
  }
  async function readImage(sha) {
    if (!/^[a-f0-9]{64}$/.test(sha || '')) fail('COMMENTS_INVALID');
    try { await directory(root); await directory(images); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const bytes = await read(path.join(images, sha + '.png'), 32 * 1024 * 1024);
    if (bytes && comments.hash(bytes) !== sha) fail('COMMENTS_IMAGE_HASH'); return bytes;
  }
  return { load, compareAndSwap, readImage };
}
module.exports = { createStore };
