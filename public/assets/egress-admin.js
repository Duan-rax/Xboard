/*
 * Egress-management controller.
 *
 * Official SPA integration is isolated in egress-admin-adapter.js. State,
 * form data, rendering and API transport are provided by their own modules.
 */
(() => {
  'use strict';

  const adapter = globalThis.XboardEgressAdapter;
  const root = globalThis.XboardEgressAdmin;
  if (!adapter || !root?.state || !root?.form || !root?.view || !root?.api) {
    throw new Error('egress-admin dependency modules must load before egress-admin.js');
  }

  const { api, form, state, view } = root;
  const showMessage = view.showMessage;
  const showBindMessage = view.showBindMessage;

  const findProxy = (id) => state.proxies.find((proxy) => Number(proxy.id) === Number(id));

  const loadCatalog = async () => {
    const list = adapter.get('xe-list');
    if (!list) return;
    const scrollPositions = adapter.captureScrollPositions();
    list.setAttribute?.('aria-busy', 'true');
    if (!list.querySelector('table')) {
      list.innerHTML = '<p class="xe-small">正在加载…</p>';
    }
    try {
      const query = new URLSearchParams({ page: String(state.page), page_size: '20' });
      const search = form.valueOf('xe-search');
      if (search) query.set('search', search);
      const result = await api.fetch(query);
      const items = Array.isArray(result) ? result : (result?.items || []);
      const pagination = Array.isArray(result)
        ? { current_page: 1, last_page: 1, total: items.length }
        : (result?.pagination || {});
      const nextPage = Number(pagination.current_page || 1);
      const lastPage = Math.max(1, Number(pagination.last_page || 1));
      if (nextPage > lastPage) {
        state.page = lastPage;
        await loadCatalog();
        return;
      }
      view.renderCatalog(items, pagination);
    } catch (error) {
      list.innerHTML = `<p class="xe-error">${root.esc(error.message)}</p>`;
    } finally {
      adapter.restoreScrollPositions(scrollPositions);
      list.removeAttribute?.('aria-busy');
    }
  };

  const loadBindNodes = async () => {
    const list = adapter.get('xe-bind-list');
    if (!list || !state.bindProxy) return;
    const scrollPositions = adapter.captureScrollPositions();
    list.setAttribute?.('aria-busy', 'true');
    if (!list.querySelector('.xe-node')) {
      list.innerHTML = '<p>正在加载节点…</p>';
    }
    try {
      const query = new URLSearchParams({
        page: String(state.bindPage),
        page_size: '50',
      });
      const search = form.valueOf('xe-bind-search');
      if (search) query.set('search', search);
      if (state.bindFilter === 'current') {
        query.set('egress_proxy_id', String(state.bindProxy.id));
      } else if (state.bindFilter === 'bound' || state.bindFilter === 'unbound') {
        query.set('bound', state.bindFilter);
      }
      query.set('current_egress_proxy_id', String(state.bindProxy.id));
      query.set('probe_proxy_id', String(state.bindProxy.id));

      const result = await api.nodes(query);
      state.bindNodes = Array.isArray(result?.items) ? result.items : [];
      const pagination = result?.pagination || {};
      state.bindPage = Number(pagination.current_page || 1);
      state.bindLastPage = Math.max(1, Number(pagination.last_page || 1));
      state.bindTotal = Number(pagination.total || state.bindNodes.length);
      if (state.bindPage > state.bindLastPage) {
        state.bindPage = state.bindLastPage;
        await loadBindNodes();
        return;
      }
      view.renderBindNodes(state.bindNodes);
      view.renderBindPager();
    } catch (error) {
      list.innerHTML = `<p class="xe-error">${root.esc(error.message)}</p>`;
    } finally {
      adapter.restoreScrollPositions(scrollPositions);
      list.removeAttribute?.('aria-busy');
    }
  };

  const closeBind = () => {
    state.syncPoll += 1;
    adapter.setMainBinding(false);
    state.selected.clear();
    state.bindProxy = null;
  };

  const openBind = async (proxyId) => {
    const proxy = findProxy(proxyId);
    if (!proxy) {
      showMessage('找不到该出站配置，请刷新后重试。', true);
      return;
    }
    state.bindProxy = proxy;
    state.bindPage = 1;
    state.bindLastPage = 1;
    state.bindTotal = 0;
    state.bindFilter = 'all';
    state.bindNodes = [];
    state.selected.clear();

    const title = adapter.get('xe-bind-title');
    if (title) title.textContent = `节点绑定 · ${proxy.name}`;
    const search = adapter.get('xe-bind-search');
    if (search) search.value = '';
    const filter = adapter.get('xe-bind-filter');
    if (filter) filter.value = 'all';
    showBindMessage('');
    adapter.setMainBinding(true);
    await loadBindNodes();
  };

  const pollNodeSync = async (serverIds, proxyId, requestedAt, expectAvailable = null) => {
    const token = ++state.syncPoll;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (token !== state.syncPoll || !state.bindProxy) return;
      try {
        const result = await api.bindStatus({
          server_ids: serverIds,
          egress_proxy_id: proxyId,
          requested_at: requestedAt,
          expect_available: expectAvailable,
        });
        const pending = result?.sync?.pending_server_ids?.length || 0;
        if (pending === 0) {
          showBindMessage('节点配置已全部确认重载。');
          return;
        }
        showBindMessage(`正在等待 ${pending} 个节点应用新配置…`);
      } catch (error) {
        if (attempt === 12) showBindMessage(error.message, true);
      }
    }
    if (token === state.syncPoll && state.bindProxy) {
      showBindMessage('仍有节点等待配置同步，请稍后刷新节点状态。');
    }
  };

  const applySelection = async (proxyId) => {
    if (!state.selected.size) {
      showBindMessage('请至少选择一个节点。', true);
      return;
    }
    if (state.selected.size > 500) {
      showBindMessage('单次最多操作 500 个节点，请分批处理。', true);
      return;
    }
    const ids = [...state.selected];
    const action = proxyId ? '绑定' : '解绑';
    showBindMessage(`正在${action} ${ids.length} 个节点…`);
    try {
      const result = await api.bind(ids, proxyId);
      state.selected.clear();
      const changed = Number(result?.changed ?? ids.length);
      const confirmed = result?.sync?.confirmed_server_ids?.length || 0;
      const pending = result?.sync?.pending_server_ids?.length || 0;
      if (changed === 0) {
        showBindMessage('所选节点已经是目标状态，无需重载。');
        await Promise.all([loadBindNodes(), loadCatalog()]);
        return;
      }
      const syncMessage = pending
        ? `，${confirmed} 个节点已重载，${pending} 个节点仍在等待配置同步。`
        : '，节点均已确认重载。';
      showBindMessage(`${action}完成，实际更新 ${changed} 个节点${syncMessage}`);
      await Promise.all([loadBindNodes(), loadCatalog()]);
      if (pending > 0 && result?.requested_at) {
        void pollNodeSync(result.server_ids || ids, proxyId, result.requested_at);
      }
    } catch (error) {
      showBindMessage(error.message, true);
    }
  };

  const applyAvailability = async (available, makeDefault = false, clearDefault = false) => {
    if (!state.selected.size || !state.bindProxy) {
      showBindMessage('请至少选择一个节点。', true);
      return;
    }
    const ids = [...state.selected];
    showBindMessage(
      available
        ? `正在授权 ${ids.length} 个节点${makeDefault ? '并设为默认出站' : '（不设为默认）'}…`
        : `正在撤销 ${ids.length} 个节点的出站授权…`
    );
    try {
      const result = await api.availability(
        state.bindProxy.id,
        ids,
        available,
        makeDefault,
        clearDefault
      );
      const changed = Number(result?.changed || 0);
      const pending = result?.sync?.pending_server_ids?.length || 0;
      state.selected.clear();
      showBindMessage(
        `${available ? '授权' : '撤销'}完成，实际变更 ${changed} 个节点${pending ? `，${pending} 个节点待确认` : '，节点均已确认'}。`
      );
      await Promise.all([loadBindNodes(), loadCatalog()]);
      if (pending > 0 && result?.requested_at) {
        void pollNodeSync(
          result.changed_server_ids || [],
          state.bindProxy.id,
          result.requested_at,
          available
        );
      }
    } catch (error) {
      showBindMessage(error.message, true);
    }
  };

  const unbindEveryNode = async () => {
    if (!state.bindProxy) return;
    if (!confirm(`确定解绑“${state.bindProxy.name}”的全部节点吗？`)) return;
    showBindMessage('正在解绑全部节点…');
    try {
      const result = await api.unbindAll(state.bindProxy.id);
      const changed = Number(result?.changed ?? 0);
      const pending = result?.sync?.pending_server_ids?.length || 0;
      showBindMessage(
        changed === 0
          ? '当前没有需要解绑的节点。'
          : `已解绑 ${changed} 个节点。${pending ? `${pending} 个节点仍待确认重载。` : '节点均已确认重载。'}`
      );
      if (pending > 0 && result?.requested_at) {
        void pollNodeSync(result.server_ids || [], 0, result.requested_at);
      }
      state.selected.clear();
      await Promise.all([loadBindNodes(), loadCatalog()]);
    } catch (error) {
      showBindMessage(error.message, true);
    }
  };

  const probeFromNode = async (proxyId, serverId, button) => {
    button.disabled = true;
    showBindMessage(`正在从节点 #${serverId} 执行真实代理探测，最长等待约 14 秒…`);
    try {
      const response = await api.probe(proxyId, [serverId]);
      const result = response?.items?.[0];
      showBindMessage(
        result?.message || (result?.ok ? '节点侧出站链路可用。' : '节点侧出站链路不可用。'),
        !result?.ok
      );
      await loadBindNodes();
    } catch (error) {
      showBindMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  const handleMainClick = async (event) => {
    if (!adapter.page()) return;
    if (event.target.closest('[data-xe-close]')) {
      closeMain();
      return;
    }
    if (event.target.closest('[data-xe-reset]')) {
      form.reset();
      return;
    }
    if (event.target.closest('[data-xe-search]')) {
      state.page = 1;
      await loadCatalog();
      return;
    }
    if (event.target.closest('[data-xe-refresh]')) {
      await loadCatalog();
      return;
    }
    const pageButton = event.target.closest('[data-xe-page]');
    if (pageButton && !pageButton.disabled) {
      state.page = Number(pageButton.dataset.xePage);
      await loadCatalog();
      return;
    }
    if (event.target.closest('[data-xe-save]')) {
      const button = event.target.closest('[data-xe-save]');
      button.disabled = true;
      showMessage('正在保存…');
      try {
        const saved = await api.save(form.read());
        adapter.get('xe-id').value = saved.id;
        form.fill(saved);
        showMessage(`已保存 ${saved.name}；绑定节点将在下一轮配置同步时生效。`);
        await loadCatalog();
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
      return;
    }
    const edit = event.target.closest('[data-xe-edit]');
    if (edit) {
      const proxy = findProxy(edit.dataset.xeEdit);
      if (proxy) form.fill(proxy);
      return;
    }
    const bind = event.target.closest('[data-xe-bind-nodes]');
    if (bind) {
      await openBind(bind.dataset.xeBindNodes);
      return;
    }
    const test = event.target.closest('[data-xe-test]');
    if (test) {
      test.disabled = true;
      showMessage('正在通过真实代理请求测试目标…');
      try {
        const result = await api.test(test.dataset.xeTest);
        showMessage(result?.message || (result?.ok ? '端口可达。' : '无法连接。'), !result?.ok);
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        test.disabled = false;
      }
      return;
    }
    const remove = event.target.closest('[data-xe-delete]');
    if (remove && !remove.disabled && confirm('确定删除此出站配置吗？')) {
      try {
        await api.drop(remove.dataset.xeDelete);
        showMessage('已删除。');
        await loadCatalog();
      } catch (error) {
        showMessage(error.message, true);
      }
    }
  };

  const handleBindChange = (event) => {
    if (event.target.id === 'xe-bind-select-page') {
      const ids = state.bindNodes.map((node) => Number(node.id));
      ids.forEach((id) => {
        if (event.target.checked) state.selected.add(id);
        else state.selected.delete(id);
      });
      adapter.bindCheckboxes().forEach((input) => {
        if (ids.includes(Number(input.dataset.xeNode))) input.checked = event.target.checked;
      });
      view.updateBindSelection();
      return;
    }
    const node = event.target.closest('[data-xe-node]');
    if (!node) return;
    const id = Number(node.dataset.xeNode);
    if (node.checked) state.selected.add(id);
    else state.selected.delete(id);
    view.updateBindSelection();
  };

  const handleBindClick = async (event) => {
    if (!adapter.bindPage()) return;
    if (event.target.closest('[data-xe-bind-close]')) {
      closeBind();
      return;
    }
    if (event.target.closest('[data-xe-bind-search]')) {
      state.bindPage = 1;
      await loadBindNodes();
      return;
    }
    if (event.target.closest('[data-xe-bind-refresh]')) {
      await loadBindNodes();
      return;
    }
    const pageButton = event.target.closest('[data-xe-bind-page]');
    if (pageButton && !pageButton.disabled) {
      state.bindPage = Number(pageButton.dataset.xeBindPage);
      await loadBindNodes();
      return;
    }
    if (event.target.closest('[data-xe-bind-selected]')) {
      await applySelection(Number(state.bindProxy?.id || 0));
      return;
    }
    if (event.target.closest('[data-xe-availability-on]')) {
      await applyAvailability(true, false, false);
      return;
    }
    if (event.target.closest('[data-xe-availability-default]')) {
      await applyAvailability(true, true, false);
      return;
    }
    if (event.target.closest('[data-xe-availability-clear-default]')) {
      await applyAvailability(true, false, true);
      return;
    }
    if (event.target.closest('[data-xe-availability-off]')) {
      await applyAvailability(false, false, false);
      return;
    }
    if (event.target.closest('[data-xe-unbind-selected]')) {
      await applySelection(0);
      return;
    }
    if (event.target.closest('[data-xe-unbind-all]')) {
      await unbindEveryNode();
      return;
    }
    const probe = event.target.closest('[data-xe-probe-node]');
    if (probe) {
      await probeFromNode(
        Number(probe.dataset.xeProbeProxy),
        Number(probe.dataset.xeProbeNode),
        probe
      );
    }
  };

  const ensureMainPage = () => {
    let page = adapter.page();
    if (page) return page;
    page = adapter.mountMain(view.mainHtml(), view.css);
    if (!page) return null;
    adapter.onPage('click', handleMainClick);
    adapter.on('xe-search', 'keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        state.page = 1;
        await loadCatalog();
      }
    });
    adapter.on('xe-protocol', 'change', form.syncProtocolUi);
    return page;
  };

  const ensureBindPage = () => {
    let bind = adapter.bindPage();
    if (bind) return bind;
    bind = adapter.mountBind(view.bindHtml());
    if (!bind) return null;
    adapter.onBindPage('click', handleBindClick);
    adapter.onBindPage('change', handleBindChange);
    adapter.on('xe-bind-search', 'keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        state.bindPage = 1;
        await loadBindNodes();
      }
    });
    adapter.on('xe-bind-filter', 'change', async (event) => {
      state.bindFilter = event.target.value;
      state.bindPage = 1;
      state.selected.clear();
      await loadBindNodes();
    });
    return bind;
  };

  const closeMain = () => {
    adapter.setMenuActive(false);
    if (!adapter.page()) return;
    closeBind();
    adapter.unmountMain();
  };

  const openMain = async () => {
    const page = ensureMainPage();
    if (!page) {
      console.error('无法找到 Xboard 后台主内容区，出站管理页面未加载。');
      return;
    }
    ensureBindPage();
    closeBind();
    form.reset();
    page.classList.add('open');
    page.setAttribute('aria-hidden', 'false');
    adapter.setMenuActive(true);
    adapter.resetPageScroll();
    await loadCatalog();
  };

  adapter.bindLifecycle({
    css: view.css,
    onOpen: () => void openMain(),
    onClose: closeMain,
  });
})();
