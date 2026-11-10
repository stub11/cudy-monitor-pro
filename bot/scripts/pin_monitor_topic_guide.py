#!/usr/bin/env python3
"""Pin one public, privacy-safe welcome note in the CM Aurora forum topic.

This script is invoked by a single audited GitHub Actions release step.
It never prints credentials, user identifiers, or group internals.
"""
import json
import os
import sys
from urllib.request import Request, urlopen

CHAT_ID = "-1003834368989"
TOPIC_ID = 87621
TOKEN = os.environ.get("CUDY_TELEGRAM_BOT_TOKEN", "")

WELCOME = """📌 Cudy Monitor Pro • CM Aurora — начните здесь

Добро пожаловать! В этой теме обсуждаем веб-монитор роутеров Cudy Monitor Pro и отдельное Android-приложение CM Aurora.

📖 Установка, обновление, совместимость и документация монитора:
https://github.com/stub11/cudy-monitor-pro#readme

🤖 Помощь @Cudyapp:
• /cudy_help — список частых вопросов;
• «Как установить монитор?» — ответ по публичному README;
• /cudy_problem — сообщить о проблеме: бот задаст 3 вопроса с кнопками и предложит подсказки.

🔐 Пожалуйста, не присылайте пароли, токены, внешний IP, приватные адреса и необработанные журналы. Перед установкой сохраните резервную копию конфигурации роутера. Не открывайте веб-панель в интернет.

🐛 Если проблема не решена, бот поможет подготовить обезличенный отчёт. Публикация в GitHub возможна только после вашего согласия; автоматическая отправка Issues пока отключена.

💬 Задавайте вопросы по теме и избегайте флуда. Cudy Monitor Pro находится на стадии публичного тестирования; CM Aurora — отдельный проект.
"""

def telegram(method, payload):
    req = Request(
        "https://api.telegram.org/bot" + TOKEN + "/" + method,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=18) as response:
            reply = json.loads(response.read(30000))
    except Exception:
        raise RuntimeError("Telegram " + method + " request failed") from None
    if not reply.get("ok"):
        raise RuntimeError("Telegram " + method + " was rejected") from None
    return reply["result"]

def main():
    if not TOKEN:
        raise RuntimeError("Telegram secret is unavailable")
    me = telegram("getMe", {})
    member = telegram("getChatMember", {"chat_id": CHAT_ID, "user_id": me["id"]})
    has_pin = member.get("status") == "creator" or (
        member.get("status") == "administrator"
        and bool(member.get("can_pin_messages"))
    )
    if not has_pin:
        raise RuntimeError("Bot lacks can_pin_messages permission; no message sent")

    sent = telegram("sendMessage", {
        "chat_id": CHAT_ID,
        "message_thread_id": TOPIC_ID,
        "text": WELCOME,
        "disable_notification": True,
        "disable_web_page_preview": True,
    })
    if sent.get("message_thread_id") not in (TOPIC_ID, None):
        raise RuntimeError("Sent message thread mismatch; pin aborted")
    message_id = sent["message_id"]
    telegram("pinChatMessage", {
        "chat_id": CHAT_ID, "message_id": message_id,
        "disable_notification": True,
    })
    print("SUCCESS: Welcome guide pinned inside CM Aurora topic.")
    print("Pinned message ID:", message_id)
    print("Topic link: https://t.me/zapret2keenetic/87621/" + str(message_id))

if __name__ == "__main__":
    try:
        main()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
