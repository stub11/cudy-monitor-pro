#!/usr/bin/env python3
"""One-time QA request to the first Netis N6 MIPSEL tester in the monitor topic.
Replies to the published APK document; no user IDs are inferred or exposed.
"""
import json
import os
import re
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from telegram_release_publisher import github_request, PublisherError

CHAT_ID = "-1003834368989"
TOPIC_ID = 87621
APK_MESSAGE_ID = 96253
ATTEMPT = "telegram-netis-n6-qa-attempted-2026-11-18"
SENT = "telegram-netis-n6-qa-sent-2026-11-18"
MESSAGE = (
    "🦊 <b>Netis N6 / OpenWrt MIPSEL — просьба к первому тестеру</b>\n\n"
    "Спасибо за первый скриншот! Монитор 1.2.26 уже запускается: видны CPU, RAM, WAN "
    "и графики. Есть замечание: подпись в боковой панели ошибочно показывает "
    "KeeneticOS/ARM64 — исправляем (PR #143).\n\n"
    "🙏 <b>Пожалуйста, ответь на это сообщение:</b>\n"
    "1️⃣ Какая версия OpenWrt, архитектура и пакетный менеджер? "
    "Пришли вывод <code>cat /etc/openwrt_release</code> "
    "(без личных данных) и <code>apk --print-arch</code> "
    "или напиши <code>opkg</code>.\n"
    "2️⃣ CPU/RAM/WAN показываются правдоподобно? Сравни с "
    "<code>top</code>, <code>free</code> и <code>ip -s link</code>; "
    "достаточно цифр, без полного лога.\n"
    "3️⃣ Через 10 минут панель и графики продолжают обновляться? "
    "Есть зависания или большой расход RAM?\n"
    "4️⃣ Что ещё не работает? Пришли скриншот или текст ошибки без IP, "
    "MAC, токенов и паролей.\n\n"
    "📦 <b>APK прикреплён к сообщению, на которое отвечаю.</b> "
    "Не нужно скачивать из Actions.\n"
    "⚠️ Только OpenWrt <code>ramips/mt7621</code> + <code>mipsel_24kc</code> "
    "с <code>apk</code>; на MIPSEL <b>не запускай OTA</b>.\n"
    "Все результаты фиксируем в GitHub Issue #139."
)


def send(bot_token: str) -> int:
    payload = {
        "chat_id": CHAT_ID,
        "message_thread_id": TOPIC_ID,
        "reply_parameters": {"message_id": APK_MESSAGE_ID, "allow_sending_without_reply": False},
        "text": MESSAGE,
        "parse_mode": "HTML",
        "disable_notification": True,
        "link_preview_options": {"is_disabled": True},
    }
    req = Request(
        f"https://api.telegram.org/bot{bot_token}/sendMessage",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "CudyMonitorNetisTesterFollowup/1.0"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=25) as res:
            raw = res.read(65537)
        if len(raw) > 65536:
            raise PublisherError("Telegram response oversized; check topic before retry")
        data = json.loads(raw)
    except HTTPError as exc:
        raise PublisherError(f"Telegram request failed HTTP {exc.code}; no blind retry") from None
    except (URLError, TimeoutError, ValueError, UnicodeError):
        raise PublisherError("Telegram delivery uncertain; inspect topic before retry") from None
    message = data.get("result", {}) if isinstance(data, dict) else {}
    if data.get("ok") is not True or not isinstance(message.get("message_id"), int):
        raise PublisherError("Telegram did not confirm the QA question")
    if message.get("message_thread_id") not in (None, TOPIC_ID):
        raise PublisherError("Telegram confirmation is from wrong topic")
    if message.get("reply_to_message", {}).get("message_id") not in (None, APK_MESSAGE_ID):
        raise PublisherError("Reply confirmation references unexpected message")
    return message["message_id"]


def main() -> int:
    gh = os.environ.get("GH_TOKEN", "").strip()
    token = os.environ.get("CUDY_TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("CUDY_TELEGRAM_CHAT_ID", "").strip()
    topic = os.environ.get("CUDY_TELEGRAM_TOPIC_ID", "").strip()
    if not gh or not token or chat not in (CHAT_ID, "@zapret2keenetic") or topic != str(TOPIC_ID):
        raise PublisherError("Missing or incorrect monitor forum configuration")
    if github_request(f"git/ref/tags/{SENT}", gh):
        print("Netis N6 follow-up already sent; no duplicate")
        return 0
    if github_request(f"git/ref/tags/{ATTEMPT}", gh):
        print("Previous Netis N6 follow-up delivery uncertain; inspect thread, no duplicate")
        return 0
    head = github_request("git/ref/heads/main", gh)
    sha = (head or {}).get("object", {}).get("sha", "")
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise PublisherError("Cannot reserve one-time Telegram send")
    github_request("git/refs", gh, method="POST",
                   payload={"ref": "refs/tags/" + ATTEMPT, "sha": sha})
    mid = send(token)
    github_request("git/refs", gh, method="POST",
                   payload={"ref": "refs/tags/" + SENT, "sha": sha})
    print(f"Netis N6 tester QA request sent: message_id={mid}; reply_to={APK_MESSAGE_ID}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except PublisherError as exc:
        print(f"Netis N6 QA request: {exc}", file=sys.stderr)
        sys.exit(1)
