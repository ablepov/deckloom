const fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { build } = require('./build.cjs');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'deckloom-vendor-'));
  try {
    const inventory = await build(temp),
      root = path.resolve(__dirname, '../../src/vendor/pptx');
    for (const name of ['backend.cjs', 'inventory.json', 'THIRD_PARTY_NOTICES.txt', 'metafile.json'])
      assert.deepEqual(
        await fs.readFile(path.join(temp, name)),
        await fs.readFile(path.join(root, name)),
        `Vendor drift: ${name}`,
      );
    assert(!inventory.imageSizeIncluded);
    assert.equal(inventory.bundledComponents.length, 15);
    console.log(
      JSON.stringify({
        status: 'passed',
        bundleSha256: inventory.bundleSha256,
        components: inventory.bundledComponents.length,
      }),
    );
  } finally {
    assert(temp.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
