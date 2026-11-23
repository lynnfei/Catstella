// Profile actual Electron/IPC with disposable settings and bundled assets.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'catstella-window-'));
fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({autoUpdateCheck:false,alwaysOnTop:false,seenReleaseNotes:['0.6.1']}));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{
 const app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'Antigravity-Cat-Widget/src/main/index.cjs'),'--isolated-dev','--data-dir='+dir],env});
 try{
  const pet=await app.firstWindow();await pet.locator('#mascot[data-art-ready=true]').waitFor();
  await pet.evaluate(()=>widgetApi.get());
  await app.evaluate(({nativeImage,ipcMain},baseline)=>{
   if(baseline){const {PreviewCache}=process.mainModule.require(process.cwd()+'/Antigravity-Cat-Widget/src/domain/preview-cache.cjs');const get=PreviewCache.prototype.get;PreviewCache.prototype.get=function(file,width){this.entries.delete(file+':'+width);return get.call(this,file,width);};}
   global.settingsMetrics={decodes:0,decodeMs:0,saves:[],gets:[]};
   const create=nativeImage.createFromPath;nativeImage.createFromPath=(...args)=>{const t=performance.now();const image=create(...args);global.settingsMetrics.decodes++;global.settingsMetrics.decodeMs+=performance.now()-t;return image;};
   const handler=ipcMain._invokeHandlers.get('widget:settings');ipcMain.removeHandler('widget:settings');
   ipcMain.handle('widget:settings',async(...args)=>{const t=performance.now();try{return await handler(...args);}finally{global.settingsMetrics.saves.push(performance.now()-t);}});
   const getter=ipcMain._invokeHandlers.get('widget:get');ipcMain.removeHandler('widget:get');ipcMain.handle('widget:get',(...args)=>{const t=performance.now();try{return getter(...args);}finally{global.settingsMetrics.gets.push(performance.now()-t);}});
  },process.env.CATSTELLA_PREVIEW_BASELINE==='1');
  const start=performance.now(),opened=app.waitForEvent('window');await pet.evaluate(()=>widgetApi.command('settings'));const page=await opened;
  await page.getByRole('heading',{name:'常用设置',exact:true}).waitFor();const openMs=performance.now()-start;
  const timings=await page.evaluate(async()=>{
   const frames=async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
   const longs=[];new PerformanceObserver(list=>longs.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});
   const categories=[];for(const name of ['pet','wallpaper','agy','interact','pet']){const t=performance.now();document.querySelector(`.nav-item[data-page="${name}"]`).click();await frames();categories.push(performance.now()-t);}
   document.querySelector('.nav-item[data-page="wallpaper"]').click();await frames();
   const scroller=document.querySelector('#content-scroll'),scrollFrameMs=[];
   for(let i=0;i<12;i++){const t=performance.now();scroller.scrollTo({top:i*45,behavior:'instant'});await frames();scrollFrameMs.push(performance.now()-t);}
   document.querySelector('.nav-item[data-page="pet"]').click();await frames();
   const slider=document.querySelector('#volume');slider.focus();const t=performance.now();
   for(let i=0;i<60;i++){slider.value=String(20+i);slider.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,5));}
   slider.dispatchEvent(new Event('change',{bubbles:true}));slider.blur();
   await new Promise(r=>setTimeout(r,200));
   return {categoryMs:categories,scrollFrameMs,inputGestureMs:performance.now()-t,longTasksMs:longs};
  });
  // Include all pre-fix queued writes, then the 15-second asset rescan boundary.
  await page.waitForTimeout(3500);const saveEnd=await page.evaluate(()=>widgetApi.get());assert.equal(saveEnd.settings.volume,.79);
  const saves=await app.evaluate(()=>global.settingsMetrics.saves);
  await app.evaluate(()=>{global.settingsMetrics.decodes=0;global.settingsMetrics.decodeMs=0;global.settingsMetrics.gets=[];});
  await page.waitForTimeout(16000);
  const rescanGetMs=await page.evaluate(async()=>{const t=performance.now();await widgetApi.get();return performance.now()-t;});
  const native=await app.evaluate(()=>global.settingsMetrics);
  const result={openMs,...timings,saveCount:saves.length,saveTotalMs:saves.reduce((a,b)=>a+b,0),saveMaxMs:Math.max(0,...saves),rescanGetMs,getMainThreadMs:native.gets,assetDecodes:native.decodes,assetDecodeMs:native.decodeMs,finalVolume:saveEnd.settings.volume};
  if(process.env.CATSTELLA_SETTINGS_METRICS)fs.writeFileSync(process.env.CATSTELLA_SETTINGS_METRICS,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
