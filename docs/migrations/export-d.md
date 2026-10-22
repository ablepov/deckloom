# Переход на экспорт D

Этап D добавляет `renderer.export(options)` и CLI `export` в рабочую копию. Опубликованный 0.1.0 этих возможностей не имеет. Переход потребителя, релиз и изменение Monq отдельно не выполнялись.

Существующие `render()`, `renderDeck()` и `run()` сохраняют правила C. Если нужен прежний связанный с исходниками HTML/PNG, менять вызов не требуется. Для переносимого результата выберите точный deckId, отдельный outputRoot и форматы:

```js
// Прежний preview/render pipeline остаётся доступным:
const preview = await renderer.render({ deckId: 'demo' });
// Новый самостоятельный результат:
const exported = await renderer.export({
  deckId: 'demo', outputRoot: '/exports/demo', formats: ['png', 'pdf', 'html'],
  fonts: { expected: ['DejaVu Sans'] },
});
if (exported.status !== 'succeeded') throw new Error(JSON.stringify(exported.diagnostics));
// Передавайте файлы из exported.outputs или копируйте exported.bundle.directory целиком.
```

1. Привести HTML к статическому профилю C. Динамику, SMIL и сложные resource substitutions подготовить в adapter. Исполняемые callbacks не становятся переносимым исходным документом F/G.
2. Объявить все источники ресурсов через root/staticMounts. Разделить source и destination; parent/child overlap, скрытые зависимости от сети и выход за roots блокируются. Для авторских `<base>` использовать file URL исходного ресурса либо абсолютные локальные пути; export удаляет base после разрешения.
3. Заменить системные/local fonts на разрешённые к передаче web font files. Проверить glyph coverage и фактическое family name. Если платформенный fallback нужен сознательно, выбрать allow-substitution и проверить отчёт; это ограничивает автономность оформления HTML. Лицензии передаваемых ресурсов остаются ответственностью потребителя.
4. Задать media/background явно при печатном оформлении. Проверить PDF page count/boxes, весь текст и fonts, визуально сравнить страницы. Убрать conflicting important color policy на псевдоэлементах при PDF_COLOR_POLICY_CONFLICT. Непреднамеренная пагинация требует исправить HTML/print CSS.
5. Для выборки перечислить slideIds; их порядок задаёт Deck. Для PNG задать scale, дающий целые пиксели. Alpha не удаляет авторскую заливку.
6. Проверять structured status и outputs, сохранять manifest/resources/fonts рядом с результатом. Не извлекать файлы из canonical mirrors и не смешивать поколения. Для переноса копировать всю bundle.directory, затем открыть без исходной папки/сети.

Добавлены публичные runtime dependencies parse5, PostCSS, postcss-value-parser, pdf-lib; Chromium/Playwright остаются обязательными для рендера. При обновлении сохранить lockfile и прежнюю точную версию. Нейтральная проверка установленного пакета теперь упражняет export через API/CLI, PNG/PDF и автономный HTML. Она не заменяет проверку конкретного adapter перед обновлением его зависимости. Полная схема и ограничения — [export v1](../contracts/export-v1.md).
