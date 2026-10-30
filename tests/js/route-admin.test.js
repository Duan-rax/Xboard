'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const createClassList = () => ({
  values: new Set(),
  add(value) { this.values.add(value); },
  remove(value) { this.values.delete(value); },
  contains(value) { return this.values.has(value); },
});

const createElement = (extra = {}) => ({
  value: '',
  checked: false,
  placeholder: '',
  innerHTML: '',
  textContent: '',
  className: '',
  style: { display: '' },
  classList: createClassList(),
  listeners: {},
  setAttribute(name, value) { this[name] = value; },
  removeAttribute(name) { delete this[name]; },
  addEventListener(name, listener) { this.listeners[name] = listener; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  closest() { return null; },
  ...extra,
});

let inserted = false;
let style = null;
let documentClickHandler = null;

const page = createElement();
page.remove = () => { inserted = false; };
page.classList.add('page');
const content = createElement();
const existingContent = createElement();
content.children = [existingContent];
const routeLink = createElement({
  href: '/server/route',
  className: 'menu-link',
  getAttribute(name) { return name === 'href' ? this.href : this[name]; },
});

const elements = new Map();
[
  'xe-form-title', 'xe-id', 'xe-remarks', 'xe-priority', 'xe-match-mode',
  'xe-enabled', 'xe-domains', 'xe-domain-suffixes', 'xe-ip-cidrs', 'xe-ports',
  'xe-networks', 'xe-source-cidrs', 'xe-source-ports', 'xe-action', 'xe-target',
  'xe-target-options', 'xe-message', 'xe-preview', 'xe-diagnostic-summary', 'xe-list', 'xe-search',
  'xe-bind-modal', 'xe-bind-title', 'xe-node-search', 'xe-node-bound',
  'xe-bind-message', 'xe-node-list', 'xe-node-page',
].forEach((id) => elements.set(id, createElement()));

content.insertAdjacentHTML = (position, html) => {
  assert.equal(position, 'beforeend');
  if (html.includes('xboard-route-v2-page')) inserted = true;
};

let pushedLocation = '';
const windowListeners = {};
global.window = {
  settings: { secure_path: 'test' },
  location: {
    href: 'https://panel.test/server/manage',
    pathname: '/server/manage',
    search: '',
    hash: '',
  },
  history: {
    pushState(_state, _title, url) {
      pushedLocation = String(url);
      window.location.pathname = new URL(url, window.location.href).pathname;
      window.location.href = new URL(url, window.location.href).href;
    },
  },
  addEventListener(name, listener) { windowListeners[name] = listener; },
};
const tokenStore = {
  panel_theme_access_token: JSON.stringify({ value: 'token-123' }),
};
global.localStorage = {
  get length() { return Object.keys(tokenStore).length; },
  key: (index) => Object.keys(tokenStore)[index] || null,
  getItem: (key) => tokenStore[key] ?? null,
};
let authorizationHeader = '';
global.fetch = async (url, options = {}) => {
  authorizationHeader = options.headers?.Authorization || authorizationHeader;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: String(url).includes('/options')
        ? { targets: [{ tag: 'warp', label: 'WARP (warp)' }] }
        : [{
            id: 7,
            remarks: '国内直连',
            criteria: { domain_suffixes: ['example.cn'] },
            match_mode: 'any',
            priority: 10,
            enabled: true,
            action: 'direct',
            action_value: null,
            servers_count: 2,
            diagnostics: [{
              code: 'shadowed_rule',
              severity: 'error',
              related_route_id: 3,
              message: '匹配条件与更高优先级规则 #3 完全相同。',
            }],
            capabilities: {
              known: true,
              kernel: 'sing-box',
              kernel_version: 'v1.14.0-alpha.2',
              features: ['domain_suffix', 'structured_routes'],
            },
            compatibility: {
              supported: true,
              known: true,
              missing_features: [],
              message: '当前规则与节点内核能力兼容。',
            },
          }],
    }),
  };
};
global.document = {
  head: { appendChild: (element) => { style = element; } },
  createElement: () => createElement(),
  getElementById(id) {
    if (id === 'xboard-route-v2-page') return inserted ? page : null;
    if (id === 'xboard-route-v2-style') return style;
    if (id === 'content') return content;
    return inserted ? (elements.get(id) || null) : null;
  },
  querySelectorAll(selector) {
    if (selector === 'a[href]' || selector === 'nav a[href]') return [routeLink];
    return [];
  },
  addEventListener(name, listener) {
    if (name === 'click') documentClickHandler = listener;
  },
};

