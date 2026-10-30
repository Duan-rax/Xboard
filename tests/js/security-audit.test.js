'use strict';

const assert = require('node:assert/strict');

const classList = () => ({
  values: new Set(),
  add(value) { this.values.add(value); },
  remove(value) { this.values.delete(value); },
  contains(value) { return this.values.has(value); },
});
const element = (extra = {}) => ({
  value: '', checked: false, innerHTML: '', textContent: '', className: '',
  style: { display: '' }, classList: classList(), listeners: {},
  setAttribute(name, value) { this[name] = value; },
  removeAttribute(name) { delete this[name]; },
  addEventListener(name, listener) { this.listeners[name] = listener; },
  querySelector() { return null; }, querySelectorAll() { return []; },
  closest() { return null; }, ...extra,
});

let inserted = false;
let menuInserted = false;
let menu = null;
let menuClick = null;
let documentClick = null;
let mutation = null;
const page = element();
page.remove = () => { inserted = false; };
const content = element();
const native = element();
content.children = [native];
content.insertAdjacentHTML = (_position, html) => {
  if (html.includes('xboard-security-audit-page')) inserted = true;
};
const dashboard = element({
  href: '#/dashboard',
  textContent: '仪表盘',
  getAttribute(name) { return name === 'href' ? this.href : this[name]; },
  closest(selector) { return selector === 'li' ? dashboardItem : null; },
});
const dashboardLink = element({
  textContent: '仪表盘',
  getAttribute(name) { return name === 'href' ? '#/dashboard' : this[name]; },
});
dashboardLink.addEventListener = (name, listener) => {
  if (name === 'click') menuClick = listener;
};
const dashboardItem = element({
  textContent: '仪表盘',
  cloneNode() { return menu; },
  insertAdjacentElement(position, value) {
    assert.equal(position, 'afterend');
    assert.equal(value, menu);
    menuInserted = true;
  },
});
menu = element({
  childNodes: [{ nodeType: 3, nodeValue: '仪表盘' }],
  matches(selector) { return selector === 'a'; },
  querySelectorAll(selector) {
    if (selector === '*') return [];
    if (selector === 'div') return [element({ innerHTML: '' })];
    return [];
  },
});
menu.addEventListener = dashboardLink.addEventListener;

const ids = [
  'sa-range', 'sa-user-id', 'sa-node-id', 'sa-destination', 'sa-action', 'sa-message',
  'sa-cards', 'sa-routes', 'sa-users', 'sa-destinations', 'sa-nodes', 'sa-events',
  'sa-page-info', 'sa-ingest-url', 'sa-secret', 'sa-retention', 'sa-settings-message',
];
const elements = new Map(ids.map((id) => [id, element()]));
const style = element();
global.window = {
  settings: { secure_path: 'test' },
  addEventListener() {},
};
global.localStorage = {
  length: 1,
  key: () => 'Xboard_access_token',
  getItem: (key) => key === 'Xboard_access_token' ? JSON.stringify({ value: 'token' }) : null,
};
global.document = {
  documentElement: element(),
  head: { appendChild(value) { style.id = value.id; style.textContent = value.textContent; } },
  createElement: () => element(),
  getElementById(id) {
    if (id === 'xboard-security-audit-page') return inserted ? page : null;
    if (id === 'xboard-security-audit-style') return style.id ? style : null;
    if (id === 'xboard-security-audit-menu') return menuInserted ? menu : null;
    if (id === 'content') return content;
    return inserted ? (elements.get(id) || null) : null;
  },
  querySelectorAll(selector) {
    if (selector === 'a[href]' || selector === 'nav a[href]') return [dashboard];
    return [];
  },
  addEventListener(name, listener) { if (name === 'click') documentClick = listener; },
};
global.MutationObserver = class {
  constructor(callback) { mutation = callback; }
  observe() {}
};
global.sessionStorage = { value: null, getItem() { return this.value; }, setItem(_k, value) { this.value = value; }, removeItem() { this.value = null; } };
global.fetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => ({
    status: 'success',
    data: String(url).includes('/events?')
      ? { data: [], current_page: 1, last_page: 1, total: 0 }
      : String(url).includes('/settings')
        ? { webhook_secret: 'secret', retention_days: 30, ingest_url: 'https://panel.test/api/v1/traffic-audit/events' }
        : {
            cards: { total_bytes: 0, upload_bytes: 0, download_bytes: 0, connections: 0, blocked_events: 0 },
            routes: [], users: [], destinations: [], nodes: [],
          },
  }),
});
const originalSetTimeout = global.setTimeout;
global.setTimeout = (callback) => { callback(); return 1; };

require('../../public/assets/security-audit-adapter.js');
require('../../public/assets/security-audit-state.js');
require('../../public/assets/security-audit-api.js');
require('../../public/assets/security-audit-view.js');
require('../../public/assets/security-audit.js');

async function verify() {
  assert.equal(typeof menuClick, 'function');
  assert.equal(menu.childNodes[0].nodeValue, '安全审计');
  assert.match(style.textContent, /sa-shell/);
  menuClick({ preventDefault() {}, stopPropagation() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inserted, true);
  assert.equal(native.style.display, 'none');
  assert.equal(menu['aria-current'], 'page');
  assert.match(elements.get('sa-cards').innerHTML, /总流量/);
  assert.equal(elements.get('sa-secret').value, 'secret');
  documentClick({
    target: {
      closest(selector) {
        return selector === 'a[href]' ? dashboard : null;
      },
    },
  });
  assert.equal(inserted, false);
  assert.equal(native.style.display, '');
  mutation();
  console.log('security audit native page test passed');
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
