#!/bin/sh
# Offline rollback test: no router, network, or real APK operations.
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE="$BASE/files/update-native.sh"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
sed -n '/^restore_old() {/,/^}/p' "$SOURCE" > "$ROOT/functions.sh"
[ -s "$ROOT/functions.sh" ]
. "$ROOT/functions.sh"
DIR="$ROOT"
CURRENT=1.2.25
SELF="$ROOT/monitor"
cat > "$SELF" <<'EOF'
#!/bin/sh
printf 'cudy-monitor-pro %s\n' "$(cat "$TEST_ROLLBACK_VERSION")"
EOF
chmod +x "$SELF"
TEST_ROLLBACK_VERSION="$ROOT/version"; export TEST_ROLLBACK_VERSION
printf '%s\n' "$CURRENT" > "$TEST_ROLLBACK_VERSION"
touch "$ROOT/previous.apk"
apk(){
  [ "$1" = add ] && [ "$2" = --allow-untrusted ] && [ "$3" = "$ROOT/previous.apk" ] || return 1
  printf 'restored\n' >> "$ROOT/actions"
  [ "${APK_OK:-1}" = 1 ]
}
activate_updated_service(){
  [ "$1" = "$CURRENT" ] || return 1
  [ "$("$SELF" --version)" = "cudy-monitor-pro $CURRENT" ] || return 1
  printf 'restart\n' >> "$ROOT/actions"
  [ "${RESTART_OK:-1}" = 1 ]
}
running_matches(){ [ "$1" = "$CURRENT" ] && [ "${LIVE_OK:-1}" = 1 ]; }
sleep(){ :; }
die(){ echo "ERROR: $*" >&2; exit 1; }
: > "$ROOT/actions"
restore_old > "$ROOT/out" 2>"$ROOT/err"
[ "$(cat "$ROOT/actions")" = "$(printf 'restored\nrestart')" ] || exit 1
grep -q 'ROLLBACK OK' "$ROOT/err"
: > "$ROOT/actions"
if (RESTART_OK=0; restore_old) > "$ROOT/out" 2>"$ROOT/err"; then
  echo 'Failed procd restart incorrectly passed rollback' >&2; exit 1
fi
[ "$(cat "$ROOT/actions")" = "$(printf 'restored\nrestart')" ] || exit 1
grep -q 'restored binary could not be activated' "$ROOT/err"
: > "$ROOT/actions"
printf '1.2.24\n' > "$TEST_ROLLBACK_VERSION"
if restore_old > "$ROOT/out" 2>"$ROOT/err"; then
  echo 'Wrong disk version incorrectly passed rollback' >&2; exit 1
fi
[ "$(cat "$ROOT/actions")" = 'restored' ] || exit 1
printf '1.2.25\n' > "$TEST_ROLLBACK_VERSION"
: > "$ROOT/actions"
if (APK_OK=0; restore_old) > "$ROOT/out" 2>"$ROOT/err"; then
  echo 'Failed APK restoration incorrectly passed' >&2; exit 1
fi
[ "$(cat "$ROOT/actions")" = 'restored' ] || exit 1
: > "$ROOT/actions"
if (LIVE_OK=0; restore_old) > "$ROOT/out" 2>"$ROOT/err"; then
  echo 'Stale running daemon incorrectly passed rollback' >&2; exit 1
fi
grep -q 'previous process version not observed' "$ROOT/err"
echo 'PASS: rollback restores verified binary, restarts procd, and confirms live version'
