# Переход со старого источника OTA

[← README](README.md) · [Установка](docs/INSTALL.ru.md)

Это руководство **только для ранее установленных версий**, которые пытаются загрузить обновление из старого репозитория, ставшего приватным. Если в панели уже успешно открывается вкладка «Обновления» и находится последняя версия, миграция не нужна.

**Важно:** операция меняет только установленный `/opt/share/cudy-monitor/update.sh`. Она не обновляет бинарник, не трогает другие службы и не меняет прошивку.

Подключитесь по SSH. На совместимой KeeneticOS при приглашении `(config)>` сначала введите `exec sh`.

В Linux shell роутера:

```sh
set -eu
DIR=/opt/share/cudy-monitor
CURL=/opt/bin/curl
[ -x "$CURL" ] || CURL=curl

[ -f "$DIR/update.sh" ] || { echo "Installed updater not found"; exit 1; }
BACKUP="$DIR/update.sh.backup-$(date +%Y%m%d-%H%M%S)"
cp -p "$DIR/update.sh" "$BACKUP"

"$CURL" --proto '=https' --tlsv1.2 -fsSL \
  --connect-timeout 7 --max-time 35 \
  https://raw.githubusercontent.com/stub11/cudy-monitor-pro/main/cudy-monitor/scripts/update.sh \
  -o "$DIR/update.sh.new"

# On some BusyBox systems /bin/sh -n is not supported.
grep -q 'stub11/cudy-monitor-pro/releases' "$DIR/update.sh.new" || {
  echo "Unexpected OTA source"; exit 1;
}
chmod 755 "$DIR/update.sh.new"
mv "$DIR/update.sh.new" "$DIR/update.sh"

if /bin/sh "$DIR/update.sh" --check; then
  echo "OTA source updated successfully"
  echo "Backup: $BACKUP"
else
  cp -p "$BACKUP" "$DIR/update.sh"
  echo "OTA check failed; old script restored"
fi
```

Если проверка прошла, откройте панель «Обновления». Смена источника не запускает установку версии автоматически. После обновления монитора проверьте его `/health` и версию.

При необходимости можно вручную восстановить `update.sh` из созданного `BACKUP` (путь выводится командой). Старый источник обновлений может оставаться недоступным — это ожидаемо.

## Безопасность

Скачиваемый скрипт берётся из публичного GitHub; скачивайте только из официального репозитория, проверяйте источник и не отключайте HTTPS. Последующая установка бинарника выполняет отдельную сверку SHA-256. Не публикуйте в Issue скриншоты с адресами локальной сети и журналы без обезличивания.
