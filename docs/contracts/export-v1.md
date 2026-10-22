# Экспорт v1 — D1–D4

Реализован в development checkout, без нового опубликованного релиза. `createRenderer(project).export(options)` использует общий runtime C, реестр B и существующие hooks. Статический профиль экспортируется в PNG, PDF и автономный HTML. E3 добавляет [ограниченный PPTX-профиль](pptx-e3.md); его видимая PowerPoint-приёмка ещё не закрыта.

```js
const { createRenderer } = require('deckloom/node');
const result = await createRenderer(project).export({
  deckId: 'demo',
  outputRoot: '/absolute/path/to/export',
  slideIds: ['intro', 'closing'],
  formats: ['png', 'pdf', 'html'],
  png: { scale: 2, transparent: false },
  pdf: { media: 'screen', background: true },
  fonts: { policy: 'strict', expected: ['DejaVu Sans'] },
});
if (result.status !== 'succeeded') throw new Error(JSON.stringify(result.diagnostics));
console.log(result.outputs, result.bundle);
```

## Запрос и подготовка

Одна операция выбирает одну непустую колоду по точному `deckId`; `all` не является специальной командой API. `outputRoot` обязателен и физически отделён от `project.root` и всех `staticMounts`: нельзя писать ни внутрь источников, ни в их родительскую папку. Проверяется realpath существующих предков, включая ссылки. Относительные пути разрешаются от cwd.

`slideIds`, если задан, — непустой массив уникальных точных ID. Это множество выбора: результат всегда сохраняет порядок Deck, даже если запрос перечисляет ID наоборот. Для unversioned конфигурации ID слайда — исходный `no`. Неизвестный ID отвергается до записи и запуска браузера. Исходные данные и состав проекта не меняются; один выбранный слайд не требует рендерить остальные.

| Параметр | Значение по умолчанию / граница |
| --- | --- |
| `formats` | `['png','html']`; непустой уникальный массив из `png`, `pdf`, `html`, `pptx` |
| `pptx` | Только для `formats` с `pptx`; обязательные strict/reference Arial/windows-installed-v1 options по [контракту E3](pptx-e3.md) |
| `png.scale` | Положительное конечное число, default 1; оба произведения CSS canvas × scale должны быть положительными безопасными целыми |
| `png.transparent` | `false`, boolean |
| `pdf.media` | `screen`; допускается `print` |
| `pdf.background` | `true`, boolean |
| `fonts.policy` | `strict`; либо явный `allow-substitution` |
| `fonts.expected` | `[]`; уникальные непустые названия фактически используемых семейств |
| `resources` | Только `offline`; связанный с исходниками результат остаётся в `render()` |

Неизвестные поля и неверные типы отвергаются. Параметры `browser`, `signal`, `onProgress`, `hookTimeoutMs`, `pageTimeoutMs`, `warnings` наследуют [API C](programmatic-render-v1.md). Библиотека не меняет argv, stdout или exitCode; переданный браузер остаётся собственностью вызывающего кода.

Общий pipeline один раз вызывает adapter для каждого выбранного слайда, включает ресурсы, проверяет экранный документ, снимает PNG и при необходимости печатает PDF того же документа. PDF может явно применить print CSS. Формат не выбирает другую копию текста или данных. Hooks получают metadata B/C; opaque data остаётся ответственностью adapter.

## PNG и PDF

PNG сохраняет логический CSS canvas и задаёт device scale factor. Например, 640×360 при scale 1.5 даёт ровно 960×540. Дробные итоговые пиксели отвергаются; заголовок фактического PNG проверяется перед записью. Предел — 16384 px по стороне и 64 Mi пикселей, дополнительно действует логический предел C для выбранных слайдов. Alpha отключает только стандартный фон браузера: авторский фон остаётся нарисованным.

Каждый слайд печатается Chromium отдельно, с нулевыми полями, без headers/footers, с явным размером страницы. Затем страницы объединяются через pdf-lib без превращения текста в изображение. Разные размеры и ориентации поддержаны: CSS px × 0.75 даёт PDF pt с допуском округления Chromium до 0.8 pt. Один слайд обязан дать одну страницу; переполнение на несколько страниц останавливает экспорт с `PDF_PAGINATION`.

