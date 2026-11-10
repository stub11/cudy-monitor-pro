#!/usr/bin/env python3
"""One-time group chat resolution via a quiet bot confirmation in the configured topic."""
import json, os, sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

token = os.environ.get("CUDY_TELEGRAM_BOT_TOKEN", "")
chat = os.environ.get("CUDY_TELEGRAM_CHAT_ID", "")
topic = os.environ.get("CUDY_TELEGRAM_TOPIC_ID", "")
if not token or not chat or not topic or not topic.isdecimal():
    sys.exit("Missing Telegram settings")

def api(method, values):
    req = Request("https://api.telegram.org/bot" + token + "/" + method,
                  data=urlencode(values).encode("utf-8"), method="POST")
    try:
        with urlopen(req, timeout=18) as res:
            result = json.loads(res.read(20000))
    except HTTPError as e:
        raise RuntimeError("Telegram API error HTTP " + str(e.code) + " (" + method + ")") from None
    if not result.get("ok"):
        raise RuntimeError("Telegram API rejected " + method)
    return result["result"]

try:
    msg = api("sendMessage", {
        "chat_id": chat, "message_thread_id": topic,
        "disable_notification": "true",
        "text": "🤖 Проверка связи Cudyapp для настройки модерации. Релизные уведомления работают отдельно."
    })
    group = msg.get("chat") or {}
    ident = group.get("id")
    if not isinstance(ident, int): raise RuntimeError("Telegram response lacked chat ID")
    # A supergroup ID is not a credential, but never print participant data or messages.
    print("Resolved group ID:", ident)
    print("Group type:", group.get("type"))
    print("Returned topic:", msg.get("message_thread_id"))
    member = api("getChatMember", {"chat_id": str(ident), "user_id": str(msg.get("from", {}).get("id"))})
    print("Bot role:", member.get("status"))
    print("Can delete messages:", member.get("status") == "creator" or bool(member.get("can_delete_messages")))
    print("Moderation allowed:", member.get("status") in ("creator", "administrator") and
          (member.get("status") == "creator" or bool(member.get("can_delete_messages"))))
except RuntimeError as e:
    sys.exit(str(e))
