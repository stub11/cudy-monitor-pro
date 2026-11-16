#!/bin/sh
# Offline policy test: no actual GitHub, apk, daemon or router access.
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SCRIPT="$BASE/files/update-native.sh"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
if sh "$SCRIPT" --apply-testing >"$ROOT/out" 2>"$ROOT/err"; then
 echo 'Test installation accepted missing confirmation' >&2; exit 1
fi
grep -q -- '--confirm-testing' "$ROOT/err"
if sh "$SCRIPT" --apply-testing --invalid >"$ROOT/out" 2>"$ROOT/err"; then
 echo 'Test installation accepted wrong confirmation' >&2; exit 1
fi
grep -q -- '--confirm-testing' "$ROOT/err"
if sh "$SCRIPT" --check-testing --confirm-testing >"$ROOT/out" 2>"$ROOT/err"; then
 echo 'Testing check accepted unrelated extra argument' >&2; exit 1
fi
grep -q 'Unexpected extra arguments' "$ROOT/err"
sed -n '/^package_digest(){/,/^}/p' "$SCRIPT" > "$ROOT/helpers"
[ -s "$ROOT/helpers" ]
. "$ROOT/helpers"
die(){ echo "ERROR: $*" >&2; exit 1; }
CHANNEL=testing
USE_FALLBACK=1
DIR=$ROOT
if (package_digest 1.2.26) >"$ROOT/out" 2>"$ROOT/err"; then
 echo 'Testing package accepted a stable digest fallback' >&2; exit 1
fi
grep -q 'requires official GitHub asset SHA256' "$ROOT/err"
sh -n "$SCRIPT"
echo 'PASS: testing OTA requires explicit confirmation; no stable SHA256 fallback'
