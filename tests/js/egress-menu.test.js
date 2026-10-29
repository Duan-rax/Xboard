'use strict';

const assert = require('node:assert/strict');

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

const mainModal = createElement();
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
const clonedIcon = { textContent: '' };
const clonedLabel = { nodeType: 3, nodeValue: '路由管理' };
const clonedAnchor = createElement({
  textContent: '路由管理',
  childNodes: [{ nodeType: 1, textContent: '' }, clonedLabel],
  matches: selector => selector === 'a',
  querySelectorAll(selector) {
    if (selector === '*') return [clonedIcon];
    return [];
  },
});
clonedAnchor.addEventListener = (name, listener) => {
  if (name === 'click') clickHandler = listener;
};

const clonedItem = createElement({
  matches: () => false,
  querySelectorAll(selector) {
    if (selector === 'a[href]') return [clonedAnchor];
    if (selector === '[data-state]') return [];
    return [];
  },
});

const routeAnchor = createElement({
  textContent: '路由管理',
  href: '/server/route',
  getAttribute(name) {
    return name === 'href' ? this.href : this[name];
  },
  closest(selector) {
    assert.equal(selector, 'li');
    return routeItem;
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

global.window = {};
global.localStorage = {
  length: 0,
  getItem: () => null,
  key: () => null,
};
global.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    status: 'success',
    data: {
      items: [],
      pagination: { current_page: 1, last_page: 1, total: 0 },
    },
  }),
});
global.document = {
  documentElement: {},
  head: { appendChild: (element) => { style = element; } },
  body: {
    insertAdjacentHTML(position, html) {
      assert.equal(position, 'beforeend');
      if (html.includes('xboard-egress-management-modal')) mainInserted = true;
      if (html.includes('xboard-egress-binding-modal')) bindInserted = true;
    },
  },
  createElement: () => createElement(),
  getElementById(id) {
    if (id === 'xboard-egress-management-menu') return installed;
    if (id === 'xboard-egress-style') return style;
    if (id === 'xboard-egress-management-modal') return mainInserted ? mainModal : null;
    if (id === 'xboard-egress-binding-modal') return bindInserted ? bindModal : null;
    if (id === 'xe-list') return mainInserted ? list : null;
    if (id === 'xe-pager') return mainInserted ? pager : null;
    return formElements.get(id) || bindElements.get(id) || null;
  },
  querySelectorAll(selector) {
    if (selector === 'a[href]') return [routeAnchor];
    if (selector === 'a,button') return [topGroup, routeAnchor];
    return [];
  },
  addEventListener() {},
};
global.MutationObserver = class { observe() {} };
global.setTimeout = (callback) => { callback(); return 1; };

require('../../public/assets/egress-admin.js');

assert.equal(installed, clonedItem, 'the leaf list item must be cloned');
assert.equal(installed.id, 'xboard-egress-management-menu');
assert.equal(clonedAnchor.href, '#');
assert.equal(clonedLabel.nodeValue, '出站管理');
assert.equal(clonedIcon.textContent, '', 'the cloned icon must be preserved');
assert.equal(typeof clickHandler, 'function');
assert.match(style.textContent, /background:hsl\(var\(--card,0 0% 100%\)\)/);
assert.doesNotMatch(style.textContent, /background:var\(--background/);

async function verifyModalOpen() {
  clickHandler({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(mainInserted, true, 'clicking the menu must insert the main modal');
  assert.equal(bindInserted, true, 'clicking the menu must insert the binding modal');
  assert.equal(mainModal.classList.contains('open'), true);
  assert.match(list.innerHTML, /没有匹配的出站配置/);

  console.log('egress menu insertion and modal-open test passed');
}

verifyModalOpen().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
