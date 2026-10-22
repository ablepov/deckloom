// Data-only authored composition exercising the E4 blocks through F3/F4/G1.
module.exports = {
  definition: { definitionVersion: 1, fields: { title: { type: 'string', required: true }, rows: { type: 'array', required: true, minItems: 1, maxItems: 4, items: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 } }, picture: { type: 'image', required: true } },
    blocks: [
      { id: 'title', type: 'text', x: 48, y: 36, w: 864, h: 64, text: { field: 'title' }, size: 32, lineHeight: 40 },
      { id: 'data-table', type: 'table', x: 48, y: 150, w: 520, h: 240, rows: { field: 'rows' }, size: 18, lineHeight: 24, padding: 8 },
      { id: 'data-link', type: 'connector', x: 568, y: 268, w: 112, h: 4, fill: { token: 'accent' } },
      { id: 'data-picture', type: 'image', x: 680, y: 150, w: 200, h: 240, image: { field: 'picture' }, fit: 'cover' },
      { id: 'transparent-fill', type: 'rect', x: 680, y: 420, w: 200, h: 60, fill: { token: 'accent' }, opacity: .4 },
    ] },
  values: { title: 'Документ → правка → сохранение → PPTX', rows: [['Показатель', 'План', 'Факт'], ['Строка один', '120', '135'], ['Строка два', '80', '92']], picture: { src: '../../export-assets/pptx-marker.png', alt: 'Оригинал PNG с crop' } },
};
