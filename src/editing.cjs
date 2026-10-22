const presentation = require('./document.cjs');
const compositions = require('./compositions.cjs');
const { cloneJson } = require('./json-data.cjs');
const owns = (v, k) => Object.hasOwn(v, k);
function fail(code, field, message) { throw Object.assign(new Error(`${code} at ${field}: ${message}`), { code, field }); }
function checkSignal(options) {
  if (!options || Object.keys(options).some(k => k !== 'signal')) fail('INVALID_EDIT_OPTIONS', 'options', 'Only signal is supported');
  if (options.signal?.aborted) fail('CANCELLED', 'signal', 'Editing cancelled');
}
function createEditor(catalog) {
  function validate(doc) { return compositions.validateDocument(doc, catalog).document; }
  function transaction(input, action, options = {}) {
    checkSignal(options);
    const draft = validate(input), changed = action(draft) ?? draft;
    checkSignal(options);
    const result = validate(changed); checkSignal(options); return result;
  }
  function slide(doc, id) { const found = doc.slides.find(s => s.id === id); if (!found) fail('DOCUMENT_SLIDE_NOT_FOUND', 'slideId', 'Unknown exact slide ID'); return found; }
  function authored(doc, id) { const s = slide(doc, id); if (s.content.kind !== 'authored') fail('EDIT_NOT_ALLOWED', 'slideId', 'Definition edits require an authored instance; template/local definitions remain pinned'); return s.content.data.definition; }
  function permutation(items, ids, at) {
    if (!Array.isArray(ids) || ids.length !== items.length || new Set(ids).size !== ids.length || ids.some(id => !items.some(item => item.id === id))) fail('INVALID_EDIT_ORDER', at, 'Expected an exact permutation of current IDs');
    return ids.map(id => items.find(item => item.id === id));
  }
  return Object.freeze({
    create(input, options = {}) {
      checkSignal(options); const data = cloneJson(input, 'create');
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !['projectId', 'id', 'name', 'width', 'height', 'compositions'].includes(k))) fail('INVALID_EDIT_OPTIONS', 'create', 'Unknown create metadata');
      const doc = validate({ ...data, documentVersion: 1, slides: [] }); checkSignal(options); return doc;
    },
    addTemplate: (doc, ref, id, data = {}, options = {}) => transaction(doc, d => catalog.instantiate(d, ref, id, data), options),
    addLocal: (doc, ref, id, data = {}, options = {}) => transaction(doc, d => {
      d.slides.push({ id, content: { kind: 'local', ref: cloneJson(ref), data: cloneJson(data) } }); return catalog.pinReferences(d);
    }, options),
    addAuthored: (doc, id, definition, values, options = {}) => transaction(doc, d => { d.slides.push({ id, content: { kind: 'authored', data: { definition: cloneJson(definition), values: cloneJson(values) } } }); }, options),
    remove: (doc, id, options = {}) => transaction(doc, d => { slide(d, id); d.slides = d.slides.filter(s => s.id !== id); }, options),
    duplicate: (doc, id, newId, options = {}) => transaction(doc, d => presentation.duplicateSlide(d, id, newId), options),
    rename: (doc, id, name, options = {}) => transaction(doc, d => presentation.renameSlide(d, id, name), options),
    reorder: (doc, ids, options = {}) => transaction(doc, d => { d.slides = permutation(d.slides, cloneJson(ids), 'slideIds'); }, options),
    editFields: (doc, id, patch, options = {}) => transaction(doc, d => {
      const s = slide(d, id), values = cloneJson(patch, 'patch');
      if (!values || typeof values !== 'object' || Array.isArray(values)) fail('INVALID_INSTANCE_DATA', 'patch', 'Expected field record');
      if (s.content.kind === 'authored') s.content.data.values = { ...s.content.data.values, ...values };
      else s.content.data = { ...s.content.data, ...values };
    }, options),
    setTheme: (doc, id, theme, options = {}) => transaction(doc, d => { slide(d, id).theme = theme; }, options),
    setSlideSize: (doc, id, size, options = {}) => transaction(doc, d => {
      const s = slide(d, id), value = cloneJson(size);
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['width', 'height'].includes(k))) fail('INVALID_EDIT_OPTIONS', 'size', 'Only width/height overrides are supported');
      for (const [k, v] of Object.entries(value)) { if (v === null) delete s[k]; else s[k] = v; }
    }, options),
    addBlock: (doc, id, block, options = {}) => transaction(doc, d => { authored(d, id).blocks.push(cloneJson(block)); }, options),
    editBlock: (doc, id, blockId, patch, options = {}) => transaction(doc, d => {
      const definition = authored(d, id), index = definition.blocks.findIndex(b => b.id === blockId), values = cloneJson(patch);
      if (index < 0) fail('UNKNOWN_BLOCK', 'blockId', 'Unknown block ID');
      if (!values || typeof values !== 'object' || Array.isArray(values) || ['id', 'type', 'slot'].some(k => owns(values, k))) fail('EDIT_NOT_ALLOWED', 'patch', 'Identity/type/slot are fixed');
      definition.blocks[index] = { ...definition.blocks[index], ...values };
    }, options),
    removeBlock: (doc, id, blockId, options = {}) => transaction(doc, d => { const def = authored(d, id); if (!def.blocks.some(b => b.id === blockId)) fail('UNKNOWN_BLOCK', 'blockId', 'Unknown block ID'); def.blocks = def.blocks.filter(b => b.id !== blockId); }, options),
    reorderBlocks: (doc, id, ids, options = {}) => transaction(doc, d => { const def = authored(d, id); def.blocks = permutation(def.blocks, cloneJson(ids), 'blockIds'); }, options),
    setBlockVisible: (doc, id, blockId, visible, options = {}) => transaction(doc, d => { const block = authored(d, id).blocks.find(b => b.id === blockId); if (!block) fail('UNKNOWN_BLOCK', 'blockId', 'Unknown block ID'); if (typeof visible !== 'boolean') fail('INVALID_EDIT_OPTIONS', 'visible', 'Expected boolean'); block.visible = visible; }, options),
    validate,
  });
}
module.exports = Object.freeze({ createEditor });
