// Persisted presentation data is independent of executable adapter configuration.
const { cloneJson, limits: jsonLimits } = require('./json-data.cjs');
const limits = Object.freeze({ ...jsonLimits, maxSlides: 4096, maxCompositions: 4096 });
const owns = (value, key) => Object.hasOwn(value, key);
function fail(code, field, message) {
  throw Object.assign(new Error(`${code} at ${field}: ${message}`), { code, field });
}
const childField = (field, key) => field + '[' + JSON.stringify(key) + ']';

function record(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_DOCUMENT', field, 'Expected a JSON record');
}
function closed(value, keys, field) {
  record(value, field);
  for (const key of Object.keys(value)) if (!keys.includes(key))
    fail('UNKNOWN_DOCUMENT_FIELD', childField(field, key), 'Unexpected document field');
}
function identifier(value, field) {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value))
    fail('INVALID_DOCUMENT_ID', field, 'Expected 1..128 ASCII letters/digits/underscore/hyphen');
  return value;
}
function text(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
    fail('INVALID_DOCUMENT', field, 'Expected a nonempty string without NUL');
}
function revision(value, field) {
  text(value, field);
  if (value.length > 128) fail('INVALID_DOCUMENT', field, 'Revision exceeds 128 characters');
}
function dimension(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) fail('INVALID_DOCUMENT', field, 'Expected a positive safe integer in CSS px');
}
function array(value, field, maximum) {
  if (!Array.isArray(value)) fail('INVALID_DOCUMENT', field, 'Expected an explicit array; [] is a valid draft');
  if (value.length > maximum) fail('DOCUMENT_BUDGET_EXCEEDED', field, 'Too many document items');
}
function normalize(input) {
  const doc = cloneJson(input);
  closed(doc, ['documentVersion', 'projectId', 'id', 'name', 'width', 'height', 'slides', 'compositions'], 'document');
  if (doc.documentVersion !== 1) fail('UNSUPPORTED_DOCUMENT_VERSION', 'document.documentVersion', 'Only documentVersion:1 is supported; no implicit migration');
  identifier(doc.projectId, 'document.projectId'); identifier(doc.id, 'document.id');
  if (owns(doc, 'name')) text(doc.name, 'document.name');
  dimension(doc.width, 'document.width'); dimension(doc.height, 'document.height');
  array(doc.slides, 'document.slides', limits.maxSlides);
  const compositions = new Map(), spellings = new Map();
  if (owns(doc, 'compositions')) {
    array(doc.compositions, 'document.compositions', limits.maxCompositions);
    for (const [i, composition] of doc.compositions.entries()) {
      const field = `document.compositions[${i}]`;
      closed(composition, ['id', 'revision', 'definition'], field);
      identifier(composition.id, field + '.id'); revision(composition.revision, field + '.revision');
      record(composition.definition, field + '.definition');
      const folded = composition.id.toLowerCase();
      if (spellings.has(folded) && spellings.get(folded) !== composition.id)
        fail('DOCUMENT_COMPOSITION_ID_CASE', field + '.id', 'All revisions of a local composition must use the same ID spelling');
      spellings.set(folded, composition.id);
      const key = JSON.stringify([composition.id, composition.revision]);
      if (compositions.has(key)) fail('DUPLICATE_DOCUMENT_COMPOSITION', field, 'Duplicate local composition ID/revision');
      compositions.set(key, composition);
    }
  }
  const ids = new Set();
  for (const [i, slide] of doc.slides.entries()) {
    const field = `document.slides[${i}]`;
    closed(slide, ['id', 'name', 'width', 'height', 'theme', 'content'], field);
    identifier(slide.id, field + '.id');
    const folded = slide.id.toLowerCase();
    if (ids.has(folded)) fail('DUPLICATE_DOCUMENT_ID', field + '.id', 'Slide IDs are unique within the document, ASCII case-insensitive');
    ids.add(folded);
    if (owns(slide, 'name')) text(slide.name, field + '.name');
    if (owns(slide, 'theme')) identifier(slide.theme, field + '.theme');
    for (const key of ['width', 'height']) if (owns(slide, key)) dimension(slide[key], field + '.' + key);
    closed(slide.content, ['kind', 'ref', 'data'], field + '.content');
    const content = slide.content;
    record(content.data, field + '.content.data');
    if (content.kind === 'authored') {
      if (owns(content, 'ref')) fail('INVALID_DOCUMENT_REFERENCE', field + '.content.ref', 'Authored content has inline data and no reference');
    } else if (content.kind === 'template') {
      closed(content.ref, ['libraryId', 'templateId', 'revision', 'integrity'], field + '.content.ref');
      identifier(content.ref.libraryId, field + '.content.ref.libraryId');
      identifier(content.ref.templateId, field + '.content.ref.templateId');
      revision(content.ref.revision, field + '.content.ref.revision');
      // External library availability/revision resolution is explicitly F2.
    } else if (content.kind === 'local') {
      closed(content.ref, ['compositionId', 'revision', 'integrity'], field + '.content.ref');
      identifier(content.ref.compositionId, field + '.content.ref.compositionId');
      revision(content.ref.revision, field + '.content.ref.revision');
      if (!compositions.has(JSON.stringify([content.ref.compositionId, content.ref.revision])))
        fail('UNKNOWN_DOCUMENT_COMPOSITION', field + '.content.ref', 'Local composition ID/revision must resolve exactly; no latest/case fallback');
    } else fail('INVALID_DOCUMENT_CONTENT', field + '.content.kind', 'Expected template, local or authored');
    if (content.ref && owns(content.ref, 'integrity') && (typeof content.ref.integrity !== 'string' || !/^[a-f0-9]{64}$/.test(content.ref.integrity)))
      fail('INVALID_DOCUMENT_REFERENCE', field + '.content.ref.integrity', 'Expected lowercase SHA-256');
  }
  return doc;
}
function serialize(input) { return JSON.stringify(normalize(input)); }
function deserialize(json) {
  if (typeof json !== 'string') fail('INVALID_DOCUMENT_JSON', 'json', 'Expected JSON text');
  if (Buffer.byteLength(json, 'utf8') > limits.maxBytes) fail('DOCUMENT_BUDGET_EXCEEDED', 'json', 'JSON text exceeds maxBytes');
  let input;
  try { input = JSON.parse(json.replace(/^\uFEFF/, '')); }
  catch { fail('INVALID_DOCUMENT_JSON', 'json', 'Invalid JSON syntax'); }
  return normalize(input);
}
function findSlide(doc, slideId) {
  identifier(slideId, 'slideId');
  const index = doc.slides.findIndex(slide => slide.id === slideId);
  if (index < 0) fail('DOCUMENT_SLIDE_NOT_FOUND', 'slideId', 'Slide lookup uses exact ID spelling');
  return index;
}
function renameSlide(input, slideId, name) {
  const doc = normalize(input), index = findSlide(doc, slideId);
  text(name, 'name'); doc.slides[index].name = name;
  return normalize(doc);
}
function duplicateSlide(input, slideId, newId) {
  const doc = normalize(input), index = findSlide(doc, slideId);
  identifier(newId, 'newId');
  if (doc.slides.some(slide => slide.id.toLowerCase() === newId.toLowerCase()))
    fail('DUPLICATE_DOCUMENT_ID', 'newId', 'A duplicate requires a new unique slide instance ID');
  const duplicate = cloneJson(doc.slides[index]);
  duplicate.id = newId;
  doc.slides.splice(index + 1, 0, duplicate);
  return normalize(doc);
}
module.exports = Object.freeze({ normalize, serialize, deserialize, renameSlide, duplicateSlide, limits });
