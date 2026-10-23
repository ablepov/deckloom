const fs = require('node:fs/promises');
const path = require('node:path');
const comments = require('./comments.cjs');
const { readManifest } = require('./builds.cjs');
const { verifyImage } = require('./comments-bundle.cjs');
const fail = code => { throw Object.assign(new Error(code), { code }); };
function createLocalService(reader, settings) {
  const project = reader.project;
  const { sourceId, projectId, author } = settings;
  comments.empty({ sourceId, projectId, deckId: 'configuration-check' });
  const store = comments.createStore({ root: settings.root, ...(settings.maxImageBytes ? { maxImageBytes: settings.maxImageBytes } : {}) });
  const scopeFor = deckId => {
    if (!project.decks.some(deck => deck.id === deckId)) fail('UNKNOWN_DECK');
    return { projectId, deckId };
  };
  async function current(deckId, viewerSlideId) {
    scopeFor(deckId);
    const dto = await reader.scanSlides(deckId), deck = dto.deck || dto;
    const index = deck.slides.findIndex(slide => slide.id === viewerSlideId);
    if (index < 0) fail('COMMENTS_NOT_FOUND');
    const logical = project.decks.find(deck => deck.id === deckId).slides[index];
    const stableId = settings.slideIds?.[deckId]?.[logical.id] || (project.inputVersion === 1 ? logical.id : null);
    if (!stableId) fail('COMMENTS_IDENTITY_REQUIRED');
    if (deck.build?.state !== 'published') fail('COMMENTS_VERSION_REQUIRED');
    const buildId = deck.build.buildId;
    const published = await readManifest(project.root, buildId, deckId);
    const rendered = published.manifest.slides.find(slide => slide.id === logical.id);
    if (!rendered?.artifacts.png || rendered.width !== logical.width || rendered.height !== logical.height) fail('COMMENTS_VERSION_MISMATCH');
    // Only declared PNG of a complete generation, never mutable canonical output.
    if (published.manifest.state !== 'complete') fail('COMMENTS_VERSION_REQUIRED');
    const file = path.join(published.directory, rendered.artifacts.png);
    const realRoot = await fs.realpath(published.directory), realFile = await fs.realpath(file);
    if (!realFile.startsWith(realRoot + path.sep)) fail('COMMENTS_UNSAFE_PATH');
    const stat = await fs.stat(realFile); if (!stat.isFile() || stat.size > 32 * 1024 * 1024) fail('COMMENTS_IMAGE_BUDGET');
    const image = await fs.readFile(realFile);
    const context = comments.createContext({ publicationId: buildId, buildId, slideId: stableId, label: logical.name,
      width: rendered.width, height: rendered.height, generatedAt: published.manifest.finishedAt, pngSha256: comments.hash(image) });
    verifyImage(image, context);
    const preview = deck.slides[index];
    return { context, image, viewerSlideId, imageUrl: project.inputVersion === 1 ? preview.artifacts.png.url : preview.url };
  }
  async function load(deckId) {
    const scope = scopeFor(deckId), state = await store.load(scope);
    const document = state?.document || comments.empty({ sourceId, ...scope });
    const dto = await reader.scanSlides(deckId), deck = dto.deck || dto;
    const registered = project.decks.find(deck => deck.id === deckId);
    const bindings = deck.slides.map((slide, i) => ({ viewerSlideId: slide.id, slideId: settings.slideIds?.[deckId]?.[registered.slides[i].id] || (project.inputVersion === 1 ? registered.slides[i].id : null) }));
    const availableImages = [];
    for (const sha of new Set(document.contexts.map(context => context.pngSha256))) if (await store.readImage(sha)) availableImages.push(sha);
    return { document, token: state?.token || null, author, canModerate: false, writable: true, bindings, availableImages };
  }
  async function mutate(deckId, operation, viewerSlideId) {
    const scope = scopeFor(deckId), now = new Date().toISOString();
    let pinned;
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await store.load(scope), document = state?.document || comments.empty({ sourceId, ...scope }, now);
      const result = comments.apply(document, operation, { author, now });
      if (result.repeated) return { ...state, repeated: true };
      if (operation.kind === 'create' && !pinned) {
        pinned = await current(deckId, viewerSlideId);
        if (pinned.context.id !== operation.context?.id) fail('COMMENTS_VERSION_MISMATCH');
      }
      try {
        return await store.compareAndSwap(scope, result.document, state?.token || null, pinned ? new Map([[pinned.context.pngSha256, pinned.image]]) : new Map());
      } catch (error) { if (error.code !== 'COMMENTS_STORAGE_CONFLICT' || attempt === 2) throw error; }
    }
  }
  async function importDocument(deckId, incoming, images = new Map(), expectedToken) {
    const scope = scopeFor(deckId), state = await store.load(scope);
    if ((state?.token || null) !== expectedToken) fail('COMMENTS_STORAGE_CONFLICT');
    if (incoming.projectId !== projectId || incoming.deckId !== deckId || incoming.sourceId !== sourceId) fail('COMMENTS_SCOPE_MISMATCH');
    const result = state ? comments.merge(state.document, incoming) : { document: comments.validate(incoming), conflicts: [] };
    if (result.conflicts.length) return { conflicts: result.conflicts };
    const wanted = new Set(result.document.contexts.map(context => context.pngSha256));
    const kept = new Map([...images].filter(([sha]) => wanted.has(sha)));
    return store.compareAndSwap(scope, result.document, expectedToken, kept);
  }
  return { load, current, mutate, importDocument, async image(deckId, sha) {
    const state = await load(deckId);
    if (!state.document.contexts.some(context => context.pngSha256 === sha)) fail('COMMENTS_NOT_FOUND');
    return store.readImage(sha);
  }, async export(deckId, format) {
    const { document } = await load(deckId);
    return format === 'zip' ? comments.exportBundle(document, sha => store.readImage(sha)) : Buffer.from(comments.serialize(document));
  } };
}
module.exports = { createLocalService };
