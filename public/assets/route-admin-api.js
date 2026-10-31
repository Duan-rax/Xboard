/* API facade for structured route-management workflows. */
(() => {
  'use strict';

  const adapter = globalThis.XboardRouteAdapter;
  const root = globalThis.XboardRouteAdmin = globalThis.XboardRouteAdmin || {};
  if (!adapter) {
    throw new Error('route-admin-adapter.js must load before route-admin-api.js');
  }

  root.api = Object.freeze({
    bind: (payload) => adapter.api('/bind', 'POST', payload),
    bindStatus: (payload) => adapter.api('/bind-status', 'POST', payload),
    drop: (id) => adapter.api('/drop', 'POST', { id: Number(id) }),
    fetchCatalog: () => Promise.all([
      adapter.api('/fetch'),
      adapter.api('/options'),
    ]),
    nodes: (query) => adapter.api(`/nodes?${query.toString()}`),
    preview: (payload) => adapter.api('/preview', 'POST', payload),
    save: (payload) => adapter.api('/save', 'POST', payload),
    simulate: (payload) => adapter.api('/simulate', 'POST', payload),
    sort: (items) => adapter.api('/sort', 'POST', {
      items: items.map((route, index) => ({
        id: Number(route.id),
        priority: (index + 1) * 10,
      })),
    }),
    syncStatus: (routeId) => adapter.api('/sync-status', 'POST', {
      route_id: Number(routeId),
    }),
    toggle: (route, enabled) => adapter.api('/toggle', 'POST', {
      id: Number(route.id),
      enabled,
    }),
  });
})();
