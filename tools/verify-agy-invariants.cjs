const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium,_electron}=require('playwright');
const {installTheme}=require('../Antigravity-Dream-Skin/src/host/theme.cjs');
const {WallpaperManager}=require('../Antigravity-Dream-Skin/src/domain/theme-loader.cjs');
const root=path.resolve(__dirname,'..');
const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="#9988bb"/></svg>');
async function closeApp(app){const child=app.process();let timer;try{await Promise.race([app.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('test app shutdown timed out')),6000);})]);}finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill();}}
async function main(){
 const browser=await chromium.launch({headless:true,channel:process.env.SKIN_BROWSER_CHANNEL||'msedge'});let app,dir;
 try{
  const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<body style="margin:0;background:#16121c"><main id="root"><section class="agy-sheet" style="width:1000px;height:760px"><div data-testid="user-message-bubble"><div data-markdown-root>user</div></div><div class="scroll-mt-4" style="background:#333"><div id="first" class="answer prose" style="background:#333"><p>answer</p><pre><code>const x = 1;</code></pre></div></div><div class="scroll-mt-4"><div class="answer markdown-body"><p>answer</p></div></div><div class="scroll-mt-4"><div class="answer" data-markdown-root><p>answer</p><div class="prose" id="nested"><p>nested</p></div></div></div></section></main></body>');
  await page.evaluate(()=>{document.hasFocus=()=>true;});
  const config={owner:'invariant-test',image:svg,wallpaperId:'first',opacity:1,scrim:0,outputMode:'glass',transition:'fade'};
  await page.evaluate(installTheme,config);
  const alpha=async()=>page.locator('.answer').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor));
  assert.deepEqual(await alpha(),Array(3).fill('rgba(24, 18, 36, 0.22)'));
  assert.equal(await page.locator('[data-testid=user-message-bubble]').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(24, 18, 36)');
  assert.equal(await page.locator('#nested').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
  const frames=await page.locator('.answer').evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n);return{radius:s.borderTopLeftRadius,border:s.borderTopWidth,padding:s.padding,shadow:s.boxShadow!=='none'};}));
  assert.deepEqual(frames,Array(3).fill({radius:'18px',border:'1px',padding:'16px 22px',shadow:true}),'restore the old rounded reading card without restoring its opaque gradient');
  assert.deepEqual(await page.locator('#nested').evaluate(n=>{const s=getComputedStyle(n);return{border:s.borderTopWidth,padding:s.padding,blur:s.backdropFilter};}),{border:'0px',padding:'0px',blur:'none'});
  assert.equal(await page.locator('pre').evaluate(n=>getComputedStyle(n).opacity),'1');
  const immediate=await page.evaluate(()=>{const wrapper=document.createElement('div');wrapper.className='scroll-mt-4';wrapper.style.background='#333';wrapper.innerHTML='<div role="article" style="background:#222"><div style="background:#111"><div class="answer leading-relaxed select-text" style="background:#333"><p>new streamed reply</p></div></div></div>';document.querySelector('.agy-sheet').append(wrapper);return {reply:getComputedStyle(wrapper.querySelector('.answer')).backgroundColor,ancestors:[wrapper,...wrapper.querySelectorAll('div:not(.answer)')].map(n=>getComputedStyle(n).backgroundColor)};});
  assert.equal(immediate.reply,'rgba(24, 18, 36, 0.22)','streaming nodes must be correct before the delayed scanner runs');
  assert.deepEqual(immediate.ancestors,Array(3).fill('rgba(0, 0, 0, 0)'),'native solid ancestors must never flash before scan()');
  await page.waitForTimeout(180);assert.deepEqual(await alpha(),Array(4).fill(immediate.reply));
  // A streamed insertion can cause a second ResizeObserver scan after the
  // first scan changes its padding. Wait for that fixture work to settle;
  // count opacity-only work separately, without disabling any observer.
  await page.evaluate(async()=>{
   const rect=Element.prototype.getBoundingClientRect;let changed=performance.now();
   Element.prototype.getBoundingClientRect=function(...args){changed=performance.now();return rect.apply(this,args);};
   try{
    const deadline=performance.now()+3000;
    while(performance.now()-changed<200){if(performance.now()>deadline)throw Error('streamed fixture never settled');await new Promise(r=>setTimeout(r,25));}
   }finally{Element.prototype.getBoundingClientRect=rect;}
  });
  const lightweight=await page.evaluate(async()=>{
   let layouts=0,decodes=0;const rect=Element.prototype.getBoundingClientRect,decode=Image.prototype.decode;
   const before=document.querySelector('#agy-dream-wallpaper-v2').style.backgroundImage;
   Element.prototype.getBoundingClientRect=function(...args){layouts++;return rect.apply(this,args);};
   Image.prototype.decode=function(...args){decodes++;return decode.apply(this,args);};
   try{
    for(let i=0;i<60;i++)__agyDreamSkinV2.updateAppearance({replyOpacity:31,chatOpacity:100});
    await new Promise(resolve=>setTimeout(resolve,180));
    return {layouts,decodes,sameWallpaper:before===document.querySelector('#agy-dream-wallpaper-v2').style.backgroundImage};
   }finally{Element.prototype.getBoundingClientRect=rect;Image.prototype.decode=decode;}
  });
  assert.deepEqual(lightweight,{layouts:0,decodes:0,sameWallpaper:true},'opacity edits must not scan geometry or decode wallpapers');
  assert.deepEqual(await alpha(),Array(4).fill('rgba(24, 18, 36, 0.31)'));
  await page.evaluate(async c=>__agyDreamSkinV2.update({...c,outputMode:'transparent'}),config);
  assert.deepEqual(await alpha(),Array(4).fill('rgba(24, 18, 36, 0)'));
  await page.evaluate(async c=>__agyDreamSkinV2.update({...c,chatOpacity:100,replyOpacity:31}),config);
  assert.deepEqual(await alpha(),Array(4).fill('rgba(24, 18, 36, 0.31)'));
  const reused=await page.evaluate(()=>{const n=document.querySelector('#first');n.setAttribute('data-agy-ai-shell','');n.setAttribute('data-testid','user-message-bubble');const user=getComputedStyle(n).backgroundColor;n.removeAttribute('data-testid');return{user,reply:getComputedStyle(n).backgroundColor};});
  assert.deepEqual(reused,{user:'rgb(24, 18, 36)',reply:'rgba(24, 18, 36, 0.31)'});
  await page.locator('#root').evaluate(n=>n.style.removeProperty('--agy-reply-alpha'));
  await page.waitForFunction(()=>document.querySelector('#root').style.getPropertyValue('--agy-reply-alpha')==='0.31');
  assert.deepEqual(await alpha(),Array(4).fill('rgba(24, 18, 36, 0.31)'));
  // This stale marker was injected by the fixture, not owned by installTheme.
  await page.locator('#first').evaluate(n=>n.removeAttribute('data-agy-ai-shell'));
  await page.evaluate(()=>__agyDreamSkinV2.destroy());
  assert.equal(await page.locator('[data-agy-ai-shell]').count(),0);

  // Concurrent first installs used to leave unreachable observers competing for
  // the same style/layer IDs. Exercise the actual async image-decode boundary.
  await page.evaluate(()=>{
   const add=window.addEventListener,remove=window.removeEventListener;
   window.fixtureFocusHandlers=new Set();
   window.addEventListener=function(type,fn,...rest){if(type==='focus'&&fn.name==='onWindowLifecycle')fixtureFocusHandlers.add(fn);return add.call(this,type,fn,...rest);};
   window.removeEventListener=function(type,fn,...rest){if(type==='focus'&&fn.name==='onWindowLifecycle')fixtureFocusHandlers.delete(fn);return remove.call(this,type,fn,...rest);};
  });
  await page.evaluate('window.fixtureInstallTheme='+installTheme.toString());
  await page.evaluate(async c=>{
   await Promise.all([fixtureInstallTheme({...c,wallpaperId:'mount-old'}),fixtureInstallTheme({...c,wallpaperId:'mount-latest'})]);
   window.retiredTheme=__agyDreamSkinV2;
   if(__agyDreamSkinV2.status().wallpaper.selected!=='mount-latest')throw Error('stale initializer won');
   retiredTheme.destroy();
   await fixtureInstallTheme({...c,wallpaperId:'replacement'});
   retiredTheme.destroy(); // A late cleanup must not remove the new instance.
   document.querySelector('#root').append(document.createElement('span'));
   window.dispatchEvent(new Event('focus'));
  },config);
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#agy-dream-style-v2').count(),1);
  assert.equal(await page.locator('#agy-dream-wallpaper-v2').count(),1);
  assert.equal(await page.evaluate(()=>fixtureFocusHandlers.size),1,'removing duplicate DOM nodes is insufficient: old listeners must also retire');
  assert(await page.evaluate(()=>__agyDreamSkinV2.status().applied));
  assert.equal(await page.evaluate(()=>__agyDreamSkinV2.status().wallpaper.presented),'replacement');

  // Exercise the real main-process timer, selection writer and subscription path.
  // The accelerated interval is accepted only with a validated disposable profile.
  dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'catstella-window-'));
  fs.mkdirSync(path.join(dir,'skin'));const manager=new WallpaperManager(),ids=manager.orderedIds();
  const start=ids[1],stale=manager.resolve(ids[0]).file;
  fs.writeFileSync(path.join(dir,'skin/settings.json'),JSON.stringify({wallpaperId:start,wallpaperFile:stale,legacyMigrated:true,slideshow:true,slideshowIntervalMinutes:1}));
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({autoUpdateCheck:false,alwaysOnTop:false,seenReleaseNotes:[require('../package.json').version]}));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'Antigravity-Cat-Widget/src/main/index.cjs'),'--isolated-dev','--test-slideshow-ms=1000','--data-dir='+dir],env,timeout:30000});
  const pet=await app.firstWindow();await pet.locator('#mascot[data-art-ready=true]').waitFor();
  let state=await pet.evaluate(()=>widgetApi.get());assert.notEqual(state.webCompanion.port,3921);
  state=await pet.evaluate(async({id,file})=>widgetApi.save({dreamSkin:{wallpaperId:id,wallpaperFile:file}}),{id:start,file:stale});
  assert.equal(state.dreamSkin.wallpaperId,start);assert.equal(state.dreamSkin.wallpaperFile,manager.resolve(start).file);
  const baseline=await pet.evaluate(async()=>{window.cycles=[];widgetApi.subscribe(s=>cycles.push(s.dreamSkin));const state=await widgetApi.get();cycles=[];return state.dreamSkin;});
  await page.evaluate(async c=>{document.hasFocus=()=>true;await (window.__agyDreamSkinV2?.destroy());},config);
  const desired=[];let current=baseline.wallpaperId;
  for(let i=0;i<5;i++){
   await new Promise(r=>setTimeout(r,1060));
   const updates=await pet.evaluate(()=>cycles.splice(0));
   for(const next of updates){
    if(next.wallpaperId===current)continue;
    assert.equal(next.wallpaperId,manager.nextId(current),'global rotation order must not be overwritten by an old image');
    assert.equal(next.wallpaperFile,manager.resolve(next.wallpaperId).file);current=next.wallpaperId;desired.push(current);
    const payload={...manager.payload(next),owner:'invariant-test'};
    await page.evaluate(installTheme,payload);
   }
   await pet.evaluate(()=>widgetApi.save({dreamSkin:{chatTint:'#334455'}}));
  }
  assert(desired.length>=4,'the actual slideshow timer must publish multiple successive rotations despite settings edits');
  const stopped=await pet.evaluate(()=>widgetApi.save({dreamSkin:{slideshow:false}}));
  if(stopped.dreamSkin.wallpaperId!==current){assert.equal(stopped.dreamSkin.wallpaperId,manager.nextId(current));current=stopped.dreamSkin.wallpaperId;desired.push(current);}
  await page.evaluate(installTheme,{...manager.payload(stopped.dreamSkin),owner:'invariant-test'});
  await page.waitForFunction(id=>{const s=__agyDreamSkinV2.status();return s.wallpaper.presented===id&&!s.wallpaper.transitioning;},current);
  assert.equal(await page.locator('.agy-dream-wallpaper-incoming').count(),0,'no old opaque overlay can cover later rotations');
  const persisted=JSON.parse(fs.readFileSync(path.join(dir,'skin/settings.json')));
  assert.equal(persisted.wallpaperFile,manager.resolve(persisted.wallpaperId).file);
  assert.deepEqual(errors,[]);
  const out=path.join(root,'evidence/agy-invariants-2026-11-09.json');fs.writeFileSync(out,JSON.stringify({checkedAt:new Date().toISOString(),roleRules:true,roundedGlass:true,appearanceOnly:lightweight,streamingImmediate:true,nestedSingleSurface:true,modeChanges:true,roleReuse:true,singleInitializer:true,lateCleanupSafe:true,realTimer:true,order:desired,latestActuallyPresented:true,staleFileRejected:true},null,2));
  console.log('PASS: AGY rounded role surfaces, alpha-only updates without layout/decode, streaming/reuse, real rotation and final rendered wallpaper.');
 }finally{if(app)await closeApp(app);await browser.close();if(dir)try{fs.rmSync(dir,{recursive:true,force:true});}catch{}}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
