#!/bin/sh
# End-to-end mocked Entware manual rollback, isolated from actual /opt or network.
set -eu
SOURCE="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/cudy-monitor/scripts/update.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
mkdir -p "$WORK/root/bin" "$WORK/root/etc/init.d" "$WORK/root/etc/cudy-monitor"
BIN="$WORK/root/bin/cudy-monitor-pro"
PREV="$BIN.previous"
cat > "$WORK/root/etc/init.d/S99cudy-monitor" <<'INIT'
#!/bin/sh
[ "$1" = restart ] || exit 1
[ "${MOCK_RESTART_FAIL_PREV:-0}" = 1 ] &&
    [ "$("$MOCK_ROOT/bin/cudy-monitor-pro" --version)" = 'cudy-monitor-pro 1.2.24' ] && exit 7
exit 0
INIT
cat > "$WORK/mock-curl" <<'CURL'
#!/bin/sh
version=$("$MOCK_ROOT/bin/cudy-monitor-pro" --version)
[ "${MOCK_HEALTH_ALWAYS_FAIL:-0}" != 1 ] || exit 7
[ "${MOCK_HEALTH_FAIL_PREV:-0}" != 1 ] ||
    [ "$version" != 'cudy-monitor-pro 1.2.24' ] || exit 7
printf 'ok\n'
CURL
cat > "$WORK/new-binary" <<'NEW'
#!/bin/sh
[ "$1" = --version ] && { echo 'cudy-monitor-pro 1.2.25'; exit 0; }
exit 1
NEW
cat > "$WORK/old-binary" <<'OLD'
#!/bin/sh
[ "$1" = --version ] && { echo 'cudy-monitor-pro 1.2.24'; exit 0; }
exit 1
OLD
chmod +x "$WORK/root/etc/init.d/S99cudy-monitor" "$WORK/mock-curl" "$WORK/new-binary" "$WORK/old-binary"
export MOCK_ROOT="$WORK/root"
run(){
    CUDY_MONITOR_ROOT="$WORK/root" CUDY_MONITOR_CURL="$WORK/mock-curl" sh "$SOURCE" --rollback
}
reset(){
    cp "$WORK/new-binary" "$BIN"
    cp "$WORK/old-binary" "$PREV"
    rm -f "$BIN.failed"
}
reset
run > "$WORK/out" 2> "$WORK/err"
grep -q 'Previous version restored and healthy' "$WORK/out"
[ "$("$BIN" --version)" = 'cudy-monitor-pro 1.2.24' ]
[ "$("$PREV" --version)" = 'cudy-monitor-pro 1.2.24' ]
[ "$("$BIN.failed" --version)" = 'cudy-monitor-pro 1.2.25' ]
reset
if MOCK_HEALTH_FAIL_PREV=1 run > "$WORK/out" 2> "$WORK/err"; then
    echo 'unhealthy manual rollback falsely succeeded' >&2; exit 1
fi
grep -q 'original version restored' "$WORK/err"
[ "$("$BIN" --version)" = 'cudy-monitor-pro 1.2.25' ]
reset
if MOCK_RESTART_FAIL_PREV=1 run > "$WORK/out" 2> "$WORK/err"; then
    echo 'failed previous restart falsely succeeded' >&2; exit 1
fi
grep -q 'original version restored' "$WORK/err"
[ "$("$BIN" --version)" = 'cudy-monitor-pro 1.2.25' ]
reset
printf 'not an executable\n' > "$PREV"
if run > "$WORK/out" 2> "$WORK/err"; then
    echo 'malformed previous version was allowed' >&2; exit 1
fi
[ "$("$BIN" --version)" = 'cudy-monitor-pro 1.2.25' ]
echo 'PASS: manual rollback verifies health and restores original on failure'
