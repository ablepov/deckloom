const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { createRenderer } = require('../src/index.cjs');
const project = require('../examples/export.config.cjs');
const execute = promisify(execFile);
async function main() {
  const output = path.resolve('output/validation/d'), renderer = createRenderer(project);
  await fs.mkdir(output, { recursive: true });
  const main = await renderer.export({ deckId: 'demo', outputRoot: path.join(output, 'acceptance'), formats: ['png', 'pdf', 'html'], png: { scale: 2 }, fonts: { expected: ['DejaVu Sans'] } });
  if (main.status !== 'succeeded') throw new Error(JSON.stringify(main.diagnostics));
  const variants = [];
  for (const background of [true, false]) {
    const result = await renderer.export({ deckId: 'demo', slideIds: ['intro'], outputRoot: path.join(output, `print-${background}`), formats: ['pdf'], pdf: { media: 'print', background }, fonts: { expected: ['DejaVu Sans'] } });
    if (result.status !== 'succeeded') throw new Error(JSON.stringify(result.diagnostics));
    variants.push({ file: result.outputs.find(item => item.format === 'pdf').file, background });
  }
  const input = { main: main.outputs.find(item => item.format === 'pdf').file,
    slides: project.decks[0].slides.map(slide => ({ id: slide.id, width: slide.width || project.decks[0].width, height: slide.height || project.decks[0].height, text: [slide.data.title, slide.data.text], png: main.outputs.find(item => item.format === 'png' && item.slideId === slide.id).file })),
    variants, output, expectedFont: 'DejaVuSans' };
  const inputFile = path.join(output, 'verification-input.json');
  await fs.writeFile(inputFile, JSON.stringify(input, null, 2), 'utf8');
  const checked = await execute(process.env.DECKLOOM_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [path.join(__dirname, 'check-export.py'), inputFile], { encoding: 'utf8', timeout: 120000 });
  const independent = JSON.parse(checked.stdout);
  await fs.mkdir(path.resolve('output/pdf'), { recursive: true });
  await fs.copyFile(input.main, path.resolve('output/pdf/deckloom-export.pdf'));
  await fs.writeFile(path.join(output, 'api-result.json'), JSON.stringify(main, null, 2), 'utf8');
  await fs.writeFile(path.join(output, 'latest.json'), JSON.stringify({ status: 'passed', node: process.version, platform: process.platform, request: main.request, independent, bundle: main.bundle }, null, 2), 'utf8');
  console.log(JSON.stringify({ status: 'passed', pages: independent.pages.length, text: true, embeddedFonts: true, rasterizer: independent.rasterizer, report: path.join(output, 'latest.json') }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
