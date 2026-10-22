# F3/F4 — definitions, capabilities и редактирование

`compositions.normalizeDefinition()` принимает `definitionVersion:1`, closed `fields`, `blocks`, optional `themes/defaultTheme/slots`. Поля типизированы: string/number/boolean/color/image/enum/array/object, required/nullable и bounds. Definition validator проверяет структуру; тип привязанного значения проверяется при разрешении документа.

Blocks text/rect/image/list/metric имеют stable slide-scoped IDs, geometry и literal/`{field:id}` bindings; цвета поддерживают `{token:'background'|'foreground'|'accent'}`. Slots задают accepts, required и смысловой порядок. Исчезновение обязательного visible slot и несовместимый порядок отвергаются. Theme выбирается по slide.theme, explicit defaultTheme или сортированному первому ключу — canonical key order не меняет поведение pin. Политика images — relative local URI либо prepared PNG/SVG base64, без whitespace/authority/backslash bypass.

E4 добавляет table rows binding/size/lineHeight/padding (single-line rectangular string cells), connector fill (thin horizontal/vertical, без attachment), image fit fill/center cover и leaf opacity literal/binding. Полный ограниченный export profile — [матрица E4](pptx-e4-matrix.md). Native table требует opacity 1 и fitting row height; hidden field data сохраняются.

`compositions.validateDocument(doc,catalog)` разрешает integrity pins F2 и валидирует поля/blocks/themes/slots. Authored payload имеет `{definition,values}`. Выдаёт snapshots definitions/data, compiled blocks и capabilities. `pptx.supported` описывает структурное подмножество; resource/font/layout checks обязательны на фактическом экспорте, это не completed Office acceptance.

`compositions.createProject(doc,catalog,{root:absoluteResourceRoot})` создаёт snapshot registered Project для существующего renderer/export pipeline. HTML/text/attributes экранируются, callbacks в JSON не сериализуются; отдельного контента по форматам нет.

`editing.createEditor(catalog)` — immutable transactional API: create; addTemplate/addLocal/addAuthored; remove/duplicate/rename/reorder; editFields/setTheme/setSlideSize. Definition/block edits (add/edit/remove/reorder/visibility) разрешены для authored instances, не меняют pinned shared definitions. Field patch shallow, неизвестные/невалидные поля отвергаются; block IDs/type/slot сохраняются, required slots защищены, hidden data не удаляются. Порядок — exact permutation IDs. До/после операции валидируется весь документ, ошибки/AbortSignal cancellation не меняют input. Synchronous операции bounded документом; storage interface получает возвращённый validated документ в G1.

F1 JSON schema аддитивно принимает optional slide.theme; omitted overrides сохраняют наследование. UI, свободное изменение фирменной библиотеки и G2 обновление pinned definitions не входят в эту реализацию. [Рабочая запись](../tasks/autonomous-engine-2026-10-21.md).
