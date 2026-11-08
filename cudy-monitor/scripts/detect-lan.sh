#!/bin/sh
# Read-only LAN address discovery for BusyBox/OpenWrt/KeeneticOS.
# Exit nonzero if no unique safe LAN address can be identified.
# Usage: sh detect-lan.sh detect | validate ADDRESS
set -eu
IP_TOOL=${MONITOR_IP_COMMAND:-}
if [ -z "$IP_TOOL" ]; then
  if command -v ip >/dev/null 2>&1; then IP_TOOL=ip
  elif [ -x /sbin/ip ]; then IP_TOOL=/sbin/ip
  elif [ -x /opt/sbin/ip ]; then IP_TOOL=/opt/sbin/ip
  else echo "ip command missing" >&2; exit 1; fi
fi
is_private() {
  printf '%s\n' "$1" | awk -F. '
  NF!=4 {exit 1}
  {for (i=1;i<=4;i++) if ($i !~ /^[0-9]+$/ || $i>255) exit 1;
   if ($1==10 || ($1==192 && $2==168) || ($1==172 && $2>=16 && $2<=31)) exit 0;
   exit 1}'
}
iface_addresses() {
  "$IP_TOOL" -4 -o addr show dev "$1" 2>/dev/null |
    awk '{for(i=1;i<=NF;i++) if($i=="inet"){split($(i+1),a,"/");print a[1];break}}'
}
all_addresses() {
  "$IP_TOOL" -4 -o addr show 2>/dev/null |
    awk '{for(i=1;i<=NF;i++) if($i=="inet"){split($(i+1),a,"/");print $2,a[1];break}}'
}
validate_assigned() {
  is_private "$1" || return 1
  all_addresses | awk -v wanted="$1" '$2==wanted{found=1} END{exit !found}'
}
choose_iface() {
  [ -n "$1" ] || return 1
  iface_addresses "$1" | while IFS= read -r address; do
    if is_private "$address"; then printf '%s\n' "$address"; fi
  done | sort -u
}
# When several LAN addresses are configured, explicit selection is required.
unique() {
  values=$(printf '%s\n' "$1" | sed '/^$/d' | sort -u)
  [ -n "$values" ] || return 1
  [ "$(printf '%s\n' "$values" | wc -l | tr -d ' ')" -eq 1 ] || return 2
  printf '%s\n' "$values"
}
case "${1:-}" in
 validate)
  [ "$#" -eq 2 ] && validate_assigned "$2" || {
    echo "Address must be a private IPv4 assigned to this router" >&2; exit 1;
  }
  printf '%s\n' "$2"; exit 0 ;;
 detect)
  [ "$#" -eq 1 ] || exit 2 ;;
 *) echo "Usage: $0 detect | validate PRIVATE_ASSIGNED_IPV4" >&2; exit 2 ;;
esac
# 1. OpenWrt's configured logical LAN: resolve the actual bridge/device name.
if command -v uci >/dev/null 2>&1; then
  uci_names=""
  for key in network.lan.device network.lan.ifname; do
    value=$(uci -q get "$key" 2>/dev/null || true)
    uci_names="$uci_names $value"
  done
  uci_matches=""
  for name in $uci_names; do
    case "$name" in *[!a-zA-Z0-9_.@:-]*|'') continue ;; esac
    addresses=$(choose_iface "$name")
    [ -z "$addresses" ] || uci_matches="$uci_matches
$addresses"
  done
  if [ -n "$(printf '%s' "$uci_matches" | tr -d ' \n')" ]; then
    unique "$uci_matches" && exit 0
    echo "Several addresses on configured LAN; provide --bind-ip" >&2; exit 1
  fi
fi
# 2. Common interfaces on Keenetic/OpenWrt (including custom bridges).
common=""
for dev in br-lan br0 lan0; do
  addresses=$(choose_iface "$dev")
  [ -z "$addresses" ] || common="$common
$addresses"
done
if [ -n "$(printf '%s' "$common" | tr -d ' \n')" ]; then
  unique "$common" && exit 0
  echo "Several LAN bridges; provide --bind-ip" >&2; exit 1
fi
# 3. Safe fallback: scan all private IPv4s, excluding default-route uplinks,
# loopback and common tunnel/wireless client interfaces. NEVER guess if ambiguous.
default_devs=$("$IP_TOOL" -4 route show default 2>/dev/null |
  awk '{for(i=1;i<=NF;i++)if($i=="dev"){print $(i+1);break}}' | sort -u)
possible=""
while read -r dev addr; do
  [ -n "$dev" ] || continue
  case "$dev" in lo|ppp*|tun*|tap*|wg*|tailscale*|docker*|veth*) continue ;; esac
  printf '%s\n' "$default_devs" | grep -Fxq "$dev" && continue
  if is_private "$addr"; then possible="$possible
$addr"; fi
done <<EOF
$(all_addresses)
EOF
if unique "$possible"; then exit 0; fi
echo "Cannot uniquely identify a trusted LAN IPv4. Use --bind-ip ADDRESS (assigned private IPv4) or --local." >&2
exit 1
