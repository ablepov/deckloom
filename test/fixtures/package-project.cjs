const path = require('node:path');
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
module.exports = {
  root: path.join(__dirname, 'artifacts'),
  decks: [
    { id: 'landscape', label: 'Neutral landscape', artifactPrefix: 'wide', width: 960, height: 540,
      slides: [{ no: '01', name: 'Проверка «Deckloom» — API' }, { no: '02', name: 'Second neutral slide' }] },
    { id: 'portrait', label: 'Neutral portrait', artifactPrefix: 'tall', width: 540, height: 810,
      slides: [{ no: '01', name: 'Portrait slide' }] },
  ],
  viewer: { title: 'Installed Deckloom', storagePrefix: 'installed-deckloom' },
  staticMounts: { '/assets': path.join(__dirname, 'artifacts/assets') },
  renderDocument(deck, slide) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;width:${deck.width}px;height:${deck.height}px;overflow:hidden}
      .slide{box-sizing:border-box;width:100%;height:100%;padding:48px;display:flex;flex-direction:column;gap:24px;background:#f4f1e9;color:#17221c;font-family:Arial,sans-serif}
      h1{margin:0;font-size:36px;line-height:1.2}img{width:48px;height:48px}
    </style></head><body><main class="slide"><h1>${esc(slide.name)}</h1><img src="../assets/marker.svg" alt="Neutral marker"></main></body></html>`;
  },
  validateDocument(html) { if (!html.includes('<main class="slide">')) throw new Error('Missing neutral slide'); },
  renderSpec(deck, slide) { return `# ${deck.id} ${slide.no}\n`; },
};
