const status = document.querySelector('#status');
const api = window.widgetApi;

(async () => {
  if (!api) {
    status.textContent = 'widgetApi 不可用（缺少 Tauri 绑定）';
    return;
  }
  // 快照订阅：settings 窗口自己的保存也会经事件回环回来。
  await api.subscribe(snap => {
    const tint = snap?.settings?.bubbleTint;
    status.textContent = '已同步 · 气泡颜色 ' + (tint || '默认');
    if (tint) document.querySelector('#tint').value = tint;
  });
  await api.ready();

  // 真实保存路径：本窗口被授权调用 widget_save。
  document.querySelector('#apply').addEventListener('click', async () => {
    const tint = document.querySelector('#tint').value;
    try {
      const snap = await api.save({ bubbleTint: tint });
      void window.__TAURI__.core.invoke('widget_sync_log', { line: 'settings saved tint=' + snap.settings.bubbleTint });
    } catch (error) {
      status.textContent = String(error);
      void window.__TAURI__.core.invoke('widget_sync_log', { line: 'settings save FAILED ' + error });
    }
  });

  // 快速连续保存 5 次 + 非对象 patch（应无破坏）+ 未知动作拒绝：自动执行写日志，由探针核对。
  (async () => {
    const invoke = window.__TAURI__.core.invoke;
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    // pet 页的订阅自检窗口约 2s：延后避免并发事件污染计数。
    await delay(6000);
    for (let i = 1; i <= 5; i++) {
      try {
        const snap = await api.save({ bubbleTint: i % 2 ? '#eee6ff' : '#ffd9ec', burst: i });
        void invoke('widget_sync_log', { line: 'burst save ' + i + ' ok tint=' + snap.settings.bubbleTint });
      } catch (error) {
        void invoke('widget_sync_log', { line: 'burst save ' + i + ' FAILED ' + error });
      }
      await delay(150);
    }
    try {
      const snap = await api.save('not-an-object');
      void invoke('widget_sync_log', { line: 'bad-patch accepted (merge unchanged) keys=' + Object.keys(snap.settings).length });
    } catch (error) {
      void invoke('widget_sync_log', { line: 'bad-patch rejected ' + error });
    }
    try { await api.online('download', 'x'); void invoke('widget_sync_log', { line: 'boundary online-mutate NOT-rejected' }); }
    catch (error) { void invoke('widget_sync_log', { line: 'boundary online-mutate rejected' }); }
    try { await api.command('definitely-not-a-command'); void invoke('widget_sync_log', { line: 'boundary settings unknown-command NOT-rejected' }); }
    catch (error) { void invoke('widget_sync_log', { line: 'boundary settings unknown-command rejected' }); }
  })();

  // 只读目录。
  try {
    const catalog = await api.online('catalog');
    const list = document.querySelector('#catalog');
    list.textContent = '';
    for (const item of catalog.items || []) {
      const line = document.createElement('div');
      line.textContent = item.name + ' · ' + item.kind + ' · ' + item.description;
      list.append(line);
    }
    void window.__TAURI__.core.invoke('widget_sync_log', { line: 'catalog items=' + (catalog.items || []).length });
  } catch (error) {
    document.querySelector('#catalog').textContent = 'catalog: ' + error;
  }
})();
