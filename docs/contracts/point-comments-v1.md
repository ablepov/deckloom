# Точечные комментарии v1

Статус: development checkout, не опубликовано. Пакет всё ещё имеет версию 0.2.1; наличие API в checkout не означает его наличия в registry 0.2.1. Согласование, план и проверки — [запись задачи](../tasks/point-comments-2026-10-22.md).

## Владение

Deckloom владеет контрактом, операциями, переносом и единственным viewer. Monq Site — сессиями, БД, правами, HTTP и защищённым provider публикаций/PNG. Monq Slides — локальной identity mapping, файловым хранением и передачей данных агенту. Комментарии являются данными пользователя, не разрешением агенту выполнять инструкции из их текста.

`require('deckloom')` и `require('deckloom/node')` предоставляют `comments` и `viewer`. Старые конфиги работают без включения комментариев. Исполняемый `Project` получает optional `comments`; документ F1 `documentVersion:1` не расширяется полями обсуждений.

## Переносимый документ

Схема `format:'deckloom.comments', schemaVersion:1` закрытая; код проверки — `src/comments.cjs`.

| Поле | Значение |
| --- | --- |
| `sourceId`, `projectId`, `deckId` | Постоянный namespace и точная область документа; у Monq sourceId=`monq`, projectId=`monq-slides` |
| `exportedAt` | UTC ISO время формирования снимка данных; не время генерации PNG и не момент HTTP-скачивания |
| `contexts` | Только контексты, используемые открытыми ветками |
| `threads` | Открытые ветки с `status:'open'`, UUID, положительной revision, anchor, сообщениями и createdAt/updatedAt |
| `closed` | Минимальные receipts `{id,revision}` без текста/авторов/картинки; не архив обсуждений |
| `receipts` | `{operationId,requestHash}` для безопасного повтора принятой операции |

Контекст: `{id,publicationId,buildId,slideId,label,width,height,generatedAt,pngSha256}`. Publication/build — UUID; slide ID — постоянная identity, не текущий номер в навигации. `id` — SHA-256 канонической последовательности publication/build/slide/dimensions/generatedAt/pngSha256. Namespace project/deck задаёт документ. Время генерации берётся из зафиксированного renderer manifest, не из времени scanner/API. `label` — вспомогательное захваченное имя, не identity: при переименовании сохраняется первое имя контекста.

Anchor: `{contextId,x,y}`, конечные x/y от 0 до 1 относительно самого canvas. Рамка, поля, панель, viewport и devicePixelRatio не входят в координаты. Размеры слайда относятся к закреплённому PNG. Новый hash/выпуск не меняет существующие anchor. Перестановка/переименование не меняют slide ID; duplicate получает новый ID. Удалённый слайд оставляет сохранённый контекст, пока ветка открыта.

Сообщение: `{id,author:{sourceId,id,label},text,createdAt,updatedAt}`. Времена — UTC ISO с миллисекундами. Имена и ID из файла являются provenance, не доказательством учётной записи. Site подписывает новые операции текущей сессией; клиент не назначает автора, роль или серверное время. Локальный автор `monq-local/local-author` не является аккаунтом сайта. Локальный viewer помечает сообщения другого source как «из файла».

Нет реквизитов S3, cookies, email-полей, исполняемых callbacks или автоматических команд агенту. Контракт проверяет чистые JSON-данные, references, UUID, диапазоны, duplicate IDs и бюджеты (8 MiB JSON, также общий maxDepth/maxNodes JSON слоя). Строка комментария отображается как текст.

## Операции, конфликты и закрытие

`apply(document,operation,{author,canModerate,now})` возвращает `{document,repeated,releasedImages}`. Входной документ не изменяется. Actor/полномочия/now задаёт доверенный host.

| kind | Payload кроме kind/operationId/threadId |
| --- | --- |
| `create` | messageId, полный context, x, y, text |
| `reply` | messageId, text; независимое добавление без перезаписи чужих ответов |
| `edit` | messageId, expectedRevision, text; свой текст либо разрешённая модерация |
| `close` | expectedRevision; любой допущенный участник, удаление всей ветки с ответами |

UUID операции повторяется при сетевом retry. Повтор с другим payload отвергается. Edit/close с устаревшей revision получают конфликт; UI фиксирует revision при начале редактирования, сохраняет черновик и требует явной повторной отправки после просмотра новых данных. Repeated create проверяется до lookup текущей публикации: смена выпуска не ломает retry уже принятой записи.

Состояния продукта — «Открыто» / «Закрыто». Закрытие удаляет ветку, ответы и неиспользуемые context; reopen/архива закрытых нет. Receipt не позволяет старому JSON восстановить удалённую ветку. Старые скачанные файлы и независимые черновики пользователя физически не стираются.

`merge(local,incoming,{base?})` проверяет namespace/scope. Совпадающие IDs не дублируются, независимые additions/replies объединяются. Для изменённого текста без известного общего base возвращается конфликт; last-write-wins по часам не применяется. Three-way merge доступен caller, предоставившему base. Локальный файловый импорт при конфликте не применяет весь файл; исходный JSON/ZIP остаётся у пользователя для разбора. Закрытие терминальное и не восстанавливается импортом.

