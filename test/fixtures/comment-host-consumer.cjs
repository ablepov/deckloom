// Read a real host's source config; write only the external consumer's temp store.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const engine = require('deckloom/node');
async function main() {
  const source = require(path.resolve(process.argv[2])), deckId = process.argv[3];
  assert(source.comments, 'Host must configure the shared comments adapter');
  const project = { ...source, comments: { ...source.comments, root: path.join(__dirname, 'isolated-host-comments') } };
  const dto = await engine.scanSlides(project, deckId), deck = dto.deck || dto;
  assert(deck.build?.state === 'published');
  const slide = deck.slides[0];
  const server = engine.createReviewServer(project);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const html = await (await fetch(base)).text();
    const config = JSON.parse(html.match(/window\.deckloomConfig = (.*?);<\/script>/)[1]);
    const endpoint = base + '/api/comments?deck=' + encodeURIComponent(deckId);
    const get = async () => (await fetch(endpoint)).json();
    const current = await (await fetch(base + '/api/comments/context?deck=' + encodeURIComponent(deckId) + '&slide=' + encodeURIComponent(slide.id))).json();
    assert(current.context); assert.equal(current.context.slideId, source.comments.slideIds[deckId][slide.no || slide.id]);
    const bytes = Buffer.from(await (await fetch(new URL(current.imageUrl, base))).arrayBuffer());
    assert.equal(engine.comments.hash(bytes), current.context.pngSha256);
    const post = operation => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Deckloom-Comment-Token': config.commentToken }, body: JSON.stringify({ operation, viewerSlideId: slide.id }) });
    const create = engine.comments.operation('create', { threadId: randomUUID(), messageId: randomUUID(), context: current.context, x: .27, y: .64, text: 'Тест адаптера — «точка»' });
    assert.equal((await post(create)).status, 200);
    const exported = Buffer.from(await (await fetch(base + '/api/comments/export?deck=' + encodeURIComponent(deckId) + '&format=zip')).arrayBuffer());
    const portable = engine.comments.importBundle(exported);
    assert.equal(portable.document.threads[0].messages[0].text, create.text);
    assert.deepEqual(portable.images.get(current.context.pngSha256), bytes);
    const state = await get();
    assert.equal((await post(engine.comments.operation('close', { threadId: create.threadId, expectedRevision: state.document.threads[0].revision }))).status, 200);
    assert.equal((await get()).document.threads.length, 0);
    assert.deepEqual(await fs.readdir(path.join(project.comments.root, 'images')), []);
    const after = Buffer.from(await (await fetch(new URL(current.imageUrl, base))).arrayBuffer());
    assert.deepEqual(after, bytes, 'Closing never changes host generation artifacts');
    console.log(JSON.stringify({ passed: true, deckId, slides: deck.slides.length, stableSlideId: current.context.slideId,
      sourceBuildId: current.context.buildId, pngSha256: current.context.pngSha256, bundleRoundTrip: true, closeCleanup: true, hostArtifactsUnchanged: true }));
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
