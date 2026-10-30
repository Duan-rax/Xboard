/*
 * Xboard route-admin integration adapter.
 *
 * Keep official SPA DOM, menu, history, location and authentication-token
 * assumptions in this file. route-admin.js contains feature state, rendering
 * and API workflows and must not depend on the official admin shell directly.
 */
(() => {
  'use strict';

  const PAGE_ID = 'xboard-route-v2-page';
  const STYLE_ID = 'xboard-route-v2-style';
  const ROUTE_PATH = /\/server\/route(?:[/?#]|$)/;

  let activeMenuSnapshot = null;
  let hiddenHostChildren = [];

  const get = (id) => document.getElementById(id);
  const page = () => get(PAGE_ID);

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
        const token = parseStoredToken(localStorage.getItem(key));
        if (token) return token;
      }
      const length = Number(localStorage.length) || 0;
      for (let i = 0; i < length; i += 1) {
        const key = localStorage.key(i) || '';
        if (!/access_token$/i.test(key)) continue;
        const token = parseStoredToken(localStorage.getItem(key));
        if (token) return token;
      }
    } catch (_) {
      // localStorage can be unavailable in hardened browsers.
    }
    return '';
  };

  const apiBase = () => {
    const securePath = String(window.settings?.secure_path || '').replace(/^\/+|\/+$/g, '');
    return `/api/v2/${securePath}/server/route`.replace(/\/+/g, '/');
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
      throw new Error(payload?.message || `请求失败（HTTP ${response.status}）`);
    }
    return payload.data;
  };

  const api = (path, method = 'GET', body) => request(`${apiBase()}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const routeMenuLink = () => [...document.querySelectorAll('a[href]')].find((link) => {
    const href = link.getAttribute('href') || link.href || '';
    return ROUTE_PATH.test(href);
  });

  const isRouteHref = (href) => ROUTE_PATH.test(String(href || ''));
  const isCurrentRoute = () => ROUTE_PATH.test(String(window.location?.pathname || ''));

  const setMenuActive = (active) => {
    const link = routeMenuLink();
    if (!link) return;
    if (active) {
      const current = [...document.querySelectorAll('nav a[href]')]
        .find((item) => item !== link && item.getAttribute('aria-current') === 'page');
      if (current) {
        activeMenuSnapshot = {
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
    if (activeMenuSnapshot?.link) {
      activeMenuSnapshot.link.className = activeMenuSnapshot.className;
      if (activeMenuSnapshot.ariaCurrent) {
        activeMenuSnapshot.link.setAttribute('aria-current', activeMenuSnapshot.ariaCurrent);
      }
    }
    activeMenuSnapshot = null;
  };

  const ensureStyle = (css) => {
    if (get(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  };

  const restoreHostChildren = () => {
    hiddenHostChildren.forEach(({ element, display }) => {
      element.style.display = display;
    });
    hiddenHostChildren = [];
  };

  const mountPage = (html, css) => {
    if (page()) return page();
    ensureStyle(css);
    const host = document.getElementById('content') || document.querySelector('main');
    if (!host) return null;
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

  const unmountPage = () => {
    const element = page();
    if (!element) return false;
    element.remove();
    restoreHostChildren();
    return true;
  };

  const updateRouteLocation = (href) => {
    if (!window.history?.pushState || !window.location) return;
    try {
      const target = new URL(href, window.location.href || 'http://localhost/');
      const next = `${target.pathname}${target.search}${target.hash}`;
      const current = `${window.location.pathname || ''}${window.location.search || ''}${window.location.hash || ''}`;
      if (next !== current) window.history.pushState({}, '', next);
    } catch (_) {
      // The native menu supplied an invalid URL; opening the editor still works.
    }
  };

  const on = (elementId, eventName, listener) => {
    get(elementId)?.addEventListener(eventName, listener);
  };

  const onPage = (eventName, listener) => {
    page()?.addEventListener(eventName, listener);
  };

  const bindNavigation = ({ onRoute, onClose, onResume }) => {
    let startupObserver = null;
    let resumeTimer = null;

    const stopStartupObserver = () => {
      if (!startupObserver) return;
      startupObserver.disconnect();
      startupObserver = null;
    };

    const resumeWhenReady = () => {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        onResume();
        if (page()) stopStartupObserver();
      }, 120);
    };

    const afterShellSettles = (callback) => {
      let settled = false;
      let quietTimer = null;
      let maxTimer = null;
      const observer = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, 120);
      });
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(quietTimer);
        clearTimeout(maxTimer);
        observer.disconnect();
        callback();
      };
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      quietTimer = setTimeout(finish, 120);
      maxTimer = setTimeout(finish, 800);
    };

    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link) return;
      const href = link.getAttribute('href') || link.href || '';
      if (isRouteHref(href)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        updateRouteLocation(href);
        // Let the official router finish its own content re-render before
        // mounting. A quiet-DOM window avoids depending on a fixed delay.
        afterShellSettles(onRoute);
        return;
      }
      if (page() && !link.closest(`#${PAGE_ID}`)) onClose();
    }, true);

    window.addEventListener('hashchange', onClose);
    window.addEventListener('popstate', () => setTimeout(resumeWhenReady, 50));
    document.addEventListener?.('DOMContentLoaded', () => setTimeout(resumeWhenReady, 100));
    startupObserver = new MutationObserver(resumeWhenReady);
    startupObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    setTimeout(resumeWhenReady, 1200);
  };

  globalThis.XboardRouteAdapter = Object.freeze({
    api,
    bindNavigation,
    get,
    isCurrentRoute,
    mountPage,
    on,
    onPage,
    page,
    setMenuActive,
    unmountPage,
  });
})();
