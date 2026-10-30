/* Official Xboard admin-shell integration for native security audit. */
(() => {
  'use strict';

  const PAGE_ID = 'xboard-security-audit-page';
  const STYLE_ID = 'xboard-security-audit-style';
  const MENU_STYLE_ID = 'xboard-security-audit-menu-style';
  const MENU_ID = 'xboard-security-audit-menu';
  const INTENT_KEY = 'xboard_security_audit_open';
  const SECTION_KEY = 'xboard_security_audit_section';
  const MENU_LABEL = '安全审计';
  const MENU_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.8 2.8 8.1 7 10 4.2-1.9 7-5.2 7-10V6l-7-3Z"></path>
      <path d="m9 12 2 2 4-4"></path>
    </svg>`;
  const MENU_CSS = `
    .sa-nav-group{list-style:none;width:100%}
    .sa-nav-toggle{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .16s ease,color .16s ease}
    .sa-nav-toggle:hover,.sa-nav-toggle.active{background:hsl(var(--accent,210 40% 96%));color:hsl(var(--accent-foreground,222.2 47.4% 11.2%))}
    .sa-nav-icon{display:inline-flex;flex:0 0 18px;align-items:center;justify-content:center}
    .sa-nav-chevron{margin-left:auto;font-size:16px;line-height:1;transition:transform .16s ease}
    .sa-nav-toggle.expanded .sa-nav-chevron{transform:rotate(180deg)}
    .sa-nav-sub{display:flex;flex-direction:column;gap:2px;margin:2px 0 5px 28px;padding-left:10px;border-left:1px solid hsl(var(--border,214 32% 91%))}
    .sa-nav-sub[hidden]{display:none}
    .sa-nav-sub button{width:100%;padding:7px 10px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:.92em;text-align:left;cursor:pointer}
    .sa-nav-sub button:hover{background:hsl(var(--accent,210 40% 96%))}
    .sa-nav-sub button.active{background:hsl(var(--primary,221.2 83.2% 53.3%));color:hsl(var(--primary-foreground,210 40% 98%));font-weight:600}
  `;

  let menuLink = null;
  let menuBaseClass = '';
  let activeMenuSnapshot = null;
  let sectionLinks = [];
  let hiddenChildren = [];
  let host = null;
  let restoreAttempted = false;

  const get = (id) => document.getElementById(id);
  const page = () => get(PAGE_ID);

  const parseToken = (raw) => {
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
    try {
      const keys = ['Xboard_access_token', 'Vue_Naive_access_token', 'access_token'];
      for (const key of keys) {
        const value = parseToken(localStorage.getItem(key));
        if (value) return value;
      }
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i) || '';
        if (!/access_token$/i.test(key)) continue;
        const value = parseToken(localStorage.getItem(key));
        if (value) return value;
      }
    } catch (_) {
      // Ignore hardened browser storage.
    }
    return '';
  };

  const apiBase = () => {
    const secure = String(window.settings?.secure_path || '').replace(/^\/+|\/+$/g, '');
    return `/api/v2/${secure}/security-audit`.replace(/\/+/g, '/');
  };

  const api = async (path, method = 'GET', body) => {
    const token = authToken();
    const response = await fetch(`${apiBase()}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: /^Bearer\s/i.test(token) ? token : `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      // Proxy error.
    }
    if (!response.ok || !payload || payload.status === 'fail') {
      throw new Error(payload?.message || `请求失败（HTTP ${response.status}）`);
    }
    return payload.data;
  };

  const ensureStyle = (css, id = STYLE_ID) => {
    if (get(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  };

  const restoreHost = () => {
    hiddenChildren.forEach(({ element, display }) => {
      element.style.display = display;
    });
    hiddenChildren = [];
    host = null;
  };

  const mount = (html, css) => {
    if (page()) return page();
    ensureStyle(css);
    host = get('content') || document.querySelector('main');
    if (!host) return null;
    hiddenChildren = [...host.children].map((child) => ({
      element: child,
      display: child.style.display,
    }));
    hiddenChildren.forEach(({ element }) => {
      element.style.display = 'none';
    });
    host.insertAdjacentHTML('beforeend', html);
    return page();
  };

  const unmount = () => {
    if (!page()) return;
    page().remove();
    restoreHost();
  };

  const setMenuActive = (active, section = 'overview') => {
    if (!menuLink) return;
    if (active) {
      const current = [...document.querySelectorAll('nav a[href]')]
        .find((link) => link !== menuLink && link.getAttribute('aria-current') === 'page');
      if (current) {
        activeMenuSnapshot = {
          link: current,
          className: current.className,
          ariaCurrent: current.getAttribute('aria-current'),
        };
        menuLink.className = `${menuBaseClass} ${current.className}`.trim();
        current.classList.remove('bg-secondary');
        current.removeAttribute('aria-current');
      }
      menuLink.setAttribute('aria-current', 'page');
      menuLink.classList.add('active');
      menuLink.classList.add('expanded');
      menuLink.setAttribute('aria-expanded', 'true');
      const submenu = menuLink.parentElement?.querySelector('.sa-nav-sub');
      if (submenu) submenu.hidden = false;
      sectionLinks.forEach((link) => {
        link.classList.toggle('active', link.dataset.saSection === section);
      });
      return;
    }
    menuLink.className = menuBaseClass;
    menuLink.removeAttribute('aria-current');
    menuLink.classList.remove('active');
    sectionLinks.forEach((link) => link.classList.remove('active'));
    if (activeMenuSnapshot?.link) {
      activeMenuSnapshot.link.className = activeMenuSnapshot.className;
      if (activeMenuSnapshot.ariaCurrent) {
        activeMenuSnapshot.link.setAttribute('aria-current', activeMenuSnapshot.ariaCurrent);
      }
    }
    activeMenuSnapshot = null;
  };

  const installMenu = ({ css, onOpen }) => {
    ensureStyle(css);
    ensureStyle(MENU_CSS, MENU_STYLE_ID);
    const existing = get(MENU_ID);
    if (existing) {
      menuLink = existing.matches('a') ? existing : existing.querySelector('a[href]');
      menuLink = menuLink || existing.querySelector('.sa-nav-toggle');
      if (!menuBaseClass) menuBaseClass = menuLink?.className || '';
      sectionLinks = [...existing.querySelectorAll('[data-sa-section]')];
      return;
    }

    const links = [...document.querySelectorAll('a[href]')];
    const dashboard = links.find((link) => /\/dashboard(?:[/?#]|$)/.test(link.getAttribute('href') || link.href || ''))
      || links.find((link) => ['仪表盘', 'Dashboard'].includes(link.textContent.trim()));
    if (!dashboard) return;
    const leaf = dashboard.closest('li') || dashboard;
    const list = leaf.parentElement;
    if (!list) return;

    const item = document.createElement('li');
    item.id = MENU_ID;
    item.className = 'sa-nav-group';
    item.innerHTML = `
      <button type="button" class="sa-nav-toggle" aria-expanded="true">
        <span class="sa-nav-icon">${MENU_ICON}</span><span>${MENU_LABEL}</span><span class="sa-nav-chevron" data-sa-toggle>⌄</span>
      </button>
      <div class="sa-nav-sub">
        <button type="button" data-sa-section="overview">审计概览</button>
        <button type="button" data-sa-section="traffic">流量明细</button>
        <button type="button" data-sa-section="rules">规则命中</button>
        <button type="button" data-sa-section="users">用户审计</button>
        <button type="button" data-sa-section="settings">审计设置</button>
      </div>`;
    menuLink = item.querySelector('.sa-nav-toggle');
    menuBaseClass = menuLink.className;
    sectionLinks = [...item.querySelectorAll('[data-sa-section]')];
    let expanded = true;
    const setExpanded = (value) => {
      expanded = value;
      menuLink.classList.toggle('expanded', expanded);
      menuLink.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      item.querySelector('.sa-nav-sub').hidden = !expanded;
    };
    menuLink.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.target.closest?.('[data-sa-toggle]')) {
        setExpanded(!expanded);
        return;
      }
      const current = sectionLinks.find((link) => link.classList.contains('active'));
      const section = current?.dataset.saSection || 'overview';
      setExpanded(true);
      restoreAttempted = true;
      try {
        sessionStorage.setItem(INTENT_KEY, '1');
        sessionStorage.setItem(SECTION_KEY, section);
      } catch (_) {}
      onOpen(section);
    });
    sectionLinks.forEach((sectionLink) => {
      sectionLink.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        restoreAttempted = true;
        try {
          sessionStorage.setItem(INTENT_KEY, '1');
          sessionStorage.setItem(SECTION_KEY, sectionLink.dataset.saSection);
        } catch (_) {}
        setExpanded(true);
        onOpen(sectionLink.dataset.saSection);
      });
    });
    leaf.insertAdjacentElement('afterend', item);
  };

  const bindLifecycle = ({ css, onOpen, onClose }) => {
    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.closest(`#${MENU_ID}`) || link.closest(`#${PAGE_ID}`)) return;
      try { sessionStorage.removeItem(INTENT_KEY); } catch (_) {}
      onClose();
    }, true);
    window.addEventListener('hashchange', () => {
      try { sessionStorage.removeItem(INTENT_KEY); } catch (_) {}
      onClose();
    });
    new MutationObserver(() => {
      installMenu({ css, onOpen });
      let restore = false;
      try { restore = sessionStorage.getItem(INTENT_KEY) === '1'; } catch (_) {}
      if (restore && !restoreAttempted && !page()) {
        restoreAttempted = true;
        let section = 'overview';
        try { section = sessionStorage.getItem(SECTION_KEY) || 'overview'; } catch (_) {}
        onOpen(section);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => installMenu({ css, onOpen }));
    setTimeout(() => installMenu({ css, onOpen }), 1000);
  };

  globalThis.XboardSecurityAuditAdapter = Object.freeze({
    PAGE_ID,
    api,
    bindLifecycle,
    get,
    mount,
    page,
    setMenuActive,
    unmount,
  });
})();
