# Текущее состояние и продолжение

**22.10.2026 — локальная UI-правка после релиза:** toolbar заменён отдельными Lucide SVG; download trigger получил spinner/«Готовим…», reduced-motion/mobile и восстановление состояния. Исправлено перекрытие меню уведомлением. Проверено в браузере и external package; [запись и evidence](tasks/toolbar-icons-2026-10-22.md). Пока не опубликовано: обычный Monq3000 остаётся на0.2.0.

**22.10.2026 — Deckloom 0.2.0 опубликован в npm и установлен в Monq Slides.** Registry tarball совпал с проверенным кандидатом; полный CI Linux/Windows и внешний registry consumer прошли. Обычный `npm run dev` Monq работает на **http://localhost:3000/#retail-slide-08**; preview4070 остановлен. Retail16: render без ошибок, viewer19 checks, реальные PDF/PPTX/ZIP downloads и independent font/text/media checks прошли. Исправлена Monq render CLI обёртка для явного выбора колоды и exit status. [Запись релиза](tasks/release-0.2.0-2026-10-22.md), [релиз](https://github.com/ablepov/deckloom/releases/tag/v0.2.0). Reload recovery/постоянное хранение export jobs ещё не реализованы; Google — disabled Beta, font shaping parity не закрыта.

Обновлено 22.10.2026 после [реализации меню скачивания выбранной колоды](tasks/download-menu-2026-10-22.md). PDF/PPTX/ZIP со шрифтами технически проверены; Google — отключённая Бета-заглушка по явному запросу пользователя. Ранее F2–F4/G1 выполнены и проверены, E4 принят пользователем. Полноценный редактор отложен. Шрифтовая работа и границы Retail — [предыдущая задача](tasks/monq-retail-pptx-2026-10-21.md). Статусы — [roadmap](roadmap.md).

## Где остановились

F1–F4/G1 выполнены: catalog/integrity pins, typed fields/blocks/themes/slots, общий renderer bridge, immutable edits, atomic storage/CAS/backup/autosave/recovery и file operations. **91/91 tests**, syntax 56 modules/viewer, installed npm consumer `f2g1Engine:true`, baseline 123, D/E3 exports — pass. Сквозной create → independent edits → save/recovery/new-store reopen → all-format export — pass. Новая E4 matrix (12 landscape + 1 portrait) и engine (3 slides) проверены независимыми parsers, настоящим PowerPoint COM render/edit/save/reopen и визуальным сравнением PNG. Сложные фон/тень — объявленный декоративный растр, текст native. Пользователь проверил новые PPTX в Google Презентациях и явно закрыл E4. Пользователь затем уточнил цель: движок и Monq PowerPoint, выбрал Retail16; [текущая задача](tasks/monq-retail-pptx-2026-10-21.md).

A, B1–B4, C и D закрыты в development checkout. E1-проба и E2-решение о backend завершены. **E3 закрыт по явной пользовательской приёмке:** технические проверки пройдены, конечный PPTX открыт в видимом PowerPoint без repair, три слайда просмотрены, пользователь проверил файл в Google Презентациях и принял шаг выполненным. Интерактивная PowerPoint UI правка/save/reopen не наблюдалась из-за отсутствия активации Office; пользователь принял это ограничение для закрытия E3. **Первый случай E4 согласован, реализован и технически проверен:** ограниченные Grid-карточки и отчёт о преобразовании. Пользователь подтвердил в Google Презентациях внешний вид и text/fill editing, явно закрыл первый случай E4 и согласовал переход к F1. Остальная ограниченная матрица E4 реализована, технически проверена и теперь принята пользователем после проверки новых PPTX в Google Презентациях. Ненаблюдённые интерактивные PowerPoint проверки сохранены как факты evidence; явное решение пользователя закрывает этап в реализованных границах. Эти изменения вошли в опубликованную0.2.0; выпуск и Monq update проверены22.10.2026.

