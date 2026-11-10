# Native OpenWrt APK updates (1.2.7)

The dashboard previously surfaced the raw error `Native OpenWrt APK: update using apk package manager` when checking for updates. This is expected for the native package but confusing to testers.

From version 1.2.7 the `/api/status` response includes `update_mode` (`native_apk` or `entware`). Native APK installations display a clear non-privileged SSH update command and release link; they hide the in-page check/apply actions. No writable update command is exposed to an unauthenticated LAN client. Entware installations retain their existing guarded update flow.

The SSH command uses the existing universal `easy-install.sh --update`, which verifies the APK and keeps router settings. Existing 1.2.3–1.2.6 installations still show the old UI until upgraded once from SSH. On multi-network systems the user should be careful not to expose TCP 8237 outside a trusted LAN.

This fixes UI guidance, not the broader OTA design. An authenticated, permission-separated native updater may be implemented later, after a security review. No DNS, routing, firewall or firmware changes are made.
