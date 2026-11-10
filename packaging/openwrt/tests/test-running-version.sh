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
printf '%s\\n' 'cudy-monitor-pro $version'
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
