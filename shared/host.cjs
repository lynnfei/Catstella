const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),http=require("node:http"),{execFile,execFileSync,spawn}=require("node:child_process"),WebSocket=require("./vendor/ws");
const HOST_DEBUG_FLAGS=Object.freeze(["--remote-debugging-port=0","--remote-debugging-address=127.0.0.1"]);
function getJson(port,resource){return new Promise((resolve,reject)=>{const req=http.get({hostname:"127.0.0.1",port,path:resource,timeout:1800},res=>{let data="";res.on("data",b=>{data+=b;if(data.length>1048576)req.destroy();});res.on("end",()=>{try{resolve(JSON.parse(data));}catch{reject(new Error("宿主端点返回无效数据"));}});});req.on("timeout",()=>req.destroy(new Error("宿主响应超时")));req.on("error",reject);});}
function execFileAsync(file,args,options={}){
 return new Promise((resolve,reject)=>{
  execFile(file,args,{encoding:"utf8",...options},(error,stdout)=>{
   if(error)reject(error);else resolve(typeof stdout==="string"?stdout:"");
  });
 });
}
function getHostPortFiles(){
 return[
  path.join(process.env.APPDATA||path.join(os.homedir(),"AppData/Roaming"),"Antigravity/DevToolsActivePort"),
  path.join(os.homedir(),"Library/Application Support/Antigravity/DevToolsActivePort"),
  path.join(os.homedir(),".config/Antigravity/DevToolsActivePort"),
  path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),".config"),"Antigravity/DevToolsActivePort")
 ];
}
function isPrimaryHostPage(t){
 return Boolean(t&&t.type==="page"&&/^https?:\/\/(127\.0\.0\.1|localhost):\d+\//.test(t.url)&&/^ws:\/\/(127\.0\.0\.1|localhost):\d+\//.test(t.webSocketDebuggerUrl));
}
function isLocalizableTarget(t){
 if(!t||typeof t.url!=="string"||!/^ws:\/\/(127\.0\.0\.1|localhost):\d+\//.test(t.webSocketDebuggerUrl||""))return false;
 if(!["page","iframe","webview","app"].includes(t.type))return false;
 if(/^(data:|devtools:|chrome-devtools:|about:blank)/.test(t.url))return false;
 return /^(https?:\/\/(127\.0\.0\.1|localhost):\d+\/|plugin:\/\/|vscode-webview:\/\/|vscode-file:\/\/|app:\/\/)/.test(t.url);
}
function parsePortFile(file){
 const lines=fs.readFileSync(file,"utf8").split(/\r?\n/);
 const port=Number(lines[0]);
 if(!Number.isInteger(port)||port<1||port>65535)return null;
 const browserPath=typeof lines[1]==="string"&&lines[1].startsWith("/")?lines[1].trim():"";
 return{port,browserWsUrl:browserPath?`ws://127.0.0.1:${port}${browserPath}`:null};
}
async function probePortTargets(port,includeSubTargets){
 const rawTargets=await getJson(port,"/json/list");
 const allTargets=Array.isArray(rawTargets)?rawTargets:[];
 const validTargets=allTargets.filter(includeSubTargets?isLocalizableTarget:isPrimaryHostPage);
 const primary=validTargets.find(isPrimaryHostPage)||validTargets[0]||null;
 return{validTargets,primary};
}
async function discover(options={}){
 const includeSubTargets=Boolean(options?.includeSubTargets);
 const portFiles=Array.isArray(options?.portFiles)?options.portFiles:getHostPortFiles();
 let fallbackBrowser=null;
 for(const file of portFiles)try{
  const meta=parsePortFile(file);
  if(!meta)continue;
  const {validTargets,primary}=await probePortTargets(meta.port,includeSubTargets);
  if(validTargets.length)return{port:meta.port,browserWsUrl:meta.browserWsUrl,target:primary,targets:validTargets};
  if(options?.browserFallback&&meta.browserWsUrl&&!fallbackBrowser)fallbackBrowser={port:meta.port,browserWsUrl:meta.browserWsUrl,target:null,targets:[]};
 }catch{}
 const explicitRaw=options?.explicitPort??process.env.CATSTELLA_HOST_CDP_PORT??process.env.AGY_CDP_PORT;
 const explicitPort=explicitRaw!==undefined&&explicitRaw!==null&&String(explicitRaw).trim()!==""?Number(explicitRaw):NaN;
 if(Number.isInteger(explicitPort)&&explicitPort>=1&&explicitPort<=65535){
  try{
   const {validTargets,primary}=await probePortTargets(explicitPort,includeSubTargets);
   if(validTargets.length)return{port:explicitPort,browserWsUrl:null,target:primary,targets:validTargets};
  }catch{}
 }
 return fallbackBrowser;
}
function watchHostPort(onChange){
 const watchers=[];
 const seen=new Set();
 for(const file of getHostPortFiles()){
  const dir=path.dirname(file);
  if(seen.has(dir))continue;
  seen.add(dir);
  try{
   if(!fs.existsSync(dir))continue;
   const watcher=fs.watch(dir,{persistent:false},(_eventType,filename)=>{
    if(!filename||String(filename)==="DevToolsActivePort")onChange();
   });
   watcher.on("error",()=>{});
   watchers.push(watcher);
  }catch{}
 }
 return{close(){for(const w of watchers)try{w.close();}catch{}}};
}
class Cdp{
 constructor(url,options={}){
  if(!/^ws:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url))throw new Error("仅允许本机宿主");
  const handshakeTimeout=Number.isFinite(options.handshakeTimeout)?Math.max(20,Math.min(10000,options.handshakeTimeout)):4000;
  this.socket=new WebSocket(url,{maxPayload:5*1024*1024,handshakeTimeout});this.pending=new Map();this.eventListeners=new Set();this.id=0;this.closed=false;
  this.ready=new Promise((resolve,reject)=>{this.socket.once("open",resolve);this.socket.once("error",reject);});
  this.socket.on("message",raw=>{
   try{
    const m=JSON.parse(raw);
    if(m.id!==undefined){
     const p=this.pending.get(m.id);
     if(p){this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}
    }else if(m.method){
     for(const fn of this.eventListeners)try{fn(m.method,m.params);}catch{}
    }
   }catch{}
  });
  this.socket.on("error",()=>{});this.socket.on("close",()=>{this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error("宿主已断开"));}this.pending.clear();this.eventListeners.clear();});
 }
 onEvent(fn){if(typeof fn==="function")this.eventListeners.add(fn);return()=>this.eventListeners.delete(fn);}
 async send(method,params={},timeout=7000){await this.ready;if(this.closed)throw new Error("宿主已断开");return new Promise((resolve,reject)=>{const id=++this.id,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error("宿主操作超时"));},timeout);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));});}
 async evaluate(expression,timeout=20000){const out=await this.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},timeout);if(out.exceptionDetails)throw new Error(out.exceptionDetails.exception?.description||out.exceptionDetails.text||"宿主执行失败");return out.result?.value;}
 close(){this.closed=true;this.socket.close();}
}

