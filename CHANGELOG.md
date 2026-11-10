# Cudy Monitor Pro — Release notes

## 1.2.6 — WAN auto/manual controls
- Add one-tap return to default-route WAN after manually selecting a network interface.
- Clearly display whether the WAN view is automatic or manual, including missing or ambiguous routes.
- Add browser regression coverage for manual-to-auto switching and fix duplicate RAM comparison class attributes.
- Keep router network settings unchanged.

## 1.2.5 — Active WAN route detection
- Detect default IPv4 route interface from the kernel's main routing table; select by lowest metric and treat equally ranked different interfaces as ambiguous.
- Follow the detected WAN in the dashboard without hard-coded interface names; retain deliberate manual selection and reset the chart on route changes.
- Expose WAN route evidence in the status API; no claim of Internet connectivity or policy-routing verification.
- Add routing fixtures, mock-browser WAN data, and status API smoke checks.

## 1.2.4 — CM Aurora telemetry lessons
- Distinguish stale dashboard data from live readings after HTTP/API failures; pause live network visualization until a valid status poll returns.
- Expose htop-like used RAM and MemAvailable separately while retaining the existing memory metric/API for compatibility.
- Display a memory comparison in the UI and add Linux meminfo regression tests.
- Keep service management disabled by default; no router-side configuration or unrelated service changes.

## 1.1.0 — Aurora dashboard
- First implementation of Aurora visual design: responsive cards, clearer navigation and spacious desktop charts.
- Show real local service status chips from the existing API; no fabricated metrics.
- Add improved focus styling, reduced-motion support and mobile viewport checks.
- Preserve existing APIs and disabled-by-default service controls.
- Harden standalone installer rollback and Entware tool detection.

## 1.0.4 — OTA and HTTP reliability
- Correct update availability: only versions strictly newer than the installed release are offered.
- Reject malformed version metadata instead of showing a false update prompt.
- Read HTTP request headers across multiple TCP reads, supporting segmented packets.
- Reject malformed or oversized header blocks (8 KiB limit).
- Add regression tests and a dedicated pull-request CI job for Rust, shell and UI syntax.
- No changes to service management defaults, D2K, DoQ, router configuration, or external networking.
