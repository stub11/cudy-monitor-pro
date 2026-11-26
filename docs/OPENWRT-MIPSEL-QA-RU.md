# Тест Cudy Monitor Pro 1.2.27 — OpenWrt MIPSEL (ramips/mt7621)

Это **тестовый APK, не стабильный релиз**. Пакет собирается в GitHub Actions с официальным OpenWrt SDK 25.12.6 для `ramips/mt7621` (`mipsel_24kc`). Другие MIPSEL ABI не подтверждены.

## Кому подходит

Добровольцам с **отдельным тестовым маршрутизатором**, где `/etc/openwrt_release` содержит `DISTRIB_TARGET='ramips/mt7621'`, а `apk --print-arch` показывает `mipsel_24kc`. Нужны OpenWrt 25.12.6/совместимый 25.12 с `apk` и достаточно свободной памяти/места. Не устанавливать на основное устройство, Keenetic Ported/Entware или OpenWrt 24.10 с `opkg`.

## Как проверить (только тестовый роутер)

1. Сделать резервную копию настроек OpenWrt. Проверить тип прошивки: `cat /etc/openwrt_release`, `apk --print-arch`, `uname -m`, `df -h /overlay`.
2. Открыть [Actions → OpenWrt MIPSEL mt7621 QA](https://github.com/stub11/cudy-monitor-pro/actions/workflows/openwrt-mipsel-mt7621-qa.yml), выбрать успешную сборку `main`, скачать `cudy-openwrt-mipsel-24kc-mt7621-qa-1.2.27-not-released`. Распаковать ZIP и сверить **SHA256 APK** с `SHA256SUMS`.
3. Перенести `cudy-monitor-pro-1.2.27-r1.apk` в `/tmp` тестового роутера. Убедиться, что пакет совпадает с `mipsel_24kc`; только после этого вручную выполнить:

   ```sh
   apk add --allow-untrusted /tmp/cudy-monitor-pro-1.2.27-r1.apk
   ```

4. Проверить `/etc/init.d/cudy-monitor-pro status`, `/usr/bin/cudy-monitor-pro --version`, `sh /usr/share/cudy-monitor-pro/update-native.sh --diagnose`, `wget -qO- http://127.0.0.1:8237/health` (локально; порт может отличаться при назначенном LAN IP). Затем открыть панель по LAN, проверить CPU, RAM, WAN, графики, процессы и 10 минут наблюдения без зависаний.
5. Сообщить разработчику или в [GitHub Issues](https://github.com/stub11/cudy-monitor-pro/issues): **модель роутера, точный target/ABI, версия OpenWrt, работает/не работает и обезличенный текст ошибки**.

**Не проверять OTA тестового MIPSEL через существующий ARM64 APK релиз**: канал тестирования выбирает версию, но пока не фильтрует архитектуру пакета. Для MIPSEL `--apply-testing` **запрещён** до отдельной защиты архитектуры и второго MIPSEL Pre-release. Не открывать порт панели в интернет, не отправлять приватные IP, токены и неочищенные логи.

## Что ещё не подтверждено

26.11.2026 получен [аппаратный отчёт Netis N6](https://github.com/stub11/cudy-monitor-pro/issues/150#issuecomment-7183455369): интерфейс версии 1.2.27 работает на OpenWrt 25.12.6 MIPSEL, отображаются CPU, RAM, WAN, графики и два Wi-Fi датчика. Температура CPU отсутствует; не заменять её температурой Wi-Fi.

Это частичная аппаратная проверка. Точный ABI и SHA256 установленного APK, установка, перезапуск, длительная стабильность и OTA ещё не подтверждены. Статус пакета остаётся тестовым; запрет MIPSEL OTA сохраняется.
