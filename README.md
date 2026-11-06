# Cudy Monitor Pro
A lightweight standalone Rust dashboard for ARM64 (aarch64) routers running compatible KeeneticOS and Entware. The interface is built into the binary and does not require external CDN resources.

## Monitoring
CPU and per-core load, RAM, temperature sensors, USB storage usage, processes, interface traffic, and the local status of supported D2K/DoQ services. Up to three hours of resource history and five minutes of network history are kept only in RAM.

## Setup
Requires an ARM64 router with Entware mounted at /opt. Review scripts/install.sh before running; an automatic install changes local /opt service files. The default binding is 127.0.0.1:8237, intentionally not remotely accessible. Change /opt/etc/cudy-monitor/bind to your router's trusted LAN IPv4 address plus :8237, then restart the service. Never expose this panel to the WAN, guests, or untrusted clients.

## Releases
Official builds: https://github.com/stub11/cudy-monitor-pro/releases. New installations use those builds for SHA-256-checked OTA. Existing installations initially pointing to the legacy d2k-hopper release must migrate their updater helper separately; do not make the old repository private before checking that migration.

## Important security limits
The web UI does not require a login. Service controls are disabled by default. Enable only on trusted, isolated networks. A same-origin check is not authentication. DoQ stop is a temporary pause with a best-effort 90-second restart, not a guarantee of network recovery.

## Source
Application: cudy-monitor/src/main.rs; interface: cudy-monitor/web/index.html; launcher: cudy-monitor/scripts/S99cudy-monitor; OTA: cudy-monitor/scripts/update.sh. CI: .github/workflows/cudy-monitor-arm64.yml.

## Testing
CI builds static ARM64 binaries, checks HTTP endpoints and browser layouts. Hardware testing remains necessary for each new router model, especially restoration after restart and service controls.