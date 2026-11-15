#!/bin/sh
# Pure offline extracted helper test. Does not install on any router.
set -eu
SCRIPT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/cudy-monitor/scripts/install.sh"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
sed -n '/^write_atomic() {/,/^}/p' "$SCRIPT" > "$ROOT/helper.sh"
[ -s "$ROOT/helper.sh" ]
. "$ROOT/helper.sh"
printf 'original\n' > "$ROOT/bind"
chmod 600 "$ROOT/bind"
write_atomic "$ROOT/bind" '192.0.2.1:8237' 600
[ "$(cat "$ROOT/bind")" = '192.0.2.1:8237' ]
[ "$(stat -c '%a' "$ROOT/bind")" = 600 ]
[ "$(find "$ROOT" -maxdepth 1 -name 'bind.new.*' | wc -l)" -eq 0 ]
printf '1.2.24\n' > "$ROOT/VERSION"
write_atomic "$ROOT/VERSION" '1.2.25' 644
[ "$(cat "$ROOT/VERSION")" = 1.2.25 ]
[ "$(stat -c '%a' "$ROOT/VERSION")" = 644 ]
if write_atomic "$ROOT/missing/VERSION" '1.2.26' 644; then
 echo 'write into missing parent unexpectedly succeeded' >&2; exit 1
fi
[ "$(cat "$ROOT/VERSION")" = 1.2.25 ]
[ "$(cat "$ROOT/bind")" = '192.0.2.1:8237' ]
echo 'PASS: atomic config replace, permission and staging failure safety'
