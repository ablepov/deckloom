const path = require('node:path');

function createContractProject(root = path.join(__dirname, '../../output/contract-example')) {
  return {
    contractVersion: 1, id: 'neutral-project', mode: 'registered', root,
    decks: [
      { id: 'intro', label: 'Введение', width: 1280, height: 720, slides: [
        { id: 'cover-main', name: 'Обложка', data: { title: 'Презентация «Deckloom» — пример' } },
        { id: 'cover-meeting', width: 960, data: { title: 'Отдельный экземпляр' } },
      ] },
      { id: 'portrait', label: 'Вертикальная колода', width: 720, height: 1080,
        slides: [{ id: 'cover-main', height: 1200, data: { title: 'Другой формат' } }] },
    ],
    renderDocument(deck, slide) {
      const text = slide.data.title.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      return `<!doctype html><html><meta charset="utf-8"><body><main class="slide" style="width:${slide.width}px;height:${slide.height}px">${text}</main></body></html>`;
    },
  };
}

module.exports = { createContractProject };
