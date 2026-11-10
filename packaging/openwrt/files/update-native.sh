#!/bin/sh
# Native OpenWrt Cudy Monitor updater. Only signed-by-GitHub-API digest releases
# from stub11/cudy-monitor-pro. No arbitrary command/url is accepted.
set -eu
MODE=${1:---check}
case "$MODE" in --check|--apply) ;; *) echo "unsupported mode" >&2; exit 2;; esac
REPO=https://api.github.com/repos/stub11/cudy-monitor-pro
RELEASE=https://github.com/stub11/cudy-monitor-pro/releases/download
SELF=/usr/bin/cudy-monitor-pro
LOCK=/tmp/.cudy-monitor-native-update.lock
DIR=/tmp/cudy-monitor-native-update.$$
die(){ echo "ERROR: $*" >&2; exit 1; }
cleanup(){ rm -rf "$DIR"; if [ "$MODE" = --apply ]; then rmdir "$LOCK" 2>/dev/null || :; fi; }
fetch(){
  url=$1 dest=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fLsS --retry 1 --connect-timeout 8 --max-time 90 -o "$dest" "$url" && [ -s "$dest" ] && return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -O "$dest" "$url" && [ -s "$dest" ] && return 0
  fi
  return 1
}
[ -x "$SELF" ] || die "Cudy Monitor is not installed"
command -v apk >/dev/null 2>&1 || die "Native OpenWrt apk required"
command -v jsonfilter >/dev/null 2>&1 || die "OpenWrt jsonfilter required"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum required"
if [ "$MODE" = --apply ]; then
  mkdir "$LOCK" 2>/dev/null || die "another update is running"
fi
trap cleanup EXIT HUP INT TERM
mkdir -p "$DIR"
CURRENT=$("$SELF" --version | awk '{print $2}')
valid_version(){ printf '%s\n' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; }
valid_version "$CURRENT" || die "installed version is invalid"
newer(){
  awk -F. -v a="$1" -v b="$2" 'BEGIN{split(a,x,".");split(b,y,".");for(i=1;i<=3;i++){if(x[i]+0>y[i]+0)exit 0;if(x[i]+0<y[i]+0)exit 1}exit 1}'
}
fetch "$REPO/releases?per_page=50" "$DIR/releases.json" || die "cannot retrieve GitHub release metadata"
LATEST=$CURRENT
for tag in $(jsonfilter -i "$DIR/releases.json" -e '@[*].tag_name'); do
  case "$tag" in cudy-monitor-openwrt-v*) ver=${tag#cudy-monitor-openwrt-v} ;; *) continue;; esac
  valid_version "$ver" || continue
  if newer "$ver" "$LATEST"; then LATEST=$ver; fi
done
if [ "$MODE" = --check ]; then
  printf '%s %s\n' "$LATEST" "$CURRENT"
  exit 0
fi
newer "$LATEST" "$CURRENT" || { echo "Already up to date: $CURRENT"; exit 0; }
# Fetch the GitHub API digest for this exact asset, never an untrusted URL.
package_digest(){
  version=$1
  fetch "$REPO/releases/tags/cudy-monitor-openwrt-v$version" "$DIR/metadata.json" || die "cannot read $version release metadata"
  index=0
  while [ "$index" -lt 20 ]; do
    name=$(jsonfilter -i "$DIR/metadata.json" -e "@.assets[$index].name" 2>/dev/null || :)
    [ -n "$name" ] || break
    if [ "$name" = "cudy-monitor-pro-$version-r1.apk" ]; then
      digest=$(jsonfilter -i "$DIR/metadata.json" -e "@.assets[$index].digest" 2>/dev/null || :)
      case "$digest" in sha256:*) value=${digest#sha256:} ;; *) die "release digest missing";; esac
      [ "${#value}" -eq 64 ] || die "invalid release digest length"
      printf '%s' "$value" | grep -Eq '^[a-f0-9]{64}$' || die "invalid release digest"
      printf '%s\n' "$value"
      return 0
    fi
    index=$((index+1))
  done
  die "APK artifact missing in official GitHub release"
}
download_verified(){
  version=$1 output=$2
  hash=$(package_digest "$version")
  url="$RELEASE/cudy-monitor-openwrt-v$version/cudy-monitor-pro-$version-r1.apk"
  fetch "$url" "$output" || die "cannot download verified APK for $version"
  actual=$(sha256sum "$output" | awk '{print $1}')
  [ "$actual" = "$hash" ] || die "APK SHA256 mismatch for $version"
}
# Must have a verified old APK before replacing a working instance.
download_verified "$CURRENT" "$DIR/previous.apk"
download_verified "$LATEST" "$DIR/next.apk"
echo "Upgrading Cudy Monitor Pro $CURRENT -> $LATEST"
if ! apk add --allow-untrusted "$DIR/next.apk"; then
  echo "Upgrade failed. Attempting verified rollback to $CURRENT." >&2
  apk add --allow-untrusted "$DIR/previous.apk" || die "ROLLBACK FAILED; manual recovery required"
  die "Upgrade failed; previous package restored"
fi
BIND=$(head -n 1 /etc/cudy-monitor-pro/bind 2>/dev/null || printf '127.0.0.1:8237')
case "$BIND" in *[!0-9.:]*|*:*:*) die "Upgrade completed but stored LAN bind invalid";; esac
healthy=0
tries=0
while [ "$tries" -lt 12 ]; do
  if wget -q -O - "http://$BIND/health" 2>/dev/null | grep -qx ok; then healthy=1; break; fi
  tries=$((tries+1));sleep 1
done
if [ "$healthy" -ne 1 ]; then
  echo "Health check failed; restoring previously verified package" >&2
  apk add --allow-untrusted "$DIR/previous.apk" || die "ROLLBACK FAILED; manual recovery required"
  die "Updated service failed health check; previous package restored"
fi
echo "UPDATED $LATEST"
