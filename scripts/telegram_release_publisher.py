#!/usr/bin/env python3
"""Post one Telegram forum-topic announcement after BOTH Cudy Monitor Pro releases exist.

Runs in GitHub Actions, without a home PC. No token is stored or printed.
Git tag telegram-announced-vX.Y.Z is the durable idempotency marker.
"""
from __future__ import annotations

import html
import json
import os
from pathlib import Path
import re
import sys
import tomllib
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

REPO = "stub11/cudy-monitor-pro"
API = f"https://api.github.com/repos/{REPO}"
ROOT = Path(__file__).resolve().parents[1]
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
TIMEOUT = 20
# 1.2.13 sendMessage returned HTTP 200 on 2026-11-10, but its response
# was truncated by our previous 4096-byte reader. It MAY already be posted.
# Never send that version again without first inspecting the real Telegram
# topic and explicitly resolving the ambiguity.
MANUAL_REVIEW_VERSIONS = frozenset({"1.2.13"})


class PublisherError(RuntimeError):
    pass


def version_from_source() -> str:
    value = tomllib.loads((ROOT / "cudy-monitor/Cargo.toml").read_text(encoding="utf-8"))
    version = value["package"]["version"]
    if not VERSION_RE.fullmatch(version):
        raise PublisherError("Unexpected package version")
    return version


def github_request(path: str, token: str, *, method: str = "GET", payload=None):
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "CudyMonitorReleaseAnnouncement/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
        "Authorization": f"Bearer {token}",
    }
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    req = Request(f"{API}/{path.lstrip('/')}", data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=TIMEOUT) as res:
            return json.loads(res.read(1024 * 1024))
    except HTTPError as ex:
        if ex.code == 404:
            return None
        if ex.code == 422 and method == "POST" and path == "git/refs":
            raise PublisherError("Announcement marker already exists or could not be created")
        raise PublisherError(f"GitHub request failed with HTTP {ex.code}") from None
    except (URLError, TimeoutError):
        raise PublisherError("GitHub connection failed") from None


def validated_release(meta: object, tag: str, expected_asset: str) -> bool:
    if not isinstance(meta, dict) or meta.get("tag_name") != tag:
        return False
    if meta.get("draft") or not meta.get("published_at"):
        return False
    for asset in meta.get("assets", []):
        if not isinstance(asset, dict):
            continue
        if asset.get("name") != expected_asset or asset.get("state") != "uploaded":
            continue
        if not isinstance(asset.get("size"), int) or asset["size"] <= 1000:
            continue
        digest = asset.get("digest", "")
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
            continue
        return True
    return False


