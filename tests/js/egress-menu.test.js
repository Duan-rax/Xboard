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
  scrollLeft: 0,
  scrollTop: 0,
  classList: createClassList(),
  listeners: {},
  setAttribute(name, value) { this[name] = value; },
  removeAttribute(name) { delete this[name]; },
  addEventListener(name, listener) { this.listeners[name] = listener; },
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  },
  querySelectorAll() { return []; },
  ...extra,
});

let installed = null;
let style = null;
let mainInserted = false;
let bindInserted = false;
let clickHandler = null;
let documentClickHandler = null;
let mutationCallback = null;
let clampScrollOnListFetch = false;

const mainModal = createElement();
mainModal.remove = () => { mainInserted = false; };
const bindModal = createElement();
const list = createElement();
const pager = createElement();
const formElements = new Map();
[
  'id', 'name', 'host', 'port', 'sni', 'username', 'password',
  'protocol', 'config', 'tls', 'insecure', 'enabled',
  'clear-username', 'clear-password', 'search', 'message', 'hint',
].forEach((id) => formElements.set(`xe-${id}`, createElement()));

const bindElements = new Map();
['bind-title', 'bind-search', 'bind-filter', 'bind-list', 'bind-pager', 'bind-message']
  .forEach((id) => bindElements.set(`xe-${id}`, createElement()));

const topGroup = createElement({ textContent: '节点管理' });
const clonedIconHost = { innerHTML: '', textContent: '' };
const clonedLabel = { nodeType: 3, nodeValue: '路由管理' };
const clonedAnchor = createElement({
  textContent: '路由管理',
  className: 'menu-link',
  childNodes: [{ nodeType: 1, textContent: '' }, clonedLabel],
  matches: selector => selector === 'a',
  querySelectorAll(selector) {
    if (selector === '*') return [clonedIconHost];
    if (selector === 'div') return [clonedIconHost];
    return [];
  },
});
clonedAnchor.addEventListener = (name, listener) => {
  if (name === 'click') clickHandler = listener;
};

const clonedItem = createElement({
  matches: () => false,
  contains: element => element === clonedAnchor,
  querySelectorAll(selector) {
    if (selector === 'a[href]') return [clonedAnchor];
    if (selector === '[data-state]') return [];
    return [];
  },
});

const routeAnchor = createElement({
  textContent: '路由管理',
  href: '/server/route',
  className: 'menu-link bg-secondary',
  'aria-current': 'page',
  getAttribute(name) {
    return name === 'href' ? this.href : this[name];
  },
  closest(selector) {
    if (selector === 'li') return routeItem;
    return null;
  },
});

const routeItem = createElement({
  textContent: '路由管理',
  cloneNode() { return clonedItem; },
  insertAdjacentElement(position, item) {
    assert.equal(position, 'afterend');
    installed = item;
  },
});

const routeContent = createElement({ style: { display: '' } });
const bindSlot = createElement({
  insertAdjacentHTML(position, html) {
    assert.equal(position, 'beforeend');
    if (html.includes('xboard-egress-binding-modal')) bindInserted = true;
  },
});
const contentHost = createElement({
  children: [routeContent],
  insertAdjacentHTML(position, html) {
    assert.equal(position, 'beforeend');
    if (html.includes('xboard-egress-management-modal')) mainInserted = true;
  },
});

global.window = { addEventListener() {} };
global.localStorage = {
  length: 0,
  getItem: () => null,
  key: () => null,
};
global.fetch = async (url, options = {}) => {
  if (clampScrollOnListFetch && String(url).includes('/fetch?')) {
    contentHost.scrollTop = 0;
    mainModal.scrollTop = 0;
    clampScrollOnListFetch = false;
  }
  if (String(url).includes('/server/egress/save') && options.method === 'POST') {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: {
          id: 7,
          name: 'Test egress',
          protocol: 'socks5',
          host: '127.0.0.1',
          port: 1080,
          tls_enabled: false,
          tls_server_name: '',
          allow_insecure: false,
          enabled: true,
          config: {},
        },
      }),
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'success',
      data: {
        items: [],
        pagination: { current_page: 1, last_page: 1, total: 0 },
      },
    }),
  };
};
global.document = {
  documentElement: {},
  head: { appendChild: (element) => { style = element; } },
  body: {},
  createElement: () => createElement(),
  getElementById(id) {
    if (id === 'xboard-egress-management-menu') return installed;
    if (id === 'xboard-egress-style') return style;
    if (id === 'content') return contentHost;
    if (id === 'xboard-egress-management-modal') return mainInserted ? mainModal : null;
    if (id === 'xboard-egress-binding-modal') return bindInserted ? bindModal : null;
    if (id === 'xe-bind-slot') return mainInserted ? bindSlot : null;
    if (id === 'xe-list') return mainInserted ? list : null;
    if (id === 'xe-pager') return mainInserted ? pager : null;
    if (formElements.has(id)) return mainInserted ? formElements.get(id) : null;
    if (bindElements.has(id)) return bindInserted ? bindElements.get(id) : null;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === 'a[href]') return [routeAnchor];
    if (selector === 'nav a[href]') return [routeAnchor];
    if (selector === '.xe-menu-suppressed') {
      return routeAnchor.classList.contains('xe-menu-suppressed') ? [routeAnchor] : [];
    }
    if (selector === 'a,button') return [topGroup, routeAnchor];
    if (selector === 'main') return [contentHost];
    return [];
  },
  addEventListener(name, listener) {
    if (name === 'click') documentClickHandler = listener;
  },
};
global.MutationObserver = class {
  constructor(callback) { mutationCallback = callback; }
  observe() {}
};
global.setTimeout = (callback) => { callback(); return 1; };