function getHostAppCandidates(platform=process.platform){
 if(platform==="darwin"){
  return [
   "/Applications/Antigravity.app",
   path.join(os.homedir(),"Applications/Antigravity.app")
  ];
 }
 if(platform==="win32"){
  return [
   path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),"AppData/Local"),"Programs/Antigravity/Antigravity.exe"),
   path.join(process.env["ProgramFiles"]||"C:/Program Files","Antigravity/Antigravity.exe"),
   path.join(process.env["ProgramFiles(x86)"]||"C:/Program Files (x86)","Antigravity/Antigravity.exe")
  ];
 }
 return [
  "/opt/Antigravity/antigravity",
  "/usr/bin/antigravity",
  "/usr/share/antigravity/antigravity",
  path.join(os.homedir(),".local/bin/antigravity")
 ];
}

function hasDebugArgs(argStr){
 if(typeof argStr!=="string"||!argStr.trim())return false;
 return /(?:^|\s)--remote-debugging-port=(?:0|[1-9]\d*)(?=\s|$)/.test(argStr);
}
function stripDebugArgs(argStr){
 if(typeof argStr!=="string"||!argStr.trim())return "";
 return argStr
  .replace(/(?:^|\s)--remote-debugging-(?:port|address)(?:=\S*)?(?=\s|$)/g," ")
  .replace(/\s+/g," ")
  .trim();
}
function mergeDebugArgs(argStr){
 const base=stripDebugArgs(argStr);
 const flags=HOST_DEBUG_FLAGS.join(" ");
 return base?`${base} ${flags}`:flags;
}

