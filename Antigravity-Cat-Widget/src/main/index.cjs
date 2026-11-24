const {app,BrowserWindow,screen,Tray,Menu,ipcMain,nativeImage,globalShortcut,shell,powerMonitor,net}=require("electron");
const path=require("node:path"),os=require("node:os"),{pathToFileURL}=require("node:url");
const {SettingsManager}=require("../domain/settings.cjs"),{UsageLedger}=require("../domain/ledger.cjs"),{WidgetStateMachine}=require("../domain/state-machine.cjs"),{TranscriptAdapter}=require("../adapters/transcript-adapter.cjs"),{AudioManager}=require("../domain/audio-manager.cjs");
const {HostQuotaAdapter}=require("../adapters/host-quota.cjs");
const {ForegroundMonitor,hostPlacement,characterPlacement,widgetLayout,placeDraggedWidget,facingAt}=require("../domain/host-visibility.cjs");
// BYOK is sealed in archive/legacy-byok and must not be loaded by normal or release runs.
const devGateway=null;
const {CompanionBridgeServer}=require("../../../shared/companion-bridge.cjs");
const {diagnoseHost,configureHostShortcuts,launchHostWithDebug}=require("../../../shared/host.cjs");
const {createOnlineActions}=require("./online.cjs");
const {selectWallpaper}=require("../../../Antigravity-Dream-Skin/src/domain/wallpaper-selection.cjs");
const {CompanionVisibility}=require("../domain/companion-visibility.cjs");
const {isBoundsVisibleOnDisplays,hasUsableDisplay,reconcileBoundsForDisplays,shouldWindowBeVisible}=require("../domain/window-recovery.cjs");
const {MouseRouting}=require("../domain/mouse-routing.cjs");
const {PreviewCache}=require("../domain/preview-cache.cjs");
const {VisualWatchdog}=require("./visual-watchdog.cjs");
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
 let quitting=false,suspended=false,screenLocked=false,shutdownDaemonOnQuit=false,recoveryTimer,visualTimer,bridgeMonitorTimer,updateCheckTimer,initialShowTimer;
 const recoveryLog=reason=>{
  try{
   const fs=require("node:fs"),file=path.join(dataDir,"recovery.log");
   fs.mkdirSync(dataDir,{recursive:true});
   if(fs.existsSync(file)&&fs.statSync(file).size>256*1024)fs.renameSync(file,file+".1");
   fs.appendFileSync(file,`${new Date().toISOString()} pid=${process.pid} ${reason}\n`);
  }catch{}
 };
 let quitReason="application";
 recoveryLog(`start parent=${process.ppid}`);
 process.on("uncaughtExceptionMonitor",(error,origin)=>recoveryLog(`uncaught ${origin} ${error?.name||"Error"} ${error?.code||""}`));
 app.on("child-process-gone",(_event,details)=>{
  recoveryLog(`child-gone type=${details.type} reason=${details.reason} code=${details.exitCode}`);
  if(details?.type==="GPU"&&!quitting&&win&&!win.isDestroyed()){
   setTimeout(()=>{
    if(quitting||!win||win.isDestroyed())return;
    win.webContents.send("widget:force-repaint");
    win.webContents.invalidate();
    if(!settings.get("hostWindowOnly"))applyStandaloneTopmost(true);
   },250);
  }
 });
 app.on("quit",(_event,code)=>recoveryLog(`exit code=${code} reason=${quitReason}`));
 const quit=reason=>{quitReason=reason;app.quit();};
 // BYOK Highest Startup Priority: bind/handshake gateway BEFORE UI rendering and Dream Skin injection.
 const explicitModelsPath=process.argv.find(a=>a.startsWith("--models-path="))?.slice(14);
 const installRoot=[path.resolve(__dirname,"../../../../.."),path.resolve(__dirname,"../../../.."),path.resolve(__dirname,"../../..")].find(d=>require("node:fs").existsSync(path.join(d,".starsuite-install")))||path.resolve(__dirname,"../../..");
 const modelsFilePath=explicitModelsPath||(explicitDataDir?path.join(explicitDataDir,".catstella","models.json"):devGateway?.defaultModelsPath());
 const byokGateway=devGateway?new devGateway.GatewayCoordinator({filePath:modelsFilePath,installRoot,argv:process.argv,env:process.env}):null;
 const byokHandshake=byokGateway?.available?byokGateway.ensureReady().catch(err=>{recoveryLog("byok-handshake-failed "+err.message);return{available:true,ready:false};}):Promise.resolve({available:false,ready:false});
 let win,tray,panel,source={online:false,source:"正在读取本机日志",files:0},saveTimer,displayScale=null,hostArea=null,hostLayout=null,facing="right",dockSide="",artShift=0,artShiftY=0,dragPlacement=null;
 const visualWatchdog=new VisualWatchdog({
  window:()=>win,
  eligible:target=>!quitting&&!suspended&&!screenLocked&&!dragPlacement&&target&&!target.isDestroyed()&&target.isVisible()&&!target.isMinimized()&&(!settings.get("hostWindowOnly")||!!hostArea),
  recover:(target,reason)=>{recoveryLog(`visual-watchdog-recreate reason=${reason}`);target.destroy();}
 });
 const mouseRouting=new MouseRouting({
  window:()=>win,screen,clickThrough:()=>settings.get("clickThrough"),dragging:()=>!!dragPlacement,
  onIgnored:target=>{if(target&&!target.isDestroyed()&&!target.webContents.isDestroyed())target.webContents.send("widget:mouse-left");},
  onEntered:(target,coords)=>{if(target&&!target.isDestroyed()&&!target.webContents.isDestroyed())target.webContents.send("widget:mouse-entered",coords);}
 });
 const noHost=isolatedDev?{discover:async()=>null}:{};
 const foreground=new ForegroundMonitor(),quotaAdapter=new HostQuotaAdapter(noHost);
 const startForeground=handle=>{if(!isolatedDev)foreground.start(handle);};
 const companionVisibility=new CompanionVisibility();
 const dialogue=require("../../assets/dialogue/zh-CN.json");
 const running=new (require("../domain/model-activity.cjs").ModelActivity)();
 const settings=new SettingsManager(path.join(dataDir,"settings.json")),ledger=new UsageLedger({storagePath:path.join(dataDir,"usage-v2.json")}),sm=new WidgetStateMachine("offline"),adapter=new TranscriptAdapter(isolatedDev?{appDataDir:path.join(dataDir,"transcripts")}:{}),audio=new AudioManager();
 function saveUsage(retry=true){
  clearTimeout(saveTimer);
  try{ledger.save();}catch(error){
   recoveryLog(`usage-save-failed ${error.code||error.name}`);
   if(retry&&!quitting)saveTimer=setTimeout(saveUsage,15000);
  }
 }
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
 const online=createOnlineActions({dataDir,wallpaperDir:skinManager.userDir,characterDir,bundled,getDreamSkin:()=>skinSettings.getAll(),getFallbackWallpaper:()=>skinManager.listPacks().find(p=>p.file&&!p.id.startsWith("online-")),fetcher:isolatedDev?async()=>{throw Error("Network disabled in isolated source test");}:(...args)=>net.fetch(...args),
  onInstalled:kind=>{previewCache.clear();if(kind==="character"){cachedCharacterPacks=null;cachedArtVersion=null;lastArtScan=0;}else cachedWallpapers=null;publish();},version:require("../../../package.json").version,settings,nativeImage,shell,apply,onCheck:result=>{
  const next=result.status==="available"?result:null;
  if(next?.latest!==availableUpdate?.latest){availableUpdate=next;updateMenu();}
 }});
 const skinController=new HostController(skinManager,status=>{const key=JSON.stringify([status?.connected,status?.applied,status?.reason]);if(key!==lastSkinStateKey){lastSkinStateKey=key;void refreshHostDiagnostic(true);}publish();updateMenu();},{owner:"starsuite-desktop-host",...noHost});
 const localization=new LocalizationController(()=>{publish();},{dict:localizationDict,...noHost});
 let hostDiagnostic={state:"unknown",connected:false,running:false,cdpAvailable:false,shortcutsSupported:process.platform==="win32",shortcutsConfigured:false,installPath:null};
 let hostDiagnosticInflight=null,lastSkinStateKey="",lastQuotaStatus="";
 async function refreshHostDiagnostic(publishOnChange=false){
  if(isolatedDev)return hostDiagnostic;
  if(hostDiagnosticInflight)return hostDiagnosticInflight;
  hostDiagnosticInflight=(async()=>{
   try{
    const next=await diagnoseHost({bypassCache:true});
    const changed=JSON.stringify(next)!==JSON.stringify(hostDiagnostic);
    hostDiagnostic=next;
    if(changed){updateMenu();if(publishOnChange)publish();}
   }catch{}
   return hostDiagnostic;
  })().finally(()=>{hostDiagnosticInflight=null;});
  return hostDiagnosticInflight;
 }
 const WALLPAPER_TITLES={"01_chibi_star_16_9.jpg":"星语星空 · Q版 Stella","02_halloween_duo_16_9.jpg":"万圣双子 · 萌宠同框","03_catgirl_witch_16_9.jpg":"星空大魔女 · 骑行法杖"};
 let availableUpdate=null;
 let cachedCharacterPacks=null,cachedWallpapers=null,lastPackScan=0,lastWallScan=0;
 const previewCache=new PreviewCache(nativeImage);
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
     const preview=previewCache.get(idle,384);
     const frames=root===characterDir?Object.fromEntries(["idle","blink","proud","sad","shy"].flatMap(frame=>{
      const file=path.join(dir,"frames",frame+".png");
      return fs.existsSync(file)?[[frame,pathToFileURL(file).href]]:[];
     })):null;
     packs.push({id:entry.name,name:manifest.name||entry.name,description:manifest.description||"",revision:typeof manifest.revision==="string"?manifest.revision:"",preview,frames});
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
    try{preview=previewCache.get(pack.file,600);}catch{}
    const fileName=path.basename(pack.file);
    return{id:pack.id,fileName,filePath:pack.file,title:WALLPAPER_TITLES[fileName]||pack.name,revision:pack.revision||"",preview,pack:pack.pack};
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
   if(fs.existsSync(characterDir))walk(characterDir);
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
   const activeWall=walls.find(w=>w.id===ds.wallpaperId)||(ds.wallpaperFile?walls.find(w=>w.filePath&&path.resolve(w.filePath)===path.resolve(ds.wallpaperFile)):null)||walls[0]||null;
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
     chatAppearance:{
      tint:ds.chatTint||skinController.status.defaultChatTint||"#181224",
      opacity:ds.chatOpacity??100,
      reply:ds.replyOpacity??(ds.outputMode==="glass"?22:0)
     },
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
      modelName:q?.modelInfo?.modelName||"",
      orchestrator:Boolean(q?.modelInfo?.orchestrator)
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
   if(wallpaperSync&&patch.action==="next-wallpaper")rotateWallpaper();
  },
  onWebUpdate:()=>{syncVisibility();publish();},
  onOpenSettings:byokGateway?.available?(tab=>openSettings(tab==="byok"?"models":tab)):undefined
 });
 const byokPortal=null;

 const displayState=()=>["pressed","release"].includes(sm.currentState)?sm.persistentState:sm.currentState;
 const snapshot=()=>{ledger.quotaRemainingPercent=settings.get("manualQuota")===true?settings.get("manualPercent"):null;return{artShift,artShiftY,dockSide,modelActivity:running.snapshot(),quotaWindows:quotaAdapter.snapshot,webCompanion:companionBridge.getWebSnapshot(),byok:byokGateway?.getSnapshot()??{available:false,gatewayOnline:false},facing,state:displayState(),persistentState:sm.persistentState,dialogue:dialogue.lines,dialogueTags:dialogue.expressionTags,settings:settings.getAll(),dreamSkin:skinSettings.getAll(),skinStatus:skinController.status,localizationStatus:localization.status,hostDiagnostic,characterPacks:getCharacterPacks(),wallpapers:getWallpapers(),artVersion:getArtVersion(),displayScale:displayScale||settings.get("scale"),visibility:{visible:win?.isVisible()===true,supported:process.platform==="win32",foreground:foreground.state.kind,nativeAttached:foreground.state.attached===true,withinHost:!!hostArea},ledger:ledger.getSnapshot(),source,presets:audio.getPresetList()};};
 const send=(channel,data)=>{for(const w of [win,panel])if(w&&!w.isDestroyed())w.webContents.send(channel,data);};
 const syncByokPortal=()=>{if(byokPortal)byokPortal.setFromSnapshot(byokGateway.getSnapshot(),{port:companionBridge.boundPort,portalNonce:companionBridge.portalNonce}).catch(()=>{});};
 const publish=()=>{const snap=snapshot();send("widget:snapshot",snap);syncByokPortal();};
 function syncQuotaState(){
  if(!["idle","warning"].includes(sm.persistentState))return;
  const quota=quotaAdapter.snapshot;
  const model=quota.modelInfo?.modelName?.toLowerCase()||"";
  const gemini=quota.gemini||quota;
  const active=/claude|gpt|opus|sonnet/.test(model)?quota.claudeGpt||{}:gemini;
  const values=settings.get("manualQuota")
   ?[settings.get("manualPercent"),settings.get("manualWeeklyPercent")]
   :model.includes("argon")?[quota.argon?.fiveHour??gemini.fiveHour,quota.argon?.weekly]
   :[active.fiveHour,active.weekly];
  sm.setPersistentState(values.some(value=>Number.isFinite(value)&&value<=20)?"warning":"idle");
 }
 // 壁纸轮播（分钟级，上游 slideshow 语义）与旧字段一次性迁移。
 let slideshowTimer=null;
 function rotateWallpaper(){
  const next=skinManager.nextId(skinSettings.get("wallpaperId"));
  const pack=next?skinManager.listPacks().find(p=>p.id===next):null;
  if(!next||next===skinSettings.get("wallpaperId"))return;
  try{skinSettings.update({wallpaperId:next,wallpaperFile:pack?.file||""});}
  catch(error){recoveryLog(`wallpaper-save-failed ${error.code||error.name}`);return;}
  skinController.update(skinSettings.getAll());
  publish();
 }
 function scheduleSlideshow(){
  if(slideshowTimer){clearInterval(slideshowTimer);slideshowTimer=null;}
  if(skinSettings.get("slideshow")!==false){
   const minutes=Number(skinSettings.get("slideshowIntervalMinutes"))||5;
   const probeMs=isolatedDev?Number(process.argv.find(a=>a.startsWith("--test-slideshow-ms="))?.split("=")[1]):0;
   slideshowTimer=setInterval(rotateWallpaper,probeMs>=100&&probeMs<=5000?probeMs:Math.max(1,Math.min(60,minutes))*60000);
  }
 }
 function migrateLegacyDreamSettings(){
  const migrating=skinSettings.get("legacyMigrated")!==true;
  if(skinSettings.get("legacyMigrated")!==true){
   const patch=legacyRotatePatch(skinSettings.getAll());
   if(patch)skinSettings.update(patch);
   skinSettings.update({legacyMigrated:true});
  }
  const selected=selectWallpaper(skinManager,skinSettings.getAll(),{fileOnly:migrating});
  if(selected&&(selected.wallpaperFile!==skinSettings.get("wallpaperFile")||selected.wallpaperId!==skinSettings.get("wallpaperId")))skinSettings.update(selected);
 }
 function desktopBounds(x,y,previous){
  const saved=Number.isFinite(x)&&Number.isFinite(y);
  const display=previous?screen.getDisplayMatching(previous):saved?screen.getDisplayNearestPoint({x,y}):screen.getPrimaryDisplay();
  const area=display.workArea;
  const {scale,width,height}=widgetLayout(area,settings.get("scale"));
  displayScale=scale;
  const left=previous?previous.x+previous.width-width:saved?x:area.x+area.width-width-18;
  const top=previous?previous.y+previous.height-height:saved?y:area.y+area.height-height-18;
  const placement=characterPlacement(area,scale,{width,height},left+(width-scale)/2+(saved?settings.get("desktopArtShiftX"):previous?artShift:0),top+(saved?settings.get("desktopArtShiftY"):previous?artShiftY:0));
  artShift=placement.artShift;artShiftY=placement.artShiftY;
  dockSide=Math.abs(placement.visualX-area.x)<2?"left":Math.abs(placement.visualX+scale-area.x-area.width)<2?"right":"";
  return placement.bounds;
 }
 function applyStandaloneTopmost(force=false){
  if(!win||win.isDestroyed())return;
  const wantTop=Boolean(settings.get("alwaysOnTop"));
  if(process.platform==='darwin'||process.platform==='linux'){
   if(force||win.isAlwaysOnTop()!==wantTop)win.setAlwaysOnTop(wantTop,wantTop?"screen-saver":"normal");
  }else{
   if((force&&wantTop)||win.isAlwaysOnTop()!==wantTop)win.setAlwaysOnTop(wantTop,wantTop?"pop-up-menu":"normal");
  }
 }
 // 宿主消失时优雅退守：恢复独立桌面尺寸与位置（用户最后的自由坐标，缺省右下角），绝不闪退或强行隐藏。
 function degradeToStandalone(){
  if(!win||win.isDestroyed())return;
  hostArea=null;hostLayout=null;artShift=0;dockSide="";
  win.setBounds(desktopBounds(settings.get("x"),settings.get("y")));
  applyStandaloneTopmost(true);
  if(win.isMinimized())win.restore();
  if(!win.isVisible())win.showInactive();
  mouseRouting.setIgnored(settings.get("clickThrough"));
  updateMenu();
 }
 function syncVisibility(){
  if(!win||win.isDestroyed())return;
  const webSnap=companionBridge.getWebSnapshot();
  if(companionVisibility.hideDesktop(settings.get("petDisplayMode"),webSnap,foreground.state)){
   if(win.isVisible())win.hide();
   return;
  }
  if(process.platform!=='win32'){
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
  if(state.bounds)state={...state,bounds:screen.screenToDipRect(null,state.bounds)};
  const placement=hostPlacement(state,settings.get("scale"),settings.get("hostOffsetX"),settings.get("hostOffsetY"),settings.get("hostDock"));

  // Host unavailable (hidden/minimized/too small): never crash or force-hide.
  // Standalone mode degrades gracefully to a free-floating desktop pet.
  if(!placement){
   const wasFollowing=!!hostArea;
   if(previousArea)visualWatchdog.reset();
   hostArea=null;hostLayout=null;
   if(settings.get("standaloneDesktopMode")){
    if(wasFollowing||!win.isVisible())degradeToStandalone();
    publish();return;
   }
   if(win.isVisible())win.hide();
   return;
  }

  // Host is available - native ForegroundHost.exe owns z-order (do NOT call win.setAlwaysOnTop(false) here!)
  if(dragPlacement){hostArea=state.bounds;return false;}
  hostArea=state.bounds;displayScale=placement.scale;artShift=placement.artShift;artShiftY=placement.artShiftY;
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
  if(!settings.get("hostWindowOnly")){
   const reconciled=reconcileBoundsForDisplays(win.getBounds(),screen.getAllDisplays(),()=>desktopBounds(settings.get("x"),settings.get("y")));
   if(reconciled.actionable&&reconciled.changed)win.setBounds(reconciled.bounds);
  }
  if(win.isMinimized())win.restore();
  if(!win.isVisible()){
   win.showInactive();
   if(!settings.get("hostWindowOnly"))applyStandaloneTopmost(true);
   else win.moveTop();
  }else if(!settings.get("hostWindowOnly")){
   applyStandaloneTopmost(true);
  }
  syncVisibility();
  mouseRouting.setIgnored(settings.get("clickThrough"));
 }
 function apply(partial){
  const allowed=["characterPack","scale","alwaysOnTop","reducedMotion","sound","volume","soundSet","bubbleOn","turnCostOn","turnCostDurationMs","clickThrough","bubblePage","manualQuota","manualPercent","manualWeeklyPercent","hostWindowOnly","standaloneDesktopMode","clickCatAction","sideQuotaEnabled","sideQuotaVariant","sideQuotaDistance","sideQuotaSize","sideQuotaMode","sideQuotaSource","easterEggs","ambientChatter","autoUpdateCheck","syncCharacter","syncWallpaper","syncInteraction","petDisplayMode","userHonorificMode","customHonorific","customThemes","bubbleTint","bubbleOpacity"];
  if(partial?.characterPack!==undefined&&!getCharacterPacks().some(pack=>pack.id===partial.characterPack)){
   partial={...partial};delete partial.characterPack;
  }
  const oldScale=settings.get("scale"),oldHostOnly=settings.get("hostWindowOnly"),oldDisplayMode=settings.get("petDisplayMode");
  if(!oldHostOnly&&partial?.hostWindowOnly===true&&win){const pos=win.getBounds();settings.update({x:pos.x,y:pos.y});}
  const widgetPatch=Object.fromEntries(Object.entries(partial||{}).filter(([k])=>allowed.includes(k)));
  if(Object.keys(widgetPatch).length)settings.update(widgetPatch);
  if(partial?.dreamSkin&&typeof partial.dreamSkin==="object"&&!Array.isArray(partial.dreamSkin)){
   const dream={...partial.dreamSkin};
   const previous=skinSettings.getAll();
   // 壁纸画廊走 wallpaperFile 选择；同步解析为壁纸包 id 供主题负载使用。
   if(Object.hasOwn(dream,"wallpaperId")||Object.hasOwn(dream,"wallpaperFile")){
    const selected=selectWallpaper(skinManager,{...previous,...dream},{fileOnly:!Object.hasOwn(dream,"wallpaperId")});
    if(selected)Object.assign(dream,selected);
   }
   delete dream.legacyMigrated;
   skinSettings.update(dream);
   if(skinSettings.get("wallpaperId")!==previous.wallpaperId||skinSettings.get("wallpaperFile")!==previous.wallpaperFile){cachedWallpapers=null;lastWallScan=0;}
   skinController.update(skinSettings.getAll());
   localization.update(skinSettings.getAll());
   const next=skinSettings.getAll();
   if(["slideshow","slideshowIntervalMinutes","wallpaperId"].some(key=>next[key]!==previous[key]))scheduleSlideshow();
  }
  syncQuotaState();
  if(oldHostOnly!==settings.get("hostWindowOnly")||oldDisplayMode!==settings.get("petDisplayMode")){
   visualWatchdog.reset();foreground.stop();
  }
  if(settings.get("hostWindowOnly"))startForeground(win?.getNativeWindowHandle());
  else if(settings.get("petDisplayMode")==="prefer-web")startForeground();
  else foreground.stop();
  if(win){
   const following=settings.get("hostWindowOnly");
   if(!following&&oldHostOnly){
    artShift=0;dockSide="";
    win.setBounds(desktopBounds(settings.get("x"),settings.get("y")));
   }else if(settings.get("scale")!==oldScale&&!hostArea){
    const pos=desktopBounds(null,null,win.getBounds());
    win.setBounds(pos);
    settings.update({x:pos.x,y:pos.y,desktopArtShiftX:artShift,desktopArtShiftY:artShiftY});
   }
   if(!settings.get("hostWindowOnly"))applyStandaloneTopmost();
   mouseRouting.setIgnored(settings.get("clickThrough"));
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
 function reset(){if(settings.get("hostWindowOnly")&&hostArea){settings.update({hostOffsetX:18,hostOffsetY:18,hostDock:""});syncVisibility();publish();return;}if(!win||win.isDestroyed())return;const pos=desktopBounds();artShift=0;dockSide="";win.setBounds(pos);settings.update({x:pos.x,y:pos.y,desktopArtShiftX:0,desktopArtShiftY:0});show();publish();}
 function recall(){show();if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();if(!settings.get("hostWindowOnly"))applyStandaloneTopmost(true);win.moveTop();win.webContents.send("widget:force-repaint");win.webContents.invalidate();}if(settings.get("hostWindowOnly")&&!win?.isVisible())openSettings();}
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
  const hostConnected=skinController.status.connected||quotaAdapter.snapshot.online||hostDiagnostic.connected;
  const hostCdpDisabled=!hostConnected&&(skinController.status.reason==="cdp-disabled"||quotaAdapter.snapshot.status==="cdp-disabled"||hostDiagnostic.state==="running-no-cdp");
  const hostTrayLabel=hostConnected?"🟢 Antigravity 已连接":hostCdpDisabled?"⚠️ Antigravity 需开启调试通道并重启":"⚪ Antigravity 等待连接";
  tray.setContextMenu(Menu.buildFromTemplate([{label:"Catstella",enabled:false},{label:"显示 / 唤回挂件",click:recall},{label:"重启套件",click:()=>{app.relaunch();quit("tray-restart");}},{label:"统一设置中心",click:()=>openSettings()},...byokItems,...(availableUpdate?[{label:"有新版 "+availableUpdate.latest+" · 查看发行页",click:()=>void online.handle("release")}]:[]),{type:"separator"},
  {label:hostTrayLabel,enabled:false},
  {label:"应用到 Antigravity（皮肤）",type:"checkbox",checked:skinSettings.get("enabled")===true,click:()=>{skinSettings.update({enabled:skinSettings.get("enabled")!==true});skinController.update(skinSettings.getAll());publish();}},
  {label:"切换下一张壁纸",click:rotateWallpaper},{type:"separator"},
  {label:"仅在 Antigravity 窗口内显示",type:"checkbox",checked:settings.get("hostWindowOnly"),click:()=>apply({hostWindowOnly:!settings.get("hostWindowOnly")})},
  {label:"无宿主时退守桌面显示",type:"checkbox",enabled:settings.get("hostWindowOnly"),checked:settings.get("hostWindowOnly")&&settings.get("standaloneDesktopMode"),click:()=>apply({standaloneDesktopMode:!settings.get("standaloneDesktopMode")})},
  {label:"显示气泡",type:"checkbox",checked:settings.get("bubbleOn"),click:()=>apply({bubbleOn:!settings.get("bubbleOn")})},
  {label:"桌面模式始终置顶",type:"checkbox",enabled:!settings.get("hostWindowOnly"),checked:!settings.get("hostWindowOnly")&&settings.get("alwaysOnTop"),click:()=>apply({alwaysOnTop:!settings.get("alwaysOnTop")})},
  {label:"鼠标穿透 · Ctrl+Alt+Shift+G 恢复",type:"checkbox",checked:settings.get("clickThrough"),click:()=>apply({clickThrough:!settings.get("clickThrough")})},
  {label:"停靠左下角",click:()=>dock("left")},{label:"停靠右下角",click:()=>dock("right")},{label:"重置位置",click:reset},{type:"separator"},{label:"退出 Catstella",click:()=>quit("tray")}]));
 }
 function createWindow(){
  const pos=desktopBounds(settings.get("x"),settings.get("y"));
  facing=facingAt(pos.x+pos.width/2,screen.getDisplayMatching(pos).workArea,facing,0);
  // On Windows, skipTaskbar only removes the current Shell tab. A toolbar
  // window also carries WS_EX_TOOLWINDOW, so show/z-order changes cannot turn
  // the persistent pet back into an ordinary taskbar/Alt-Tab application.
  win=new BrowserWindow({...pos,...(process.platform==="win32"?{type:"toolbar"}:{}),frame:false,transparent:true,hasShadow:false,resizable:false,skipTaskbar:true,alwaysOnTop:!settings.get("hostWindowOnly")&&settings.get("alwaysOnTop"),show:false,
   webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  const created=win;
  visualWatchdog.reset();
  // Apply the same native bounds path as dragging before the first frame.
  // On Windows at fractional DPI, constructor sizing can be a few DIP wider.
  if(process.platform==="win32")win.setBounds(pos);
  clearTimeout(initialShowTimer);
  initialShowTimer=setTimeout(()=>{if(!quitting&&win===created&&!created.isDestroyed()&&!created.isVisible()){recoveryLog("renderer-ready-timeout");show();}},5000);
  created.on("closed",()=>{
   if(win!==created)return;
   clearTimeout(initialShowTimer);
   visualWatchdog.reset();
   dragPlacement=null;foreground.stop();win=null;
   if(!quitting){
    recoveryLog("window-closed-recreate");
    setTimeout(()=>{if(!quitting&&(!win||win.isDestroyed()))show();},250);
   }
  });
  win.webContents.setWindowOpenHandler(()=>({action:"deny"}));win.webContents.on("will-navigate",e=>e.preventDefault());
  win.webContents.on("render-process-gone",(_event,details)=>{
   recoveryLog(`renderer-gone reason=${details.reason} code=${details.exitCode}`);
   if(!quitting&&win===created&&!created.isDestroyed())created.destroy();
  });
  win.on("session-end",()=>recoveryLog("windows-session-end"));
  const resetVisual=()=>{if(win===created)visualWatchdog.reset();};
  created.webContents.on("did-start-loading",resetVisual);
  created.webContents.on("did-finish-load",()=>{resetVisual();publish();});
  for(const event of ["show","hide"])created.on(event,()=>{resetVisual();publish();});
  for(const event of ["minimize","restore"])created.on(event,resetVisual);
  // A brief renderer stall is handled by the same visible-window checks.
  // A renderer process exit still takes the immediate recovery path above.
  created.loadFile(path.join(__dirname,"../renderer/index.html")).catch(error=>recoveryLog(`renderer-load-failed ${error.code||error.name}`));
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
 ipcMain.handle("widget:host",async(e,action)=>{
  if(!settingsSender(e))return null;
  if(action==="diagnose"){
   if(isolatedDev)return{ok:true,diagnostic:hostDiagnostic};
   await refreshHostDiagnostic(true);
   return{ok:true,diagnostic:hostDiagnostic};
  }
  if(action==="configure-shortcuts"||action==="restore-shortcuts"){
   const enable=action==="configure-shortcuts";
   const res=await configureHostShortcuts({enable});
   await refreshHostDiagnostic(false);
   publish();
   return{...res,diagnostic:hostDiagnostic};
  }
  if(action==="launch-debug"){
   const res=await launchHostWithDebug();
   if(res?.ok)setTimeout(()=>void refreshHostDiagnostic(true),1500);
   return res;
  }
  return{ok:false,error:"unsupported-action"};
 });
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
  else if(command==="next-wallpaper")rotateWallpaper();
  else if(command==="open-project-repo")void shell.openExternal("https://github.com/lynnfei/Catstella");
  else if(command==="open-upstream-repo")void shell.openExternal("https://github.com/Monokumakuki/Antigravity-Star-Suite");
  else if(command==="menu")tray?.popUpContextMenu();
  else if(command==="quit")quit("renderer-command");
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
  win.setBounds(placement.bounds);artShift=placement.artShift;artShiftY=placement.artShiftY;dockSide=side;facing=side;
  if(hostArea)settings.update({hostOffsetX:side==="left"?a.width-size:0,hostOffsetY:0,hostDock:side});else settings.update({x:placement.bounds.x,y:placement.bounds.y,desktopArtShiftX:placement.artShift,desktopArtShiftY:placement.artShiftY});publish();
 }
 ipcMain.on("widget:drag",(e,phase,dx,dy)=>{
  if(!win||win.isDestroyed()||e.sender!==win.webContents)return;
  if(phase==="start"){
   const bounds=win.getBounds(),scale=displayScale||settings.get("scale");
   dragPlacement={bounds,scale,visualX:bounds.x+(bounds.width-scale)/2+artShift,artShift,artShiftY,dockSide,facing};
   visualWatchdog.reset();
   mouseRouting.setIgnored(false);
   return;
  }
  const drag=dragPlacement;
  if(!drag||!["move","end","cancel"].includes(phase))return;
  if(phase==="cancel"){
   dragPlacement=null;visualWatchdog.reset();win.setBounds(drag.bounds);displayScale=drag.scale;artShift=drag.artShift;artShiftY=drag.artShiftY;dockSide=drag.dockSide;facing=drag.facing;syncVisibility();mouseRouting.setIgnored(settings.get("clickThrough"));publish();return;
  }
  if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>100000||Math.abs(dy)>100000)return;
  const left=drag.visualX+dx,top=drag.bounds.y+drag.artShiftY+dy;
  const area=hostArea||screen.getDisplayNearestPoint({x:Math.round(left+drag.scale/2),y:Math.round(top+drag.bounds.height-drag.scale/2)}).workArea;
  const placement=placeDraggedWidget(area,settings.get("scale"),left,top,{following:!!hostArea,snap:phase==="end"});
  const {scale,side}=placement;
  const direction=side||facingAt(placement.visualX+scale/2,area,facing);
  const changed=displayScale!==scale||artShift!==placement.artShift||artShiftY!==placement.artShiftY||dockSide!==side||facing!==direction;
  displayScale=scale;artShift=placement.artShift;artShiftY=placement.artShiftY;dockSide=side;facing=direction;
  win.setBounds(placement.bounds);
  if(phase==="end"){
   dragPlacement=null;
   visualWatchdog.reset();
   mouseRouting.setIgnored(settings.get("clickThrough"));
   try{
    if(hostArea)settings.update({hostOffsetX:placement.hostOffsetX,hostOffsetY:placement.hostOffsetY,hostDock:side});
    else settings.update({x:placement.bounds.x,y:placement.bounds.y,desktopArtShiftX:placement.artShift,desktopArtShiftY:placement.artShiftY});
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
 ipcMain.on("widget:hit",(e,interactive)=>{if(trusted(e)&&e.sender===win?.webContents&&!dragPlacement)mouseRouting.setIgnored(settings.get("clickThrough")||interactive!==true);});
 ipcMain.handle("widget:audio",(e,type)=>trusted(e)&&["press","release"].includes(type)?audio.getAudioFile(type):null);
 quotaAdapter.on("change",snap=>{
  const nextStatus=snap?.status||"";
  if(nextStatus!==lastQuotaStatus){
   lastQuotaStatus=nextStatus;
   if(nextStatus==="cdp-disabled"||nextStatus==="ready"||nextStatus==="waiting-host")void refreshHostDiagnostic(true);
  }
  syncQuotaState();publish();
 });
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
 let lastForegroundChild=null,lastForegroundMessage="";
 foreground.on("change",state=>{
  const message=JSON.stringify(state);
  if(lastForegroundChild===foreground.child&&message===lastForegroundMessage)return;
  lastForegroundChild=foreground.child;lastForegroundMessage=message;
  if(syncVisibility()!==false)publish();
 });
 adapter.on("step",step=>{if(!step.historical&&running.observe(step.step_index,step.tools,step.sessionId))publish();});
 adapter.on("turnDone",step=>{
  const recorded=ledger.recordStep(step);
  const activityChanged=!step.historical&&running.end(step.sessionId+":"+step.step_index,step.step_index,"model-done",!!recorded&&!recorded.updated);
  if(!step.historical){sm.setPersistentState((running.size||byokBusy)?"thinking":"idle");syncQuotaState();}
  if(recorded){clearTimeout(saveTimer);saveTimer=setTimeout(saveUsage,1000);if(!step.historical&&!recorded.updated){sm.handleTurnSuccess();send("widget:step",recorded);}}
  if(activityChanged)publish();
 });
 adapter.on("askUser",s=>{if(!s.historical&&running.setWaiting(s.stepIndex,s.sessionId))publish();});
 adapter.on("userInput",s=>{if(s.historical)return;if(running.clearWaiting(s.sessionId,s.stepIndex))publish();});
 adapter.on("turnRunning",s=>{
  if(s.historical||!running.begin(s.sessionId+":"+s.stepIndex,s.stepIndex))return;
  sm.setPersistentState("thinking");publish();
 });
 adapter.on("turnError",s=>{
  if(s.historical)return;
  const changed=running.end(s.sessionId+":"+s.stepIndex,s.stepIndex,"model-error",true);
  if(!changed)return;
  sm.setPersistentState((running.size||byokBusy)?"thinking":source.online?"idle":"offline");
  syncQuotaState();
  if(!running.size&&sm.currentState!=="pressed")sm.triggerTransient("error",2400);
  publish();
 });
 adapter.on("status",status=>{
  const changed=source.online!==status.online||source.files!==status.files||source.lastUpdated!==status.lastUpdated;
  source=status;
  if(!status.online){running.clear();if(!byokBusy)sm.setPersistentState("offline");}
  else if(sm.persistentState==="offline")sm.setPersistentState((running.size||byokBusy)?"thinking":"idle");
  syncQuotaState();
  if(changed)publish();
 });
 app.on("second-instance",(_event,args)=>{
  if(args.includes("--quit")){shutdownDaemonOnQuit=true;quit("second-instance-command");return;}
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
  if(!isolatedDev)void refreshHostDiagnostic(true);
  mouseRouting.start();
  scheduleSlideshow();
  if(!isolatedDev){
   globalShortcut.register("CommandOrControl+Alt+G",recall);globalShortcut.register("CommandOrControl+Alt+Shift+G",()=>{apply({clickThrough:false});recall();});
   if(settings.get("hostWindowOnly"))startForeground(win?.getNativeWindowHandle());
   else if(settings.get("petDisplayMode")==="prefer-web")startForeground();
  }
  audio.setEnabled(settings.get("sound"));audio.setVolume(settings.get("volume"));audio.setPreset(settings.get("soundSet"));
  // Explicit source checks may read only the already-isolated transcripts directory.
  if(!isolatedDev||process.argv.includes("--test-transcripts"))adapter.start();
  if(!isolatedDev)quotaAdapter.start();
  let lastWebOnline=false,lastWebActive=false,lastWebVisible=false,recoveryTickCount=0;
  bridgeMonitorTimer=setInterval(()=>{
   const ws=companionBridge.getWebSnapshot();
   if(ws.online!==lastWebOnline||ws.active!==lastWebActive||ws.visible!==lastWebVisible){
    lastWebOnline=ws.online;lastWebActive=ws.active;lastWebVisible=ws.visible;
    syncVisibility();publish();
   }
  },3500);
  recoveryTimer=setInterval(()=>{
   recoveryTickCount=(recoveryTickCount+1)%30;
   if(quitting)return;
   if(!win||win.isDestroyed()){if(!suspended&&!screenLocked)show();return;}
   if(settings.get("hostWindowOnly"))startForeground(win.getNativeWindowHandle());
   else if(settings.get("petDisplayMode")==="prefer-web")startForeground();
   if(suspended||screenLocked||dragPlacement)return;
   const hideForWeb=companionVisibility.hideDesktop(settings.get("petDisplayMode"),companionBridge.getWebSnapshot(),foreground.state);
   const wantVisible=shouldWindowBeVisible({
    quitting,suspended,screenLocked,dragPlacement,hideForWeb,
    hostWindowOnly:settings.get("hostWindowOnly"),hasHostArea:!!hostArea,
    standaloneDesktopMode:settings.get("standaloneDesktopMode")
   });
   if(!wantVisible){if(win.isVisible())syncVisibility();return;}
   if(win.isMinimized()){recoveryLog("minimized-window-restore");win.restore();}
   if(!settings.get("hostWindowOnly")&&!hostArea){
    const reconciled=reconcileBoundsForDisplays(win.getBounds(),screen.getAllDisplays(),()=>desktopBounds(settings.get("x"),settings.get("y")));
    if(reconciled.actionable&&reconciled.changed){
     recoveryLog("offscreen-bounds-restore");
     win.setBounds(reconciled.bounds);
     win.webContents.invalidate();
    }
   }
   if(!win.isVisible()){
    recoveryLog("hidden-window-restore");
    show();
    win.webContents.send("widget:force-repaint");
    win.webContents.invalidate();
    publish();
    return;
   }
   if(recoveryTickCount===0&&!settings.get("hostWindowOnly")&&settings.get("alwaysOnTop")&&!(panel&&!panel.isDestroyed()&&panel.isVisible())){
    applyStandaloneTopmost(true);
   }
  },2000);
  visualTimer=setInterval(()=>{
   const uptime=process.uptime();
   void visualWatchdog.tick(uptime>=7200?120000:uptime>=3600?60000:15000);
  },15000);
  const resume=()=>{suspended=false;visualWatchdog.reset();if(sm.currentState==="pressed")sm.clearTransient();hostLayout=null;foreground.stop();show();publish();
   if(win&&!win.isDestroyed()){
     win.webContents.send('widget:force-repaint');
     win.webContents.invalidate();
   }
  };
  powerMonitor.on("suspend",()=>{suspended=true;visualWatchdog.reset();});
  powerMonitor.on("resume",resume);
  powerMonitor.on("lock-screen",()=>{screenLocked=true;visualWatchdog.reset();});
  powerMonitor.on("unlock-screen",()=>{screenLocked=false;resume();});
  const reconcileDisplayLayout=(persistValid=false)=>{
   if(quitting||!win||win.isDestroyed()||dragPlacement)return;
   const displays=screen.getAllDisplays();
   if(!hasUsableDisplay(displays))return;
   if(!hostArea){
    const savedX=settings.get("x"),savedY=settings.get("y");
    const savedCandidate=Number.isFinite(savedX)&&Number.isFinite(savedY)?desktopBounds(savedX,savedY):null;
    if(savedCandidate&&isBoundsVisibleOnDisplays(savedCandidate,displays)){
     win.setBounds(savedCandidate);
    }else{
     const current=win.getBounds();
     const pos=isBoundsVisibleOnDisplays(current,displays)?desktopBounds(null,null,current):desktopBounds();
     win.setBounds(pos);
     if(persistValid){
      try{settings.update({x:pos.x,y:pos.y,desktopArtShiftX:artShift,desktopArtShiftY:artShiftY});}
      catch(error){recoveryLog(`display-position-save-failed ${error.code||error.name}`);}
     }
    }
   }
   syncVisibility();
   if(!settings.get("hostWindowOnly"))applyStandaloneTopmost(true);
   win.webContents.send("widget:force-repaint");
   win.webContents.invalidate();
   publish();
  };
  screen.on("display-removed",()=>reconcileDisplayLayout(false));
  screen.on("display-added",()=>reconcileDisplayLayout(false));
  screen.on("display-metrics-changed",()=>reconcileDisplayLayout(true));
 });
 app.on("before-quit",()=>{quitting=true;recoveryLog(`before-quit reason=${quitReason}`);mouseRouting.stop();clearInterval(visualTimer);visualWatchdog.reset();clearInterval(recoveryTimer);clearInterval(bridgeMonitorTimer);clearInterval(updateCheckTimer);clearTimeout(byokIdleTimer);if(slideshowTimer)clearInterval(slideshowTimer);foreground.stop();adapter.stop();quotaAdapter.stop();companionBridge.stop().catch(()=>{});byokPortal?.stop().catch(()=>{});byokGateway?.stop({shutdownDaemon:shutdownDaemonOnQuit}).catch(()=>{});skinController.stop();localization.stop();sm.destroy();saveUsage(false);globalShortcut.unregisterAll();tray?.destroy();});
 // A transient window failure is recovered even if the tray could not initialize.
 app.on("window-all-closed",()=>{});
}
