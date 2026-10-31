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
  const auditTimeFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const time = (value) => {
    if (!value) return '-';
    let raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
      raw = `${raw.replace(' ', 'T')}Z`;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '-';
    const parts = Object.fromEntries(
      auditTimeFormatter.formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  };

  const css = `
    #${PAGE}{height:100%;overflow:auto;background:#f5f7fb;color:hsl(var(--foreground,222.2 84% 4.9%))}
    #${PAGE} [hidden]{display:none!important}
    #${PAGE} .sa-shell{max-width:1500px;margin:0 auto;padding:28px clamp(18px,3vw,40px) 44px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    #${PAGE} .sa-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:18px}
    #${PAGE} .sa-head-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    #${PAGE} h1{margin:0;font-size:27px}#${PAGE} h2{font-size:15px;margin:0 0 12px}#${PAGE} h3{font-size:13px;margin:0 0 10px}
    #${PAGE} p{margin:6px 0 0;color:#64748b;font-size:12.5px;line-height:1.6}
    #${PAGE} .sa-kicker{margin:0 0 5px;color:#2563eb;font-size:10px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}
    #${PAGE} .sa-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
    #${PAGE} .sa-range-tabs{display:inline-flex;align-items:center;padding:3px;border-radius:8px;background:#fff;border:1px solid #e2e8f0}
    #${PAGE} .sa-range-tabs button{padding:5px 9px;border:0;border-radius:6px;background:transparent;color:#64748b;font-size:11px;white-space:nowrap}
    #${PAGE} .sa-range-tabs button.active{background:#eff6ff;color:#1d4ed8;box-shadow:inset 0 0 0 1px #bfdbfe}
    #${PAGE} .sa-range-native{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
    #${PAGE} input,#${PAGE} select,#${PAGE} button{box-sizing:border-box;padding:7px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#0f172a;font-size:12.5px}
    #${PAGE} #sa-user-id,#${PAGE} #sa-node-id{min-width:160px;max-width:260px}
    #${PAGE} button{background:#2563eb;color:#fff;border:0;cursor:pointer}#${PAGE} button.secondary{background:#e2e8f0;color:#334155}#${PAGE} button:disabled{opacity:.5}
    #${PAGE} .sa-cards{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:10px;margin-bottom:14px}
    #${PAGE} .sa-card,#${PAGE} .sa-panel{background:hsl(var(--card,0 0 100%));border:1px solid hsl(var(--border,214 32% 91%));border-radius:12px;padding:16px;min-width:0}
    #${PAGE} .sa-panel{box-shadow:0 1px 2px rgba(15,23,42,.025)}
    #${PAGE} .sa-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
    #${PAGE} .sa-panel-head h2{margin:0}
    #${PAGE} .sa-card b{display:block;font-size:21px;margin-top:5px}#${PAGE} .sa-small{font-size:11px;color:#64748b}
    #${PAGE} .sa-analysis-cards{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:12px;margin-bottom:14px}
    #${PAGE} .sa-analysis-card{padding:18px 20px}#${PAGE} .sa-analysis-card b{font-size:23px}
    #${PAGE} .sa-analysis-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
    #${PAGE} .sa-analysis-controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
    #${PAGE} .sa-segment{display:inline-flex;padding:3px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px}
    #${PAGE} .sa-segment button{padding:4px 8px;background:transparent;color:#64748b;font-size:11px}
    #${PAGE} .sa-segment button.active{background:#fff;color:#1d4ed8;box-shadow:0 1px 3px rgba(15,23,42,.1)}
    #${PAGE} .sa-stack{display:flex;height:28px;overflow:hidden;border-radius:7px;background:#f1f5f9;margin:18px 0 16px}
    #${PAGE} .sa-stack span{display:block;height:100%;min-width:2px;opacity:.9}
    #${PAGE} .sa-analysis-row{display:grid;grid-template-columns:minmax(150px,1fr) minmax(110px,1.25fr) 76px 150px 104px;align-items:center;gap:14px;padding:11px 8px;border-top:1px solid #eef2f7;border-radius:7px}
    #${PAGE} .sa-analysis-row:hover{background:#f8fafc}
    #${PAGE} .sa-service-name{display:flex;align-items:center;gap:10px;min-width:0}
    #${PAGE} .sa-service-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 32px;height:32px;border-radius:50%;color:#fff;font-size:10px;font-weight:800}
    #${PAGE} .sa-service-label{display:block;font-size:13px;font-weight:600;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #${PAGE} .sa-track{height:4px;background:#f1f5f9;border-radius:999px;overflow:hidden}
    #${PAGE} .sa-track span{display:block;height:100%;border-radius:inherit}
    #${PAGE} .sa-share{font-weight:700;text-align:right;color:#0f172a}
    #${PAGE} .sa-transfer{font-size:11px;color:#64748b;text-align:right;white-space:nowrap}
    #${PAGE} .sa-record-title{display:flex;align-items:center;gap:8px}
    #${PAGE} .sa-live{display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;box-shadow:0 0 0 3px #d1fae5}
    #${PAGE} .sa-destination{color:#2563eb;font-weight:600}
    #${PAGE} .sa-protocol{display:inline-flex;align-items:center;justify-content:center;min-width:38px;padding:2px 6px;border-radius:5px;background:#eef4ff;color:#2563eb;font-size:9px;font-weight:800;letter-spacing:.04em}
    #${PAGE} .sa-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
    #${PAGE} .sa-table-wrap{width:100%;overflow-x:auto}
    #${PAGE} table{width:100%;border-collapse:collapse;font-size:11.5px}#${PAGE} th,#${PAGE} td{padding:8px 6px;border-bottom:1px solid #eef2f7;text-align:left;vertical-align:top}
    #${PAGE} th{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
    #${PAGE} code{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#334155;word-break:break-all}
    #${PAGE} .sa-badge{display:inline-block;padding:1px 6px;border-radius:999px;background:#e2e8f0;color:#334155;font-size:10px;font-weight:600}
    #${PAGE} .sa-badge.block{background:#fee2e2;color:#b91c1c}#${PAGE} .sa-badge.route{background:#dcfce7;color:#15803d}
    #${PAGE} .sa-badge.healthy{background:#dcfce7;color:#15803d}#${PAGE} .sa-badge.delayed{background:#fef3c7;color:#b45309}
    #${PAGE} .sa-badge.stale,#${PAGE} .sa-badge.no_events{background:#fee2e2;color:#b91c1c}
    #${PAGE} .sa-error{color:#dc2626;font-size:11.5px;white-space:pre-wrap}#${PAGE} .sa-status{color:#15803d;font-size:11.5px}
    #${PAGE} .sa-pager{display:flex;justify-content:space-between;align-items:center;margin-top:10px}
    #${PAGE} .sa-user-link{border:0;background:none;color:#2563eb;padding:0;cursor:pointer}
    #${PAGE} .sa-note{margin-top:14px;padding:12px 14px;border-radius:9px;background:#eff6ff;color:#1e3a8a;font-size:11.5px;line-height:1.65}
    #${PAGE} .sa-warning{background:#fff7ed;color:#9a3412}
    @media(max-width:1000px){#${PAGE} .sa-cards,#${PAGE} .sa-analysis-cards{grid-template-columns:1fr 1fr}#${PAGE} .sa-grid{grid-template-columns:1fr}#${PAGE} .sa-analysis-row{grid-template-columns:minmax(130px,1fr) minmax(90px,1fr) 64px 110px}}
    @media(max-width:680px){#${PAGE} .sa-head{align-items:stretch;flex-direction:column}#${PAGE} .sa-head-actions{justify-content:flex-start}#${PAGE} .sa-analysis-row{grid-template-columns:1fr 72px}#${PAGE} .sa-analysis-row .sa-track,#${PAGE} .sa-analysis-row .sa-transfer{display:none}}
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
          <div class="sa-head-actions">
            <div class="sa-range-tabs" aria-label="审计时间范围">
              <button type="button" data-sa-range-value="1h">最近 1 小时</button>
              <button type="button" data-sa-range-value="6h">最近 6 小时</button>
              <button type="button" data-sa-range-value="24h" class="active">最近 24 小时</button>
              <button type="button" data-sa-range-value="7d">最近 7 天</button>
              <button type="button" data-sa-range-value="14d">最近 14 天</button>
            </div>
            <select id="sa-range" class="sa-range-native" aria-label="审计时间范围"><option value="1h">1 小时</option><option value="6h">6 小时</option><option value="24h" selected>24 小时</option><option value="7d">7 天</option><option value="14d">14 天</option></select>
            <button type="button" class="secondary" data-sa-refresh>刷新</button>
          </div>
        </header>
        <div class="sa-toolbar" data-sa-filter-toolbar>
          <select id="sa-user-id" aria-label="按用户筛选"><option value="">全部用户</option></select>
          <select id="sa-node-id" aria-label="按节点筛选"><option value="">全部节点</option></select>
          <input id="sa-destination" name="audit_destination_search" autocomplete="off" autocapitalize="none" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="域名或 IP">
          <select id="sa-action"><option value="">全部动作</option><option value="block">阻止</option><option value="reject">内核拒绝</option><option value="direct">直连</option><option value="route">路由</option><option value="hijack-dns">DNS</option></select>
          <button class="secondary" data-sa-clear>清除筛选</button>
          <span id="sa-message" class="sa-small"></span>
        </div>
        <section data-sa-panel="overview">
          <div id="sa-cards" class="sa-cards"></div>
          <div class="sa-grid">
            <section class="sa-panel"><h2>热门目标</h2><div id="sa-destinations" class="sa-small">正在加载…</div></section>
            <section class="sa-panel"><h2>节点分布</h2><div id="sa-nodes" class="sa-small">正在加载…</div></section>
          </div>
          <section class="sa-panel" style="margin-bottom:14px">
            <div class="sa-panel-head"><div><h2>审计覆盖与健康度</h2><p>按所选时间范围检查节点最近上报、用户关联率和规则标识完整率。此面板不受用户、目标或动作筛选影响。</p></div><span id="sa-health-summary" class="sa-small"></span></div>
            <div id="sa-health" class="sa-small">正在加载…</div>
          </section>
          <div class="sa-note">顶部流量和用户/节点流量来自 Xboard 平台统计，包含 Xray 与 sing-box；热门目标、规则和出站来自审计事件。需要定位具体连接时，请使用左侧对应小分类。</div>
        </section>
        <section data-sa-panel="analysis" hidden>
          <div id="sa-analysis-cards" class="sa-analysis-cards"></div>
          <section class="sa-panel">
            <div class="sa-analysis-head">
              <div><h2>流量分布</h2><p>按服务或目标地址汇总当前时间范围内的上传、下载与连接数。</p></div>
              <div class="sa-analysis-controls">
                <div class="sa-segment">
                  <button type="button" data-sa-analysis-dimension="service" class="active">服务</button>
                  <button type="button" data-sa-analysis-dimension="destination">目标地址</button>
                </div>
                <div class="sa-segment">
                  <button type="button" data-sa-analysis-sort="bytes" class="active">流量</button>
                  <button type="button" data-sa-analysis-sort="connections">连接数</button>
                </div>
              </div>
            </div>
            <div id="sa-analysis-stack" class="sa-stack"></div>
            <div id="sa-analysis-rows" class="sa-small">正在加载…</div>
            <div class="sa-toolbar" style="margin:10px 0 0"><button type="button" class="secondary" data-sa-analysis-more>显示更多</button><span id="sa-analysis-total" class="sa-small"></span></div>
          </section>
          <div class="sa-note">服务分类根据目标域名归并；无法识别的目标会进入“其他”。切换到“目标地址”可查看具体域名或 IP。百分比和流量均来自审计连接字节。</div>
        </section>
        <section data-sa-panel="traffic" hidden>
          <section class="sa-panel">
            <div class="sa-panel-head"><div class="sa-record-title"><span class="sa-live"></span><h2>流量审计记录</h2></div><span id="sa-event-count" class="sa-small"></span></div>
            <div id="sa-events" class="sa-small">正在加载…</div>
            <div class="sa-pager"><span class="sa-small" id="sa-page-info"></span><div><button class="secondary" data-sa-prev>上一页</button> <button class="secondary" data-sa-next>下一页</button></div></div>
          </section>
          <div class="sa-note">记录按连接结束或字节增量实时更新。同一连接的身份起点和后续字节事件共享连接 ID，连接数统计会自动去重。</div>
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

  const percent = (value) => value == null ? '-' : `${Number(value).toFixed(1)}%`;

  const renderHealth = () => {
    const el = adapter.get('sa-health');
    const summaryEl = adapter.get('sa-health-summary');
    const health = state.overview?.health || {};
    const rows = health.nodes || [];
    const summary = health.summary || {};
    if (summaryEl) {
      summaryEl.textContent = `${Number(summary.nodes || 0)} 个节点 · 正常 ${Number(summary.healthy || 0)} · 延迟 ${Number(summary.delayed || 0)} · 无事件 ${Number(summary.no_events || 0)} · 用户关联 ${percent(summary.user_link_rate)}`;
    }
    if (!el) return;
    el.innerHTML = rows.length ? `<div class="sa-table-wrap"><table><thead><tr><th>节点</th><th>状态</th><th>最近事件</th><th>连接</th><th>用户关联</th><th>规则标识</th><th>审计流量</th></tr></thead><tbody>${rows.map((row) => `
      <tr><td><b>${esc(row.node_name || `节点 #${row.node_id}`)}</b><br><span class="sa-small">#${esc(row.node_id)} · ${esc(row.protocol || '-')}</span></td>
      <td><span class="sa-badge ${esc(row.health_status || 'no_events')}">${esc(row.health_label || '-')}</span></td>
      <td>${time(row.last_event_at)}</td>
      <td>${Number(row.connections || 0).toLocaleString()}<br><span class="sa-small">${Number(row.unlinked_connections || 0)} 未关联</span></td>
      <td>${percent(row.user_link_rate)}<br><span class="sa-small">${Number(row.linked_connections || 0)}/${Number(row.connections || 0)}</span></td>
      <td>${percent(row.route_identity_rate)}<br><span class="sa-small">${Number(row.route_missing_connections || 0)} 未标识</span></td>
      <td>${bytes(Number(row.upload_bytes || 0) + Number(row.download_bytes || 0))}</td></tr>`).join('')}</tbody></table></div>`
      : '<p>所选时间范围内没有可检查的启用节点。</p>';
  };

  const safeColor = (value) => /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? value : '#64748b';

  const renderAnalysis = () => {
    const analysis = state.analysis || {};
    const cards = analysis.cards || {};
    const cardsEl = adapter.get('sa-analysis-cards');
    if (cardsEl) {
      cardsEl.innerHTML = [
        ['上传', bytes(cards.upload_bytes)],
        ['下载', bytes(cards.download_bytes)],
        ['总流量', bytes(cards.total_bytes)],
        ['连接数', Number(cards.connections || 0).toLocaleString()],
      ].map(([label, value]) => `<div class="sa-card sa-analysis-card"><span class="sa-small">${label}</span><b>${value}</b></div>`).join('');
    }

    const rows = analysis.rows || [];
    const stack = adapter.get('sa-analysis-stack');
    if (stack) {
      stack.innerHTML = rows.map((row) => `<span title="${esc(row.name || '-')}" style="width:${Math.max(0, Number(row.share || 0))}%;background:${safeColor(row.color)}"></span>`).join('');
    }
    const visibleRows = rows.slice(0, Number(state.analysisRowsLimit || 8));
    const rowsEl = adapter.get('sa-analysis-rows');
    if (rowsEl) {
      rowsEl.innerHTML = visibleRows.length ? visibleRows.map((row) => `
        <div class="sa-analysis-row">
          <div class="sa-service-name"><span class="sa-service-icon" style="background:${safeColor(row.color)}">${esc(row.short || String(row.name || '?').slice(0, 2))}</span><span class="sa-service-label" title="${esc(row.name || '-')}">${esc(row.name || '-')}</span></div>
          <div class="sa-track"><span style="width:${Math.min(100, Math.max(Number(row.share || 0), Number(row.share || 0) > 0 ? 1 : 0))}%;background:${safeColor(row.color)}"></span></div>
          <div class="sa-share">${Number(row.share || 0).toFixed(1)}%</div>
          <div class="sa-transfer">↑ ${bytes(row.upload_bytes)}　↓ ${bytes(row.download_bytes)}</div>
          <div class="sa-transfer">${Number(row.connections || 0).toLocaleString()} 个连接</div>
        </div>`).join('') : '<p>当前时间范围内没有可分析的连接目标。</p>';
    }
    const total = adapter.get('sa-analysis-total');
    if (total) total.textContent = `按${analysis.dimension === 'destination' ? '目标地址' : '服务'}分组，共 ${rows.length} 项`;
    const more = adapter.page()?.querySelector('[data-sa-analysis-more]');
    if (more) {
      more.hidden = rows.length <= visibleRows.length;
      more.textContent = state.analysisRowsLimit >= rows.length ? '已显示全部' : '显示更多';
    }

    adapter.page()?.querySelectorAll('[data-sa-analysis-dimension]').forEach((button) => {
      button.classList.toggle('active', button.dataset.saAnalysisDimension === state.analysisDimension);
    });
    adapter.page()?.querySelectorAll('[data-sa-analysis-sort]').forEach((button) => {
      button.classList.toggle('active', button.dataset.saAnalysisSort === state.analysisSort);
    });
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
    const protocolLabel = (row) => {
      const protocol = String(row.protocol || '').toLowerCase();
      const destination = String(row.destination || '');
      if (protocol.includes('tls') || destination.endsWith(':443')) return 'TLS';
      if (protocol.includes('http') || destination.endsWith(':80')) return 'HTTP';
      if (String(row.network || '').toLowerCase() === 'udp') return 'UDP';
      return 'NET';
    };
    el.innerHTML = state.events.length ? `<div class="sa-table-wrap"><table><thead><tr><th>协议</th><th>来源 / 用户</th><th>节点</th><th>目标地址</th><th>规则 / 出站</th><th>流量</th><th>时间</th></tr></thead><tbody>${state.events.map((row) => `
      <tr><td><span class="sa-protocol">${protocolLabel(row)}</span></td>
      <td><code>${esc(row.client_source || row.source_ip || '-')}</code><br>${row.user_id ? `<button class="sa-user-link" data-sa-user="${row.user_id}">${esc(row.user_name || `用户 #${row.user_id}`)}</button>` : '<span class="sa-small">未关联用户</span>'}</td>
      <td>${esc(row.node_id || '-')}</td>
      <td><span class="sa-destination">${esc(row.destination || row.destination_ip || '-')}</span><br><span class="sa-small">${esc(row.network || '')}</span></td>
      <td>${esc(row.route_name || row.route_tag || '默认路由')}<br><span class="sa-badge ${row.action === 'block' || row.action === 'reject' ? 'block' : 'route'}">${esc(row.action)}</span> ${row.outbound ? `<code>${esc(row.outbound)}</code>` : ''}</td>
      <td>↑ ${bytes(row.upload_bytes)}<br>↓ ${bytes(row.download_bytes)}</td>
      <td>${time(row.occurred_at)}</td></tr>`).join('')}</tbody></table></div>`
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
    renderHealth();
    renderAnalysis();
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
  root.view = Object.freeze({ css, html, renderAll, renderAnalysis, renderEvents, renderSettings, showMessage });
})();
