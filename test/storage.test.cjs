const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto');
const { templates, editing, storage } = require('../src/index.cjs');
const library = require('../examples/engine-library.cjs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-store-'));
  t.after(async () => { assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'deckloom-store-'))); await fs.rm(root, { recursive: true, force: true }); });
  const catalog = templates.createCatalog([library]), editor = editing.createEditor(catalog), store = storage.createStore({ root, catalog });
  const doc = editor.addTemplate(editor.create({ projectId: 'Project', id: 'Deck', width: 960, height: 540 }), { libraryId: library.id, templateId: 'summary', revision: '1' }, 'first');
  return { root, catalog, store, editor, doc, file: path.join(root, 'project', 'deck', 'document.json') };
}
test('G1 atomic save/reopen, exact identities, CAS and independent duplicate/rename/move/archive', async t => {
  const { root, store, doc, editor } = await setup(t);
  let saved = await store.save(doc, { expectedToken: null }); assert.deepEqual(await store.load('Project', 'Deck'), saved);
  await assert.rejects(store.load('project', 'deck'), { code: 'STORAGE_ID_MISMATCH' });
  await assert.rejects(store.save(doc), { code: 'INVALID_STORAGE_TOKEN' });
  const edited = editor.editFields(doc, 'first', { title: 'Изменение — один' });
  const next = await store.save(edited, { expectedToken: saved.token });
  await assert.rejects(store.save(doc, { expectedToken: saved.token }), { code: 'STORAGE_CONFLICT' });
  const copied = await store.duplicate('Project', 'Deck', 'Other', 'Copy', { expectedToken: next.token });
  assert.equal(copied.document.slides[0].id, 'first'); assert.equal(copied.document.projectId, 'Other');
  saved = await store.rename('Other', 'Copy', 'Имя «копия»', { expectedToken: copied.token });
  assert.equal(saved.document.id, 'Copy'); assert.equal((await store.load('Project', 'Deck')).document.name, undefined);
  const moved = await store.move('Other', 'Copy', 'Third', 'Moved', { expectedToken: saved.token });
  await assert.rejects(store.load('Other', 'Copy'), { code: 'STORAGE_NOT_FOUND' });
  assert.deepEqual(await store.load('Third', 'Moved'), { document: moved.document, token: moved.token });
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.trash', moved.archive, 'document.json'), 'utf8')).id, 'Copy');
  const removed = await store.remove('Third', 'Moved', { expectedToken: moved.token });
  assert.ok(await fs.readFile(path.join(root, '.trash', removed.archive, 'document.json')));
  await assert.rejects(store.load('Third', 'Moved'), { code: 'STORAGE_NOT_FOUND' });
});
test('G1 corruption retains last good backup, autosave recovery is explicit and rejects stale checkpoints', async t => {
  const { store, doc, editor, file } = await setup(t), saved = await store.save(doc, { expectedToken: null });
  const draft = editor.editFields(doc, 'first', { title: 'Автосохранение' });
  await store.autosave(draft, { expectedToken: saved.token }); assert.deepEqual((await store.load('Project', 'Deck')).document, doc);
  let recovered = await store.recover('Project', 'Deck', { source: 'autosave', expectedToken: saved.token });
  assert.equal(recovered.document.slides[0].content.data.title, 'Автосохранение');
  await assert.rejects(store.recover('Project', 'Deck', { source: 'autosave', expectedToken: recovered.token }), { code: 'STORAGE_CONFLICT' });
  const corrupt = Buffer.from('{сломано'); await fs.writeFile(file, corrupt); const corruptToken = createHash('sha256').update(corrupt).digest('hex');
  await assert.rejects(store.load('Project', 'Deck'), { code: 'STORAGE_CORRUPT', token: corruptToken });
  await assert.rejects(store.save(doc, { expectedToken: corruptToken }), { code: 'STORAGE_CORRUPT' });
  assert.deepEqual(await fs.readFile(file), corrupt);
  recovered = await store.recover('Project', 'Deck', { source: 'backup', expectedToken: corruptToken }); assert.deepEqual(recovered.document, doc);
  await fs.unlink(file); await assert.rejects(store.save(doc, { expectedToken: null }), { code: 'STORAGE_RECOVERY_AVAILABLE' });
  await store.recover('Project', 'Deck', { source: 'autosave', expectedToken: null });
  assert.equal((await store.load('Project', 'Deck')).document.slides[0].content.data.title, 'Автосохранение');
});
test('G1 interrupted move rolls forward on reopen without losing original or checkpoints', async t => {
  const { store, doc, root, catalog } = await setup(t), saved = await store.save(doc, { expectedToken: null });
  const original = fs.rename; let injected = false;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (!injected && String(from).includes(`${path.sep}.transactions${path.sep}`) && to === path.join(root, 'new', 'moved')) { injected = true; throw Object.assign(new Error('Simulated interruption'), { code: 'EIO' }); }
    return original(from, to);
  });
  await assert.rejects(store.move('Project', 'Deck', 'New', 'Moved', { expectedToken: saved.token }), { code: 'EIO' });
  assert.ok(await fs.readFile(path.join(root, '.journal.json'))); t.mock.restoreAll();
  const reopened = storage.createStore({ root, catalog }); assert.equal((await reopened.load('New', 'Moved')).document.id, 'Moved');
  await assert.rejects(reopened.load('Project', 'Deck'), { code: 'STORAGE_NOT_FOUND' });
  await assert.rejects(fs.stat(path.join(root, '.journal.json')), { code: 'ENOENT' });
});
test('G1 missing refs, foreign files, path attacks, concurrent writers and cancellation preserve saved bytes', async t => {
  const { store, root, doc, file, catalog } = await setup(t), saved = await store.save(doc, { expectedToken: null });
  const controller = new AbortController(); controller.abort(); await assert.rejects(store.rename('Project', 'Deck', 'x', { expectedToken: saved.token, signal: controller.signal }), { code: 'CANCELLED' });
  await assert.rejects(store.load('..', 'Deck'), { code: 'INVALID_STORAGE_ID' }); await assert.rejects(store.load('CON', 'Deck'), { code: 'INVALID_STORAGE_ID' });
  const empty = storage.createStore({ root, catalog: templates.createCatalog([]) }); await assert.rejects(empty.load('Project', 'Deck'), { code: 'UNKNOWN_TEMPLATE_REVISION' });
  await fs.writeFile(path.join(path.dirname(file), 'foreign.txt'), 'retained');
  await assert.rejects(store.remove('Project', 'Deck', { expectedToken: saved.token }), { code: 'STORAGE_FOREIGN_FILES' });
  await fs.unlink(path.join(path.dirname(file), 'foreign.txt'));
  const second = storage.createStore({ root, catalog });
  const results = await Promise.allSettled([store.rename('Project', 'Deck', 'a', { expectedToken: saved.token }), second.rename('Project', 'Deck', 'b', { expectedToken: saved.token })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected').reason;
  assert.ok(['STORAGE_BUSY', 'STORAGE_CONFLICT'].includes(rejected.code), rejected.stack);
  const bytes = await fs.readFile(file); const external = Buffer.from(bytes.toString().replace('"name":', '"external":'));
  await fs.writeFile(file, external); await assert.rejects(store.save(doc, { expectedToken: createHash('sha256').update(bytes).digest('hex') }), { code: 'STORAGE_CONFLICT' }); assert.deepEqual(await fs.readFile(file), external);
});
test('G1 separate processes ignore dead tickets and never share write ownership', async t => {
  const { store, doc, root } = await setup(t); let saved = await store.save(doc, { expectedToken: null });
  // An exited child gives a real dead PID, rather than assuming a fixed unused PID.
  const run = promisify(execFile), dead = Number((await run(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'])).stdout);
  const nonce = '11111111-1111-1111-1111-111111111111';
  await fs.writeFile(path.join(root, '.locks', `${nonce}.json`), JSON.stringify({ pid: dead, nonce, number: null }));
  const source = `const {storage,templates}=require('./src/index.cjs'); const catalog=templates.createCatalog([require('./examples/engine-library.cjs')]); const store=storage.createStore({root:process.argv[1],catalog}); store.rename('Project','Deck',process.argv[3],{expectedToken:process.argv[2]}).then(()=>process.stdout.write('ok'),e=>{process.stdout.write(e.code);if(!['STORAGE_BUSY','STORAGE_CONFLICT'].includes(e.code))process.stderr.write(e.stack)});`;
  for (let i = 0; i < 12; i++) {
    const results = await Promise.all(['left', 'right'].map(name => run(process.execPath, ['-e', source, root, saved.token, `${name}-${i}`], { cwd: path.resolve(__dirname, '..') })));
    assert.equal(results.filter(r => r.stdout === 'ok').length, 1);
    assert.ok(results.every(r => ['ok', 'STORAGE_BUSY', 'STORAGE_CONFLICT'].includes(r.stdout)), JSON.stringify(results.map(r => ({ stdout: r.stdout, stderr: r.stderr }))));
    saved = await store.load('Project', 'Deck');
  }
  assert.ok(await fs.readFile(path.join(root, '.locks', `${nonce}.json`)));
});
test('G1 detects an external edit during save preparation without overwriting it', async t => {
  const { store, doc, file } = await setup(t), saved = await store.save(doc, { expectedToken: null });
  const original = fs.rename, external = Buffer.from('{external edit}'); let injected = false;
  t.mock.method(fs, 'rename', async (from, to) => {
    const result = await original(from, to);
    if (!injected && to === path.join(path.dirname(file), 'backup.json')) { injected = true; await fs.writeFile(file, external); }
    return result;
  });
  await assert.rejects(store.save({ ...doc, name: 'replacement' }, { expectedToken: saved.token }), { code: 'STORAGE_CONFLICT' });
  assert.deepEqual(await fs.readFile(file), external);
});
test('G1 Windows ticket publication tolerates transient reader sharing errors', { skip: process.platform !== 'win32' }, async t => {
  const { store, doc, root } = await setup(t); const original = fs.rename; let denied = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (path.dirname(to) === path.join(root, '.locks') && denied < 3 && await fs.stat(to).catch(() => null)) { denied++; throw Object.assign(new Error('Windows reader sharing violation'), { code: 'EPERM' }); }
    return original(from, to);
  });
  const saved = await store.save(doc, { expectedToken: null }); assert.equal(denied, 3); assert.deepEqual((await store.load('Project', 'Deck')).document, saved.document);
});


