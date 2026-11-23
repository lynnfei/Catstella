const {EventEmitter}=require('node:events'),{discover,Cdp,isHostProcessRunning}=require('../../../shared/host.cjs');
// 重置时间文案："Resets in 2 hours, 5 minutes." → "2小时5分钟后重置"；满额或无法解析时分别返回 满额/""。
// 注意：本函数与 readHostQuota/queryHostQuota/extractModelInfo 都会被 toString 注入宿主页面执行，必须完全自包含。
function parseResetTime(desc,remainingFraction){
 if(typeof remainingFraction==='number'&&remainingFraction>=1)return "满额";
 if(typeof desc!=='string')return "";
 const m=desc.match(/(?:resets?|refresh) in\s+([^.]+)/i);
 if(!m)return "";
 return m[1].replace(/hours?/g,'小时').replace(/minutes?/g,'分钟').replace(/days?/g,'天').replace(/,/g,'').replace(/\s+/g,'').trim()+"后重置";
}
// 从宿主模型选择器按钮读取当前模型与思考强度（纯 DOM 只读，不点击任何东西）。
function extractModelInfo(doc=document){
 if(typeof doc==='undefined'||!doc||typeof doc.querySelector!=='function')return null;
 const modelBtn=doc.querySelector('[data-testid="model-selector-trigger"]')||doc.querySelector('button[aria-label*="current:"],button[aria-label*="当前："]');
 if(!modelBtn)return null;
 const aria=modelBtn.getAttribute('aria-label')||'';
 const currentMatch=aria.match(/(?:current:|当前[：:])\s*(.+)$/i);
 const fullText=(currentMatch?currentMatch[1]:modelBtn.innerText).replace(/\n/g,' ').trim();
 if(!fullText)return null;
 const thinkingMatch=fullText.match(/\b(High|Medium|Low|Minimal|Max|None|Off|Extended|Auto)\b/i);
 const thinking=thinkingMatch?thinkingMatch[1]:null;
 const modelName=thinking?fullText.replace(new RegExp('\\b'+thinking+'\\b','i'),'').trim():fullText;
 return {modelName,thinking:thinking||"默认",fullText};
}
const emptyChannel=()=>({fiveHour:null,weekly:null,fiveHourReset:"",weeklyReset:""});
const clampPercent=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100?v:null;
const normalizeChannel=c=>({fiveHour:clampPercent(c?.fiveHour),weekly:clampPercent(c?.weekly),fiveHourReset:typeof c?.fiveHourReset==='string'?c.fiveHourReset:"",weeklyReset:typeof c?.weeklyReset==='string'?c.weeklyReset:""});
function isModelGroup(name){return typeof name==='string'&&(name.includes('Claude')||name.includes('GPT'));}
// 把一个模型组的双周期桶位折叠成 {fiveHour,weekly,fiveHourReset,weeklyReset}。
function collectChannel(group){
 const channel=emptyChannel();
 for(const b of group?.buckets||[]){
  const value=b.remaining?.case==='remainingFraction'?b.remaining.value:null;
  const valid=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1&&!b.disabled;
  const percent=valid?value*100:null;
  const reset=parseResetTime(b.description,valid?value:undefined);
  const id=typeof b.bucketId==='string'?b.bucketId:'';
  if(id.includes('5h')){channel.fiveHour=percent;channel.fiveHourReset=reset;}
  else if(id.includes('weekly')){channel.weekly=percent;channel.weeklyReset=reset;}
 }
 return channel;
}
// Read only quota fields from the native IDE cache or Desktop Models view cache.
function readHostQuota(){
 const empty=()=>({fiveHour:null,weekly:null,fiveHourReset:"",weeklyReset:""});
 const resetText=(desc,remainingFraction)=>{
  if(typeof remainingFraction==='number'&&remainingFraction>=1)return "满额";
  if(typeof desc!=='string')return "";
  const m=desc.match(/(?:resets?|refresh) in\s+([^.]+)/i);
  if(!m)return "";
  return m[1].replace(/hours?/g,'小时').replace(/minutes?/g,'分钟').replace(/days?/g,'天').replace(/,/g,'').replace(/\s+/g,'').trim()+"后重置";
 };
 const isModelGroup=name=>typeof name==='string'&&(name.includes('Claude')||name.includes('GPT'));
 const collect=group=>{
  const channel=empty();
  for(const b of group?.buckets||[]){
   const value=b.remaining?.case==='remainingFraction'?b.remaining.value:null;
   const valid=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1&&!b.disabled;
   const percent=valid?value*100:null;
   const reset=resetText(b.description,valid?value:undefined);
   const id=typeof b.bucketId==='string'?b.bucketId:'';
   if(id.includes('5h')){channel.fiveHour=percent;channel.fiveHourReset=reset;}
   else if(id.includes('weekly')){channel.weekly=percent;channel.weeklyReset=reset;}
  }
  return channel;
 };
 const result={...empty(),claudeGpt:empty(),argon:empty(),fetchedAt:null};
  let gemini=null,geminiFallback=null,claude=null,argon=null;
  const isArgonGroup=name=>typeof name==='string'&&name.toLowerCase().includes('argon');
  const isGeminiFallbackGroup=g=>typeof g?.displayName==='string'&&/gemini/i.test(g.displayName)&&!isArgonGroup(g.displayName)&&!isModelGroup(g.displayName)&&Array.isArray(g.buckets)&&g.buckets.length>0;
  const groups=typeof nY!=='undefined'&&Array.isArray(nY)?nY:typeof pY!=='undefined'&&Array.isArray(pY)?pY:[];
  for(const g of groups){
   if(!g)continue;
   if(isArgonGroup(g.displayName)&&!argon)argon=g;
   else if(g.displayName==='Gemini Models'&&!gemini)gemini=g;
   else if(isModelGroup(g.displayName)&&!claude)claude=g;
   else if(!geminiFallback&&isGeminiFallbackGroup(g))geminiFallback=g;
  }
  if(!gemini&&geminiFallback)gemini=geminiFallback;
 if(!gemini&&typeof document!=='undefined'){
  const seen=new Set();
  for(const el of document.querySelectorAll('[role=dialog] *')){
   let fiber=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];
   for(let i=0;fiber&&i<40;fiber=fiber.return,i++){
    if(seen.has(fiber))break;seen.add(fiber);
    for(let state=fiber.memoizedState,j=0;state&&j<80;state=state.next,j++){
     if(Array.isArray(state.memoizedState)){
      for(const g of state.memoizedState){
       if(!g)continue;
       if(isArgonGroup(g.displayName)&&!argon)argon=g;
       else if(g.displayName==='Gemini Models'&&!gemini)gemini=g;
       else if(isModelGroup(g.displayName)&&!claude)claude=g;
       else if(!geminiFallback&&isGeminiFallbackGroup(g))geminiFallback=g;
      }
     }
    }
   }
   if(gemini)break;
  }
  if(!gemini&&geminiFallback)gemini=geminiFallback;
 }
 if(!gemini&&!claude)return result;
 result.cacheAvailable=true;
 if(gemini)Object.assign(result,collect(gemini));
  if(claude)result.claudeGpt=collect(claude);
  if(argon)result.argon=collect(argon);
 const timestamp=typeof nY!=='undefined'&&Array.isArray(nY)&&typeof mFb==='number'?mFb:typeof jFb==='number'?jFb:null;
 if(typeof timestamp==='number'&&Number.isFinite(timestamp)&&timestamp>0&&timestamp<=Date.now()+60000)result.fetchedAt=timestamp;
 return result;
}
// Uses only the logged-in host's quota service; no credentials or conversation data leave the host.
async function queryHostQuota(readCache){
 const empty=()=>({fiveHour:null,weekly:null,fiveHourReset:"",weeklyReset:""});
 const resetText=(desc,remainingFraction)=>{
  if(typeof remainingFraction==='number'&&remainingFraction>=1)return "满额";
  if(typeof desc!=='string')return "";
  const m=desc.match(/(?:resets?|refresh) in\s+([^.]+)/i);
  if(!m)return "";
  return m[1].replace(/hours?/g,'小时').replace(/minutes?/g,'分钟').replace(/days?/g,'天').replace(/,/g,'').replace(/\s+/g,'').trim()+"后重置";
 };
 const isModelGroup=name=>typeof name==='string'&&(name.includes('Claude')||name.includes('GPT'));
 const collect=group=>{
  const channel=empty();
  for(const b of group?.buckets||[]){
   const value=b.remaining?.case==='remainingFraction'?b.remaining.value:null;
   const valid=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1&&!b.disabled;
   const percent=valid?value*100:null;
   const reset=resetText(b.description,valid?value:undefined);
   const id=typeof b.bucketId==='string'?b.bucketId:'';
   if(id.includes('5h')){channel.fiveHour=percent;channel.fiveHourReset=reset;}
   else if(id.includes('weekly')){channel.weekly=percent;channel.weeklyReset=reset;}
  }
  return channel;
 };
 const seen=new Set();
 if(typeof document!=='undefined')for(const el of document.querySelectorAll('body *')){
  let fiber=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];
  for(;fiber&&!seen.has(fiber);fiber=fiber.return){
   seen.add(fiber);
   const service=fiber.memoizedProps?.value?.core?.cloudCodeService;
   if(typeof service?.retrieveUserQuotaSummary!=='function')continue;
   const response=await service.retrieveUserQuotaSummary(undefined,false);
   const groups=response?.response?.groups||[];
   const isArgonGroup=name=>typeof name==='string'&&name.toLowerCase().includes('argon');
   const gemini=groups.find(g=>g?.displayName==='Gemini Models')||groups.find(g=>typeof g?.displayName==='string'&&/gemini/i.test(g.displayName)&&!isArgonGroup(g.displayName)&&!isModelGroup(g.displayName)&&Array.isArray(g.buckets)&&g.buckets.length>0);
   if(!gemini)throw Error('Gemini quota group unavailable');
   const result=collect(gemini);
   result.cacheAvailable=true;
   result.liveQuery=true;
   result.claudeGpt=empty();
   result.argon=empty();
   const claude=groups.find(g=>isModelGroup(g.displayName));
   if(claude)result.claudeGpt=collect(claude);
   const argon=groups.find(g=>isArgonGroup(g.displayName));
   if(argon)result.argon=collect(argon);
   return result;
  }
 }
 return readCache();
}
class HostQuotaAdapter extends EventEmitter{
 constructor(options={}){super();this.hasCustomDiscover=typeof options.discover==='function';this.discover=options.discover||discover;this.isHostProcessRunning=typeof options.isHostProcessRunning==='function'?options.isHostProcessRunning:(this.hasCustomDiscover?null:isHostProcessRunning);this.Client=options.Client||Cdp;this.now=options.now||Date.now;this.snapshot={fiveHour:null,weekly:null,fiveHourReset:"",weeklyReset:"",claudeGpt:emptyChannel(),argon:emptyChannel(),modelInfo:null,fetchedAt:null,online:false};this.active=false;this.failures=0;this.generation=0;this.setTimer=options.setTimer||setTimeout;this.clearTimer=options.clearTimer||clearTimeout;}
 start(){if(this.active)return;this.active=true;this.generation++;this.failures=0;this.tick();}
 async tick(){if(this.busy||!this.active)return;this.busy=true;this.clearTimer(this.timer);const generation=this.generation;let c,ready=false,confirmed=false;const current=()=>this.active&&generation===this.generation;
  try{const host=await this.discover();if(!current())return;if(!host){const running=this.isHostProcessRunning?await this.isHostProcessRunning().catch(()=>false):false;if(!current())return;this.snapshot={...this.snapshot,status:running?'cdp-disabled':'waiting-host'};throw new Error('offline');}if(this.hostIdentity&&this.hostIdentity!==host.target.webSocketDebuggerUrl){this.snapshot={fiveHour:null,weekly:null,fiveHourReset:"",weeklyReset:"",claudeGpt:emptyChannel(),argon:emptyChannel(),modelInfo:null,fetchedAt:null,online:false};this.sampleAt=null;}this.hostIdentity=host.target.webSocketDebuggerUrl;c=new this.Client(host.target.webSocketDebuggerUrl);this.client=c;this.snapshot={...this.snapshot,status:'querying'};// 模型/思考强度识别与额度查询共用同一次 evaluate（模型信息失败不影响额度解析，由 try 整体兜底）。
   const sample=await c.evaluate('(async()=>({modelInfo:('+extractModelInfo.toString()+')(),...(await ('+queryHostQuota.toString()+')('+readHostQuota.toString()+'))}))()');if(!current())return;
   if(!sample?.cacheAvailable){
    if(this.sampleAt!==null&&this.sampleAt!==undefined)this.snapshot={...this.snapshot,online:true,cached:true,stale:this.now()-this.sampleAt>=300000};
    else this.snapshot={fiveHour:null,weekly:null,fiveHourReset:"",weeklyReset:"",claudeGpt:normalizeChannel(this.snapshot.claudeGpt),argon:normalizeChannel(this.snapshot.argon),modelInfo:this.snapshot.modelInfo,fetchedAt:null,online:true};
    this.snapshot={...this.snapshot,status:'unsupported-or-initializing'};return;
   }
   ready=[sample.fiveHour,sample.weekly].some(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100);
   confirmed=ready&&sample.liveQuery===true;
   if(ready)this.sampleAt=this.now();
   if(current())this.snapshot={status:ready?'ready':'quota-unavailable',fiveHour:clampPercent(sample?.fiveHour),weekly:clampPercent(sample?.weekly),fiveHourReset:typeof sample?.fiveHourReset==='string'?sample.fiveHourReset:this.snapshot.fiveHourReset||"",weeklyReset:typeof sample?.weeklyReset==='string'?sample.weeklyReset:this.snapshot.weeklyReset||"",claudeGpt:sample?.claudeGpt?normalizeChannel(sample.claudeGpt):normalizeChannel(this.snapshot.claudeGpt),argon:sample?.argon?normalizeChannel(sample.argon):normalizeChannel(this.snapshot.argon),modelInfo:sample?.modelInfo&&typeof sample.modelInfo.modelName==='string'?sample.modelInfo:this.snapshot.modelInfo||null,cached:false,stale:false,observedAt:this.sampleAt,fetchedAt:typeof sample?.fetchedAt==='number'?sample.fetchedAt:null,online:true};
  }catch{if(current())this.snapshot={...this.snapshot,status:(this.snapshot.status==='waiting-host'||this.snapshot.status==='cdp-disabled')?this.snapshot.status:'query-failed',online:false,cached:true,stale:true};}
  finally{c?.close();this.client=null;this.busy=false;if(current()){this.failures=ready?0:Math.min(this.failures+1,5);this.emit('change',this.snapshot);if(current())this.timer=this.setTimer(()=>this.tick(),ready?30000:Math.min(30000,3000*2**(this.failures-1)));}else if(this.active)this.timer=this.setTimer(()=>this.tick(),0);}
  return current()&&confirmed;
 }
 async openNativeQuota(){return this.tick();}

 stop(){this.active=false;this.generation++;this.clearTimer(this.timer);this.client?.close();}
}
module.exports={HostQuotaAdapter,readHostQuota,queryHostQuota,parseResetTime,extractModelInfo};
