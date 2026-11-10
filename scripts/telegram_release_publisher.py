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


def changelog(version: str) -> str:
    source = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    match = re.search(
        rf"(?ms)^## {re.escape(version)}[^\n]*\n(.*?)(?=^## |\Z)", source
    )
    if not match:
        return "Новая версия доступна для OpenWrt и Entware."
    points = []
    for item in match.group(1).splitlines():
        item = item.strip().lstrip("- ").strip()
        if item and not item.startswith("#"):
            points.append(item)
        if len(points) == 3:
            break
    result = "\n".join("• " + html.escape(x[:180]) for x in points)
    return result[:700] or "Обновление опубликовано."


def message(version: str) -> str:
    safe_version = html.escape(version)
    apk = f"https://github.com/{REPO}/releases/tag/cudy-monitor-openwrt-v{version}"
    ipk = f"https://github.com/{REPO}/releases/tag/cudy-monitor-v{version}"
    return (
        f"🚀 <b>Cudy Monitor Pro {safe_version} — новый релиз</b>\n\n"
        f"{changelog(version)}\n\n"
        "✅ Два пакета опубликованы и проверены сборкой GitHub Actions:\n"
        f'📦 <a href="{apk}">OpenWrt APK</a>\n'
        f'📦 <a href="{ipk}">Keenetic Ported / Entware IPK</a>\n\n'
        f'📖 <a href="https://github.com/{REPO}#readme">Установка, обновление и удаление</a>\n\n'
        "⚠️ Проверка CI не заменяет тестирование на реальном роутере. "
        "Не открывайте панель в интернет.\n"
        "#CudyMonitorPro #Релиз"
    )


def telegram_send(bot_token: str, chat_id: str, topic_id: int, body: str) -> None:
    payload = {
        "chat_id": chat_id,
        "message_thread_id": topic_id,
        "text": body,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
        "disable_notification": True,
    }
    # Never include the bot token or full request URL in errors/logs.
    req = Request(
        f"https://api.telegram.org/bot{bot_token}/sendMessage",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "CudyMonitorPublisher/1.0"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=TIMEOUT) as res:
            value = json.loads(res.read(4096))
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
        print("Telegram auto-publishing not configured: add repository Actions secrets")
        return 0
    if not topic.isdecimal() or int(topic) <= 0:
        raise PublisherError("Invalid Telegram topic ID")
    version = version_from_source()
    marker = f"telegram-announced-v{version}"
    if github_request(f"git/ref/tags/{quote(marker)}", gh_token) is not None:
        print(f"Already announced Cudy Monitor Pro {version}; no duplicate")
        return 0

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

    telegram_send(bot, chat, int(topic), message(version))
    head = github_request("git/ref/heads/main", gh_token)
    sha = (head or {}).get("object", {}).get("sha")
    if not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise PublisherError("Could not mark announcement; check for duplicates before retry")
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
