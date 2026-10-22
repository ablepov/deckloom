# PPTX export — E3

Это базовый профиль E3. Текущее аддитивное расширение Grid-карточек и conversion report описано отдельно в [контракте E4](pptx-e4-grid.md); остальные границы E3 сохраняются.

Реализован и принят пользователем в development checkout 21.10.2026, без нового релиза. Подключён к `createRenderer(project).export()` и CLI, общей подготовке D и публикации C. **E3 закрыт по явному решению пользователя** после проверки в Google Презентациях. Настоящий PowerPoint 16 проверен через COM; в свежем computer-use runtime подтверждены видимое открытие без repair и просмотр трёх слайдов. Интерактивная правка через PowerPoint UI с save/reopen не наблюдалась: Office не активирован и отключает редактирование. Пользователь принял E3 без ожидания этой проверки; ограничение evidence сохранено. [Запись проверки и решение](../tasks/e3-export-2026-10-21.md).

```js
const result = await createRenderer(project).export({
  deckId: 'main', outputRoot: '/separate/export',
  formats: ['pptx', 'png', 'pdf', 'html'],
  fonts: { policy: 'allow-substitution' },
  pptx: {
    mode: 'strict',
    fonts: { mode: 'reference', family: 'Arial', profile: 'windows-installed-v1' },
  },
});
if (result.status !== 'succeeded') throw new Error(JSON.stringify(result.diagnostics));
const file = result.outputs.find(output => output.format === 'pptx').file;
```

## Границы первого профиля

| Область | Поддержано / отказ |
| --- | --- |
| Платформа | Windows с установленным Arial regular/bold/italic, проверенным через System.Drawing InstalledFontCollection. Другие ОС дают `PPTX_PLATFORM_UNSUPPORTED`; это граница профиля, не ограничения остальных форматов |
| Шрифты | Только reference Arial, без embedding. Каждый фактически нарисованный Chromium glyph должен принадлежать системному Arial; custom font или fallback другого семейства даёт отказ. Получателю нужен тот же Arial |
| Canvas | Все выбранные слайды 960×540 CSS px; PPTX 720×405 pt. До 64 слайдов, 256 объектов на слайде, 100000 символов на текстовый объект; подготовленное представление до 24 MiB |
| Текст | Native text в прозрачных прямоугольных shapes: left, pre-wrap, одинаковый размер/line-height внутри объекта; regular, bold **или** italic, underline текущим цветом. Совместное bold+italic пока не принято. Обычный текст и одиночные LF; пустые абзацы, CR, tabs, leading/trailing LF отвергаются |
| Фигуры | Native пустые solid rectangles; текст — отдельный объект. Цвета непрозрачные, DOM order задаёт z-order |
| PNG | Picture, 8-bit noninterlaced grayscale/RGB/gray-alpha/RGBA. Без crop/padding; до 16 MiB ресурса и 16 Mi пикселей при проверке PNG |
| SVG | Picture с сохранёнными SVG bytes и настоящим PNG fallback из того же подготовленного SVG. Только статические svg/g/path/rect/circle/ellipse/line/polyline/polygon и ограниченные геометрические/presentation attributes; без text/style/defs/references/filters. Это ресурс, не набор native PowerPoint shapes |
| Остальное | Hybrid, embedding, таблицы, charts, connectors, группы блоков, тени, gradients, opacity, clipping, transforms, rotations, Grid/Flex, portrait/mixed canvas и редактор блоков не входят в E3 |

`fonts.policy:'strict'` сохраняет значение D: только file-backed web fonts. Для reference PPTX нужно явно выбрать `allow-substitution`; дополнительная PPTX-проверка всё равно запрещает подмену Arial другим семейством. Здесь нет отдельного PPTX mapping или второго текста. Если adapter сам разрешает исходный font mapping, он делает это до общей подготовки всех форматов.

## Источник и разметка

`renderDocument` вызывается один раз на выбранный слайд. Реестр определяет IDs, выборку и порядок. Resource bundler D готовит автономный HTML. После readiness/QA и фактического font inventory из **этого же screen DOM** снимается внутреннее `preparedVersion:1`: координаты, текст/runs, цвета и уже включённые ресурсы. Это происходит перед PDF media overrides. `pdf.media:'print'` сохраняет отдельную явную семантику D. Второй callback, независимая PPTX-схема контента и публичный метод записи prepared JSON не добавлены.

Минимальная authoring-разметка:

```html
<main class="slide" data-deckloom-pptx="slide">
  <div id="heading" data-deckloom-pptx="text">Заголовок <span>и текст</span></div>
  <div id="panel" data-deckloom-pptx="rect"></div>
  <img id="photo" data-deckloom-pptx="image" src="asset.png" alt="Описание">
</main>
```

