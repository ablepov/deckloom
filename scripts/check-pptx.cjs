const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { execFile } = require('node:child_process'),
  { promisify } = require('node:util');
const { createRenderer } = require('../src/index.cjs');
async function main() {
  const folder = path.resolve(
    process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) || 'output/validation/e3/latest',
  );
  await fs.mkdir(folder, { recursive: true });
  const result = await createRenderer(require(process.argv.includes('--grid') ? '../examples/pptx-grid.config.cjs' : '../examples/pptx.config.cjs')).export({
    deckId: 'main',
    outputRoot: path.join(folder, 'export'),
    formats: ['pptx', 'png', 'pdf', 'html'],
    fonts: { policy: 'allow-substitution' },
    pptx: { mode: 'strict', fonts: { mode: 'reference', family: 'Arial', profile: 'windows-installed-v1' } },
  });
  const file = path.join(folder, 'result.json');
  await fs.writeFile(file, JSON.stringify(result, null, 2), 'utf8');
  if (process.platform !== 'win32') {
    assert.equal(result.error.code, 'PPTX_PLATFORM_UNSUPPORTED');
    assert.deepEqual(result.outputs, []);
    console.log(JSON.stringify({ status: 'passed-platform-rejection', file }));
    return;
  }
  assert.equal(result.status, 'succeeded', JSON.stringify(result.diagnostics));
  const run = promisify(execFile);
  if (process.argv.includes('--office'))
    await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'check-pptx-powerpoint.ps1'), '-Result', file],
      { timeout: 60000, windowsHide: true },
    );
  const checked = await run(
    process.env.DECKLOOM_PYTHON || 'python',
    [path.join(__dirname, 'check-pptx.py'), file, ...(process.argv.includes('--office') ? ['--office'] : [])],
    { timeout: 60000, encoding: 'utf8' },
  );
  console.log(checked.stdout.trim());
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
