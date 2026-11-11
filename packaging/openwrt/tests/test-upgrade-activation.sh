#!/bin/sh
# Offline regression: service restart must happen only after exact disk version.
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/files/update-native.sh
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
sed -n '/^activate_updated_service(){/,/^}/p' "$SOURCE" | sed "s@/etc/init.d/cudy-monitor-pro@$ROOT/init-monitor@g" > "$ROOT/helper.sh"
[ -s "$ROOT/helper.sh" ]
. "$ROOT/helper.sh"
SELF="$ROOT/binary"
cat > "$SELF" <<'EOF'
#!/bin/sh
printf 'cudy-monitor-pro %s\n' "$(cat "$TEST_DISK_VERSION")"
EOF
chmod +x "$SELF"
TEST_DISK_VERSION="$ROOT/disk-version"; export TEST_DISK_VERSION
cat > "$ROOT/init-monitor" <<'EOF'
#!/bin/sh
printf 'restart\n' >> "$TEST_RESTART_LOG"
[ "$1" = restart ] && [ "${RESTART_OK:-1}" = 1 ]
EOF
chmod +x "$ROOT/init-monitor"
TEST_RESTART_LOG="$ROOT/restarts"; export TEST_RESTART_LOG
: > "$TEST_RESTART_LOG"
printf '1.2.21\n' > "$TEST_DISK_VERSION"
if activate_updated_service 1.2.23; then echo 'wrong disk version accepted'; exit 1; fi
[ ! -s "$TEST_RESTART_LOG" ] || { echo 'wrong version caused restart'; exit 1; }
printf '1.2.23\n' > "$TEST_DISK_VERSION"
RESTART_OK=0; export RESTART_OK
if activate_updated_service 1.2.23; then echo 'restart failure accepted'; exit 1; fi
[ "$(wc -l < "$TEST_RESTART_LOG")" -eq 1 ]
RESTART_OK=1; export RESTART_OK
activate_updated_service 1.2.23
[ "$(wc -l < "$TEST_RESTART_LOG")" -eq 2 ]
echo 'PASS: exact disk version gate and one procd restart attempt'
