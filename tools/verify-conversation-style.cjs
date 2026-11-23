// Isolated real browser pages: conversation controls, persistence, footer and AGY surfaces.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {installTheme}=require('../Antigravity-Dream-Skin/src/host/theme.cjs');
const source=path.resolve(__dirname,'../../Catstella-web/Gemini-Web-Companion/content');
const html=`<!doctype html><html><head><style>
body{margin:0;background:#211e2d;color:white;font:16px Arial}main{margin-left:100px}infinite-scroller.chat-history{display:block;height:800px;overflow:auto}
user-query{display:block;width:700px;margin:20px auto}.user-query-bubble-with-background{display:block;padding:20px}model-response{display:block;color:white}model-response p{opacity:1}
input-container{position:fixed;left:200px;bottom:0;width:600px;z-index:2}input-area-v2{display:block;padding:18px}rich-textarea{display:block;height:35px}.footnote{height:36px;text-align:center;font:12px Arial;padding-top:12px}
</style></head><body><main><infinite-scroller class="chat-history"><user-query><div class="user-query-bubble-with-background">用户消息：帮我整理计划<button id="copy">复制</button></div></user-query><model-response><message-content><p>Gemini 回答：文字应该保持清晰。</p><p>${'用于滚动检查的对话内容。'.repeat(250)}</p><button id="reply-copy">复制回答</button></message-content></model-response></infinite-scroller></main><input-container><input-area-v2><rich-textarea><div class="ql-editor" contenteditable="true">尚未发送的输入</div></rich-textarea><button id="send">发送</button></input-area-v2><div class="footnote">Gemini 可能会出错，请核查重要信息。</div></input-container></body></html>`;
async function main(){
 const browser=await chromium.launch({headless:true,channel:process.env.SKIN_BROWSER_CHANNEL||'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://chat-style.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:html}));
  await page.addInitScript(()=>{
   window.saved={enabled:true,bubbleVisible:true,soundEnabled:false,ambientChatter:false,syncWallpaper:false,syncCharacter:false,bubbleTint:'#ff0000',bubbleOpacity:35,...JSON.parse(localStorage.getItem('fixture-settings')||'{}')};
   window.listeners=[];window.clicks=0;
   const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="#9b78c7"/></svg>');
   window.KIMINO_API={getURL:()=>image,storageGet:async()=>structuredClone(saved),storageSet:async patch=>{
    if(window.failSave)return false;
    const changes=Object.fromEntries(Object.entries(patch).map(([key,newValue])=>[key,{oldValue:saved[key],newValue}]));
    Object.assign(saved,patch);localStorage.setItem('fixture-settings',JSON.stringify(saved));listeners.forEach(fn=>fn(changes,'local'));return true;
   },onChanged:fn=>listeners.push(fn),sendMessage:async()=>null};
   window.__KIMINO_TRACKER__={sessionData:{status:'idle',turns:0,realQuota:{}},subscribe:()=>{}};
  });
  const mount=async()=>{
   await page.addStyleTag({path:path.join(source,'skin.css')});
   for(const file of ['wallpaper.js','fade.js','skin.js','ambient.js','pet-behavior.js','widget.js'])await page.addScriptTag({path:path.join(source,file)});
   await page.waitForFunction(()=>document.getElementById('kimino-companion-root')?.shadowRoot.querySelector('.kimino-wrapper')?.dataset.ready==='true');
  };
  await page.goto('https://chat-style.test/app/fixture');await mount();
  const quota=page.locator('.kimino-bubble');
  const beforeQuota=await quota.evaluate(el=>getComputedStyle(el).backgroundColor);
  await page.locator('.btn-open-settings').click();
  await page.getByLabel('对话气泡颜色',{exact:true}).fill('#345678');
  await page.getByLabel('对话气泡不透明度',{exact:true}).fill('61');
  const backgrounds=async()=>page.locator('.user-query-bubble-with-background,model-response').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).backgroundColor));
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('model-response')).backgroundColor==='rgba(52, 86, 120, 0.61)');
  assert.deepEqual(await backgrounds(),['rgba(52, 86, 120, 0.61)','rgba(52, 86, 120, 0.61)']);
  assert.equal(await page.locator('model-response p').first().evaluate(el=>getComputedStyle(el).opacity),'1');
  assert.equal(await quota.evaluate(el=>getComputedStyle(el).backgroundColor),beforeQuota,'quota/pet surface stays unchanged');
  await page.getByLabel('对话气泡不透明度',{exact:true}).fill('0');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('model-response')).backgroundColor==='rgba(52, 86, 120, 0)');
  await page.getByLabel('对话气泡不透明度',{exact:true}).fill('61');
  await page.waitForFunction(()=>saved.chatOpacity===61);
  await page.evaluate(()=>{window.failSave=true;});
  await page.getByLabel('对话气泡不透明度',{exact:true}).fill('42');
  await page.getByText('未能保存对话气泡外观，请重试。').waitFor();
  assert.equal(await page.getByLabel('对话气泡不透明度',{exact:true}).inputValue(),'61');
  await page.reload();await mount();
  assert.deepEqual(await backgrounds(),['rgba(52, 86, 120, 0.61)','rgba(52, 86, 120, 0.61)']);
  await page.locator('.btn-open-settings').click();
  const follow = page.getByLabel('对话气泡跟随桌面',{exact:true});
  assert.equal(await follow.isChecked(),false,'existing users remain independent until they opt in');
  const desktop = {online:true,desktop:{chatAppearance:{tint:'#123456',opacity:100,reply:0}}};
  await page.evaluate(state=>KIMINO_API.storageSet({agyBridgeState:state}),desktop);
  const followTrack = page.locator('#kg-sync-chat-style + .kg-switch-track');
  await followTrack.click();
  await page.getByText('已跟随桌面',{exact:true}).waitFor();
  assert.deepEqual(await backgrounds(),['rgb(18, 52, 86)','rgba(18, 52, 86, 0)']);
  assert(await page.getByLabel('回答气泡不透明度',{exact:true}).isDisabled());
  await page.evaluate(state=>KIMINO_API.storageSet({agyBridgeState:state}),{...desktop,online:false});
  await page.getByText('桌面未连接，使用网页设置',{exact:true}).waitFor();
  assert.deepEqual(await backgrounds(),['rgba(52, 86, 120, 0.61)','rgba(52, 86, 120, 0.61)']);
  await page.getByLabel('回答气泡不透明度',{exact:true}).fill('44');
  await page.waitForFunction(()=>saved.replyOpacity===44);
  await page.evaluate(state=>KIMINO_API.storageSet({agyBridgeState:state}),{online:true,desktop:{chatAppearance:{tint:'#123456',opacity:0,reply:22}}});
  await page.getByText('已跟随桌面',{exact:true}).waitFor();
  assert.deepEqual(await backgrounds(),['rgba(18, 52, 86, 0)','rgba(18, 52, 86, 0.22)']);
  await followTrack.click();
  await page.getByText('使用网页设置',{exact:true}).waitFor();
  assert.deepEqual(await backgrounds(),['rgba(52, 86, 120, 0.61)','rgba(52, 86, 120, 0.44)']);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{document.querySelector('#send').onclick=()=>clicks++;document.querySelector('infinite-scroller').scrollTop=400;});
  await page.locator('#send').click();assert.equal(await page.evaluate(()=>clicks),1);
  await page.locator('.ql-editor').fill('输入仍然可编辑');
  assert.equal(await page.locator('.footnote').isVisible(),true);
  assert.equal(await page.locator('#kimino-static-fade').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
  const out=path.resolve(__dirname,'../evidence/chat-style-2026-11-09');fs.mkdirSync(out,{recursive:true});
  await page.locator('#kimino-companion-root').evaluate(el=>el.style.display='none');
  await page.screenshot({path:path.join(out,'web-conversation-footer.png')});
  assert.deepEqual(errors,[]);
  const agy=await browser.newPage({viewport:{width:1000,height:800}});
  await agy.setContent('<main id="root"><section class="agy-sheet" style="width:900px;height:700px"><div class="agy-user-bubble">用户消息</div><div data-markdown-root><p>模型回答</p><pre>const value = 42;</pre></div></section></main>');
  const config={owner:'chat-style-fixture',image:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="#9b78c7"/></svg>'),opacity:1,scrim:0,transition:'none',chatTint:'#345678',chatOpacity:61};
  await agy.evaluate(installTheme,config);
  await agy.waitForFunction(()=>getComputedStyle(document.querySelector('[data-markdown-root]')).backgroundColor==='rgba(52, 86, 120, 0)');
  assert.equal(await agy.locator('.agy-user-bubble').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(52, 86, 120, 0.61)');
  assert.equal(await agy.locator('[data-markdown-root] p').evaluate(el=>getComputedStyle(el).opacity),'1');
  await agy.evaluate(()=>__agyDreamSkinV2.destroy());
  assert.equal(await agy.locator('[data-agy-chat-custom]').count(),0);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({webUserAndModelBackground:true,textOpacityUnchanged:true,quotaUnchanged:true,zeroOpacity:true,failedSaveRestored:true,reloadPersisted:true,desktopFollow:true,disconnectFallback:true,reconnectAndIndependentRestore:true,composerClickableAndEditable:true,footnoteVisible:true,agyUserAndModelBackground:true,cleanup:true},null,2));
  console.log('PASS: Web conversation controls and reload, background-only opacity, quota unchanged, input/footer, AGY conversation surfaces.');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
