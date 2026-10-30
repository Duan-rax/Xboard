/* Structured route page template and render functions. */
(() => {
  'use strict';

  const adapter = globalThis.XboardRouteAdapter;
  const root = globalThis.XboardRouteAdmin = globalThis.XboardRouteAdmin || {};
  if (!adapter || !root.state || !root.form || !root.diagnostics) {
    throw new Error('route state/form/diagnostics modules must load before route-admin-view.js');
  }

  const state = root.state;
  const PAGE_ID = root.PAGE_ID;
  const esc = root.esc;

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

  const showBindMessage = (message, error = false) => {
    const element = adapter.get('xe-bind-message');
    if (!element) return;
    element.className = error ? 'xe-error' : 'xe-message';
    element.textContent = message;
  };

  const renderList = () => {
    const list = adapter.get('xe-list');
    if (!list) return;
    root.diagnostics.renderSummary();
    const items = state.routes.filter(root.form.matchesSearch);
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
                ${root.diagnostics.renderBadges(route)}
              </td>
              <td class="xe-mono">${esc(root.diagnostics.criteriaSummary(route))}</td>
              <td>${esc(root.form.actionLabel(route))}</td>
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

  root.showMessage = showMessage;
  root.view = Object.freeze({
    css,
    pageHtml,
    renderBindingNodes,
    renderList,
    renderTargets,
    showBindMessage,
    showMessage,
  });
})();
