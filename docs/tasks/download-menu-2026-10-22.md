# Меню скачивания выбранной колоды

## Запрос и согласованные границы

Пользователь явно поручил добавить в движок кнопку «Скачать» с четырьмя пунктами: PDF всей выбранной колоды, PPTX всей выбранной колоды, ZIP с PPTX и устанавливаемыми шрифтами, disabled Google Презентации с отметкой «Бета». Это авторизация нового пути экспорта в существующем viewer; полноценный редактор, OAuth/Google upload и изменение содержания/оформления колод не входят. Предыдущий общий разбор архива и Google — источник предложения; именно этот запрос разрешил реализацию меню.

Применены route-codex-work (связанные изменения оставлены одному lead), product-task-understanding (явно заданный сценарий достаточен для реализации), enterprise-b2b-ui-ux, presentations и Playwright. Ветку не меняем, commit/push/release не разрешены.

## Реализация

Общий viewer использует существующую шапку и UI tokens. Добавлены меню, progress/success/error/retry, автоматическое скачивание и повторная ссылка, доступная клавиатура и narrow viewport. Выбранная колода фиксируется при нажатии; переключение во время работы не меняет файл. Google — disabled native button, без загрузок/авторизации.

src/downloads.cjs запускает настоящий renderer export в отдельный temp root; source profile подключает общие semantic/fonts/measured modules. src/server.cjs содержит ограниченный job API и attachment response. Project.downloads — новый явный optional namespace конфигурации; adapter data остаётся opaque. ZIP содержит исходные TTF той же версии, только использованные faces, лицензии, SHA manifest и инструкцию; автоматической установки нет. Подробности — [контракт](../contracts/viewer-downloads-v1.md).

Во время integration test найдены и исправлены две общие ошибки: complete публиковался до освобождения предыдущего задания (гонка с следующим экспортом); валидатор PDF не распознавал встроенные Type3 CharProcs и ошибочно требовал FontFile. Для Type3 добавлена проверка glyph streams, обычные отсутствующие/пустые шрифты продолжают отвергаться. Font names, кегль и source content ради прохождения проверки не менялись.

## Monq и параллельная работа

В Monq добавлены только consumer config src/deck/download-profile.js, ссылка downloads в engine-adapter.js и исходные static Manrope400/500/600/700 + OFL/native reference в assets/fonts/manrope/pptx. Все файлы TTF скопированы без изменений из проверенного4.504 candidate. Слайдовый контент не редактировался.

Во время проверки обнаружено, что соседний чат активно меняет Retail09–11 и другие product scenes. Дополнительные записи в checkout Monq были остановлены по правилу одного автора; работа продолжена только в Deckloom. После завершения соседнего writer и перехода его чата в idle consumer config актуализирован: HTML product screenshot containers объявлены local atomic scenes через семантический класс .retail-screenshot:not(img), отдельно radial/link scenes. Это сохраняет соседние native copy/fills и не сводит слайд в фон. experiments/monq-retail/download-preview.config.cjs теперь только делегирует canonical consumer config, без дублирования правил. После финальных правок canonical11 проведена read-only browser проверка16 текущих исходных слайдов:210 native blocks, все source font styles имеют reference; pass. Старые неудачные пробы не выданы как готовый результат.

Запущенный installed Monq остаётся на npm deckloom0.1.0. Локальный новый viewer доступен отдельно на localhost:4070. Новая публикация/переустановка зависимости не выполнялась.

## Проверки и результат

Нейтральный источник с двумя колодами/повторным slide ID: точный выбор/полный порядок, PDF page count, PPTX text, ZIP font bytes/hash/version/license, CSRF/Origin/unknown deck/empty/unknown format/Google/path injection/busy, failed resource без download URL. Browser: четыре пункта, Google disabled, Escape/focus, переключение во время экспорта, narrow375px без горизонтального overflow — pass. После устранения гонки targeted export/download suite13/13 — pass. Desktop/mobile screenshots просмотрены: output/playwright/downloads-2026-10-22/.

**Финальный полный npm test:101/101 pass**, npm run check:63 modules/viewer pass, Monq npm run check:112 JS pass, локальный package в чистом внешнем consumer pass. В промежуточном полном прогоне наблюдался Windows EPERM в существующем G1 separate-process lock test; отдельный storage rerun7/7 и финальный полный прогон прошли без изменения storage runtime. Другой прогон обнаружил Windows ENOTEMPTY только при удалении test fixture B4; в teardown добавлены maxRetries:5, как уже принято в соседних Windows fixtures. Основные проверки/утверждения теста не ослаблены. Ошибочные промежуточные прогоны не считались pass.

**Все три настоящих download API jobs Retail завершились успешно:**16-page PDF,16-slide PPTX и ZIP. Независимый verify-downloads.py (pypdf/python-pptx/fontTools/PDFium):210 native text blocks,25 fills,45 pictures; PDF размеры1440×810pt на всех16 страницах; весь native текст PPTX найден в PDF;205 Type3 fonts имеют непустые CharProcs, ordinary fonts — встроенные font streams. Отдельный Type3 unit regression принимает self-contained glyph programs, но отвергает пустые программы и отсутствующий ordinary font при общем descriptor. ZIP и отдельный PPTX имеют одинаковый состав/текст/типы объектов; обе Manrope4.504 TTF в ZIP совпадают побайтно с embedded TTF PPTX. Лицензия/инструкция Windows/macOS присутствуют, исполняемых установщиков нет. Просмотрен свежий16-page PDF overview и крупный слайд05; desktop/mobile menu screenshots просмотрены. Технический Office COM для этого download-среза повторно не выполнялся; Google disabled, его приёмка не заявляется.

Evidence: output/validation/downloads-2026-10-22/ — tests.log, targeted.log, storage-recheck.log, package.log, live.log, downloads-receipts.json, independent-verification.json, PDF/PPTX/ZIP и fresh PNG. Сохранённые API artifacts:

| Формат | Файл evidence | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| PDF | retail-live.pdf | 18273096 | d41f640dbfb4bf5077debe2cf6bdf14cea6d282fe5ef906aeb5f8093552012aa |
| PPTX | retail-live.pptx | 14988677 | 658be03ba8e0e6dba5e45a38c3393cd9e69f0a1515c14ffb81165635109ae507 |
| ZIP | retail-live-with-fonts.zip | 15051853 | 50cd55926d1813614309362a2c6d6d2bf6152a7f7f661e9431a0029e61443d95 |

После завершения соседних правок server перезапущен с canonical Monq config на http://localhost:4070/#retail-slide-01. Структура/содержимое registered-конфига фиксируются при запуске; изменения source JS требуют перезапуска сервера. Viewer отдельно перечитывает опубликованные preview artifacts. PDF capability доступен registered renderable колодам; PPTX/ZIP в Monq настроены сейчас для Retail, остальные native profiles ещё не подготовлены и соответствующие пункты имеют disabled explanation. В нейтральном engine profile нет привязки к Retail/Manrope.

После финального restart наблюдался ещё один успешный PDF download именно через меню в настоящем браузере: status «PDF готов · Monq · Ритейл», повторная attachment ссылка, активная кнопка после завершения. Состояние этой пробы не смешивается с промежуточным старым PDF_FONT_NOT_EMBEDDED. Preview открыт в панели текущего чата; пользовательский сервер3000 не остановлен.

Пользовательская UI-приёмка нового меню ещё не получена. Шаг реализации/технических проверок завершён; Google integration остаётся заглушкой, полная cross-application font shaping parity не объявляется закрытой. Commit/push/release и подмена installed Monq зависимости не выполнялись.
