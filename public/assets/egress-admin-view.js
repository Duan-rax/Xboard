/* Egress-management templates and render functions. */
(() => {
  'use strict';

  const adapter = globalThis.XboardEgressAdapter;
  const root = globalThis.XboardEgressAdmin = globalThis.XboardEgressAdmin || {};
  if (!adapter || !root.state || !root.form) {
    throw new Error('egress adapter/state/form modules must load before egress-admin-view.js');
  }

  const state = root.state;
  const PAGE_ID = adapter.PAGE_ID;
  const BIND_PAGE_ID = adapter.BIND_PAGE_ID;
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));

  const css = `
    #${PAGE_ID}{display:none;height:100%;overflow:auto;background:hsl(var(--background,0 0% 100%));color:hsl(var(--foreground,222.2 84% 4.9%));font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    #${PAGE_ID}.open{display:block}
    #${PAGE_ID} .xe-page-shell{max-width:1440px;margin:0 auto;padding:28px clamp(20px,3vw,40px) 40px}
    #${PAGE_ID} .xe-page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px}
    #${PAGE_ID} h1,#${BIND_PAGE_ID} h2{margin:0;font-size:26px;line-height:1.25;font-weight:700}
    #${PAGE_ID} p,#${BIND_PAGE_ID} p{margin:6px 0 0;color:#64748b;font-size:12.5px;line-height:1.6}
    #${PAGE_ID} > .xe-page-shell > .xe-main{display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,1.35fr);gap:18px}
    #${PAGE_ID}.xe-binding > .xe-page-shell > .xe-main{display:none}
    #${PAGE_ID} .xe-panel,#${BIND_PAGE_ID}{background:hsl(var(--card,0 0 100%));border:1px solid hsl(var(--border,214 32% 91%));border-radius:12px;padding:18px;min-width:0;color:hsl(var(--card-foreground,222.2 84% 4.9%))}
    #${PAGE_ID} .xe-panel h3,#${BIND_PAGE_ID} h3{margin:0 0 10px;font-size:14px}
    #${PAGE_ID} label{display:block;margin:9px 0 4px;color:#475569;font-size:12px;font-weight:600}
    #${PAGE_ID} input,#${PAGE_ID} select,#${PAGE_ID} textarea,#${BIND_PAGE_ID} input,#${BIND_PAGE_ID} select{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#0f172a;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
    #${PAGE_ID} textarea{min-height:96px;resize:vertical}
    #${PAGE_ID} .xe-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    #${PAGE_ID} .xe-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;align-items:center}
    #${PAGE_ID} button,#${BIND_PAGE_ID} button{border:0;border-radius:7px;padding:8px 11px;background:#2563eb;color:#fff;cursor:pointer;font-size:13px;line-height:1.2}
    #${PAGE_ID} button.xe-secondary,#${BIND_PAGE_ID} button.xe-secondary{background:#e2e8f0;color:#334155}
    #${PAGE_ID} button.xe-danger,#${BIND_PAGE_ID} button.xe-danger{background:#dc2626}
    #${PAGE_ID} button:disabled,#${BIND_PAGE_ID} button:disabled{opacity:.5;cursor:not-allowed}
    #${PAGE_ID} table{width:100%;border-collapse:collapse;font-size:12.5px}
    #${PAGE_ID} th,#${PAGE_ID} td{text-align:left;padding:9px 7px;border-bottom:1px solid #eef2f7;vertical-align:middle}
    #${PAGE_ID} th{color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em}
    #${PAGE_ID} .xe-small,#${BIND_PAGE_ID} .xe-small{font-size:11px;color:#64748b;line-height:1.5}
    #${PAGE_ID} .xe-name{font-weight:600;color:#0f172a}
    #${PAGE_ID} .xe-code{font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#334155}
    #${PAGE_ID} .xe-status{color:#16a34a;font-size:12px}
    #${PAGE_ID} .xe-error,#${BIND_PAGE_ID} .xe-error{color:#dc2626;font-size:12px;white-space:pre-wrap}
    #${PAGE_ID} .xe-row-actions{display:flex;gap:6px;flex-wrap:wrap}
    #${PAGE_ID} .xe-toolbar,#${BIND_PAGE_ID} .xe-toolbar{display:flex;gap:8px;align-items:center;margin:8px 0 10px;flex-wrap:wrap}
    #${PAGE_ID} .xe-toolbar input{flex:1;min-width:160px}
    #${PAGE_ID} .xe-pager,#${BIND_PAGE_ID} .xe-pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:10px;flex-wrap:wrap}
    #${PAGE_ID} .xe-pager span,#${BIND_PAGE_ID} .xe-pager span{margin-right:auto}
    #${PAGE_ID} .xe-badge,#${BIND_PAGE_ID} .xe-badge{display:inline-block;padding:1px 6px;border-radius:999px;background:#e2e8f0;color:#334155;font-size:10.5px;font-weight:600;vertical-align:middle}
    #${PAGE_ID} .xe-badge.xe-on{background:#dcfce7;color:#15803d}
    #${PAGE_ID} .xe-badge.xe-off{background:#fee2e2;color:#b91c1c}
    #${PAGE_ID} .xe-badge.xe-tls{background:#dbeafe;color:#1d4ed8}
    #${PAGE_ID} .xe-bind-panel{display:none}
    #${BIND_PAGE_ID}{display:none;margin-top:18px}
    #${BIND_PAGE_ID}.open{display:block}
    #${BIND_PAGE_ID} .xe-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:16px;border-bottom:1px solid hsl(var(--border,214 32% 91%))}
    #${BIND_PAGE_ID} .xe-main{padding:16px 0 20px}
    #${BIND_PAGE_ID} .xe-badge.xe-bound{background:#fef3c7;color:#92400e;margin-left:6px}
    #${BIND_PAGE_ID} .xe-node{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border:1px solid #eef2f7;border-radius:9px;margin-bottom:6px;cursor:pointer;font-weight:400}
    #${BIND_PAGE_ID} .xe-node:hover{background:#f8fafc}
    #${BIND_PAGE_ID} .xe-node input{width:auto;margin-top:4px;flex:none}
    #${BIND_PAGE_ID} .xe-node-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
    #${BIND_PAGE_ID} .xe-node-name{font-size:13px;font-weight:600;color:#0f172a}
    #${BIND_PAGE_ID} .xe-node-side{flex:none;text-align:right}
    #${BIND_PAGE_ID} .xe-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-top:14px;border-top:1px solid hsl(var(--border,214 32% 91%))}
    #${BIND_PAGE_ID} .xe-foot .xe-small{margin-right:auto}
    #${PAGE_ID} .xe-hint{color:#64748b;font-size:11px;line-height:1.55;margin-top:4px}
    @media(max-width:900px){#${PAGE_ID} > .xe-page-shell > .xe-main{grid-template-columns:1fr}#${PAGE_ID} .xe-page-shell{padding:22px 16px 32px}}
  `;

  const mainHtml = () => `
    <section id="${PAGE_ID}" aria-hidden="true">
      <div class="xe-page-shell">
        <header class="xe-page-head">
          <div>
            <h1 id="xe-title">出站管理</h1>
            <p>为节点绑定落地代理。凭据只下发给已认证的节点控制面，不会进入订阅或用户 API。仅支持包含 egress_proxy 的 Xboard-Node 构建。</p>
          </div>
        </header>
        <div class="xe-main">
          <section class="xe-panel">
            <h3>新增 / 编辑出站</h3>
            <input type="hidden" id="xe-id">
            <label for="xe-name">名称</label>
            <input id="xe-name" placeholder="例如：US Residential 01" autocomplete="off">
            <div class="xe-grid">
              <div>
                <label for="xe-protocol">类型</label>
                <select id="xe-protocol">
                  <option value="socks5">SOCKS5</option>
                  <option value="http">HTTP / HTTPS 代理</option>
                  <option value="shadowsocks">Shadowsocks</option>
                  <option value="vless">VLESS</option>
                  <option value="trojan">Trojan</option>
                </select>
              </div>
              <div>
                <label for="xe-host">地址</label>
                <input id="xe-host" placeholder="host 或 IP" autocomplete="off">
              </div>
            </div>
            <div class="xe-grid">
              <div>
                <label for="xe-port">端口</label>
                <input id="xe-port" type="number" min="1" max="65535" placeholder="1080">
              </div>
              <div>
                <label for="xe-sni">TLS SNI（可选）</label>
                <input id="xe-sni" placeholder="example.com" autocomplete="off">
              </div>
            </div>
            <div class="xe-grid">
              <div>
                <label for="xe-username">用户名（SOCKS / HTTP）</label>
                <input id="xe-username" autocomplete="off">
                <label><input id="xe-clear-username" type="checkbox" style="width:auto"> 清除已保存用户名</label>
              </div>
              <div>
                <label for="xe-password">密码 / Trojan 密码 / SS 密码</label>
                <input id="xe-password" type="password" autocomplete="new-password">
                <label><input id="xe-clear-password" type="checkbox" style="width:auto"> 清除已保存密码</label>
              </div>
            </div>
            <label><input id="xe-tls" type="checkbox" style="width:auto"> 出站 TLS / HTTPS</label>
            <label><input id="xe-insecure" type="checkbox" style="width:auto"> 允许不安全证书</label>
            <label for="xe-config">高级 JSON</label>
            <textarea id="xe-config" spellcheck="false">{}</textarea>
            <div class="xe-hint" id="xe-hint"></div>
            <label><input id="xe-enabled" type="checkbox" style="width:auto" checked> 启用</label>
            <div class="xe-actions">
              <button data-xe-save>保存出站</button>
              <button class="xe-secondary" data-xe-reset>清空</button>
              <span id="xe-message" class="xe-small"></span>
            </div>
          </section>
          <section class="xe-panel" id="xe-catalog-panel">
            <h3>现有出站</h3>
            <div class="xe-toolbar">
              <input id="xe-search" placeholder="搜索名称、地址或协议">
              <button class="xe-secondary" data-xe-search>搜索</button>
              <button class="xe-secondary" data-xe-refresh>刷新</button>
            </div>
            <div id="xe-list" class="xe-small">正在加载…</div>
            <div id="xe-pager" class="xe-pager"></div>
          </section>
        </div>
        <div id="xe-bind-slot"></div>
      </div>
    </section>`;

  const bindHtml = () => `
    <section id="${BIND_PAGE_ID}" class="xe-bind-panel" aria-hidden="true">
      <div class="xe-head">
        <div>
          <h2 id="xe-bind-title">节点绑定</h2>
          <p>勾选节点后批量绑定或解绑。一个节点同时只能使用一个出站资料；解绑后节点恢复默认 direct 出站。</p>
        </div>
        <button class="xe-secondary" data-xe-bind-close>返回列表</button>
      </div>
      <div class="xe-main">
        <div class="xe-toolbar">
          <input id="xe-bind-search" placeholder="搜索节点名称或地址">
          <select id="xe-bind-filter" style="width:auto">
            <option value="all">全部节点</option>
            <option value="unbound">未绑定</option>
            <option value="current">已绑定到当前出站</option>
            <option value="bound">已绑定任意出站</option>
          </select>
          <button class="xe-secondary" data-xe-bind-search>搜索</button>
          <button class="xe-secondary" data-xe-bind-refresh>刷新</button>
        </div>
        <label class="xe-small"><input id="xe-bind-select-page" type="checkbox" style="width:auto"> 全选本页</label>
        <div id="xe-bind-list" class="xe-small">正在加载…</div>
        <div id="xe-bind-pager" class="xe-pager"></div>
      </div>
      <div class="xe-foot">
        <span class="xe-small" id="xe-bind-selected-count">未选择节点</span>
        <button data-xe-bind-selected>绑定所选</button>
        <button class="xe-secondary" data-xe-unbind-selected>解绑所选</button>
        <button class="xe-danger" data-xe-unbind-all>解绑全部</button>
        <span id="xe-bind-message" class="xe-small"></span>
      </div>
    </section>`;

  const showMessage = (message, error = false) => {
    const element = adapter.get('xe-message');
    if (!element) return;
    element.className = error ? 'xe-error' : 'xe-status';
    element.textContent = message;
  };

  const showBindMessage = (message, error = false) => {
    const element = adapter.get('xe-bind-message');
    if (!element) return;
    element.className = error ? 'xe-error' : 'xe-small';
    element.textContent = message;
  };

  const renderCatalog = (items, pagination) => {
    const list = adapter.get('xe-list');
    if (!list) return;
    state.proxies = items;
    state.page = Number(pagination.current_page || 1);
    state.lastPage = Math.max(1, Number(pagination.last_page || 1));
    state.total = Number(pagination.total || items.length);
    list.innerHTML = items.length ? `
      <table>
        <thead><tr><th>名称</th><th>类型</th><th>地址</th><th>节点</th><th>操作</th></tr></thead>
        <tbody>
          ${items.map((proxy) => `
            <tr>
              <td>
                <div class="xe-name">${esc(proxy.name)} ${proxy.enabled ? '<span class="xe-badge xe-on">启用</span>' : '<span class="xe-badge xe-off">停用</span>'}</div>
                <span class="xe-small">#${proxy.id}${proxy.updated_at ? ` · ${esc(root.form.formatTime(proxy.updated_at))}` : ''}</span>
              </td>
              <td>
                <span class="xe-badge">${esc(root.form.protocolLabel(proxy.protocol))}</span>
                ${proxy.tls_enabled ? '<span class="xe-badge xe-tls">TLS</span>' : ''}
              </td>
              <td>
                <code class="xe-code">${esc(proxy.host)}:${proxy.port}</code>
                ${proxy.tls_server_name ? `<br><span class="xe-small">SNI ${esc(proxy.tls_server_name)}</span>` : ''}
              </td>
              <td>${Number(proxy.servers_count) || 0}</td>
              <td>
                <div class="xe-row-actions">
                  <button class="xe-secondary" data-xe-edit="${proxy.id}">编辑</button>
                  <button data-xe-bind-nodes="${proxy.id}">绑定节点${Number(proxy.servers_count) ? ` (${proxy.servers_count})` : ''}</button>
                  <button class="xe-secondary" data-xe-test="${proxy.id}">测试</button>
                  <button class="xe-danger" data-xe-delete="${proxy.id}" ${Number(proxy.servers_count) ? 'disabled title="请先解绑节点"' : ''}>删除</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>` : '<p>没有匹配的出站配置。</p>';

    const pager = adapter.get('xe-pager');
    if (pager) {
      pager.innerHTML = `
        <span class="xe-small">共 ${state.total} 条 · 第 ${state.page}/${state.lastPage} 页</span>
        <button class="xe-secondary" data-xe-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>上一页</button>
        <button class="xe-secondary" data-xe-page="${state.page + 1}" ${state.page >= state.lastPage ? 'disabled' : ''}>下一页</button>`;
    }
  };

  const updateBindSelection = () => {
    const count = state.selected.size;
    const countElement = adapter.get('xe-bind-selected-count');
    if (countElement) countElement.textContent = count ? `已选择 ${count} 个节点` : '未选择节点';

    const pageIds = state.bindNodes.map((node) => Number(node.id));
    const selectedOnPage = pageIds.filter((id) => state.selected.has(id)).length;
    const toggle = adapter.get('xe-bind-select-page');
    if (toggle) {
      toggle.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
      toggle.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
    }
  };

  const renderBindNodes = (items) => {
    const list = adapter.get('xe-bind-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<p>没有匹配的节点。</p>';
      updateBindSelection();
      return;
    }

    const currentId = Number(state.bindProxy?.id || 0);
    list.innerHTML = items.map((node) => {
      const boundId = Number(node.egress_proxy_id || 0);
      const current = boundId > 0 && boundId === currentId;
      const other = boundId > 0 && boundId !== currentId;
      const boundLabel = node.egress_proxy_name || (boundId ? `#${boundId}` : '');
      const badge = current
        ? '<span class="xe-badge xe-on">当前出站</span>'
        : other
          ? `<span class="xe-badge xe-bound">已绑定 ${esc(boundLabel)}</span>`
          : '<span class="xe-badge">未绑定</span>';
      return `
        <label class="xe-node">
          <input type="checkbox" data-xe-node="${node.id}" ${state.selected.has(Number(node.id)) ? 'checked' : ''}>
          <span class="xe-node-main">
            <span class="xe-node-name">${esc(node.name || `节点 #${node.id}`)}</span>
            <span class="xe-small">${esc(node.host)}:${node.port} · #${node.id}</span>
          </span>
          <span class="xe-node-side">
            ${badge}
            <div class="xe-small">${node.enabled ? '已启用' : '已停用'}</div>
          </span>
        </label>`;
    }).join('');
    updateBindSelection();
  };

  const renderBindPager = () => {
    const pager = adapter.get('xe-bind-pager');
    if (!pager) return;
    pager.innerHTML = `
      <span class="xe-small">共 ${state.bindTotal} 个节点 · 第 ${state.bindPage}/${state.bindLastPage} 页</span>
      <button class="xe-secondary" data-xe-bind-page="${state.bindPage - 1}" ${state.bindPage <= 1 ? 'disabled' : ''}>上一页</button>
      <button class="xe-secondary" data-xe-bind-page="${state.bindPage + 1}" ${state.bindPage >= state.bindLastPage ? 'disabled' : ''}>下一页</button>`;
  };

  root.esc = esc;
  root.showMessage = showMessage;
  root.view = Object.freeze({
    bindHtml,
    css,
    mainHtml,
    renderBindNodes,
    renderBindPager,
    renderCatalog,
    showBindMessage,
    showMessage,
    updateBindSelection,
  });
})();
