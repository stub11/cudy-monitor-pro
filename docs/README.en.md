# Cudy Monitor Pro — English overview

[← Main README (Russian)](../README.md) · [Releases](https://github.com/stub11/cudy-monitor-pro/releases) · [Issues](https://github.com/stub11/cudy-monitor-pro/issues/new/choose)

Cudy Monitor Pro is a lightweight, self-hosted Rust dashboard for **aarch64 / ARM64 Linux routers with a compatible KeeneticOS environment and Entware mounted at `/opt`**. No CDN, vendor login, or required telemetry.

**Beta / community testing:** primarily tested on Cudy WBR3000UAX. Other router hardware and firmware are unverified; the hardware model label is currently hardcoded. MIPS, ARMv7, and generic OpenWrt support are not claimed.

### Metrics
- CPU load and cores, memory, processes, temperatures, disk and uptime.
- Network interfaces and live throughput charts.
- In-memory history: up to 3 hours of system metrics and 5 minutes of network metrics; cleared on restart.
- Optional local status display for D2K, DoQ, KeenKit. They are **not required** to run the dashboard.

### Requirements
ARM64 + Linux shell, functioning Entware at `/opt`, `curl`, `sha256sum`, internet access to GitHub Releases and sufficient free storage.

### Install
Connect to the router by SSH. For compatible Keenetic CLI sessions, enter `exec sh` first. Review the installer before running it:

```sh
mkdir -p /opt/tmp
/opt/bin/curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/stub11/cudy-monitor-pro/main/cudy-monitor/scripts/install.sh \
  -o /opt/tmp/cudy-monitor-install.sh
sed -n '1,180p' /opt/tmp/cudy-monitor-install.sh
/bin/sh /opt/tmp/cudy-monitor-install.sh
```

The installer writes to `/opt`, checks the release binary SHA-256, installs the monitor's Entware service script, and restarts **only the monitor**. It does not flash firmware.

By default the server listens on **127.0.0.1:8237**, not on your LAN IP. To make it visible to devices on a trusted LAN, edit `/opt/etc/cudy-monitor/bind` to a specific private IPv4 address with port `8237` and restart `/opt/etc/init.d/S99cudy-monitor`.

**Security:** no built-in authentication. Do not expose port 8237 to the Internet, guest networks or tunnels without independent access protection. Service controls are opt-in and off by default.

For install/uninstall details see [Russian install guide](INSTALL.ru.md). Never publish unredacted IP/MAC addresses, SSIDs, device names, router backups, keys, tokens or logs.

MIT-licensed, independent community project. Not affiliated with Cudy or Keenetic.
