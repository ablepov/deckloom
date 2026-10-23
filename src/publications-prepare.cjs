const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, randomBytes } = require('node:crypto');
const publications = require('./publications.cjs');
const { createRenderer } = require('./renderer.cjs');
const { normalizeProject } = require('./project.cjs');
// One prepared, self-contained document set supplies images, PDF and semantic PPTX.
// Brand paths/selectors stay in the consumer's ordinary downloads adapter.
async function prepare(project, options) {
  if (!options || !path.isAbsolute(options.outputRoot || '')) throw new Error('An absolute publication outputRoot is required');
  const model = normalizeProject(project), deck = model.decks.find(deck => deck.id === options.deckId);
  if (!deck?.slides?.length) throw new Error('Choose one nonempty registered deck');
  const downloads = options.downloads || ['pdf'];
  if (!Array.isArray(downloads) || new Set(downloads).size !== downloads.length || downloads.some(format => !['pdf', 'pptx', 'pptx-fonts'].includes(format))) throw new Error('Unsupported publication downloads');
  const cfg = { ...model.downloads, ...model.downloads?.decks?.[deck.id] };
  const semantic = downloads.some(format => format !== 'pdf');
  if (semantic && cfg.pptx?.profile !== 'semantic-source-v1') throw new Error('Native publication downloads need an explicitly configured semantic source profile');
  const mappings = options.slideIds || {};
  if (deck.slides.some(slide => typeof mappings[slide.id] !== 'string')) throw new Error('Stable publication slideIds are required');
  await fs.mkdir(path.dirname(options.outputRoot), { recursive: true });
  await fs.mkdir(options.outputRoot); // Never overwrite an existing prepared publication.
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-publication-'));
  try {
    const result = await createRenderer(project).export({ deckId: deck.id, outputRoot: path.join(temporary, 'render'), formats: ['png', 'html', ...(downloads.includes('pdf') ? ['pdf'] : [])], fonts: { policy: cfg.fontPolicy || 'strict' }, onProgress: options.onProgress });
    if (result.status !== 'succeeded') throw Object.assign(new Error('Publication render failed'), { code: 'PUBLICATION_RENDER_FAILED', diagnostics: result.diagnostics });
    const generatedAt = new Date().toISOString(), slides = [], ready = {};
    async function save(file, bytes) {
      const destination = path.join(options.outputRoot, file);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes, { flag: 'wx' });
      return { file, bytes: bytes.length, sha256: publications.hash(bytes) };
    }
    const source = [];
    for (const [index, slide] of deck.slides.entries()) {
      const output = result.outputs.find(item => item.format === 'png' && item.slideId === slide.id);
      const html = result.outputs.find(item => item.format === 'html' && item.slideId === slide.id && item.kind !== 'deck');
      if (!output || !html) throw new Error('Prepared slide artifacts are missing');
      source.push([slide.id, publications.hash(await fs.readFile(html.file))]);
      const image = await save(`slides/${String(index + 1).padStart(3, '0')}.png`, await fs.readFile(output.file));
      slides.push({ id: mappings[slide.id], name: slide.name || String(index + 1), width: slide.width, height: slide.height, image });
    }
    if (downloads.includes('pdf')) {
      const output = result.outputs.find(item => item.format === 'pdf');
      ready.pdf = await save('downloads/presentation.pdf', await fs.readFile(output.file));
    }
    if (semantic) {
      const { semanticExport, fontArchive } = require('./downloads.cjs');
      let native;
      try { native = await semanticExport(result, deck, cfg, path.join(temporary, 'semantic'), { onProgress: options.onProgress }); }
      catch (error) { throw Object.assign(new Error('Native export is not ready for the selected source'), { code: 'PUBLICATION_NATIVE_EXPORT_FAILED', cause: error }); }
      const { output, fonts } = native;
      if (downloads.includes('pptx')) ready.pptx = await save('downloads/presentation.pptx', output.bytes);
      if (downloads.includes('pptx-fonts')) ready['pptx-fonts'] = await save('downloads/presentation-with-fonts.zip', await fontArchive(output.bytes, deck.label, fonts, cfg.pptx.fonts, new Set(output.conversion.fonts.map(font => font.sha256))));
    }
    const manifest = publications.validate({ publicationVersion: 1, sourceId: options.sourceId, projectId: options.projectId, deckId: deck.id,
      releaseId: randomUUID(), shareId: options.shareId || randomBytes(16).toString('hex'), title: deck.label, publishedAt: generatedAt, generatedAt,
      engineVersion: require('../package.json').version, sourceSha256: publications.hash(JSON.stringify(source)), slides, downloads: ready });
    await publications.verify(manifest, file => fs.readFile(path.join(options.outputRoot, file)));
    await fs.writeFile(path.join(options.outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' });
    return { manifest, directory: options.outputRoot };
  } finally {
    if (path.dirname(temporary) !== os.tmpdir() || !path.basename(temporary).startsWith('deckloom-publication-')) throw new Error('Invalid temporary publication directory');
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
}
module.exports = { prepare };
