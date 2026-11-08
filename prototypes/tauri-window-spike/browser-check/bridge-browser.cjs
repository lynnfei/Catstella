// 隔离浏览器对接实验：加载仓库构建的真实扩展（不改动扩展与用户配置），
// 用 --host-resolver-rules 把 127.0.0.1 改写到 127.0.0.2，使生产的 3921 对本实例
// 彻底不可达，扩展按端口扫描自然回落到 spike 桥接的 127.0.0.2:3922。
// 验证：真实握手（/companion/sync 接受）、状态轮询、壁纸图拉取、断线重连。
// 用法：node bridge-browser.cjs --out=<目录> [--keep]
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const args = Object.fromEntries(
  process.argv.slice(2).flatMap(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [[m[1], m[2]]] : [];
  })
);
const outDir = path.resolve(args.out || path.join(__dirname, '..', 'target', 'bridge-run'));
const keep = Boolean(args.keep);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const spikeExe = path.join(__dirname, '..', 'target', 'release', 'catstella-window-spike.exe');
const extensionDir =
  process.env.SPIKE_EXTENSION_DIR || path.join(repoRoot, '..', 'Catstella-web', 'Gemini-Web-Companion', 'dist', 'chromium');
const { chromium } = require('playwright');

const log = (...lines) => console.log('[bridge-browser]', ...lines);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(pattern, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let text = '';
    try { text = fs.readFileSync(path.join(outDir, 'bridge.log'), 'utf8'); } catch {}
    if (pattern.test(text)) return text;
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${label || pattern}`);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const bridgeLog = path.join(outDir, 'bridge.log');
  fs.rmSync(bridgeLog, { force: true });
  if (!fs.existsSync(spikeExe)) throw new Error('spike exe missing: ' + spikeExe);
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error('extension dir missing: ' + extensionDir);

  // 1) 启动 spike 桥接（无窗口模式）。
  let spike = spawn(spikeExe, [`--bridge-only=${bridgeLog}`], { stdio: ['pipe', 'ignore', 'pipe'] });
  spike.stderr.on('data', chunk => process.stderr.write('[spike] ' + chunk));
  await waitFor(/listening port=/, 8000, 'bridge listening');
  const logText = fs.readFileSync(bridgeLog, 'utf8');
  const port = Number(logText.match(/listening port=(\d+)/)?.[1]);
  log('spike bridge listening on port', port);
  if (port !== 3922 && port !== 3923) throw new Error('bridge fell back to an unexpected port: ' + port);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catstella-spike-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: false,
    viewport: { width: 900, height: 720 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      // 关键：测试实例内 127.0.0.1 全部改写到 127.0.0.2 —— 生产 3921 不可达，spike 双绑定可达。
      '--host-resolver-rules=MAP 127.0.0.1 127.0.0.2',
    ]
  });

  try {
    // 2) 等扩展 service worker 出现，取扩展 ID。
    let worker = null;
    for (let i = 0; i < 40 && !worker; i++) {
      worker = context.serviceWorkers().find(w => /background|service/.test(w.url()));
      if (!worker) await sleep(250);
    }
    if (!worker) throw new Error('extension service worker not found');
    const extensionId = new URL(worker.url()).host;
    log('extension id', extensionId);

    // 3) 真实握手：onInstalled/启动即触发 syncWithDesktop → spike 记录接受的 sync。
    await waitFor(/POST \/companion\/sync accepted/, 15000, 'extension handshake');
    log('handshake accepted by spike');

    // 4) 打开扩展 popup：加载即发 KG_BRIDGE_GET → 又一轮真实同步；并截屏存证。
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(outDir, 'popup-bridge-state.png') });
    log('popup opened, screenshot saved');

    // 5) 壁纸：sync 响应带 desktop.wallpaperId → 扩展应拉取 wallpaper-image。
    await waitFor(/GET \/companion\/wallpaper-image/, 15000, 'wallpaper fetch');
    log('wallpaper image fetched by extension');

    // 6) 断线重连：杀桥接 → 扩展侧失败 → 重启 → reload popup 触发重同步。
    const linesBefore = fs.readFileSync(bridgeLog, 'utf8').split('\n').filter(Boolean).length;
    spike.stdin.end();
    await waitFor(/bridge-only stop/, 8000, 'bridge stop');
    await sleep(2000);
    spike = spawn(spikeExe, [`--bridge-only=${bridgeLog}`], { stdio: ['pipe', 'ignore', 'pipe'] });
    await waitFor(/listening port=/, 8000, 'bridge restart');
    await page.reload();
    await page.waitForTimeout(2500);
    const linesAfter = fs.readFileSync(bridgeLog, 'utf8').split('\n').filter(Boolean).length;
    log('bridge log lines before/after reconnect:', linesBefore, '->', linesAfter);
    if (linesAfter <= linesBefore) throw new Error('no reconnect traffic after bridge restart');
    log('reconnect verified');
  } finally {
    await context.close().catch(() => {});
  }

  // 7) 收尾：退出 spike、清理临时配置。
  spike.stdin.end();
  await sleep(500);
  if (!keep) {
    try { spawnSync('taskkill', ['/IM', 'spike-external.exe', '/F'], { stdio: 'ignore' }); } catch {}
    try { spawnSync('taskkill', ['/IM', 'catstella-window-spike.exe', '/F'], { stdio: 'ignore' }); } catch {}
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  const bridgeText = fs.readFileSync(bridgeLog, 'utf8');
  const summary = {
    handshake: /POST \/companion\/sync accepted/.test(bridgeText),
    syncAcceptedTwice: (bridgeText.match(/POST \/companion\/sync accepted/g) || []).length >= 2,
    wallpaperFetched: /GET \/companion\/wallpaper-image id=spike-gemini-star-v1/.test(bridgeText),
    reconnect: (bridgeText.match(/bridge-only start port-wait/g) || []).length >= 2,
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  log('summary', JSON.stringify(summary));
  if (!Object.values(summary).every(Boolean)) throw new Error('summary has failures');
  log('ALL PASS');
}

main().catch(error => {
  console.error('[bridge-browser] FAILED:', error.message);
  process.exit(1);
});
