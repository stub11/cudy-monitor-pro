#!/bin/sh
# One-time migration for legacy native OpenWrt users with outdated bundled OTA.
# The updater source is pinned to an immutable, reviewed project commit.
# No DNS, routing, firewall, firmware, or other packages are modified.
set -eu
[ "$(id -u)" = 0 ] || { echo "ERROR: run as root" >&2; exit 1; }
[ -f /etc/openwrt_release ] || { echo "ERROR: native OpenWrt required" >&2; exit 1; }
command -v apk >/dev/null 2>&1 || { echo "ERROR: OpenWrt APK required" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: HTTPS curl required" >&2; exit 1; }
[ -x /usr/bin/cudy-monitor-pro ] || { echo "ERROR: installed monitor not found" >&2; exit 1; }
[ ! -x /opt/bin/cudy-monitor-pro ] || { echo "ERROR: conflicting Entware monitor found" >&2; exit 1; }
CURRENT=$(/usr/bin/cudy-monitor-pro --version)
case "$CURRENT" in
  "cudy-monitor-pro 1.2.21"|"cudy-monitor-pro 1.2.22"|"cudy-monitor-pro 1.2.23") ;;
  *) echo "ERROR: this migration is only for verified legacy 1.2.21–1.2.23; installed: $CURRENT" >&2; exit 1 ;;
esac
UPDATER_URL=https://raw.githubusercontent.com/stub11/cudy-monitor-pro/81360c8077e6c5f9bae739d92120ab46e836e8bc/packaging/openwrt/files/update-native.sh
TMP=$(mktemp /tmp/cudy-monitor-legacy-ota.XXXXXX) || exit 1
trap 'rm -f "$TMP"' EXIT HUP INT TERM
umask 077
curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 8 --max-time 45 -o "$TMP" "$UPDATER_URL" || { echo "ERROR: cannot fetch pinned official updater; monitor unchanged" >&2; exit 1; }
[ -s "$TMP" ] || { echo "ERROR: downloaded updater empty" >&2; exit 1; }
/bin/sh -n "$TMP" || { echo "ERROR: invalid updater shell syntax" >&2; exit 1; }
echo "Legacy OpenWrt $CURRENT. Checking verified release..."
/bin/sh "$TMP" --check || { echo "ERROR: release check failed; monitor unchanged" >&2; exit 1; }
echo "Updating with pinned official updater. It verifies both old and new APK checksums and performs rollback if checks fail."
/bin/sh "$TMP" --apply
