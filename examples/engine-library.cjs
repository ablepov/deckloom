module.exports = {
  libraryVersion: 1, id: 'neutral-engine', templates: [{ id: 'summary', revision: '1',
    defaults: { title: 'Нейтральный шаблон', body: 'Текст экземпляра — редактируется независимо.', showBody: true, picture: { src: '../../export-assets/pptx-marker.png', alt: 'PNG' } },
    definition: { definitionVersion: 1,
      fields: { title: { type: 'string', required: true, minLength: 1, maxLength: 80 }, body: { type: 'string', required: true, maxLength: 200 }, showBody: { type: 'boolean', required: true }, picture: { type: 'image', required: true } },
      themes: { light: { background: '#f4f1e9', foreground: '#17221c', accent: '#2456a6' }, dark: { background: '#17221c', foreground: '#f4f1e9', accent: '#2456a6' } }, defaultTheme: 'light',
      slots: [{ id: 'heading', accepts: ['text'], required: true }, { id: 'content', accepts: ['rect', 'text', 'image'], required: false }],
      blocks: [
        { id: 'title', type: 'text', slot: 'heading', x: 48, y: 40, w: 864, h: 64, text: { field: 'title' }, size: 36, lineHeight: 44, bold: true },
        { id: 'panel', type: 'rect', slot: 'content', x: 64, y: 150, w: 832, h: 300, fill: { token: 'accent' } },
        { id: 'body', type: 'text', slot: 'content', x: 88, y: 180, w: 600, h: 200, text: { field: 'body' }, visible: { field: 'showBody' }, color: '#ffffff', size: 24, lineHeight: 32 },
        { id: 'picture', type: 'image', slot: 'content', x: 720, y: 190, w: 120, h: 120, image: { field: 'picture' } },
      ] },
  }],
};
