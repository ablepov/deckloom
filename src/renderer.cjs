const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { measureLayout, issueCount } = require('./qa.cjs');

// One rename publishes each artifact; Windows readers may briefly lock a file.
async function writeArtifact(file, data, encoding) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, data, encoding);
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, file); break; }
      catch (error) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  } finally { await fs.rm(temporary, { force: true }); }
}

function createRenderer(project) {
  if (!project?.root || typeof project.renderDocument !== 'function') {
    throw new Error('A project root and renderDocument(deck, slide, options) are required');
  }
  const root = path.resolve(project.root);
  const artifactName = (deck, slide) => {
    const name = `${deck.artifactPrefix}-${slide.no}`;
    if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`Invalid artifact name: ${name}`);
    return name;
  };

  async function renderDeck(browser, deck, { outputRoot = root } = {}) {
    if (deck.expectedSlides != null && deck.slides.length !== deck.expectedSlides) {
      throw new Error(`${deck.label}: expected ${deck.expectedSlides} slides, got ${deck.slides.length}`);
    }
    outputRoot = path.resolve(outputRoot);
    const report = [];
    for (const slide of deck.slides) {
      const artifact = artifactName(deck, slide);
      const dir = path.join(outputRoot, artifact);
      await fs.mkdir(dir, { recursive: true });
      const baseUrl = outputRoot === root ? '' : pathToFileURL(path.join(root, artifact) + path.sep).href;
      const html = await project.renderDocument(deck, slide, { baseUrl });
      await project.validateDocument?.(html, deck, slide);
      const htmlPath = path.join(dir, `${artifact}-render.html`);
      const pngPath = path.join(dir, 'generated-html.png');
      const specPath = path.join(dir, `${artifact}-spec.md`);
      const qaPath = path.join(dir, `${artifact}-qa.md`);
      await writeArtifact(htmlPath, html, 'utf8');
      if (project.renderSpec) await writeArtifact(specPath, await project.renderSpec(deck, slide), 'utf8');
      const page = await browser.newPage({
        viewport: { width: slide.width || deck.width || 1920, height: slide.height || deck.height || 1080 },
        deviceScaleFactor: 1,
      });
      const consoleMessages = [];
      page.on('console', message => {
        if (['error', 'warning'].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() });
      });
      page.on('pageerror', error => consoleMessages.push({ type: 'pageerror', text: error.message }));
      try {
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle', timeout: 30000 });
        await page.evaluate(async () => {
          if (document.fonts?.ready) await document.fonts.ready;
          await Promise.all(Array.from(document.images).map(img => {
            if (img.complete && img.naturalWidth > 0) return Promise.resolve();
            if (typeof img.decode === 'function') return img.decode().catch(() => undefined);
            return new Promise(resolve => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            });
          }));
        });
        await writeArtifact(pngPath, await page.screenshot({ type: 'png' }));
        const layoutQa = await page.evaluate(project.measureLayout || measureLayout, project.layoutOptions);
        const layoutIssues = (project.issueCount || issueCount)(layoutQa);
        const missingAssets = await page.$$eval('img', imgs => imgs
          .filter(img => !img.complete || img.naturalWidth === 0).map(img => img.getAttribute('src')));
        const entry = {
          deck: deck.id, slide: slide.no, sourceNode: slide.nodeId, name: slide.name,
          png: pngPath, spec: project.renderSpec ? specPath : undefined, html: htmlPath, qa: qaPath,
          overflowIssues: layoutQa.overflow?.length || 0, layoutIssues, layoutQa,
          missingAssets: missingAssets.length, consoleMessages: consoleMessages.length,
        };
        const context = { deck, slide, artifact, layoutQa, layoutIssues, missingAssets, consoleMessages };
        const qa = project.renderQa ? await project.renderQa(context) : JSON.stringify(context, null, 2);
        await writeArtifact(qaPath, qa, 'utf8');
        report.push(entry);
      } finally { await page.close(); }
    }
    const reportName = project.reportName?.(deck) || `render-report-${deck.id}.json`;
    if (path.basename(reportName) !== reportName) throw new Error('reportName must be a file name');
    await writeArtifact(path.join(outputRoot, reportName), JSON.stringify(report, null, 2), 'utf8');
    return report;
  }

  async function run(args = process.argv.slice(2)) {
    const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
    const requested = option('deck') || project.decks[0]?.id;
    const decks = requested === 'all' ? project.decks : project.decks.filter(deck => deck.id === requested);
    if (!decks.length) throw new Error(`Unknown deck "${requested}". Available: ${project.decks.map(deck => deck.id).join(', ')}, all`);
    const outputRoot = path.resolve(option('output') || root);
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const reports = {};
    try {
      for (const deck of decks) reports[deck.id] = await renderDeck(browser, deck, { outputRoot });
    } finally { await browser.close(); }
    const failed = Object.values(reports).flat().filter(r => r.layoutIssues || r.missingAssets || r.consoleMessages);
    console.log(JSON.stringify({ outputRoot, slides: Object.values(reports).flat().length,
      failed: failed.map(r => ({ deck: r.deck, slide: r.slide, layout: r.layoutIssues, assets: r.missingAssets, console: r.consoleMessages })) }, null, 2));
    if (failed.length) process.exitCode = 1;
    return reports;
  }
  return { renderDocument: project.renderDocument, renderDeck, run };
}
module.exports = { createRenderer, writeArtifact };