# Short human-reviewed Russian summaries. Never publish raw English CHANGELOG
# lines as Telegram announcements. Add a new entry when preparing each release.
RELEASE_NOTES_RU = {
    "1.2.20": [
        "На OpenWrt системный журнал теперь правильно обозначен как logread, без упоминаний KeeneticOS.",
        "Настройки служебных подключений ndmc показываются только на совместимых системах Entware.",
    ],
    "1.2.19": [
        "Если роутер не передаёт данные RAM или накопителя, панель показывает «Нет данных» вместо ложных 0%.",
        "Индикаторы и графические шкалы автоматически возвращаются к правильным значениям после восстановления замеров.",
    ],
    "1.2.18": [
        "Журнал KeeneticOS больше не засоряется служебными подключениями ndmc.",
        "Добавлен переключатель для просмотра всех служебных событий.",
        "Сохранены полезные сообщения об ошибках и отключениях.",
    ],
    "1.2.17": [
        "Многострочные события KeeneticOS теперь отображаются целиком.",
        "Убраны лишние символы терминала из журнала.",
        "IP- и MAC-адреса видны; пароли и токены по-прежнему скрыты.",
    ],
    "1.2.16": [
        "Добавлено чтение системного журнала KeeneticOS.",
        "Журнал теперь различает пустой и недоступный источник.",
        "При потере авторизации устаревшие показатели больше не выглядят актуальными.",
    ],
    "1.2.15": [
        "Улучшено отображение показателей памяти на смартфонах.",
        "Убраны дубли названий платформы и лишние разделители в панели.",
    ],
    "1.2.14": [
        "Усилена проверка отката обновления OpenWrt: сверяются версия установленного файла и запущенного процесса.",
        "Неудачное восстановление пакета теперь сопровождается предупреждением вместо неподтверждённого успеха.",
        "Добавлены изолированные регрессионные тесты ошибок восстановления.",
    ],
    "1.2.13": [
        "Панель теперь подтверждает завершение обновления по версии реально запущенного монитора.",
        "Ответ о запуске обновлятора больше не считается подтверждением успешной установки.",
        "При ошибке проверки отображается предупреждение без автоматического повторного обновления.",
    ],
    "1.2.12": [
        "Исправлена проверка обновления OpenWrt: сверяются версии файла и запущенного монитора.",
        "Улучшена диагностика, когда монитор показывает разные версии до и после обновления.",
        "Добавлена проверка успешного запуска и откат при ошибке обновления OpenWrt.",
    ],
    "1.2.11": [
        "Исправлено обновление OpenWrt APK из веб-панели: устранена ошибка origin mismatch.",
        "Для авторизации и обновлений используется единая проверка запросов браузера.",
        "Добавлены тесты защиты от запросов с посторонних сайтов.",
    ],
    "1.2.10": [
        "Исправлено включение авторизации в браузерах без заголовка Origin.",
        "Сохранена защита от запросов с чужих сайтов.",
    ],
    "1.2.9": [
        "Добавлены системные журналы OpenWrt и история обновлений.",
        "Появились поиск, обновление списка и экспорт диагностического отчёта.",
    ],
    "1.2.8": [
        "Добавлено обновление OpenWrt APK непосредственно из веб-панели.",
        "Авторизацию теперь можно включать и отключать; по умолчанию она выключена.",
    ],
}


def changelog(version: str) -> str:
    """Return concise reviewed changes; never replace them with generic release text."""
    points = RELEASE_NOTES_RU.get(version)
    if not points or not all(isinstance(item, str) and item.strip() for item in points):
        raise PublisherError(
            f"No reviewed Russian changelog for v{version}; add release highlights before announcing"
        )
    # Keep Telegram previews brief and safely escaped.
    return "\n".join("• " + html.escape(item.strip()) for item in points[:3])


def release_links(version: str) -> dict[str, str]:
    if not VERSION_RE.fullmatch(version):
        raise PublisherError("Invalid release version")
    return {
        "OpenWrt APK": f"https://github.com/{REPO}/releases/tag/cudy-monitor-openwrt-v{version}",
        "Entware IPK": f"https://github.com/{REPO}/releases/tag/cudy-monitor-v{version}",
        "Инструкция": f"https://github.com/{REPO}#readme",
    }


def message(version: str) -> str:
    safe_version = html.escape(version)
    return (
        f"🚀 <b>Cudy Monitor Pro {safe_version} — новый релиз!</b>\n\n"
        f"<b>Что нового:</b>\n{changelog(version)}\n\n"
        "📦 <b>Выберите платформу с помощью кнопок ниже.</b>\n\n"
        "⚠️ Автоматические тесты не заменяют проверку на реальном роутере. "
        "Не открывайте порт панели в интернет.\n"
        "#CudyMonitorPro #Релиз"
    )


def telegram_keyboard(version: str) -> dict:
    urls = release_links(version)
    return {
        "inline_keyboard": [
            [
                {"text": "📦 OpenWrt APK", "url": urls["OpenWrt APK"]},
                {"text": "📦 Entware IPK", "url": urls["Entware IPK"]},
            ],
            [{"text": "📖 Установка и обновление", "url": urls["Инструкция"]}],
        ]
    }


