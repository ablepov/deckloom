// Portable, data-only publication contract. Storage and authentication belong to hosts.
const { createHash } = require('node:crypto');
const { cloneJson } = require('./json-data.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const share = /^[a-f0-9]{32}$/;
const id = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const digest = /^[a-f0-9]{64}$/;
const formats = { pdf: ['application/pdf', '.pdf'], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'], 'pptx-fonts': ['application/zip', '.zip'] };
function check(value, field) { if (!value) throw Object.assign(new Error(`Invalid publication: ${field}`), { code: 'INVALID_PUBLICATION', field }); }
function object(value, allowed, field) {
  check(value && typeof value === 'object' && !Array.isArray(value), field);
  check(Object.keys(value).every(key => allowed.includes(key)), field);
}
function text(value, field, max = 300) { check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value), field); }
function date(value, field) { check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, field); }
function identity(value) {
  check(typeof value.projectId === 'string' && id.test(value.projectId), 'projectId'); check(typeof value.deckId === 'string' && id.test(value.deckId), 'deckId');
  check(uuid.test(value.releaseId), 'releaseId'); check(share.test(value.shareId), 'shareId');
}
function file(value, kind) {
  object(value, ['file', 'bytes', 'sha256'], 'file');
  const extension = kind === 'image' ? '.png' : formats[kind][1];
  const prefix = kind === 'image' ? 'slides/' : 'downloads/';
  check(typeof value.file === 'string' && value.file.startsWith(prefix) && value.file.endsWith(extension) && /^[A-Za-z0-9_./-]{1,200}$/.test(value.file) && value.file.split('/').every(part => part && part !== '.' && part !== '..'), 'file.path');
  check(Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= (kind === 'image' ? 32 : 100) * 1024 * 1024, 'file.bytes');
  check(digest.test(value.sha256), 'file.sha256');
}
function validate(input) {
  const value = cloneJson(input, 'publication');
  object(value, ['publicationVersion', 'sourceId', 'projectId', 'deckId', 'releaseId', 'shareId', 'title', 'publishedAt', 'generatedAt', 'engineVersion', 'sourceSha256', 'slides', 'downloads'], 'manifest');
  check(value.publicationVersion === 1, 'publicationVersion'); identity(value);
  check(typeof value.sourceId === 'string' && id.test(value.sourceId), 'sourceId'); text(value.title, 'title'); text(value.engineVersion, 'engineVersion', 80);
  date(value.publishedAt, 'publishedAt'); date(value.generatedAt, 'generatedAt'); check(digest.test(value.sourceSha256), 'sourceSha256');
  check(Array.isArray(value.slides) && value.slides.length > 0 && value.slides.length <= 1000, 'slides');
  const ids = new Set(), files = new Map();
  const remember = item => { const old = files.get(item.file); check(!old || (old.sha256 === item.sha256 && old.bytes === item.bytes), 'file.conflict'); files.set(item.file, item); };
  for (const slide of value.slides) {
    object(slide, ['id', 'name', 'width', 'height', 'image'], 'slide');
    check(typeof slide.id === 'string' && id.test(slide.id) && !ids.has(slide.id), 'slide.id'); ids.add(slide.id);
    text(slide.name, 'slide.name');
    for (const axis of ['width', 'height']) check(Number.isSafeInteger(slide[axis]) && slide[axis] > 0 && slide[axis] <= 16384, `slide.${axis}`);
    file(slide.image, 'image'); remember(slide.image);
  }
  object(value.downloads, Object.keys(formats), 'downloads');
  for (const [format, item] of Object.entries(value.downloads)) { file(item, format); remember(item); }
  check([...files.values()].reduce((sum, item) => sum + item.bytes, 0) <= 300 * 1000 * 1000, 'totalBytes');
  return value;
}
function validateCatalog(input) {
  const value = cloneJson(input, 'publicationCatalog');
  object(value, ['catalogVersion', 'revisionId', 'entries'], 'catalog');
  check(value.catalogVersion === 1 && uuid.test(value.revisionId), 'catalogVersion/revisionId');
  check(Array.isArray(value.entries) && value.entries.length <= 1000, 'entries');
  const shares = new Set(), decks = new Set();
  for (const entry of value.entries) {
    object(entry, ['projectId', 'deckId', 'shareId', 'releaseId', 'title', 'publishedAt'], 'entry'); identity(entry); text(entry.title, 'title'); date(entry.publishedAt, 'publishedAt');
    const deck = `${entry.projectId}/${entry.deckId}`;
    check(!shares.has(entry.shareId) && !decks.has(deck), 'entry.duplicate'); shares.add(entry.shareId); decks.add(deck);
  }
  return value;
}
function parse(bytes) { check(Buffer.byteLength(bytes) <= 1024 * 1024, 'manifest.size'); return validate(JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes)); }
function parseCatalog(bytes) { check(Buffer.byteLength(bytes) <= 1024 * 1024, 'catalog.size'); return validateCatalog(JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes)); }
function files(input) {
  const manifest = validate(input), all = new Map();
  for (const slide of manifest.slides) all.set(slide.image.file, { ...slide.image, contentType: 'image/png' });
  for (const [format, item] of Object.entries(manifest.downloads)) all.set(item.file, { ...item, contentType: formats[format][0] });
  return [...all.values()];
}
async function verify(input, read) {
  const manifest = validate(input);
  for (const item of files(manifest)) {
    const bytes = await read(item.file);
    check(bytes && bytes.byteLength === item.bytes && hash(bytes) === item.sha256, 'file.integrity');
    if (item.contentType === 'image/png') {
      const image = require('./pptx-package.cjs').png(Buffer.from(bytes));
      for (const slide of manifest.slides.filter(slide => slide.image.file === item.file)) check(image[0] === slide.width && image[1] === slide.height, 'image.dimensions');
    }
  }
  return manifest;
}
function safeUrl(value) {
  check(typeof value === 'string' && (value.startsWith('/') && !value.startsWith('//') || /^https:\/\//.test(value)) && !/[\u0000-\u0020\\]/.test(value), 'assetUrl');
  const parsed = new URL(value, 'https://publication.invalid'); check(!parsed.username && !parsed.password, 'assetUrl');
  return value;
}
function viewModel(input, assetUrl) {
  const manifest = validate(input);
  return { contractVersion: 1, project: { id: manifest.projectId, label: manifest.title, mode: 'registered' }, decks: [{
    id: manifest.deckId, label: manifest.title, width: manifest.slides[0].width, height: manifest.slides[0].height,
    build: { state: 'published', buildId: manifest.releaseId },
    slides: manifest.slides.map((slide, index) => ({ id: slide.id, name: slide.name, index, number: index + 1, width: slide.width, height: slide.height,
      artifacts: { html: { state: 'missing' }, png: { state: 'available', url: safeUrl(assetUrl(slide.image.file)), version: slide.image.sha256 } } })),
  }] };
}
function downloadModel(input, assetUrl) {
  const manifest = validate(input), links = {};
  for (const [format, item] of Object.entries(manifest.downloads)) links[format] = { url: safeUrl(assetUrl(item.file)), filename: item.file.split('/').at(-1) };
  return { decks: [{ deckId: manifest.deckId, mode: 'ready', pdf: !!links.pdf, pptx: !!links.pptx, fonts: !!links['pptx-fonts'], links }] };
}
module.exports = { validate, parse, validateCatalog, parseCatalog, files, verify, viewModel, downloadModel, hash, prepare: (...args) => require('./publications-prepare.cjs').prepare(...args) };
