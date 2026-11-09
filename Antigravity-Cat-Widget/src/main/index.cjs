const {app,BrowserWindow,screen,Tray,Menu,ipcMain,nativeImage,globalShortcut,shell,powerMonitor,net}=require("electron");
const path=require("node:path"),os=require("node:os"),{pathToFileURL}=require("node:url");
const {SettingsManager}=require("../domain/settings.cjs"),{UsageLedger}=require("../domain/ledger.cjs"),{WidgetStateMachine}=require("../domain/state-machine.cjs"),{TranscriptAdapter}=require("../adapters/transcript-adapter.cjs"),{AudioManager}=require("../domain/audio-manager.cjs");
const {HostQuotaAdapter}=require("../adapters/host-quota.cjs");
const {ForegroundMonitor,hostPlacement,characterPlacement,widgetLayout,placeDraggedWidget,facingAt}=require("../domain/host-visibility.cjs");
// BYOK is sealed in archive/legacy-byok and must not be loaded by normal or release runs.
const devGateway=null;
const {CompanionBridgeServer}=require("../../../shared/companion-bridge.cjs");
const {createOnlineActions}=require("./online.cjs");
const {CompanionVisibility}=require("../domain/companion-visibility.cjs");
// 星语皮肤并入同一实例：设置/壁纸/宿主主题化全部由挂件主进程托管，全局只保留一个托盘图标。
const {DreamSkinSettings,legacyRotatePatch}=require("../../../Antigravity-Dream-Skin/src/domain/settings.cjs"),{WallpaperManager}=require("../../../Antigravity-Dream-Skin/src/domain/theme-loader.cjs"),{HostController}=require("../../../Antigravity-Dream-Skin/src/domain/host-controller.cjs"),{LocalizationController}=require("../../../Antigravity-Dream-Skin/src/domain/localization-controller.cjs");
let localizationDict={};
try{const loaded=require("../../../Antigravity-Dream-Skin/assets/localization/zh-CN.json");for(const k of Object.keys(loaded))if(!k.startsWith("$"))localizationDict[k]=loaded[k];}catch{}
const isolatedDev=process.argv.includes("--isolated-dev");
const explicitDataDir=process.argv.find(a=>a.startsWith("--data-dir="))?.slice(11);
const dataDir=explicitDataDir||path.join(os.homedir(),".antigravity-cat-widget");
if(isolatedDev){
 const fs=require("node:fs");
 const localTemp=fs.realpathSync(os.tmpdir()),localData=explicitDataDir&&path.isAbsolute(explicitDataDir)&&fs.realpathSync(explicitDataDir);
 if(!localData||path.relative(localTemp,path.dirname(localData))!==""||!path.basename(localData).startsWith("catstella-window-")){
  throw Error("--isolated-dev requires an existing catstella-window-* test directory directly under the system temp folder.");
 }
}
const skinDataDir=isolatedDev?path.join(dataDir,"skin"):path.join(os.homedir(),".antigravity-dream-skin");
app.setPath("userData",path.join(dataDir,"runtime"));app.setName(isolatedDev?"Catstella (isolated source test)":"Catstella");
// Transparent Chromium surfaces can stop presenting after GPU/desktop transitions.
app.disableHardwareAcceleration();
if(!app.requestSingleInstanceLock())app.quit();
else if(process.argv.includes("--quit")&&!devGateway)app.quit();
else if(process.argv.includes("--quit")){
 const rtFile=path.join(path.dirname(devGateway.defaultModelsPath()),"gateway-runtime.json");
 try{if(require("node:fs").existsSync(rtFile)){const rt=JSON.parse(require("node:fs").readFileSync(rtFile,"utf8"));if(rt?.port&&rt?.adminToken){const req=require("node:http").request({hostname:"127.0.0.1",port:rt.port,path:"/admin/shutdown",method:"POST",headers:{"x-catstella-token":rt.adminToken,"Content-Length":"2"},timeout:800},()=>app.quit());req.on("error",()=>app.quit());req.end("{}");setTimeout(()=>app.quit(),900);}else app.quit();}else app.quit();}catch{app.quit();}
}
else{
 let quitting=false,shutdownDaemonOnQuit=false,recoveryTimer,visualTimer,visualChecking=false,blankFrames=0,visualCheckInterval=15000,uptimeCheckTimer,bridgeMonitorTimer,updateCheckTimer,initialShowTimer;
 const recoveryLog=reason=>{try{require("node:fs").appendFileSync(path.join(dataDir,"recovery.log"),new Date().toISOString()+" "+reason+"\n");}catch{}};
 // BYOK Highest Startup Priority: bind/handshake gateway BEFORE UI rendering and Dream Skin injection.
 const explicitModelsPath=process.argv.find(a=>a.startsWith("--models-path="))?.slice(14);
 const installRoot=[path.resolve(__dirname,"../../../../.."),path.resolve(__dirname,"../../../.."),path.resolve(__dirname,"../../..")].find(d=>require("node:fs").existsSync(path.join(d,".starsuite-install")))||path.resolve(__dirname,"../../..");
 const modelsFilePath=explicitModelsPath||(explicitDataDir?path.join(explicitDataDir,".catstella","models.json"):devGateway?.defaultModelsPath());
 const byokGateway=devGateway?new devGateway.GatewayCoordinator({filePath:modelsFilePath,installRoot,argv:process.argv,env:process.env}):null;
 const byokHandshake=byokGateway?.available?byokGateway.ensureReady().catch(err=>{recoveryLog("byok-handshake-failed "+err.message);return{available:true,ready:false};}):Promise.resolve({available:false,ready:false});
 let win,tray,panel,source={online:false,source:"正在读取本机日志",files:0},saveTimer,displayScale=null,hostArea=null,hostLayout=null,facing="right",dockSide="",artShift=0,dragPlacement=null;
 const noHost=isolatedDev?{discover:async()=>null}:{};
 const foreground=new ForegroundMonitor(),quotaAdapter=new HostQuotaAdapter(noHost);
 const startForeground=handle=>{if(!isolatedDev)foreground.start(handle);};
 const companionVisibility=new CompanionVisibility();
 const dialogue=require("../../assets/dialogue/zh-CN.json");
 const running=new (require("../domain/model-activity.cjs").ModelActivity)();
 const settings=new SettingsManager(path.join(dataDir,"settings.json")),ledger=new UsageLedger({storagePath:path.join(dataDir,"usage-v2.json")}),sm=new WidgetStateMachine("offline"),adapter=new TranscriptAdapter(isolatedDev?{appDataDir:path.join(dataDir,"transcripts")}:{}),audio=new AudioManager();
 const validPatCount=value=>Number.isSafeInteger(value)&&value>=0?value:0;
 let headPatTotal=validPatCount(settings.get("headPatTotal")),interactionSaveTimer,bubbleDirty=false;
 let headPatDay=settings.get("headPatDay"),headPatToday=validPatCount(settings.get("headPatToday"));
 const flushInteractions=(notify=false)=>{
  clearTimeout(interactionSaveTimer);
  const counted=settings.get("headPatTotal")!==headPatTotal||settings.get("headPatDay")!==headPatDay||settings.get("headPatToday")!==headPatToday;
  if(!counted&&!bubbleDirty)return;
  try{
   if(counted)settings.update({headPatTotal,headPatDay,headPatToday});
   else settings.save();
   const changed=bubbleDirty;
   bubbleDirty=false;
   if(notify&&changed&&panel&&!panel.isDestroyed()&&panel.isVisible())panel.webContents.send("widget:snapshot",snapshot());
  }catch(error){console.warn("Catstella: could not save interaction preferences",error.message);}
 };
 const scheduleInteractionSave=()=>{
  clearTimeout(interactionSaveTimer);
  interactionSaveTimer=setTimeout(()=>flushInteractions(true),350);
 };
 app.on("before-quit",()=>flushInteractions());
 const skinSettings=new DreamSkinSettings(path.join(skinDataDir,"settings.json"));
 const skinManager=new WallpaperManager({userDir:path.join(skinDataDir,"wallpapers")});
 const characterDir=path.join(dataDir,"character-packs");
 const onlineSeed=path.resolve(__dirname,"../../../online-assets");
 const readSeed=relative=>require("node:fs").promises.readFile(path.join(onlineSeed,relative));
 const bundled={catalog:async()=>{const data=JSON.parse(await readSeed("catalog.json"));return {schema:1,items:data.items.filter(item=>item.pack?.id==="moriyama-catgirl-pack")};},
  file:async relative=>new Response(await readSeed(relative))};
 const online=createOnlineActions({dataDir,wallpaperDir:skinManager.userDir,characterDir,bundled,fetcher:isolatedDev?async()=>{throw Error("Network disabled in isolated source test");}:(...args)=>net.fetch(...args),
  onInstalled:kind=>{if(kind==="character")cachedCharacterPacks=null;else cachedWallpapers=null;publish();},version:require("../../../package.json").version,settings,nativeImage,shell,apply,onCheck:result=>{
  const next=result.status==="available"?result:null;
  if(next?.latest!==availableUpdate?.latest){availableUpdate=next;updateMenu();}
 }});
 const skinController=new HostController(skinManager,()=>{publish();updateMenu();},{owner:"starsuite-desktop-host",...noHost});
 const localization=new LocalizationController(()=>{publish();},{dict:localizationDict,...noHost});
 const WALLPAPER_TITLES={"01_chibi_star_16_9.jpg":"星语星空 · Q版 Stella","02_halloween_duo_16_9.jpg":"万圣双子 · 萌宠同框","03_catgirl_witch_16_9.jpg":"星空大魔女 · 骑行法杖"};
 let availableUpdate=null;
 let cachedCharacterPacks=null,cachedWallpapers=null,lastPackScan=0,lastWallScan=0;
 const getCharacterPacks=()=>{
  const now=Date.now();if(cachedCharacterPacks&&now-lastPackScan<15000)return cachedCharacterPacks;
  const fs=require("node:fs");
  const bundled=path.join(__dirname,"../../assets/character-packs");
  const packs=[];
  for(const root of [bundled,characterDir]){
   let entries=[];
   try{entries=fs.readdirSync(root,{withFileTypes:true});}catch{}
   for(const entry of entries){
    if(!entry.isDirectory()||!/^[a-z][a-z0-9-]{0,60}$/.test(entry.name))continue;
    const dir=path.join(root,entry.name);
    try{
     const manifest=JSON.parse(fs.readFileSync(path.join(dir,"manifest.json"),"utf8"));
     const idle=path.join(dir,"frames","idle.png");
     if(!fs.statSync(idle).isFile()||packs.some(pack=>pack.id===entry.name))continue;
     const preview=nativeImage.createFromPath(idle).resize({width:384}).toDataURL();
     const frames=root===characterDir?Object.fromEntries(["idle","blink","proud","sad","shy"].flatMap(frame=>{
      const file=path.join(dir,"frames",frame+".png");
      return fs.existsSync(file)?[[frame,pathToFileURL(file).href]]:[];
     })):null;
     packs.push({id:entry.name,name:manifest.name||entry.name,description:manifest.description||"",preview,frames});
    }catch{}
   }
  }
  cachedCharacterPacks=packs;lastPackScan=now;return packs;
 };
 const getWallpapers=()=>{
  const now=Date.now();if(cachedWallpapers&&now-lastWallScan<15000)return cachedWallpapers;
  try{
   const fs=require("node:fs");
   cachedWallpapers=skinManager.listPacks(true).filter(pack=>pack.file).map(pack=>{
    let preview="";
    try{preview=nativeImage.createFromPath(pack.file).resize({width:600}).toDataURL();}catch{}
    const fileName=path.basename(pack.file);
    return{id:pack.id,fileName,filePath:pack.file,title:WALLPAPER_TITLES[fileName]||pack.name,preview,pack:pack.pack};
   });
   lastWallScan=now;return cachedWallpapers;
  }catch{return cachedWallpapers=[];}
 };
 // 立绘指纹：帧图内容一变（升级/换图）URL 版本号自动失效 Chromium 文件缓存，根治"偶尔变回老立绘"。
 let cachedArtVersion=null,lastArtScan=0;
 const getArtVersion=()=>{
  const now=Date.now();if(cachedArtVersion&&now-lastArtScan<15000)return cachedArtVersion;
  try{
   const fs=require("node:fs"),crypto=require("node:crypto"),packsDir=path.join(__dirname,"../../assets/character-packs");
   const parts=[];
   const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())walk(full);
    else{const st=fs.statSync(full);parts.push(entry.name+":"+st.size+":"+st.mtimeMs);}
   }};
   walk(packsDir);
   cachedArtVersion=crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0,10);
  }catch{cachedArtVersion="0";}
  lastArtScan=now;return cachedArtVersion;
 };

 // 双端联动桥接服务（127.0.0.1:3921）：同步角色、桌面壁纸库、轮播状态与 AGY/Web 双端额度。
 const companionBridge=new CompanionBridgeServer({
  ...(isolatedDev?{ports:[0]}:{}),
  getState:()=>{
   const fs=require("node:fs");
   const walls=getWallpapers();
   const ds=skinSettings.getAll();
   const activeWall=(ds.wallpaperFile?walls.find(w=>w.filePath&&path.resolve(w.filePath)===path.resolve(ds.wallpaperFile)):null)||walls.find(w=>w.id===ds.wallpaperId)||walls[0]||null;
   let wallMtime=0;
   try{if(activeWall?.filePath&&fs.existsSync(activeWall.filePath))wallMtime=Math.round(fs.statSync(activeWall.filePath).mtimeMs);}catch{}
   const q=quotaAdapter.snapshot;
   const gData=q?.gemini||q||{};
   const isArgon=Boolean(q?.modelInfo?.modelName?.toLowerCase().includes("argon"));
   const manual=settings.get("manualQuota")===true;
   return{
    sync:{
     syncCharacter:settings.get("syncCharacter")!==false,
     syncWallpaper:settings.get("syncWallpaper")!==false,
     syncInteraction:settings.get("syncInteraction")!==false,
     petDisplayMode:settings.get("petDisplayMode")||"both"
    },
    desktop:{
     characterPack:settings.get("characterPack")||"gemini-star-v1",
     characterPackIds:getCharacterPacks().map(pack=>pack.id),
     scale:settings.get("scale")||220,
     sound:settings.get("sound")===true,
     easterEggs:settings.get("easterEggs")===true,
     clickCatAction:settings.get("clickCatAction")||"talk",
     honorific:settings.get("syncInteraction")!==false?{
      mode:settings.get("userHonorificMode"),
      name:settings.get("userHonorificMode")==="custom"?settings.get("customHonorific"):""
     }:null,
     modelActivity:running.snapshot(),
     themePreset:ds.themePreset||"violet",
     skinEnabled:ds.enabled===true,
     wallpaperId:activeWall?.id||ds.wallpaperId||"gemini-character-sheet-v1",
     wallpaperIds:walls.map(wall=>wall.id),
     wallpaperTitle:activeWall?.title||"默认星语设定集",
     wallpaperRev:(activeWall?.id||ds.wallpaperId||"default")+":"+wallMtime,
     wallpaperTransition:ds.transition==="none"?"none":"fade",
     wallpaperFit:ds.fit,
     opacity:ds.opacity??22,
     scrim:ds.scrim??25,
     slideshow:ds.slideshow!==false,
     slideshowIntervalMinutes:ds.slideshowIntervalMinutes||5,
     hostActive:foreground.state.foregroundKind==="host",
     agyQuota:{
      fiveHour:manual?settings.get("manualPercent"):gData.fiveHour??null,
      weekly:manual?settings.get("manualWeeklyPercent"):(isArgon&&typeof q?.argon?.weekly==="number"?q.argon.weekly:(gData.weekly??null)),
      fiveHourReset:manual?"":gData.fiveHourReset||"",
      weeklyReset:manual?"":(isArgon&&typeof q?.argon?.weekly==="number"?(q.argon.weeklyReset||""):(gData.weeklyReset||"")),
      geminiWeekly:manual?settings.get("manualWeeklyPercent"):gData.weekly??null,
      geminiWeeklyReset:manual?"":gData.weeklyReset||"",
      claudeGpt:q?.claudeGpt||null,
      argonWeekly:typeof q?.argon?.weekly==="number"?q.argon.weekly:null,
      argonWeeklyReset:typeof q?.argon?.weeklyReset==="string"?q.argon.weeklyReset:"",
      modelName:q?.modelInfo?.modelName||""
     }
    }
   };
  },
  getWallpapers:()=>getWallpapers(),
  resolveWallpaperFile:(requestedId)=>{
   const packs=skinManager.listPacks(true).filter(p=>p.file);
   const targetId=requestedId||skinSettings.get("wallpaperId");
   const found=packs.find(p=>p.id===targetId);
   if(found?.file)return found.file;
   if(requestedId)return null;
   const fallbackFile=skinSettings.get("wallpaperFile");
   if(fallbackFile&&require("node:fs").existsSync(fallbackFile))return fallbackFile;
   return packs[0]?.file||null;
  },
  onPatch:(patch)=>{
   const characterSync=typeof patch.syncCharacter==="boolean"?patch.syncCharacter:settings.get("syncCharacter")!==false;
   const wallpaperSync=typeof patch.syncWallpaper==="boolean"?patch.syncWallpaper:settings.get("syncWallpaper")!==false;
   const next={};
   for(const k of ["syncCharacter","syncWallpaper","syncInteraction","petDisplayMode","clickCatAction","scale","sound"]){
    if(patch[k]!==undefined&&patch[k]!==settings.get(k))next[k]=patch[k];
   }
   if(characterSync&&typeof patch.characterPack==="string"&&patch.characterPack!==settings.get("characterPack"))next.characterPack=patch.characterPack;
   if(wallpaperSync&&patch.dreamSkin&&typeof patch.dreamSkin==="object"&&!Array.isArray(patch.dreamSkin)){
    const dsPatch={};
    for(const dk of ["wallpaperId","slideshow","slideshowIntervalMinutes","opacity","scrim","themePreset"]){
     if(patch.dreamSkin[dk]!==undefined)dsPatch[dk]=patch.dreamSkin[dk];
    }
    if(dsPatch.wallpaperId){
     const pack=skinManager.listPacks().find(p=>p.id===dsPatch.wallpaperId);
     if(pack?.file)dsPatch.wallpaperFile=pack.file;
     else delete dsPatch.wallpaperId;
    }
    for(const key of Object.keys(dsPatch))if(dsPatch[key]===skinSettings.get(key))delete dsPatch[key];
    if(Object.keys(dsPatch).length)next.dreamSkin=dsPatch;
   }
   if(Object.keys(next).length)apply(next);
   if(wallpaperSync&&patch.action==="next-wallpaper"){rotateWallpaper();publish();}
  },
  onWebUpdate:()=>{syncVisibility();publish();},
  onOpenSettings:byokGateway?.available?(tab=>openSettings(tab==="byok"?"models":tab)):undefined
 });
 const byokPortal=null;

 const displayState=()=>["pressed","release"].includes(sm.currentState)?sm.persistentState:sm.currentState;
 const snapshot=()=>{ledger.quotaRemainingPercent=settings.get("manualQuota")===true?settings.get("manualPercent"):null;return{artShift,dockSide,modelActivity:running.snapshot(),quotaWindows:quotaAdapter.snapshot,webCompanion:companionBridge.getWebSnapshot(),byok:byokGateway?.getSnapshot()??{available:false,gatewayOnline:false},facing,state:displayState(),persistentState:sm.persistentState,dialogue:dialogue.lines,dialogueTags:dialogue.expressionTags,settings:settings.getAll(),dreamSkin:skinSettings.getAll(),skinStatus:skinController.status,characterPacks:getCharacterPacks(),wallpapers:getWallpapers(),artVersion:getArtVersion(),displayScale:displayScale||settings.get("scale"),visibility:{visible:win?.isVisible()===true,supported:process.platform==="win32",foreground:foreground.state.kind,nativeAttached:foreground.state.attached===true,withinHost:!!hostArea},ledger:ledger.getSnapshot(),source,presets:audio.getPresetList()};};
 const send=(channel,data)=>{for(const w of [win,panel])if(w&&!w.isDestroyed())w.webContents.send(channel,data);};
 const syncByokPortal=()=>{if(byokPortal)byokPortal.setFromSnapshot(byokGateway.getSnapshot(),{port:companionBridge.boundPort,portalNonce:companionBridge.portalNonce}).catch(()=>{});};
 const publish=()=>{const snap=snapshot();send("widget:snapshot",snap);syncByokPortal();};
 function syncQuotaState(){if(["idle","warning"].includes(sm.persistentState)){const isArgon=Boolean(quotaAdapter.snapshot.modelInfo?.modelName?.toLowerCase().includes("argon"));const values=settings.get("manualQuota")?[settings.get("manualPercent"),settings.get("manualWeeklyPercent")]:(isArgon&&typeof quotaAdapter.snapshot.argon?.weekly==="number")?[quotaAdapter.snapshot.argon.weekly,quotaAdapter.snapshot.argon.fiveHour]:[quotaAdapter.snapshot.fiveHour,quotaAdapter.snapshot.weekly,quotaAdapter.snapshot.argon?.weekly];sm.setPersistentState(values.some(v=>typeof v==="number"&&v<=20)?"warning":"idle");}}
 // 壁纸轮播（分钟级，上游 slideshow 语义）与旧字段一次性迁移。
 let slideshowTimer=null;
 function rotateWallpaper(){
  const next=skinManager.nextId(skinSettings.get("wallpaperId"));
  const pack=next?skinManager.listPacks().find(p=>p.id===next):null;
  if(!next||next===skinSettings.get("wallpaperId"))return;
  skinSettings.update({wallpaperId:next,wallpaperFile:pack?.file||""});
  skinController.update(skinSettings.getAll());
 }
 function scheduleSlideshow(){
  if(slideshowTimer){clearInterval(slideshowTimer);slideshowTimer=null;}
  if(skinSettings.get("slideshow")!==false){
   const minutes=Number(skinSettings.get("slideshowIntervalMinutes"))||5;
   slideshowTimer=setInterval(rotateWallpaper,Math.max(1,Math.min(60,minutes))*60000);
  }
 }
 function migrateLegacyDreamSettings(){
  if(skinSettings.get("legacyMigrated")!==true){
   const patch=legacyRotatePatch(skinSettings.getAll());
   if(patch)skinSettings.update(patch);
   skinSettings.update({legacyMigrated:true});
  }
  const packs=skinManager.listPacks(true).filter(p=>p.file);
  const file=skinSettings.get("wallpaperFile"),currentId=skinSettings.get("wallpaperId");
  const byFile=file&&packs.find(pack=>[pack.file,...(pack.aliasFiles||[])].some(candidate=>path.resolve(candidate)===path.resolve(file)));
  const selected=byFile||packs.find(pack=>pack.id===currentId||pack.aliases?.includes(currentId))||packs[0];
  if(selected&&(selected.file!==file||selected.id!==currentId))skinSettings.update({wallpaperId:selected.id,wallpaperFile:selected.file});
 }
 function desktopBounds(x,y,previous){
  const saved=Number.isFinite(x)&&Number.isFinite(y);
  const display=previous?screen.getDisplayMatching(previous):saved?screen.getDisplayNearestPoint({x,y}):screen.getPrimaryDisplay();
  const area=display.workArea;
  const {scale,width,height}=widgetLayout(area,settings.get("scale"));
  displayScale=scale;
  const left=previous?previous.x+previous.width-width:saved?x:area.x+area.width-width-18;
  const top=previous?previous.y+previous.height-height:saved?y:area.y+area.height-height-18;
  return characterPlacement(area,scale,{width,height},left+(width-scale)/2,top).bounds;
 }
 function applyStandaloneTopmost(){
  if(!win||win.isDestroyed())return;
  const wantTop=Boolean(settings.get("alwaysOnTop"));
  if(process.platform==='darwin'||process.platform==='linux'){
   win.setAlwaysOnTop(wantTop,wantTop?"screen-saver":"normal");
  }else{
   if(win.isAlwaysOnTop()!==wantTop)win.setAlwaysOnTop(wantTop,wantTop?"pop-up-menu":"normal");
  }
 }
 // 宿主消失时优雅退守：恢复独立桌面尺寸与位置（用户最后的自由坐标，缺省右下角），绝不闪退或强行隐藏。
 function degradeToStandalone(){
  if(!win||win.isDestroyed())return;
  hostArea=null;hostLayout=null;artShift=0;dockSide="";
  win.setBounds(desktopBounds(settings.get("x"),settings.get("y")));
  applyStandaloneTopmost();
  if(!win.isVisible())win.showInactive();
  if(settings.get("clickThrough"))win.setIgnoreMouseEvents(true,{forward:true});else win.setIgnoreMouseEvents(false);
  updateMenu();
 }
 function syncVisibility(){
  if(!win||win.isDestroyed())return;
  const webSnap=companionBridge.getWebSnapshot();
  if(companionVisibility.hideDesktop(settings.get("petDisplayMode"),webSnap,foreground.state)){
   if(win.isVisible())win.hide();
   return;
  }
  if(process.platform!=='win32'&&process.platform!=='darwin'){
   hostArea=null;hostLayout=null;
   applyStandaloneTopmost();
   if(!win.isVisible())win.showInactive();
   return;
  }
  if(!settings.get("hostWindowOnly")){
   hostArea=null;hostLayout=null;
   applyStandaloneTopmost();
   if(!win.isVisible())win.showInactive();
   return;
  }
  const previousArea=hostArea;let state=foreground.state;
  if(state.bounds)state={...state,bounds:process.platform==='win32'?screen.screenToDipRect(null,state.bounds):state.bounds};
  const placement=hostPlacement(state,settings.get("scale"),settings.get("hostOffsetX"),settings.get("hostOffsetY"),settings.get("hostDock"));

  // Host unavailable (hidden/minimized/too small/occluded/not in foreground): never crash or force-hide.
  // Standalone mode degrades gracefully to a free-floating desktop pet.
  if(!placement||state.widgetVisible===false||(state.kind!=="host"&&state.kind!=="self")){
   const wasFollowing=!!hostArea;
   hostArea=null;hostLayout=null;
   if(settings.get("standaloneDesktopMode")&&!settings.get("hostWindowOnly")){
    if(wasFollowing||!win.isVisible())degradeToStandalone();
    publish();return;
   }
   if(win.isVisible()){
    if(process.platform==='darwin')win.setAlwaysOnTop(false);
    win.hide();
   }
   return;
  }

  // Host is available
  if(process.platform==='darwin'){
   win.setAlwaysOnTop(true,"floating");
  }
  if(dragPlacement){hostArea=state.bounds;return false;}
  hostArea=state.bounds;displayScale=placement.scale;artShift=placement.artShift;
  dockSide=Math.abs(placement.visualX-hostArea.x)<2?"left":Math.abs(placement.visualX+displayScale-hostArea.x-hostArea.width)<2?"right":"";
  facing=facingAt(placement.visualX+displayScale/2,hostArea,facing);
  const nextLayout=JSON.stringify([state.hostId,state.restoreGeneration,displayScale,hostArea.width,hostArea.height,settings.get("hostOffsetX"),settings.get("hostOffsetY"),settings.get("hostDock")]);
  const nativeTranslation=state.nativeFollowing&&previousArea&&hostLayout===nextLayout;
  const layoutChanged=hostLayout!==nextLayout;
  hostLayout=nextLayout;
  const old=win.getBounds(),stationary=nativeTranslation&&previousArea&&previousArea.x===hostArea.x&&previousArea.y===hostArea.y;
  if((!nativeTranslation||stationary)&&Object.keys(placement.bounds).some(key=>Math.abs(old[key]-placement.bounds[key])>2))win.setBounds(placement.bounds);

  // Ensure widget is visible when host is available
  if(!win.isVisible()){
   win.showInactive();
   if(layoutChanged)setTimeout(()=>{
     if(win&&!win.isDestroyed()){
       win.webContents.send('widget:preload-frames');
       win.webContents.invalidate();
     }
   },50);
  }
  return !nativeTranslation;
 }
 function show(){
  if(!win||win.isDestroyed())createWindow();
  if(settings.get("hostWindowOnly"))startForeground(win.getNativeWindowHandle());
  if(!win.isVisible()&&!settings.get("hostWindowOnly")){
   win.show();
   applyStandaloneTopmost();
  }
  syncVisibility();
  if(settings.get("clickThrough"))win.setIgnoreMouseEvents(true,{forward:true});else win.setIgnoreMouseEvents(false);
 }
 function apply(partial){
  const allowed=["characterPack","scale","alwaysOnTop","reducedMotion","sound","volume","soundSet","bubbleOn","turnCostOn","turnCostDurationMs","clickThrough","bubblePage","manualQuota","manualPercent","manualWeeklyPercent","hostWindowOnly","standaloneDesktopMode","clickCatAction","easterEggs","ambientChatter","autoUpdateCheck","syncCharacter","syncWallpaper","syncInteraction","petDisplayMode","userHonorificMode","customHonorific"];
  if(partial?.characterPack!==undefined&&!getCharacterPacks().some(pack=>pack.id===partial.characterPack)){
   partial={...partial};delete partial.characterPack;
  }
  const oldScale=settings.get("scale"),oldHostOnly=settings.get("hostWindowOnly"),oldDisplayMode=settings.get("petDisplayMode");
  if(!oldHostOnly&&partial?.hostWindowOnly===true&&win){const pos=win.getBounds();settings.update({x:pos.x,y:pos.y});}
  settings.update(Object.fromEntries(Object.entries(partial||{}).filter(([k])=>allowed.includes(k))));
  if(partial?.dreamSkin&&typeof partial.dreamSkin==="object"&&!Array.isArray(partial.dreamSkin)){
   const dream={...partial.dreamSkin};
   const previous=skinSettings.getAll();
   // 壁纸画廊走 wallpaperFile 选择；同步解析为壁纸包 id 供主题负载使用。
   if(typeof dream.wallpaperFile==="string"&&dream.wallpaperFile){
    const pack=skinManager.listPacks().find(p=>p.file&&path.resolve(p.file)===path.resolve(dream.wallpaperFile));
    if(pack)dream.wallpaperId=pack.id;
   }
   delete dream.legacyMigrated;
   skinSettings.update(dream);
   cachedWallpapers=null;lastWallScan=0;
   skinController.update(skinSettings.getAll());
   localization.update(skinSettings.getAll());
   const next=skinSettings.getAll();
   if(["slideshow","slideshowIntervalMinutes","wallpaperId"].some(key=>next[key]!==previous[key]))scheduleSlideshow();
  }
  syncQuotaState();
  if(oldHostOnly!==settings.get("hostWindowOnly")||oldDisplayMode!==settings.get("petDisplayMode"))foreground.stop();
  if(settings.get("hostWindowOnly"))startForeground(win?.getNativeWindowHandle());
  else if(settings.get("petDisplayMode")==="prefer-web")startForeground();
  else foreground.stop();
  if(win){
   const following=settings.get("hostWindowOnly");
   if(!following&&oldHostOnly){
    artShift=0;dockSide="";
    win.setBounds(desktopBounds(settings.get("x"),settings.get("y")));
   }else if(settings.get("scale")!==oldScale&&!hostArea){
    win.setBounds(desktopBounds(null,null,win.getBounds()));
    if(dockSide)dock(dockSide);
   }
   if(!settings.get("hostWindowOnly"))applyStandaloneTopmost();
   if(settings.get("clickThrough"))win.setIgnoreMouseEvents(true,{forward:true});else win.setIgnoreMouseEvents(false);
   syncVisibility();
  }
  audio.setEnabled(settings.get("sound"));audio.setVolume(settings.get("volume"));audio.setPreset(settings.get("soundSet"));publish();updateMenu();return snapshot();
 }
 function openSettings(targetPage){
  const page=typeof targetPage==="string"?targetPage:"";
  if(panel&&!panel.isDestroyed()){panel.show();panel.focus();if(page)panel.webContents.send("widget:navigate",page);return;}
  // 无边框自绘标题栏设置中心（用户 fork 设计）：拖拽区 + 最小化/关闭按钮。
  const work=screen.getPrimaryDisplay().workAreaSize,pw=Math.min(1080,Math.max(880,work.width-80)),ph=Math.min(740,Math.max(580,work.height-60));panel=new BrowserWindow({width:pw,height:ph,minWidth:860,minHeight:580,frame:false,transparent:true,hasShadow:true,resizable:true,autoHideMenuBar:true,title:"Catstella · 设置中心",backgroundColor:"#00000000",webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  panel.loadFile(path.join(__dirname,"../renderer/settings.html"),page?{hash:page}:undefined);
  if(page)panel.webContents.once("did-finish-load",()=>{if(panel&&!panel.isDestroyed())panel.webContents.send("widget:navigate",page);});
  panel.on("closed",()=>panel=null);
 }
 function reset(){if(settings.get("hostWindowOnly")&&hostArea){settings.update({hostOffsetX:18,hostOffsetY:18,hostDock:""});syncVisibility();publish();return;}if(!win||win.isDestroyed())return;const pos=desktopBounds();artShift=0;dockSide="";win.setBounds(pos);settings.update({x:pos.x,y:pos.y});show();publish();}
 function recall(){show();if(win&&!win.isDestroyed()){win.show();if(process.platform==='darwin')win.setAlwaysOnTop(true,"floating");else if(!settings.get("hostWindowOnly"))applyStandaloneTopmost();win.moveTop();}syncVisibility();if(settings.get("hostWindowOnly")&&!win?.isVisible())openSettings();}
 function updateMenu(){
  if(!tray)return;
  const byokSnap=byokGateway?.getSnapshot();
  const byokItems=[];
  if(byokSnap?.available){
   const choices=Array.isArray(byokSnap.enabledModelChoices)?byokSnap.enabledModelChoices:[];
   const sub=[
    {label:byokSnap.gatewayOnline?("🟢 网关在线 · 127.0.0.1:"+byokSnap.port):"⚪ 网关离线",enabled:false},
    {label:"打开模型网关设置…",click:()=>openSettings("models")}
   ];
   if(choices.length){
    sub.push({type:"separator"});
    for(const item of choices){
     sub.push({
      label:item.providerName+" / "+item.modelId,
      type:"radio",
      checked:Boolean(item.active),
      click:()=>{byokGateway.handleAction("setActiveModel",{providerId:item.providerId,modelId:item.modelId}).then(()=>{publish();updateMenu();}).catch(()=>{});}
     });
    }
   }
   byokItems.push({label:"🔌 BYOK 模型网关",submenu:sub});
  }
  tray.setContextMenu(Menu.buildFromTemplate([{label:"Catstella",enabled:false},{label:"显示 / 唤回挂件",click:recall},{label:"重启套件",click:()=>{app.relaunch();app.quit();}},{label:"统一设置中心",click:()=>openSettings()},...byokItems,...(availableUpdate?[{label:"有新版 "+availableUpdate.latest+" · 查看发行页",click:()=>void online.handle("release")}]:[]),{type:"separator"},
  {label:"应用到 Antigravity（皮肤）",type:"checkbox",checked:skinSettings.get("enabled")===true,click:()=>{skinSettings.update({enabled:skinSettings.get("enabled")!==true});skinController.update(skinSettings.getAll());publish();}},
  {label:"切换下一张壁纸",click:()=>{rotateWallpaper();publish();}},{type:"separator"},
  {label:"仅在 Antigravity 窗口内显示",type:"checkbox",checked:settings.get("hostWindowOnly"),click:()=>apply({hostWindowOnly:!settings.get("hostWindowOnly")})},
  {label:"无宿主时退守桌面显示",type:"checkbox",enabled:settings.get("hostWindowOnly"),checked:settings.get("hostWindowOnly")&&settings.get("standaloneDesktopMode"),click:()=>apply({standaloneDesktopMode:!settings.get("standaloneDesktopMode")})},
  {label:"显示气泡",type:"checkbox",checked:settings.get("bubbleOn"),click:()=>apply({bubbleOn:!settings.get("bubbleOn")})},
  {label:"桌面模式始终置顶",type:"checkbox",enabled:!settings.get("hostWindowOnly"),checked:!settings.get("hostWindowOnly")&&settings.get("alwaysOnTop"),click:()=>apply({alwaysOnTop:!settings.get("alwaysOnTop")})},
  {label:"鼠标穿透 · Ctrl+Alt+Shift+G 恢复",type:"checkbox",checked:settings.get("clickThrough"),click:()=>apply({clickThrough:!settings.get("clickThrough")})},
  {label:"停靠左下角",click:()=>dock("left")},{label:"停靠右下角",click:()=>dock("right")},{label:"重置位置",click:reset},{type:"separator"},{label:"退出 Catstella",click:()=>app.quit()}]));
 }
 function createWindow(){
  if(process.platform==="darwin"&&app.dock)app.dock.hide();
  const pos=desktopBounds(settings.get("x"),settings.get("y"));
  facing=facingAt(pos.x+pos.width/2,screen.getDisplayMatching(pos).workArea,facing,0);
  win=new BrowserWindow({...pos,frame:false,transparent:true,hasShadow:false,resizable:false,skipTaskbar:true,alwaysOnTop:!settings.get("hostWindowOnly")&&settings.get("alwaysOnTop"),show:false,
   webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  // Apply the same native bounds path as dragging before the first frame.
  // On Windows at fractional DPI, constructor sizing can be a few DIP wider.
  if(process.platform==="win32")win.setBounds(pos);
  win.loadFile(path.join(__dirname,"../renderer/index.html"));
  clearTimeout(initialShowTimer);
  initialShowTimer=setTimeout(()=>{if(win&&!win.isDestroyed()&&!win.isVisible()){recoveryLog("renderer-ready-timeout");show();}},5000);
  win.on("closed",()=>{clearTimeout(initialShowTimer);dragPlacement=null;foreground.stop();win=null;if(!quitting)setTimeout(show,250);});
  win.webContents.setWindowOpenHandler(()=>({action:"deny"}));win.webContents.on("will-navigate",e=>e.preventDefault());
  win.webContents.on("render-process-gone",()=>{if(!quitting&&win&&!win.isDestroyed())win.destroy();});
  win.webContents.on("did-finish-load",()=>{blankFrames=0;publish();});
  win.on("show",publish);win.on("hide",publish);
  let unresponsiveTimer;
  win.on("unresponsive",()=>{const stuck=win;clearTimeout(unresponsiveTimer);unresponsiveTimer=setTimeout(()=>{if(!quitting&&win===stuck&&!stuck.isDestroyed())stuck.destroy();},10000);});
  win.on("responsive",()=>clearTimeout(unresponsiveTimer));win.on("closed",()=>clearTimeout(unresponsiveTimer));
 }
 function trusted(e){return[win,panel].some(w=>w&&!w.isDestroyed()&&e.sender===w.webContents);}
 const releaseNotes=require("../../assets/release-notes.json");
 const currentVersion=require("../../../package.json").version;
 const seenReleaseNotes=()=>Array.isArray(settings.get("seenReleaseNotes"))?settings.get("seenReleaseNotes").filter(v=>typeof v==="string").slice(-20):[];
 const settingsSender=e=>Boolean(panel&&!panel.isDestroyed()&&e.sender===panel.webContents);
 ipcMain.handle("widget:release-notes",e=>settingsSender(e)&&releaseNotes.version===currentVersion&&!seenReleaseNotes().includes(currentVersion)?releaseNotes:null);
 ipcMain.handle("widget:release-notes-seen",(e,version)=>{
  if(!settingsSender(e)||version!==currentVersion||releaseNotes.version!==currentVersion)return false;
  settings.update({seenReleaseNotes:[...new Set([...seenReleaseNotes(),currentVersion])].slice(-20)});
  return true;
 });
 ipcMain.handle("widget:online",(e,action,value)=>panel&&!panel.isDestroyed()&&e.sender===panel.webContents?online.handle(action,value):null);
 ipcMain.handle("widget:can-chatter",e=>Boolean(win&&!win.isDestroyed()&&e.sender===win.webContents&&win.isVisible()&&!panel?.isVisible()&&!companionBridge.getWebSnapshot().active&&settings.get("ambientChatter")&&settings.get("bubbleOn")&&["idle","offline"].includes(sm.currentState)&&powerMonitor.getSystemIdleState(300)==="active"));
 ipcMain.handle("widget:get",e=>trusted(e)?snapshot():null);
 ipcMain.handle("widget:settings",(e,v)=>trusted(e)?apply(v):null);
 ipcMain.on("widget:bubble-preference",(e,value)=>{
  if(!trusted(e)||e.sender!==win?.webContents||!value||typeof value!=="object")return;
  const patch={};
  if(["quota","webQuota","claudeGpt","today","latest","talk"].includes(value.bubblePage)&&settings.get("bubblePage")!==value.bubblePage)patch.bubblePage=value.bubblePage;
  if(typeof value.bubbleOn==="boolean"&&settings.get("bubbleOn")!==value.bubbleOn)patch.bubbleOn=value.bubbleOn;
  if(!Object.keys(patch).length)return;
  settings.update(patch,{persist:false});bubbleDirty=true;scheduleInteractionSave();
 });
 ipcMain.on("widget:ready",e=>{if(!win||win.isDestroyed()||e.sender!==win.webContents)return;clearTimeout(initialShowTimer);show();});
 if(byokGateway?.available)ipcMain.handle("widget:byok",(e,payload)=>trusted(e)?byokGateway.handleAction(payload?.action,payload?.data):null);
 ipcMain.on("widget:command",(e,command)=>{
  if(!trusted(e))return;
  if(command==="settings")openSettings();
  else if(command==="settings-close")panel?.close();
  else if(command==="settings-minimize")panel?.minimize();
  else if(command==="refresh-state"||command==="refresh"){
   cachedCharacterPacks=null;lastPackScan=0;cachedWallpapers=null;lastWallScan=0;
   win?.webContents.session.clearCache();
   win?.webContents.reloadIgnoringCache();
   quotaAdapter.tick();
   publish();
   if(panel&&!panel.isDestroyed())panel.webContents.send("widget:snapshot",snapshot());
  }
  else if(command==="open-character-dir"){
   const dir=characterDir;
   require("node:fs").mkdirSync(dir,{recursive:true});
   shell.openPath(dir);
  }
  else if(command==="open-wallpaper-dir"){
   const dir=path.join(skinDataDir,"wallpapers");
   require("node:fs").mkdirSync(dir,{recursive:true});
   shell.openPath(dir);
  }
  else if(command==="next-wallpaper"){rotateWallpaper();publish();}
  else if(command==="open-project-repo")void shell.openExternal("https://github.com/lynnfei/Catstella");
  else if(command==="open-upstream-repo")void shell.openExternal("https://github.com/Monokumakuki/Antigravity-Star-Suite");
  else if(command==="menu")tray?.popUpContextMenu();
  else if(command==="quit")app.quit();
  else if(command==="reset")reset();
  else if(command==="dock-left")dock("left");else if(command==="dock-right")dock("right");
  else if(command==="show-bubble")apply({bubbleOn:true});
  else if(typeof command==="string"&&(command==="preview-reaction"||command.startsWith("preview-reaction:"))){
   const expression=command.split(":")[1]||"proud";
   if(["proud","shy","angry","nap"].includes(expression))send("widget:reaction",{source:"preview",expression});
  }
  else if(command==="quota-refresh")quotaAdapter.openNativeQuota().then(confirmed=>{if(confirmed)send("widget:reaction",{source:"quota-refresh"});}).catch(()=>{});
  else if(byokGateway?.available&&command==="byok-ping-active"){const activeId=byokGateway.getSnapshot().activeProvider?.id;if(activeId){byokGateway.handleAction("ping",{providerId:activeId}).catch(()=>{});byokGateway.handleAction("fetchBalance",{providerId:activeId}).catch(()=>{});}}
  else if(byokGateway?.available&&command==="byok-cycle-prev")byokGateway.handleAction("cycleActiveModel",{delta:-1}).then(()=>{publish();updateMenu();}).catch(()=>{});
  else if(byokGateway?.available&&command==="byok-cycle-next")byokGateway.handleAction("cycleActiveModel",{delta:1}).then(()=>{publish();updateMenu();}).catch(()=>{});
  else if(byokGateway?.available&&command==="byok-open-settings")openSettings("models");
 });
 function dock(side){
  if(!win)return;if(settings.get("hostWindowOnly"))syncVisibility();
  const a=hostArea||screen.getDisplayMatching(win.getBounds()).workArea;
  const {scale:size,width,height}=widgetLayout(a,settings.get("scale"));
  const placement=characterPlacement(a,size,{width,height},side==="left"?a.x:a.x+a.width-size,a.y+a.height-height);
  displayScale=size;
  win.setBounds(placement.bounds);artShift=placement.artShift;dockSide=side;facing=side;
  if(hostArea)settings.update({hostOffsetX:side==="left"?a.width-size:0,hostOffsetY:0,hostDock:side});else settings.update({x:placement.bounds.x,y:placement.bounds.y});publish();
 }
 ipcMain.on("widget:drag",(e,phase,dx,dy)=>{
  if(!win||win.isDestroyed()||e.sender!==win.webContents)return;
  if(phase==="start"){
   const bounds=win.getBounds(),scale=displayScale||settings.get("scale");
   dragPlacement={bounds,scale,visualX:bounds.x+(bounds.width-scale)/2+artShift,artShift,dockSide,facing};
   win.setIgnoreMouseEvents(false);
   if(process.platform==='darwin')win.setAlwaysOnTop(true,"floating");
   return;
  }
  const drag=dragPlacement;
  if(!drag||!["move","end","cancel"].includes(phase))return;
  if(phase==="cancel"){
   dragPlacement=null;win.setBounds(drag.bounds);displayScale=drag.scale;artShift=drag.artShift;dockSide=drag.dockSide;facing=drag.facing;syncVisibility();
   if(settings.get("clickThrough"))win.setIgnoreMouseEvents(true,{forward:true});else win.setIgnoreMouseEvents(false);
   publish();return;
  }
  if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>100000||Math.abs(dy)>100000)return;
  const left=drag.visualX+dx,top=drag.bounds.y+dy;
  const area=hostArea||screen.getDisplayNearestPoint({x:Math.round(left+drag.scale/2),y:Math.round(top+drag.bounds.height/2)}).workArea;
  const placement=placeDraggedWidget(area,settings.get("scale"),left,top,{following:!!hostArea,snap:phase==="end"});
  const {scale,side}=placement;
  const direction=side||facingAt(placement.visualX+scale/2,area,facing);
  const changed=displayScale!==scale||artShift!==placement.artShift||dockSide!==side||facing!==direction;
  displayScale=scale;artShift=placement.artShift;dockSide=side;facing=direction;
  win.setBounds(placement.bounds);
  if(phase==="end"){
   dragPlacement=null;
   if(settings.get("clickThrough"))win.setIgnoreMouseEvents(true,{forward:true});else win.setIgnoreMouseEvents(false);
   if(process.platform==='darwin')win.setAlwaysOnTop(true,"floating");
   try{
    if(hostArea)settings.update({hostOffsetX:placement.hostOffsetX,hostOffsetY:placement.hostOffsetY,hostDock:side});
    else settings.update({x:placement.bounds.x,y:placement.bounds.y});
   }catch{recoveryLog("drag-position-save-failed");}
  }
  if(changed||phase==="end")publish();
 });
 ipcMain.handle("widget:pointer",(e,action)=>{
  if(!trusted(e)||e.sender!==win?.webContents)return;
  if(action==="down")sm.handlePointerDown();
  else if(action==="up"&&sm.currentState==="pressed")sm.handlePointerUp();
  else if(action==="cancel"&&sm.currentState==="pressed")sm.clearTransient();
  else if(action==="pet")sm.handlePetting();
  else if(action==="head-pat"){
   const now=new Date(),day=[now.getFullYear(),now.getMonth()+1,now.getDate()].join("-");
   if(headPatDay!==day){headPatDay=day;headPatToday=0;}
   headPatTotal=Math.min(headPatTotal+1,Number.MAX_SAFE_INTEGER);
   headPatToday=Math.min(headPatToday+1,Number.MAX_SAFE_INTEGER);
   scheduleInteractionSave();
   return {total:headPatTotal,today:headPatToday};
  }
 });
 ipcMain.on("widget:hit",(e,interactive)=>{
  if(trusted(e)&&e.sender===win?.webContents&&!dragPlacement){
   const ignore=settings.get("clickThrough")||interactive!==true;
   if(ignore)win.setIgnoreMouseEvents(true,{forward:true});
   else win.setIgnoreMouseEvents(false);
  }
 });
 ipcMain.handle("widget:audio",(e,type)=>trusted(e)&&["press","release"].includes(type)?audio.getAudioFile(type):null);
 quotaAdapter.on("change",()=>{syncQuotaState();publish();});
 byokGateway?.on("change",()=>{publish();updateMenu();});
 let byokBusy=false,byokIdleTimer=null;
 byokGateway?.on("activity",ev=>{
  clearTimeout(byokIdleTimer);
  if(ev?.phase==="start"){
   byokBusy=true;
   if(!running.size&&["idle","offline","warning"].includes(sm.persistentState))sm.setPersistentState("thinking");
   byokIdleTimer=setTimeout(()=>{byokBusy=false;if(!running.size&&sm.persistentState==="thinking"){sm.setPersistentState(source.online?"idle":"offline");syncQuotaState();}},45000);
  }else if(ev?.phase==="error"){
   byokBusy=false;
   if(!running.size){sm.setPersistentState(source.online?"idle":"offline");syncQuotaState();}
   send("widget:reaction","angry");
  }else if(ev?.phase==="end"){
   byokBusy=false;
   if(!running.size&&sm.persistentState==="thinking"){sm.setPersistentState(source.online?"idle":"offline");syncQuotaState();}
  }
 });
 let lastDisplayState=displayState();
 sm.subscribe(()=>{
  const state=displayState();
  if(state===lastDisplayState)return;
  lastDisplayState=state;
  publish();
 });
 foreground.on("change",()=>{if(syncVisibility()!==false)publish();});
 adapter.on("turnDone",step=>{
  const recorded=ledger.recordStep(step);
  const activityChanged=!step.historical&&running.end(step.sessionId+":"+step.step_index,step.step_index,"model-done",!!recorded&&!recorded.updated);
  if(!step.historical){sm.setPersistentState((running.size||byokBusy)?"thinking":"idle");syncQuotaState();}
  if(recorded){clearTimeout(saveTimer);saveTimer=setTimeout(()=>ledger.save(),1000);if(!step.historical&&!recorded.updated){sm.handleTurnSuccess();send("widget:step",recorded);}}
  if(activityChanged)publish();
 });
 adapter.on("turnRunning",s=>{
  if(s.historical||!running.begin(s.sessionId+":"+s.stepIndex,s.stepIndex))return;
  sm.setPersistentState("thinking");publish();
 });
 adapter.on("turnError",s=>{
  if(s.historical)return;
  const changed=running.end(s.sessionId+":"+s.stepIndex,s.stepIndex,"model-error");
  sm.setPersistentState(running.size?"thinking":"error");
  if(changed)publish();
 });
 adapter.on("status",status=>{source=status;if(!status.online){running.clear();if(!byokBusy)sm.setPersistentState("offline");}else if(sm.persistentState==="offline")sm.setPersistentState((running.size||byokBusy)?"thinking":"idle");syncQuotaState();publish();});
 app.on("second-instance",(_event,args)=>{
  if(args.includes("--quit")){shutdownDaemonOnQuit=true;app.quit();return;}
  if(byokGateway?.available&&args.includes("--settings-byok")){openSettings("models");return;}
  if(args.includes("--settings")){openSettings();return;}
  if(args.includes("--enable")||args.includes("--disable")){skinSettings.update({enabled:args.includes("--enable")});skinController.update(skinSettings.getAll());publish();}
  if(!args.includes("--background"))recall();
 });
 app.whenReady().then(async()=>{
  if(byokGateway?.available)await Promise.race([byokHandshake,new Promise(r=>setTimeout(r,450))]);
  await companionBridge.start().catch(err=>recoveryLog("companion-bridge-failed "+err.message));
  createWindow();
  if(!isolatedDev){void online.check();updateCheckTimer=setInterval(()=>void online.check(),60*60_000);}
  if(byokGateway?.available&&process.argv.includes("--settings-byok"))openSettings("models");
  else if(process.argv.includes("--settings"))openSettings();
  if(!isolatedDev)try{tray=new Tray(nativeImage.createFromPath(path.join(__dirname,"../../assets/character-packs/gemini-star-v1/frames/idle.png")).resize({width:24,height:24}));
  tray.setToolTip("Catstella");tray.on("double-click",recall);updateMenu();}catch(error){recoveryLog("tray-init-failed "+error.message);}
  migrateLegacyDreamSettings();
  if(!isolatedDev)skinController.start(skinSettings.getAll());
  if(byokPortal){syncByokPortal();byokPortal.start();}
  if(!isolatedDev)localization.start();
  scheduleSlideshow();
  if(!isolatedDev){
   globalShortcut.register("CommandOrControl+Alt+G",recall);globalShortcut.register("CommandOrControl+Alt+Shift+G",()=>{apply({clickThrough:false});recall();});
   if(settings.get("hostWindowOnly"))startForeground(win?.getNativeWindowHandle());
   else if(settings.get("petDisplayMode")==="prefer-web")startForeground();
  }
  audio.setEnabled(settings.get("sound"));audio.setVolume(settings.get("volume"));audio.setPreset(settings.get("soundSet"));
  if(!isolatedDev){adapter.start();quotaAdapter.start();}
  let lastWebOnline=false,lastWebActive=false;
  bridgeMonitorTimer=setInterval(()=>{
   const ws=companionBridge.getWebSnapshot();
   if(ws.online!==lastWebOnline||ws.active!==lastWebActive){
    lastWebOnline=ws.online;lastWebActive=ws.active;
    syncVisibility();publish();
   }
  },3500);
  recoveryTimer=setInterval(()=>{if(!win||win.isDestroyed()){show();return;}if(settings.get("hostWindowOnly"))startForeground(win.getNativeWindowHandle());else if(settings.get("petDisplayMode")==="prefer-web")startForeground();},2000);
  // Adaptive visual check interval based on uptime
  uptimeCheckTimer=setInterval(()=>{
   const uptime=process.uptime();
   visualCheckInterval=uptime>=7200?120000:uptime>=3600?60000:15000;
  },300000);
  let lastVisualCheck=0;
  visualTimer=setInterval(async()=>{
   if(Date.now()-lastVisualCheck<visualCheckInterval)return;
   lastVisualCheck=Date.now();
   if(visualChecking||!win||win.isDestroyed()||!win.isVisible()||(settings.get("hostWindowOnly")&&!hostArea))return;
   visualChecking=true;const checked=win;
   try{
    const healthy=await Promise.race([checked.webContents.executeJavaScript(`(()=>{const face=document.querySelector('.agy-face');if(!face)return false;const r=face.getBoundingClientRect();if(r.width<20||r.height<20)return false;let node=face;while(node){const s=getComputedStyle(node);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;node=node.parentElement;}return [...face.querySelectorAll('img')].some(img=>img.complete&&img.naturalWidth>0&&Number(getComputedStyle(img).opacity)>0);})()`),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error("renderer-check-timeout")),4000);timer.unref();})]);
    if(!healthy){recoveryLog("invalid-character-layout-recreate");checked.destroy();return;}
    const frame=await Promise.race([checked.webContents.capturePage(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error("capture-timeout")),4000);timer.unref();})]);
    const pixels=frame.toBitmap();let opaque=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>32)opaque++;
    blankFrames=opaque<500?blankFrames+1:0;
    if(blankFrames>=2&&win===checked&&!checked.isDestroyed()){recoveryLog("blank-surface-recreate opaque="+opaque);checked.destroy();}
   }catch(error){if(win===checked&&!checked.isDestroyed()){recoveryLog("surface-check-recreate "+error.message);checked.destroy();}}
   finally{visualChecking=false;}
  },15000);
  const resume=()=>{if(sm.currentState==="pressed")sm.clearTransient();hostLayout=null;foreground.stop();show();publish();
   if(win&&!win.isDestroyed()){
     win.webContents.send('widget:force-repaint');
     win.webContents.invalidate();
   }
  };
  powerMonitor.on("resume",resume);powerMonitor.on("unlock-screen",resume);
  screen.on("display-removed",reset);
  screen.on("display-metrics-changed",()=>{
   if(!win||win.isDestroyed())return;
   if(!hostArea){
    if(dockSide){dock(dockSide);return;}
    win.setBounds(desktopBounds(null,null,win.getBounds()));
   }
   syncVisibility();publish();
  });
 });
 app.on("before-quit",()=>{quitting=true;clearInterval(visualTimer);clearInterval(recoveryTimer);clearInterval(bridgeMonitorTimer);clearInterval(updateCheckTimer);clearTimeout(byokIdleTimer);if(slideshowTimer)clearInterval(slideshowTimer);foreground.stop();adapter.stop();quotaAdapter.stop();companionBridge.stop().catch(()=>{});byokPortal?.stop().catch(()=>{});byokGateway?.stop({shutdownDaemon:shutdownDaemonOnQuit}).catch(()=>{});skinController.stop();localization.stop();sm.destroy();clearTimeout(saveTimer);ledger.save();globalShortcut.unregisterAll();tray?.destroy();});
 app.on("window-all-closed",()=>{if(!tray)app.quit();});
}
