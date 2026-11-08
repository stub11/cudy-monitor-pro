#!/usr/bin/env python3
"""Low-noise privacy guard for a public repository. Never prints matched secret values."""
from __future__ import annotations
import ipaddress
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
tracked = subprocess.check_output(["git", "-C", str(ROOT), "ls-files", "--cached", "--others", "--exclude-standard", "-z"])
paths = [ROOT / part.decode("utf-8", "replace") for part in tracked.split(b"\0") if part]
bad = []
secrets = [
    ("GitHub token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{25,}\b|github_pat_[A-Za-z0-9_]{25,}")),
    ("API token", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b")),
    ("Private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("AWS key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
]
emails = re.compile(r"(?<![\w])[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}")
ips = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
allowed_ips = {"127.0.0.1", "192.168.1.1", "10.0.0.1", "0.0.0.0"}
for path in paths:
    rel = path.relative_to(ROOT).as_posix()
    if path.suffix.lower() in {".pem", ".p12", ".pfx", ".key", ".ppk", ".env", ".bak", ".log"}:
        bad.append((rel, "sensitive file extension"))
        continue
    if not path.is_file() or path.stat().st_size > 2_000_000:
        continue
    b = path.read_bytes()
    if b"\0" in b[:2048]:
        bad.append((rel, "binary file in tracked content"))
        continue
    try:
        content = b.decode("utf-8-sig")
    except UnicodeDecodeError:
        bad.append((rel, "non-UTF8 content"))
        continue
    for name, regex in secrets:
        if regex.search(content):
            bad.append((rel, name))
    for match in emails.finditer(content):
        if not match.group(0).lower().endswith("@users.noreply.github.com"):
            bad.append((rel, "personal/contact email"))
            break
    for match in ips.finditer(content):
        raw = match.group(0)
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            continue
        if ip.is_private and raw not in allowed_ips:
            bad.append((rel, "non-example private IPv4"))
            break
    if re.search(r"\b(?:imei|serial.?number|router.?password)\s*[:=]\s*[A-Za-z0-9]{12,}", content, re.I):
        bad.append((rel, "possible unique device credential"))
if bad:
    for rel, kind in sorted(set(bad)):
        print(f"PUBLIC CONTENT CHECK FAILED: {rel}: {kind}", file=sys.stderr)
    sys.exit(1)
print(f"Public content guard OK: {len(paths)} repository files inspected")
