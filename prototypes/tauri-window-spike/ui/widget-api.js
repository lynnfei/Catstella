// window.widgetApi 的 Tauri 绑定层（spike 版）。
// 已实现：get/save/ready、snapshot 订阅与取消、command（settings/navigate:页）、只读 online/catalog。
// 未实现接口显式 unsupported（reject），不假成功。
(function (root) {
  const core = root.__TAURI__ && root.__TAURI__.core;
  const events = root.__TAURI__ && root.__TAURI__.event;
  if (!core || !events) {
    root.widgetApi = null;
    return;
  }
  const invoke = core.invoke;
  const listen = events.listen;
  const api = {
    get: () => invoke('widget_get'),
    save: patch => invoke('widget_save', { patch }),
    ready: () => invoke('widget_ready'),
    online: (action, value) => invoke('widget_online', { action, value: value === undefined ? null : value }),
    command: action => invoke('widget_command', { action }),
    subscribe: async callback => await listen('widget://snapshot', event => callback(event.payload)),
    onNavigate: async callback => await listen('widget://navigate', event => callback(event.payload))
  };
  const unsupported = [
    'byok', 'rememberBubble', 'hit', 'drag', 'audio', 'pointer',
    'releaseNotes', 'markReleaseNotesSeen', 'canChatter',
    'onStep', 'onReaction', 'onRefresh'
  ];
  for (const name of unsupported) {
    api[name] = () => Promise.reject(new Error(`widgetApi.${name}: unsupported in tauri spike`));
  }
  root.widgetApi = api;
})(window);
