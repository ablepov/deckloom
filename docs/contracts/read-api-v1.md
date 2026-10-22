# Проекции чтения B3

20 октября 2026 года. Реализованный слой чтения [контракта Project/Deck/Slide](project-deck-slide-v1.md) в рабочей копии. Публикация не выполнялась. Пример подключения — examples/read-v1.config.cjs: после npm run render:example его можно открыть командой node bin/deckloom.cjs dev --config=examples/read-v1.config.cjs. До рендера registered-слайды остаются в составе как placeholders.

## Выбор проекции и состава

- Явный contractVersion: 1 выбирает v1 для scanDecks, scanSlides и HTTP API. Unversioned-конфиг использует bridge и форму 0.1. Неизвестная версия отвергается, а не трактуется как старый формат.
- Registered берёт состав и порядок только из decks[].slides. Папки не добавляют слайдов; отсутствие файлов не убирает заявленные экземпляры. Удалённые из конфигурации папки не удаляются с диска и не публикуются как артефакты реестра.
- Discovery обнаруживает только цифровые папки заявленного artifactPrefix. Порядок числовой, при равенстве — ASCII-порядок полного имени; большие цифровые значения сравниваются без потери точности. Пустые папки без HTML/изображения не становятся слайдами. Ссылки каталогов исключаются, как в 0.1.
- Сервер захватывает неизменяемый реестр при создании. Изменение исходного объекта не меняет состав до перезапуска. Файлы и их версии перечитываются при каждом запросе; discovery заново обнаруживает папки. Это не watcher конфига и не проверка свежести сборки C4.
- scanDecks(project) создаёт snapshot на вызов. scanSlides(project, selection) принимает ID либо объект с id, выбирая каноническую колоду из реестра; остальные поля selection не переопределяют состав. Без selection выбирается первая колода, при её отсутствии — UNKNOWN_DECK. Неизвестный/неверный регистр ID не подменяется первой колодой.

## V1

GET /api/decks и scanDecks возвращают contractVersion, generatedAt, project.id/mode и decks. Deck содержит id, label, default width/height и slides. Slide содержит id/name/index/number/effective width/height и artifacts.html/png. Поле no отсутствует. Пример сокращён до одной колоды и одного ещё не отрендеренного слайда:

```json
{
  "contractVersion": 1,
  "generatedAt": "2026-10-20T12:00:00.000Z",
  "project": { "id": "neutral-reader", "mode": "registered" },
  "decks": [{
    "id": "demo", "label": "Neutral landscape", "width": 1280, "height": 720,
    "slides": [{
      "id": "cover", "name": "Cover", "index": 0, "number": 1,
      "width": 1280, "height": 720,
      "artifacts": { "html": { "state": "missing" }, "png": { "state": "missing" } }
    }]
  }]
}
```

GET /api/slides?deck=demo и scanSlides возвращают тот же envelope с полем deck вместо decks. Для unknown deck — HTTP 404; для пустого Project список decks пуст, запрос одной колоды также даёт 404.

У available-артефакта есть state/url/version. У missing нет URL. У unreadable есть диагностическая категория без абсолютного пути. version — непрозрачный ключ обновления preview по stat, не revision содержимого, не успешный QA и не признак принятия слайда. data, callbacks, source objects и абсолютные FS-пути в проекцию не попадают, включая циклические данные адаптера.

Registered v1 использует файлы контракта: render.html/generated-html.png в stable либо старое имя HTML/generated-html.png в legacy layout. Discovery сохраняет ранжирование изображений 0.1 (complete/hybrid, generated, прочие кандидаты с прежними исключениями и tie-break). Его ID — имя найденной папки, а не ID авторского экземпляра.

## Доставка

V1 URL строится по относительному пути файла от root, под namespace /artifacts/:

| Layout | Пример HTML URL без cache query |
| --- | --- |
| Stable | /artifacts/deck-demo/slide-cover/render.html |
| Legacy | /artifacts/demo-slide-01/demo-slide-01-render.html |

