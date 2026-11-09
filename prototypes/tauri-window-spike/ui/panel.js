const status = document.querySelector('#status');
const invoke = window.__TAURI__.core.invoke;

async function command(name, args) {
  try { await invoke(name, args); }
  catch (error) { status.textContent = String(error); }
}

// 立绘分区按下 → 原生拖动；拖动模态循环跨出命中区仍保持捕获。
document.querySelector('#art').addEventListener('pointerdown', event => {
  if (event.button === 0) {
    status.textContent = '拖动中……松手后恢复分区穿透。';
    void command('drag').then(() => { status.textContent = '拖动结束，分区穿透已恢复。'; });
  }
});
document.querySelector('#ignore').addEventListener('click', () => {
  status.textContent = '整窗穿透三秒，随后自动恢复。';
  void command('ignore_temporarily');
});
document.querySelector('#ping').addEventListener('click', () => {
  status.textContent = '气泡按钮已收到点击。';
  void command('bubble_ping');
});
document.querySelector('#cfg').addEventListener('click', async () => {
  status.textContent = '正在写入隔离配置……';
  try {
    const result = await invoke('cfg_experiment', { phase: 1 });
    status.textContent = '配置已写入：' + JSON.stringify(result.readback);
  } catch (error) {
    status.textContent = String(error);
  }
});
document.querySelector('#open-host').addEventListener('click', () => void command('open_host'));
document.querySelector('#follow').addEventListener('click', () => {
  status.textContent = '跟随测试宿主：位置平移 + z 序管理。';
  void command('follow_host');
});
document.querySelector('#unfollow').addEventListener('click', () => void command('stop_follow'));
document.querySelector('#settings').addEventListener('click', () => {
  status.textContent = '打开设置实验窗…';
  void window.widgetApi.command('settings');
});
document.querySelector('#exit').addEventListener('click', () => void command('exit_spike'));

// widgetApi 绑定层：快照订阅（跨窗口同步可见生效）+ 权限自检（save 应被拒）。
(async () => {
  const api = window.widgetApi;
  if (!api) return;
  const syncLog = line => void window.__TAURI__.core.invoke('widget_sync_log', { line });
  await api.ready();
  await api.subscribe(snap => {
    const tint = snap?.settings?.bubbleTint;
    if (tint) document.documentElement.style.setProperty('--bubble-tint', tint);
    void syncLog('pet applied tint=' + (tint || 'default'));
  });
  await api.onNavigate(page => {
    status.textContent = '收到导航命令: ' + page;
    void syncLog('pet navigate ' + page);
  });
  const results = {};
  try { await api.get(); results.get = 'allowed'; } catch { results.get = 'rejected'; }
  try { await api.save({ probe: true }); results.save = 'allowed'; } catch (error) { results.save = 'rejected: ' + error; }
  void syncLog('permtest pet get=' + results.get + ' save=' + results.save);

  // 订阅可靠性：事件不重复、取消后不收到、重订阅恢复（事件由 widget_test_emit 广播）。
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const emit = () => window.__TAURI__.core.invoke('widget_test_emit');
  let received = 0;
  const un1 = await api.subscribe(() => { received += 1; });
  await emit(); await delay(350);
  void syncLog('subtest after_sub delivered=' + received);
  await un1();
  await emit(); await delay(350);
  void syncLog('subtest after_unsub delivered=' + received);
  let received2 = 0;
  const un2 = await api.subscribe(() => { received2 += 1; });
  await emit(); await delay(350);
  void syncLog('subtest resub delivered=' + received2);
  await un2();

  // settings 反复开关 5 次（页面不重载，订阅不应重复或堆积），最后重开。
  for (let i = 0; i < 5; i++) {
    await api.command('settings'); await delay(180);
    await api.command('settings-hide'); await delay(180);
  }
  await api.command('settings'); await delay(300);
  await emit(); await delay(350);
  void syncLog('subtest after_toggle resub2=' + received2);
  // 边界：未知命令 / 未知 online 动作 —— 明确拒绝。
  try { await api.command('definitely-not-a-command'); void syncLog('boundary unknown-command NOT-rejected'); }
  catch (error) { void syncLog('boundary unknown-command rejected'); }
  try { await api.online('make-me-coffee'); void syncLog('boundary unknown-online NOT-rejected'); }
  catch (error) { void syncLog('boundary unknown-online rejected'); }
})();
