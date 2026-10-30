'use strict';

const assert = require('node:assert/strict');

const classList = (owner) => {
  const values = new Set(String(owner.className || '').split(/\s+/).filter(Boolean));
  return {
    values,
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); },
    toggle(value, force) {
      const enabled = force === undefined ? !values.has(value) : Boolean(force);
      if (enabled) values.add(value);
      else values.delete(value);
      return enabled;
    },
  };
};

const element = (extra = {}) => {
  const value = {
    value: '', checked: false, innerHTML: '', textContent: '', className: '',
    id: '', href: '', hidden: false, disabled: false, dataset: {}, parentElement: null,
    children: [], style: { display: '' }, listeners: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); this[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; delete this[name]; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    matches() { return false; },
    ...extra,
  };
  value.classList = classList(value);
  return value;
};

let inserted = false;
let menuInserted = false;
let migrationCallback = null;
let documentClick = null;
let hashChange = null;
const elements = new Map();
const styles = new Map();
const sectionLinks = [];

const native = element();
const content = element({ children: [native] });
const page = element({
  remove() {
    inserted = false;
  },
});
const panels = ['overview', 'traffic', 'rules', 'users', 'settings'].map((name) => {
  const panel = element({ hidden: name !== 'overview' });
  panel.dataset.saPanel = name;
  return panel;
});
const filterToolbar = element();

page.querySelectorAll = (selector) => selector === '[data-sa-panel]' ? panels : [];
page.querySelector = (selector) => selector === '[data-sa-filter-toolbar]' ? filterToolbar : null;
content.insertAdjacentHTML = (_position, markup) => {
  assert.match(markup, /id="xboard-security-audit-page"/);
  assert.match(markup, /data-sa-panel="overview"/);
  assert.match(markup, /data-sa-panel="traffic" hidden/);
  assert.match(markup, /data-sa-panel="settings" hidden/);
  inserted = true;
};

const idNames = [
  'sa-range', 'sa-user-id', 'sa-node-id', 'sa-destination', 'sa-action', 'sa-message',
  'sa-cards', 'sa-routes', 'sa-users', 'sa-destinations', 'sa-nodes', 'sa-events',
  'sa-event-count', 'sa-page-info', 'sa-ingest-url', 'sa-secret', 'sa-retention',
  'sa-settings-message', 'sa-section-title', 'sa-section-copy',
];
idNames.forEach((id) => elements.set(id, element({ id })));
elements.get('sa-range').value = '24h';
elements.get('sa-action').value = '';

const list = element();
const groupLabelNode = { nodeType: 3, nodeValue: '系统管理' };
const groupIcon = element({ tag: 'DIV' });
const groupChevron = element({ tag: 'SPAN', className: 'ml-auto transition-all' });
const menuLink = element({
  tag: 'BUTTON',
  className: 'official-group-button group h-12 w-full justify-start rounded-none px-6 text-xs',
  childNodes: [groupIcon, groupLabelNode, groupChevron],
  children: [groupIcon, groupChevron],
  listeners: {},
});
menuLink.lastElementChild = groupChevron;
menuLink.querySelector = (selector) => selector === 'div' ? groupIcon : null;
menuLink.closest = () => null;

const submenu = element({ tag: 'DIV', className: 'official-content collapsibleDropdown' });
const rowList = element({ tag: 'UL' });
rowList.children = [];
Object.defineProperty(rowList, 'firstChild', {
  get() { return this.children[0] || null; },
});
rowList.removeChild = function removeChild(child) {
  this.children = this.children.filter((value) => value !== child);
};
rowList.appendChild = function appendChild(child) {
  this.children.push(child);
};
rowList.querySelectorAll = function querySelectorAll(selector) {
  const links = selector === '[data-sa-section]'
  ? this.children.map((row) => row._link).filter((link) => link?.dataset.saSection)
  : [];
  if (selector === '[data-sa-section]') {
    sectionLinks.splice(0, sectionLinks.length, ...links);
  }
  return links;
};

const makeTemplateRow = () => {
  const link = element({
    tag: 'A',
    className: 'official-sub-link text-xs border-l border-l-slate-500 h-10 w-full',
  });
  Object.defineProperty(link, 'innerHTML', {
    set(markup) {
      this._html = markup;
      const match = String(markup).match(/<\/div>([^<]+)$/);
      this.textContent = match ? match[1] : '';
    },
    get() {
      return this._html || '';
    },
  });
  link.closest = (selector) => selector === '[data-sa-section]' && link.dataset.saSection
    ? link
    : null;
  const row = element({ tag: 'LI', _link: link });
  row.querySelector = (selector) => selector === 'a[href]' || selector === 'a' ? link : null;
  row.cloneNode = () => makeTemplateRow();
  return row;
};
for (let index = 0; index < 6; index += 1) rowList.appendChild(makeTemplateRow());

