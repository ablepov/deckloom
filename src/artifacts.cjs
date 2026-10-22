const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeProject, preflightProject } = require('./project.cjs');
const builds = require('./builds.cjs');

const missing = () => ({ state: 'missing' });
const ascii = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const within = (root, file) => {
  const relative = path.relative(root, file);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};
function readError(code, field, message, context = {}) {
  return Object.assign(new Error(`${code} at ${field}: ${message}`), { code, field, ...context });
}
function family(name, deck) { return new RegExp(`^${deck.artifactPrefix}-[0-9]+$`, 'i').test(name); }
function reviewImageRank(name) {
  const value = name.toLowerCase();
  if (!/\.(png|jpe?g|webp)$/.test(value) || /(preview|small|tiny|comparison|source|background-layer)/.test(value) || /(^|[-_])bg([-_.]|$)|background/.test(value)) return 0;
  if (/generated-(complete|hybrid)/.test(value)) return 3;
  return value.startsWith('generated-') ? 2 : 1;
}
function cacheVersion(stat) { return `${Math.trunc(stat.mtimeMs).toString(36)}-${stat.size.toString(36)}`; }
function noFromFolder(folder) { return folder.match(/([0-9]+)$/)[1]; }
function discoveryOrder(a, b) {
  const first = BigInt(noFromFolder(a)), second = BigInt(noFromFolder(b));
  return first < second ? -1 : first > second ? 1 : ascii(a, b);
}
function urlFor(project, directory, file, version) {
  const relative = path.relative(project.root, path.join(directory, file));
  const encoded = relative.split(path.sep).map(encodeURIComponent).join('/');
  return `${project.inputVersion === 1 ? '/artifacts' : ''}/${encoded}?v=${version}`;
}

async function inspectFile(project, directory, file) {
  const absolute = path.join(directory, file);
  try {
    const realRoot = await fs.realpath(project.root);
    const realDirectory = await fs.realpath(directory);
    if (!within(realRoot, realDirectory)) return { state: 'unreadable', diagnostic: 'PATH_ESCAPE' };
    if (!(await fs.stat(realDirectory)).isDirectory()) return { state: 'unreadable', diagnostic: 'NOT_DIRECTORY' };
    const realFile = await fs.realpath(absolute);
    if (!within(realDirectory, realFile)) return { state: 'unreadable', diagnostic: 'PATH_ESCAPE' };
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) return { state: 'unreadable', diagnostic: 'NOT_FILE' };
    await fs.access(absolute, fs.constants.R_OK);
    const version = cacheVersion(stat);
    return { state: 'available', url: urlFor(project, directory, file, version), version,
      file, size: stat.size, modifiedAt: stat.mtime.toISOString(), mtimeMs: stat.mtimeMs };
  } catch (error) {
    return error.code === 'ENOENT' ? absentState(absolute) : unreadable(error);
  }
}
function unreadable(error) {
  return { state: 'unreadable', diagnostic: ['EACCES', 'EPERM'].includes(error.code) ? 'ACCESS_DENIED'
    : error.code === 'ENOTDIR' ? 'NOT_DIRECTORY' : error.code === 'ELOOP' ? 'BROKEN_LINK' : 'IO_ERROR' };
}
async function absentState(absolute) {
  // ENOENT can be a genuinely absent leaf or a dangling ancestor/leaf link.
  for (let candidate = absolute; ; candidate = path.dirname(candidate)) {
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) {
        try { await fs.realpath(candidate); }
        catch (error) { return error.code === 'ENOENT' ? { state: 'unreadable', diagnostic: 'BROKEN_LINK' } : unreadable(error); }
      }
      return missing();
    } catch (error) {
      if (error.code !== 'ENOENT') return unreadable(error);
      if (path.dirname(candidate) === candidate) return missing();
    }
  }
}
function publicArtifact(artifact) {
  if (artifact.state === 'available') return { state: 'available', url: artifact.url, version: artifact.version };
  return artifact.state === 'missing' ? missing() : { state: 'unreadable', diagnostic: artifact.diagnostic };
}

