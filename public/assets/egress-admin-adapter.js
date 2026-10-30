/*
 * Official Xboard SPA integration for the egress-management extension.
 * Business state, forms, rendering, API calls and workflows live in the
 * egress-admin-*.js modules.
 */
(() => {
  'use strict';

  const MENU_ID = 'xboard-egress-management-menu';
  const PAGE_ID = 'xboard-egress-management-modal';
  const BIND_PAGE_ID = 'xboard-egress-binding-modal';
  const STYLE_ID = 'xboard-egress-style';
  const MENU_LABEL = '出站管理';
  const MENU_ICON = `
    <svg class="xe-menu-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="8" height="16" rx="2"></rect>
      <path d="M6 8h2M6 12h2M6 16h2"></path>
      <path d="M13 12h7"></path>
      <path d="m17 8 4 4-4 4"></path>
    </svg>`;

  let menuLink = null;
  let menuBaseClass = '';
  let activeMenuSnapshot = null;
  let pageHost = null;
  let hiddenHostChildren = [];
  let styleInstalled = false;

  const get = (id) => document.getElementById(id);
  const page = () => get(PAGE_ID);
  const bindPage = () => get(BIND_PAGE_ID);

  const securePath = () => String(window.settings?.secure_path || '').replace(/^\/+|\/+$/g, '');
  const apiRoot = () => `/api/v2/${securePath()}`.replace(/\/$/, '');

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
      const error = new Error(payload?.message || `请求失败（HTTP ${response.status}）`);
      error.status = response.status;
      throw error;
    }
    return payload.data;
  };

  const api = (path, method = 'GET', body) => request(`${apiRoot()}/server/egress${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const ensureStyle = (css) => {
    if (styleInstalled || get(STYLE_ID)) {
      styleInstalled = true;
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
    styleInstalled = true;
  };

  const restoreHostChildren = () => {
    hiddenHostChildren.forEach(({ element, display }) => {
      element.style.display = display;
    });
    hiddenHostChildren = [];
    pageHost = null;
  };

  const mountMain = (html, css) => {
    if (page()) return page();
    ensureStyle(css);
    const host = get('content') || document.querySelector('main');
    if (!host) return null;
    pageHost = host;
    hiddenHostChildren = [...host.children].map((child) => ({
      element: child,
      display: child.style.display,
    }));
    hiddenHostChildren.forEach(({ element }) => {
      element.style.display = 'none';
    });
    try {
      host.insertAdjacentHTML('beforeend', html);
      const element = page();
      if (element) return element;
    } catch (_) {
      restoreHostChildren();
      throw _;
    }
    restoreHostChildren();
    return null;
  };

  const mountBind = (html) => {
    if (bindPage()) return bindPage();
    const slot = get('xe-bind-slot');
    if (!slot) return null;
    slot.insertAdjacentHTML('beforeend', html);
    return bindPage();
  };

  const unmountMain = () => {
    const element = page();
    if (!element) return false;
    element.remove();
    restoreHostChildren();
    return true;
  };

  const setMainBinding = (active) => {
    if (active) {
      page()?.classList.add('xe-binding');
      bindPage()?.classList.add('open');
    } else {
      page()?.classList.remove('xe-binding');
      bindPage()?.classList.remove('open');
    }
    bindPage()?.setAttribute('aria-hidden', active ? 'false' : 'true');
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
        current.blur?.();
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

  const scrollRoots = () => {
    const roots = [
      window,
      document.scrollingElement,
      document.documentElement,
      document.body,
      pageHost,
      page(),
      bindPage(),
    ];
    return roots.filter((root, index) => root && roots.indexOf(root) === index);
  };

  const captureScrollPositions = () => scrollRoots().flatMap((root) => {
    if (root === window) {
      return Number.isFinite(Number(root.scrollY))
        ? [{ root, left: Number(root.scrollX) || 0, top: Number(root.scrollY) || 0 }]
        : [];
    }
    return Number.isFinite(Number(root.scrollTop))
      ? [{ root, left: Number(root.scrollLeft) || 0, top: Number(root.scrollTop) || 0 }]
      : [];
  });

  const setScrollPosition = (root, left, top) => {
    if (root === window && typeof window.scrollTo === 'function') {
      window.scrollTo(left, top);
      return;
    }
    root.scrollLeft = left;
    root.scrollTop = top;
  };

  const restoreScrollPositions = (positions) => {
    positions.forEach(({ root, left, top }) => setScrollPosition(root, left, top));
  };

  const resetPageScroll = () => {
    scrollRoots().forEach((root) => setScrollPosition(root, 0, 0));
  };

  const on = (elementId, eventName, listener) => {
    get(elementId)?.addEventListener(eventName, listener);
  };

  const bindCheckboxes = () => [...document.querySelectorAll('[data-xe-node]')];

  const onPage = (eventName, listener) => page()?.addEventListener(eventName, listener);
  const onBindPage = (eventName, listener) => bindPage()?.addEventListener(eventName, listener);

  const installMenu = ({ css, onOpen }) => {
    ensureStyle(css);
    const existing = get(MENU_ID);
    if (existing) {
      if (!menuLink || !existing.contains(menuLink)) {
        menuLink = existing.querySelector('a[href]');
        menuBaseClass = menuLink?.className || '';
      }
      if (page()?.classList.contains('open')) setMenuActive(true);
      return;
    }

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
    menuLink = item.matches('a') ? item : item.querySelector('a[href]');
    if (!menuLink) return;
    menuLink.setAttribute('href', '#');
    menuLink.removeAttribute('aria-current');
    menuBaseClass = menuLink.className;
    activeMenuSnapshot = null;
    if (page()?.classList.contains('open')) setMenuActive(true);
    item.removeAttribute('data-state');
    item.querySelectorAll('[data-state]').forEach((element) => {
      element.removeAttribute('data-state');
    });

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
      onOpen();
    });
    leafItem.insertAdjacentElement('afterend', item);
  };

  const bindLifecycle = ({ css, onOpen, onClose }) => {
    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.closest(`#${MENU_ID}`) || link.closest(`#${PAGE_ID}`)) return;
      onClose();
    }, true);
    window.addEventListener('hashchange', onClose);
    new MutationObserver(() => installMenu({ css, onOpen })).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    document.addEventListener('DOMContentLoaded', () => installMenu({ css, onOpen }));
    setTimeout(() => installMenu({ css, onOpen }), 1000);
  };

  globalThis.XboardEgressAdapter = Object.freeze({
    BIND_PAGE_ID,
    MENU_ID,
    PAGE_ID,
    api,
    bindCheckboxes,
    bindLifecycle,
    bindPage,
    captureScrollPositions,
    get,
    installMenu,
    mountBind,
    mountMain,
    on,
    onBindPage,
    onPage,
    page,
    resetPageScroll,
    restoreScrollPositions,
    setMainBinding,
    setMenuActive,
    unmountMain,
  });
})();
