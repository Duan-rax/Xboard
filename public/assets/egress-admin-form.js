/* Egress form model, protocol metadata and serialization. */
(() => {
  'use strict';

  const adapter = globalThis.XboardEgressAdapter;
  const root = globalThis.XboardEgressAdmin = globalThis.XboardEgressAdmin || {};
  if (!adapter || !root.state) {
    throw new Error('egress adapter/state modules must load before egress-admin-form.js');
  }

  const protocolLabels = {
    socks5: 'SOCKS5',
    http: 'HTTP/HTTPS',
    shadowsocks: 'Shadowsocks',
    vless: 'VLESS',
    trojan: 'Trojan',
  };
  const protocolHints = {
    socks5: 'SOCKS5：填写地址和端口；需要认证时再填用户名/密码。高级 JSON 保持 {}。',
    http: 'HTTP/HTTPS 代理：可选用户名/密码；勾选 TLS 后可填写 SNI。高级 JSON 保持 {}。',
    shadowsocks: 'Shadowsocks：必须填写密码。高级 JSON 示例 {"method":"aes-256-gcm"}。',
    vless: 'VLESS：高级 JSON 必须包含 uuid。Reality 另加 reality.public_key 与 reality.short_id，并填写 TLS SNI。',
    trojan: 'Trojan：必须填写密码。高级 JSON 保持 {}。',
  };
  const protocolTemplates = {
    socks5: '{}',
    http: '{}',
    shadowsocks: '{\n  "method": "aes-256-gcm"\n}',
    vless: '{\n  "uuid": "",\n  "flow": "xtls-rprx-vision",\n  "network": "tcp"\n}',
    trojan: '{}',
  };

  const checked = (id) => Boolean(adapter.get(id)?.checked);
  const valueOf = (id) => (adapter.get(id)?.value || '').trim();
  const rawValueOf = (id) => adapter.get(id)?.value || '';

  const read = () => {
    const configText = valueOf('xe-config') || '{}';
    let config;
    try {
      config = JSON.parse(configText);
    } catch (_) {
      throw new Error('高级 JSON 格式不正确');
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('高级 JSON 必须是对象，例如 {}');
    }

    const body = {
      name: valueOf('xe-name'),
      protocol: valueOf('xe-protocol'),
      host: valueOf('xe-host'),
      port: Number(valueOf('xe-port')),
      tls_enabled: checked('xe-tls'),
      tls_server_name: valueOf('xe-sni') || null,
      allow_insecure: checked('xe-insecure'),
      enabled: checked('xe-enabled'),
      config,
      clear_username: checked('xe-clear-username'),
      clear_password: checked('xe-clear-password'),
    };
    if (!body.name) throw new Error('请填写名称');
    if (!body.host) throw new Error('请填写地址');
    if (!Number.isInteger(body.port) || body.port < 1 || body.port > 65535) {
      throw new Error('端口必须是 1-65535 之间的整数');
    }

    const id = valueOf('xe-id');
    if (id) body.id = Number(id);
    const username = valueOf('xe-username');
    const password = rawValueOf('xe-password');
    if (username) body.username = username;
    if (password !== '') body.password = password;
    return body;
  };

  const syncProtocolUi = () => {
    const protocol = valueOf('xe-protocol') || 'socks5';
    const hint = adapter.get('xe-hint');
    if (hint) hint.textContent = protocolHints[protocol] || '';

    const config = adapter.get('xe-config');
    if (!config) return;
    const editing = Boolean(valueOf('xe-id'));
    const current = config.value.trim();
    const currentIsTemplate = Object.values(protocolTemplates)
      .some((template) => template.trim() === current);
    if (!editing && (!current || currentIsTemplate)) {
      config.value = protocolTemplates[protocol] || '{}';
    }
  };

  const fill = (proxy) => {
    ['id', 'name', 'host', 'port'].forEach((key) => {
      const element = adapter.get(`xe-${key}`);
      if (element) element.value = proxy[key] ?? '';
    });
    adapter.get('xe-protocol').value = proxy.protocol;
    adapter.get('xe-sni').value = proxy.tls_server_name || '';
    adapter.get('xe-tls').checked = Boolean(proxy.tls_enabled);
    adapter.get('xe-insecure').checked = Boolean(proxy.allow_insecure);
    adapter.get('xe-enabled').checked = Boolean(proxy.enabled);
    adapter.get('xe-config').value = JSON.stringify(proxy.config || {}, null, 2);
    adapter.get('xe-username').value = '';
    adapter.get('xe-password').value = '';
    adapter.get('xe-username').placeholder = proxy.username_configured ? '已保存，留空保持不变' : '可选';
    adapter.get('xe-password').placeholder = proxy.password_configured ? '已保存，留空保持不变' : '可选';
    adapter.get('xe-clear-username').checked = false;
    adapter.get('xe-clear-password').checked = false;
    syncProtocolUi();
    root.showMessage(`正在编辑 #${proxy.id}；留空用户名/密码会保留原值。`);
  };

  const reset = () => {
    ['id', 'name', 'host', 'port', 'sni', 'username', 'password'].forEach((key) => {
      const element = adapter.get(`xe-${key}`);
      if (element) element.value = '';
    });
    adapter.get('xe-protocol').value = 'socks5';
    adapter.get('xe-config').value = '{}';
    adapter.get('xe-tls').checked = false;
    adapter.get('xe-insecure').checked = false;
    adapter.get('xe-enabled').checked = true;
    adapter.get('xe-clear-username').checked = false;
    adapter.get('xe-clear-password').checked = false;
    adapter.get('xe-username').placeholder = '可选';
    adapter.get('xe-password').placeholder = '可选';
    syncProtocolUi();
    root.showMessage('');
  };

  const protocolLabel = (protocol) => protocolLabels[protocol] || protocol;
  const formatTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  };

  root.form = Object.freeze({
    fill,
    formatTime,
    protocolLabel,
    read,
    reset,
    syncProtocolUi,
    valueOf,
  });
})();
