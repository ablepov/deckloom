const limits = Object.freeze({ maxBytes: 8 * 1024 * 1024, maxDepth: 64, maxNodes: 100000 });
const owns = (value, key) => Object.hasOwn(value, key);
function fail(code, field, message) {
  throw Object.assign(new Error(`${code} at ${field}: ${message}`), { code, field });
}
const childField = (field, key) => field + '[' + JSON.stringify(key) + ']';

// Inspect own descriptors before reading values: JSON.stringify must never silently
// omit callbacks/undefined, coerce dates or invoke getters/toJSON on caller data.
// Plain Proxy traps cannot be detected without running them; callers are trusted JS.
function cloneJson(input, rootField = 'document') {
  const active = new WeakSet();
  let nodes = 0, bytes = 0;
  function budget(size, field) {
    bytes += size;
    if (bytes > limits.maxBytes) fail('DOCUMENT_BUDGET_EXCEEDED', field, 'JSON exceeds maxBytes');
  }
  function clone(value, field, depth) {
    if (++nodes > limits.maxNodes || depth > limits.maxDepth)
      fail('DOCUMENT_BUDGET_EXCEEDED', field, 'JSON exceeds maxNodes/maxDepth');
    if (value === null) { budget(4, field); return null; }
    if (typeof value === 'string') { budget(Buffer.byteLength(JSON.stringify(value), 'utf8'), field); return value; }
    if (typeof value === 'boolean') { budget(value ? 4 : 5, field); return value; }
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) {
      budget(String(value).length, field); return value;
    }
    if (!value || typeof value !== 'object')
      fail('DOCUMENT_NON_JSON_VALUE', field, 'Expected finite JSON values; negative zero, functions, undefined and symbols are not supported');
    const isArray = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype : ![Object.prototype, null].includes(prototype))
      fail('DOCUMENT_NON_JSON_VALUE', field, 'Only plain JSON records/arrays are supported');
    if (active.has(value)) fail('DOCUMENT_NON_JSON_VALUE', field, 'Cycles cannot be serialized');
    active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string')) fail('DOCUMENT_NON_JSON_VALUE', field, 'Symbol keys cannot be serialized');
    const result = isArray ? [] : {};
    budget(2, field);
    if (isArray) {
      const length = descriptors.length.value;
      if (length > limits.maxNodes) fail('DOCUMENT_BUDGET_EXCEEDED', field, 'Array exceeds maxNodes');
      if (keys.length !== length + 1 || keys.some(key => key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)))
        fail('DOCUMENT_NON_JSON_VALUE', field, 'Sparse arrays and additional array properties cannot be serialized');
      for (let i = 0; i < length; i++) {
        const descriptor = descriptors[i];
        if (!descriptor || !owns(descriptor, 'value') || !descriptor.enumerable)
          fail('DOCUMENT_NON_JSON_VALUE', `${field}[${i}]`, 'Array entries must be enumerable data properties');
        if (i) budget(1, field);
        result.push(clone(descriptor.value, `${field}[${i}]`, depth + 1));
      }
    } else {
      for (const [index, key] of keys.entries()) {
        const descriptor = descriptors[key], next = childField(field, key);
        if (!owns(descriptor, 'value') || !descriptor.enumerable)
          fail('DOCUMENT_NON_JSON_VALUE', next, 'Properties must be enumerable data properties without getters');
        budget(Buffer.byteLength(JSON.stringify(key), 'utf8') + 1 + (index ? 1 : 0), next);
        Object.defineProperty(result, key, { value: clone(descriptor.value, next, depth + 1), enumerable: true, writable: true, configurable: true });
      }
    }
    active.delete(value);
    return result;
  }
  return clone(input, rootField, 0);
}
module.exports = { cloneJson, limits };
