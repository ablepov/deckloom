# Добавление сохраняемого документа F1

F1 — аддитивный API development checkout, без нового релиза. [Схема и методы](../contracts/presentation-document-v1.md), [решения и проверки](../tasks/f1-document-2026-10-21.md).

Действующие `Project`/`Deck`/`Slide` конфиги, hooks, CLI, viewer и exporter миграции не требуют. Они по-прежнему могут содержать функции и opaque adapter data; runtime normalizer их не пропускает через JSON validator. Новый `presentation` namespace добавлен к root и `/node` imports, существующие экспорты сохраняются.

Сохраняемый документ — отдельная структура `documentVersion:1`, представляющая одну колоду с `projectId` и `id`. Для нового документа явно задаются dimensions и `slides`. Сохраняются stable IDs/order и отсутствующие per-slide dimension overrides. Не копируйте весь config в JSON: root paths, callbacks и runtime options не являются документом.

При подготовке документа автор адаптера должен отдельно выбрать JSON-данные и ссылки template/local/authored. F1 не добавляет автоматический config importer и не генерирует новые ID вместо старых. ID должны соответствовать F1 grammar и длине до 128; конфликт/неподходящий ID требует явного решения, не усечения. Data с functions/undefined/Date/cycles не очищаются молча — validator откажет.

`presentation.serialize()` возвращает строку, `deserialize()` — проверенный документ. Это in-memory round trip, без file storage/recovery G1 и без автоматического повторного рендера. Template ref структурно сохраняется; проверку внешней библиотеки и её ревизий реализует F2. Local ref уже требует точного определения ID/revision в документе.

Первой опубликованной схемы документа до F1 не было; миграция с вымышленной версии не вводится. Unknown `documentVersion` отвергается. Откат npm-зависимости сам по себе не конвертирует новый документ в config старой версии; храните исходные данные отдельно и используйте только поддерживающую схему реализацию.

В development v1 F2/F3 добавили optional `ref.integrity` и `slide.theme`. Новая реализация читает прежние F1 документы; старый strict F1 reader не обязан читать новые поля. Для F2/F3 использования старых template/local refs требуется явный `catalog.pinReferences(document)`: он проверяет revision и фиксирует definition/defaults hash, не обновляет существующие pins. Opaque F1 authored data не превращаются автоматически в F3 `{definition,values}`. `compositions.createProject` связывает валидный документ с прежним renderer, `storage.createStore` реализует G1; library/resources должны быть доступны явно. Portable project packaging и schema migrations G3/G4 остаются отдельными этапами.
