#!/bin/sh
# Offline regression: exact disk, HTTP health and live process version checks.
# This does not source the updater or run apk / contact the router.
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/files/update-native.sh
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
sed -n '/^verify_updated(){/,/^}/p' "$SOURCE" > "$ROOT/check.sh"
[ -s "$ROOT/check.sh" ]
. "$ROOT/check.sh"
SELF="$ROOT/monitor"
cat > "$SELF" <<'SCRIPT'
#!/bin/sh
printf 'cudy-monitor-pro %s\n' "$(cat "$TEST_VERSION_FILE")"
SCRIPT
chmod +x "$SELF"
TEST_VERSION_FILE="$ROOT/version"; export TEST_VERSION_FILE
BIND=127.0.0.1:8237
wget(){ [ "$HEALTH" = 1 ] && printf ok; }
running_matches(){ [ "$LIVE" = 1 ] && [ "$1" = 1.2.23 ]; }
printf '1.2.23\n' > "$TEST_VERSION_FILE"
HEALTH=1 LIVE=1
verify_updated 1.2.23 || { echo 'valid target rejected'; exit 1; }
[ -z "$VERIFY_FAILURE" ]
printf '1.2.21\n' > "$TEST_VERSION_FILE"
if verify_updated 1.2.23; then echo 'stale disk binary accepted'; exit 1; fi
[ "$VERIFY_FAILURE" = 'installed binary version differs from 1.2.23' ]
printf '1.2.23\n' > "$TEST_VERSION_FILE"
HEALTH=0
if verify_updated 1.2.23; then echo 'failed health accepted'; exit 1; fi
[ "$VERIFY_FAILURE" = 'health endpoint did not return ok' ]
HEALTH=1 LIVE=0
if verify_updated 1.2.23; then echo 'stale running daemon accepted'; exit 1; fi
[ "$VERIFY_FAILURE" = 'running daemon version differs from 1.2.23' ]
HEALTH=1 LIVE=1
verify_updated 1.2.23
[ -z "$VERIFY_FAILURE" ]
echo 'PASS OpenWrt verification separates disk, health and daemon failures'