function getUserShortcutPaths(){
 const appData=process.env.APPDATA||path.join(os.homedir(),"AppData/Roaming");
 return [
  path.join(os.homedir(),"Desktop/Antigravity.lnk"),
  path.join(appData,"Microsoft/Windows/Start Menu/Programs/Antigravity.lnk")
 ];
}

function runPowerShellSync(script,extraEnv={}){
 const stdout=execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{
  encoding:"utf8",
  timeout:3000,
  windowsHide:true,
  env:{...process.env,...extraEnv}
 });
 return typeof stdout==="string"?stdout.trim():"";
}

async function runPowerShellAsync(script,extraEnv={}){
 const stdout=await execFileAsync("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{
  timeout:4000,
  windowsHide:true,
  env:{...process.env,...extraEnv}
 });
 return stdout.trim();
}

function isRegularFile(filePath,existsFn=p=>{try{return fs.statSync(p).isFile();}catch{return false;}}){
 return Boolean(typeof filePath==="string"&&filePath&&existsFn(filePath));
}

let cachedExtraInstallProbe={path:null,at:0};
function detectHostInstall(options={}){
 const platform=options?.platform||process.platform;
 const existsFn=typeof options?.existsSync==="function"
  ? p=>{try{return Boolean(options.existsSync(p));}catch{return false;}}
  : p=>{try{return fs.statSync(p).isFile();}catch{return false;}};
 const baseCandidates=Array.isArray(options?.candidates)?options.candidates:getHostAppCandidates(platform);
 const candidates=[...baseCandidates];
 if(platform==="win32"&&!Array.isArray(options?.candidates)){
  candidates.push("D:/Program Files/Antigravity/Antigravity.exe","E:/Program Files/Antigravity/Antigravity.exe");
 }
 const seen=new Set();
 for(const candidate of candidates){
  if(typeof candidate!=="string"||!candidate)continue;
  const key=platform==="win32"?candidate.toLowerCase():candidate;
  if(seen.has(key))continue;
  seen.add(key);
  if(isRegularFile(candidate,existsFn))return candidate;
 }
 if(platform!=="win32")return null;
 const now=Date.now();
 const allowCache=!options?.shortcutLookup&&!options?.registryLookup&&!options?.existsSync;
 if(allowCache&&now-cachedExtraInstallProbe.at<30000){
  if(cachedExtraInstallProbe.path&&isRegularFile(cachedExtraInstallProbe.path,existsFn))return cachedExtraInstallProbe.path;
  if(cachedExtraInstallProbe.path===null)return null;
 }
 let resolved=null;
 try{
  const shortcutTargets=typeof options?.shortcutLookup==="function"?options.shortcutLookup():(() => {
   const paths=getUserShortcutPaths().filter(p=>{try{return fs.existsSync(p);}catch{return false;}});
   if(!paths.length)return [];
   const b64=Buffer.from(JSON.stringify({items:paths}),"utf8").toString("base64");
   const out=runPowerShellSync(
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$obj=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:CATSTELLA_SHORTCUT_PATHS_B64))|ConvertFrom-Json;$ws=New-Object -ComObject WScript.Shell;$res=@();foreach($p in $obj.items){if($p -and (Test-Path -LiteralPath $p)){$res+=$ws.CreateShortcut($p).TargetPath}};ConvertTo-Json -InputObject @($res) -Compress",
    {CATSTELLA_SHORTCUT_PATHS_B64:b64}
   );
   if(!out)return [];
   const parsed=JSON.parse(out);
   return Array.isArray(parsed)?parsed:[parsed];
  })();
  for(const target of Array.isArray(shortcutTargets)?shortcutTargets:[]){
   if(typeof target==="string"&&path.basename(target).toLowerCase()==="antigravity.exe"&&isRegularFile(target,existsFn)){
    resolved=target;
    break;
   }
  }
 }catch{}
 if(!resolved){
  try{
   const regTargets=typeof options?.registryLookup==="function"?options.registryLookup():(() => {
    const out=runPowerShellSync(
     "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$ErrorActionPreference='SilentlyContinue';$keys=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');$res=@();foreach($it in (Get-ItemProperty $keys|Where-Object{$_.DisplayName -match 'Antigravity'})){if($it.InstallLocation){$res+=(Join-Path $it.InstallLocation 'Antigravity.exe')};if($it.DisplayIcon){$res+=(($it.DisplayIcon -replace ',\\d+$','').Trim('\"').Trim())}};ConvertTo-Json -InputObject @($res) -Compress"
    );
    if(!out)return [];
    const parsed=JSON.parse(out);
    return Array.isArray(parsed)?parsed:[parsed];
   })();
   for(const target of Array.isArray(regTargets)?regTargets:[]){
    if(typeof target==="string"&&path.basename(target).toLowerCase()==="antigravity.exe"&&isRegularFile(target,existsFn)){
     resolved=target;
     break;
    }
   }
  }catch{}
 }
 if(allowCache)cachedExtraInstallProbe={path:resolved,at:Date.now()};
 return resolved;
}

