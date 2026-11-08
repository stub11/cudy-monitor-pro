# Approved UI specification — Cudy Monitor Pro
Approved: 2026-11-08. Primary reference: user-provided image 8237.png, size 1536x1024, SHA-256 89d5701f72b24358a9d26574c7e2db99f0b45cf29a7905362b7540732180331a.

## Non-negotiable appearance
Dark navy dashboard with luminous blue/cyan/purple/green accents, soft outlines, rounded cards, careful information hierarchy, desktop left sidebar, responsive mobile dashboard. Preserve existing functional capabilities; do not replace with mockups.

## Main navigation
Overview / Processes / Services / Network / Storage / Logs / Settings.

## Overview
Top bar: connection state, update interval, current time; hero metric cards for CPU, CPU temperature, RAM, Entware partition, uptime.
Middle: 5-minute CPU/RAM/temperature history, per-core utilization, WAN/LAN throughput.
Bottom: memory/process consumption breakdown and available sensors.
Use accurate units, timestamps, legends, labels, zero/empty/error states. Keep chart axes steady while updating.

## Detail views
Processes: sortable CPU/memory tabs and overall view; process identity and category.
Services: list real detected services, status, action controls with confirmation and feedback.
Network: WAN/LAN/Wi-Fi selections only if supported, live throughput, safely redacted public IP in screenshots.
Storage: real filesystems/mounts and free space.
Logs: filtered logs with size limits and safe redaction.
Settings: refresh interval, units, theme/status, diagnostics.

## Responsive
Desktop: sidebar + grid, no clipping at common widths.
Mobile: compact metric tiles, legible charts, menu navigation, touch targets, no horizontal page scroll.

## Backend portability
Auto-detect model/CPU/memory/sensors/flash, LAN/WAN and interfaces; do not hardcode Cudy model or netdev names. Unsupported signals show explicit 'not available'. Do not invent Wi-Fi temperature or metric names.
Support existing ARM64 Entware and relevant OpenWrt/Keenetic variants; test on hardware before claiming compatibility.

## QA acceptance
1. Compare screenshots of every route at desktop and mobile sizes against approved reference.
2. 2-second refresh causes no layout jumping or spurious changes; handle offline/reconnecting.
3. All navigation, sorting, service actions, permissions, errors and safe fallback work.
4. No leaked credentials/private IPs in public repository artifacts.
5. Verify built assets embedded and installer/package upgrade preserves configuration.
6. Screenshot is a visual specification, not a source of real telemetry.

This document is safe for the public source repository. Do not commit live router exports or personal configuration.
