#!/bin/sh
# Offline regression: no network, no installation, no router state changes.
set -eu
SCRIPT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)/cudy-monitor/scripts/update.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
mkdir -p "$WORK/bin" "$WORK/root"
cat > "$WORK/bin/mock-curl" <<'MOCK'
#!/bin/sh
set -eu
out=
while [ "$#" -gt 0 ]; do
    case "$1" in
        -o) out=$2; shift 2 ;;
        -w) shift 2 ;;
        *) shift ;;
    esac
done
case "$MOCK_HTTP" in
    403|429)
        printf '%s' "$MOCK_HTTP"
        exit 22 ;;
    200)
        printf '1.2.21\n%s\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' > "$out"
        printf 200 ;;
    *) printf 000; exit 7 ;;
esac
MOCK
chmod +x "$WORK/bin/mock-curl"
for CODE in 403 429 000; do
    if MOCK_HTTP="$CODE" CUDY_MONITOR_ROOT="$WORK/root" CUDY_MONITOR_CURL="$WORK/bin/mock-curl" sh "$SCRIPT" --check >"$WORK/out" 2>"$WORK/err"; then
        echo "Expected error for HTTP $CODE" >&2; exit 1
    fi
    grep -q "HTTP $CODE" "$WORK/err" || { echo "Missing HTTP code $CODE" >&2; cat "$WORK/err" >&2; exit 1; }
    [ ! -e "$WORK/root/bin/cudy-monitor-pro" ] || { echo 'Updater unexpectedly installed a binary' >&2; exit 1; }
done
MOCK_HTTP=200 CUDY_MONITOR_ROOT="$WORK/root" CUDY_MONITOR_CURL="$WORK/bin/mock-curl" sh "$SCRIPT" --check >"$WORK/out" 2>"$WORK/err"
grep -q '^1.2.21 unknown$' "$WORK/out"
echo 'PASS: HTTP status diagnostics and read-only --check'
