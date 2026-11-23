const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { DEFAULT_SETTINGS } = require('../src/domain/settings.cjs');
const renderer = process.env.CATSTELLA_SETTINGS_RENDERER || path.resolve(__dirname, '../src/renderer');
const base = 'https://catstella-settings.test';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.SKIN_BROWSER_CHANNEL || 'msedge' });
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
      let listener;
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
        subscribe: callback => { listener = callback; },
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
    await page.locator('.nav-item[data-page=pet]').click();
    const volumeStart=await page.evaluate(()=>commands.length);
    await page.locator('#volume').evaluate(el=>{
      el.focus();for(let i=20;i<=79;i++){el.value=i;el.dispatchEvent(new Event('input',{bubbles:true}));}
    });
    assert.equal(await page.locator('#volume-value').innerText(),'79%','slider feedback is immediate');
    assert.equal(await page.evaluate(()=>commands.length),volumeStart,'movement cannot queue disk saves');
    await page.locator('#volume').dispatchEvent('change');
    await page.waitForFunction(n=>commands.length===n+1,volumeStart);
    await page.waitForTimeout(90);
    assert.equal(await page.locator('#volume').inputValue(),'79','the released value is retained');
    await page.evaluate(()=>{window.rejectSave=true;});
    await page.locator('#volume').evaluate(el=>{el.focus();el.value=33;el.dispatchEvent(new Event('input'));el.dispatchEvent(new Event('change'));});
    await page.getByText('保存失败，请重试').waitFor();
    await page.waitForTimeout(60);
    assert.equal(await page.locator('#volume').inputValue(),'79','failed writes roll back to the saved value');
    await page.evaluate(()=>{window.rejectSave=false;});
    await page.locator('#volume').evaluate(el=>{el.value=35;el.dispatchEvent(new Event('input'));el.dispatchEvent(new Event('change'));el.blur();});
    await page.waitForTimeout(100);
    await page.evaluate(()=>{window.commands.length=0;});
    await page.locator('.nav-item[data-page=pet]').click();
    await page.getByText('当前桌面：星语').waitFor();
    assert.match(await page.locator('#desktop-character-mode').innerText(), /同步待连接/);
    const current = page.locator('#character-gallery [aria-pressed=true]');
    await current.focus();
    await page.evaluate(() => {
      window.oldTile = document.querySelector('#character-gallery [aria-pressed=true]');
      window.publish({ webCompanion: { online: true } });
      window.publish({ webCompanion: { online: true } });
    });
    assert.ok(await page.evaluate(() => window.oldTile === document.activeElement && window.oldTile.isConnected));
    const syncPet = page.getByRole('checkbox', { name: '同步桌宠形象到网页' });
    await syncPet.evaluate(el => { el.click(); el.click(); });
    await page.waitForFunction(() => window.commands.length === 2);
    assert.deepEqual(await page.evaluate(() => window.commands.map(value => value.syncCharacter)), [false, true]);
    assert.match(await page.locator('#desktop-character-mode').innerText(), /网页的独立选择会保留/);
    await page.waitForTimeout(70);
    assert.equal(await syncPet.isChecked(), true);
    await page.evaluate(() => { window.rejectSave = true; });
    await syncPet.uncheck();
    await page.getByText('保存失败，请重试').waitFor();
    assert.equal(await syncPet.isChecked(), true, 'failure restores the real preference even while the input has focus');
    await page.evaluate(() => { window.rejectSave = false; });
    await page.locator('.nav-item[data-page=wallpaper]').click();
    await page.getByText('当前桌面：当前壁纸').waitFor();
    assert.match(await page.locator('#wallpaper-gallery [aria-pressed=true]').innerText(), /当前壁纸/);
    await page.getByRole('checkbox', { name: '同步壁纸到网页' }).uncheck();
    await page.getByText('独立设置 · 网页使用自己的选择').last().waitFor();
    await page.getByText('当前桌面：当前壁纸').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('#wallpaper-gallery img')].every(img => img.complete && img.naturalWidth > 0));
    const pack = page.locator('#wallpaper-gallery .wallpaper-pack');
    assert.equal(await pack.getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('#wallpaper-gallery .wallpaper-pack-items button').count(),0);
    await pack.click();
    assert.equal(await pack.getAttribute('aria-expanded'),'true');
    const secondWall = page.locator('#wallpaper-gallery [data-asset-id="online-moriyama-catgirl-02"]');
    await secondWall.click();
    await page.getByText('当前桌面：套装壁纸二').waitFor();
    assert.equal(await pack.getAttribute('aria-expanded'),'true');
    await pack.click();
    await secondWall.waitFor({state:'hidden'});
    assert.equal(await pack.getAttribute('aria-expanded'),'false');

    await page.locator('.nav-item[data-page=agy]').click();
    await page.locator('#atelier-grid .theme-card').filter({hasText:'旧版主题'}).waitFor();
    assert.equal(await page.locator('#atelier-reply-opacity').inputValue(),'17','restore the persisted AI alpha instead of the HTML default');
    const drag = await page.locator('#atelier-reply-opacity').evaluate(el => {
      const count=commands.length;
      for(let value=10;value<=90;value++){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}
      window.publish({source:{online:true}});
      return {count,value:el.value,preview:document.querySelector('#atelier-preview').style.getPropertyValue('--at-reply-alpha')};
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>commands.length),drag.count,'dragging must not queue disk writes and full snapshots');
    assert.equal(drag.value,'90');assert.equal(drag.preview,'0.9');
    assert.equal(await page.locator('#atelier-reply-opacity').inputValue(),'90','live status must not overwrite the drag');
    await page.locator('#atelier-reply-opacity').dispatchEvent('change');
    await page.waitForFunction(count=>commands.length===count+1,drag.count);
    await page.getByText('AI 回复透明度已更新',{exact:true}).waitFor();
    await page.locator('#atelier-reply-opacity').evaluate(el=>{el.value=45;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForFunction(count=>commands.length===count+2,drag.count);
    await page.locator('#atelier-reply-opacity').evaluate(el=>{el.value=67;el.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#atelier-reply-opacity').inputValue(),'67','a previous save completing must not overwrite the next drag');
    await page.locator('#atelier-reply-opacity').dispatchEvent('change');
    await page.waitForFunction(count=>commands.length===count+3,drag.count);
    await page.waitForTimeout(70);
    assert.equal(await page.locator('#atelier-reply-opacity').inputValue(),'67');
    await page.getByRole('button',{name:'深海蓝',exact:true}).click();
    await page.locator('#atelier-opacity').fill('42');
    await page.evaluate(() => window.publish({source:{online:true}}));
    assert.equal(await page.locator('#atelier-preview').getAttribute('data-palette'),'ocean');
    assert.equal(await page.locator('#atelier-opacity').inputValue(),'42','incoming state preserves the draft');
    await page.locator('#atelier-chat-tint').fill('#abc123');
    await page.locator('#atelier-chat-opacity').fill('57');
    await page.locator('#atelier-name').fill('我的主题');
    await page.locator('#atelier-save').click();
    await page.locator('#atelier-grid .theme-card').filter({hasText:'我的主题'}).waitFor();
    assert.equal(await page.locator('#atelier-grid .theme-card').count(),2,'saving retains older themes');
    await page.locator('#atelier-grid .theme-card').filter({hasText:'旧版主题'}).click();
    await page.getByText('已应用主题「旧版主题」').waitFor();
    assert.equal(await page.locator('#atelier-chat-tint').inputValue(),'#abc123','old themes preserve the current bubble');
    assert.equal(await page.locator('#atelier-chat-opacity').inputValue(),'57');
    await page.locator('#atelier-grid .theme-card').filter({hasText:'我的主题'}).click();
    await page.getByText('已应用主题「我的主题」').waitFor();
    assert.equal(await page.locator('#atelier-preview').getAttribute('data-palette'),'ocean');
    assert.equal(await page.locator('#atelier-opacity').inputValue(),'42');
    assert.equal(await page.locator('#atelier-grid button button').count(),0,'delete and apply are separate controls');
    await page.getByRole('button',{name:'删除主题 我的主题'}).click();
    await page.getByText('已删除主题「我的主题」').waitFor();
    assert.equal(await page.locator('#atelier-grid .theme-card').count(),1);
    await page.evaluate(() => { window.rejectSave = true; });
    await page.locator('#atelier-name').fill('保留失败草稿');
    await page.locator('#atelier-save').click();
    await page.getByText('保存失败，请重试').waitFor();
    assert.equal(await page.locator('#atelier-name').inputValue(),'保留失败草稿');
    assert.equal(await page.locator('#atelier-grid .theme-card').count(),1);
    await page.evaluate(() => { window.rejectSave = false; });

    const notice = page.locator('#online-notice');
    await notice.getByText('内容商店有主题、壁纸、桌宠更新').waitFor();
    await notice.getByRole('button',{name:'查看更新'}).click();
    assert.equal(await notice.isVisible(),false);
    assert.equal(await page.getByRole('button',{name:'最近更新'}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.hub-card h3').first().innerText(),'远程桌宠');
    await page.getByRole('button',{name:'主题配色',exact:true}).click();
    const detail = page.getByRole('dialog');
    await page.getByRole('button',{name:'预览 测试配色'}).click();
    await detail.getByText('壁纸不透明度 73%').waitFor();
    await detail.getByRole('button',{name:'阅读区',exact:true}).click();
    assert.equal(await detail.locator('.hub-theme-reading').isVisible(),true);
    await detail.getByRole('button',{name:'应用配色'}).click();
    await detail.getByText('已应用 测试配色').waitFor();
    await detail.getByRole('button',{name:'关闭'}).click();
    await detail.waitFor({state:'hidden'});
    assert.equal(await notice.isVisible(),false);
    await page.getByRole('button',{name:'壁纸',exact:true}).click();
    const opener = page.getByRole('button',{name:'预览 商店测试壁纸'});
    await opener.scrollIntoViewIfNeeded();
    await opener.evaluate(button => button.addEventListener('click',() => {
      window.storeOpener = button;
      window.storeTop = document.getElementById('content-scroll').scrollTop;
    },{capture:true,once:true}));
    await opener.click();
    assert.ok(await page.evaluate(() => storeTop > 0));
    await detail.getByRole('button',{name:'使用这项素材'}).click();
    await detail.getByRole('button',{name:'正在使用'}).waitFor();
    assert.equal(await detail.getByRole('button',{name:'正在使用'}).evaluate(button => document.activeElement === button),true);
    await detail.getByRole('button',{name:'关闭'}).click();
    await page.waitForFunction(() => document.activeElement === storeOpener);
    assert.equal(await page.evaluate(() => document.getElementById('content-scroll').scrollTop),await page.evaluate(() => storeTop));
    await page.evaluate(() => { window.catalogOffline = true; });
    await page.getByRole('button',{name:'刷新目录'}).click();
    await page.getByText(/无法连接 GitHub/).waitFor();
    assert.equal(await notice.isVisible(),false);
    await page.locator('.nav-item[data-page=agy]').click();
    await page.locator('#undo').click();
    await page.getByText('已恢复到打开设置时').waitFor();
    assert.equal(await page.locator('#atelier-chat-tint').inputValue(),'#181224');
    assert.equal(await page.locator('#atelier-chat-opacity').inputValue(),'100');
    assert.equal(await page.locator('#atelier-reply-opacity').inputValue(),'17');
    await page.locator('.nav-item[data-page=store]').click();
    await page.reload();
    await page.getByRole('button',{name:'刷新目录'}).waitFor();
    await page.locator('.hub-card').first().waitFor();
    assert.equal(await page.locator('.release-notes').count(),0,'release notes are shown only once per version');
    assert.equal(await notice.isVisible(),false,'opening settings again does not repeat a seen update');
    await page.waitForTimeout(100);
    const irrelevantMutations=await page.evaluate(async()=>{
      const current=await widgetApi.get();let count=0;
      const observer=new MutationObserver(records=>count+=records.length);
      observer.observe(document.querySelector('.settings-layout'),{subtree:true,childList:true,attributes:true,characterData:true});
      for(let i=0;i<20;i++)window.publish({artShift:i,facing:i%2?'left':'right',modelActivity:{stepIndex:i},source:{...current.source,heartbeat:i}});
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);observer.disconnect();return count;
    });
    assert.equal(irrelevantMutations,0,'pet motion and unchanged heartbeat snapshots must not repaint the form');
    await page.evaluate(()=>window.publish({quotaWindows:{fiveHour:17,weekly:61}}));
    await page.waitForFunction(()=>document.querySelector('#dq-agy-5h').textContent==='17%');
    assert.deepEqual(errors, []);
    console.log('Desktop settings: bounded slider saves/drafts, galleries, store categories, focus and scroll restoration passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
