#!/bin/sh
# Offline install fetch regression: no router, network or package operations.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TEMP=$(mktemp -d)
trap 'rm -rf "$TEMP"' EXIT HUP INT TERM
sed -n '/^fetch() {/,/^}/p' "$ROOT/cudy-monitor/scripts/install.sh" > "$TEMP/fetch.sh"
[ "$(grep -c '^fetch() {' "$TEMP/fetch.sh")" -eq 1 ]
cat > "$TEMP/curl-mock" <<'MOCK'
#!/bin/sh
out=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    *) shift ;;
  esac
done
[ -z "$out" ] || { [ "${FAKE_BODY:-no}" != yes ] || printf '1.2.25\n' > "$out"; }
printf '%s' "${FAKE_HTTP:-200}"
exit "${FAKE_EXIT:-0}"
MOCK
chmod 755 "$TEMP/curl-mock"
REPO=https://github.com/stub11/cudy-monitor-pro
BASE=https://raw.githubusercontent.com/stub11/cudy-monitor-pro
FETCH_TOOL=curl
CURL="$TEMP/curl-mock"
. "$TEMP/fetch.sh"
expect_failure(){
  code=$1
  label=$2
  export FAKE_HTTP="$code" FAKE_EXIT=22 FAKE_BODY=no
  if fetch "$REPO/releases/latest/download/latest.txt" "$TEMP/data" 2>"$TEMP/err"; then
    echo "FAIL: unexpected successful fetch for HTTP $code" >&2; exit 1
  fi
  grep -q "HTTP $code" "$TEMP/err" || { cat "$TEMP/err"; exit 1; }
  grep -q "$label" "$TEMP/err" || { cat "$TEMP/err"; exit 1; }
  ! grep -q 'latest.txt\|token\|http[s]*://' "$TEMP/err" || exit 1
}
expect_failure 403 'access restriction'
expect_failure 429 'rate limit'
export FAKE_HTTP=000 FAKE_EXIT=7 FAKE_BODY=no
if fetch "$REPO/releases/download/cudy-monitor-v1.2.25/cudy-monitor-pro-aarch64" "$TEMP/data" 2>"$TEMP/err"; then exit 1; fi
grep -q 'HTTP 000' "$TEMP/err"
export FAKE_HTTP=200 FAKE_EXIT=0 FAKE_BODY=no
if fetch "$REPO/releases/latest/download/latest.txt" "$TEMP/empty" 2>"$TEMP/err"; then exit 1; fi
grep -q 'is empty' "$TEMP/err"
export FAKE_HTTP=200 FAKE_EXIT=0 FAKE_BODY=yes
fetch "$REPO/releases/latest/download/latest.txt" "$TEMP/valid"
grep -q '1.2.25' "$TEMP/valid"
if fetch 'https://untrusted.invalid/asset' "$TEMP/bad" 2>"$TEMP/err"; then exit 1; fi
grep -q 'unexpected installer download source' "$TEMP/err"
echo 'PASS: Entware installer HTTP status, empty response and source restrictions'
