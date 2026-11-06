# Cudy Monitor Pro — Release notes

## 1.0.4 — OTA and HTTP reliability
- Correct update availability: only versions strictly newer than the installed release are offered.
- Reject malformed version metadata instead of showing a false update prompt.
- Read HTTP request headers across multiple TCP reads, supporting segmented packets.
- Reject malformed or oversized header blocks (8 KiB limit).
- Add regression tests and a dedicated pull-request CI job for Rust, shell and UI syntax.
- No changes to service management defaults, D2K, DoQ, router configuration, or external networking.

This release is source-side only until explicitly installed on a router. To migrate an old installation's OTA source from the former private repository, follow MIGRATION.md.