def telegram_send(bot_token: str, chat_id: str, topic_id: int, body: str,
                  *, version: str) -> None:
    payload = {
        "chat_id": chat_id,
        "message_thread_id": topic_id,
        "text": body,
        "parse_mode": "HTML",
        "link_preview_options": {"is_disabled": True},
        "disable_notification": True,
        "reply_markup": telegram_keyboard(version),
    }
    # Never include the bot token or full request URL in errors/logs.
    req = Request(
        f"https://api.telegram.org/bot{bot_token}/sendMessage",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "CudyMonitorPublisher/1.1"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=TIMEOUT) as res:
            raw = res.read(65537)
            if len(raw) > 65536:
                raise PublisherError("Telegram response exceeded safe size; delivery uncertain")
            try:
                value = json.loads(raw)
            except (ValueError, UnicodeError):
                raise PublisherError(
                    "Telegram returned an unreadable response; delivery uncertain, do not retry blindly"
                ) from None
    except HTTPError as ex:
        raise PublisherError(f"Telegram rejected announcement (HTTP {ex.code}); check bot, chat and topic access") from None
    except (URLError, TimeoutError):
        raise PublisherError("Telegram connection failed; inspect topic before retrying") from None
    if value.get("ok") is not True or not value.get("result", {}).get("message_id"):
        raise PublisherError("Telegram did not confirm the message")


def main() -> int:
    gh_token = os.environ.get("GH_TOKEN", "").strip()
    bot = os.environ.get("CUDY_TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("CUDY_TELEGRAM_CHAT_ID", "").strip()
    topic = os.environ.get("CUDY_TELEGRAM_TOPIC_ID", "").strip()
    if not gh_token:
        raise PublisherError("Missing GH_TOKEN")
    if not bot or not chat or not topic:
        missing = [name for name, value in (
            ("CUDY_TELEGRAM_BOT_TOKEN", bot),
            ("CUDY_TELEGRAM_CHAT_ID", chat),
            ("CUDY_TELEGRAM_TOPIC_ID", topic),
        ) if not value]
        raise PublisherError(
            "Telegram auto-publishing not configured. Missing GitHub Actions secrets: "
            + ", ".join(missing)
        )
    if not topic.isdecimal() or int(topic) <= 0:
        raise PublisherError("Invalid Telegram topic ID")
    version = version_from_source()
    marker = f"telegram-announced-v{version}"
    if github_request(f"git/ref/tags/{quote(marker)}", gh_token) is not None:
        print(f"Already announced Cudy Monitor Pro {version}; no duplicate")
        return 0
    if version in MANUAL_REVIEW_VERSIONS:
        print(f"Delivery of Cudy Monitor Pro {version} is ambiguous; manual Telegram topic inspection required. No duplicate sent.")
        return 0
    attempt = f"telegram-attempted-v{version}"
    if github_request(f"git/ref/tags/{quote(attempt)}", gh_token) is not None:
        raise PublisherError(
            "A previous Telegram send was attempted for this version; inspect the topic before retrying"
        )

    apk_tag = f"cudy-monitor-openwrt-v{version}"
    ipk_tag = f"cudy-monitor-v{version}"
    apk_meta = github_request(f"releases/tags/{quote(apk_tag)}", gh_token)
    ipk_meta = github_request(f"releases/tags/{quote(ipk_tag)}", gh_token)
    apk_asset = f"cudy-monitor-pro-{version}-r1.apk"
    ipk_asset = f"cudy-monitor-pro_{version}-1_aarch64-3.10.ipk"
    if not validated_release(apk_meta, apk_tag, apk_asset):
        print(f"Not ready: verified native OpenWrt APK {version} is missing")
        return 0
    if not validated_release(ipk_meta, ipk_tag, ipk_asset):
        print(f"Not ready: verified Entware IPK {version} is missing")
        return 0

    head = github_request("git/ref/heads/main", gh_token)
    sha = (head or {}).get("object", {}).get("sha")
    if not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise PublisherError("Cannot reserve announcement before sending")
    # Durable at-most-once reservation: even if Telegram accepts a message and
    # the response is lost, another workflow run cannot create a duplicate.
    github_request(
        "git/refs", gh_token, method="POST",
        payload={"ref": f"refs/tags/{attempt}", "sha": sha},
    )
    telegram_send(bot, chat, int(topic), message(version), version=version)
    github_request(
        "git/refs", gh_token, method="POST",
        payload={"ref": f"refs/tags/{marker}", "sha": sha},
    )
    print(f"Announced Cudy Monitor Pro {version}; saved idempotency marker")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except PublisherError as error:
        print(f"Release notification error: {error}", file=sys.stderr)
        sys.exit(1)
