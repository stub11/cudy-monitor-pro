# Development notes — OTA and HTTP resilience

This change is deliberately isolated to the **source project**. It does not install software on a router or modify any deployed 1.0.2/1.0.3 installation.

## OTA version comparison
The dashboard's `/api/update/check` now validates both versions as three unsigned numeric components. The update button is enabled only when the release version is **strictly newer** than the installed version. A lower release, identical version, or malformed metadata cannot trigger an offered update.

The updater script retains its existing independent version and SHA-256 checks; this change corrects the dashboard's display and validation.

## HTTP framing
Headers are read until the HTTP `\r\n\r\n` terminator, across multiple TCP reads. Previously, the daemon read once, which could truncate headers on slower or segmented connections. Requests with missing or invalid headers are rejected, and oversized header blocks are limited to 8 KiB.

## Regression coverage
New Rust tests cover version precedence (including `1.10.0` versus `1.9.9`), malformed metadata, split HTTP headers, and oversized headers. A dedicated pull-request workflow runs the Rust tests, shell syntax checks and a front-end JS syntax check, without building an ARM64 release or deploying to a router.

## Deployment
No automatic release is issued from this branch. Review the pull request, confirm passing CI, merge only when ready to publish a new version, then test the next release on an authorized router.

