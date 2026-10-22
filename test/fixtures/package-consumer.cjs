const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const engine = require('deckloom');
const node = require('deckloom/node');
const qa = require('deckloom/qa');
const { chromium } = require('playwright');
const project = require('./deckloom.config.cjs');

async function main() {
  assert.strictEqual(engine, node);
  for (const name of ['createRenderer', 'createReviewServer', 'scanDecks', 'scanSlides', 'startReviewServer']) assert.equal(typeof engine[name], 'function');
  for (const name of ['createLayoutMeasure', 'measureLayout', 'issueCount']) assert.equal(typeof qa[name], 'function');
  const resolved = await fs.realpath(require.resolve('deckloom'));
  const installRoot = await fs.realpath(path.join(__dirname, 'node_modules/deckloom'));
  assert.equal(installRoot, path.join(await fs.realpath(__dirname), 'node_modules', 'deckloom'), 'Installed package is a link outside the consumer');
  assert(resolved.startsWith(installRoot + path.sep), 'Import escaped the installed package');
  const decks = await engine.scanDecks(project);
  assert.deepEqual(decks.decks.map(deck => deck.slides.length), [2, 1]);
  for (const deck of decks.decks) for (const slide of deck.slides) {
    assert(slide.htmlUrl);
    const png = await fs.readFile(path.join(project.root, slide.id, slide.file));
    assert.equal(png.readUInt32BE(16), deck.width); assert.equal(png.readUInt32BE(20), deck.height);
    assert.equal(await fs.readFile(path.join(project.root, slide.id, `${slide.id}-spec.md`), 'utf8'), `# ${deck.id} ${slide.no}\n`);
    const diagnostic = JSON.parse(await fs.readFile(path.join(project.root, slide.id, `${slide.id}-qa.md`), 'utf8'));
    assert.equal(diagnostic.layoutIssues, 0); assert.deepEqual(diagnostic.missingAssets, []);
  }
  let browser, server;
  try {
    browser = await chromium.launch({ headless: true });
    const reports = await engine.createRenderer(project).renderDeck(browser, project.decks[0]);
    assert(reports.every(item => !item.layoutIssues && !item.missingAssets && !item.consoleMessages));
    server = await engine.startReviewServer(project, { port: 0, host: '127.0.0.1' });
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(origin + '/package.json')).status, 404);
    assert.equal((await fetch(origin + '/assets/marker.svg')).status, 200);
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.waitForSelector('.html-inline-holder .slide');
    assert.equal(await page.locator('.html-inline-holder h1').first().textContent(), 'Проверка «Deckloom» — API');
    await page.waitForFunction(() => [...document.querySelectorAll('.html-inline-holder img')].every(img => img.complete && img.naturalWidth > 0));
    await page.keyboard.press('ArrowRight'); assert.equal(new URL(page.url()).hash, '#wide-02');
    await page.locator('#deckSelect').selectOption('portrait');
    await page.waitForFunction(() => document.querySelector('.html-inline-holder h1')?.textContent === 'Portrait slide');
    assert.deepEqual(await page.locator('.html-inline-holder').evaluate(el => [el.offsetWidth, el.offsetHeight]), [540, 810]);
    await page.locator('#deckMode').click(); await page.setViewportSize({ width: 400, height: 800 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    let v1Read = false, discovery = false, v1Render = false, v1Export = false, f1Document = false, f2g1Engine = false;
    if (process.argv.includes('--expect-read-v1')) {
      assert.strictEqual(engine.presentation, node.presentation);
      const document = {
        documentVersion: 1, projectId: 'installed-project', id: 'main', width: 960, height: 540,
        compositions: [{ id: 'cards', revision: '1', definition: { layout: 'cards' } }],
        slides: [
          { id: 'cover', content: { kind: 'template', ref: { libraryId: 'neutral', templateId: 'cover', revision: '1' }, data: { title: 'Документ — «ёжик»' } } },
          { id: 'cards', content: { kind: 'local', ref: { compositionId: 'cards', revision: '1' }, data: { title: 'Карточки' } } },
          { id: 'notes', content: { kind: 'authored', data: { paragraphs: ['Обычный текст'] } } },
        ],
      };
      assert.deepEqual(engine.presentation.deserialize(engine.presentation.serialize(document)), document);
      const copied = engine.presentation.duplicateSlide(document, 'cards', 'cards-copy');
      assert.deepEqual(copied.slides.map(s => s.id), ['cover', 'cards', 'cards-copy', 'notes']);
      copied.slides[2].content.data.title = 'Правка';
      assert.equal(copied.slides[1].content.data.title, 'Карточки');
      assert.equal(engine.presentation.renameSlide(document, 'cover', 'Новое имя').slides[0].id, 'cover');
      assert.throws(() => engine.presentation.deserialize('{"documentVersion":2}'), { code: 'UNSUPPORTED_DOCUMENT_VERSION' });
      f1Document = true;
      const library = require(path.join(installRoot, 'examples/engine-library.cjs'));
      const catalog = engine.templates.createCatalog([library]), editor = engine.editing.createEditor(catalog);
      let editable = editor.create({ projectId: 'installed-engine', id: 'main', width: 960, height: 540 });
      editable = editor.addTemplate(editable, { libraryId: library.id, templateId: 'summary', revision: '1' }, 'one'); editable = editor.duplicate(editable, 'one', 'two');
      editable = editor.editFields(editable, 'one', { title: 'Установленный пакет — правка' }); assert.equal(editable.slides[1].content.data.title, library.templates[0].defaults.title);
      const store = engine.storage.createStore({ root: path.join(__dirname, 'engine-store'), catalog }), saved = await store.save(editable, { expectedToken: null });
      assert.deepEqual(await store.load('installed-engine', 'main'), saved);
      assert.equal(engine.compositions.validateDocument(saved.document, catalog).slides.length, 2); f2g1Engine = true;
      const readProject = {
        contractVersion: 1, id: 'installed-read', mode: 'registered', root: project.root,
        artifacts: { layout: 'legacy' }, staticMounts: project.staticMounts,
        decks: project.decks.map(deck => ({ id: deck.id, label: deck.label, artifactPrefix: deck.artifactPrefix, width: deck.width, height: deck.height,
          slides: deck.slides.map(slide => ({ id: `slide-${slide.no}`, artifactNo: slide.no, name: slide.name })) })),
      };
      readProject.decks[0].slides.reverse();
      const readResult = await engine.scanDecks(readProject);
      assert.equal(readResult.contractVersion, 1);
      assert.deepEqual(readResult.decks[0].slides.map(slide => slide.id), ['slide-02', 'slide-01']);
      assert.equal(readResult.decks[0].slides[0].number, 1);
      assert(!Object.hasOwn(readResult.decks[0].slides[0], 'no'));
      await assert.rejects(engine.createRenderer(readProject).renderDeck(browser, 'landscape'), { code: 'MISSING_RENDERER' });
      const readServer = engine.createReviewServer(readProject);
      try {
        await new Promise(resolve => readServer.listen(0, '127.0.0.1', resolve));
        const readOrigin = `http://127.0.0.1:${readServer.address().port}`;
        await page.goto(readOrigin);
        await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('h1')?.textContent === 'Second neutral slide');
        await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(frame => [...(frame.contentDocument?.images || [])].every(img => img.complete && img.naturalWidth > 0)));
        assert.equal(new URL(page.url()).hash, '#project/installed-read/deck/landscape/slide/slide-02');
        const api = await (await fetch(readOrigin + '/api/slides?deck=landscape')).json();
        assert.equal(api.deck.slides[0].id, 'slide-02');
        assert.equal((await fetch(readOrigin + api.deck.slides[0].artifacts.html.url)).status, 200);
        assert.equal((await fetch(readOrigin + '/artifacts/assets/marker.svg')).status, 200);
        assert.deepEqual(errors, []);
        v1Read = true;
      } finally { await new Promise(resolve => readServer.close(resolve)); }
      const archive = { ...readProject, mode: 'discovery', decks: readProject.decks.map(({ slides, ...deck }) => deck) };
      const archiveResult = await engine.scanDecks(archive);
      assert.deepEqual(archiveResult.decks[0].slides.map(slide => slide.id), ['wide-01', 'wide-02']);
      assert.throws(() => engine.createRenderer(archive), { code: 'READ_ONLY_PROJECT' });
      discovery = true;
      const runtimeFile = path.join(__dirname, 'runtime.config.cjs');
      await fs.writeFile(runtimeFile, `const path = require('node:path');\nconst fixture = require(${JSON.stringify(path.join(installRoot, 'examples/render-v1.config.cjs'))});\nmodule.exports = { ...fixture, root: path.join(__dirname, 'v1-artifacts') };\n`, 'utf8');
      const runtime = require(runtimeFile);
      const runtimeRenderer = engine.createRenderer(runtime);
      const beforeExit = process.exitCode, progress = [];
      const programmatic = await runtimeRenderer.render({ deckId: 'portrait', browser, onProgress: event => { progress.push(event.type); } });
      assert.equal(programmatic.resultVersion, 1); assert.equal(programmatic.status, 'succeeded');
      assert.equal(programmatic.reports.portrait.length, 1); assert.equal(process.exitCode, beforeExit);
      assert.deepEqual(progress, ['deck-start', 'slide-start', 'slide-complete', 'deck-ready']);
      const runtimeReports = [];
      for (const deck of runtime.decks) runtimeReports.push(...await runtimeRenderer.renderDeck(browser, deck.id));
      assert.equal(runtimeReports.length, 5);
      assert(runtimeReports.every(entry => !entry.layoutIssues && !entry.missingAssets && !entry.consoleMessages));
      const runtimePayload = await engine.scanDecks(runtime);
      for (const deck of runtimePayload.decks) for (const slide of deck.slides) {
        const entry = runtimeReports.find(item => item.deck === deck.id && item.slide === slide.id);
        const png = await fs.readFile(entry.png);
        assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [slide.width, slide.height]);
        assert.equal(slide.artifacts.html.state, 'available'); assert.equal(slide.artifacts.png.state, 'available');
      }
      const runtimeServer = engine.createReviewServer(runtime);
      try {
        await new Promise(resolve => runtimeServer.listen(0, '127.0.0.1', resolve));
        await page.goto(`http://127.0.0.1:${runtimeServer.address().port}`);
        await page.frameLocator('.html-document-frame').first().locator('.slide').waitFor();
        await page.locator('#deckMode').click();
        assert.deepEqual(await page.locator('.html-inline-holder').evaluateAll(nodes => nodes.map(node => [node.offsetWidth, node.offsetHeight])), [[800, 450], [600, 450], [800, 700], [450, 800]]);
        assert.deepEqual(errors, []);
        v1Render = true;
      } finally { await new Promise(resolve => runtimeServer.close(resolve)); }
      const exportFile = path.join(__dirname, 'export.config.cjs');
      await fs.writeFile(exportFile, `const path = require('node:path');\nconst fixture = require(${JSON.stringify(path.join(installRoot, 'examples/export.config.cjs'))});\nmodule.exports = { ...fixture, root: path.join(__dirname, 'export-source') };\n`, 'utf8');
      const portable = await engine.createRenderer(require(exportFile)).export({ deckId: 'demo', outputRoot: path.join(__dirname, 'portable'), browser,
        slideIds: ['closing', 'intro'], formats: ['png', 'pdf', 'html'], png: { scale: 1.5 }, fonts: { expected: ['DejaVu Sans'] } });
      assert.equal(portable.status, 'succeeded'); assert.deepEqual(portable.request.slideIds, ['intro', 'closing']);
      assert.equal(portable.outputs.filter(item => item.format === 'png').length, 2);
      const pdf = portable.outputs.find(item => item.format === 'pdf');
      assert.equal(pdf.pages.length, 2); assert(pdf.fonts.every(font => font.embedded));
      assert.equal((await fs.readFile(pdf.file)).subarray(0, 5).toString(), '%PDF-');
      const png = await fs.readFile(portable.outputs.find(item => item.format === 'png').file);
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [960, 540]);
      await page.route('**/*', route => route.request().url().startsWith('file:') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
      await page.goto(require('node:url').pathToFileURL(portable.bundle.index).href);
      await page.frameLocator('iframe').first().locator('h1').waitFor();
      assert.equal(await page.frameLocator('iframe').first().locator('h1').textContent(), 'Презентация — Deckloom');
      assert.deepEqual(errors, []); v1Export = true;
    }
    await page.close();
    console.log(JSON.stringify({ status: 'passed', imports: 3, decks: 2, slides: 3, apiRenderSlides: reports.length, viewer: true, localSvg: true, cyrillic: true, spec: true, qa: true, ...(v1Read ? { v1Read, discovery, v1Render, v1Export, f1Document, f2g1Engine } : {}) }));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
