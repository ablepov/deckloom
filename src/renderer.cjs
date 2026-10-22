const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { measureLayout, issueCount } = require('./qa.cjs');
const { validateRuntimeProject } = require('./project.cjs');
const builds = require('./builds.cjs');
const execution = require('./runtime.cjs');
const exporter = require('./exports.cjs');
const { createResourceBundler } = require('./resources.cjs');
const { createHash } = require('node:crypto');

function createRenderer(project) {
  const root = validateRuntimeProject(project).project.root;

  async function execute(input = {}, selectedDeck, exportMode = false) {
    const request = exportMode ? exporter.request(input) : undefined;
    const exportOptions = request?.export;
    const settings = execution.options(request ? request.settings : input);
    let prepared = validateRuntimeProject({ ...project, root }, { operation: 'render',
      ...(selectedDeck !== undefined ? { deck: selectedDeck } : settings.deckId !== undefined ? { deckId: settings.deckId } : {}),
      ...(exportOptions?.slideIds ? { slideIds: exportOptions.slideIds } : {}),
      outputRoot: path.resolve(settings.outputRoot || root) });
    if (exportOptions) prepared = exporter.prepare(prepared, exportOptions);
    if (settings.browser !== undefined && typeof settings.browser?.newPage !== 'function') throw execution.fail('INVALID_OPTIONS', 'browser must be a Playwright Browser');
    const runtime = prepared.project, v1 = runtime.inputVersion === 1;
    const result = { resultVersion: 1, status: 'succeeded', outputRoot: prepared.outputRoot, reports: Object.create(null), builds: [], diagnostics: [], failures: [] };
    if (exportOptions) Object.assign(result, { exportVersion: 1, request: { ...exportOptions, slideIds: prepared.selected[0].slides.map(item => item.slide.id) }, outputs: [] });
    let release, ownedBrowser, current = {};
    const emit = async event => {
      if (settings.onProgress) await execution.hook({ onProgress: settings.onProgress }, 'onProgress', [Object.freeze({ ...event })], settings);
    };
    try {
      execution.check(settings.signal);
      release = await builds.acquire(prepared.outputRoot);
      for (const target of prepared.selected) {
        const deck = target.deck;
        current = { deckId: deck.id };
        const build = await builds.begin(prepared.outputRoot, deck.id);
        result.builds.push({ deckId: deck.id, buildId: build.manifest.buildId, state: 'building', manifest: path.join(build.directory, '../manifest.json') });
        const buildResult = result.builds.at(-1), report = [];
        const pdfPages = [], pptxScenes = [], exportOutputs = [], selectedHtml = [];
        let bundler;
        result.reports[deck.id] = report;
        try {
          await emit({ type: 'deck-start', deckId: deck.id, buildId: build.manifest.buildId });
          if (exportOptions) {
            build.manifest.export = { ...exportOptions, slideIds: target.slides.map(item => item.slide.id), outputs: [], resources: [], fonts: [] };
            bundler = await createResourceBundler(runtime, { ...settings, ...exportOptions });
            build.manifest.export.resources = bundler.records;
            if (exportOptions.pptx) build.manifest.export.pptx = { fontProfile: await require('./pptx.cjs').profile(settings) };
          }
          let browser = settings.browser;
          if (!browser) {
            if (!ownedBrowser) ownedBrowser = await require('playwright').chromium.launch({ headless: true, timeout: settings.pageTimeoutMs });
            browser = ownedBrowser;
          }
          for (const item of target.slides) {
            const slide = item.slide;
            current = { deckId: deck.id, slideId: slide.id };
            execution.check(settings.signal);
            await emit({ type: 'slide-start', ...current, index: slide.index, total: target.slides.length });
            const artifact = path.basename(item.output.directory);
            const artifactMap = {};
            for (const role of ['html', 'png', 'qa', ...(runtime.renderSpec ? ['spec'] : [])]) artifactMap[role] = builds.relative(prepared.outputRoot, item.output[role]);
            const staged = role => path.join(build.directory, artifactMap[role]);
            await fs.mkdir(path.dirname(staged('html')), { recursive: true });
            const composition = { id: slide.id, index: slide.index, width: slide.width, height: slide.height, artifacts: {} };
            build.manifest.slides.push(composition);
            const baseUrl = prepared.outputRoot === runtime.root ? '' : pathToFileURL(item.source.directory + path.sep).href;
            const contextOptions = { baseUrl, signal: settings.signal };
            let html = await execution.hook(runtime, 'renderDocument', [deck, slide, contextOptions], settings, 'string');
            if (!html.trim()) throw execution.fail('INVALID_HOOK_RESULT', 'renderDocument returned empty HTML', { stage: 'renderDocument' });
            if (runtime.validateDocument) await execution.hook(runtime, 'validateDocument', [html, deck, slide, contextOptions], settings, 'void');
            if (bundler) {
              html = await execution.bounded(() => bundler.bundle(html, pathToFileURL(item.source.html).href), settings.pageTimeoutMs, settings.signal, 'bundle');
              if (bundler.failures.length) {
                for (const failure of bundler.failures) build.manifest.diagnostics.push({ severity: 'error', code: failure.code, message: `${failure.message}: ${failure.url}`, ...current, stage: 'bundle' });
                result.diagnostics.push(...build.manifest.diagnostics.slice(-bundler.failures.length));
                throw execution.fail('RESOURCE_BUNDLE_FAILED', `${bundler.failures.length} unpackable resources`, { stage: 'bundle' });
              }
            }
            await builds.writeArtifact(staged('html'), html, 'utf8'); composition.artifacts.html = artifactMap.html;
            if (runtime.renderSpec) {
              await builds.writeArtifact(staged('spec'), await execution.hook(runtime, 'renderSpec', [deck, slide, contextOptions], settings, 'string'), 'utf8');
              composition.artifacts.spec = artifactMap.spec;
            }
            let page, abandoned = false, pageFailed = false;
            const diagnostics = [], consoleMessages = [];
            try {
              page = await execution.bounded(async () => {
                const opened = await browser.newPage({ viewport: { width: slide.width, height: slide.height }, deviceScaleFactor: exportOptions?.png.scale || 1, javaScriptEnabled: !(v1 || exportMode), colorScheme: 'light', reducedMotion: 'reduce' });
                if (abandoned) { await opened.close(); throw execution.fail('CANCELLED', 'Page creation abandoned'); }
                return opened;
              }, settings.pageTimeoutMs, settings.signal, 'newPage');
              const add = (code, message, severity = 'error') => diagnostics.push({ code, message, severity, ...current });
              page.on('console', message => {
                if (['error', 'warning'].includes(message.type())) {
                  consoleMessages.push({ type: message.type(), text: message.text() });
                  add('PAGE_CONSOLE', message.text(), message.type() === 'warning' ? 'warning' : 'error');
                }
              });
              page.on('pageerror', cause => { consoleMessages.push({ type: 'pageerror', text: cause.message }); add('PAGE_ERROR', cause.message); });
              page.on('requestfailed', request => add('RESOURCE_FAILED', `${request.resourceType()}: ${request.url()} — ${request.failure()?.errorText}`));
              page.on('response', response => { if (response.status() >= 400) add('RESOURCE_HTTP', `${response.status()}: ${response.url()}`); });
              const bootstrap = exportOptions ? 'about:blank' : pathToFileURL(path.join(build.directory, '../bootstrap.html')).href;
              if (exportOptions) await page.route('**/*', route => route.request().url() === bootstrap ? route.continue() : route.abort('blockedbyclient'));
              // Establish file origin, then use the logical source base. Moving
              // generated artifacts into a generation must not move resources.
              await execution.bounded(async () => {
                await page.goto(bootstrap, { waitUntil: 'load', timeout: settings.pageTimeoutMs });
                if (v1 || exportMode) {
                  const parsed = await page.evaluateHandle(value => new DOMParser().parseFromString(value, 'text/html'), html);
                  try {
                    const unsupported = await parsed.evaluate(execution.staticInspection);
                    if (unsupported.length) throw execution.fail('UNSUPPORTED_HTML', unsupported.join('; '), { stage: 'profile' });
                  } finally { await parsed.dispose(); }
                }
                const documentHtml = exportOptions ? html : await page.evaluate(execution.documentForRender, { html, baseUrl: pathToFileURL(item.source.directory + path.sep).href });
                await page.setContent(documentHtml, { waitUntil: 'load', timeout: settings.pageTimeoutMs });
                const unsupported = await page.evaluate(execution.staticInspection);
                if (unsupported.length) {
                  if (v1 || exportMode) throw execution.fail('UNSUPPORTED_HTML', unsupported.join('; '), { stage: 'profile' });
                  add('LEGACY_DYNAMIC_HTML', unsupported.join('; '), 'warning');
                }
              }, settings.pageTimeoutMs, settings.signal, 'document');
              const ready = await execution.bounded(() => page.evaluate(execution.readiness), settings.pageTimeoutMs, settings.signal, 'readiness');
              for (const font of ready.fonts) add('FONT_FAILED', font);
              for (const image of ready.images) add('IMAGE_FAILED', image);
              const layoutQa = await execution.hook({ measureLayout: () => page.evaluate(runtime.measureLayout || measureLayout, runtime.layoutOptions) }, 'measureLayout', [], settings);
              if (!layoutQa || typeof layoutQa !== 'object' || Array.isArray(layoutQa)) throw execution.fail('INVALID_HOOK_RESULT', 'measureLayout must return an object', { stage: 'measureLayout' });
              let count;
              try { count = (runtime.issueCount || issueCount)(layoutQa); }
              catch (cause) { throw execution.fail(cause?.code || 'HOOK_FAILED', cause?.message || String(cause), { stage: 'issueCount' }); }
              if (count && typeof count.then === 'function') Promise.resolve(count).catch(() => {});
              if (!Number.isSafeInteger(count) || count < 0) throw execution.fail('INVALID_HOOK_RESULT', 'issueCount must synchronously return a nonnegative safe integer', { stage: 'issueCount' });
              if (count) add('LAYOUT_ISSUES', `${count} layout issues`);
              let fontReport;
              if (exportOptions) {
                const fonts = await execution.bounded(() => exporter.fontsUsed(page), settings.pageTimeoutMs, settings.signal, 'fonts');
                fontReport = { screen: fonts, substitutions: exporter.validateFonts(fonts, exportOptions.fonts.policy) };
                // Capture the common prepared screen DOM before PDF changes media/styles.
                if (exportOptions.pptx) pptxScenes.push(await execution.bounded(() => require('./pptx.cjs').capture(page, slide, fonts, { path: artifactMap.html, sha256: createHash('sha256').update(html).digest('hex') }), settings.pageTimeoutMs, settings.signal, 'pptx-capture'));
              }
              const png = await execution.bounded(() => page.screenshot({ type: 'png', animations: 'disabled', omitBackground: exportOptions?.png.transparent || false, timeout: settings.pageTimeoutMs }), settings.pageTimeoutMs, settings.signal, 'screenshot');
              if (exportOptions && (png.length < 24 || png.readUInt32BE(16) !== slide.width * exportOptions.png.scale || png.readUInt32BE(20) !== slide.height * exportOptions.png.scale)) throw execution.fail('PNG_DIMENSION_MISMATCH', 'PNG pixel dimensions differ from the prepared request');
              await builds.writeArtifact(staged('png'), png);
              composition.artifacts.png = artifactMap.png;
              if (exportOptions) {
                if (exportOptions.formats.includes('pdf')) {
                  const pdf = await execution.bounded(() => exporter.pdfSlide(page, slide, exportOptions), settings.pageTimeoutMs, settings.signal, 'pdf');
                  pdfPages.push(pdf); fontReport.pdf = pdf.fonts;
                  fontReport.substitutions.push(...exporter.validateFonts(pdf.fonts, exportOptions.fonts.policy));
                }
                if (diagnostics.some(item => item.severity === 'error' && /^(RESOURCE_|IMAGE_|FONT_|PAGE_)/.test(item.code))) throw execution.fail('EXPORT_RESOURCE_FAILED', 'Offline browser verification failed', { stage: 'offline' });
                build.manifest.export.fonts.push({ slideId: slide.id, ...fontReport });
                selectedHtml.push({ ...item, htmlRelative: artifactMap.html });
                if (exportOptions.formats.includes('png')) exportOutputs.push({ format: 'png', slideId: slide.id, path: artifactMap.png, mediaType: 'image/png', width: slide.width * exportOptions.png.scale, height: slide.height * exportOptions.png.scale });
                if (exportOptions.formats.includes('html')) exportOutputs.push({ format: 'html', slideId: slide.id, path: artifactMap.html, mediaType: 'text/html' });
              }
              const entry = { deck: deck.id, slide: v1 ? slide.id : slide.artifactNo,
                ...(v1 ? { index: slide.index, number: slide.number, width: slide.width, height: slide.height } : { sourceNode: slide.data.source.nodeId }),
                name: slide.name, png: item.output.png, spec: runtime.renderSpec ? item.output.spec : undefined, html: item.output.html, qa: item.output.qa,
                artifacts: Object.fromEntries(Object.keys(artifactMap).map(role => [role, staged(role)])),
                ...(exportOptions ? { fonts: fontReport, pixelWidth: slide.width * exportOptions.png.scale, pixelHeight: slide.height * exportOptions.png.scale } : {}),
                overflowIssues: layoutQa.overflow?.length || 0, layoutIssues: count, layoutQa,
                missingAssets: ready.images.length, consoleMessages: consoleMessages.length, buildId: build.manifest.buildId, diagnostics };
              const context = { deck, slide, artifact, layoutQa, layoutIssues: count, missingAssets: ready.images, consoleMessages, diagnostics, signal: settings.signal };
              const defaultContext = v1 ? { ...context, deck: { id: deck.id, label: deck.label, width: deck.width, height: deck.height }, slide: { id: slide.id, name: slide.name, index: slide.index, number: slide.number, width: slide.width, height: slide.height } }
                : { ...context, deck: deck.data.source, slide: slide.data.source };
              const qa = runtime.renderQa ? await execution.hook(runtime, 'renderQa', [context], settings, 'string') : JSON.stringify(defaultContext, null, 2);
              await builds.writeArtifact(staged('qa'), qa, 'utf8'); composition.artifacts.qa = artifactMap.qa;
              report.push(entry);
              await emit({ type: 'slide-complete', ...current, index: slide.index, total: target.slides.length });
            } catch (cause) { pageFailed = true; throw cause; } finally {
              abandoned = true;
              let cleanupFailure;
              if (page) {
                try { await execution.bounded(() => page.close(), settings.pageTimeoutMs, undefined, 'closePage'); }
                catch (cause) {
                  if (!pageFailed) cleanupFailure = cause;
                  else diagnostics.push(execution.diagnostic(cause, { ...current, stage: 'closePage' }));
                }
              }
              result.diagnostics.push(...diagnostics); build.manifest.diagnostics.push(...diagnostics);
              if (cleanupFailure) throw cleanupFailure;
            }
          }
          execution.check(settings.signal);
          build.manifest.report = builds.relative(prepared.outputRoot, target.report);
          await builds.writeArtifact(path.join(build.directory, build.manifest.report), JSON.stringify(report, null, 2), 'utf8');
          if (exportOptions) {
            const actualFonts = build.manifest.export.fonts.flatMap(item => exportOptions.formats.includes('pdf') ? item.pdf || [] : item.screen);
            for (const family of exportOptions.fonts.expected) if (!actualFonts.some(font => font.familyName.toLowerCase() === family.toLowerCase())) {
              if (exportOptions.fonts.policy === 'strict') throw execution.fail('EXPECTED_FONT_MISSING', `Expected font was not used: ${family}`, { stage: 'fonts' });
              build.manifest.export.fonts.push({ expected: family, substitutionAllowed: true, actual: [...new Set(actualFonts.map(font => font.familyName))] });
            }
            const extras = target.exportOutputs;
            await fs.mkdir(path.dirname(path.join(build.directory, extras.html)), { recursive: true });
            if (pptxScenes.length) {
              const pptx = await execution.bounded(() => require('./pptx.cjs').render(pptxScenes), settings.pageTimeoutMs, settings.signal, 'pptx-render');
              execution.check(settings.signal);
              await builds.writeArtifact(path.join(build.directory, extras.pptx), pptx.bytes);
              await builds.writeArtifact(path.join(build.directory, extras.pptxRaw), pptx.raw);
              await builds.writeArtifact(path.join(build.directory, extras.pptxPrepared), JSON.stringify(pptxScenes, null, 2), 'utf8');
              const verification = { ...build.manifest.export.pptx, rawSha256: pptx.rawSha256, normalizedSha256: pptx.normalizedSha256, corrections: pptx.corrections, verified: pptx.verified, slides: pptx.slides, conversion: pptx.conversion };
              await builds.writeArtifact(path.join(build.directory, extras.pptxReport), JSON.stringify(verification, null, 2), 'utf8');
              build.manifest.export.pptx = { ...verification, prepared: extras.pptxPrepared, raw: extras.pptxRaw, report: extras.pptxReport };
              exportOutputs.push({ format: 'pptx', path: extras.pptx, mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', slides: pptx.slides });
            }
            if (pdfPages.length) {
              const pdf = await execution.bounded(() => exporter.mergePdf(pdfPages), settings.pageTimeoutMs, settings.signal, 'pdf-merge');
              await builds.writeArtifact(path.join(build.directory, extras.pdf), pdf.bytes);
              exportOutputs.push({ format: 'pdf', path: extras.pdf, mediaType: 'application/pdf', pages: pdf.pages, fonts: pdf.fonts });
            }
            await builds.writeArtifact(path.join(build.directory, extras.html), exporter.deckHtml({ ...target, buildId: build.manifest.buildId, slides: selectedHtml }), 'utf8');
            if (exportOptions.formats.includes('html')) exportOutputs.push({ format: 'html', path: extras.html, mediaType: 'text/html', kind: 'deck' });
            for (const output of exportOutputs) {
              const bytes = await fs.readFile(path.join(build.directory, output.path));
              output.bytes = bytes.length; output.sha256 = createHash('sha256').update(bytes).digest('hex');
            }
            build.manifest.outputs = Object.values(extras);
            build.manifest.export.outputs = exportOutputs;
            const manifest = { exportManifestVersion: 1, buildId: build.manifest.buildId, deckId: deck.id, state: 'complete',
              request: { ...exportOptions, slideIds: target.slides.map(item => item.slide.id) }, outputs: exportOutputs, fonts: build.manifest.export.fonts, resources: bundler.records, ...(build.manifest.export.pptx ? { pptx: build.manifest.export.pptx } : {}) };
            await builds.writeArtifact(path.join(build.directory, extras.manifest), JSON.stringify(manifest, null, 2), 'utf8');
          }
          // Compatibility mirrors are serialized with publication. Manifest-
          // aware readers stay on the previous generation until finish().
          for (const file of [...build.manifest.slides.flatMap(slide => Object.values(slide.artifacts)), build.manifest.report, ...(build.manifest.outputs || [])]) {
            execution.check(settings.signal);
            const canonical = path.join(prepared.outputRoot, file);
            await fs.mkdir(path.dirname(canonical), { recursive: true });
            await builds.writeArtifact(canonical, await fs.readFile(path.join(build.directory, file)));
          }
          await emit({ type: 'deck-ready', deckId: deck.id, buildId: build.manifest.buildId });
          execution.check(settings.signal);
          await build.finish('complete'); buildResult.state = 'complete';
          if (exportOptions) {
            result.outputs.push(...exportOutputs.map(output => ({ ...output, file: path.join(build.directory, output.path), buildId: build.manifest.buildId })));
            result.bundle = { directory: build.directory, index: path.join(build.directory, target.exportOutputs.html), manifest: path.join(build.directory, target.exportOutputs.manifest) };
          }
        } catch (cause) {
          const state = cause?.code === 'CANCELLED' ? 'cancelled' : 'failed';
          const item = execution.diagnostic(cause, current);
          result.diagnostics.push(item); build.manifest.diagnostics.push(item); buildResult.state = state;
          try { await build.finish(state); } catch (failure) { result.diagnostics.push(execution.diagnostic(failure, { ...current, stage: 'save-failed-manifest' })); }
          throw cause;
        }
      }
    } catch (cause) {
      if (cause?.build) result.builds.push(cause.build);
      result.status = cause?.code === 'CANCELLED' ? 'cancelled' : 'failed';
      result.error = execution.diagnostic(cause, current);
      if (!result.diagnostics.some(item => item.code === result.error.code && item.message === result.error.message)) result.diagnostics.push(result.error);
    } finally {
      for (const [stage, work] of [['closeBrowser', () => ownedBrowser?.close()], ['releaseLock', () => release?.()]]) {
        try { await execution.bounded(work, settings.pageTimeoutMs, undefined, stage); }
        catch (cause) {
          const item = execution.diagnostic(cause, { stage }); result.diagnostics.push(item);
          result.error ||= item; if (result.status === 'succeeded') result.status = 'failed';
        }
      }
    }
    result.failures = result.diagnostics.filter(item => item.severity === 'error' || settings.warnings === 'fail');
    if (result.failures.length && result.status === 'succeeded') result.status = 'failed';
    return result;
  }

  async function renderDeck(browser, deck, options = {}) {
    const result = await execute({ ...options, ...(browser === null ? {} : { browser }) }, deck === undefined ? project.decks[0]?.id : deck);
    if (result.error) throw Object.assign(new Error(result.error.message), result.error, { result });
    return Object.values(result.reports)[0];
  }
  // Compatibility adapter only. CLI owns argv, output and process exit status.
  async function run(args = []) {
    const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
    const requested = option('deck') || project.decks[0]?.id;
    const result = await execute({ ...(requested === 'all' ? {} : { deckId: requested }), outputRoot: option('output') || root });
    if (result.error) throw Object.assign(new Error(result.error.message), result.error, { result });
    return result.reports;
  }
  return { renderDocument: project.renderDocument, render: input => execute(input), export: input => execute(input, undefined, true), renderDeck, run };
}
module.exports = { createRenderer, writeArtifact: builds.writeArtifact };
