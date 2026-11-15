#!/bin/sh
# Offline regression of native HTTPS fetching: no real network or router.
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE="$BASE/files/update-native.sh"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
mkdir -p "$ROOT/bin"
sed -n '/^fetch(){/,/^}/p' "$SOURCE" > "$ROOT/helper.sh"
cat > "$ROOT/bin/curl" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" > "$TEST_ROOT/curl-args"
case " $* " in
  *" --proto =https "*" --proto-redir =https "*) ;;
  *) echo 'curl must require HTTPS for initial and redirect URLs' >&2; exit 99 ;;
esac
exit 22
MOCK
cat > "$ROOT/bin/wget" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" > "$TEST_ROOT/wget-args"
[ "$1" = "-T" ] && [ "$2" = 20 ] && [ "$3" = "-t" ] && [ "$4" = 2 ] || {
 echo 'wget must have bounded timeout and retries' >&2; exit 98;
}
[ "$5" = "-O" ] || exit 97
case "$MOCK_WGET" in
 good) printf 'verified fixture\n' > "$6"; exit 0 ;;
 empty) : > "$6"; exit 0 ;;
 *) exit 4 ;;
esac
MOCK
chmod +x "$ROOT/bin/curl" "$ROOT/bin/wget"
export TEST_ROOT="$ROOT"
PATH="$ROOT/bin:$PATH"
export PATH
. "$ROOT/helper.sh"
MOCK_WGET=good; export MOCK_WGET
fetch "https://github.com/example/release" "$ROOT/success"
[ "$(cat "$ROOT/success")" = "verified fixture" ]
grep -q -- '--proto-redir =https' "$ROOT/curl-args"
grep -q -- '-T 20 -t 2' "$ROOT/wget-args"
MOCK_WGET=empty; export MOCK_WGET
if fetch "https://github.com/example/release" "$ROOT/empty"; then
 echo 'empty fallback accepted' >&2; exit 1
fi
MOCK_WGET=fail; export MOCK_WGET
if fetch "https://github.com/example/release" "$ROOT/fail"; then
 echo 'failed fallback accepted' >&2; exit 1
fi
echo 'PASS: HTTPS-only redirect, bounded 403 fallback, reject empty/failed downloads'
