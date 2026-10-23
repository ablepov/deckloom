const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { publications } = require('../src/index.cjs');
test('one real preparation produces an offline PNG/PDF release without source mirrors or overwrites', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-publication-test-'));
  t.after(async () => { if (path.dirname(temporary) !== os.tmpdir() || !path.basename(temporary).startsWith('deckloom-publication-test-')) throw Error('Unsafe cleanup'); await fs.rm(temporary, { recursive: true, force: true }); });
  const root = path.join(temporary, 'source'); await fs.mkdir(root);
  const project = { root, decks: [{ id: 'demo', artifactPrefix: 'demo-slide', label: 'Portable example', width: 320, height: 180, slides: [{ no: '01', name: 'First' }] }], downloads: { fontPolicy: 'allow-substitution' },
    renderDocument: () => '<!doctype html><html><head><style>html,body{margin:0;width:320px;height:180px;background:white}main{box-sizing:border-box;width:320px;height:180px;font:20px sans-serif;padding:20px}</style></head><body><main class="slide">Prepared example</main></body></html>' };
  const options = { deckId: 'demo', sourceId: 'example', projectId: 'project', outputRoot: path.join(temporary, 'prepared'), slideIds: { '01': 'stable-first' }, downloads: ['pdf'] };
  const result = await publications.prepare(project, options).catch(error => { t.diagnostic(JSON.stringify(error.diagnostics)); throw error; });
  assert.equal(result.manifest.slides[0].id, 'stable-first');
  assert.equal(result.manifest.slides[0].width, 320); assert.deepEqual(Object.keys(result.manifest.downloads), ['pdf']);
  await publications.verify(result.manifest, file => fs.readFile(path.join(result.directory, file)));
  assert.deepEqual((await fs.readdir(root)), []);
  assert.deepEqual((await fs.readdir(result.directory)).sort(), ['downloads', 'manifest.json', 'slides']);
  const before = await fs.readFile(path.join(result.directory, 'manifest.json'));
  await assert.rejects(() => publications.prepare(project, options), { code: 'EEXIST' });
  assert.deepEqual(await fs.readFile(path.join(result.directory, 'manifest.json')), before);
});
