# Переход со старого источника OTA

С 6 ноября 2026 исходники и релизы Cudy Monitor Pro публикуются в **stub11/cudy-monitor-pro**. Старый репозиторий является приватным, поэтому установленный ранее помощник OTA не сможет проверить новые выпуски через прежний URL.

ВНИМАНИЕ: это отдельная операция. Сам монитор 1.0.2 продолжает работать локально и не нуждается в немедленной замене.

## Однократная миграция помощника обновлений

Откройте SSH на роутере, перейдите в BusyBox shell (из Keenetic CLI: `exec sh`). Выполните:

```sh
set -eu
DIR=/opt/share/cudy-monitor
cp "$DIR/update.sh" "$DIR/update.sh.before-migration"
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/stub11/cudy-monitor-pro/main/cudy-monitor/scripts/update.sh \
  -o "$DIR/update.sh.new"
/bin/sh -n "$DIR/update.sh.new"
mv "$DIR/update.sh.new" "$DIR/update.sh"
/bin/sh "$DIR/update.sh" --check
```

Если `curl` не найден, используйте `/opt/bin/curl`. Для восстановления старого файла:

```sh
cp /opt/share/cudy-monitor/update.sh.before-migration /opt/share/cudy-monitor/update.sh
```

После успешной проверки можно открыть веб-панель **Обновления** и установить выпуск 1.0.3. Заменяется только бинарник; скрипты установки и конфигурация сервисов не обновляются автоматически. Во время обновления монитор на несколько секунд станет недоступен; DNS и другие службы не следует останавливать.

## Важное ограничение

Приватизация других GitHub-репозиториев может повлиять на отдельные публичные механизмы обновлений, которые ранее скачивали файлы без авторизации. Они должны быть переведены на доступный источник отдельно.

## Проверка

Публичный проект: https://github.com/stub11/cudy-monitor-pro

Выпуски: https://github.com/stub11/cudy-monitor-pro/releases
