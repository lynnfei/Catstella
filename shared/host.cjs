const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),http=require("node:http"),WebSocket=require("./vendor/ws");
function getJson(port,resource){return new Promise((resolve,reject)=>{const req=http.get({hostname:"127.0.0.1",port,path:resource,timeout:1800},res=>{let data="";res.on("data",b=>{data+=b;if(data.length>1048576)req.destroy();});res.on("end",()=>{try{resolve(JSON.parse(data));}catch{reject(new Error("宿主端点返回无效数据"));}});});req.on("timeout",()=>req.destroy(new Error("宿主响应超时")));req.on("error",reject);});}
function getHostPortFiles(){
 return[
  path.join(process.env.APPDATA||path.join(os.homedir(),"AppData/Roaming"),"Antigravity/DevToolsActivePort"),
  path.join(os.homedir(),"Library/Application Support/Antigravity/DevToolsActivePort"),
  path.join(os.homedir(),".config/Antigravity/DevToolsActivePort"),
  path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),".config"),"Antigravity/DevToolsActivePort")
 ];
}
function isPrimaryHostPage(t){
 return Boolean(t&&t.type==="page"&&/^https?:\/\/127\.0\.0\.1:\d+\//.test(t.url)&&/^ws:\/\/(127\.0\.0\.1|localhost):\d+\//.test(t.webSocketDebuggerUrl));
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
async function discover(options={}){
 const includeSubTargets=Boolean(options?.includeSubTargets);
 let fallbackBrowser=null;
 for(const file of getHostPortFiles())try{
  const meta=parsePortFile(file);
  if(!meta)continue;
  const rawTargets=await getJson(meta.port,"/json/list");
  const allTargets=Array.isArray(rawTargets)?rawTargets:[];
  const validTargets=allTargets.filter(includeSubTargets?isLocalizableTarget:isPrimaryHostPage);
  const primary=validTargets.find(isPrimaryHostPage)||validTargets[0];
  if(validTargets.length)return{port:meta.port,browserWsUrl:meta.browserWsUrl,target:primary,targets:validTargets};
  if(options?.browserFallback&&meta.browserWsUrl&&!fallbackBrowser)fallbackBrowser={port:meta.port,browserWsUrl:meta.browserWsUrl,target:null,targets:[]};
 }catch{}
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

function getHostAppCandidates(){
 if(process.platform==='darwin'){
  return [
   '/Applications/Antigravity.app',
   path.join(os.homedir(),'Applications/Antigravity.app')
  ];
 }
 if(process.platform==='win32'){
  return [
   path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local'),'Programs/Antigravity/Antigravity.exe'),
   path.join(process.env['ProgramFiles']||'C:/Program Files','Antigravity/Antigravity.exe'),
   path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Antigravity/Antigravity.exe')
  ];
 }
 return [
  '/opt/Antigravity/antigravity',
  '/usr/bin/antigravity',
  '/usr/share/antigravity/antigravity',
  path.join(os.homedir(),'.local/bin/antigravity')
 ];
}

module.exports={discover,Cdp,getHostAppCandidates,getHostPortFiles,watchHostPort,isLocalizableTarget,isPrimaryHostPage};
