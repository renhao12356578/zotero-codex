var ZoteroMCPPreferences = {
  initialized: false,
  get api() {
    if (!Zotero.ZoteroCodex?.settings) throw new Error('插件已关闭，请重新启用后打开设置');
    return Zotero.ZoteroCodex.settings;
  },
  el(id) { return document.getElementById('zc-' + id); },
  feedback(message) { this.el('feedback').textContent = message; },
  bind(id, action) {
    this.el(id).addEventListener('click', async () => {
      const button = this.el(id); button.disabled = true;
      try { await action(); } catch (error) { this.feedback(error.message); }
      finally { button.disabled = false; }
    });
  },
  init() {
    if (this.initialized) return;
    this.initialized = true;
    for (const [id, key] of [['auto-text','autoText'], ['auto-region','autoRegion']]) {
      this.el(id).addEventListener('change', () => {
        try { this.api.setCapturePreference(key, this.el(id).checked); this.refresh(); this.feedback('设置已保存，立即生效'); }
        catch (error) { this.feedback(error.message); }
      });
    }
    for (const id of ['node-path','server-path']) this.el(id).addEventListener('change', () => {
      try { this.savePaths(); this.feedback('路径已保存在本机'); } catch (error) { this.feedback(error.message); }
    });
    this.bind('refresh', () => { this.refresh(); this.feedback('状态已刷新'); });
    this.bind('clear', () => { this.api.clearContext(); this.refresh(); this.feedback('已清除所有阅读器的 MCP 选区快照'); });
    this.bind('copy-config', async () => {
      this.savePaths();
      Zotero.Utilities.Internal.copyTextToClipboard(await this.api.connectionConfig());
      this.feedback('MCP 配置已复制，不包含访问令牌');
    });
    this.bind('reveal', () => this.api.revealConnection());
    this.bind('check', () => this.check());
    this.bind('copy-diagnostics', async () => {
      const report = await this.check();
      Zotero.Utilities.Internal.copyTextToClipboard(JSON.stringify(report, null, 2));
      this.feedback('诊断信息已复制，不含令牌、路径或论文笔记内容');
    });
    const repo = 'https://github.com/renhao12356578/zotero-codex';
    for (const [id, url] of [['help',repo + '/blob/main/docs/local-setup.md'], ['github',repo], ['releases',repo + '/releases/latest']]) {
      this.bind(id, () => Zotero.launchURL(url));
    }
    this.refresh(true);
  },
  savePaths() { this.api.saveConnectionSettings(this.el('node-path').value, this.el('server-path').value); },
  refresh(fillPaths = false) {
    if (!this.initialized) return;
    try {
      const state = this.api.state();
      const values = {
        version:state.version + ' · Zotero ' + state.zoteroVersion,
        bridge:state.bridgeReady ? '已就绪' : '未就绪',
        native:state.nativeAPIEnabled ? '已开启' : '未开启，请前往「高级」设置',
        notes:state.betterNotes ? '可用' : '未启用，笔记协作功能受限',
        'last-request':state.lastRequestAt ? new Date(state.lastRequestAt).toLocaleString() : '本次启动后尚无客户端请求',
        'server-version':state.serverVersion ? state.serverVersion + (state.serverVersion === state.version ? '' : '（与插件版本不同，请更新并重新加载 MCP）') : '尚未识别',
        'context-count':`已保存 ${state.snapshotCount} 个阅读器快照`,
      };
      for (const [id, text] of Object.entries(values)) this.el(id).textContent = text;
      this.el('auto-text').checked = state.autoText;
      this.el('auto-region').checked = state.autoRegion;
      if (fillPaths) {
        this.el('node-path').value = state.nodePath;
        this.el('server-path').value = state.serverPath;
      } else if (!this.el('server-path').value && document.activeElement !== this.el('server-path')) {
        this.el('server-path').value = state.serverPath;
        if (this.el('node-path').value === 'node' && document.activeElement !== this.el('node-path')) this.el('node-path').value = state.nodePath;
      }
    } catch (error) { this.feedback(error.message); }
  },
  async check() {
    this.el('diagnostics').textContent = '正在检查本机连接…';
    const report = await this.api.diagnose();
    const describe = check => check.ok ? '正常' : check.status ? `失败（HTTP ${check.status}）` : '无法连接';
    this.el('diagnostics').textContent = `本地桥接：${describe(report.bridge)}；Zotero API：${describe(report.nativeAPI)}；连接文件：${report.connectionFilePresent ? '存在' : '缺失'}。这项检查不验证 Codex 客户端是否已配置。`;
    this.refresh();
    return report;
  },
};
