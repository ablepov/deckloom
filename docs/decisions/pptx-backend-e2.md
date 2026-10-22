# E2 — backend, упаковка, шрифты и границы PPTX

Источник: прямой запрос пользователя 21.10.2026 после [пробы E1](../reviews/pptx-e1-2026-10-21.md). Это решение о следующем экспортном backend, подтверждаемое изолированной пробой. E3, публичный PPTX API, новая схема документа F и обновление Monq не входят в задачу. Синтаксис private harness не становится публичным контрактом.

## Выбранное направление

Уточнение E3 от 21.10.2026: backend подключён к общему экспорту в development checkout; [контракт и текущая приёмка](../contracts/pptx-e3.md). E3 обнаружил третий дефект PptxGenJS 4.0.1: повтор одинакового `a:pPr` перед каждым rich run внутри одного абзаца. Предыдущая E2-проверка не проверяла эту cardinality. E3 явно расширяет узкую нормализацию: только serialized-XML-identical повторы в ожидаемых native text bodies/run boundaries, с проверкой порядка, hashes и отрицательными тестами. Остальные условия и неизвестные повреждения дают отказ. Это не новая поддерживаемая возможность E4 и не общий OpenXML repair. Первоначальные результаты E2 ниже остаются исторической записью; видимое no-repair открытие пока не доказано и в E3.

Выбран **структурированный Node backend PptxGenJS 4.0.1**, поставляемый как закреплённый внутренний CJS bundle, с JSZip 3.10.1 и отдельной узкой нормализацией OPC-пакета. Он получает подготовленные данные/геометрию/ресурсы того же слайда, что и HTML/PNG/PDF; он не строит другую копию текста и порядка. Граница подготовленного представления и публичный способ его получения — работа E3 совместно с минимальной потребностью F3, а не новый callback/schema в E2.

DOM-to-PPTX не выбран основным backend: E1 показал тихую потерю SVG через img и backdrop-filter. Автоматическая конвертация произвольного HTML не становится обещанием Deckloom. Существующие HTML/PNG/PDF и API A–D сохраняются.

Формат загрузки, доказанный E2, — CJS на Node 22. Native ESM entry, browser bundle backend, другие Office/ОС и произвольные композиции не объявляются проверенными. Это выбор backend для E3, ещё не готовый публичный экспортёр.

## Поставка зависимостей

Private build-профиль закрепляет PptxGenJS 4.0.1, JSZip 3.10.1, esbuild 0.28.2; image-size переопределён до 2.0.4 только в build tree. `image-size` объявлен upstream зависимостью, но фактический Node entry PptxGenJS его не использует. Metafile подтверждает, что его кода нет в bundle. В E1 оставался image-size 1.2.1 с audit findings.

Один override в package.json Deckloom недостаточен: npm учитывает overrides корневого проекта установки, а не пакета-зависимости. Поэтому принято решение проверять именно поставляемый bundle, без требования к consumer менять собственный overrides. [Правило npm](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides).

Bundle включает PptxGenJS, JSZip и реально использованные транзитивные компоненты. Все они перечислены с версиями, SPDX, source hashes в inventory; полные notices включены в THIRD_PARTY_NOTICES. Для JSZip выбирается MIT-ветвь dual license; для pako сохраняются MIT и Zlib notices, для inherits — ISC. Неиспользуемые declared зависимости не выдаются за включённый код. Esbuild — build tool, не runtime dependency получателя.

Проверены две сборки при одинаковых исходниках в разных выходных папках: SHA-256 backend совпал. Это локальная воспроизводимость при закреплённом lock/toolchain; межплатформенная двоичная идентичность не доказана. Bundle, metafile, inventory, lock hash и notices составляют единый результат сборки. Разрешённые externals — только Node builtins; неожиданный nonbuiltin external останавливает сборку.

Проверены install реального private tarball во внешний временный consumer без overrides, совпадение installed bundle bytes и генерация/повторное чтение PPTX из установленного entry. Loader пробы запрещает загрузку модулей вне consumer; NODE_PATH/NODE_OPTIONS удалены. Ресурсные файлы явно передаются как входные bytes/пути — это не утверждение, что consumer лишён доступа ко всей файловой системе.

