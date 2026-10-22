# Скачивание выбранной колоды, development v1

Реализовано в checkout по [задаче меню экспорта](../tasks/download-menu-2026-10-22.md). Новый npm-релиз не опубликован.

В общей шапке viewer кнопка «Скачать» открывает PDF, PPTX, PPTX со шрифтами (ZIP), затем disabled «Открыть в Google Презентациях · Бета» с подписью о будущей доступности. Google не запускает запросы/авторизацию и не создаёт документы. Пункты текущих форматов доступны только при наличии соответствующей возможности колоды. Используются существующие цвета/типографика/кнопки; меню поддерживает keyboard navigation, Escape, Tab, outside click и narrow viewport.

Нажатие фиксирует точный deckId и всю зарегистрированную композицию; текущий номер слайда, режим просмотра и последующее переключение колоды не меняют запрос. Один экспорт на сервер одновременно, повторный клик в том же viewer блокируется; другой клиент получает DOWNLOAD_BUSY. После подготовки файл скачивается и доступен по повторной ссылке. Ошибка имеет явное состояние и повтор для исходной колоды.

## API

- GET /api/downloads — capabilities по deckId: pdf/pptx/fonts. Пути к исходникам/шрифтам/лицензиям не публикуются.
- POST /api/downloads — только JSON {deckId,format}, format = pdf / pptx / pptx-fonts. Требует server-session token из viewer config и same Origin при его наличии. Другие ключи, неизвестная/пустая колода, неподдержанный формат и Google отвергаются до сборки. Ответ202 содержит opaque job ID.
- GET /api/downloads/{id} — queued/running/complete/failed, счётчик слайдов, название зафиксированной колоды. При успехе filename/url, при ошибке только code; internal paths/stack не выдаются.
- GET/HEAD /api/downloads/{id}/file — только готовый файл, Content-Disposition attachment, точный Content-Type/Length, nosniff/no-store. Не принимает пользовательские файловые пути.

Сборка использует отдельный OS temp root вне source/static mounts; ничего не перезаписывает в canonical artifacts потребителя. Временные HTML/PNG удаляются перед публикацией complete; следующий запрос принимается после освобождения предыдущей операции. Хранятся максимум8 результатов, TTL30мин; остановка dev CLI отменяет активную работу и закрывает её ресурсы. Истечение результата требует нового экспорта.

## Конфигурация

Необязательное Project.downloads — отдельный общий namespace, не adapter data. Поддерживает fontPolicy strict/allow-substitution, pptx и overrides decks[deckId]. Никакие consumer selectors, font family names, исходные пути или значения метрик не зашиты в общий viewer/service.

PDF использует createRenderer.export. Без semantic profile PPTX использует прежний ограниченный Windows Arial reference profile, включая его canvas/HTML ограничения. Его условия не ослабляются для меню. Discovery/read-only и пустые колоды не экспортируются.

Для semantic-source-v1 необходимы роли root/text/groups/imageComponents/atomic/centeredText/intrinsicText, pinned static source fonts (family,file,sha256) и pinned native reference metrics (file,sha256). Используются общие semantic capture/source-font/measured render modules; [границы профиля](pptx-measured-source-fonts.md) сохраняются. Это подключение через download service, не новое значение публичного renderer.export().pptx/CLI profile.

ZIP содержит presentation.pptx, полные TTF только использованных faces, fonts.json (имя/вес/версия/SHA), лицензии и UTF-8 инструкцию Windows/macOS. Для каждого устанавливаемого face требуются redistributable:true, licenseFile и licenseSha256. OpenType embedding bits не заменяют разрешение распространения; неподтверждённая лицензия или изменившийся SHA вызывают отказ. Системные шрифты не копируются автоматически. Установка/замена шрифтов остаётся действием получателя; архив не содержит исполняемого установщика.

## PDF fonts

Обычные PDF fonts требуют непустой встроенный FontFile/FontFile2/FontFile3. Для Type3 проверяются встроенные непустые CharProcs glyph streams; отсутствие FontFile у них допустимо. Composite descendants и ordinary fonts проверяются отдельно, даже при общем descriptor. Неизвестный source font или отсутствующий ordinary font по-прежнему вызывает PDF_FONT_NOT_EMBEDDED. Это форматное исправление проверки, не растеризация текста и не исключение для конкретного семейства.

Основание формата Type3/CharProcs — [Adobe PDF Reference](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.3.pdf).
