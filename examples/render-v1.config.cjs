const path = require('node:path');
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

module.exports = {
  contractVersion: 1, id: 'neutral-runtime', mode: 'registered',
  root: path.join(__dirname, '../output/v1-example'),
  viewer: { title: 'Deckloom v1 runtime' },
  decks: [
    { id: 'mixed', label: 'Mixed slide dimensions', width: 800, height: 450, slides: [
      { id: 'default', name: 'Deck defaults', data: { title: 'Презентация «Deckloom»' } },
      { id: 'width-only', width: 600, data: { title: 'Width override' } },
      { id: 'height-only', height: 700, data: { title: 'Height override' } },
      { id: 'both', width: 450, height: 800, data: { title: 'Portrait slide' } },
    ] },
    { id: 'portrait', label: 'Portrait deck', width: 450, height: 800,
      slides: [{ id: 'default', data: { title: 'Another deck' } }] },
  ],
  renderDocument(deck, slide, { baseUrl }) {
    return `<!doctype html><html><head><meta charset="utf-8">${baseUrl ? `<base href="${baseUrl}">` : ''}<style>
      html,body{margin:0;width:${slide.width}px;height:${slide.height}px;overflow:hidden}
      .slide{box-sizing:border-box;width:100%;height:100%;padding:32px;background:#f4f1e9;color:#17221c;font:28px Arial}
      h1{font-size:32px;margin:0}
    </style></head><body><main class="slide"><h1>${escapeHtml(slide.data.title)}</h1></main></body></html>`;
  },
};
