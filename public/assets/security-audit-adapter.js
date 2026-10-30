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
  const SECTION_ICONS = {
    overview: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="9" rx="1"></rect><rect x="14" y="3" width="7" height="5" rx="1"></rect>
        <rect x="14" y="12" width="7" height="9" rx="1"></rect><rect x="3" y="16" width="7" height="5" rx="1"></rect>
      </svg>`,
    traffic: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12h4l3-9 4 18 3-9h4"></path>
      </svg>`,
    rules: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 5h16M7 12h10M10 19h4"></path><circle cx="8" cy="5" r="2"></circle><circle cx="15" cy="12" r="2"></circle>
      </svg>`,
    users: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>`,
    settings: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 7h-9M14 17H5"></path><circle cx="17" cy="17" r="3"></circle><circle cx="7" cy="7" r="3"></circle>
      </svg>`,
  };
  const MENU_SECTIONS = [
    ['overview', '审计概览'],
    ['traffic', '流量明细'],
    ['rules', '规则命中'],
    ['users', '用户审计'],
    ['settings', '审计设置'],
  ];
  const BUTTON_BASE = 'inline-flex items-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0';
  const GROUP_BASE = `${BUTTON_BASE} group h-12 w-full justify-start rounded-none px-6`;
  const SUBLINK_BASE = `${BUTTON_BASE} h-10 w-full justify-start text-wrap rounded-none border-l border-l-slate-500 px-2`;
  const ACTIVE_VARIANT = ['bg-secondary', 'text-secondary-foreground', 'shadow-sm', 'hover:bg-secondary/80'];
  const INACTIVE_VARIANT = ['hover:bg-accent', 'hover:text-accent-foreground'];
  const MENU_CSS = `
    .sa-nav-group{list-style:none;width:100%}
    .sa-nav-sub{list-style:none;margin:0;padding:0}
    .sa-nav-sub[hidden]{display:none}
    [data-collapsed="true"] .sa-nav-group .sa-nav-toggle{width:3rem;padding:0;justify-content:center}
    [data-collapsed="true"] .sa-nav-group .sa-nav-toggle>span{display:none}
    [data-collapsed="true"] .sa-nav-group .sa-nav-sub{display:none!important}
  `;

  let menuLink = null;
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

  const setVariant = (element, active) => {
    if (!element) return;
    [...ACTIVE_VARIANT, ...INACTIVE_VARIANT].forEach((name) => element.classList.remove(name));
    (active ? ACTIVE_VARIANT : INACTIVE_VARIANT).forEach((name) => element.classList.add(name));
    element.classList.toggle('active', active);
  };

  const setMenuActive = (active, section = 'overview') => {
    if (!menuLink) return;
    if (active) {
      const current = [...document.querySelectorAll('nav a[href]')]
        .find((link) => link !== menuLink
          && !link.closest?.(`#${MENU_ID}`)
          && link.getAttribute('aria-current') === 'page');
      if (current) {
        activeMenuSnapshot = {
          link: current,
          className: current.className,
          ariaCurrent: current.getAttribute('aria-current'),
        };
        current.classList.remove(...ACTIVE_VARIANT);
        current.removeAttribute('aria-current');
      }
      setVariant(menuLink, true);
      menuLink.setAttribute('aria-current', 'page');
      menuLink.setAttribute('aria-expanded', 'true');
      menuLink.setAttribute('data-state', 'open');
      const submenu = menuLink.parentElement?.querySelector('.sa-nav-sub');
      if (submenu) {
        submenu.hidden = false;
        submenu.setAttribute('data-state', 'open');
      }
      sectionLinks.forEach((link) => {
        const selected = link.dataset.saSection === section;
        setVariant(link, selected);
        if (selected) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      return;
    }
    setVariant(menuLink, false);
    menuLink.removeAttribute('aria-current');
    sectionLinks.forEach((link) => {
      setVariant(link, false);
      link.removeAttribute('aria-current');
    });
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

    const item = document.createElement('div');
    item.id = MENU_ID;
    item.className = 'sa-nav-group';
    item.innerHTML = `
      <button type="button" class="sa-nav-toggle ${GROUP_BASE} ${INACTIVE_VARIANT.join(' ')}" aria-expanded="true" data-state="open">
        <div class="mr-2">${MENU_ICON}</div><span>${MENU_LABEL}</span>
        <span class='ml-auto transition-all group-data-[state="open"]:-rotate-180' data-sa-toggle>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
        </span>
      </button>
      <ul class="sa-nav-sub" data-state="open">
        ${MENU_SECTIONS.map(([section, label]) => `
          <li class="my-1 ml-8">
            <button type="button" data-sa-section="${section}" class="sa-nav-sub-link ${SUBLINK_BASE} ${INACTIVE_VARIANT.join(' ')}">
              <span class="mr-2 inline-flex">${SECTION_ICONS[section]}</span><span>${label}</span>
            </button>
          </li>`).join('')}
      </ul>`;
    menuLink = item.querySelector('.sa-nav-toggle');
    sectionLinks = [...item.querySelectorAll('[data-sa-section]')];
    let expanded = true;
    const setExpanded = (value) => {
      expanded = value;
      menuLink.setAttribute('data-state', expanded ? 'open' : 'closed');
      menuLink.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      const submenu = item.querySelector('.sa-nav-sub');
      submenu.hidden = !expanded;
      submenu.setAttribute('data-state', expanded ? 'open' : 'closed');
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
