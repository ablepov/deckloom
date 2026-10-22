# Публикация сборки C4

Реализована в рабочей копии. Единица публикации — одна Deck. Несколько колод одной render-операции публикуются независимо, последовательно. Новая сборка не заменяет текущую до готовности всего набора generated HTML/PNG/QA, optional spec и report.

## Хранение

```text
outputRoot/.deckloom/write.lock
outputRoot/.deckloom/decks/<deckId>.json
outputRoot/.deckloom/builds/<uuid>/manifest.json
outputRoot/.deckloom/builds/<uuid>/bootstrap.html
outputRoot/.deckloom/builds/<uuid>/files/<canonical-relative-path>
```

`.deckloom` зарезервирован. Control directories и manifest files не могут быть links; обычные B1 physical path checks сохраняются. outputRoot не может попадать внутрь source build controls. Один writer владеет всем outputRoot; второй получает BUILD_BUSY. Это защищает и canonical mirrors. После process crash lock не удаляется автоматически: сначала подтвердить отсутствие writer, затем удалить только этот write.lock и повторить render. Автоматическая эвристика stale PID не применяется.

Каждый manifest имеет manifestVersion:1, buildId (UUID), deckId, state, startedAt, finishedAt после завершения, ordered slides с id/index/width/height и относительными artifact roles, optional report и diagnostics. Состояния: building, complete, failed, cancelled. Failed/cancelled сохраняют уже подготовленную часть состава и диагностику. Complete с QA findings отличается от прерванного исполнения: полный набор опубликован, findings доступны, общий результат может быть failed.

Pointer имеет manifestVersion:1, deckId, published (UUID или null), latestAttempt (UUID). Он заменяется атомарным rename с ограниченными Windows retries. В начале попытки latestAttempt меняется, published остаётся прежним; после полного исполнения published указывает на новое поколение. При ошибке/отмене публикуемый ID остаётся прежним. Если commit pointer не записался, фиксация failed состояния также сохраняет прежний ID. Поколения не переиспользуются и пока не удаляются автоматически. fsync/crash-durable transaction при отключении питания и защита от сторонней правки файлов не обещаются.

## Читатели

Scanner считывает pointer один раз на колоду и использует одну опубликованную composition для всех её generated artifacts. URL сохраняет логический canonical путь, добавляя `build=<uuid>`; version тоже равен build ID. Server обслуживает именно объявленный файл этого поколения. Запрос старого URL после новой публикации получает прежние байты. Неизвестный/corrupt build не переключается на canonical файл. Относительные ресурсы используют прежний логический каталог; build query не наследуется CSS/image URLs.

В read DTO Deck добавлено `build`: state=unversioned при отсутствии pointer, unreadable с diagnostic при повреждении, unpublished/published с buildId и latestAttempt {buildId,state,diagnostics:[{code,severity,stage?}]}. Paths, stack и сообщения adapter в HTTP metadata не раскрываются. Viewer показывает состояние последней попытки, сохраняя предыдущую опубликованную сборку при ошибке или отмене.

При наличии pointer отсутствие слайда в опубликованном manifest означает missing; старый файл с тем же canonical именем не подмешивается. Удалённый declared artifact — unreadable/MISSING_BUILD_ARTIFACT; повреждённая схема — unreadable/INVALID_MANIFEST. Registered composition/config продолжает задавать порядок и placeholders. Discovery использует объявленный состав опубликованного legacy поколения; без manifest сохраняет прежнее сканирование и ранжирование. Изменение текущего реестра/перезапуск server может запретить старый путь; ответ тогда 404, без замены другими байтами.

## Совместимость и пределы

Renderer сохраняет прежние canonical файлы и basename отчётов как зеркало, после подготовки поколения и перед commit. Старые прямые файловые читатели сохраняют доступ, но несколько отдельных файлов зеркала не образуют транзакцию. Для согласованного чтения нужно использовать scanner/server build URLs или manifest generation paths. Unversioned и discovery readers Deckloom также учитывают manifest. Для файлов, созданных сторонним инструментом без manifest, доступен явный unversioned режим доступности без обещания общей ревизии.

В C4 зафиксированы генерируемые HTML/PNG/spec/QA/report. CSS, шрифты, изображения, mounts и сетевые ресурсы адаптера не копируются; их версия может измениться между preview и render. Полный ресурсный bundle — D4. Нельзя удалять `.deckloom` для «обновления» canonical зеркала: это снимает гарантию поколения. При откате на 0.1.0 использовать ранее сохранённые артефакты/зависимость согласно [политике совместимости](../compatibility.md).

Если файловая система не позволяет сохранить failed manifest, исходная ошибка и ошибка сохранения возвращаются через [RenderResult](programmatic-render-v1.md). Cleanup error после уже завершённой публикации не отменяет complete generation; его диагностика находится в результате операции. Гарантия читателей — отсутствие молчаливой смеси generated artifacts, а не отсутствие любого I/O сбоя.
