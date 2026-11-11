#!/bin/sh
# Offline OpenWrt pinned metadata regression: no real internet, apk or router.
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE="$BASE/files/update-native.sh"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
mkdir -p "$ROOT/tmp"
DIR="$ROOT/tmp"
FALLBACK=https://raw.githubusercontent.com/stub11/cudy-monitor-pro/main/packaging/openwrt/release-digests.txt
RELEASE=https://github.com/stub11/cudy-monitor-pro/releases/download
# Extract only production helpers; never run updater initialization or apk.
sed -n '/^read_fallback(){/,/^}/p' "$SOURCE" > "$ROOT/helpers.sh"
sed -n '/^fallback_digest(){/,/^}/p' "$SOURCE" >> "$ROOT/helpers.sh"
sed -n '/^download_verified(){/,/^}/p' "$SOURCE" >> "$ROOT/helpers.sh"
sed -n '/^package_digest(){/,/^}/p' "$SOURCE" >> "$ROOT/helpers.sh"
test -s "$ROOT/helpers.sh"
. "$ROOT/helpers.sh"
die(){ echo "$*" >&2; exit 1; }
printf 'known-good-APK-test-content\n' > "$ROOT/payload"
GOOD=$(sha256sum "$ROOT/payload" | awk '{print $1}')
printf '1.2.21 %s\n1.2.22 %s\n' "$GOOD" "$GOOD" > "$ROOT/good-list"
fetch(){
  case "$1" in
    "$FALLBACK")
      [ "\${API_BLOCKED:-0}" = 1 ] || return 1
      cp "$ROOT/\${LIST_FILE:-good-list}" "$2" ;;
    "$RELEASE"/*)
      cp "$ROOT/payload" "$2" ;;
    *) return 22 ;; # Simulate api.github.com HTTP 403
  esac
}
USE_FALLBACK=1
API_BLOCKED=1
read_fallback
[ "$(fallback_digest 1.2.22)" = "$GOOD" ]
download_verified 1.2.22 "$ROOT/next.apk"
cmp "$ROOT/payload" "$ROOT/next.apk"
if (API_BLOCKED=0; read_fallback) >"$ROOT/out" 2>"$ROOT/err"; then
  echo "Unavailable fallback unexpectedly succeeded" >&2; exit 1
fi
printf '1.2.22 NOT_A_SHA\n' > "$ROOT/bad-list"
if (LIST_FILE=bad-list; read_fallback) >"$ROOT/out" 2>"$ROOT/err"; then
  echo "Invalid digest accepted" >&2; exit 1
fi
printf '1.2.22 %s\n1.2.22 %s\n' "$GOOD" "$GOOD" > "$ROOT/duplicate-list"
if (LIST_FILE=duplicate-list; read_fallback) >"$ROOT/out" 2>"$ROOT/err"; then
  echo "Duplicate version accepted" >&2; exit 1
fi
printf '# comment only\n' > "$ROOT/empty-list"
if (LIST_FILE=empty-list; read_fallback) >"$ROOT/out" 2>"$ROOT/err"; then
  echo "Empty manifest accepted" >&2; exit 1
fi
printf '1.2.22 %064d\n' 0 > "$ROOT/wrong-list"
LIST_FILE=wrong-list read_fallback
if (download_verified 1.2.22 "$ROOT/wrong.apk") >"$ROOT/out" 2>"$ROOT/err"; then
  echo "Incorrect SHA256 accepted" >&2; exit 1
fi
grep -q 'SHA256 mismatch' "$ROOT/err"
printf '1.2.21 %s\n' "$GOOD" > "$ROOT/missing-list"
LIST_FILE=missing-list read_fallback
if (download_verified 1.2.22 "$ROOT/missing.apk") >"$ROOT/out" 2>"$ROOT/err"; then
  echo "Missing version accepted" >&2; exit 1
fi
grep -q 'No verified pinned digest' "$ROOT/err"
echo 'PASS: GitHub API HTTP 403 fallback, invalid SHA, missing versions'
