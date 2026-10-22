const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { createRenderer } = require('../src/index.cjs');
async function main() {
  const folder = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || 'output/validation/e4/matrix');
  const run = promisify(execFile), fixture = require('../examples/pptx-extended.config.cjs');
  const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
  for (const profile of ['main', 'portrait', 'svg-crop'].filter(p => !only || p === only)) {
    const svg = profile === 'svg-crop', deckId = svg ? 'main' : profile;
    const renderer = createRenderer(svg ? { ...fixture, renderDocument(deck, slide) { return fixture.renderDocument(deck, slide).replace('pptx-marker.png', 'pptx-marker.svg'); } } : fixture);
    const dir = path.join(folder, profile); await fs.mkdir(dir, { recursive: true });
    const result = await renderer.export({ deckId, ...(svg ? { slideIds: ['crop'] } : {}), outputRoot: path.join(dir, 'export-' + randomUUID()), formats: ['html', 'png', 'pdf', 'pptx'], fonts: { policy: 'allow-substitution' }, pptx: { mode: 'strict', fonts: { mode: 'reference', family: 'Arial', profile: 'windows-installed-v1' } } });
    const file = path.join(dir, 'result.json'); await fs.writeFile(file, JSON.stringify(result, null, 2), 'utf8'); assert.equal(result.status, 'succeeded', JSON.stringify(result.error || result.diagnostics));
    if (process.argv.includes('--office')) console.log((await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'check-engine-powerpoint.ps1'), '-Result', file], { timeout: 120000, windowsHide: true })).stdout.trim());
    console.log((await run(process.env.DECKLOOM_PYTHON || 'python', [path.join(__dirname, 'check-engine-output.py'), file, ...(process.argv.includes('--office') ? ['--office'] : [])], { timeout: 60000 })).stdout.trim());
    console.log(JSON.stringify({ profile, deckId, status: result.status, file }));
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
