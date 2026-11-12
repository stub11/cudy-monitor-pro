#!/bin/sh
# Offline: the FIRST apk installation may fail before reaching later helpers.
# Verify rollback service activation is declared before that early branch.
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE="$BASE/files/update-native.sh"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
python3 - "$SOURCE" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text()
def where(snippet):
    p=s.find(snippet)
    assert p>=0, f"missing {snippet}"
    return p
assert where("activate_updated_service(){") < where("restore_old() {")
assert where("restore_old() {") < where('if ! apk add --allow-untrusted "$DIR/next.apk"; then')
assert s.count("activate_updated_service(){")==1
print("PASS: rollback activation exists before first attempted APK replacement")
PY
# Source the SAME production helper functions with only the absolute init
# script replaced by a temporary mock. No real apk, network or router calls.
sed -n '/^activate_updated_service(){/,/^}/p' "$SOURCE" |
  sed "s@/etc/init.d/cudy-monitor-pro@$ROOT/init-monitor@g" > "$ROOT/helpers.sh"
sed -n '/^restore_old() {/,/^}/p' "$SOURCE" >> "$ROOT/helpers.sh"
. "$ROOT/helpers.sh"
DIR="$ROOT"
CURRENT=1.2.21
SELF="$ROOT/monitor"
cat > "$SELF" <<'EOF'
#!/bin/sh
printf 'cudy-monitor-pro %s\n' "$(cat "$TEST_VERSION_FILE")"
EOF
chmod +x "$SELF"
TEST_VERSION_FILE="$ROOT/version"; export TEST_VERSION_FILE
printf '1.2.23\n' > "$TEST_VERSION_FILE"
: > "$ROOT/previous.apk"
cat > "$ROOT/init-monitor" <<'EOF'
#!/bin/sh
[ "$1" = restart ] || exit 1
printf 'restart\n' >> "$TEST_RESTART_LOG"
EOF
chmod +x "$ROOT/init-monitor"
TEST_RESTART_LOG="$ROOT/restarts"; export TEST_RESTART_LOG
: > "$TEST_RESTART_LOG"
apk(){
  [ "$1" = add ] || return 1
  [ "$2" = --allow-untrusted ] || return 1
  [ "$3" = "$DIR/previous.apk" ] || return 1
  printf '1.2.21\n' > "$TEST_VERSION_FILE"
  return 0
}
running_matches(){ [ "$1" = "$CURRENT" ]; }
BIND=127.0.0.1:8237
wget(){ printf "ok\n"; }
restore_old > "$ROOT/stdout" 2> "$ROOT/stderr"
grep -q 'ROLLBACK OK: installed, running and healthy 1.2.21' "$ROOT/stderr"
[ "$(wc -l < "$TEST_RESTART_LOG")" -eq 1 ]
[ "$("$SELF" --version)" = "cudy-monitor-pro 1.2.21" ]
echo 'PASS: early APK failure can restore previous package and activate old daemon'
