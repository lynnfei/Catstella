import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotsDir = path.join(__dirname, 'screenshots');
fs.mkdirSync(shotsDir, { recursive: true });

const toFileUrl = (rel) => 'file:///' + path.join(__dirname, rel).replace(/\\/g, '/');

async function launchBrowser() {
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      return await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
    } catch {}
  }
  throw new Error('No Chromium/Edge/Chrome browser binary available');
}

async function verifySettingsVariant(browser, variantDir, shotsPrefix) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`);
  });

  await page.goto(toFileUrl(`${variantDir}/index.html`), { waitUntil: 'networkidle' });

  const imgStats = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.map((im) => ({
      src: im.getAttribute('src'),
      complete: im.complete,
      naturalWidth: im.naturalWidth
    }));
  });

  // 0. Overview initial screenshot (for flagship/all variants)
  if (variantDir === 'compact') {
    await page.screenshot({ path: path.join(shotsDir, `${shotsPrefix}-desktop-overview.png`), fullPage: true });
  }

  // 1. Switch to Character & verify interaction
  await page.click('.nav-item[data-target="character"]');
  const snapNav = await page.evaluate(() => document.getElementById('settings-app-root').__catstellaApp.perf.getSnapshot());
  await page.click('.char-card[data-char-id="lin-cat"]');
  await page.click('[data-expr-id="shy"]');
  const snapChar = await page.evaluate(() => document.getElementById('settings-app-root').__catstellaApp.perf.getSnapshot());
  await page.locator('#pet-size').fill('1.12');
  const snapSlider = await page.evaluate(() => document.getElementById('settings-app-root').__catstellaApp.perf.getSnapshot());
  await page.screenshot({ path: path.join(shotsDir, `${shotsPrefix}-desktop-char.png`), fullPage: true });

  // 2. Wallpaper gallery + magnetic 1m-1h ruler + WAI-ARIA tablist ArrowRight keyboard nav
  await page.click('.nav-item[data-target="wallpaper"]');
  await page.click('[data-wallpaper-id="aica-clouds"]');
  await page.locator('#wp-interval').fill('15.5');
  const wpIntervalVal = await page.locator('output[for="wp-interval"]').textContent();
  await page.screenshot({ path: path.join(shotsDir, `${shotsPrefix}-desktop-gallery.png`), fullPage: true });

  await page.focus('#tab-wp-gallery');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const themeTabSelected = await page.locator('#tab-wp-theme').getAttribute('aria-selected');
  await page.click('[data-theme-preset="ocean"]');
  await page.screenshot({ path: path.join(shotsDir, `${shotsPrefix}-desktop-theme.png`), fullPage: true });

  // 3. Quota + BYOK keyed incremental patch + number input empty guard + save failure rollback + draft/save/undo flow
  await page.click('.nav-item[data-target="quota"]');
  if (variantDir === 'compact') {
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(shotsDir, `${shotsPrefix}-desktop-quota.png`), fullPage: true });
  }
  await page.click('#tab-q-byok');
  await page.click('.byok-row[data-provider-id="deepseek"] .byok-toggle-btn');
  if (variantDir === 'compact') {
    await page.screenshot({ path: path.join(shotsDir, `${shotsPrefix}-desktop-byok.png`), fullPage: true });
  }
  const snapByok = await page.evaluate(() => document.getElementById('settings-app-root').__catstellaApp.perf.getSnapshot());

  await page.click('#tab-q-cards');
  // Test incomplete number input tolerance + blur restore
  await page.locator('#q-manual-5h').fill('');
  const afterEmptyStoreVal = await page.evaluate(() => document.getElementById('settings-app-root').__catstellaApp.store.get('manualFiveHourLeft'));
  await page.locator('#q-manual-5h').blur();
  const afterBlurInputVal = await page.locator('#q-manual-5h').inputValue();

  // Test simulated save failure -> error status -> discard rollback
  await page.click('[data-sim="save-failure"]');
  await page.locator('#q-manual-5h').fill('55');
  const saveErrTone = await page.locator('[data-role="save-status"]').getAttribute('data-tone');
  const dirtyOnErr = await page.locator('[data-role="dirty-badge"]').textContent();
  await page.click('[data-action="discard-draft"]');
  const rolledBackVal = await page.locator('#q-manual-5h').inputValue();
  await page.click('[data-sim="save-failure"]');

  // Test manual draft / save / undo cycle
  await page.click('[data-bind-key="autoSave"]');
  await page.locator('#q-manual-5h').fill('64');
  const dirtyText = await page.locator('[data-role="dirty-badge"]').textContent();
  await page.click('[data-action="save-now"]');
  const afterSaveDirty = await page.locator('[data-role="dirty-badge"]').textContent();
  await page.click('[data-action="undo"]');

  // 4. Interaction + inline non-blocking reset confirm + Escape focus return + Reduced motion toggle
  await page.click('.nav-item[data-target="interact"]');
  await page.click('[data-action="pat-cat"]');
  await page.click('[data-sim="reduced-motion"]');
  const rmAttr = await page.evaluate(() => document.documentElement.getAttribute('data-reduced-motion'));
  if (variantDir === 'compact') {
    await page.screenshot({ path: path.join(shotsDir, `${shotsPrefix}-desktop-interact.png`), fullPage: true });
  }

  await page.click('.nav-item[data-target="about"]');
  await page.click('[data-action="reset-confirm-open"]');
  if (variantDir === 'compact') {
    await page.screenshot({ path: path.join(shotsDir, `${shotsPrefix}-desktop-about.png`), fullPage: true });
  }
  await page.keyboard.press('Escape');
  const resetEscapeResult = await page.evaluate(() => ({
    dialogHidden: document.querySelector('[data-reset-confirm-box]')?.hidden === true,
    focusReturned: document.activeElement?.getAttribute('data-action') === 'reset-confirm-open'
  }));

  // 5. Desktop horizontal overflow guard + Narrow 460px viewport responsive + preview toggle focus check
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.setViewportSize({ width: 460, height: 820 });
  await page.click('.nav-item[data-target="character"]');
  await page.click('[data-action="toggle-preview-dock"]');
  const narrowPreviewCheck = await page.evaluate(() => {
    const dock = document.getElementById('live-preview-dock');
    const cs = dock ? getComputedStyle(dock) : null;
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      order: cs ? cs.order : null,
      focusedDock: document.activeElement === dock
    };
  });
  await page.screenshot({ path: path.join(shotsDir, `${shotsPrefix}-narrow-460.png`), fullPage: true });

  await page.close();
  return {
    variant: variantDir,
    errors,
    brokenImages: imgStats.filter((x) => !x.complete || x.naturalWidth === 0),
    wpIntervalVal,
    themeTabSelected,
    afterEmptyStoreVal,
    afterBlurInputVal,
    saveErrTone,
    dirtyOnErr,
    rolledBackVal,
    dirtyText,
    afterSaveDirty,
    rmAttr,
    resetEscapeResult,
    desktopOverflow,
    narrowOverflow: narrowPreviewCheck.overflow,
    narrowPreviewOrder: narrowPreviewCheck.order,
    narrowPreviewFocused: narrowPreviewCheck.focusedDock,
    perf: {
      navMutations: snapNav.lastOpMutations,
      charMutations: snapChar.lastOpMutations,
      sliderMutations: snapSlider.lastOpMutations,
      byokMutations: snapByok.lastOpMutations,
      maxOpMutations: snapByok.maxOpMutations,
      fullRebuildCount: snapByok.fullRebuildCount,
      blurLayers: snapByok.blurLayerCount,
      lastOpMs: snapByok.lastOpMs
    }
  };
}

async function verifyWebChatterDemo(browser) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 780 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`);
  });

  await page.goto(toFileUrl('web-chatter-demo/index.html'), { waitUntil: 'networkidle' });

  // Scenario 1: Auto-chatter shows speech-only bubble (full panel remains hidden), then naturally retracts
  await page.click('#btn-sim-ambient');
  const speechOnlyState = await page.evaluate(() => ({
    demo: window.__catstellaWebDemo.getState(),
    speechHidden: document.getElementById('speech-only-bubble').hidden,
    panelHidden: document.getElementById('web-full-panel').hidden
  }));
  await page.screenshot({ path: path.join(shotsDir, 'web-chatter-speech-only.png'), fullPage: true });

  // Wait for 3.2s auto-retraction (+ buffer)
  await page.waitForTimeout(3500);
  const afterRetractState = await page.evaluate(() => ({
    demo: window.__catstellaWebDemo.getState(),
    speechHidden: document.getElementById('speech-only-bubble').hidden
  }));

  // Scenario 2 (Collision A): Speech-only running -> user clicks mascot wake at ~350ms -> promotes cleanly & stays open >3.5s
  await page.click('#btn-sim-ambient');
  await page.waitForTimeout(350);
  await page.click('#web-cat-wake-btn');
  await page.waitForTimeout(3500);
  const afterCollisionA = await page.evaluate(() => ({
    demo: window.__catstellaWebDemo.getState(),
    panelHidden: document.getElementById('web-full-panel').hidden,
    speechHidden: document.getElementById('speech-only-bubble').hidden
  }));
  await page.screenshot({ path: path.join(shotsDir, 'web-chatter-full-panel.png'), fullPage: true });

  // Scenario 3 (Collision B): Full panel active -> background auto-chatter fires -> must YIELD without downgrading panel
  await page.click('#btn-sim-ambient');
  const afterCollisionB = await page.evaluate(() => ({
    demo: window.__catstellaWebDemo.getState(),
    panelHidden: document.getElementById('web-full-panel').hidden,
    speechHidden: document.getElementById('speech-only-bubble').hidden
  }));

  // Scenario 4: Keyboard Enter on speech bubble -> full panel focus kept, Escape -> focus back to wake button
  await page.click('#btn-sim-reset');
  await page.click('#btn-sim-ambient');
  await page.focus('#speech-only-bubble');
  await page.keyboard.press('Enter');
  const keyboardPromoteCheck = await page.evaluate(() => ({
    panelHidden: document.getElementById('web-full-panel').hidden,
    focusInPanel: document.getElementById('web-full-panel').contains(document.activeElement)
  }));
  await page.keyboard.press('Escape');
  const keyboardEscapeCheck = await page.evaluate(() => ({
    panelHidden: document.getElementById('web-full-panel').hidden,
    focusReturnedToCat: document.activeElement?.id === 'web-cat-wake-btn'
  }));

  // Scenario 5: Narrow viewport (460x820) bounds check for both speech-only & full-panel
  await page.setViewportSize({ width: 460, height: 820 });
  await page.click('#btn-sim-reset');
  await page.click('#btn-sim-ambient');
  const narrowSpeechBounds = await page.evaluate(() => {
    const card = document.querySelector('.gemini-browser-card').getBoundingClientRect();
    const bubble = document.getElementById('speech-only-bubble').getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      insideCard: bubble.left >= card.left && bubble.right <= card.right && bubble.top >= card.top && bubble.bottom <= card.bottom
    };
  });
  await page.screenshot({ path: path.join(shotsDir, 'web-chatter-narrow-speech.png'), fullPage: true });

  await page.click('#web-cat-wake-btn');
  const narrowPanelBounds = await page.evaluate(() => {
    const card = document.querySelector('.gemini-browser-card').getBoundingClientRect();
    const panel = document.getElementById('web-full-panel').getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      insideCard: panel.left >= card.left && panel.right <= card.right && panel.top >= card.top && panel.bottom <= card.bottom
    };
  });
  await page.screenshot({ path: path.join(shotsDir, 'web-chatter-narrow-panel.png'), fullPage: true });

  await page.close();
  return {
    variant: 'web-chatter-demo',
    errors,
    speechOnlyState,
    afterRetractState,
    afterCollisionA,
    afterCollisionB,
    keyboardPromoteCheck,
    keyboardEscapeCheck,
    narrowSpeechBounds,
    narrowPanelBounds,
    narrowOverflow: narrowSpeechBounds.overflow || narrowPanelBounds.overflow
  };
}

async function verifyHub(browser) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`);
  });
  await page.goto(toFileUrl('index.html'), { waitUntil: 'networkidle' });
  const brokenImages = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img')).filter((im) => !im.complete || im.naturalWidth === 0).map((im) => im.src)
  );
  await page.screenshot({ path: path.join(shotsDir, 'study-hub-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 460, height: 820 });
  const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.close();
  return { variant: 'hub', errors, brokenImages, narrowOverflow };
}

const targetArg = process.argv[2] || 'all';
const browser = await launchBrowser();
try {
  const results = [];
  if (targetArg === 'all' || targetArg === 'hub') results.push(await verifyHub(browser));
  if (targetArg === 'all' || targetArg === 'compact') results.push(await verifySettingsVariant(browser, 'compact', 'compact'));
  if (targetArg === 'all' || targetArg === 'frosted') results.push(await verifySettingsVariant(browser, 'frosted', 'frosted'));
  if (targetArg === 'all' || targetArg === 'journal') results.push(await verifySettingsVariant(browser, 'journal', 'journal'));
  if (targetArg === 'all' || targetArg === 'web') results.push(await verifyWebChatterDemo(browser));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
