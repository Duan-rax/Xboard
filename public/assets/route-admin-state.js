/* Shared mutable state for the structured route-management extension. */
(() => {
  'use strict';

  const root = globalThis.XboardRouteAdmin = globalThis.XboardRouteAdmin || {};
  root.PAGE_ID = 'xboard-route-v2-page';
  root.state = {
    routes: [],
    targets: [],
    nodes: [],
    presets: [],
    egressProxies: [],
    editingId: 0,
    loading: false,
    search: '',
    bindingRoute: null,
    bindingNodes: [],
    bindingSelected: new Set(),
    bindingPage: 1,
    bindingPagination: { current_page: 1, last_page: 1, total: 0 },
  };
})();