let cachedRunning={value:false,at:0};
async function isHostProcessRunning(options={}){
 if(typeof options?.checkProcess==="function"){
  try{return Boolean(await options.checkProcess());}catch{return false;}
 }
 const now=Date.now();
 if(!options?.bypassCache&&now-cachedRunning.at<2500)return cachedRunning.value;
 const platform=options?.platform||process.platform;
 let running=false;
 try{
  if(platform==="win32"){
   const stdout=await execFileAsync("tasklist",["/FI","IMAGENAME eq Antigravity.exe","/FO","CSV","/NH"],{timeout:2000,windowsHide:true});
   running=/"antigravity\.exe"/i.test(stdout);
  }else if(platform==="darwin"){
   await execFileAsync("pgrep",["-f","Antigravity\\.app/Contents/MacOS"],{timeout:2000});
   running=true;
  }else{
   await execFileAsync("pgrep",["-x","antigravity"],{timeout:2000});
   running=true;
  }
 }catch{
  running=false;
 }
 cachedRunning={value:running,at:Date.now()};
 return running;
}

async function inspectHostShortcuts(options={}){
 const platform=options?.platform||process.platform;
 if(platform!=="win32")return{supported:false,shortcuts:[],allConfigured:false};
 const exists=typeof options?.existsSync==="function"?options.existsSync:p=>{try{return fs.existsSync(p);}catch{return false;}};
 const paths=(Array.isArray(options?.paths)?options.paths:getUserShortcutPaths()).filter(p=>typeof p==="string"&&exists(p));
 if(!paths.length)return{supported:true,shortcuts:[],allConfigured:false};
 if(typeof options?.readShortcuts==="function"){
  const rows=await options.readShortcuts(paths);
  const shortcuts=(Array.isArray(rows)?rows:[])
   .filter(item=>item&&path.basename(String(item.target||"")).toLowerCase()==="antigravity.exe")
   .map(item=>{
    const args=String(item.arguments||"").trim();
    return{path:item.path,target:item.target,arguments:args,hasDebugFlag:hasDebugArgs(args)};
   });
  return{supported:true,shortcuts,allConfigured:shortcuts.length>0&&shortcuts.every(s=>s.hasDebugFlag)};
 }
 try{
  const b64=Buffer.from(JSON.stringify({items:paths}),"utf8").toString("base64");
  const out=await runPowerShellAsync(
   "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$obj=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:CATSTELLA_SHORTCUT_PATHS_B64))|ConvertFrom-Json;$ws=New-Object -ComObject WScript.Shell;$res=@();foreach($p in $obj.items){if($p -and (Test-Path -LiteralPath $p)){$sc=$ws.CreateShortcut($p);$res+=[PSCustomObject]@{path=$p;target=[string]$sc.TargetPath;arguments=[string]$sc.Arguments}}};ConvertTo-Json -InputObject @($res) -Compress",
   {CATSTELLA_SHORTCUT_PATHS_B64:b64}
  );
  const parsed=out?JSON.parse(out):[];
  const rows=Array.isArray(parsed)?parsed:(parsed?[parsed]:[]);
  const shortcuts=rows
   .filter(item=>item&&path.basename(String(item.target||"")).toLowerCase()==="antigravity.exe")
   .map(item=>{
    const args=String(item.arguments||"").trim();
    return{path:item.path,target:item.target,arguments:args,hasDebugFlag:hasDebugArgs(args)};
   });
  return{supported:true,shortcuts,allConfigured:shortcuts.length>0&&shortcuts.every(s=>s.hasDebugFlag)};
 }catch(error){
  return{supported:true,shortcuts:[],allConfigured:false,error:error.message};
 }
}

