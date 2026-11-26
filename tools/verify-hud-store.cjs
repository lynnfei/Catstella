const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const staged = process.argv.includes('--staged');
const hud = path.join(root, staged ? 'src-tauri/frontend-dist/src/renderer' : 'src-tauri/settings-hud');
const shared = path.join(root, 'Antigravity-Cat-Widget/src/renderer');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 840 } });
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://hud.test/**', async route => {
      const name = path.basename(new URL(route.request().url()).pathname);
      if(name==='tauri-widget-api.js') return route.fulfill({contentType:'text/javascript',body:''});
      if(name==='bubble-pop-release.wav') return route.fulfill({path:path.join(root,'Antigravity-Cat-Widget/assets/audio/codex-maid-widget/files',name),contentType:'audio/wav'});
      const base = !staged && name.startsWith('side-quota.') ? shared : hud;
      const file = path.join(base,name);
      if(!fs.existsSync(file)) return route.fulfill({status:404,body:''});
      return route.fulfill({path:file});
    });
    await page.addInitScript(() => {
      const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"/>');
      window.fixture = { settings:{sideQuotaEnabled:false,scale:220}, dreamSkin:{themePreset:'violet',wallpaperId:'builtin-wall'}, wallpapers:[{id:'builtin-wall',name:'Builtin'}],characterPacks:[],ledger:{} };
      window.catalog = [
        ...Array.from({length:30},(_,i)=>({id:`asset-${i}`,kind:i%3===0?'character':i%3===1?'wallpaper':'theme',name:`素材 ${i}`,description:`测试内容 ${i}`,preview:svg})),
        ...[1, 2, 3].map((pos) => ({
          id: `pack-wall-${pos}`,
          kind: 'wallpaper',
          name: `系列图 ${pos}`,
          description: `Series frame ${pos}`,
          preview: svg,
          pack: { id: 'series-pack', name: '系列图包测试', position: pos, source: 'https://www.bilibili.com/video/BV17PxC6SERc/' }
        }))
      ];
      window.installs=[];
      window.downloads=[];
      let subscriber;
      window.publish = patch => { Object.assign(window.fixture,patch);subscriber(structuredClone(window.fixture)); };
      window.widgetApi = {
        get:async()=>structuredClone(window.fixture),
        save:async patch=>{Object.assign(window.fixture.settings,patch);return structuredClone(window.fixture);},
        subscribe:fn=>{subscriber=fn;},onNavigate:()=>{},command:async()=>{},audio:async()=>null,host:async()=>({}),
        online:async (op,id)=>{
          if(op==='catalog')return {ok:true,items:structuredClone(window.catalog),offline:false};
          if(op==='download')downloads.push(id);
          if(op==='install')installs.push(id);
          return {ok:true};
        }
      };
    });
    await page.goto('https://hud.test/settings.html#store');
    await page.waitForFunction(()=>document.querySelectorAll('#storeGrid .store-card').length===31);
    const packCardInit = await page.evaluate(() => {
      const card = document.querySelector('[data-sid="series-pack"]');
      window.packApplyBtn = card?.querySelector('[data-apply]');
      return {
        exists: Boolean(card),
        isPack: card?.classList.contains('is-pack'),
        countTxt: card?.querySelector('.store-pack-count')?.textContent,
        badge: card?.querySelector('.store-state-pill')?.textContent,
        btn: card?.querySelector('[data-apply]')?.textContent
      };
    });
    assert.deepEqual(packCardInit, { exists: true, isPack: true, countTxt: '3 张合集', badge: '可安装', btn: '安装整套' });
    await page.evaluate(() => publish({ wallpapers: [{ id: 'builtin-wall', name: 'Builtin' }, { id: 'pack-wall-1', name: '系列图 1' }] }));
    const packPartial = await page.evaluate(() => {
      const card = document.querySelector('[data-sid="series-pack"]');
      return {
        sameBtn: window.packApplyBtn === card?.querySelector('[data-apply]'),
        badge: card?.querySelector('.store-state-pill')?.textContent,
        btn: card?.querySelector('[data-apply]')?.textContent
      };
    });
    assert.deepEqual(packPartial, { sameBtn: true, badge: '已装 1/3', btn: '安装整套' });
    await page.locator('[data-detail="series-pack"]').click();
    await page.locator('#storeDlg[open]').waitFor();
    assert.equal(await page.locator('#dlgStrip .dlg-strip-thumb').count(), 3);
    assert.equal(await page.locator('#dlgCounter').textContent(), '1 / 3');
    await page.locator('#dlgStrip .dlg-strip-thumb').nth(1).click();
    assert.equal(await page.locator('#dlgCounter').textContent(), '2 / 3');
    await page.locator('#dlgInstallAll').click();
    await page.waitForFunction(() => downloads.length === 2 && installs.includes('pack-wall-1'));
    assert.deepEqual(await page.evaluate(() => downloads), ['pack-wall-2', 'pack-wall-3']);
    await page.locator('#dlgClose').click();
    await page.evaluate(() => { window.installs = []; window.downloads = []; });
    await page.evaluate(() => publish({settings:{...fixture.settings,headPatTotal:123456},ledger:{todaySteps:3}}));
    assert.equal(await page.locator('#steps').textContent(),'123456');
    const unchanged=await page.evaluate(()=>{
      const grid=document.getElementById('storeGrid'),scroll=document.getElementById('main-scroll');
      window.originalButton=grid.querySelector('[data-apply="asset-12"]');
      originalButton.focus({preventScroll:true});scroll.scrollTop=650;
      const top=scroll.scrollTop;
      for(let i=0;i<100;i++)publish({quotaWindows:{gemini:{fiveHour:i,weekly:50}},ledger:{todaySteps:i}});
      return {same:originalButton===grid.querySelector('[data-apply="asset-12"]'),focused:document.activeElement===originalButton,scrollStable:scroll.scrollTop===top};
    });
    assert.deepEqual(unchanged,{same:true,focused:true,scrollStable:true});
    const states=await page.evaluate(()=>{
      publish({characterPacks:[{id:'asset-12',name:'已安装角色',preview:catalog[12].preview}]});
      const card=document.querySelector('[data-sid="asset-12"]');
      const installed=card.querySelector('.store-state-pill').textContent;
      publish({settings:{...fixture.settings,characterPack:'asset-12'}});
      const active=card.querySelector('.store-state-pill').textContent;
      return {installed,active,same:originalButton===card.querySelector('[data-apply]'),focused:document.activeElement===originalButton};
    });
    assert.deepEqual(states,{installed:'已安装',active:'使用中',same:true,focused:true});
    await page.locator('#storeRefreshBtn').click();
    assert.equal(await page.evaluate(()=>originalButton===document.querySelector('[data-apply="asset-12"]')),true,'identical catalog refresh keeps nodes');
    await page.evaluate(()=>{originalButton.focus({preventScroll:true});catalog[12].description='目录内容已更新';});
    await page.evaluate(()=>document.getElementById('storeRefreshBtn').click());
    await page.getByText('目录内容已更新',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.apply),'asset-12','catalog changes restore the same action focus');
    await page.locator('[data-apply="asset-12"]').click();
    await page.waitForFunction(()=>installs.length===1);
    assert.deepEqual(await page.evaluate(()=>installs),['asset-12']);
    await page.locator('#storeSearch').fill('素材 12');
    assert.equal(await page.locator('#storeGrid .store-card').count(),1);
    await page.evaluate(()=>publish({ledger:{todaySteps:1234}}));
    assert.equal(await page.locator('#storeSearch').inputValue(),'素材 12');
    await page.locator('[data-detail="asset-12"]').click();
    await page.locator('#storeDlg[open]').waitFor();
    await page.evaluate(() => {
      publish({settings:{...fixture.settings,sound:true,volume:0.4}});
      widgetApi.audio = async () => ({url:'/bubble-pop-release.wav',effectiveVolume:0.4});
      window.started = [];

      const OriginalAudio = window.Audio;
      window.Audio = function(url) {
        const player = new OriginalAudio(url);
        player.addEventListener('playing', () => started.push(player), {once:true});
        return player;
      };
      document.getElementById('audition').click();
    });
    await page.waitForFunction(() => started.length > 0);
    assert.equal(await page.evaluate(() => started[0].volume),0.4);
    await page.evaluate(async () => {
      let resolveAudio;
      widgetApi.audio = () => new Promise(resolve => {resolveAudio = resolve;});
      document.getElementById('audition').click();
      publish({settings:{...fixture.settings,sound:false}});
      resolveAudio({url:'/bubble-pop-release.wav',effectiveVolume:0.4});
      await Promise.resolve();
    });
    assert.equal(await page.evaluate(() => started[0].paused),true);
    assert.deepEqual(errors,[]);
    console.log('PASS: 100 quota snapshots preserve card identity, focus and scroll; install/use labels update in place; catalog refresh, search and details work.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
