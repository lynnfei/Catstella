// 界面汉化控制器：极速感知宿主启动（fs.watch + 浏览器 Target 事件推流）+ Page.addScriptToEvaluateOnNewDocument 首帧前预注入 + 多窗口/plugin iframe 同步覆盖；关闭语言时完整 destroy 且移除预注入脚本，绝不残留。
const {discover,Cdp,watchHostPort,isHostProcessRunning}=require("../../../shared/host.cjs");
const {installLocalization}=require("../host/localize.cjs");

class LocalizationController{
 constructor(onStatus,options={}){
  this.owner=require("node:crypto").randomUUID();
  this.onStatus=typeof onStatus==="function"?onStatus:()=>{};
  this.hasCustomDiscover=typeof options.discover==="function";
  this.discover=options.discover||(opts=>discover({includeSubTargets:true,...opts}));
  this.isHostProcessRunning=typeof options.isHostProcessRunning==="function"
   ? options.isHostProcessRunning
   : (this.hasCustomDiscover?null:isHostProcessRunning);
  this.createClient=options.createClient||(url=>new Cdp(url));
  this.watchPort=options.watchPort||(this.hasCustomDiscover?null:watchHostPort);
  const rawDict=options.dict&&typeof options.dict==="object"?options.dict:{};
  this.dict=Object.fromEntries(Object.entries(rawDict).filter(([k])=>!k.startsWith("$")));
  this.settings={uiLanguage:"zh-CN"};
  this.status={applied:false,reason:null,message:"翻译层未启用"};
  this.signature=null;
  this.client=null;
  this.primaryUrl=null;
  this.browserClient=null;
  this.browserUrl=null;
  this.extraClients=new Map();
  this.docScriptIds=new WeakMap();
  this.stopping=false;
  this.started=false;
  this.timer=null;
  this.portWatcher=null;
  this.inflight=null;
  this.queued=false;
  this.fastUntil=0;
 }

 report(value){
  this.status={...this.status,...value};
  try{this.onStatus(this.status);}catch{}
 }

 update(settings){
  this.settings={...this.settings,...(settings||{})};
  return this.tick();
 }

 buildInstallExpression(){
  return"("+installLocalization.toString()+")("+JSON.stringify({owner:this.owner,dict:this.dict})+")";
 }

 async installPreloadScript(client,expr){
  if(!client||client.closed||typeof client.send!=="function")return;
  const prevId=this.docScriptIds.get(client);
  if(prevId){
   try{await client.send("Page.removeScriptToEvaluateOnNewDocument",{identifier:prevId},1500);}catch{}
   this.docScriptIds.delete(client);
  }
  try{
   await client.send("Page.enable",{},1500);
   const res=await client.send("Page.addScriptToEvaluateOnNewDocument",{source:expr},1500);
   if(res&&res.identifier)this.docScriptIds.set(client,res.identifier);
  }catch{}
 }

 async removePreloadScript(client){
  if(!client||client.closed||typeof client.send!=="function")return;
  const prevId=this.docScriptIds.get(client);
  if(prevId){
   try{await client.send("Page.removeScriptToEvaluateOnNewDocument",{identifier:prevId},1500);}catch{}
   this.docScriptIds.delete(client);
  }
 }

 async ensureBrowserWatcher(browserWsUrl){
  if(this.stopping||!browserWsUrl||this.hasCustomDiscover)return;
  if(this.browserClient&&!this.browserClient.closed&&this.browserUrl===browserWsUrl)return;
  if(this.browserClient){try{this.browserClient.close();}catch{}this.browserClient=null;this.browserUrl=null;}
  try{
   const client=this.createClient(browserWsUrl);
   if(typeof client.send!=="function"||typeof client.onEvent!=="function"){
    try{client.close();}catch{}
    return;
   }
   this.browserClient=client;
   this.browserUrl=browserWsUrl;
   client.onEvent((method,params)=>{
    if(this.stopping||this.settings.uiLanguage!=="zh-CN")return;
    if(method==="Target.targetCreated"||method==="Target.targetInfoChanged"||method==="Target.targetDestroyed"){
     const info=params?.targetInfo;
     if(!info||["page","iframe","webview","app"].includes(info.type)){
      this.fastUntil=Math.max(this.fastUntil,Date.now()+2000);
      this.scheduleNext(20);
     }
    }
   });
   await client.send("Target.setDiscoverTargets",{discover:true},2000).catch(()=>{});
  }catch{
   if(this.browserClient){try{this.browserClient.close();}catch{}this.browserClient=null;this.browserUrl=null;}
  }
 }

 start(){
  clearTimeout(this.timer);
  this.stopping=false;
  this.started=true;
  this.fastUntil=Date.now()+8000;
  if(this.watchPort&&!this.portWatcher){
   try{
    this.portWatcher=this.watchPort(()=>{
     if(this.stopping)return;
     this.fastUntil=Date.now()+6000;
     this.scheduleNext(30);
    });
   }catch{}
  }
  return this.tick();
 }

 scheduleNext(explicitDelay){
  clearTimeout(this.timer);
  if(this.stopping||!this.started)return;
  let delay=explicitDelay;
  if(delay===undefined){
   const waiting=!this.client||this.client.closed;
   if(Date.now()<this.fastUntil)delay=180;
   else if(waiting)delay=450;
   else delay=2000;
  }
  this.timer=setTimeout(()=>{void this.tick();},delay);
 }

 async destroyInHost(client){
  if(!client||client.closed)return;
  await this.removePreloadScript(client);
  await client.evaluate("window.__agyZhV1&&window.__agyZhV1.owner==="+JSON.stringify(this.owner)+"?window.__agyZhV1.destroy():null");
 }

