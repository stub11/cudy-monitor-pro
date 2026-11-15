#!/bin/sh
# Isolated non-root-friendly --check smoke regression (no router mutation).
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SCRIPT="$ROOT/scripts/easy-install.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'MOCK'
#!/bin/sh
echo 'Unexpected network call during platform --check' >&2
exit 71
MOCK
cat > "$WORK/bin/wget" <<'MOCK'
#!/bin/sh
echo 'Unexpected network call during platform --check' >&2
exit 71
MOCK
chmod +x "$WORK/bin/curl" "$WORK/bin/wget"
PATH="$WORK/bin:$PATH" sh "$SCRIPT" --check >"$WORK/out" 2>"$WORK/err"
grep -q 'platform diagnostics (read-only)' "$WORK/out"
grep -q 'CPU architecture:' "$WORK/out"
grep -q 'Detected system:' "$WORK/out"
grep -q 'Entware:' "$WORK/out"
grep -q 'Diagnosis:' "$WORK/out"
grep -q 'No network requests or router configuration changes' "$WORK/out"
[ ! -s "$WORK/err" ] || { cat "$WORK/err"; exit 1; }
# The read-only mode must refuse APK input and never create packages.
if sh "$SCRIPT" --check --file "$WORK/fixture.apk" >"$WORK/out2" 2>"$WORK/err2"; then
 echo 'Unexpected success for --check --file' >&2; exit 1
fi
grep -q '\-\-file is only valid' "$WORK/err2"
[ ! -e "$WORK/fixture.apk" ]
echo 'PASS: read-only platform diagnosis, no package fetch, invalid flags rejected'