async function configureHostShortcuts(options={}){
 const enable=options?.enable!==false;
 const platform=options?.platform||process.platform;
 if(platform!=="win32"){
  return{ok:false,supported:false,reason:"unsupported-platform",updated:[],shortcuts:[],allConfigured:false};
 }
 const inspected=await inspectHostShortcuts(options);
 const tasks=[];
 if(enable){
  if(inspected.shortcuts.length>0){
   for(const sc of inspected.shortcuts){
    const nextArgs=mergeDebugArgs(sc.arguments);
    if(nextArgs!==sc.arguments||!sc.hasDebugFlag){
     tasks.push({path:sc.path,target:sc.target,arguments:nextArgs,create:false});
    }
   }
  }else{
   const exe=options?.installPath!==undefined?options.installPath:detectHostInstall(options);
   if(!exe){
    return{ok:false,supported:true,reason:"not-installed",updated:[],shortcuts:[],allConfigured:false};
   }
   const desktopLnk=(Array.isArray(options?.paths)&&options.paths[0])||getUserShortcutPaths()[0];
   tasks.push({path:desktopLnk,target:exe,arguments:HOST_DEBUG_FLAGS.join(" "),create:true});
  }
 }else{
  for(const sc of inspected.shortcuts){
   const nextArgs=stripDebugArgs(sc.arguments);
   if(nextArgs!==sc.arguments){
    tasks.push({path:sc.path,target:sc.target,arguments:nextArgs,create:false});
   }
  }
 }
 if(tasks.length){
  if(typeof options?.writeShortcuts==="function"){
   await options.writeShortcuts(tasks);
  }else{
   const b64=Buffer.from(JSON.stringify({items:tasks}),"utf8").toString("base64");
   await runPowerShellAsync(
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$obj=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:CATSTELLA_SHORTCUT_TASKS_B64))|ConvertFrom-Json;$ws=New-Object -ComObject WScript.Shell;foreach($t in $obj.items){$d=Split-Path -Parent $t.path;if($d -and -not (Test-Path -LiteralPath $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null};$sc=$ws.CreateShortcut($t.path);if($t.create -and $t.target){$sc.TargetPath=[string]$t.target;$sc.WorkingDirectory=Split-Path -Parent $t.target};$sc.Arguments=[string]$t.arguments;$sc.Save()}",
    {CATSTELLA_SHORTCUT_TASKS_B64:b64}
   );
  }
 }
 const after=await inspectHostShortcuts(options);
 return{
  ok:enable?after.allConfigured:after.shortcuts.every(s=>!s.hasDebugFlag),
  supported:true,
  updated:tasks.map(t=>t.path),
  shortcuts:after.shortcuts,
  allConfigured:after.allConfigured
 };
}

