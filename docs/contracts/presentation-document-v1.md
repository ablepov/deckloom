# Документ презентации F1 — v1

Документ представляет **одну колоду** и сохраняемые JSON-данные, независимо от исполняемого `Project` config. `documentVersion:1` не равен runtime `contractVersion:1`. Существующие конфиги, callbacks, renderer и exports не переводятся автоматически в эту схему. [Решения и проверки F1](../tasks/f1-document-2026-10-21.md).

## Данные и идентичность

| Поле | Правило |
| --- | --- |
| `documentVersion` | Обязательно, число `1`; другая/отсутствующая версия даёт `UNSUPPORTED_DOCUMENT_VERSION`, без угадывания миграции |
| `projectId`, `id` | Обязательные ID проекта и колоды. Идентичность документа — `(projectId,id)`, слайда — `(projectId,id,slide.id)` |
| `name` | Необязательное непустое отображаемое имя; переименование не меняет ID |
| `width`, `height` | Обязательные положительные safe integers, CSS px. Это размер колоды, не ограничение конкретного export profile |
| `slides` | Обязательный массив в авторском порядке; `[]` — допустимый draft. Порядок не вычисляется по ID или шаблону |
| `compositions` | Необязательный массив локальных определений `{id,revision,definition}`. `definition` — opaque JSON record; F1 не валидирует поля/блоки и не обещает его рендер |

Слайд: `{id,name?,width?,height?,content}`. Неуказанные name/dimensions сохраняются неуказанными: нормализация не записывает наследованные размеры в слайд. `index`/`number` и runtime paths/callbacks не сохраняются. Все поля схемы закрыты; содержание адаптера размещается в `content.data`, определения — в `definition`.

ID — 1–128 ASCII letters/digits/underscore/hyphen. Spelling сохраняется. Slide ID уникальны внутри одной колоды ASCII case-insensitive; одинаковый slide ID в другом документе допустим. Ссылки разрешаются **точно по spelling**. Ограничение длины 128 — правило F1, более узкое, чем grammar-only IDs B; будущий импорт не должен молча переименовывать/обрезать конфиг.

### Варианты содержания

| `content.kind` | Поля и семантика |
| --- | --- |
| `template` | `{kind:'template',ref:{libraryId,templateId,revision,integrity?},data}`. ID/revision сохраняются; F2 разрешает library и проверяет SHA-256 integrity pin |
| `local` | `{kind:'local',ref:{compositionId,revision,integrity?},data}`. Ссылка обязана точно разрешиться в `compositions`; неизвестный ID/revision — `UNKNOWN_DOCUMENT_COMPOSITION`. F2 проверяет integrity pin |
| `authored` | `{kind:'authored',data}`. Содержание встроено в JSON, `ref` запрещён. Блоковая схема и capabilities относятся к F3 |

`data`/`definition` — обязательные JSON records. `revision` — непустая opaque строка без NUL длиной до 128 символов; semver не интерпретируется. Разные ревизии одного local composition допускаются с единым canonical spelling ID; пара `(id,revision)` уникальна. Нет разрешения «latest», подбора ревизии, обновления библиотеки или замены данных при загрузке. Даже внешняя revision трактуется как буквальная строка; её существование F1 не доказывает.

## API

Оба существующих входа `require('deckloom')` и `require('deckloom/node')` дополнены одним namespace `presentation`:

```js
const { presentation } = require('deckloom');
const document = require('./examples/presentation-document.cjs');
const json = presentation.serialize(document);
const restored = presentation.deserialize(json);
const renamed = presentation.renameSlide(restored, 'cover', 'Новое имя');
const copied = presentation.duplicateSlide(renamed, 'cards', 'cards-copy');
```

Пример `require` относится к [локальной нейтральной fixture](../../examples/presentation-document.cjs), не к обещанному package subpath. F1 не добавляет CLI, автоматическую запись файла, загрузчик runtime config или преобразование документа в renderer.

- `normalize(input)` валидирует и возвращает независимые JSON-данные без изменения input; выполняет структурную проверку, а не материализацию контента или библиотек.
- `serialize(input)` возвращает compact JSON string без BOM/добавочного newline; тот же validator, порядок массивов и значения сохранены.
- `deserialize(json)` принимает JSON string с необязательным начальным BOM, проверяет byte budget до `JSON.parse`, затем тот же validator. Ошибка синтаксиса/типа входа — `INVALID_DOCUMENT_JSON`.
- `renameSlide(document,slideId,name)` возвращает новый документ; меняется только отображаемое имя целевого слайда, ID/order/content refs сохраняются.
- `duplicateSlide(document,slideId,newId)` требует новый уникальный ID от caller и вставляет копию сразу после исходного слайда. Data копии независимы, pinned refs сохраняются, общие composition definitions не размножаются. Идентичность вложенных авторских блоков и переписывание внутренних ссылок **не** определяются F1: это будущий контракт F3/F4.
- `limits` — read-only значения budget. Namespace также read-only; документы остаются обычными изменяемыми JSON-данными, их повторная сериализация снова валидируется.

Lookup слайда точный; неизвестный ID — `DOCUMENT_SLIDE_NOT_FOUND`. Duplicate collision — `DUPLICATE_DOCUMENT_ID`. Unknown fields, content/ref/type/ID ошибки содержат стабильный `code` и `field` в Error; error message не является отдельной схемой. Все helpers неизменяющие input, при отказе новый результат не возвращается.

## JSON-семантика и budgets

Разрешены null, boolean, string, finite JS number кроме negative zero, dense arrays и plain records с enumerable own data properties. Undefined, callback/function, symbol, bigint, Date/custom prototypes, sparse/дополненные arrays, cycles, accessors и non-enumerable own properties отвергаются как `DOCUMENT_NON_JSON_VALUE`; getters/toJSON callbacks на данных не вызываются. Собственные ключи `__proto__`/`constructor` безопасно сохраняются как JSON-данные. Общие поддеревья сохраняют значения, не object identity.

Round trip означает сохранность валидированных JavaScript JSON **значений**, ID/order/refs и отсутствующих optional fields. Исходный JSON текст/whitespace не сохраняется. Используется стандартная семантика `JSON.parse`: duplicate property names выбирают последнее значение, числовые литералы имеют JS number precision; arbitrary-precision JSON parser не вводится.

Лимиты: 8 MiB JSON, глубина 64 (root depth 0), 100000 JSON nodes, 4096 slides и 4096 local composition revisions. Нарушение даёт `DOCUMENT_BUDGET_EXCEEDED`. При десериализации byte bound проверяется до parsing. Для trusted JS input budgets ограничивают принимаемый документ и обход, но не обещают hard peak-memory isolation: сбор descriptors/кодирование строки может требовать временных ресурсов до отказа. Нельзя гарантировать отсутствие side effects у произвольных Proxy traps; входной JS объект не является sandbox для чужого кода.

F1 не делает data безопасной HTML-разметкой и не запускает её. UI, файл/storage/recovery, library resolution/update, capability/block validation и остальные editing operations остаются отдельными этапами.
