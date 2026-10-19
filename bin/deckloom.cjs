#!/usr/bin/env node
const path = require('node:path');
const { startReviewServer, createRenderer } = require('../src/index.cjs');

async function main(args = process.argv.slice(2)) {
  const [command = 'help'] = args;
  if (command === 'help' || command === '--help') {
    console.log('deckloom dev|render --config=deckloom.config.cjs [--deck=all] [--output=path] [--port=3000]');
    return;
  }
  const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const configFile = path.resolve(option('config') || 'deckloom.config.cjs');
  const project = require(configFile);
  if (command === 'dev') {
    await startReviewServer(project, { port: option('port') ? Number(option('port')) : undefined });
  } else if (command === 'render') {
    await createRenderer(project).run(args);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
