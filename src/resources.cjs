const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createHash } = require('node:crypto');
const postcss = require('postcss');
const valueParser = require('postcss-value-parser');
const { check, fail } = require('./runtime.cjs');
const within = (root, file) => { const rel = path.relative(root, file); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); };
const mime = { '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const dataUrl = (type, bytes) => `data:${type};base64,${bytes.toString('base64')}`;
// URL percent-decoding operates on bytes. A literal/malformed '%' is retained;
// decodeURIComponent instead throws and also rejects non-UTF-8 binary resources.
function percentDecodeData(value) {
  const input = Buffer.from(value, 'utf8'), output = Buffer.allocUnsafe(input.length);
  const hex = n => n >= 48 && n <= 57 ? n - 48 : n >= 65 && n <= 70 ? n - 55 : n >= 97 && n <= 102 ? n - 87 : -1;
  let length = 0;
  for (let i = 0; i < input.length; i++) {
    const a = hex(input[i + 1]), b = hex(input[i + 2]);
    if (input[i] === 37 && a >= 0 && b >= 0) { output[length++] = a * 16 + b; i += 2; }
    else output[length++] = input[i];
  }
  return output.subarray(0, length);
}
function svgText(bytes) {
  const le = bytes[0] === 255 && bytes[1] === 254 || bytes[0] === 60 && bytes[1] === 0 && bytes[2] === 63 && bytes[3] === 0;
  const be = bytes[0] === 254 && bytes[1] === 255 || bytes[0] === 0 && bytes[1] === 60 && bytes[2] === 0 && bytes[3] === 63;
  const encoding = le ? 'utf-16le' : be ? 'utf-16be' : 'utf-8';
  let source = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  const normalizations = encoding === 'utf-8' ? [] : [encoding + '-to-utf8'];
  // Corel/Illustrator assets commonly retain this inert public identifier. Strip
  // exactly the standard declaration without loading its DTD or accepting entities.
  const standard = /<!DOCTYPE\s+svg\s+PUBLIC\s+["']-\/\/W3C\/\/DTD SVG 1\.1\/\/EN["']\s+["']https?:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd["']\s*>/i;
  if (standard.test(source)) { source = source.replace(standard, ''); normalizations.push('strip-standard-svg11-doctype'); }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw fail('UNPACKABLE_SVG', 'SVG external XML declarations/entities are unsupported');
  return { source, normalizations };
}
// CSS escapes are decoded before resolving a URL; strings/comments are handled
// by the value parser rather than a URL regex over the stylesheet.
function cssUnescape(text) { return text.replace(/\\(?:\r\n|[\r\n\f])/g, '').replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\n\r\f])?|([^\r\n\f]))/gi, (_, hex, char) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : char); }
function normalizeFunctions(input) {
  // value-parser splits identifiers at a hex-escape terminator space. Normalize
  // only recognized function identifiers, leaving strings/comments/URL bytes
  // untouched. This is lexical preparation, not regex rewriting of CSS URLs.
  let out = '', i = 0;
  while (i < input.length) {
    const start = i, char = input[i];
    if (char === '"' || char === "'") {
      i++; while (i < input.length) { if (input[i] === '\\') { i += 2; continue; } if (input[i++] === char) break; }
    } else if (input.slice(i,i+2) === '/*') { const end = input.indexOf('*/',i+2); i = end < 0 ? input.length : end+2; }
    else if (/[-_a-z\\\u0080-\uffff]/i.test(char)) {
      while (i < input.length) {
        if (/[-_a-z0-9\u0080-\uffff]/i.test(input[i])) { i++; continue; }
        if (input[i] !== '\\') break;
        const escape = /^\\(?:[0-9a-f]{1,6}(?:\r\n|[ \t\n\r\f])?|[^\r\n\f])/i.exec(input.slice(i));
        if (!escape) { i++; break; } i += escape[0].length;
      }
      const name = cssUnescape(input.slice(start,i)).toLowerCase();
      if (input[i] === '(' && ['url','local','image-set','-webkit-image-set','var','env','attr'].includes(name)) { out += name; continue; }
    } else i++;
    out += input.slice(start,i);
  }
  return out;
}
function srcset(value) {
  const result = []; let i = 0;
  while (i < value.length) {
    while (/[\s,]/.test(value[i] || '') && i < value.length) i++;
    if (i >= value.length) break;
    const start = i; while (i < value.length && !/\s/.test(value[i])) i++;
    let url = value.slice(start, i), descriptor = '';
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else { const from = i; while (i < value.length && value[i] !== ',') i++; descriptor = value.slice(from, i).trim(); i++; }
    if (!url || descriptor && !/^(?:[1-9][0-9]*w|(?:[0-9]*\.)?[0-9]+x)$/.test(descriptor)) throw fail('UNPACKABLE_SRCSET', 'Unsupported srcset syntax');
    result.push({ url, descriptor });
  }
  return result;
}