| Этап | Источник решений и проверок |
| --- | --- |
| A — исходная точка, пакет, совместимость | [Задача A](tasks/stage-a-2026-10-20.md), [правила совместимости](compatibility.md) |
| B1 — Project/Deck/Slide | [Решения](tasks/b1-contract-2026-10-20.md), [контракт](contracts/project-deck-slide-v1.md) |
| B2 — нормализация/валидация | [Проверки](tasks/b2-normalization-2026-10-20.md) |
| B3 — registry/read API | [Проверки](tasks/b3-read-registry-2026-10-20.md), [read API](contracts/read-api-v1.md) |
| B4 — размеры/состояния/renderer | [Проверки](tasks/b4-runtime-2026-10-20.md), [render contract](contracts/render-v1.md) |
| C — runtime и publication | [Решения и приёмка](tasks/c-runtime-2026-10-20.md) |
| D — offline PNG/HTML/PDF | [Приёмка](tasks/d-export-2026-10-20.md), [export contract](contracts/export-v1.md) |
| E1–E2 — PPTX proof и backend | [Сравнение E1](reviews/pptx-e1-2026-10-21.md), [решение E2](decisions/pptx-backend-e2.md), [приёмка E2](tasks/e2-backend-2026-10-21.md) |
| E3 — общий PPTX export, принят пользователем | [Полная запись E3 и решение приёмки](tasks/e3-export-2026-10-21.md), [контракт](contracts/pptx-e3.md), [миграция](migrations/pptx-e3.md) |
| E4 — Grid и расширенная матрица приняты пользователем | [Реализация, evidence и пользовательская приёмка](tasks/e4-scope-2026-10-21.md), [контракт](contracts/pptx-e4-grid.md) |
| F1 — реализован и проверен | [Решения и проверки](tasks/f1-document-2026-10-21.md), [документ v1](contracts/presentation-document-v1.md), [переход](migrations/presentation-f1.md) |
| F2–F4/G1 — проверены; новая E4 matrix — принята | [Итог и evidence](tasks/autonomous-engine-2026-10-21.md), [catalog](contracts/templates-v1.md), [editing](contracts/compositions-editing-v1.md), [storage](contracts/storage-v1.md), [E4 bounds](contracts/pptx-e4-matrix.md) |

## Текущий разрешённый шаг

**Меню скачивания реализовано и технически проверено.** В шапке viewer — PDF, PPTX, PPTX со шрифтами (ZIP) и disabled «Открыть в Google Презентациях · Бета». Запрос фиксирует всю выбранную колоду; отдельный job API, прогресс, attachment download, повтор, ошибки/занятость, keyboard/mobile. Project.downloads — общий optional namespace; источники/шрифты/лицензии задаёт consumer. ZIP содержит только используемые полные TTF, совпадающие с embedded faces, лицензии и инструкцию; установки автоматически нет. Исправлен общий PDF-validator для self-contained Type3/CharProcs без ослабления проверки ordinary fonts и гонка публикации complete до освобождения job.

**101/101 tests**, syntax63, external installed package — pass; Monq syntax112 — pass. Свежие настоящие API скачивания Retail:16-page PDF,16-slide PPTX,ZIP; независимые parsers подтвердили210 native texts,25 fills,45 pictures, font hashes/versions/лицензии и наличие всего native PPTX текста в PDF. Desktop375px/mobile keyboard/menu проверены; финальный успешный PDF download через кнопку наблюдался после перезапуска на свежем Monq source. [Запись, evidence, SHA и ограничения](tasks/download-menu-2026-10-22.md), [контракт](contracts/viewer-downloads-v1.md).

Обычный Monq server: **http://localhost:3000/#retail-slide-08**, installed npm dependency **0.2.0**. Отдельный preview4070 остановлен. PDF доступен зарегистрированным renderable колодам, native PPTX/ZIP настроены для Retail; остальные profiles не подготовлены и UI показывает недоступность. После правок source JS нужен restart сервера. Google-интеграция, полный editor и cross-application font shaping parity остаются вне закрытого объёма. [Выпуск и проверка потребителя](tasks/release-0.2.0-2026-10-22.md).

## Шрифтовой срез от 21 октября

