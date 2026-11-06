# Security policy

Cudy Monitor Pro is intended for a **trusted local network**. It does **not** include a password-protected login. Binding to a private IPv4 address and checking the HTTP Origin header **do not provide authentication**.

## Supported releases

Security fixes target the latest published release in the `1.x` series. Older versions may have known limitations. Always verify the published version and SHA-256 before installing.

## Security model

- Default bind: `127.0.0.1:8237` (loopback).
- LAN binding is an explicit local configuration change.
- No WAN, guest-network, or public-tunnel exposure without independent authentication and access control.
- Privileged D2K/DoQ service actions are disabled by default and are unsafe to enable on an untrusted network.
- Official release binaries use SHA-256 verification; the installer itself must be reviewed before executing.
- The project does not install or modify router firmware.

## Reporting vulnerabilities

**Do not open a public Issue containing a vulnerability exploit, access token, secret, unredacted router backup, network topology, or personal data.** Use GitHub's *Report a vulnerability* / private vulnerability reporting feature if it is enabled for this repository. If it is unavailable, refrain from disclosing secrets publicly; ask for a private contact method in a generic Issue without sharing sensitive details.

Regular functional bugs without confidential material can use the public bug-report template.

## Privacy

See [privacy notes](docs/PRIVACY.ru.md). Logs, screenshots, API dumps and device details should be redacted before public sharing.

This is an independent project, not official Cudy or Keenetic support.
