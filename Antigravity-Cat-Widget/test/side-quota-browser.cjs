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
    const arcOptionText = await settingsWin.locator('#sideQuotaVariant option[value="arc"]').textContent();
    assert.ok(!arcOptionText.includes('原神'), 'settings variant option must not mention 原神');
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

    // Verify Orchestrator Omnitrix-inspired crest toggle across arc/ring/bar & tooltip layout without overflow.
    const orchCheck = await widget.evaluate(() => {
      const mount = document.createElement('div');
      document.body.appendChild(mount);
      const variants = {};
      for (const variant of ['arc', 'ring', 'bar']) {
        window.CatstellaSideQuota.updateGaugeMount(mount, variant, `orch-test-${variant}`, {
          fiveHour: 88,
          weekly: 92,
          ghost5h: 88,
          quotaMode: 'remaining',
          side: 'left',
          draining: false,
          surging: false,
          orchestrator: true
        });
        const root = mount.querySelector('.gauge-root');
        const orchOn = {
          attr: root.dataset.orchestrator,
          orchDisplay: getComputedStyle(root.querySelector('.orch-body')).display,
          starDisplay: getComputedStyle(root.querySelector('.star-body')).display
        };
        window.CatstellaSideQuota.updateGaugeMount(mount, variant, `orch-test-${variant}`, {
          fiveHour: 88,
          weekly: 92,
          ghost5h: 88,
          quotaMode: 'remaining',
          side: 'left',
          draining: false,
          surging: false,
          orchestrator: false
        });
        const orchOff = {
          attr: root.dataset.orchestrator,
          orchDisplay: getComputedStyle(root.querySelector('.orch-body')).display,
          starDisplay: getComputedStyle(root.querySelector('.star-body')).display
        };
        variants[variant] = { orchOn, orchOff };
      }
      mount.innerHTML = '';
      const ctrl = new window.CatstellaSideQuota.SideQuotaController({
        container: mount,
        mascot: document.getElementById('mascot')
      });
      ctrl.update({
        snapshot: {
          settings: { sideQuotaEnabled: true, sideQuotaVariant: 'arc', sideQuotaSource: 'agy', manualQuota: false },
          quotaWindows: {
            online: true,
            fiveHour: 100,
            weekly: 100,
            modelInfo: { modelName: 'Gemini 4 Neon', thinking: 'Extra High', orchestrator: true }
          }
        },
        mainBubbleVisible: false,
        dragging: false,
        artReady: true
      });
      ctrl.tooltip.hidden = false;
      ctrl.tooltip.dataset.open = 'true';
      ctrl._syncTooltipContent();
      const head = ctrl.tooltip.querySelector('.quota-tooltip__head');
      const tipInfo = {
        orchHidden: ctrl.tooltip.querySelector('#sq-tip-orch').hidden,
        modelText: ctrl.tooltip.querySelector('#sq-tip-model-text').textContent,
        headOverflow: head.scrollWidth > head.clientWidth
      };

      const readCrest = () => {
        ctrl._syncTooltipContent();
        const g = ctrl.visual.querySelector('.gauge-root');
        return {
          orchAttr: g.dataset.orchestrator,
          orchDisplay: getComputedStyle(g.querySelector('.orch-body')).display,
          starDisplay: getComputedStyle(g.querySelector('.star-body')).display,
          badgeText: ctrl.tooltip.querySelector('#sq-tip-badge').textContent
        };
      };
      const baseQuota = {
        online: true,
        fiveHour: 86,
        weekly: 94,
        modelInfo: { modelName: 'Gemini 4 Neon', thinking: 'Extra High', orchestrator: true }
      };
      const webCompanion = { online: true, quota: { fiveHourRemainingPct: 60, weeklyRemainingPct: 70 } };
      ctrl.update({
        snapshot: {
          settings: { sideQuotaEnabled: true, sideQuotaVariant: 'arc', sideQuotaSource: 'auto', manualQuota: false },
          quotaWindows: baseQuota,
          webCompanion,
          visibility: { effectiveForeground: 'desktop' }
        },
        mainBubbleVisible: false,
        dragging: false,
        artReady: true
      });
      const fgDesktop = readCrest();
      ctrl.update({
        snapshot: {
          settings: { sideQuotaEnabled: true, sideQuotaVariant: 'arc', sideQuotaSource: 'auto', manualQuota: false },
          quotaWindows: baseQuota,
          webCompanion,
          visibility: { effectiveForeground: 'browser' }
        },
        mainBubbleVisible: false,
        dragging: false,
        artReady: true
      });
      const fgBrowser = readCrest();
      ctrl.update({
        snapshot: {
          settings: { sideQuotaEnabled: true, sideQuotaVariant: 'arc', sideQuotaSource: 'auto', manualQuota: false },
          quotaWindows: baseQuota,
          webCompanion,
          visibility: { effectiveForeground: 'host' }
        },
        mainBubbleVisible: false,
        dragging: false,
        artReady: true
      });
      const fgHostOrch = readCrest();
      ctrl.update({
        snapshot: {
          settings: { sideQuotaEnabled: true, sideQuotaVariant: 'arc', sideQuotaSource: 'auto', manualQuota: false },
          quotaWindows: { ...baseQuota, modelInfo: { modelName: 'Gemini 4 Pro', thinking: 'High', orchestrator: false } },
          webCompanion,
          visibility: { effectiveForeground: 'host' }
        },
        mainBubbleVisible: false,
        dragging: false,
        artReady: true
      });
      const fgHostRegular = readCrest();
      mount.remove();
      return { variants, tipInfo, fgTransitions: { fgDesktop, fgBrowser, fgHostOrch, fgHostRegular } };
    });
    for (const v of ['arc', 'ring', 'bar']) {
      assert.equal(orchCheck.variants[v].orchOn.attr, 'true');
      assert.notEqual(orchCheck.variants[v].orchOn.orchDisplay, 'none', `${v} orch-body must show`);
      assert.equal(orchCheck.variants[v].orchOn.starDisplay, 'none', `${v} star-body must hide`);
      assert.equal(orchCheck.variants[v].orchOff.attr, 'false');
      assert.equal(orchCheck.variants[v].orchOff.orchDisplay, 'none', `${v} orch-body must hide`);
      assert.notEqual(orchCheck.variants[v].orchOff.starDisplay, 'none', `${v} star-body must restore`);
    }
    assert.equal(orchCheck.tipInfo.orchHidden, false);
    assert.equal(orchCheck.tipInfo.modelText, 'Gemini 4 Neon · Extra High');
    assert.equal(orchCheck.tipInfo.headOverflow, false, 'tooltip model header must not overflow horizontally');
    assert.equal(orchCheck.fgTransitions.fgDesktop.orchAttr, 'false');
    assert.equal(orchCheck.fgTransitions.fgDesktop.orchDisplay, 'none');
    assert.notEqual(orchCheck.fgTransitions.fgDesktop.starDisplay, 'none');
    assert.equal(orchCheck.fgTransitions.fgBrowser.orchAttr, 'false');
    assert.match(orchCheck.fgTransitions.fgBrowser.badgeText, /^Web/);
    assert.equal(orchCheck.fgTransitions.fgHostOrch.orchAttr, 'true');
    assert.notEqual(orchCheck.fgTransitions.fgHostOrch.orchDisplay, 'none');
    assert.equal(orchCheck.fgTransitions.fgHostOrch.starDisplay, 'none');
    assert.match(orchCheck.fgTransitions.fgHostOrch.badgeText, /^AGY/);
    assert.equal(orchCheck.fgTransitions.fgHostRegular.orchAttr, 'false');
    assert.equal(orchCheck.fgTransitions.fgHostRegular.orchDisplay, 'none');
    assert.notEqual(orchCheck.fgTransitions.fgHostRegular.starDisplay, 'none');

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