async function createResourceBundler(project, settings) {
  const parser = await import('parse5');
  const roots = [];
  for (const root of [project.root, ...Object.values(project.staticMounts || {})]) {
    try { roots.push(await fs.realpath(root)); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
  }
  const records = [], failures = [], cache = new Map(); let total = 0;
  const issue = (code, message, url) => { const item = { code, message, url }; failures.push(item); records.push({ url, state: 'blocked', code }); };
  const attrs = node => node.attrs || [];
  const attr = (node, name) => attrs(node).find(item => item.name === name);
  const nodes = root => [root, ...(root.childNodes || []).flatMap(nodes), ...(root.content ? nodes(root.content) : [])];
  const text = node => (node.childNodes || []).filter(child => child.nodeName === '#text').map(child => child.value).join('');
  const setText = (node, value) => { node.childNodes = [{ nodeName: '#text', value, parentNode: node }]; };

  async function resource(raw, base, kind, stack) {
    check(settings.signal);
    if (!raw || raw.startsWith('#')) return raw;
    let url;
    try { url = new URL(raw, base); } catch { issue('UNPACKABLE_URL', 'Invalid resource URL', raw); return 'about:blank'; }
    if (!['file:', 'data:'].includes(url.protocol)) { issue('EXTERNAL_RESOURCE', 'Strict export cannot use external or unsupported resource URLs', url.href); return 'about:blank'; }
    if (url.protocol === 'file:' && (url.hostname || /^\/{2,}/.test(url.pathname))) { issue('EXTERNAL_RESOURCE', 'Remote file authorities and UNC paths are not offline resources', url.href); return 'about:blank'; }
    const fragment = url.hash; url.hash = '';
    const key = `${kind || 'asset'}:${url.href}`;
    if (stack.includes(key) || stack.length >= 32) { issue('RESOURCE_CYCLE', 'Cyclic or overly deep resource graph', url.href); return 'about:blank'; }
    if (cache.has(key)) return (await cache.get(key)) + fragment;
    if (cache.size >= 512) { issue('RESOURCE_BUDGET', 'At most 512 distinct resources per deck', url.href); return 'about:blank'; }
    const promise = (async () => {
      try {
        let bytes, type, normalizations = [];
        if (url.protocol === 'data:') {
          const match = /^data:([^;,]*)(;[^,]*)?,([\s\S]*)$/i.exec(url.href);
          if (!match) throw fail('UNPACKABLE_URL', 'Invalid data URL');
          type = match[1].toLowerCase() || 'text/plain';
          const decoded = percentDecodeData(match[3]);
          bytes = /;base64/i.test(match[2] || '') ? Buffer.from(decoded.toString('ascii'), 'base64') : decoded;
        } else {
          const file = await fs.realpath(fileURLToPath(url));
          if (!roots.some(root => within(root, file))) throw fail('RESOURCE_PATH_ESCAPE', 'Resource is outside declared source roots/mounts');
          const stat = await fs.stat(file);
          if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw fail('RESOURCE_BUDGET', 'Resource must be a file up to 16 MiB');
          bytes = await fs.readFile(file); type = mime[path.extname(file).toLowerCase()];
        }
        if (!type || !Object.values(mime).includes(type)) throw fail('UNPACKABLE_RESOURCE', 'Unsupported resource media type');
        total += bytes.length;
        if (bytes.length > 16 * 1024 * 1024 || total > 64 * 1024 * 1024) throw fail('RESOURCE_BUDGET', 'Deck resource budget is 64 MiB, at most 16 MiB per resource');
        const originalBytes = bytes;
        if (kind === 'css' || type === 'text/css') bytes = Buffer.from(await css(bytes.toString('utf8'), url.href, [...stack, key]));
        if (type === 'image/svg+xml') {
          const decoded = svgText(bytes), source = decoded.source; normalizations = decoded.normalizations;
          const tree = parser.parseFragment(source);
          if (!nodes(tree).some(node => node.tagName === 'svg') || nodes(tree).some(node => ['script', 'foreignObject', 'iframe', 'animate', 'animateMotion', 'animateTransform', 'set'].includes(node.tagName))) throw fail('UNPACKABLE_SVG', 'SVG must be static without script, animation or foreignObject');
          if (settings.fonts.policy === 'strict' && nodes(tree).some(node => node.tagName === 'text')) throw fail('UNPACKABLE_SVG', 'External SVG text requires explicit font substitution permission or conversion to paths');
          await rewrite(tree, url.href, [...stack, key]); bytes = Buffer.from(parser.serialize(tree));
        }
        const encoded = dataUrl(type, bytes);
        records.push({ url: url.protocol === 'data:' ? `data:${type}` : url.href, state: 'embedded', mediaType: type, bytes: originalBytes.length, sha256: createHash('sha256').update(originalBytes).digest('hex'), ...(normalizations.length ? { normalizations } : {}) });
        return encoded;
      } catch (cause) {
        if (cause.code === 'CANCELLED') throw cause;
        issue(cause.code || 'RESOURCE_READ_FAILED', cause.message, url.href); return 'about:blank';
      }
    })();
    cache.set(key, promise);
    return (await promise) + fragment;
  }

  async function cssValue(input, base, stack) {
    const parsed = valueParser(normalizeFunctions(input)), work = [];
    parsed.walk(node => {
      const name = node.type === 'function' ? cssUnescape(node.value).toLowerCase() : '';
      if (name === 'url') {
        node.value = 'url';
        const raw = node.nodes.length === 1 && node.nodes[0].type === 'string' ? node.nodes[0].value : valueParser.stringify(node.nodes).trim();
        work.push(async () => { const value = await resource(cssUnescape(raw), base, undefined, stack); node.nodes = [{ type: 'string', quote: '"', value }]; }); return false;
      }
      if (name === 'local' && settings.fonts.policy === 'strict') issue('LOCAL_FONT_SOURCE', 'local() fonts are not portable; supply an explicit font file', base);
      if (/^(?:-webkit-)?image-set$/.test(name)) {
        node.value = name;
        valueParser.walk(node.nodes, child => {
          if (child.type === 'function' && ['var', 'env', 'attr'].includes(cssUnescape(child.value).toLowerCase())) issue('UNRESOLVED_RESOURCE', 'image-set substitutions require prior static preparation', base);
        });
        for (const child of node.nodes) if (child.type === 'string') work.push(async () => { child.value = await resource(cssUnescape(child.value), base, undefined, stack); });
      }
    });
    for (const item of work) await item();
    return parsed.toString();
  }
  async function css(input, base, stack) {
    let root;
    try { root = postcss.parse(input, { from: undefined }); }
    catch (cause) { issue('UNPACKABLE_CSS', cause.reason, base); return ''; }
    const imports = []; root.walkAtRules(rule => {
      // PostCSS splits an escaped at-keyword into name + params without a
      // separator. Recover that token before testing the actual CSS name.
      if (!rule.raws.afterName && rule.params.startsWith('\\')) {
        const token = /^(?:\\(?:[0-9a-f]{1,6}(?:\r\n|[ \t\n\r\f])?|[^\r\n\f])|[-_a-z0-9])+/i.exec(rule.params)?.[0];
        if (token) { rule.name += token; rule.params = rule.params.slice(token.length).trimStart(); }
      }
      if (cssUnescape(rule.name).toLowerCase() === 'import') { rule.name = 'import'; rule.raws.afterName = ' '; imports.push(rule); }
    });
    for (const rule of imports) {
      const parsed = valueParser(normalizeFunctions(rule.params)), first = parsed.nodes.find(node => !['space', 'comment'].includes(node.type));
      const url = first?.type === 'string' ? first.value : first?.type === 'function' && cssUnescape(first.value).toLowerCase() === 'url' ? valueParser.stringify(first.nodes).replace(/^(['"])([\s\S]*)\1$/, '$2') : undefined;
      if (!url) { issue('UNPACKABLE_CSS', 'Unrecognized CSS import', base); continue; }
      const value = await resource(cssUnescape(url), base, 'css', stack);
      if (first.type === 'string') first.value = value; else { first.value = 'url'; first.nodes = [{ type: 'string', quote: '"', value }]; }
      rule.params = parsed.toString();
    }
    const declarations = []; root.walkDecls(decl => declarations.push(decl));
    for (const decl of declarations) decl.value = await cssValue(decl.value, base, stack);
    return root.toString();
  }
  async function rewrite(tree, base, stack = []) {
    for (const node of nodes(tree)) {
      check(settings.signal);
      if (node.tagName === 'base') { node.parentNode.childNodes = node.parentNode.childNodes.filter(item => item !== node); continue; }
      if (['script', 'iframe', 'object', 'embed', 'canvas', 'video', 'audio', 'animate', 'animateMotion', 'animateTransform', 'set'].includes(node.tagName) || attrs(node).some(item => /^on/i.test(item.name)) || node.tagName === 'meta' && attr(node, 'http-equiv')?.value.toLowerCase() === 'refresh') issue('UNSUPPORTED_HTML', 'Dynamic HTML requires static preparation', base);
      if (node.tagName === 'style') setText(node, await css(text(node), base, stack));
      for (const item of attrs(node)) {
        if (item.name === 'base' && item.prefix === 'xml') issue('UNPACKABLE_SVG', 'xml:base requires prior static preparation', base);
        if (['style', 'fill', 'stroke', 'filter', 'mask', 'clip-path', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'cursor'].includes(item.name)) { item.value = await cssValue(item.value, base, stack); continue; }
        if (['srcset', 'imagesrcset'].includes(item.name)) {
          try { const candidates = srcset(item.value); for (const candidate of candidates) candidate.url = await resource(candidate.url, base, undefined, stack); item.value = candidates.map(c => `${c.url}${c.descriptor ? ' ' + c.descriptor : ''}`).join(', '); }
          catch (cause) { issue(cause.code || 'UNPACKABLE_SRCSET', cause.message, base); }
          continue;
        }
        if (['src', 'href', 'poster', 'data', 'background'].includes(item.name) && item.value && !item.value.startsWith('#')) {
          if (node.tagName === 'a') { issue('UNPACKABLE_LINK', 'Offline export only supports fragment navigation links', item.value); continue; }
          if (node.tagName === 'base') continue;
          const kind = node.tagName === 'link' && /\bstylesheet\b/i.test(attr(node, 'rel')?.value || '') ? 'css' : undefined;
          item.value = await resource(item.value, base, kind, stack);
          // Embedded resource bytes differ from their source checksum.
          node.attrs = node.attrs.filter(attribute => !['integrity', 'crossorigin'].includes(attribute.name));
        }
      }
    }
  }
  return { records, failures, async bundle(html, sourceUrl) {
    const tree = parser.parse(html), base = nodes(tree).find(node => node.tagName === 'base' && attr(node, 'href'));
    const effective = base ? new URL(attr(base, 'href').value, sourceUrl).href : sourceUrl;
    await rewrite(tree, effective);
    return parser.serialize(tree);
  } };
}
module.exports = { createResourceBundler, srcset };
