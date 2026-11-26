const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const source = path.join(root, process.argv.includes('--built') ? 'dist/chromium/content' : 'content');

async function main() {
  const browser = await chromium.launch({ headless: true, channel: process.env.SKIN_BROWSER_CHANNEL || 'msedge',
    args:['--js-flags=--max-old-space-size=96'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://interaction.test/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><main>fixture</main></body></html>'
    }));
    await page.goto('https://interaction.test/app/fixture');
    await page.evaluate(() => {
      Math.random = () => .99; // A tap must animate even when no expression is drawn.
      window.storageWrites = [];
      window.headPatTotal = 0;
      window.audioInstances = 0;
      window.Audio = class {
        constructor() { window.audioInstances++; }
        pause() {}
        play() { return Promise.resolve(); }
      };
      window.startedAnimations = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        window.startedAnimations.push(animation);
        return animation;
      };
      window.quotaResult = false;
      window.quotaRequests = 0;
      const snapshot = { status: 'idle', turns: 1, totalTokensEst: 100, fatiguePercent: 10, realQuota: {} };
      window.__KIMINO_TRACKER__ = {
        sessionData: snapshot,
        subscribe: callback => { window.emitTracker = (data = {}) => callback({ ...snapshot, ...data }); window.emitTracker(); },
        refreshUsageLedger: async () => { window.quotaRequests++; return window.quotaResult; }
      };
      window.state = {
        enabled: true,
        bubbleVisible: false,
        ambientChatter: false,
        soundEnabled: true,
        syncCharacter: false,
        syncWallpaper: false,
        petDisplayMode: 'prefer-web', // A legacy setting still maps to a visible Web choice.
        agyBridgeState: null
      };
      window.KIMINO_API = {
        getURL: () => 'data:image/svg+xml,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="240"><rect width="200" height="240" fill="#8b6fd3"/></svg>'
        ),
        storageGet: async () => window.state,
        storageSet: async value => {
          window.storageWrites.push(value);
          if (window.failStorage) return false;
          Object.assign(window.state,value);
          return true;
        },
        onChanged: listener => { window.notifyStorage = listener; },
        sendMessage: async message => message.type === 'KG_HEAD_PAT' ? { total: ++window.headPatTotal,today:window.headPatTotal } : null
      };
    });
    await page.addScriptTag({ path: path.join(source, 'ambient.js') });
    await page.addScriptTag({ path: path.join(source, 'pet-behavior.js') });
    await page.addScriptTag({ path: path.join(source, 'interaction-audio.js') });
    await page.addScriptTag({ path: path.join(source, 'usage-viewer.js') });
    await page.addScriptTag({ path: path.join(source, 'widget.js') });

    await page.waitForFunction(() => {
      const host = document.getElementById('kimino-companion-root');
      return host?.shadowRoot?.querySelector('.kimino-wrapper')?.dataset.ready === 'true';
    });
    const character = page.locator('.kimino-character-box');
    await character.waitFor();
    const box = await character.boundingBox();
    assert.ok(box, 'character must have a pointer target');
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(box.height / 3, 80);

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(760);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.storageWrites.length), 0, 'a held pointer must not activate the character');

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 45, y + 25, { steps: 5 });
    await page.mouse.up();
    const dragged = await page.evaluate(() => window.storageWrites);
    assert.equal(dragged.length, 1, 'only the final drag position is persisted');
    assert.ok(Number.isFinite(dragged[0].widgetPos?.x) && Number.isFinite(dragged[0].widgetPos?.y));
    const moved = await character.boundingBox();
    assert.ok(moved.x > box.x + 10 && moved.y > box.y + 10, 'the pet follows the drag');
    assert.equal(await page.evaluate(() => startedAnimations.filter(a => a.id === 'catstella-head-tap').length), 0);
    assert.equal(await page.evaluate(() => startedAnimations.filter(a => a.id === 'catstella-head-spark').length), 0);
    assert.equal(await page.evaluate(() => headPatTotal), 0);

    await page.mouse.move(moved.x + moved.width / 2, moved.y + Math.min(moved.height / 3, 80));
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(80);
    const writes = await page.evaluate(() => window.storageWrites);
    assert.ok(writes.some(value => value.bubbleVisible === true), 'a short stationary click must activate the character');
    assert.equal(await page.evaluate(() => startedAnimations.filter(a => a.id === 'catstella-head-tap').length), 1, 'tap animates independently of expressions');
    assert.equal(await page.evaluate(() => startedAnimations.filter(a => a.id === 'catstella-head-spark').length), 1, 'short head taps always show a visible spark');
    assert.equal(await page.evaluate(() => headPatTotal), 1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.click(moved.x + moved.width / 2, moved.y + 65);
    assert.equal(await page.evaluate(() => startedAnimations.filter(a => a.id === 'catstella-head-tap').length), 1);
    assert.equal(await page.evaluate(() => startedAnimations.filter(a => a.id === 'catstella-head-spark').length), 2);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const targetX=moved.x+moved.width/2,targetY=moved.y+65;
    await page.mouse.click(targetX,targetY);
    const quip=await page.locator('.kimino-dialogue').innerText();
    assert.match(quip,/3 次/);
    for(let i=0;i<12;i++)await page.mouse.click(targetX,targetY);
    assert.equal(await page.locator('.kimino-dialogue').innerText(),quip);
    assert.deepEqual(await page.evaluate(() => [
      headPatTotal,audioInstances,startedAnimations.filter(a => a.id === 'catstella-head-tap').length,
      startedAnimations.filter(a => a.id === 'catstella-head-spark').length
    ]),[15,2,1,3]);
    assert.match(await page.locator('.kimino-sprite').evaluate(el => getComputedStyle(el).filter), /drop-shadow\(rgba\(189, 162, 242/);
    const sync = page.locator('.btn-sync-quota');
    await sync.click();
    await page.getByRole('button', { name: '未确认' }).waitFor();
    assert.notEqual(await page.locator('.kimino-wrapper').getAttribute('data-nuzzling'), 'true');
    assert.equal(await page.evaluate(() => startedAnimations.filter(a => a.id === 'catstella-quota-success').length), 0);
    await page.evaluate(() => { window.quotaResult = true; });
    await sync.click();
    await page.getByRole('button', { name: '已同步' }).waitFor();
    assert.equal(await page.locator('.kimino-wrapper').getAttribute('data-nuzzling'), 'true');
    assert.equal(await page.evaluate(() => startedAnimations.filter(a => a.id === 'catstella-quota-success').length), 1);
    assert.equal(await page.evaluate(() => window.quotaRequests), 2, 'one refresh per manual click');
    await page.evaluate(() => window.emitTracker({ status: 'thinking', activity: { kind: 'generating' } }));
    await page.getByText(/Gemini 正在生成/).waitFor();
    await page.evaluate(() => window.emitTracker({ quotaReset: { cycle: 'weekly', at: Date.now() } }));
    await page.getByText(/每周额度已进入新周期|周额度重置啦/).waitFor();
    const petBox = await character.boundingBox();
    await page.mouse.move(petBox.x + petBox.width / 2, petBox.y + 60);
    await page.mouse.down();
    await page.mouse.move(4, 4, {steps:5});
    assert.equal(await page.locator('.kimino-wrapper').getAttribute('data-facing'), 'left', 'flip during drag, before release');
    assert.match(await page.locator('.kimino-sprite').evaluate(el => getComputedStyle(el).transform), /^matrix\(-1,/);
    await page.mouse.up();
    const bubble = await page.locator('.kimino-bubble').boundingBox();
    assert.ok(bubble && bubble.x >= 0 && bubble.y >= 0, 'the bubble remains reachable at the top-left dock');
    await page.locator('.btn-open-settings').click();
    assert.deepEqual(await page.locator('.kg-seg-btn').allTextContents(), ['双端同显','仅桌面端']);
    assert.equal(await page.locator('.kg-seg-btn.active').getAttribute('data-mode'), 'both');
    await page.evaluate(()=>emitTracker({fatiguePercent:25,realQuota:{weeklyUsagePercent:40,displaySource:'official'}}));
    assert.equal(await page.locator('.cur-quota-pct').textContent(),'剩余 75%');
    assert.equal(await page.locator('.week-quota-pct').textContent(),'剩余 60%');
    const display=page.getByLabel('额度显示方式',{exact:true});
    await display.selectOption('used');
    await page.waitForFunction(()=>state.quotaDisplay==='used');
    assert.equal(await page.locator('.cur-quota-pct').textContent(),'已使用 25%');
    assert.equal(await page.locator('.cur-quota-bar').evaluate(el=>el.style.width),'25%');
    assert.equal(await page.locator('.week-quota-pct').textContent(),'已使用 40%');
    await page.evaluate(()=>{
      Object.assign(state,{quotaView:'compact',showAgyQuotaInCompact:true,agyBridgeState:{online:true,desktop:{agyQuota:{fiveHour:80,geminiWeekly:35}}}});
      notifyStorage({quotaView:{newValue:'compact'},showAgyQuotaInCompact:{newValue:true},agyBridgeState:{newValue:state.agyBridgeState}},'local');
    });
    assert((await page.locator('.catstella-usage-viewer .reading span').allTextContents()).includes('已使用 25%'));
    assert((await page.locator('.catstella-usage-viewer .reading span').allTextContents()).includes('已使用 20%'),'AGY remaining is inverted only for presentation');
    await display.selectOption('remaining');
    await page.waitForFunction(()=>state.quotaDisplay==='remaining');
    assert((await page.locator('.catstella-usage-viewer .reading span').allTextContents()).includes('剩余 75%'));
    assert((await page.locator('.catstella-usage-viewer .reading span').allTextContents()).includes('剩余 80%'));
    await page.evaluate(()=>emitTracker({fatiguePercent:100,realQuota:{fivePending:true,weeklyPending:true}}));
    assert.equal(await page.locator('.cur-quota-pct').textContent(),'等待更新');
    assert.equal(await page.locator('.week-quota-pct').textContent(),'等待更新');
    assert.deepEqual(errors, []);
    console.log('PASS: web pet drag moves without activating; short stationary taps still animate.');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
