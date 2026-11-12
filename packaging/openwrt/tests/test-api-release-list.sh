#!/bin/sh
# No network, APK installation, router mutation, or user data.
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE="$BASE/files/update-native.sh"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
sed -n '/^newer(){/,/^}/p' "$SOURCE" > "$ROOT/helpers"
sed -n '/^parse_api_releases(){/,/^}/p' "$SOURCE" >> "$ROOT/helpers"
# This one-line predicate is used verbatim in production.
grep '^valid_version(){' "$SOURCE" >> "$ROOT/helpers"
. "$ROOT/helpers"
DIR=$ROOT
CURRENT=1.2.21
jsonfilter() {
  [ "${PARSE_OK:-1}" = 1 ] || return 1
  printf '%s\n' "${TAGS:-}"
}
LATEST=$CURRENT
PARSE_OK=0
TAGS='cudy-monitor-openwrt-v9.9.9'
if parse_api_releases; then echo 'invalid API JSON accepted' >&2; exit 1; fi
LATEST=$CURRENT
PARSE_OK=1
TAGS=''
if parse_api_releases; then echo 'empty release list accepted' >&2; exit 1; fi
LATEST=$CURRENT
TAGS='cudy-monitor-v1.2.25'
if parse_api_releases; then echo 'Entware-only list accepted for OpenWrt' >&2; exit 1; fi
LATEST=$CURRENT
TAGS='cudy-monitor-openwrt-vnot-a-version'
if parse_api_releases; then echo 'malformed OpenWrt tag accepted' >&2; exit 1; fi
LATEST=$CURRENT
TAGS='cudy-monitor-v1.2.25 cudy-monitor-openwrt-v1.2.22 cudy-monitor-openwrt-v1.2.25 cudy-monitor-openwrt-v1.2.23'
parse_api_releases
[ "$LATEST" = 1.2.25 ] || { echo 'did not select newest valid release' >&2; exit 1; }
LATEST=1.2.25
TAGS='cudy-monitor-openwrt-v1.2.22'
parse_api_releases
[ "$LATEST" = 1.2.25 ] || { echo 'downgrade of release candidate' >&2; exit 1; }
echo 'PASS: invalid, empty and Entware-only API lists rejected; latest native selected'
