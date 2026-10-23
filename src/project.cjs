// Shared runtime metadata. Adapter data remains opaque and caller-owned.
const fs = require('node:fs');
const path = require('node:path');

const ID = /^[A-Za-z0-9_-]+$/;
const DIGITS = /^[0-9]+$/;
const owns = (object, key) => Object.hasOwn(object, key) && object[key] !== undefined;
const hooks = ['renderDocument', 'validateDocument', 'renderSpec', 'renderQa', 'reportName', 'measureLayout', 'issueCount'];
const projectKeys = ['contractVersion', 'id', 'mode', 'root', 'decks', 'artifacts', 'viewer', 'staticMounts', 'data', 'downloads', 'comments', 'layoutOptions', ...hooks];
const deckKeys = ['id', 'label', 'width', 'height', 'slides', 'artifactPrefix', 'expectedSlides', 'data'];
const slideKeys = ['id', 'name', 'width', 'height', 'artifactNo', 'data'];
const models = new WeakSet();

function fail(code, field, message, context = {}, cause) {
  const error = new Error(`${code} at ${field}: ${message}`, cause ? { cause } : undefined);
  Object.assign(error, { code, field, ...context });
  throw error;
}

function object(value, field, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_TYPE', field, 'Expected an object', context);
}
function record(value, field, context) {
  object(value, field, context);
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_TYPE', field, 'Expected a configuration record', context);
}
function closed(value, keys, field, context) {
  record(value, field, context);
  for (const key of Reflect.ownKeys(value)) {
    if (!keys.includes(key)) fail('UNKNOWN_FIELD', `${field}.${String(key)}`, 'Put adapter fields in data', context);
  }
}
function text(value, field, context) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) fail('INVALID_VALUE', field, 'Expected a nonempty string without NUL', context);
  return value;
}
function identifier(value, field, context) {
  if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_ID', field, 'Expected [A-Za-z0-9_-]+', context);
  return value;
}
function array(value, field, context) {
  if (!Array.isArray(value)) fail('INVALID_TYPE', field, 'Expected an array (use [] for a draft)', context);
}
function dimension(value, fallback, field, context) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) fail('INVALID_DIMENSION', field, 'Expected a positive safe integer in CSS pixels', context);
  return value;
}
function unique(set, value, field, context, code = 'DUPLICATE_ID') {
  const key = value.toLowerCase();
  if (set.has(key)) fail(code, field, `Duplicate "${value}" (ASCII case-insensitive)`, context);
  set.add(key);
}
function absolute(value, field, legacy, cwd, diagnostics) {
  text(value, field);
  if (!path.isAbsolute(value)) {
    if (!legacy) fail('INVALID_PATH', field, 'Expected an absolute path');
    diagnostics.push(Object.freeze({ code: 'LEGACY_RELATIVE_PATH', field, message: 'Resolved against the supplied cwd' }));
  }
  return path.resolve(cwd, value);
}
function adapterData(value, field, context) {
  if (value !== undefined) object(value, field, context);
  return value;
}

