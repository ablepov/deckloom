const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const file = path.join(dir, item.name);
    return item.isDirectory() ? walk(file) : /\.c?js$/.test(file) ? [file] : [];
  });
}
const files = ['src', 'bin', 'scripts', 'examples', 'test'].flatMap(dir => walk(path.join(root, dir)));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
const html = fs.readFileSync(path.join(root, 'viewer/index.html'), 'utf8');
for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  if (!script[1].includes('__DECKLOOM_CONFIG__')) new Function(script[1]);
}
console.log(`Syntax OK: ${files.length} modules and viewer script`);
