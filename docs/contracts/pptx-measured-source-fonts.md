# Измеренный semantic PPTX и исходные шрифты — development profile

Статус: внутренний экспериментальный профиль checkout, используется Monq Retail adapter. Не опубликован и не подключён к публичным `renderer.export()`/CLI; прежний ограниченный E3/E4 профиль и его строгий package validator сохраняются. Источник требований и конкретная проверка — [задача Retail](../tasks/monq-retail-pptx-2026-10-21.md).

## Общий механизм

`src/pptx-semantic.cjs` принимает HTML, viewport и декларативные роли потребителя: root, logical text, native groups, independent image components, local atomic scenes. Названия бренда и CSS-селекторы потребителя остаются в adapter. Фон всего слайда с наложенным текстом не является допустимым atomic fallback.

Логический текстовый блок становится одним native text body со styled runs и авторскими переносами. Пробелы схлопываются между inline-runs; автоматический перенос браузера не удаляет пробел и не становится авторским разрывом строки. `normal`/`nowrap`/`pre-line`/`pre`/`pre-wrap` поддержаны в ограниченной модели; preserved tabs, неизвестный whitespace и неоднородные inline size/family/italic отклоняются. Скрытые inline nodes не экспортируются. Необъявленные эффекты/трансформации/непокрытый текст вызывают отказ.

Геометрия разделена: текущая tight DOM рамка, доступная CSS flow width, рамка компонента и native selection frame. Для auto-width в поддержанной column/row flow учитывается свободная ширина родителей, а не только текущая длина текста. `nowrap` сохраняется; бейджи могут использовать центрированный абзац в полной рамке компонента.

`src/pptx-fonts.cjs` принимает pinned static TrueType faces, проверяет SFNT, имя, реальные weight/style/RIBBI slots, SHA и права редактируемого embedding. Variable font предварительно инстанцируется по явно заданным осям с сохранением оригинальных naming metadata; механизм не придумывает семейство и не округляет 600 к 700. Font outlines/advances не переписываются. EOT содержит полные исходные static TTF bytes. Нет коэффициентов для конкретного шрифта, shrink-to-fit или компенсации межбуквенного интервала. Case-insensitive CSS alias применяется и при binding, и при embedding.

`installationConflicts()` сравнивает исходные faces с переданным inventory зарегистрированных faces по actual typeface/weight/italic и SHA. Это диагностика отличающихся данных, не доказательство несовместимых метрик и не автоматическая установка шрифтов. Windows inventory — отдельный read-only экспериментальный adapter; неполный inventory и variable/system faces нельзя объявлять полностью проверенными по этому сравнению. Установка/удаление шрифтов требует отдельного пользовательского разрешения.

`src/pptx-measured.cjs` строит PPTX с 96 CSS px/in, исходным кеглем и spacing, native fills/groups/text и отдельными pictures. Прежний normalizer/strict inspector применяется до добавления fonts; расширение не ослабляет старый E3/E4 контракт. Отдельные исходные logos и screenshots могут захватываться как одно изображение с локальным CSS paint/shadow. Сложная схема включает внутренние надписи и прекращает capture потомков.

## Native reference и проверки

Вертикальная поправка определяется измерением реального Office PDF glyph origin для каждого source face SHA + size + line-height. Profile хранит источник, Office version, SHA reference PDF и style IDs; нет предположения, что baseline равен 3/4 line-height. Неоднородные вертикальные метрики runs без специальной reference отклоняются. Совпадение baseline не означает совпадение horizontal shaping.

При техническом проходе Office измеряет native text bounds. `containTextFrames()` допускает расширение selection frame вправо с равным right inset и вниз: исходная flow width, кегль, baseline и координаты текста не меняются. Перед этим проверяются source line count и отсутствие отрицательного overflow; переполнение центрированного компонента вызывает отказ. Это исправление геометрии выделения, не способ скрыть отличие шрифта.

Обязательная проверка кандидата: точный текст/авторские разрывы, исходный кегль/spacing, font identities и встроенные bytes, media hashes/crops/alpha, порядок/группы, source line counts и containment, actual Office PDF fonts/baselines, edit/save/reopen текста/fill/group/picture, просмотр свежего render. Неподдержанные эффекты остаются явными отказами или заранее объявленными локальными image fallbacks.

Встраивание правильного TTF и исправление локальной коллизии версии не доказывают одинаковый GPOS/kerning в Chromium, Office и Google. Межпрограммная точность shaping и пользовательская Google приёмка фиксируются отдельно. Технический COM проход не считается наблюдением интерактивной UI-приёмки или отсутствия repair dialog.
