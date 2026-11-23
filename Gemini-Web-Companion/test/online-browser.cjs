const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const packMode = process.argv.includes('--seed');
const root = process.argv.includes('--built')
  ? path.resolve(process.env.CATSTELLA_WEB_DIST || path.join(__dirname, '../dist'), 'chromium')
  : path.resolve(__dirname, '..');
const base = 'https://online-fixture.test';
const assetBase = 'https://raw.githubusercontent.com/lynnfei/Catstella/main/online-assets/';
const wall = fs.readFileSync(path.join(root, 'assets/icons/icon-128.png'));
const theme = Buffer.from(JSON.stringify({ schema: 1, palette: 'ocean', opacity: 75 }));
const character = Buffer.from(JSON.stringify({ schema: 1, frames: { idle: 'data:image/png;base64,' + wall.toString('base64') } }));
const record = (kind, id, ext, bytes, name) => ({ id, kind, name, credit: '测试素材',
  path: `${kind}s/${id}.${ext}`, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
const catalog = { schema: 1, items: [record('wallpaper', 'sample', 'png', wall, '示例壁纸'),
  record('theme', 'night', 'json', theme, '示例主题')],
  characters: [record('character', 'sample-cat', 'json', character, '示例桌宠')] };
const fixture = `
  window.store = { syncWallpaper: true, wallpaperId: 'old',
    agyBridgeState:{online:true,desktop:{characterPackIds:['online-sample-cat'],wallpaperIds:[]}} };
  window.openedTabs = [];
  window.storageListeners = [];
  window.chrome = {
    runtime: {
      id: 'catstella', getURL: p => location.origin + '/' + p,
      getManifest: () => ({version: '1.5.0'}),
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener(listener) { window.receiver = listener; } },
      sendMessage(msg, respond) { window.receiver(msg, {url: location.href, id: 'catstella'}, respond); }
    },
    storage: { local: {
      get(keys, cb) { queueMicrotask(() => cb(structuredClone(store))); },
      set(value, cb) {
        if (window.failStorage) { chrome.runtime.lastError={message:'storage full'}; queueMicrotask(()=>{cb();delete chrome.runtime.lastError;}); }
        else {
          const changes=Object.fromEntries(Object.entries(value).map(([key,newValue])=>[key,{oldValue:store[key],newValue}]));
          Object.assign(store, value); queueMicrotask(()=>{cb();storageListeners.forEach(listener=>listener(changes,'local'));});
        }
      }
    }, onChanged:{addListener(listener){storageListeners.push(listener);}} },
    tabs: { create: async value => openedTabs.push(value) },
    action: { setBadgeText: ({text}) => window.badge = text }
  };
`;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.SKIN_BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const fulfill = (route, body, contentType) => route.fulfill({ body, contentType, headers: { 'access-control-allow-origin': '*' } });
    let bridgeUp = false, desktopSyncWallpaper = true;
    await page.route('http://127.0.0.1:*/**', route => {
      if (!bridgeUp) return route.abort();
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-private-network': 'true' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const syncWallpaper = route.request().postDataJSON()?.patch?.syncWallpaper;
      if (typeof syncWallpaper === 'boolean') desktopSyncWallpaper = syncWallpaper;
      return route.fulfill({ json: { ok: true, desktop: {}, sync: { syncWallpaper: desktopSyncWallpaper } }, headers });
    });
    await page.route(base + '/**', route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (name === 'fixture.js') return fulfill(route, fixture, 'text/javascript');
      if (!fs.existsSync(path.join(root, name))) return route.fulfill({status:404,body:''});
      const data = fs.readFileSync(path.join(root, name));
      if (name === 'online/index.html') return fulfill(route, data.toString().replace(
        '<script src="../content/shim.js">',
        '<script src="/fixture.js"></script><script src="/online/client.js"></script><script src="/background.js"></script><script src="../content/shim.js">'), 'text/html; charset=utf-8');
      return fulfill(route, data, name.endsWith('.css') ? 'text/css' : 'text/javascript; charset=utf-8');
    });
    let updateRequests = 0;
    await page.route('https://api.github.com/repos/lynnfei/Catstella/releases**', route => {
      updateRequests++;
      return fulfill(route, JSON.stringify([
        { draft: false, prerelease: false, tag_name: 'desktop-v9.0.0', assets: [{ state: 'uploaded', name: 'Catstella-Setup-9.0.0-x64.exe' }] },
        { draft: false, prerelease: false, tag_name: 'web-v1.5.1', assets: [{ state: 'uploaded', name: 'kimino-gemini-companion.xpi' }] }
      ]), 'application/json');
    });
    let corrupt = false, disconnected = packMode;
    await page.route(assetBase + '**', route => {
      const file = route.request().url().slice(assetBase.length);
      if (file === 'catalog.json') return disconnected ? route.abort() : fulfill(route, JSON.stringify(catalog), 'application/json');
      if (file === 'themes/night.json') return fulfill(route, theme, 'application/json');
      if (file === 'characters/sample-cat.json') return fulfill(route, character, 'application/json');
      return fulfill(route, corrupt ? Buffer.alloc(wall.length) : wall, 'image/png');
    });
    await page.goto(base + '/online/index.html');
    if (packMode) {
      await page.getByText(/无法连接 GitHub/).waitFor();
      await page.waitForFunction(() => document.querySelector('.hub-hero-caption')?.textContent.startsWith('2 / 9'),{},{timeout:8500});
      await page.getByRole('button',{name:'上一张推荐壁纸'}).click();
      await page.getByRole('button',{ name:'查看壁纸包' }).click();
      const detail = page.getByRole('dialog');
      assert.equal(await detail.locator('.hub-strip button').count(),9);
      await page.mouse.move(1,1);
      await page.waitForFunction(() => document.querySelector('.hub-preview-count')?.textContent === '2 / 9',{},{timeout:8500});
      await detail.getByRole('button',{name:'上一张'}).click();
      await detail.getByRole('button',{name:'下一张'}).click();
      assert.equal(await detail.locator('.hub-preview-count').innerText(),'2 / 9');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await detail.locator('.hub-preview-count').innerText(),'1 / 9');
      await detail.getByRole('button',{ name:'安装整套（9 张）' }).click();
      await detail.getByText('已安装 9 项，可从本地图库切换。').waitFor({timeout:40000});
      assert.equal(await page.evaluate(() => store.customWallpapers.length),9);
      assert.equal(await page.evaluate(() => store.customWallpapers.every(wall => wall.pack?.id === 'moriyama-catgirl-pack')),true);
      assert.equal(await page.evaluate(() => store.wallpaperId),'old');
      await detail.locator('.hub-strip button').last().click();
      await detail.getByRole('button',{ name:'使用这项素材' }).click();
      await detail.getByRole('button',{ name:'正在使用' }).waitFor();
      assert.equal(await page.evaluate(() => store.wallpaperId),'custom:online-moriyama-catgirl-09');
      assert.deepEqual(errors,[]);
      console.log('PASS: built Web Hub installs all nine seeded wallpapers offline and applies the selected image separately.');
      return;
    }
    await page.getByText('更新与配色管理').click();
    await page.getByText(/发现新版本 1.5.1/).waitFor();
    assert.equal(await page.evaluate(() => window.badge), 'NEW');
    await page.getByRole('button', { name: '查看发行页' }).click();
    await page.waitForFunction(() => openedTabs.length === 1);
    assert.match(await page.evaluate(() => openedTabs[0].url), /\/web-v1\.5\.1$/);
    assert.equal(updateRequests, 1);
    await page.getByRole('button', { name: '预览 示例主题' }).click();
    const detail = page.getByRole('dialog');
    await detail.getByText('壁纸不透明度 75%').waitFor();
    assert.equal(await detail.locator('.hub-detail-art').getAttribute('data-palette'), 'ocean');
    assert.equal(await page.evaluate(() => store.wallpaperOpacity), undefined, 'theme preview must not apply anything');
    await detail.getByRole('button',{name:'阅读区',exact:true}).click();
    assert.equal(await detail.locator('.hub-theme-reading').isVisible(),true);
    await detail.getByRole('button', { name: '应用配色' }).click();
    await detail.getByText('已应用 示例主题').waitFor();
    await page.evaluate(()=>KIMINO_API.storageSet({onlinePalette:'pink',wallpaperOpacity:.43}));
    await detail.getByRole('button',{name:'当前搭配',exact:true}).click();
    assert.equal(await detail.locator('.hub-detail-art').getAttribute('data-palette'),'pink');
    assert.equal(await detail.locator('.hub-theme-sample').evaluate(el=>el.style.getPropertyValue('--sample-opacity')),'0.43');
    await page.evaluate(()=>KIMINO_API.storageSet({onlinePalette:'ocean',wallpaperOpacity:.75}));
    await detail.getByRole('button', { name: '关闭' }).click();
    await detail.waitFor({state:'hidden'});
    assert.deepEqual(await page.evaluate(() => [store.onlinePalette, store.wallpaperOpacity, store.wallpaperId]), ['ocean', .75, 'old']);
    await page.getByRole('button',{name:'预览 示例主题'}).click();
    await page.evaluate(()=>KIMINO_API.storageSet({onlineThemeRevision:'0'.repeat(64)}));
    await detail.getByRole('button',{name:'更新到最新版',exact:true}).click();
    await detail.getByText('已安装 1 项，可从本地图库切换。').waitFor();
    assert.equal(await page.evaluate(()=>store.onlineThemeRevision),catalog.items.find(item=>item.id==='night').sha256);
    await detail.getByRole('button',{name:'关闭'}).click();await detail.waitFor({state:'hidden'});
    await page.getByRole('button', { name: '预览 示例桌宠' }).click();
    await detail.getByText('桌面端已安装',{exact:true}).waitFor();
    assert.equal(await detail.getByRole('button',{name:'仅桌面端可用'}).getAttribute('aria-disabled'),'true');
    assert.equal(await page.evaluate(() => !!store.onlineCharacterPacks),false);
    await detail.getByRole('button', { name: '另存到网页' }).click();
    await detail.getByRole('button', { name: '使用这项素材' }).waitFor();
    await detail.getByRole('button', { name: '关闭' }).click();
    await detail.waitFor({state:'hidden'});
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '预览 示例桌宠');
    assert.ok(await page.evaluate(() => store.onlineCharacterPacks['online-sample-cat'].frames.idle));
    await page.evaluate(()=>KIMINO_API.storageSet({character:'online-sample-cat',syncCharacter:false}));
    const queued = await page.evaluate(async()=>Promise.all([
      KIMINO_API.sendMessage({type:'KG_ONLINE',action:'download',value:'sample-cat'}),
      KIMINO_API.sendMessage({type:'KG_ONLINE',action:'uninstall',value:'sample-cat'})
    ]));
    assert(queued.every(result=>result.ok));
    assert.equal(await page.evaluate(()=>!!store.onlineCharacterPacks['online-sample-cat']),false,'uninstall runs after the queued install');
    assert.equal(await page.evaluate(()=>store.character),'gemini-star-v1');
    await page.setViewportSize({width:480,height:560});
    const opener = page.getByRole('button', { name: '预览 示例壁纸' });
    await opener.scrollIntoViewIfNeeded();
    await opener.evaluate(button => {
      button.addEventListener('click', () => {
        window.savedHubPosition = document.scrollingElement.scrollTop;
        window.savedHubOpener = button;
      }, {capture:true,once:true});
    });
    await opener.click();
    assert.ok(await page.evaluate(() => savedHubPosition > 0));
    await detail.getByRole('button', { name: '安装这项素材' }).click();
    await detail.getByRole('button', { name: '使用这项素材' }).waitFor();
    const saved = await page.evaluate(async () => {
      const asset = store.customWallpapers[0];
      const img = new Image();
      img.src = asset.dataUrl;
      await img.decode();
      return { id: store.wallpaperId, sync: store.syncWallpaper, width: img.naturalWidth, url: asset.dataUrl };
    });
    assert.deepEqual([saved.id, saved.sync, saved.width], ['old', true, 128]);
    await detail.getByRole('button', { name: '使用这项素材' }).click();
    await detail.getByRole('button', { name: '正在使用' }).waitFor();
    assert.equal(await detail.getByRole('button', { name: '正在使用' }).evaluate(button => document.activeElement === button), true);
    await detail.getByRole('button', { name: '关闭' }).click();
    await detail.waitFor({state:'hidden'});
    await page.waitForFunction(() => document.activeElement === savedHubOpener);
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), await page.evaluate(() => savedHubPosition));
    assert.equal(await page.evaluate(() => store.pendingOnlineWallpaper?.enabled), false);
    bridgeUp = true;
    await page.evaluate(async () => {
      const ping = () => window.KIMINO_API.sendMessage({ type: 'KG_TAB_HEARTBEAT', active: true });
      await ping();
      await ping();
    });
    await page.waitForFunction(() => store.pendingOnlineWallpaper === false);
    assert.equal(desktopSyncWallpaper, false, 'the first successful sync must keep the new Web wallpaper independent');
    assert.equal(await page.evaluate(() => store.syncWallpaper), false);
    // A revision-less legacy item remains usable, and removing it restores a valid selection.
    await opener.click();
    await page.evaluate(()=>{delete store.customWallpapers[0].revision;});
    await detail.getByRole('button',{name:'卸载',exact:true}).click();
    await page.evaluate(()=>{window.failStorage=true;});
    await detail.getByRole('button',{name:'确认卸载？',exact:true}).click();
    await detail.getByText('素材操作失败，请重试。').waitFor();
    assert.equal(await page.evaluate(()=>store.customWallpapers.length),1);
    await page.evaluate(()=>{window.failStorage=false;});
    await detail.getByRole('button',{name:'卸载',exact:true}).click();
    await detail.getByRole('button',{name:'确认卸载？',exact:true}).click();
    await detail.getByText('已卸载，可随时重新安装。').waitFor();
    assert.equal(await page.evaluate(()=>store.wallpaperId),'gemini-character-sheet-v1');
    assert.equal(await page.evaluate(()=>store.customWallpapers.length),0);
    await detail.getByRole('button',{name:'安装这项素材',exact:true}).click();
    await detail.getByRole('button',{name:'使用这项素材',exact:true}).waitFor();
    await detail.getByRole('button',{name:'关闭'}).click();
    await detail.waitFor({state:'hidden'});
    corrupt = true;
    assert.equal(await page.evaluate(async () => (await window.KIMINO_API.sendMessage({ type: 'KG_ONLINE', action: 'download', value: 'sample' })).ok), false);
    assert.equal(await page.evaluate(() => store.customWallpapers[0].dataUrl), saved.url);
    disconnected = true;
    await page.getByRole('button', { name: '刷新目录' }).click();
    await page.getByText(/无法连接 GitHub/).waitFor();
    await page.getByRole('button',{name:'预览 示例主题'}).click();
    await detail.getByRole('button',{name:'卸载',exact:true}).click();
    await detail.getByRole('button',{name:'确认卸载？',exact:true}).click();
    await detail.getByText('已卸载，可随时重新安装。').waitFor();
    assert.deepEqual(await page.evaluate(()=>[store.onlineThemeId,store.onlinePalette,store.wallpaperOpacity]),[null,'violet',.88]);
    await detail.getByRole('button',{name:'关闭'}).click();await detail.waitFor({state:'hidden'});
    await page.getByRole('checkbox', { name: '自动检查更新' }).uncheck();
    await page.getByText(/自动检查已关闭/).waitFor();
    assert.equal(await page.evaluate(() => window.badge), '');
    assert.equal(await page.evaluate(() => receiver({ type: 'KG_ONLINE', action: 'install', value: 'sample' },
      { url: 'https://gemini.google.com/app', id: 'catstella' }, () => {})), undefined);
    assert.deepEqual(errors, []);
    console.log('Online browser: release channel, update badge, theme, wallpaper, failed download and sender restrictions passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
