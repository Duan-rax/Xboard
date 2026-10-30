/* Shared mutable state for the egress-management extension. */
(() => {
  'use strict';

  const root = globalThis.XboardEgressAdmin = globalThis.XboardEgressAdmin || {};
  root.state = {
    page: 1,
    lastPage: 1,
    total: 0,
    proxies: [],
    bindProxy: null,
    bindPage: 1,
    bindLastPage: 1,
    bindTotal: 0,
    bindFilter: 'all',
    bindSearch: '',
    bindNodes: [],
    selected: new Set(),
    syncPoll: 0,
  };
})();
