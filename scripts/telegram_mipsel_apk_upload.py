#!/usr/bin/env python3
"""Publish one vetted MIPSEL APK as a Telegram document in the monitor topic.

Runs only inside GitHub Actions. The APK is never installed on a router and
never written to the user's PC. Uses a durable at-most-once attempted tag.
"""
from __future__ import annotations

from hashlib import sha256
from io import BytesIO
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zipfile import ZipFile, BadZipFile

from telegram_release_publisher import github_request, PublisherError

REPO = "stub11/cudy-monitor-pro"
RUN_ID = 44068567009
ARTIFACT_ID = 14321981206
ARTIFACT = "cudy-openwrt-mipsel-24kc-mt7621-qa-1.2.26-not-released"
SOURCE_SHA = "3c777f19143e1891c67b63e82392a396535caa1c"
APK = "cudy-monitor-pro-1.2.26-r1.apk"
GROUP = "-1003834368989"
TOPIC = 87621
ATTEMPT = "telegram-mipsel-apk-attempted-1-2-26-mt7621"
ANNOUNCED = "telegram-mipsel-apk-sent-1-2-26-mt7621"
MAX_ZIP = 8_000_000
MAX_APK = 7_000_000

CAPTION = (
    "🧪 <b>Cudy Monitor Pro 1.2.26 — MIPSEL APK для теста</b>\n"
    "📦 OpenWrt 25.12+, только <code>ramips/mt7621</code> / <code>mipsel_24kc</code> "
    "(например, Netis N6 с соответствующей прошивкой).\n\n"
    "Перед установкой: бэкап, <code>cat /etc/openwrt_release</code>, "
    "<code>apk --print-arch</code>. Если ABI не совпадает — не устанавливать.\n"
    "Установка с локально сохранённого файла:\n"
    "<code>apk add --allow-untrusted /tmp/cudy-monitor-pro-1.2.26-r1.apk</code>\n"
    "Проверить CPU, RAM, WAN, графики, службы и работу 10 минут. "
    "Результат отправить в эту тему: модель, target, версия OpenWrt и обезличенная ошибка.\n\n"
    "⚠️ Только для запасного тестового роутера. <b>OTA MIPSEL пока заблокирован.</b> "
    "Не для ARM64, Keenetic/Entware и не для рабочего роутера."
)


def verify_artifact(run: object, meta: object, archive: bytes) -> tuple[bytes, str]:
    if not isinstance(run, dict) or not isinstance(meta, dict):
        raise PublisherError("Missing GitHub build evidence")
    if (run.get("id") != RUN_ID or run.get("status") != "completed"
        or run.get("conclusion") != "success" or run.get("head_branch") != "main"
        or run.get("head_sha") != SOURCE_SHA):
        raise PublisherError("GitHub build is not the approved MIPSEL main build")
    if (meta.get("id") != ARTIFACT_ID or meta.get("name") != ARTIFACT
        or meta.get("expired") is not False
        or meta.get("workflow_run", {}).get("head_sha") != SOURCE_SHA):
        raise PublisherError("Artifact does not match approved MIPSEL build")
    if not isinstance(archive, bytes) or len(archive) > MAX_ZIP:
        raise PublisherError("Invalid artifact archive size")
    if meta.get("digest") != "sha256:" + sha256(archive).hexdigest():
        raise PublisherError("Artifact archive SHA-256 mismatch")

    try:
        with ZipFile(BytesIO(archive)) as z:
            names = z.namelist()
            if set(names) != {APK, "SHA256SUMS", "BUILD-INFO.txt"} or len(names) != 3:
                raise PublisherError("Artifact contains unexpected files")
            if z.getinfo(APK).file_size > MAX_APK:
                raise PublisherError("APK too large")
            apk = z.read(APK)
            sums = z.read("SHA256SUMS").decode("utf-8").strip()
            build = z.read("BUILD-INFO.txt").decode("utf-8")
    except (BadZipFile, ValueError, UnicodeError, OSError) as exc:
        raise PublisherError("Artifact ZIP invalid") from None
    m = re.fullmatch(r"([a-f0-9]{64})  (?:\./)?" + re.escape(APK), sums)
    if not m or sha256(apk).hexdigest() != m.group(1):
        raise PublisherError("APK SHA-256 mismatch")
    expected = (
        "source_commit=" + SOURCE_SHA, "candidate_version=1.2.26",
        "channel=testing", "architecture=mipsel_24kc", "target=ramips/mt7621",
        "not_a_stable_release=true",
    )
    lines = set(build.splitlines())
    if not all(item in lines for item in expected):
        raise PublisherError("Artifact build target or source mismatch")
    return apk, m.group(1)



