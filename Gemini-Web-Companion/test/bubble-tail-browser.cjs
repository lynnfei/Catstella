// 桌宠台词气泡尾巴变量修复验证：
// 主体 --kg-bubble-tint 与尾巴必须同色（此前尾巴误读 --kg-chat-tint，
// 会被 Gemini 对话气泡颜色设置牵连或停留在 fallback）。
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const source = path.join(root, process.argv.includes('--built') ? 'dist/chromium/content' : 'content');

async function main() {
  const browser = await chromium.launch({ headless: true, channel: process.env.SKIN_BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://interaction.test/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><main>fixture</main></body></html>'
    }));
    await page.goto('https://interaction.test/app/fixture');
    await page.evaluate(() => {
      window.state = {
        enabled: true,
        bubbleVisible: true,
        bubbleTint: '#ffd9ec',
        bubbleOpacity: 100,
        chatTint: '#181224',
        chatOpacity: 76,
        ambientChatter: false,
        soundEnabled: false,
        syncCharacter: false,
        syncWallpaper: false,
        petDisplayMode: 'both',
        agyBridgeState: null
      };
      window.KIMINO_API = {
        getURL: () => 'data:image/svg+xml,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'),
        storageGet: async () => window.state,
        storageSet: async value => Object.assign(window.state, value),
        onChanged: () => {},
        sendMessage: async () => null
      };
    });
    await page.addScriptTag({ path: path.join(source, 'ambient.js') });
    await page.addScriptTag({ path: path.join(source, 'pet-behavior.js') });
    await page.addScriptTag({ path: path.join(source, 'usage-viewer.js') });
    await page.addScriptTag({ path: path.join(source, 'widget.js') });
    await page.waitForSelector('.kimino-bubble', { timeout: 5000 });
    await page.waitForTimeout(300);

    const read = () => page.evaluate(() => {
      const root = document.getElementById('kimino-companion-root').shadowRoot;
      const bubble = root.querySelector('.kimino-bubble');
      const style = getComputedStyle(bubble, '::after');
      return {
        tailBorder: style.borderTopColor,
        bodyBackground: getComputedStyle(bubble).backgroundColor,
        bubbleVar: bubble.style.getPropertyValue('--kg-bubble-tint').trim(),
        chatVar: ''
      };
    });
    const first = await read();
    // 桌宠台词气泡为固定外观（用户已把可调范围收敛到 Gemini 对话气泡）：
    // 主体与尾巴同为 rgba(22,16,38,0.94)，且尾巴不得读 --kg-chat-tint 之类的对话变量。
    assert.ok(!first.bubbleVar, 'pet bubble no longer consumes a tint variable');
    assert.ok(first.tailBorder.includes('22, 16, 38'), `tail matches body color: ${first.tailBorder}`);
    assert.ok(first.bodyBackground.includes('22, 16, 38'), `body color fixed: ${first.bodyBackground}`);

    // 对话色变量被外部设置时也不牵连桌宠尾巴。
    await page.evaluate(() => {
      const root = document.getElementById('kimino-companion-root').shadowRoot;
      const bubble = root.querySelector('.kimino-bubble');
      bubble.style.setProperty('--kg-chat-tint', '#9ff2c7');
      bubble.style.setProperty('--kg-bubble-tint', '#9ff2c7');
    });
    const second = await read();
    assert.ok(!/159,\s*242/.test(second.tailBorder), `tail unaffected by chat/bubble vars: ${second.tailBorder}`);

    if (errors.length) throw new Error('page errors: ' + errors.join('; '));
    console.log('[bubble-tail] body/tail fixed color consistent; chat tint isolated. PASS');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('[bubble-tail] FAILED:', error.message);
  process.exit(1);
});
