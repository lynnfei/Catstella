const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function testStoreClarity() {
  const root = path.resolve(__dirname, '..');
  const catalogData = JSON.parse(fs.readFileSync(path.join(root, 'online-assets', 'catalog.json'), 'utf8'));
  const allItems = [...catalogData.items, ...catalogData.characters];

  const settingsUrl = 'file:///' + path.join(root, 'Antigravity-Cat-Widget', 'src', 'renderer', 'settings.html').replace(/\\/g, '/');
  const browser = await chromium.launch({
    channel: process.env.SKIN_BROWSER_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });

  await page.addInitScript(items => {
    window.widgetApi = window.api = {
      get: async () => ({
        settings: { characterPack: 'gemini-star-v1', syncCharacter: true, syncWallpaper: true },
        dreamSkin: { enabled: true, themePreset: 'violet', wallpaperFile: '' },
        characterPacks: [
          { id: 'gemini-star-v1', name: '星语', description: '默认角色', preview: '' },
          { id: 'lin-cat', name: '霓音', description: '粉色猫耳', preview: '' }
        ],
        wallpapers: [
          { id: 'online-moriyama-catgirl-01', title: '森山白月 · 壁纸 01', fileName: 'moriyama-catgirl-01.jpg', filePath: 'D:/Catstella/online-assets/wallpapers/moriyama-catgirl-01.jpg' }
        ]
      }),
      online: async (action, value) => {
        if (action === 'catalog') {
          return { ok: true, items };
        }
        return { ok: true };
      },
      save: async () => true,
      on: () => {},
      off: () => {}
    };
  }, allItems);

  await page.goto(settingsUrl);
  await page.waitForLoadState('domcontentloaded');

  // Click on "内容商店" tab
  const storeNav = page.locator('button.nav-item[data-page="store"]');
  await storeNav.click();

  // Wait for content-hub cards to render
  const cards = page.locator('#content-hub .hub-card');
  await page.waitForSelector('#content-hub .hub-card', { timeout: 5000 });
  const cardCount = await cards.count();
  console.log(`Found ${cardCount} cards in content-hub.`);

  // 1. Screenshot of main hub
  const hubArtifactPath = path.resolve(__dirname, '..', 'scratch', 'verify-store-hub-hires.png');
  await page.screenshot({ path: hubArtifactPath });
  console.log(`Saved hub screenshot to: ${hubArtifactPath}`);

  // 2. Click on wallpaper pack detail
  const heroBtn = page.locator('.hub-hero button.primary');
  if (await heroBtn.isVisible()) {
    await heroBtn.click();
    await page.waitForSelector('.hub-dialog[open]');
    const dialogImg = page.locator('.hub-dialog .hub-detail-art img');
    const dialogDims = await dialogImg.evaluate(img => ({
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      displayWidth: img.clientWidth,
      displayHeight: img.clientHeight
    }));
    console.log('Wallpaper dialog detail image dimensions:', dialogDims);

    // Screenshot of detail dialog
    const artifactPath = path.resolve(__dirname, '..', 'scratch', 'verify-store-detail-hires.png');
    await page.screenshot({ path: artifactPath });
    console.log(`Saved detail screenshot to: ${artifactPath}`);

    // Close dialog
    await page.locator('.hub-dialog button', { hasText: '关闭' }).click();
    await page.waitForTimeout(200);
  }

  // 3. Switch to "桌宠" filter and open detail
  const petFilter = page.locator('.hub-tabs button', { hasText: '桌宠样式' });
  await petFilter.click();
  await page.waitForTimeout(300);

  const openPetBtn = page.locator('.hub-card button.primary', { hasText: '查看详情' }).first();
  await openPetBtn.click();
  await page.waitForSelector('.hub-dialog[open]');

  const petDialogImg = page.locator('.hub-dialog .hub-detail-art img');
  const petDialogDims = await petDialogImg.evaluate(img => ({
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    displayWidth: img.clientWidth,
    displayHeight: img.clientHeight
  }));
  console.log('Pet dialog detail image dimensions:', petDialogDims);

  const petArtifactPath = path.resolve(__dirname, '..', 'scratch', 'verify-store-pet-hires.png');
  await page.screenshot({ path: petArtifactPath });
  console.log(`Saved pet detail screenshot to: ${petArtifactPath}`);

  await browser.close();
  console.log('Store clarity verification completed successfully!');
}

testStoreClarity().catch(err => {
  console.error(err);
  process.exit(1);
});
