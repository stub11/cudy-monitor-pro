#!/usr/bin/env python3
"""Register existing Cudyapp webhook from GitHub Actions without exposing token."""
import hashlib
import json
import os
import sys
from urllib.parse import urlparse
from urllib.request import Request, urlopen

SALT = "|cudyapp-topic-webhook-v1"


def validate_url(value: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not parsed.hostname.endswith(".vercel.app")
        or parsed.path != "/api/webhook"
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
        or parsed.port
    ):
        raise ValueError("Webhook URL must be https://<project>.vercel.app/api/webhook")
    return value


def register(token: str, url: str):
    validate_url(url)
    if not token:
        raise ValueError("CUDY_TELEGRAM_BOT_TOKEN must be configured in Actions secrets")
    secret = hashlib.sha256((token + SALT).encode("utf-8")).hexdigest()
    payload = json.dumps({
        "url": url,
        "secret_token": secret,
        "allowed_updates": ["message", "edited_message"],
        "drop_pending_updates": True,
        "max_connections": 8,
    }).encode("utf-8")
    request = Request(
        "https://api.telegram.org/bot" + token + "/setWebhook",
        data=payload,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read(5000))
    except Exception as e:
        # Never print full URL with embedded bot token, request or exception text.
        raise RuntimeError("Telegram webhook registration failed") from None
    if not result.get("ok"):
        raise RuntimeError("Telegram refused webhook registration")
    print("Webhook registered: Telegram will deliver new topic messages to configured Vercel endpoint")


if __name__ == "__main__":
    try:
        register(os.environ.get("CUDY_TELEGRAM_BOT_TOKEN", ""), os.environ.get("CUDYAPP_WEBHOOK_URL", ""))
    except (ValueError, RuntimeError) as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