require('../../public/assets/route-admin-adapter.js');
require('../../public/assets/route-admin-state.js');
require('../../public/assets/route-admin-form.js');
require('../../public/assets/route-admin-diagnostics.js');
require('../../public/assets/route-admin-view.js');
require('../../public/assets/route-admin-api.js');
require('../../public/assets/route-admin.js');

async function verify() {
  assert.equal(typeof documentClickHandler, 'function');
  assert.equal(typeof globalThis.XboardRouteAdapter, 'object');
  assert.equal(typeof globalThis.XboardRouteAdmin.state, 'object');
  assert.equal(typeof globalThis.XboardRouteAdmin.form.read, 'function');
  assert.equal(typeof globalThis.XboardRouteAdmin.diagnostics.renderSummary, 'function');
  assert.equal(typeof globalThis.XboardRouteAdmin.view.renderList, 'function');
  assert.equal(typeof globalThis.XboardRouteAdmin.api.fetchCatalog, 'function');
  assert.equal(existingContent.style.display, '');

  await documentClickHandler({
    target: {
      closest(selector) {
        return selector === 'a[href]' ? routeLink : null;
      },
    },
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(inserted, true, 'route link must open the embedded structured page');
  assert.equal(pushedLocation, '/server/route', 'route click must keep browser history in sync');
  assert.match(style.textContent, /xe-layout/);
  assert.equal(existingContent.style.display, 'none');
  assert.equal(routeLink['aria-current'], 'page');
  assert.equal(authorizationHeader, 'Bearer token-123');
  assert.match(elements.get('xe-list').innerHTML, /国内直连/);
  assert.match(elements.get('xe-list').innerHTML, /绑定节点/);
  assert.match(elements.get('xe-list').innerHTML, /停用/);
  assert.match(elements.get('xe-list').innerHTML, /规则被遮蔽/);
  assert.match(elements.get('xe-diagnostic-summary').innerHTML, /1 个冲突/);
  assert.match(elements.get('xe-target-options').innerHTML, /warp/);

  const otherLink = createElement({
    href: '/server/manage',
    getAttribute(name) { return name === 'href' ? this.href : this[name]; },
    closest() { return null; },
  });
  documentClickHandler({
    target: {
      closest(selector) {
        return selector === 'a[href]' ? otherLink : null;
      },
    },
    preventDefault() {},
    stopImmediatePropagation() {},
  });

  assert.equal(inserted, false);
  assert.equal(existingContent.style.display, '');
  assert.equal(routeLink['aria-current'], undefined);

  window.location.pathname = '/server/route';
  window.location.href = 'https://panel.test/server/route';
  windowListeners.popstate();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(inserted, true, 'popstate must reopen the page on the route URL');
  windowListeners.hashchange();
  assert.equal(inserted, false, 'hash navigation must close the embedded page');

  const routeSource = fs.readFileSync('public/assets/route-admin.js', 'utf8');
  assert.doesNotMatch(routeSource, /\bdocument\b|\bwindow\b|localStorage/);
  assert.ok(routeSource.split('\n').length < 600, 'route controller should stay a thin orchestrator');
  for (const moduleName of ['state', 'form', 'diagnostics', 'view', 'api']) {
    const moduleSource = fs.readFileSync(`public/assets/route-admin-${moduleName}.js`, 'utf8');
    assert.doesNotMatch(moduleSource, /\bdocument\b|\bwindow\b|localStorage/, moduleName);
  }
  console.log('structured route page test passed');
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
