const path = require('node:path');
const { cloneJson } = require('./json-data.cjs');
const owns = (v, k) => Object.hasOwn(v, k);
const TYPES = ['text', 'rect', 'image', 'list', 'metric', 'table', 'connector'];
const PALETTE = { light: { background: '#f4f1e9', foreground: '#17221c', accent: '#2456a6' } };
function fail(code, field, message) { throw Object.assign(new Error(`${code} at ${field}: ${message}`), { code, field }); }
function check(ok, field, message, code = 'INVALID_COMPOSITION') { if (!ok) fail(code, field, message); }
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const identifier = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const color = v => typeof v === 'string' && /^#[a-f0-9]{6}$/i.test(v);
function closed(v, keys, at) { check(record(v), at, 'Expected record'); for (const k of Object.keys(v)) check(keys.includes(k), at + '.' + k, 'Unknown field'); }
function schema(s, at) {
  check(record(s), at, 'Expected field schema');
  const extra = { string: ['minLength', 'maxLength'], number: ['min', 'max'], boolean: [], color: [], image: [], enum: ['values'], array: ['items', 'minItems', 'maxItems'], object: ['properties'] };
  check(typeof s.type === 'string' && owns(extra, s.type), at + '.type', 'Unknown field type');
  closed(s, ['type', 'required', 'nullable', ...extra[s.type]], at);
  for (const k of ['required', 'nullable']) if (owns(s, k)) check(typeof s[k] === 'boolean', at + '.' + k, 'Expected boolean');
  for (const [a, b] of [['minLength', 'maxLength'], ['minItems', 'maxItems']]) {
    for (const k of [a, b]) if (owns(s, k)) check(Number.isSafeInteger(s[k]) && s[k] >= 0 && s[k] <= 100000, at + '.' + k, 'Invalid bound');
    if (owns(s, a) && owns(s, b)) check(s[a] <= s[b], at, 'Reversed bounds');
  }
  for (const k of ['min', 'max']) if (owns(s, k)) check(typeof s[k] === 'number' && Number.isFinite(s[k]), at + '.' + k, 'Invalid number bound');
  if (owns(s, 'min') && owns(s, 'max')) check(s.min <= s.max, at, 'Reversed number bounds');
  if (s.type === 'enum') check(Array.isArray(s.values) && s.values.length > 0 && s.values.every(v => typeof v === 'string') && new Set(s.values).size === s.values.length, at + '.values', 'Expected unique string values');
  if (s.type === 'array') schema(s.items, at + '.items');
  if (s.type === 'object') fields(s.properties, at + '.properties');
}
function fields(value, at) { check(record(value) && Object.keys(value).length <= 256, at, 'Expected <=256 fields'); for (const [k, s] of Object.entries(value)) { check(identifier(k), at + '.' + k, 'Invalid field ID'); schema(s, at + '.' + k); } }
function validateValue(s, v, at) {
  const invalid = message => fail('INVALID_INSTANCE_DATA', at, message);
  if (v === null && s.nullable) return;
  if (s.type === 'string') { if (typeof v !== 'string' || [...v].length < (s.minLength ?? 0) || [...v].length > (s.maxLength ?? 100000)) invalid('String type/length mismatch'); }
  else if (s.type === 'number') { if (typeof v !== 'number' || !Number.isFinite(v) || v < (s.min ?? -Infinity) || v > (s.max ?? Infinity)) invalid('Number type/range mismatch'); }
  else if (s.type === 'boolean') { if (typeof v !== 'boolean') invalid('Expected boolean'); }
  else if (s.type === 'color') { if (!color(v)) invalid('Expected opaque #RRGGBB color'); }
  else if (s.type === 'enum') { if (!s.values.includes(v)) invalid('Unknown enum value'); }
  else if (s.type === 'image') { if (!record(v) || Object.keys(v).some(k => !['src', 'alt'].includes(k)) || typeof v.src !== 'string' || !v.src || (owns(v, 'alt') && typeof v.alt !== 'string')) invalid('Expected image src/alt record'); validateSource(v.src, at); }
  else if (s.type === 'array') { if (!Array.isArray(v) || v.length < (s.minItems ?? 0) || v.length > (s.maxItems ?? 4096)) invalid('Array type/length mismatch'); v.forEach((item, i) => validateValue(s.items, item, at + '[' + i + ']')); }
  else if (s.type === 'object') validateFields(s.properties, v, at);
}
function validateFields(properties, data, at) {
  check(record(data), at, 'Expected data record', 'INVALID_INSTANCE_DATA');
  for (const k of Object.keys(data)) check(owns(properties, k), at + '.' + k, 'Unknown field', 'INVALID_INSTANCE_DATA');
  for (const [k, s] of Object.entries(properties)) {
    if (!owns(data, k)) check(!s.required, at + '.' + k, 'Missing required field', 'INVALID_INSTANCE_DATA');
    else validateValue(s, data[k], at + '.' + k);
  }
}
function validateSource(src, at) {
  const prepared = /^data:image\/(png|svg\+xml);base64,[a-z0-9+/]*={0,2}$/i.test(src);
  let local = false;
  try { const url = new URL(src, 'https://deckloom.invalid/resources/slide.html'); local = url.protocol === 'https:' && url.host === 'deckloom.invalid'; } catch {}
  check(src.trim() === src && !/[\u0000-\u001f\\]/.test(src) && !src.startsWith('/') &&
    (prepared || (local && !/^[a-z][a-z0-9+.-]*:/i.test(src))), at, 'Only local relative or prepared PNG/SVG data resources', 'INVALID_INSTANCE_DATA');
}
function normalizeDefinition(input) {
  const d = cloneJson(input, 'definition');
  closed(d, ['definitionVersion', 'fields', 'themes', 'defaultTheme', 'slots', 'blocks'], 'definition');
  check(d.definitionVersion === 1, 'definition.definitionVersion', 'Expected definitionVersion:1', 'UNSUPPORTED_COMPOSITION_VERSION');
  fields(d.fields, 'definition.fields');
  const themes = d.themes ?? PALETTE;
  check(record(themes) && Object.keys(themes).length > 0 && Object.keys(themes).length <= 32, 'definition.themes', 'Expected 1..32 themes');
  for (const [id, theme] of Object.entries(themes)) { check(identifier(id), 'definition.themes', 'Invalid theme ID'); closed(theme, ['background', 'foreground', 'accent'], 'definition.themes.' + id); check(['background', 'foreground', 'accent'].every(k => color(theme[k])), 'definition.themes.' + id, 'Expected opaque theme colors'); }
  if (owns(d, 'defaultTheme')) check(identifier(d.defaultTheme) && owns(themes, d.defaultTheme), 'definition.defaultTheme', 'Unknown theme');
  check(Array.isArray(d.blocks) && d.blocks.length <= 256, 'definition.blocks', 'Expected <=256 blocks');
  const slots = new Map();
  if (owns(d, 'slots')) {
    check(Array.isArray(d.slots) && d.slots.length <= 64, 'definition.slots', 'Expected <=64 slots');
    for (const [i, slot] of d.slots.entries()) {
      closed(slot, ['id', 'accepts', 'required'], 'definition.slots[' + i + ']');
      check(identifier(slot.id) && !slots.has(slot.id.toLowerCase()) && Array.isArray(slot.accepts) && slot.accepts.length && slot.accepts.every(v => TYPES.includes(v)) && typeof slot.required === 'boolean', 'definition.slots[' + i + ']', 'Invalid slot');
      slots.set(slot.id.toLowerCase(), { ...slot, index: i });
    }
  }
  const ids = new Set(); let lastSlot = -1;
  function binding(v, at) {
    if (!record(v)) return;
    if (owns(v, 'field')) { closed(v, ['field'], at); check(identifier(v.field) && owns(d.fields, v.field), at, 'Unknown field binding'); }
    else if (owns(v, 'token')) { closed(v, ['token'], at); check(['background', 'foreground', 'accent'].includes(v.token), at, 'Unknown theme token'); }
  }
  for (const [i, b] of d.blocks.entries()) {
    const at = 'definition.blocks[' + i + ']';
    const props = { text: ['text', 'size', 'lineHeight', 'bold', 'italic', 'underline', 'color'], list: ['items', 'size', 'lineHeight', 'color'], metric: ['value', 'size', 'lineHeight', 'color'], rect: ['fill'], image: ['image', 'fit'], connector: ['fill'], table: ['rows', 'size', 'lineHeight', 'padding'] };
    check(record(b) && typeof b.type === 'string' && owns(props, b.type), at, 'Unsupported block type');
    closed(b, ['id', 'type', 'x', 'y', 'w', 'h', 'slot', 'visible', 'opacity', ...props[b.type]], at);
    check(typeof b.id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(b.id) && !ids.has(b.id.toLowerCase()), at + '.id', 'Block IDs must be stable, unique lowercase IDs'); ids.add(b.id.toLowerCase());
    check(['x', 'y', 'w', 'h'].every(k => typeof b[k] === 'number' && Number.isFinite(b[k])) && b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0, at, 'Invalid block geometry');
    if (owns(b, 'slot')) { check(identifier(b.slot), at + '.slot', 'Invalid slot ID'); const slot = slots.get(b.slot.toLowerCase()); check(slot && slot.id === b.slot && slot.accepts.includes(b.type) && slot.index >= lastSlot, at + '.slot', 'Unknown/incompatible/reordered slot'); lastSlot = slot.index; }
    check(owns(b, { text: 'text', list: 'items', metric: 'value', rect: 'fill', image: 'image', connector: 'fill', table: 'rows' }[b.type]), at, 'Missing block content');
    for (const k of ['text', 'items', 'value', 'fill', 'image', 'color', 'visible', 'rows', 'opacity']) if (owns(b, k)) binding(b[k], at + '.' + k);
    if (owns(b, 'visible') && !record(b.visible)) check(typeof b.visible === 'boolean', at + '.visible', 'Expected boolean/binding');
    for (const k of ['bold', 'italic', 'underline']) if (owns(b, k)) check(typeof b[k] === 'boolean', at + '.' + k, 'Expected boolean');
    for (const k of ['size', 'lineHeight']) if (owns(b, k)) check(typeof b[k] === 'number' && b[k] > 0 && b[k] <= 256, at + '.' + k, 'Invalid text size');
    if (owns(b, 'opacity') && !record(b.opacity)) check(typeof b.opacity === 'number' && b.opacity >= 0 && b.opacity <= 1, at + '.opacity', 'Expected opacity 0..1/binding');
    if (owns(b, 'fit')) check(['fill', 'cover'].includes(b.fit), at + '.fit', 'Expected fill/center cover');
    if (owns(b, 'padding')) check(typeof b.padding === 'number' && b.padding >= 0 && b.padding <= 64, at + '.padding', 'Expected cell padding 0..64');
    if (b.type === 'connector') check(Math.min(b.w, b.h) <= 8 && !owns(b, 'opacity'), at, 'Connector requires a thin axis-aligned box without opacity');
  }
  return d;
}
function evaluate(value, data, theme) {
  if (record(value) && owns(value, 'field')) { check(owns(data, value.field), value.field, 'Missing bound field', 'INVALID_INSTANCE_DATA'); return data[value.field]; }
  if (record(value) && owns(value, 'token')) return theme[value.token];
  return value;
}
function textValue(v, at) { check(v === null || ['string', 'number', 'boolean'].includes(typeof v), at, 'Text requires primitive data', 'INVALID_INSTANCE_DATA'); return v === null ? '' : String(v); }
function validateDocument(input, catalog) {
  check(catalog && typeof catalog.resolveDocument === 'function', 'catalog', 'Expected a templates catalog');
  const resolved = catalog.resolveDocument(input), slides = [];
  for (const [index, source] of resolved.slides.entries()) {
    const raw = source.kind === 'authored' ? source.data : null;
    if (raw) closed(raw, ['definition', 'values'], 'authored.' + source.id);
    const definition = normalizeDefinition(raw ? raw.definition : source.definition), data = raw ? raw.values : source.data;
    validateFields(definition.fields, data, 'slides.' + source.id + '.data');
    const themes = definition.themes ?? PALETTE, name = resolved.document.slides[index].theme ?? definition.defaultTheme ?? Object.keys(themes).sort()[0];
    check(owns(themes, name), 'slides.' + source.id + '.theme', 'Unknown theme', 'INVALID_INSTANCE_DATA');
    const theme = themes[name], blocks = [];
    for (const b of definition.blocks) {
      check(b.x + b.w <= source.width && b.y + b.h <= source.height, b.id, 'Block outside slide', 'INVALID_INSTANCE_DATA');
      const visible = evaluate(b.visible ?? true, data, theme); check(typeof visible === 'boolean', b.id, 'Visibility requires boolean', 'INVALID_INSTANCE_DATA');
      const result = { ...b, visible, opacity: evaluate(b.opacity ?? 1, data, theme) };
      check(typeof result.opacity === 'number' && Number.isFinite(result.opacity) && result.opacity >= 0 && result.opacity <= 1, b.id, 'Invalid opacity', 'INVALID_INSTANCE_DATA');
      if (['rect', 'connector'].includes(b.type)) { result.fill = evaluate(b.fill, data, theme); check(color(result.fill), b.id, 'Invalid solid fill', 'INVALID_INSTANCE_DATA'); }
      else if (b.type === 'image') { result.image = evaluate(b.image, data, theme); validateValue({ type: 'image' }, result.image, b.id); }
      else if (b.type === 'table') {
        result.rows = evaluate(b.rows, data, theme); result.size = b.size ?? 18; result.lineHeight = b.lineHeight ?? 24; result.padding = b.padding ?? 8;
        check(Array.isArray(result.rows) && result.rows.length > 0 && result.rows.length <= 32 && result.rows.every(row => Array.isArray(row) && row.length > 0 && row.length <= 16 && row.length === result.rows[0].length && row.every(cell => typeof cell === 'string' && cell && !/[\r\n\t]/.test(cell))), b.id, 'Expected rectangular single-line string table', 'INVALID_INSTANCE_DATA');
        check(result.opacity === 1 && result.lineHeight >= result.size && result.lineHeight + 2 * result.padding <= b.h / result.rows.length, b.id, 'Table row height/opacity does not fit the native profile', 'INVALID_INSTANCE_DATA');
      }
      else {
        result.size = b.size ?? 24; result.lineHeight = b.lineHeight ?? result.size * 4 / 3;
        check(result.lineHeight >= result.size, b.id, 'lineHeight must be >= size', 'INVALID_INSTANCE_DATA');
        result.color = evaluate(b.color ?? { token: 'foreground' }, data, theme); check(color(result.color), b.id, 'Invalid text color', 'INVALID_INSTANCE_DATA');
        if (b.type === 'list') { const items = evaluate(b.items, data, theme); check(Array.isArray(items), b.id, 'List requires array', 'INVALID_INSTANCE_DATA'); result.text = items.map(item => '• ' + textValue(item, b.id)).join('\n'); }
        else result.text = textValue(evaluate(b.type === 'metric' ? b.value : b.text, data, theme), b.id);
        if (!result.text) result.visible = false;
      }
      blocks.push(result);
    }
    for (const slot of definition.slots ?? []) if (slot.required) check(blocks.some(b => b.slot === slot.id && b.visible), slot.id, 'Required slot must retain visible content', 'INVALID_INSTANCE_DATA');
    slides.push({ id: source.id, ...(owns(source, 'name') ? { name: source.name } : {}), width: source.width, height: source.height, theme: name, palette: theme, definition, data, blocks,
      capabilities: { editableFields: Object.keys(definition.fields), themes: Object.keys(themes).sort(), blockIds: blocks.map(b => b.id), formats: { html: true, png: true, pdf: true,
        pptx: { supported: ((source.width === 960 && source.height === 540) || (source.width === 540 && source.height === 960)) && !blocks.some(b => b.bold && b.italic) && blocks.filter(b => b.type === 'image').every(b => /(?:\.png|\.svg)(?:[?#]|$)|^data:image\/(?:png|svg\+xml);base64,/i.test(b.image.src)), validation: 'resource-font-layout-checks-required-at-export' } } } });
  }
  return cloneJson({ document: resolved.document, slides }, 'compiledDocument');
}
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
function renderSlide(slide) {
  const nodes = slide.blocks.filter(b => b.visible).map(b => {
    const geometry = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;opacity:${b.opacity};`;
    if (['rect', 'connector'].includes(b.type)) return `<div id="${b.id}" data-deckloom-pptx="${b.type}" style="${geometry}background:${b.fill}"></div>`;
    if (b.type === 'image') return `<img id="${b.id}" data-deckloom-pptx="image" src="${escape(b.image.src)}" alt="${escape(b.image.alt ?? '')}" style="${geometry}object-fit:${b.fit ?? 'fill'};${b.fit === 'cover' ? 'overflow:clip' : ''}">`;
    if (b.type === 'table') return `<table id="${b.id}" data-deckloom-pptx="table" style="position:absolute;${geometry}table-layout:fixed;border-collapse:collapse"><tbody>${b.rows.map((row, i) => `<tr style="height:${b.h / b.rows.length}px">${row.map(cell => `<td style="font:${b.size}px/${b.lineHeight}px Arial;white-space:pre;text-align:left;vertical-align:top;padding:${b.padding}px;background:${i ? slide.palette.background : slide.palette.accent};color:${i ? slide.palette.foreground : '#ffffff'}">${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    return `<div id="${b.id}" data-deckloom-pptx="text" style="${geometry}font-size:${b.size}px;line-height:${b.lineHeight}px;color:${b.color};font-weight:${b.bold ? 700 : 400};font-style:${b.italic ? 'italic' : 'normal'};text-decoration:${b.underline ? 'underline' : 'none'}">${escape(b.text)}</div>`;
  });
  return '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}main{position:relative;width:' + slide.width + 'px;height:' + slide.height + 'px;background:' + slide.palette.background + '}main>div,main>img{position:absolute;overflow:visible}div{font:24px/32px Arial;white-space:pre-wrap;text-align:left;margin:0;padding:0}</style></head><body><main class="slide" data-deckloom-pptx="slide">' + nodes.join('') + '</main></body></html>';
}
function createProject(document, catalog, options) {
  check(options && Object.keys(options).every(k => k === 'root') && typeof options.root === 'string' && path.isAbsolute(options.root), 'options.root', 'Expected explicit absolute resource root');
  const compiled = validateDocument(document, catalog), html = new Map(compiled.slides.map(s => [s.id, renderSlide(s)])), doc = compiled.document;
  return { contractVersion: 1, id: doc.projectId, mode: 'registered', root: options.root,
    decks: [{ id: doc.id, label: doc.name ?? doc.id, width: doc.width, height: doc.height, slides: compiled.slides.map(s => ({ id: s.id, ...(s.name ? { name: s.name } : {}), width: s.width, height: s.height })) }],
    renderDocument(_deck, slide) { check(html.has(slide.id), 'slide.id', 'Unknown slide'); return html.get(slide.id); } };
}
module.exports = Object.freeze({ normalizeDefinition, validateDocument, createProject });
