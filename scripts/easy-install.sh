#!/bin/sh
# Universal ARM64 one-command bootstrap: native OpenWrt 25.12 APK or Keenetic Ported + Entware.
set -eu
BASE=https://raw.githubusercontent.com/stub11/cudy-monitor-pro/main
fetch() {
  url=$1
  dest=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fL --connect-timeout 8 --max-time 45 -o "$dest" "$url"
  elif [ -x /opt/bin/curl ]; then
    /opt/bin/curl -fL --connect-timeout 8 --max-time 45 -o "$dest" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$dest" "$url"
  elif [ -x /opt/bin/wget ]; then
    /opt/bin/wget -q -O "$dest" "$url"
  else
    echo "ERROR: wget or curl is required to download installer." >&2
    return 1
  fi
}
[ "$(id -u)" = 0 ] || { echo "ERROR: Run as root in the router Linux shell." >&2; exit 1; }
case "$(uname -m)" in aarch64|arm64) ;; *) echo "ERROR: ARM64 only." >&2; exit 1;; esac
if [ -f /etc/openwrt_release ]; then
  echo "OpenWrt detected: using native APK installer."
  command -v apk >/dev/null 2>&1 || { echo "ERROR: Native APK requires OpenWrt 25.12+." >&2; exit 1; }
  FILE=/tmp/cudy-monitor-openwrt-install.$$.sh
  trap 'rm -f "$FILE"' EXIT HUP INT TERM
  fetch "$BASE/packaging/openwrt/install-openwrt.sh" "$FILE"
  /bin/sh "$FILE"
elif [ -d /opt/etc/init.d ] && [ -x /opt/bin/opkg ]; then
  echo "Entware router detected: installing monitor via Entware (Keenetic Ported supported)."
  mkdir -p /opt/tmp
  FILE=/opt/tmp/cudy-monitor-entware-install.$$.sh
  trap 'rm -f "$FILE"' EXIT HUP INT TERM
  fetch "$BASE/cudy-monitor/scripts/install.sh" "$FILE"
  /bin/sh "$FILE" --lan
else
  echo "ERROR: Unsupported system. Requires OpenWrt 25.12+ APK or Keenetic Ported with ARM64 Entware mounted at /opt." >&2
  exit 1
fi
