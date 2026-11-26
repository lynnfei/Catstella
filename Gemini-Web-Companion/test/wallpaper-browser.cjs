const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const source = path.join(root, process.argv.includes('--built') ? 'dist/chromium/content' : 'content');
const svg = color => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/></svg>`);

async function main() {
  const browser = await chromium.launch({ headless: true, channel: process.env.SKIN_BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<div id="source" style="position:fixed;width:320px;height:180px"></div><div id="mirror" style="position:fixed;top:200px;width:320px;height:180px"></div>');
    await page.addStyleTag({ path: path.join(source, 'skin.css') });
    await page.addScriptTag({ path: path.join(source, 'wallpaper.js') });
    await page.evaluate(async urls => {
      window.urls = urls;
      const source = document.querySelector('#source'), mirror = document.querySelector('#mirror');
      window.controller = new window.KiminoWallpaper(source, () => window.KiminoWallpaper.mirror(source, mirror));
      await window.controller.setSource(urls[0]);
      await window.controller.setSource(urls[1]);
    }, [svg('#8048c8'), svg('#258f9f'), svg('#ad556e'), svg('#405a9d')]);
    await page.evaluate(() => document.querySelector('#source').__kgWallpaperStage.animation.ready);
    await page.waitForTimeout(180);
    const phase = await page.evaluate(() => {
      const source = document.querySelector('#source'), mirror = document.querySelector('#mirror');
      return { source: Number(getComputedStyle(source.firstChild).opacity), mirror: Number(getComputedStyle(mirror.firstChild).opacity), duration: source.__kgWallpaperStage.animation.effect.getTiming().duration, time: source.__kgWallpaperStage.animation.currentTime, state: source.__kgWallpaperStage.animation.playState };
    });
    assert.equal(phase.duration, 1300);
    assert.ok(phase.source > 0 && phase.source < 1, 'must blend rather than instant-replace: ' + JSON.stringify(phase));
    assert.ok(Math.abs(phase.source - phase.mirror) < .02, 'fixed fade replica must share the animation phase');
    await page.evaluate(async () => { await window.controller.setSource(window.urls[2]); await window.controller.setSource(window.urls[3]); });
    await page.waitForTimeout(2700);
    assert.equal(await page.evaluate(() => window.controller.current), await page.evaluate(() => window.urls[3]));
    assert.equal(await page.locator('.kimino-wallpaper-incoming').count(), 0);
    await page.evaluate(async () => { await window.controller.setSource(window.urls[0], 'none'); });
    assert.equal(await page.locator('.kimino-wallpaper-incoming').count(), 0);
    assert.equal(await page.evaluate(() => window.controller.current), await page.evaluate(() => window.urls[0]));
    const success = await page.evaluate(() => window.controller.setSource('data:image/png;base64,broken', 'fade'));
    assert.equal(success, false);
    assert.equal(await page.evaluate(() => window.controller.current), await page.evaluate(() => window.urls[0]), 'failed decode must retain the previous image');

    await page.evaluate(async () => {
      await controller.setSource(urls[1]);
      controller.setVisible(false); // Interrupt a fade that has not been committed.
      await controller.setSource(urls[2]);
      await controller.setSource(urls[3]);
    });
    assert.equal(await page.locator('.kimino-wallpaper-incoming').count(), 0);
    assert.equal(await page.evaluate(() => controller.current), await page.evaluate(() => urls[0]));
    await page.evaluate(() => controller.setVisible(true));
    assert.equal(await page.evaluate(() => document.querySelector('#source').__kgWallpaperStage.url), await page.evaluate(() => urls[3]));
    assert.equal(await page.locator('.kimino-wallpaper-incoming').count(), 2, 'source and mirror must both resume the latest fade');
    await page.waitForFunction(() => controller.current === urls[3]);
    assert.equal(await page.locator('.kimino-wallpaper-incoming').count(), 0, 'skip intermediate background wallpapers');

    await page.evaluate(async () => {
      await controller.setSource(urls[0]);
      // A bridge configuration change can resend the same wallpaper with no fade.
      await controller.setSource(urls[0], 'none');
    });
    assert.equal(await page.evaluate(() => controller.current === urls[3] && controller.root.__kgWallpaperStage?.url === urls[0]), true);
    await page.evaluate(() => {
      // Force the finish callback to beat delivery of visibilitychange.
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      controller.root.__kgWallpaperStage.animation.finish();
    });
    await page.waitForFunction(() => !controller.root.__kgWallpaperStage);
    assert.equal(await page.evaluate(() => controller.current === urls[3]), true, 'the background must not commit an unseen fade');
    await page.evaluate(() => { delete document.hidden; controller.setVisible(true); });
    assert.equal(await page.evaluate(() => controller.root.__kgWallpaperStage?.url === urls[0]), true);

    const gallery = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const image = svg('#9159b8');
    await gallery.route('https://gallery.test/**', route => new URL(route.request().url()).pathname === '/manifest.json'
      ? route.fulfill({ json: { wallpapers: [{ id: 'local', name: '网页壁纸', src: 'local.jpg' }] } })
      : route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'self' data:; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" }, body: '<html><body></body></html>' }));
    await gallery.goto('https://gallery.test/app/fixture');
    await gallery.addStyleTag({ path: path.join(source, 'skin.css') });
    await gallery.addScriptTag({ path: path.join(source, 'shim.js') });
    await gallery.evaluate(({ image, customChar }) => {
      window.handlers = [];
      window.listCalls = 0;
      window.state = {
        enabled: true, bubbleVisible: true, syncWallpaper: true, syncCharacter: true, petDisplayMode: 'both',
        character: 'lin-cat', customCharacter: customChar, wallpaperId: 'local',
        agySyncedWallpaper: { id: 'one', title: 'one', dataUrl: image },
        customWallpapers: [{ id: 'custom:online-test', title: '已安装在线壁纸', dataUrl: customChar }],
        agyBridgeState: { online: true, port: 3921, desktop: { wallpaperId: 'one', characterPack: 'gemini-star-v1', agyQuota: { fiveHour: 75 } } }
      };
      window.storageWrites = [];
      window.__KIMINO_TRACKER__ = { subscribe(callback) {
        const base = { status:'idle', turns:3, totalTokensEst:1200, fatiguePercent:38,
          realQuota:{ displaySource:'official', currentResetTime:'15:32', weeklyUsagePercent:17, weeklyResetTime:'11月12日 10:10' } };
        window.emitTracker = patch => callback({ ...base, ...patch });
        window.emitTracker({});
      } };
      window.write = values => {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          changes[key] = { oldValue: state[key], newValue: value };
          state[key] = value;
        }
        window.handlers.forEach(fn => fn(changes, 'local'));
      };
      window.KIMINO_API = {
        getURL: path => path.endsWith('manifest.json') ? '/manifest.json' : image,
        storageGet: async () => window.state,
        storageSet: async value => { window.storageWrites.push(value); window.write(value); return true; },
        onChanged: callback => window.handlers.push(callback),
        sendMessage: async message => {
          if (message.type === 'KG_GET_DESKTOP_WALLPAPERS') {
            const call = ++window.listCalls;
            await new Promise(resolve => setTimeout(resolve, call === 1 ? 180 : 15));
            return { ok: true, wallpapers: ['one', 'two', 'three', 'four'].map(id => ({ id, title: id, revision: id + ':1' })) };
          }
          if (message.type === 'KG_GET_WALLPAPER_PREVIEW') return { ok: true, dataUrl: image };
          if (message.type === 'KG_BRIDGE_PATCH') {
            if (message.patch.dreamSkin) return { ok: false, online: false };
            window.write(message.patch);
            return { ok: true, localOnly: true };
          }
          return null;
        }
      };
    }, { image, customChar: svg('#e58f9b') });
    await gallery.addScriptTag({ path: path.join(source, 'wallpaper.js') });
    await gallery.addScriptTag({ path: path.join(source, 'wallpaper-packs.js') });
    await gallery.addScriptTag({ path: path.join(source, 'fade.js') });
    await gallery.addScriptTag({ path: path.join(source, 'skin.js') });
    await gallery.addScriptTag({ path: path.join(source, 'ambient.js') });
    await gallery.addScriptTag({ path: path.join(source, 'pet-behavior.js') });
    await gallery.addScriptTag({ path: path.join(source, 'interaction-audio.js') });
    await gallery.addScriptTag({ path: path.join(source, 'usage-viewer.js') });
    await gallery.addScriptTag({ path: path.join(source, 'widget.js') });
    await gallery.waitForFunction(() => {
      const host = document.getElementById('kimino-companion-root');
      return host?.shadowRoot?.querySelector('.kimino-wrapper')?.dataset.ready === 'true';
    });
    await gallery.locator('.agy-companion-row').waitFor();
    await gallery.locator('.btn-open-settings').click();
    await gallery.waitForFunction(() => {
      const host = document.getElementById('kimino-companion-root');
      return getComputedStyle(host.shadowRoot.querySelector('.kimino-settings')).display !== 'none';
    });
    const style = gallery.getByLabel('界面样式');
    await style.selectOption('solid');
    await gallery.waitForFunction(() => document.documentElement.dataset.kiminoStyle === 'solid');
    await style.selectOption('native');
    await gallery.waitForFunction(() => !document.documentElement.classList.contains('kimino-dream-active'));
    await style.selectOption('glass');
    await gallery.waitForFunction(() => document.documentElement.classList.contains('kimino-dream-active'));
    assert.equal(await gallery.locator('html').getAttribute('data-kimino-style'), null);
    const quotaToggle = gallery.locator('.kg-switch').filter({ has: gallery.getByLabel('同步反重力用量') });
    await quotaToggle.click();
    assert.equal(await gallery.evaluate(() => state.syncAgyUsage), false);
    assert.equal(await gallery.evaluate(() => state.syncWallpaper && state.syncCharacter), true);
    assert.equal(await gallery.locator('.agy-companion-row').evaluate(row => row.style.display), 'none');
    await quotaToggle.click();
    assert.equal(await gallery.locator('.agy-companion-row').evaluate(row => row.style.display), 'flex');
    await gallery.evaluate(() => window.write({ agyBridgeState: { ...state.agyBridgeState, desktop: {
      ...state.agyBridgeState.desktop, agyQuota: {
        fiveHour: 75, weekly: 9, geminiWeekly: 55, argonWeekly: 9, modelName: 'Argon',
        claudeGpt: { fiveHour: 92, weekly: 3, weeklyReset: '3 天后重置' }
      }
    } } }));
    await gallery.getByLabel('额度显示样式').selectOption('compact');
    const viewer = gallery.locator('.catstella-usage-viewer');
    const compactToggle = gallery.locator('.kg-switch').filter({ has: gallery.getByLabel('显示反重力模型用量') });
    assert.equal(await gallery.getByLabel('显示反重力模型用量').isChecked(), false);
    assert.equal(await viewer.locator('section').count(), 1);
    await compactToggle.click();
    await viewer.getByText('Argon · 每周', { exact: true }).waitFor({ state: 'attached' });
    assert.deepEqual(await viewer.locator('section').nth(1).locator('dt').allTextContents(), ['5 小时', '每周', 'Argon · 每周']);
    assert.match(await viewer.locator('section').nth(1).innerText(), /余 55%/);
    const webMeter = viewer.locator('section').first();
    // 2026-11-09 口径统一为剩余百分比（数据同一来源：38% 已用 = 62% 剩余）。
    assert.match(await webMeter.innerText(), /剩余 62%/);
    assert.match(await webMeter.innerText(), /剩余 83%/);
    assert.match(await webMeter.innerText(), /重置时间 15:32/);
    assert.equal(await viewer.locator('.panel').evaluate(el => getComputedStyle(el).borderTopWidth), '0px');
    await compactToggle.click();
    assert.equal(await viewer.locator('section').count(), 1);
    assert.equal(await gallery.evaluate(() => state.syncAgyUsage), true);
    await compactToggle.click();
    assert.equal(await viewer.locator('section').count(), 3);
    await quotaToggle.click();
    assert.equal(await viewer.locator('section').count(), 1);
    await quotaToggle.click();
    await gallery.keyboard.press('Escape');
    await gallery.locator('.kimino-bubble').waitFor();
    assert.equal(await gallery.locator('.kg-usage-mount').evaluate(el => el.clientHeight === el.scrollHeight && getComputedStyle(el).overflowY === 'visible'), true);
    await gallery.setViewportSize({ width: 320, height: 390 });
    await gallery.waitForFunction(() => {
      const bubble = document.getElementById('kimino-companion-root').shadowRoot.querySelector('.kimino-bubble');
      const box = bubble.getBoundingClientRect();
      return box.height > 0 && box.top >= 7 && box.bottom <= innerHeight - 7;
    });
    await gallery.setViewportSize({ width: 1200, height: 900 });
    await gallery.locator('.btn-open-settings').click();
    await gallery.getByLabel('额度显示样式').selectOption('classic');
    assert.equal(await viewer.count(), 0);
    assert.equal(await compactToggle.isVisible(), false);
    const honorific = gallery.getByLabel('桌宠互动称呼');
    await honorific.selectOption('custom');
    await gallery.getByLabel('自定义称呼').fill('  <队长>  ');
    await gallery.getByLabel('自定义称呼').dispatchEvent('change');
    await gallery.waitForFunction(() => state.customHonorific === '<队长>');
    await gallery.locator('.kimino-settings').evaluate(panel => Promise.all(panel.getAnimations().map(animation => animation.finished)));
    const settingsRect = () => gallery.locator('.kimino-settings').boundingBox();
    const beforeTabs = await settingsRect();
    await gallery.locator('.kg-tab-btn[data-tab="wallpaper"]').click();
    assert.deepEqual(await settingsRect(), beforeTabs, 'tab content must not resize the settings window');
    await gallery.evaluate(() => window.handlers.forEach(fn => fn({ agyBridgeState: { newValue: window.state.agyBridgeState } }, 'local')));
    await gallery.waitForTimeout(450);
    assert.equal(await gallery.locator('.kg-wallpaper-grid .kg-thumb').count(), 4, 'overlapping settings refreshes must not append duplicate cards');
    assert.equal(await gallery.locator('.kg-wallpaper-grid img').evaluateAll(images => images.filter(img => img.complete && img.naturalWidth > 0 && img.src.startsWith('data:')).length), 4, 'desktop previews must decode under a page CSP that blocks localhost images');
    const assertOpacity = async () => {
      const snapshot = await gallery.evaluate(() => {
        const root = document.querySelector('#kimino-companion-root').shadowRoot;
        const panel = root.querySelector('.kimino-settings');
        const first = root.querySelector('.kg-wallpaper-grid .kg-thumb');
        const slider = root.querySelector('#kg-wallpaper-opacity');
        const calls = window.listCalls;
        window.opacitySnapshot = { first, calls, top: panel.getBoundingClientRect().top, writes: storageWrites.length };
        for (const value of [52, 68, 71]) {
          slider.value = value;
          slider.dispatchEvent(new Event('input'));
        }
        return { opacity: document.querySelector('#kimino-dream-wallpaper').style.opacity, writes: storageWrites.length - window.opacitySnapshot.writes };
      });
      assert.deepEqual(snapshot, { opacity: '0.71', writes: 0 });
      await gallery.locator('#kg-wallpaper-opacity').dispatchEvent('change');
      await gallery.waitForFunction(() => state.wallpaperOpacity === .71);
      assert.equal(await gallery.evaluate(() => {
        const root = document.querySelector('#kimino-companion-root').shadowRoot;
        return root.querySelector('.kg-wallpaper-grid .kg-thumb') === opacitySnapshot.first &&
          root.querySelector('.kimino-settings').getBoundingClientRect().top === opacitySnapshot.top &&
          listCalls === opacitySnapshot.calls && storageWrites.length === opacitySnapshot.writes + 1;
      }), true, 'opacity must not move the panel, replace gallery cards, or request them again');
    };
    assert.equal(await gallery.locator('.kg-wallpaper-style').isVisible(),false);
    await gallery.evaluate(() => window.write({syncWallpaper:false}));
    await gallery.locator('.kg-wallpaper-style').waitFor();
    await assertOpacity();
    const blurSnapshot = await gallery.evaluate(() => {
      const root = document.getElementById('kimino-companion-root').shadowRoot;
      const slider = root.querySelector('#kg-wallpaper-blur');
      window.blurSnapshot = { writes: storageWrites.length, thumb: root.querySelector('.kg-wallpaper-grid .kg-thumb'), calls: listCalls };
      for (const value of [4, 9, 12]) {
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
      }
      return [getComputedStyle(document.querySelector('#kimino-dream-wallpaper')).filter, storageWrites.length - blurSnapshot.writes];
    });
    assert.deepEqual(blurSnapshot, ['blur(12px)', 0]);
    await gallery.locator('#kg-wallpaper-blur').dispatchEvent('change');
    await gallery.waitForFunction(() => state.wallpaperBlur === 12);
    assert.equal(await gallery.evaluate(() => {
      const root = document.getElementById('kimino-companion-root').shadowRoot;
      return storageWrites.length === blurSnapshot.writes + 1 && listCalls === blurSnapshot.calls &&
        root.querySelector('.kg-wallpaper-grid .kg-thumb') === blurSnapshot.thumb;
    }), true, 'blur must preview without writing or rebuilding the gallery, then save once');
    await gallery.evaluate(() => window.write({syncWallpaper:true}));
    await gallery.locator('.kg-wallpaper-grid button[title="two"]').click();
    await gallery.getByRole('status').filter({hasText:'桌面壁纸未切换'}).waitFor();
    assert.equal(await gallery.evaluate(() => state.wallpaperId), 'local');
    await gallery.locator('.kg-show-local-wall').click();
    await gallery.locator('.kg-wallpaper-grid button[title="已安装在线壁纸"]').click();
    await gallery.getByText(/网页独立：已安装在线壁纸/).waitFor();
    assert.equal(await gallery.evaluate(() => state.syncWallpaper), true, 'editing local assets must not toggle sync');
    assert.match(await gallery.locator('.kg-wall-sync-text').innerText(), /当前显示：one/);

    await gallery.locator('.kg-tab-btn[data-tab="character"]').click();
    await gallery.getByText('当前显示：星语').waitFor();
    assert.match(await gallery.locator('.kg-char-saved').innerText(), /网页独立：霓音/);
    assert.equal(await gallery.locator('.kg-file-character').count(), 0);
    await gallery.setViewportSize({ width: 320, height: 620 });
    await gallery.waitForFunction(() => {
      const panel = document.querySelector('#kimino-companion-root').shadowRoot.querySelector('.kimino-settings');
      const bounds = panel.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
    });
    assert.equal(await gallery.locator('.kg-tab-body').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await gallery.evaluate(() => window.write({ agyBridgeState: { ...state.agyBridgeState, online: false } }));
    await gallery.getByText('当前显示：霓音').waitFor();
    assert.notEqual(await gallery.locator('.kimino-sprite').getAttribute('src'), await gallery.evaluate(() => state.customCharacter));
    await gallery.locator('.kg-tab-btn[data-tab="wallpaper"]').click();
    await gallery.getByText('桌面离线 · 保留上次壁纸').waitFor();
    await gallery.waitForFunction(() => document.querySelector('#kimino-dream-wallpaper').__kgSrc === state.agySyncedWallpaper.dataUrl);
    await gallery.locator('.kg-btn-wallpaper').waitFor();
    assert.equal(await gallery.locator('.kg-wallpaper-grid button[title="已安装在线壁纸"]').getAttribute('aria-pressed'), 'true');
    const badge = await gallery.locator('.kg-wallpaper-grid .kg-active-badge').boundingBox();
    const remove = await gallery.locator('.kg-thumb-del').boundingBox();
    assert.ok(badge && remove && badge.x + badge.width <= remove.x, 'the selection badge must not overlap the delete control');
    await gallery.locator('.kg-toggle-wall-sync').click();
    await gallery.locator('.kg-wall-mode').filter({ hasText: '独立设置' }).waitFor();
    assert.equal(await gallery.evaluate(() => state.syncWallpaper), false);
    await gallery.getByText('当前显示：已安装在线壁纸').waitFor();
    await gallery.waitForFunction(() => document.querySelector('#kimino-dream-wallpaper').__kgSrc === state.customWallpapers[0].dataUrl);
    await gallery.getByLabel('壁纸铺放方式').selectOption('contain');
    await gallery.waitForFunction(() => getComputedStyle(document.querySelector('#kimino-dream-wallpaper')).backgroundSize.includes('contain'));
    await gallery.getByLabel('自动轮播',{exact:true}).evaluate(input => input.click());
    await gallery.getByLabel('轮播间隔（分钟）').fill('7');
    await gallery.getByLabel('轮播间隔（分钟）').dispatchEvent('change');
    await gallery.waitForFunction(() => state.webWallpaperSlideshow === true && state.webWallpaperInterval === 7);
    await gallery.evaluate(() => window.write({webWallpaperCycle:{anchor:state.wallpaperId,minutes:7,id:'local',nextAt:Date.now()+420000}}));
    await gallery.getByText('当前显示：网页壁纸').waitFor();
    await gallery.getByLabel('自动轮播',{exact:true}).evaluate(input => input.click());
    await gallery.getByText('当前显示：已安装在线壁纸').waitFor();
    await assertOpacity();
    await gallery.keyboard.press('Escape');
    const dialogue = gallery.locator('.kimino-dialogue');
    await dialogue.waitFor();
    await gallery.evaluate(() => window.emitTracker({ status: 'thinking', activity: { kind: 'generating' } }));
    assert.match(await dialogue.innerText(), /<队长>/);
    assert.equal(await dialogue.locator('*').count(), 0, 'the honorific remains plain text');
    await gallery.evaluate(() => {
      write({ userHonorificMode: 'desktop', agyBridgeState: { online: true, desktop: {
        honorific: { mode: 'custom', name: '指挥官' }, modelActivity: { kind: 'model-running', stepIndex: 4 }
      } } });
    });
    assert.match(await dialogue.innerText(), /Gemini.*生成/);
    assert.match(await dialogue.innerText(), /指挥官/);
    await gallery.evaluate(() => window.emitTracker({ activity: { kind: 'interrupted' } }));
    assert.match(await dialogue.innerText(), /回复中断/);
    await gallery.waitForFunction(() => {
      const root = document.getElementById('kimino-companion-root').shadowRoot;
      return root.querySelector('.kimino-dialogue').textContent.includes('模型步骤 #4');
    });
    await gallery.evaluate(() => write({ agyBridgeState: { ...state.agyBridgeState, online: false } }));
    assert.doesNotMatch(await dialogue.innerText(), /模型步骤 #4/);
    await gallery.locator('.btn-open-settings').click();
    await gallery.locator('.kg-tab-btn[data-tab="wallpaper"]').click();
    await gallery.evaluate(() => {
      const {dataUrl} = state.customWallpapers[0];
      write({customWallpapers:[...state.customWallpapers,
        {id:'custom:online-moriyama-catgirl-01',title:'套装壁纸一',dataUrl},
        {id:'custom:online-moriyama-catgirl-02',title:'套装壁纸二',dataUrl,
          pack:{id:'moriyama-catgirl-pack',name:'森山白月壁纸包',position:2}}
      ]});
    });
    const pack = gallery.locator('.kg-wallpaper-grid .wallpaper-pack');
    await pack.waitFor();
    assert.equal(await pack.getAttribute('aria-expanded'),'false');
    assert.equal(await gallery.locator('.wallpaper-pack-items button').count(),0);
    await pack.click();
    const packWall = gallery.locator('.wallpaper-pack-items .kg-thumb[title="套装壁纸二"]');
    await packWall.click();
    await gallery.waitForFunction(() => state.wallpaperId === 'custom:online-moriyama-catgirl-02');
    assert.equal(await pack.getAttribute('aria-expanded'),'true');
    await pack.click();
    await packWall.waitFor({state:'hidden'});
    const evidence = path.resolve(root, process.env.SKIN_EVIDENCE_DIR || '../evidence');
    fs.mkdirSync(evidence, { recursive: true });
    await gallery.screenshot({ path: path.join(evidence, 'wallpaper-gallery.png') });
    const worker = await browser.newPage();
    await worker.setContent('<html><body></body></html>');
    await worker.evaluate(base64 => {
      window.browser = { runtime: {} };
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      window.fetch = async () => new Response(bytes, { headers: { 'content-type': 'image/png' } });
    }, fs.readFileSync(path.join(root, 'assets/icons/icon-128.png')).toString('base64'));
    await worker.addScriptTag({ content: fs.readFileSync(path.join(root, process.argv.includes('--built') ? 'dist/chromium/background.js' : 'background.js'), 'utf8').split('async function syncDesktopWallpaperIfNeeded')[0] + '\nwindow.getPreview = wallpaperPreview;' });
    const raster = await worker.evaluate(async () => {
      const uri = await window.getPreview('fixture', '1');
      const image = new Image(); image.src = uri; await image.decode();
      return { jpeg: uri.startsWith('data:image/jpeg;base64,'), width: image.naturalWidth, height: image.naturalHeight };
    });
    assert.equal(raster.jpeg, true);
    assert.ok(raster.width > 0 && raster.width <= 320 && raster.height > 0 && raster.height <= 180);
    assert.deepEqual(errors, []);
    console.log('PASS: 1.3s wallpaper blend, shared fade phase, rapid changes, no-transition/decode fallback, CSP-safe thumbnails, native JPEG conversion, no duplicate cards.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
