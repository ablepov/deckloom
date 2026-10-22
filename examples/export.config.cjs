const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const assets = path.join(__dirname, 'export-assets');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
module.exports = {
  contractVersion: 1, id: 'neutral-export', mode: 'registered', root: path.join(__dirname, '../output/export-source'),
  staticMounts: { '/assets': assets },
  decks: [{ id: 'demo', label: 'Нейтральный экспорт', width: 640, height: 360, slides: [
    { id: 'intro', name: 'Проверка экспорта', data: { title: 'Презентация — Deckloom', text: 'Кириллица: ёжик, съёмка, проверка. Текст остаётся текстом в PDF.' } },
    { id: 'portrait', name: 'Портретный слайд', width: 360, height: 640, data: { title: 'Другой размер', text: 'Размер страницы соответствует этому слайду. Порядок задаёт колода.' } },
    { id: 'closing', name: 'Завершение', data: { title: 'Готово к переносу', text: 'HTML, изображения и шрифт работают без исходной папки и сети.' } },
  ] }],
  renderDocument(deck, slide) {
    return `<!doctype html><html><head><meta charset="utf-8"><base href="${pathToFileURL(assets + path.sep).href}"><link rel="stylesheet" href="deck.css"><style>.slide{width:${slide.width}px;height:${slide.height}px}</style></head><body><main class="slide"><h1>${escape(slide.data.title)}</h1><p>${escape(slide.data.text)}</p><img src="marker.svg" width="48" height="48" alt="Маркер"></main><template id="font-license">${escape(fs.readFileSync(path.join(assets, 'DejaVu-LICENSE.txt'), 'utf8'))}</template></body></html>`;
  },
};
