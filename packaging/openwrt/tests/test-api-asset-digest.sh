#!/bin/sh
# Offline native APK metadata digest scenarios. No network or router changes.
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE="$BASE/files/update-native.sh"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
DIR="$ROOT"
REPO=https://api.github.com/repos/stub11/cudy-monitor-pro
FALLBACK=https://raw.githubusercontent.com/stub11/cudy-monitor-pro/main/packaging/openwrt/release-digests.txt
for fn in read_fallback fallback_digest api_asset_digest package_digest; do
  sed -n "/^$fn(){/,/^}/p" "$SOURCE" >> "$ROOT/helpers.sh"
done
. "$ROOT/helpers.sh"
die(){ echo "ERROR: $*" >&2; exit 1; }
GOOD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
printf '1.2.25 %s\n' "$GOOD" > "$ROOT/good-list"
fetch(){
  case "$1" in
    "$FALLBACK") cp "$ROOT/good-list" "$2" ;;
    "$REPO"/releases/tags/*)
      [ "${API_UNAVAILABLE:-0}" = 0 ] || return 1
      printf '{"assets":[]}' > "$2"
      ;;
    *) return 1 ;;
  esac
}
jsonfilter(){
  case "$*" in
    *'assets[0].name'*) printf '%s\n' "${ASSET_NAME:-}" ;;
    *'assets[0].digest'*) printf '%s\n' "${ASSET_DIGEST:-}" ;;
    *) printf '\n' ;;
  esac
}
USE_FALLBACK=0
ASSET_NAME=cudy-monitor-pro-1.2.25-r1.apk
ASSET_DIGEST=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
[ "$(package_digest 1.2.25)" = bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ] || exit 1
ASSET_DIGEST=
[ "$(package_digest 1.2.25 2>"$ROOT/message")" = "$GOOD" ] || exit 1
grep -q 'asset SHA256 absent/invalid' "$ROOT/message"
ASSET_DIGEST=sha256:not-a-sha
[ "$(package_digest 1.2.25)" = "$GOOD" ] || exit 1
ASSET_NAME=unrelated.apk
[ "$(package_digest 1.2.25)" = "$GOOD" ] || exit 1
ASSET_NAME=cudy-monitor-pro-1.2.25-r1.apk
API_UNAVAILABLE=1
[ "$(package_digest 1.2.25)" = "$GOOD" ] || exit 1
USE_FALLBACK=1
[ "$(package_digest 1.2.25)" = "$GOOD" ] || exit 1
printf '1.2.24 %s\n' "$GOOD" > "$ROOT/good-list"
rm -f "$DIR/release-digests.txt"
if (USE_FALLBACK=0; package_digest 1.2.25) > "$ROOT/out" 2>"$ROOT/err"; then
  echo "Missing published digest was accepted" >&2; exit 1
fi
grep -q 'No verified pinned digest' "$ROOT/err"
echo 'PASS: valid API digest, malformed metadata fallback and missing pinned SHA rejection'
