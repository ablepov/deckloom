const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, PDFDict, PDFName, PDFArray, PDFStream } = require('pdf-lib');
const { fail, readiness, staticInspection } = require('./runtime.cjs');
const { physical, within } = require('./project.cjs');
const BASE = ['deckId', 'outputRoot', 'browser', 'signal', 'onProgress', 'hookTimeoutMs', 'pageTimeoutMs', 'warnings'];
function closed(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('INVALID_EXPORT_OPTIONS', `${name} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw fail('INVALID_EXPORT_OPTIONS', `Unknown ${name} option: ${key}`);
}
function request(input = {}) {
  closed(input, [...BASE, 'slideIds', 'formats', 'png', 'pdf', 'pptx', 'fonts', 'resources'], 'export');
  if (typeof input.deckId !== 'string' || !input.deckId || typeof input.outputRoot !== 'string' || !input.outputRoot.trim()) throw fail('INVALID_EXPORT_OPTIONS', 'Export requires one exact deckId and a separate outputRoot');
  const formats = input.formats ?? ['png', 'html'];
  if (!Array.isArray(formats) || !formats.length || Array.from(formats).some(format => !['png', 'html', 'pdf', 'pptx'].includes(format)) || new Set(formats).size !== formats.length) throw fail('INVALID_EXPORT_OPTIONS', 'formats must be a nonempty unique array of png/html/pdf/pptx');
  if (input.slideIds !== undefined && (!Array.isArray(input.slideIds) || !input.slideIds.length || Array.from(input.slideIds).some(id => typeof id !== 'string' || !id) || new Set(input.slideIds).size !== input.slideIds.length)) throw fail('INVALID_SELECTION', 'slideIds must be nonempty unique exact IDs');
  const png = { scale: 1, transparent: false, ...input.png }, pdf = { media: 'screen', background: true, ...input.pdf }, fonts = { policy: 'strict', expected: [], ...input.fonts };
  if (input.png !== undefined) closed(input.png, ['scale', 'transparent'], 'png');
  if (input.pdf !== undefined) closed(input.pdf, ['media', 'background'], 'pdf');
  if (input.fonts !== undefined) closed(input.fonts, ['policy', 'expected'], 'fonts');
  if (typeof png.scale !== 'number' || !Number.isFinite(png.scale) || png.scale <= 0 || typeof png.transparent !== 'boolean') throw fail('INVALID_EXPORT_OPTIONS', 'PNG requires finite scale > 0 and boolean transparent');
  if (!['screen', 'print'].includes(pdf.media) || typeof pdf.background !== 'boolean') throw fail('INVALID_EXPORT_OPTIONS', 'PDF requires screen/print media and boolean background');
  if (!['strict', 'allow-substitution'].includes(fonts.policy) || !Array.isArray(fonts.expected) || Array.from(fonts.expected).some(name => typeof name !== 'string' || !name.trim()) || new Set(fonts.expected).size !== fonts.expected.length) throw fail('INVALID_EXPORT_OPTIONS', 'Invalid font policy or expected font families');
  if (input.resources !== undefined && input.resources !== 'offline') throw fail('INVALID_EXPORT_OPTIONS', 'Only the strict offline resource profile is supported for export; use render for linked output');
  if (input.pptx !== undefined && !formats.includes('pptx')) throw fail('INVALID_PPTX_OPTIONS', 'pptx options require the pptx format');
  const pptx = formats.includes('pptx') ? require('./pptx.cjs').options(input.pptx, fonts) : undefined;
  const settings = Object.fromEntries(BASE.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  return { settings, export: Object.freeze({ requestVersion: 1, deckId: input.deckId, slideIds: input.slideIds ? Object.freeze([...input.slideIds]) : undefined,
    formats: Object.freeze([...formats]), png: Object.freeze(png), pdf: Object.freeze(pdf), ...(pptx ? { pptx } : {}), fonts: Object.freeze({ ...fonts, expected: Object.freeze([...fonts.expected]) }), resources: 'offline' }) };
}
function prepare(prepared, options) {
  const sourceRoots = [prepared.project.root, ...Object.values(prepared.project.staticMounts || {})];
  const out = physical(prepared.outputRoot, 'outputRoot');
  for (const root of sourceRoots) {
    const source = physical(root, 'sourceRoot');
    if (within(source, out) || within(out, source)) throw fail('EXPORT_SOURCE_OVERLAP', 'Export outputRoot must be disjoint from source root and static mounts');
  }
  const target = prepared.selected[0], selected = options.slideIds ? new Set(options.slideIds) : null;
  if (selected) for (const id of selected) if (!target.slides.some(item => item.slide.id === id)) throw fail('UNKNOWN_SLIDE', `Unknown slide ID: ${id}`, { deckId: target.deck.id, slideId: id });
  const slides = target.slides.filter(item => !selected || selected.has(item.slide.id));
  if (options.pptx && slides.length > 64) throw fail('PPTX_INPUT_BUDGET', 'PPTX supports at most 64 selected slides');
  for (const { slide } of slides) {
    if (options.pptx && (!((slide.width === 960 && slide.height === 540) || (slide.width === 540 && slide.height === 960)) || slide.width !== slides[0].slide.width || slide.height !== slides[0].slide.height)) throw fail('PPTX_UNSUPPORTED_CANVAS', 'PPTX requires uniform 960x540 or 540x960 slides; mixed orientations require separate decks', { slideId: slide.id });
    const width = slide.width * options.png.scale, height = slide.height * options.png.scale;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw fail('NON_INTEGRAL_PIXELS', 'PNG dimensions must be positive integer pixels at the requested scale', { slideId: slide.id });
    if (width > 16384 || height > 16384 || width * height > 64 * 1024 * 1024) throw fail('UNSUPPORTED_CANVAS', 'Scaled PNG exceeds the 16384 px / 64 Mi pixel budget', { slideId: slide.id });
  }
  const namespace = `_deckloom-export/${target.deck.id}`;
  const outputs = { html: `${namespace}/index.html`, manifest: `${namespace}/export-manifest.json`, ...(options.formats.includes('pdf') ? { pdf: `${namespace}/presentation.pdf` } : {}),
    ...(options.pptx ? { pptx: `${namespace}/presentation.pptx`, pptxRaw: `${namespace}/backend-raw.pptx`, pptxPrepared: `${namespace}/prepared-pptx.json`, pptxReport: `${namespace}/pptx-verification.json` } : {}) };
  for (const rel of [namespace.split('/')[0], namespace, ...Object.values(outputs)]) {
    const file = path.join(prepared.outputRoot, rel), actual = physical(file, 'export.outputs');
    if (!within(out, actual)) throw fail('PATH_ESCAPE', 'Export output resolves outside outputRoot');
    if ((prepared.planned || prepared.selected).some(deck => deck.report.toLowerCase() === file.toLowerCase())) throw fail('DUPLICATE_PATH', 'Export namespace conflicts with reportName');
    try { if (fs.lstatSync(file).isSymbolicLink()) throw fail('PATH_ESCAPE', 'Export output namespace cannot contain links'); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    try { const stat = fs.statSync(file); const directory = !Object.values(outputs).includes(rel); if (directory ? !stat.isDirectory() : !stat.isFile()) throw fail('PATH_CONFLICT', 'Invalid export output type'); }
    catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
  }
  return Object.freeze({ ...prepared, selected: Object.freeze([Object.freeze({ ...target, slides: Object.freeze(slides), exportOutputs: Object.freeze(outputs) })]) });
}

async function fontsUsed(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable'); await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    const { nodeIds } = await session.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'body, body *' });
    const fonts = new Map();
    for (const nodeId of nodeIds) for (const item of (await session.send('CSS.getPlatformFontsForNode', { nodeId })).fonts) {
      if (item.glyphCount) fonts.set(`${item.postScriptName}:${item.isCustomFont}`, item);
    }
    return [...fonts.values()];
  } finally {
    await session.detach();
    // Chromium clears media features on CDP detach, including reduced-motion.
    // Restore Playwright's configured media and features before further work.
    await page.emulateMedia({});
  }
}
function validateFonts(fonts, policy) {
  const substitutions = fonts.filter(font => !font.isCustomFont);
  if (policy === 'strict' && substitutions.length) throw fail('FONT_NOT_BUNDLED', `Strict export requires file-backed web fonts; platform fonts used: ${substitutions.map(font => font.familyName).join(', ')}`, { stage: 'fonts' });
  return substitutions.map(font => ({ familyName: font.familyName, postScriptName: font.postScriptName, allowed: true, reason: 'platform-font' }));
}
async function pdfSlide(page, slide, settings) {
  await page.emulateMedia({ media: settings.pdf.media });
  const colorAdjust = settings.pdf.background ? 'exact' : 'economy';
  await page.evaluate(css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); }, `@page{size:${slide.width}px ${slide.height}px!important;margin:0!important}*,*::before,*::after{-webkit-print-color-adjust:${colorAdjust}!important;print-color-adjust:${colorAdjust}!important}`);
  const colorConflicts = await page.evaluate(value => {
    const conflicts = [];
    for (const element of document.querySelectorAll('*')) {
      element.style.setProperty('print-color-adjust', value, 'important');
      element.style.setProperty('-webkit-print-color-adjust', value, 'important');
      for (const pseudo of ['::before', '::after', '::first-letter', '::first-line', '::marker']) {
        const style = getComputedStyle(element, pseudo);
        if (style.printColorAdjust !== value && (style.backgroundImage !== 'none' || !['rgba(0, 0, 0, 0)', 'transparent'].includes(style.backgroundColor))) conflicts.push(`${element.tagName}${pseudo}`);
      }
    }
    return conflicts;
  }, colorAdjust);
  if (colorConflicts.length) throw fail('PDF_COLOR_POLICY_CONFLICT', 'Authored pseudo-element color policy conflicts with pdf.background; prepare static CSS without the conflicting important rule', { stage: 'pdf' });
  const ready = await page.evaluate(readiness);
  if (ready.fonts.length || ready.images.length) throw fail('PDF_RESOURCE_FAILED', 'PDF media has unreadable fonts/images');
  const unsupported = await page.evaluate(staticInspection);
  if (unsupported.length) throw fail('UNSUPPORTED_HTML', unsupported.join('; '), { stage: 'pdf' });
  const fonts = await fontsUsed(page); validateFonts(fonts, settings.fonts.policy);
  // Detaching the font-inspection CDP session clears Chromium's media override.
  // Reapply it so printToPDF uses the same media as the inspected font inventory.
  await page.emulateMedia({ media: settings.pdf.media });
  const bytes = await page.pdf({ width: `${slide.width}px`, height: `${slide.height}px`, margin: { top: '0', right: '0', bottom: '0', left: '0' }, displayHeaderFooter: false, printBackground: settings.pdf.background, preferCSSPageSize: true, scale: 1 });
  const document = await PDFDocument.load(bytes), pages = document.getPages();
  if (pages.length !== 1) throw fail('PDF_PAGINATION', `Slide ${slide.id} produced ${pages.length} PDF pages`, { slideId: slide.id });
  const size = pages[0].getSize();
  if (Math.abs(size.width - slide.width * .75) > .8 || Math.abs(size.height - slide.height * .75) > .8) throw fail('PDF_DIMENSION_MISMATCH', 'Chromium PDF page does not match the slide canvas', { slideId: slide.id });
  return { bytes, fonts, size };
}
async function mergePdf(pages) {
  const document = await PDFDocument.create();
  for (const item of pages) {
    const source = await PDFDocument.load(item.bytes);
    for (const page of await document.copyPages(source, [0])) document.addPage(page);
  }
  const bytes = Buffer.from(await document.save());
  const verify = await PDFDocument.load(bytes), fonts = [], visited=new Set();
  const resolve=value=>verify.context.lookup(value);
  const nonemptyStream=value=>{const stream=resolve(value);return stream instanceof PDFStream&&stream.getContents().length>0;};
  function inspectFont(object){
    if(visited.has(object))return;visited.add(object);
    const subtype=object.get(PDFName.of('Subtype'))?.toString();
    if(subtype==='/Type0'){
      const descendants=resolve(object.get(PDFName.of('DescendantFonts')));
      if(!(descendants instanceof PDFArray)||!descendants.size())throw fail('PDF_FONT_NOT_EMBEDDED','Composite PDF font has no descendants');
      for(const child of descendants.asArray()){const font=resolve(child);if(!(font instanceof PDFDict))throw fail('PDF_FONT_NOT_EMBEDDED','Invalid PDF descendant font');inspectFont(font);}
      return;
    }
    const descriptor=resolve(object.get(PDFName.of('FontDescriptor')));
    let embedded=false;
    if(subtype==='/Type3'){
      // Type3 glyph programs live in CharProcs, not in a FontFile stream.
      const programs=resolve(object.get(PDFName.of('CharProcs')));
      embedded=programs instanceof PDFDict&&programs.entries().length>0&&programs.entries().every(([,stream])=>nonemptyStream(stream));
    }else if(descriptor instanceof PDFDict)embedded=['FontFile','FontFile2','FontFile3'].some(key=>nonemptyStream(descriptor.get(PDFName.of(key))));
    fonts.push({name:(descriptor instanceof PDFDict?descriptor.get(PDFName.of('FontName')):object.get(PDFName.of('BaseFont')))?.toString().slice(1),embedded,...(subtype==='/Type3'?{type:'Type3'}:{})});
  }
  for(const [,object]of verify.context.enumerateIndirectObjects())if(object instanceof PDFDict&&object.get(PDFName.of('Type'))?.toString()==='/Font')inspectFont(object);
  if (fonts.some(font => !font.embedded) || pages.some(page => page.fonts.length) && !fonts.length) throw fail('PDF_FONT_NOT_EMBEDDED', 'PDF font embedding was not confirmed');
  const normalize = value => value.replace(/^[A-Z]{6}\+/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  for (const page of pages) for (const font of page.fonts) if (!fonts.some(item => normalize(item.name || '') === normalize(font.postScriptName))) throw fail('PDF_FONT_NOT_EMBEDDED', `Missing PDF font: ${font.postScriptName}`);
  return { bytes, pages: verify.getPages().map(page => page.getSize()), fonts };
}
function deckHtml(target) {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  return '<!doctype html><meta charset="utf-8"><title>' + escape(target.deck.label) + '</title><style>body{margin:0;background:#ddd}section{margin:20px auto;width:max-content}iframe{display:block;border:0;background:white}</style>' + target.slides.map(item => {
    const rel = path.posix.relative(path.posix.dirname(target.exportOutputs.html), item.htmlRelative);
    return `<section><iframe title="${escape(item.slide.name || item.slide.id)}" sandbox="allow-same-origin" width="${item.slide.width}" height="${item.slide.height}" src="${escape(rel)}?build=${target.buildId}"></iframe></section>`;
  }).join('');
}
module.exports = { request, prepare, fontsUsed, validateFonts, pdfSlide, mergePdf, deckHtml };