Build tree audit и consumer dependency graph audit не имеют известных findings на момент прогона. Consumer audit сам по себе не анализирует bundled JavaScript: доказательствами состава служат metafile и inventory вместе с отдельным audit build lock. Это не обещание безопасности любых входов и всех будущих версий.

Изменение версии backend, JSZip, bundler, overrides или normalizer требует rebuild, нового inventory/audit, внешней установки и повторения package/font/native/Office проверок. Upstream source не форкается и не правится. Если понадобятся содержательные изменения генератора, решение о fork принимается отдельно; bundle не должен скрывать непроверенные патчи.

## Нормализация пакета

До приёмки сохраняется сырой файл и его hash. Разрешены только две распознанные коррекции в заявленном профиле 4.0.1:

1. Удаление orphan Content_Types overrides для отсутствующих slideMaster2…N, соответствующих известному дефекту и составу колоды. Реальная relationship на отсутствующий master — ошибка, а не повод «почистить» её.
2. Замена ошибочных SVG-байтов в PNG fallback конкретной picture на фактический PNG того же SVG. Source hash должен совпасть с подготовленным SVG; SVG part, его bytes/reference и геометрия picture сохраняются. Растер берётся из закреплённого Chromium с известными canvas/scale. Коррекция записывает старый/new hash, parts и размеры.

В E1 обнаружен второй дефект: `image-3-2.png` действительно содержал SVG bytes. Одного успешного открытия современным PowerPoint недостаточно для корректной упаковки.

После нормализации проверяются ZIP, XML, internal relationships, дубли part/relationship IDs/content types, обязательные presentation/slide types, отсутствие неизвестных orphan Content_Types overrides и missing relationship targets, PNG signature/декодирование и SVG part/reference. Нормализация идемпотентна. Это не проверка достижимости всех существующих parts от корневых relationships. Неизвестное повреждение в проверяемом профиле, внешний relationship, unrecognized fallback, неполный ресурс или неоднозначная связь ведут к отказу; общее «repair всего PPTX» не поддерживается. Текст/слои/переносы дополнительно проверяются семантической и Office-приёмкой, а не ZIP-проверкой.

Изолированный normalizer является проверкой узкой гипотезы, не полноценным OpenXML validator или sanitizer недоверенного архива. Для E3 нужны bounded input/output, общий ресурсный профиль D, безопасная публикация C и перенос нормализации с теми же отрицательными тестами в выбранную production-среду. Python здесь используется как независимый proof/parser и не становится требованием npm runtime по этому решению.

## Политика шрифтов

Первый поддерживаемый режим — **явная ссылка на установленный шрифт**, без embedding и без обещания автономности оформления. Режим reference выбирается явно. Записываются resolved family/styles, проверенная среда, требование наличия шрифта у получателя и факт `embedded:false`. Наличие шрифта на компьютере автора не доказывает его наличие у получателя.

Проверка до генерации должна подтвердить наличие семейства и нужных styles в объявленном target profile и отсутствие непредусмотренного fallback в подготовленном HTML. Само `Font.Name` в PPTX/COM — декларация, не универсальный детектор фактической подстановки PowerPoint. E2 проверяет реальную Windows inventory, Chromium glyph-font inventory и результат PNG/редактирования в имеющемся PowerPoint. Для других target environments нужен собственный проверенный font profile; при неизвестном resolution — отказ.

Загруженный browser webfont не считается установленным Office-шрифтом. E2 воспроизводит границу: DejaVu Sans используется Chromium как custom font, отсутствует в Windows inventory и отвергается для reference PPTX. `document.fonts.check()` не является достаточным доказательством отсутствия fallback.

Подмена возможна только по явной mapping original→replacement. Сначала разрешается общий шрифт, затем заново готовятся HTML/PNG/PDF/PPTX и проверки геометрии/переносов. Подмена только в PPTX, автоматическое сжатие текста или растрирование основного текста запрещены. В E2 missing synthetic family явно отображается в Arial; общие reference и native PPTX используют этот же resolved Arial, а mapping записан в отчёте. Стили regular/bold/italic проверены; underline — оформление текста, а не отдельный font face.

