# Browser updates and optional authorization (v1.2.8)

## User-facing behavior
- Authorization is **OFF by default**. The panel remains local LAN-only.
- Settings → Authorization: enable to generate a **random 256-bit access key**. Save it immediately; the panel does not display it again. Requests to telemetry and administrative endpoints then require the key.
- The key is stored as a root-readable `0600` file on the router. The browser keeps the key only in sessionStorage; it is cleared when the browser session ends. To disable, use Settings → Disable authorization while the key is available.
- If the key is lost, the router administrator can remove the access-token file over SSH: OpenWrt `rm -f /etc/cudy-monitor-pro/access-token`; Entware `rm -f /opt/etc/cudy-monitor/access-token`. No router reboot required.
- **HTTP does not encrypt the key.** A trusted wired/home Wi-Fi LAN is required; never expose TCP 8237 to the internet or a guest network. Enabling authorization does not replace HTTPS.
- If authorization is OFF, other trusted LAN clients can start a package update. This is the explicit default requested by the project owner. To prevent it, enable authorization.

## In-browser update
- Native OpenWrt 25.12 ARM64 build has an installed fixed-path updater at `/usr/share/cudy-monitor-pro/update-native.sh`.
- The built-in update checker reads only the pinned GitHub repository's releases; installer selects the newest versioned `cudy-monitor-openwrt-vX.Y.Z` release.
- Before installation, it downloads the currently installed and target APK, validating both against **SHA-256 digests supplied by GitHub's release API**.
- It uses `apk add --allow-untrusted` only for the verified local Cudy Monitor Pro package. It never issues a general `apk upgrade`.
- The former APK is retained in `/tmp` while upgrading. On an installation or health-check error the updater **attempts** rollback; recovery is not guaranteed if storage/power fails. Update runs detached from the UI; logs at `/tmp/cudy-monitor-update.log`.
- The dashboard POST endpoint requires `X-Monitor-Action: apply` and matching Origin/Host, as well as the access key whenever authorization is enabled. The web UI asks for an explicit user confirmation.
- For a router lacking `jsonfilter`, the update check fails with a clear explanation; the standard SSH one-command installer remains usable.
- The updater uses `curl` first (matching Netis N6 v2 tester's network behavior) and falls back to `wget`.

## Testing
- Rust backend auth tests: optional key creation, permission mode 0600, denial of unauthenticated requests, removal, and bad-origin checks.
- Native OpenWrt script source/syntax checks. Actual firmware-package update and rollback require a physical OpenWrt router.
- No remote router modifications were performed as part of this implementation.
