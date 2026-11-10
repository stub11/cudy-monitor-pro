#!/usr/bin/env python3
"""Read-only Telegram bot moderation readiness check. Never print token or chat IDs."""
import json
import os
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen

token = os.environ.get("CUDY_TELEGRAM_BOT_TOKEN", "")
chat = os.environ.get("CUDY_TELEGRAM_CHAT_ID", "@zapret2keenetic")
if not token:
    print("BLOCKED: Telegram bot secret not available")
    sys.exit(1)

def call(method, params=None):
    url = "https://api.telegram.org/bot" + token + "/" + method
    data = urlencode(params or {}).encode("utf-8")
    try:
        with urlopen(Request(url, data=data, method="POST"), timeout=15) as r:
            payload = json.loads(r.read(30000))
    except Exception:
        raise RuntimeError("Telegram API request failed: " + method) from None
    if not payload.get("ok"):
        raise RuntimeError("Telegram API rejected: " + method)
    return payload["result"]

try:
    me = call("getMe")
    member = call("getChatMember", {"chat_id": chat, "user_id": me["id"]})
    state = member.get("status", "unknown")
    delete = state == "creator" or (state == "administrator" and bool(member.get("can_delete_messages")))
    info = call("getWebhookInfo")
    configured = bool(info.get("url"))
    print("Bot username:", me.get("username", "unknown"))
    print("Group membership:", state)
    print("Can delete messages:", delete)
    print("Webhook configured:", configured)
    print("Webhook points to own Vercel:", info.get("url", "").startswith("https://cudyapp-community-bot.vercel.app/api/webhook"))
    if not delete:
        print("ACTION_REQUIRED: Grant bot minimal administrator right to delete messages")
    if not configured:
        print("ACTION_REQUIRED: Webhook must be activated AFTER setting Vercel bot token")
except RuntimeError as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
