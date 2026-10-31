(() => {
  'use strict';
  const adapter = globalThis.XboardSecurityAuditAdapter;
  const root = globalThis.XboardSecurityAudit;
  if (!adapter || !root?.state || !root?.api || !root?.view) {
    throw new Error('security audit modules must load in order');
  }
  const { api, state, view } = root;
  const SECTION_KEY = 'xboard_security_audit_section';
  const sections = {
    overview: {
      title: '审计概览',
      copy: '统一查看所选时间范围内的流量总量、热门目标与节点分布。审计仅记录连接元数据，不记录正文内容。',
    },
    analysis: {
      title: '流量分析',
      copy: '按服务或目标地址汇总上传、下载与连接数，快速识别流量去向和主要服务。',
    },
    traffic: {
      title: '流量审计记录',
      copy: '实时查看连接协议、来源、用户、目标地址、规则、出站和连接流量。',
    },
    rules: {
      title: '规则命中',
      copy: '按面板规则聚合连接、流量和最近命中时间，区分内核精确标识与采集器上报来源。',
    },
    users: {
      title: '用户审计',
      copy: '按用户汇总连接量、总流量和阻断次数；点击任意用户可直接钻取该用户的连接明细。',
    },
    settings: {
      title: '审计设置',
      copy: '配置节点审计上报地址、认证密钥、事件保留期限和过期数据清理。',
    },
  };
  let pageNumber = 1;
  let requestSerial = 0;

  const sectionName = (section) => Object.prototype.hasOwnProperty.call(sections, section) ? section : 'overview';

  const showSection = (section, persist = true) => {
    const next = sectionName(section);
    state.section = next;
    const page = adapter.page();
    if (page) {
      page.querySelectorAll('[data-sa-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.saPanel !== next;
      });
      const toolbar = page.querySelector('[data-sa-filter-toolbar]');
      if (toolbar) toolbar.hidden = next === 'settings';
      const title = adapter.get('sa-section-title');
      const copy = adapter.get('sa-section-copy');
      if (title) title.textContent = sections[next].title;
      if (copy) copy.textContent = sections[next].copy;
    }
    adapter.setMenuActive(true, next);
    if (persist) {
      try {
        sessionStorage.setItem('xboard_security_audit_open', '1');
        sessionStorage.setItem(SECTION_KEY, next);
      } catch (_) {
        // Ignore hardened browser storage.
      }
    }
    return next;
  };

  const params = () => ({
    range: state.range,
    user_id: adapter.get('sa-user-id')?.value || '',
    node_id: adapter.get('sa-node-id')?.value?.trim() || '',
    destination: adapter.get('sa-destination')?.value?.trim() || '',
    action: adapter.get('sa-action')?.value || '',
  });

  const syncRangeButtons = () => {
    adapter.page()?.querySelectorAll('[data-sa-range-value]').forEach((button) => {
      button.classList.toggle('active', button.dataset.saRangeValue === state.range);
    });
  };

  const load = async () => {
    const serial = ++requestSerial;
    state.loading = true;
    if (state.section !== 'settings') view.showMessage('正在加载审计数据…');
    try {
      const query = { ...params(), page: pageNumber, per_page: 50 };
      const [overview, events, analysis] = await Promise.all([
        api.overview(query),
        api.events(query),
        state.section === 'analysis'
          ? api.analysis({ ...query, dimension: state.analysisDimension, sort: state.analysisSort })
          : Promise.resolve(null),
      ]);
      if (serial !== requestSerial) return;
      state.overview = overview;
      if (analysis) state.analysis = analysis;
      const userFilter = String(adapter.get('sa-user-id')?.value || '');
      const nodeFilter = String(adapter.get('sa-node-id')?.value || '');
      const destinationFilter = String(adapter.get('sa-destination')?.value || '').trim();
      const actionFilter = String(adapter.get('sa-action')?.value || '');
      const mergeOptions = (current, incoming, key) => {
        const values = new Map((current || []).map((row) => [String(row[key]), row]));
        (incoming || []).forEach((row) => values.set(String(row[key]), row));
        return [...values.values()];
      };
      const replaceOptions = !userFilter && !nodeFilter && !destinationFilter && !actionFilter;
      state.filterOptions.users = replaceOptions
        ? [...(overview.users || [])]
        : mergeOptions(state.filterOptions.users, overview.users, 'user_id');
      state.filterOptions.nodes = replaceOptions
        ? [...(overview.nodes || [])]
        : mergeOptions(state.filterOptions.nodes, overview.nodes, 'node_id');
      state.events = Array.isArray(events?.data) ? events.data : [];
      state.pagination = {
        current_page: Number(events?.current_page || 1),
        last_page: Number(events?.last_page || 1),
        total: Number(events?.total || 0),
      };
      pageNumber = state.pagination.current_page;
      view.renderAll();
      syncRangeButtons();
      if (state.section !== 'settings') {
        view.showMessage(`已加载 ${state.pagination.total} 条审计事件。`);
      }
    } catch (error) {
      if (serial === requestSerial) view.showMessage(error.message, true);
    } finally {
      if (serial === requestSerial) state.loading = false;
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
    const range = event.target.closest('[data-sa-range-value]');
    if (range) {
      state.range = range.dataset.saRangeValue;
      adapter.get('sa-range').value = state.range;
      pageNumber = 1;
      await load();
      return;
    }
    const dimension = event.target.closest('[data-sa-analysis-dimension]');
    if (dimension) {
      state.analysisDimension = dimension.dataset.saAnalysisDimension;
      state.analysisRowsLimit = 8;
      state.analysisExpanded = [];
      await load();
      return;
    }
    const sort = event.target.closest('[data-sa-analysis-sort]');
    if (sort) {
      state.analysisSort = sort.dataset.saAnalysisSort;
      await load();
      return;
    }
    const expand = event.target.closest('[data-sa-analysis-expand]');
    if (expand) {
      const key = String(expand.dataset.saAnalysisExpand || '');
      state.analysisExpanded = state.analysisExpanded.includes(key)
        ? state.analysisExpanded.filter((value) => value !== key)
        : [...state.analysisExpanded, key];
      view.renderAnalysis();
      return;
    }
    if (event.target.closest('[data-sa-analysis-more]')) {
      state.analysisRowsLimit += 20;
      view.renderAnalysis();
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
      showSection('traffic');
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
    const cleanup = event.target.closest('[data-sa-cleanup]');
    if (cleanup) {
      const message = adapter.get('sa-settings-message');
      cleanup.disabled = true;
      try {
        const result = await api.cleanup();
        if (message) {
          message.className = 'sa-status';
          message.textContent = `已清理 ${Number(result?.deleted || 0)} 条过期事件。`;
        }
      } catch (error) {
        if (message) {
          message.className = 'sa-error';
          message.textContent = error.message;
        }
      } finally {
        cleanup.disabled = false;
      }
      return;
    }
    const save = event.target.closest('[data-sa-save-settings]');
    if (save) await saveSettings(save);
  };

  const open = async (requestedSection = 'overview') => {
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
      adapter.get('sa-range').value = state.range;
      syncRangeButtons();
      ['sa-user-id', 'sa-node-id', 'sa-action'].forEach((id) => {
        adapter.get(id)?.addEventListener('change', async () => {
          pageNumber = 1;
          await load();
        });
      });
    }
    const section = showSection(requestedSection);
    if (section === 'settings') {
      await loadSettings();
    } else {
      await load();
    }
  };

  const close = () => {
    if (!adapter.page()) return;
    adapter.setMenuActive(false);
    adapter.unmount();
  };

  root.open = open;
  root.showSection = showSection;
  adapter.bindLifecycle({
    css: view.css,
    onOpen: (section) => void open(section),
    onClose: close,
  });
})();
