const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isBuildId = value => typeof value === 'string' && ID.test(value);
const within = (root, file) => { const rel = path.relative(root, file); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); };
const error = (code, message) => Object.assign(new Error(message), { code });

async function writeArtifact(file, data, encoding) {
  const temporary = path.join(path.dirname(file), `.deckloom-${process.pid}-${randomUUID()}.tmp`);
  const handle = await fs.open(temporary, 'wx');
  try {
    try { await handle.writeFile(data, encoding); } finally { await handle.close(); }
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, file); break; }
      catch (cause) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(cause.code) || attempt >= 5) throw cause;
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  } finally { await fs.rm(temporary, { force: true }); }
}
function relative(root, file) {
  if (!within(root, file)) throw error('PATH_ESCAPE', 'Build artifact escapes outputRoot');
  return path.relative(root, file).split(path.sep).join('/');
}
function validRelative(value) {
  return typeof value === 'string' && value && !value.includes('\\') && !value.includes('\0') && !value.includes(':') && !value.startsWith('/') && !value.split('/').some(x => !x || x === '.' || x === '..') && !value.startsWith('.deckloom/');
}
async function control(root, create = false) {
  // Control directories never follow links, even links remaining within root.
  for (const rel of ['.deckloom', '.deckloom/decks', '.deckloom/builds']) {
    const dir = path.join(root, rel);
    if (create) await fs.mkdir(dir, { recursive: true });
    try { const stat = await fs.lstat(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) throw error('INVALID_BUILD_PATH', 'Build control path must be a real directory'); }
    catch (cause) { if (cause.code !== 'ENOENT' || create) throw cause; }
  }
}
async function json(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw error('INVALID_MANIFEST', 'Invalid manifest file');
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (cause) { throw error('INVALID_MANIFEST', `Cannot parse build manifest: ${cause.message}`); }
}
function pointerPath(root, deckId) { return path.join(root, '.deckloom/decks', `${deckId}.json`); }
async function readPointer(root, deckId) {
  await control(root);
  let pointer;
  try { pointer = await json(pointerPath(root, deckId)); }
  catch (cause) { if (cause.code === 'ENOENT') return null; throw cause; }
  if (!pointer || pointer.manifestVersion !== 1 || pointer.deckId !== deckId || (pointer.published !== null && !isBuildId(pointer.published)) || !isBuildId(pointer.latestAttempt)) throw error('INVALID_MANIFEST', 'Invalid publication pointer');
  return pointer;
}
async function readManifest(root, buildId, deckId) {
  if (!isBuildId(buildId)) throw error('INVALID_MANIFEST', 'Invalid build ID');
  await control(root);
  const directory = path.join(root, '.deckloom/builds', buildId);
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw error('INVALID_MANIFEST', 'Invalid generation directory');
  const manifest = await json(path.join(directory, 'manifest.json'));
  if (!manifest || manifest.manifestVersion !== 1 || manifest.buildId !== buildId || manifest.deckId !== deckId || !['building', 'complete', 'failed', 'cancelled'].includes(manifest.state) || !Array.isArray(manifest.slides) || !Array.isArray(manifest.diagnostics)) throw error('INVALID_MANIFEST', 'Invalid generation manifest');
  for (const slide of manifest.slides) {
    if (!slide || typeof slide !== 'object' || typeof slide.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(slide.id) || !slide.artifacts || typeof slide.artifacts !== 'object' || Array.isArray(slide.artifacts) ||
      !Number.isSafeInteger(slide.index) || slide.index < 0 || !Number.isSafeInteger(slide.width) || slide.width < 1 || !Number.isSafeInteger(slide.height) || slide.height < 1 ||
      Object.keys(slide.artifacts).some(key => !['html', 'png', 'qa', 'spec'].includes(key)) || manifest.state === 'complete' && ['html', 'png', 'qa'].some(key => typeof slide.artifacts[key] !== 'string')) throw error('INVALID_MANIFEST', 'Invalid slide composition');
  }
  if (new Set(manifest.slides.map(slide => slide.id.toLowerCase())).size !== manifest.slides.length || manifest.state === 'complete' && (!manifest.slides.length || typeof manifest.report !== 'string') ||
    manifest.diagnostics.some(item => !item || typeof item.code !== 'string' || !['error', 'warning'].includes(item.severity) || item.stage !== undefined && typeof item.stage !== 'string')) throw error('INVALID_MANIFEST', 'Invalid manifest metadata');
  const files = manifest.slides.flatMap(slide => Object.values(slide.artifacts));
  if (manifest.report) files.push(manifest.report);
  if (manifest.outputs !== undefined) {
    if (!Array.isArray(manifest.outputs)) throw error('INVALID_MANIFEST', 'Invalid deck outputs');
    files.push(...manifest.outputs);
  }
  if (files.some(file => !validRelative(file)) || new Set(files.map(file => file.toLowerCase())).size !== files.length) throw error('INVALID_MANIFEST', 'Invalid manifest composition');
  return { manifest, directory: path.join(directory, 'files'), files };
}
async function publication(root, deckId) {
  const pointer = await readPointer(root, deckId);
  if (!pointer) return null;
  const latest = await readManifest(root, pointer.latestAttempt, deckId);
  const published = pointer.published ? await readManifest(root, pointer.published, deckId) : null;
  if (published && published.manifest.state !== 'complete') throw error('INVALID_MANIFEST', 'Publication is not complete');
  return { pointer, latest, published };
}
async function acquire(root) {
  await fs.mkdir(root, { recursive: true });
  await control(root, true);
  const lock = path.join(root, '.deckloom/write.lock');
  let handle;
  try { handle = await fs.open(lock, 'wx'); }
  catch (cause) { if (cause.code === 'EEXIST') throw error('BUILD_BUSY', 'Another writer owns outputRoot'); throw cause; }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8'); }
  catch (cause) { try { await handle.close(); } finally { await fs.rm(lock, { force: true }); } throw cause; }
  return async () => { try { await handle.close(); } finally { await fs.rm(lock, { force: true }); } };
}
async function begin(root, deckId) {
  const previous = await readPointer(root, deckId);
  const buildId = randomUUID(), directory = path.join(root, '.deckloom/builds', buildId);
  await fs.mkdir(directory);
  const manifest = { manifestVersion: 1, buildId, deckId, state: 'building', startedAt: new Date().toISOString(), slides: [], diagnostics: [] };
  const pointer = { manifestVersion: 1, deckId, published: previous?.published || null, latestAttempt: buildId };
  const save = () => writeArtifact(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  try {
    await fs.mkdir(path.join(directory, 'files'));
    await fs.writeFile(path.join(directory, 'bootstrap.html'), '<!doctype html><meta charset="utf-8">', 'utf8');
    await save();
    await writeArtifact(pointerPath(root, deckId), JSON.stringify(pointer, null, 2), 'utf8');
  } catch (cause) {
    manifest.state = 'failed'; manifest.finishedAt = new Date().toISOString();
    manifest.diagnostics.push({ severity: 'error', code: cause.code || 'RENDER_FAILED', message: cause.message, stage: 'begin-build', deckId });
    try { await save(); } catch { /* Primary I/O error still carries the generation location. */ }
    cause.build = { deckId, buildId, state: 'failed', manifest: path.join(directory, 'manifest.json') };
    throw cause;
  }
  return { manifest, directory: path.join(directory, 'files'), async finish(state) {
    manifest.state = state; manifest.finishedAt = new Date().toISOString(); await save();
    const next = { ...pointer, published: state === 'complete' ? buildId : previous?.published || null };
    await writeArtifact(pointerPath(root, deckId), JSON.stringify(next, null, 2), 'utf8');
  } };
}
module.exports = { writeArtifact, relative, validRelative, acquire, begin, publication, readManifest };
