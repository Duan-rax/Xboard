/* Route diagnostics labels, summaries and badges. */
(() => {
  'use strict';

  const adapter = globalThis.XboardRouteAdapter;
  const root = globalThis.XboardRouteAdmin = globalThis.XboardRouteAdmin || {};
  if (!adapter || !root.state || !root.form) {
    throw new Error('route state/form modules must load before route-admin-diagnostics.js');
  }

  const state = root.state;
  const diagnosticLabel = {
    shadowed_rule: '规则被遮蔽',
    duplicate_rule: '重复规则',
    missing_proxy_target: '出站 Tag 缺失',
    unbound_rule: '未绑定节点',
    node_capability_mismatch: '节点内核不兼容',
    node_capabilities_unknown: '节点能力待上报',
  };

  const routeDiagnostics = (route) => Array.isArray(route?.diagnostics) ? route.diagnostics : [];

  const criteriaSummary = (route) => {
    const criteria = root.form.criteriaOf(route);
    const parts = [];
    if (criteria.domains?.length) parts.push(`域名 ${criteria.domains.length}`);
    if (criteria.domain_suffixes?.length) parts.push(`后缀 ${criteria.domain_suffixes.length}`);
    if (criteria.domain_keywords?.length) parts.push(`关键字 ${criteria.domain_keywords.length}`);
    if (criteria.domain_regexes?.length) parts.push(`正则 ${criteria.domain_regexes.length}`);
    if (criteria.ip_cidrs?.length) parts.push(`IP ${criteria.ip_cidrs.length}`);
    if (criteria.ports?.length) parts.push(`端口 ${criteria.ports.length}`);
    if (criteria.networks?.length) parts.push(`网络 ${criteria.networks.join('/')}`);
    if (criteria.source_cidrs?.length) parts.push(`来源IP ${criteria.source_cidrs.length}`);
    if (criteria.source_ports?.length) parts.push(`来源端口 ${criteria.source_ports.length}`);
    if (criteria.protocols?.length) parts.push(`协议 ${criteria.protocols.join('/')}`);
    if (criteria.geoip?.length) parts.push(`GeoIP ${criteria.geoip.join(',')}`);
    if (criteria.geosite?.length) parts.push(`GeoSite ${criteria.geosite.join(',')}`);
    if (criteria.rule_sets?.length) parts.push(`sing-box 集合 ${criteria.rule_sets.join(',')}`);
    return parts.join(' · ') || '旧版匹配值';
  };

  const renderBadges = (route) => routeDiagnostics(route).map((diagnostic) => {
    const severity = ['error', 'warning', 'info'].includes(diagnostic.severity)
      ? diagnostic.severity
      : 'info';
    const label = diagnosticLabel[diagnostic.code] || '诊断提示';
    return `<span class="xe-badge ${severity}" title="${root.esc(diagnostic.message || label)}">${root.esc(label)}</span>`;
  }).join(' ');

  const renderSummary = () => {
    const target = adapter.get('xe-diagnostic-summary');
    if (!target) return;
    const counts = { error: 0, warning: 0, info: 0 };
    state.routes.forEach((route) => routeDiagnostics(route).forEach((diagnostic) => {
      const severity = ['error', 'warning', 'info'].includes(diagnostic.severity)
        ? diagnostic.severity
        : 'info';
      counts[severity] += 1;
    }));
    const total = counts.error + counts.warning + counts.info;
    target.innerHTML = total
      ? `<strong>规则诊断</strong>
         ${counts.error ? `<span class="xe-badge error">${counts.error} 个冲突</span>` : ''}
         ${counts.warning ? `<span class="xe-badge warning">${counts.warning} 个警告</span>` : ''}
         ${counts.info ? `<span class="xe-badge info">${counts.info} 个提示</span>` : ''}
         <span class="xe-help">仅报告确定性问题，不推测 CIDR 或正则之间的部分重叠。</span>`
      : '<strong>规则诊断</strong><span class="xe-badge on">未发现确定性冲突</span>';
  };

  root.diagnostics = Object.freeze({
    criteriaSummary,
    renderBadges,
    renderSummary,
    routeDiagnostics,
  });
})();
