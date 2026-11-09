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