Отсутствие выбранной policy, семейства, style, требование `embed` или полностью переносимых fonts дают диагностический отказ. Strict означает выполнение заявленного reference-контракта, а не скрытое обещание font portability. Самодостаточные media и font portability различаются.

Embedding helper в E2 не принят. PowerPoint использует font data parts с EOT/MicroType payload; простое добавление TTF или Word obfuscation не является доказанным embedding. [Microsoft Font Part](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/ea097c57-5794-4624-b08e-017b47051b1d).

Локальный DejaVuSans — кандидат отдельной будущей пробы: OS/2 version 1, fsType 0, retained license notice. Это метаданные, не доказательство технического встраивания или разрешение игнорировать условия лицензии. [OS/2 fsType](https://learn.microsoft.com/en-us/typography/opentype/spec/os2), [локальная лицензия](../../examples/export-assets/DejaVu-LICENSE.txt). Перед поддержкой embedding требуются права на передачу/редактирование, соответствующий формат font part и все используемые styles, проверка на машине без установленного шрифта, новый ранее отсутствовавший символ, смена стиля, save/reopen без подмены. До прохождения этой приёмки embedding и обещание portable fonts остаются unsupported.

## Начальное подмножество и строгий отказ

| Содержимое | Решение для первого E3 |
| --- | --- |
| Unicode text и простые rich runs | Native text boxes; regular/bold/italic/underline, явный размер, цвет, line spacing и проверенные переносы. Основной текст не растрируется |
| Прямоугольники с solid fill | Native shapes, явная геометрия и z-order, отдельный редактируемый текст |
| PNG | Picture с ресурсом и явной геометрией; не native editable pixels |
| Static SVG | SVG graphic/resource с корректным PNG fallback; не набор native editable shapes, convert/ungroup не обещан |
| Canvas | Единый размер колоды. Начальный proof допускает только 960×540 / 720×405 pt. Смешанные размеры отвергаются; portrait/другие layout требуют отдельного расширения приёмки |
| Сложное оформление/структуры | Tables, charts, connectors, Grid/Flex как семантический объект, crop/mask/rotation, shadow/filter/blur, gradients, animation и SVG text требуют отдельной capability-пробы; не конвертируются молча |

Начальный текстовый proof покрывает обычные и одиночные явные LF. Начальные/конечные пустые paragraphs, последовательные пустые строки и CR/CRLF пока отвергаются; их корректная нормализация/сериализация и проверка — явная задача E3, до обещания поддержки таких случаев. Одновременные text+runs отвергаются как неоднозначный источник. Это ограничение первого подтверждённого профиля, а не постоянное ограничение документа F. Неизвестные поля/возможности, недоказанное font resolution и потеря native основного текста — ошибка до публикации.

**Strict — начальный режим. Hybrid не объявляется реализованным.** В E3 неподдержанная возможность не должна приводить к тихому best-effort. Будущий hybrid требует explicit opt-in и пообъектный отчёт: source ID, reason, область композиции, actual output, editable/noneditable и затронутые слои. Разрешение растрировать один декор не разрешает растрировать слайд/основной текст. Backdrop-filter зависит от фона; автономный PNG только панели некорректен. Пока атомарная область и зависимости не определены и не проверены, даже hybrid должен отказать. Runtime/fallback implementation в E2 отсутствует.

## Проверенное решение и следующий этап

Evidence и независимое ревью фиксируются в [записи E2](../tasks/e2-backend-2026-10-21.md). Выбор backend закрепляется для ограниченного E3; исправность поставки и font policy не доказывают готовность публичного API. E3 отдельно подключит этот путь к D/C publication и проверит отсутствие repair в заявленном пользовательском сценарии, native editability, ошибки/отмену/артефакты и совместимость текущих потребителей. До авторизации E3 `formats:['pptx']` в движке не появляется.
