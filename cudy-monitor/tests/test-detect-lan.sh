#!/bin/sh
# Offline network detection regression tests: no router changes or network use.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
cat > "$DIR/ip" <<'EOF'
#!/bin/sh
case "$*" in
  "-4 -o addr show dev custom-bridge")
    [ "${TEST_CASE:-}" = "uci" ] && echo '3: custom-bridge    inet 192.168.66.1/24 brd 192.168.66.255 scope global custom-bridge' ;;
  "-4 -o addr show dev br-lan") : ;;
  "-4 -o addr show dev br0") : ;;
  "-4 -o addr show dev lan0") : ;;
  "-4 -o addr show")
    case "${TEST_CASE:-}" in
      uci) echo '3: custom-bridge inet 192.168.66.1/24 brd 192.168.66.255 scope global custom-bridge' ;;
      fallback) printf '%s\n' '2: eth0 inet 100.64.0.3/24 scope global eth0' '8: weirdlan inet 10.23.4.1/24 scope global weirdlan' ;;
      ambiguous) printf '%s\n' '4: inside1 inet 192.168.1.1/24 scope global inside1' '5: inside2 inet 192.168.3.1/24 scope global inside2' ;;
      wan) echo '4: eth0 inet 192.168.10.2/24 scope global eth0' ;;
    esac ;;
  "-4 route show default") echo 'default via 192.168.10.1 dev eth0' ;;
esac
EOF
cat > "$DIR/uci" <<'EOF'
#!/bin/sh
if [ "${TEST_CASE:-}" = uci ] && [ "$*" = '-q get network.lan.device' ]; then
  echo custom-bridge
fi
EOF
chmod 755 "$DIR/ip" "$DIR/uci"
export PATH="$DIR:$PATH" MONITOR_IP_COMMAND="$DIR/ip"
TEST_CASE=uci
export TEST_CASE
value=$(sh "$ROOT/scripts/detect-lan.sh" detect)
[ "$value" = 192.168.66.1 ]
TEST_CASE=fallback
export TEST_CASE
value=$(sh "$ROOT/scripts/detect-lan.sh" detect)
[ "$value" = 10.23.4.1 ]
TEST_CASE=ambiguous
export TEST_CASE
if sh "$ROOT/scripts/detect-lan.sh" detect >"$DIR/out" 2>"$DIR/err"; then
  echo "Ambiguous LAN was incorrectly accepted" >&2; exit 1
fi
grep -q "Cannot uniquely identify" "$DIR/err"
[ "$(sh "$ROOT/scripts/detect-lan.sh" validate 192.168.3.1)" = 192.168.3.1 ]
if sh "$ROOT/scripts/detect-lan.sh" validate 8.8.8.8 >"$DIR/out" 2>"$DIR/err"; then exit 1; fi
if sh "$ROOT/scripts/detect-lan.sh" validate 192.168.9.9 >"$DIR/out" 2>"$DIR/err"; then exit 1; fi
TEST_CASE=wan
export TEST_CASE
if sh "$ROOT/scripts/detect-lan.sh" detect >"$DIR/out" 2>"$DIR/err"; then
  echo "WAN address was incorrectly chosen" >&2; exit 1
fi
echo "LAN detection scenarios passed: UCI custom bridge, fallback, ambiguity, manual IP and WAN rejection."
