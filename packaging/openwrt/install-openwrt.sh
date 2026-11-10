#!/bin/sh
# Native OpenWrt APK v3 installer. Never modifies DNS, routes or firewall.
set -eu
VERSION=1.2.10
PACKAGE="cudy-monitor-pro-$VERSION-r1.apk"
EXPECTED_SHA256=5bc7c3299e70d7ae3d12d1c522cfc77ce008d1107572ceb4d82e65b4614e4efd
BASE="https://github.com/stub11/cudy-monitor-pro/releases/download/cudy-monitor-openwrt-v$VERSION"
WORKDIR=/tmp/cudy-monitor-installer.$$
LOCAL_FILE=
umask 077
die(){ echo "ERROR: $*" >&2; exit 1; }
cleanup(){ rm -rf "$WORKDIR"; }
trap cleanup EXIT HUP INT TERM
usage(){ echo "Usage: sh install-openwrt.sh [--file /tmp/$PACKAGE]"; exit 2; }
case "${1:-}" in
  "") ;;
  --file) [ "$#" -eq 2 ] || usage; LOCAL_FILE=$2 ;;
  *) usage ;;
esac
[ "$(id -u)" = 0 ] || die "Run as root over SSH."
[ -f /etc/openwrt_release ] || die "OpenWrt required."
command -v apk >/dev/null 2>&1 || die "OpenWrt 25.12+ apk required."
case "$(uname -m)" in aarch64|arm64) ;; *) die "ARM64 required."; esac
command -v sha256sum >/dev/null 2>&1 || die "sha256sum required."
[ ! -x /opt/bin/cudy-monitor-pro ] || die "Entware monitor already installed. Do not run both versions."
mkdir -p "$WORKDIR"
TARGET="$WORKDIR/$PACKAGE"
download_file(){
  URL=$1; DEST=$2
  # Some BusyBox wget builds cannot follow GitHub release-asset HTTPS redirects.
  # Show the actual error and retry with curl if available. Never disable TLS checks.
  if command -v wget >/dev/null 2>&1; then
    echo "Trying wget (including GitHub redirects)..."
    if wget -O "$DEST" "$URL" && [ -s "$DEST" ]; then return 0; fi
    echo "wget failed; trying curl if available." >&2
  fi
  if command -v curl >/dev/null 2>&1; then
    echo "Trying curl..."
    if curl -fL --retry 2 --connect-timeout 12 --max-time 100 -o "$DEST" "$URL" && [ -s "$DEST" ]; then return 0; fi
  elif [ -x /opt/bin/curl ]; then
    echo "Trying Entware curl..."
    if /opt/bin/curl -fL --retry 2 --connect-timeout 12 --max-time 100 -o "$DEST" "$URL" && [ -s "$DEST" ]; then return 0; fi
  fi
  return 1
}
echo "Cudy Monitor Pro $VERSION — native OpenWrt APK"
if [ -n "$LOCAL_FILE" ]; then
  [ -f "$LOCAL_FILE" ] || die "Local APK file not found: $LOCAL_FILE"
  echo "Using local APK file: $LOCAL_FILE"
  cp "$LOCAL_FILE" "$TARGET" || die "Cannot read local APK."
else
  echo "Downloading package from official GitHub Releases..."
  if ! download_file "$BASE/$PACKAGE" "$TARGET"; then
    echo "Download failed. GitHub release exists, but this router cannot fetch it." >&2
    echo "Possible TLS/DNS/HTTPS redirect problem (release-assets.githubusercontent.com)." >&2
    echo "Download $PACKAGE on phone/PC, transfer to router /tmp via SFTP/SCP," >&2
    echo "then run: sh /tmp/cudy-monitor-easy.sh --install --file /tmp/$PACKAGE" >&2
    die "Cannot download APK. No packages have been installed."
  fi
fi
# Pin this release's SHA-256 from the GitHub release API.
ACTUAL_SHA256=$(sha256sum "$TARGET" | awk '{print $1}')
[ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ] || die "SHA256 mismatch: expected $EXPECTED_SHA256, got $ACTUAL_SHA256. Refusing installation."
echo "SHA256 verified: $ACTUAL_SHA256"
echo "Installing verified OpenWrt APK..."
apk add --allow-untrusted "$TARGET" || die "apk installation failed."
echo "Configuring LAN access..."
if ! cudy-monitor-lan --lan; then
  echo "LAN detection ambiguous. Monitor is installed, but local-only access may be in effect." >&2
  echo "Use: ip -4 addr show; cudy-monitor-lan --bind-ip YOUR_ROUTER_LAN_IP" >&2
  exit 1
fi
BIND=$(head -n 1 /etc/cudy-monitor-pro/bind)
case "$BIND" in *[!0-9.:]*|*:*:*) die "Invalid stored LAN bind." ;; esac
URL="http://$BIND/"
OK=0
N=0
while [ "$N" -lt 5 ]; do
  if wget -q -O - "http://$BIND/health" 2>/dev/null | grep -q "ok"; then OK=1; break; fi
  N=$((N+1))
  sleep 1
done
[ "$OK" = 1 ] || die "Installed, but health check failed: $URL. Check /etc/init.d/cudy-monitor-pro status and logread | grep -i cudy"
echo ""
echo "=========================================="
echo "   CUDY MONITOR PRO — INSTALLED"
echo "   OPEN IN BROWSER: $URL"
echo "   Use a phone/PC on the router's LAN/Wi-Fi"
echo "=========================================="
echo "Never expose TCP port 8237 to the Internet: the panel has no password."
