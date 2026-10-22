// E4 neutral cards extend the same single-source E3 fixture; no consumer styling.
const base = require('./pptx.config.cjs');
const text = (id, value, style = '') => `<div id="${id}" data-deckloom-pptx="text" style="${style}">${value}</div>`;
function card(id, title, body, fill) {
  return `<div id="${id}" data-deckloom-pptx="card" style="background:${fill}">` +
    text(id + '-title', title, 'left:20px;top:18px;width:calc(100% - 40px);height:40px;font-weight:700') +
    text(id + '-body', body, 'left:20px;top:76px;width:calc(100% - 40px);height:100px;font-size:22px;line-height:30px') + '</div>';
}
const slides = [
  { id: 'grid', columns: 'repeat(3, 1fr)', top: 150, height: 260, cards: [
    card('card-one', 'Первая карточка', 'Кириллица, ёжик<br>и обычный текст.', '#DDE8F6'),
    card('card-two', 'Вторая карточка', 'Текст <span style="font-weight:700">жирный</span><br>и <span style="font-style:italic">курсивный</span>.', '#F9E4BE'),
    card('card-three', 'Третья карточка', 'Отдельная фигура<br>с native текстом.', '#DCEAD9'),
  ] },
  { id: 'grid-wrap', columns: 'repeat(2, 1fr)', top: 130, height: 380, cards: [
    card('card-one', 'Карточка — один', 'Первая строка', '#DDE8F6'),
    card('card-two', 'Карточка — два', 'Вторая карточка', '#F9E4BE'),
    card('card-three', 'Карточка — три', 'Новый ряд сетки', '#DCEAD9'),
    card('card-four', 'Карточка — четыре', 'Порядок сохранён', '#E9E0F3'),
  ] },
];
module.exports = {
  ...base, id: 'pptx-grid-neutral',
  decks: [{ ...base.decks[0], slides: [...base.decks[0].slides, ...slides.map(({ id }) => ({ id }))] }],
  renderDocument(deck, slide) {
    const grid = slides.find(s => s.id === slide.id);
    if (!grid) return base.renderDocument(deck, slide);
    return '<!doctype html><html><head><meta charset="utf-8"><style>' +
      'html,body{margin:0}main{position:relative;width:960px;height:540px;background:#f4f1e9}' +
      'div{font:24px/32px Arial;color:#17221c;white-space:pre-wrap;text-align:left;margin:0;padding:0;overflow:visible}' +
      '[data-deckloom-pptx="text"]{position:absolute}' +
      '[data-deckloom-pptx="card"]{position:relative;display:block}' +
      '</style></head><body><main class="slide" data-deckloom-pptx="slide">' +
      text('title', grid.id === 'grid' ? 'Grid-карточки — редактируемый PPTX' : 'Grid — перенос карточек на новый ряд', 'left:48px;top:40px;width:864px;height:64px;font-size:36px;line-height:44px;font-weight:700') +
      `<div id="cards" data-deckloom-pptx="grid" style="position:absolute;display:grid;left:48px;top:${grid.top}px;width:864px;height:${grid.height}px;grid-template-columns:${grid.columns};gap:20px">` +
      grid.cards.join('') + '</div></main></body></html>';
  },
};
