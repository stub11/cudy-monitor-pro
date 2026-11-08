#!/bin/sh
# Portable installer for OpenWrt/KeeneticOS ARM64 routers with Entware.
# Run only after reviewing the script and confirming a working /opt USB mount.
set -eu
ROOT=/opt
MODE="${1:---local}"
EXPLICIT_IP=""
case "$MODE" in
  --local|--lan|--check) [ "$#" -eq 0 ] || [ "$#" -eq 1 ] || exit 2 ;;
  --bind-ip) [ "$#" -eq 2 ] || { echo "Usage: sh install.sh --bind-ip PRIVATE_ASSIGNED_IPV4" >&2; exit 2; }; EXPLICIT_IP=$2 ;;
  *) echo "Usage: sh install.sh [--local|--lan|--check|--bind-ip PRIVATE_ASSIGNED_IPV4]" >&2; exit 2;;
esac
OPENWRT=0
[ ! -f /etc/openwrt_release ] || OPENWRT=1
if [ "$MODE" = --check ]; then
    echo "Platform: $(if [ "$OPENWRT" = 1 ]; then echo OpenWrt; else echo KeeneticOS/other; fi)"
    echo "Architecture: $(uname -m)"
    [ -x /opt/bin/opkg ] && /opt/bin/opkg print-architecture || echo "Entware opkg not found under /opt/bin"
    [ -d /opt/etc/init.d ] || echo "Entware /opt/etc/init.d not found"
    exit 0
fi
REPO=https://github.com/stub11/cudy-monitor-pro
BASE=https://raw.githubusercontent.com/stub11/cudy-monitor-pro
CURL=/opt/bin/curl
SHASUM=/opt/bin/sha256sum
[ -x "$CURL" ] || CURL=curl
[ -x "$SHASUM" ] || SHASUM=sha256sum
if command -v "$CURL" >/dev/null 2>&1; then
    FETCH_TOOL=curl
elif command -v wget >/dev/null 2>&1; then
    FETCH_TOOL=wget
else
    echo "Requires curl or wget" >&2; exit 1
fi
fetch() {
    url=$1
    dest=$2
    if [ "$FETCH_TOOL" = curl ]; then
        "$CURL" --proto '=https' --tlsv1.2 -fsSL --connect-timeout 5 --max-time 120 "$url" -o "$dest"
    else
        wget -q -O "$dest" "$url"
    fi
}
command -v "$SHASUM" >/dev/null 2>&1 || { echo "Requires sha256sum" >&2; exit 1; }
[ "$(uname -m)" = "aarch64" ] || { echo "Expected aarch64 router" >&2; exit 1; }
[ -d "$ROOT/etc/init.d" ] && [ -d "$ROOT/bin" ] || { echo "Entware not mounted" >&2; exit 1; }
case "$(readlink -f /opt 2>/dev/null || echo /opt)" in
    *tmpfs*) echo "Unsafe temporary Entware path" >&2; exit 1 ;;
esac
mkdir -p /opt/tmp
TMP=$(mktemp -d /opt/tmp/cudy-monitor.XXXXXX) || exit 1
trap 'rm -rf "$TMP"' EXIT
fetch "$REPO/releases/latest/download/latest.txt" "$TMP/latest"
VER=$(sed -n '1p' "$TMP/latest")
SUM=$(sed -n '2p' "$TMP/latest")
printf '%s\n' "$VER" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || exit 1
printf '%s\n' "$SUM" | grep -Eq '^[a-f0-9]{64}$' || exit 1
fetch "$REPO/releases/download/cudy-monitor-v$VER/cudy-monitor-pro-aarch64" "$TMP/monitor"
[ "$("$SHASUM" "$TMP/monitor" | awk '{print $1}')" = "$SUM" ] || { echo "Checksum mismatch" >&2; exit 1; }
for script in update.sh S99cudy-monitor detect-lan.sh $(if [ "$OPENWRT" = 1 ]; then echo openwrt-procd; fi); do
    fetch "$BASE/cudy-monitor-v$VER/cudy-monitor/scripts/$script" "$TMP/$script"
    # Some BusyBox ash builds reject "sh -n", so do not require it on the router.
    case "$script" in openwrt-procd) expected_header='#!/bin/sh /etc/rc.common' ;; *) expected_header='#!/bin/sh' ;; esac
    [ "$(sed -n '1p' "$TMP/$script")" = "$expected_header" ] || {
        echo "Unexpected $script header" >&2; exit 1;
    }
    case "$script" in
      detect-lan.sh)
        grep -q 'Cannot uniquely identify a trusted LAN IPv4' "$TMP/$script" || {
            echo "Unexpected address-detection helper" >&2; exit 1;
        } ;;
      update.sh)
        grep -q 'stub11/cudy-monitor-pro/releases' "$TMP/$script" || {
            echo "Unexpected OTA source" >&2; exit 1;
        } ;;
      S99cudy-monitor|openwrt-procd)
        grep -q '/opt/bin/cudy-monitor-pro' "$TMP/$script" || {
            echo "Unexpected service launcher" >&2; exit 1;
        } ;;
    esac
