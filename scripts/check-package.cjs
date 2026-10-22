const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '..');
const metadata = require('../package.json');

async function main() {
  const published = process.argv.slice(2).find(arg => arg.startsWith('--published='))?.slice('--published='.length);
  if (!published && process.env.npm_config_published) throw new Error('Use check:package:published; npm did not forward --published');
  if (published && !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(published)) throw new Error('Expected --published=<exact-version>');
  const source = published ? `registry-${published}` : 'local';
  const output = path.join(root, 'output/validation/stage-a/package', source);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-package-'));
  assert(!temporary.startsWith(root + path.sep), 'Consumer must be outside the checkout');
  const consumer = path.join(temporary, 'consumer');
  const packDir = path.join(temporary, 'pack');
  await fs.mkdir(consumer); await fs.mkdir(packDir); await fs.mkdir(output, { recursive: true });
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  await fs.access(npmCli);
  const userconfig = path.join(temporary, 'empty.npmrc');
  await fs.writeFile(userconfig, '', 'utf8');
  const env = { ...process.env, npm_config_userconfig: userconfig, npm_config_registry: 'https://registry.npmjs.org/', npm_config_update_notifier: 'false' };
  for (const key of Object.keys(env)) {
    if (/^(NODE_PATH|NODE_OPTIONS|NODE_AUTH_TOKEN|NPM_TOKEN)$/i.test(key)) delete env[key];
  }
  const run = (args, cwd) => execute(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 5 * 1024 * 1024 });
  const npm = (args, cwd) => run([npmCli, `--userconfig=${userconfig}`, '--registry=https://registry.npmjs.org/', ...args], cwd);
  const report = { schemaVersion: 1, source, startedAt: new Date().toISOString(), status: 'running', node: process.version, platform: process.platform };
  try {
    const pack = await npm(['pack', ...(published ? [`deckloom@${published}`] : []), '--json', '--ignore-scripts', `--pack-destination=${packDir}`], root);
    const packed = JSON.parse(pack.stdout)[0];
    assert.equal(packed.name, 'deckloom'); assert.equal(packed.version, published || metadata.version);
    const paths = packed.files.map(file => file.path);
    for (const required of ['package.json', 'LICENSE', 'README.md', 'src/index.cjs', 'src/qa.cjs', 'bin/deckloom.cjs', 'viewer/index.html']) assert(paths.includes(required), `Missing archive entry ${required}`);
    const allowedRoots = new Set(['src', 'bin', 'viewer', 'examples', 'scripts', 'test']);
    for (const file of paths) {
      assert(!file.split('/').some(part => ['node_modules', 'output', '.git', '.npmrc', 'AGENTS.md'].includes(part)), `Forbidden archive entry ${file}`);
      assert(['package.json', 'README.md', 'LICENSE'].includes(file) || allowedRoots.has(file.split('/')[0]), `Unexpected archive entry ${file}`);
      assert(!/\.(tgz|log)$/i.test(file), `Generated archive entry ${file}`);
    }
    const archive = path.join(packDir, packed.filename);
    const bytes = await fs.readFile(archive);
    assert.equal(`sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`, packed.integrity);
    report.archive = { name: packed.filename, version: packed.version, integrity: packed.integrity, files: paths.length, size: bytes.length };
    await fs.copyFile(archive, path.join(output, packed.filename));
    await fs.writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'deckloom-package-consumer', version: '1.0.0', private: true,
      dependencies: { deckloom: archive, playwright: metadata.devDependencies.playwright } }, null, 2) + '\n', 'utf8');
    for (const [from, to] of [['package-project.cjs', 'deckloom.config.cjs'], ['package-consumer.cjs', 'check-consumer.cjs']]) {
      await fs.copyFile(path.join(root, 'test/fixtures', from), path.join(consumer, to));
    }
    await fs.mkdir(path.join(consumer, 'artifacts/assets'), { recursive: true });
    await fs.writeFile(path.join(consumer, 'artifacts/assets/marker.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="8" fill="#17221c"/></svg>', 'utf8');
    console.log(`Package check: installing ${source} in an external consumer`);
    await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], consumer);
    const installedMetadata = JSON.parse(await fs.readFile(path.join(consumer, 'node_modules/deckloom/package.json'), 'utf8'));
    assert.equal(installedMetadata.version, packed.version); assert.notEqual(installedMetadata.private, true);
    report.runtimeSha256 = {};
    for (const file of paths.filter(file => /^(src|bin|viewer)\//.test(file))) {
      const installed = await fs.readFile(path.join(consumer, 'node_modules/deckloom', file));
      report.runtimeSha256[file] = crypto.createHash('sha256').update(installed).digest('hex');
      if (!published) assert.deepEqual(installed, await fs.readFile(path.join(root, file)), `Archive runtime differs at ${file}`);
    }
    for (const [name, spec] of Object.entries({ ...installedMetadata.dependencies, ...installedMetadata.optionalDependencies, ...installedMetadata.peerDependencies })) {
      assert(!name.startsWith('@ablepov/'), 'Private consumer dependency in engine');
      assert(!/^(file:|link:|workspace:)|npm\.pkg\.github\.com|git\+ssh:/i.test(spec), `Non-public dependency ${name}`);
    }
    // Installed code must keep working without the original tarball or a NODE_PATH fallback.
    await fs.rename(archive, archive + '.hidden');
    const help = await npm(['exec', '--offline', '--', 'deckloom', '--help'], consumer);
    assert(help.stdout.includes('deckloom dev|render'));
    const rendered = await npm(['exec', '--offline', '--', 'deckloom', 'render', '--config=deckloom.config.cjs', '--deck=all'], consumer);
    assert.equal(JSON.parse(rendered.stdout).slides, 3); assert.deepEqual(JSON.parse(rendered.stdout).failed, []);
    await assert.rejects(npm(['exec', '--offline', '--', 'deckloom', 'render', '--config=deckloom.config.cjs', '--deck=missing'], consumer), error => error.code === 1 && error.stderr.includes('Unknown deck'));
    const checked = await run([path.join(consumer, 'check-consumer.cjs'), ...(published ? [] : ['--expect-read-v1'])], consumer);
    report.consumer = JSON.parse(checked.stdout.trim().split(/\r?\n/).at(-1));
    if (!published) {
      assert.equal(report.consumer.v1Read, true); assert.equal(report.consumer.discovery, true); assert.equal(report.consumer.v1Render, true);
      assert.equal(report.consumer.v1Export, true);
      assert.equal(report.consumer.f1Document, true);
      assert.equal(report.consumer.f2g1Engine, true);
      const v1Cli = await npm(['exec', '--offline', '--', 'deckloom', 'render', '--config=runtime.config.cjs', '--deck=all'], consumer);
      report.v1Cli = JSON.parse(v1Cli.stdout);
      assert.equal(report.v1Cli.slides, 5); assert.deepEqual(report.v1Cli.failed, []);
      const exported = await npm(['exec', '--offline', '--', 'deckloom', 'export', '--config=export.config.cjs', '--deck=demo', '--output=cli-export', '--format=png,pdf,html', '--slides=portrait', '--scale=2', '--expected-fonts=DejaVu Sans'], consumer);
      const exportResult = JSON.parse(exported.stdout);
      assert.equal(exportResult.status, 'succeeded'); assert.deepEqual(exportResult.request.slideIds, ['portrait']);
      report.exportCli = { status: exportResult.status, formats: exportResult.outputs.map(item => item.format), pages: exportResult.outputs.find(item => item.format === 'pdf').pages };
      for (const required of ['src/vendor/pptx/backend.cjs', 'src/vendor/pptx/inventory.json', 'src/vendor/pptx/THIRD_PARTY_NOTICES.txt']) assert(paths.includes(required));
      assert(!paths.some(file => file.startsWith('tools/') || file.startsWith('experiments/')));
      const pptxArgs=['exec','--offline','--','deckloom','export',`--config=${path.join(consumer,'node_modules/deckloom/examples/pptx.config.cjs')}`,'--deck=main','--output=pptx-export','--format=pptx,pdf,png,html','--allow-font-substitution','--pptx-profile=windows-installed-v1'];
      if(process.platform==='win32'){
        const result=JSON.parse((await npm(pptxArgs,consumer)).stdout);assert.equal(result.status,'succeeded');const output=result.outputs.find(item=>item.format==='pptx');assert.equal((await fs.readFile(output.file)).readUInt32LE(0),0x04034b50);
        const verification=JSON.parse(await fs.readFile(result.bundle.manifest,'utf8'));assert.equal(verification.pptx.fontProfile.provider,'windows-installed-v1');assert.equal(verification.pptx.verified.slides,3);report.pptxCli={status:result.status,slides:3,formats:result.outputs.map(item=>item.format)};
      }else await assert.rejects(npm(pptxArgs,consumer),error=>JSON.parse(error.stdout).error.code==='PPTX_PLATFORM_UNSUPPORTED');
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.message;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'latest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
    // Remove only the exact temporary directory created by this invocation.
    assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert(path.basename(temporary).startsWith('deckloom-package-'));
    await fs.rm(temporary, { recursive: true, force: true });
    console.log(JSON.stringify({ status: report.status, source, report: path.join(output, 'latest.json') }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
