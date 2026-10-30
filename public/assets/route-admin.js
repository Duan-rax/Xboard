/*
 * Structured route-management extension.
 *
 * The admin SPA is distributed as a build artifact, so this script augments
 * the existing route page at runtime. It keeps Xboard's native route menu and
 * selected state while providing the v2 structured rule editor in main#content.
 */
(() => {
  'use strict';

  const adapter = globalThis.XboardRouteAdapter;
  if (!adapter) {
    throw new Error('route-admin-adapter.js must load before route-admin.js');
  }

  const PAGE_ID = 'xboard-route-v2-page';
  const state = {
    routes: [],
    targets: [],
    editingId: 0,
    loading: false,
    search: '',
    bindingRoute: null,
    bindingNodes: [],
    bindingSelected: new Set(),
    bindingPage: 1,
    bindingPagination: { current_page: 1, last_page: 1, total: 0 },
  };

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));

  const page = adapter.page;
  const api = adapter.api;

  const css = `
    #${PAGE_ID}{height:100%;overflow:auto;background:hsl(var(--background,0 0% 100%));color:hsl(var(--foreground,222.2 84% 4.9%));font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    #${PAGE_ID} .xe-shell{max-width:1480px;margin:0 auto;padding:28px clamp(20px,3vw,40px) 44px}
    #${PAGE_ID} .xe-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:20px}
    #${PAGE_ID} h1{margin:0;font-size:26px;line-height:1.25;font-weight:700}
    #${PAGE_ID} p{margin:6px 0 0;color:#64748b;font-size:12.5px;line-height:1.6}
    #${PAGE_ID} .xe-layout{display:grid;grid-template-columns:minmax(360px,.9fr) minmax(0,1.35fr);gap:18px;align-items:start}
    #${PAGE_ID} .xe-panel{background:hsl(var(--card,0 0 100%));border:1px solid hsl(var(--border,214 32% 91%));border-radius:12px;padding:18px;min-width:0}
    #${PAGE_ID} h2{margin:0 0 12px;font-size:14px}
    #${PAGE_ID} h3{margin:16px 0 8px;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:.05em}
    #${PAGE_ID} label{display:block;margin:9px 0 4px;color:#475569;font-size:12px;font-weight:600}
    #${PAGE_ID} label.xe-inline{display:flex;align-items:center;gap:7px;font-weight:500}
    #${PAGE_ID} input,#${PAGE_ID} select,#${PAGE_ID} textarea{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#0f172a;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
    #${PAGE_ID} input[type=checkbox]{width:auto}
    #${PAGE_ID} textarea{min-height:72px;resize:vertical}
    #${PAGE_ID} .xe-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    #${PAGE_ID} .xe-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    #${PAGE_ID} button{border:0;border-radius:7px;padding:7px 10px;background:#2563eb;color:#fff;cursor:pointer;font-size:12.5px;line-height:1.2}
    #${PAGE_ID} button.secondary{background:#e2e8f0;color:#334155}
    #${PAGE_ID} button.danger{background:#dc2626}
    #${PAGE_ID} button:disabled{opacity:.45;cursor:not-allowed}
    #${PAGE_ID} .xe-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}
    #${PAGE_ID} .xe-message{font-size:11.5px;color:#16a34a}
    #${PAGE_ID} .xe-error{font-size:11.5px;color:#dc2626;white-space:pre-wrap}
    #${PAGE_ID} .xe-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px}
    #${PAGE_ID} .xe-toolbar input{flex:1}
    #${PAGE_ID} table{width:100%;border-collapse:collapse;font-size:12px}
    #${PAGE_ID} th,#${PAGE_ID} td{padding:8px 6px;border-bottom:1px solid #eef2f7;text-align:left;vertical-align:top}
    #${PAGE_ID} th{color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em}
    #${PAGE_ID} .xe-mono{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#334155;white-space:pre-wrap;word-break:break-word}
    #${PAGE_ID} .xe-badge{display:inline-block;padding:1px 6px;border-radius:999px;background:#e2e8f0;color:#334155;font-size:10.5px;font-weight:600}
    #${PAGE_ID} .xe-badge.on{background:#dcfce7;color:#15803d}
    #${PAGE_ID} .xe-badge.off{background:#fee2e2;color:#b91c1c}
    #${PAGE_ID} .xe-badge.info{background:#e0f2fe;color:#0369a1}
    #${PAGE_ID} .xe-badge.warning{background:#fef3c7;color:#b45309}
    #${PAGE_ID} .xe-badge.error{background:#fee2e2;color:#b91c1c}
    #${PAGE_ID} .xe-diagnostic-summary{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 10px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc}
    #${PAGE_ID} .xe-row-actions{display:flex;gap:5px;flex-wrap:wrap}
    #${PAGE_ID} .xe-preview{margin-top:12px;padding:10px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;max-height:260px;overflow:auto}
    #${PAGE_ID} .xe-help{font-size:11px;color:#64748b;line-height:1.55;margin-top:4px}
    #${PAGE_ID} .xe-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.48)}
    #${PAGE_ID} .xe-modal[hidden]{display:none}
    #${PAGE_ID} .xe-dialog{width:min(980px,96vw);max-height:88vh;overflow:auto;background:#fff;border-radius:14px;padding:20px;box-shadow:0 24px 60px rgba(15,23,42,.28)}
    #${PAGE_ID} .xe-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
    #${PAGE_ID} .xe-node-tools{display:grid;grid-template-columns:minmax(220px,1fr) 150px auto;gap:8px;margin-bottom:12px}
    #${PAGE_ID} .xe-node-name{display:flex;align-items:center;gap:7px}
    #${PAGE_ID} .xe-dot{width:8px;height:8px;border-radius:50%;background:#94a3b8;display:inline-block}#${PAGE_ID} .xe-dot.on{background:#22c55e}
    #${PAGE_ID} .xe-warning{color:#b45309;font-size:11px}
    #${PAGE_ID} .xe-pagination{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px}
    @media(max-width:980px){#${PAGE_ID} .xe-layout{grid-template-columns:1fr}#${PAGE_ID} .xe-grid3{grid-template-columns:1fr 1fr}}
  `;

  const pageHtml = () => `
    <section id="${PAGE_ID}">
      <div class="xe-shell">
        <header class="xe-head">
          <div>
            <h1>路由管理</h1>
            <p>结构化规则按优先级从小到大执行。绑定前会根据节点上报的内核版本与能力校验兼容性，并查看 revision/hash 应用确认。</p>
          </div>
          <span class="xe-badge">ROUTE V2</span>
        </header>
        <div class="xe-layout">
          <section class="xe-panel">
            <h2 id="xe-form-title">新增规则</h2>
            <input type="hidden" id="xe-id">
            <label for="xe-remarks">名称</label>
            <input id="xe-remarks" placeholder="例如：国内网站直连">
            <div class="xe-grid3">
              <div>
                <label for="xe-priority">优先级</label>
                <input id="xe-priority" type="number" min="0" max="100000" value="100">
              </div>
              <div>
                <label for="xe-match-mode">组合方式</label>
                <select id="xe-match-mode">
                  <option value="any">任一条件</option>
                  <option value="all">全部条件</option>
                </select>
              </div>
              <div>
                <label>&nbsp;</label>
                <label class="xe-inline"><input id="xe-enabled" type="checkbox" checked> 启用规则</label>
              </div>
            </div>
            <h3>匹配条件</h3>
            <label for="xe-domains">精确域名</label>
            <textarea id="xe-domains" placeholder="example.com&#10;api.example.net"></textarea>
            <label for="xe-domain-suffixes">域名后缀</label>
            <textarea id="xe-domain-suffixes" placeholder="google.com&#10;openai.com"></textarea>
            <div class="xe-grid">
              <div>
                <label for="xe-domain-keywords">域名关键字</label>
                <textarea id="xe-domain-keywords" placeholder="tracker&#10;announce"></textarea>
              </div>
              <div>
                <label for="xe-domain-regexes">域名正则（双内核）</label>
                <textarea id="xe-domain-regexes" placeholder="(^|\\.)example[0-9]+\\.com$"></textarea>
              </div>
            </div>
            <label for="xe-ip-cidrs">IP / CIDR</label>
            <textarea id="xe-ip-cidrs" placeholder="1.1.1.0/24&#10;2001:db8::/32"></textarea>
            <div class="xe-grid">
              <div>
                <label for="xe-ports">目标端口</label>
                <textarea id="xe-ports" placeholder="80&#10;443&#10;8000-8100"></textarea>
              </div>
              <div>
                <label for="xe-networks">网络</label>
                <textarea id="xe-networks" placeholder="tcp&#10;udp"></textarea>
              </div>
            </div>
            <label for="xe-protocols">嗅探协议（双内核）</label>
            <textarea id="xe-protocols" placeholder="bittorrent&#10;http&#10;tls&#10;quic"></textarea>
            <div class="xe-grid">
              <div>
                <label for="xe-source-cidrs">来源 IP / CIDR</label>
                <textarea id="xe-source-cidrs" placeholder="10.0.0.0/8"></textarea>
              </div>
              <div>
                <label for="xe-source-ports">来源端口</label>
                <textarea id="xe-source-ports" placeholder="1000-2000"></textarea>
              </div>
            </div>
            <div class="xe-grid3">
              <div>
                <label for="xe-geoip">GeoIP 集合（双内核）</label>
                <textarea id="xe-geoip" placeholder="cn&#10;private"></textarea>
              </div>
              <div>
                <label for="xe-geosite">GeoSite 集合（双内核）</label>
                <textarea id="xe-geosite" placeholder="cn&#10;category-ads-all"></textarea>
              </div>
              <div>
                <label for="xe-rule-sets">Rule Set Tag（仅 sing-box）</label>
                <textarea id="xe-rule-sets" placeholder="cn_ip"></textarea>
              </div>
            </div>
            <p class="xe-help">GeoIP/GeoSite 会自动适配：Xray 使用 geoip/geosite 数据库；sing-box 不生成已弃用的 geoip/geosite 字段，而是使用并缓存远程 SRS。自定义 Rule Set Tag 必须已在 sing-box custom_config 的 route.rule_set 中定义，不能绑定 Xray 节点。</p>
            <p class="xe-help">选择 bittorrent 等嗅探协议，或使用域名类条件时，节点会自动开启必要的流量嗅探。加密或混淆后的 BT 仍可能无法识别。</p>
            <p class="xe-help">“全部条件”会生成一个同时满足多类条件的规则；“任一条件”会拆成多条 OR 规则。</p>
            <h3>动作</h3>
            <div class="xe-grid">
              <div>
                <label for="xe-action">动作</label>
                <select id="xe-action">
                  <option value="direct">直连</option>
                  <option value="block">阻止</option>
                  <option value="proxy">指定出站</option>
                  <option value="dns">DNS 解析</option>
                </select>
              </div>
              <div>
                <label for="xe-target">出站 Tag</label>
                <input id="xe-target" list="xe-target-options" placeholder="例如 warp-jp">
                <datalist id="xe-target-options"></datalist>
              </div>
            </div>
            <div class="xe-actions">
              <button data-xe-save>保存规则</button>
              <button class="secondary" data-xe-preview>校验并预览</button>
              <button class="secondary" data-xe-reset>清空</button>
              <span id="xe-message" class="xe-message"></span>
            </div>
            <div id="xe-preview" class="xe-preview xe-mono">尚未校验。</div>
          </section>
          <section class="xe-panel">
            <div class="xe-toolbar">
              <input id="xe-search" placeholder="搜索名称、域名、CIDR、动作或 Tag">
              <button class="secondary" data-xe-refresh>刷新</button>
              <button class="secondary" data-xe-renumber>按当前顺序重新编号</button>
            </div>
            <div id="xe-diagnostic-summary" class="xe-diagnostic-summary">正在分析规则健康状态…</div>
            <div id="xe-list">正在加载…</div>
          </section>
        </div>
        <div id="xe-bind-modal" class="xe-modal" hidden>
          <section class="xe-dialog">
            <div class="xe-dialog-head">
              <div><h2 id="xe-bind-title">绑定节点</h2><p>绑定只改变节点的 route_ids；节点会按自身内核编译为 Xray 或 sing-box 原生规则。</p></div>
              <button class="secondary" data-xe-bind-close>关闭</button>
            </div>
            <div class="xe-node-tools">
              <input id="xe-node-search" placeholder="搜索节点名称或地址">
              <select id="xe-node-bound"><option value="all">全部节点</option><option value="bound">已绑定</option><option value="unbound">未绑定</option></select>
              <button class="secondary" data-xe-node-filter>筛选</button>
            </div>
            <div class="xe-actions">
              <button data-xe-bind-selected="1">绑定所选</button>
              <button class="secondary" data-xe-bind-selected="0">解绑所选</button>
              <button class="secondary" data-xe-select-page>选择本页</button>
              <button class="secondary" data-xe-clear-selection>清空选择</button>
              <span id="xe-bind-message" class="xe-message"></span>
            </div>
            <div id="xe-node-list">正在加载…</div>
            <div class="xe-pagination"><button class="secondary" data-xe-node-prev>上一页</button><span id="xe-node-page">第 1 / 1 页</span><button class="secondary" data-xe-node-next>下一页</button></div>
          </section>
        </div>
      </div>
    </section>`;

  const showMessage = (message, error = false) => {
    const element = adapter.get('xe-message');
    if (!element) return;
    element.className = error ? 'xe-error' : 'xe-message';
    element.textContent = message;
  };

  const values = (id) => (adapter.get(id)?.value || '').trim();
  const lines = (id) => (adapter.get(id)?.value || '')
    .split(/[\r\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

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

  const legacyCriteria = (route) => {
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

  const criteriaOf = (route) => route.criteria || legacyCriteria(route);

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

  const resetForm = () => {
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
    showMessage('');
  };

  const fillForm = (route) => {
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
    showMessage('');
  };

  const updateTargetState = () => {
    const target = adapter.get('xe-target');
    const isProxy = values('xe-action') === 'proxy';
    if (!target) return;
    target.disabled = !isProxy;
    if (!isProxy) target.value = '';
  };

  const readForm = () => ({
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

  const criteriaSummary = (route) => {
    const criteria = criteriaOf(route);
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

  const actionLabel = (route) => {
    if (route.action === 'direct') return '直连';
    if (route.action === 'block') return '阻止';
    if (route.action === 'dns') return `DNS${route.action_value ? ` → ${route.action_value}` : ''}`;
    if (route.action === 'proxy') return `出站 → ${route.action_value || '未设置'}`;
    return route.action;
  };

  const diagnosticLabel = {
    shadowed_rule: '规则被遮蔽',
    duplicate_rule: '重复规则',
    missing_proxy_target: '出站 Tag 缺失',
    unbound_rule: '未绑定节点',
    node_capability_mismatch: '节点内核不兼容',
    node_capabilities_unknown: '节点能力待上报',
  };

  const routeDiagnostics = (route) => Array.isArray(route?.diagnostics) ? route.diagnostics : [];

  const renderDiagnosticBadges = (route) => routeDiagnostics(route).map((diagnostic) => {
    const severity = ['error', 'warning', 'info'].includes(diagnostic.severity)
      ? diagnostic.severity
      : 'info';
    const label = diagnosticLabel[diagnostic.code] || '诊断提示';
    return `<span class="xe-badge ${severity}" title="${esc(diagnostic.message || label)}">${esc(label)}</span>`;
  }).join(' ');

  const renderDiagnosticSummary = () => {
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

  const renderList = () => {
    const list = adapter.get('xe-list');
    if (!list) return;
    renderDiagnosticSummary();
    const items = state.routes.filter(matchesSearch);
    if (!items.length) {
      list.innerHTML = '<p>没有匹配的路由规则。</p>';
      return;
    }
    list.innerHTML = `
      <table>
        <thead><tr><th>优先级</th><th>规则</th><th>匹配</th><th>动作</th><th>节点</th><th>操作</th></tr></thead>
        <tbody>
          ${items.map((route) => `
            <tr>
              <td><span class="xe-badge">${route.priority ?? 100}</span></td>
              <td>
                <strong>${esc(route.remarks || `#${route.id}`)}</strong><br>
                ${route.enabled === false
                  ? '<span class="xe-badge off">停用</span>'
                  : '<span class="xe-badge on">启用</span>'}
                <span class="xe-badge">${route.match_mode === 'all' ? '全部条件' : '任一条件'}</span>
                ${renderDiagnosticBadges(route)}
              </td>
              <td class="xe-mono">${esc(criteriaSummary(route))}</td>
              <td>${esc(actionLabel(route))}</td>
              <td>${Number(route.servers_count || 0)}</td>
              <td>
                <div class="xe-row-actions">
                  <button class="secondary" data-xe-edit="${route.id}">编辑</button>
                  <button class="secondary" data-xe-bind="${route.id}">绑定节点</button>
                  <button class="secondary" data-xe-toggle="${route.id}" data-xe-enabled="${route.enabled === false ? 1 : 0}">${route.enabled === false ? '启用' : '停用'}</button>
                  <button class="secondary" data-xe-copy="${route.id}">复制</button>
                  <button class="secondary" data-xe-up="${route.id}">上移</button>
                  <button class="secondary" data-xe-down="${route.id}">下移</button>
                  <button class="danger" data-xe-delete="${route.id}">删除</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  };

  const renderTargets = () => {
    const datalist = adapter.get('xe-target-options');
    if (!datalist) return;
    datalist.innerHTML = state.targets.map((target) =>
      `<option value="${esc(target.tag)}">${esc(target.label || target.tag)}${target.server_count ? ` · ${Number(target.server_count)} 个面板节点` : ''}</option>`
    ).join('');
  };

  const showBindMessage = (message, error = false) => {
    const element = adapter.get('xe-bind-message');
    if (!element) return;
    element.className = error ? 'xe-error' : 'xe-message';
    element.textContent = message;
  };

  const renderBindingNodes = () => {
    const list = adapter.get('xe-node-list');
    if (!list) return;
    if (!state.bindingNodes.length) {
      list.innerHTML = '<p>没有符合条件的节点。</p>';
    } else {
      list.innerHTML = `
        <table>
          <thead><tr><th>选择</th><th>节点</th><th>内核</th><th>协议</th><th>状态</th><th>规则状态</th><th>兼容性</th></tr></thead>
          <tbody>${state.bindingNodes.map((node) => `
            <tr>
              <td><input type="checkbox" data-xe-node-check="${node.id}" ${state.bindingSelected.has(Number(node.id)) ? 'checked' : ''}></td>
              <td><div class="xe-node-name"><span class="xe-dot ${node.online ? 'on' : ''}"></span><strong>${esc(node.name || `#${node.id}`)}</strong></div><span class="xe-mono">${esc(node.host || '')}:${Number(node.port || 0)}</span></td>
              <td>
                <span class="xe-badge info">${esc(node.capabilities?.kernel || '未上报')}</span><br>
                <span class="xe-mono" title="${esc((node.capabilities?.features || []).join('\n'))}">${esc(node.capabilities?.kernel_version || '版本未知')}</span><br>
                <span class="xe-help">${(node.capabilities?.features || []).length} 项能力</span>
              </td>
              <td><span class="xe-badge">${esc(node.type || '-')}</span></td>
              <td>${node.enabled ? '<span class="xe-badge on">启用</span>' : '<span class="xe-badge off">停用</span>'}</td>
              <td>${node.bound ? '<span class="xe-badge on">已绑定</span>' : '<span class="xe-badge">未绑定</span>'}</td>
              <td>
                ${node.compatibility?.supported === false
                  ? `<span class="xe-badge error" title="${esc(node.compatibility?.message || '')}">不兼容</span><br><span class="xe-warning">${esc((node.compatibility?.missing_features || []).join(', '))}</span>`
                  : node.compatibility?.supported === true
                    ? '<span class="xe-badge on">规则兼容</span>'
                    : '<span class="xe-badge warning">能力未上报</span>'}
                ${node.target_known === false ? '<br><span class="xe-warning">目标 Tag 可能由节点本地配置提供</span>' : ''}
              </td>
            </tr>`).join('')}</tbody>
        </table>`;
    }
    const pageLabel = adapter.get('xe-node-page');
    if (pageLabel) {
      pageLabel.textContent = `第 ${state.bindingPagination.current_page || 1} / ${state.bindingPagination.last_page || 1} 页，共 ${state.bindingPagination.total || 0} 个节点`;
    }
  };

  const loadBindingNodes = async (pageNumber = state.bindingPage) => {
    if (!state.bindingRoute) return;
    const list = adapter.get('xe-node-list');
    if (list) list.innerHTML = '<p>正在加载节点…</p>';
    const query = new URLSearchParams({
      route_id: String(state.bindingRoute.id),
      page: String(Math.max(1, pageNumber)),
      page_size: '50',
      search: values('xe-node-search'),
      bound: values('xe-node-bound') || 'all',
    });
    try {
      const result = await api(`/nodes?${query.toString()}`);
      state.bindingNodes = Array.isArray(result?.items) ? result.items : [];
      state.bindingPagination = result?.pagination || { current_page: 1, last_page: 1, total: 0 };
      state.bindingPage = Number(state.bindingPagination.current_page || 1);
      renderBindingNodes();
    } catch (error) {
      if (list) list.innerHTML = `<p class="xe-error">${esc(error.message)}</p>`;
    }
  };

  const openBinding = async (route) => {
    state.bindingRoute = route;
    state.bindingSelected.clear();
    state.bindingPage = 1;
    const modal = adapter.get('xe-bind-modal');
    const title = adapter.get('xe-bind-title');
    if (title) title.textContent = `绑定节点：${route.remarks || `#${route.id}`}`;
    if (modal) modal.hidden = false;
    showBindMessage('');
    await loadBindingNodes(1);
  };

  const closeBinding = () => {
    const modal = adapter.get('xe-bind-modal');
    if (modal) modal.hidden = true;
    state.bindingRoute = null;
    state.bindingNodes = [];
    state.bindingSelected.clear();
  };

  const syncMessage = (sync) => {
    const confirmed = sync?.confirmed_server_ids?.length || 0;
    const pending = sync?.pending_server_ids?.length || 0;
    return pending
      ? `已确认 ${confirmed} 个节点，${pending} 个节点离线或尚未确认应用。`
      : `全部 ${confirmed} 个在线节点已确认应用。`;
  };

  const pollBindingStatus = async (result) => {
    let pending = result?.sync?.pending_server_ids || [];
    if (!pending.length || !result?.requested_at) return;
    const routeId = Number(state.bindingRoute?.id || 0);
    for (let attempt = 0; attempt < 12 && pending.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (!state.bindingRoute || Number(state.bindingRoute.id) !== routeId) return;
      try {
        const status = await api('/bind-status', 'POST', {
          server_ids: pending,
          requested_at: result.requested_at,
        });
        pending = status?.sync?.pending_server_ids || [];
        showBindMessage(syncMessage(status?.sync));
      } catch (error) {
        if (attempt === 11) showBindMessage(error.message, true);
      }
    }
  };

  const bindSelectedNodes = async (bound, button) => {
    if (!state.bindingRoute || !state.bindingSelected.size) {
      showBindMessage('请至少选择一个节点。', true);
      return;
    }
    button.disabled = true;
    showBindMessage(bound ? '正在绑定并等待节点确认…' : '正在解绑并等待节点确认…');
    try {
      const result = await api('/bind', 'POST', {
        route_id: Number(state.bindingRoute.id),
        server_ids: [...state.bindingSelected],
        bound,
      });
      if (Number(result?.changed || 0) === 0) {
        showBindMessage('所选节点已经是目标状态，无需重载。');
        state.bindingSelected.clear();
        await loadBindingNodes(state.bindingPage);
        return;
      }
      showBindMessage(`${bound ? '绑定' : '解绑'}完成：${syncMessage(result?.sync)}`);
      state.bindingSelected.clear();
      await Promise.all([loadBindingNodes(state.bindingPage), load()]);
      void pollBindingStatus(result);
    } catch (error) {
      showBindMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  const toggleRoute = async (route, enabled) => {
    try {
      await api('/toggle', 'POST', { id: Number(route.id), enabled });
      showMessage(`${route.remarks || `#${route.id}`} 已${enabled ? '启用' : '停用'}，绑定节点正在更新。`);
      await load();
    } catch (error) {
      showMessage(error.message, true);
    }
  };

  const copyRoute = (route) => {
    fillForm(route);
    state.editingId = 0;
    adapter.get('xe-id').value = '';
    adapter.get('xe-form-title').textContent = '复制规则';
    adapter.get('xe-remarks').value = `${route.remarks || `#${route.id}`}（副本）`;
    adapter.get('xe-priority').value = Number(route.priority || 100) + 1;
    showMessage('已复制到编辑器，确认后保存。');
  };

  const load = async () => {
    if (state.loading) return;
    state.loading = true;
    const list = adapter.get('xe-list');
    if (list) list.innerHTML = '<p>正在加载…</p>';
    try {
      const [routes, options] = await Promise.all([
        api('/fetch'),
        api('/options'),
      ]);
      state.routes = Array.isArray(routes) ? routes : [];
      state.targets = Array.isArray(options?.targets) ? options.targets : [];
      renderTargets();
      renderList();
    } catch (error) {
      if (list) list.innerHTML = `<p class="xe-error">${esc(error.message)}</p>`;
    } finally {
      state.loading = false;
    }
  };

  const save = async (button) => {
    button.disabled = true;
    showMessage('正在保存…');
    try {
      const body = readForm();
      const saved = await api('/save', 'POST', body);
      showMessage('规则已保存，正在等待绑定节点确认配置版本…');
      await load();
      resetForm();
      showMessage('规则已保存，正在等待绑定节点确认配置版本…');
      if (saved?.id) void pollSync(saved.id);
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  const pollSync = async (routeId) => {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      if (!page()) return;
      try {
        const status = await api('/sync-status', 'POST', { route_id: Number(routeId) });
        if (Number(status?.pending || 0) === 0) {
          showMessage(`节点配置已全部确认：revision/hash 一致（${Number(status?.confirmed || 0)} 台）。`);
          return;
        }
        showMessage(`等待节点应用：${Number(status?.confirmed || 0)} 台已确认，${Number(status.pending)} 台待更新。`);
      } catch (error) {
        if (attempt === 8) showMessage(error.message, true);
      }
    }
    showMessage('仍有节点未确认 revision/hash，请检查节点版本和连接状态。', true);
  };

  const preview = async () => {
    try {
      const result = await api('/preview', 'POST', readForm());
      const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
      adapter.get('xe-preview').textContent = JSON.stringify(result, null, 2);
      if (diagnostics.some((item) => item.severity === 'error')) {
        showMessage('格式校验通过，但发现会影响规则生效的冲突。', true);
      } else if (diagnostics.some((item) => item.severity === 'warning')) {
        showMessage('格式校验通过，但存在需要确认的警告。', true);
      } else if (diagnostics.length) {
        showMessage('校验通过，并有诊断提示。');
      } else {
        showMessage('校验通过，未发现确定性冲突。');
      }
    } catch (error) {
      showMessage(error.message, true);
    }
  };

  const reorder = async (id, direction) => {
    const index = state.routes.findIndex((route) => Number(route.id) === Number(id));
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.routes.length) return;
    const items = [...state.routes];
    [items[index], items[target]] = [items[target], items[index]];
    await applyOrder(items);
  };

  const applyOrder = async (items) => {
    try {
      await api('/sort', 'POST', {
        items: items.map((route, index) => ({
          id: Number(route.id),
          priority: (index + 1) * 10,
        })),
      });
      await load();
    } catch (error) {
      showMessage(error.message, true);
    }
  };

  const handleClick = async (event) => {
    const nodeCheck = event.target.closest?.('[data-xe-node-check]');
    if (nodeCheck) {
      const nodeId = Number(nodeCheck.dataset.xeNodeCheck);
      if (nodeCheck.checked) state.bindingSelected.add(nodeId);
      else state.bindingSelected.delete(nodeId);
      return;
    }
    if (event.target.closest?.('[data-xe-bind-close]')) {
      closeBinding();
      return;
    }
    if (event.target.closest?.('[data-xe-node-filter]')) {
      state.bindingPage = 1;
      await loadBindingNodes(1);
      return;
    }
    if (event.target.closest?.('[data-xe-select-page]')) {
      state.bindingNodes.forEach((node) => state.bindingSelected.add(Number(node.id)));
      renderBindingNodes();
      return;
    }
    if (event.target.closest?.('[data-xe-clear-selection]')) {
      state.bindingSelected.clear();
      renderBindingNodes();
      return;
    }
    const bindSelected = event.target.closest?.('[data-xe-bind-selected]');
    if (bindSelected) {
      await bindSelectedNodes(bindSelected.dataset.xeBindSelected === '1', bindSelected);
      return;
    }
    if (event.target.closest?.('[data-xe-node-prev]')) {
      if (state.bindingPage > 1) await loadBindingNodes(state.bindingPage - 1);
      return;
    }
    if (event.target.closest?.('[data-xe-node-next]')) {
      if (state.bindingPage < Number(state.bindingPagination.last_page || 1)) {
        await loadBindingNodes(state.bindingPage + 1);
      }
      return;
    }
    if (event.target.closest('[data-xe-refresh]')) {
      await load();
      return;
    }
    if (event.target.closest('[data-xe-reset]')) {
      resetForm();
      return;
    }
    if (event.target.closest('[data-xe-preview]')) {
      await preview();
      return;
    }
    const saveButton = event.target.closest('[data-xe-save]');
    if (saveButton) {
      await save(saveButton);
      return;
    }
    const edit = event.target.closest('[data-xe-edit]');
    if (edit) {
      const route = state.routes.find((item) => Number(item.id) === Number(edit.dataset.xeEdit));
      if (route) fillForm(route);
      return;
    }
    const bind = event.target.closest('[data-xe-bind]');
    if (bind) {
      const route = state.routes.find((item) => Number(item.id) === Number(bind.dataset.xeBind));
      if (route) await openBinding(route);
      return;
    }
    const toggle = event.target.closest('[data-xe-toggle]');
    if (toggle) {
      const route = state.routes.find((item) => Number(item.id) === Number(toggle.dataset.xeToggle));
      if (route) await toggleRoute(route, toggle.dataset.xeEnabled === '1');
      return;
    }
    const copy = event.target.closest('[data-xe-copy]');
    if (copy) {
      const route = state.routes.find((item) => Number(item.id) === Number(copy.dataset.xeCopy));
      if (route) copyRoute(route);
      return;
    }
    const up = event.target.closest('[data-xe-up]');
    if (up) {
      await reorder(up.dataset.xeUp, -1);
      return;
    }
    const down = event.target.closest('[data-xe-down]');
    if (down) {
      await reorder(down.dataset.xeDown, 1);
      return;
    }
    if (event.target.closest('[data-xe-renumber]')) {
      await applyOrder(state.routes);
      return;
    }
    const remove = event.target.closest('[data-xe-delete]');
    if (remove) {
      const route = state.routes.find((item) => Number(item.id) === Number(remove.dataset.xeDelete));
      const count = Number(route?.servers_count || 0);
      if (!confirm(`确定删除此路由规则吗？${count ? `将同时从 ${count} 个节点解绑并推送配置。` : ''}`)) return;
      try {
        const result = await api('/drop', 'POST', { id: Number(remove.dataset.xeDelete) });
        showMessage(`规则已删除，并清理 ${Number(result?.removed_bindings || 0)} 个节点绑定。`);
        await load();
        if (state.editingId === Number(remove.dataset.xeDelete)) resetForm();
      } catch (error) {
        showMessage(error.message, true);
      }
    }
  };

  const open = async () => {
    if (!page()) {
      const element = adapter.mountPage(pageHtml(), css);
      if (!element) return;
      adapter.onPage('click', handleClick);
      adapter.on('xe-search', 'input', (event) => {
        state.search = event.target.value.trim();
        renderList();
      });
      adapter.on('xe-action', 'change', updateTargetState);
    }
    adapter.setMenuActive(true);
    resetForm();
    await load();
  };

  const close = () => {
    if (!page()) return;
    closeBinding();
    adapter.setMenuActive(false);
    adapter.unmountPage();
  };

  const openIfCurrentRoute = () => {
    if (adapter.isCurrentRoute()) {
      if (!page()) void open();
      return;
    }
    if (page()) close();
  };

  adapter.bindNavigation({
    onRoute: () => void open(),
    onClose: close,
    onResume: openIfCurrentRoute,
  });
})();