const menu = element({
  matches() { return false; },
  listeners: {},
});
menu.querySelector = (selector) => {
  if (selector === 'button') return menuLink;
  if (selector === '.collapsibleDropdown') return submenu;
  if (selector === 'ul') return rowList;
  return null;
};
menu.querySelectorAll = (selector) => selector === '[data-sa-section]'
  ? rowList.querySelectorAll('[data-sa-section]')
  : [];
menu.addEventListener = (name, listener) => {
  menu.listeners[name] = listener;
};

const templateGroup = element({
  querySelector(selector) {
    return selector === 'button[data-state]' ? true : null;
  },
  cloneNode() {
    return menu;
  },
});

const dashboardItem = element({
  parentElement: list,
  insertAdjacentElement(position, item) {
    assert.equal(position, 'afterend');
    assert.equal(item, menu);
    menuInserted = true;
  },
});
const dashboard = element({
  className: 'official-nav-item',
  href: '#/dashboard',
  textContent: '仪表盘',
});
dashboard.attributes['aria-current'] = 'page';
dashboard.getAttribute = (name) => name === 'href' ? '#/dashboard' : dashboard.attributes[name];
dashboard.closest = (selector) => selector === 'li' ? dashboardItem : null;
list.children = [dashboardItem, templateGroup];

global.window = {
  settings: { secure_path: 'test' },
  addEventListener(name, listener) {
    if (name === 'hashchange') hashChange = listener;
  },
};
global.localStorage = {
  length: 1,
  key: () => 'Xboard_access_token',
  getItem: (key) => key === 'Xboard_access_token' ? JSON.stringify({ value: 'token' }) : null,
};
const sessionValues = new Map();
global.sessionStorage = {
  getItem: (key) => sessionValues.get(key) || null,
  setItem: (key, value) => sessionValues.set(key, String(value)),
  removeItem: (key) => sessionValues.delete(key),
};

global.document = {
  documentElement: element(),
  head: {
    appendChild(style) {
      styles.set(style.id, style);
    },
  },
  createElement(tag) {
    return element({ tag });
  },
  createTextNode(value) {
    return { nodeType: 3, nodeValue: String(value) };
  },
  getElementById(id) {
    if (id === 'xboard-security-audit-page') return inserted ? page : null;
    if (id === 'xboard-security-audit-menu') return menuInserted ? menu : null;
    if (id === 'content') return content;
    if (styles.has(id)) return styles.get(id);
    return inserted ? (elements.get(id) || null) : null;
  },
  querySelectorAll(selector) {
    if (selector === 'a[href]' || selector === 'nav a[href]') return [dashboard];
    return [];
  },
  addEventListener(name, listener) {
    if (name === 'click') documentClick = listener;
  },
};
global.MutationObserver = class {
  constructor(callback) { migrationCallback = callback; }
  observe() {}
};

const requestedUrls = [];
global.fetch = async (url) => {
  requestedUrls.push(String(url));
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'success',
      data: String(url).includes('/events?')
        ? { data: [], current_page: 1, last_page: 2, total: 73 }
        : String(url).includes('/settings')
          ? { webhook_secret: 'secret', retention_days: 30, ingest_url: 'https://panel.test/api/v1/traffic-audit/events' }
          : {
              cards: { total_bytes: 2048, upload_bytes: 1024, download_bytes: 1024, connections: 4, blocked_events: 1 },
              routes: [{ route_id: 38, route_tag: 'panel-route-38', action: 'block', outbound: 'block', route_source: 'kernel', connections: 2 }],
              users: [{ user_id: 7, user_name: 'audit@example.com', connections: 3, upload_bytes: 100, download_bytes: 200, blocked_events: 1 }],
              destinations: [],
              nodes: [],
            },
    }),
  };
};

const immediateTimeout = global.setTimeout;
global.setTimeout = (callback) => {
  callback();
  return 1;
};