require('../../public/assets/egress-admin-adapter.js');
require('../../public/assets/egress-admin-state.js');
require('../../public/assets/egress-admin-form.js');
require('../../public/assets/egress-admin-view.js');
require('../../public/assets/egress-admin-api.js');
require('../../public/assets/egress-admin.js');

assert.equal(installed, clonedItem, 'the leaf list item must be cloned');
assert.equal(typeof globalThis.XboardEgressAdapter, 'object');
assert.equal(typeof globalThis.XboardEgressAdmin.state, 'object');
assert.equal(typeof globalThis.XboardEgressAdmin.form.read, 'function');
assert.equal(typeof globalThis.XboardEgressAdmin.view.renderCatalog, 'function');
assert.equal(typeof globalThis.XboardEgressAdmin.api.fetch, 'function');
assert.equal(installed.id, 'xboard-egress-management-menu');
assert.equal(clonedAnchor.href, '#');
assert.equal(clonedLabel.nodeValue, '出站管理');
assert.match(clonedIconHost.innerHTML, /xe-menu-icon/);
assert.equal(typeof clickHandler, 'function');
assert.match(style.textContent, /\.xe-page-shell/);
assert.doesNotMatch(style.textContent, /position:fixed/);
assert.match(style.textContent, /\.xe-binding > \.xe-page-shell > \.xe-main/);
assert.doesNotMatch(style.textContent, /\.xe-binding \.xe-main/);

async function verifyModalOpen() {
  contentHost.scrollTop = 320;
  mainModal.scrollTop = 0;
  clampScrollOnListFetch = true;
  clickHandler({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(mainInserted, true, 'clicking the menu must insert the embedded page');
  assert.equal(bindInserted, true, 'the page must include the embedded binding view');
  assert.equal(mainModal.classList.contains('open'), true);
assert.equal(clonedAnchor['aria-current'], 'page');
assert.match(clonedAnchor.className, /bg-secondary/);
assert.equal(routeAnchor['aria-current'], undefined);
assert.equal(routeContent.style.display, 'none');
  assert.match(list.innerHTML, /没有匹配的出站配置/);
  assert.equal(contentHost.scrollTop, 0, 'opening the page should start at the top');

  contentHost.scrollTop = 240;
  mainModal.scrollTop = 180;
  clampScrollOnListFetch = true;
  await mainModal.listeners.click({
    target: {
      closest(selector) {
        return selector === '[data-xe-refresh]' ? {} : null;
      },
    },
  });
  assert.equal(contentHost.scrollTop, 240, 'catalog refresh must preserve the host scroll position');
  assert.equal(mainModal.scrollTop, 180, 'catalog refresh must preserve the page scroll position');

  formElements.get('xe-name').value = 'Test egress';
  formElements.get('xe-host').value = '127.0.0.1';
  formElements.get('xe-port').value = '1080';
  formElements.get('xe-protocol').value = 'socks5';
  formElements.get('xe-config').value = '{}';
  contentHost.scrollTop = 360;
  mainModal.scrollTop = 260;
  clampScrollOnListFetch = true;
  await mainModal.listeners.click({
    target: {
      closest(selector) {
        return selector === '[data-xe-save]' ? { disabled: false } : null;
      },
    },
  });
  assert.equal(contentHost.scrollTop, 360, 'save must preserve the host scroll position');
  assert.equal(mainModal.scrollTop, 260, 'save must preserve the page scroll position');

  routeAnchor['aria-current'] = 'page';
  routeAnchor.className = 'menu-link bg-secondary';
  mutationCallback();
  assert.equal(routeAnchor['aria-current'], undefined);
  assert.equal(clonedAnchor['aria-current'], 'page');

  documentClickHandler({
    target: {
      closest(selector) {
        return selector === 'a[href]' ? routeAnchor : null;
      },
    },
  });
  assert.equal(clonedAnchor['aria-current'], undefined);
  assert.equal(routeAnchor['aria-current'], 'page');
  assert.match(routeAnchor.className, /bg-secondary/);

  const controllerSource = fs.readFileSync('public/assets/egress-admin.js', 'utf8');
  assert.doesNotMatch(controllerSource, /\bdocument\b|\bwindow\b|localStorage|(?<![.\w])fetch\(/);
  assert.ok(controllerSource.split('\n').length < 600, 'egress controller should stay a thin orchestrator');
  for (const moduleName of ['state', 'form', 'view', 'api']) {
    const moduleSource = fs.readFileSync(`public/assets/egress-admin-${moduleName}.js`, 'utf8');
    assert.doesNotMatch(moduleSource, /\bdocument\b|\bwindow\b|localStorage|(?<![.\w])fetch\(/, moduleName);
  }
  console.log('egress menu, embedded page, and catalog test passed');
}

verifyModalOpen().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
