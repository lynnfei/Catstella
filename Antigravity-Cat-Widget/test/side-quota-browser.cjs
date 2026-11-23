const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '../..');
const entry = path.join(root, 'Antigravity-Cat-Widget/src/main/index.cjs');
const executablePath = require('electron');

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

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catstella-window-'));
  const settingsFile = path.join(dataDir, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({
    bubbleOn: false,
    manualQuota: true,
    manualPercent: 68,
    manualWeeklyPercent: 82,
    autoUpdateCheck: false,
    hostWindowOnly: false,
    petDisplayMode: 'both'
  }));

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await _electron.launch({
    executablePath,
    args: [entry, '--data-dir=' + dataDir, '--isolated-dev'],
    env,
    timeout: 25000
  });

  const errors = [];
  try {
    const widget = await app.firstWindow();
    widget.on('pageerror', err => errors.push(`widget: ${err.message}`));
    await widget.locator('#mascot[data-art-ready="true"]').waitFor({ timeout: 12000 });
    await widget.locator('#side-widget-slot[data-suppressed="false"]').waitFor({ timeout: 5000 });

    const initialGauge = await widget.evaluate(() => ({
      hidden: document.getElementById('side-widget-slot').hidden,
      variant: document.querySelector('#side-widget-visual .gauge-root')?.dataset.variant,
      aria: document.getElementById('side-widget-trigger')?.getAttribute('aria-label')
    }));
    assert.equal(initialGauge.hidden, false);
    assert.equal(initialGauge.variant, 'arc');
    assert.match(initialGauge.aria, /5小时剩余 68%/);

    // Open real settings window and verify hot-update propagation to the widget.
    const settingsWinPromise = app.waitForEvent('window');
    await widget.evaluate(() => window.widgetApi.command('settings'));
    const settingsWin = await settingsWinPromise;
    settingsWin.on('pageerror', err => errors.push(`settings: ${err.message}`));

    await settingsWin.locator('.nav-item[data-page="quota"]').waitFor({ timeout: 10000 });
    await settingsWin.waitForTimeout(250);
    const releaseBtn = settingsWin.locator('dialog.release-notes[open] button').first();
    if (await releaseBtn.isVisible().catch(() => false)) {
      await releaseBtn.click();
    }
    await settingsWin.locator('.nav-item[data-page="quota"]').click();
    await settingsWin.locator('#sideQuotaVariant').waitFor({ timeout: 10000 });
    await settingsWin.locator('#sideQuotaVariant').selectOption('ring');
    await settingsWin.locator('#sideQuotaDistance').selectOption('relaxed');
    await settingsWin.locator('#sideQuotaSize').selectOption('lg');
    await settingsWin.locator('#sideQuotaMode').selectOption('used');
    await settingsWin.locator('.nav-item[data-page="interact"]').click();
    await settingsWin.locator('#clickCatAction').waitFor({ timeout: 5000 });
    assert.equal(await settingsWin.locator('#talkCategory').count(), 0, 'settings must not render talk category selector');

    // Wait for live hot-update in widget DOM (without restart).
    await widget.waitForFunction(() => {
      const root = document.querySelector('#side-widget-visual .gauge-root');
      const trig = document.getElementById('side-widget-trigger');
      return root?.dataset.variant === 'ring'
        && root?.dataset.quotaMode === 'used'
        && (trig?.getAttribute('aria-label') || '').includes('5小时已用 32%');
    }, { timeout: 6000 });

    // Hover trigger, then simulate Win32 WS_EX_TRANSPARENT leave (where Chromium misses pointerleave) -> must auto-close without re-hovering.
    const trigBox = await widget.locator('#side-widget-trigger').boundingBox();
    await widget.mouse.move(trigBox.x + trigBox.width / 2, trigBox.y + trigBox.height / 2);
    await widget.waitForFunction(() => document.getElementById('side-widget-tooltip')?.dataset.open === 'true', { timeout: 4000 });
    assert.equal(await widget.locator('#side-widget-trigger').getAttribute('data-hovered'), 'true');
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && win.webContents.getURL().includes('/renderer/index.html'));
      w.webContents.send('widget:mouse-left');
    });
    await widget.waitForFunction(() => (
      document.getElementById('side-widget-tooltip')?.dataset.open === 'false'
      && document.getElementById('side-widget-tooltip')?.hidden === true
      && document.getElementById('side-widget-trigger')?.getAttribute('data-hovered') === 'false'
    ), { timeout: 4000 });

    // Hover/focus side trigger to verify tooltip content in Web positive usage mode.
    await widget.locator('#side-widget-trigger').focus();
    await widget.waitForFunction(() => document.getElementById('side-widget-tooltip')?.dataset.open === 'true', { timeout: 4000 });
    assert.equal(await widget.locator('#sq-tip-window-5h').textContent(), '5 小时已用');
    assert.equal(await widget.locator('#sq-tip-pct-5h').textContent(), '32%');

    // Clicking the side gauge opens the full bubble on quota page and suppresses the side gauge.
    await widget.locator('#side-widget-trigger').click();
    await widget.locator('#bubble').waitFor({ state: 'visible', timeout: 4000 });
    await widget.waitForFunction(() => document.getElementById('side-widget-slot')?.dataset.suppressed === 'true', { timeout: 4000 });

    // Switch to 喵言喵语 page and verify internal chatter shows without group badge chip.
    while ((await widget.locator('#title').textContent()) !== '喵言喵语') {
      await widget.locator('#next').click();
    }
    assert.equal(await widget.locator('#talk-topic-bar').count(), 0, 'talk bubble must not render group badge chip');
    assert.ok((await widget.locator('#value').textContent()).trim().length > 0);

    // Disabling side quota in settings immediately hides it live.
    await settingsWin.locator('.nav-item[data-page="quota"]').click();
    await settingsWin.locator('#sideQuotaEnabled').uncheck();
    await widget.waitForFunction(() => document.getElementById('side-widget-slot')?.hidden === true, { timeout: 4000 });

    assert.deepEqual(errors, []);
    console.log('PASS: side quota widget, Web used mode, hover-exit recovery, clean talk bubble, and settings hot-update verified in Electron.');
  } finally {
    await closeApp(app).catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
