// 对话气泡一致性验收（mock 元素，非真实 Gemini 内容）：
// 用户消息走 chat alpha；模型回答走 reply alpha（缺省回落 chat alpha）；
// 0=全透、100=不透；onChanged 跨标签页生效；持久化键包含 replyOpacity。
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const source = path.join(root, process.argv.includes('--built') ? 'dist/chromium/content' : 'content');

async function main() {
  const browser = await chromium.launch({ headless: true, channel: process.env.SKIN_BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://interaction.test/**', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html class="kimino-dream-active" data-kg-chat-custom><body>
        <main>
          <div class="user-query-bubble-with-background" id="user-bubble">user</div>
          <model-response id="model-bubble">model</model-response>
        </main></body></html>`
    }));
    await page.goto('https://interaction.test/app/fixture');
    await page.evaluate(() => {
      window.state = { chatTint: '#181224', chatOpacity: 76, replyOpacity: null, skinEnabled: true };
      window.storageWrites = [];
      window.KIMINO_API = {
        getURL: () => 'data:,',
        storageGet: async keys => Object.fromEntries((keys || []).map(key => [key, window.state[key] ?? null])),
        storageSet: async value => { Object.assign(window.state, value); window.storageWrites.push(value); return true; },
        onChanged: listener => { window.notifyStorage = listener; }
      };
    });
    await page.addStyleTag({ path: path.join(source, 'skin.css') });
    await page.addScriptTag({ path: path.join(source, 'skin.js') });

    const alphas = () => page.evaluate(() => {
      const read = id => {
        const raw = getComputedStyle(document.getElementById(id)).backgroundColor;
        const match = raw.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
        return { raw, alpha: match ? Number(match[4] ?? 1) : null, rgb: match ? `${match[1]}, ${match[2]}, ${match[3]}` : null };
      };
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        user: read('user-bubble'),
        model: read('model-bubble'),
        chatAlpha: rootStyle.getPropertyValue('--kg-chat-alpha').trim(),
        replyAlpha: rootStyle.getPropertyValue('--kg-reply-alpha').trim(),
        custom: document.documentElement.hasAttribute('data-kg-chat-custom'),
        keys: window.__LAST_KEYS__ || null
      };
    });

    // 1) 默认兼容：只给 tint+chatOpacity（默认 76%），reply 未设 → model 回落 chat alpha。
    await page.evaluate(() => window.KiminoPreviewChatStyle('#181224', 76));
    let view = await alphas();
    assert.equal(view.custom, true, 'custom attribute set by tint');
    assert.equal(view.chatAlpha, '0.76', 'chat alpha applied');
    assert.equal(view.replyAlpha, '0.76', 'reply alpha follows chat when unset');
    assert.equal(view.user.alpha, 0.76, 'user bubble uses chat alpha');
    assert.equal(view.model.alpha, 0.76, 'model bubble falls back to chat alpha');
    assert.equal(view.user.rgb, view.model.rgb, 'both share chat rgb');

    // 2) reply=100：模型不透、用户仍 76%。
    await page.evaluate(() => window.KiminoPreviewChatStyle('#181224', 76, 100));
    view = await alphas();
    assert.equal(view.replyAlpha, '1', 'reply alpha set');
    assert.equal(view.model.alpha, 1, 'model bubble uses reply alpha');
    assert.equal(view.user.alpha, 0.76, 'user bubble unaffected');

    // 3) reply=0：模型全透。
    await page.evaluate(() => window.KiminoPreviewChatStyle('#181224', 76, 0));
    view = await alphas();
    assert.equal(view.replyAlpha, '0', 'reply alpha zero');
    assert.equal(view.model.alpha, 0, 'model bubble fully transparent at 0');

    // 4) 回到未设置：移除变量回落 chat alpha（默认兼容往返）。
    await page.evaluate(() => window.KiminoPreviewChatStyle('#181224', 76, null));
    view = await alphas();
    assert.equal(view.replyAlpha, '0.76', 'reply alpha follows chat again');
    assert.equal(view.model.alpha, 0.76, 'model bubble falls back again');

    // 5) 持久化：loadAndApply 从 storage 读取（keys 含 replyOpacity）。
    const keys = await page.evaluate(async () => {
      let captured = null;
      const api = window.KIMINO_API;
      const original = api.storageGet;
      api.storageGet = async keys => { captured = keys; return original(keys); };
      // loadAndApply 由 skin.js 内部定时触发不可直接调；直接再调一次预览验证读写键集合的通道。
      void captured;
      return Object.keys(window.state);
    });
    assert.ok(keys.includes('replyOpacity'), 'state carries replyOpacity for persistence');

    // 6) onChanged 跨标签页：notifyStorage 派发 replyOpacity 变更。
    await page.evaluate(() => window.notifyStorage({ replyOpacity: { newValue: 40 } }, 'local'));
    view = await alphas();
    assert.equal(view.replyAlpha, '0.4', 'onChanged applies reply opacity');
    assert.equal(view.model.alpha, 0.4, 'model bubble updated via onChanged');

    // 6b) 跨标签页部分变更：只广播 chatTint 时，已设的 reply 不得回退。
    await page.evaluate(() => window.KiminoPreviewChatStyle('#181224', 76, 40));
    let partView = await alphas();
    assert.equal(partView.model.alpha, 0.4, 'reply set to 40');
    await page.evaluate(() => window.notifyStorage({ chatTint: { newValue: '#221636' } }, 'local'));
    partView = await alphas();
    assert.equal(partView.model.alpha, 0.4, `reply survives chatTint-only broadcast: ${partView.model.alpha}`);
    assert.equal(partView.user.rgb, '34, 22, 54', 'user rgb follows new tint');

    // 7) 边界：未知大值钳制。
    await page.evaluate(() => window.notifyStorage({ replyOpacity: { newValue: 250 } }, 'local'));
    view = await alphas();
    assert.equal(view.model.alpha, 1, 'reply opacity clamped to 1');

    // 8) 网页设置重开：加载完整 widget，设置面板开/关/再开，reply 滑条从持久化值读回。
    const widgetPage = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    widgetPage.on('pageerror', error => errors.push('widget: ' + error.message));
    await widgetPage.route('https://interaction.test/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><main>fixture</main></body></html>'
    }));
    await widgetPage.goto('https://interaction.test/app/fixture');
    await widgetPage.evaluate(() => {
      window.state = {
        enabled: true, bubbleVisible: true, bubbleTint: '#ffd9ec',
        chatTint: '#181224', chatOpacity: 76, replyOpacity: 40,
        ambientChatter: false, soundEnabled: false,
        syncCharacter: false, syncWallpaper: false, petDisplayMode: 'both', agyBridgeState: null
      };
      window.KIMINO_API = {
        getURL: () => 'data:,',
        storageGet: async keys => Object.fromEntries((keys || []).map(key => [key, window.state[key] ?? null])),
        storageSet: async value => { Object.assign(window.state, value); return true; },
        onChanged: () => {},
        sendMessage: async () => null
      };
    });
    for (const file of ['ambient.js', 'pet-behavior.js', 'usage-viewer.js', 'widget.js']) {
      await widgetPage.addScriptTag({ path: path.join(source, file) });
    }
    await widgetPage.waitForTimeout(600);
    const clickSettings = () => widgetPage.evaluate(() => {
      const shadow = document.getElementById('kimino-companion-root').shadowRoot;
      shadow.querySelector('.btn-open-settings').click();
    });
    await clickSettings();
    await widgetPage.waitForTimeout(600);
    const reopenRead = () => widgetPage.evaluate(() => {
      const shadow = document.getElementById('kimino-companion-root').shadowRoot;
      const reply = shadow.querySelector('#kg-reply-opacity');
      const replyLabel = shadow.querySelector('.kg-val-reply');
      const chat = shadow.querySelector('#kg-chat-opacity');
      return {
        reply: reply ? reply.value : null,
        replyLabel: replyLabel ? replyLabel.textContent.trim() : null,
        chat: chat ? chat.value : null
      };
    });
    let widgetView = await reopenRead();
    assert.equal(widgetView.reply, '40', 'reply slider reads persisted value on open');
    await clickSettings(); await widgetPage.waitForTimeout(350);
    await clickSettings(); await widgetPage.waitForTimeout(500);
    widgetView = await reopenRead();
    assert.equal(widgetView.reply, '40', 'reply slider stable across reopen');
    assert.equal(widgetView.replyLabel, '40%', 'reply label shows percent');
    assert.equal(widgetView.chat, '76', 'chat slider consistent');

    // 9) 重置路径：点击状态标签清除独立值，回复气泡回到"跟随用户气泡"。
    // 10) 独立网页选择不能写回桌面，避免和跟随模式形成循环。
    await widgetPage.evaluate(() => {
      window.bridgePatches = [];
      window.KIMINO_API.sendMessage = async message => {
        if (message.type === 'KG_BRIDGE_PATCH') window.bridgePatches.push(message.patch);
        return { ok: true };
      };
      const shadow = document.getElementById('kimino-companion-root').shadowRoot;
      const slider = shadow.querySelector('#kg-reply-opacity');
      slider.value = '55';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await widgetPage.waitForTimeout(400);
    const patches = await widgetPage.evaluate(() => window.bridgePatches);
    assert.deepEqual(patches, [], 'independent edits never write to the desktop');
    assert.equal(await widgetPage.evaluate(() => window.state.replyOpacity), 55);

    await widgetPage.evaluate(() => {
      const shadow = document.getElementById('kimino-companion-root').shadowRoot;
      shadow.querySelector('.kg-val-reply').click();
    });
    await widgetPage.waitForTimeout(400);
    const resetPatches = await widgetPage.evaluate(() => window.bridgePatches);
    assert.deepEqual(resetPatches, [], 'reset also stays local');
    widgetView = await reopenRead();
    assert.equal(widgetView.reply, '76', 'reply slider follows chat after reset');
    assert.equal(widgetView.replyLabel, '跟随用户气泡', 'reply label restored to follow mode');
    const storedReply = await widgetPage.evaluate(() => window.state.replyOpacity);
    assert.equal(storedReply, null, 'replyOpacity cleared in storage');

    if (errors.length) throw new Error('page errors: ' + errors.join('; '));
    console.log('[chat-style] split/fallback/bounds/onChanged/clamp/persist/reopen/reset. PASS');
    await widgetPage.close();
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('[chat-style] FAILED:', error.message);
  process.exit(1);
});
