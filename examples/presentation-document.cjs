// F1 data only: an editable presentation document is not an executable Project config.
module.exports = {
  documentVersion: 1,
  projectId: 'neutral-project',
  id: 'main',
  name: 'Презентация «Deckloom» — документ',
  width: 960,
  height: 540,
  compositions: [
    { id: 'two-cards', revision: '1', definition: { layout: 'two-cards', slots: ['left', 'right'] } },
    { id: 'two-cards', revision: '2', definition: { layout: 'two-cards', slots: ['left', 'right'], gap: 24 } },
  ],
  slides: [
    { id: 'cover', name: 'Обложка', content: { kind: 'template', ref: { libraryId: 'neutral-library', templateId: 'cover', revision: '1' }, data: { title: 'Кириллица, ёжик и «кавычки»' } } },
    { id: 'cards', content: { kind: 'local', ref: { compositionId: 'two-cards', revision: '1' }, data: { left: { title: 'Первая карточка' }, right: { title: 'Вторая карточка' } } } },
    { id: 'notes', width: 540, height: 960, content: { kind: 'authored', data: { title: 'Авторское содержание', paragraphs: ['Первый абзац — текст', 'Второй абзац'] } } },
  ],
};
