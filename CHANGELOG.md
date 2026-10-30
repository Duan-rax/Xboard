# Changelog

Release dates use the `Asia/Singapore` timezone.

## 2026.10.30.8

Release: `v2026.10.30.8`

- Disable Docker layer caching for immutable tag builds so the packed source
  commit always matches the release tag.

## 2026.10.30.4

Release: `v2026.10.30.4`

- Open the structured route editor when `/server/route` is loaded directly or
  refreshed, not only after clicking the sidebar entry.

## Unreleased

### Added

- Structured route-management editor with exact domains, domain suffixes,
  keyword/regex domains, IP/CIDR, ports, networks, source CIDRs, source ports
  and sniffed application protocols.
- Dual-kernel GeoIP/GeoSite adaptation: Xray uses native geo data while
  sing-box uses current remote SRS `rule_set` definitions.
- `any` and `all` matching modes, explicit priority ordering, enable/disable
  controls and rule validation preview.
- Route target suggestions for panel custom outbounds and managed egress
  profiles.
- Backward-compatible route schema migration; existing `match` rules continue
  to work without data conversion.
- Sing-box and Xray priority-aware structured route compilation.
- Monotonic node `config_revision` and canonical SHA-256 `config_hash`
  acknowledgement for genuine applied-config verification.
- CIDR network normalization, compressed IPv6 output and IDN/Punycode domain
  normalization for stable rule hashes.
- Node capability negotiation with kernel name, embedded kernel version and a
  per-node structured-route feature manifest. The binding page flags unsupported
  Xray/sing-box combinations, and the server rejects known-incompatible binds.

### Fixed

- `all` rules keep their AND relationship across domain, IP and port groups
  instead of accidentally matching a substring.
- Custom sing-box rule-set and experimental settings merge without losing the
  generated remote-rule cache.
- Route management accepts the current admin session token regardless of the
  theme-specific `*_access_token` localStorage key, so existing routes no
  longer disappear behind an `Unauthorized` response.

## 2026.10.30.2

Release: `v2026.10.30.2`

- Switched official panel image builds and GitHub Releases to tag-triggered
  GitHub Actions.
- Release tags now build amd64/arm64 images, publish GHCR tags and update
  `latest` automatically.
- Go builders now run on the native `BUILDPLATFORM` and cross-compile for
  `TARGETARCH`, avoiding stalled arm64 builds under QEMU.
- Branch pushes remain verification-only and do not replace release images.

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
