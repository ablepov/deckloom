# Автономное развитие движка F2 → F3 → F4 → G1 → E4

Источник: прямое согласие пользователя 21.10.2026: «Делай автономно F2 → F3 → F4 → G1 с проверками каждого этапа, затем продолжай E4 и проведи сквозную проверку. К визуальным шаблонам и интерфейсу вернёмся вместе».

Объём согласован целиком; обычные технические решения и проверки не требуют повторного разрешения. Визуальные фирменные шаблоны, UI, потребители и commit/push/release остаются вне объёма. Сохраняются изменения A–F1, текущая ветка master, один автор checkout. Независимые reviewers только читают.

| Шаг | Текущее состояние |
| --- | --- |
| F2 — catalog/revisions/independent instances | Реализован, focused F1/F2 11/11 pass; [контракт](../contracts/templates-v1.md). Старые refs требуют явного pin, существующие pins не переписываются |
| F3 — fields/blocks/capabilities | Реализован и focused проверен, включая настоящий all-format export; deterministic themes/resource policy замечания reviewer исправлены. [Контракт](../contracts/compositions-editing-v1.md) |
| F4 — editing API | Реализован, focused operations/isolation/cancel/slot guards проходят; [контракт](../contracts/compositions-editing-v1.md) |
| G1 — local storage | Выполнен: atomic save/CAS/reopen/backup/autosave/recovery, rename/move/duplicate/archive, interrupted move, actual 2-process race (12 rounds) и corruption/conflict checks; focused 7/7 pass. [Контракт](../contracts/storage-v1.md) |
| E4 — дальнейшая матрица | Реализована и технически проверена: Flex, native tables/connectors, center cover crop, explicit decorative gradient/shadow raster, native opacity, themes, portrait. Focused 5/5 pass, включая SVG crop/fallback aspect. [Границы](../contracts/pptx-e4-matrix.md). Новая пользовательская приёмка в Google Презентациях получена; E4 закрыт в реализованных границах |
| Сквозная проверка | Pass: create → instantiate twice → independent edits → theme/authored blocks → serialize → save/rename/autosave/recover → new-store reopen → HTML/PNG/PDF/PPTX + conflict/invalid edit/library drift negatives |

## Итог реализации и проверок

- Public namespaces `presentation`, `templates`, `compositions`, `editing`, `storage` доступны через root и `/node`. Старые executable configs/CLI/viewer/export сохранены. Data-only definitions и records не требуют callbacks в JSON. Фирменные шаблоны/UI/потребители не менялись.
- `npm test` — **91/91**, `npm run check` — **56 modules + viewer**, pass. Лог `output/validation/autonomous-tests.txt`; focused проверки запускались перед переходом между F2/F3/F4/G1/E4.
- Внешний npm archive consumer — pass: `consumer.f1Document:true`, `consumer.f2g1Engine:true`; runtime bytes совпадают с checkout. Baseline **123 slides** — pass. Evidence snapshots перечислены в `output/validation/engine/final/final-verification.json`.
- Новый end-to-end: `node scripts/check-engine.cjs --output=output/validation/engine/final`; `presentation.json`, `library.json`, storage directory, export receipt и `verification.json` сохранены. Авторская таблица/connector/crop/opacity проходят F3/F4/G1 и общий exporter.
- После Windows hardening весь end-to-end повторён в `output/validation/engine/final/hardened` на окончательном G1. All-format export, COM и independent parsers — pass; presentation JSON byte-identical первому успешному сценарию. В Downloads engine-файл обновлён этим последним PPTX с предварительной проверкой, что прежняя копия не изменена извне. Итоговый `final-verification.json` сверяет все runtime hashes с установленным npm archive, 91/91 tests, receipts и hashes трёх Downloads.
- E4: `node scripts/check-e4.cjs --office --output=output/validation/e4/matrix`; landscape **12 slides** (первые 5 — прежние E3/Grid), portrait **1 slide** отдельно. Настоящий PowerPoint COM открыл/отрендерил все слайды и подтвердил native text/fill/table-cell/connector/crop edit/save/reopen. End-to-end deck **3 slides** прошёл тот же COM сценарий.
- `python scripts/check-engine-output.py <result.json> --office` — pass для matrix main, portrait и engine. Независимые ElementTree/zipfile/Pillow/pypdf проверяют структуру/отношения/content types/PNG, native text/table/crop geometry, сохранность primary PNG bytes, source hashes, native scene mapping, размеры PDF/PNG и Office evidence. PDF rounding допускается в пределах 0.5pt. Новые растры — только явно объявленные пустые decorations/background, `containsText:false`.
- Визуально просмотрены browser/PowerPoint comparisons всех новых landscape cases, portrait и authored engine slide. `output/validation/e4/matrix/main/comparison.png`; MAE новых landscape cases 0.683–2.093/255, portrait 1.010, engine 1.033–1.628. Это описательная метрика, не pixel identity gate.

