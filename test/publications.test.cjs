const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const publications = require('../src/index.cjs').publications;
function png() {
  const crc = bytes => { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; } return (n ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const bytes = Buffer.alloc(12 + data.length); bytes.writeUInt32BE(data.length); bytes.write(name, 4); data.copy(bytes, 8); bytes.writeUInt32BE(crc(bytes.subarray(4, -4)), bytes.length - 4); return bytes; };
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
function fixture() {
  const image = png(), pdf = Buffer.from('%PDF-1.7\nfixture');
  const entry = (file, bytes) => ({ file, bytes: bytes.length, sha256: publications.hash(bytes) });
  const manifest = { publicationVersion: 1, sourceId: 'brand', projectId: 'project', deckId: 'retail', releaseId: randomUUID(), shareId: 'a'.repeat(32), title: 'Retail — пример', publishedAt: '2026-10-23T09:00:00.000Z', generatedAt: '2026-10-23T08:59:00.000Z', engineVersion: '0.2.1', sourceSha256: 'b'.repeat(64),
    slides: [{ id: randomUUID(), name: 'Первый', width: 2, height: 1, image: entry('slides/001.png', image) }], downloads: { pdf: entry('downloads/retail.pdf', pdf) } };
  return { manifest, image, data: new Map([['slides/001.png', image], ['downloads/retail.pdf', pdf]]) };
}
test('publication survives portable round trip and verifies exact PNG/PDF bytes', async () => {
  const { manifest, data } = fixture();
  const parsed = publications.parse(JSON.stringify(manifest));
  assert.deepEqual(await publications.verify(parsed, file => data.get(file)), manifest);
  assert.equal(publications.files(parsed).length, 2);
  assert.notEqual(parsed, manifest);
});
test('corrupt bytes, mismatched geometry, unsafe paths and missing identity cannot activate', async () => {
  const { manifest, data } = fixture();
  await assert.rejects(() => publications.verify(manifest, () => Buffer.from('corrupt')), /integrity/);
  const wrong = structuredClone(manifest); wrong.slides[0].width = 3;
  await assert.rejects(() => publications.verify(wrong, file => data.get(file)), /dimensions/);
  for (const file of ['slides/../../secret.png', '/slides/x.png', 'slides//x.png', 'slides/x.png?secret=1']) {
    const bad = structuredClone(manifest); bad.slides[0].image.file = file;
    assert.throws(() => publications.validate(bad));
  }
  for (const key of ['projectId', 'sourceId', 'deckId']) { const bad = structuredClone(manifest); delete bad[key]; assert.throws(() => publications.validate(bad)); }
});
test('duplicate slides and undeclared secret fields are rejected', () => {
  const { manifest } = fixture();
  assert.throws(() => publications.validate({ ...manifest, slides: [...manifest.slides, ...manifest.slides] }));
  assert.throws(() => publications.validate({ ...manifest, accessKey: 'not-allowed' }));
  assert.throws(() => publications.validate({ ...manifest, publicationVersion: 2 }));
});
test('ready viewer reads one immutable revision and only configured formats', () => {
  const { manifest } = fixture();
  const url = file => `/files/${manifest.releaseId}/${file}`;
  const model = publications.viewModel(manifest, url);
  assert.equal(model.decks[0].slides[0].artifacts.png.version, manifest.slides[0].image.sha256);
  assert.equal(model.decks[0].slides[0].id, manifest.slides[0].id);
  assert.equal(model.decks[0].build.buildId, manifest.releaseId);
  const download = publications.downloadModel(manifest, url).decks[0];
  assert.equal(download.mode, 'ready'); assert.equal(download.pdf, true); assert.equal(download.pptx, false);
  assert.deepEqual(Object.keys(download.links), ['pdf']);
  assert.throws(() => publications.viewModel(manifest, () => 'javascript:alert(1)'));
  assert.throws(() => publications.downloadModel(manifest, () => 'https://name:secret@example.test/file'));
});
test('catalog cannot alias share IDs or deck identity and does not expose arbitrary paths', () => {
  const { manifest } = fixture();
  const { projectId, deckId, shareId, releaseId, title, publishedAt } = manifest;
  const catalog = { catalogVersion: 1, revisionId: randomUUID(), entries: [{ projectId, deckId, shareId, releaseId, title, publishedAt }] };
  assert.deepEqual(publications.parseCatalog(JSON.stringify(catalog)), catalog);
  assert.throws(() => publications.validateCatalog({ ...catalog, entries: [...catalog.entries, ...catalog.entries] }));
  assert.throws(() => publications.validateCatalog({ ...catalog, entries: [{ ...catalog.entries[0], manifest: '../../private.json' }] }));
});
