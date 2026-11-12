#!/bin/sh
# Native OpenWrt Cudy Monitor updater. Only project-published releases
# verified against official GitHub API asset digests or the maintainer's
# HTTPS-hosted, release-pinned SHA256 list. No arbitrary URLs are accepted.
set -eu
MODE=${1:---check}
case "$MODE" in --check|--apply) ;; *) echo "unsupported mode" >&2; exit 2;; esac
REPO=https://api.github.com/repos/stub11/cudy-monitor-pro
RELEASE=https://github.com/stub11/cudy-monitor-pro/releases/download
# Fixed official repository file: entries must be version + published SHA256.
FALLBACK=https://raw.githubusercontent.com/stub11/cudy-monitor-pro/main/packaging/openwrt/release-digests.txt
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
# In restricted networks api.github.com can return HTTP 403 even when
# GitHub Release asset downloads succeed. The fallback is a fixed HTTPS file
# from the same maintained repository; never accept arbitrary URL input.
# Reject malformed or duplicate entries and retain checksum verification.
read_fallback(){
  fetch "$FALLBACK" "$DIR/release-digests.txt" || die "GitHub API unavailable and pinned release list inaccessible. Installed version unchanged"
  awk '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    NF != 2 || $1 !~ /^[0-9]+\.[0-9]+\.[0-9]+$/ || length($2) != 64 || $2 !~ /^[a-f0-9]+$/ { bad=1; exit 1 }
    seen[$1]++ { bad=1; exit 1 }
    { entries++ }
    END { if (bad || entries == 0) exit 1 }
  ' "$DIR/release-digests.txt" || die "Invalid pinned release list. Installed version unchanged"
}
fallback_digest(){
  awk -v version="$1" '$1 == version { print $2 }' "$DIR/release-digests.txt"
}
# A proxy may reply HTTP 200 with an empty/malformed body. Treating that
# as an empty release list would falsely report "already up to date".
# At least one valid native OpenWrt release tag must be present.
parse_api_releases(){
  tags=$(jsonfilter -i "$DIR/releases.json" -e '@[*].tag_name' 2>/dev/null) || return 1
  found=0
  for tag in $tags; do
    case "$tag" in cudy-monitor-openwrt-v*) ver=${tag#cudy-monitor-openwrt-v} ;; *) continue;; esac
    valid_version "$ver" || continue
    found=1
    if newer "$ver" "$LATEST"; then LATEST=$ver; fi
  done
  [ "$found" -eq 1 ]
}
LATEST=$CURRENT
USE_FALLBACK=0
if fetch "$REPO/releases?per_page=50" "$DIR/releases.json" && parse_api_releases; then
  :
else
  echo "GitHub API release listing unavailable or invalid; trying verified maintainer-pinned SHA256 list" >&2
  LATEST=$CURRENT
  read_fallback
  USE_FALLBACK=1
  for ver in $(awk '!/^[[:space:]]*(#|$)/ {print $1}' "$DIR/release-digests.txt"); do
    if newer "$ver" "$LATEST"; then LATEST=$ver; fi
  done
fi
if [ "$MODE" = --check ]; then
  printf '%s %s\n' "$LATEST" "$CURRENT"
  exit 0
fi
newer "$LATEST" "$CURRENT" || { echo "Already up to date: $CURRENT"; exit 0; }
# Fetch the GitHub API digest for this exact asset, never an untrusted URL.
# Parse only the exact expected APK's SHA256 from an official release.
# Missing/invalid API asset metadata must not become an unchecked download.
api_asset_digest(){
  version=$1
  index=0
  while [ "$index" -lt 20 ]; do
    name=$(jsonfilter -i "$DIR/metadata.json" -e "@.assets[$index].name" 2>/dev/null) || return 1
    [ -n "$name" ] || return 1
    if [ "$name" = "cudy-monitor-pro-$version-r1.apk" ]; then
      digest=$(jsonfilter -i "$DIR/metadata.json" -e "@.assets[$index].digest" 2>/dev/null) || return 1
      case "$digest" in sha256:*) value=${digest#sha256:} ;; *) return 1 ;; esac
      [ "${#value}" -eq 64 ] || return 1
      printf '%s' "$value" | grep -Eq '^[a-f0-9]{64}$' || return 1
      printf '%s\n' "$value"
      return 0
    fi
    index=$((index+1))
  done
  return 1
}
# A 200 response with malformed/absent asset digest is equivalent to an
# unavailable metadata source, NOT permission to skip checksum verification.
package_digest(){
  version=$1
  if [ "$USE_FALLBACK" != 1 ]; then
    if fetch "$REPO/releases/tags/cudy-monitor-openwrt-v$version" "$DIR/metadata.json"; then
      if value=$(api_asset_digest "$version"); then
        printf '%s\n' "$value"
        return 0
      fi
      echo "GitHub API asset SHA256 absent/invalid; checking pinned digest" >&2
    else
      echo "GitHub API digest unavailable; checking pinned digest" >&2
    fi
  fi
  [ -f "$DIR/release-digests.txt" ] || read_fallback
  value=$(fallback_digest "$version")
  [ -n "$value" ] || die "No verified pinned digest for $version; refusing update"
  printf '%s\n' "$value"
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
# Confirm the *running* executable version, not merely a responsive /health.
# /proc/<pid>/exe still refers to the old executable after a package replacement
# until that process really exits. Read-only, no network, safe with panel auth.
running_matches() {
  expected=$1
  command -v pidof >/dev/null 2>&1 || return 1
  pids=$(pidof cudy-monitor-pro 2>/dev/null) || return 1
  [ -n "$pids" ] || return 1
  checked=0
  for pid in $pids; do
    case "$pid" in ''|*[!0-9]*) return 1 ;; esac
    [ -x "/proc/$pid/exe" ] || return 1
    value=$("/proc/$pid/exe" --version 2>/dev/null) || return 1
    [ "$value" = "cudy-monitor-pro $expected" ] || return 1
    checked=$((checked+1))
  done
  [ "$checked" -gt 0 ]
}
restore_old() {
  echo "Update verification failed; attempting verified rollback to $CURRENT." >&2
  apk add --allow-untrusted "$DIR/previous.apk" || die "ROLLBACK FAILED: previous package could not be restored"
  # Package scripts may restart the service. Verify that the rollback is live.
  retries=0
  while [ "$retries" -lt 12 ]; do
    # A still-running old daemon is not proof the previous APK was restored.
    # Require both the installed executable and every monitor process to match.
    installed=$("$SELF" --version 2>/dev/null || :)
    if [ "$installed" = "cudy-monitor-pro $CURRENT" ] &&
       running_matches "$CURRENT"; then
      echo "ROLLBACK OK: installed and running $CURRENT" >&2
      return 0
    fi
    retries=$((retries+1))
    sleep 1
  done
  die "ROLLBACK FAILED: previous process version not observed"
}

