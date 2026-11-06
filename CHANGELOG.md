# Cudy Monitor Pro — Release notes

## Unreleased — public testing distribution
- GitHub bug and feature request templates, PR template, contribution and security policies, MIT license.
- Fixed fresh installer for BusyBox variants where sh -n is unsupported.
- Added automated public-content privacy guard and installer compatibility CI checks.
- Make installer restore prior monitor files when health verification fails.


## 1.0.4 — OTA and HTTP reliability
- Correct update availability: only versions strictly newer than the installed release are offered.
- Reject malformed version metadata instead of showing a false update prompt.
- Read HTTP request headers across multiple TCP reads, supporting segmented packets.
- Reject malformed or oversized header blocks (8 KiB limit).
- Add regression tests and a dedicated pull-request CI job for Rust, shell and UI syntax.
- No changes to service management defaults, D2K, DoQ, router configuration, or external networking.
