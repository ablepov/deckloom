# B3 Реестр и проекции чтения

20 октября 2026 года. Статус: B3 реализован и проверен локально. Разрешено: подключить реестр B2 к scanner/server/viewer, разделить registered/discovery и реализовать проекции B1 с проверками. B4 и Monq вне области задачи. Существующие незакоммиченные A/B1/B2 сохранены, ветка master, без commit/push/publish и без назначения релиза.

## Результат

- src/artifacts.cjs использует normalizeProject/preflightProject; сервер создаёт один неизменяемый registry snapshot. Public scanDecks/scanSlides создают snapshot на вызов. FS-артефакты перечитываются независимо от состава.
- Registered не сканирует root для добавления слайдов, сохраняет авторский порядок и placeholders, исключает оставшиеся папки. Discovery отдельно обнаруживает numeric families, сравнивает числовые значения без потери точности, равные числа — по ASCII имени. Папки без HTML/изображения и directory links не становятся слайдами.
- [Проекции B3](../contracts/read-api-v1.md) задают v1 envelope, Deck/Slide DTO, single-deck ответ, старую проекцию и точные URL/hash aliases. data/callbacks/source/absolute paths не выдаются через API. Для старого входа no/id/file/URL сохраняют прежний смысл, включая ranking изображений внутри разрешённой папки.
- src/server.cjs доставляет текущие registered-каталоги либо discovery-семейства и явные static mounts. V1 использует /artifacts/<relative-path>; legacy layout сохраняет старые файловые aliases. Зеркало явно объявленных mounts под namespace сохраняет ../assets ресурсы. Незаявленный root не публикуется; decoded traversal и realpath escape блокируются.
- Viewer явно поддерживает обе проекции, различает номер/ID, хранит v1 ссылки как project/deck/slide, корректно выбирает повторный локальный ID в другой колоде и показывает пустой Project/Deck. Отсутствующий preview не превращается в запрос undefined URL.
- examples/read-v1.config.cjs читает neutral output/example через v1. Потребительские презентации не требуются.

V1 чтение работает, но versioned rendering не открыт: createRenderer возвращает CONTRACT_RUNTIME_PENDING до B4; discovery в любом формате не получает renderer-capability. src/renderer.cjs не менялся в B3. Полная матрица размеров и unreadable/повреждённых файлов/сбоев preview остаётся B4; минимальные поля состояния и размеров добавлены как обязательная часть read projection B1.

## Ревью и совместимость

Независимый read-only reviewer проверил состав, snapshot, API boundary, hash и статическую доставку. Обнаружен регресс legacy ranking в registered (complete/hybrid-only PNG превращался в placeholder). Исправлено общим helper ранжирования для unversioned registered и discovery; две постоянные регрессии проверяют complete-over-html и hybrid-only. Повторный узкий проход подтвердил исправление и ограничение mount aliases явными ресурсами: 7/7 focused tests, без оставшихся блокеров. V1 registered следует фиксированному generated-html.png из B1. Для изменений состава/порядка, placeholders, single-deck и aliases обновлена [карта миграции](../migrations/project-contract-v1.md).

## Проверки

Основной набор содержит 28 проверок, включая 7 сценариев B3 и реальные Chromium-сценарии. Покрыты registered reorder/delete/stale/missing/root drafts, v0/v1 DTO, repeated local IDs и scoped hash/reload/navigation, source snapshot и live file refresh, discovery sort/ranking/read-only, safe routes/mount aliases и legacy viewer.

Проверка установленного npm-кандидата дополнена обязательными v1 read/server/viewer/relative SVG и discovery. Проверка опубликованного 0.1.0 использует прежнюю ветку fixture без требований B3, а локальная проверка явно требует v1Read/discovery в отчёте.

Среда: Windows x64, Node 22.17.1, Playwright 1.59.1, Chromium 147.0.7727.15.

| Проверка | Результат |
| --- | --- |
| npm run check | 20 модулей и viewer script, passed |
| npm test | 28/28; 7 сценариев B3, среди них проверки реального Chromium |
| npm run render:example | 3 слайда; 0 layout/asset/console failures |
| examples/read-v1.config.cjs | 3/3 слайда читаются как v1; HTML/PNG available |
| npm run check:baseline | 123 слайда и viewer focus/overview/narrow; passed, 108 857 ms |
| npm run check:baseline:ci | 27 слайдов; passed, 19 720 ms |
| npm run check:package | Внешний установленный tgz: legacy CLI/API/viewer/resources/кириллица/spec/QA и обязательные v1Read/discovery passed |
| npm run check:package:published | Настоящий registry 0.1.0 установлен и проверен прежней веткой fixture, passed |
| Archive/source | 24 файла, 49 171 bytes; SHA-256 всех 8 runtime-файлов равен текущим исходникам |
| Граница B4 | SHA-256 src/renderer.cjs совпадает с зафиксированным кандидатом B2 |
| Документация | 13 Markdown-файлов, 51 локальная ссылка, UTF-8; passed |
| git diff --check | Passed; только предупреждения настройки LF→CRLF |

Отчёты: игнорируемый output/validation/b3/ содержит baseline-full.json, baseline-ci.json, package.json и package-published-0.1.0.json. Кандидат deckloom-0.1.0.tgz локальный, не опубликованный релиз. Его integrity: sha512-8AG4KDu4kDfpZB0XsTAB/Tp2AIpSfAekOOBX7jh786EgOM3SJCqNk7/0Vi93hCaZ7evqIvv/kvZdE7zbAHm9yw==.

src/index.cjs, src/qa.cjs, src/renderer.cjs, bin/deckloom.cjs и package-lock.json в B3 не менялись. Новые package exports/зависимости не добавлены. Изменения workflows/package scripts и baseline fixtures относятся к A. Проверки локальные на Windows; remote CI/Linux, публикация и миграция конкретного потребителя не выполнялись.

## Следующий шаг

B4: согласовать effective dimensions и состояния/отказы HTML/PNG во всех представлениях с versioned renderer, закрыть оставшуюся матрицу и только затем объявлять end-to-end поддержку v1. Реализация этого шага и миграция конкретного потребителя здесь не выполняются.
