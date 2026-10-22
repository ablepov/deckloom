# PPTX — ограниченные Grid-карточки E4

Реализовано и принято пользователем в development checkout 21.10.2026 поверх [профиля E3](pptx-e3.md), без нового релиза. Технические проверки выполнены; пользователь подтвердил внешний вид и редактируемость текста/заливки slides 4–5 в Google Презентациях и явно закрыл этот первый случай E4. [Запись задачи, решение приёмки и ограничения](../tasks/e4-scope-2026-10-21.md).

## Authoring contract

Options API/CLI не меняются: strict/reference Arial/windows-installed-v1, Windows, uniform 960×540, общий подготовленный HTML всех форматов. Добавлены только markers `grid` и `card`; отдельный renderer callback или контентная PPTX-схема не вводятся. Пример — [нейтральный adapter](../../examples/pptx-grid.config.cjs).

```html
<main data-deckloom-pptx="slide">
  <div id="cards" data-deckloom-pptx="grid"
       style="position:absolute;display:grid;left:48px;top:150px;width:864px;height:260px;grid-template-columns:repeat(3,1fr);gap:20px">
    <div id="card-one" data-deckloom-pptx="card"
         style="position:relative;display:block;background:#dde8f6">
      <div id="card-one-title" data-deckloom-pptx="text"
           style="position:absolute;left:20px;top:18px;width:220px;height:40px">Карточка</div>
    </div>
  </div>
</main>
```

Фрагмент предполагает базовые E3 стили root/text/font/overflow; сам по себе не является полной fixture.

| Узел | Разрешённая структура и поведение |
| --- | --- |
| Root | E3 MAIN/DIV block/relative у начала canvas; прямые text/rect/image либо grid |
| Grid | DIV, absolute, display:grid, transparent background, ltr; 1–64 card children; только auto row placement, без dense/explicit item placement/reorder |
| Tracks | Вычисленные Chromium columns/rows — 1–64 положительных px tracks на ось. `repeat()`/`fr` допустимы, если resolved tracks соответствуют профилю; named tracks/subgrid/areas не поддержаны |
| Alignment/gaps | Items normal/stretch, content normal/start/stretch; gaps normal либо неотрицательные px. Grid-auto-columns/rows остаются auto |
| Card | DIV, block/relative, без relative shift; непрозрачный solid background; один или больше text/rect/image children с absolute positioning |
| Leaves | Существующий E3 text/runs/solid rect/PNG/SVG профиль; текст и прямоугольники native, изображения picture с сохранением E3 семантики |
| Общие ограничения | Уникальные стабильные ID на всём слайде; finite positive bounds, visible overflow, все descendants внутри контейнера. На grid/card нулевые margins/padding и нет text-decoration. E3 paint/stacking/clipping guards действуют на все узлы |

Grid bounds не могут пересекаться с другими top-level объектами или grid. Карточки не пересекаются друг с другом. Дочерние leaves внутри одной карточки могут перекрываться в DOM order. Эти ограничения сохраняют CSS paint order при преобразовании в плоский список PowerPoint shapes. Непомеченные элементы, прямой текст контейнера и вложенные grid/card внутри карточки отвергаются. Лимиты: 256 native объектов на слайд **включая card backgrounds**, 512 declared nodes, 64 slides и 24 MiB prepared representation. Остальные E3 budgets сохраняются.

Фон card преобразуется в native rect с тем же ID; затем идут leaves в DOM order. Grid не становится shape. Контейнеры не являются PowerPoint groups. Grid/text/rect не растеризуются; SVG остаётся picture с исходным SVG и отдельным PNG compatibility fallback. Flex, таблицы, тени, opacity и остальные случаи матрицы E4 этим расширением не разрешены.

## Отчёт о преобразовании

Существующий `pptx-verification.json` и `manifest.pptx` дополнены `conversion.version:1`. Внутренний `preparedVersion:1` не становится отдельным публичным входом. Для каждого слайда сохраняются:

- `sourceDocument.path/sha256`: build-relative путь и hash точного подготовленного HTML, сохранённого и переданного в screen DOM. Исходный HTML/DOM не переписывается при flattening.
- `containers`: source ID/path, CSS px bounds, transformation, output IDs; grid также содержит resolved tracks и `childContainerIds`.
- `objects`: source ID/path/kind, CSS px bounds, native kind, editable и transformations. `nativeIndex` — **one-based slide shape order**, отдельно от `nativeShapeId` — реального OOXML `cNvPr/@id`.
- `verified:true`: mapping проверен против нормализованного PPTX XML по identity/kind/geometry с допуском <0.01 CSS px. Несовпадение даёт `PPTX_MAPPING_MISMATCH` до публикации. Это не заявление полного OpenXML conformance.
- `rasterizedObjects:[]` для поддержанного профиля. `rasterFallbacks` отдельно перечисляет SVG PNG compatibility fallback; это не растеризация основного текста или Grid.

Неподдерживаемый HTML/CSS даёт `PPTX_UNSUPPORTED_HTML` с source ID и причиной в diagnostics; прежняя published generation сохраняется, частичный PPTX не публикуется. Отдельный успешный conversion report для неуспешного экспорта не обещается. Существующие raw/prepared/verification artifacts и общий C lock/cancel/publication сохраняются.

## Проверенная граница

Тесты подтверждают HTML serialize/restore/recapture, DOM immutability, mapping фактических XML shapes, предел 256/257 native objects, strict negatives, SVG bytes/fallback и атомарный отказ. Это не обратный импорт PPTX в исходный документ. Независимые Python parsers и PowerPoint COM подтвердили 5 слайдов, geometry/lines/runs и native Grid text/fill edits с save/reopen.

COM PNG двух Grid slides просмотрены визуально. Видимое открытие конечного E4 PPTX без repair не наблюдалось: computer-use остановлен Esc до открытия; интерактивная Office UI правка также не заявляется. Пользователь отдельно проверил новый файл в Google Презентациях, подтвердил text/fill editing и явно принял этот шаг выполненным. Это пользовательская приёмка E4 с сохранёнными ограничениями Office evidence; вся матрица E4 этим решением не закрыта.
