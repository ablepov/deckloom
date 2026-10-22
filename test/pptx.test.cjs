const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { test } = require('node:test'),
  { chromium } = require('playwright');
const { createRenderer, createReviewServer } = require('../src/index.cjs'),
  builds = require('../src/builds.cjs');
const pptx = require('../src/pptx.cjs'),
  pack = require('../src/pptx-package.cjs');
const example = require('../examples/pptx.config.cjs');
const profile = { mode: 'strict', fonts: { mode: 'reference', family: 'Arial', profile: 'windows-installed-v1' } };
async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-e3-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5 }));
  return root;
}
async function browser(t) {
  const b = await chromium.launch();
  t.after(() => b.close());
  return b;
}
const request = (outputRoot, b) => ({
  deckId: 'main',
  outputRoot,
  browser: b,
  formats: ['pptx'],
  fonts: { policy: 'allow-substitution' },
  pptx: profile,
});

test('PPTX explicit options/canvas and real platform profile fail before source preparation', async (t) => {
  const out = path.join(await temp(t), 'out'),
    renderer = createRenderer(example);
  for (const change of [
    { pptx: undefined },
    { pptx: { ...profile, mode: 'hybrid' } },
    { pptx: { ...profile, fonts: { ...profile.fonts, mode: 'embed' } } },
    { pptx: { ...profile, fonts: { ...profile.fonts, installed: true } } },
    { fonts: { policy: 'strict' } },
  ])
    await assert.rejects(renderer.export({ ...request(out), ...change }), { code: 'INVALID_PPTX_OPTIONS' });
  await assert.rejects(fs.stat(out), { code: 'ENOENT' });
  await assert.rejects(
    createRenderer({ ...example, decks: [{ ...example.decks[0], width: 1280 }] }).export(request(out)),
    { code: 'PPTX_UNSUPPORTED_CANVAS' },
  );
  if (process.platform !== 'win32') {
    const result = await renderer.export(request(out));
    assert.equal(result.error.code, 'PPTX_PLATFORM_UNSUPPORTED');
    assert.deepEqual(result.outputs, []);
  } else {
    const actual = await pptx.profile({ pageTimeoutMs: 30000 });
    assert.equal(actual.provider, 'windows-installed-v1');
    assert.equal(actual.embedded, false);
    assert(actual.styles.regular && actual.styles.bold && actual.styles.italic);
  }
});

test('strict DOM capture rejects unsupported paint/layout rather than dropping it', async (t) => {
  const b = await browser(t),
    p = await b.newPage({ viewport: { width: 960, height: 540 } });
  t.after(() => p.close());
  const original = example.renderDocument(null, { id: 'text' }),
    capture = async (html) => {
      await p.setContent(html);
      return p.evaluate(pptx.captureDocument);
    };
  assert(!(await capture(original)).error);
  const css = [
    '#title{outline:8px solid red}',
    '#title{text-indent:80px}',
    '#title{rotate:10deg}',
    '#title{-webkit-text-stroke:1px red}',
    '#title{-webkit-text-fill-color:red}',
    '#body span{position:relative;left:50px}',
    '#body span{letter-spacing:12px}',
    '#body span{white-space:normal}',
    '#body span{line-height:50px}',
    '#body{word-spacing:8px}',
    '#body{direction:rtl}',
    '#body{text-decoration:line-through}',
    '#body span{opacity:.5}',
    'main{overflow:hidden}',
    'main{display:flex}',
    '#body{display:flex}',
    '#title::first-letter{color:red}',
    '#title{z-index:2}',
    '#title{position:static}',
    '#body span{font-weight:700;font-style:italic}',
    '#body{font-kerning:none}',
    'main{zoom:2}',
    'main{padding:20px;box-sizing:border-box;background-clip:content-box}',
  ];
  for (const rule of css) assert((await capture(original.replace('</style>', rule + '</style>'))).error, rule);
  for (const html of [
    original.replace('data-deckloom-pptx="text"', ''),
    original.replace('</main>', '<div>lost</div></main>'),
    original.replace('</body>', '<div>outside</div></body>'),
    original.replace('id="body"', 'id="title"'),
    original.replace('Съёмка и ёжик: ', '\n\n'),
  ])
    assert((await capture(html)).error);
  const media = example.renderDocument(null, { id: 'media' }).replace('</style>', 'img{padding:10px}</style>');
  assert((await capture(media)).error);
  const layers = example
    .renderDocument(null, { id: 'layers' })
    .replace('background:#2456a6', 'background:#2456a6;padding:20px;background-clip:content-box');
  assert((await capture(layers)).error);
  const inherited = await capture(
    original
      .replace('style="font-weight:700"', 'style="font-weight:700;text-decoration:underline"')
      .replace('Съёмка и ёжик: ', '<span>Съёмка и ёжик: </span>'),
  );
  assert(!inherited.error);
  assert.equal(inherited.objects[1].runs[0].underline, true);
});

