// Narrow validation/normalization for the pinned backend, never a general repair tool.
const path = require('node:path').posix;
const { createHash } = require('node:crypto');
const { JSZip, DOMParser, XMLSerializer } = require('./vendor/pptx/backend.cjs');
const { fail } = require('./runtime.cjs');
const { inflateSync } = require('node:zlib');
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types',
  REL = 'http://schemas.openxmlformats.org/package/2006/relationships',
  R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  P = 'http://schemas.openxmlformats.org/presentationml/2006/main',
  A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function requirePart(value, code) {
  if (!value) throw fail('PPTX_PACKAGE_' + code, code, { stage: 'pptx-package' });
}
function xml(bytes) {
  requirePart(bytes && !/<!DOCTYPE|<!ENTITY/i.test(bytes.toString('utf8')), 'XML_DECLARATION');
  return new DOMParser({
    onError: () => {
      throw fail('PPTX_PACKAGE_XML', 'Malformed package XML');
    },
  }).parseFromString(bytes.toString('utf8'), 'text/xml');
}
const children = (node) => Array.from(node.childNodes).filter((node) => node.nodeType === 1);
const all = (doc, ns, name) => Array.from(doc.getElementsByTagNameNS(ns, name));
function paragraphs(docs, slides, allowKnown) {
  const repairs = [],
    serialize = (node) => new XMLSerializer().serializeToString(node);
  for (const part of slides)
    for (const shape of [...all(docs.get(part), P, 'sp'), ...all(docs.get(part), A, 'tc')]) {
      const body = children(shape).find((node) => [P, A].includes(node.namespaceURI) && node.localName === 'txBody');
      if (!body) continue;
      const shapeName = all(shape, P, 'cNvPr')[0]?.getAttribute('name');
      let index = 0;
      for (const paragraph of children(body).filter((node) => node.namespaceURI === A && node.localName === 'p')) {
        index++;
        const nodes = children(paragraph),
          properties = nodes.filter((node) => node.namespaceURI === A && node.localName === 'pPr'),
          end = nodes.filter((node) => node.namespaceURI === A && node.localName === 'endParaRPr');
        requirePart(
          nodes.every((node) => node.namespaceURI === A && ['pPr', 'r', 'br', 'endParaRPr'].includes(node.localName)),
          'PARAGRAPH_STRUCTURE',
        );
        requirePart(end.length <= 1 && (!end.length || nodes.at(-1) === end[0]), 'PARAGRAPH_STRUCTURE');
        requirePart(!properties.length || nodes[0] === properties[0], 'PARAGRAPH_PROPERTIES');
        if (properties.length > 1) {
          requirePart(
            allowKnown &&
              properties
                .slice(1)
                .every(
                  (node) =>
                    serialize(node) === serialize(properties[0]) &&
                    nodes[nodes.indexOf(node) + 1]?.namespaceURI === A &&
                    nodes[nodes.indexOf(node) + 1]?.localName === 'r',
                ),
            'PARAGRAPH_PROPERTIES',
          );
          repairs.push({ part, shapeName, paragraph: index, nodes: properties.slice(1) });
        }
      }
    }
  return repairs;
}
function zipNames(bytes) {
  requirePart(bytes.length < 32 * 1024 * 1024, 'BUDGET');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      end = i;
      break;
    }
  requirePart(end >= 0, 'ZIP_DIRECTORY');
  requirePart(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0, 'ZIP_DISK');
  const count = bytes.readUInt16LE(end + 10),
    offset = bytes.readUInt32LE(end + 16),
    size = bytes.readUInt32LE(end + 12),
    names = new Set();
  let pos = offset,
    total = 0;
  requirePart(count > 0 && count < 2048 && bytes.readUInt16LE(end + 8) === count && offset + size === end, 'BUDGET');
  for (let n = 0; n < count; n++) {
    requirePart(pos + 46 <= end && bytes.readUInt32LE(pos) === 0x02014b50, 'ZIP_DIRECTORY');
    const len = bytes.readUInt16LE(pos + 28),
      extra = bytes.readUInt16LE(pos + 30),
      comment = bytes.readUInt16LE(pos + 32);
    requirePart(pos + 46 + len + extra + comment <= end, 'ZIP_DIRECTORY');
    const name = bytes.subarray(pos + 46, pos + 46 + len).toString('utf8');
    requirePart(
      name &&
        !name.startsWith('/') &&
        !name.includes('\\') &&
        !name.includes(':') &&
        !name.split('/').some((p) => p === '..' || p === '.'),
      'PATH_ESCAPE',
    );
    requirePart(!names.has(name), 'DUPLICATE_ZIP_PART');
    names.add(name);
    requirePart(!(bytes.readUInt16LE(pos + 8) & 1) && [0, 8].includes(bytes.readUInt16LE(pos + 10)), 'ZIP_ENCODING');
    total += bytes.readUInt32LE(pos + 24);
    requirePart(total < 64 * 1024 * 1024, 'BUDGET');
    pos += 46 + len + extra + comment;
  }
  requirePart(pos === end, 'ZIP_DIRECTORY');
  return names;
}
async function load(bytes) {
  const names = zipNames(bytes);
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  } catch {
    throw fail('PPTX_PACKAGE_ZIP', 'Invalid package or CRC');
  }
  const files = new Map();
  for (const name of names)
    if (!name.endsWith('/')) {
      requirePart(zip.file(name), 'ZIP_PART');
      files.set(name, await zip.file(name).async('nodebuffer'));
    }
  return { zip, files };
}
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function png(bytes) {
  requirePart(bytes?.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'PNG_CONTENT_TYPE_MISMATCH');
  let pos = 8,
    first = true,
    ended = false,
    size,
    channels;
  const compressed = [];
  while (pos < bytes.length) {
    requirePart(pos + 12 <= bytes.length, 'PNG_CHUNK');
    const length = bytes.readUInt32BE(pos),
      end = pos + 12 + length;
    requirePart(end <= bytes.length, 'PNG_CHUNK');
    const type = bytes.toString('ascii', pos + 4, pos + 8);
    requirePart(crc(bytes.subarray(pos + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'PNG_CRC');
    if (first) {
      requirePart(type === 'IHDR' && length === 13, 'PNG_HEADER');
      size = [bytes.readUInt32BE(pos + 8), bytes.readUInt32BE(pos + 12)];
      requirePart(size.every((v) => v > 0 && v <= 16384) && size[0] * size[1] <= 16 * 1024 * 1024, 'PNG_BUDGET');
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[bytes[pos + 17]];
      requirePart(
        channels && bytes[pos + 16] === 8 && bytes[pos + 18] === 0 && bytes[pos + 19] === 0 && bytes[pos + 20] === 0,
        'PNG_PROFILE',
      );
      first = false;
    } else requirePart(type !== 'IHDR', 'PNG_HEADER');
    if (type === 'IDAT') compressed.push(bytes.subarray(pos + 8, end - 4));
    if (type === 'IEND') {
      requirePart(length === 0 && end === bytes.length, 'PNG_END');
      ended = true;
    }
    pos = end;
  }
  requirePart(ended && compressed.length, 'PNG_END');
  const stride = size[0] * channels + 1,
    expected = stride * size[1];
  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  } catch {
    throw fail('PPTX_PACKAGE_PNG_DECODE', 'Invalid or oversized PNG scanlines');
  }
  requirePart(decoded.length === expected, 'PNG_DECODE');
  for (let row = 0; row < size[1]; row++) requirePart(decoded[row * stride] <= 4, 'PNG_FILTER');
  return size;
}
function inspect(files, allowKnown = false) {
  const docs = new Map();
  for (const [name, bytes] of files) if (/\.(xml|rels)$/.test(name)) docs.set(name, xml(bytes));
  const ct = docs.get('[Content_Types].xml');
  requirePart(
    ct?.documentElement.namespaceURI === CT && ct.documentElement.localName === 'Types',
    'CONTENT_TYPES_ROOT',
  );
  const defaults = new Map(),
    overrides = new Map();
  for (const node of children(ct.documentElement)) {
    requirePart(node.namespaceURI === CT, 'CONTENT_TYPE_NODE');
    const isDefault = node.localName === 'Default';
    requirePart(isDefault || node.localName === 'Override', 'CONTENT_TYPE_NODE');
    const key = node.getAttribute(isDefault ? 'Extension' : 'PartName'),
      map = isDefault ? defaults : overrides;
    requirePart(key && !map.has(isDefault ? key.toLowerCase() : key), 'DUPLICATE_CONTENT_TYPE');
    map.set(isDefault ? key.toLowerCase() : key, node.getAttribute('ContentType'));
  }
  const slides = [...files.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  requirePart(slides.length > 0, 'SLIDES_MISSING');
  const known = new Set(
    Array.from({ length: slides.length - 1 }, (_, i) => `/ppt/slideMasters/slideMaster${i + 2}.xml`),
  );
  const orphan = [...overrides.keys()].filter((name) => !files.has(name.slice(1)));
  requirePart(
    orphan.every(
      (name) =>
        allowKnown &&
        known.has(name) &&
        overrides.get(name) === 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
    ),
    'UNKNOWN_ORPHAN_CONTENT_TYPE',
  );
  const relations = new Map();
  for (const [name, doc] of docs)
    if (name.endsWith('.rels')) {
      requirePart(
        doc.documentElement.namespaceURI === REL && doc.documentElement.localName === 'Relationships',
        'RELATIONSHIPS_ROOT',
      );
      const links = new Map(),
        base = path.dirname(path.dirname(name));
      for (const node of children(doc.documentElement)) {
        const id = node.getAttribute('Id'),
          target = node.getAttribute('Target');
        requirePart(node.namespaceURI === REL && node.localName === 'Relationship' && id && target, 'RELATIONSHIP');
        requirePart(!links.has(id), 'DUPLICATE_RELATIONSHIP_ID');
        requirePart(!node.getAttribute('TargetMode'), 'EXTERNAL_RELATIONSHIP');
        requirePart(!/[\\:#?%]/.test(target), 'RELATIONSHIP_ESCAPE');
        const resolved = path.normalize(path.join(base, target)).replace(/^\//, '');
        requirePart(!resolved.startsWith('../'), 'RELATIONSHIP_ESCAPE');
        requirePart(files.has(resolved), 'MISSING_RELATIONSHIP_TARGET');
        links.set(id, resolved);
      }
      relations.set(name, links);
    }
  requirePart(
    [...(relations.get('_rels/.rels')?.values() || [])].includes('ppt/presentation.xml'),
    'PRESENTATION_ROOT_MISSING',
  );
  const pairs = [];
  for (const slide of slides) {
    const links = relations.get(path.join(path.dirname(slide), '_rels', path.basename(slide) + '.rels')) || new Map();
    for (const pic of all(docs.get(slide), P, 'pic')) {
      const blips = all(pic, A, 'blip');
      requirePart(blips.length === 1, 'PICTURE_BLIP');
      const pngPart = links.get(blips[0].getAttributeNS(R, 'embed'));
      requirePart(pngPart, 'PICTURE_REFERENCE_MISSING');
      const svgs = Array.from(pic.getElementsByTagName('*')).filter((node) => node.localName === 'svgBlip');
      requirePart(svgs.length <= 1, 'AMBIGUOUS_SVG_REFERENCE');
      if (svgs.length) {
        const svgPart = links.get(svgs[0].getAttributeNS(R, 'embed'));
        requirePart(svgPart, 'SVG_REFERENCE_MISSING');
        pairs.push([pngPart, svgPart]);
      }
    }
  }
  const type = (name) => overrides.get('/' + name) || defaults.get(name.split('.').at(-1).toLowerCase());
  requirePart(
    type('ppt/presentation.xml') ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    'PRESENTATION_TYPE',
  );
  for (const slide of slides)
    requirePart(type(slide) === 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml', 'SLIDE_TYPE');
  for (const [name, bytes] of files) {
    requirePart(type(name), 'CONTENT_TYPE_MISSING');
    if (name.endsWith('.svg'))
      requirePart(
        type(name) === 'image/svg+xml' && xml(bytes).documentElement.namespaceURI === 'http://www.w3.org/2000/svg',
        'SVG_TYPE',
      );
    if (name.endsWith('.png')) {
      const knownBad = allowKnown && pairs.some(([p, s]) => p === name && bytes.equals(files.get(s)));
      if (!knownBad) {
        requirePart(type(name) === 'image/png', 'PNG_TYPE');
        png(bytes);
      }
    }
    requirePart(!name.startsWith('ppt/fonts/'), 'EMBEDDED_FONTS_UNSUPPORTED');
  }
  return { slides: slides.length, orphan, pairs, ct, docs, paragraphs: paragraphs(docs, slides, allowKnown) };
}
async function normalize(raw, rasters = new Map()) {
  const { zip, files } = await load(raw),
    finding = inspect(files, true),
    corrections = [];
  for (const node of children(finding.ct.documentElement))
    if (finding.orphan.includes(node.getAttribute('PartName'))) {
      finding.ct.documentElement.removeChild(node);
      corrections.push({ kind: 'known-orphan-master-override', part: node.getAttribute('PartName') });
    }
  if (finding.orphan.length) zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(finding.ct));
  // 4.0.1 repeats identical paragraph properties before each rich run.
  // All candidates were checked before mutation; differing properties fail closed.
  const changedSlides = new Set();
  for (const repair of finding.paragraphs) {
    for (const node of repair.nodes) node.parentNode.removeChild(node);
    changedSlides.add(repair.part);
  }
  for (const part of changedSlides) {
    const bytes = Buffer.from(new XMLSerializer().serializeToString(finding.docs.get(part)));
    zip.file(part, bytes);
    for (const repair of finding.paragraphs.filter((item) => item.part === part))
      corrections.push({
        kind: 'identical-rich-paragraph-properties',
        part,
        shapeName: repair.shapeName,
        paragraph: repair.paragraph,
        removed: repair.nodes.length,
        oldPartSha256: hash(files.get(part)),
        newPartSha256: hash(bytes),
      });
  }
  for (const [p, s] of finding.pairs)
    if (!files.get(p).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      requirePart(files.get(p).equals(files.get(s)), 'UNRECOGNIZED_SVG_FALLBACK');
      const svgHash = hash(files.get(s)),
        bytes = rasters.get(svgHash);
      requirePart(bytes, 'UNRECOGNIZED_SVG_SOURCE');
      const size = png(bytes);
      zip.file(p, bytes);
      corrections.push({
        kind: 'svg-png-fallback',
        part: p,
        svgPart: s,
        svgSha256: svgHash,
        oldSha256: hash(files.get(p)),
        newSha256: hash(bytes),
        size,
      });
    }
  const bytes = corrections.length ? await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : raw,
    verified = inspect((await load(bytes)).files);
  return {
    bytes,
    rawSha256: hash(raw),
    normalizedSha256: hash(bytes),
    corrections,
    verified: { slides: verified.slides, svgPairs: verified.pairs, fontParts: 0 },
  };
}
module.exports = { normalize, load, inspect, png };
