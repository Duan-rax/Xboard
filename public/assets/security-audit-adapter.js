/* Official Xboard admin-shell integration for native security audit. */
(() => {
  'use strict';

  const PAGE_ID = 'xboard-security-audit-page';
  const STYLE_ID = 'xboard-security-audit-style';
  const MENU_ID = 'xboard-security-audit-menu';
  const INTENT_KEY = 'xboard_security_audit_open';
  const MENU_LABEL = '安全审计';
  const MENU_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.8 2.8 8.1 7 10 4.2-1.9 7-5.2 7-10V6l-7-3Z"></path>
      <path d="m9 12 2 2 4-4"></path>
    </svg>`;

  let menuLink = null;
  let menuBaseClass = '';
  let activeMenuSnapshot = null;
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

  const ensureStyle = (css) => {
    if (get(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
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

  const setMenuActive = (active) => {
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
        menuLink.className = current.className;
        current.classList.remove('bg-secondary');
        current.removeAttribute('aria-current');
      }
      menuLink.setAttribute('aria-current', 'page');
      return;
    }
    menuLink.className = menuBaseClass;
    menuLink.removeAttribute('aria-current');
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
    const existing = get(MENU_ID);
    if (existing) {
      menuLink = existing.matches('a') ? existing : existing.querySelector('a[href]');
      menuBaseClass = menuLink?.className || '';
      return;
    }

    const links = [...document.querySelectorAll('a[href]')];
    const dashboard = links.find((link) => /\/dashboard(?:[/?#]|$)/.test(link.getAttribute('href') || link.href || ''))
      || links.find((link) => ['仪表盘', 'Dashboard'].includes(link.textContent.trim()));
    if (!dashboard) return;

    const leaf = dashboard.closest('li') || dashboard;
    const item = leaf.cloneNode(true);
    item.id = MENU_ID;
    menuLink = item.matches('a') ? item : item.querySelector('a[href]');
    if (!menuLink) return;
    menuLink.setAttribute('href', '#');
    menuLink.removeAttribute('aria-current');
    menuBaseClass = menuLink.className;
    const labelHosts = [menuLink, ...menuLink.querySelectorAll('*')];
    for (const nodeHost of labelHosts) {
      const text = [...(nodeHost.childNodes || [])].find((node) => {
        return node.nodeType === 3 && ['仪表盘', 'Dashboard'].includes(node.nodeValue.trim());
      });
      if (text) {
        text.nodeValue = MENU_LABEL;
        break;
      }
    }
    const label = [...menuLink.querySelectorAll('*')]
      .reverse()
      .find((element) => ['仪表盘', 'Dashboard'].includes(element.textContent.trim()));
    if (label) label.textContent = MENU_LABEL;
    const icon = menuLink.querySelector('div');
    if (icon) icon.innerHTML = MENU_ICON;
    item.removeAttribute('data-state');
    item.querySelectorAll?.('[data-state]').forEach((element) => element.removeAttribute('data-state'));
    menuLink.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      restoreAttempted = true;
      try { sessionStorage.setItem(INTENT_KEY, '1'); } catch (_) {}
      onOpen();
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
        onOpen();
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
