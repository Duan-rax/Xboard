(() => {
  'use strict';
  const adapter = globalThis.XboardSecurityAuditAdapter;
  const root = globalThis.XboardSecurityAudit;
  if (!adapter || !root?.state || !root?.api || !root?.view) {
    throw new Error('security audit modules must load in order');
  }
  const { api, state, view } = root;
  let pageNumber = 1;

  const params = () => ({
    range: state.range,
    user_id: adapter.get('sa-user-id')?.value || '',
    node_id: adapter.get('sa-node-id')?.value?.trim() || '',
    destination: adapter.get('sa-destination')?.value?.trim() || '',
    action: adapter.get('sa-action')?.value || '',
  });

  const load = async () => {
    if (state.loading) return;
    state.loading = true;
    view.showMessage('正在加载审计数据…');
    try {
      const query = { ...params(), page: pageNumber, per_page: 50 };
      const [overview, events] = await Promise.all([api.overview(query), api.events(query)]);
      state.overview = overview;
      state.events = Array.isArray(events?.data) ? events.data : [];
      state.pagination = {
        current_page: Number(events?.current_page || 1),
        last_page: Number(events?.last_page || 1),
        total: Number(events?.total || 0),
      };
      pageNumber = state.pagination.current_page;
      view.renderAll();
      view.showMessage(`已加载 ${state.pagination.total} 条审计事件。`);
    } catch (error) {
      view.showMessage(error.message, true);
    } finally {
      state.loading = false;
    }
  };

  const loadSettings = async () => {
    try {
      view.renderSettings(await api.settings());
    } catch (error) {
      const message = adapter.get('sa-settings-message');
      if (message) {
        message.className = 'sa-error';
        message.textContent = error.message;
      }
    }
  };

  const saveSettings = async (button) => {
    button.disabled = true;
    const message = adapter.get('sa-settings-message');
    try {
      const settings = await api.saveSettings({
        webhook_secret: adapter.get('sa-secret')?.value || '',
        retention_days: Number(adapter.get('sa-retention')?.value || 30),
        clock_skew: 300,
      });
      view.renderSettings({ ...state.settings, ...settings });
      if (message) {
        message.className = 'sa-status';
        message.textContent = '审计设置已保存。';
      }
    } catch (error) {
      if (message) {
        message.className = 'sa-error';
        message.textContent = error.message;
      }
    } finally {
      button.disabled = false;
    }
  };

  const handleClick = async (event) => {
    if (event.target.closest('[data-sa-refresh]')) {
      pageNumber = 1;
      await load();
      return;
    }
    if (event.target.closest('[data-sa-clear]')) {
      ['sa-user-id', 'sa-node-id', 'sa-destination'].forEach((id) => {
        const el = adapter.get(id);
        if (el) el.value = '';
      });
      adapter.get('sa-action').value = '';
      pageNumber = 1;
      await load();
      return;
    }
    const user = event.target.closest('[data-sa-user]');
    if (user) {
      adapter.get('sa-user-id').value = user.dataset.saUser;
      pageNumber = 1;
      await load();
      return;
    }
    if (event.target.closest('[data-sa-prev]')) {
      if (pageNumber > 1) {
        pageNumber -= 1;
        await load();
      }
      return;
    }
    if (event.target.closest('[data-sa-next]')) {
      if (pageNumber < state.pagination.last_page) {
        pageNumber += 1;
        await load();
      }
      return;
    }
    if (event.target.closest('[data-sa-generate]')) {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      adapter.get('sa-secret').value = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
      return;
    }
    const save = event.target.closest('[data-sa-save-settings]');
    if (save) await saveSettings(save);
  };

  const open = async () => {
    let page = adapter.page();
    if (!page) {
      page = adapter.mount(view.html(), view.css);
      if (!page) return;
      page.addEventListener('click', handleClick);
      adapter.get('sa-range').addEventListener('change', async (event) => {
        state.range = event.target.value;
        pageNumber = 1;
        await load();
      });
    }
    adapter.setMenuActive(true);
    await Promise.all([load(), loadSettings()]);
  };

  const close = () => {
    if (!adapter.page()) return;
    adapter.setMenuActive(false);
    adapter.unmount();
  };

  adapter.bindLifecycle({
    css: view.css,
    onOpen: () => void open(),
    onClose: close,
  });
})();
