const { inflateRawSync } = require('node:zlib');
const comments = require('./comments.cjs');
const MAX = 300 * 1024 * 1024, JSON_MAX = 8 * 1024 * 1024, IMAGE_MAX = 32 * 1024 * 1024;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireValue = (value, code = 'COMMENTS_INVALID_ZIP') => { if (!value) fail(code); };
let crcTable;
function crc(bytes) {
  crcTable ||= Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
  let result = 0xffffffff;
  for (const byte of bytes) result = crcTable[(result ^ byte) & 255] ^ result >>> 8;
  return (result ^ 0xffffffff) >>> 0;
}
function verifyImage(bytes, context) {
  requireValue(Buffer.isBuffer(bytes) && bytes.length <= IMAGE_MAX, 'COMMENTS_IMAGE_BUDGET');
  requireValue(comments.hash(bytes) === context.pngSha256, 'COMMENTS_IMAGE_HASH');
  const { png } = require('./pptx-package.cjs');
  let info; try { info = png(bytes); } catch { fail('COMMENTS_INVALID_PNG'); }
  requireValue(info[0] === context.width && info[1] === context.height, 'COMMENTS_IMAGE_SIZE');
  return bytes;
}
function imagesNeeded(document) { return [...new Set(document.contexts.map(context => context.pngSha256))]; }
async function encode(input, readImage) {
  const document = comments.validate(input), { JSZip } = require('./vendor/pptx/backend.cjs');
  const zip = new JSZip(); zip.file('comments.json', comments.serialize(document));
  let total = JSON_MAX;
  for (const sha of imagesNeeded(document)) {
    const bytes = await readImage(sha);
    requireValue(bytes, 'COMMENTS_IMAGE_MISSING');
    for (const context of document.contexts.filter(context => context.pngSha256 === sha)) verifyImage(bytes, context);
    total += bytes.length; requireValue(total <= MAX, 'COMMENTS_BUNDLE_BUDGET');
    zip.file(`images/${sha}.png`, bytes, { createFolders: false });
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}
// Read central AND local headers before inflation. JSZip sanitizes traversal names;
// inspecting original names avoids accepting a silently renamed malicious entry.
function entries(bytes) {
  requireValue(Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes.length <= MAX + JSON_MAX, 'COMMENTS_BUNDLE_BUDGET');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  requireValue(end >= 0);
  const count = bytes.readUInt16LE(end + 10), start = bytes.readUInt32LE(end + 16), size = bytes.readUInt32LE(end + 12);
  requireValue(!bytes.readUInt16LE(end + 4) && !bytes.readUInt16LE(end + 6) && count === bytes.readUInt16LE(end + 8));
  requireValue(count > 0 && count <= 2001 && start + size === end);
  const result = [], names = new Set(), ranges = []; let pos = start, total = 0;
  for (let i = 0; i < count; i++) {
    requireValue(pos + 46 <= end && bytes.readUInt32LE(pos) === 0x02014b50);
    const flags = bytes.readUInt16LE(pos + 8), method = bytes.readUInt16LE(pos + 10), checksum = bytes.readUInt32LE(pos + 16);
    const compressed = bytes.readUInt32LE(pos + 20), expanded = bytes.readUInt32LE(pos + 24), nameLength = bytes.readUInt16LE(pos + 28);
    const extraLength = bytes.readUInt16LE(pos + 30), commentLength = bytes.readUInt16LE(pos + 32), local = bytes.readUInt32LE(pos + 42);
    const external = bytes.readUInt32LE(pos + 38);
    requireValue(pos + 46 + nameLength + extraLength + commentLength <= end && (flags & ~0x800) === 0 && [0, 8].includes(method));
    requireValue(!bytes.readUInt16LE(pos + 34) && ((external >>> 16) & 0xf000) !== 0xa000, 'COMMENTS_UNSAFE_ZIP');
    const nameBytes = bytes.subarray(pos + 46, pos + 46 + nameLength), name = nameBytes.toString('utf8');
    requireValue(name === 'comments.json' || /^images\/[a-f0-9]{64}\.png$/.test(name), 'COMMENTS_UNSAFE_ZIP');
    requireValue(!names.has(name), 'COMMENTS_DUPLICATE_ZIP_ENTRY'); names.add(name);
    requireValue(expanded <= (name === 'comments.json' ? JSON_MAX : IMAGE_MAX), 'COMMENTS_BUNDLE_BUDGET');
    total += expanded; requireValue(total <= MAX, 'COMMENTS_BUNDLE_BUDGET');
    requireValue(local + 30 <= start && bytes.readUInt32LE(local) === 0x04034b50);
    const localNameLength = bytes.readUInt16LE(local + 26), localExtraLength = bytes.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
    requireValue(dataEnd <= start && dataStart <= dataEnd && bytes.readUInt16LE(local + 6) === flags && bytes.readUInt16LE(local + 8) === method);
    requireValue(bytes.readUInt32LE(local + 14) === checksum && bytes.readUInt32LE(local + 18) === compressed && bytes.readUInt32LE(local + 22) === expanded);
    requireValue(nameBytes.equals(bytes.subarray(local + 30, local + 30 + localNameLength)));
    ranges.push([local, dataEnd]); result.push({ name, dataStart, dataEnd, method, expanded, checksum });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  requireValue(pos === end && names.has('comments.json'));
  ranges.sort((a, b) => a[0] - b[0]);
  requireValue(ranges.every((range, i) => !i || ranges[i - 1][1] <= range[0]), 'COMMENTS_UNSAFE_ZIP');
  return result;
}
function decode(bytes) {
  const files = new Map();
  for (const item of entries(bytes)) {
    let content;
    try { content = item.method === 0 ? bytes.subarray(item.dataStart, item.dataEnd) : inflateRawSync(bytes.subarray(item.dataStart, item.dataEnd), { maxOutputLength: Math.max(1, item.expanded) }); }
    catch { fail('COMMENTS_INVALID_ZIP'); }
    requireValue(content.length === item.expanded && crc(content) === item.checksum, 'COMMENTS_ZIP_CRC');
    files.set(item.name, content);
  }
  const document = comments.parse(files.get('comments.json')), images = new Map();
  for (const sha of imagesNeeded(document)) {
    const bytes = files.get(`images/${sha}.png`); requireValue(bytes, 'COMMENTS_IMAGE_MISSING');
    for (const context of document.contexts.filter(context => context.pngSha256 === sha)) verifyImage(bytes, context);
    images.set(sha, bytes);
  }
  requireValue(files.size === images.size + 1, 'COMMENTS_UNUSED_ZIP_ENTRY');
  return { document, images };
}
module.exports = { encode, decode, verifyImage };
