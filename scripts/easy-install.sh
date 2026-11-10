#!/bin/sh
# One-command Cudy Monitor Pro install/update/remove for supported ARM64 routers.
# No DNS, routing, Wi-Fi, firewall, or unrelated Entware changes.
set -eu

BASE=https://raw.githubusercontent.com/stub11/cudy-monitor-pro/main
ACTION=${1:---install}
die() { echo "ERROR: $*" >&2; exit 1; }
case "$ACTION" in --install|--update|--remove) ;; *) echo "Usage: sh easy-install.sh [--install|--update|--remove] [--file /tmp/package.apk]" >&2; exit 2;; esac
LOCAL_APK=
if [ "${2:-}" = --file ] && [ -n "${3:-}" ] && [ "$#" -eq 3 ]; then
  [ "$ACTION" != --remove ] || die "--file is not valid with --remove"
  LOCAL_APK=$3
elif [ "$#" -gt 1 ]; then
  die "Usage: sh easy-install.sh [--install|--update|--remove] [--file /tmp/package.apk]"
fi
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
    die "wget or curl is required to download the installer."
  fi
}
[ "$(id -u)" = 0 ] || die "Run as root in the router's Linux shell."
case "$(uname -m)" in aarch64|arm64) ;; *) die "Only ARM64 is supported." ;; esac

if [ -f /etc/openwrt_release ]; then
  command -v apk >/dev/null 2>&1 || die "Native APK needs OpenWrt 25.12+."
  if [ "$ACTION" = --remove ]; then
    if ! apk info -e cudy-monitor-pro >/dev/null 2>&1; then
      echo "Cudy Monitor Pro native OpenWrt package is not installed."
      exit 0
    fi
    echo "Removing ONLY native OpenWrt package cudy-monitor-pro..."
    apk del cudy-monitor-pro || die "Package removal failed."
    echo "Removed. Configuration /etc/cudy-monitor-pro was left unchanged."
    exit 0
  fi
  if [ "$ACTION" = --update ] && ! apk info -e cudy-monitor-pro >/dev/null 2>&1; then
    die "Native OpenWrt package is not installed. Use --install."
  fi
  [ ! -x /opt/bin/cudy-monitor-pro ] || die "Entware monitor also exists: refusing conflicting native installation."
  echo "OpenWrt: using native APK package installer."
  FILE=/tmp/cudy-monitor-openwrt-install.$$.sh
  trap 'rm -f "$FILE"' EXIT HUP INT TERM
  fetch "$BASE/packaging/openwrt/install-openwrt.sh" "$FILE"
  if [ -n "$LOCAL_APK" ]; then /bin/sh "$FILE" --file "$LOCAL_APK"; else /bin/sh "$FILE"; fi
elif [ -d /opt/etc/init.d ] && [ -x /opt/bin/opkg ]; then
  [ -z "$LOCAL_APK" ] || die "--file APK is only for native OpenWrt."
  BIN=/opt/bin/cudy-monitor-pro
  INIT=/opt/etc/init.d/S99cudy-monitor
  META=/opt/share/cudy-monitor
  PACKAGED=0
  if /opt/bin/opkg status cudy-monitor-pro 2>/dev/null | grep -q '^Status:.*installed'; then PACKAGED=1; fi
  if [ "$ACTION" = --remove ]; then
    if [ "$PACKAGED" = 1 ]; then
      echo "Removing Entware IPK via its package manager (other Entware packages are untouched)..."
      /opt/bin/opkg remove cudy-monitor-pro || die "Entware package removal failed."
    elif [ -x "$BIN" ] || [ -f "$INIT" ]; then
      echo "Removing standalone Cudy Monitor Pro files only..."
      [ ! -x "$INIT" ] || "$INIT" stop || die "Monitor service could not stop. No files removed."
      rm -f "$BIN" "$BIN.previous" "$BIN.failed" "$INIT" \
        "$META/update.sh" "$META/VERSION" "$META/detect-lan.sh" "$META/openwrt-procd" \
        /opt/var/run/cudy-monitor-pro.pid
    else
      echo "Cudy Monitor Pro is not installed."
      exit 0
    fi
    echo "Removed. Saved settings in /opt/etc/cudy-monitor are preserved."
    exit 0
  fi
  if [ "$ACTION" = --update ]; then
    [ -x "$BIN" ] || die "Monitor is not installed. Use --install."
    [ "$PACKAGED" = 0 ] || die "Monitor installed with opkg IPK. Update with the Entware opkg package manager to keep package records consistent."
  fi
  [ "$PACKAGED" = 0 ] || die "Entware IPK is installed: avoid mixing opkg and script installation methods."
  echo "Keenetic Ported / Entware: installing or updating standalone monitor."
  mkdir -p /opt/tmp
  FILE=/opt/tmp/cudy-monitor-entware-install.$$.sh
  trap 'rm -f "$FILE"' EXIT HUP INT TERM
  fetch "$BASE/cudy-monitor/scripts/install.sh" "$FILE"
  /bin/sh "$FILE" --lan
else
  die "Requires OpenWrt 25.12+ APK or Keenetic Ported with ARM64 Entware at /opt."
fi
