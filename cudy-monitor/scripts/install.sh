#!/bin/sh
# One-time installer for Cudy WBR3000UAX with KeeneticOS + Entware.
# Run only after reviewing the script and confirming a working /opt USB mount.
set -eu
ROOT=/opt
REPO=https://github.com/stub11/cudy-monitor-pro
BASE=https://raw.githubusercontent.com/stub11/cudy-monitor-pro
command -v curl >/dev/null 2>&1 || { echo "Requires curl" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "Requires sha256sum" >&2; exit 1; }
[ "$(uname -m)" = "aarch64" ] || { echo "Expected aarch64 router" >&2; exit 1; }
[ -d "$ROOT/etc/init.d" ] && [ -d "$ROOT/bin" ] || { echo "Entware not mounted" >&2; exit 1; }
case "$(readlink -f /opt 2>/dev/null || echo /opt)" in
    *tmpfs*) echo "Unsafe temporary Entware path" >&2; exit 1 ;;
esac
TMP=$(mktemp -d /opt/tmp/cudy-monitor.XXXXXX) || exit 1
trap 'rm -rf "$TMP"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 5 --max-time 20 "$REPO/releases/latest/download/latest.txt" -o "$TMP/latest"
VER=$(sed -n '1p' "$TMP/latest")
SUM=$(sed -n '2p' "$TMP/latest")
printf '%s\n' "$VER" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || exit 1
printf '%s\n' "$SUM" | grep -Eq '^[a-f0-9]{64}$' || exit 1
curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 5 --max-time 120 "$REPO/releases/download/cudy-monitor-v$VER/cudy-monitor-pro-aarch64" -o "$TMP/monitor"
[ "$(sha256sum "$TMP/monitor" | awk '{print $1}')" = "$SUM" ] || { echo "Checksum mismatch" >&2; exit 1; }
for script in update.sh S99cudy-monitor; do
    curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 5 --max-time 20 "$BASE/cudy-monitor-v$VER/cudy-monitor/scripts/$script" -o "$TMP/$script"
    sh -n "$TMP/$script"
done
mkdir -p /opt/etc/cudy-monitor /opt/share/cudy-monitor /opt/var/run
chmod 700 /opt/etc/cudy-monitor
# Version 0.4.4+ runs without a login token; preserve any legacy token file but do not use it.
[ -f /opt/etc/cudy-monitor/bind ] || printf '127.0.0.1:8237\n' > /opt/etc/cudy-monitor/bind
chmod 600 /opt/etc/cudy-monitor/bind
[ -e /opt/bin/cudy-monitor-pro ] && cp /opt/bin/cudy-monitor-pro /opt/bin/cudy-monitor-pro.previous || true
cp "$TMP/monitor" /opt/bin/cudy-monitor-pro
chmod 755 /opt/bin/cudy-monitor-pro
cp "$TMP/update.sh" /opt/share/cudy-monitor/update.sh
cp "$TMP/S99cudy-monitor" /opt/etc/init.d/S99cudy-monitor
chmod 755 /opt/etc/init.d/S99cudy-monitor
printf '%s\n' "$VER" > /opt/share/cudy-monitor/VERSION
/opt/etc/init.d/S99cudy-monitor restart
sleep 2
HEALTH_BIND=$(cat /opt/etc/cudy-monitor/bind)
curl -fsS --max-time 4 "http://$HEALTH_BIND/health" >/dev/null || {
    echo "Health check failed; restoring prior binary if available" >&2
    if [ -f /opt/bin/cudy-monitor-pro.previous ]; then
        cp /opt/bin/cudy-monitor-pro.previous /opt/bin/cudy-monitor-pro
        /opt/etc/init.d/S99cudy-monitor restart || true
    fi
    exit 1
}
echo "Cudy Monitor Pro $VER installed at http://$HEALTH_BIND/ (LAN bind requires trusted private network)."
