# Cudy Monitor Pro — agent guidance

Read `docs/UI-TOOLKIT-RU.md` and compare against the approved dashboard references before any UI change.

- For component-selection tasks, explicitly consult `.agents/skills/pick-ui-library/SKILL.md`.
- This is an embedded Rust + vanilla HTML/CSS/JS app; do not add React, npm runtime, Tailwind, remote UI registries, or CDN assets for appearance alone.
- Preserve LAN-only design, user consent for actions, and separate OpenWrt/Entware packaging.
- Verify any changes with browser compatibility CI and Rust/public-content checks; do not publish new assets over immutable releases.
- Never write project files/caches on the PC outside `D:\AI` or `U:\AI work`.