async function legacyImage(project, directory, entries) {
  try { entries ??= await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) {
    return error.code === 'ENOENT' ? absentState(directory) : unreadable(error);
  }
  const candidates = [];
  for (const file of entries) {
    if (!file.isFile() || !reviewImageRank(file.name)) continue;
    const artifact = await inspectFile(project, directory, file.name);
    if (artifact.state !== 'missing') candidates.push({ artifact, file: file.name, rank: reviewImageRank(file.name), attempt: Number(file.name.match(/attempt-([0-9]+)/i)?.[1] || 0) });
  }
  candidates.sort((a, b) => b.rank - a.rank || (b.artifact.mtimeMs || 0) - (a.artifact.mtimeMs || 0) || b.attempt - a.attempt || a.file.localeCompare(b.file));
  return candidates[0]?.artifact || missing();
}
function projectSlide(project, deck, slide) {
  if (project.inputVersion === 1) return {
    id: slide.id, name: slide.name, index: slide.index, number: slide.number, width: slide.width, height: slide.height,
    artifacts: { html: publicArtifact(slide.html), png: publicArtifact(slide.png) },
  };
  const { html, png } = slide;
  const htmlAvailable = html.state === 'available', pngAvailable = png.state === 'available';
  return { deckId: deck.id, width: slide.width, height: slide.height, no: slide.no, id: slide.folder,
    file: pngAvailable ? png.file : null, url: pngAvailable ? png.url : null,
    version: pngAvailable ? png.version : null, size: pngAvailable ? png.size : null, modifiedAt: pngAvailable ? png.modifiedAt : null,
    htmlFile: htmlAvailable ? html.file : null, htmlUrl: htmlAvailable ? html.url : null,
    htmlVersion: htmlAvailable ? html.version : null, htmlSize: htmlAvailable ? html.size : null, htmlModifiedAt: htmlAvailable ? html.modifiedAt : null,
    ...(html.state === 'unreadable' ? { htmlError: html.diagnostic } : {}), ...(png.state === 'unreadable' ? { imageError: png.diagnostic } : {}) };
}

async function registeredImage(project, source) {
  if (project.inputVersion === 0) {
    const ranked = await legacyImage(project, source.directory);
    if (ranked.state !== 'missing') return ranked;
  }
  return inspectFile(project, source.directory, path.basename(source.png));
}

