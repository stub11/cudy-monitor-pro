#!/usr/bin/env python3
"""Non-destructive Telegram permission probe. Never prints the bot token."""
import json
import os
import sys
import urllib.error
import urllib.request

token = os.environ.get("CUDY_TELEGRAM_BOT_TOKEN", "")
chat_id = os.environ.get("CUDY_TELEGRAM_CHAT_ID", "-1003834368989")
if not token:
    print("ERROR: bot secret is absent")
    sys.exit(2)

def call(method, payload):
    request = urllib.request.Request(
        "https://api.telegram.org/bot" + token + "/" + method,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        body = json.loads(response.read(65536))
    if not body.get("ok"):
        raise RuntimeError(method + " failed")
    return body["result"]

try:
    bot = call("getMe", {})
    member = call("getChatMember", {"chat_id": chat_id, "user_id": bot["id"]})
except Exception:
    print("ERROR: permission probe failed (no secret or Telegram payload logged)")
    sys.exit(1)

status = member.get("status", "unknown")
delete = bool(member.get("can_delete_messages", False))
print("Bot identity verified:", bot.get("username") == "Cudyapp")
print("Group ID matches configured target:", chat_id == "-1003834368989")
print("Member status:", status)
print("Can delete messages:", str(delete).lower())
if bot.get("username", "").lower() != "cudyapp" or status not in ("administrator", "creator") or not delete:
    sys.exit(1)
