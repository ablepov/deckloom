const path = require('node:path');

// Read the neutral artifacts from `npm run render:example` through contract v1.
// The registered draft is also viewable before artifacts exist. This particular
// config has no renderer; use render-v1.config.cjs for the full runtime example.
module.exports = {
  contractVersion: 1, id: 'neutral-reader', mode: 'registered',
  root: path.join(__dirname, '../output/example'), artifacts: { layout: 'legacy' },
  viewer: { title: 'Deckloom registry example' },
  decks: [
    { id: 'demo', label: 'Neutral landscape', artifactPrefix: 'demo-slide', width: 1280, height: 720,
      slides: [{ id: 'cover', artifactNo: '01', name: 'HTML stays yours' }, { id: 'details', artifactNo: '02', name: 'Second slide' }] },
    { id: 'portrait', label: 'Neutral portrait', artifactPrefix: 'portrait-slide', width: 720, height: 1080,
      slides: [{ id: 'cover', artifactNo: '01', name: 'A different canvas' }] },
  ],
};
