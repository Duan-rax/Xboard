/*
 * Structured route-management controller.
 *
 * This file orchestrates user actions and API workflows. Official SPA
 * integration lives in route-admin-adapter.js; form, diagnostics, view and API
 * responsibilities live in their respective route-admin-*.js modules.
 */
(() => {
  'use strict';

  const adapter = globalThis.XboardRouteAdapter;
  const root = globalThis.XboardRouteAdmin;
  if (!adapter || !root?.state || !root?.form || !root?.diagnostics || !root?.view || !root?.api) {
    throw new Error('route-admin dependency modules must load before route-admin.js');
  }

  const { api, diagnostics, form, state, view } = root;
  const showMessage = view.showMessage;
  const showBindMessage = view.showBindMessage;
  const page = adapter.page;

  const syncMessage = (sync) => {
    const confirmed = sync?.confirmed_server_ids?.length || 0;
    const pending = sync?.pending_server_ids?.length || 0;
    return pending
      ? `已确认 ${confirmed} 个节点，${pending} 个节点离线或尚未确认应用。`
      : `全部 ${confirmed} 个在线节点已确认应用。`;
  };

  const load = async () => {
    if (state.loading) return;
    state.loading = true;
    const list = adapter.get('xe-list');
    if (list) list.innerHTML = '<p>正在加载…</p>';
    try {
      const [routes, options] = await api.fetchCatalog();
      state.routes = Array.isArray(routes) ? routes : [];
      state.targets = Array.isArray(options?.targets) ? options.targets : [];
      view.renderTargets();
      view.renderList();
    } catch (error) {
      if (list) list.innerHTML = `<p class="xe-error">${root.esc(error.message)}</p>`;
    } finally {
      state.loading = false;
    }
  };

  const loadBindingNodes = async (pageNumber = state.bindingPage) => {
    if (!state.bindingRoute) return;
    const list = adapter.get('xe-node-list');
    if (list) list.innerHTML = '<p>正在加载节点…</p>';
    const bindingQuery = form.readBindingQuery();
    const query = new URLSearchParams({
      route_id: String(state.bindingRoute.id),
      page: String(Math.max(1, pageNumber)),
      page_size: '50',
      search: bindingQuery.search,
      bound: bindingQuery.bound,
    });
    try {
      const result = await api.nodes(query);
      state.bindingNodes = Array.isArray(result?.items) ? result.items : [];
      state.bindingPagination = result?.pagination || { current_page: 1, last_page: 1, total: 0 };
      state.bindingPage = Number(state.bindingPagination.current_page || 1);
      view.renderBindingNodes();
    } catch (error) {
      if (list) list.innerHTML = `<p class="xe-error">${root.esc(error.message)}</p>`;
    }
  };

  const openBinding = async (route) => {
    state.bindingRoute = route;
    state.bindingSelected.clear();
    state.bindingPage = 1;
    const modal = adapter.get('xe-bind-modal');
    const title = adapter.get('xe-bind-title');
    if (title) title.textContent = `绑定节点：${route.remarks || `#${route.id}`}`;
    if (modal) modal.hidden = false;
    showBindMessage('');
    await loadBindingNodes(1);
  };

  const closeBinding = () => {
    const modal = adapter.get('xe-bind-modal');
    if (modal) modal.hidden = true;
    state.bindingRoute = null;
    state.bindingNodes = [];
    state.bindingSelected.clear();
  };

  const pollBindingStatus = async (result) => {
    let pending = result?.sync?.pending_server_ids || [];
    if (!pending.length || !result?.requested_at) return;
    const routeId = Number(state.bindingRoute?.id || 0);
    for (let attempt = 0; attempt < 12 && pending.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (!state.bindingRoute || Number(state.bindingRoute.id) !== routeId) return;
      try {
        const status = await api.bindStatus({
          server_ids: pending,
          requested_at: result.requested_at,
        });
        pending = status?.sync?.pending_server_ids || [];
        showBindMessage(syncMessage(status?.sync));
      } catch (error) {
        if (attempt === 11) showBindMessage(error.message, true);
      }
    }
  };

  const bindSelectedNodes = async (bound, button) => {
    if (!state.bindingRoute || !state.bindingSelected.size) {
      showBindMessage('请至少选择一个节点。', true);
      return;
    }
    button.disabled = true;
    showBindMessage(bound ? '正在绑定并等待节点确认…' : '正在解绑并等待节点确认…');
    try {
      const result = await api.bind({
        route_id: Number(state.bindingRoute.id),
        server_ids: [...state.bindingSelected],
        bound,
      });
      if (Number(result?.changed || 0) === 0) {
        showBindMessage('所选节点已经是目标状态，无需重载。');
        state.bindingSelected.clear();
        await loadBindingNodes(state.bindingPage);
        return;
      }
      showBindMessage(`${bound ? '绑定' : '解绑'}完成：${syncMessage(result?.sync)}`);
      state.bindingSelected.clear();
      await Promise.all([loadBindingNodes(state.bindingPage), load()]);
      void pollBindingStatus(result);
    } catch (error) {
      showBindMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  const toggleRoute = async (route, enabled) => {
    try {
      await api.toggle(route, enabled);
      showMessage(`${route.remarks || `#${route.id}`} 已${enabled ? '启用' : '停用'}，绑定节点正在更新。`);
      await load();
    } catch (error) {
      showMessage(error.message, true);
    }
  };

  const applyOrder = async (items) => {
    try {
      await api.sort(items);
      await load();
    } catch (error) {
      showMessage(error.message, true);
    }
  };

  const reorder = async (id, direction) => {
    const index = state.routes.findIndex((route) => Number(route.id) === Number(id));
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.routes.length) return;
    const items = [...state.routes];
    [items[index], items[target]] = [items[target], items[index]];
    await applyOrder(items);
  };

  const pollSync = async (routeId) => {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      if (!page()) return;
      try {
        const status = await api.syncStatus(routeId);
        if (Number(status?.pending || 0) === 0) {
          showMessage(`节点配置已全部确认：revision/hash 一致（${Number(status?.confirmed || 0)} 台）。`);
          return;
        }
        showMessage(`等待节点应用：${Number(status?.confirmed || 0)} 台已确认，${Number(status.pending)} 台待更新。`);
      } catch (error) {
        if (attempt === 8) showMessage(error.message, true);
      }
    }
    showMessage('仍有节点未确认 revision/hash，请检查节点版本和连接状态。', true);
  };

  const save = async (button) => {
    button.disabled = true;
    showMessage('正在保存…');
    try {
      const saved = await api.save(form.read());
      showMessage('规则已保存，正在等待绑定节点确认配置版本…');
      await load();
      form.reset();
      showMessage('规则已保存，正在等待绑定节点确认配置版本…');
      if (saved?.id) void pollSync(saved.id);
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  const preview = async () => {
    try {
      const result = await api.preview(form.read());
      const routeDiagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
      adapter.get('xe-preview').textContent = JSON.stringify(result, null, 2);
      if (routeDiagnostics.some((item) => item.severity === 'error')) {
        showMessage('格式校验通过，但发现会影响规则生效的冲突。', true);
      } else if (routeDiagnostics.some((item) => item.severity === 'warning')) {
        showMessage('格式校验通过，但存在需要确认的警告。', true);
      } else if (routeDiagnostics.length) {
        showMessage('校验通过，并有诊断提示。');
      } else {
        showMessage('校验通过，未发现确定性冲突。');
      }
    } catch (error) {
      showMessage(error.message, true);
    }
  };

  const handleClick = async (event) => {
    const nodeCheck = event.target.closest?.('[data-xe-node-check]');
    if (nodeCheck) {
      const nodeId = Number(nodeCheck.dataset.xeNodeCheck);
      if (nodeCheck.checked) state.bindingSelected.add(nodeId);
      else state.bindingSelected.delete(nodeId);
      return;
    }
    if (event.target.closest?.('[data-xe-bind-close]')) {
      closeBinding();
      return;
    }
    if (event.target.closest?.('[data-xe-node-filter]')) {
      state.bindingPage = 1;
      await loadBindingNodes(1);
      return;
    }
    if (event.target.closest?.('[data-xe-select-page]')) {
      state.bindingNodes.forEach((node) => state.bindingSelected.add(Number(node.id)));
      view.renderBindingNodes();
      return;
    }
    if (event.target.closest?.('[data-xe-clear-selection]')) {
      state.bindingSelected.clear();
      view.renderBindingNodes();
      return;
    }
    const bindSelected = event.target.closest?.('[data-xe-bind-selected]');
    if (bindSelected) {
      await bindSelectedNodes(bindSelected.dataset.xeBindSelected === '1', bindSelected);
      return;
    }
    if (event.target.closest?.('[data-xe-node-prev]')) {
      if (state.bindingPage > 1) await loadBindingNodes(state.bindingPage - 1);
      return;
    }
    if (event.target.closest?.('[data-xe-node-next]')) {
      if (state.bindingPage < Number(state.bindingPagination.last_page || 1)) {
        await loadBindingNodes(state.bindingPage + 1);
      }
      return;
    }
    if (event.target.closest('[data-xe-refresh]')) {
      await load();
      return;
    }
    if (event.target.closest('[data-xe-reset]')) {
      form.reset();
      return;
    }
    if (event.target.closest('[data-xe-preview]')) {
      await preview();
      return;
    }
    const saveButton = event.target.closest('[data-xe-save]');
    if (saveButton) {
      await save(saveButton);
      return;
    }
    const edit = event.target.closest('[data-xe-edit]');
    if (edit) {
      const route = state.routes.find((item) => Number(item.id) === Number(edit.dataset.xeEdit));
      if (route) form.fill(route);
      return;
    }
    const bind = event.target.closest('[data-xe-bind]');
    if (bind) {
      const route = state.routes.find((item) => Number(item.id) === Number(bind.dataset.xeBind));
      if (route) await openBinding(route);
      return;
    }
    const toggle = event.target.closest('[data-xe-toggle]');
    if (toggle) {
      const route = state.routes.find((item) => Number(item.id) === Number(toggle.dataset.xeToggle));
      if (route) await toggleRoute(route, toggle.dataset.xeEnabled === '1');
      return;
    }
    const copy = event.target.closest('[data-xe-copy]');
    if (copy) {
      const route = state.routes.find((item) => Number(item.id) === Number(copy.dataset.xeCopy));
      if (route) form.copy(route);
      return;
    }
    const up = event.target.closest('[data-xe-up]');
    if (up) {
      await reorder(up.dataset.xeUp, -1);
      return;
    }
    const down = event.target.closest('[data-xe-down]');
    if (down) {
      await reorder(down.dataset.xeDown, 1);
      return;
    }
    if (event.target.closest('[data-xe-renumber]')) {
      await applyOrder(state.routes);
      return;
    }
    const remove = event.target.closest('[data-xe-delete]');
    if (remove) {
      const route = state.routes.find((item) => Number(item.id) === Number(remove.dataset.xeDelete));
      const count = Number(route?.servers_count || 0);
      if (!confirm(`确定删除此路由规则吗？${count ? `将同时从 ${count} 个节点解绑并推送配置。` : ''}`)) return;
      try {
        const result = await api.drop(remove.dataset.xeDelete);
        showMessage(`规则已删除，并清理 ${Number(result?.removed_bindings || 0)} 个节点绑定。`);
        await load();
        if (state.editingId === Number(remove.dataset.xeDelete)) form.reset();
      } catch (error) {
        showMessage(error.message, true);
      }
    }
  };

  const open = async () => {
    if (!page()) {
      const element = adapter.mountPage(view.pageHtml(), view.css);
      if (!element) return;
      adapter.onPage('click', handleClick);
      adapter.on('xe-search', 'input', (event) => {
        state.search = event.target.value.trim();
        view.renderList();
      });
      adapter.on('xe-action', 'change', form.updateTargetState);
    }
    adapter.setMenuActive(true);
    form.reset();
    await load();
  };

  const close = () => {
    if (!page()) return;
    closeBinding();
    adapter.setMenuActive(false);
    adapter.unmountPage();
  };

  const openIfCurrentRoute = () => {
    if (adapter.isCurrentRoute()) {
      if (!page()) void open();
      return;
    }
    if (page()) close();
  };

  adapter.bindNavigation({
    onRoute: () => void open(),
    onClose: close,
    onResume: openIfCurrentRoute,
  });
})();
