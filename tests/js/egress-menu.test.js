'use strict';

const assert = require('node:assert/strict');

let installed = null;
let style = null;
const icon = { textContent: '' };
const label = { textContent: '路由管理' };

const clonedRoute = {
  id: '',
  textContent: '路由管理',
  matches: selector => selector === 'a',
  setAttribute(name, value) { this[name] = value; },
  removeAttribute(name) { delete this[name]; },
  querySelectorAll(selector) {
    if (selector === '*') return [icon, label];
    if (selector === '[data-state]') return [];
    return [];
  },
  addEventListener() {},
};

const route = {
  textContent: '路由管理',
  cloneNode: () => clonedRoute,
  insertAdjacentElement(position, item) {
    assert.equal(position, 'afterend');
    installed = item;
  },
  parentElement: {
    insertAdjacentElement() {
      throw new Error('menu entry must not be inserted after the shared parent');
    },
  },
};

global.window = {};
global.localStorage = { getItem: () => null };
global.document = {
  documentElement: {},
  head: { appendChild: element => { style = element; } },
  createElement: () => ({}),
  getElementById(id) {
    if (id === 'xboard-egress-management-menu') return installed;
    if (id === 'xboard-egress-style') return style;
    return null;
  },
  querySelectorAll: selector => selector === 'a,button' ? [route] : [],
  addEventListener() {},
};
global.MutationObserver = class { observe() {} };
global.setTimeout = callback => { callback(); return 1; };

require('../../public/assets/egress-admin.js');

assert.equal(installed, clonedRoute);
assert.equal(installed.id, 'xboard-egress-management-menu');
assert.equal(installed.href, '#');
assert.equal(label.textContent, '出站管理');
assert.equal(icon.textContent, '', 'the cloned icon must be preserved');

console.log('egress menu insertion test passed');
