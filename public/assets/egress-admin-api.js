/* API facade for egress-management workflows. */
(() => {
  'use strict';

  const adapter = globalThis.XboardEgressAdapter;
  const root = globalThis.XboardEgressAdmin = globalThis.XboardEgressAdmin || {};
  if (!adapter) {
    throw new Error('egress-admin-adapter.js must load before egress-admin-api.js');
  }

  root.api = Object.freeze({
    availability: (proxyId, serverIds, available, makeDefault = false, clearDefault = false) =>
      adapter.api('/availability', 'POST', {
        egress_proxy_id: Number(proxyId),
        server_ids: serverIds.map(Number),
        available,
        make_default: makeDefault,
        clear_default: clearDefault,
      }),
    bind: (serverIds, proxyId) => adapter.api('/bind', 'POST', {
      server_ids: serverIds,
      egress_proxy_id: proxyId,
    }),
    bindStatus: (payload) => adapter.api('/bind-status', 'POST', payload),
    drop: (id) => adapter.api('/drop', 'POST', { id: Number(id) }),
    fetch: (query) => adapter.api(`/fetch?${query.toString()}`),
    nodes: (query) => adapter.api(`/nodes?${query.toString()}`),
    probe: (proxyId, serverIds, target = '') => adapter.api('/probe', 'POST', {
      id: Number(proxyId),
      server_ids: serverIds.map(Number),
      target: target || undefined,
    }),
    save: (payload) => adapter.api('/save', 'POST', payload),
    test: (id) => adapter.api('/test', 'POST', { id: Number(id) }),
    unbindAll: (proxyId) => adapter.api('/unbind-all', 'POST', {
      egress_proxy_id: Number(proxyId),
    }),
  });
})();
