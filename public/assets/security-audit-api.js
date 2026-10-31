(() => {
  'use strict';
  const adapter = globalThis.XboardSecurityAuditAdapter;
  const root = globalThis.XboardSecurityAudit = globalThis.XboardSecurityAudit || {};
  if (!adapter) throw new Error('security-audit-adapter.js must load first');
  const query = (params) => new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null));
  root.api = Object.freeze({
    overview: (params) => adapter.api(`/overview?${query(params).toString()}`),
    analysis: (params) => adapter.api(`/analysis?${query(params).toString()}`),
    events: (params) => adapter.api(`/events?${query(params).toString()}`),
    settings: () => adapter.api('/settings'),
    saveSettings: (payload) => adapter.api('/settings', 'POST', payload),
    cleanup: () => adapter.api('/cleanup', 'POST', {}),
  });
})();
