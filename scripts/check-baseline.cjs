const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { chromium } = require('playwright');
const { createRenderer, createReviewServer, scanDecks } = require('../src/index.cjs');
const { createBaselineProject } = require('../examples/baseline-fixture.cjs');

async function main() {
  const option = process.argv.slice(2).find(arg => arg.startsWith('--large='));
  if (!option && process.env.npm_config_large) throw new Error('Use check:baseline:ci or node scripts/check-baseline.cjs --large=N; npm did not forward --large');
  const largeSlides = option ? Number(option.slice('--large='.length)) : 120;
  const output = path.resolve(__dirname, '../output/validation/stage-a/baseline');
  // Each run has its own artifact root, so shrinking the sample cannot reveal old slides.
  const startedAt = new Date().toISOString();
  const runRoot = path.join(output, startedAt.replace(/[:.]/g, '-') + '-' + process.pid);
  const project = createBaselineProject({ root: runRoot, largeSlides });
  await fs.mkdir(runRoot, { recursive: true });
  const result = {
    schemaVersion: 1, startedAt, status: 'running', artifactRoot: runRoot,
    environment: { node: process.version, playwright: require('playwright/package.json').version, platform: process.platform, arch: process.arch },
    memoryScope: 'Node process RSS only; excludes Chromium processes', decks: [],
  };
  let peakRss = process.memoryUsage().rss;
  const sampleMemory = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); };
  const timer = setInterval(sampleMemory, 100);
  const start = performance.now();
  let browser, server;
  try {
    browser = await chromium.launch({ headless: true });
    result.environment.chromium = browser.version();
    const renderer = createRenderer(project);
    for (const deck of project.decks) {
      const deckStart = performance.now();
      const report = await renderer.renderDeck(browser, deck);
      assert.equal(report.length, deck.slides.length);
      assert(report.every(item => !item.layoutIssues && !item.missingAssets && !item.consoleMessages), `${deck.id}: render failures`);
      for (const item of report) {
        const png = await fs.readFile(item.png);
        assert.equal(png.readUInt32BE(16), deck.width);
        assert.equal(png.readUInt32BE(20), deck.height);
      }
      result.decks.push({ id: deck.id, slides: report.length, durationMs: Math.round(performance.now() - deckStart), failures: 0 });
      console.log(`Baseline: ${deck.id}, ${report.length} slides passed`);
    }
    const scanned = await scanDecks(project);
    assert.deepEqual(scanned.decks.map(deck => deck.slides.length), project.decks.map(deck => deck.slides.length));
    server = createReviewServer(project);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for (const deck of project.decks) {
      await page.locator('#deckSelect').selectOption(deck.id);
      await page.waitForFunction(count => document.querySelectorAll('.html-inline-holder .slide').length === count, deck.slides.length);
      assert.equal(await page.locator('.slide-tab').count(), deck.slides.length);
      await page.locator('#deckMode').click();
      await page.setViewportSize({ width: 400, height: 800 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator('#focusMode').click();
      await page.setViewportSize({ width: 1200, height: 900 });
    }
    assert.deepEqual(errors, []);
    await page.close();
    result.viewer = { decks: project.decks.length, focus: true, overview: true, narrowViewport: true, pageErrors: 0 };
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = error.message;
    throw error;
  } finally {
    clearInterval(timer); sampleMemory();
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    result.durationMs = Math.round(performance.now() - start);
    result.nodePeakRssBytes = peakRss;
    await fs.writeFile(path.join(runRoot, 'baseline-result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
    await fs.writeFile(path.join(output, 'latest.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ status: result.status, report: path.join(output, 'latest.json'), durationMs: result.durationMs }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
