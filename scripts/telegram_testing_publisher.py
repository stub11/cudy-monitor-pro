#!/usr/bin/env python3
"""Post concise verified OpenWrt test-build announcements in the monitor topic.

The normal stable release publisher stays independent. At-most-once tags prevent
duplicate Telegram posts even if the bot accepts a message but times out.
No home router, personal machine, firmware or service operations.
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from telegram_release_publisher import github_request, PublisherError

REPOSITORY = "stub11/cudy-monitor-pro"
GROUP_ID = "-1003834368989"
TOPIC_ID = 87621
CANDIDATE_WORKFLOW = "openwrt-candidate-126.yml"
CANDIDATE_NAME = "cudy-openwrt-candidate-1.2.26-arm64-not-released"
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
SHA_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
TIMEOUT = 20
DOC_URL = f"https://github.com/{REPOSITORY}/blob/main/docs/OPENWRT-OTA-CHANNELS-RU.md"
ISSUE_URL = f"https://github.com/{REPOSITORY}/issues/43"


def eligible_candidate(run: object, artifacts: object) -> bool:
    if not isinstance(run, dict) or not isinstance(artifacts, dict):
        return False
    if (run.get("name") != "Build isolated OpenWrt candidate APK 1.2.26 (no release)"
        or run.get("status") != "completed" or run.get("conclusion") != "success"
        or run.get("head_branch") != "main"
        or not re.fullmatch(r"[a-f0-9]{40}", str(run.get("head_sha", "")))):
        return False
    return any(
        isinstance(a, dict) and a.get("name") == CANDIDATE_NAME
        and a.get("expired") is False
        and isinstance(a.get("size_in_bytes"), int) and a["size_in_bytes"] > 10000
        and SHA_RE.fullmatch(str(a.get("digest", "")))
        for a in artifacts.get("artifacts", [])
    )


def eligible_prerelease(item: object) -> bool:
    if not isinstance(item, dict) or item.get("prerelease") is not True or item.get("draft") is not False:
        return False
    tag = item.get("tag_name", "")
    prefix = "cudy-monitor-openwrt-v"
    if not isinstance(tag, str) or not tag.startswith(prefix):
        return False
    version = tag[len(prefix):]
    if not VERSION_RE.fullmatch(version) or tuple(map(int, version.split("."))) <= (1, 2, 25):
        return False
    return any(
        isinstance(asset, dict)
        and asset.get("name") == f"cudy-monitor-pro-{version}-r1.apk"
        and asset.get("state") == "uploaded"
        and isinstance(asset.get("size"), int) and asset["size"] > 10000
        and SHA_RE.fullmatch(str(asset.get("digest", "")))
        for asset in item.get("assets", [])
    )


def candidate_message(run: dict) -> tuple[str, dict]:
    rid = run["id"]
    url = f"https://github.com/{REPOSITORY}/actions/runs/{rid}"
    body = (
        "🧪 <b>Cudy Monitor Pro 1.2.26 — тестовый OpenWrt APK</b>\n"
        "Не стабильный релиз! Доступен как артефакт GitHub Actions.\n\n"
        "👤 <b>Кому:</b> добровольцам с отдельным тестовым ARM64-роутером "
        "на OpenWrt 25.12+ и <code>apk</code>. "
        "<b>Не</b> KeeneticOS/Entware и <b>не</b> основной домашний роутер.\n\n"
        "1️⃣ Сохраните резервную копию роутера.\n"
        "2️⃣ Скачайте ZIP из Actions → Artifacts, извлеките APK, сверьте "
        "<code>sha256sum</code> с файлом <code>SHA256SUMS</code>.\n"
        "3️⃣ Перенесите APK в <code>/tmp</code>; на тестовом OpenWrt:\n"
        "<code>apk add --allow-untrusted /tmp/cudy-monitor-pro-1.2.26-r1.apk</code>\n"
        "4️⃣ Проверьте запуск панели, CPU/RAM/WAN, графики, службы, "
        "переподключение и <code>--diagnose</code>.\n"
        "5️⃣ Напишите модель, OpenWrt, результат и текст ошибки через "
        "<code>/cudy_problem</code> в этой теме.\n\n"
        "⚠️ Автоматическое OTA между двумя кандидатами <b>пока не тестируем</b> — "
        "для него потребуется следующий Pre-release. "
        "Не присылайте IP, токены и необработанные журналы."
    )
    return body, {"inline_keyboard": [
        [{"text": "📦 APK из Actions", "url": url}],
        [{"text": "📖 План тестов", "url": DOC_URL},
         {"text": "🐛 Замечания", "url": ISSUE_URL}],
    ]}


def prerelease_message(release: dict) -> tuple[str, dict]:
    version = release["tag_name"].removeprefix("cudy-monitor-openwrt-v")
    tag = html.escape(version)
    url = f"https://github.com/{REPOSITORY}/releases/tag/{quote(release['tag_name'])}"
    body = (
        f"🧪 <b>Cudy Monitor Pro {tag} — тестовый OpenWrt Pre-release</b>\n"
        "Не обновление для всех! Только добровольцам с резервным "
        "ARM64-роутером на OpenWrt 25.12+ (<code>apk</code>).\n\n"
        "1️⃣ Сделайте бэкап. Проверьте SHA-256 APK на странице релиза.\n"
        "2️⃣ Если уже установлен тестовый монитор с каналом testing:\n"
        "<code>sh /usr/share/cudy-monitor-pro/update-native.sh --check-testing</code>\n"
        "3️⃣ После осознанного согласия и бэкапа:\n"
        "<code>sh /usr/share/cudy-monitor-pro/update-native.sh --apply-testing --confirm-testing</code>\n"
        "4️⃣ Сверьте версии файла и запущенного монитора через <code>--diagnose</code>, "
        "проверьте веб-панель, графики, WAN и отсутствие проблем после рестарта.\n"
        "5️⃣ Результаты и ошибки — в <code>/cudy_problem</code> в этой ветке.\n\n"
        "⚠️ Не использовать на основном роутере, KeeneticOS или Entware. "
        "Не публикуйте IP-адреса, пароли и сырые логи."
    )
    return body, {"inline_keyboard": [
        [{"text": "📦 Тестовый Pre-release", "url": url}],
        [{"text": "📖 Инструкция", "url": DOC_URL},
         {"text": "🐛 Отчёт", "url": ISSUE_URL}],
    ]}


def telegram_send(token: str, chat: str, topic: int, body: str, keyboard: dict) -> int:
    payload = {
        "chat_id": chat, "message_thread_id": topic,
        "text": body, "parse_mode": "HTML",
        "disable_notification": True,
        "link_preview_options": {"is_disabled": True},
        "reply_markup": keyboard,
    }
    req = Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "CudyMonitorTestPublisher/1.0"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=TIMEOUT) as res:
            raw = res.read(65537)
            if len(raw) > 65536:
                raise PublisherError("Telegram response oversized; delivery uncertain, inspect topic")
            try:
                reply = json.loads(raw)
            except (UnicodeError, ValueError):
                raise PublisherError("Telegram response unreadable; delivery uncertain, inspect topic") from None
    except HTTPError as exc:
        raise PublisherError(f"Telegram rejected test notice (HTTP {exc.code})") from None
    except (URLError, TimeoutError):
        raise PublisherError("Telegram transport uncertain; inspect topic before retry") from None
    msg = reply.get("result")
    if reply.get("ok") is not True or not isinstance(msg, dict) or not isinstance(msg.get("message_id"), int):
        raise PublisherError("Telegram did not confirm test notice; inspect topic")
    if msg.get("message_thread_id") not in (None, topic):
        raise PublisherError("Telegram responded with different forum topic; inspect group")
    return msg["message_id"]


def mark_once(key: str, github_token: str, telegram_token: str, body: str, keyboard: dict) -> bool:
    if not re.fullmatch(r"[a-z0-9-]{10,110}", key):
        raise PublisherError("Invalid idempotency key")
    sent = f"telegram-testing-announced-{key}"
    attempt = f"telegram-testing-attempted-{key}"
    if github_request(f"git/ref/tags/{sent}", github_token):
        print(f"Already announced testing item {key}")
        return False
    if github_request(f"git/ref/tags/{attempt}", github_token):
        print(f"Unresolved earlier delivery attempt for {key}; inspect Telegram before retry")
        return False
    head = github_request("git/ref/heads/main", github_token)
    sha = (head or {}).get("object", {}).get("sha", "")
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise PublisherError("Cannot reserve testing announcement")
    github_request("git/refs", github_token, method="POST",
                   payload={"ref": f"refs/tags/{attempt}", "sha": sha})
    mid = telegram_send(telegram_token, GROUP_ID, TOPIC_ID, body, keyboard)
    github_request("git/refs", github_token, method="POST",
                   payload={"ref": f"refs/tags/{sent}", "sha": sha})
    print(f"Published testing notice {key}, Telegram message ID {mid}")
    return True


def main() -> int:
    gh = os.environ.get("GH_TOKEN", "").strip()
    bot = os.environ.get("CUDY_TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("CUDY_TELEGRAM_CHAT_ID", "").strip()
    thread = os.environ.get("CUDY_TELEGRAM_TOPIC_ID", "").strip()
    if not gh or not bot or chat not in (GROUP_ID, "@zapret2keenetic") or thread != str(TOPIC_ID):
        raise PublisherError("Missing or mismatched Telegram monitor topic configuration")
    candidate_runs = github_request(
        f"actions/workflows/{CANDIDATE_WORKFLOW}/runs?branch=main&status=success&per_page=5", gh
    ) or {}
    for run in candidate_runs.get("workflow_runs", []):
        if not isinstance(run, dict) or not isinstance(run.get("id"), int):
            continue
        rid = run["id"]
        artifacts = github_request(f"actions/runs/{rid}/artifacts", gh) or {}
        if eligible_candidate(run, artifacts):
            body, keyboard = candidate_message(run)
            mark_once(f"candidate-126-{rid}", gh, bot, body, keyboard)
            break

    releases = github_request("releases?per_page=20", gh) or []
    for rel in releases:
        if eligible_prerelease(rel):
            body, keyboard = prerelease_message(rel)
            mark_once(f"prerelease-{rel['tag_name'].removeprefix('cudy-monitor-openwrt-v').replace('.', '-')}", gh, bot, body, keyboard)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except PublisherError as exc:
        print(f"Testing announcement error: {exc}", file=sys.stderr)
        sys.exit(1)
