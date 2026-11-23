const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { DEFAULT_SETTINGS } = require('../Antigravity-Cat-Widget/src/domain/settings.cjs');
const renderer = process.env.CATSTELLA_SETTINGS_RENDERER || path.resolve(__dirname, '../Antigravity-Cat-Widget/src/renderer');
const base = 'https://catstella-settings.test';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.SKIN_BROWSER_CHANNEL || 'msedge', args:['--disable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 740, height: 660 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const types = { '.html': 'text/html', '.css': 'text/css', '.cjs': 'text/javascript', '.js': 'text/javascript' };
    await page.route(base + '/**', route => {
      const file = new URL(route.request().url()).pathname.slice(1);
      if (!Object.hasOwn(types, path.extname(file)) || file.includes('/')) return route.abort();
      return route.fulfill({ contentType: types[path.extname(file)] + '; charset=utf-8', body: fs.readFileSync(path.join(renderer, file)) });
    });
    await page.addInitScript(defaults => {
      const preview = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#9e79cf"/></svg>');
      const model = {
        settings: { ...defaults, syncCharacter: true, syncWallpaper: true,
          customThemes:[{id:'legacy',name:'旧版主题',palette:'pink',opacity:64}] },
        dreamSkin: { chatTint:'',chatOpacity:null,replyOpacity:17, enabled: true, wallpaperId: 'new', wallpaperFile: 'D:/art/new.jpg' },
        webCompanion: { online: false },
        source: { online: false },
        characterPacks: [
          { id: 'gemini-star-v1', name: '星语', preview },
          { id: 'lin-cat', name: '霓音', preview }
        ],
        wallpapers: [
          { id: 'old', title: '旧壁纸', filePath: 'D:/art/old.jpg', preview },
          { id: 'new', title: '当前壁纸', filePath: 'D:/art/new.jpg', preview },
          { id: 'online-moriyama-catgirl-01', title: '套装壁纸一', filePath: 'D:/art/pack1.jpg', preview },
          { id: 'online-moriyama-catgirl-02', title: '套装壁纸二', filePath: 'D:/art/pack2.jpg', preview }
        ]
      };
      const catalog = [
        {id:'night',kind:'theme',name:'测试配色',updatedAt:'2026-11-06'},
        {id:'remote-cat',kind:'character',name:'远程桌宠',updatedAt:'2026-11-07'},
        ...Array.from({length:8},(_,i) => ({id:'remote-wall-' + i,kind:'wallpaper',name:'远程壁纸 ' + i,preview,updatedAt:'2026-11-05'})),
        {id:'old',kind:'wallpaper',name:'商店测试壁纸',preview}
      ];
      let listener; window.subscriptionCount=0;
      window.publish = patch => {
        Object.assign(model, patch);
        listener?.(structuredClone(model));
      };
      window.commands = [];
      window.widgetApi = {
        releaseNotes: async () => localStorage.getItem('release-seen') === '0.6.1' ? null : {version:'0.6.1',title:'Catstella 0.6.1 更新内容',items:['内容商店和摸头优化']},
        markReleaseNotesSeen: async version => { localStorage.setItem('release-seen', version); return true; },
        get: async () => structuredClone(model),
        online: async (action, value) => {
          if (action === 'catalog') return {ok:true,offline:!!window.catalogOffline,items:catalog};
          if (action === 'preview-theme') return {ok:true,palette:'ocean',opacity:73};
          if (action === 'install' && value === 'night') {
            window.publish({dreamSkin:{...model.dreamSkin,onlineThemeId:value}});
            return {ok:true};
          }
          return {ok:false};
        },
        subscribe: callback => { window.subscriptionCount++; listener = callback; },
        command: () => {},
        save: async ({ dreamSkin, ...settings }) => {
          window.commands.push({ dreamSkin, ...settings });
          await new Promise(resolve => setTimeout(resolve, 45));
          if (window.rejectSave) throw new Error('fixture failed save');
          Object.assign(model.settings, settings);
          if (dreamSkin) {
            Object.assign(model.dreamSkin, dreamSkin);
            const selected = model.wallpapers.find(wall => wall.filePath === dreamSkin.wallpaperFile);
            if (selected) model.dreamSkin.wallpaperId = selected.id;
          }
          window.publish({});
          return structuredClone(model);
        }
      };
    }, DEFAULT_SETTINGS);
    await page.goto(base + '/settings.html');
    await page.getByRole('heading', { name: '常用设置' }).waitFor();
    const releaseNotes = page.getByRole('dialog', { name: 'Catstella 0.6.1 更新内容' });
    await releaseNotes.getByText('内容商店和摸头优化').waitFor();
    await page.waitForFunction(() => localStorage.getItem('release-seen') === '0.6.1');
    await releaseNotes.getByRole('button', { name:'知道了' }).click();
    await releaseNotes.waitFor({state:'detached'});
    const metrics = await page.evaluate(async () => {
      const pause = ms => new Promise(r=>setTimeout(r,ms));
      const frames = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
      const longs=[];new PerformanceObserver(list=>longs.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});
      const switches=[];
      for(const name of ['pet','wallpaper','agy','overview','pet','agy']) {
        const start=performance.now();document.querySelector(`.nav-item[data-page="${name}"]`).click();await frames();switches.push(performance.now()-start);
      }
      document.querySelector('.nav-item[data-page="pet"]').click();await frames();
      window.commands.length=0;const volume=document.querySelector('#volume');volume.focus();
      let mutations=0;const observer=new MutationObserver(records=>mutations+=records.length);observer.observe(document.querySelector('.settings-layout'),{subtree:true,childList:true,attributes:true,characterData:true});
      const start=performance.now();
      for(let i=0;i<60;i++){volume.value=String(20+i);volume.dispatchEvent(new Event('input',{bubbles:true}));await pause(5);}
      volume.dispatchEvent(new Event('change',{bubbles:true}));volume.blur();
      await pause(120);const settled=()=>document.querySelector('#volume-value').textContent==='79%';
      const deadline=performance.now()+6000;while(performance.now()<deadline&&(!settled()||performance.now()-start<3300))await pause(30);
      const slider={saves:window.commands.length,elapsedMs:performance.now()-start,mutations,final:volume.value,label:document.querySelector('#volume-value').textContent};observer.disconnect();
      document.querySelector('.nav-item[data-page="wallpaper"]').click();await frames();
      const scroll=[];const scroller=document.querySelector('#content-scroll');
      for(let i=0;i<15;i++){const t=performance.now();scroller.scrollTop=i*35;await frames();scroll.push(performance.now()-t);}
      const nav=performance.getEntriesByType('navigation')[0];
      return {openMs:nav.domContentLoadedEventEnd,categoryMs:switches,scrollFrameMs:scroll,slider,longTasksMs:longs,subscriptions:window.subscriptionCount};
    });
    assert.deepEqual(errors,[]);
    if(process.env.CATSTELLA_SETTINGS_METRICS)fs.writeFileSync(process.env.CATSTELLA_SETTINGS_METRICS,JSON.stringify(metrics,null,2));
    console.log(JSON.stringify(metrics));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
