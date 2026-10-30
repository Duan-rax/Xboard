/* API facade for egress-management workflows. */
(() => {
  'use strict';

  const adapter = globalThis.XboardEgressAdapter;
  const root = globalThis.XboardEgressAdmin = globalThis.XboardEgressAdmin || {};
  if (!adapter) {
    throw new Error('egress-admin-adapter.js must load before egress-admin-api.js');
  }

  root.api = Object.freeze({
    bind: (serverIds, proxyId) => adapter.api('/bind', 'POST', {
      server_ids: serverIds,
      egress_proxy_id: proxyId,
    }),
    bindStatus: (payload) => adapter.api('/bind-status', 'POST', payload),
    drop: (id) => adapter.api('/drop', 'POST', { id: Number(id) }),
    fetch: (query) => adapter.api(`/fetch?${query.toString()}`),
    nodes: (query) => adapter.api(`/nodes?${query.toString()}`),
    save: (payload) => adapter.api('/save', 'POST', payload),
    test: (id) => adapter.api('/test', 'POST', { id: Number(id) }),
    unbindAll: (proxyId) => adapter.api('/unbind-all', 'POST', {
      egress_proxy_id: Number(proxyId),
    }),
  });
})();