async function diagnoseHost(options={}){
 const discoverFn=options?.discover||discover;
 const runningFn=options?.isHostProcessRunning||isHostProcessRunning;
 const installFn=options?.detectHostInstall||detectHostInstall;
 const shortcutsFn=options?.inspectHostShortcuts||inspectHostShortcuts;
 const [found,running,shortcutsInfo]=await Promise.all([
  discoverFn(options).catch(()=>null),
  runningFn(options).catch(()=>false),
  shortcutsFn(options).catch(()=>({supported:false,shortcuts:[],allConfigured:false}))
 ]);
 const installPath=installFn(options);
 let state;
 if(found?.target)state="connected";
 else if(running)state="running-no-cdp";
 else if(installPath)state="not-running";
 else state="not-installed";
 return{
  state,
  connected:state==="connected",
  running:Boolean(running),
  cdpAvailable:state==="connected",
  port:found?.port||null,
  installPath:installPath||null,
  shortcutsSupported:Boolean(shortcutsInfo?.supported),
  shortcutsConfigured:Boolean(shortcutsInfo?.allConfigured),
  shortcuts:Array.isArray(shortcutsInfo?.shortcuts)?shortcutsInfo.shortcuts:[]
 };
}

async function launchHostWithDebug(options={}){
 const discoverFn=options?.discover||discover;
 const runningFn=options?.isHostProcessRunning||isHostProcessRunning;
 const installFn=options?.detectHostInstall||detectHostInstall;
 const spawnFn=options?.spawn||spawn;
 const [found,running]=await Promise.all([
  discoverFn(options).catch(()=>null),
  runningFn({bypassCache:true,...options}).catch(()=>false)
 ]);
 if(found?.target){
  return{ok:true,alreadyConnected:true,port:found.port||null,message:"Antigravity 已在调试模式运行并已连接"};
 }
 if(running){
  return{ok:false,reason:"already-running-no-cdp",message:"Antigravity 正在运行但未开启调试通道。请先保存并完全退出 Antigravity，再点击启动（或使用桌面快捷方式重新打开）。"};
 }
 const exe=options?.installPath!==undefined?options.installPath:installFn(options);
 if(!exe){
  return{ok:false,reason:"not-installed",message:"未检测到 Antigravity 安装路径"};
 }
 const child=spawnFn(exe,[...HOST_DEBUG_FLAGS],{detached:true,stdio:"ignore",windowsHide:false});
 child?.unref?.();
 return{ok:true,pid:child?.pid||null,exePath:exe,message:"已以兼容模式启动 Antigravity"};
}

module.exports={
 HOST_DEBUG_FLAGS,
 discover,
 Cdp,
 getHostAppCandidates,
 getHostPortFiles,
 watchHostPort,
 isLocalizableTarget,
 isPrimaryHostPage,
 hasDebugArgs,
 mergeDebugArgs,
 stripDebugArgs,
 getUserShortcutPaths,
 inspectHostShortcuts,
 configureHostShortcuts,
 detectHostInstall,
 isHostProcessRunning,
 diagnoseHost,
 launchHostWithDebug
};
