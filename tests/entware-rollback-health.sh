#!/bin/sh
# Offline Entware rollback verification; does not access router or network.
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)/cudy-monitor/scripts/update.sh
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
sed -n '/^replace_installed_binary() {/,/^}/p; /^restore_previous() {/,/^}/p' "$SOURCE" > "$WORK/function.sh"
[ -s "$WORK/function.sh" ]
BIN="$WORK/monitor"
INIT="$WORK/init"
HEALTH_BIND=127.0.0.1:8237
CURRENT=1.2.24
CURL="$WORK/curl"
export MOCK_HEALTH=ok
cat > "$BIN.previous" <<'BIN'
#!/bin/sh
[ "$1" = --version ] && { echo 'cudy-monitor-pro 1.2.24'; exit 0; }
exit 1
BIN
cat > "$INIT" <<'INIT'
#!/bin/sh
[ "$1" = restart ] && exit 0
exit 1
INIT
cat > "$CURL" <<'CURL'
#!/bin/sh
[ "$MOCK_HEALTH" = ok ] || exit 7
printf 'ok\n'
CURL
chmod +x "$BIN.previous" "$INIT" "$CURL"
fail(){ echo "ERROR: $*" >&2; exit 1; }
. "$WORK/function.sh"
restore_previous
[ "$("$BIN" --version)" = 'cudy-monitor-pro 1.2.24' ]
MOCK_HEALTH=down; export MOCK_HEALTH
if (restore_previous) >"$WORK/out" 2>"$WORK/err"; then
    echo 'unhealthy rollback falsely reported success' >&2; exit 1
fi
grep -q 'ROLLBACK FAILED: restored service health not confirmed' "$WORK/err"
MOCK_HEALTH=ok; export MOCK_HEALTH
cat > "$BIN.previous" <<'WRONG'
#!/bin/sh
[ "$1" = --version ] && { echo 'cudy-monitor-pro 9.9.9'; exit 0; }
exit 1
WRONG
chmod +x "$BIN.previous"
if (restore_previous) >"$WORK/out" 2>"$WORK/err"; then
    echo 'wrong restored version falsely reported success' >&2; exit 1
fi
grep -q 'ROLLBACK FAILED: restored binary version not confirmed' "$WORK/err"
echo 'PASS: Entware rollback requires restored disk version and healthy HTTP endpoint'

# A healthy endpoint may still belong to the old process after a file swap.
sed -n '/^running_binary_matches() {/,/^}/p' "$SOURCE" > "$WORK/running.sh"
[ -s "$WORK/running.sh" ]
. "$WORK/running.sh"
ROOT="$WORK/runtime"
mkdir -p "$ROOT/var/run"
BIN="$ROOT/sleep"
cp -L "$(command -v sleep)" "$BIN"
chmod +x "$BIN"
"$BIN" 30 &
fixture_pid=$!
trap 'kill "$fixture_pid" 2>/dev/null || :; rm -rf "$WORK"' EXIT HUP INT TERM
pidfile="$ROOT/var/run/cudy-monitor-pro.pid"
printf '%s\n' "$fixture_pid" > "$pidfile"
attempt=0
until running_binary_matches; do
    attempt=$((attempt+1))
    [ "$attempt" -lt 3 ] || fail "Matching executable was rejected"
    sleep 1
done
printf 'replacement\n' > "$ROOT/other"
replace_installed_binary "$ROOT/other"
grep -qx replacement "$BIN"
if running_binary_matches; then fail "Old process matched replaced binary"; fi
printf 'invalid\n' > "$pidfile"
if running_binary_matches; then fail "Invalid PID was accepted"; fi
echo 'PASS: Entware verifies the running executable matches its installed binary'