**Актуально:** общий source-font/semantic/measured development profile применён ко всем **16 слайдам Retail**. По отдельному явному разрешению пользователя установлен исходный Manrope4.504 вместо1.000, старые файлы/registry/SHA сохранены в `output/validation/monq/font-transport/user-font-backup-2026-10-21/`. Actual Office использует4.504; кегль и spacing сохранены без font-specific коэффициентов/переименований/shrink. Auto-width flow, nowrap, цельные text runs и пробелы исправлены в общем модуле. 210 native texts,29 fills,47 pictures,30 groups; сложные scenes03/05/06/07 — локальные pictures. Все source line counts и native bounds проходят; максимум baseline deviation по209 searchable PDF blocks0.213px. Office COM render/edit/save/reopen и независимые XML/font/media/geometry checks — pass;98/98 tests и syntax61. Все16 свежих PDF PNG просмотрены. Новый файл: `C:/Users/ablep/Downloads/Monq-Retail-16-Editable-2026-10-21.pptx`, SHA `4361441dcb9ac147cd8827d74f30164081d2f9befc11d2e8a02f4d804614c56a`. [Полная запись, evidence и ограничения](tasks/monq-retail-pptx-2026-10-21.md#retail16-исходные-шрифты-и-послойный-кандидат-для-google-проверки), [development contract](contracts/pptx-measured-source-fonts.md). **Это проверенный кандидат для Google, не окончательная приёмка:** horizontal shaping/GPOS parity ещё неполная; local font-version collision устранена. Google этого файла и интерактивный Office UI не наблюдались. Profile ещё не подключён к public export/CLI и постоянной Monq dependency/config; релиза не было. Следующий шаг — Google проверка пользователя, затем фактические исправления и общий versioned public profile/consumer adapter. UI/редактор отложен, дизайн/контент Monq сохранены. Commit/push/release не было.

Историческая Compatibility-проба Retail16 с backdrop и дроблением текста **не принята**. Последующие layered01–03 получили замечания по выравниванию/логотипу/шрифтам и послужили проверочным срезом; детали и старые SHA сохранены в [задаче](tasks/monq-retail-pptx-2026-10-21.md). Native circular WordArt не требуется: пользователь явно разрешил локальную картинку сложной схемы вместе с надписями.

Пользователь проверил новые PPTX в Google Презентациях, подтвердил корректность/редактируемость, явно закрыл E4 и запросил переход к визуальной шаблонизации и интерфейсу редактора. Последующее уточнение заменило UI-направление: редактор пока не нужен; разрешены доработка движка и экспорт Monq Retail16 с сохранением содержания/оформления/фирменных шрифтов и редактируемого текста. [Текущая запись](tasks/monq-retail-pptx-2026-10-21.md).

F1 выполнен: отдельная JSON-схема `documentVersion:1` и public namespace `presentation` через root и `/node` imports. Serialize/deserialize, normalize и thin renameSlide/duplicateSlide helpers проверены. Исполняемые Project configs не проходят новый JSON validator автоматически; совместимость сохраняется.

1. F2–F4 и G1 выполнены в согласованном API-объёме: catalog/pins, fields/blocks/themes/slots, immutable edits и local storage. [Контракты и проверки](tasks/autonomous-engine-2026-10-21.md). Вся согласованная ограниченная матрица E4 реализована и принята пользователем в Google Презентациях; приёмка не расширяет заявленный native/raster profile.
2. Повторно не открывать E3/E4 приёмку и не выполнять F1 checks без новых изменений/сбоя. Ограничения UI evidence остаются историческими фактами, не незакрытым gate принятого шага.
3. Визуальные шаблоны, UI, G2–G4 и Monq/другие потребители не выполнялись. Без веток/commit/push/release. Текущая работа — Monq Retail16 PPTX: общий export profile и consumer adapter, без редактора/переработки дизайна. Предложение editor UI отложено, не является утверждённым объёмом. Публикация пакета/commit/push по отдельному разрешению.

## Что проверено в F1

- `npm run check` — 41 modules + viewer; `npm test` — 68/68, pass. Document tests 7/7: variants/refs/ID/order round trip, rename/duplicate isolation, schema/version/ref negatives, JSON data safety/budgets.
- Внешний npm archive consumer — pass, `consumer.f1Document:true`; runtime hashes новых `src/document.cjs` и root `src/index.cjs` совпадают с checkout. Старые public imports/CLI/render/export также проходят.
- Baseline 123 slides, D PNG/HTML/PDF и E3 public PPTX с независимыми parsers — pass. Office COM/UI не повторялись: PPTX implementation не менялась в F1.
- Evidence — `output/validation/f1/verification.json`, `tests-final.txt`, snapshots package/baseline/export/PPTX checks; данные — `presentation.json` и `presentation-edited.json`. Второй JSON подтверждает rename ID и независимый duplicate с сохранением pinned refs.
- F1 — in-memory data API, не file storage и не automatic renderer. External template library resolution относится к F2; block schema/capabilities и nested block identity к F3/F4.

## Что проверено и передано в E4

- `npm run check` — 38 modules + viewer; `npm test` — 61/61, pass. Включены strict negatives, 256/257 native budget, SVG/rect leaves и mapping к реальным XML shapes, intact HTML serialize/restore/recapture.
- `npm run check:export`, baseline 123 slides и внешний npm archive consumer — pass. Package runtime hashes сверены с текущими `src/pptx.cjs` и `src/renderer.cjs` при передаче.
- `node scripts/check-pptx.cjs --grid --office --output=output/validation/e4/final` — 3 E3 + 2 Grid slides, независимые XML/ZIP/image/PDF parsers и PowerPoint 16 COM, pass. На обоих Grid slides native text/fill edits сохранились после save/reopen. COM PNG slides 4–5 просмотрены визуально.
- Evidence: `output/validation/e4/final/`, `output/validation/e4/tests-final.txt`, `output/validation/e4/delivery.json`. Финальный PPTX общего exporter скопирован в «Загрузки», SHA-256 `1f361b504c5c3f347ae7ebafa4cd2500cfd08a6172b67033519485807ab0eec8`; hash копии совпал. Это не raw backend и не COM-edited файл.
- **Принято пользователем:** slides 4–5 в Google Презентациях выглядят нормально, текст и заливка редактируются. Решение закрыть первый случай E4 записано в задаче и `output/validation/e4/user-acceptance.json`. Ненаблюдённые PowerPoint UI no-repair/edit/save/reopen остаются ограничениями evidence; исторические поля не переписаны. Вся матрица E4 не завершена.

## Что уже проверено в E3

Общий API/CLI строит PPTX из того же подготовленного HTML до PDF media overrides. Начальный профиль — Windows, реально установленный Arial reference, 960×540, native text/runs/solid rectangles и PNG/ограниченный SVG. Нет embedding/hybrid. PptxGenJS 4.0.1/JSZip/@xmldom поставляются воспроизводимым bundle с notices. Узкая нормализация исправляет три доказанных backend defects; неизвестные повреждения отвергаются. Независимое ревью и исправления подробно сохранены в записи E3.

- 57/57 тестов; `npm test` ограничивает одновременные test files двумя, assertions/deadlines сохранены.
- Нейтральная база 123 слайда, старый render example, D export, установленный npm archive и registry 0.1.0 consumer — pass.
- Bundle/inventory/notices reproducibility и root/private build-tree audits — pass, 0 vulnerabilities на момент проверки.
- Настоящий PowerPoint 16 COM: rendering, точные строки/геометрия/порядок/runs, native edit/save/reopen — pass. Исправлена Unicode-передача тестовой правки для PowerShell 5.1; строка `Правка — сохранено` проверена независимо в XML и визуально.
- Свежий `@oai/sky` runtime: конечный PPTX открыт через диалог PowerPoint без repair, просмотрены все три слайда; SHA-256 исходника неизменен. Evidence `output/validation/e3/ui/verification.json` содержит `visibleNoRepairObservation:true` и снимки/деревья UI.
- Пользователь загрузил выданный PPTX в Google Презентации, сообщил «все норм», а затем явно принял E3 выполненным и попросил двигаться дальше; ссылка, источник и решение записаны в [задаче E3](tasks/e3-export-2026-10-21.md). Пользователь пока не может активировать Office.
- **Ограничение принятого результата:** интерактивная PowerPoint UI правка текста/заливки и UI save/reopen отдельной копии не наблюдались; Office не активирован и отключает редактирование. По явному решению пользователя это больше не блокирует E3. Историческое COM evidence с `visibleNoRepairObservation:false` и UI evidence с ненаблюдёнными edit/save/reopen сохранены без изменения фактов.

Техническое evidence находится в `output/validation/e3/final/`: `result.json`, `independent-verification.json`, `powerpoint/verification.json`, PNG и COM-edited PPTX. Новое UI evidence — `output/validation/e3/ui/`. Output игнорируется Git и не включается в npm archive. Если локальных файлов нет, сначала воспроизвести общий экспорт командой ниже; прежние результаты не объявлять свежей проверкой.

```powershell
node scripts/check-pptx.cjs --office --output=output/validation/e3/final
```

Эта команда проверяет COM и независимые parsers, **не** интерактивную PowerPoint UI правку. Для кода применяются `npm run check`, `npm test`, `npm run check:export`, `npm run check:pptx`, `npm run check:baseline`, `npm run check:package`; при изменении vendor — отдельные audit/reproducibility checks. Не повторять весь набор только из-за нового чата, если код и исходные evidence не изменились.

## Рабочая копия и известное ограничение

Путь — `C:\repositories\deckloom`, PowerShell, Node 22+, Playwright/Chromium, установлен PowerPoint 16. Ветка на момент передачи — `master`. Изменения A–G1 и E4 уже существуют и в основном не закоммичены; не сбрасывать/не очищать checkout, не создавать worktree/ветку, commit/push/release без отдельного запроса. Один автор изменений в checkout.

При неограниченной параллельной нагрузке обнаружена граница старого C cleanup: если сам `newPage` превышает короткий deadline, borrowed browser может кратковременно показывать context до завершения late-close callback. Это не исправлено ограничением параллельности тестов. Отдельный будущий hardening требует deterministic deferred-newPage tests; он не является условием для перехода к видимой E3-приёмке. Подробности — в записи E3 и API C.


