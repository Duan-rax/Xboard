(() => {
  'use strict';
  const root = globalThis.XboardSecurityAudit = globalThis.XboardSecurityAudit || {};
  root.state = {
    section: 'overview',
    range: '24h',
    loading: false,
    overview: null,
    analysis: null,
    analysisDimension: 'service',
    analysisSort: 'bytes',
    analysisRowsLimit: 8,
    analysisExpanded: [],
    events: [],
    pagination: { current_page: 1, last_page: 1, total: 0 },
    filterOptions: { users: [], nodes: [] },
    filters: { destination: '', node_id: '', action: '' },
    settings: null,
  };
})();