def verify_downloaded_files(run: object, meta: object, location: str) -> tuple[bytes, str]:
    """Verify extracted files from authenticated GitHub CLI artifact download.

    GitHub CLI handles Actions artifact redirects. SHA256SUMS, ABI and exact
    workflow/commit are checked; no arbitrary files or symlinks are accepted.
    """
    from pathlib import Path
    if not isinstance(run, dict) or not isinstance(meta, dict):
        raise PublisherError("Missing GitHub build evidence")
    if (run.get("id") != RUN_ID or run.get("status") != "completed"
        or run.get("conclusion") != "success" or run.get("head_branch") != "main"
        or run.get("head_sha") != SOURCE_SHA):
        raise PublisherError("GitHub build is not the approved MIPSEL main build")
    if (meta.get("id") != ARTIFACT_ID or meta.get("name") != ARTIFACT
        or meta.get("expired") is not False
        or meta.get("workflow_run", {}).get("head_sha") != SOURCE_SHA
        or not re.fullmatch(r"sha256:[a-f0-9]{64}", str(meta.get("digest", "")))):
        raise PublisherError("Artifact metadata does not match approved MIPSEL build")
    folder = Path(location)
    if not folder.is_dir() or folder.is_symlink():
        raise PublisherError("No verified artifact directory")
    expected_names = {APK, "SHA256SUMS", "BUILD-INFO.txt"}
    if {p.name for p in folder.iterdir()} != expected_names:
        raise PublisherError("Artifact has unexpected files")
    for name in expected_names:
        p = folder / name
        if not p.is_file() or p.is_symlink():
            raise PublisherError("Unexpected artifact file type")
    apk_path = folder / APK
    if apk_path.stat().st_size < 10000 or apk_path.stat().st_size > MAX_APK:
        raise PublisherError("Invalid APK size")
    apk = apk_path.read_bytes()
    sums = (folder / "SHA256SUMS").read_text(encoding="utf-8").strip()
    build = (folder / "BUILD-INFO.txt").read_text(encoding="utf-8")
    m = re.fullmatch(r"([a-f0-9]{64})  (?:\./)?" + re.escape(APK), sums)
    if not m or sha256(apk).hexdigest() != m.group(1):
        raise PublisherError("APK SHA256SUMS mismatch")
    expected_build = {
        "source_commit=" + SOURCE_SHA, "candidate_version=1.2.26",
        "channel=testing", "architecture=mipsel_24kc", "target=ramips/mt7621",
        "not_a_stable_release=true",
    }
    if not expected_build.issubset(set(build.splitlines())):
        raise PublisherError("Artifact build metadata mismatch")
    return apk, m.group(1)


def download_archive(token: str) -> bytes:
    req = Request(
        f"https://api.github.com/repos/{REPO}/actions/artifacts/{ARTIFACT_ID}/zip",
        headers={"Authorization": f"Bearer {token}",
                 "Accept": "application/vnd.github+json",
                 "User-Agent": "CudyMonitorMipselTelegramUpload/1.0"},
    )
    try:
        with urlopen(req, timeout=50) as resp:
            raw = resp.read(MAX_ZIP + 1)
        if len(raw) > MAX_ZIP:
            raise PublisherError("Artifact ZIP oversized")
        return raw
    except HTTPError as e:
        raise PublisherError(f"Could not fetch verified APK ZIP (HTTP {e.code})") from None
    except (URLError, TimeoutError):
        raise PublisherError("Artifact download failed") from None