function normalizeProject(input, { cwd = process.cwd() } = {}) {
  record(input, 'project');
  const legacy = !owns(input, 'contractVersion');
  if (!legacy && input.contractVersion !== 1) fail('UNSUPPORTED_CONTRACT_VERSION', 'project.contractVersion', 'Only contractVersion: 1 is understood');
  if (!legacy) closed(input, projectKeys, 'project');
  array(input.decks, 'project.decks');
  // Do not use map/every on sparse configuration arrays: holes are invalid records.
  const sources = Array.from(input.decks);
  for (let i = 0; i < sources.length; i++) record(sources[i], `project.decks[${i}]`);
  let mode = input.mode;
  if (legacy) {
    if (!sources.length) fail('AMBIGUOUS_LEGACY_MODE', 'project.decks', 'An empty legacy project needs explicit v1 mode');
    const authored = sources.filter(deck => owns(deck, 'slides')).length;
    if (authored && authored !== sources.length) fail('SOURCE_CONFLICT', 'project.decks', 'Legacy registered and discovery decks cannot be mixed');
    mode = authored ? 'registered' : 'discovery';
  }
  if (!['registered', 'discovery'].includes(mode)) fail('INVALID_MODE', 'project.mode', 'Expected registered or discovery');
  const diagnostics = [];
  const id = legacy ? 'legacy-session' : identifier(input.id, 'project.id');
  const root = absolute(input.root, 'project.root', legacy, cwd, diagnostics);
  if (!legacy && owns(input, 'artifacts')) closed(input.artifacts, ['layout'], 'project.artifacts');
  const layout = legacy ? 'legacy' : (input.artifacts?.layout === undefined && mode === 'registered' ? 'stable' : input.artifacts?.layout);
  if (!['stable', 'legacy'].includes(layout)) fail('INVALID_LAYOUT', 'project.artifacts.layout', 'Expected stable or legacy; discovery requires explicit legacy');
  if (mode === 'discovery' && layout !== 'legacy') fail('SOURCE_CONFLICT', 'project.artifacts.layout', 'Discovery requires legacy layout');
  for (const hook of hooks) {
    if (owns(input, hook) && typeof input[hook] !== 'function') fail('INVALID_TYPE', `project.${hook}`, 'Expected a function');
  }
  const viewer = {};
  if (owns(input, 'viewer')) {
    if (legacy) record(input.viewer, 'project.viewer');
    else closed(input.viewer, ['title', 'favicon', 'storagePrefix', 'legacyDeckId', 'presentation'], 'project.viewer');
    for (const key of ['title', 'favicon', 'storagePrefix', 'legacyDeckId']) {
      if (owns(input.viewer, key)) viewer[key] = text(input.viewer[key], `project.viewer.${key}`);
    }
    if (owns(input.viewer, 'presentation')) {
      if (typeof input.viewer.presentation !== 'boolean') fail('INVALID_TYPE', 'project.viewer.presentation', 'Expected a boolean');
      viewer.presentation = input.viewer.presentation;
    }
  }
  viewer.storagePrefix ??= legacy ? 'deckloom' : `deckloom:${id}`;
  const deckIds = new Set(), prefixes = new Set();
  const decks = sources.map((source, di) => {
    const field = `project.decks[${di}]`;
    const context = { deckId: source.id };
    if (!legacy) closed(source, deckKeys, field, context);
    const deckId = identifier(source.id, `${field}.id`, context);
    unique(deckIds, deckId, `${field}.id`, context);
    const label = text(source.label, `${field}.label`, context);
    const width = dimension(source.width, 1920, `${field}.width`, context);
    const height = dimension(source.height, 1080, `${field}.height`, context);
    let artifactPrefix;
    if (layout === 'legacy') {
      artifactPrefix = identifier(source.artifactPrefix, `${field}.artifactPrefix`, context);
      unique(prefixes, artifactPrefix, `${field}.artifactPrefix`, context, 'DUPLICATE_PREFIX');
    } else if (owns(source, 'artifactPrefix')) fail('LAYOUT_CONFLICT', `${field}.artifactPrefix`, 'Forbidden in stable layout', context);
    if (mode === 'discovery' && (owns(source, 'slides') || owns(source, 'expectedSlides'))) {
      fail('SOURCE_CONFLICT', owns(source, 'slides') ? `${field}.slides` : `${field}.expectedSlides`, 'Discovery does not declare an authored composition', context);
    }
    const slideIds = new Set(), numbers = new Set();
    let slides;
    if (mode === 'registered') {
      array(source.slides, `${field}.slides`, context);
      slides = Array.from(source.slides, (slide, si) => {
        const sf = `${field}.slides[${si}]`;
        record(slide, sf, context);
        const sc = { ...context, slideId: legacy ? slide.no : slide.id };
        if (!legacy) closed(slide, slideKeys, sf, sc);
        const slideId = identifier(legacy ? slide.no : slide.id, `${sf}.${legacy ? 'no' : 'id'}`, sc);
        unique(slideIds, slideId, `${sf}.${legacy ? 'no' : 'id'}`, sc);
        let artifactNo;
        if (layout === 'legacy') {
          artifactNo = legacy ? slide.no : slide.artifactNo;
          if (typeof artifactNo !== 'string' || !DIGITS.test(artifactNo)) {
            fail('INVALID_ARTIFACT_NO', `${sf}.${legacy ? 'no' : 'artifactNo'}`, 'Legacy layout requires a digit string; non-numeric no needs explicit path migration', sc);
          }
          unique(numbers, artifactNo, `${sf}.${legacy ? 'no' : 'artifactNo'}`, sc, 'DUPLICATE_ARTIFACT_NO');
        } else if (owns(slide, 'artifactNo')) fail('LAYOUT_CONFLICT', `${sf}.artifactNo`, 'Forbidden in stable layout', sc);
        return Object.freeze({
          id: slideId, name: owns(slide, 'name') ? text(slide.name, `${sf}.name`, sc) : slideId,
          index: si, number: si + 1,
          width: dimension(slide.width, width, `${sf}.width`, sc), height: dimension(slide.height, height, `${sf}.height`, sc),
          ...(artifactNo !== undefined ? { artifactNo } : {}),
          data: legacy ? Object.freeze({ source: slide }) : adapterData(slide.data, `${sf}.data`, sc),
        });
      });
      if (owns(source, 'expectedSlides')) {
        if (!Number.isSafeInteger(source.expectedSlides) || source.expectedSlides < 0) fail('INVALID_VALUE', `${field}.expectedSlides`, 'Expected a nonnegative safe integer', context);
        if (source.expectedSlides !== slides.length) fail('EXPECTED_SLIDES_MISMATCH', `${field}.expectedSlides`, `Expected ${source.expectedSlides}, got ${slides.length}`, context);
      }
    }
    return Object.freeze({ id: deckId, label, width, height,
      ...(artifactPrefix !== undefined ? { artifactPrefix } : {}),
      ...(slides ? { slides: Object.freeze(slides) } : {}),
      ...(owns(source, 'expectedSlides') ? { expectedSlides: source.expectedSlides } : {}),
      data: legacy ? Object.freeze({ source }) : adapterData(source.data, `${field}.data`, context),
    });
  });
  const mounts = {};
  if (owns(input, 'staticMounts')) {
    record(input.staticMounts, 'project.staticMounts');
    for (const [mount, directory] of Object.entries(input.staticMounts)) {
      const field = `project.staticMounts[${JSON.stringify(mount)}]`;
      if (!mount.startsWith('/') || mount === '/' || /[\\%?#\x00-\x20]/.test(mount) || mount.endsWith('/') || mount.slice(1).split('/').some(part => !part || part === '.' || part === '..')) {
        fail('INVALID_MOUNT', field, 'Expected a non-root URL path without encoded or relative segments');
      }
      const lower = mount.toLowerCase();
      const reserved = ['/api', '/artifacts', '/slides-review.html'];
      if (reserved.some(route => lower === route || lower.startsWith(route + '/')) || decks.some(deck => layout === 'legacy' && new RegExp(`^/${deck.artifactPrefix}-[0-9]+(?:/|$)`, 'i').test(mount))) {
        fail('MOUNT_CONFLICT', field, 'Mount overlaps an engine route');
      }
      if (Object.keys(mounts).some(other => {
        const previous = other.toLowerCase();
        return lower === previous || lower.startsWith(previous + '/') || previous.startsWith(lower + '/');
      })) fail('MOUNT_CONFLICT', field, 'Overlapping mounts depend on declaration order');
      mounts[mount] = absolute(directory, field, legacy, cwd, diagnostics);
    }
  }
  const normalized = {
    contractVersion: 1, inputVersion: legacy ? 0 : 1, id, mode, root,
    artifacts: Object.freeze({ layout }), viewer: Object.freeze(viewer), staticMounts: Object.freeze(mounts),
    decks: Object.freeze(decks), data: legacy ? Object.freeze({ source: input }) : adapterData(input.data, 'project.data'),
    layoutOptions: input.layoutOptions, diagnostics: Object.freeze(diagnostics),
  };
  if(owns(input,'downloads')){record(input.downloads,'project.downloads');normalized.downloads=Object.freeze({...input.downloads});}
  if(owns(input,'comments')){record(input.comments,'project.comments');normalized.comments=Object.freeze({...input.comments});}
  for (const hook of hooks) if (owns(input, hook)) normalized[hook] = input[hook];
  if (legacy) {
    for (const hook of ['renderDocument', 'renderSpec', 'reportName']) if (normalized[hook]) {
      normalized[hook] = (deck, slide, options) => input[hook](deck.data.source, slide?.data.source, options);
    }
    if (input.validateDocument) normalized.validateDocument = (html, deck, slide, options) => input.validateDocument(html, deck.data.source, slide.data.source, options);
    if (input.renderQa) normalized.renderQa = context => input.renderQa({ ...context, deck: context.deck.data.source, slide: context.slide.data.source });
  }
  models.add(normalized);
  return Object.freeze(normalized);
}

function within(base, target) {
  const relative = path.relative(base, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

// Resolve even a not-yet-created leaf through its closest existing ancestor.
// lstat makes dangling links an error rather than treating them as absent files.
function physical(target, field, context) {
  try {
    fs.lstatSync(target);
    return fs.realpathSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') {
      try { fs.lstatSync(target); }
      catch (missing) {
        if (missing.code === 'ENOENT') {
          const parent = path.dirname(target);
          if (parent !== target) return path.join(physical(parent, field, context), path.basename(target));
        }
      }
    }
    fail('PATH_ACCESS', field, 'Cannot resolve filesystem path', context, error);
  }
}

function artifactPaths(project, deck, slide, root) {
  const stem = `${deck.artifactPrefix}-${slide.artifactNo}`;
  const relative = project.artifacts.layout === 'stable' ? path.join(`deck-${deck.id}`, `slide-${slide.id}`) : stem;
  const directory = path.join(root, relative);
  const stable = project.artifacts.layout === 'stable';
  return Object.freeze({ directory, html: path.join(directory, stable ? 'render.html' : `${stem}-render.html`),
    png: path.join(directory, 'generated-html.png'), qa: path.join(directory, stable ? 'qa.md' : `${stem}-qa.md`),
    spec: path.join(directory, stable ? 'spec.md' : `${stem}-spec.md`) });
}

function reportNames(project) {
  const seen = new Set();
  return project.decks.map((deck, di) => {
    const field = `project.decks[${di}].reportName`, context = { deckId: deck.id };
    let name;
    try { name = project.reportName ? project.reportName(deck) : `render-report-${deck.id}.json`; }
    catch (error) { fail('REPORT_NAME_FAILED', field, 'reportName threw during preflight', context, error); }
    if (name instanceof Promise) name.catch(() => {});
    if (typeof name !== 'string' || !name || name.toLowerCase() === '.deckloom' || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
      fail('INVALID_REPORT_NAME', field, 'reportName must return one portable file basename synchronously', context);
    }
    unique(seen, name, field, context, 'DUPLICATE_PATH');
    if (project.decks.some(other => project.artifacts.layout === 'stable'
      ? name.toLowerCase() === `deck-${other.id}`.toLowerCase()
      : new RegExp(`^${other.artifactPrefix}-[0-9]+$`, 'i').test(name))) {
      fail('DUPLICATE_PATH', field, 'Report name conflicts with an artifact directory', context);
    }
    return name;
  });
}

function preflightProject(project, { operation = 'read', deckId, outputRoot = project.root, cwd = process.cwd() } = {}) {
  if (!models.has(project)) fail('INVALID_MODEL', 'project', 'Use normalizeProject before preflight');
  if (!['read', 'render'].includes(operation)) fail('INVALID_OPERATION', 'operation', 'Expected read or render');
  text(outputRoot, 'outputRoot');
  outputRoot = path.resolve(cwd, outputRoot);
  let selected = project.decks;
  if (deckId !== undefined) {
    selected = project.decks.filter(deck => deck.id === deckId);
    if (!selected.length) fail('UNKNOWN_DECK', 'deckId', `Unknown deck "${deckId}". Available: ${project.decks.map(deck => deck.id).join(', ')}`, { deckId });
  }
  if (operation === 'render') {
    if (project.mode === 'discovery') fail('READ_ONLY_PROJECT', 'project.mode', 'Discovery cannot render');
    if (!selected.length) fail('EMPTY_TARGET', 'project.decks', 'No render target');
    for (const deck of selected) if (!deck.slides.length) fail('EMPTY_DECK', `project.decks[${project.decks.indexOf(deck)}].slides`, 'Cannot render an empty deck', { deckId: deck.id });
    if (!project.renderDocument) fail('MISSING_RENDERER', 'project.renderDocument', 'Rendering requires renderDocument');
  }
  try {
    const stat = fs.statSync(project.root);
    if (!stat.isDirectory()) fail('INVALID_PATH', 'project.root', 'Artifact root must be a directory');
    fs.accessSync(project.root, fs.constants.R_OK);
  } catch (error) {
    if (error.field) throw error;
    if (error.code !== 'ENOENT') fail('PATH_ACCESS', 'project.root', 'Cannot read artifact root', {}, error);
    // A dangling root link must not be confused with a new registered root.
    try { fs.lstatSync(project.root); fail('PATH_ACCESS', 'project.root', 'Artifact root is a dangling link'); }
    catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
    if (project.mode === 'discovery') fail('MISSING_ROOT', 'project.root', 'Discovery requires an existing source directory');
  }
  const names = reportNames(project);
  // Reading describes every registered instance even if a leaf is broken or
  // unreadable. The reader inspects leaves independently; writing still uses
  // the strict physical path/collision checks below before its first write.
  if (operation === 'read') {
    return Object.freeze({ project, outputRoot, selected: Object.freeze(selected.map(deck => {
      const di = project.decks.indexOf(deck);
      return Object.freeze({ deck, report: path.join(outputRoot, names[di]), slides: Object.freeze((deck.slides || []).map(slide => Object.freeze({
        slide, source: artifactPaths(project, deck, slide, project.root), output: artifactPaths(project, deck, slide, outputRoot),
      }))) });
    })) });
  }
  const sourceBase = physical(project.root, 'project.root');
  const outputBase = physical(outputRoot, 'outputRoot');
  if (within(path.join(sourceBase, '.deckloom'), outputBase)) fail('PATH_CONFLICT', 'outputRoot', 'Output cannot be inside source build controls');
  const seen = new Set(), sourcePaths = new Set(), sourceOwners = new Map(), sourceAncestors = new Set();
  // Separate output roots must not overwrite a different source artifact (for
  // example, a report inside an existing slide directory becoming its HTML).
  for (const [di, deck] of project.decks.entries()) {
    const targets = [{ target: path.join(project.root, names[di]), role: `${di}:report`, kind: 'file', field: `project.decks[${di}].reportName`, context: { deckId: deck.id } }];
    for (const [si, slide] of (deck.slides || []).entries()) {
      for (const [key, target] of Object.entries(artifactPaths(project, deck, slide, project.root))) {
        targets.push({ target, role: `${di}:${si}:${key}`, kind: key === 'directory' ? 'directory' : 'file',
          field: `project.decks[${di}].slides[${si}]`, context: { deckId: deck.id, slideId: slide.id } });
      }
    }
    for (const entry of targets) {
      const resolved = physical(entry.target, entry.field, entry.context);
      if (!within(sourceBase, resolved)) fail('PATH_ESCAPE', entry.field, 'Source artifact resolves outside root', entry.context);
      unique(sourcePaths, resolved, entry.field, entry.context, 'DUPLICATE_PATH');
      sourceOwners.set(resolved.toLowerCase(), { ...entry, resolved });
      for (let parent = path.dirname(resolved); ; parent = path.dirname(parent)) {
        sourceAncestors.add(parent.toLowerCase());
        if (path.dirname(parent) === parent) break;
      }
    }
  }
  function check(target, base, field, context, kind, role) {
    const resolved = physical(target, field, context);
    if (!within(base, resolved)) fail('PATH_ESCAPE', field, 'Artifact resolves outside its root', context);
    const source = sourceOwners.get(resolved.toLowerCase());
    if ((source && source.role !== role) || (kind === 'file' && sourceAncestors.has(resolved.toLowerCase()))) {
      fail('DUPLICATE_PATH', field, 'Output conflicts with a different source artifact', context);
    }
    for (let parent = path.dirname(resolved); ; parent = path.dirname(parent)) {
      if (sourceOwners.get(parent.toLowerCase())?.kind === 'file') fail('DUPLICATE_PATH', field, 'Output is inside a source file path', context);
      if (path.dirname(parent) === parent) break;
    }
    // Portable comparisons intentionally reject case-only aliases on POSIX too.
    unique(seen, resolved, field, context, 'DUPLICATE_PATH');
    try {
      const stat = fs.statSync(target);
      if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) fail('PATH_CONFLICT', field, `Expected an artifact ${kind}`, context);
    } catch (error) {
      if (error.field) throw error;
      if (error.code !== 'ENOENT') fail('PATH_ACCESS', field, 'Cannot inspect artifact target', context, error);
    }
  }
  const planned = project.decks.map((deck, di) => {
    const context = { deckId: deck.id }, field = `project.decks[${di}]`;
    const report = path.join(outputRoot, names[di]);
    check(report, outputBase, `${field}.reportName`, context, 'file', `${di}:report`);
    const slides = (deck.slides || []).map((slide, si) => {
      const sc = { ...context, slideId: slide.id }, sf = `${field}.slides[${si}]`;
      const source = artifactPaths(project, deck, slide, project.root);
      const output = artifactPaths(project, deck, slide, outputRoot);
      check(output.directory, outputBase, sf, sc, 'directory', `${di}:${si}:directory`);
      for (const key of ['html', 'png', 'qa', 'spec']) check(output[key], outputBase, `${sf}.${key}`, sc, 'file', `${di}:${si}:${key}`);
      return Object.freeze({ slide, source, output });
    });
    return Object.freeze({ deck, report, slides: Object.freeze(slides) });
  });
  return Object.freeze({ project, outputRoot, planned: Object.freeze(planned), selected: Object.freeze(planned.filter(item => selected.includes(item.deck))) });
}

function validateRuntimeProject(input, options = {}) {
  let project = normalizeProject(input);
  if (project.mode === 'discovery') fail('READ_ONLY_PROJECT', 'project.mode', 'Discovery cannot create a renderer');
  let deckId = options.deckId;
  if (options.deck !== undefined) {
    if (typeof options.deck === 'string') deckId = options.deck;
    else {
      record(options.deck, 'deck');
      deckId = options.deck.id;
      if (project.inputVersion === 0) {
        const decks = input.decks.filter(deck => deck.id !== deckId);
        // Legacy renderDeck still accepts a caller-supplied authored deck.
        project = normalizeProject({ ...input, decks: [...decks, options.deck] });
      }
    }
    if (typeof deckId !== 'string') fail('INVALID_ID', 'deck.id', 'Expected a deck ID');
  }
  const prepared = preflightProject(project, { ...options, deckId });
  if (options.operation === 'render') {
    // This is the current PNG renderer's documented operating budget, not a
    // limit of the logical contract or a promise about every Chromium build.
    for (const target of prepared.selected) for (const { slide } of target.slides.filter(item => options.slideIds === undefined || options.slideIds.includes(item.slide.id))) {
      if (slide.width > 16384 || slide.height > 16384 || slide.width * slide.height > 64 * 1024 * 1024) {
        fail('UNSUPPORTED_CANVAS', `project.decks[${project.decks.indexOf(target.deck)}].slides[${slide.index}]`, 'PNG renderer supports sides up to 16384 px and up to 64 Mi pixels', { deckId: target.deck.id, slideId: slide.id });
      }
    }
  }
  return prepared;
}

module.exports = { normalizeProject, preflightProject, validateRuntimeProject, physical, within };
