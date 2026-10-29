/*
 * Xboard egress-management extension.
 *
 * The distributed admin SPA is a built artifact, so this file augments it at
 * runtime instead of requiring its React sources. The sidebar entry is placed
 * directly below "节点管理" (the /server/manage leaf) inside the same group.
 *
 * The admin SPA stores its Sanctum token in localStorage as
 * "Xboard_access_token" (a JSON wrapper written by its storage helper). Older
 * builds used other names, so the lookup keeps fallbacks.
 */
(() => {
  'use strict';

  const MENU_ID = 'xboard-egress-management-menu';
  const MODAL_ID = 'xboard-egress-management-modal';
  const BIND_MODAL_ID = 'xboard-egress-binding-modal';
  const STYLE_ID = 'xboard-egress-style';
  const MENU_LABEL = '出站管理';
  const MENU_ICON = `
    <svg class="xe-menu-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="8" height="16" rx="2"></rect>
      <path d="M6 8h2M6 12h2M6 16h2"></path>
      <path d="M13 12h7"></path>
      <path d="m17 8 4 4-4 4"></path>
    </svg>`;

  const state = {
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
    pageHost: null,
    hiddenHostChildren: [],
    menuLink: null,
    busy: false,
  };

  const settings = () => (typeof window !== 'undefined' && window.settings) || {};
  const securePath = () => String(settings().secure_path || '').replace(/^\/+|\/+$/g, '');
  const apiRoot = () => `/api/v2/${securePath()}`.replace(/\/$/, '');
  const apiBase = () => `${apiRoot()}/server/egress`;

  const parseStoredToken = (raw) => {
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string') return parsed.trim();
      if (parsed && typeof parsed === 'object') {
        return String(parsed.value || parsed.token || parsed.access_token || '').trim();
      }
      return String(raw).trim();
    } catch (_) {
      return String(raw).trim();
    }
  };

  const authToken = () => {
    const keys = ['Xboard_access_token', 'Vue_Naive_access_token', 'access_token'];
    try {
      for (const key of keys) {
        const value = parseStoredToken(localStorage.getItem(key));
        if (value) return value;
      }
      const length = Number(localStorage.length) || 0;
      for (let i = 0; i < length; i += 1) {
        const key = localStorage.key(i) || '';
        if (!/access_token$/i.test(key)) continue;
        const value = parseStoredToken(localStorage.getItem(key));
        if (value) return value;
      }
    } catch (_) {
      // localStorage can be unavailable in hardened browsers.
    }
    return '';
  };

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));

  const request = async (url, options = {}) => {
    const token = authToken();
    const authorization = token && !/^Bearer\s/i.test(token) ? `Bearer ${token}` : token;
    const headers = {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(authorization ? { Authorization: authorization } : {}),
    };
    let response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch (_) {
      throw new Error('网络请求失败，请检查面板连接。');
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      // Non-JSON error page (proxy, 500, secure-path mismatch).
    }
    if (!response.ok || !payload || payload.status === 'fail') {
      const message = (payload && payload.message) || `请求失败（HTTP ${response.status}）`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload.data;
  };

  const api = (path, method = 'GET', body) => request(`${apiBase()}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const protocolLabels = {
    socks5: 'SOCKS5',
    http: 'HTTP/HTTPS',
    shadowsocks: 'Shadowsocks',
    vless: 'VLESS',
    trojan: 'Trojan',
  };
  const protocolLabel = (protocol) => protocolLabels[protocol] || protocol;

  const protocolHints = {
    socks5: 'SOCKS5：填写地址和端口；需要认证时再填用户名/密码。高级 JSON 保持 {}。',
    http: 'HTTP/HTTPS 代理：可选用户名/密码；勾选 TLS 后可填写 SNI。高级 JSON 保持 {}。',
    shadowsocks: 'Shadowsocks：必须填写密码。高级 JSON 示例 {"method":"aes-256-gcm"}。',
    vless: 'VLESS：高级 JSON 必须包含 uuid。Reality 另加 reality.public_key 与 reality.short_id，并填写 TLS SNI。',
    trojan: 'Trojan：必须填写密码。高级 JSON 保持 {}。',
  };
  const protocolTemplates = {
    socks5: '{}',
    http: '{}',
    shadowsocks: '{\n  "method": "aes-256-gcm"\n}',
    vless: '{\n  "uuid": "",\n  "flow": "xtls-rprx-vision",\n  "network": "tcp"\n}',
    trojan: '{}',
  };

  const formatTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  };

  const css = `
    #${MODAL_ID}{display:none;height:100%;overflow:auto;background:hsl(var(--background,0 0% 100%));color:hsl(var(--foreground,222.2 84% 4.9%));font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    #${MODAL_ID}.open{display:block}
    #${MODAL_ID} .xe-page-shell{max-width:1440px;margin:0 auto;padding:28px clamp(20px,3vw,40px) 40px}
    #${MODAL_ID} .xe-page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px}
    #${MODAL_ID} h1,#${BIND_MODAL_ID} h2{margin:0;font-size:26px;line-height:1.25;font-weight:700}
    #${MODAL_ID} p,#${BIND_MODAL_ID} p{margin:6px 0 0;color:#64748b;font-size:12.5px;line-height:1.6}
    #${MODAL_ID} > .xe-page-shell > .xe-main{display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,1.35fr);gap:18px}
    #${MODAL_ID}.xe-binding > .xe-page-shell > .xe-main{display:none}
    #${MODAL_ID} .xe-panel,#${BIND_MODAL_ID}{background:hsl(var(--card,0 0% 100%));border:1px solid hsl(var(--border,214 32% 91%));border-radius:12px;padding:18px;min-width:0;color:hsl(var(--card-foreground,222.2 84% 4.9%))}
    #${MODAL_ID} .xe-panel h3,#${BIND_MODAL_ID} h3{margin:0 0 10px;font-size:14px}
    #${MODAL_ID} label{display:block;margin:9px 0 4px;color:#475569;font-size:12px;font-weight:600}
    #${MODAL_ID} input,#${MODAL_ID} select,#${MODAL_ID} textarea,#${BIND_MODAL_ID} input,#${BIND_MODAL_ID} select{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#0f172a;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
    #${MODAL_ID} textarea{min-height:96px;resize:vertical}
    #${MODAL_ID} .xe-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    #${MODAL_ID} .xe-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;align-items:center}
    #${MODAL_ID} button,#${BIND_MODAL_ID} button{border:0;border-radius:7px;padding:8px 11px;background:#2563eb;color:#fff;cursor:pointer;font-size:13px;line-height:1.2}
    #${MODAL_ID} button.xe-secondary,#${BIND_MODAL_ID} button.xe-secondary{background:#e2e8f0;color:#334155}
    #${MODAL_ID} button.xe-danger,#${BIND_MODAL_ID} button.xe-danger{background:#dc2626}
    #${MODAL_ID} button:disabled,#${BIND_MODAL_ID} button:disabled{opacity:.5;cursor:not-allowed}
    #${MODAL_ID} table{width:100%;border-collapse:collapse;font-size:12.5px}
    #${MODAL_ID} th,#${MODAL_ID} td{text-align:left;padding:9px 7px;border-bottom:1px solid #eef2f7;vertical-align:middle}
    #${MODAL_ID} th{color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em}
    #${MODAL_ID} .xe-small,#${BIND_MODAL_ID} .xe-small{font-size:11px;color:#64748b;line-height:1.5}
    #${MODAL_ID} .xe-name{font-weight:600;color:#0f172a}
    #${MODAL_ID} .xe-code{font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#334155}
    #${MODAL_ID} .xe-status{color:#16a34a;font-size:12px}
    #${MODAL_ID} .xe-error,#${BIND_MODAL_ID} .xe-error{color:#dc2626;font-size:12px;white-space:pre-wrap}
    #${MODAL_ID} .xe-row-actions{display:flex;gap:6px;flex-wrap:wrap}
    #${MODAL_ID} .xe-toolbar,#${BIND_MODAL_ID} .xe-toolbar{display:flex;gap:8px;align-items:center;margin:8px 0 10px;flex-wrap:wrap}
    #${MODAL_ID} .xe-toolbar input{flex:1;min-width:160px}
    #${MODAL_ID} .xe-pager,#${BIND_MODAL_ID} .xe-pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:10px;flex-wrap:wrap}
    #${MODAL_ID} .xe-pager span,#${BIND_MODAL_ID} .xe-pager span{margin-right:auto}
    #${MODAL_ID} .xe-badge,#${BIND_MODAL_ID} .xe-badge{display:inline-block;padding:1px 6px;border-radius:999px;background:#e2e8f0;color:#334155;font-size:10.5px;font-weight:600;vertical-align:middle}
    #${MODAL_ID} .xe-badge.xe-on{background:#dcfce7;color:#15803d}
    #${MODAL_ID} .xe-badge.xe-off{background:#fee2e2;color:#b91c1c}
    #${MODAL_ID} .xe-badge.xe-tls{background:#dbeafe;color:#1d4ed8}
    #${MODAL_ID} .xe-bind-panel{display:none}
    #${BIND_MODAL_ID}{display:none;margin-top:18px}
    #${BIND_MODAL_ID}.open{display:block}
    #${BIND_MODAL_ID} .xe-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:16px;border-bottom:1px solid hsl(var(--border,214 32% 91%))}
    #${BIND_MODAL_ID} .xe-main{padding:16px 0 20px}
    #${BIND_MODAL_ID} .xe-badge.xe-bound{background:#fef3c7;color:#92400e;margin-left:6px}
    #${BIND_MODAL_ID} .xe-node{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border:1px solid #eef2f7;border-radius:9px;margin-bottom:6px;cursor:pointer;font-weight:400}
    #${BIND_MODAL_ID} .xe-node:hover{background:#f8fafc}
    #${BIND_MODAL_ID} .xe-node input{width:auto;margin-top:4px;flex:none}
    #${BIND_MODAL_ID} .xe-node-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
    #${BIND_MODAL_ID} .xe-node-name{font-size:13px;font-weight:600;color:#0f172a}
    #${BIND_MODAL_ID} .xe-node-side{flex:none;text-align:right}
    #${BIND_MODAL_ID} .xe-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-top:14px;border-top:1px solid hsl(var(--border,214 32% 91%))}
    #${BIND_MODAL_ID} .xe-foot .xe-small{margin-right:auto}
    #${MODAL_ID} .xe-hint{color:#64748b;font-size:11px;line-height:1.55;margin-top:4px}
    #${MENU_ID} a[data-xe-active="true"]{background:hsl(var(--accent,210 40% 96.1%));color:hsl(var(--accent-foreground,222.2 47.4% 11.2%))}
    @media(max-width:900px){#${MODAL_ID} > .xe-page-shell > .xe-main{grid-template-columns:1fr}#${MODAL_ID} .xe-page-shell{padding:22px 16px 32px}}
  `;

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  };

  const mainModalHtml = () => `
    <section id="${MODAL_ID}" aria-hidden="true">
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

  const bindModalHtml = () => `
    <section id="${BIND_MODAL_ID}" class="xe-bind-panel" aria-hidden="true">
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

  const mainModal = () => document.getElementById(MODAL_ID);
  const bindModal = () => document.getElementById(BIND_MODAL_ID);
  const setMenuActive = (active) => {
    state.menuLink?.setAttribute('data-xe-active', active ? 'true' : 'false');
  };

  const showMessage = (message, error = false) => {
    const el = document.getElementById('xe-message');
    if (!el) return;
    el.className = error ? 'xe-error' : 'xe-status';
    el.textContent = message;
  };

  const showBindMessage = (message, error = false) => {
    const el = document.getElementById('xe-bind-message');
    if (!el) return;
    el.className = error ? 'xe-error' : 'xe-small';
    el.textContent = message;
  };

  const checked = (id) => Boolean(document.getElementById(id)?.checked);
  const valueOf = (id) => (document.getElementById(id)?.value || '').trim();
  const rawValueOf = (id) => document.getElementById(id)?.value || '';

  const readForm = () => {
    const configText = valueOf('xe-config') || '{}';
    let config;
    try {
      config = JSON.parse(configText);
    } catch (_) {
      throw new Error('高级 JSON 格式不正确');
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('高级 JSON 必须是对象，例如 {}');
    }

    const body = {
      name: valueOf('xe-name'),
      protocol: valueOf('xe-protocol'),
      host: valueOf('xe-host'),
      port: Number(valueOf('xe-port')),
      tls_enabled: checked('xe-tls'),
      tls_server_name: valueOf('xe-sni') || null,
      allow_insecure: checked('xe-insecure'),
      enabled: checked('xe-enabled'),
      config,
      clear_username: checked('xe-clear-username'),
      clear_password: checked('xe-clear-password'),
    };
    if (!body.name) throw new Error('请填写名称');
    if (!body.host) throw new Error('请填写地址');
    if (!Number.isInteger(body.port) || body.port < 1 || body.port > 65535) {
      throw new Error('端口必须是 1-65535 之间的整数');
    }

    const id = valueOf('xe-id');
    if (id) body.id = Number(id);
    const username = valueOf('xe-username');
    const password = rawValueOf('xe-password');
    if (username) body.username = username;
    if (password !== '') body.password = password;
    return body;
  };

  const syncProtocolUi = () => {
    const protocol = valueOf('xe-protocol') || 'socks5';
    const hint = document.getElementById('xe-hint');
    if (hint) hint.textContent = protocolHints[protocol] || '';

    const config = document.getElementById('xe-config');
    if (!config) return;
    const editing = Boolean(valueOf('xe-id'));
    const current = config.value.trim();
    const currentIsTemplate = Object.values(protocolTemplates)
      .some((template) => template.trim() === current);
    if (!editing && (!current || currentIsTemplate)) {
      config.value = protocolTemplates[protocol] || '{}';
    }
  };

  const fillForm = (proxy) => {
    ['id', 'name', 'host', 'port'].forEach((key) => {
      const el = document.getElementById(`xe-${key}`);
      if (el) el.value = proxy[key] ?? '';
    });
    document.getElementById('xe-protocol').value = proxy.protocol;
    document.getElementById('xe-sni').value = proxy.tls_server_name || '';
    document.getElementById('xe-tls').checked = Boolean(proxy.tls_enabled);
    document.getElementById('xe-insecure').checked = Boolean(proxy.allow_insecure);
    document.getElementById('xe-enabled').checked = Boolean(proxy.enabled);
    document.getElementById('xe-config').value = JSON.stringify(proxy.config || {}, null, 2);
    document.getElementById('xe-username').value = '';
    document.getElementById('xe-password').value = '';
    document.getElementById('xe-username').placeholder = proxy.username_configured ? '已保存，留空保持不变' : '可选';
    document.getElementById('xe-password').placeholder = proxy.password_configured ? '已保存，留空保持不变' : '可选';
    document.getElementById('xe-clear-username').checked = false;
    document.getElementById('xe-clear-password').checked = false;
    syncProtocolUi();
    showMessage(`正在编辑 #${proxy.id}；留空用户名/密码会保留原值。`);
  };

  const resetForm = () => {
    ['id', 'name', 'host', 'port', 'sni', 'username', 'password'].forEach((key) => {
      const el = document.getElementById(`xe-${key}`);
      if (el) el.value = '';
    });
    document.getElementById('xe-protocol').value = 'socks5';
    document.getElementById('xe-config').value = '{}';
    document.getElementById('xe-tls').checked = false;
    document.getElementById('xe-insecure').checked = false;
    document.getElementById('xe-enabled').checked = true;
    document.getElementById('xe-clear-username').checked = false;
    document.getElementById('xe-clear-password').checked = false;
    document.getElementById('xe-username').placeholder = '可选';
    document.getElementById('xe-password').placeholder = '可选';
    syncProtocolUi();
    showMessage('');
  };

  const findProxy = (id) => state.proxies.find((proxy) => Number(proxy.id) === Number(id));

  const renderList = async () => {
    const list = document.getElementById('xe-list');
    if (!list) return;
    list.innerHTML = '<p class="xe-small">正在加载…</p>';
    try {
      const query = new URLSearchParams({ page: String(state.page), page_size: '20' });
      const search = valueOf('xe-search');
      if (search) query.set('search', search);
      const result = await api(`/fetch?${query.toString()}`);
      const items = Array.isArray(result) ? result : (result?.items || []);
      const pagination = Array.isArray(result)
        ? { current_page: 1, last_page: 1, total: items.length }
        : (result?.pagination || {});

      state.proxies = items;
      state.page = Number(pagination.current_page || 1);
      state.lastPage = Math.max(1, Number(pagination.last_page || 1));
      state.total = Number(pagination.total || items.length);
      if (state.page > state.lastPage) {
        state.page = state.lastPage;
        await renderList();
        return;
      }

      list.innerHTML = items.length ? `
        <table>
          <thead><tr><th>名称</th><th>类型</th><th>地址</th><th>节点</th><th>操作</th></tr></thead>
          <tbody>
            ${items.map((proxy) => `
              <tr>
                <td>
                  <div class="xe-name">${esc(proxy.name)} ${proxy.enabled ? '<span class="xe-badge xe-on">启用</span>' : '<span class="xe-badge xe-off">停用</span>'}</div>
                  <span class="xe-small">#${proxy.id}${proxy.updated_at ? ` · ${esc(formatTime(proxy.updated_at))}` : ''}</span>
                </td>
                <td>
                  <span class="xe-badge">${esc(protocolLabel(proxy.protocol))}</span>
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

      const pager = document.getElementById('xe-pager');
      if (pager) {
        pager.innerHTML = `
          <span class="xe-small">共 ${state.total} 条 · 第 ${state.page}/${state.lastPage} 页</span>
          <button class="xe-secondary" data-xe-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>上一页</button>
          <button class="xe-secondary" data-xe-page="${state.page + 1}" ${state.page >= state.lastPage ? 'disabled' : ''}>下一页</button>`;
      }
    } catch (error) {
      list.innerHTML = `<p class="xe-error">${esc(error.message)}</p>`;
    }
  };

  const updateBindSelection = () => {
    const count = state.selected.size;
    const countEl = document.getElementById('xe-bind-selected-count');
    if (countEl) countEl.textContent = count ? `已选择 ${count} 个节点` : '未选择节点';

    const pageIds = state.bindNodes.map((node) => Number(node.id));
    const selectedOnPage = pageIds.filter((id) => state.selected.has(id)).length;
    const toggle = document.getElementById('xe-bind-select-page');
    if (toggle) {
      toggle.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
      toggle.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
    }
  };

  const renderBindNodes = (items) => {
    const list = document.getElementById('xe-bind-list');
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

  const loadBindNodes = async () => {
    const list = document.getElementById('xe-bind-list');
    if (!list || !state.bindProxy) return;
    list.innerHTML = '<p>正在加载节点…</p>';
    try {
      const query = new URLSearchParams({
        page: String(state.bindPage),
        page_size: '50',
      });
      const search = valueOf('xe-bind-search');
      if (search) query.set('search', search);
      if (state.bindFilter === 'current') {
        query.set('egress_proxy_id', String(state.bindProxy.id));
      } else if (state.bindFilter === 'bound' || state.bindFilter === 'unbound') {
        query.set('bound', state.bindFilter);
      }

      const result = await api(`/nodes?${query.toString()}`);
      state.bindNodes = Array.isArray(result?.items) ? result.items : [];
      const pagination = result?.pagination || {};
      state.bindPage = Number(pagination.current_page || 1);
      state.bindLastPage = Math.max(1, Number(pagination.last_page || 1));
      state.bindTotal = Number(pagination.total || state.bindNodes.length);
      if (state.bindPage > state.bindLastPage) {
        state.bindPage = state.bindLastPage;
        await loadBindNodes();
        return;
      }
      renderBindNodes(state.bindNodes);

      const pager = document.getElementById('xe-bind-pager');
      if (pager) {
        pager.innerHTML = `
          <span class="xe-small">共 ${state.bindTotal} 个节点 · 第 ${state.bindPage}/${state.bindLastPage} 页</span>
          <button class="xe-secondary" data-xe-bind-page="${state.bindPage - 1}" ${state.bindPage <= 1 ? 'disabled' : ''}>上一页</button>
          <button class="xe-secondary" data-xe-bind-page="${state.bindPage + 1}" ${state.bindPage >= state.bindLastPage ? 'disabled' : ''}>下一页</button>`;
      }
    } catch (error) {
      list.innerHTML = `<p class="xe-error">${esc(error.message)}</p>`;
    }
  };

  const openBind = async (proxyId) => {
    const proxy = findProxy(proxyId);
    if (!proxy) {
      showMessage('找不到该出站配置，请刷新后重试。', true);
      return;
    }
    state.bindProxy = proxy;
    state.bindPage = 1;
    state.bindLastPage = 1;
    state.bindTotal = 0;
    state.bindFilter = 'all';
    state.bindNodes = [];
    state.selected.clear();

    const title = document.getElementById('xe-bind-title');
    if (title) title.textContent = `节点绑定 · ${proxy.name}`;
    const search = document.getElementById('xe-bind-search');
    if (search) search.value = '';
    const filter = document.getElementById('xe-bind-filter');
    if (filter) filter.value = 'all';
    showBindMessage('');

    mainModal()?.classList.add('xe-binding');
    bindModal()?.classList.add('open');
    bindModal()?.setAttribute('aria-hidden', 'false');
    await loadBindNodes();
  };

  const closeBind = () => {
    bindModal()?.classList.remove('open');
    bindModal()?.setAttribute('aria-hidden', 'true');
    mainModal()?.classList.remove('xe-binding');
    state.selected.clear();
    state.bindProxy = null;
  };

  const applySelection = async (proxyId) => {
    if (!state.selected.size) {
      showBindMessage('请至少选择一个节点。', true);
      return;
    }
    if (state.selected.size > 500) {
      showBindMessage('单次最多操作 500 个节点，请分批处理。', true);
      return;
    }
    const ids = [...state.selected];
    const action = proxyId ? '绑定' : '解绑';
    showBindMessage(`正在${action} ${ids.length} 个节点…`);
    try {
      const result = await api('/bind', 'POST', {
        server_ids: ids,
        egress_proxy_id: proxyId,
      });
      state.selected.clear();
      const changed = Number(result?.changed ?? ids.length);
      const confirmed = result?.sync?.confirmed_server_ids?.length || 0;
      const pending = result?.sync?.pending_server_ids?.length || 0;
      if (changed === 0) {
        showBindMessage('所选节点已经是目标状态，无需重载。');
        await Promise.all([loadBindNodes(), renderList()]);
        return;
      }
      const syncMessage = pending
        ? `，${confirmed} 个节点已重载，${pending} 个节点仍在等待配置同步。`
        : '，节点均已确认重载。';
      showBindMessage(`${action}完成，实际更新 ${changed} 个节点${syncMessage}`);
      await Promise.all([loadBindNodes(), renderList()]);
    } catch (error) {
      showBindMessage(error.message, true);
    }
  };

  const unbindEveryNode = async () => {
    if (!state.bindProxy) return;
    if (!confirm(`确定解绑“${state.bindProxy.name}”的全部节点吗？`)) return;
    showBindMessage('正在解绑全部节点…');
    try {
      const result = await api('/unbind-all', 'POST', {
        egress_proxy_id: Number(state.bindProxy.id),
      });
      const changed = Number(result?.changed ?? 0);
      const pending = result?.sync?.pending_server_ids?.length || 0;
      showBindMessage(
        changed === 0
          ? '当前没有需要解绑的节点。'
          : `已解绑 ${changed} 个节点。${pending ? `${pending} 个节点仍待确认重载。` : '节点均已确认重载。'}`
      );
      state.selected.clear();
      await Promise.all([loadBindNodes(), renderList()]);
    } catch (error) {
      showBindMessage(error.message, true);
    }
  };

  const handleMainClick = async (event) => {
    const modal = mainModal();
    if (!modal) return;
    if (event.target.closest('[data-xe-close]')) {
      closeMainPage();
      return;
    }
    if (event.target.closest('[data-xe-reset]')) {
      resetForm();
      return;
    }
    if (event.target.closest('[data-xe-search]')) {
      state.page = 1;
      await renderList();
      return;
    }
    if (event.target.closest('[data-xe-refresh]')) {
      await renderList();
      return;
    }

    const page = event.target.closest('[data-xe-page]');
    if (page && !page.disabled) {
      state.page = Number(page.dataset.xePage);
      await renderList();
      return;
    }

    if (event.target.closest('[data-xe-save]')) {
      const button = event.target.closest('[data-xe-save]');
      button.disabled = true;
      showMessage('正在保存…');
      try {
        const saved = await api('/save', 'POST', readForm());
        document.getElementById('xe-id').value = saved.id;
        fillForm(saved);
        showMessage(`已保存 ${saved.name}；绑定节点将在下一轮配置同步时生效。`);
        await renderList();
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
      return;
    }

    const edit = event.target.closest('[data-xe-edit]');
    if (edit) {
      const proxy = findProxy(edit.dataset.xeEdit);
      if (proxy) fillForm(proxy);
      return;
    }

    const bind = event.target.closest('[data-xe-bind-nodes]');
    if (bind) {
      await openBind(bind.dataset.xeBindNodes);
      return;
    }

    const test = event.target.closest('[data-xe-test]');
    if (test) {
      test.disabled = true;
      showMessage('正在通过真实代理请求测试目标…');
      try {
        const result = await api('/test', 'POST', { id: Number(test.dataset.xeTest) });
        showMessage(result?.message || (result?.ok ? '端口可达。' : '无法连接。'), !result?.ok);
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        test.disabled = false;
      }
      return;
    }

    const remove = event.target.closest('[data-xe-delete]');
    if (remove && !remove.disabled && confirm('确定删除此出站配置吗？')) {
      try {
        await api('/drop', 'POST', { id: Number(remove.dataset.xeDelete) });
        showMessage('已删除。');
        await renderList();
      } catch (error) {
        showMessage(error.message, true);
      }
    }
  };

  const handleBindChange = (event) => {
    if (event.target.id === 'xe-bind-select-page') {
      const ids = state.bindNodes.map((node) => Number(node.id));
      ids.forEach((id) => {
        if (event.target.checked) state.selected.add(id);
        else state.selected.delete(id);
      });
      document.querySelectorAll('[data-xe-node]').forEach((input) => {
        if (ids.includes(Number(input.dataset.xeNode))) input.checked = event.target.checked;
      });
      updateBindSelection();
      return;
    }
    const node = event.target.closest('[data-xe-node]');
    if (!node) return;
    const id = Number(node.dataset.xeNode);
    if (node.checked) state.selected.add(id);
    else state.selected.delete(id);
    updateBindSelection();
  };

  const handleBindClick = async (event) => {
    const modal = bindModal();
    if (!modal) return;
    if (event.target.closest('[data-xe-bind-close]')) {
      closeBind();
      return;
    }
    if (event.target.closest('[data-xe-bind-search]')) {
      state.bindPage = 1;
      await loadBindNodes();
      return;
    }
    if (event.target.closest('[data-xe-bind-refresh]')) {
      await loadBindNodes();
      return;
    }
    const page = event.target.closest('[data-xe-bind-page]');
    if (page && !page.disabled) {
      state.bindPage = Number(page.dataset.xeBindPage);
      await loadBindNodes();
      return;
    }
    if (event.target.closest('[data-xe-bind-selected]')) {
      await applySelection(Number(state.bindProxy?.id || 0));
      return;
    }
    if (event.target.closest('[data-xe-unbind-selected]')) {
      await applySelection(0);
      return;
    }
    if (event.target.closest('[data-xe-unbind-all]')) {
      await unbindEveryNode();
    }
  };

  const ensureMainModal = () => {
    let page = mainModal();
    if (page) return page;
    const host = document.getElementById('content') || document.querySelector('main');
    if (!host) return null;

    state.pageHost = host;
    state.hiddenHostChildren = [];
    [...host.children].forEach((child) => {
      state.hiddenHostChildren.push({ element: child, display: child.style.display });
      child.style.display = 'none';
    });
    host.insertAdjacentHTML('beforeend', mainModalHtml());
    page = mainModal();
    if (!page) return null;
    page.addEventListener('click', handleMainClick);
    const search = document.getElementById('xe-search');
    search?.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        state.page = 1;
        await renderList();
      }
    });
    document.getElementById('xe-protocol')?.addEventListener('change', syncProtocolUi);
    return page;
  };

  const ensureBindModal = () => {
    let modal = bindModal();
    if (modal) return modal;
    const slot = document.getElementById('xe-bind-slot');
    if (!slot) return null;
    slot.insertAdjacentHTML('beforeend', bindModalHtml());
    modal = bindModal();
    if (!modal) return null;
    modal.addEventListener('click', handleBindClick);
    modal.addEventListener('change', handleBindChange);
    const search = document.getElementById('xe-bind-search');
    search?.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        state.bindPage = 1;
        await loadBindNodes();
      }
    });
    document.getElementById('xe-bind-filter')?.addEventListener('change', async (event) => {
      state.bindFilter = event.target.value;
      state.bindPage = 1;
      state.selected.clear();
      await loadBindNodes();
    });
    return modal;
  };

  const closeMainPage = () => {
    setMenuActive(false);
    const page = mainModal();
    if (!page) return;
    closeBind();
    page.classList.remove('open');
    page.setAttribute('aria-hidden', 'true');
    state.hiddenHostChildren.forEach(({ element, display }) => {
      element.style.display = display;
    });
    state.hiddenHostChildren = [];
    state.pageHost = null;
    page.remove();
  };

  const openMain = async () => {
    ensureStyle();
    const page = ensureMainModal();
    if (!page) {
      console.error('无法找到 Xboard 后台主内容区，出站管理页面未加载。');
      return;
    }
    ensureBindModal();
    closeBind();
    resetForm();
    page.classList.add('open');
    page.setAttribute('aria-hidden', 'false');
    setMenuActive(true);
    await renderList();
  };

  const installMenu = () => {
    ensureStyle();
    if (document.getElementById(MENU_ID)) return;

    // Select the actual leaf link, never the top-level "节点管理" group button.
    // The route link is preferred so the new item appears after "路由管理".
    const links = [...document.querySelectorAll('a[href]')];
    const hasPath = (element, path) => {
      const href = element.getAttribute('href') || element.href || '';
      return new RegExp(`/${path}(?:/)?(?:[?#].*)?$`).test(href);
    };
    const anchor = links.find((element) => hasPath(element, 'server/route'))
      || links.find((element) => hasPath(element, 'server/manage'))
      || links.find((element) => ['路由管理', 'Route Management', 'Routes']
        .includes(element.textContent.trim()));
    if (!anchor) return;

    const leafItem = anchor.closest('li') || anchor;
    const item = leafItem.cloneNode(true);
    item.id = MENU_ID;
    const menuLink = item.matches('a') ? item : item.querySelector('a[href]');
    if (!menuLink) return;
    menuLink.setAttribute('href', '#');
    menuLink.removeAttribute('aria-current');
    menuLink.setAttribute('data-xe-active', 'false');
    state.menuLink = menuLink;
    item.removeAttribute('data-state');
    item.querySelectorAll('[data-state]').forEach((element) => {
      element.removeAttribute('data-state');
    });

    // Keep the cloned icon and nested layout; only replace the matching label.
    const labels = new Set([
      '路由管理', 'Route Management', 'Routes',
      '节点管理', 'Node Management', 'Nodes',
    ]);
    const textHosts = [menuLink, ...menuLink.querySelectorAll('*')];
    for (const host of textHosts) {
      const textNode = [...(host.childNodes || [])]
        .find((node) => node.nodeType === 3 && labels.has(node.nodeValue.trim()));
      if (textNode) {
        textNode.nodeValue = MENU_LABEL;
        break;
      }
    }
    const labelElement = [...menuLink.querySelectorAll('*')]
      .reverse()
      .find((element) => labels.has(element.textContent.trim()));
    if (labelElement) labelElement.textContent = MENU_LABEL;
    const iconHost = menuLink.querySelector('div');
    if (iconHost) iconHost.innerHTML = MENU_ICON;

    menuLink.addEventListener('click', (event) => {
      event.preventDefault();
      openMain();
    });
    leafItem.insertAdjacentElement('afterend', item);
  };

  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (!link || link.closest(`#${MENU_ID}`) || link.closest(`#${MODAL_ID}`)) return;
    closeMainPage();
  }, true);
  window.addEventListener('hashchange', closeMainPage);

  new MutationObserver(installMenu).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener('DOMContentLoaded', installMenu);
  setTimeout(installMenu, 1000);
})();