test(
  'public all-format export uses one prepared source, editable objects, canonical order and C publication',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = await temp(t),
      out = path.join(root, 'out'),
      b = await browser(t);
    let calls = [];
    const project = {
        ...example,
        renderDocument(d, s) {
          calls.push(s.id);
          return example.renderDocument(d, s);
        },
      },
      renderer = createRenderer(project);
    const first = await renderer.export({
      ...request(out, b),
      formats: ['pptx', 'png', 'pdf', 'html'],
      slideIds: ['media', 'text', 'layers'],
    });
    assert.equal(first.status, 'succeeded', JSON.stringify(first.diagnostics));
    assert.deepEqual(calls, ['text', 'layers', 'media']);
    assert.deepEqual(first.request.slideIds, calls);
    const output = first.outputs.find((o) => o.format === 'pptx'),
      manifest = JSON.parse(await fs.readFile(first.bundle.manifest, 'utf8'));
    assert.equal(manifest.pptx.verified.slides, 3);
    assert(manifest.pptx.corrections.some((c) => c.kind === 'svg-png-fallback'));
    assert.equal(manifest.pptx.fontProfile.family, 'Arial');
    const { files } = await pack.load(await fs.readFile(output.file)),
      xml = files.get('ppt/slides/slide1.xml').toString('utf8');
    assert(xml.includes('Кириллица — проверка переноса'));
    assert(xml.includes('b="1"'));
    assert(xml.includes('i="1"'));
    assert(xml.includes('u="sng"'));
    assert(!xml.includes('<p:pic>'));
    const layer = files.get('ppt/slides/slide2.xml').toString('utf8');
    assert(layer.indexOf('name="back"') < layer.indexOf('name="front"'));
    const final = await pack.normalize(await fs.readFile(output.file));
    assert.deepEqual(final.bytes, await fs.readFile(output.file));
    assert.deepEqual(final.corrections, []);
    const server = createReviewServer({ ...example, root: out });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/artifacts/${output.path}?build=${output.buildId}`,
      response = await fetch(url);
    assert.equal(response.headers.get('content-type'), output.mediaType);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, await fs.readFile(output.file));
    project.renderDocument = (d, s) =>
      example.renderDocument(d, s).replace('</style>', '#title{outline:2px solid red}</style>');
    const failed = await createRenderer(project).export(request(out, b));
    assert.equal(failed.error.code, 'PPTX_UNSUPPORTED_HTML');
    assert.deepEqual(failed.outputs, []);
    assert.equal((await builds.publication(out, 'main')).published.manifest.buildId, output.buildId);
    project.renderDocument = example.renderDocument;
    const controller = new AbortController();
    const cancelled = await createRenderer(project).export({
      ...request(out, b),
      signal: controller.signal,
      onProgress: (e) => {
        if (e.type === 'deck-ready') controller.abort();
      },
    });
    assert.equal(cancelled.status, 'cancelled');
    assert.deepEqual(cancelled.outputs, []);
    assert.equal((await builds.publication(out, 'main')).published.manifest.buildId, output.buildId);
    const second = await createRenderer(project).export({ ...request(out, b), slideIds: ['layers'] });
    assert.equal(second.status, 'succeeded');
    assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), bytes);
    const wrong = await createRenderer({
      ...example,
      renderDocument: (d, s) => example.renderDocument(d, s).replaceAll('Arial', 'Times New Roman'),
    }).export({ ...request(out, b), slideIds: ['text'] });
    assert.equal(wrong.error.code, 'PPTX_UNSUPPORTED_HTML');
    const svg = await createRenderer({
      ...example,
      renderDocument: (d, s) =>
        example
          .renderDocument(d, s)
          .replace(
            'src="../../export-assets/pptx-marker.svg"',
            'src="data:image/svg+xml;base64,' +
              Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><text y="40">text</text></svg>',
              ).toString('base64') +
              '"',
          ),
    }).export({ ...request(out, b), slideIds: ['media'] });
    assert.equal(svg.error.code, 'PPTX_UNSUPPORTED_SVG');
  },
);

test('bounded package normalization repairs only the three pinned backend defects', async (t) => {
  const b = await browser(t),
    p = await b.newPage({ viewport: { width: 960, height: 540 } });
  t.after(() => p.close());
  const source =
    'data:image/svg+xml;base64,' +
    Buffer.from(await fs.readFile(path.join(__dirname, '../examples/export-assets/pptx-marker.svg'))).toString(
      'base64',
    );
  await p.setContent(example.renderDocument(null, { id: 'media' }).replace(/src="[^"]+"/g, `src="${source}"`));
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  const scene = await pptx.capture(p, { id: 'media' }, [{ familyName: 'Arial', isCustomFont: false }]);
  await p.setContent(example.renderDocument(null, { id: 'text' }));
  const textScene = await pptx.capture(p, { id: 'text' }, [{ familyName: 'Arial', isCustomFont: false }]),
    rendered = await pptx.render([textScene, scene]);
  assert.equal(rendered.verified.slides, 2);
  assert(rendered.corrections.some((c) => c.kind === 'known-orphan-master-override'));
  assert(rendered.corrections.some((c) => c.kind === 'identical-rich-paragraph-properties'));
  const loaded = await pack.load(rendered.raw),
    rawFiles = loaded.files;
  async function reject(changes, code) {
    const zip = (await pack.load(rendered.raw)).zip;
    for (const [name, bytes] of Object.entries(changes)) zip.file(name, bytes);
    await assert.rejects(
      pack.normalize(
        await zip.generateAsync({ type: 'nodebuffer' }),
        new Map(
          scene.objects
            .filter((o) => o.fallback)
            .map((o) => [o.sha256, Buffer.from(o.fallback.split(',')[1], 'base64')]),
        ),
      ),
      { code: 'PPTX_PACKAGE_' + code },
    );
  }
  const ct = rawFiles.get('[Content_Types].xml').toString('utf8'),
    rel = 'ppt/_rels/presentation.xml.rels',
    rels = rawFiles.get(rel).toString('utf8');
  await reject(
    {
      '[Content_Types].xml': ct.replace(
        '</Types>',
        '<Override PartName="/ppt/media/ghost.svg" ContentType="image/svg+xml"/></Types>',
      ),
    },
    'UNKNOWN_ORPHAN_CONTENT_TYPE',
  );
  await reject(
    {
      '[Content_Types].xml': ct.replace(
        'PartName="/ppt/slideMasters/slideMaster2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"',
        'PartName="/ppt/slideMasters/slideMaster2.xml" ContentType="application/unknown"',
      ),
    },
    'UNKNOWN_ORPHAN_CONTENT_TYPE',
  );
  const relation = rels.match(/<Relationship\s[^>]+\/>/)[0];
  await reject({ [rel]: rels.replace('</Relationships>', relation + '</Relationships>') }, 'DUPLICATE_RELATIONSHIP_ID');
  await reject(
    {
      [rel]: rels.replace(
        '</Relationships>',
        '<Relationship Id="bad" Type="test" Target="slideMasters/slideMaster2.xml"/></Relationships>',
      ),
    },
    'MISSING_RELATIONSHIP_TARGET',
  );
  await reject(
    {
      [rel]: rels.replace(
        '</Relationships>',
        '<Relationship Id="bad" Type="test" Target="https://example.invalid" TargetMode="External"/></Relationships>',
      ),
    },
    'EXTERNAL_RELATIONSHIP',
  );
  await reject(
    { '[Content_Types].xml': ct.replace('</Types>', ct.match(/<Default\s[^>]+\/>/)[0] + '</Types>') },
    'DUPLICATE_CONTENT_TYPE',
  );
  const finding = pack.inspect(rawFiles, true);
  await reject({ [finding.pairs[0][0]]: Buffer.from('broken') }, 'PNG_CONTENT_TYPE_MISMATCH');
  await assert.rejects(pack.normalize(rendered.raw), { code: 'PPTX_PACKAGE_UNRECOGNIZED_SVG_SOURCE' });
  const textPart = 'ppt/slides/slide1.xml',
    textXml = rawFiles.get(textPart).toString('utf8'),
    paragraph = textXml.match(/<a:p>[^]*?Съёмка[^]*?<\/a:p>/)[0],
    properties = [...paragraph.matchAll(/<a:pPr[^]*?<\/a:pPr>/g)];
  const changed =
    paragraph.slice(0, properties[1].index) +
    paragraph.slice(properties[1].index).replace('indent="0"', 'indent="900"');
  await reject({ [textPart]: textXml.replace(paragraph, changed) }, 'PARAGRAPH_PROPERTIES');
  await reject(
    { [textPart]: textXml.replace(paragraph, paragraph.replace('</a:p>', properties[0][0] + '</a:p>')) },
    'PARAGRAPH_STRUCTURE',
  );
  await reject(
    { [textPart]: textXml.replace('<a:p>' + properties[0][0], '<a:p><a:r><a:t>bad</a:t></a:r>' + properties[0][0]) },
    'PARAGRAPH_PROPERTIES',
  );
  await reject(
    {
      [textPart]: textXml.replace(
        properties[0][0],
        properties[0][0].replace('<a:pPr', '<q:pPr xmlns:q="urn:lookalike"').replace('</a:pPr>', '</q:pPr>'),
      ),
    },
    'PARAGRAPH_STRUCTURE',
  );
  const again = await pack.normalize(rendered.bytes);
  assert.deepEqual(again.bytes, rendered.bytes);
  assert.deepEqual(again.corrections, []);
  const raw = rendered.raw,
    end = raw.length - 22,
    start = raw.readUInt32LE(end + 16),
    len = 46 + raw.readUInt16LE(start + 28) + raw.readUInt16LE(start + 30) + raw.readUInt16LE(start + 32),
    tail = Buffer.from(raw.subarray(end));
  tail.writeUInt16LE(tail.readUInt16LE(8) + 1, 8);
  tail.writeUInt16LE(tail.readUInt16LE(10) + 1, 10);
  tail.writeUInt32LE(tail.readUInt32LE(12) + len, 12);
  await assert.rejects(pack.load(Buffer.concat([raw.subarray(0, end), raw.subarray(start, start + len), tail])), {
    code: 'PPTX_PACKAGE_DUPLICATE_ZIP_PART',
  });
  const png = Buffer.from(await fs.readFile(path.join(__dirname, '../examples/export-assets/pptx-marker.png')));
  let pos = 8;
  while (png.toString('ascii', pos + 4, pos + 8) !== 'IDAT') pos += 12 + png.readUInt32BE(pos);
  const length = png.readUInt32BE(pos);
  png.fill(0x41, pos + 8, pos + 8 + length);
  let crc = 0xffffffff;
  for (const byte of png.subarray(pos + 4, pos + 8 + length)) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  png.writeUInt32BE((crc ^ 0xffffffff) >>> 0, pos + 8 + length);
  assert.throws(() => pack.png(png), { code: 'PPTX_PACKAGE_PNG_DECODE' });
});
