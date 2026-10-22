const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const presentation = require('./document.cjs');
const compositions = require('./compositions.cjs');
const MAX_BYTES = presentation.limits.maxBytes + 2048;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fail(code, message, extra = {}) { throw Object.assign(new Error(`${code}: ${message}`), { code, ...extra }); }
function check(signal) { if (signal?.aborted) fail('CANCELLED', 'Storage operation cancelled before commit'); }
function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)) fail('INVALID_STORAGE_ID', 'Unsafe storage ID');
  return value;
}
function token(value) { if (value !== null && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) fail('INVALID_STORAGE_TOKEN', 'Expected null for create or SHA-256 token for overwrite'); }
function createStore({ root, catalog }) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('INVALID_STORAGE_ROOT', 'An absolute storage root is required');
  root = path.resolve(root);
  const validate = input => compositions.validateDocument(input, catalog).document;
  const folder = (project, doc) => path.join(root, id(project).toLowerCase(), id(doc).toLowerCase());
  async function safe(target, make = false) {
    const relative = path.relative(root, path.resolve(target));
    if (relative.startsWith('..') || path.isAbsolute(relative)) fail('UNSAFE_STORAGE_PATH', 'Path escaped root');
    if (make) await fs.mkdir(root, { recursive: true });
    let current = root;
    for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
      if (part) { current = path.join(current, part); if (make) await fs.mkdir(current).catch(e => { if (e.code !== 'EEXIST') throw e; }); }
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_STORAGE_PATH', 'Managed directories must be real directories');
    }
    return target;
  }
  async function read(file) {
    let handle;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('UNSAFE_STORAGE_PATH', 'Managed files cannot be links');
      if (stat.size > MAX_BYTES) fail('STORAGE_BUDGET_EXCEEDED', 'File exceeds budget');
      handle = await fs.open(file, 'r'); const bytes = Buffer.alloc(Math.min(MAX_BYTES + 1, stat.size + 1)); let length = 0, n;
      do { n = (await handle.read(bytes, length, bytes.length - length, length)).bytesRead; length += n; } while (n && length < bytes.length);
      if (length > MAX_BYTES) fail('STORAGE_BUDGET_EXCEEDED', 'File exceeds budget');
      if (length > stat.size) fail('STORAGE_CONFLICT', 'File grew while being read; reopen before writing');
      return bytes.subarray(0, length);
    } catch (e) { if (e.code === 'ENOENT') return null; throw e; } finally { await handle?.close(); }
  }
  async function atomic(file, bytes, signal) {
    check(signal); const temp = path.join(path.dirname(file), `.tmp-${randomUUID()}`); let handle;
    try {
      handle = await fs.open(temp, 'wx'); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      check(signal);
      // Windows replacement can transiently reject a ticket while another writer
      // holds a read handle. Retain the published choosing flag while retrying;
      // this never removes another owner's file or grants lock admission early.
      const retryUntil = Date.now() + 500;
      for (;;) {
        try { await fs.rename(temp, file); break; }
        catch (e) {
          if (process.platform !== 'win32' || path.dirname(file) !== path.join(root, '.locks') || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || Date.now() > retryUntil) throw e;
          check(signal); await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
      await syncDirectory(path.dirname(file));
    } finally { await handle?.close(); await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  }
  async function syncDirectory(dir) {
    let handle;
    try { handle = await fs.open(dir, 'r'); await handle.sync(); }
    catch (e) { if (!(process.platform === 'win32' && ['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EACCES'].includes(e.code))) throw e; }
    finally { await handle?.close(); }
  }
  async function decode(bytes, project, doc) {
    if (!bytes) fail('STORAGE_NOT_FOUND', 'Document does not exist');
    let value;
    try { value = presentation.deserialize(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch (cause) { fail('STORAGE_CORRUPT', 'Invalid document bytes', { token: hash(bytes), cause }); }
    if (value.projectId !== project || value.id !== doc) fail('STORAGE_ID_MISMATCH', 'Exact identity does not match requested IDs');
    return { document: validate(value), token: hash(bytes) };
  }
  async function current(project, doc) {
    const dir = folder(project, doc);
    try { await safe(dir); } catch (e) { if (e.code !== 'ENOENT') throw e; return null; }
    return read(path.join(dir, 'document.json'));
  }
  function compare(bytes, expected) {
    token(expected); const actual = bytes === null ? null : hash(bytes);
    if (actual !== expected) fail('STORAGE_CONFLICT', 'Saved document changed; reopen before writing', { expectedToken: expected, actualToken: actual });
  }
  async function clean(dir) {
    await safe(dir);
    for (const name of await fs.readdir(dir)) {
      if (!['document.json', 'backup.json', 'autosave.json'].includes(name) && !/^\.tmp-[a-f0-9-]{36}$/.test(name)) fail('STORAGE_FOREIGN_FILES', 'Unrecognized file in document directory');
      const stat = await fs.lstat(path.join(dir, name));
      if (!stat.isFile() || stat.isSymbolicLink()) fail('UNSAFE_STORAGE_PATH', 'Link/subdirectory in document directory');
    }
  }
  async function journal() {
    const file = path.join(root, '.journal.json'), bytes = await read(file); if (!bytes) return;
    let j; try { j = JSON.parse(bytes); } catch { fail('STORAGE_JOURNAL_CORRUPT', 'Original files retained'); }
    if (!j || typeof j !== 'object' || Array.isArray(j) || Object.keys(j).sort().join() !== 'archive,operation,sourceId,sourceProject,sourceToken,stage,storageVersion,targetId,targetProject,targetToken' || j.storageVersion !== 1 || j.operation !== 'move' || !/^[a-f0-9-]{36}$/.test(j.stage) || !/^[a-f0-9-]{36}$/.test(j.archive) || j.sourceToken === null || j.targetToken === null) fail('STORAGE_JOURNAL_CORRUPT', 'Unknown transaction');
    token(j.sourceToken); token(j.targetToken);
    const source = folder(j.sourceProject, j.sourceId), target = folder(j.targetProject, j.targetId), stage = path.join(root, '.transactions', j.stage), archive = path.join(root, '.trash', j.archive);
    const a = await current(j.sourceProject, j.sourceId), b = await current(j.targetProject, j.targetId);
    if (a && hash(a) !== j.sourceToken || b && hash(b) !== j.targetToken) fail('STORAGE_JOURNAL_CONFLICT', 'Interrupted move conflicts with changed files; all files retained');
    if (!b) {
      const staged = await read(path.join(await safe(stage), 'document.json'));
      if (!staged || hash(staged) !== j.targetToken) fail('STORAGE_JOURNAL_CORRUPT', 'Staged document changed');
      await safe(path.dirname(target), true); await fs.rename(stage, target); await syncDirectory(path.dirname(target)); await syncDirectory(path.dirname(stage));
    }
    if (a) {
      await clean(source); await safe(path.dirname(archive), true); compare(await current(j.sourceProject, j.sourceId), j.sourceToken);
      await fs.rename(source, archive); await syncDirectory(path.dirname(source)); await syncDirectory(path.dirname(archive));
    } else {
      const archived = await read(path.join(await safe(archive), 'document.json'));
      if (!archived || hash(archived) !== j.sourceToken) fail('STORAGE_JOURNAL_CONFLICT', 'Archived original is missing or changed');
    }
    await fs.unlink(file); await syncDirectory(root);
  }
  async function locked(action, signal) {
    check(signal); const dir = await safe(path.join(root, '.locks'), true), nonce = randomUUID(), file = path.join(dir, `${nonce}.json`);
    // Filesystem bakery lock: each contender owns exactly one ticket. No process ever
    // unlinks another process's ticket, including dead owners. Fully written tickets
    // are published by rename, so a crash cannot publish an empty lock record.
    const ticket = { pid: process.pid, nonce, number: null };
    async function tickets() {
      const result = [];
      for (const name of await fs.readdir(dir)) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        const bytes = await read(path.join(dir, name)); if (!bytes) continue;
        let value; try { value = JSON.parse(bytes); } catch { fail('STORAGE_BUSY', 'Malformed lock ticket; retained for diagnosis'); }
        if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || `${value.nonce}.json` !== name || value.number !== null && (!Number.isSafeInteger(value.number) || value.number < 1)) fail('STORAGE_BUSY', 'Invalid lock ticket');
        let alive = true; try { process.kill(value.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
        if (alive) result.push(value);
      }
      return result;
    }
    try {
      await atomic(file, JSON.stringify(ticket), signal);
      ticket.number = 1 + Math.max(0, ...(await tickets()).map(t => t.number || 0));
      if (!Number.isSafeInteger(ticket.number)) fail('STORAGE_BUSY', 'Ticket counter exhausted');
      await atomic(file, JSON.stringify(ticket), signal);
      const deadline = Date.now() + 1000;
      for (;;) {
        check(signal); const other = (await tickets()).filter(t => t.nonce !== nonce);
        if (other.some(t => t.number !== null && (t.number < ticket.number || t.number === ticket.number && t.nonce < nonce))) fail('STORAGE_BUSY', 'Another storage operation owns an earlier ticket');
        if (!other.some(t => t.number === null)) break;
        if (Date.now() > deadline) fail('STORAGE_BUSY', 'Another writer is choosing its ticket');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await journal(); check(signal); return await action();
    } finally { await fs.unlink(file).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  }
  async function save(doc, expected, signal) {
    const value = validate(doc), { projectId: project, id: docId } = value;
    const old = await current(project, docId); compare(old, expected); if (old) await decode(old, project, docId);
    const dir = folder(project, docId); await safe(dir, true); await clean(dir);
    if (!old && (await read(path.join(dir, 'backup.json')) || await read(path.join(dir, 'autosave.json')))) fail('STORAGE_RECOVERY_AVAILABLE', 'Recovery data exists; recover explicitly');
    const bytes = Buffer.from(presentation.serialize(value));
    await atomic(path.join(dir, 'backup.json'), old || bytes, signal); compare(await current(project, docId), expected);
    await atomic(path.join(dir, 'document.json'), bytes, signal);
    return { document: value, token: hash(bytes) };
  }
  async function copy(project, doc, targetProject, targetId, expected, signal, move) {
    const old = await current(project, doc); compare(old, expected); const loaded = await decode(old, project, doc);
    const target = folder(targetProject, targetId);
    try { await fs.lstat(target); fail('STORAGE_TARGET_EXISTS', 'Target directory exists'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await clean(folder(project, doc));
    const value = validate({ ...loaded.document, projectId: targetProject, id: targetId }), bytes = Buffer.from(presentation.serialize(value));
    const stageId = randomUUID(), stage = path.join(root, '.transactions', stageId); await safe(stage, true);
    await atomic(path.join(stage, 'document.json'), bytes, signal); await atomic(path.join(stage, 'backup.json'), bytes, signal); check(signal);
    let archive;
    if (move) {
      archive = randomUUID();
      await atomic(path.join(root, '.journal.json'), JSON.stringify({ storageVersion: 1, operation: 'move', sourceProject: project, sourceId: doc, targetProject, targetId, sourceToken: loaded.token, targetToken: hash(bytes), stage: stageId, archive }), signal);
      // Durable intent is the commit point: complete it even if cancellation arrives now.
      await journal();
    } else { await safe(path.dirname(target), true); check(signal); await fs.rename(stage, target); await syncDirectory(path.dirname(target)); }
    return { document: value, token: hash(bytes), ...(archive ? { archive } : {}) };
  }
  return Object.freeze({
    load: (project, doc, { signal } = {}) => locked(async () => decode(await current(project, doc), project, doc), signal),
    save: (doc, { expectedToken, signal } = {}) => locked(() => save(doc, expectedToken, signal), signal),
    rename: (project, doc, name, { expectedToken, signal } = {}) => locked(async () => {
      const bytes = await current(project, doc); compare(bytes, expectedToken); const loaded = await decode(bytes, project, doc);
      return save({ ...loaded.document, name }, expectedToken, signal);
    }, signal),
    autosave: (doc, { expectedToken, signal } = {}) => locked(async () => {
      const value = validate(doc), bytes = await current(value.projectId, value.id); compare(bytes, expectedToken); await decode(bytes, value.projectId, value.id);
      await atomic(path.join(folder(value.projectId, value.id), 'autosave.json'), JSON.stringify({ storageVersion: 1, baseToken: expectedToken, document: value }), signal);
      return { baseToken: expectedToken };
    }, signal),
    recover: (project, doc, { source, expectedToken, signal } = {}) => locked(async () => {
      if (!['backup', 'autosave'].includes(source)) fail('INVALID_RECOVERY_SOURCE', 'Choose backup or autosave explicitly');
      const old = await current(project, doc); compare(old, expectedToken); const dir = await safe(folder(project, doc)), saved = await read(path.join(dir, `${source}.json`));
      if (!saved) fail('STORAGE_NOT_FOUND', 'Recovery source is absent');
      let value, baseToken;
      if (source === 'backup') value = (await decode(saved, project, doc)).document;
      else {
        let checkpoint; try { checkpoint = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(saved)); } catch { fail('STORAGE_CORRUPT', 'Invalid autosave'); }
        if (checkpoint.storageVersion !== 1) fail('UNSUPPORTED_STORAGE_VERSION', 'Unknown autosave version');
        baseToken = checkpoint.baseToken; token(baseToken); value = validate(checkpoint.document);
        if (value.projectId !== project || value.id !== doc) fail('STORAGE_ID_MISMATCH', 'Autosave identity mismatch');
        let valid = false; if (old) { try { await decode(old, project, doc); valid = true; } catch (e) { if (e.code !== 'STORAGE_CORRUPT') throw e; } }
        if (valid && baseToken !== expectedToken) fail('STORAGE_CONFLICT', 'Autosave belongs to older saved version');
      }
      const bytes = Buffer.from(presentation.serialize(value)); await atomic(path.join(dir, 'document.json'), bytes, signal);
      return { document: value, token: hash(bytes), recoveredFrom: source, ...(source === 'autosave' ? { baseToken } : {}) };
    }, signal),
    duplicate: (p, d, tp, td, { expectedToken, signal } = {}) => locked(() => copy(p, d, tp, td, expectedToken, signal, false), signal),
    move: (p, d, tp, td, { expectedToken, signal } = {}) => locked(() => copy(p, d, tp, td, expectedToken, signal, true), signal),
    remove: (p, d, { expectedToken, signal } = {}) => locked(async () => {
      const bytes = await current(p, d); compare(bytes, expectedToken); await decode(bytes, p, d); const dir = folder(p, d); await clean(dir);
      const archive = randomUUID(), destination = path.join(root, '.trash', archive); await safe(path.dirname(destination), true);
      check(signal); compare(await current(p, d), expectedToken); await fs.rename(dir, destination); await syncDirectory(path.dirname(dir)); await syncDirectory(path.dirname(destination)); return { archive };
    }, signal),
  });
}
module.exports = Object.freeze({ createStore });