 async syncSecondaryTargets(targets,signature,expr){
  if(!Array.isArray(targets)||targets.length<=1){
   for(const[url,entry]of this.extraClients.entries()){entry.client?.close();this.extraClients.delete(url);}
   return;
  }
  const activeUrls=new Set();
  for(const target of targets){
   const wsUrl=target?.webSocketDebuggerUrl;
   if(!wsUrl||wsUrl===this.primaryUrl)continue;
   activeUrls.add(wsUrl);
   let entry=this.extraClients.get(wsUrl);
   if(!entry||entry.client.closed){
    try{entry={client:this.createClient(wsUrl),signature:null};this.extraClients.set(wsUrl,entry);}catch{continue;}
   }
   try{
    const cur=await entry.client.evaluate("({ready:document.readyState,installed:!!window.__agyZhV1,owner:window.__agyZhV1&&window.__agyZhV1.owner})");
    if(this.stopping)return;
    if(cur.installed&&cur.owner!==this.owner)continue;
    if(!cur.installed||entry.signature!==signature){
     await this.installPreloadScript(entry.client,expr);
     await entry.client.evaluate(expr);
     entry.signature=signature;
    }
   }catch{
    entry.client?.close();this.extraClients.delete(wsUrl);
   }
  }
  for(const[url,entry]of this.extraClients.entries()){
   if(!activeUrls.has(url)){entry.client?.close();this.extraClients.delete(url);}
  }
 }

 async tick(){
  if(this.stopping)return;
  if(this.inflight){
   this.queued=true;
   return this.inflight;
  }
  this.inflight=(async()=>{
   do{
    this.queued=false;
    if(this.stopping)break;
    await this.runOnce();
   }while(this.queued&&!this.stopping);
  })();
  try{return await this.inflight;}
  finally{
   this.inflight=null;
   if(!this.stopping&&this.started)this.scheduleNext();
  }
 }

 async runOnce(){
  if(this.stopping)return;
  const enabled=this.settings.uiLanguage==="zh-CN";
  try{
   if(!enabled){
    if(this.browserClient){try{this.browserClient.close();}catch{}this.browserClient=null;this.browserUrl=null;}
    if(this.client){try{await this.destroyInHost(this.client);}catch{}this.client.close();this.client=null;this.primaryUrl=null;}
    for(const[url,entry]of this.extraClients.entries()){try{await this.destroyInHost(entry.client);}catch{}entry.client?.close();}
    this.extraClients.clear();
    if(this.signature!==null){this.signature=null;this.report({applied:false,reason:null,message:"翻译层未启用"});}
    return;
   }
   let foundTargets=null;
   if(!this.client||this.client.closed){
    const found=await this.discover({includeSubTargets:true,browserFallback:!this.hasCustomDiscover});
    if(found?.browserWsUrl)void this.ensureBrowserWatcher(found.browserWsUrl);
    if(!found||!found.target){
     const running=this.isHostProcessRunning?await this.isHostProcessRunning().catch(()=>false):false;
     const sig=running?"cdp-disabled":"waiting";
     if(this.signature!==sig){
      this.report(running
       ?{applied:false,reason:"cdp-disabled",message:"Antigravity 未开启本地调试通道，配置快捷方式并重启后自动注入汉化"}
       :{applied:false,reason:"host-offline",message:"等待 Antigravity 连接后注入翻译层"});
     }
     this.signature=sig;
     return;
    }
    this.primaryUrl=found.target.webSocketDebuggerUrl;
    this.client=this.createClient(this.primaryUrl);
    this.signature=null;
    foundTargets=found.targets;
   }
   const current=await this.client.evaluate("({ready:document.readyState,installed:!!window.__agyZhV1,owner:window.__agyZhV1&&window.__agyZhV1.owner})");
   if(current.installed&&current.owner!==this.owner){this.report({applied:false,reason:null,message:"翻译层由另一个运行实例管理"});return;}
   const signature=JSON.stringify([this.settings.uiLanguage,this.dict]);
   const expr=this.buildInstallExpression();
   if(!current.installed||signature!==this.signature){
    await this.installPreloadScript(this.client,expr);
    const result=await this.client.evaluate(expr);
    this.signature=signature;
    this.report({applied:true,reason:null,message:result&&result.applied?"汉化已注入 · 字典 "+Object.keys(this.dict).length+" 条":"宿主未就绪，稍后重试"});
   }
   if(!foundTargets){
    try{
     const probe=await this.discover({includeSubTargets:true});
     foundTargets=probe?.targets||null;
     if(probe?.browserWsUrl)void this.ensureBrowserWatcher(probe.browserWsUrl);
    }catch{}
   }
   if(foundTargets)await this.syncSecondaryTargets(foundTargets,signature,expr);
  }catch(error){
   if(this.client){try{this.client.close();}catch{}this.client=null;this.primaryUrl=null;}
   this.signature=null;
   this.report({applied:false,reason:"connect-error",message:"翻译层未接入："+error.message});
  }
 }

 async stop(){
  this.stopping=true;
  this.started=false;
  clearTimeout(this.timer);
  this.timer=null;
  if(this.portWatcher){try{this.portWatcher.close();}catch{}this.portWatcher=null;}
  if(this.browserClient){try{this.browserClient.close();}catch{}this.browserClient=null;this.browserUrl=null;}
  try{if(this.inflight)await this.inflight;}catch{}
  try{if(this.client&&!this.client.closed)await this.destroyInHost(this.client);}catch{}
  if(this.client){try{this.client.close();}catch{}this.client=null;this.primaryUrl=null;}
  for(const[url,entry]of this.extraClients.entries()){try{await this.destroyInHost(entry.client);}catch{}entry.client?.close();}
  this.extraClients.clear();
 }
}
module.exports={LocalizationController};
