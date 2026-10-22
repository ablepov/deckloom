# Подключение PPTX в E3

Изменение аддитивное, только development checkout; npm 0.1.0 не перепубликован. Существующие `render()`, defaults `export()` (`png,html`), font strict semantics, PDF/HTML/PNG и потребительские конфигурации сохраняются. Monq не менялся; готовность обновления его зависимости не заявлена.

Для нового PPTX:

1. Проверить [профиль E3](../contracts/pptx-e3.md): Windows/installed Arial, 960×540, native text/rect и PNG/ограниченный SVG. Произвольный существующий HTML этим профилем не становится автоматически.
2. В своём adapter объявить slide и прямые text/rect/image объекты, их стабильные HTML IDs и поддержанные стили. Текст и геометрия остаются в одном HTML-источнике. [Neutral adapter](../../examples/pptx.config.cjs) показывает полный переход без изменений потребителя.
3. Явно запросить `formats:['pptx']`, `fonts.policy:'allow-substitution'` и `pptx:{mode:'strict',fonts:{mode:'reference',family:'Arial',profile:'windows-installed-v1'}}`. Отдельного backend API, embedding и hybrid нет.
4. Проверить structured status, diagnostics, manifest и конечный output; не выдавать `backend-raw.pptx`. Unsupported cases исправляются в общем adapter или требуют отдельного будущего расширения E4, не скрытого raster fallback.
5. Выполнить собственную PowerPoint-приёмку: no repair, переносы/кириллица/слои, native edits/save/reopen. Системный Arial нужен получателю. Общая нейтральная проверка не гарантирует любой шаблон потребителя.

```powershell
node bin/deckloom.cjs export --config=examples/pptx.config.cjs --deck=main --output=output/pptx-example --format=pptx,pdf,png,html --allow-font-substitution --pptx-profile=windows-installed-v1
```

Для отката достаточно не запрашивать PPTX и сохранить исходный adapter/точную зависимость. Схема Project/Deck/Slide и документы пользователя не переписываются. Полное закрытие E3 пока ожидает [видимого UI checkpoint](../tasks/e3-export-2026-10-21.md).
