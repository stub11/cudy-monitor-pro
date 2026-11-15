#!/bin/sh
# No router, network, firmware, apk, or service operations.
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SRC="$BASE/files/update-native.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
sed -n '/^diagnose_state(){/,/^}/p' "$SRC" > "$WORK/helper"
[ -s "$WORK/helper" ]
. "$WORK/helper"
assert_state(){
 expected=$1; shift
 got=$(diagnose_state "$@")
 [ "$got" = "$expected" ] || { echo "Expected $expected, got $got" >&2; exit 1; }
}
assert_state matching 'cudy-monitor-pro 1.2.25' 'cudy-monitor-pro 1.2.25'
assert_state matching 'cudy-monitor-pro 1.2.25' 'cudy-monitor-pro 1.2.25' 'cudy-monitor-pro 1.2.25'
assert_state mismatch 'cudy-monitor-pro 1.2.25' 'cudy-monitor-pro 1.2.24'
assert_state mismatch 'cudy-monitor-pro 1.2.25' 'cudy-monitor-pro 1.2.25' 'cudy-monitor-pro 1.2.24'
assert_state not_running 'cudy-monitor-pro 1.2.25'
assert_state invalid_installed 'malformed' 'cudy-monitor-pro 1.2.25'
assert_state unreadable_running 'cudy-monitor-pro 1.2.25' 'error'
# The standalone diagnostic must exit before metadata/API initialization.
# This is a structural gate that prevents future refactors from adding
# a network fetch or apk action before the read-only branch.
awk '
  /^if \[ "\$MODE" = --diagnose \]; then/{in_block=1}
  in_block && /^fi$/{done=1;exit}
  END{ if(!done)exit 1 }
' "$SRC"
sh -n "$SRC"
echo 'PASS: version state classification for matching, mismatch, missing, malformed'
