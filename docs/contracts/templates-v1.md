# F2 — каталог и закреплённые экземпляры

`templates.createCatalog(libraries)` принимает JSON array библиотек `{libraryVersion:1,id,templates:[{id,revision,definition,defaults}]}`. Definitions/defaults — JSON records. Catalog делает глубокий snapshot; ID уникальны ASCII case-insensitive, разные ревизии используют единый spelling ID. Lookup library/template/revision точный, без latest и сетевой загрузки.

Методы catalog:
- `list()` и `resolve({libraryId,templateId,revision,integrity?})` возвращают независимые JSON snapshots. Unknown version/revision и неоднозначные ID дают явные ошибки.
- `instantiate(document,ref,newSlideId,data={})` добавляет независимый экземпляр в конец. Defaults применяются один раз, merge shallow: присутствующий ключ заменяет значение целиком, включая object/array/null; отсутствующий наследуется. При чтении defaults повторно не применяются.
- `pinReferences(document)` явно принимает существующее определение для legacy-ссылки без hash. Только добавляет отсутствующий pin; существующий несовпадающий pin отвергается.
- `resolveDocument(document)` требует integrity у template/local refs, разрешает их и возвращает `{document,slides}` с независимыми definition/data, effective dimensions и сохранённой identity. Authored data остаются inline; их смысл проверяет F3.

F1 ref schema аддитивно принимает optional `integrity` — lowercase SHA-256. Старые документы остаются нормализуемыми/сериализуемыми, но resolution unpinned refs требует явного `pinReferences` (`UNPINNED_TEMPLATE_REFERENCE`). Старый строгий F1 reader без этого расширения не читает новые pinned docs; это development schema extension, не опубликованная совместимость со старым reader.

Hash вычисляется по canonical key-sorted JSON versioned/domain-separated envelope: kind + library/template/local identity + revision + целое definition и defaults (для template). Instance data/name/dimensions не входят в hash. Замена definition/defaults под тем же ref даёт `TEMPLATE_INTEGRITY_MISMATCH`; pinning не скрывает такую замену. Canonicalization сохраняет JSON special keys безопасно. Aggregate документ и результат resolution ограничены JSON budgets F1.

F2 не валидирует визуальные поля definitions и не рендерит их сам: этот контракт принадлежит F3. Runtime configs не изменены. [Рабочая запись](../tasks/autonomous-engine-2026-10-21.md).