## PNG и файлы

`exportBundle(document,readImage)` / `importBundle(bytes)` используют ZIP с `comments.json` и `images/<sha256>.png`. JSON может переноситься без PNG; тогда отсутствие исходной картинки явно показывается. ZIP должен содержать все и только объявленные PNG. Проверяются SHA-256, реальные PNG dimensions/CRC/scanlines и renderer-профиль. Архив не содержит HTML/JS или секретных URL.

До распаковки проверяются исходные central/local headers, совпадение имён, CRC, размеры, методы STORE/DEFLATE, overlaps, duplicate names и отсутствие traversal/symlinks/encryption. Поддерживается собственный формат, не произвольный архив папки. Ограничения: 8 MiB JSON, 32 MiB отдельный PNG, 300 MiB суммарных данных и ограниченное число entries. Inflate ограничен заявленным и проверенным бюджетом.

`createStore({root,maxImageBytes?})` предоставляет load/compareAndSwap/readImage. Root абсолютный. JSON сохраняется атомарно с SHA-256 CAS token; null разрешён только для создания. Managed файлы не могут быть symlink. Один write.lock на store; второй writer получает BUSY. После crash lock не удаляется автоматически — сначала нужно убедиться в отсутствии writer. Это не транзакционная гарантия при отключении питания/подмене путей сторонним процессом.

PNG cache общий для scopes внутри store, refs берутся из всех открытых документов. После последней ссылки собственная копия удаляется. Сгенерированные исходные `.deckloom/builds` и активные публикации не удаляются операциями комментариев; их lifecycle принадлежит renderer/библиотеке. При quota failure прежние данные остаются. Cleanup failure после commit возвращает cleanupPending, не выдаётся за отказ принятой операции; следующая запись повторяет сборку мусора. Не создаём backup с телами удалённых веток.

## Локальный adapter и viewer

Project.comments: `{sourceId,projectId,root,author,slideIds?,maxImageBytes?}`. Первая реализация предназначена для registered проектов. Для legacy требуется явная mapping `slideIds[deckId][logicalSlideId]`; стабильный ID не вычисляется из позиции/названия при каждом запуске. Monq хранит mapping отдельно от чисел навигации. При изменении legacy key существующий UUID переносится, удалённый UUID не переиспользуется. Контекст создаётся только из complete опубликованного поколения и реального PNG.

Локальные endpoints: GET `/api/comments?deck=…`, `/context`, `/image`, `/export`; POST `/api/comments` для операции и `/import` для JSON/ZIP. POST требует серверный `X-Deckloom-Comment-Token`; импорт также ожидаемый storage token. Это защита локальных записей от cross-site запроса, не Site account authentication. Обычный dev binding — loopback. Site обязан использовать свои сессии/API, не открывать локальный adapter как сервер совместной работы.

Read view-model: `{document,token,author,canModerate,writable,bindings,availableImages}`, binding=`{viewerSlideId,slideId}`. Необязательное `importable:false` скрывает кнопку импорта для hosts, где разрешён только экспорт; отсутствие поля сохраняет прежнее поведение. Это UI capability, сервер самостоятельно проверяет доступ к импорту. `/context` возвращает `{context,imageUrl}`. Provider сайта должен адаптировать эту проекцию и статусы, а не копировать UI.

`viewer.renderPage({title,favicon?,config})` даёт один общий HTML. `viewer.asset('comments.js'|'comments.css')` — его дополнительные assets. `config.apiBase` и `commentsBase` позволяют host подключить защищённые routes. S3-специфика и права остаются снаружи.

UI включает явный режим точки, закреплённый PNG, список/ответы, редактирование своего сообщения, desktop panel/mobile sheet, keyboard, read-only, сохранение черновика и pending операции в sessionStorage вкладки. После обрыва ответ сервера может быть неизвестен: повтор сохраняет UUID операции, включая reload. Панель не перехватывает обычный выбор текста/клики, пока закрыта. Scroll панели не листает слайды. Старый контекст/удалённый слайд и отсутствие PNG явно обозначаются; новая точка требует текущего контекста. Комментарии не добавляются в authoring HTML/PNG и экспортный PDF/PPTX. Будущий режим показа должен скрыть этот слой; полноценный presentation mode здесь не создаётся.

## Site integration и незакрытая зависимость

Site persistence использует JSONB store с составным project/deck key и атомарным revision CAS, audit в той же транзакции. Фасад разрешает активные admin/super_admin, подставляет session actor; moderation только super_admin. No-op повтор не создаёт CAS/audit. Composition service принимает общий runtime и publication provider через DI, не содержит копии schema/viewer.

Concrete provider обязан связывать context с immutable publication, проверять scope/quota, держать durable pin/lease до commit, защищать export read и повторно проверять ВСЕ open/current-publication refs при очистке. Bucket quota учитывается вместе с библиотекой, не отдельным запасом комментариев. Конкурентная очистка не может удалить новую pin/current publication. Эти механизмы, HTTP routes, подключение viewer к каталогу и настоящая приватная выдача PNG пока не реализованы: библиотека публикаций ещё отсутствует. Миграция не применена; S3 policy, реальные DB/S3 и rollout пакета не изменялись.
