// Serialized into the host by its existing local CDP endpoint (same channel as the theme). No host files are modified.
// 界面汉化翻译层：零延迟同步 MutationObserver + 早期注入支持 + Shadow DOM 穿透 + 精确字典与安全动态模板；输入区/代码区/终端绝对不碰；可随时 destroy 完整还原。
async function installLocalization(config){
 const key="__agyZhV1";
 if(window[key]){
  if(window[key].owner!==config.owner)throw new Error("翻译层由另一个运行实例管理");
  window[key].update(config);
  return window[key].status();
 }
 let dict=config.dict&&typeof config.dict==="object"?config.dict:{};
 const textSkip=".monaco-editor,.cm-editor,.xterm,.integrated-terminal,pre,code,script,style,textarea,input,[contenteditable=true],[role=textbox],[role=combobox]";
 const codeSkip=".monaco-editor,.cm-editor,.xterm,.integrated-terminal,pre,code,script,style";
 const textOriginals=new Map();
 const attrOriginals=new Map();
 const observers=[];
 const observedRoots=new WeakSet();
 const pendingNodes=new Set();
 const TIME_UNITS={s:"秒前",m:"分钟前",h:"小时前",d:"天前",w:"周前"};
 let active=true,rafId=null,translatedCount=0,domReadyHandler=null;

 function restoreAll(){
  for(const [node,entry] of textOriginals.entries()){
   try{if(node.nodeValue===entry.translated)node.nodeValue=entry.raw;}catch{}
  }
  textOriginals.clear();
  for(const [el,attrs] of attrOriginals.entries()){
   for(const [attr,entry] of attrs.entries()){
    try{if(el.getAttribute(attr)===entry.translated)el.setAttribute(attr,entry.raw);}catch{}
   }
  }
  attrOriginals.clear();
  translatedCount=0;
 }

 function replaceTrimmed(text,trimmed,translated){
  const i=text.indexOf(trimmed);
  if(i<0)return translated;
  return text.slice(0,i)+translated+text.slice(i+trimmed.length);
 }

 function resolveDynamic(trimmed,parent){
  let m;
  if((m=trimmed.match(/^Version\s+([0-9.]+)$/i)))return"版本 "+m[1];
  if((m=trimmed.match(/^Show\s+(\d+)\s+earlier\s+steps?$/i)))return"显示 "+m[1]+" 个较早步骤";
  if((m=trimmed.match(/^Worked\s+for\s+(\d+[a-z]+)$/i)))return"已工作 "+m[1];
  if((m=trimmed.match(/^(\d+[a-z]+)\s+ago$/i)))return m[1]+" 前";
  if((m=trimmed.match(/^(?:resets?|refresh(?:es)?)\s+in\s+([^.]+)$/i)))return m[1]+" 后重置";
  if((m=trimmed.match(/^(\d+)\s+files?\s+changed$/i)))return m[1]+" 个文件已更改";
  if((m=trimmed.match(/^Turn\s+(\d+)\s+of\s+(\d+)$/i)))return"第 "+m[1]+" / "+m[2]+" 轮";
  if((m=trimmed.match(/^Load\s+older\s+messages,\s+showing\s+(\d+)\s+of\s+(\d+)$/i)))return"加载更早消息（当前显示 "+m[1]+" / "+m[2]+" 条）";
  if((m=trimmed.match(/^Select\s+model,\s+current:\s+(.+)$/i)))return"选择模型，当前："+m[1];
  if((m=trimmed.match(/^Agent\s+permissions\s+preset\s+selector,\s+current:\s+(.+)$/i)))return"智能体权限预设，当前："+m[1];
  if((m=trimmed.match(/^(\d+)\s+steps?$/i)))return m[1]+" 个步骤";
  if((m=trimmed.match(/^(\d+)\s+Drafts?$/i)))return m[1]+" 份草稿";
  if((m=trimmed.match(/^Resume\s+(\d+)\s+comment\s+drafts?$/i)))return"恢复 "+m[1]+" 条评论草稿";
  if((m=trimmed.match(/^Show\s+more\s*\((\d+)\)$/i)))return"显示更多 ("+m[1]+")";
  if((m=trimmed.match(/^See\s+all\s*\((\d+)\)$/i)))return"查看全部 ("+m[1]+")";
  if((m=trimmed.match(/^Show\s+submitted\s*\((\d+)\)$/i)))return"查看已提交 ("+m[1]+")";
  if((m=trimmed.match(/^Generation\s+Steps\s*\((\d+)\)$/i)))return"生成步骤 ("+m[1]+")";
  if((m=trimmed.match(/^Comment\s*\((\d+)\)$/i)))return"评论 ("+m[1]+")";
  if((m=trimmed.match(/^Available\s+AI\s+Credits:\s*(.+)$/i)))return"可用 AI 额度："+m[1];
  if((m=trimmed.match(/^Your\s+Plan:\s*(.+)$/i)))return"当前套餐："+m[1];
  if((m=trimmed.match(/^Playback\s+speed\s+([0-9.]+x)$/i)))return"播放速度 "+m[1];
  if((m=trimmed.match(/^Zoom\s+(\d+%?),\s+reset\s+to\s+fit$/i)))return"缩放 "+m[1]+"，点击重置为适配视图";
  if((m=trimmed.match(/^Downloads,\s+(\d+)%\s+complete$/i)))return"下载中，已完成 "+m[1]+"%";
  if((m=trimmed.match(/^Today\s+(.+)$/)))return"今天 "+m[1];
  if((m=trimmed.match(/^Yesterday\s+(.+)$/)))return"昨天 "+m[1];
  if((m=trimmed.match(/^Running\s+(.+)$/)))return"正在运行 "+m[1];
  if((m=trimmed.match(/^Open\s+Subagent:\s*(.+)$/)))return"打开子智能体："+m[1];
  if((m=trimmed.match(/^Open\s+the\s+(.+)\s+plugin$/)))return"打开 "+m[1]+" 插件";
  if((m=trimmed.match(/^Open\s+(.+)\s+skill$/)))return"打开 "+m[1]+" 技能";
  if((m=trimmed.match(/^Open\s+in\s+(.+)$/)))return"在 "+m[1]+" 中打开";
  if((m=trimmed.match(/^Open\s+(.+)\s+settings$/)))return"打开 "+m[1]+" 设置";
  if((m=trimmed.match(/^Signed\s+in\s+as\s+(.+)$/)))return"已登录："+m[1];
  if((m=trimmed.match(/^Connected\s+to\s+(.+)$/)))return"已连接到 "+m[1];
  if((m=trimmed.match(/^Working\s+[Dd]irectory:\s*(.+)$/)))return"工作目录："+m[1];
  if((m=trimmed.match(/^Agent\s+finished:\s*(.+)$/)))return"智能体已完成："+m[1];
  if((m=trimmed.match(/^Timed\s+out\s+\(([^)]+)\)$/)))return"已超时 ("+m[1]+")";
  if((m=trimmed.match(/^(?:Process\s+)?[Ee]xited\s+with\s+code\s+(-?\d+)\.?$/)))return"进程已退出，退出码 "+m[1];
  if((m=trimmed.match(/^Configure\s+(.+)$/)))return"配置 "+m[1];
  if((m=trimmed.match(/^View\s+Diff\s+for\s+(.+)$/)))return"查看 "+m[1]+" 的差异";
  if((m=trimmed.match(/^Remove\s+(.+)\s+from\s+Recent$/)))return"从最近列表中移除 "+m[1];
  if((m=trimmed.match(/^Hide\s+(.+)\s+from\s+this\s+list$/)))return"从此列表中隐藏 "+m[1];
  if((m=trimmed.match(/^Show\s+(.+)\s+in\s+the\s+list\s+again$/)))return"在列表中重新显示 "+m[1];
  if((m=trimmed.match(/^Build\s+with\s+(.+)\s+Plugins$/i)))return"使用 "+m[1]+" 插件构建";
  if((m=trimmed.match(/^Agent\s+needs\s+permission\s+to\s+act\s+on\s+(.+)$/)))return"智能体需要权限以操作 "+m[1];
  if((m=trimmed.match(/^Wants\s+to\s+run:\s*(.+)$/)))return"请求运行："+m[1];
  if((m=trimmed.match(/^Message\s+from\s+(.+)$/)))return"来自 "+m[1]+" 的消息";
  if((m=trimmed.match(/^Forked\s+from\s+(.+)$/)))return"分叉自 "+m[1];
  if((m=trimmed.match(/^Opening\s+(.+)$/)))return"正在打开 "+m[1];
  if((m=trimmed.match(/^Pressing\s+(.+)$/)))return"正在按下 "+m[1];
  if((m=trimmed.match(/^Scrolling\s+(.+)$/)))return"正在滚动 "+m[1];
  if(parent&&parent.closest&&!parent.closest("kbd,table,.katex")&&(parent.tagName==="TIME"||parent.closest("nav,aside,[role='navigation'],[aria-label*='Sidebar'],[aria-label*='侧边栏'],[aria-label*='Archive'],[aria-label*='Pin']"))){
   if((m=trimmed.match(/^(\d+)([smhdw])$/))&&TIME_UNITS[m[2]])return m[1]+TIME_UNITS[m[2]];
  }
  return undefined;
 }

 function resolveHit(text,parent){
  if(typeof text!=="string")return undefined;
  const trimmed=text.trim();
  if(!trimmed)return undefined;
  if(dict[trimmed]!==undefined)return replaceTrimmed(text,trimmed,dict[trimmed]);
  const dyn=resolveDynamic(trimmed,parent);
  if(dyn!==undefined)return replaceTrimmed(text,trimmed,dyn);
  return undefined;
 }

 function translateNode(node){
  if(!node||node.nodeType!==Node.TEXT_NODE)return;
  const parent=node.parentElement;
  if(!parent||parent.closest(textSkip))return;
  const raw=node.nodeValue;
  if(!raw)return;
  const existing=textOriginals.get(node);
  if(existing&&raw===existing.translated)return;
  const hit=resolveHit(raw,parent);
  if(hit===undefined||hit===raw)return;
  textOriginals.set(node,{raw,translated:hit});
  node.nodeValue=hit;
  translatedCount++;
 }

 function translateAttr(el,attr){
  if(!el||!el.getAttribute||el.closest?.(codeSkip))return;
  const raw=el.getAttribute(attr);
  if(!raw)return;
  let attrs=attrOriginals.get(el);
  const existing=attrs&&attrs.get(attr);
  if(existing&&raw===existing.translated)return;
  const hit=resolveHit(raw,el);
  if(hit===undefined||hit===raw)return;
  if(!attrs){attrs=new Map();attrOriginals.set(el,attrs);}
  attrs.set(attr,{raw,translated:hit});
  el.setAttribute(attr,hit);
  translatedCount++;
 }

 function scanElementAttrs(el){
  if(!el||el.nodeType!==Node.ELEMENT_NODE)return;
  if(el.closest&&el.closest(codeSkip))return;
  if(el.hasAttribute("placeholder"))translateAttr(el,"placeholder");
  if(el.hasAttribute("title"))translateAttr(el,"title");
  if(el.hasAttribute("aria-label"))translateAttr(el,"aria-label");
 }

 function scan(root){
  if(!active||!root)return;
  if(root.nodeType===Node.TEXT_NODE){translateNode(root);return;}
  if(root.nodeType!==Node.ELEMENT_NODE&&root.nodeType!==Node.DOCUMENT_FRAGMENT_NODE&&root.nodeType!==Node.DOCUMENT_NODE)return;
  if(root.nodeType===Node.ELEMENT_NODE){
   scanElementAttrs(root);
   if(root.shadowRoot){observeRoot(root.shadowRoot);scan(root.shadowRoot);}
   if(root.closest&&root.closest(textSkip))return;
  }
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
   acceptNode:n=>n.nodeValue&&resolveHit(n.nodeValue,n.parentElement)!==undefined?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT
  });
  let node;
  while(node=walker.nextNode())translateNode(node);
  if(root.querySelectorAll){
   for(const el of root.querySelectorAll("[placeholder],[title],[aria-label]"))scanElementAttrs(el);
   for(const el of root.querySelectorAll("*")){
    if(el.shadowRoot&&(!el.closest||!el.closest(codeSkip))){
     observeRoot(el.shadowRoot);
     scan(el.shadowRoot);
    }
   }
  }
 }

 function flushPending(){
  rafId=null;
  if(!active||!pendingNodes.size)return;
  const items=[...pendingNodes];
  pendingNodes.clear();
  for(const item of items)scan(item);
 }

 function handleMutations(records){
  if(!active)return;
  const started=performance.now();
  let ops=0;
  for(const m of records){
   if(m.type==="characterData"){
    translateNode(m.target);ops++;
   }else if(m.type==="attributes"){
    translateAttr(m.target,m.attributeName);ops++;
   }else if(m.type==="childList"){
    const parentEl=m.target&&m.target.nodeType===Node.ELEMENT_NODE?m.target:m.target?.parentElement;
    if(parentEl&&parentEl.closest&&parentEl.closest(codeSkip))continue;
    for(const added of m.addedNodes){
     if(added.nodeType===Node.TEXT_NODE){
      translateNode(added);ops++;
     }else if(added.nodeType===Node.ELEMENT_NODE||added.nodeType===Node.DOCUMENT_FRAGMENT_NODE){
      if(added.closest&&added.closest(codeSkip))continue;
      if(ops<350&&performance.now()-started<12){
       scan(added);
       ops+=12;
      }else{
       pendingNodes.add(added);
      }
     }
    }
   }
  }
  if(pendingNodes.size&&!rafId&&typeof requestAnimationFrame==="function"){
   rafId=requestAnimationFrame(flushPending);
  }
 }

 function observeRoot(root){
  if(!root||observedRoots.has(root))return;
  observedRoots.add(root);
  const obs=new MutationObserver(handleMutations);
  obs.observe(root,{
   childList:true,
   subtree:true,
   characterData:true,
   attributes:true,
   attributeFilter:["placeholder","title","aria-label"]
  });
  observers.push(obs);
 }

 function scanInitial(){
  if(!active)return;
  const root=document.body||document.documentElement;
  if(root){
   observeRoot(document.documentElement||root);
   scan(root);
  }else if(document){
   observeRoot(document);
  }
 }

 function update(next){
  config=next;
  const nextDict=config.dict&&typeof config.dict==="object"?config.dict:{};
  const dictChanged=JSON.stringify(nextDict)!==JSON.stringify(dict);
  dict=nextDict;
  if(dictChanged)restoreAll();
  scanInitial();
 }

 function destroy(){
  active=false;
  if(rafId&&typeof cancelAnimationFrame==="function")cancelAnimationFrame(rafId);
  rafId=null;
  pendingNodes.clear();
  if(domReadyHandler){document.removeEventListener("DOMContentLoaded",domReadyHandler);domReadyHandler=null;}
  for(const obs of observers)try{obs.disconnect();}catch{}
  observers.length=0;
  restoreAll();
  delete window[key];
  return{removed:true};
 }

 scanInitial();
 if(!document.body&&document.readyState==="loading"){
  domReadyHandler=()=>{domReadyHandler=null;if(active)scanInitial();};
  document.addEventListener("DOMContentLoaded",domReadyHandler,{once:true});
 }
 const status=()=>({applied:active,translated:translatedCount,owner:config.owner});
 window[key]={update,destroy,status,owner:config.owner};
 return status();
}
module.exports={installLocalization};
