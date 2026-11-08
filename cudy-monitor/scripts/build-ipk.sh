#!/bin/sh
# Build a standard Entware .ipk package (ar + control/data tar.gz).
# Usage: sh build-ipk.sh PATH_TO_AARCH64_BINARY VERSION OUTPUT_DIRECTORY
set -eu
[ "$#" -eq 3 ] || { echo "Usage: $0 binary version output-dir" >&2; exit 2; }
BINARY=$1
VERSION=$2
DEST=$3
case "$VERSION" in ''|*[!0-9.]*|*..*|.*|*.) echo "Invalid version" >&2; exit 2;; esac
[ -r "$BINARY" ] || { echo "Missing binary" >&2; exit 1; }
command -v ar >/dev/null 2>&1 || { echo "GNU ar required for packaging" >&2; exit 1; }
mkdir -p "$DEST"
DEST=$(cd "$DEST" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/control" "$WORK/data/opt/bin" "$WORK/data/opt/etc/init.d" "$WORK/data/opt/share/cudy-monitor"
cp "$BINARY" "$WORK/data/opt/bin/cudy-monitor-pro"
cp scripts/S99cudy-monitor "$WORK/data/opt/etc/init.d/S99cudy-monitor"
cp scripts/update.sh "$WORK/data/opt/share/cudy-monitor/update.sh"
cp scripts/openwrt-procd "$WORK/data/opt/share/cudy-monitor/openwrt-procd"
printf '%s\n' "$VERSION" > "$WORK/data/opt/share/cudy-monitor/VERSION"
chmod 755 "$WORK/data/opt/bin/cudy-monitor-pro" "$WORK/data/opt/etc/init.d/S99cudy-monitor" "$WORK/data/opt/share/cudy-monitor/update.sh"
cat > "$WORK/control/control" <<EOF
Package: cudy-monitor-pro
Version: $VERSION-1
Architecture: aarch64-3.10
Maintainer: Cudy Monitor Contributors
Section: net
Priority: optional
Description: Standalone ARM64 router monitor for Entware/OpenWrt/KeeneticOS
EOF
cat > "$WORK/control/postinst" <<'EOF'
#!/bin/sh
set -eu
[ -z "${IPKG_INSTROOT:-}" ] || exit 0
mkdir -p /opt/etc/cudy-monitor /opt/var/run
chmod 700 /opt/etc/cudy-monitor
[ -f /opt/etc/cudy-monitor/bind ] || printf '127.0.0.1:8237\n' > /opt/etc/cudy-monitor/bind
chmod 600 /opt/etc/cudy-monitor/bind
if [ -f /etc/openwrt_release ] && [ -f /etc/rc.common ]; then
    cp /opt/share/cudy-monitor/openwrt-procd /etc/init.d/cudy-monitor-pro
    chmod 755 /etc/init.d/cudy-monitor-pro
    /etc/init.d/cudy-monitor-pro enable
fi
/opt/etc/init.d/S99cudy-monitor restart
echo "Cudy Monitor Pro installed. Default: http://127.0.0.1:8237/"
echo "Set trusted LAN IP in /opt/etc/cudy-monitor/bind and restart to allow LAN access."
EOF
cat > "$WORK/control/prerm" <<'EOF'
#!/bin/sh
[ -z "${IPKG_INSTROOT:-}" ] || exit 0
/opt/etc/init.d/S99cudy-monitor stop >/dev/null 2>&1 || true
if [ -f /etc/openwrt_release ] && [ -x /etc/init.d/cudy-monitor-pro ]; then
    /etc/init.d/cudy-monitor-pro disable >/dev/null 2>&1 || true
    rm -f /etc/init.d/cudy-monitor-pro
fi
exit 0
EOF
chmod 755 "$WORK/control/postinst" "$WORK/control/prerm"
(cd "$WORK/control" && tar -czf "$WORK/control.tar.gz" .)
(cd "$WORK/data" && tar -czf "$WORK/data.tar.gz" .)
printf '2.0\n' > "$WORK/debian-binary"
OUT="$DEST/cudy-monitor-pro_${VERSION}-1_aarch64-3.10.ipk"
(cd "$WORK" && ar qc "$OUT" debian-binary control.tar.gz data.tar.gz)
echo "$OUT"
