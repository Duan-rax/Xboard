/* Official Xboard admin-shell integration for native security audit. */
(() => {
  'use strict';

  const PAGE_ID = 'xboard-security-audit-page';
  const STYLE_ID = 'xboard-security-audit-style';
  const MENU_STYLE_ID = 'xboard-security-audit-menu-style';
  const MENU_ID = 'xboard-security-audit-menu';
  const INTENT_KEY = 'xboard_security_audit_open';
  const SECTION_KEY = 'xboard_security_audit_section';
  const EXPANDED_KEY = 'xboard_security_audit_expanded';
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
    analysis: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2"></path>
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
    ['analysis', '流量分析'],
    ['traffic', '流量审计记录'],
    ['rules', '规则命中'],
    ['users', '用户审计'],
    ['settings', '审计设置'],
  ];
  const ACTIVE_VARIANT = ['bg-secondary', 'text-secondary-foreground', 'shadow-sm', 'hover:bg-secondary/80'];
  const INACTIVE_VARIANT = ['hover:bg-accent', 'hover:text-accent-foreground'];
  const FALLBACK_SUBLINK_CLASS = 'inline-flex items-center gap-2 w-full whitespace-nowrap text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 h-10 justify-start text-wrap rounded-none border-l border-l-slate-500 px-2';
  const MENU_CSS = `
    .sa-nav-sub[hidden]{display:none}
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
      menuLink = existing.matches('a') ? existing : existing.querySelector('button');
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
    const groupCandidates = [...list.children].filter((candidate) => (
      candidate !== leaf
      && (
        candidate.querySelector?.('button[data-state]')
        || candidate.querySelector?.('button[aria-expanded]')
      )
    ));
    const templateGroup = groupCandidates.find((candidate) => candidate.querySelector?.('ul a[href]'))
      || groupCandidates[0];
    if (!templateGroup) return;

    const item = templateGroup.cloneNode(true);
    item.id = MENU_ID;
    item.classList.add('sa-nav-group');
    item.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));

    menuLink = item.querySelector('button');
    const submenu = item.querySelector('.collapsibleDropdown') || item.querySelector('ul')?.parentElement;
    let rowList = item.querySelector('ul');
    const templateRows = rowList ? [...rowList.children] : [];
    if (!menuLink) return;

    const replaceDirectLabel = (host, label) => {
      const labelNode = [...host.childNodes].find((node) => node.nodeType === 3 && node.nodeValue.trim());
      if (labelNode) labelNode.nodeValue = label;
      else host.appendChild(document.createTextNode(label));
    };

    const groupIcon = menuLink.querySelector('div');
    if (groupIcon) groupIcon.innerHTML = MENU_ICON;
    replaceDirectLabel(menuLink, MENU_LABEL);
    const chevron = [...menuLink.children]
      .find((child) => child.tagName === 'SPAN' && child.classList.contains('ml-auto'))
      || menuLink.lastElementChild;
    chevron?.setAttribute('data-sa-toggle', '');
    menuLink.removeAttribute('aria-current');
    menuLink.removeAttribute('aria-controls');

    let sectionContainer = submenu;
    if (!sectionContainer) {
      sectionContainer = document.createElement('div');
      sectionContainer.className = 'collapsibleDropdown';
      item.appendChild(sectionContainer);
    }
    if (!rowList) {
      rowList = document.createElement('ul');
      sectionContainer.appendChild(rowList);
    }
    sectionContainer.classList.remove('collapsibleDropdown');
    sectionContainer.removeAttribute('style');
    sectionContainer.classList.add('sa-nav-sub');
    sectionContainer.id = `${MENU_ID}-sections`;
    menuLink.setAttribute('aria-controls', sectionContainer.id);

    while (rowList.firstChild) rowList.removeChild(rowList.firstChild);
    MENU_SECTIONS.forEach(([section, label], index) => {
      let row = templateRows[index]?.cloneNode(true);
      let link = row?.querySelector('a[href]') || row?.querySelector('a');
      if (!row || !link) {
        row = document.createElement('li');
        row.className = 'my-1 ml-8';
        link = document.createElement('a');
        link.className = `${FALLBACK_SUBLINK_CLASS} ${INACTIVE_VARIANT.join(' ')}`;
        row.appendChild(link);
      }
      link.setAttribute('href', '#');
      link.removeAttribute('aria-current');
      link.dataset.saSection = section;
      link.innerHTML = `<div class="mr-2">${SECTION_ICONS[section]}</div>${label}`;
      setVariant(link, false);
      rowList.appendChild(row);
    });
    sectionLinks = [...rowList.querySelectorAll('[data-sa-section]')];

    let expanded = false;
    try {
      expanded = sessionStorage.getItem(EXPANDED_KEY) === '1';
    } catch (_) {}
    const setExpanded = (value, persist = true) => {
      expanded = value;
      menuLink.setAttribute('data-state', expanded ? 'open' : 'closed');
      menuLink.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      sectionContainer.hidden = !expanded;
      sectionContainer.setAttribute('data-state', expanded ? 'open' : 'closed');
      if (persist) {
        try { sessionStorage.setItem(EXPANDED_KEY, expanded ? '1' : '0'); } catch (_) {}
      }
    };
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sectionLink = event.target.closest?.('[data-sa-section]');
      if (sectionLink) {
        restoreAttempted = true;
        try {
          sessionStorage.setItem(INTENT_KEY, '1');
          sessionStorage.setItem(SECTION_KEY, sectionLink.dataset.saSection);
        } catch (_) {}
        setExpanded(true);
        onOpen(sectionLink.dataset.saSection);
        return;
      }
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
    }, true);
    setExpanded(expanded, false);
    setVariant(menuLink, false);
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
