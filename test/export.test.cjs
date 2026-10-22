const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { chromium } = require('playwright');
const { createRenderer, createReviewServer } = require('../src/index.cjs');
const builds = require('../src/builds.cjs');
const { createResourceBundler } = require('../src/resources.cjs');
const { mergePdf } = require('../src/exports.cjs');
const { PDFDocument, PDFName } = require('pdf-lib');
const run = promisify(execFile);
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64');

test('PDF Type3 glyph programs are self-contained while missing ordinary fonts still fail',async()=>{
  async function sample({empty=false,ordinary=false}={}){
    const pdf=await PDFDocument.create(),page=pdf.addPage([100,100]),c=pdf.context;
    const descriptor=c.register(c.obj({Type:'FontDescriptor',FontName:'ExampleType3',Flags:4}));
    const font=c.register(c.obj({Type:'Font',Subtype:'Type3',FontDescriptor:descriptor,FontMatrix:[.001,0,0,.001,0,0],FontBBox:[0,0,600,700],FirstChar:65,LastChar:65,Widths:[600],Encoding:{Type:'Encoding',Differences:[65,'A']},CharProcs:{A:c.register(c.stream(empty?'':'600 0 d0 0 0 600 700 re f'))}}));
    const resources={F1:font};
    if(ordinary)resources.F2=c.register(c.obj({Type:'Font',Subtype:'TrueType',BaseFont:'ExampleType3',FontDescriptor:descriptor}));
    page.node.set(PDFName.of('Resources'),c.obj({Font:resources}));
    page.node.set(PDFName.of('Contents'),c.register(c.stream('BT /F1 32 Tf 20 40 Td (A) Tj ET')));
    return {bytes:await pdf.save(),fonts:[{postScriptName:'ExampleType3'}]};
  }
  const result=await mergePdf([await sample()]);assert.equal(result.fonts[0].type,'Type3');assert.equal(result.fonts[0].embedded,true);
  await assert.rejects(()=>sample({empty:true}).then(p=>mergePdf([p])),e=>e.code==='PDF_FONT_NOT_EMBEDDED');
  await assert.rejects(()=>sample({ordinary:true}).then(p=>mergePdf([p])),e=>e.code==='PDF_FONT_NOT_EMBEDDED');
});
test('data URL resources preserve literal percentages, escaped base64 and binary bytes like browser fetch', async t => {
  const root = await temporary(t), project = { root }, base = pathToFileURL(path.join(root, 'slide.html')).href;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><linearGradient id="g"><stop offset="0%" stop-color="#0052cc"/><stop offset="100%" stop-color="#2684ff"/></linearGradient><rect width="10" height="10" fill="url(#g)"/></svg>';
  const urls = ['data:image/svg+xml,' + svg.replaceAll('#', '%23'), 'data:image/png,' + [...pixel].map(b => '%' + b.toString(16).padStart(2, '0')).join(''), 'data:image/png;base64,' + pixel.toString('base64').replaceAll('=', '%3D')];
  const { createHash } = require('node:crypto');
  for (const url of urls) {
    const expected = Buffer.from(await (await fetch(url)).arrayBuffer());
    const bundler = await createResourceBundler(project, { fonts: { policy: 'strict' } });
    const html = await bundler.bundle('<img src="' + url.replaceAll('"', '&quot;') + '">', base);
    assert.deepEqual(bundler.failures, []);
    assert.ok(bundler.records.some(r => r.sha256 === createHash('sha256').update(expected).digest('hex')));
    assert.ok(html.includes(';base64,'));
    if (url.startsWith('data:image/svg')) assert.ok(Buffer.from(/base64,([^"]+)/.exec(html)[1], 'base64').toString().includes('offset="100%"'));
  }
});
test('UTF-16 SVG and standard SVG11 declaration normalize without loading DTDs or permitting active XML', async t => {
  const root = await temporary(t), base = pathToFileURL(path.join(root, 'slide.html')).href;
  const declaration = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';
  const svg = '<?xml version="1.0" encoding="UTF-16"?>' + declaration + '<svg xmlns="http://www.w3.org/2000/svg"><title>Ёжик</title><rect width="10" height="10" fill="#00ff00"/></svg>';
  for (const encoding of ['le', 'be']) {
    const bytes = Buffer.from('\uFEFF' + svg, 'utf16le'); if (encoding === 'be') bytes.swap16();
    await fs.writeFile(path.join(root, 'logo.svg'), bytes);
    const b = await createResourceBundler({ root }, { fonts: { policy: 'strict' } }); const html = await b.bundle('<img src="logo.svg">', base);
    assert.deepEqual(b.failures, []); assert.deepEqual(b.records[0].normalizations, ['utf-16' + encoding + '-to-utf8', 'strip-standard-svg11-doctype']);
    const prepared = Buffer.from(/base64,([^"]+)/.exec(html)[1], 'base64').toString('utf8'); assert.ok(prepared.includes('Ёжик')); assert.ok(!prepared.includes('DOCTYPE'));
  }
  for (const content of [svg.replace(declaration, '<!DOCTYPE svg SYSTEM "https://example.invalid/a.dtd">'), svg.replace(declaration, '<!DOCTYPE svg [<!ENTITY bad "expanded">]>'), svg.replace('<title>Ёжик</title>', '<script>alert(1)</script>')]) {
    await fs.writeFile(path.join(root, 'logo.svg'), Buffer.from('\uFEFF' + content, 'utf16le'));
    const b = await createResourceBundler({ root }, { fonts: { policy: 'strict' } }); await b.bundle('<img src="logo.svg">', base); assert.equal(b.failures[0].code, 'UNPACKABLE_SVG');
  }
});
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-d-'));
  t.after(async () => { assert(root.startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  return root;
}
async function write(root, file, value) { const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, value, typeof value === 'string' ? 'utf8' : undefined); }
async function fixture(t) {
  const parent = await temporary(t), root = path.join(parent, 'source'), outputRoot = path.join(parent, 'export');
  await write(root, 'assets/font.ttf', await fs.readFile(path.join(__dirname, '../examples/export-assets/DejaVuSans.ttf')));
  await write(root, 'assets/pixel.png', pixel);
  await write(root, 'assets/marker.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>');
  await write(root, 'assets/import.css', '.slide{color:#17221c}');
  await write(root, 'assets/main.css', '@import "import.css" screen; @font-face{font-family:Neutral;src:url(font.ttf)}html,body{margin:0}.slide{box-sizing:border-box;padding:20px;font:22px Neutral}h1{font:26px Neutral;margin:0 0 20px}p{margin:0}@media print{.slide{background:rgb(30,80,120)}}');
  const project = { contractVersion: 1, id: 'export-contract', mode: 'registered', root,
    decks: [{ id: 'main', label: 'Экспорт', width: 640, height: 360, slides: [{ id: 'one' }, { id: 'two' }, { id: 'three', width: 320, height: 480 }] }],
    renderDocument(deck, slide) { return `<!doctype html><html><head><meta charset="utf-8"><base href="../../assets/"><link rel="stylesheet" href="main.css"><style>.slide{width:${slide.width}px;height:${slide.height}px}</style></head><body><main class="slide"><h1>Слайд ${slide.id}</h1><p>Кириллица: ёжик, съёмка.</p><img src="marker.svg" width="10" height="10" alt="SVG"><img src="pixel.png" srcset="pixel.png 1x, pixel.png 2x" width="10" height="10" alt="PNG"></main></body></html>`; } };
  return { parent, project, outputRoot };
}
async function browserFor(t) { const browser = await chromium.launch(); t.after(() => browser.close()); return browser; }
async function hashes(root) {
  const crypto = require('node:crypto'), result = {};
  async function walk(dir) { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) await walk(file); else result[path.relative(root, file)] = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'); } }
  await walk(root); return result;
}
async function alpha(browser, file) {
  const page = await browser.newPage();
  try { return await page.evaluate(async url => { const image = new Image(); image.src = url; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return [...ctx.getImageData(0, 0, 1, 1).data]; }, 'data:image/png;base64,' + (await fs.readFile(file)).toString('base64')); }
  finally { await page.close(); }
}

test('export preflight rejects bad options/selections/overlap/budgets without writes or browser launch', async t => {
  const { project, outputRoot } = await fixture(t), renderer = createRenderer(project);
  const cases = [
    [{}, 'INVALID_EXPORT_OPTIONS'], [{ slideIds: [] }, 'INVALID_SELECTION'], [{ slideIds: ['one', 'one'] }, 'INVALID_SELECTION'], [{ slideIds: ['missing'] }, 'UNKNOWN_SLIDE'],
    [{ formats: [] }, 'INVALID_EXPORT_OPTIONS'], [{ formats: ['pptx'] }, 'INVALID_PPTX_OPTIONS'], [{ formats: Array(1) }, 'INVALID_EXPORT_OPTIONS'], [{ fonts: { expected: Array(1) } }, 'INVALID_EXPORT_OPTIONS'],
    [{ png: { scale: 0 } }, 'INVALID_EXPORT_OPTIONS'], [{ png: { transparent: 'yes' } }, 'INVALID_EXPORT_OPTIONS'], [{ png: { scale: .001 } }, 'NON_INTEGRAL_PIXELS'], [{ png: { scale: 100 } }, 'UNSUPPORTED_CANVAS'],
    [{ pdf: { media: 'auto' } }, 'INVALID_EXPORT_OPTIONS'], [{ resources: 'linked' }, 'INVALID_EXPORT_OPTIONS'], [{ outputRoot: project.root }, 'EXPORT_SOURCE_OVERLAP'],
  ];
  for (const [options, code] of cases) {
    const request = Object.keys(options).length ? { deckId: 'main', outputRoot, ...options } : {};
    await assert.rejects(renderer.export(request), { code });
    await assert.rejects(fs.stat(outputRoot), { code: 'ENOENT' });
  }
  project.decks.push({ id: 'other', label: 'Other', slides: [{ id: 'one' }] });
  project.reportName = deck => deck.id === 'other' ? '_deckloom-export' : 'main-report.json';
  await assert.rejects(createRenderer(project).export({ deckId: 'main', outputRoot }), { code: 'DUPLICATE_PATH' });
  await assert.rejects(fs.stat(outputRoot), { code: 'ENOENT' });
});

test('one prepared subset preserves deck order/IDs/data and supports exact PNG scale/alpha and mixed PDF pages', async t => {
  const { project, outputRoot } = await fixture(t), before = await hashes(project.root), browser = await browserFor(t);
  const ids = ['three', 'one'], formats = ['pdf', 'png', 'html']; const original = project.decks[0].slides.slice();
  const result = await createRenderer(project).export({ browser, deckId: 'main', outputRoot, slideIds: ids, formats, png: { scale: 1.5, transparent: true }, fonts: { expected: ['DejaVu Sans'] } });
  assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
  assert.deepEqual(result.request.slideIds, ['one', 'three']); assert.deepEqual(result.reports.main.map(slide => slide.slide), ['one', 'three']); assert.deepEqual(ids, ['three', 'one']); assert.deepEqual(project.decks[0].slides, original);
  assert.deepEqual(result.outputs.filter(output => output.format === 'png').map(output => [output.width, output.height]), [[960, 540], [480, 720]]);
  for (const output of result.outputs.filter(output => output.format === 'png')) { const bytes = await fs.readFile(output.file); assert.equal(bytes.readUInt32BE(16), output.width); assert.equal(bytes.readUInt32BE(20), output.height); assert.equal((await alpha(browser, output.file))[3], 0); }
  assert.deepEqual(result.outputs.find(output => output.format === 'pdf').pages, [{ width: 480, height: 270 }, { width: 240, height: 360 }]);
  assert(result.outputs.find(output => output.format === 'pdf').fonts.every(font => font.embedded && /DejaVuSans/.test(font.name)));
  const manifest = JSON.parse(await fs.readFile(result.bundle.manifest, 'utf8')); assert.equal(manifest.exportManifestVersion, 1); assert.deepEqual(manifest.request.slideIds, ['one', 'three']);
  for (const output of result.outputs) assert.equal(require('node:crypto').createHash('sha256').update(await fs.readFile(output.file)).digest('hex'), output.sha256);
  assert.deepEqual(await hashes(project.root), before);
  // An unselected oversized slide cannot invalidate a supported subset.
  project.decks[0].slides.push({ id: 'oversized', width: 20000, height: 100 });
  assert.equal((await createRenderer(project).export({ browser, deckId: 'main', slideIds: ['one'], outputRoot })).status, 'succeeded');
});

test('PNG transparency retains authored paint and default background; PDF media/background are explicit', async t => {
  const { project, outputRoot, parent } = await fixture(t), browser = await browserFor(t), document = project.renderDocument;
  project.decks[0].slides.length = 1;
  project.renderDocument = (d, s) => document(d, s).replace('</style>', '.slide{background:red}@media(prefers-reduced-motion:reduce){.slide{background:rgb(12,34,56)}}</style>');
  const painted = await createRenderer(project).export({ browser, deckId: 'main', outputRoot, png: { transparent: true } });
  assert.equal(painted.status, 'succeeded'); assert.deepEqual(await alpha(browser, painted.outputs.find(o => o.format === 'png').file), [12,34,56,255]);
  project.renderDocument = document;
  const white = await createRenderer(project).export({ browser, deckId: 'main', outputRoot }); assert.equal((await alpha(browser, white.outputs.find(o => o.format === 'png').file))[3], 255);
  const print = await createRenderer(project).export({ browser, deckId: 'main', outputRoot: path.join(parent, 'print'), formats: ['pdf'], pdf: { media: 'print', background: false } });
  assert.equal(print.status, 'succeeded'); assert.equal(print.request.pdf.media, 'print'); assert.equal(print.request.pdf.background, false);
  project.renderDocument = (d,s) => document(d,s).replace('</style>', '.slide::before{content:"";display:block;width:10px;height:10px;background:red;print-color-adjust:exact!important}</style>');
  const conflict = await createRenderer(project).export({ browser, deckId: 'main', outputRoot, formats: ['pdf'], pdf: { background: false } });
  assert.equal(conflict.error.code, 'PDF_COLOR_POLICY_CONFLICT'); assert.deepEqual(conflict.outputs, []);
});

test('portable bundle relocates with sources unavailable and network blocked, including deck index', async t => {
  const { project, outputRoot, parent } = await fixture(t), browser = await browserFor(t);
  await write(project.root, 'assets/vector.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="pixel.png" width="10" height="10"/></svg>');
  const document = project.renderDocument; project.renderDocument = (d,s) => document(d,s).replace('src="marker.svg"', 'src="vector.svg"');
  const result = await createRenderer(project).export({ browser, deckId: 'main', outputRoot, formats: ['png', 'html'] }); assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
  const moved = path.join(parent, 'relocated'); await fs.cp(result.bundle.directory, moved, { recursive: true });
  // Exact resolved source directory is inside this test's own temporary root.
  const source = path.resolve(project.root); assert(source.startsWith(path.resolve(parent) + path.sep));
  await fs.rename(source, path.join(parent, 'source-unavailable'));
  const page = await browser.newPage(), requests = [], errors = [];
  page.on('requestfailed', request => errors.push(request.url()));
  await page.route('**/*', route => {
    const url = route.request().url(); requests.push(url);
    if (url.startsWith(pathToFileURL(moved + path.sep).href)) return route.continue();
    return route.abort();
  });
  await page.goto(pathToFileURL(path.join(moved, '_deckloom-export/main/index.html')).href);
  await page.frameLocator('iframe').first().locator('h1').waitFor();
  assert.equal(await page.locator('iframe').count(), 3);
  for (const frame of page.frames().slice(1)) {
    await frame.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
    assert.equal(await frame.evaluate(() => document.fonts.check('22px Neutral')), true);
    assert.equal(await frame.locator('p').textContent(), 'Кириллица: ёжик, съёмка.');
  }
  assert.deepEqual(errors, []); assert(!requests.some(url => /^https?:/.test(url)));
  const firstHtml = await fs.readFile(path.join(moved, 'deck-main/slide-one/render.html'), 'utf8'); assert(!firstHtml.includes('file:')); assert(!firstHtml.includes('<base'));
  await page.close();
});

test('strict graph enumerates inactive CSS/SVG/srcset/UNC escapes and cycles without network or source mutation', async t => {
  const { project } = await fixture(t), base = pathToFileURL(path.join(project.root, 'assets/document.html')).href;
  const cases = [
    '<style>.unused{--source:"https://example.invalid/a.png";background:image-set(var(--source) 1x)}</style>',
    '<style>@media print{.unused{--source:"https://example.invalid/a.png";background:-webkit-image-set(v\\61 r(--source) 1x)}}</style>',
    '<style>@media print{.unused{background:u\\72l("https://example.invalid/a.png")}}</style>',
    '<style>@IMPORT "https://example.invalid/a.css" print;</style>',
    '<style>@im\\70ort url("https://example.invalid/b.css");</style>',
    '<svg><defs><rect fill="url(https://example.invalid/p.svg#x)"/></defs></svg>',
    '<link rel="preload" as="image" media="(width:0px)" imagesrcset="https://example.invalid/a.png 1x">',
    '<img src="//server.invalid/share/a.png">', '<img src="file:////server.invalid/share/a.png">',
    '<style>@font-face{font-family:Unused;src:lo\\63 al("Missing")}</style>',
  ];
  for (const html of cases) {
    const bundler = await createResourceBundler({ ...project, staticMounts: {} }, { fonts: { policy: 'strict' } });
    await bundler.bundle(html, base);
    assert(bundler.failures.length > 0, html);
  }
  await write(project.root, 'assets/a.css', '@import "b.css";'); await write(project.root, 'assets/b.css', '@import "a.css";');
  const cyclic = await createResourceBundler(project, { fonts: { policy: 'strict' } });
  await cyclic.bundle('<link rel="stylesheet" href="a.css"><link rel="stylesheet" href="b.css">', base);
  assert(cyclic.failures.some(item => item.code === 'RESOURCE_CYCLE'));
  await write(project.root, 'assets/a.svg', '<svg xmlns="http://www.w3.org/2000/svg"><image href="b.svg"/></svg>');
  await write(project.root, 'assets/b.svg', '<svg xmlns="http://www.w3.org/2000/svg"><image href="a.svg"/></svg>');
  const svgCycle = await createResourceBundler(project, { fonts: { policy: 'strict' } });
  await svgCycle.bundle('<style>.unused{background:url(a.svg),url(b.svg)}</style>', base);
  assert(svgCycle.failures.some(item => item.code === 'RESOURCE_CYCLE'));
  const unc = await createResourceBundler(project, { fonts: { policy: 'strict' } }), realpath = fs.realpath;
  let calls = 0; fs.realpath = async (...args) => { calls++; return realpath(...args); };
  try { await unc.bundle('<img src="file://server.invalid/share/a.png">', base); } finally { fs.realpath = realpath; }
  assert.equal(calls, 0); assert.equal(unc.failures[0].code, 'EXTERNAL_RESOURCE');
});

test('strict failures and cancellation preserve previous publication and pinned PDF/index after a new export', async t => {
  const { project, outputRoot } = await fixture(t), browser = await browserFor(t); project.decks[0].slides.length = 1;
  const renderer = createRenderer(project), first = await renderer.export({ browser, deckId: 'main', outputRoot, formats: ['pdf', 'html'] }); assert.equal(first.status, 'succeeded');
  const server = createReviewServer({ ...project, root: outputRoot }); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`, pdf = first.outputs.find(item => item.format === 'pdf');
  const pdfUrl = `${origin}/artifacts/${pdf.path}?build=${first.builds[0].buildId}`, original = Buffer.from(await (await fetch(pdfUrl)).arrayBuffer()); assert(original.subarray(0,4).equals(Buffer.from('%PDF')));
  const document = project.renderDocument;
  project.renderDocument = (d,s) => document(d,s).replace('</head>', '<style>@media (width:0px){.unused{background:url(https://example.invalid/unused.png)}}</style></head>');
  const failed = await createRenderer(project).export({ browser, deckId: 'main', outputRoot }); assert.equal(failed.error.code, 'RESOURCE_BUNDLE_FAILED'); assert.deepEqual(failed.outputs, []);
  assert.equal((await builds.publication(outputRoot,'main')).published.manifest.buildId, first.builds[0].buildId);
  assert((await builds.publication(outputRoot,'main')).latest.manifest.export.resources.some(item => item.code === 'EXTERNAL_RESOURCE'));
  project.renderDocument = (d,s) => document(d,s).replace('Кириллица:', 'Изменено:');
  const controller = new AbortController();
  const cancel = await createRenderer(project).export({ browser, deckId: 'main', outputRoot, signal: controller.signal, onProgress: event => { if(event.type==='deck-ready')controller.abort(); } }); assert.equal(cancel.status, 'cancelled'); assert.deepEqual(cancel.outputs, []);
  const second = await createRenderer(project).export({ browser, deckId: 'main', outputRoot, formats: ['pdf','html'] }); assert.equal(second.status, 'succeeded');
  assert.deepEqual(Buffer.from(await (await fetch(pdfUrl)).arrayBuffer()), original);
  const index = first.outputs.find(item => item.kind === 'deck'), page = await browser.newPage(); await page.goto(`${origin}/artifacts/${index.path}?build=${first.builds[0].buildId}`);
  await page.frameLocator('iframe').locator('p').waitFor(); assert((await page.frameLocator('iframe').locator('p').textContent()).startsWith('Кириллица:')); await page.close();
});

test('PDF font substitution and pagination are explicit and cannot silently publish', async t => {
  const { project, outputRoot } = await fixture(t), browser = await browserFor(t); project.decks[0].slides.length = 1;
  const document = project.renderDocument;
  project.renderDocument = (d,s) => document(d,s).replace('</style>', '@media print{h1{font-family:Arial}}</style>');
  let result = await createRenderer(project).export({ browser, deckId: 'main', outputRoot, formats: ['pdf'], pdf: { media: 'print' } });
  assert.equal(result.error.code, 'FONT_NOT_BUNDLED'); assert.equal((await builds.publication(outputRoot,'main')).published, null);
  result = await createRenderer(project).export({ browser, deckId: 'main', outputRoot, formats: ['pdf'], pdf: { media: 'print' }, fonts: { policy: 'allow-substitution', expected: ['Unknown Font'] } });
  assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics)); const manifest = JSON.parse(await fs.readFile(result.bundle.manifest,'utf8')); assert(manifest.fonts.some(item => item.substitutionAllowed)); assert(manifest.fonts[0].pdf.some(font => !font.isCustomFont));
  project.renderDocument = (d,s) => document(d,s).replace('</style>', '@media print{.slide{height:2000px}p{break-after:page}}</style>');
  const pagination = await createRenderer(project).export({ browser, deckId: 'main', outputRoot, formats:['pdf'], pdf:{media:'print'} }); assert.equal(pagination.error.code,'PDF_PAGINATION');
  assert.equal((await builds.publication(outputRoot,'main')).published.manifest.buildId, result.builds[0].buildId);
  project.renderDocument = (d,s) => document(d,s).replace('</style>', '@media print{h1,p{display:none}}</style>');
  const expected = await createRenderer(project).export({ browser, deckId:'main', outputRoot, formats:['pdf'], pdf:{media:'print'}, fonts:{expected:['DejaVu Sans']} }); assert.equal(expected.error.code,'EXPECTED_FONT_MISSING');
});

test('CLI translates the same selection/scale request and rejects malformed flags before writing', async t => {
  const parent=await temporary(t), outputRoot=path.join(parent,'cli'), config=path.resolve('examples/export.config.cjs'), bin=path.resolve('bin/deckloom.cjs');
  const result=await run(process.execPath,[bin,'export',`--config=${config}`,'--deck=demo',`--output=${outputRoot}`,'--format=png,pdf','--slides=closing,intro','--scale=2']);
  const payload=JSON.parse(result.stdout); assert.equal(payload.status,'succeeded'); assert.deepEqual(payload.request.slideIds,['intro','closing']); assert.deepEqual(payload.outputs.filter(o=>o.format==='png').map(o=>o.width),[1280,1280]);
  for(const args of [['--slides'],['--format'],['--media='],['--scale=2','--scale=1'],['--unknown=1']]){
    const target=path.join(parent,'invalid'); await assert.rejects(run(process.execPath,[bin,'export',`--config=${config}`,'--deck=demo',`--output=${target}`,...args]),error=>error.code===1);
    await assert.rejects(fs.stat(target),{code:'ENOENT'});
  }
});