// Server instances own one immutable registry. Public scans create a fresh one
// for each operation; filesystem availability is read again on every scan.
function createArtifactReader(input) {
  const prepared = preflightProject(normalizeProject(input));
  const project = prepared.project;
  const decks = new Map(prepared.selected.map(target => [target.deck.id, target]));
  const envelope = () => project.inputVersion === 1
    ? { contractVersion: 1, generatedAt: new Date().toISOString(), project: { id: project.id, mode: project.mode } }
    : { generatedAt: new Date().toISOString() };

  async function buildArtifact(state, source, role) {
    if (!state) return role === 'html' ? inspectFile(project, source.directory, path.basename(source.html)) : registeredImage(project, source);
    if (state.error) return { state: 'unreadable', diagnostic: state.error };
    if (!state.published) return missing();
    const logical = path.relative(project.root, source[role]).split(path.sep).join('/');
    const declared = state.published.manifest.slides.some(slide => slide.artifacts[role] === logical);
    if (!declared) return missing();
    const actual = path.join(state.published.directory, logical);
    const artifact = await inspectFile(project, path.dirname(actual), path.basename(actual));
    if (artifact.state === 'missing') return { state: 'unreadable', diagnostic: 'MISSING_BUILD_ARTIFACT' };
    if (artifact.state === 'available') {
      const buildId = state.published.manifest.buildId;
      artifact.version = buildId;
      artifact.url = urlFor(project, source.directory, path.basename(source[role]), buildId) + `&build=${buildId}`;
    }
    return artifact;
  }
  async function registeredSlides(target, state) {
    return Promise.all(target.slides.map(async ({ slide, source }) => {
      const [html, png] = await Promise.all([
        buildArtifact(state, source, 'html'), buildArtifact(state, source, 'png'),
      ]);
      return { ...slide, folder: path.basename(source.directory), no: slide.artifactNo, html, png };
    }));
  }
  async function discoveredSlides(target, state) {
    const deck = target.deck;
    if (state && !state.error) {
      if (!state.published) return [];
      const result = [];
      for (const item of state.published.manifest.slides) {
        const folder = path.posix.dirname(item.artifacts.html || '');
        if (!family(folder, deck)) throw readError('INVALID_MANIFEST', 'manifest.slides', 'Discovery build has incompatible paths');
        const directory = path.join(project.root, folder), source = { directory, html: path.join(project.root, item.artifacts.html), png: path.join(project.root, item.artifacts.png) };
        const [html, png] = await Promise.all([buildArtifact(state, source, 'html'), buildArtifact(state, source, 'png')]);
        result.push({ id: folder, folder, no: noFromFolder(folder), name: folder, index: result.length, number: result.length + 1, width: deck.width, height: deck.height, html, png });
      }
      return result;
    }
    let entries;
    try { entries = await fs.readdir(project.root, { withFileTypes: true }); }
    catch (error) { throw readError(error.code === 'ENOENT' ? 'MISSING_ROOT' : 'PATH_ACCESS', 'project.root', 'Cannot read discovery source'); }
    // Retain 0.1's exclusion of directory links. Registered paths are explicit.
    const folders = entries.filter(entry => entry.isDirectory() && family(entry.name, deck)).map(entry => entry.name).sort(discoveryOrder);
    const identities = new Set();
    for (const folder of folders) {
      if (identities.has(folder.toLowerCase())) throw readError('DUPLICATE_ID', 'discovery', 'Case-only discovery IDs conflict', { deckId: deck.id });
      identities.add(folder.toLowerCase());
    }
    const result = [];
    for (const folder of folders) {
      const directory = path.join(project.root, folder);
      let files, imageError;
      try { files = await fs.readdir(directory, { withFileTypes: true }); }
      catch (error) { imageError = error.code === 'ENOENT' ? await absentState(directory) : unreadable(error); }
      const [html, png] = state?.error ? [{ state: 'unreadable', diagnostic: state.error }, { state: 'unreadable', diagnostic: state.error }]
        : await Promise.all([inspectFile(project, directory, `${folder}-render.html`), imageError || legacyImage(project, directory, files)]);
      if (html.state === 'missing' && png.state === 'missing') continue;
      const index = result.length;
      result.push({ id: folder, folder, no: noFromFolder(folder), name: folder, index, number: index + 1, width: deck.width, height: deck.height, html, png });
    }
    return result;
  }
  async function readDeck(target) {
    const { deck } = target;
    let state;
    try { state = await builds.publication(project.root, deck.id); }
    catch (cause) { state = { error: cause.code === 'ENOENT' ? 'INVALID_MANIFEST' : cause.code || 'INVALID_MANIFEST' }; }
    const slides = project.mode === 'registered' ? await registeredSlides(target, state) : await discoveredSlides(target, state);
    return { id: deck.id, label: deck.label, width: deck.width, height: deck.height,
      ...(state ? { build: state.error ? { state: 'unreadable', diagnostic: state.error } : {
        state: state.published ? 'published' : 'unpublished', buildId: state.published?.manifest.buildId || null,
        latestAttempt: { buildId: state.latest.manifest.buildId, state: state.latest.manifest.state,
          diagnostics: state.latest.manifest.diagnostics.map(item => ({ code: item.code, severity: item.severity, ...(item.stage ? { stage: item.stage } : {}) })) },
      } } : { build: { state: 'unversioned' } }),
      slides: slides.map(slide => projectSlide(project, deck, slide)) };
  }
  async function scanDecks() { return { ...envelope(), decks: await Promise.all(prepared.selected.map(readDeck)) }; }
  async function scanSlides(selection) {
    const id = selection === undefined ? project.decks[0]?.id : typeof selection === 'string' ? selection : selection?.id;
    const target = decks.get(id);
    if (!target) throw readError('UNKNOWN_DECK', 'deckId', 'Unknown deck', { deckId: id });
    const deck = await readDeck(target);
    return project.inputVersion === 1 ? { ...envelope(), deck } : { ...envelope(), ...deck };
  }
  async function artifactRoot(relative, buildId) {
    if (buildId !== undefined) {
      for (const target of prepared.selected) {
        try {
          const published = await builds.readManifest(project.root, buildId, target.deck.id);
          if (published.manifest.state !== 'complete' || !published.files.includes(relative)) continue;
          const folder = path.posix.dirname(relative);
          const allowed = published.manifest.outputs?.includes(relative) || (project.mode === 'registered' ? target.slides.some(item => path.relative(project.root, item.source.directory).split(path.sep).join('/') === folder) : family(folder, target.deck));
          if (allowed) return { root: published.directory, relative, artifact: true };
        } catch { /* Unknown, corrupt or foreign generation is never a fallback. */ }
      }
      return null;
    }
    // Match full directory boundaries. A stale registered folder is not served.
    if (project.mode === 'registered') {
      for (const target of prepared.selected) for (const item of target.slides) {
        const folder = path.relative(project.root, item.source.directory).split(path.sep).join('/');
        if (relative.startsWith(folder + '/')) return { root: item.source.directory, relative: relative.slice(folder.length + 1), artifact: true };
      }
    } else {
      const [folder, ...rest] = relative.split('/');
      if (project.decks.some(deck => family(folder, deck))) return { root: path.join(project.root, folder), relative: rest.join('/'), artifact: true };
    }
    return null;
  }
  return { project, scanDecks, scanSlides, artifactRoot };
}

async function scanDecks(project) { return createArtifactReader(project).scanDecks(); }
async function scanSlides(project, deck) { return createArtifactReader(project).scanSlides(deck); }
module.exports = { scanSlides, scanDecks, createArtifactReader };
