const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const{_electron,chromium}=require("playwright");
const{installTheme}=require("../Antigravity-Dream-Skin/src/host/theme.cjs");
const{DreamSkinThemeLoader}=require("../Antigravity-Dream-Skin/src/domain/theme-loader.cjs");
const root=path.resolve(__dirname,".."),out=path.join(root,"evidence"),exe=(fs.existsSync(path.join(root,"runtime/electron-45.1.0/electron.exe"))?path.join(root,"runtime/electron-45.1.0/electron.exe"):require("electron"));
const sourceHashes=()=>require("./source-hashes.cjs").sourceHashes(root);
fs.mkdirSync(out,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
async function main(){
 const report={checkedAt:new Date().toISOString(),runtime:"Electron 45.1.0",checks:[],errors:[]};
 report.sourceHashes=sourceHashes();
 const apps=[];
 try{
  await new Promise((resolve,reject)=>{
   const child=require("node:child_process").spawn(exe,[path.join(root,"Antigravity-Cat-Widget/src/main/index.cjs"),"--quit","--data-dir="+fs.mkdtempSync(path.join(os.tmpdir(),"star-quit-"))],{env,windowsHide:true,stdio:"ignore"});
   const timer=setTimeout(()=>{child.kill();reject(new Error("Catstella --quit did not exit"));},10000);
   child.once("error",error=>{clearTimeout(timer);reject(error);});
   child.once("exit",code=>{clearTimeout(timer);code===0?resolve():reject(new Error("Catstella --quit exit "+code));});
  });
  report.checks.push("quit-with-no-existing-instance-exits-unified-app");
  const widget=await _electron.launch({executablePath:exe,args:[path.join(root,"Antigravity-Cat-Widget/src/main/index.cjs"),"--data-dir="+fs.mkdtempSync(path.join(os.tmpdir(),"star-runtime-"))],env,timeout:30000});apps.push(widget);
  const page=await widget.firstWindow();page.on("pageerror",e=>report.errors.push(e.message));await page.waitForFunction(()=>window.widgetApi&&document.getElementById("mascot").style.getPropertyValue("--agy-width")&&document.getElementById("mascot").dataset.artReady==="true");
  await page.waitForTimeout(150);
  assert.equal(await widget.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true,"Window must appear only after the selected artwork decoded");
  await page.evaluate(async()=>Promise.all([...document.images].map(i=>i.decode())));
  if(await page.locator("#bubble").isVisible())await page.locator("#close").click();
  await page.waitForTimeout(220);assert.equal(await page.locator("#bubble").isVisible(),false);
  await page.locator("#motion").click({force:true});await page.waitForTimeout(280);assert.equal(await page.locator("#bubble").isVisible(),true);
  assert.doesNotMatch(await page.locator("#caption").textContent(),/undefined|NaN/);
  assert.equal(await page.locator(".agy-face").evaluate(e=>getComputedStyle(e).filter),"none");
  await page.waitForTimeout(6750);assert.equal(await page.locator("#bubble").isVisible(),false);
  await page.locator("#toggle").click({force:true});await page.waitForTimeout(280);await page.locator("#bubble").dispatchEvent("pointerenter");
  report.checks.push("bubble-default-hidden-click-pop-in-idle-retract-and-no-character-brightening");
  if(await require("../shared/host.cjs").discover()){
   await page.waitForFunction(async()=>(await window.widgetApi.get()).quotaWindows.online);
   const nativeQuota=(await page.evaluate(()=>window.widgetApi.get())).quotaWindows;
   if(nativeQuota.fiveHour!==null||nativeQuota.weekly!==null){
    assert.equal(await page.locator("#track").getAttribute("aria-valuenow"),nativeQuota.fiveHour===null?null:String(nativeQuota.fiveHour));
    assert.equal(await page.locator("#track-week").getAttribute("aria-valuenow"),nativeQuota.weekly===null?null:String(nativeQuota.weekly));
    await page.screenshot({path:path.join(out,"widget-quota-native.png"),omitBackground:true});report.checks.push("real-host-native-gemini-five-hour-weekly-cache-with-source-time");
   }
  }
  await page.evaluate(()=>window.widgetApi.save({manualQuota:true,manualPercent:null,manualWeeklyPercent:null}));
  await page.waitForFunction(async()=>{const s=(await window.widgetApi.get()).settings;return s.manualQuota===true&&s.manualPercent===null;});
  await page.waitForFunction(()=>document.getElementById("percent").textContent==="—");
  assert.equal(await page.locator("#percent").textContent(),"—");
  assert.equal(await page.locator("#track").getAttribute("aria-valuenow"),null);
  for(const [five,week,levels] of [[31,30,["normal","low"]],[10,11,["critical","low"]],[0,null,["critical","unknown"]]]){
   await page.evaluate(v=>window.widgetApi.save({manualPercent:v[0],manualWeeklyPercent:v[1]}),[five,week]);
   await page.waitForFunction(expected=>document.getElementById("track").dataset.level===expected[0]&&document.getElementById("track-week").dataset.level===expected[1],levels);
  }
  await page.evaluate(()=>window.widgetApi.save({manualPercent:null,manualWeeklyPercent:null}));
  report.checks.push("quota-independent-colors-at-30-and-10-percent-unknown-stays-purple");
  for(const size of [140,220,300,360]){
   await page.evaluate(size=>window.widgetApi.save({scale:size}),size);
   await page.waitForFunction(size=>Math.abs(innerWidth-Math.max(360,size+80))<=1&&Math.abs(innerHeight-(size+384))<=1&&document.getElementById("mascot").style.getPropertyValue("--agy-width")===size+"px",size);
   const b=await page.locator("#bubble").boundingBox(),m=await page.locator("#motion").boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
   assert(b.x>=0&&b.y>=0&&b.x+b.width<=viewport.width&&m.y+m.height<=viewport.height,"Widget clipped at "+size+" "+JSON.stringify({b,m,viewport}));
   const anchor=await page.locator("#bubble").evaluate(el=>{
    const rect=el.getBoundingClientRect(),frame=document.querySelector(".agy-frame--idle").getBoundingClientRect(),border=parseFloat(getComputedStyle(el).borderLeftWidth);
    const dot=name=>{const s=getComputedStyle(el,name),width=parseFloat(s.width),height=parseFloat(s.height),bottom=rect.bottom-border-parseFloat(s.bottom);return{x:rect.x+border+parseFloat(s.left)+width/2,y:bottom-height/2,bottom};};
    // Crown anchor measured from the square idle artwork.
    return{small:dot("::before"),large:dot("::after"),crown:{x:frame.x+frame.width*.5,y:frame.y+frame.height*.035}};
   });
   assert(anchor.small.x<anchor.large.x&&anchor.small.y>anchor.large.y,"Thought dots must turn toward the head");
   assert(Math.abs(anchor.small.x-anchor.crown.x)<18&&anchor.crown.y-anchor.small.bottom>0&&anchor.crown.y-anchor.small.bottom<32,"Thought dots must originate beside the crown at "+size+" "+JSON.stringify(anchor));
   const boundsBefore=await widget.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
   for(let i=0;i<8;i++)await page.evaluate(bubblePage=>window.widgetApi.save({bubblePage}),i%2?"quota":"today");
   assert.deepEqual(await widget.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds()),boundsBefore,"Unrelated settings must not move the widget at fractional DPI");
  }
  await page.evaluate(()=>window.widgetApi.save({scale:220}));
  await page.screenshot({path:path.join(out,"widget-runtime.png"),omitBackground:true});
  const closeInside=await page.locator("#close").evaluate(e=>{const c=e.getBoundingClientRect(),b=document.getElementById("bubble").getBoundingClientRect();return Math.pow(((c.left+c.right)/2-(b.left+b.right)/2)/(b.width/2),2)+Math.pow(((c.top+c.bottom)/2-(b.top+b.bottom)/2)/(b.height/2),2)<1;});
  await page.evaluate(()=>window.widgetApi.save({manualQuota:false}));
  const positionBefore=await widget.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
  const titleBeforeLongPress=await page.locator("#title").textContent();
  const bubbleBeforeLongPress=await page.locator("#bubble").isVisible();
  await page.locator("#motion").hover({force:true});await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.deepEqual(await widget.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds()),positionBefore);
  assert.equal(await page.locator("#title").textContent(),titleBeforeLongPress);
  assert.equal(await page.locator("#bubble").isVisible(),bubbleBeforeLongPress);
  report.checks.push("stationary-long-press-does-not-activate-or-move");
  assert(closeInside,"Close button must stay inside thought ellipse");
  await widget.evaluate(({BrowserWindow,screen})=>{const a=screen.getPrimaryDisplay().workArea;BrowserWindow.getAllWindows()[0].setPosition(a.x+150,a.y+100);});
  const beforeDrag=await widget.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
  const titleBeforeDrag=await page.locator("#title").textContent();
  const bubbleBeforeDrag=await page.locator("#bubble").isVisible();
  await page.locator("#motion").hover({force:true});const dragBox=await page.locator("#motion").boundingBox();await page.mouse.down();await page.mouse.move(dragBox.x+dragBox.width/2+95,dragBox.y+dragBox.height/2-30,{steps:8});await page.waitForTimeout(150);await page.mouse.up();
  const afterDrag=await widget.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());assert.deepEqual(afterDrag,beforeDrag,"A held swipe must keep the widget in place");
  assert.equal(await page.locator("#title").textContent(),titleBeforeDrag);
  assert.equal(await page.locator("#bubble").isVisible(),bubbleBeforeDrag);
  for(const side of ["left","right"]){await page.evaluate(side=>window.widgetApi.command("dock-"+side),side);await page.waitForFunction(side=>document.getElementById("mascot").dataset.facing===side,side);await page.waitForTimeout(280);const result=await widget.evaluate(({BrowserWindow,screen})=>{const b=BrowserWindow.getAllWindows()[0].getBounds();return{b,a:screen.getDisplayMatching(b).workArea};});assert(Math.abs(result.b.y+result.b.height-result.a.y-result.a.height)<=1);assert(Math.abs((side==="left"?result.b.x:result.b.x+result.b.width)-(side==="left"?result.a.x:result.a.x+result.a.width))<=1);}
  await page.waitForTimeout(300);const edge=await page.locator(".agy-face").boundingBox();assert(Math.abs(edge.x+edge.width-await page.evaluate(()=>innerWidth))<3,"Visible character must touch the right window edge");await page.screenshot({path:path.join(out,"widget-facing-right.png"),omitBackground:true});
  report.checks.push("held-swipe-keeps-position-and-explicit-corner-docking-still-works");

  await page.locator("#next").click();assert.equal(await page.locator("#title").textContent(),"喵言喵语");
  await page.locator("#close").click();await page.waitForTimeout(210);assert.equal(await page.locator("#bubble").isVisible(),false);
  await page.locator("#toggle").click({force:true});await page.waitForTimeout(280);assert.equal(await page.locator("#bubble").isVisible(),true);
  const settingsEvent=widget.waitForEvent("window");await page.locator("#settings").click({force:true});const settings=await settingsEvent;
  await settings.waitForFunction(()=>document.getElementById("soundSet").options.length===4);
  assert.equal(await page.locator("#title").textContent(),"喵言喵语");
  const firstQuip=await page.locator("#value").textContent();assert.equal(await page.locator("#quip").count(),0);await page.locator("#motion").hover({force:true});await page.mouse.down();await page.mouse.up();await page.waitForFunction(text=>document.getElementById("value").textContent!==text,firstQuip);assert.equal(await page.locator("#page").textContent(),"2 / 4");await page.waitForFunction(()=>!["pressed","release","petting"].includes(document.getElementById("mascot").dataset.state));
  await settings.locator('.nav-item[data-page="about"]').click();
  await settings.locator("#preview-reaction").click();await page.waitForFunction(()=>document.getElementById("mascot").dataset.expression==="proud");
  assert.equal(await page.locator(".agy-expression--proud").evaluate(el=>getComputedStyle(el).opacity),"1");
  await page.screenshot({path:path.join(out,"widget-expression-runtime.png"),omitBackground:true});
  await page.locator("#motion").hover({force:true});await page.mouse.down();await page.waitForTimeout(220);
  assert(await page.locator("#mascot").getAttribute("data-expression"),"Press must retain the expression");
  assert.notEqual(await page.locator(".agy-face").evaluate(e=>getComputedStyle(e).scale),"1");
  await page.mouse.up();
  await settings.locator('.nav-item[data-page="interact"]').click();
  await settings.locator("#easterEggs").uncheck();
  assert.equal(await page.locator("#mascot").getAttribute("data-expression"),"proud");
  await page.waitForFunction(()=>!document.getElementById("mascot").dataset.expression);
  await settings.locator("#easterEggs").check();
  report.checks.push("chinese-quips-change-and-expression-preview-finishes-after-settings-refresh");
  const desktopBounds=await widget.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith("/index.html")).getBounds());
  await widget.evaluate(({},modulePath)=>{const {ForegroundMonitor}=process.mainModule.require(modulePath);globalThis.__nativeStart=ForegroundMonitor.prototype.start;ForegroundMonitor.prototype.start=function(){globalThis.__testForeground=this;};},path.join(root,"Antigravity-Cat-Widget/src/domain/host-visibility.cjs"));
  await settings.locator('.nav-item[data-page="overview"]').click();
  await settings.locator("#hostWindowOnly").check();
  await widget.evaluate(({screen})=>{const m=globalThis.__testForeground;m.state={kind:"host",bounds:screen.dipToScreenRect(null,screen.getPrimaryDisplay().workArea)};m.emit("change",m.state);});
  await page.waitForFunction(async()=>(await window.widgetApi.get()).visibility.withinHost);
  await widget.evaluate(({screen})=>{const a=screen.getPrimaryDisplay().workArea,m=globalThis.__testForeground;m.state={kind:"host",bounds:screen.dipToScreenRect(null,{x:a.x+40,y:a.y+20,width:500,height:500})};m.emit("change",m.state);});
  await page.waitForFunction(async()=>{const s=await window.widgetApi.get();return s.visibility.withinHost&&s.displayScale<s.settings.scale&&parseFloat(document.getElementById("mascot").style.getPropertyValue("--agy-width"))===s.displayScale;});
  const constrained=await page.evaluate(()=>window.widgetApi.get());assert.equal(constrained.settings.scale,220);assert(constrained.displayScale>=140);
  const firstHostBounds=await widget.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith("/index.html")).getBounds());
  await widget.evaluate(({screen})=>{const a=screen.getPrimaryDisplay().workArea,m=globalThis.__testForeground;m.state={kind:"self",bounds:screen.dipToScreenRect(null,{x:a.x+80,y:a.y+40,width:500,height:500})};m.emit("change",m.state);});
  const movedHostBounds=await widget.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith("/index.html")).getBounds());
  assert(Math.abs(movedHostBounds.x-firstHostBounds.x-40)<=1&&Math.abs(movedHostBounds.y-firstHostBounds.y-20)<=1,"Widget must follow host client area movement");
  await widget.evaluate(({screen})=>{const a=screen.getPrimaryDisplay().workArea,m=globalThis.__testForeground;m.state={kind:"host",bounds:screen.dipToScreenRect(null,{x:a.x,y:a.y,width:250,height:400})};m.emit("change",m.state);});
  await page.waitForFunction(async()=>!(await window.widgetApi.get()).visibility.visible);
  await widget.evaluate(({screen})=>{const m=globalThis.__testForeground;m.state={kind:"host",bounds:screen.dipToScreenRect(null,screen.getPrimaryDisplay().workArea)};m.emit("change",m.state);});
  await page.waitForFunction(async()=>{const s=await window.widgetApi.get();return s.visibility.withinHost&&s.displayScale===s.settings.scale;});
  for(const side of ["left","right"]){
   await page.evaluate(side=>window.widgetApi.command("dock-"+side),side);await page.waitForTimeout(280);
   const {b,a}=await widget.evaluate(({BrowserWindow,screen})=>({b:BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith("/index.html")).getBounds(),a:screen.getPrimaryDisplay().workArea}));
   const {artShift,displayScale,facing}=await page.evaluate(()=>window.widgetApi.get());
   const visible=artShift+(b.width-displayScale)/2+b.x;
   assert(Math.abs((side==="left"?visible:visible+displayScale)-(side==="left"?a.x:a.x+a.width))<=1,"Docking reaches the selected host edge");
   assert.equal(facing,side);
  }
  report.checks.push("host-mode-menu-docking-reaches-both-visible-corners");
  await widget.evaluate(({BrowserWindow,screen})=>{
   const m=globalThis.__testForeground,w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith("/index.html")),a=screen.getPrimaryDisplay().workArea;
   m.state={kind:"host",nativeFollowing:true,hostId:"controlled",bounds:screen.dipToScreenRect(null,a)};m.emit("change",m.state);
   const before=w.getBounds();w.setBounds({...before,x:before.x+25,y:before.y+15});
   const afterNative=w.getBounds(),original=w.setBounds;let calls=0;w.setBounds=function(...args){calls++;return original.apply(this,args);};
   try{m.state={...m.state,bounds:screen.dipToScreenRect(null,{...a,x:a.x+25,y:a.y+15})};m.emit("change",m.state);globalThis.__followProbe={calls,afterNative,actual:w.getBounds()};}finally{w.setBounds=original;}
  });
  const followProbe=await widget.evaluate(()=>globalThis.__followProbe);assert.equal(followProbe.calls,0,"JS must not reposition a natively translated widget");assert.deepEqual(followProbe.actual,followProbe.afterNative);
  report.checks.push("native-host-translation-has-one-position-controller-no-js-correction");
  report.checks.push("host-resize-temporary-scale-small-window-hide-self-focus-follow-and-restore");
  await page.evaluate(()=>window.widgetApi.save({standaloneDesktopMode:false}));
  await widget.evaluate(()=>{const m=globalThis.__testForeground;m.state={kind:"other",bounds:null};m.emit("change",m.state);});
  await page.waitForFunction(async()=>!(await window.widgetApi.get()).visibility.visible);
  await settings.locator("#hostWindowOnly").uncheck();
  assert.deepEqual(await widget.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith("/index.html")).getBounds()),desktopBounds);
  await widget.evaluate(({},modulePath)=>{process.mainModule.require(modulePath).ForegroundMonitor.prototype.start=globalThis.__nativeStart;},path.join(root,"Antigravity-Cat-Widget/src/domain/host-visibility.cjs"));
  await page.locator("#next").click();await page.locator("#next").click();
  report.checks.push("controlled-host-foreground-hide-follow-and-desktop-position-restore");
  if(await require("../shared/host.cjs").discover()){
   await page.evaluate(()=>window.widgetApi.save({hostWindowOnly:true}));
   await page.waitForFunction(async()=>(await window.widgetApi.get()).visibility.nativeAttached);
   await page.evaluate(()=>window.widgetApi.save({hostWindowOnly:false}));
   report.checks.push("real-native-host-tracking-established");
  }

  await settings.locator('.nav-item[data-page="pet"]').click();
  const initialWidgetSettings=(await settings.evaluate(()=>window.widgetApi.get())).settings;
  await settings.locator("#volume").fill("0");await settings.waitForTimeout(100);
  assert.equal((await settings.evaluate(()=>window.widgetApi.get())).settings.volume,0);
  await settings.locator("#soundSet").selectOption("soft-spring");
  assert.equal((await settings.evaluate(()=>window.widgetApi.get())).settings.soundSet,"soft-spring");
  await settings.locator("#undo").click();
  await settings.waitForFunction(()=>document.getElementById("saved").textContent.includes("已恢复"));
  const restoredWidgetSettings=(await settings.evaluate(()=>window.widgetApi.get())).settings;
  for(const key of ["volume","soundSet","scale","manualQuota","manualPercent"])assert.equal(restoredWidgetSettings[key],initialWidgetSettings[key]);
  report.checks.push("widget-settings-undo-restores-opening-values");
  await settings.locator('.nav-item[data-page="quota"]').click();
  await settings.locator("#manualPercent").fill("14");
  await settings.locator("#manualPercent").dispatchEvent("change");
  await settings.locator("#manualWeeklyPercent").evaluate(el=>{el.focus();el.value="68";el.dispatchEvent(new Event("change",{bubbles:true}));});
  await settings.locator("#manualQuota").check();
  await page.evaluate(()=>window.widgetApi.save({bubblePage:"quota"}));
  for(let i=0;i<4&&await page.locator("#title").textContent()!=="Gemini Models";i++)await page.locator("#next").click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#track").getAttribute("aria-valuenow"),"14");
  assert.equal(await page.locator("#track-week").getAttribute("aria-valuenow"),"68");
  await page.screenshot({path:path.join(out,"widget-quota-manual.png"),omitBackground:true});
  await settings.locator("#manualPercent").evaluate(el=>{el.focus();el.value="0";el.dispatchEvent(new Event("change",{bubbles:true}));});
  await page.waitForFunction(()=>document.getElementById("track").getAttribute("aria-valuenow")==="0");
  await settings.locator("#manualQuota").uncheck();
  await settings.evaluate(()=>scrollTo(0,0));
  await settings.screenshot({path:path.join(out,"widget-settings.png"),fullPage:true});
  report.checks.push("manual-quota-14-and-zero-explicitly-labelled");
  report.checks.push("widget-real-window-140-220-300-360","quota-unknown-not-zero","bubble-navigation-close-restore","settings-zero-volume-four-public-audio-presets");
  report.checks.push("unrelated-settings-do-not-drift-window-at-fractional-dpi");
  report.checks.push("thought-dot-chain-originates-at-character-crown-140-220-300-360");
  await page.evaluate(()=>window.widgetApi.save({reducedMotion:true}));
  assert.equal(await page.locator("#motion").evaluate(e=>getComputedStyle(e).animationName),"none");
  await page.evaluate(()=>window.widgetApi.save({reducedMotion:false}));
  const quotaState=await page.evaluate(()=>window.widgetApi.get());
  if(quotaState.source.online){
   await page.evaluate(()=>window.widgetApi.save({manualQuota:true,manualPercent:10}));
   await page.waitForFunction(()=>document.getElementById("mascot").dataset.state==="warning");
   await page.locator("#motion").hover({force:true});await page.mouse.down();
   await page.locator("#motion").dispatchEvent("pointercancel",{pointerId:1});await page.mouse.up();
   await page.waitForFunction(()=>document.getElementById("mascot").dataset.state==="warning");
   await page.evaluate(()=>window.widgetApi.save({manualQuota:false}));
   await page.waitForFunction(()=>!["pressed","release","petting"].includes(document.getElementById("mascot").dataset.state));
   report.checks.push("manual-low-quota-restores-warning-after-pointer-cancel-and-returns-to-live-state");
  }
  report.checks.push("real-widget-reduced-motion");
  const state=await page.evaluate(()=>window.widgetApi.get());
  report.localTelemetry={files:state.source.files,observedModelSteps:state.ledger.todaySteps,rawConversationTextStored:false,price:null,quota:null};
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),"dream-cdp-test-"));
  const context=await chromium.launchPersistentContext(profile,{channel:"msedge",headless:true,args:["--remote-debugging-port=0"],viewport:{width:1280,height:800}});
  try{
   const host=await context.newPage();
   await host.setContent('<html><head><style>body{background:#fafafa;color:#222}#root{height:100vh;background:white}.main{width:100%;height:100%}.monaco-editor{background:#f8f8f8;color:#135;height:300px}textarea{background:#fff;color:#111}</style></head><body><div id="root"><main class="main"><h1>Welcome</h1><div class="monaco-editor">const value = 42;</div><textarea>Input stays editable</textarea></main></div></body></html>');
   const before=await host.locator(".monaco-editor").evaluate(e=>({bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}));
   const payload=new DreamSkinThemeLoader().payload({scrim:12,fit:"contain",outputMode:"transparent"});
   await host.evaluate(()=>document.body.style.setProperty("--agy-dream-base-bg","#abcdef","important"));
   const bodyVariable=await host.evaluate(()=>({value:document.body.style.getPropertyValue("--agy-dream-base-bg"),priority:document.body.style.getPropertyPriority("--agy-dream-base-bg")}));
   for(let i=0;i<20;i++){
    const applied=await host.evaluate(installTheme,payload);assert.equal(applied.applied,true);
    assert.equal(await host.locator("#agy-dream-wallpaper-v2").count(),1);
    const after=await host.locator(".monaco-editor").evaluate(e=>({bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}));
    assert.equal(after.color,before.color);
    await host.locator("textarea").fill("still editable");
    await host.evaluate(()=>window.__agyDreamSkinV2.destroy());
    assert.equal(await host.locator("[data-agy-dream-clear]").count(),0);
    assert.equal(await host.locator("#agy-dream-style-v2").count(),0);
    assert.deepEqual(await host.evaluate(()=>({value:document.body.style.getPropertyValue("--agy-dream-base-bg"),priority:document.body.style.getPropertyPriority("--agy-dream-base-bg")})),bodyVariable);
   }
   report.checks.push("controlled-host-20-mount-unmount-cycles-no-residue","editor-text-color-preserved","input-remains-editable");
   await host.evaluate(installTheme,payload);
   const trackedBefore=await host.evaluate(()=>window.__agyDreamSkinV2.status().trackedChanges);
   for(let i=0;i<3;i++){
    await host.evaluate(()=>{const area=document.createElement("section");area.id="temporary-page";for(let j=0;j<80;j++){const pre=document.createElement("pre");pre.textContent="temporary output";area.append(pre);}document.getElementById("root").append(area);});
    await host.waitForFunction(b=>window.__agyDreamSkinV2.status().trackedChanges>=b+160,trackedBefore);
    await host.evaluate(()=>document.getElementById("temporary-page").remove());
    await host.waitForFunction(b=>window.__agyDreamSkinV2.status().trackedChanges===b,trackedBefore);
   }
   report.checks.push("controlled-host-detached-page-references-released-3x80-nodes");
   await host.evaluate(()=>{
    const root=document.createElement("div");root.id="root";
    const editor=document.createElement("div");editor.className="monaco-editor";editor.textContent="new root remains readable";
    root.append(editor);document.getElementById("root").replaceWith(root);
   });
   assert.equal(await host.evaluate(()=>window.__agyDreamSkinV2.status().applied),false);
   assert.equal((await host.evaluate(installTheme,payload)).applied,true);
   assert.equal(await host.locator("#agy-dream-wallpaper-v2").count(),1);
   await host.evaluate(()=>document.getElementById("agy-dream-wallpaper-v2").remove());
   assert.equal(await host.evaluate(()=>window.__agyDreamSkinV2.status().applied),false);
   assert.equal((await host.evaluate(installTheme,payload)).applied,true);
   await assert.rejects(host.evaluate(installTheme,{...payload,owner:"another-controller"}),/另一个运行实例/);
   assert.equal(await host.locator("#agy-dream-wallpaper-v2").count(),1);
   await host.evaluate(()=>window.__agyDreamSkinV2.destroy());
   assert.equal(await host.locator("[data-agy-dream-root],[data-agy-dream-clear],[data-agy-dream-protect],#agy-dream-style-v2").count(),0);
   report.checks.push("root-remount-and-removed-layer-repair","dom-owner-conflict-no-duplicate-or-residue");
   const port=Number(fs.readFileSync(path.join(profile,"DevToolsActivePort"),"utf8").split("\n")[0]);
   const targets=await(await fetch("http://127.0.0.1:"+port+"/json/list")).json();
   const target=targets.find(t=>t.type==="page"&&t.url==="about:blank");
   const{HostController}=require("../Antigravity-Dream-Skin/src/domain/host-controller.cjs");
   const controller=new HostController(new DreamSkinThemeLoader(),()=>{},{discover:async()=>({target,port})});
   controller.start({enabled:true,scrim:12,fit:"contain"});await controller.tick();
   assert.equal(controller.status.applied,true);
   await controller.update({enabled:false,scrim:12,fit:"contain"});
   assert.equal(controller.status.applied,false);
   await controller.stop();
   report.checks.push("real-cdp-protocol-apply-disable-cleanup-on-controlled-browser");
   for(const background of ["rgb(248, 248, 248)","rgb(26, 26, 30)"]){
    await host.setContent('<html><head><style>body{margin:0}#root{height:100vh;background:'+background+'}.monaco-editor{height:300px;color:#789}</style></head><body><div id="root"><main style="height:100%"><div class="monaco-editor">Transparent editor surface</div></main></div></body></html>');
    await host.evaluate(installTheme,payload);
    assert.match(await host.locator(".monaco-editor").evaluate(e=>getComputedStyle(e).backgroundColor),/^rgba?\(/);
    await host.evaluate(()=>window.__agyDreamSkinV2.destroy());
    assert.equal(await host.locator(".monaco-editor").evaluate(e=>getComputedStyle(e).backgroundColor),"rgba(0, 0, 0, 0)");
   }
   report.checks.push("transparent-editors-render-and-restore-cleanly-on-light-and-dark-hosts");
   for(const width of [1280,900]){
    await host.setViewportSize({width,height:800});
    await host.setContent('<html><head><style>body{margin:0}#root{display:flex;height:100vh;background:#fff}aside{width:220px;flex:none;background:#222;color:#eee}.agy-sheet{flex:1;height:100%;background:#f9f9f9}</style></head><body><div id="root"><aside><button aria-selected="true">Selected</button>Native sidebar</aside><div class="agy-sheet"><div role="article"><p>Readable conversation</p><p>Second paragraph</p><ul><li>One list item</li></ul></div><div class="pt-[30vh]" style="height:100%;display:flex"><form class="surface-composer">Composer</form><div class="absolute bottom-0 pointer-events-none" style="position:absolute;bottom:90px;width:80%;height:48px;background:linear-gradient(to top,#000,transparent)"></div></div></div></div></body></html>');
    const sidebarBefore=await host.locator("aside").evaluate(e=>({bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}));
    await host.evaluate(installTheme,payload);
    const paneBounds=await host.locator(".agy-sheet").boundingBox(),layerBounds=await host.locator("#agy-dream-wallpaper-v2").boundingBox();
    for(const key of ["x","y","width","height"])assert(Math.abs(paneBounds[key]-layerBounds[key])<1,"Wallpaper must fit main workspace at "+width);
    assert.equal(await host.locator("aside").evaluate(e=>getComputedStyle(e).color),sidebarBefore.color);
    assert.notEqual(await host.locator("aside").evaluate(e=>getComputedStyle(e).backgroundImage),"none");
    assert.notEqual(await host.locator("aside button").evaluate(e=>getComputedStyle(e).backgroundImage),"none");
    assert.equal(await host.locator("[role=article]").getAttribute("data-agy-dream-reading"),"");
    assert.equal(await host.locator("[role=article]").evaluate(e=>getComputedStyle(e).backgroundColor),"rgba(0, 0, 0, 0)");
    assert.equal(await host.locator("form").evaluate(e=>getComputedStyle(e).backgroundColor),"rgba(0, 0, 0, 0)");
    assert.equal(await host.locator("[data-agy-dream-fade]").evaluate(e=>getComputedStyle(e).backgroundImage),"none");
    assert.equal(await host.locator(".agy-sheet").evaluate(e=>getComputedStyle(e).borderRadius),"22px");
    assert.equal(await host.locator("#agy-dream-wallpaper-v2").evaluate(e=>getComputedStyle(e).borderRadius),"22px");
    assert.equal(await host.locator(".surface-composer").evaluate(e=>getComputedStyle(e).borderRadius),"22px");
    assert.match(await host.locator(".surface-composer").evaluate(e=>getComputedStyle(e).backdropFilter),/blur\(22px\)/);
    assert.match(await host.locator(".surface-composer").evaluate(e=>getComputedStyle(e).backgroundImage),/linear-gradient/);
    assert.equal(await host.locator("body").evaluate(e=>getComputedStyle(e).backgroundColor),"rgb(243, 237, 252)");
    await host.evaluate(installTheme,{...payload,outputMode:"glass"});
    assert.equal(await host.locator("[data-agy-dream-segment]").count(),3);
    assert.match(await host.locator("[role=article] p").first().evaluate(e=>getComputedStyle(e).backdropFilter),/blur\(18px\)/);
    assert.equal(await host.locator("[role=article]").evaluate(e=>getComputedStyle(e).backdropFilter),"none");
    await host.evaluate(installTheme,{...payload,outputMode:"transparent"});
    assert.equal(await host.locator("[role=article] p").first().evaluate(e=>getComputedStyle(e).backdropFilter),"none");
    await host.locator("aside button").evaluate(e=>e.setAttribute("aria-selected","false"));
    assert.equal(await host.locator("aside button").evaluate(e=>getComputedStyle(e).backgroundImage),"none");
    assert.equal(await host.locator("aside [data-agy-dream-clear],aside[data-agy-dream-chrome]").count(),0);
    await host.evaluate(()=>window.__agyDreamSkinV2.destroy());
   }
   report.checks.push("wallpaper-contained-in-main-workspace-sidebar-texture-with-text-colors-preserved-1280-and-900");
   await host.setContent('<html><head></head><body><main style="background:#123456">Unknown host layout</main></body></html>');
   const unknownBefore=await host.content();
   assert.deepEqual(await host.evaluate(installTheme,payload),{applied:false,reason:"unsupported-root"});
   assert.equal(await host.content(),unknownBefore);
   report.checks.push("unknown-host-root-left-unchanged","inline-style-priority-restored");
  }finally{await context.close();}
  assert.deepEqual(report.errors,[]);
  assert.deepEqual(sourceHashes(),report.sourceHashes,"Source changed during runtime verification");
  report.result="pass";report.realHostVerified=false;
  const liveFile=path.join(out,"live-host/report.json");
  if(fs.existsSync(liveFile)){
   const live=JSON.parse(fs.readFileSync(liveFile,"utf8"));
   const sameSource=Object.entries(report.sourceHashes).filter(([file])=>file.startsWith("Antigravity-Dream-Skin/src/")||file.startsWith("Antigravity-Dream-Skin/assets/wallpapers/")||file.startsWith("shared/")).every(([file,hash])=>live.sourceHashes?.[file]===hash);
   report.realHostVerified=sameSource&&live.result==="pass"&&String(live.visualReview).startsWith("pass");
   report.hostEvidence={historical:!sameSource,host:live.host,checkedAt:live.checkedAt,restoreVerified:live.restored.layers===0,visualReview:live.visualReview};
  }
  fs.writeFileSync(path.join(out,"runtime-report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
 }finally{for(const a of apps.reverse())await a.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});



