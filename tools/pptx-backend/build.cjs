const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { builtinModules } = require('node:module');
const esbuild = require('esbuild');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
async function build(directory) {
  await fs.mkdir(directory, { recursive: true });
  const entry = 'deckloom-pptx-backend-entry.cjs';
  const contents =
    'module.exports = { PptxGenJS: require("pptxgenjs"), JSZip: require("jszip"), ...require("@xmldom/xmldom") };';
  const built = await esbuild.build({
    absWorkingDir: __dirname,
    stdin: { contents, sourcefile: entry, resolveDir: __dirname, loader: 'js' },
    outfile: path.join(directory, 'backend.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    metafile: true,
    legalComments: 'inline',
  });
  const inputs = Object.keys(built.metafile.inputs),
    components = new Map(),
    sourceFiles = [];
  assert(!inputs.some((file) => file.includes('node_modules/image-size/')), 'Unused parser must not be bundled');
  for (const output of Object.values(built.metafile.outputs))
    for (const item of output.imports)
      if (item.external)
        assert(builtinModules.includes(item.path) || item.path.startsWith('node:'), `Unexpected external ${item.path}`);
  for (const file of inputs) {
    if (file === entry) {
      sourceFiles.push({ path: entry, sha256: hash(contents) });
      continue;
    }
    const absolute = path.resolve(__dirname, file);
    sourceFiles.push({ path: file, sha256: hash(await fs.readFile(absolute)) });
    if (!absolute.includes(path.sep + 'node_modules' + path.sep)) continue;
    let folder = path.dirname(absolute);
    while (true) {
      try {
        const metadata = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
        if (metadata.name && metadata.version) {
          const key = metadata.name + '@' + metadata.version;
          if (!components.has(key)) {
            const names = (await fs.readdir(folder))
              .filter((name) => /^(?:licen[cs]e|copying|copyright|mit-license)(?:[._-].*)?$/i.test(name))
              .sort();
            const licenses = [];
            for (const name of names)
              if ((await fs.stat(path.join(folder, name))).isFile())
                licenses.push({ file: name, text: await fs.readFile(path.join(folder, name), 'utf8') });
            if (!licenses.length && metadata.name === 'isarray' && metadata.version === '1.0.0') {
              const text = await fs.readFile(path.join(folder, 'README.md'), 'utf8');
              assert(text.includes('Permission is hereby granted') && text.includes('THE SOFTWARE IS PROVIDED'));
              licenses.push({ file: 'README.md (contains full MIT notice)', text });
            }
            assert(licenses.length, key);
            components.set(key, {
              name: metadata.name,
              version: metadata.version,
              license: metadata.license,
              licenses,
            });
          }
          break;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const parent = path.dirname(folder);
      assert.notEqual(parent, folder);
      folder = parent;
    }
  }
  const externals = [
    ...new Set(
      Object.values(built.metafile.outputs).flatMap((output) =>
        output.imports.filter((item) => item.external).map((item) => item.path),
      ),
    ),
  ].sort();
  // Upstream's generated runtime helpers carry an unmarked license banner.
  // esbuild's legalComments does not retain every ordinary block comment.
  const upstream = await fs.readFile(require.resolve('pptxgenjs'), 'utf8');
  const noticeStart = upstream.indexOf('/**********'),
    noticeEnd = upstream.indexOf('*/', noticeStart) + 2;
  const helperNotice = upstream.slice(noticeStart, noticeEnd);
  assert(
    helperNotice.includes('Copyright (c) Microsoft Corporation.') &&
      helperNotice.includes('Permission to use, copy, modify'),
  );
  const inventory = {
    buildTool: 'esbuild 0.28.2',
    format: 'CJS Node >=22',
    backend: 'PptxGenJS 4.0.1',
    lockSha256: hash(await fs.readFile(path.join(__dirname, 'package-lock.json'))),
    bundledComponents: [...components.values()].map(({ licenses, ...item }) => item),
    additionalNotices: [{ source: 'PptxGenJS upstream generated runtime helpers', sha256: hash(helperNotice) }],
    sourceFiles,
    externals,
    bundleSha256: hash(await fs.readFile(path.join(directory, 'backend.cjs'))),
    imageSizeIncluded: false,
  };
  await fs.writeFile(path.join(directory, 'inventory.json'), JSON.stringify(inventory, null, 2));
  await fs.writeFile(
    path.join(directory, 'THIRD_PARTY_NOTICES.txt'),
    [...components.values()]
      .map(
        (item) =>
          `${item.name}@${item.version} (${item.license})\n${item.licenses.map((license) => license.file + '\n' + license.text).join('\n')}`,
      )
      .join('\n\n') +
      '\n\nAdditional upstream runtime helpers notice\n' +
      helperNotice,
  );
  await fs.writeFile(
    path.join(directory, 'metafile.json'),
    JSON.stringify(
      { inputs: built.metafile.inputs, outputs: { 'backend.cjs': Object.values(built.metafile.outputs)[0] } },
      null,
      2,
    ),
  );
  return inventory;
}
module.exports = { build };
if (require.main === module)
  build(path.resolve(__dirname, '../../src/vendor/pptx'))
    .then((result) =>
      console.log(JSON.stringify({ sha256: result.bundleSha256, components: result.bundledComponents.length })),
    )
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
