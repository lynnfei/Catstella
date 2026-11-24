(async()=>{
 const api=window.widgetApi,$=id=>document.getElementById(id),mascot=$("mascot"),motion=$("motion"),sleepShell=motion.parentElement;
 let snapshot,selected="quota",closed=true,temporary=null,timeout,pointer=null,gesture=0,currentSound=null,hit=null;
 let tapTimer=null,artRenderSequence=0,artReadyNotified=false;
 let personality,talkState,talkLine,talkFields=undefined,sideQuota=null,autoHide,hideAnimation,lastBubbleOpen=null,lastBubbleView,lastTalkMode=null;
 let modelTalkTimer,modelTalkKey,modelTalkTemplate;
 let patReflection,patReflectionTimer,lastTalkClick=-Infinity,tapChain=Promise.resolve();
 let alertState,alertTimer;
 let consecutiveClicks=0;
 function armBubble(){clearTimeout(autoHide);const focus=document.activeElement;if(!closed&&!(temporary&&temporary===ambientMessage)&&!($("bubble").contains(focus)&&focus.matches(":focus-visible")))autoHide=setTimeout(()=>{closed=true;consecutiveClicks=0;render();},6500);}
 const {formatLine}=window.CatstellaDialogue;
 const headPatDialogue=new window.CatstellaHeadPatDialogue();
 const formatTalk=(line,fields)=>formatLine(line,{mode:snapshot?.settings.userHonorificMode,name:snapshot?.settings.customHonorific},fields);
 function bubbleVisibility(open){const bubble=$("bubble");if(lastBubbleOpen===open)return;lastBubbleOpen=open;clearTimeout(hideAnimation);bubble.inert=!open;bubble.setAttribute("aria-hidden",String(!open));if(open){bubble.hidden=false;void bubble.offsetWidth;requestAnimationFrame(()=>{if(lastBubbleOpen)bubble.dataset.open="true";});}else{bubble.dataset.open="false";hideAnimation=setTimeout(()=>{if(!lastBubbleOpen)bubble.hidden=true;},snapshot?.settings.reducedMotion?0:180);}}
 const PetBehavior=window.CatstellaPetBehavior;
 sleepShell.style.setProperty("--agy-wake-duration",PetBehavior.wakeTime+"ms");
 const pet=new PetBehavior(({expression,rest,blink})=>{
  if(rest==="waking"&&mascot.dataset.rest!==rest){
   const offset=new DOMMatrixReadOnly(getComputedStyle(sleepShell).transform).m42;
   sleepShell.style.setProperty("--agy-nuzzle-start",offset+"px");
  }
  if(expression)mascot.dataset.expression=expression;
  else delete mascot.dataset.expression;
  mascot.dataset.rest=rest;
  mascot.dataset.blink=String(blink);
 });
 function syncPet(){
  if(!snapshot)return;
  const visible=!document.hidden&&snapshot.visibility?.visible!==false;
  const resting=visible&&["idle","offline","warning","error"].includes(snapshot.state);
  pet.sync({visible,idle:resting&&!pointer,rest:resting&&(!pointer||pet.rest==="sleeping")&&(closed||!snapshot.settings.bubbleOn),
   expressions:snapshot.settings.easterEggs});
 }
 function chooseTalk(express=false){
  talkState=snapshot.persistentState||snapshot.state;
  talkFields=undefined;talkLine=personality.say(talkState==="offline"?"idle":talkState);
  if(express)pet.show(personality.expressionFor(talkLine),"dialogue");
 }
 function syncAlertEffect(){
  const state=snapshot.state==="error"?"error":snapshot.persistentState||snapshot.state;
  if(state===alertState)return;
  alertState=state;
  clearTimeout(alertTimer);
  delete mascot.dataset.alertEffect;
  if(state!=="warning"&&state!=="error")return;
  mascot.dataset.alertEffect=state;
  alertTimer=setTimeout(()=>delete mascot.dataset.alertEffect,2400);
 }
 const modelToolLabels={run_command:"终端命令",read_file:"读文件",write_file:"写文件",edit_file:"改文件",search_web:"联网搜索",schedule:"定时任务",manage_task:"后台任务",manage_subagents:"子代理",invoke_subagent:"子代理",ask_question:"向你提问",list_plugin_accounts:"插件账号",search_marketplace:"插件市场"};
 const formatModelTools=tools=>{const labels=[...(Array.isArray(tools)?tools:[])].map(name=>modelToolLabels[name]||name).slice(0,3);return labels.join(" · ");};
 function modelTalk(){
  const activity=snapshot?.modelActivity||{};
  const {stepIndex,expiresAt}=activity;
  const kind=activity.waitingUser===true?"model-waiting":activity.kind;
  if(!Number.isSafeInteger(stepIndex)||expiresAt!==undefined&&expiresAt<=Date.now()||!snapshot.dialogue[kind]){
   modelTalkKey=null;
   return "";
  }
  const key=`${kind}:${stepIndex}:${expiresAt}`;
  if(key!==modelTalkKey){modelTalkKey=key;modelTalkTemplate=personality.say(kind);}
  return formatTalk(modelTalkTemplate,{step:stepIndex,tools:formatModelTools(activity.tools)||"任务"});
 }
 function scheduleModelTalk(){
  clearTimeout(modelTalkTimer);
  const delay=snapshot?.modelActivity?.expiresAt-Date.now();
  if(delay>0)modelTalkTimer=setTimeout(render,delay+5);
 }
 const hasWebData=()=>Boolean(snapshot?.webCompanion?.online||snapshot?.webCompanion?.quota);
 const getPages=()=>{
  const list=["quota"];
  if(hasWebData())list.push("webQuota");
/* @byok-dev-start */
  if(snapshot?.byok?.available)list.push("claudeGpt");
/* @byok-dev-end */
  list.push("talk","today","latest");
  return list;
 };
 const format=v=>typeof v==="number"?v.toLocaleString():"—";
 const tapSounds=new Map();
 function stopSound(){gesture++;if(currentSound){currentSound.pause();currentSound=null;}tapSounds.clear();}
 async function play(kind){
  if(!snapshot?.settings.sound||snapshot.settings.volume===0)return;
  const token=++gesture;
  if(!tapSounds.has(kind))tapSounds.set(kind,Promise.resolve(api.audio(kind)).then(payload=>{
   if(!payload)return null;
   const audio=new Audio(payload.url);audio.volume=payload.effectiveVolume;return audio;
  }).catch(()=>null));
  const audio=await tapSounds.get(kind);if(token!==gesture||!audio)return;
  currentSound?.pause();currentSound=audio;
  audio.currentTime=0;audio.play().catch(()=>{});
 }
 async function paintArtwork(pack,frames,artKey){
  if(mascot.dataset.characterPack===pack&&mascot.dataset.artKey===artKey)return;
  const sequence=++artRenderSequence;
  const packChanged=mascot.dataset.characterPack!==pack;
  if(mascot.dataset.artReady!=="true"||packChanged)mascot.dataset.artReady="false";
  mascot.dataset.characterPack=pack;mascot.dataset.artKey=artKey;
  const v="?v="+artKey.replace(/[^a-z0-9]/gi,"-");
  const base=pack==="lin-cat"?"../../assets/character-packs/lin-cat/frames/":"../../assets/character-packs/gemini-star-v1/frames/";
  const files={idle:"idle.png",blink:"blink.png",proud:pack==="lin-cat"?"proud.png":"proud-v3.png",sad:"sad.png",shy:"shy.png"};
  const idleEl=document.querySelector(".agy-frame--idle");
  const blinkEl=document.querySelector(".agy-frame--blink");
  const proudEl=document.querySelector(".agy-expression--proud");
  const shyEl=document.querySelector(".agy-expression--shy");
  const angryEl=document.querySelector(".agy-expression--angry");
  const source=frame=>(frames?.[frame]||frames?.idle||base+files[frame])+v;
  if(idleEl)idleEl.src=source("idle");
  if(blinkEl)blinkEl.src=source("blink");
  if(proudEl)proudEl.src=source("proud");
  if(shyEl)shyEl.src=source("shy");
  if(angryEl)angryEl.src=source("sad");
  const images=[idleEl,blinkEl,proudEl,shyEl,angryEl].filter(Boolean);
  await Promise.all(images.map(image=>image.decode?Promise.race([image.decode().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,2500))]):Promise.resolve()));
  if(sequence!==artRenderSequence)return;
  mascot.dataset.artReady="true";syncSideQuota();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(!artReadyNotified&&typeof api.ready==="function"){
   artReadyNotified=true;
   api.ready();
  }
 }
 function syncSideQuota(dragging=Boolean(pointer?.dragging)){
  if(!sideQuota||!snapshot)return;
  mascot.dataset.facing=snapshot.facing||"right";
  sideQuota.update({snapshot,mainBubbleVisible:!closed&&snapshot.settings.bubbleOn,dragging,artReady:mascot.dataset.artReady==="true"});
 }
 function render(){
  if(!snapshot)return;const s=snapshot.settings,l=snapshot.ledger,pages=getPages();
  if(!pages.includes(selected))selected="quota";
  syncPet();
  const bubbleView=temporary||selected;
  if(bubbleView!==lastBubbleView){lastBubbleView=bubbleView;$("bubble-body").scrollTop=0;}
  const frames=snapshot.characterPacks?.find(item=>item.id===s.characterPack)?.frames;
  const pack=frames?.idle?s.characterPack:s.characterPack==="lin-cat"?"lin-cat":"gemini-star-v1";
  // 帧图 URL 全部携带内容指纹版本号：资产更新即缓存失效，根治"偶尔变回老立绘"。
  const artKey=pack+":"+(snapshot.artVersion||"0");
  void paintArtwork(pack,frames,artKey);
  mascot.style.setProperty("--agy-width",(snapshot.displayScale||s.scale)+"px");mascot.style.setProperty("--agy-shift",(snapshot.artShift||0)+"px");mascot.style.setProperty("--agy-shift-y",(snapshot.artShiftY||0)+"px");
  const size=snapshot.displayScale||s.scale,top=innerHeight-size+(snapshot.artShiftY||0),above=top-70,below=innerHeight-top-size-64;
  mascot.dataset.bubbleBelow=String(below>above);
  mascot.style.setProperty("--agy-bubble-room",Math.max(80,Math.max(above,below))+"px");
  mascot.dataset.state=snapshot.state;mascot.dataset.dock=snapshot.dockSide||"";mascot.dataset.facing=snapshot.facing||"left";mascot.dataset.reducedMotion=String(s.reducedMotion);
  syncAlertEffect();
  mascot.style.setProperty("--bubble-tint",/^#[0-9a-f]{6}$/i.test(s.bubbleTint||"")&&s.bubbleTint.toLowerCase()!=="#eee6ff"?s.bubbleTint:"");mascot.style.setProperty("--bubble-alpha",typeof s.bubbleOpacity==="number"&&s.bubbleOpacity!==98?String(Math.min(100,Math.max(30,s.bubbleOpacity))/100):"");
  bubbleVisibility(!closed&&s.bubbleOn);syncSideQuota();for(const id of ["quota","web-quota-panel","byok-panel","value","detail","meta"])if($(id))$(id).hidden=true;$("page").textContent=(pages.indexOf(selected)+1)+" / "+pages.length;
  $("value").classList.toggle("agy-phrase",temporary?temporary.kind==="talk":selected==="talk");
  if(temporary){$("title").textContent=temporary.title;$("value").hidden=false;$("value").textContent=temporary.kind==="talk"?formatTalk(temporary.body):temporary.body;$("detail").hidden=!temporary.detail;$("detail").textContent=temporary.detail||"";$("meta").hidden=!temporary.meta;$("meta").textContent=temporary.meta||"";return;}
  if(selected==="quota"){
   $("quota").hidden=false;
   $("title").textContent="Gemini Models";
   const q=snapshot.quotaWindows;
   const tag=$("model-tag");
   if(tag){
    if(q?.modelInfo){
     tag.hidden=false;
     if(!tag.firstElementChild){
      const left=document.createElement("span");
      left.className="model-tag-left";
      const orch=document.createElement("span");
      orch.className="orch-inline-badge";
      orch.title="编排器模式 (Orchestrator)";
      orch.setAttribute("aria-label","编排器模式");
      orch.hidden=true;
      orch.innerHTML='<svg viewBox="-10.5 -10.5 21 21" width="14" height="14" aria-hidden="true"><defs><linearGradient id="pet-tag-orch-g" x1="-5" y1="-6" x2="5" y2="6" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#5cf2b4"/><stop offset="52%" stop-color="#84ecff"/><stop offset="100%" stop-color="#e5fff6"/></linearGradient></defs><circle cx="0" cy="0" r="8.4" fill="#1b1433" stroke="#d8b263" stroke-width="1.25"/><circle cx="0" cy="-8.4" r="1.1" fill="#f7e29c"/><circle cx="0" cy="8.4" r="1.1" fill="#f7e29c"/><circle cx="-8.4" cy="0" r="1.1" fill="#f7e29c"/><circle cx="8.4" cy="0" r="1.1" fill="#f7e29c"/><circle cx="0" cy="0" r="6.2" fill="#120d26" stroke="rgba(116,245,204,0.42)" stroke-width="0.65"/><path d="M-4.35 -4.9 L4.35 -4.9 L1.25 0 L4.35 4.9 L-4.35 4.9 L-1.25 0 Z" fill="url(#pet-tag-orch-g)" stroke="#0f2f2b" stroke-width="0.55" stroke-linejoin="round"/><path d="M0 -1.35 L0.95 0 L0 1.35 L-0.95 0 Z" fill="#f5fffb" opacity="0.88"/></svg>';
      const model=document.createElement("span");
      model.className="model-tag-name";
      left.append(orch,model);
      const thinking=document.createElement("span");
      thinking.className="thinking-badge";
      tag.replaceChildren(left,thinking);
     }
     const rawModel=q.modelInfo.modelName||"";
     const isOrch=Boolean(q.modelInfo.orchestrator||/^orchestrator(?:\s+|$)/i.test(rawModel)||/^orchestrator(?:\s+|$)/i.test(q.modelInfo.fullText||""));
     const stripped=isOrch?rawModel.replace(/^Orchestrator\s*/i,"").replace(/^\(([^()]+)\)$/,"$1").trim():rawModel;
     const model=stripped||rawModel;
     const thinking="思考: "+q.modelInfo.thinking;
     const orchEl=tag.firstElementChild?.firstElementChild;
     const nameEl=tag.firstElementChild?.lastElementChild;
     tag.dataset.orchestrator=String(isOrch);
     tag.title=isOrch?`编排器模式 · ${model} · ${thinking}`:`${model} · ${thinking}`;
     if(orchEl)orchEl.hidden=!isOrch;
     if(nameEl&&nameEl.textContent!==model)nameEl.textContent=model;
     if(tag.lastElementChild.textContent!==thinking)tag.lastElementChild.textContent=thinking;
    }else{
     tag.hidden=true;
    }
   }
   const gData=q?.gemini||q;
   const isArgon=Boolean(q?.modelInfo?.modelName?.toLowerCase().includes("argon"));
   const hasArgonQuota=typeof q?.argon?.weekly==="number";
   const fiveVal=s.manualQuota?s.manualPercent:gData?.fiveHour;
   const weekVal=s.manualQuota?s.manualWeeklyPercent:(isArgon&&hasArgonQuota?q.argon.weekly:gData?.weekly);
   const fiveReset=s.manualQuota?"":gData?.fiveHourReset||"";
   const weekReset=s.manualQuota?"":(isArgon&&hasArgonQuota?(q.argon.weeklyReset||""):gData?.weeklyReset||"");
   if($("label-5h"))$("label-5h").textContent=isArgon?"5 小时 (共享)":"5 小时";
   if($("label-week"))$("label-week").textContent=isArgon?"1 周 (Argon WTU)":"1 周";

   for(const [suffix,value,resetStr] of [["",fiveVal,fiveReset],["-week",weekVal,weekReset]]){
    const known=typeof value==="number";
    $("percent"+suffix).textContent=known?Math.round(value)+"%":"—";
    $("fill"+suffix).style.width=known?value+"%":"100%";
    $("track"+suffix).dataset.known=String(known);
    $("track"+suffix).dataset.level=!known?"unknown":value<=10?"critical":value<=30?"low":"normal";
    $("percent"+suffix).dataset.level=$("track"+suffix).dataset.level;
    if(known)$("track"+suffix).setAttribute("aria-valuenow",value);else $("track"+suffix).removeAttribute("aria-valuenow");
    const rEl=$(suffix===""?"reset-5h":"reset-week");
    if(rEl)rEl.textContent=resetStr;
   }
   const wc=snapshot.webCompanion;
   const webBrief=wc?.quota?(typeof wc.quota.fiveHourUsedPct==="number"?(" · Web 5h 剩余 "+Math.max(0,100-wc.quota.fiveHourUsedPct)+"%"):(wc.quota.dailyTotal?(" · Web 今日 "+wc.quota.dailyTotal+" 次"):"")):"";
   let extraHint="";if(isArgon&&typeof gData?.weekly==="number"){extraHint=" · 通用周额度余 "+Math.round(gData.weekly)+"%";}else if(!isArgon&&hasArgonQuota){extraHint=" · 🪐 Argon 余 "+Math.round(q.argon.weekly)+"%";}
   const mainCaption=s.manualQuota?"手动记录":q?.status==="cdp-disabled"?"未开启 AGY 调试通道 · 请在设置配置后重启 AGY":q?.stale?"上次读取 · 待更新":q?.cached?"上次读取":"";
   $("caption").textContent=mainCaption+extraHint+webBrief;
   $("meta").textContent="";
  }else if(selected==="webQuota"){
   const wc=snapshot.webCompanion||{},wq=wc.quota||{};
   $("web-quota-panel").hidden=false;
   $("title").textContent="Gemini Web · 伴侣";
   $("web-status-text").textContent=wc.online?(wc.active?"🟢 网页活跃同步中":"🟢 浏览器已联动"):"⚪ 缓存快照（离线）";
   $("web-model-badge").textContent=wq.displaySource==="official"?"官方账本":(wq.lastModel||"Web");
   if(typeof wq.fiveHourUsedPct==="number"){
    if($("web-5h-label"))$("web-5h-label").textContent="剩余额度 (5h)";
    $("web-5h-count").textContent="剩余 "+Math.max(0,100-wq.fiveHourUsedPct)+"%";
   }else{
    if($("web-5h-label"))$("web-5h-label").textContent="近 5h 调用";
    $("web-5h-count").textContent=(wq.window5hTotal??0)+" 次";
   }
   if(typeof wq.weeklyUsedPct==="number"){
    if($("web-daily-label"))$("web-daily-label").textContent="每周剩余 (1w)";
    $("web-daily-count").textContent="剩余 "+Math.max(0,100-wq.weeklyUsedPct)+"%";
   }else if(wq.dailyTotal){
    if($("web-daily-label"))$("web-daily-label").textContent="今日累计对话";
    $("web-daily-count").textContent=(wq.dailyTotal??0)+" / "+(wq.dailyBudget||150)+" 次";
   }else{
    if($("web-daily-label"))$("web-daily-label").textContent="每周限额 (1w)";
    $("web-daily-count").textContent="待同步";
   }
   if(wq.sessionTurns||wq.sessionTokensEst){
    if($("web-split-label"))$("web-split-label").textContent="当前会话负载";
    $("web-model-split").textContent="第 "+(wq.sessionTurns||0)+" 轮 · ~"+((wq.sessionTokensEst||0)/1000).toFixed(1)+"k";
   }else{
    if($("web-split-label"))$("web-split-label").textContent="当前会话负载";
    $("web-model-split").textContent=wq.flashCount||wq.thinkingCount||wq.proCount?((wq.flashCount||0)+" / "+(wq.thinkingCount||0)+" / "+(wq.proCount||0)):"第 0 轮";
   }
   $("meta").hidden=false;$("meta").textContent=wq.resetHint?("重置时间: "+wq.resetHint):(wc.online?"与浏览器扩展实时联动中":"打开 Gemini 网页即可自动同步");
/* @byok-dev-start */
  }else if(selected==="claudeGpt"){
   const b=snapshot.byok||{},ap=b.activeProvider,choices=Array.isArray(b.enabledModelChoices)?b.enabledModelChoices:[];
   const statusMap={online:"🟢 联通正常",warning:"🟡 待测速",error:"🔴 连接异常",disabled:"⚪ 未启用"};
   $("byok-panel").hidden=false;
   $("title").textContent=ap?.name?("BYOK · "+ap.name):"BYOK 模型网关";
   $("byok-status-text").textContent=ap?(statusMap[ap.status]||"🟡 待测速"):"⚪ 未配置供应商";
   $("byok-model-badge").textContent=ap?.activeModel||"未选模型";
   $("byok-model-badge").title="点击打开模型网关设置";
   const canCycle=choices.length>1;
   if($("byok-model-prev"))$("byok-model-prev").hidden=!canCycle;
   if($("byok-model-next"))$("byok-model-next").hidden=!canCycle;
   const balText=ap?.balance?.formatted||"";
   if($("byok-balance-row"))$("byok-balance-row").hidden=!balText;
   if($("byok-balance-badge")&&balText)$("byok-balance-badge").textContent=balText;
   $("byok-ping").textContent=typeof ap?.pingMs==="number"?("⚡ "+ap.pingMs+" ms"):(ap?.enabled?"点此测速":"未启用");
   $("byok-requests").textContent=(typeof b.todayRequests==="number"?b.todayRequests:0)+" 次";
   $("meta").hidden=false;$("meta").textContent=(b.gatewayOnline?("网关 127.0.0.1:"+b.port):"网关离线")+" · 点卡片测速查余";
/* @byok-dev-end */
  }else if(selected==="today"){
   $("title").textContent="今日用量 · 本机";$("value").hidden=false;$("value").textContent=format(l.todayTokens.total);$("detail").hidden=false;
   $("detail").textContent="输入 "+format(l.todayTokens.prompt)+" · 缓存 "+format(l.todayTokens.cache)+" · 输出 "+format(l.todayTokens.output);
   $("meta").hidden=false;$("meta").textContent=l.todaySteps+" 个模型步骤 · "+(l.partial?"部分字段缺失":snapshot.source.coverage||"只读日志");
  }else if(selected==="latest"){
   const r=l.latest;$("title").textContent="最近模型步骤";$("value").hidden=false;$("value").textContent=format(r?.tokens.total);$("detail").hidden=false;$("detail").textContent=r?"输入 "+format(r.tokens.input)+" · 输出 "+format(r.tokens.output):"尚无数值记录";
   $("meta").hidden=false;$("meta").textContent=r?"本机记录 · 费用 —（无价格来源）":"等待真实会话记录";
  }else{$("title").textContent="喵言喵语";$("value").hidden=false;$("value").classList.add("agy-phrase");const nextTalkState=snapshot.persistentState||snapshot.state;if(!talkLine){chooseTalk();}else if(talkState!==nextTalkState){talkState=nextTalkState;if(closed)chooseTalk();}const statusLine=modelTalk();const patLine=!statusLine&&patReflection?.line;const talkMode=statusLine?"model":(patLine?"pat":"idle");if(!closed&&lastTalkMode==="model"&&talkMode!=="model"&&!temporary)armBubble();lastTalkMode=talkMode;$("value").textContent=statusLine||formatTalk(patLine||talkLine,patLine?patReflection.fields:talkFields);$("meta").hidden=false;$("meta").textContent=statusLine?"本机 Antigravity 日志":"点点本喵，再聊一句";}
  if(selected!=="talk"){lastTalkMode=null;$("value").classList.remove("agy-phrase");}
 }
 function message(title,body,detail="",ms=4500,meta="",kind="notice"){clearAmbient();clearTimeout(timeout);if(ms>0)clearTimeout(autoHide);temporary={title,body,detail,meta,kind};closed=false;render();if(ms>0)timeout=setTimeout(()=>{temporary=null;if(!closed)armBubble();render();},ms);}
 function rememberBubble(patch){
  if(Object.entries(patch).every(([key,value])=>snapshot.settings[key]===value))return;
  Object.assign(snapshot.settings,patch);
  if(api.rememberBubble)api.rememberBubble(patch);else void api.save(patch);
 }
 function select(delta){const pages=getPages();clearTimeout(patReflectionTimer);patReflection=null;talkFields=undefined;armBubble();clearTimeout(timeout);temporary=null;closed=false;selected=pages[(pages.indexOf(selected)+delta+pages.length)%pages.length];if(selected==="talk")chooseTalk(true);rememberBubble({bubblePage:selected});render();}
 $("prev").onclick=()=>select(-1);$("next").onclick=()=>select(1);$("close").onclick=()=>{clearTimeout(autoHide);closed=true;consecutiveClicks=0;render();};$("toggle").onclick=()=>{closed=!closed;if(!snapshot.settings.bubbleOn)rememberBubble({bubbleOn:true});armBubble();render();};$("settings").onclick=()=>api.command("settings");
/* @byok-dev-start */
 if($("byok-panel"))$("byok-panel").onclick=()=>api.command("byok-ping-active");
 if($("byok-model-prev"))$("byok-model-prev").onclick=e=>{e.stopPropagation();armBubble();api.command("byok-cycle-prev");};
 if($("byok-model-next"))$("byok-model-next").onclick=e=>{e.stopPropagation();armBubble();api.command("byok-cycle-next");};
 if($("byok-model-badge"))$("byok-model-badge").onclick=e=>{e.stopPropagation();api.command("byok-open-settings");};
/* @byok-dev-end */
 if($("web-quota-panel"))$("web-quota-panel").onclick=()=>select(1);
 window.addEventListener("contextmenu",e=>{e.preventDefault();api.command("menu");});
 $("bubble").addEventListener("pointerenter",()=>{clearTimeout(autoHide);if(temporary&&temporary===ambientMessage)clearTimeout(ambientTimer);});$("bubble").addEventListener("pointerleave",()=>{if(temporary&&temporary===ambientMessage){clearTimeout(ambientTimer);ambientTimer=setTimeout(clearAmbient,2200);}else armBubble();});
 $("bubble").addEventListener("focusin",event=>{if(event.target.matches(":focus-visible"))clearTimeout(autoHide);});
 $("bubble").addEventListener("focusout",event=>{if(!$("bubble").contains(event.relatedTarget))queueMicrotask(armBubble);});
 function hitsHead(event){
  const area=sleepShell.getBoundingClientRect();
  const x=event.clientX-area.left,y=event.clientY-area.top;
  return x>=area.width*.07&&x<=area.width*.93&&y>=area.height*.035&&y<=area.height*.80;
 }
 function canOfferHeadPat(){
  return Boolean(snapshot&&!closed&&snapshot.settings.bubbleOn&&selected==="talk"&&!temporary&&!document.hidden&&
   !modelTalk()&&["idle","offline"].includes(snapshot.persistentState||snapshot.state));
 }
 function applyPatOffer(offer){
  if(!offer||!snapshot?.dialogue[offer.category]?.length)return false;
  const line=personality.say(offer.category);
  talkState=snapshot.persistentState||snapshot.state;
  talkLine=line;
  talkFields=offer.fields;
  patReflection={line,fields:offer.fields};
  clearTimeout(patReflectionTimer);
  patReflectionTimer=setTimeout(()=>{
   // Unlock head tapping while keeping the already-shown line on screen until next click or auto-hide.
   patReflection=null;
  },5500);
  return true;
 }
 function animatePress(pressed){motion.dataset.pressed=String(pressed);}
 const pointerDistance=event=>Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y);
 function cancelPointerPress(){
  clearTimeout(tapTimer);
  tapTimer=null;
  if(!pointer?.pressActive)return;
  pointer.pressActive=false;
  animatePress(false);
  api.pointer("cancel");
 }
 function willLandOnTalk(){
  if(closed)return false;
  const action=snapshot?.settings?.clickCatAction||"talk";
  if(action==="cyclePages"){
   const pages=getPages();
   return pages[(pages.indexOf(selected)+1)%pages.length]==="talk";
  }
  const nextClicks=consecutiveClicks+1;
  if(nextClicks===2&&hasWebData())return false;
  if((nextClicks===2||nextClicks===3)&&snapshot?.byok?.available&&selected!=="claudeGpt"&&selected!=="talk")return false;
  return true;
 }
 function activate(head=false,patCounts=null){
  const action = snapshot?.settings?.clickCatAction || "talk";
  if (action === "cyclePages") {
    if (closed) {
      closed = false;
      armBubble();
      render();
    } else {
      const pages=getPages();
      const target=pages[(pages.indexOf(selected)+1)%pages.length];
      if(target==="talk"){
       selected="talk";
       if(head&&patCounts){
        const offer=headPatDialogue.next(patCounts,canOfferHeadPat());
        if(!applyPatOffer(offer))chooseTalk(true);
       }else chooseTalk(true);
       rememberBubble({bubblePage:"talk"});armBubble();clearTimeout(timeout);temporary=null;closed=false;render();
       return;
      }
      select(1);
    }
    return;
  }

  if (closed) {
    consecutiveClicks = 1;
    closed = false;
    armBubble();
    selected = "quota";
    rememberBubble({ bubblePage: "quota", bubbleOn: true });
    render();
    return;
  }

  consecutiveClicks++;
  armBubble();

  if (consecutiveClicks === 2 && hasWebData()) {
    selected = "webQuota";
    rememberBubble({ bubblePage: "webQuota", bubbleOn: true });
    render();
/* @byok-dev-start */
  } else if ((consecutiveClicks === 2 || consecutiveClicks === 3) && snapshot?.byok?.available && selected !== "claudeGpt" && selected !== "talk") {
    selected = "claudeGpt";
    rememberBubble({ bubblePage: "claudeGpt", bubbleOn: true });
    render();
/* @byok-dev-end */
  } else {
    const alreadyTalk=selected==="talk";
    if(head&&alreadyTalk&&patReflection){
     if(patCounts)headPatDialogue.next(patCounts,false);
     return;
    }
    const throttled=head&&alreadyTalk&&performance.now()-lastTalkClick<180;
    selected = "talk";
    const offer=head&&patCounts?headPatDialogue.next(patCounts,canOfferHeadPat()):null;
    if(applyPatOffer(offer)){
     rememberBubble({ bubblePage: "talk", bubbleOn: true });
     render();
     return;
    }
    if(throttled)return;
    if(head)lastTalkClick=performance.now();
    chooseTalk(true);
    rememberBubble({ bubblePage: "talk", bubbleOn: true });
    render();
  }
 }
 motion.addEventListener("pointerdown",event=>{
  if(event.button!==0||!event.isPrimary||pointer)return;
  const head=hitsHead(event);
  const sleeping=pet.rest==="sleeping";
  pointer={id:event.pointerId,startedAt:performance.now(),sleeping,head,x:event.clientX,y:event.clientY,
   screenX:event.screenX,screenY:event.screenY,distance:0,pressActive:!sleeping,dragging:false};
  pet.activity();
  motion.setPointerCapture(event.pointerId);
  if(!sleeping){
   animatePress(true);
   api.pointer("down");
   clearTimeout(tapTimer);
   tapTimer=setTimeout(cancelPointerPress,PetBehavior.tapLimit);
  }
  syncPet();
  if(!sleeping)play("press");
 });
 motion.addEventListener("pointerenter",()=>pet.activity());
 motion.addEventListener("pointermove",event=>{
  if(pointer?.id!==event.pointerId)return;
  pointer.distance=Math.max(pointer.distance,pointerDistance(event));
  if(pointer.distance>PetBehavior.tapSlop||pointer.dragging){
   cancelPointerPress();
   if(!pointer.dragging){pointer.dragging=true;api.drag?.("start");syncSideQuota(true);}
   api.drag?.("move",event.screenX-pointer.screenX,event.screenY-pointer.screenY);
  }
 });
 function release(cancel=false,event){
  if(!pointer||(event&&event.pointerId!==pointer.id))return;
  clearTimeout(tapTimer);tapTimer=null;
  const {sleeping,head,startedAt,dragging}=pointer;
  const distance=event?Math.max(pointer.distance,pointerDistance(event)):pointer.distance;
  const isTap=!cancel&&!dragging&&PetBehavior.isTap(performance.now()-startedAt,distance);
  if(dragging){api.drag?.(cancel?"cancel":"end",event?event.screenX-pointer.screenX:0,event?event.screenY-pointer.screenY:0);syncSideQuota(false);}
  pointer=null;
  animatePress(false);
  if(!sleeping)api.pointer(isTap?"up":"cancel");
  if(isTap)play("release");
  syncPet();
  if(isTap){
   if(pet.activity(true)||sleeping||pet.rest!=="awake")return;
   if(!head){activate(false);return;}
   if(pet.tap()==="proud")api.pointer("pet");
   if(!willLandOnTalk()){
    activate(true);
    tapChain=tapChain.then(async()=>{
     const counts=await api.pointer("head-pat").catch(()=>null);
     if(counts)headPatDialogue.next(counts,false);
    });
   }else{
    tapChain=tapChain.then(async()=>{
     const counts=await api.pointer("head-pat").catch(()=>null);
     activate(true,counts);
    });
   }
  }
 }
 motion.addEventListener("pointerup",event=>release(false,event));
 motion.addEventListener("pointercancel",event=>release(true,event));
 motion.addEventListener("lostpointercapture",event=>release(true,event));
 window.addEventListener("blur",()=>release(true));
 motion.addEventListener("keydown",event=>{
  if(event.key!==" "&&event.key!=="Enter")return;
  event.preventDefault();
  if(event.repeat)return;
  if(!pet.activity(true)&&pet.rest==="awake")activate();
 });
 window.addEventListener("mousemove",e=>{const active=!!e.target.closest(".interactive");if(hit!==active){hit=active;api.hit(active);}});
 window.addEventListener("mouseleave",()=>{hit=false;api.hit(false);});
 if(api.onMouseLeft)api.onMouseLeft(()=>{hit=false;api.hit(false);sideQuota?.handleExternalLeave?.();});
 if(api.onMouseEntered)api.onMouseEntered(coords=>{
  if(!coords||!Number.isFinite(coords.x)||!Number.isFinite(coords.y))return;
  const el=document.elementFromPoint(coords.x,coords.y);
  const active=!!el?.closest(".interactive");
  if(hit!==active){hit=active;api.hit(active);}
  sideQuota?.handleExternalHoverCheck?.(coords.x,coords.y);
 });

  function reloadImages(){
    const ts=Date.now();
    for(const img of document.querySelectorAll(".agy-frame, .agy-expression")){
      if(img.src){
        try{
          const u=new URL(img.src, window.location.href);
          u.searchParams.set("t", ts);
          img.src=u.href;
        }catch{}
      }
    }
  }
  if(api.onRefresh)api.onRefresh(()=>{
    reloadImages();
    render();
  });
  if(api.onForceRepaint)api.onForceRepaint(()=>{
    const idleImg=document.querySelector(".agy-frame--idle");
    if(idleImg&&(!idleImg.complete||idleImg.naturalWidth===0))reloadImages();
    mascot.dataset.artReady="true";
    // Nudge Chromium compositor layer after GPU/sleep/display wake without altering layout.
    mascot.style.transform="translateZ(0)";
    void mascot.offsetWidth;
    requestAnimationFrame(()=>{
      mascot.style.transform="";
      syncPet();
      syncSideQuota();
      render();
    });
  });
  api.subscribe(data=>{if(snapshot&&(!data.settings.sound||data.settings.soundSet!==snapshot.settings.soundSet||data.settings.volume!==snapshot.settings.volume))stopSound();snapshot=data;scheduleModelTalk();render();});
 api.onStep(step=>{if(!closed&&snapshot?.settings.turnCostOn){message("模型步骤完成",format(step.tokens.total)+" tokens","输入 "+format(step.tokens.input)+" · 输出 "+format(step.tokens.output),snapshot.settings.turnCostDurationMs,"真实本机记录 · 非整轮计费");play("release");}});
 let quotaBounce;
 api.onReaction(payload=>{
  if(payload?.source==="quota-refresh"){
   if(pet.show("proud","system")&&snapshot&&!snapshot.settings.reducedMotion&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches){
    quotaBounce?.cancel();
    quotaBounce=sleepShell.animate([{translate:"0 0"},{translate:"0 -9px",offset:.38},{translate:"0 0"}],{duration:340,easing:"ease-out"});
    quotaBounce.id="catstella-quota-success";
   }
   return;
  }
  if(payload?.source==="preview"){
   if(payload.expression==="nap")pet.previewNap();
   else pet.show(payload.expression,"preview");
  }
  else if(typeof payload==="string")pet.show(payload,"system");
 });
 let ambientTimer,ambientMessage,previousAmbient;
 function clearAmbient(){
  if(!ambientMessage)return;
  clearTimeout(ambientTimer);
  clearTimeout(autoHide);
  if(temporary===ambientMessage){temporary=null;closed=true;render();}
  ambientMessage=null;
 }
 sideQuota=window.CatstellaSideQuota?.SideQuotaController
  ? new window.CatstellaSideQuota.SideQuotaController({
     container:$("widget")||document.body,
     mascot,
     onOpenQuota:source=>{
      const target=source==="web"&&hasWebData()?"webQuota":"quota";
      selected=target;closed=false;
      clearTimeout(patReflectionTimer);patReflection=null;talkFields=undefined;
      temporary=null;clearTimeout(timeout);clearAmbient();
      if(snapshot)snapshot={...snapshot,settings:{...snapshot.settings,bubbleOn:true,bubblePage:target}};
      armBubble();
      rememberBubble({bubblePage:target,bubbleOn:true});
      render();
     }
    })
  : null;
 const readyForAmbient=()=>snapshot?.settings.ambientChatter&&snapshot.settings.bubbleOn&&closed&&!pointer&&!temporary&&!document.hidden&&["idle","offline"].includes(snapshot.state);
 const chatter=new window.CatstellaChatter({
  allowed:async()=>readyForAmbient()&&await api.canChatter()&&readyForAmbient(),
  pick:previous=>personality?personality.say("idle"):window.CatstellaChatter.pickLine(previous),
  speak:picked=>{
   const resolved=picked===undefined?window.CatstellaChatter.pickLine(previousAmbient):picked;const text=typeof resolved==="object"&&resolved?resolved.text:resolved;previousAmbient=text;
   message("喵言喵语",previousAmbient,"",0,"","talk");
   ambientMessage=temporary;
   render();
   ambientTimer=setTimeout(clearAmbient,4500);
  }
 });
 const quiet=()=>{clearAmbient();chatter.reset();};
 document.addEventListener("pointerdown",quiet,true);
 document.addEventListener("keydown",quiet,true);
 document.addEventListener("visibilitychange",()=>{quiet();syncPet();});
 api.subscribe(data=>{
  chatter.configure(data.settings.ambientChatter===true);
  if(!data.settings.ambientChatter||!data.settings.bubbleOn||!["idle","offline"].includes(data.state)||data.webCompanion?.active)clearAmbient();
 });
 snapshot=await api.get();personality=new window.StarPersonality(snapshot.dialogue,Math.random,snapshot.dialogueTags);selected=snapshot.settings.bubblePage;scheduleModelTalk();render();
 chatter.configure(snapshot.settings.ambientChatter===true);
 window.addEventListener("beforeunload",()=>{clearTimeout(timeout);clearTimeout(autoHide);clearTimeout(hideAnimation);clearTimeout(modelTalkTimer);clearTimeout(patReflectionTimer);clearTimeout(alertTimer);pet.dispose();stopSound();});
})();