def send_document(bot: str, apk: bytes, digest: str) -> int:
    boundary = "CudyMonitorMipselDocumentBoundary"
    fields = {
        "chat_id": GROUP,
        "message_thread_id": str(TOPIC),
        "caption": CAPTION + "\n\nSHA-256 APK: <code>" + digest + "</code>",
        "parse_mode": "HTML",
        "disable_notification": "true",
        "protect_content": "false",
    }
    body = bytearray()
    for name, value in fields.items():
        body.extend(("--" + boundary + "\r\nContent-Disposition: form-data; name=\""
                     + name + "\"\r\n\r\n" + value + "\r\n").encode("utf-8"))
    body.extend(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"document\"; filename=\""
                 + APK + "\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode())
    body.extend(apk)
    body.extend(("\r\n--" + boundary + "--\r\n").encode())
    req = Request(
        f"https://api.telegram.org/bot{bot}/sendDocument",
        data=bytes(body),
        headers={"Content-Type": "multipart/form-data; boundary=" + boundary,
                 "User-Agent": "CudyMonitorMipselTelegramUpload/1.0"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=60) as res:
            raw = res.read(65537)
        if len(raw) > 65536:
            raise PublisherError("Telegram response too large; delivery uncertain")
        result = json.loads(raw)
    except HTTPError as e:
        raise PublisherError(f"Telegram file upload rejected (HTTP {e.code})") from None
    except (URLError, TimeoutError, ValueError, UnicodeError):
        raise PublisherError("Telegram file delivery uncertain; inspect topic before retry") from None
    message = result.get("result", {}) if isinstance(result, dict) else {}
    if result.get("ok") is not True or not isinstance(message.get("message_id"), int):
        raise PublisherError("Telegram did not confirm MIPSEL document")
    if message.get("message_thread_id") not in (None, TOPIC):
        raise PublisherError("Telegram document landed in unexpected topic; inspect immediately")
    return message["message_id"]


def main() -> int:
    token = os.environ.get("GH_TOKEN", "").strip()
    bot = os.environ.get("CUDY_TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("CUDY_TELEGRAM_CHAT_ID", "").strip()
    topic = os.environ.get("CUDY_TELEGRAM_TOPIC_ID", "").strip()
    if not token or not bot or chat not in (GROUP, "@zapret2keenetic") or topic != str(TOPIC):
        raise PublisherError("Telegram bot or exact topic not configured")
    if github_request(f"git/ref/tags/{ANNOUNCED}", token):
        print("MIPSEL test APK already sent; no duplicate")
        return 0
    if github_request(f"git/ref/tags/{ATTEMPT}", token):
        print("MIPSEL test APK earlier send uncertain; check topic instead of retrying")
        return 0
    run = github_request(f"actions/runs/{RUN_ID}", token)
    meta = github_request(f"actions/artifacts/{ARTIFACT_ID}", token)
    artifact_dir = os.environ.get("CUDY_MIPSEL_ARTIFACT_DIR", "").strip()
    if artifact_dir:
        apk, digest = verify_downloaded_files(run, meta, artifact_dir)
    else:
        archive = download_archive(token)
        apk, digest = verify_artifact(run, meta, archive)
    head = github_request("git/ref/heads/main", token)
    sha = (head or {}).get("object", {}).get("sha", "")
    if not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise PublisherError("Unable to reserve Telegram delivery")
    github_request("git/refs", token, method="POST",
                   payload={"ref": f"refs/tags/{ATTEMPT}", "sha": sha})
    message_id = send_document(bot, apk, digest)
    github_request("git/refs", token, method="POST",
                   payload={"ref": f"refs/tags/{ANNOUNCED}", "sha": sha})
    print(f"Published vetted MIPSEL APK as Telegram document ID {message_id}; SHA256 {digest}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except PublisherError as error:
        print(f"MIPSEL Telegram upload: {error}", file=sys.stderr)
        sys.exit(1)
