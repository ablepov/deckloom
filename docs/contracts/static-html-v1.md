# Статический HTML-профиль C1

Реализован в рабочей копии 20 октября 2026 года; npm 0.1.0 не изменён. Профиль относится к `contractVersion: 1`. Размер canvas задаёт нормализованный Slide; адаптер строит соответствующий HTML. Движок не исправляет размеры авторского CSS.

Поддерживаются статические HTML5 document/fragment, inline CSS и внешние stylesheet с `@import`, локальные web fonts, PNG/JPEG/WebP, inline SVG и SVG через img, data URLs и относительные пути. Layout, media queries и масштаб считаются в CSS viewport Slide, deviceScaleFactor 1, light color scheme, reduced motion. Обычные CSS-возможности Chromium работают без переписывания селекторов. Пригодность конкретной композиции проверяется layout QA. Отсутствие ошибок парсера не означает проверки всех CSS-свойств.

Для воспроизводимого результата закрепляются версия Deckloom/Playwright/Chromium, ОС, ресурсы и шрифты. Сравнение выполнено на Windows x64, Node 22.17.1, Playwright 1.59.1, Chromium 147.0.7727.15. Межплатформенная попиксельная идентичность не обещается. Нейтральный шрифт `test/fixtures/neutral.ttf` содержит собственную тестовую геометрию; генератор на fontTools хранится рядом, сторонние шрифты/брендовые материалы не использованы.

## Ресурсы

PNG подготавливается из исходного каталога слайда. Автоматически добавленный browser-only base сохраняет относительные ресурсы после переноса HTML в поколение сборки. Явный относительный `<base href>` разрешается относительно исходного document URL. Сохранённый HTML адаптера не переписывается. Прежний callback `{baseUrl}` сохранён: для отдельного outputRoot он по-прежнему указывает на исходный каталог.

HTTP preview использует логический URL HTML как base, включая authored relative base. Ресурсы внутри каталога слайда доступны автоматически; общие каталоги публикуются через явные `staticMounts`. Внешний stylesheet разрешает свои `url()` и `@import` относительно собственного URL. Абсолютный file base непригоден для HTTP и даёт видимую ошибку preview. Общая проверка профиля в renderer/viewer отвергает root-relative, protocol-relative и blob resource URLs в HTML и доступном CSSOM: file и HTTP origin иначе разрешили бы их по-разному. Зависящие от окружения абсолютные пути и сеть без закреплённых ресурсов не входят в проверенную гарантию совпадения. Для таких источников нужен явный одинаковый resolver адаптера либо подготовка ресурсов. Профиль не создаёт переносимый bundle: копирование и версионирование ресурсов относится к D4.

## Исполнение и preview

Скрипты, обработчики событий, javascript URLs, iframe/object/embed, canvas, video/audio, meta refresh и активные CSS animations требуют предварительного статического результата. V1 renderer отвергает их с `UNSUPPORTED_HTML`; выполнение scripts в его страницах отключено. Viewer также проверяет статические ограничения и показывает ошибку неподдержанного документа. Проверка активных animations выполняется в состоянии загрузки документа; это не полноценный линтер всех ветвей CSS.

Viewer v1 сохраняет весь document в отдельном sandboxed iframe без allow-scripts. Текст выделяется; CSS, head, font faces, viewport units и media queries не влияют на оболочку или соседний слайд. Геометрия holder и iframe равна Slide, внешнее масштабирование сохраняет aspect ratio. CSS-изоляция и sandbox здесь не являются контрактом безопасного исполнения недоверенного кода: hooks доверены, ресурсы требуют обычной политики доступа.

Сравнение одинакового примера с внешним CSS, `@import`, локальным шрифтом, PNG, обоими видами SVG и относительным base показало: renderer и document preview имеют одинаковые метрики (480×270, ширина AAAA 96 px, заданный цвет); прямой HTTP document и PNG попиксельно совпадают. Inline CSS rewriting потерял внешний head stylesheet. Поэтому document preview выбран для v1. Доказательства теста сохраняются в `output/validation/c/profile-comparison.json` и PNG рядом.

Unversioned input временно сохраняет inline viewer и прежнее исполнение JavaScript в renderer. Обнаруженное динамическое содержание получает warning `LEGACY_DYNAMIC_HTML`; это переходный режим, без гарантии совпадения с preview. Перевод на v1 требует статической подготовки такого HTML. Ошибки JS продолжают попадать в диагностику legacy renderer.

## Ошибки

Renderer сохраняет console/page errors, failed requests/HTTP ≥400, font/image failures и layout findings. Загрузка документа, fonts/images и screenshot ограничены [runtime-контрактом](programmatic-render-v1.md). Viewer ограничивает fetch/frame readiness 30 секундами; ошибки direct CSS, images/fonts и same-origin resource timing для импортов/backgrounds видимы и повторяются при здоровом polling. Cross-origin timing без разрешения браузера не даёт полного статуса вложенных ресурсов; диагноз renderer остаётся в manifest/API, а сетевые внешние ресурсы не дают гарантии воспроизводимости.

При повторной попытке прежняя ошибка остаётся до готовности нового frame. Успешный preview не загружается повторно на каждом poll. Generated HTML/PNG связаны [публикацией сборки](build-publication-v1.md); внешние ресурсы в эту транзакцию не входят.