done
# Resolve the requested LAN address BEFORE touching any installed files.
# Detection failure must never stop an already running monitor.
SELECTED_IP=127.0.0.1
if [ "$MODE" = --lan ]; then
    SELECTED_IP=$(/bin/sh "$TMP/detect-lan.sh" detect) || exit 1
elif [ "$MODE" = --bind-ip ]; then
    SELECTED_IP=$(/bin/sh "$TMP/detect-lan.sh" validate "$EXPLICIT_IP") || exit 1
fi
mkdir -p /opt/etc/cudy-monitor /opt/share/cudy-monitor /opt/var/run "$TMP/backup"
BIN=/opt/bin/cudy-monitor-pro
INIT=/opt/etc/init.d/S99cudy-monitor
UPD=/opt/share/cudy-monitor/update.sh
META=/opt/share/cudy-monitor/VERSION
BIND=/opt/etc/cudy-monitor/bind
PREV="$BIN.previous"
PROCD=/etc/init.d/cudy-monitor-pro
PROCD_WAS_ENABLED=0
[ -e /etc/rc.d/S99cudy-monitor-pro ] && PROCD_WAS_ENABLED=1
WAS_RUNNING=0
if [ -x "$INIT" ] && "$INIT" status >/dev/null 2>&1; then WAS_RUNNING=1; fi
backup() { [ ! -f "$2" ] || cp -p "$2" "$TMP/backup/$1"; }
restore() {
    if [ -f "$TMP/backup/$1" ]; then
        cp -p "$TMP/backup/$1" "$2" || echo "WARNING: restore failed: $1" >&2
    else
        rm -f "$2" || true
    fi
}
backup binary "$BIN"
backup init "$INIT"
backup updater "$UPD"
backup version "$META"
backup bind "$BIND"
backup previous "$PREV"
if [ "$OPENWRT" = 1 ]; then backup procd "$PROCD"; fi
COMMITTED=0
finish() {
    result=$?
    trap - EXIT
    if [ "$COMMITTED" -eq 0 ]; then
        echo "ERROR: reverting incomplete Cudy Monitor installation" >&2
        [ ! -x "$INIT" ] || "$INIT" stop >/dev/null 2>&1 || true
        restore binary "$BIN"
        restore init "$INIT"
        restore updater "$UPD"
        restore version "$META"
        restore bind "$BIND"
        restore previous "$PREV"
        if [ "$OPENWRT" = 1 ]; then
            [ "$PROCD_WAS_ENABLED" = 1 ] || [ ! -x "$PROCD" ] || "$PROCD" disable >/dev/null 2>&1 || true
            restore procd "$PROCD"
            if [ "$PROCD_WAS_ENABLED" = 1 ] && [ -x "$PROCD" ]; then "$PROCD" enable || true; fi
        fi
        if [ "$WAS_RUNNING" -eq 1 ] && [ -x "$INIT" ]; then
            "$INIT" start || echo "WARNING: prior monitor did not restart" >&2
        fi
    fi
    rm -rf "$TMP"
    exit "$result"
}
trap finish EXIT
chmod 700 /opt/etc/cudy-monitor
# Version 0.4.4+ runs without a login token; preserve any legacy token file but do not use it.
# Explicit --lan/--bind-ip refresh an existing stale bind; --local preserves it.
if [ ! -f "$BIND" ] || [ "$MODE" = --lan ] || [ "$MODE" = --bind-ip ]; then
    printf '%s:8237\n' "$SELECTED_IP" > "$BIND"
fi
chmod 600 /opt/etc/cudy-monitor/bind
cp "$TMP/monitor" /opt/bin/cudy-monitor-pro
chmod 755 /opt/bin/cudy-monitor-pro
cp "$TMP/update.sh" /opt/share/cudy-monitor/update.sh
cp "$TMP/S99cudy-monitor" /opt/etc/init.d/S99cudy-monitor
chmod 755 /opt/etc/init.d/S99cudy-monitor
if [ "$OPENWRT" = 1 ]; then
    [ -f /etc/rc.common ] || { echo "OpenWrt procd integration requires /etc/rc.common" >&2; exit 1; }
    cp "$TMP/openwrt-procd" "$PROCD"
    chmod 755 "$PROCD"
    "$PROCD" enable
fi
/opt/etc/init.d/S99cudy-monitor restart
sleep 2
HEALTH_BIND=$(cat /opt/etc/cudy-monitor/bind)
( if [ "$FETCH_TOOL" = curl ]; then "$CURL" -fsS --max-time 4 "http://$HEALTH_BIND/health"; else wget -q -O - "http://$HEALTH_BIND/health"; fi ) >/dev/null || {
    echo "Health check failed" >&2
    exit 1
}
printf '%s\n' "$VER" > "$META"
if [ -f "$TMP/backup/binary" ]; then
    cp -p "$TMP/backup/binary" "$PREV"
fi
COMMITTED=1
echo "Cudy Monitor Pro $VER installed on $(if [ "$OPENWRT" = 1 ]; then echo OpenWrt; else echo Entware; fi)."
echo "Panel: http://$HEALTH_BIND/ (LAN access requires explicit --lan or manual trusted IP)."
echo "Service: /opt/etc/init.d/S99cudy-monitor {start|stop|restart|status}"