## Замечания независимого ревью и исправления

Read-only reviewers, один автор checkout. F2 hash domain/key ordering/defaults проверены. Исправлены F3 implicit theme key order и image whitespace/authority bypass. G1 shared stale-lock reclamation заменён на bakery tickets без удаления чужих tickets; partial lock publication исключена, external CAS перепроверяется перед commit, journal закрытый/архив проверяется по hash; directory fsync выполняется где поддержан. Ограничения Windows/power loss и cooperating writers явно описаны.

Усиленный two-process test воспроизвёл Windows EPERM при замене собственного ticket одновременно с reader. Добавлен bounded retry только ticket rename, choosing flag сохраняется; read buffers уменьшены до bounded stat.size+1 с growth conflict. Детерминированные 3 injected EPERM и 12 rounds двух процессов проходят; bounded reviewer не обнаружил safety/admission/data-loss flaw. Это исправление, а не расширение списка допустимых ошибок теста.

Один повторный full run был прерван после зависания test/runtime.test.cjs cleanup: assertions уже завершились, HTTP polling connection удерживал server.close перед browser cleanup. Test helper теперь закрывает только test-owned connections, product runtime/UI не менялись. Focused runtime 7/7 pass. Прерванный лог сохранён отдельно `autonomous-tests-interrupted.txt`; найденный sharing failure — `autonomous-tests-windows-sharing.txt`. Оба не выдаются за successful final run.

В E4 исправлены silent table text-transform/spacing и positioned-cell loss, передан точный line-height. Более строгий crop test обнаружил нулевой srcRect при передаче box dimensions в backend — теперь передаются natural dimensions + crop box; независимый parser проверяет формулу. PNG compatibility fallback для SVG crop сохраняет полные natural dimensions/aspect до native crop, а не растягивается в box; raster pixel budget проверяется заранее. Отдельный `svg-crop` all-format export/Office COM/independent parsers — pass, MAE 1.192. Для shadow требуется достаточный padding; clone фиксирует border-box. Повторное bounded review не обнаружило новых blocking findings, targeted 2/2 tests — pass.

## Готовность и следующий совместный шаг

Автономная API-работа F2 → F3 → F4 → G1 и E4 выполнены. Пользователь 21.10.2026 сообщил: «Проверил новые PPTX в Google Презентациях, всё нормально, всё редактируется. Закрываем E4 и давай переходить к визуальной шаблонизации и интерфейсу редактора.» Источник — прямое сообщение пользователя; Google Slides UI не наблюдался агентом. Новое явное решение закрывает E4 после проверки выданных файлов, а не наследует прежнюю приёмку Grid. Visible PowerPoint no-repair opening и интерактивные UI edits/save/reopen новых файлов по-прежнему не наблюдались; COM evidence и его flags не переписывались. Реализованные границы (включая explicit decorative raster) сохраняются. Receipt приёмки — output/validation/e4/matrix/user-acceptance.json.

Начата совместная проработка visual templates/UI; [новая запись](editor-visual-framing-2026-10-21.md). G2–G4, consumer integration, commit/push/release не выполнялись. Старое C late-newPage cleanup ограничение остаётся записанным в current-state, не выдаётся за исправленное.

## Файлы для пользователя

В `C:\Users\ablep\Downloads` скопированы исходные export PPTX, не COM-edited copies; SHA-256 копий сверен с export receipts. `output/validation/engine/final/downloads.json` хранит пути/hashes.

- `Deckloom-E4-Matrix-2026-10-21.pptx` — 12 slides; новые E4 cases slides 6–12 (Flex, table, connectors, crop, paint, opacity, dark).
- `Deckloom-E4-Portrait-2026-10-21.pptx` — отдельный portrait slide.
- `Deckloom-Engine-F2-G1-2026-10-21.pptx` — 3 slides после independent edits/storage/recovery/reopen.