# Validate the persisted LAN bind before making ANY package changes.
# Failing here leaves the original installed and running version untouched.
BIND=$(head -n 1 /etc/cudy-monitor-pro/bind 2>/dev/null || printf '127.0.0.1:8237')
case "$BIND" in *[!0-9.:]*|*:*:*) die "Stored LAN bind invalid; update not started" ;; esac
[ -n "$BIND" ] || die "Stored LAN bind empty; update not started"
download_verified "$CURRENT" "$DIR/previous.apk"
download_verified "$LATEST" "$DIR/next.apk"
echo "Upgrading Cudy Monitor Pro $CURRENT -> $LATEST"
if ! apk add --allow-untrusted "$DIR/next.apk"; then
  echo "Upgrade failed. Attempting verified rollback to $CURRENT." >&2
  restore_old
  die "Upgrade failed; verified previous package restored"
fi
# The APK package post-upgrade hook may start a daemon while procd is still
# transitioning. Independently restart the newly installed binary once before
# checking /health and the live executable. Never restart a wrong disk version.
activate_updated_service(){
  expected=$1
  disk=$("$SELF" --version 2>/dev/null || :)
  if [ "$disk" != "cudy-monitor-pro $expected" ]; then
    echo "VERIFY FAILED: installed binary version differs from $expected" >&2
    return 1
  fi
  if ! /etc/init.d/cudy-monitor-pro restart >/dev/null 2>&1; then
    echo "VERIFY FAILED: procd restart reported failure" >&2
    return 1
  fi
  return 0
}
if ! activate_updated_service "$LATEST"; then
  restore_old
  die "New service activation failed; previous package restored"
fi
# Keep each check distinct to explain hardware-only failures without
# logging addresses, auth tokens, process arguments or private configuration.
verify_updated(){
  expected=$1
  disk=$("$SELF" --version 2>/dev/null || :)
  if [ "$disk" != "cudy-monitor-pro $expected" ]; then
    VERIFY_FAILURE="installed binary version differs from $expected"
    return 1
  fi
  if ! wget -q -O - "http://$BIND/health" 2>/dev/null | grep -qx ok; then
    VERIFY_FAILURE="health endpoint did not return ok"
    return 1
  fi
  if ! running_matches "$expected"; then
    VERIFY_FAILURE="running daemon version differs from $expected"
    return 1
  fi
  VERIFY_FAILURE=
  return 0
}
healthy=0
tries=0
VERIFY_FAILURE="verification did not start"
while [ "$tries" -lt 18 ]; do
  if verify_updated "$LATEST"; then healthy=1; break; fi
  tries=$((tries+1)); sleep 1
done
if [ "$healthy" -ne 1 ]; then
  echo "VERIFY FAILED: $VERIFY_FAILURE after $tries attempts; attempting rollback" >&2
  restore_old
  die "Updated service failed verification; previous package restored"
fi
# Also confirm disk version after the final health check, preventing a false
# success if an APK post-install hook reported success without replacement.
AFTER=$("$SELF" --version 2>/dev/null || :)
if [ "$AFTER" != "cudy-monitor-pro $LATEST" ]; then
  restore_old
  die "Updated file version mismatch; previous package restored"
fi
echo "UPDATED $LATEST (installed and running)"