Корень — единственный прямой child body, MAIN/DIV, block/relative, у начала canvas, с solid background. Все объекты — прямые children с уникальными обычными `id` (`^[a-z][a-z0-9-]{0,63}$`), absolute positioning, finite positive geometry внутри canvas. Текст — DIV/block с нулевыми margin/padding; внутри только text/SPAN/BR, span static/inline/baseline. Изображения — IMG/object-fit:fill без padding. Весь видимый контент должен принадлежать этим объектам. Необъявленный объект и содержимое вне root дают отказ.

Авторские CSS declarations проверяются по закрытому списку геометрии, solid backgrounds и простого текста; CSSOM shorthand resets учитываются отдельно. Неизвестное свойство и pseudo-element rule отвергаются даже в неактивной ветви. Computed checks дополнительно запрещают неподдерживаемые значения: outlines, stroke/fill overrides, offsets spans, spacing/indent, clipping, фон вне canvas, background-clip с иной областью paint, stacking/opacity/transforms и т. п. Это узкий authoring-профиль, а не преобразование произвольной HTML-страницы. Полный пример: [нейтральный adapter](../../examples/pptx.config.cjs).

## Backend, нормализация и артефакты

Поставляется bundle PptxGenJS 4.0.1, JSZip 3.10.1 и @xmldom/xmldom 0.9.12; Node >=22. Python и Microsoft Office не нужны runtime. Lock/build recipe находятся в `tools/pptx-backend`, npm archive содержит bundle, inventory и полный THIRD_PARTY_NOTICES. Build recipe воспроизводится проверкой; исходное дерево аудируется отдельно, consumer не требует overrides или зависимости на уязвимый неиспользуемый image-size.

После ZIP CRC/budget/path/duplicate checks и XML/relationships/types проверки допускаются только три известных исправления pinned backend:

1. Удаление ожидаемых orphan slideMaster2…N Content_Types overrides с точным MIME, без реальных ссылок на missing part.
2. Замена SVG bytes в ошибочном PNG fallback на raster именно этого подготовленного SVG, с сохранением SVG part и relationship.
3. Удаление одинаковых по serialized XML повторов `a:pPr` перед rich runs в native slide text body. Первый pPr обязан быть первым элементом; различающиеся свойства, неверная позиция и иные структуры отвергаются. Записываются part/shape/paragraph, количество удалённых повторов и hashes до/после.

Третий дефект найден в E3: предыдущая E2-проверка не проверяла cardinality paragraph properties. Это явное уточнение [решения E2](../decisions/pptx-backend-e2.md), не универсальный repair. Normalizer проверяется на идемпотентность и отрицательные случаи. PNG проверяется по CRC, bounded zlib decode, длине строк/filters; независимая приёмка использует Pillow. Проверки являются целевыми, не полной OpenXML/PNG conformance или sanitizer недоверенного архива.

В `_deckloom-export/<deckId>/` публикуются `presentation.pptx`, диагностический `backend-raw.pptx`, `prepared-pptx.json`, `pptx-verification.json`. Raw не предназначен для выдачи пользователю. Manifest содержит font profile, inventory screen fonts, исправления/hashes, native object metadata и ссылки на evidence. `result.outputs` возвращает только конечный запрошенный PPTX с MIME, bytes/hash и `file`; auxiliary artifacts остаются в build bundle. `editable:true` означает native text/rect; изображения можно перемещать, но их внутреннее содержимое не объявлено редактируемыми shapes.

Общий C lock, cancellation, timeout и commit действуют для всего экспорта. Ошибка до commit не публикует частичную PPTX-колоду и сохраняет прежнюю published generation. Build-pinned HTTP URL сохраняет прежние bytes после нового экспорта; MIME — `application/vnd.openxmlformats-officedocument.presentationml.presentation`. Canonical files остаются compatibility mirrors C.

## Проверка

`npm test` включает option/platform/canvas, DOM negative cases, native objects/runs/selection/order, normalizer positives/negatives/idempotence, cancel/failure/previous publication и pinned MIME. `npm run check:pptx` экспортирует три нейтральных слайда и независимо проверяет пакет/текст/геометрию/PNG/SVG/PDF через Python; на Linux проверяет явный platform refusal. `node scripts/check-pptx.cjs --office` дополнительно запускает PowerPoint COM render/edit/save/reopen. CI не выдаёт эту команду за видимую Office-приёмку.

Видимое открытие конечного PPTX без repair и все три слайда проверены через `@oai/sky`; evidence находится в `output/validation/e3/ui/`. Изображения PowerPoint COM и COM edit/save/reopen остаются отдельной технической проверкой. Пользователь проверил файл в Google Презентациях и явно закрыл E3. Ненаблюдённая интерактивная PowerPoint UI правка text/rectangle с save/reopen остаётся ограничением проверки, но больше не блокирует закрытие E3 по решению пользователя. Критерии приёмки новых возможностей согласуются отдельно.