require('../../public/assets/security-audit-adapter.js');
require('../../public/assets/security-audit-state.js');
require('../../public/assets/security-audit-api.js');
require('../../public/assets/security-audit-view.js');
require('../../public/assets/security-audit.js');
global.setTimeout = immediateTimeout;

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function verify() {
  migrationCallback();
  assert.equal(menuInserted, true);
  assert.equal(menu.id, 'xboard-security-audit-menu');
  assert.equal(groupLabelNode.nodeValue, '安全审计');
  assert.equal(sectionLinks.length, 5);
  assert.deepEqual(sectionLinks.map((link) => link.textContent), ['审计概览', '流量明细', '规则命中', '用户审计', '审计设置']);
  assert.equal(menu.classList.contains('sa-nav-group'), true);
  assert.equal(submenu.id, 'xboard-security-audit-menu-sections');
  assert.equal(menuLink.attributes['aria-controls'], submenu.id);
  assert.match(sectionLinks[0].className, /border-l-slate-500/);
  assert.match(sectionLinks[0].className, /text-xs/);
  assert.match(styles.get('xboard-security-audit-menu-style').textContent, /sa-nav-sub\[hidden\]/);
  assert.equal(submenu.hidden, true);
  assert.equal(menuLink.attributes['aria-expanded'], 'false');
  assert.equal(sessionValues.get('xboard_security_audit_expanded'), undefined);

  const menuClick = menu.listeners.click;
  assert.equal(typeof menuClick, 'function');
  menuClick({ preventDefault() {}, stopPropagation() {}, target: menuLink });
  await flush();
  assert.equal(inserted, true);
  assert.equal(native.style.display, 'none');
  assert.equal(menuLink.attributes['aria-current'], 'page');
  assert.equal(menuLink.classList.contains('active'), true);
  assert.equal(menuLink.classList.contains('bg-secondary'), true);
  assert.equal(submenu.hidden, false);
  assert.equal(sessionValues.get('xboard_security_audit_expanded'), '1');
  assert.equal(dashboard.attributes['aria-current'], undefined);
  assert.equal(panels.find((panel) => panel.dataset.saPanel === 'overview').hidden, false);
  assert.equal(panels.filter((panel) => !panel.hidden).length, 1);
  assert.match(elements.get('sa-cards').innerHTML, /总流量/);
  assert.match(elements.get('sa-users').innerHTML, /data-sa-user="7"/);
  assert.equal(sessionValues.get('xboard_security_audit_section'), 'overview');

  const rules = sectionLinks.find((link) => link.dataset.saSection === 'rules');
  menuClick({ preventDefault() {}, stopPropagation() {}, target: rules });
  await flush();
  assert.equal(panels.find((panel) => panel.dataset.saPanel === 'rules').hidden, false);
  assert.equal(panels.filter((panel) => !panel.hidden).length, 1);
  assert.equal(elements.get('sa-section-title').textContent, '规则命中');
  assert.equal(rules.classList.contains('active'), true);
  assert.equal(rules.classList.contains('bg-secondary'), true);
  assert.equal(sectionLinks.find((link) => link.dataset.saSection === 'overview').classList.contains('active'), false);
  assert.equal(sessionValues.get('xboard_security_audit_section'), 'rules');

  const user = element({ dataset: { saUser: '7' } });
  user.closest = (selector) => selector === '[data-sa-user]' ? user : null;
  page.listeners.click({ target: user });
  await flush();
  assert.equal(elements.get('sa-user-id').value, '7');
  assert.equal(panels.find((panel) => panel.dataset.saPanel === 'traffic').hidden, false);
  assert.equal(elements.get('sa-section-title').textContent, '流量明细');
  assert.equal(requestedUrls.some((url) => /user_id=7/.test(url) && /\/events\?/.test(url)), true);
  assert.match(elements.get('sa-events').innerHTML, /没有连接事件/);
  assert.match(elements.get('sa-page-info').textContent, /共 73 条/);

  const settings = sectionLinks.find((link) => link.dataset.saSection === 'settings');
  menuClick({ preventDefault() {}, stopPropagation() {}, target: settings });
  await flush();
  assert.equal(filterToolbar.hidden, true);
  assert.equal(elements.get('sa-secret').value, 'secret');
  assert.equal(elements.get('sa-section-title').textContent, '审计设置');

  documentClick({
    target: {
      closest(selector) {
        return selector === 'a[href]' ? dashboard : null;
      },
    },
  });
  assert.equal(inserted, false);
  assert.equal(native.style.display, '');
  assert.equal(dashboard.attributes['aria-current'], 'page');

  assert.equal(typeof hashChange, 'function');
  console.log('security audit native categories test passed');
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
