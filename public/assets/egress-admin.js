/*
 * Xboard egress-management extension.
 * Kept dependency-free so it works with the distributed admin SPA even when
 * its React source is not installed. It uses the same Sanctum token already
 * stored by the admin SPA and never returns stored credentials to the browser.
 */
(() => {
  'use strict';
  const menuId = 'xboard-egress-management-menu';
  const modalId = 'xboard-egress-management-modal';
  const adminApiBase = () => `/api/v2/${window.settings?.secure_path || ''}`;
  const apiBase = () => `${adminApiBase()}/server/egress`;
  const token = () => {
    const raw = localStorage.getItem('Vue_Naive_access_token');
    if (!raw) return '';
    try { return JSON.parse(raw)?.value || raw; } catch (_) { return raw; }
  };
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(`${apiBase()}${path}`, {
      method,
      headers: { Authorization: token(), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === 'fail') throw new Error(payload.message || '请求失败');
    return payload.data;
  };
  const adminApi = async (path) => {
    const response = await fetch(`${adminApiBase()}${path}`, {
      headers: { Authorization: token() },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === 'fail') throw new Error(payload.message || '请求失败');
    return payload.data;
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
  const css = `
    #${modalId}{position:fixed;inset:0;z-index:9999;display:none;background:rgba(15,23,42,.48);align-items:center;justify-content:center;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    #${modalId}.open{display:flex}#${modalId} .xe-card{width:min(1100px,94vw);height:min(780px,90vh);overflow:auto;background:#fff;border-radius:16px;box-shadow:0 25px 70px rgba(2,6,23,.35);color:#0f172a}
    #${modalId} .xe-head{display:flex;justify-content:space-between;align-items:flex-start;padding:22px 26px;border-bottom:1px solid #e2e8f0}#${modalId} h2{margin:0;font-size:20px}#${modalId} p{margin:6px 0 0;color:#64748b;font-size:13px}
    #${modalId} .xe-main{display:grid;grid-template-columns:1fr 1.25fr;gap:18px;padding:22px 26px}#${modalId} .xe-panel{border:1px solid #e2e8f0;border-radius:12px;padding:16px}#${modalId} .xe-panel h3{margin:0 0 12px;font-size:15px}
    #${modalId} label{display:block;margin:10px 0 5px;color:#475569;font-size:12px;font-weight:600}#${modalId} input,#${modalId} select,#${modalId} textarea{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#0f172a;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}#${modalId} textarea{min-height:82px;resize:vertical}
    #${modalId} .xe-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}#${modalId} .xe-actions{display:flex;gap:8px;margin-top:14px;align-items:center}#${modalId} button{border:0;border-radius:7px;padding:8px 11px;background:#2563eb;color:#fff;cursor:pointer;font-size:13px}#${modalId} button.xe-secondary{background:#e2e8f0;color:#334155}#${modalId} button.xe-danger{background:#dc2626}#${modalId} button:disabled{opacity:.5;cursor:not-allowed}
    #${modalId} table{width:100%;border-collapse:collapse;font-size:13px}#${modalId} th,#${modalId} td{text-align:left;padding:10px 8px;border-bottom:1px solid #e2e8f0;vertical-align:middle}#${modalId} th{color:#64748b;font-size:11px;text-transform:uppercase}#${modalId} .xe-small{font-size:11px;color:#64748b}#${modalId} .xe-status{color:#16a34a;font-size:12px}#${modalId} .xe-error{color:#dc2626;font-size:12px;white-space:pre-wrap}#${modalId} .xe-row-actions{display:flex;gap:6px;flex-wrap:wrap}#${modalId} .xe-toolbar,#${modalId} .xe-pager{display:flex;gap:8px;align-items:center;margin:10px 0}#${modalId} .xe-toolbar input{flex:1}#${modalId} .xe-pager{justify-content:flex-end}#${modalId} .xe-pager span{margin-right:auto}@media(max-width:800px){#${modalId} .xe-main{grid-template-columns:1fr}#${modalId} .xe-card{height:94vh}}
  `;
  const insertStyle = () => { if (!document.getElementById('xboard-egress-style')) { const s=document.createElement('style'); s.id='xboard-egress-style'; s.textContent=css; document.head.appendChild(s); } };
  const modalHtml = () => `<div id="${modalId}" aria-hidden="true"><div class="xe-card" role="dialog" aria-modal="true"><div class="xe-head"><div><h2>出站管理</h2><p>建立落地代理并绑定到现有节点。仅支持包含 egress_proxy 功能的自定义 Xboard-Node；官方版本会安全忽略该字段。</p></div><button class="xe-secondary" data-xe-close>关闭</button></div><div class="xe-main"><section class="xe-panel"><h3>新增 / 编辑出站</h3><input type="hidden" id="xe-id"><label>名称</label><input id="xe-name" placeholder="例如：US Residential 01"><div class="xe-grid"><div><label>类型</label><select id="xe-protocol"><option value="socks5">SOCKS5</option><option value="http">HTTP / HTTPS 代理</option><option value="shadowsocks">Shadowsocks</option><option value="vless">VLESS</option><option value="trojan">Trojan</option></select></div><div><label>地址</label><input id="xe-host" placeholder="host / IP"></div></div><div class="xe-grid"><div><label>端口</label><input id="xe-port" type="number" min="1" max="65535" placeholder="1080"></div><div><label>TLS SNI（可选）</label><input id="xe-sni" placeholder="example.com"></div></div><div class="xe-grid"><div><label>用户名（SOCKS / HTTP）</label><input id="xe-username" autocomplete="off"><label><input id="xe-clear-username" type="checkbox" style="width:auto"> 清除已保存用户名</label></div><div><label>密码 / Trojan 密码 / SS 密码</label><input id="xe-password" type="password" autocomplete="new-password"><label><input id="xe-clear-password" type="checkbox" style="width:auto"> 清除已保存密码</label></div></div><label><input id="xe-tls" type="checkbox" style="width:auto"> 出站 TLS / HTTPS</label><label><input id="xe-insecure" type="checkbox" style="width:auto"> 允许不安全证书</label><label>高级 JSON（SS: {"method":"aes-256-gcm"}；VLESS: {"uuid":"...","flow":"xtls-rprx-vision"}；Reality: 另加 reality.public_key / short_id）</label><textarea id="xe-config" placeholder='{}'>{}</textarea><label><input id="xe-enabled" type="checkbox" style="width:auto" checked> 启用</label><div class="xe-actions"><button data-xe-save>保存出站</button><button class="xe-secondary" data-xe-reset>清空</button><span id="xe-message" class="xe-small"></span></div></section><section class="xe-panel"><h3>现有出站与节点绑定</h3><div class="xe-toolbar"><input id="xe-search" placeholder="搜索名称、地址或协议"><button class="xe-secondary" data-xe-search>搜索</button></div><div id="xe-list" class="xe-small">正在加载…</div><div id="xe-pager" class="xe-pager"></div></section></div></div></div>`;
  const showMessage = (message, error = false) => { const el=document.getElementById('xe-message'); if (el) { el.className=error?'xe-error':'xe-status'; el.textContent=message; } };
  const readForm = () => {
    let config={}; const configText=document.getElementById('xe-config').value.trim() || '{}';
    try { config=JSON.parse(configText); } catch (_) { throw new Error('高级 JSON 格式不正确'); }
    const value=id => document.getElementById(id).value.trim();
    const body={ name:value('xe-name'), protocol:value('xe-protocol'), host:value('xe-host'), port:Number(value('xe-port')), tls_server_name:value('xe-sni') || null, tls_enabled:document.getElementById('xe-tls').checked, allow_insecure:document.getElementById('xe-insecure').checked, enabled:document.getElementById('xe-enabled').checked, config };
    const id=value('xe-id'); if(id) body.id=Number(id);
    const username=value('xe-username'), password=value('xe-password'); if(username) body.username=username; if(password) body.password=password;
    body.clear_username=document.getElementById('xe-clear-username').checked;
    body.clear_password=document.getElementById('xe-clear-password').checked;
    return body;
  };
  const fillForm = proxy => { ['id','name','host','port'].forEach(k=>document.getElementById(`xe-${k}`).value=proxy[k] ?? ''); document.getElementById('xe-protocol').value=proxy.protocol; document.getElementById('xe-sni').value=proxy.tls_server_name||''; document.getElementById('xe-tls').checked=!!proxy.tls_enabled; document.getElementById('xe-insecure').checked=!!proxy.allow_insecure; document.getElementById('xe-enabled').checked=!!proxy.enabled; document.getElementById('xe-config').value=JSON.stringify(proxy.config||{},null,2); document.getElementById('xe-username').value=''; document.getElementById('xe-password').value=''; document.getElementById('xe-clear-username').checked=false; document.getElementById('xe-clear-password').checked=false; showMessage('编辑时留空用户名/密码会保留原值；需要删除时勾选“清除”。'); };
  const resetForm = () => { ['id','name','host','port','sni','username','password'].forEach(k=>document.getElementById(`xe-${k}`).value=''); document.getElementById('xe-protocol').value='socks5'; document.getElementById('xe-config').value='{}'; document.getElementById('xe-tls').checked=false; document.getElementById('xe-insecure').checked=false; document.getElementById('xe-enabled').checked=true; document.getElementById('xe-clear-username').checked=false; document.getElementById('xe-clear-password').checked=false; showMessage(''); };
  let currentPage=1, lastPage=1, total=0;
  const render = async () => {
    const list=document.getElementById('xe-list'); if(!list) return;
    try {
      const search=document.getElementById('xe-search')?.value.trim()||'';
      const query=new URLSearchParams({page:String(currentPage),page_size:'20'}); if(search)query.set('search',search);
      const [result,nodes]=await Promise.all([api(`/fetch?${query.toString()}`),adminApi('/server/manage/getNodes')]);
      const proxies=Array.isArray(result)?result:(result?.items||[]);
      const pagination=Array.isArray(result)?{current_page:1,last_page:1,total:proxies.length}:(result?.pagination||{});
      currentPage=Number(pagination.current_page||1); lastPage=Math.max(1,Number(pagination.last_page||1)); total=Number(pagination.total||proxies.length);
      if(currentPage>lastPage){currentPage=lastPage;await render();return;}
      const nodeOptions=(nodes||[]).filter(n=>n.enabled!==false).map(n=>`<option value="${n.id}">${escapeHtml(n.name)} #${n.id}${n.egress_proxy_id?`（已绑定 #${n.egress_proxy_id}）`:''}</option>`).join('');
      list.innerHTML=(proxies||[]).length ? `<table><thead><tr><th>出站</th><th>地址</th><th>已绑定节点</th><th>操作</th></tr></thead><tbody>${proxies.map(p=>`<tr><td><b>${escapeHtml(p.name)}</b><br><span class="xe-small">${escapeHtml(p.protocol)} · #${p.id}${p.enabled?'':' · 已停用'}</span></td><td>${escapeHtml(p.host)}:${p.port}</td><td><select data-xe-bind-select="${p.id}"><option value="">选择节点…</option>${nodeOptions}</select><br><span class="xe-small">当前共 ${p.servers_count||0} 个节点</span></td><td><div class="xe-row-actions"><button class="xe-secondary" data-xe-edit="${p.id}">编辑</button><button data-xe-bind="${p.id}">绑定</button><button class="xe-secondary" data-xe-unbind="${p.id}">解绑</button><button class="xe-danger" data-xe-delete="${p.id}" ${p.servers_count?'disabled':''}>删除</button></div></td></tr>`).join('')}</tbody></table>`:'<p>没有匹配的出站配置。</p>';
      list._proxies=proxies||[];
      const pager=document.getElementById('xe-pager'); if(pager) pager.innerHTML=`<span class="xe-small">共 ${total} 条 · 第 ${currentPage}/${lastPage} 页</span><button class="xe-secondary" data-xe-page="${currentPage-1}" ${currentPage<=1?'disabled':''}>上一页</button><button class="xe-secondary" data-xe-page="${currentPage+1}" ${currentPage>=lastPage?'disabled':''}>下一页</button>`;
    } catch(error) { list.innerHTML=`<p class="xe-error">${escapeHtml(error.message)}</p>`; }
  };
  const open = async () => { let modal=document.getElementById(modalId); if(!modal){ document.body.insertAdjacentHTML('beforeend',modalHtml()); modal=document.getElementById(modalId); modal.addEventListener('click',async e=>{ if(e.target===modal||e.target.closest('[data-xe-close]')){modal.classList.remove('open');return;} if(e.target.closest('[data-xe-reset]')){resetForm();return;} if(e.target.closest('[data-xe-search]')){currentPage=1;await render();return;} const page=e.target.closest('[data-xe-page]');if(page&&!page.disabled){currentPage=Number(page.dataset.xePage);await render();return;} if(e.target.closest('[data-xe-save]')){try{const saved=await api('/save','POST',readForm());showMessage(`已保存 ${saved.name}`);await render();}catch(err){showMessage(err.message,true)}return;} const edit=e.target.closest('[data-xe-edit]');if(edit){fillForm((document.getElementById('xe-list')._proxies||[]).find(p=>p.id===Number(edit.dataset.xeEdit)));return;} const bind=e.target.closest('[data-xe-bind]');if(bind){try{const serverId=Number(document.querySelector(`[data-xe-bind-select="${bind.dataset.xeBind}"]`).value);if(!serverId)throw new Error('请选择要绑定的节点');await api('/bind','POST',{server_id:serverId,egress_proxy_id:Number(bind.dataset.xeBind)});showMessage('节点已绑定；支持 egress_proxy 的节点会在下次拉取或推送时重载配置。');await render();}catch(err){showMessage(err.message,true)}return;} const unbind=e.target.closest('[data-xe-unbind]');if(unbind){try{const serverId=Number(document.querySelector(`[data-xe-bind-select="${unbind.dataset.xeUnbind}"]`).value);if(!serverId)throw new Error('请选择要解绑的节点');await api('/bind','POST',{server_id:serverId,egress_proxy_id:0});showMessage('节点已解绑，将恢复默认直连出站。');await render();}catch(err){showMessage(err.message,true)}return;} const remove=e.target.closest('[data-xe-delete]');if(remove&&confirm('删除此出站？已绑定节点不能删除。')){try{await api('/drop','POST',{id:Number(remove.dataset.xeDelete)});await render()}catch(err){showMessage(err.message,true)}} }); document.getElementById('xe-search').addEventListener('keydown',async e=>{if(e.key==='Enter'){currentPage=1;await render();}}); }
    modal.classList.add('open'); await render();
  };
  const installMenu = () => { insertStyle(); if(document.getElementById(menuId)) return; const labels=new Set(['路由管理','Route Management','Routes']); const anchors=[...document.querySelectorAll('a,button')]; const route=anchors.find(el=>labels.has(el.textContent.trim())); if(!route) return; const item=route.cloneNode(true); item.id=menuId; item.href='#'; item.removeAttribute('data-state'); item.textContent='出站管理'; item.addEventListener('click',e=>{e.preventDefault();open();}); (route.parentElement||route).insertAdjacentElement('afterend',item); };
  new MutationObserver(installMenu).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',installMenu); setTimeout(installMenu,1000);
})();

