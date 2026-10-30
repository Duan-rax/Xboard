/* Structured route form model and serialization. */
(() => {
  'use strict';

  const adapter = globalThis.XboardRouteAdapter;
  const root = globalThis.XboardRouteAdmin = globalThis.XboardRouteAdmin || {};
  if (!adapter || !root.state) {
    throw new Error('route-admin-adapter.js and route-admin-state.js must load before route-admin-form.js');
  }

  const state = root.state;
  const values = (id) => (adapter.get(id)?.value || '').trim();
  const lines = (id) => (adapter.get(id)?.value || '')
    .split(/[\r\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));

  const emptyCriteria = () => ({
    domains: [],
    domain_suffixes: [],
    domain_keywords: [],
    domain_regexes: [],
    ip_cidrs: [],
    ports: [],
    networks: [],
    source_cidrs: [],
    source_ports: [],
    protocols: [],
    geoip: [],
    geosite: [],
    rule_sets: [],
  });

  const criteriaFromLegacy = (route) => {
    const criteria = emptyCriteria();
    for (const raw of route.match || []) {
      const value = String(raw || '').trim().replace(/^\*\./, '');
      if (!value) continue;
      if (value.includes('/') || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) || value.includes(':')) {
        criteria.ip_cidrs.push(value);
      } else {
        criteria.domain_suffixes.push(value);
      }
    }
    return criteria;
  };

  const criteriaOf = (route) => route.criteria || criteriaFromLegacy(route);

  const fillCriteria = (criteria) => {
    const map = {
      domains: 'xe-domains',
      domain_suffixes: 'xe-domain-suffixes',
      domain_keywords: 'xe-domain-keywords',
      domain_regexes: 'xe-domain-regexes',
      ip_cidrs: 'xe-ip-cidrs',
      ports: 'xe-ports',
      networks: 'xe-networks',
      source_cidrs: 'xe-source-cidrs',
      source_ports: 'xe-source-ports',
      protocols: 'xe-protocols',
      geoip: 'xe-geoip',
      geosite: 'xe-geosite',
      rule_sets: 'xe-rule-sets',
    };
    for (const [key, id] of Object.entries(map)) {
      const element = adapter.get(id);
      if (element) element.value = (criteria?.[key] || []).join('\n');
    }
  };

  const updateTargetState = () => {
    const target = adapter.get('xe-target');
    const isProxy = values('xe-action') === 'proxy';
    if (!target) return;
    target.disabled = !isProxy;
    if (!isProxy) target.value = '';
  };

  const reset = () => {
    state.editingId = 0;
    adapter.get('xe-form-title').textContent = '新增规则';
    adapter.get('xe-id').value = '';
    adapter.get('xe-remarks').value = '';
    adapter.get('xe-priority').value = '100';
    adapter.get('xe-match-mode').value = 'any';
    adapter.get('xe-enabled').checked = true;
    adapter.get('xe-action').value = 'direct';
    adapter.get('xe-target').value = '';
    updateTargetState();
    fillCriteria(emptyCriteria());
    adapter.get('xe-preview').textContent = '尚未校验。';
    root.showMessage('');
  };

  const fill = (route) => {
    state.editingId = Number(route.id);
    adapter.get('xe-form-title').textContent = `编辑规则 #${route.id}`;
    adapter.get('xe-id').value = route.id;
    adapter.get('xe-remarks').value = route.remarks || '';
    adapter.get('xe-priority').value = route.priority ?? 100;
    adapter.get('xe-match-mode').value = route.match_mode || 'any';
    adapter.get('xe-enabled').checked = route.enabled !== false;
    adapter.get('xe-action').value = route.action || 'direct';
    adapter.get('xe-target').value = route.action_value || '';
    updateTargetState();
    fillCriteria(criteriaOf(route));
    adapter.get('xe-preview').textContent = '正在编辑。点击“校验并预览”查看最终结构。';
    root.showMessage('');
  };

  const copy = (route) => {
    fill(route);
    state.editingId = 0;
    adapter.get('xe-id').value = '';
    adapter.get('xe-form-title').textContent = '复制规则';
    adapter.get('xe-remarks').value = `${route.remarks || `#${route.id}`}（副本）`;
    adapter.get('xe-priority').value = Number(route.priority || 100) + 1;
    root.showMessage('已复制到编辑器，确认后保存。');
  };

  const read = () => ({
    id: state.editingId || undefined,
    remarks: values('xe-remarks'),
    priority: Number(values('xe-priority') || 100),
    match_mode: values('xe-match-mode') || 'any',
    enabled: Boolean(adapter.get('xe-enabled')?.checked),
    match: [],
    criteria: {
      domains: lines('xe-domains'),
      domain_suffixes: lines('xe-domain-suffixes'),
      domain_keywords: lines('xe-domain-keywords'),
      domain_regexes: lines('xe-domain-regexes'),
      ip_cidrs: lines('xe-ip-cidrs'),
      ports: lines('xe-ports'),
      networks: lines('xe-networks'),
      source_cidrs: lines('xe-source-cidrs'),
      source_ports: lines('xe-source-ports'),
      protocols: lines('xe-protocols'),
      geoip: lines('xe-geoip'),
      geosite: lines('xe-geosite'),
      rule_sets: lines('xe-rule-sets'),
    },
    action: values('xe-action') || 'direct',
    action_value: values('xe-action') === 'proxy' ? (values('xe-target') || null) : null,
  });

  const readBindingQuery = () => ({
    search: values('xe-node-search'),
    bound: values('xe-node-bound') || 'all',
  });

  const matchesSearch = (route) => {
    if (!state.search) return true;
    const haystack = [
      route.remarks,
      route.action,
      route.action_value,
      route.match_mode,
      ...Object.values(criteriaOf(route)).flat(),
    ].join(' ').toLowerCase();
    return haystack.includes(state.search.toLowerCase());
  };

  const actionLabel = (route) => {
    if (route.action === 'direct') return '直连';
    if (route.action === 'block') return '阻止';
    if (route.action === 'dns') return `DNS${route.action_value ? ` → ${route.action_value}` : ''}`;
    if (route.action === 'proxy') return `出站 → ${route.action_value || '未设置'}`;
    return route.action;
  };

  root.esc = esc;
  root.form = Object.freeze({
    actionLabel,
    copy,
    criteriaOf,
    emptyCriteria,
    fill,
    matchesSearch,
    read,
    readBindingQuery,
    reset,
    updateTargetState,
  });
})();
