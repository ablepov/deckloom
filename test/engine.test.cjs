const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createReviewServer, createRenderer, scanDecks } = require('../src/index.cjs');
const { createLayoutMeasure, issueCount } = require('../src/qa.cjs');

test('rendered decks survive server, viewer, dimensions and layout diagnostics', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-test-'));
  const demo = require('../examples/deckloom.config.cjs');
  const project = { ...demo, root, viewer: { title: '<Deckloom>', storagePrefix: 'test' } };
  const browser = await chromium.launch({ headless: true });
  let server;
  try {
    const renderer = createRenderer(project);
    for (const deck of project.decks) {
      const report = await renderer.renderDeck(browser, deck);
      assert(report.every(r => r.layoutIssues === 0 && r.missingAssets === 0 && r.consoleMessages === 0));
    }
    // Highest-ranked generated preview wins even over a newer arbitrary image.
    await fs.copyFile(path.join(root, 'demo-slide-01/generated-html.png'), path.join(root, 'demo-slide-01/attempt-99.png'));
    const scanned = await scanDecks(project);
    assert.equal(scanned.decks.length, 2);
    assert.equal(scanned.decks[0].slides[0].file, 'generated-html.png');
    assert.equal(scanned.decks[1].slides[0].height, 1080);
    server = createReviewServer(project);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;

    await t.test('server exposes only configured resources and handles HTTP safely', async () => {
      const html = await (await fetch(url)).text();
      assert(html.includes('<title>&lt;Deckloom&gt;</title>'));
      assert(!html.includes('__DECKLOOM_'));
      for (const file of ['package.json', '.npmrc', 'src/renderer.cjs', '%5C..%5Cpackage.json', 'demo-slide-01/%2e%2e%5Csecret']) {
        assert.equal((await fetch(`${url}/${file}`)).status, 404, file);
      }
      assert.equal((await fetch(`${url}/%XX`)).status, 400);
      assert.equal((await fetch(url, { method: 'POST' })).status, 405);
      const head = await fetch(`${url}/demo-slide-01/generated-html.png`, { method: 'HEAD' });
      assert.equal(head.status, 200); assert.equal(await head.text(), '');
      assert.equal((await fetch(`${url}/api/slides?deck=missing`)).status, 404);
      assert.equal((await (await fetch(`${url}/api/slides?deck=portrait`)).json()).slides.length, 1);
      await fs.symlink(os.tmpdir(), path.join(root, 'demo-slide-03'), 'junction');
      assert.equal((await fetch(`${url}/demo-slide-03/`)).status, 404);
      await fs.rm(path.join(root, 'demo-slide-03'), { force: true });
    });

    await t.test('viewer preserves HTML text and each deck canvas in focus and overview', async () => {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url);
      await page.waitForSelector('.html-inline-holder .slide');
      assert.equal(await page.locator('.slide-tab').count(), 2);
      await page.keyboard.press('ArrowRight');
      assert.equal(new URL(page.url()).hash, '#demo-slide-02');
      await page.locator('#deckSelect').selectOption('portrait');
      await page.waitForSelector('.html-inline-holder .slide');
      const size = await page.locator('.html-inline-holder').evaluate(el => [el.offsetWidth, el.offsetHeight]);
      assert.deepEqual(size, [720, 1080]);
      assert.equal(await page.locator('.html-inline-holder h1').textContent(), 'A different canvas');
      const ratio = await page.locator('.stage').evaluate(el => getComputedStyle(el).aspectRatio);
      assert(Math.abs(Number(ratio.split('/')[0]) - 720 / 1080) < .001);
      await page.locator('#deckMode').click();
      await page.setViewportSize({ width: 400, height: 800 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      await page.close();
    });

    await t.test('configured artwork exclusion keeps ordinary text failures detectable', async () => {
      const page = await browser.newPage({ viewport: { width: 400, height: 200 } });
      const measure = createLayoutMeasure({ expectedFrames: 1, requireFlow: true, ignoreTextWithin: '[data-artwork]' });
      await page.setContent('<style>body{margin:0}.slide{width:400px;height:200px;position:relative}</style><main class="slide"><div data-layout-frame="test"><div data-artwork style="position:absolute;left:900px">Decorative</div></div></main>');
      assert.equal(issueCount(await page.evaluate(measure)), 0);
      await page.evaluate(() => { const p = document.createElement('p'); p.style.cssText = 'position:absolute;left:600px'; p.textContent = 'Ordinary text'; document.querySelector('main').append(p); });
      const qa = await page.evaluate(measure);
      assert(qa.bounds.some(item => item.kind === 'outside-canvas'));
      assert(qa.absoluteText.length > 0);
      await page.close();
    });

    await t.test('render reports missing resources and uncaught page errors', async () => {
      const broken = createRenderer({ ...project, renderDocument: () => '<!doctype html><main class="slide"><img src="missing.png"><script>throw new Error("Expected test failure")</script></main>' });
      const result = await broken.renderDeck(browser, { ...project.decks[0], slides: [project.decks[0].slides[0]] });
      assert.equal(result[0].missingAssets, 1);
      assert(result[0].consoleMessages > 0);
      const report = await fs.readFile(result[0].qa, 'utf8');
      assert(report.includes('Expected test failure'));
      await assert.rejects(broken.renderDeck(browser, { ...project.decks[0], slides: [{ no: '../escape' }] }), { code: 'INVALID_ID' });
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await browser.close();
    // Only the temporary directory created by this test is removed.
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});
