# Переход на runtime C

Исходная npm-версия 0.1.0 остаётся доступной; C пока только в development checkout. Monq и другие потребители на этом этапе не изменялись.

1. Перейти от библиотечного run() без аргументов к render({deckId?, outputRoot?, ...}). Проверять result.status и diagnostics. CLI остаётся отдельной точкой с summary и exit code. Если нужен старый array report, renderDeck сохранён; run принимает только явно переданный argv и больше не управляет глобальным exitCode/выводом.
2. Привести типы hooks к [C2–C3](../contracts/programmatic-render-v1.md). Validator возвращает undefined либо бросает ошибку. issueCount/reportName синхронны. Асинхронные callbacks укладываются в timeout и по возможности учитывают signal. Browser measureLayout не использует Node closures.
3. Для v1 подготовить статический HTML по [C1](../contracts/static-html-v1.md): полноценный head/resources теперь сохраняется в document preview; скрипты, event handlers, активная анимация и dynamic elements требуют подготовки. Legacy input сохраняет переходное поведение с предупреждением, но не гарантирует fidelity динамического HTML.
4. Использовать URL из scanner без удаления build query или generation paths из result.artifacts/manifest. Прямые canonical пути сохранены как зеркало и не дают гарантии согласованной пары HTML/PNG. Не править файлы опубликованного поколения вручную. Добавленное поле deck.build отражает последнюю попытку и предыдущую публикацию.
5. Отдельный outputRoot сохраняет относительный source base для PNG; для HTTP ресурсов нужны подходящие пути/mounts. File base не переносим в HTTP. Автономный bundle относится к D4.

Перед обновлением потребителя сохранить его точную прежнюю зависимость/lockfile, конфигурацию и результат рендера. Затем проверить реальный адаптер, его ресурсы, основные колоды и экспорты. Нейтральные проверки движка не заменяют эту приёмку. Обновление конкретного потребителя — отдельная авторизованная задача.
