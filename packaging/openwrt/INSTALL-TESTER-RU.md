# Установка Cudy Monitor Pro на OpenWrt 25.12.6 — ОДНА КОМАНДА

Предназначено для Netis N6 v2 / других совместимых ARM64 роутеров с OpenWrt 25.12.6 (mediatek/filogic).

> Панель работает в локальной сети без пароля. Не открывайте порт 8237 в WAN или гостевую сеть. Перед первым тестом сделайте резервную копию конфигурации. Физическая проверка на Netis N6 v2 ещё продолжается.

## 1. Войти по SSH под root

Откройте терминал роутера OpenWrt (например, через Termius/PuTTY). **Скопируйте и вставьте ВСЮ команду целиком:**

```sh
wget -qO /tmp/cudy-monitor-install.sh https://raw.githubusercontent.com/stub11/cudy-monitor-pro/main/packaging/openwrt/install-openwrt.sh && sh /tmp/cudy-monitor-install.sh
```

Скрипт:
1. проверяет OpenWrt, ARM64 и наличие `apk`;
2. запрещает конкурирующую установку, если уже работает версия Entware;
3. скачивает нативный пакет `cudy-monitor-pro-1.2.6-r1.apk` с GitHub Releases; при ошибке `wget` пробует `curl`, если он установлен;
4. сверяет SHA-256 с закреплённым значением официального релиза 1.2.6 и только после совпадения устанавливает пакет через OpenWrt `apk`;
5. автоматически определяет **уже существующий** LAN-адрес (не меняет IP, DNS, Wi-Fi, firewall), активирует службу и печатает ссылку.

Это экспериментальный, не подписанный ключом репозитория пакет. Поэтому в скрипте используется `apk add --allow-untrusted`, а SHA-256 сверяется с контрольным значением релиза. Исходник скрипта можно просмотреть [здесь](install-openwrt.sh) до запуска.

## 2. Открыть панель

В конце выполнения появится примерно:

```text
CUDY MONITOR PRO — INSTALLED
OPEN IN BROWSER: http://192.168.1.1:8237/
```

**Откройте напечатанную ссылку в обычном браузере телефона или ПК, подключённого к LAN/Wi-Fi роутера.** Вводить эту ссылку в SSH/терминале НЕ нужно. `192.168.1.1` — пример; программа показывает фактический LAN-IP.

## Если скачивание APK с GitHub не работает

Если после `Downloading package...` появляется ошибка, это **ещё не ошибка установки APK**. GitHub Releases переадресует скачивание на `release-assets.githubusercontent.com`, который может быть недоступен непосредственно с роутера, даже когда `raw.githubusercontent.com` работает.

Обновлённый установщик сначала пробует `wget`, затем `curl` (если имеется), показывает настоящие ошибки HTTPS и не отключает проверку сертификатов.

Если скачивание всё равно не работает, откройте на телефоне или ПК [файл APK 1.2.6](https://github.com/stub11/cudy-monitor-pro/releases/download/cudy-monitor-openwrt-v1.2.6/cudy-monitor-pro-1.2.6-r1.apk). Передайте файл в **`/tmp/cudy-monitor-pro-1.2.6-r1.apk` на роутере** через SFTP/SCP, например через Termius или WinSCP. Важно: файл должен лежать именно на роутере, а не в памяти телефона.

После копирования **одна команда устанавливает локальный APK, проверяет встроенную SHA-256, включает службу и открывает LAN**:

```sh
wget -qO /tmp/cudy-monitor-easy.sh https://raw.githubusercontent.com/stub11/cudy-monitor-pro/main/scripts/easy-install.sh && sh /tmp/cudy-monitor-easy.sh --install --file /tmp/cudy-monitor-pro-1.2.6-r1.apk
```

Правильная SHA-256 для APK 1.2.6: `149c89f2e62e7b44cd194118ee5d8762f2b2b494c661f2b1c782fa96c508c50c` — проверяется автоматически **перед установкой**, даже при недоступном GitHub Releases. Не выключайте проверку TLS и не используйте непроверенные зеркала.

Для уточнения причины можно отдельно выполнить:

```sh
wget -S -O /tmp/cudy-monitor-download-test.apk 'https://github.com/stub11/cudy-monitor-pro/releases/download/cudy-monitor-openwrt-v1.2.6/cudy-monitor-pro-1.2.6-r1.apk'
```

Если скачивание не получилось, удалите тестовый неполный файл: `rm -f /tmp/cudy-monitor-download-test.apk`. При отправке ошибки автору удалите из вывода приватные адреса и токены.

## Если автоматическое определение LAN не удалось

Скрипт не выбирает адрес наугад. Пакет при этом может быть установлен и работать только на `127.0.0.1`. Узнайте LAN-IP, например через `ip -4 addr show`. Если реальный адрес роутера 192.168.1.1, выполните:

```sh
cudy-monitor-lan --bind-ip 192.168.1.1
```

Откройте напечатанный `Monitor: http://...:8237/`. Используйте именно адрес **своего** роутера.

## Если ссылка не открывается

```sh
cat /etc/cudy-monitor-pro/bind
/etc/init.d/cudy-monitor-pro status
logread | grep -i cudy
```

Проверьте, что телефон в основной LAN/Wi-Fi роутера, а не в гостевом сегменте. Пришлите вывод команд без секретов, WAN IP и паролей.

## Обновление и удаление одной командой

Скопируйте команду целиком в SSH-консоль роутера. Обновление сохраняет настройки, удаление оставляет конфигурацию для повторной установки. Команда не трогает сторонние службы.

**Обновить:**

```sh
wget -qO /tmp/cudy-monitor-easy.sh https://raw.githubusercontent.com/stub11/cudy-monitor-pro/main/scripts/easy-install.sh && /bin/sh /tmp/cudy-monitor-easy.sh --update
```

**Удалить:**

```sh
wget -qO /tmp/cudy-monitor-easy.sh https://raw.githubusercontent.com/stub11/cudy-monitor-pro/main/scripts/easy-install.sh && /bin/sh /tmp/cudy-monitor-easy.sh --remove
```

## Дополнительно

- Повторная установка одной командой не должна изменять настройки DNS, firewall, Wi-Fi или маршрутизацию.
- Если предыдущая версия установлена через Entware IPK — не ставьте поверх неё нативный APK. Сначала согласуйте безопасную миграцию.
- Проверить пакет: `apk info -e cudy-monitor-pro`.
- Удалить нативный пакет: `apk del cudy-monitor-pro` (конфигурационный файл может оставаться на диске).
