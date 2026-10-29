# Changelog

Release dates use the `Asia/Singapore` timezone.

## 2026.10.30

Release: `v2026.10.30`

### Added

- Embedded administrator **出站管理** page with SOCKS5, HTTP/HTTPS,
  Shadowsocks, VLESS and Trojan profiles.
- Server-side pagination, search, batch binding, selected unbind and
  unbind-all workflows.
- Real proxy verification that performs authentication, remote DNS and an
  HTTPS request, returning end-to-end latency and exit IP.
- Node acknowledgement polling for applied egress profile and reload time.
- Native resource cache busting for the runtime admin extension.

### Fixed

- The embedded page reuses Xboard's native sidebar selection state.
- Binding-node lists remain visible while switching between egress profiles.
- Saving or refreshing no longer collapses the catalog height or jumps the
  browser back to the top of the page.
- Stale selection shadows are cleared when entering or leaving the page.

### Compatible node

- [Xboard-Node v2026.10.30](https://github.com/Duan-rax/Xboard-Node/releases)
- Hot egress outbound replacement without restarting the node kernel.
- WebSocket push plus REST reconciliation and applied-config acknowledgement.

### Verification

- PHP syntax checks, JavaScript extension tests and PHPUnit egress tests pass.
- Production panel returns HTTP 200 after deployment.
- All 13 production nodes were rolled out with per-machine rollback backups.
