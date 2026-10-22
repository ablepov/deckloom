# Локальное хранилище G1

`storage.createStore({root:absolute,catalog})` — async API без UI. Каждый save/load/recovery проверяет документ, pinned references и F3 schema. Корень явно задаётся владельцем; managed descendants не могут быть symlinks/junctions. ID ASCII, case-insensitive paths, exact stored identity; Windows device names запрещены. Файлы UTF-8, ограничены бюджетом документа.

- `save(document,{expectedToken})`: `null` только для создания, SHA-256 точных предыдущих bytes для замены. Ответ `{document,token}`. Без токена запись запрещена. `load(projectId,id)` возвращает тот же receipt.
- `rename(projectId,id,name,{expectedToken})` меняет display name; ID сохраняется.
- `autosave(document,{expectedToken})` пишет отдельный checkpoint с base token, не заменяет main. `recover(projectId,id,{source:'backup'|'autosave',expectedToken})` выбирается явно; stale autosave поверх исправного нового main отклоняется. Для повреждённого main token доступен в `STORAGE_CORRUPT`; для отсутствующего main — `null`.
- `duplicate`/`move(projectId,id,targetProject,targetId,{expectedToken})` требуют отсутствующего target directory. Copy независим; перенос имеет журнал намерения и завершается при следующем открытии после прерывания. Старый каталог с checkpoint сохраняется в `.trash/<archive>`; checkpoints не принимаются как новый main автоматически.
- `remove(projectId,id,{expectedToken})` переносит в `.trash/<archive>`, не удаляет рекурсивно. Чужие файлы/подкаталоги блокируют операции каталога. Архивы доступны на диске; UI восстановления архивов вне G1.

Запись: temp в том же каталоге → flush file → rename; backup получает только предыдущий исправный main. Повреждение, missing reference или конфликт не уничтожают last-good copy. Journal и архив сверяются по tokens. Cancellation до commit отклоняется; после публикации move intent операция завершается/восстанавливается. Возможны незавершённые stage/temp файлы после process crash; они не принимаются как пользовательский main.

Взаимное исключение cooperating API writers — файловый bakery protocol: независимые полностью записанные tickets, номера/nonce, проверка живого PID. Никто не удаляет ticket другого владельца; dead tickets игнорируются и остаются для диагностики. Живой более ранний writer возвращает `STORAGE_BUSY`, retry делает вызывающий. PID reuse обрабатывается консервативно как живой владелец.

На Windows замена собственного ticket может временно получить sharing error из-за reader другого процесса. Только для ticket rename действует bounded retry до 500ms с сохранением choosing flag; раннего admission это не разрешает. Документные записи таким retry не маскируются. Read buffers ограничены размером файла +1 и общим бюджетом; рост во время чтения даёт конфликт.

CAS повторяется перед commit и ловит внешние изменения при подготовке. **Строгая атомарная проверка содержимого и replace возможна только для cooperating writers**: обычная переносимая файловая система не предоставляет compare-content-and-rename для произвольного внешнего редактора. Проверки путей также предполагают, что другой процесс не подменяет каталоги в момент системного вызова.

Directory fsync выполняется там, где платформа его поддерживает. На Windows Node/файловая система могут запрещать directory handles/fsync; там подтверждается process-interruption recovery, не транзакционная гарантия при потере питания. Root нельзя совместно использовать через файловую систему с несогласованными directory reads/rename semantics (например, произвольный network filesystem).
