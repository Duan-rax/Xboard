/*
 * Structured route-management extension.
 *
 * The admin SPA is distributed as a build artifact, so this script augments
 * the existing route page at runtime. It keeps Xboard's native route menu and
 * selected state while providing the v2 structured rule editor in main#content.
 */
(() => {
  'use strict';

  const PAGE_ID = 'xboard-route-v2-page';
  const STYLE_ID = 'xboard-route-v2-style';
  const state = {
    routes: [],
    targets: [],
    pageHost: null,
    hiddenHostChildren: [],
    activeMenuSnapshot: null,
    editingId: 0,
    loading: false,
    search: '',
  };

  const settings = () => (typeof window !== 'undefined' && window.settings) || {};
  const securePath = () => String(settings().secure_path || '').replace(/^\/+|\/+$/g, '');
  const apiBase = () => `/api/v2/${securePath()}/server/route`.replace(/\/+/g, '/');
  const page = () => document.getElementById(PAGE_ID);
  const routeMenuLink = () => [...document.querySelectorAll('a[href]')].find((link) => {
    const href = link.getAttribute('href') || link.href || '';
    return /\/server\/route(?:[/?#]|$)/.test(href);
  });

  const parseStoredToken = (raw) => {
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string') return parsed.trim();
      if (parsed && typeof parsed === 'object') {
        return String(parsed.value || parsed.token || parsed.access_token || '').trim();
      }
    } catch (_) {
      // Plain token.
    }
    return String(raw).trim();
  };

  const authToken = () => {
    for (const key of ['Xboard_access_token', 'Vue_Naive_access_token', 'access_token']) {
      try {
        const token = parseStoredToken(localStorage.getItem(key));
        if (token) return token;
      } catch (_) {
        // localStorage may be unavailable.
      }
    }
    return '';
  };

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));

  const request = async (url, options = {}) => {
    const token = authToken();
    const authorization = token && !/^Bearer\s/i.test(token) ? `Bearer ${token}` : token;
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(authorization ? { Authorization: authorization } : {}),
        },
      });
    } catch (_) {
      throw new Error('网络请求失败，请检查面板连接。');
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      // Non-JSON proxy error.
    }
    if (!response.ok || !payload || payload.status === 'fail') {
      throw new Error(payload?.message || `请求失败（HTTP ${response.status}）`);
    }
    return payload.data;
  };

  const api = (path, method = 'GET', body) => request(`${apiBase()}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

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
    #${PAGE_ID} .xe-row-actions{display:flex;gap:5px;flex-wrap:wrap}
    #${PAGE_ID} .xe-preview{margin-top:12px;padding:10px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;max-height:260px;overflow:auto}
    #${PAGE_ID} .xe-help{font-size:11px;color:#64748b;line-height:1.55;margin-top:4px}
    @media(max-width:980px){#${PAGE_ID} .xe-layout{grid-template-columns:1fr}#${PAGE_ID} .xe-grid3{grid-template-columns:1fr 1fr}}
  `;

  const pageHtml = () => `
    <section id="${PAGE_ID}">
      <div class="xe-shell">
        <header class="xe-head">
          <div>
            <h1>路由管理</h1>
            <p>结构化规则按优先级从小到大执行。旧规则继续兼容；绑定节点的 route_ids 不会改变。</p>
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
            <div id="xe-list">正在加载…</div>
          </section>
        </div>
      </div>
    </section>`;

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  };

  const setMenuActive = (active) => {
    const link = routeMenuLink();
    if (!link) return;
    if (active) {
      const current = [...document.querySelectorAll('nav a[href]')]
        .find((item) => item !== link && item.getAttribute('aria-current') === 'page');
      if (current) {
        state.activeMenuSnapshot = {
          link: current,
          className: current.className,
          ariaCurrent: current.getAttribute('aria-current'),
        };
        link.className = current.className;
        current.classList.remove('bg-secondary');
        current.removeAttribute('aria-current');
      }
      link.setAttribute('aria-current', 'page');
      return;
    }
    link.removeAttribute('aria-current');
    link.classList.remove('bg-secondary');
    if (state.activeMenuSnapshot?.link) {
      state.activeMenuSnapshot.link.className = state.activeMenuSnapshot.className;
      if (state.activeMenuSnapshot.ariaCurrent) {
        state.activeMenuSnapshot.link.setAttribute('aria-current', state.activeMenuSnapshot.ariaCurrent);
      }
    }
    state.activeMenuSnapshot = null;
  };

  const showMessage = (message, error = false) => {
    const element = document.getElementById('xe-message');
    if (!element) return;
    element.className = error ? 'xe-error' : 'xe-message';
    element.textContent = message;
  };

  const values = (id) => (document.getElementById(id)?.value || '').trim();
  const lines = (id) => (document.getElementById(id)?.value || '')
    .split(/[\r\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const emptyCriteria = () => ({
    domains: [],
    domain_suffixes: [],
    ip_cidrs: [],
    ports: [],
    networks: [],
    source_cidrs: [],
    source_ports: [],
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
      ip_cidrs: 'xe-ip-cidrs',
      ports: 'xe-ports',
      networks: 'xe-networks',
      source_cidrs: 'xe-source-cidrs',
      source_ports: 'xe-source-ports',
    };
    for (const [key, id] of Object.entries(map)) {
      const element = document.getElementById(id);
      if (element) element.value = (criteria?.[key] || []).join('\n');
    }
  };

  const resetForm = () => {
    state.editingId = 0;
    document.getElementById('xe-form-title').textContent = '新增规则';
    document.getElementById('xe-id').value = '';
    document.getElementById('xe-remarks').value = '';
    document.getElementById('xe-priority').value = '100';
    document.getElementById('xe-match-mode').value = 'any';
    document.getElementById('xe-enabled').checked = true;
    document.getElementById('xe-action').value = 'direct';
    document.getElementById('xe-target').value = '';
    updateTargetState();
    fillCriteria(emptyCriteria());
    document.getElementById('xe-preview').textContent = '尚未校验。';
    showMessage('');
  };

  const fillForm = (route) => {
    state.editingId = Number(route.id);
    document.getElementById('xe-form-title').textContent = `编辑规则 #${route.id}`;
    document.getElementById('xe-id').value = route.id;
    document.getElementById('xe-remarks').value = route.remarks || '';
    document.getElementById('xe-priority').value = route.priority ?? 100;
    document.getElementById('xe-match-mode').value = route.match_mode || 'any';
    document.getElementById('xe-enabled').checked = route.enabled !== false;
    document.getElementById('xe-action').value = route.action || 'direct';
    document.getElementById('xe-target').value = route.action_value || '';
    updateTargetState();
    fillCriteria(criteriaOf(route));
    document.getElementById('xe-preview').textContent = '正在编辑。点击“校验并预览”查看最终结构。';
    showMessage('');
  };

  const updateTargetState = () => {
    const target = document.getElementById('xe-target');
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
    enabled: Boolean(document.getElementById('xe-enabled')?.checked),
    match: [],
    criteria: {
      domains: lines('xe-domains'),
      domain_suffixes: lines('xe-domain-suffixes'),
      ip_cidrs: lines('xe-ip-cidrs'),
      ports: lines('xe-ports'),
      networks: lines('xe-networks'),
      source_cidrs: lines('xe-source-cidrs'),
      source_ports: lines('xe-source-ports'),
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
    if (criteria.ip_cidrs?.length) parts.push(`IP ${criteria.ip_cidrs.length}`);
    if (criteria.ports?.length) parts.push(`端口 ${criteria.ports.length}`);
    if (criteria.networks?.length) parts.push(`网络 ${criteria.networks.join('/')}`);
    if (criteria.source_cidrs?.length) parts.push(`来源IP ${criteria.source_cidrs.length}`);
    if (criteria.source_ports?.length) parts.push(`来源端口 ${criteria.source_ports.length}`);
    return parts.join(' · ') || '旧版匹配值';
  };

  const actionLabel = (route) => {
    if (route.action === 'direct') return '直连';
    if (route.action === 'block') return '阻止';
    if (route.action === 'dns') return `DNS${route.action_value ? ` → ${route.action_value}` : ''}`;
    if (route.action === 'proxy') return `出站 → ${route.action_value || '未设置'}`;
    return route.action;
  };

  const renderList = () => {
    const list = document.getElementById('xe-list');
    if (!list) return;
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
              </td>
              <td class="xe-mono">${esc(criteriaSummary(route))}</td>
              <td>${esc(actionLabel(route))}</td>
              <td>${Number(route.servers_count || 0)}</td>
              <td>
                <div class="xe-row-actions">
                  <button class="secondary" data-xe-edit="${route.id}">编辑</button>
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
    const datalist = document.getElementById('xe-target-options');
    if (!datalist) return;
    datalist.innerHTML = state.targets.map((target) =>
      `<option value="${esc(target.tag)}">${esc(target.label || target.tag)}</option>`
    ).join('');
  };

  const load = async () => {
    if (state.loading) return;
    state.loading = true;
    const list = document.getElementById('xe-list');
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
      await api('/save', 'POST', body);
      showMessage('规则已保存，绑定节点将热重载路由。');
      await load();
      resetForm();
      showMessage('规则已保存，绑定节点将热重载路由。');
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  const preview = async () => {
    try {
      const result = await api('/preview', 'POST', readForm());
      document.getElementById('xe-preview').textContent = JSON.stringify(result, null, 2);
      showMessage('校验通过。');
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
    if (remove && confirm('确定删除此路由规则吗？绑定节点将收到热重载通知。')) {
      try {
        await api('/drop', 'POST', { id: Number(remove.dataset.xeDelete) });
        showMessage('规则已删除。');
        await load();
        if (state.editingId === Number(remove.dataset.xeDelete)) resetForm();
      } catch (error) {
        showMessage(error.message, true);
      }
    }
  };

  const open = async () => {
    ensureStyle();
    let element = page();
    if (!element) {
      const host = document.getElementById('content') || document.querySelector('main');
      if (!host) return;
      state.pageHost = host;
      state.hiddenHostChildren = [...host.children].map((child) => ({
        element: child,
        display: child.style.display,
      }));
      state.hiddenHostChildren.forEach(({ element: child }) => {
        child.style.display = 'none';
      });
      host.insertAdjacentHTML('beforeend', pageHtml());
      element = page();
      if (!element) return;
      element.addEventListener('click', handleClick);
      document.getElementById('xe-search')?.addEventListener('input', (event) => {
        state.search = event.target.value.trim();
        renderList();
      });
      document.getElementById('xe-action')?.addEventListener('change', updateTargetState);
    }
    setMenuActive(true);
    resetForm();
    await load();
  };

  const close = () => {
    const element = page();
    if (!element) return;
    setMenuActive(false);
    element.remove();
    state.hiddenHostChildren.forEach(({ element: child, display }) => {
      child.style.display = display;
    });
    state.hiddenHostChildren = [];
    state.pageHost = null;
  };

  const openIfCurrentRoute = () => {
    const path = String(window.location?.pathname || '');
    if (/\/server\/route(?:[/?#]|$)/.test(path) && !page()) {
      void open();
    }
  };

  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (link) {
      const href = link.getAttribute('href') || link.href || '';
      if (/\/server\/route(?:[/?#]|$)/.test(href)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void open();
        return;
      }
      if (page() && !link.closest(`#${PAGE_ID}`)) close();
    }
  }, true);

  window.addEventListener('hashchange', close);
  window.addEventListener('popstate', () => setTimeout(openIfCurrentRoute, 50));
  document.addEventListener?.('DOMContentLoaded', () => setTimeout(openIfCurrentRoute, 100));
  setTimeout(openIfCurrentRoute, 1200);
})();
