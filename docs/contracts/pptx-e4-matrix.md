# Ограниченная матрица E4

Расширяет [Grid](pptx-e4-grid.md), общий D/C экспорт и conversion report. Авторский HTML не меняется; source hash связывает его с native объектами. Проверка: `node scripts/check-e4.cjs --office`; независимые parsers: `python scripts/check-engine-output.py <result.json> --office`.

| Случай | Принимаемый профиль | Результат / граница |
| --- | --- | --- |
| Flex | Прозрачный row/column flex, nowrap/wrap, прямой порядок; relative cards без overlap/margin/padding/shift | Measured layout → native card rect/text/images; `flatten-flex`. Reverse/order/неподдержанный alignment дают отказ |
| Таблица | Fixed/collapsed table, один tbody, 1..32 × 1..16 cells, без merges/borders; static rectangular measured grid; plain single-line Arial 400/700, uniform cell padding, fitting numeric line-height | Native `a:tbl`, редактируемые ячейки/заливки. Transformations/spacing, positioned cells и overflow отвергаются |
| Соединитель | Пустой thin div horizontal/vertical, толщина ≤8 CSS px, opaque color | Native `p:cxnSp`, редактируемая линия. Без attachment/стрелок/диагоналей/маршрутизации; `attached:false` |
| Crop | Decoded PNG/SVG img, cover, center `50% 50%`, own border-box clip | Native srcRect, исходный ресурс целиком; crop редактируется. Другие positions/fit/clip дают отказ |
| Opacity | Только text/rect/image leaves; solid RGBA × opacity | Native alpha/transparency; container/inline span opacity отвергается |
| Сложный фон | Root gradient с явным `data-deckloom-pptx-background="raster"`, без background URL | Отдельный PNG; report объявляет `containsText:false`, текст остаётся native |
| Тень/декор | Явный пустой `data-deckloom-pptx="paint"`; gradient/single outer shadow, padding 0..128 достаточен для shadow, whole capture внутри canvas без overlap | Только декор становится PNG; stops/shadow controls не обещаются редактируемыми |
| Темы | Light/dark opaque colors, installed Arial | Native цвета; themes доступны F3/F4 |
| Portrait | Uniform 540×960 отдельно от uniform 960×540 | Один размер на PPTX; mixed orientations отклоняются до подготовки |

JSON composition API поддерживает table rows binding/size/lineHeight/padding, connector fill, image fit fill/cover и leaf opacity 0..1/binding. Они правятся F4, хранятся G1 и экспортируются общим Project bridge. Flex/декоративный CSS остаются в opt-in HTML profile; UI и фирменные visual templates не создавались.

Проверки: browser capture/неизменность DOM, native mapping/геометрия/порядок, negatives, XML/ZIP/Pillow/pypdf, media hashes/crop formula, настоящий PowerPoint COM rendering/native edits/save/reopen. Сравнение screenshots дополняет проверки, не означает pixel identity.

**Приёмка:** 21.10.2026 пользователь проверил новые PPTX в Google Презентациях, сообщил «всё нормально, всё редактируется» и явно закрыл E4. Этап принят в реализованном ограниченном профиле. Интерактивные PowerPoint no-repair/edit/save/reopen по-прежнему не наблюдались; закрытие основано на новом явном решении пользователя и технических проверках, а не на переносе старой приёмки Grid. [Источник и receipt](../tasks/autonomous-engine-2026-10-21.md).