Default `screen` сохраняет экранное оформление; `print` применяет печатные media rules. После CDP-инспекции шрифтов media восстанавливается перед печатью, поскольку detach сессии сбрасывает Chromium override. `background:true` задаёт exact color adjustment; `false` — economy вместе с `printBackground:false`. Это настройка CSS background-печати Chromium: изображения `<img>` остаются содержанием. Авторский color adjustment на элементах переопределяется inline important. Конфликтующая important-политика рисующего псевдоэлемента отвергается с `PDF_COLOR_POLICY_CONFLICT`; её нужно убрать в статической подготовке. Переносимый HTML сохраняет исходное оформление, эти overrides действуют только на PDF-страницу.

Шрифты проверяются через CDP для screen и выбранного PDF media. Strict требует фактически использованные file-backed web fonts, включая кириллицу и fallback отдельных glyphs. `local()` не переносим и в strict запрещён даже в неактивной декларации. `expected` проверяет наличие семейства в объединённом PDF-инвентаре, если запрошен PDF, иначе в экранном. Название CSS alias может отличаться от реального family name: пример использует alias DeckloomExport и фактический DejaVu Sans.

`allow-substitution` явно разрешает платформенные fallback и записывает реальные family/PostScript identities, разрешённые подмены и отсутствующие expected families в manifest. Доступность этих системных шрифтов на другом компьютере не гарантируется. Итоговый PDF независимо проверяется на наличие FontDescriptor/font streams и соответствие использованным PostScript identities; неподтверждённое встраивание останавливает экспорт. Полная извлекаемость текста и визуальная точность конкретного adapter проверяются его приёмкой; движок не обещает правильное отображение любого произвольного HTML.

## Offline-профиль ресурсов

HTML разбирается parse5, CSS — PostCSS и value-parser. Обход включает неиспользуемые selectors, неактивные media/imports/fonts, `srcset`/`imagesrcset`, CSS `url()`/`image-set()`, SVG href и presentation URL attributes. CSS escapes нормализуются перед проверкой. Скрипты, handlers, SMIL, динамические элементы, SVG foreignObject и xml:base требуют статической подготовки. `image-set(var/env/attr(...))` отвергается с `UNRESOLVED_RESOURCE`, поскольку строковая подстановка может скрыть URL в неактивной ветви.

Локальные CSS, SVG, PNG/JPEG/WebP/GIF/AVIF/ICO, TTF/OTF/WOFF/WOFF2 и текстовые ресурсы включаются как data URLs; вложенные CSS/SVG переписываются рекурсивно. Исходники остаются прежними. Разрешены только физические файлы внутри root или объявленных mounts и поддержанные data URLs. HTTP/HTTPS/blob и прочие схемы, UNC/remote file authorities, выход через symlink, missing/unsupported ресурсы и циклы блокируют публикацию. UNC отвергается до обращения к файловой системе. Внешние ссылки `<a href>` требуют подготовки; поддержаны локальные `#fragment`.

`staticMounts` добавляет разрешённые физические источники; HTTP mount prefixes не подменяют file URL автоматически. Adapter должен предоставить локальный file base или file URL. Например, серверный `/assets/logo.svg` без такой подготовки не становится путём к mounted directory при offline export; он будет отвергнут, если не разрешается в допустимый локальный файл.

Предел на колоду: 512 различных ресурсов, глубина 32, до 16 MiB на файл и 64 MiB исходных resource bytes суммарно. Data URL embedding увеличивает размер HTML; это поддержанный переносимый профиль, а не оптимизированный общий asset store. Srcset поддерживает обычные x/w descriptors; сложная неподдержанная запись отвергается. External SVG с `<text>` в strict требует превращения текста в paths или явного разрешения подмены шрифтов: родительская CDP-инспекция не доказывает шрифты внутри SVG image.

