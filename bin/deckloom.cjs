#!/usr/bin/env node
const path = require('node:path');
const { startReviewServer, createRenderer } = require('../src/index.cjs');

async function main(args = process.argv.slice(2)) {
  const [command = 'help'] = args;
  if (command === 'help' || command === '--help') {
    console.log('deckloom dev|render --config=deckloom.config.cjs [--deck=all] [--output=path] [--port=3000]');
    console.log('deckloom export --config=deckloom.config.cjs --deck=id --output=path [--format=png,pdf,html,pptx] [--slides=id,id] [--scale=2] [--transparent] [--media=screen|print] [--background=true|false] [--expected-fonts=family] [--allow-font-substitution] [--pptx-profile=windows-installed-v1]');
    return;
  }
  const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const configFile = path.resolve(option('config') || 'deckloom.config.cjs');
  const project = require(configFile);
  if (command === 'export') {
    const allowed = ['config', 'deck', 'output', 'format', 'slides', 'scale', 'transparent', 'media', 'background', 'expected-fonts', 'allow-font-substitution', 'resources', 'pptx-profile'];
    const seen = new Set(), booleans = ['transparent', 'background', 'allow-font-substitution'];
    for (const arg of args.slice(1)) {
      const name = arg.slice(2).split('=')[0];
      if (!arg.startsWith('--') || !allowed.includes(name)) throw new Error(`Unknown export argument: ${arg}`);
      if (seen.has(name)) throw new Error(`Duplicate export argument: --${name}`);
      seen.add(name);
      if (!booleans.includes(name) && (!arg.includes('=') || !option(name))) throw new Error(`--${name} requires a nonempty value`);
    }
    const boolean = (name, fallback) => {
      if (args.includes(`--${name}`)) return true;
      const value = option(name);
      if (value === undefined) return fallback;
      if (!['true', 'false'].includes(value)) throw new Error(`--${name} must be true or false`);
      return value === 'true';
    };
    const result = await createRenderer(project).export({ deckId: option('deck'), outputRoot: option('output'),
      ...(option('format') !== undefined ? { formats: option('format').split(',') } : {}),
      ...(option('slides') !== undefined ? { slideIds: option('slides').split(',') } : {}),
      png: { scale: option('scale') === undefined ? 1 : Number(option('scale')), transparent: boolean('transparent', false) },
      pdf: { media: option('media') || 'screen', background: boolean('background', true) },
      fonts: { policy: boolean('allow-font-substitution', false) ? 'allow-substitution' : 'strict', expected: option('expected-fonts')?.split(',') || [] },
      ...(option('pptx-profile') !== undefined ? { pptx: { mode: 'strict', fonts: { mode: 'reference', family: 'Arial', profile: option('pptx-profile') } } } : {}),
      ...(option('resources') !== undefined ? { resources: option('resources') } : {}) });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'succeeded') process.exitCode = 1;
  } else if (command === 'dev') {
    const server=await startReviewServer(project, { port: option('port') ? Number(option('port')) : undefined });
    const stop=()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);server.close();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  } else if (command === 'render') {
    const requested = option('deck') || project.decks[0]?.id;
    const result = await createRenderer(project).render({ ...(requested === 'all' ? {} : { deckId: requested }),
      ...(option('output') ? { outputRoot: option('output') } : {}) });
    const slides = Object.values(result.reports).flat();
    console.log(JSON.stringify({ outputRoot: result.outputRoot, slides: slides.length,
      failed: slides.filter(r => r.layoutIssues || r.missingAssets || r.consoleMessages).map(r => ({ deck: r.deck, slide: r.slide, layout: r.layoutIssues, assets: r.missingAssets, console: r.consoleMessages })),
      status: result.status, diagnostics: result.diagnostics, builds: result.builds }, null, 2));
    if (result.status !== 'succeeded') process.exitCode = 1;
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
