const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const api = require('../src/index.cjs');
const example = require('../examples/comments.config.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-comments-viewer-'));
  const project = { ...example, root, comments: { ...example.comments, root: path.join(root, '.comments') },
    decks: [{ ...example.decks[0], width: 1920, height: 1080 }, { ...example.decks[0], id: 'other', label: 'Другая колода' }] };
  let browser, server;
  t.after(async () => {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    assert.equal(path.dirname(root), os.tmpdir());
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const renderer = api.createRenderer(project);
  for (const deck of project.decks) assert.equal((await renderer.render({ deckId: deck.id })).status, 'succeeded');
  server = api.createReviewServer(project);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.deckloomViewer.state.slides.length > 0);
  return { page, project, errors };
}

test('point comments keep reply drafts through edits, visibility, presentation and navigation', { timeout: 90000 }, async t => {
  const { page, errors } = await fixture(t);
  const pins = page.locator('.comment-pin[data-thread]');
  await page.keyboard.press('c');
  const canvas = page.locator('.comments-canvas.is-placing:visible');
  await canvas.waitFor();
  await canvas.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  const field = page.getByLabel('Комментарий', { exact: true });
  await field.fill('Исходное сообщение — «точка»'); await page.keyboard.press('Control+Enter');
  await page.getByRole('dialog').getByText('Исходное сообщение — «точка»', { exact: true }).waitFor();
  assert.equal(await page.locator('.comments-panel').isVisible(), false);
  assert.equal(await pins.textContent(), 'ЛА');
  assert.equal(await page.locator('.comments-tools, [data-action=place], [data-action=visibility]').count(), 0);
  assert.match(await page.getByRole('button', { name: 'Комментарии', exact: true }).getAttribute('title'), /Shift\+C/);
  assert.equal(await page.locator('.comments-notice').textContent(), '');
  await field.fill('Черновик ответа');
  const before = page.url(); await page.keyboard.press('c'); await page.keyboard.press('ArrowRight');
  assert.equal(page.url(), before);
  const reply = await field.inputValue();
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await field.fill('Исправленное сообщение'); await page.keyboard.press('Control+Enter');
  await page.getByRole('dialog').getByText('Исправленное сообщение', { exact: true }).waitFor();
  assert.equal(await field.inputValue(), reply, 'editing a message must not replace the reply draft');
  await page.keyboard.press('Escape');
  assert.equal(await pins.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Shift+C'); assert.equal(await pins.count(), 0);
  assert.equal(await page.locator('.comments-canvas').count(), 0, 'hidden pins also disable placement');
  assert.equal(await page.getByRole('button', { name: 'Комментарии', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Shift+C'); await pins.waitFor();
  await pins.click(); assert.equal(await field.inputValue(), reply);
  await page.evaluate(() => dispatchEvent(new CustomEvent('deckloom:presentation', { detail: { active: true } })));
  assert.equal(await page.getByRole('dialog').isVisible(), false);
  assert.equal(await pins.count(), 0);
  await page.keyboard.press('c'); assert.equal(await page.locator('.comments-list-toggle').isVisible(), false);
  await page.evaluate(() => dispatchEvent(new CustomEvent('deckloom:presentation', { detail: { active: false } })));
  await page.locator('#presentationButton').click();
  await page.locator('.presentation-controls').waitFor();
  assert.equal(await pins.count(), 0);
  assert.equal(await page.locator('.comments-popover').isVisible(), false);
  assert.equal(await page.locator('.comments-panel').isVisible(), false);
  assert.equal(await page.locator('.download-notice').isVisible(), false);
  await page.keyboard.press('c');
  assert.equal(await page.locator('.comments-list-toggle').isVisible(), false);
  await page.keyboard.press('Escape');
  await page.locator('#presentation').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Комментарии', exact: true }).click();
  await page.locator('.comments-canvas:visible').waitFor();
  await page.keyboard.press('Escape'); await pins.click();
  assert.equal(await field.inputValue(), reply);
  await page.setViewportSize({ width: 375, height: 812 });
  const box = await page.getByRole('dialog').boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 375 && box.y + box.height <= 812);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await field.fill('Черновик исходной колоды');
  await page.locator('#deckSelect').selectOption('other');
  await page.waitForFunction(() => window.deckloomViewer.state.deckId === 'other' && document.querySelector('.comments-popover').hidden);
  const drafts = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.includes(':comments:'))));
  assert.ok(Object.entries(drafts).some(([key, value]) => key.startsWith('deckloom-comment-example:comments:demo:') && value === 'Черновик исходной колоды'));
  await page.locator('#deckSelect').selectOption('demo');
  await pins.waitFor();
  await page.evaluate(() => { window.commentImage = document.querySelector('.comment-snapshot'); window.commentCanvas = document.querySelector('.comments-canvas'); });
  let imageRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/comments/image')) imageRequests++; });
  await pins.click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await field.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.evaluate(() => commentImage === document.querySelector('.comment-snapshot') && commentCanvas === document.querySelector('.comments-canvas')), true);
  assert.equal(imageRequests, 0, 'reopening the same PNG must not refetch or replace the snapshot');
  await page.keyboard.press('Escape');
  await page.locator('.comments-canvas').focus(); await page.keyboard.press('c');
  assert.equal(await page.getByRole('button', { name: 'Комментарии', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.deepEqual(errors, []);
});

test('automatic placement reuses identical pixels and switches immutable snapshots only after decode', { timeout: 90000 }, async t => {
  const { page, project, errors } = await fixture(t), base = new URL(page.url()).origin;
  const field = page.getByLabel('Комментарий', { exact: true }), pins = page.locator('.comment-pin[data-thread]');
  await page.keyboard.press('c');
  await page.locator('.comments-canvas.is-placing:visible').waitFor();
  const canvas = page.locator('.comments-canvas');
  await canvas.click({ position: { x: 180, y: 180 } });
  await field.fill('Первая версия'); await page.keyboard.press('Control+Enter');
  await page.getByRole('dialog').getByText('Первая версия', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.comments-canvas').classList.contains('is-placing'));
  const original = await (await fetch(base + '/api/comments?deck=demo')).json();
  const first = original.document.threads[0], firstContext = original.document.contexts[0];
  await page.evaluate(() => {
    window.keptImage = document.querySelector('.comment-snapshot'); window.snapshotChanges = 0;
    new MutationObserver(records => records.forEach(record => { for (const node of [...record.addedNodes, ...record.removedNodes]) if (node.classList?.contains('comment-snapshot')) window.snapshotChanges++; })).observe(document.querySelector('.stage'), { childList: true });
  });
  // A second free click works while a thread is open, without a placement toggle.
  await canvas.click({ position: { x: 600, y: 260 } }); await field.fill('Вторая точка');
  await page.keyboard.press('Control+Enter'); await page.getByRole('dialog').getByText('Вторая точка', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.comments-canvas').classList.contains('is-placing'));
  await page.keyboard.press('Escape');
  await pins.first().hover(); await page.locator('.comments-preview').waitFor();
  await pins.first().click(); await page.getByRole('dialog').getByText('Первая версия', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Список комментариев и обмен файлами', exact: true }).click();
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.comments-popover').hidden && document.querySelector('.comments-canvas').classList.contains('is-placing'));
  assert.equal(await page.evaluate(() => keptImage === document.querySelector('.comment-snapshot') && snapshotChanges === 0), true);
  await page.getByRole('button', { name: 'Скрыть список', exact: true }).click();

  // Hold the viewer DTO stable to exercise a context transition on the same stage.
  // Production polling may replace the whole stage on a new build; it must not be
  // mistaken for replacement on every pin click.
  const decks = await (await fetch(base + '/api/decks')).text();
  const slides = await (await fetch(base + '/api/slides?deck=demo')).text();
  await page.route(url => url.pathname === '/api/decks', route => route.fulfill({ contentType: 'application/json', body: decks }));
  await page.route(url => url.pathname === '/api/slides' && url.searchParams.get('deck') === 'demo',
    route => route.fulfill({ contentType: 'application/json', body: slides }));
  // Legacy build identity lives in the slides response, not the deck list.
  // Fence any earlier polling read before generating the replacement PNG.
  await page.evaluate(() => window.deckloomViewer.refresh());
  const changed = { ...project, renderDocument(deck, slide) { return example.renderDocument(deck, slide).replace('#e7edf0', '#bce2cb'); } };
  assert.equal((await api.createRenderer(changed).render({ deckId: 'demo' })).status, 'succeeded');
  const current = await (await fetch(base + '/api/comments/context?deck=demo&slide=cover')).json();
  assert.notEqual(current.context.pngSha256, firstContext.pngSha256);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const imagePath = new URL(current.imageUrl, base).pathname;
  const imageMatch = url => url.pathname === imagePath;
  await page.route(imageMatch, async route => { await gate; await route.continue(); });
  const requests = []; page.on('request', request => { if (request.url().includes('/api/comments')) requests.push(request.url()); });
  const requested = page.waitForRequest(request => new URL(request.url()).pathname === imagePath, { timeout: 5000 });
  await page.getByRole('button', { name: 'Список комментариев и обмен файлами', exact: true }).click();
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  try { await requested; } catch (error) {
    error.message += JSON.stringify({ requests, expected: current.imageUrl, state: await page.evaluate(() => ({ notice: document.querySelector('.comments-notice').textContent, image: document.querySelector('.comment-snapshot')?.src, dialog: !document.querySelector('.comments-popover').hidden, canvas: document.querySelector('.comments-canvas')?.className, deck: deckloomViewer.state.deckId, slide: deckloomViewer.state.slides[deckloomViewer.state.index]?.id })) });
    throw error;
  }
  try {
    assert.equal(await page.evaluate(() => keptImage.isConnected && keptImage === document.querySelector('.comment-snapshot') && keptImage.complete && snapshotChanges === 0), true);
    assert.equal(await canvas.isVisible(), false, 'old points cannot accept clicks while a new PNG is pending');
  } finally { release(); }
  await page.waitForFunction(() => document.querySelector('.comment-snapshot') !== window.keptImage && document.querySelector('.comment-snapshot')?.complete);
  await page.unroute(imageMatch);
  await page.getByRole('button', { name: 'Скрыть список', exact: true }).click();

  await page.getByRole('button', { name: 'Список комментариев и обмен файлами', exact: true }).click();
  await page.locator('.comments-list button').filter({ hasText: 'Первая версия' }).click();
  await page.getByRole('dialog').getByText('Первая версия', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.comments-notice').textContent.includes('Версия отличается'));
  assert.equal(await canvas.evaluate(el => el.classList.contains('is-placing')), false);
  await field.fill('Черновик во время polling');
  await page.evaluate(() => { window.priorSignature = deckloomViewer.state.decksSignature; window.retainedAfterPoll = document.querySelector('.comment-snapshot'); });
  await page.unrouteAll({ behavior: 'wait' });
  await page.waitForFunction(() => deckloomViewer.state.decksSignature !== window.priorSignature);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await page.evaluate(() => retainedAfterPoll === document.querySelector('.comment-snapshot')), true, 'polling must move the decoded snapshot to the new card without a reload');
  assert.equal(await field.inputValue(), 'Черновик во время polling');
  const restored = await (await fetch(base + '/api/comments?deck=demo')).json();
  assert.deepEqual(restored.document.threads.find(thread => thread.id === first.id).anchor, first.anchor, 'old anchors are never migrated onto new pixels');
  await page.keyboard.press('Escape');
  await page.locator('.comments-canvas.is-placing:visible').waitFor();
  await page.route('**/api/comments/image**', route => route.fulfill({ status: 404, body: '' }));
  await page.locator('.comments-list button').filter({ hasText: 'Первая версия' }).click();
  await page.locator('.comment-missing').waitFor(); await page.getByRole('dialog').waitFor();
  assert.equal(await canvas.isVisible(), false);
  assert.equal(await page.getByRole('dialog').getByText('Первая версия', { exact: true }).isVisible(), true);
  assert.deepEqual(errors, []);
});
