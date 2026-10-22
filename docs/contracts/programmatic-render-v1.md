# Программный render API и hooks C2–C3

Реализовано в рабочей копии; exports `deckloom` / `deckloom/node` сохранены. `createRenderer(project).render(options)` не читает argv, не выводит сообщения и не меняет process.exitCode. CLI переводит результат в JSON и exit code 0/1.

```js
const { createRenderer } = require('deckloom/node');
const controller = new AbortController();
const result = await createRenderer(project).render({
  deckId: 'demo',                 // exact ID; omit to render all decks
  outputRoot: '/absolute/path',  // optional; relative resolved from cwd
  signal: controller.signal,
  onProgress(event) { console.log(event.type); },
  warnings: 'fail',              // default; or 'report'
});
if (result.status !== 'succeeded') console.error(result.diagnostics);
```

## Типы и результат

Ниже структурные типы контракта, без зависимости от TypeScript runtime.

```ts
type Diagnostic = {
  severity: 'error' | 'warning'; code: string; message: string;
  stage?: string; deckId?: string; slideId?: string;
};
type Progress = {
  type: 'deck-start' | 'slide-start' | 'slide-complete' | 'deck-ready';
  deckId: string; buildId?: string; slideId?: string;
  index?: number; total?: number;
};
type RenderOptions = {
  deckId?: string; outputRoot?: string; browser?: PlaywrightBrowser;
  signal?: AbortSignal; onProgress?: (event: Readonly<Progress>) => unknown | Promise<unknown>;
  hookTimeoutMs?: number; pageTimeoutMs?: number; warnings?: 'fail' | 'report';
};
type RenderResult = {
  resultVersion: 1; status: 'succeeded' | 'failed' | 'cancelled'; outputRoot: string;
  reports: Record<string, SlideReport[]>;
  builds: Array<{deckId: string; buildId: string; state: 'building' | 'complete' | 'failed' | 'cancelled'; manifest: string}>;
  diagnostics: Diagnostic[]; failures: Diagnostic[]; error?: Diagnostic;
};
```

SlideReport сохраняет B4: deck, slide (v1 ID / legacy no), name, html/png/qa/spec, layoutQa, layoutIssues, overflowIssues, missingAssets и consoleMessages. V1 также имеет index/number/width/height, legacy — sourceNode. C добавляет buildId, diagnostics и artifacts с абсолютными путями фактического поколения. Старые html/png/qa/spec — совместимые canonical пути; при неудачной попытке они могут относиться к прошлому зеркалу. Для чтения результата конкретной попытки используются artifacts или manifest, для HTTP — URL scanner API с build ID.

Ошибки конфигурации, выбора цели и options отвергают Promise до записей и запуска owned browser (коды B1/B4 либо INVALID_OPTIONS). Нормальные ошибки исполнения возвращают status/error/diagnostics, включая HOOK_FAILED, INVALID_HOOK_RESULT, TIMEOUT, CANCELLED, BUILD_BUSY, UNSUPPORTED_HTML и I/O codes. Любой thrown value нормализуется. Сбой сохранения failed manifest добавляет диагностику `stage: save-failed-manifest`; гарантировать запись при недоступном FS невозможно.

Reports содержат только завершённые слайды, даже если колода не опубликована. Ошибка прерывает текущую и последующие колоды; ранее опубликованные колоды остаются результатом операции. Все build IDs и частичные artifacts доступны в manifests. Complete означает исполнение всех стадий, а не отсутствие QA findings. Сборка с resource/layout errors может быть complete и опубликована, а result.status — failed. `warnings: report` допускает только warnings; errors всегда дают failed. По умолчанию warnings тоже дают failed. `failures` — диагностики, влияющие на этот статус.

## Ожидания, progress и отмена