Resource ledger перечисляет исходные URL, `embedded`/`blocked`, MIME, размер и SHA-256 исходных bytes либо код отказа. Для data URLs журнал содержит короткую MIME-метку без полного payload. Неуспешный graph остаётся в диагностическом build manifest. После упаковки браузеру разрешены только about/data resources; неучтённый запрос тоже останавливает строгий экспорт. Формальное доказательство поддержки всех возможных HTML/CSS-конструкций не заявляется.

## Результат, файлы и публикация

Результат расширяет RenderResult C полями:

```ts
type ExportResult = RenderResult & {
  exportVersion: 1;
  request: { requestVersion: 1; deckId: string; slideIds: string[]; /* canonical settings */ };
  outputs: Array<{
    format: 'png' | 'html' | 'pdf'; path: string; file: string;
    buildId: string; mediaType: string; bytes: number; sha256: string;
    slideId?: string; width?: number; height?: number; kind?: 'deck';
    pages?: Array<{width: number; height: number}>; // PDF points
    fonts?: Array<{name: string; embedded: boolean}>;
  }>;
  bundle?: {directory: string; index: string; manifest: string};
};
```

`path` относительно generation files; `file` — абсолютный путь поколения, а не canonical mirror. PNG/HTML слайда используют layout B. Дополнительные файлы лежат в `_deckloom-export/<deckId>/`: `index.html`, `export-manifest.json`, optional `presentation.pdf`. Общий manifest C объявляет их в `outputs` для pinned HTTP-доступа; PDF получает application/pdf. Namespace проверяется на конфликты со всеми report paths проекта.

`outputs` описывает только запрошенные форматы. Pipeline C дополнительно сохраняет HTML, PNG, QA/report и optional spec для проверки даже при PDF-only. Deck index и export manifest готовятся всегда. Manifest `exportManifestVersion:1` содержит build/deck/request, outputs с hashes, fonts и resources; поле `state:complete` означает завершённую подготовку этого набора. Успех его публикации проверяется по outer build manifest C и результату операции. Сбой/отмена после подготовки оставляет диагностический набор, не делает его опубликованным.

После commit `bundle.directory` можно скопировать целиком: это автономный набор HTML/ресурсов и запрошенных PDF/PNG. Index использует относительные iframe URLs с pinned build ID. Открытие через file:// работает после переноса; через review server старый index продолжает читать старое поколение после новой публикации. Для read registry экспортного outputRoot нужна соответствующая конфигурация чтения; исходный project.root автоматически не переключается.

Preflight errors бросают исключение до записей. Execution failures/cancel до commit возвращают status/diagnostics и пустой `outputs`; старое опубликованное поколение сохраняется. Ошибка cleanup после успешного commit может дать failed вместе с уже опубликованными outputs/bundle; фактическую публикацию подтверждает build state. C QA findings тоже могут дать complete build при failed result: проверяйте status. Resource/font/PDF-integrity violations прекращают публикацию. Отмена и writer lock используют C4; устаревшее canonical зеркало не считается результатом экспорта.

## CLI и проверка

```sh
node bin/deckloom.cjs export --config=examples/export.config.cjs --deck=demo --output=output/portable --format=png,pdf,html --scale=2
```

Дополнительно: `--slides=intro,closing`, `--transparent`, `--media=print`, `--background=false`, `--expected-fonts=DejaVu Sans`, `--allow-font-substitution`, `--resources=offline`. Значение с пробелами в shell нужно заключать в кавычки. Неизвестные, повторные, пустые и требующие значения bare flags отвергаются. CLI печатает тот же result JSON, exit 0/1.

`npm test` покрывает selection/scale/alpha/fonts, relocation без source/network, отрицательные resource graphs, cancellation и pinned HTTP generations. `npm run check:export` дополнительно использует pypdf и Poppler либо PyMuPDF: весь кириллический текст, page boxes, реальные font streams и растры всех страниц против PNG, screen/print/background. Тестовый Python 3.12 и зависимости pypdf 6.9.2, PyMuPDF 1.27.2.2, Pillow 12.3.0 нужны только для независимой приёмки, не для runtime npm-пакета. Сравнение растров допускает разницу округления цветового канала до 1 между rasterizers; общий mean RGB difference ограничен 10. Пример включает DejaVuSans и его полную лицензию, также сохраняемую в HTML.
