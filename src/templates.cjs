const { createHash } = require('node:crypto');
const { cloneJson } = require('./json-data.cjs');
const presentation = require('./document.cjs');
const owns = (v, k) => Object.hasOwn(v, k);
function fail(code, field, message) { throw Object.assign(new Error(`${code} at ${field}: ${message}`), { code, field }); }
function record(v, field) { if (!v || typeof v !== 'object' || Array.isArray(v)) fail('INVALID_TEMPLATE_LIBRARY', field, 'Expected a JSON record'); }
function closed(v, keys, field) { record(v, field); for (const k of Object.keys(v)) if (!keys.includes(k)) fail('INVALID_TEMPLATE_LIBRARY', field + '.' + k, 'Unknown field'); }
function id(v, field) { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) fail('INVALID_TEMPLATE_LIBRARY', field, 'Invalid ID'); }
function revision(v, field) { if (typeof v !== 'string' || !v.trim() || v.includes('\0') || v.length > 128) fail('INVALID_TEMPLATE_LIBRARY', field, 'Invalid opaque revision'); }
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const digest = v => createHash('sha256').update(canonical(v)).digest('hex');
function freeze(v) { if (v && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } return v; }
function verify(ref, integrity, field, required) {
  if (!owns(ref, 'integrity')) { if (required) fail('UNPINNED_TEMPLATE_REFERENCE', field, 'Explicitly pin this legacy reference before resolution'); }
  else if (ref.integrity !== integrity) fail('TEMPLATE_INTEGRITY_MISMATCH', field, 'Definition/defaults changed under a pinned reference');
}
function createCatalog(input) {
  const libraries = cloneJson(input, 'libraries');
  if (!Array.isArray(libraries)) fail('INVALID_TEMPLATE_LIBRARY', 'libraries', 'Expected an array');
  const lookup = new Map(), libraryIds = new Set();
  for (const [li, lib] of libraries.entries()) {
    const field = `libraries[${li}]`;
    closed(lib, ['libraryVersion', 'id', 'templates'], field);
    if (lib.libraryVersion !== 1) fail('UNSUPPORTED_LIBRARY_VERSION', field + '.libraryVersion', 'Expected libraryVersion:1');
    id(lib.id, field + '.id');
    if (libraryIds.has(lib.id.toLowerCase())) fail('DUPLICATE_TEMPLATE_ID', field + '.id', 'Duplicate library ID');
    libraryIds.add(lib.id.toLowerCase());
    if (!Array.isArray(lib.templates)) fail('INVALID_TEMPLATE_LIBRARY', field + '.templates', 'Expected an array');
    const spellings = new Map();
    for (const [ti, template] of lib.templates.entries()) {
      const at = field + `.templates[${ti}]`;
      closed(template, ['id', 'revision', 'definition', 'defaults'], at);
      id(template.id, at + '.id'); revision(template.revision, at + '.revision');
      record(template.definition, at + '.definition'); record(template.defaults, at + '.defaults');
      const folded = template.id.toLowerCase();
      if (spellings.has(folded) && spellings.get(folded) !== template.id) fail('DUPLICATE_TEMPLATE_ID', at + '.id', 'Revision IDs must use canonical spelling');
      spellings.set(folded, template.id);
      const key = JSON.stringify([lib.id, template.id, template.revision]);
      if (lookup.has(key)) fail('DUPLICATE_TEMPLATE_REVISION', at, 'Duplicate ID/revision');
      const integrity = digest({ integrityVersion: 1, kind: 'template', libraryId: lib.id, templateId: template.id, revision: template.revision, definition: template.definition, defaults: template.defaults });
      lookup.set(key, freeze({ libraryId: lib.id, templateId: template.id, ...template, integrity }));
    }
  }
  freeze(libraries);
  function resolve(inputRef) {
    const ref = cloneJson(inputRef, 'ref');
    closed(ref, ['libraryId', 'templateId', 'revision', 'integrity'], 'ref');
    id(ref.libraryId, 'ref.libraryId'); id(ref.templateId, 'ref.templateId'); revision(ref.revision, 'ref.revision');
    const template = lookup.get(JSON.stringify([ref.libraryId, ref.templateId, ref.revision]));
    if (!template) fail('UNKNOWN_TEMPLATE_REVISION', 'ref', 'Exact library/template/revision is unavailable');
    verify(ref, template.integrity, 'ref.integrity', false);
    return cloneJson(template, 'template');
  }
  function instance(docInput, ref, slideId, data = {}) {
    const doc = presentation.normalize(docInput), template = resolve(ref), values = cloneJson(data, 'data');
    record(values, 'data');
    doc.slides.push({ id: slideId, content: { kind: 'template', ref: { libraryId: template.libraryId, templateId: template.templateId, revision: template.revision, integrity: template.integrity }, data: { ...template.defaults, ...values } } });
    return presentation.normalize(doc);
  }
  function materialize(docInput, pin) {
    const doc = presentation.normalize(docInput), resolved = [];
    for (const slide of doc.slides) {
      const content = slide.content;
      let definition = null;
      if (content.kind !== 'authored') {
        let integrity;
        if (content.kind === 'template') { const template = resolve(content.ref); definition = template.definition; integrity = template.integrity; }
        else {
          const local = doc.compositions.find(c => c.id === content.ref.compositionId && c.revision === content.ref.revision);
          definition = local.definition;
          integrity = digest({ integrityVersion: 1, kind: 'local', compositionId: local.id, revision: local.revision, definition });
        }
        verify(content.ref, integrity, 'slides.' + slide.id + '.content.ref.integrity', !pin);
        if (pin && !owns(content.ref, 'integrity')) content.ref.integrity = integrity;
      }
      resolved.push({ id: slide.id, ...(owns(slide, 'name') ? { name: slide.name } : {}), width: slide.width ?? doc.width, height: slide.height ?? doc.height,
        kind: content.kind, ...(content.ref ? { ref: cloneJson(content.ref) } : {}), definition: cloneJson(definition), data: cloneJson(content.data) });
    }
    const normalized = presentation.normalize(doc);
    return pin ? normalized : cloneJson({ document: normalized, slides: resolved }, 'resolvedDocument');
  }
  return Object.freeze({ list: () => cloneJson(libraries, 'libraries'), resolve, instantiate: instance,
    pinReferences: doc => materialize(doc, true), resolveDocument: doc => materialize(doc, false) });
}
module.exports = Object.freeze({ createCatalog });
