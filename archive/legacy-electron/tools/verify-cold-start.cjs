const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const electron = require('electron');

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catstella-cold-start-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
    characterPack: 'lin-cat',
    bubbleOn: false,
    reducedMotion: false
  }));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: electron,
    args: [
      path.join(root, 'Antigravity-Cat-Widget/src/main/index.cjs'),
      '--data-dir=' + dataDir
    ],
    env,
    timeout: 30000
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => {
      const mascot = document.getElementById('mascot');
      return mascot?.dataset.artReady === 'true';
    });
    const state = await page.evaluate(() => ({
      pack: document.getElementById('mascot').dataset.characterPack,
      idle: document.querySelector('.agy-frame--idle').getAttribute('src'),
      hidden: getComputedStyle(document.querySelector('.agy-face')).visibility
    }));
    assert.equal(state.pack, 'lin-cat');
    assert.match(state.idle, /character-packs\/lin-cat\/frames\/idle\.png/);
    assert.equal(state.hidden, 'visible');
    // Art readiness is observed in the renderer before the main process handles
    // widget:ready and shows the window. Wait for that separate lifecycle event.
    const shown = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isVisible()) return true;
      return new Promise(resolve => {
        const onShow = () => { clearTimeout(timer); resolve(true); };
        const timer = setTimeout(() => { win.removeListener('show', onShow); resolve(false); }, 8000);
        win.once('show', onShow);
      });
    });
    assert.equal(shown, true, 'desktop pet window must become visible after artwork is ready');

    const motion = await page.locator('#motion').boundingBox();
    const x = motion.x + motion.width / 2;
    const y = motion.y + Math.min(motion.height / 3, 80);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(760);
    await page.mouse.up();
    assert.equal(await page.locator('#bubble').isVisible(), false, 'a long press must not activate the desktop pet');

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 50, y + 20, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.locator('#bubble').isVisible(), false, 'a swipe or drag must not activate the desktop pet');

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.locator('#bubble[data-open="true"]').waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: cold start uses persisted artwork first; only a short stationary click activates the desktop pet.');
  } finally {
    await app.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
