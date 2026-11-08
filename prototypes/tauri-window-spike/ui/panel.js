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
document.querySelector('#open-host').addEventListener('click', () => void command('open_host'));
document.querySelector('#follow').addEventListener('click', () => {
  status.textContent = '跟随测试宿主：位置平移 + z 序管理。';
  void command('follow_host');
});
document.querySelector('#unfollow').addEventListener('click', () => void command('stop_follow'));
document.querySelector('#exit').addEventListener('click', () => void command('exit_spike'));