URL не выводится клиентом из number. Доставляются только каталоги текущих registered-слайдов либо допустимые discovery-семейства. Файлы внутри разрешённого каталога слайда доступны для относительных локальных ресурсов. Проверяются decoded traversal, realpath и выход через symlink/junction; весь root не публикуется.

Явные staticMounts доступны по прежнему mount и его зеркалу под /artifacts/: например, /assets/icon.svg и /artifacts/assets/icon.svg для mount /assets. Это позволяет старому HTML с ../assets/icon.svg работать при namespace-доставке legacy layout. Зеркало публикует только уже объявленный ресурс; незаявленные папки root не становятся mounts. Канонический маршрут зарегистрированного артефакта имеет приоритет перед зеркалом mount. Общий resolver ресурсов и переносимость экспорта остаются C1/D4.

Legacy layout также сохраняет unprefixed file aliases /demo-slide-01/demo-slide-01-render.html. Stable layout не получает такой alias. Явно опубликованные static mounts — самостоятельная область доступа; исключение слайда из реестра не отменяет отдельное разрешение на публикацию той же папки через staticMounts.

GET/HEAD поддерживаются, POST не добавляет операций записи. Discovery не получает renderer-capability даже при наличии renderDocument. Ошибки HTTP не передают Node/FS stack или абсолютные пути. Общий error/result контракт C2 не вводится этим шагом.

## Legacy и viewer

Unversioned-проекция сохраняет прежние поля id/no/file/url/version/size/modifiedAt/htmlFile/htmlUrl/htmlVersion/htmlSize/htmlModifiedAt. ID остаётся именем папки, no — цифровым файловым ключом, а не новой позицией. Ранжирование PNG/JPEG/WebP для старого входа сохранено даже в registered, но только внутри выбранных реестром папок. Для отсутствующего артефакта URL/file и его метаданные равны null; клиенты должны учитывать placeholders. Single-deck ответ остаётся плоским, без поля deck/contractVersion.

Viewer явно читает обе проекции. В v1 номера навигации равны number, в старой проекции — прежнему no. V1 ссылки имеют вид #project/neutral-reader/deck/demo/slide/cover, а для пустой колоды — #project/neutral-reader/deck/demo. Это устраняет неоднозначность повторного локального slide.id в другой колоде. Старый вход сохраняет #demo-slide-01. Автоматического преобразования старого hash в новый ID нет.

По умолчанию v1 хранит состояние в namespace deckloom:<project.id>; явный viewer.storagePrefix сохраняется. Помимо индекса v1 запоминает ID выбранного слайда в колоде. HTML-only и ещё не отрендеренные слайды не исчезают из навигации; при отсутствии preview используется существующий паттерн placeholder. Пустой Project/Deck показывает своё пустое состояние. Смена файлов отражается при следующем polling-запросе без изменения зарегистрированного состава.

## Согласование B4

[B4](render-v1.md) открывает v1 renderer и согласует effective dimensions с API/viewer/PNG. Read preflight отделён от write preflight: отдельные повреждённые leaves получают независимый unreadable, не обрывая весь registered-ответ. У прежней проекции только при ошибке появляются необязательные htmlError/imageError, без замены старого no номером показа. Viewer показывает ошибки загрузки/decode и повторяет неудавшийся preview при здоровом API polling. File availability не является QA/freshness/build revision; C4 остаётся следующим отдельным контрактом.

## Дополнение C4

В текущей рабочей копии [публикация сборок](build-publication-v1.md) добавляет deck.build, явный unversioned статус старых файлов и URL, закреплённые за build ID. Generated HTML/PNG одной колоды читаются из одного manifest. При повреждении manifest нет fallback к canonical зеркалам; последние остаются только совместимыми файлами для старых внешних читателей. Эти дополнения не входят в опубликованный npm 0.1.0.
