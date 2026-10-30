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
  'xe-target-options', 'xe-message', 'xe-preview', 'xe-list', 'xe-search',
  'xe-bind-modal', 'xe-bind-title', 'xe-node-search', 'xe-node-bound',
  'xe-bind-message', 'xe-node-list', 'xe-node-page',
].forEach((id) => elements.set(id, createElement()));

content.insertAdjacentHTML = (position, html) => {
  assert.equal(position, 'beforeend');
  if (html.includes('xboard-route-v2-page')) inserted = true;
};

global.window = {
  settings: { secure_path: 'test' },
  addEventListener() {},
};
global.localStorage = {
  getItem: () => null,
};
global.fetch = async (url) => ({
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
        }],
  }),
});
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

require('../../public/assets/route-admin.js');

async function verify() {
  assert.equal(typeof documentClickHandler, 'function');
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
  assert.match(style.textContent, /xe-layout/);
  assert.equal(existingContent.style.display, 'none');
  assert.equal(routeLink['aria-current'], 'page');
  assert.match(elements.get('xe-list').innerHTML, /国内直连/);
  assert.match(elements.get('xe-list').innerHTML, /绑定节点/);
  assert.match(elements.get('xe-list').innerHTML, /停用/);
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
  console.log('structured route page test passed');
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
