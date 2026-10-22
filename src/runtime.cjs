const fail = (code, message, context = {}) => Object.assign(new Error(message), { code, ...context });
function options(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('INVALID_OPTIONS', 'Expected render options');
  const allowed = ['deckId', 'outputRoot', 'browser', 'signal', 'onProgress', 'hookTimeoutMs', 'pageTimeoutMs', 'warnings'];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw fail('INVALID_OPTIONS', `Unknown render option: ${key}`);
  for (const key of ['hookTimeoutMs', 'pageTimeoutMs']) if (input[key] !== undefined && (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > 300000)) throw fail('INVALID_OPTIONS', `${key} must be an integer from 1 to 300000`);
  if (input.deckId !== undefined && typeof input.deckId !== 'string') throw fail('INVALID_OPTIONS', 'deckId must be a string');
  if (input.outputRoot !== undefined && (typeof input.outputRoot !== 'string' || !input.outputRoot.trim())) throw fail('INVALID_OPTIONS', 'outputRoot must be a nonempty string');
  if (input.onProgress !== undefined && typeof input.onProgress !== 'function') throw fail('INVALID_OPTIONS', 'onProgress must be a function');
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) throw fail('INVALID_OPTIONS', 'signal must be an AbortSignal');
  if (input.warnings !== undefined && !['fail', 'report'].includes(input.warnings)) throw fail('INVALID_OPTIONS', 'warnings must be fail or report');
  return { hookTimeoutMs: 30000, pageTimeoutMs: 30000, warnings: 'fail', ...input };
}
function check(signal) { if (signal?.aborted) throw fail('CANCELLED', 'Render was cancelled'); }
async function bounded(work, ms, signal, stage) {
  check(signal);
  let timer, abort;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(fail('TIMEOUT', `Timed out: ${stage}`, { stage })), ms);
        if (signal) { abort = () => reject(fail('CANCELLED', 'Render was cancelled', { stage })); signal.addEventListener('abort', abort, { once: true }); }
      }),
    ]);
  } finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
}
async function hook(runtime, name, args, settings, type) {
  let value;
  try { value = await bounded(() => runtime[name](...args), settings.hookTimeoutMs, settings.signal, name); }
  catch (cause) { throw fail(cause?.code || 'HOOK_FAILED', cause?.message || String(cause), { stage: name }); }
  if (type === 'string' && typeof value !== 'string') throw fail('INVALID_HOOK_RESULT', `${name} must return a string`, { stage: name });
  if (type === 'void' && value !== undefined) throw fail('INVALID_HOOK_RESULT', `${name} must return undefined or throw`, { stage: name });
  return value;
}
function documentForRender({ html, baseUrl }) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let base = doc.querySelector('base[href]');
  if (base) base.href = new URL(base.getAttribute('href'), baseUrl).href;
  else { base = doc.createElement('base'); base.href = baseUrl; doc.head.prepend(base); }
  return '<!doctype html>' + doc.documentElement.outerHTML;
}
function staticInspection(doc = document) {
  const unsupported = [];
  if (doc.querySelector('script,iframe,object,embed,canvas,video,audio,animate,animateMotion,animateTransform,set,meta[http-equiv="refresh" i]')) unsupported.push('Executable or dynamic elements require preparation into static HTML');
  if ([...doc.querySelectorAll('*')].some(node => [...node.attributes].some(attr => /^on/i.test(attr.name) || /^(href|src|action)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)))) unsupported.push('Event handlers and javascript URLs are outside the static profile');
  if (doc.getAnimations().length) unsupported.push('CSS animations require preparation into static HTML');
  let unsupportedResource = [...doc.querySelectorAll('img,source,image,use,base,link[rel="stylesheet"]')].some(node => ['src', 'href', 'xlink:href', 'srcset'].some(name => {
    const value = (node.getAttribute(name) || '').trim();
    if (/^data:/i.test(value)) return false;
    return (name === 'srcset' ? /(^|,\s*)(?:\/|blob:)/i : /^(?:\/|blob:)/i).test(value);
  }));
  const visited = new Set();
  const inspectRules = sheet => {
    if (visited.has(sheet)) return;
    visited.add(sheet);
    try {
      for (const rule of sheet.cssRules || []) {
        if (/(?:url\(\s*["']?|@import\s*["'])(?:\/|blob:)/i.test(rule.cssText)) unsupportedResource = true;
        if (rule.styleSheet) inspectRules(rule.styleSheet);
        else if (rule.cssRules) inspectRules(rule);
      }
    } catch { /* Cross-origin CSSOM may be opaque; request diagnostics remain. */ }
  };
  [...doc.styleSheets].forEach(inspectRules);
  if (unsupportedResource) unsupported.push('Root-relative, protocol-relative and blob resource URLs require an explicit portable preparation');
  return unsupported;
}
async function readiness() {
  if (document.fonts?.ready) await document.fonts.ready;
  const images = [];
  await Promise.all([...document.images].map(async image => { try { await image.decode(); } catch { images.push(image.getAttribute('src')); } }));
  const fonts = [...(document.fonts || [])].filter(font => font.status === 'error').map(font => font.family);
  document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 0; });
  return { fonts, images };
}
function diagnostic(cause, context = {}) { return { severity: 'error', code: cause?.code || 'RENDER_FAILED', message: cause?.message || String(cause), ...(cause?.stage ? { stage: cause.stage } : {}), ...context }; }
module.exports = { options, check, bounded, hook, documentForRender, staticInspection, readiness, diagnostic, fail };
