#!/bin/sh
# Offline stable-channel GitHub release discovery: no apk, router or network.
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE="$BASE/files/update-native.sh"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
sed -n '/^newer(){/,/^}/p' "$SOURCE" > "$ROOT/helpers"
sed -n '/^parse_api_releases(){/,/^}/p' "$SOURCE" >> "$ROOT/helpers"
grep '^valid_version(){' "$SOURCE" >> "$ROOT/helpers"
. "$ROOT/helpers"
DIR=$ROOT
CHANNEL=stable
CURRENT=1.2.21
jsonfilter(){
  [ "${PARSE_OK:-1}" = 1 ] || return 1
  while [ "$#" -gt 0 ]; do
    case "$1" in
      "@[*].tag_name") printf "%s\n" "${TAGS:-}"; return 0 ;;
      "@[*].prerelease") printf "%s\n" "${PRE:-}"; return 0 ;;
      "@[*].draft") printf "%s\n" "${DRAFTS:-}"; return 0 ;;
    esac
    shift
  done
  return 1
}
LATEST=$CURRENT
PARSE_OK=0
TAGS='cudy-monitor-openwrt-v9.9.9'; PRE=false; DRAFTS=false
if parse_api_releases; then echo 'invalid API JSON accepted' >&2; exit 1; fi
PARSE_OK=1
for scenario in empty no_flags missing_draft malformed_bool mismatched_count; do
  LATEST=$CURRENT
  case "$scenario" in
    empty) TAGS=''; PRE=''; DRAFTS='' ;;
    no_flags) TAGS='cudy-monitor-openwrt-v9.9.9'; PRE=''; DRAFTS='' ;;
    missing_draft) TAGS='cudy-monitor-openwrt-v9.9.9'; PRE=false; DRAFTS='' ;;
    malformed_bool) TAGS='cudy-monitor-openwrt-v9.9.9'; PRE=unknown; DRAFTS=false ;;
    mismatched_count) TAGS='cudy-monitor-openwrt-v1.2.24 cudy-monitor-openwrt-v9.9.9'; PRE=false; DRAFTS='false false' ;;
  esac
  if parse_api_releases; then echo "Invalid $scenario metadata accepted" >&2; exit 1; fi
done
LATEST=$CURRENT
TAGS='cudy-monitor-v1.2.25'; PRE=false; DRAFTS=false
if parse_api_releases; then echo 'Entware-only list accepted for OpenWrt' >&2; exit 1; fi
LATEST=$CURRENT
TAGS='cudy-monitor-openwrt-vnot-a-version'; PRE=false; DRAFTS=false
if parse_api_releases; then echo 'malformed OpenWrt tag accepted' >&2; exit 1; fi
# A higher numeric tag marked prerelease or draft must be excluded.
LATEST=$CURRENT
TAGS='cudy-monitor-openwrt-v9.9.9 cudy-monitor-openwrt-v8.8.8 cudy-monitor-v9.9.9 cudy-monitor-openwrt-v1.2.25 cudy-monitor-openwrt-v1.2.23'
PRE='true false false false false'
DRAFTS='false true false false false'
parse_api_releases
[ "$LATEST" = 1.2.25 ] || { echo "prerelease/draft promoted: $LATEST" >&2; exit 1; }
# All matching OpenWrt releases are prereleases; reject API list (fall back safely).
LATEST=$CURRENT
TAGS='cudy-monitor-openwrt-v9.9.9 cudy-monitor-openwrt-v8.8.8'
PRE='true true'; DRAFTS='false false'
if parse_api_releases; then echo 'prerelease-only list accepted' >&2; exit 1; fi
LATEST=1.2.25
TAGS='cudy-monitor-openwrt-v1.2.22'; PRE=false; DRAFTS=false
parse_api_releases
[ "$LATEST" = 1.2.25 ] || { echo "unexpected downgrade: $LATEST" >&2; exit 1; }
# Explicit testing mode may see numeric prerelease tags, but not stable or drafts.
CHANNEL=testing
LATEST=$CURRENT
TAGS='cudy-monitor-openwrt-v1.2.24 cudy-monitor-openwrt-v1.2.26 cudy-monitor-openwrt-v9.9.9'
PRE='false true true'; DRAFTS='false false true'
parse_api_releases
[ "$LATEST" = 1.2.26 ] || { echo "testing candidate selection failed: $LATEST" >&2; exit 1; }
# Testing metadata must fail closed if all results are stable or draft.
LATEST=$CURRENT
TAGS='cudy-monitor-openwrt-v9.9.9 cudy-monitor-openwrt-v8.8.8'
PRE='false true'; DRAFTS='false true'
if parse_api_releases; then echo 'testing accepted stable/draft-only metadata' >&2; exit 1; fi
CHANNEL=stable
echo 'PASS: stable OpenWrt only; prerelease, draft, malformed fields and no stable releases rejected'