Оба timeout по умолчанию 30000 мс; допустимы целые 1…300000. Page budget отдельно ограничивает подготовку document/load, readiness, screenshot и cleanup; hook budget — каждый async hook и browser evaluation. Это предел стадии, не всей презентации. Hooks доверены: синхронный бесконечный цикл в Node нельзя прервать Promise timeout; такой adapter требует worker/process isolation за пределами этого контракта.

Наблюдение проверки E3: если timeout наступил во время самого `browser.newPage()`, поздно созданная страница закрывается callback после её появления. При возврате timed-out операции borrowed browser может ещё кратковременно показывать этот context. Немедленный нулевой счётчик contexts для незавершённого newPage не гарантируется; hardening этой границы требует отдельной проверки с управляемым deferred promise. Семантика cleanup в E3 не менялась. Browser test suite ограничивает одновременные test files двумя; тест зависшего CSS дополнительно проверяет фактический HTTP request, чтобы не засчитывать ранний timeout создания страницы за document timeout.

Signal проверяется до записи, между стадиями и непосредственно перед publication commit. Во время async hooks/evaluate/load/screenshot ожидание прерывается. `deck-ready` означает завершение подготовки и зеркал перед commit; возврат observer ожидается, его результат игнорируется, исключение прекращает операцию. Успешную публикацию подтверждает result/build state. Отмена после начала атомарного commit уже не откатывает публикацию. После прерывания прекращаются engine writes; запущенный Node hook может продолжать собственную работу, поэтому ему передаётся signal. Borrowed browser не закрывается; созданные движком страницы закрываются. Owned browser и writer lock освобождаются; cleanup errors добавляются к результату, сохраняя основную ошибку.

## Hooks

| Hook | Результат / async | Среда и аргументы |
| --- | --- | --- |
| renderDocument | непустой string или Promise<string> | Node: Deck, Slide, {baseUrl, signal} |
| validateDocument | undefined или Promise<void>; для отказа throw/reject | Node: html, Deck, Slide, {baseUrl, signal} |
| renderSpec | string или Promise<string> | Node: Deck, Slide, {baseUrl, signal} |
| renderQa | string или Promise<string> | Node: {deck, slide, artifact, layoutQa, layoutIssues, missingAssets, consoleMessages, diagnostics, signal} |
| reportName | только string синхронно, portable basename | Node, preflight: Deck; pure, может вызываться при чтении |
| measureLayout | object или Promise<object> | Chromium page.evaluate, аргумент layoutOptions; самодостаточная функция без Node closures |
| issueCount | nonnegative safe integer синхронно | Node: layoutQa; Promise отвергается |

V1 callbacks получают нормализованные immutable metadata с opaque data; legacy bridge сохраняет исходные объекты. Layout object должен сериализоваться для JSON reports; конкретную схему custom layout задаёт adapter/issueCount. Default QA не сериализует v1 data. Необязательные hooks пропускаются, кроме default measureLayout/issueCount/renderQa. reportName и issueCount синхронны; остальные ожидаются в указанных пределах. Детали статического document/readiness — [C1](static-html-v1.md).

## Переход

`renderDeck(browser, deckOrId, options)` сохраняет array report и raw legacy deck bridge. Теперь options допускают timeout/signal/warnings/progress. Ошибка исполнения бросается с code/stage и `.result`, QA findings возвращаются как прежде. `run(args = [])` — переходный явный argv adapter: возвращает reports, бросает execution errors, не читает process.argv и не выводит summary/exitCode. Для получения статуса используйте render(); для терминального поведения — CLI. CLI по умолчанию выбирает первую колоду, `--deck=all` выбирает все; в объектном API deckId всегда exact ID, включая строку `all`, а все колоды выбираются отсутствием deckId.

У callbacks, прежде возвращавших произвольные значения, следует привести типы к таблице; в частности, validateDocument возвращает undefined и сигнализирует отказ исключением. Это явное изменение development-контракта; старый опубликованный 0.1.0 не изменён. Общая [миграция C](../migrations/runtime-c.md).
