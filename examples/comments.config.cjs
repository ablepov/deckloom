const path = require('node:path');
module.exports = {
  contractVersion: 1, id: 'comments-example', mode: 'registered', root: path.join(__dirname, '../output/comments-example'),
  viewer: { title: 'Deckloom — комментарии', storagePrefix: 'deckloom-comment-example' },
  comments: { sourceId: 'example', projectId: 'comments-example', root: path.join(__dirname, '../output/comments-example/.comments'),
    author: { sourceId: 'local', id: 'example-author', label: 'Локальный автор' } },
  decks: [{ id: 'demo', label: 'Обсуждение слайдов', width: 960, height: 540, slides: [
    { id: 'cover', name: 'Точная привязка к версии' }, { id: 'portrait', name: 'Вертикальный слайд', width: 540, height: 960 },
  ] }],
  renderDocument(deck, slide) {
    return `<!doctype html><html lang="ru"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0}.slide{width:${slide.width}px;height:${slide.height}px;padding:48px;background:#e7edf0;color:#142d38;font:26px/1.4 Arial;display:flex;flex-direction:column;gap:24px}h1{font-size:42px;margin:0}.proof{display:grid;grid-template-columns:1fr 1fr;gap:16px;flex:1}.proof div{padding:24px;background:#c3d8df;border-radius:12px}.proof div:last-child{background:#f3d8a6}</style><main class="slide"><h1>${slide.name}</h1><p>Нажмите C и выберите точку для комментария.</p><div class="proof"><div>Исходный PNG<br>Одна версия</div><div>Обсуждение<br>Точное место</div></div></main></html>`;
  },
};
