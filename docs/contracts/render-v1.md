# V1 renderer, размеры и состояния

Контракт B4 от 20 октября 2026 года. Реализован в рабочей копии, не опубликован в npm. Дополняет [Project/Deck/Slide](project-deck-slide-v1.md), [проекции чтения](read-api-v1.md) и [переход от 0.1](../migrations/project-contract-v1.md). Нейтральный полный пример — examples/render-v1.config.cjs.

## Вызов и идентичность

```js
const { chromium } = require('playwright');
const { createRenderer } = require('deckloom');
const project = require('./render-v1.config.cjs');

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const renderer = createRenderer(project);
    const report = await renderer.renderDeck(browser, 'mixed');
    return report;
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
```

renderDeck(browser, selection, { outputRoot }) принимает ID либо объект с id. В v1 колода выбирается из канонического реестра: другие поля selection, включая slides и размеры, не подменяют источник. Без selection выбирается первая колода. Неизвестный ID — UNKNOWN_DECK; пустой Project/Deck остаётся валидным черновиком, но render сообщает EMPTY_TARGET/EMPTY_DECK. Discovery никогда не получает renderer-capability.

Viewer-only конфиг может не иметь renderDocument. Попытка рендера непустой цели даёт MISSING_RENDERER. CLI остаётся deckloom render --config=... --deck=all; run сохраняет прежнюю CLI-семантику вывода и process.exitCode. Новый объектный API/структурированные результаты C2 здесь не вводятся.

Callback v1 получает неизменяемые метаданные Deck/Slide с id, позицией, эффективными размерами и data. Произвольный граф data сохраняет идентичность и изменяемость: движок не сериализует и не замораживает его. Adapter использует slide.width/height для своего HTML; движок не переписывает авторский CSS, чтобы скрыть неверный размер содержания.

## Единые размеры

Каждая ось Deck независимо получает default 1920 или 1080. Каждая отсутствующая ось Slide наследуется от Deck. Нормализатор вычисляет размер один раз для snapshot операции; renderer, read DTO и frame viewer используют эти значения. Viewport PNG имеет deviceScaleFactor 1, поэтому размер изображения в пикселях совпадает с размером CSS canvas. Скрытые в focus-mode карточки не измеряются через offsetWidth как активные: проверка всех canvas выполняется в overview, активных — в focus.

Логический контракт допускает положительные safe integer CSS px. Текущий PNG renderer дополнительно имеет operating budget: сторона до 16 384 px и площадь до 64 × 1024 × 1024 пикселей. Это профиль движка, не универсальный предел Chromium и не ограничение сохраняемой схемы. Неподдержанная выбранная цель даёт UNSUPPORTED_CANVAS с полем и контекстом до запуска CLI Chromium и первой записи. Неподдержанные логические размеры не масштабируются молча.

## Пути и hooks

Stable/legacy пути, root и outputRoot следуют B1. Выбранная операция проходит строгий physical preflight до записи, включая имена отчётов, alias, существующие типы путей и выходы через links. --deck=all выполняет один подготовленный план. Перестановка меняет index/number, сохраняя ID и пути; мутация исходного массива callback-ом не меняет текущую операцию.

В отдельный outputRoot renderer передаёт baseUrl исходного каталога слайда как file URL. Адаптер может использовать его в base/src для сохранения ресурсов при PNG-рендере; движок не копирует ресурсы автоматически. Полный HTML/CSS/resource profile и переносимость последующего HTTP-показа/export остаются C1/D4.

renderDocument, validateDocument, renderSpec и renderQa ожидаются через await, как предусмотрено их прежними ролями. reportName и issueCount остаются синхронными. Legacy callbacks продолжают получать исходные Deck/Slide/context через bridge; v1 callbacks получают нормализованные метаданные. У v1 report entry slide — постоянный ID, дополнительно есть index/number/width/height; прежний entry.slide для unversioned остаётся no.

Default v1 QA записывает engine metadata и диагностику, исключая data из Deck/Slide. Циклический граф данных адаптера поэтому не ломает default QA. Пользовательский renderQa сам задаёт содержание своего отчёта. Общая переработка исполнения hooks относится к C3.

## Состояния файлов

Чтение проверяет root и структуру конфигурации, но не превращает отдельный повреждённый leaf в ошибку всего Project. Все registered-слайды остаются в ответе. HTML/PNG проверяются независимо, без пригодного URL у missing/unreadable.

| Условие | Состояние / категория |
| --- | --- |
| Файл отсутствует | missing |
| Файл читается | available + url/version |
| На месте файла каталог | unreadable / NOT_FILE |
| Каталог слайда занят файлом | unreadable / NOT_DIRECTORY |
| Нет доступа к файлу | unreadable / ACCESS_DENIED |
| Обнаружен выход через link | unreadable / PATH_ESCAPE |
| Dangling/loop link | unreadable / BROKEN_LINK |
| Иной локальный I/O сбой | unreadable / IO_ERROR |

Missing root до первого registered-рендера допустим; нечитаемый или неверный source root остаётся диагностикой Project, а не фиктивным набором missing-слайдов. Discovery требует существующий root. В discovery сохраняются исключение directory links и прежнее ранжирование изображений. Unversioned registered сохраняет ранжирование, дополнительно диагностируя неисправный ожидаемый generated-html.png при отсутствии другого кандидата.

В старой плоской проекции сохранены id/no/file/URL и остальные прежние поля. При unreadable добавляются только необязательные htmlError/imageError с категорией; в штатном available/missing случае новых полей нет. Это позволяет viewer отличить ошибку HTML от его отсутствия, сохраняя совместимость прежних читателей.

## Поведение viewer

| HTML | PNG | Результат |
| --- | --- | --- |
| available | Любое | HTML preview |
| missing | available | Image preview |
| missing | missing | Placeholder, слайд остаётся в навигации |
| unreadable | Любое | Видимая ошибка HTML, без скрытой подмены |
| missing | unreadable | Видимая ошибка preview |

HTTP/network ошибка или пустой HTML дают видимое сообщение загрузки; ошибочный decode PNG также показан в карточке. API при этом по-прежнему описывает доступность файла: readable, но некорректный PNG имеет available и ошибку decode в viewer. Это не две противоречащие оценки готовности.

После успешного polling API viewer повторяет неудавшийся preview не чаще одного запроса за poll, не создавая повторов для pending HTML/image. Ошибка остаётся до успешной загрузки. Восстановление без изменения stat/version и восстановление после замены файла проверяются отдельно. Для PNG retry добавляется query previewRetry; он не меняет идентичность Slide/artifact. Успешные preview не перезагружаются на каждом poll.

Available не означает успешный QA, актуальность данных или общую ревизию HTML/PNG. Неудачный последующий рендер может оставить прошлый читаемый артефакт. Транзакция всей сборки, manifest и freshness — C4; B4 не удаляет файлы и не выдаёт file availability за подтверждение готовности.

## Дополнение C

Исторические границы B4 выше сохранены. В текущей рабочей копии [C1](static-html-v1.md) определяет full document preview и ресурсный профиль, [C2–C3](programmatic-render-v1.md) добавляют объектный API, hooks/timeouts/diagnostics, [C4](build-publication-v1.md) связывает generated artifacts в поколения. Canonical файлы остаются зеркалом; согласованное чтение использует manifest/build URL. Переход описан в [миграции C](../migrations/runtime-c.md).
