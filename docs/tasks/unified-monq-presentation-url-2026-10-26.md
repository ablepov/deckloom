# Единая ссылка Monq на просмотр и комментарии

Дата: 26.10.2026. Статус: реализация в Monq Site и локальная техническая приёмка завершены; consumer commit отправлен в текущую ветку.

## Согласованный результат и границы

Пользователь разрешил исправление, проверки, commit и push в текущих ветках Deckloom и Monq Site. Один URL `/presentations/<shareId>` открывает актуальную публикацию всем; инструменты комментариев доступны только действующей сессии с текущим правом `admin`/`super_admin`. Партнёр, пользователь без роли и аноним получают просмотр. Прежний `/admin/presentations/<shareId>/review` остаётся совместимым перенаправлением. Права, регистрация, содержание презентаций, ядро Deckloom и DevOps/runtime не входят в изменение.

## Реализация

Источник исправления — `C:/repositories/monq-site`, установленный Deckloom остаётся 0.3.2. Сервер общего маршрута получает текущую сессию и использует ту же проверку допуска, что private comments API. Только разрешённой сессии передаются `commentsBase` и HMAC `commentToken`. Остальным HTML не содержит этих полей и не читает комментарии. Все ответы общего HTML-маршрута, включая ошибки, имеют `private, no-store`, `Vary: Cookie`; публичные immutable assets/API сохраняются.

Каталожная кнопка «Обсудить», просмотр и копируемая ссылка ведут на общий адрес. Старый review возвращает 307 на него с сохранением query; действующий hash слайда сохраняется браузером. Относительный Location сохраняет внешний hostname за reverse proxy; внутренний адрес standalone не используется. Server-side API guards и CSRF не ослаблены. Публичный viewer использует прежний `monqPublished`, режим комментариев — прежний `monqReview`.

Единая проверка допуска обрабатывает Date и строковый timestamp: общий postgres client после инициализации Drizzle возвращает срок сессии строкой. Это выявлено на повторных запросах реального сервера, учтено в реализации и regression tests.

## Проверки

- Точечные unit tests: общий URL для анонима, admin, super_admin, партнёра, пользователя без роли, просроченной и отключённой сессии; отсутствие токена/private endpoints у запрещённых ролей; приватные ошибки; review redirect.
- HTTP guards: запрет document/context/image/export/UI assets/POST для истёкшей, отключённой и партнёрской сессии; CSRF, cross-site и лимит тела запроса.
- Все стадии `npm run verify:required` прошли: typography, typecheck, lint (одно прежнее предупреждение `no-img-element` вне задачи), 449 unit tests + 1 skip, component/responsive audits, production build, images. После последнего изменения redirect повторены typecheck, 29 focused tests и production build. Windows EBUSY при повторной сборке устранён остановкой своего QA standalone; финальный build прошёл.
- 6 integration tests настоящего PostgreSQL прошли в отдельной schema: транзакции, CAS/idempotency, PNG pin/GC, ZIP, rollback и версии.
- Production standalone, desktop 1440×900: аноним, admin, super_admin, партнёр, пользователь без роли, просроченная, отозванная и отключённая сессия. Mobile 390×844: аноним/admin/партнёр/super_admin и отправка ответа; screenshots просмотрены. Каталог направляет просмотр/обсуждение на один URL. Старый review проверен браузером с query и действующим hash слайда.
- Через UI созданы точка, сообщение и ответы, проверены reload и скачивание ZIP. Установленный Deckloom импортировал ZIP: 1 ветка, 2 сообщения, 1 исходный PNG. JSON после mobile reply содержит 3 сообщения; export разрешён admin/super_admin и не содержит raw session/HMAC secrets.
- Анонимный HTML не читает private API, не содержит token/base/текст ветки; document/context/image/export/ui.js/ui.css и POST дают 403. Снятие роли и отзыв уже проверенной сессии блокируют дальнейший API-доступ и старый CSRF token; публичный просмотр остаётся доступным.
- Временные QA schema, синтетические сессии и тестовый server удалены/остановлены; существующие application tables и обсуждения не изменялись. Evidence: `C:/repositories/monq-site/output/unified-link/` (ignored).

## Ограничения

Эта сборка проверена локально на реальном PostgreSQL и опубликованных Retail PNG. Авторизованная корпоративная приёмка нового commit не выполнялась: доставка требует штатного CI после push. Исторический login blocker снят 23.10.2026; новый сбой корпоративного login не заявляется. Полные all-route E2E suites не запускались по границам задачи. Ядро Deckloom не менялось, повтор engine suite и новый npm release не требуются.

## Отправка и продолжение

Monq Site: `c97171cc99f7ceb78c73a46825ea02707369cfe1` (`fix(presentations): enable authorized comments on shared URL`) отправлен `git push origin develop`; remote SHA проверен через `ls-remote`, рабочая копия чистая. Документация этой задачи и две краткие ссылки фиксируются в текущей Deckloom `master`; существующие локальные документы/эксперименты остаются вне commit. Новых релизов Deckloom не требуется.

Следующая внешняя проверка — штатная CI-доставка Site и авторизованное открытие того же URL на корпоративном dev. Это отдельное неподтверждённое состояние среды, не незавершённая локальная реализация.
