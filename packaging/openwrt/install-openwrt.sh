#!/bin/sh
# One-command native OpenWrt installer. No modification of DNS/firewall/routing.
set -eu
VERSION=1.2.5
PACKAGE="cudy-monitor-pro-$VERSION-r1.apk"
BASE="https://github.com/stub11/cudy-monitor-pro/releases/download/cudy-monitor-openwrt-v$VERSION"
TMPDIR=/tmp/cudy-monitor-installer.$$
umask 077
die() { echo "ERROR: $*" >&2; exit 1; }
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT HUP INT TERM

[ "$(id -u)" = 0 ] || die "Run as root via SSH on OpenWrt."
[ -f /etc/openwrt_release ] || die "Only for native OpenWrt, not KeeneticOS/Entware."
command -v apk >/dev/null 2>&1 || die "apk not found. Requires OpenWrt 25.12+."
case "$(uname -m)" in aarch64|arm64) ;; *) die "Only ARM64 is supported."; esac
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is missing."
command -v wget >/dev/null 2>&1 || die "wget is missing; download the package from GitHub on a PC and copy it to /tmp."
if [ -x /opt/bin/cudy-monitor-pro ]; then
    die "Entware monitor already exists at /opt/bin/cudy-monitor-pro. Refusing to run two competing services."
fi
mkdir -p "$TMPDIR"
echo "Cudy Monitor Pro $VERSION — native OpenWrt APK"
echo "Downloading package and checksum..."
wget -q -O "$TMPDIR/$PACKAGE" "$BASE/$PACKAGE" || die "Cannot download APK from GitHub."
wget -q -O "$TMPDIR/SHA256SUMS" "$BASE/SHA256SUMS" || die "Cannot download checksum manifest."
HASH=$(awk -v file="$PACKAGE" '{name=$2; sub(/^.*\//,"",name); if(name==file)print $1}' "$TMPDIR/SHA256SUMS")
[ "$(printf '%s' "$HASH" | wc -c | tr -d ' ')" -eq 64 ] || die "Invalid or missing SHA256 for package."
case "$HASH" in *[!0-9a-f]*|'') die "Invalid SHA256 encoding." ;; esac
printf '%s  %s\n' "$HASH" "$TMPDIR/$PACKAGE" | sha256sum -c - || die "APK checksum mismatch, refusing installation."
echo "Installing OpenWrt APK..."
apk add --allow-untrusted "$TMPDIR/$PACKAGE" || die "apk installation failed."
echo "Configuring LAN access..."
if ! cudy-monitor-lan --lan; then
    echo "Automatic LAN detection was ambiguous. Monitor remains installed, but may listen only on loopback." >&2
    echo "Run: ip -4 addr show; cudy-monitor-lan --bind-ip YOUR_ROUTER_LAN_IP" >&2
    exit 1
fi
BIND=$(head -n 1 /etc/cudy-monitor-pro/bind)
case "$BIND" in
    *[!0-9.:]*|*:*:*) die "Invalid stored LAN bind; no URL will be printed." ;;
esac
URL="http://$BIND/"
OK=0
N=0
while [ "$N" -lt 5 ]; do
    if wget -q -O - "http://$BIND/health" 2>/dev/null | grep -q "ok"; then OK=1; break; fi
    N=$((N+1))
    sleep 1
done
[ "$OK" = 1 ] || die "Package installed, but health check failed at $URL. Run: /etc/init.d/cudy-monitor-pro status; logread | grep -i cudy"
echo ""
echo "=========================================="
echo "   CUDY MONITOR PRO — INSTALLED"
echo "   OPEN IN BROWSER: $URL"
echo "   Use a phone/PC on the router's LAN/Wi-Fi"
echo "=========================================="
echo "Never expose TCP port 8237 to the Internet: the panel has no password."
