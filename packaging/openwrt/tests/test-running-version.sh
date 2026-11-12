#!/bin/sh
# Isolated regression for the OpenWrt updater's live process version check.
# Never invokes apk, GitHub, router services, or /proc on this CI host.
set -eu
SCRIPT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/files/update-native.sh
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/proc/101" "$TEST_ROOT/proc/102"
cat > "$TEST_ROOT/bin/pidof" <<'EOF'
#!/bin/sh
[ "$1" = cudy-monitor-pro ] || exit 1
printf '%s\n' '101 102'
EOF
chmod +x "$TEST_ROOT/bin/pidof"
# Extract unchanged production function and substitute only procfs path for
# a fully synthetic version fixture. Never source the full updater.
sed -n '/^running_matches() {/,/^}/p' "$SCRIPT" |
  sed "s@/proc/@$TEST_ROOT/proc/@g" > "$TEST_ROOT/live-function.sh"
[ -s "$TEST_ROOT/live-function.sh" ]
# shellcheck disable=SC1090
. "$TEST_ROOT/live-function.sh"
PATH="$TEST_ROOT/bin:$PATH"; export PATH
mock_exe() {
  pid=$1
  version=$2
  cat > "$TEST_ROOT/proc/$pid/exe" <<EOF
#!/bin/sh
[ "\${1:-}" = "--version" ] || exit 2
printf '%s\n' 'cudy-monitor-pro $version'
EOF
  chmod +x "$TEST_ROOT/proc/$pid/exe"
}
mock_exe 101 1.2.12
mock_exe 102 1.2.12
running_matches 1.2.12 || { echo 'matching live versions rejected'; exit 1; }
if running_matches 1.2.11; then echo 'wrong expected version accepted'; exit 1; fi
mock_exe 102 1.2.11
if running_matches 1.2.12; then echo 'stale process accepted'; exit 1; fi
rm "$TEST_ROOT/proc/102/exe"
if running_matches 1.2.12; then echo 'missing executable accepted'; exit 1; fi
echo 'PASS OpenWrt installed vs running version verification'

# Rollback is successful only when both disk binary and running daemon match.
# Exercise the real production restore_old function against synthetic fixtures.
sed -n '/^restore_old() {/,/^}/p' "$SCRIPT" > "$TEST_ROOT/rollback-function.sh"
[ -s "$TEST_ROOT/rollback-function.sh" ]
. "$TEST_ROOT/rollback-function.sh"
CURRENT=1.2.12
DIR="$TEST_ROOT"
: > "$DIR/previous.apk"
SELF="$TEST_ROOT/bin/cudy-monitor-pro"
printf '%s\n' '1.2.12' > "$TEST_ROOT/disk-version"
cat > "$SELF" <<'EOF'
#!/bin/sh
[ "${1:-}" = "--version" ] || exit 2
printf 'cudy-monitor-pro %s\n' "$(cat "$TEST_DISK_VERSION")"
EOF
chmod +x "$SELF"
TEST_DISK_VERSION="$TEST_ROOT/disk-version"
export TEST_DISK_VERSION
# Fake only local package manager and sleep: no network or actual package installs.
apk() { [ "${APK_FAIL:-0}" = 0 ]; }
# restore_old now explicitly activates the version-verified package.
# The separate rollback-activation regression tests procd restart behavior.
activate_updated_service() {
  [ "$("$SELF" --version)" = "cudy-monitor-pro $1" ]
}
sleep() { :; }
die() { echo "$*" >&2; exit 1; }
rollback_fails() {
  if (restore_old > "$TEST_ROOT/rollback.log" 2>&1); then
    echo "incorrect rollback success: $1"; exit 1
  fi
}
# Known-good restored disk plus running daemon.
mock_exe 101 1.2.12
mock_exe 102 1.2.12
(restore_old > "$TEST_ROOT/rollback.log" 2>&1) ||
  { echo 'correct rollback rejected'; exit 1; }
# Old daemon still running, but disk executable is a newer (wrong) version.
printf '%s\n' '1.2.13' > "$TEST_ROOT/disk-version"
(rollback_fails disk-mismatch)
# Disk restored correctly, but one daemon remains the newer version.
printf '%s\n' '1.2.12' > "$TEST_ROOT/disk-version"
mock_exe 102 1.2.13
(rollback_fails process-mismatch)
# A failed package-manager restoration cannot be considered successful.
mock_exe 102 1.2.12
APK_FAIL=1
export APK_FAIL
(rollback_fails apk-failure)
unset APK_FAIL
echo 'PASS OpenWrt rollback requires disk and running version agreement'
