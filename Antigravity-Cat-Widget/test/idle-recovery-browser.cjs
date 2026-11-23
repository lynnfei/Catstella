const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '../..');
const entry = path.join(root, 'Antigravity-Cat-Widget/src/main/index.cjs');
const pkgVersion = require(path.join(root, 'package.json')).version;

async function waitForCondition(check, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message || 'Timed out waiting for condition');
}

async function closeApp(app) {
  const proc = app.process();
  let timer;
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Electron exit timeout')), 6000);
      })
    ]);
  } finally {
    clearTimeout(timer);
    if (proc && proc.exitCode === null && proc.signalCode === null) proc.kill();
  }
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'catstella-window-'));
  const settingsFile = path.join(dataDir, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({
    hostWindowOnly: false,
    standaloneDesktopMode: true,
    petDisplayMode: 'both',
    alwaysOnTop: true,
    autoUpdateCheck: false,
    seenReleaseNotes: [pkgVersion],
    x: 120,
    y: 120
  }));

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  let app;
  const errors = [];
  try {
    app = await _electron.launch({
      executablePath: require('electron'),
      args: [entry, '--data-dir=' + dataDir, '--isolated-dev'],
      env,
      timeout: 25000
    });
    const pet = await app.firstWindow();
    pet.on('pageerror', err => errors.push(err.message));
    await pet.locator('#mascot[data-art-ready="true"]').waitFor({ timeout: 12000 });

    const getWinState = () => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && win.webContents.getURL().includes('/renderer/index.html'));
      if (!w) return null;
      return {
        visible: w.isVisible(),
        minimized: w.isMinimized(),
        alwaysOnTop: w.isAlwaysOnTop(),
        bounds: w.getBounds()
      };
    });

    await waitForCondition(async () => (await getWinState())?.visible === true, 5000, 'Window did not become visible on startup');

    // 1. Respect screenLocked: hiding while screen is locked must stay hidden until unlocked.
    await app.evaluate(({ BrowserWindow, powerMonitor }) => {
      const w = BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && win.webContents.getURL().includes('/renderer/index.html'));
      powerMonitor.emit('lock-screen');
      w.hide();
    });
    await pet.waitForTimeout(2400);
    assert.equal((await getWinState()).visible, false, 'Hidden window must stay hidden while screenLocked=true');

    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('unlock-screen');
    });
    await waitForCondition(async () => (await getWinState())?.visible === true, 5000, 'Window did not recover after unlock-screen');

    // 2. Unexpected silent hide while desktop is unlocked -> recoveryTimer restores it.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && win.webContents.getURL().includes('/renderer/index.html'));
      w.hide();
    });
    assert.equal((await getWinState()).visible, false);
    await waitForCondition(async () => (await getWinState())?.visible === true, 5500, 'recoveryTimer did not restore silently hidden window');

    // 3. Programmatic minimize (if permitted by OS/frameless flags) -> recoveryTimer restores it.
    const minimizedAttempt = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && win.webContents.getURL().includes('/renderer/index.html'));
      w.minimize();
      return w.isMinimized();
    });
    if (minimizedAttempt) {
      await waitForCondition(async () => {
        const s = await getWinState();
        return s && !s.minimized && s.visible;
      }, 5500, 'recoveryTimer did not restore minimized window');
    }

    // 4. Offscreen / Win32 minimized (-32000, -32000) coordinates -> recoveryTimer pulls back to visible display.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && win.webContents.getURL().includes('/renderer/index.html'));
      const b = w.getBounds();
      w.setBounds({ x: -32000, y: -32000, width: b.width, height: b.height });
    });
    await waitForCondition(async () => {
      const b = (await getWinState())?.bounds;
      return b && b.x > -200 && b.y > -200;
    }, 5500, 'recoveryTimer did not recover offscreen -32000 bounds');

    // 5. Dummy display-removed (empty display list during monitor standby) must NOT clobber saved coords.
    const beforeDisplayEvent = await getWinState();
    const savedBefore = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    await app.evaluate(({ screen }) => {
      const orig = screen.getAllDisplays.bind(screen);
      screen.getAllDisplays = () => [];
      screen.emit('display-removed');
      screen.getAllDisplays = orig;
    });
    await pet.waitForTimeout(200);
    const savedAfter = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.equal(savedAfter.x, savedBefore.x);
    assert.equal(savedAfter.y, savedBefore.y);
    assert.deepEqual((await getWinState()).bounds, beforeDisplayEvent.bounds);

    // Verify recovery telemetry recorded the real events cleanly.
    const recLog = fs.readFileSync(path.join(dataDir, 'recovery.log'), 'utf8');
    assert.match(recLog, /hidden-window-restore/);
    assert.match(recLog, /offscreen-bounds-restore/);
    if (minimizedAttempt) assert.match(recLog, /minimized-window-restore/);
    assert.deepEqual(errors, []);

    console.log('PASS: idle recovery (lock-screen respect, hidden/minimized restore, -32000 offscreen recovery, standby display-removed safety).');
  } finally {
    if (app) await closeApp(app);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
