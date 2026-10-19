const path = require('node:path');
const output = path.join(__dirname, '../output/example');
const decks = [
  { id: 'demo', label: 'Deckloom demo', artifactPrefix: 'demo-slide', width: 1280, height: 720,
    slides: [{ no: '01', name: 'HTML stays yours', content: 'One engine for your presentations' }, { no: '02', name: 'A second slide', content: 'Selectable text, keyboard navigation and overview' }] },
  { id: 'portrait', label: 'Portrait demo', artifactPrefix: 'portrait-slide', width: 720, height: 1080,
    slides: [{ no: '01', name: 'A different canvas', content: 'Dimensions belong to each deck' }] },
];
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
module.exports = {
  root: output, decks,
  viewer: { title: 'Deckloom demo' },
  renderDocument(deck, slide) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;width:${deck.width}px;height:${deck.height}px;overflow:hidden}
      .slide{box-sizing:border-box;width:100%;height:100%;padding:64px;display:flex;flex-direction:column;gap:32px;background:${deck.id === 'portrait' ? '#e8eee8' : '#f4f1e9'};font-family:Arial,sans-serif;color:#17221c}
      h1{margin:0;font-size:56px}p{margin:0;font-size:32px}
    </style></head><body><main class="slide"><h1>${esc(slide.name)}</h1><p>${esc(slide.content)}</p></main></body></html>`;
  },
};
