#!/bin/sh
# Cudy Monitor Pro OTA — release-only, pinned repository, rollback on failure.
set -eu
MODE="${1:---check}"
ROOT="${CUDY_MONITOR_ROOT:-/opt}"
BIN="$ROOT/bin/cudy-monitor-pro"
INIT="$ROOT/etc/init.d/S99cudy-monitor"
META="$ROOT/share/cudy-monitor"
MANIFEST="https://github.com/stub11/cudy-monitor-pro/releases/latest/download/latest.txt"
GITHUB="https://github.com/stub11/cudy-monitor-pro/releases/download"
CURL="${CUDY_MONITOR_CURL:-curl}"
SHASUM="${CUDY_MONITOR_SHASUM:-sha256sum}"
TMP=""
MANIFEST_TMP=""
LOCK="$META/.update-lock"
cleanup() {
    [ -z "$TMP" ] || rm -f "$TMP" "$TMP.hash" "$TMP.meta"
    [ -z "$MANIFEST_TMP" ] || rm -f "$MANIFEST_TMP"
}
unlock() { rm -f "$LOCK"; }
trap 'cleanup' EXIT
fail() { echo "ERROR: $*" >&2; exit 1; }
[ "$MODE" = "--check" ] || [ "$MODE" = "--apply" ] || [ "$MODE" = "--rollback" ] || fail "Unsupported action"
if [ "$MODE" = "--rollback" ]; then
    [ -f "$BIN.previous" ] || fail "No previous version"
    [ -x "$INIT" ] || fail "Init script is missing"
    mv "$BIN" "$BIN.failed"
    mv "$BIN.previous" "$BIN"
    "$INIT" restart || fail "Rollback restart failed"
    echo "Previous version restored"
    exit 0
fi
command -v "$CURL" >/dev/null 2>&1 || fail "curl is required"
command -v "$SHASUM" >/dev/null 2>&1 || fail "sha256sum is required"
# Release manifests are fetched only from the official GitHub release URL.
# Show a sanitized HTTP status rather than a vague error; never print redirect
# URLs, signed query strings, Set-Cookie headers, or remote response bodies.
MANIFEST_TMP=$(mktemp "${TMPDIR:-/tmp}/cudy-monitor-manifest.XXXXXX") || fail "Cannot create temporary manifest"
HTTP_CODE=$("$CURL" --proto '=https' --tlsv1.2 -sSL --retry 1 --connect-timeout 5 --max-time 18 -o "$MANIFEST_TMP" -w '%{http_code}' "$MANIFEST") || {
    case "$HTTP_CODE" in
        403) fail "GitHub release metadata request returned HTTP 403 (access restriction or temporary rate limit). Installed version is unchanged. Retry later; check access to github.com and release-assets.githubusercontent.com." ;;
        429) fail "GitHub release metadata request returned HTTP 429 (rate limit). Installed version is unchanged. Retry later." ;;
        *) fail "Cannot fetch GitHub release metadata (HTTP ${HTTP_CODE:-unknown}). Installed version is unchanged. Check HTTPS connectivity." ;;
    esac
}
[ "$HTTP_CODE" = 200 ] || fail "GitHub release metadata returned HTTP $HTTP_CODE. Installed version is unchanged."
[ -s "$MANIFEST_TMP" ] || fail "Empty GitHub release manifest. Installed version is unchanged."
DATA=$(cat "$MANIFEST_TMP")
VERSION=$(printf '%s\n' "$DATA" | sed -n '1p')
EXPECTED=$(printf '%s\n' "$DATA" | sed -n '2p')
case "$VERSION" in
    ''|*[!0-9.]*|.*|*..*|*.) fail "Invalid version" ;;
esac
printf '%s\n' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "Invalid semantic version"
printf '%s\n' "$EXPECTED" | grep -Eq '^[a-f0-9]{64}$' || fail "Invalid SHA256"
CURRENT=unknown
if [ -x "$BIN" ]; then CURRENT=$("$BIN" --version 2>/dev/null || echo unknown); fi
case "$CURRENT" in
    "cudy-monitor-pro "*) CURRENT=${CURRENT#cudy-monitor-pro } ;;
esac
is_newer() {
    printf '%s\n' "$CURRENT" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || return 1
    awk -v new="$VERSION" -v old="$CURRENT" 'BEGIN {
        split(new,n,"."); split(old,o,".");
        for(i=1;i<=3;i++) {
            if(n[i]+0 > o[i]+0) exit 0;
            if(n[i]+0 < o[i]+0) exit 1;
        }
        exit 1
    }'
}
if [ "$MODE" = "--check" ]; then
    echo "$VERSION $CURRENT"
    exit 0
fi
is_newer || fail "Release is not newer than installed version"
[ -x "$INIT" ] || fail "Entware init script is missing"
[ -d "$META" ] || fail "Installation directory is missing"
[ -x "$BIN" ] || fail "Current binary is missing"
( set -C; : > "$LOCK" ) 2>/dev/null || fail "An update is already running"
trap 'cleanup; unlock' EXIT
TMP="$META/cudy-monitor.$$"
URL="$GITHUB/cudy-monitor-v$VERSION/cudy-monitor-pro-aarch64"
"$CURL" --proto '=https' --tlsv1.2 -fsSL --retry 2 --connect-timeout 5 --max-time 120 "$URL" -o "$TMP" || fail "Binary download failed"
ACTUAL=$("$SHASUM" "$TMP" | awk '{print $1}')
[ "$ACTUAL" = "$EXPECTED" ] || fail "Binary checksum mismatch"
chmod 755 "$TMP"
# Bind must be a literal, local IPv4 address. Never let config become an arbitrary URL.
BIND_FILE="$ROOT/etc/cudy-monitor/bind"
HEALTH_BIND=127.0.0.1:8237
[ ! -s "$BIND_FILE" ] || HEALTH_BIND=$(cat "$BIND_FILE")
case "$HEALTH_BIND" in *[!0-9.:]*|*:*:*) fail "Invalid health-check address" ;; esac
IP=${HEALTH_BIND%:*}
PORT=${HEALTH_BIND##*:}
printf '%s\n' "$IP" | awk -F. 'NF!=4{exit 1}{for(i=1;i<=4;i++)if($i !~ /^[0-9]+$/ || $i<0 || $i>255)exit 1}' || fail "Invalid health-check IP"
case "$IP" in
    127.*|10.*|192.168.*) ;;
    172.*) SECOND=$(printf '%s\n' "$IP" | cut -d. -f2); [ "$SECOND" -ge 16 ] && [ "$SECOND" -le 31 ] || fail "Not a local address" ;;
    *) fail "Not a local address" ;;
esac
case "$PORT" in ''|*[!0-9]*) fail "Invalid health-check port" ;; esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || fail "Invalid health-check port"
# Keep old binary until the new daemon proves it can start.
cp "$BIN" "$BIN.previous" || fail "Could not back up old binary"
mv "$TMP" "$BIN" || fail "Cannot activate downloaded binary"
TMP=""
restore_previous() {
    cp "$BIN.previous" "$BIN" || fail "Cannot restore backup binary"
    "$INIT" restart || fail "Rollback restart failed"
}
if ! "$INIT" restart; then
    restore_previous
    fail "Restart failed; rolled back"
fi
sleep 2
if ! "$CURL" -fsS --connect-timeout 2 --max-time 4 "http://$HEALTH_BIND/health" >/dev/null; then
    restore_previous
    fail "Health check failed; rolled back"
fi
printf '%s\n' "$VERSION" > "$META/VERSION"
echo "UPDATED $VERSION"
