(() => {
  'use strict';
  const adapter = globalThis.XboardSecurityAuditAdapter;
  const root = globalThis.XboardSecurityAudit = globalThis.XboardSecurityAudit || {};
  if (!adapter || !root.state) throw new Error('security audit adapter/state modules must load first');
  const state = root.state;
  const PAGE = adapter.PAGE_ID;
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));
  const bytes = (value) => {
    let size = Number(value) || 0;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return `${size.toFixed(index ? 2 : 0)} ${units[index]}`;
  };
  const time = (value) => value ? new Date(value).toLocaleString() : '-';

  const css = `
    #${PAGE}{height:100%;overflow:auto;background:hsl(var(--background,0 0% 100%));color:hsl(var(--foreground,222.2 84% 4.9%))}
    #${PAGE} [hidden]{display:none!important}
    #${PAGE} .sa-shell{max-width:1500px;margin:0 auto;padding:28px clamp(18px,3vw,40px) 44px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    #${PAGE} .sa-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:18px}
    #${PAGE} h1{margin:0;font-size:27px}#${PAGE} h2{font-size:15px;margin:0 0 12px}#${PAGE} h3{font-size:13px;margin:0 0 10px}
    #${PAGE} p{margin:6px 0 0;color:#64748b;font-size:12.5px;line-height:1.6}
    #${PAGE} .sa-kicker{margin:0 0 5px;color:#2563eb;font-size:10px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}
    #${PAGE} .sa-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
    #${PAGE} input,#${PAGE} select,#${PAGE} button{box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#0f172a;font-size:12.5px}
    #${PAGE} #sa-user-id,#${PAGE} #sa-node-id{min-width:160px;max-width:260px}
    #${PAGE} button{background:#2563eb;color:#fff;border:0;cursor:pointer}#${PAGE} button.secondary{background:#e2e8f0;color:#334155}#${PAGE} button:disabled{opacity:.5}
    #${PAGE} .sa-cards{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:10px;margin-bottom:14px}
    #${PAGE} .sa-card,#${PAGE} .sa-panel{background:hsl(var(--card,0 0 100%));border:1px solid hsl(var(--border,214 32% 91%));border-radius:12px;padding:16px;min-width:0}
    #${PAGE} .sa-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
    #${PAGE} .sa-panel-head h2{margin:0}
    #${PAGE} .sa-card b{display:block;font-size:21px;margin-top:5px}#${PAGE} .sa-small{font-size:11px;color:#64748b}
    #${PAGE} .sa-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
    #${PAGE} .sa-table-wrap{width:100%;overflow-x:auto}
    #${PAGE} table{width:100%;border-collapse:collapse;font-size:11.5px}#${PAGE} th,#${PAGE} td{padding:8px 6px;border-bottom:1px solid #eef2f7;text-align:left;vertical-align:top}
    #${PAGE} th{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
    #${PAGE} code{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#334155;word-break:break-all}
    #${PAGE} .sa-badge{display:inline-block;padding:1px 6px;border-radius:999px;background:#e2e8f0;color:#334155;font-size:10px;font-weight:600}
    #${PAGE} .sa-badge.block{background:#fee2e2;color:#b91c1c}#${PAGE} .sa-badge.route{background:#dcfce7;color:#15803d}
    #${PAGE} .sa-error{color:#dc2626;font-size:11.5px;white-space:pre-wrap}#${PAGE} .sa-status{color:#15803d;font-size:11.5px}
    #${PAGE} .sa-pager{display:flex;justify-content:space-between;align-items:center;margin-top:10px}
    #${PAGE} .sa-user-link{border:0;background:none;color:#2563eb;padding:0;cursor:pointer}
    #${PAGE} .sa-note{margin-top:14px;padding:12px 14px;border-radius:9px;background:#eff6ff;color:#1e3a8a;font-size:11.5px;line-height:1.65}
    #${PAGE} .sa-warning{background:#fff7ed;color:#9a3412}
    @media(max-width:1000px){#${PAGE} .sa-cards{grid-template-columns:1fr 1fr}#${PAGE} .sa-grid{grid-template-columns:1fr}}
  `;

  const html = () => `
    <section id="${PAGE}">
      <div class="sa-shell">
        <header class="sa-head">
          <div>
            <p class="sa-kicker">Security audit</p>
            <h1 id="sa-section-title">审计概览</h1>
            <p id="sa-section-copy">统一查看用户、节点、目标站点、规则命中和出站结果。审计仅记录连接元数据，不记录正文内容。</p>
          </div>
          <span class="sa-badge">NATIVE AUDIT</span>
        </header>
        <div class="sa-toolbar" data-sa-filter-toolbar>
          <select id="sa-range"><option value="1h">1 小时</option><option value="6h">6 小时</option><option value="24h" selected>24 小时</option><option value="7d">7 天</option><option value="14d">14 天</option></select>
          <select id="sa-user-id" aria-label="按用户筛选"><option value="">全部用户</option></select>
          <select id="sa-node-id" aria-label="按节点筛选"><option value="">全部节点</option></select>
          <input id="sa-destination" name="audit_destination_search" autocomplete="off" autocapitalize="none" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="域名或 IP">
          <select id="sa-action"><option value="">全部动作</option><option value="block">阻止</option><option value="reject">内核拒绝</option><option value="direct">直连</option><option value="route">路由</option><option value="hijack-dns">DNS</option></select>
          <button data-sa-refresh>刷新</button>
          <button class="secondary" data-sa-clear>清除筛选</button>
          <span id="sa-message" class="sa-small"></span>
        </div>
        <section data-sa-panel="overview">
          <div id="sa-cards" class="sa-cards"></div>
          <div class="sa-grid">
            <section class="sa-panel"><h2>热门目标</h2><div id="sa-destinations" class="sa-small">正在加载…</div></section>
            <section class="sa-panel"><h2>节点分布</h2><div id="sa-nodes" class="sa-small">正在加载…</div></section>
          </div>
          <div class="sa-note">顶部流量和用户/节点流量来自 Xboard 平台统计，包含 Xray 与 sing-box；热门目标、规则和出站来自审计事件。需要定位具体连接时，请使用左侧对应小分类。</div>
        </section>
        <section data-sa-panel="traffic" hidden>
          <section class="sa-panel">
            <div class="sa-panel-head"><h2>连接明细</h2><span id="sa-event-count" class="sa-small"></span></div>
            <div id="sa-events" class="sa-small">正在加载…</div>
            <div class="sa-pager"><span class="sa-small" id="sa-page-info"></span><div><button class="secondary" data-sa-prev>上一页</button> <button class="secondary" data-sa-next>下一页</button></div></div>
          </section>
          <div class="sa-note sa-warning">Xray 访问日志提供目标、用户与连接数，但不提供单连接字节数；对应的连接流量字段为空。平台累计流量请看“审计概览”。</div>
        </section>
        <section data-sa-panel="rules" hidden>
          <section class="sa-panel"><h2>规则命中排行</h2><div id="sa-routes" class="sa-small">正在加载…</div></section>
          <div class="sa-note sa-warning">只有节点采集器明确上报的规则标识才视为内核命中；来源为采集器推断的记录会单独标注，不与内核精确命中混用。</div>
        </section>
        <section data-sa-panel="users" hidden>
          <section class="sa-panel"><h2>用户流量与连接</h2><div id="sa-users" class="sa-small">正在加载…</div></section>
          <div class="sa-note">点击用户可切换到“流量明细”，并自动按该用户筛选所选的审计时间范围。</div>
        </section>
        <section data-sa-panel="settings" hidden>
          <section class="sa-panel">
            <h2>审计接收设置</h2>
            <div class="sa-toolbar" style="margin-top:12px">
            <input id="sa-ingest-url" readonly style="min-width:420px;flex:1">
            <input id="sa-secret" name="audit_webhook_config" autocomplete="new-password" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="Webhook Secret" style="min-width:300px;flex:1">
            <input id="sa-retention" type="number" min="1" max="365" style="width:110px">
            <button data-sa-generate class="secondary">生成密钥</button>
            <button data-sa-save-settings>保存</button>
            </div>
            <p>节点采集器通过 <code>X-Audit-Token</code> 或 <code>X-Audit-Timestamp + X-Audit-Signature</code> 认证。Secret 只用于节点到面板的审计上报，请勿写入公开配置。</p>
            <p>日志默认保留 30 天；保存设置后，清理任务会按新的保留期限运行。</p>
            <div class="sa-toolbar"><button class="secondary" data-sa-cleanup>立即清理过期事件</button><span id="sa-settings-message" class="sa-small"></span></div>
          </section>
        </section>
      </div>
    </section>`;

  const showMessage = (message, error = false) => {
    const el = adapter.get('sa-message');
    if (!el) return;
    el.className = error ? 'sa-error' : 'sa-small';
    el.textContent = message;
  };

  const renderCards = () => {
    const el = adapter.get('sa-cards');
    const cards = state.overview?.cards || {};
    if (!el) return;
    el.innerHTML = [
      ['平台总流量', bytes(cards.total_bytes)],
      ['上传', bytes(cards.upload_bytes)],
      ['下载', bytes(cards.download_bytes)],
      ['连接数', Number(cards.connections || 0).toLocaleString()],
      ['阻断事件', Number(cards.blocked_events || 0).toLocaleString()],
    ].map(([label, value]) => `<div class="sa-card"><span class="sa-small">${label}</span><b>${value}</b></div>`).join('');
  };

  const renderRoutes = () => {
    const el = adapter.get('sa-routes');
    const rows = state.overview?.routes || [];
    if (!el) return;
    el.innerHTML = rows.length ? `<div class="sa-table-wrap"><table><thead><tr><th>规则</th><th>动作/出站</th><th>来源</th><th>连接</th><th>流量</th><th>最近命中</th></tr></thead><tbody>${rows.map((row) => `
      <tr><td><b>${esc(row.route_name || row.route_tag || `#${row.route_id || '-'}`)}</b><br><span class="sa-small">${row.route_id ? `#${row.route_id}` : esc(row.route_tag || '')}</span></td>
      <td><span class="sa-badge ${row.action === 'block' || row.action === 'reject' ? 'block' : 'route'}">${esc(row.action)}</span>${row.outbound ? `<br><code>${esc(row.outbound)}</code>` : ''}</td>
      <td><span class="sa-badge">${esc(row.route_source || '未标注')}</span></td><td>${Number(row.connections || 0)}</td><td>${bytes(Number(row.upload_bytes || 0) + Number(row.download_bytes || 0))}</td><td>${time(row.last_seen_at)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p>当前时间范围内没有规则命中。</p>';
  };

  const renderUsers = () => {
    const el = adapter.get('sa-users');
    const rows = state.overview?.users || [];
    if (!el) return;
    el.innerHTML = rows.length ? `<div class="sa-table-wrap"><table><thead><tr><th>用户</th><th>连接</th><th>流量</th><th>阻断</th><th></th></tr></thead><tbody>${rows.map((row) => `
      <tr><td><button class="sa-user-link" data-sa-user="${row.user_id}">${esc(row.user_name || `用户 #${row.user_id}`)}</button><br><span class="sa-small">#${row.user_id}</span></td>
      <td>${Number(row.connections || 0)}</td><td>${bytes(Number(row.upload_bytes || 0) + Number(row.download_bytes || 0))}</td><td>${Number(row.blocked_events || 0)}</td>
      <td><button class="sa-user-link" data-sa-user="${row.user_id}">查看明细</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p>当前时间范围内没有用户维度数据。</p>';
  };

  const renderSimple = (id, rows, nameKey, idKey) => {
    const el = adapter.get(id);
    if (!el) return;
    el.innerHTML = rows.length ? `<div class="sa-table-wrap"><table><thead><tr><th>${nameKey === 'destination' ? '目标' : '节点'}</th><th>连接</th><th>流量</th></tr></thead><tbody>${rows.map((row) => `
      <tr><td><code>${esc(row[nameKey] || row[idKey] || '-')}</code>${row.node_name ? `<br><span class="sa-small">${esc(row.node_name)}</span>` : ''}</td>
      <td>${Number(row.connections || 0)}</td><td>${bytes(Number(row.upload_bytes || 0) + Number(row.download_bytes || 0))}</td></tr>`).join('')}</tbody></table></div>`
      : '<p>暂无数据。</p>';
  };

  const renderEvents = () => {
    const el = adapter.get('sa-events');
    if (!el) return;
    el.innerHTML = state.events.length ? `<div class="sa-table-wrap"><table><thead><tr><th>时间</th><th>用户</th><th>节点</th><th>目标</th><th>规则/动作</th><th>出站</th><th>流量</th></tr></thead><tbody>${state.events.map((row) => `
      <tr><td>${time(row.occurred_at)}</td>
      <td>${row.user_id ? `<button class="sa-user-link" data-sa-user="${row.user_id}">${esc(row.user_name || `#${row.user_id}`)}</button>` : '-'}</td>
      <td>${esc(row.node_id || '-')}</td>
      <td><code>${esc(row.destination || row.destination_ip || '-')}</code><br><span class="sa-small">${esc(row.network || '')} ${esc(row.protocol || '')}</span></td>
      <td>${esc(row.route_name || row.route_tag || `规则 #${row.route_id || '-'}`)}<br><span class="sa-badge ${row.action === 'block' || row.action === 'reject' ? 'block' : 'route'}">${esc(row.action)}</span></td>
      <td><code>${esc(row.outbound || '-')}</code></td>
      <td>${bytes(Number(row.upload_bytes || 0) + Number(row.download_bytes || 0))}</td></tr>`).join('')}</tbody></table></div>`
      : '<p>当前筛选条件下没有连接事件。</p>';
    const info = adapter.get('sa-page-info');
    if (info) info.textContent = `第 ${state.pagination.current_page || 1}/${state.pagination.last_page || 1} 页，共 ${state.pagination.total || 0} 条`;
    const count = adapter.get('sa-event-count');
    if (count) count.textContent = `共 ${state.pagination.total || 0} 条事件`;
  };

  const renderFilters = () => {
    const userSelect = adapter.get('sa-user-id');
    if (userSelect) {
      const selected = String(userSelect.value || '');
      const options = new Map();
      options.set('', '全部用户');
      (state.filterOptions?.users || state.overview?.users || []).forEach((row) => {
        const id = String(row.user_id || '');
        if (!id) return;
        options.set(id, row.user_name ? `${row.user_name} (#${id})` : `用户 #${id}`);
      });
      if (selected && !options.has(selected)) options.set(selected, `用户 #${selected}`);
      userSelect.innerHTML = [...options.entries()]
        .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`)
        .join('');
      userSelect.value = selected;
    }

    const nodeSelect = adapter.get('sa-node-id');
    if (nodeSelect) {
      const selected = String(nodeSelect.value || '');
      const options = new Map();
      options.set('', '全部节点');
      (state.filterOptions?.nodes || state.overview?.nodes || []).forEach((row) => {
        const id = String(row.node_id || '');
        if (!id) return;
        options.set(id, row.node_name ? `${row.node_name} (#${id})` : `节点 #${id}`);
      });
      if (selected && !options.has(selected)) options.set(selected, `节点 #${selected}`);
      nodeSelect.innerHTML = [...options.entries()]
        .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`)
        .join('');
      nodeSelect.value = selected;
    }
  };

  const renderAll = () => {
    renderFilters();
    renderCards();
    renderRoutes();
    renderUsers();
    renderSimple('sa-destinations', state.overview?.destinations || [], 'destination', 'destination');
    renderSimple('sa-nodes', state.overview?.nodes || [], 'node_name', 'node_id');
    renderEvents();
  };

  const renderSettings = (settings) => {
    state.settings = settings;
    if (adapter.get('sa-ingest-url')) adapter.get('sa-ingest-url').value = settings.ingest_url || '';
    if (adapter.get('sa-secret')) adapter.get('sa-secret').value = settings.webhook_secret || '';
    if (adapter.get('sa-retention')) adapter.get('sa-retention').value = settings.retention_days || 30;
  };

  root.esc = esc;
  root.bytes = bytes;
  root.time = time;
  root.showMessage = showMessage;
  root.view = Object.freeze({ css, html, renderAll, renderEvents, renderSettings, showMessage });
})();
