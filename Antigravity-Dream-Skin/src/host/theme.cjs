// Serialized into the host by its existing local CDP endpoint. No app files are modified.
async function installTheme(config){
 const key="__agyDreamSkinV2";
 const engineRevision="2026-11-24-agy-233-v7",mountKey="__agyDreamSkinMountV2";
 if(window[key]){if(window[key].owner!==config.owner)throw new Error("皮肤由另一个运行实例管理");if(window[key].engineRevision===engineRevision&&window[key].status().applied){await window[key].update(config);return window[key].status();}window[key].destroy();}
 // Initial image decoding yields to other callers. Keep one initializer and let
 // later calls replace its desired config instead of leaving orphan observers.
 if(window[mountKey]){
  const pending=window[mountKey];if(pending.owner!==config.owner)throw new Error("皮肤由另一个运行实例管理");
  pending.latest=config;await pending.ready;if(pending.error)throw pending.error;
  return window[key]?.status()||{applied:false,reason:"initialization-retired"};
 }
 let finishMount;const mounting={owner:config.owner,latest:config,ready:new Promise(resolve=>{finishMount=resolve;})};
 window[mountKey]=mounting;
 try{
 document.querySelectorAll('#agy-dream-style-v2, #agy-dream-wallpaper-v2').forEach(el => el.remove());
 const root=document.querySelector("#root")||document.querySelector("#app");
 if(!root)return{applied:false,reason:"unsupported-root"};
 let image;
 do{config=mounting.latest;image=new Image();image.src=config.image;try{await image.decode();}catch(error){if(config===mounting.latest)throw error;}}while(config!==mounting.latest);
 let currentSrc=config.image;
 if(!root.isConnected)return{applied:false,reason:"detached-root"};
 document.querySelectorAll('#agy-dream-wallpaper-v2').forEach(el => el.remove());
 const saved=[],seen=new WeakSet(),trackedVars=new Set();
 const protect=".monaco-editor,.cm-editor,.xterm,.integrated-terminal,textarea,pre,code,[contenteditable=true],[role=dialog],[role=menu],[role=listbox]";
 const PALETTES={
  violet:{
   dark:{
    surface:"#211e2d",selected:"#443754",reading:"#211e2df5",hover:"#a58ade1c",
    accent:"#bda2f2",accentRgb:"189,162,242",highlightRgb:"227,212,255",line:"#ae8eda38",
    glass:"linear-gradient(165deg,rgba(36,28,54,0.92),rgba(18,14,28,0.96))",glassBorder:"rgba(189,162,242,0.32)",
    userBubble:"linear-gradient(145deg,rgba(48,34,74,0.94),rgba(24,18,38,0.97))",userBorder:"rgba(189,162,242,0.45)",userColor:"#ffffff",
    pillBg:"rgba(165,138,222,0.16)",pillBorder:"rgba(174,142,218,0.30)",pillHover:"rgba(165,138,222,0.28)",
    codeBg:"rgba(20,16,30,0.92)",cardBg:"rgba(31,27,44,0.95)",chromeBg:"rgba(25,20,38,0.78)",
    closeBg:"rgba(28,22,44,0.95)",closeHover:"rgba(60,44,90,0.98)",scrimRgb:"20,15,35",adaptiveBg:"#242033",
    vars:{"--background":"#1c1926","--card":"#262132","--popover":"#2b2537","--muted":"#30283e","--secondary":"#342b43","--sidebar":"#211e2d","--sidebar-muted":"#443754","--border":"#ac8ddd32","--ring":"#baa0ef"}
   },
   light:{
    surface:"#f3edfc",selected:"#e5d8f6",reading:"#fffafff5",hover:"#b494e526",
    accent:"#9370db",accentRgb:"147,112,219",highlightRgb:"255,255,255",line:"#a98bd63b",
    glass:"linear-gradient(165deg,rgba(255,250,255,0.95),rgba(238,228,250,0.92))",glassBorder:"rgba(174,142,218,0.38)",
    userBubble:"linear-gradient(145deg,rgba(255,255,255,0.97),rgba(240,232,252,0.94))",userBorder:"rgba(174,142,218,0.48)",userColor:"#1c1828",
    pillBg:"rgba(255,255,255,0.68)",pillBorder:"rgba(174,142,218,0.35)",pillHover:"rgba(255,255,255,0.88)",
    codeBg:"rgba(250,246,255,0.92)",cardBg:"rgba(255,255,255,0.95)",chromeBg:"rgba(249,244,255,0.82)",
    closeBg:"rgba(246,240,255,0.96)",closeHover:"rgba(232,220,250,0.98)",scrimRgb:"25,18,40",adaptiveBg:"#ede4f7",
    vars:{"--background":"#faf7ff","--card":"#fffaff","--popover":"#fffaff","--muted":"#eee4f7","--secondary":"#eadff6","--sidebar":"#f3edfc","--sidebar-muted":"#e5d8f6","--border":"#a98bd63b","--ring":"#9d7bd1"}
   }
  },
  pink:{
   dark:{
    surface:"#281c27",selected:"#4d3048",reading:"#281c27f5",hover:"#f48fb122",
    accent:"#f59cc6",accentRgb:"245,156,198",highlightRgb:"255,216,236",line:"#e88bb838",
    glass:"linear-gradient(165deg,rgba(48,28,44,0.92),rgba(24,14,23,0.96))",glassBorder:"rgba(245,156,198,0.34)",
    userBubble:"linear-gradient(145deg,rgba(68,34,58,0.94),rgba(34,17,30,0.97))",userBorder:"rgba(245,156,198,0.48)",userColor:"#ffffff",
    pillBg:"rgba(236,136,184,0.16)",pillBorder:"rgba(236,136,184,0.30)",pillHover:"rgba(236,136,184,0.28)",
    codeBg:"rgba(26,15,24,0.92)",cardBg:"rgba(40,24,37,0.95)",chromeBg:"rgba(33,19,31,0.78)",
    closeBg:"rgba(42,20,36,0.95)",closeHover:"rgba(86,38,70,0.98)",scrimRgb:"32,14,26",adaptiveBg:"#2c1d2a",
    vars:{"--background":"#211620","--card":"#2d1e2b","--popover":"#342231","--muted":"#3c2638","--secondary":"#432a3e","--sidebar":"#281c27","--sidebar-muted":"#4d3048","--border":"#e88bb832","--ring":"#f59cc6"}
   },
   light:{
    surface:"#fdf0f6",selected:"#f7dce9",reading:"#fff9fcf5",hover:"#e880b226",
    accent:"#d66098",accentRgb:"214,96,152",highlightRgb:"255,255,255",line:"#e08cb53b",
    glass:"linear-gradient(165deg,rgba(255,250,253,0.95),rgba(250,232,242,0.92))",glassBorder:"rgba(224,140,181,0.38)",
    userBubble:"linear-gradient(145deg,rgba(255,255,255,0.97),rgba(252,235,244,0.94))",userBorder:"rgba(224,140,181,0.48)",userColor:"#2b1622",
    pillBg:"rgba(255,255,255,0.68)",pillBorder:"rgba(224,140,181,0.35)",pillHover:"rgba(255,255,255,0.88)",
    codeBg:"rgba(255,246,251,0.92)",cardBg:"rgba(255,252,254,0.95)",chromeBg:"rgba(254,242,248,0.82)",
    closeBg:"rgba(254,240,247,0.96)",closeHover:"rgba(248,220,235,0.98)",scrimRgb:"38,16,28",adaptiveBg:"#f7e4ee",
    vars:{"--background":"#fff7fb","--card":"#fffbfd","--popover":"#fffbfd","--muted":"#f9e5ef","--secondary":"#f6ddeb","--sidebar":"#fdf0f6","--sidebar-muted":"#f7dce9","--border":"#e08cb53b","--ring":"#d66098"}
   }
  },
  ocean:{
   dark:{
    surface:"#141d2b",selected:"#213654",reading:"#141d2bf5",hover:"#6eb5ff1f",
    accent:"#7cc0ff",accentRgb:"124,192,255",highlightRgb:"204,232,255",line:"#6caef036",
    glass:"linear-gradient(165deg,rgba(20,32,52,0.92),rgba(10,17,30,0.96))",glassBorder:"rgba(124,192,255,0.32)",
    userBubble:"linear-gradient(145deg,rgba(26,46,76,0.94),rgba(13,24,42,0.97))",userBorder:"rgba(124,192,255,0.46)",userColor:"#ffffff",
    pillBg:"rgba(104,174,248,0.15)",pillBorder:"rgba(104,174,248,0.28)",pillHover:"rgba(104,174,248,0.26)",
    codeBg:"rgba(11,18,30,0.93)",cardBg:"rgba(18,28,44,0.95)",chromeBg:"rgba(14,22,36,0.78)",
    closeBg:"rgba(16,26,44,0.95)",closeHover:"rgba(30,54,88,0.98)",scrimRgb:"10,18,34",adaptiveBg:"#162234",
    vars:{"--background":"#0f1724","--card":"#172336","--popover":"#1b2940","--muted":"#20314b","--secondary":"#243754","--sidebar":"#141d2b","--sidebar-muted":"#213654","--border":"#6caef030","--ring":"#7cc0ff"}
   },
   light:{
    surface:"#eef5fd",selected:"#d9e9fb",reading:"#f9fcfff5",hover:"#5a9ee826",
    accent:"#3b7dd8",accentRgb:"59,125,216",highlightRgb:"255,255,255",line:"#6fa5e33b",
    glass:"linear-gradient(165deg,rgba(250,253,255,0.95),rgba(228,240,252,0.92))",glassBorder:"rgba(111,165,227,0.38)",
    userBubble:"linear-gradient(145deg,rgba(255,255,255,0.97),rgba(232,243,254,0.94))",userBorder:"rgba(111,165,227,0.48)",userColor:"#122033",
    pillBg:"rgba(255,255,255,0.68)",pillBorder:"rgba(111,165,227,0.35)",pillHover:"rgba(255,255,255,0.88)",
    codeBg:"rgba(244,249,255,0.92)",cardBg:"rgba(252,254,255,0.95)",chromeBg:"rgba(240,247,254,0.82)",
    closeBg:"rgba(238,246,255,0.96)",closeHover:"rgba(218,234,252,0.98)",scrimRgb:"12,24,42",adaptiveBg:"#e2eefb",
    vars:{"--background":"#f5f9ff","--card":"#fbfdff","--popover":"#fbfdff","--muted":"#e3effc","--secondary":"#dceafb","--sidebar":"#eef5fd","--sidebar-muted":"#d9e9fb","--border":"#6fa5e33b","--ring":"#3b7dd8"}
   }
  },
  onyx:{
   dark:{
    surface:"#17181d",selected:"#2a2c35",reading:"#17181df5",hover:"#d4d8e81a",
    accent:"#c8cedf",accentRgb:"200,206,223",highlightRgb:"240,243,250",line:"#a8b0c430",
    glass:"linear-gradient(165deg,rgba(26,27,34,0.93),rgba(14,15,19,0.97))",glassBorder:"rgba(200,206,223,0.26)",
    userBubble:"linear-gradient(145deg,rgba(38,40,50,0.95),rgba(20,21,27,0.98))",userBorder:"rgba(212,218,235,0.38)",userColor:"#ffffff",
    pillBg:"rgba(190,196,214,0.13)",pillBorder:"rgba(190,196,214,0.24)",pillHover:"rgba(190,196,214,0.22)",
    codeBg:"rgba(12,13,17,0.94)",cardBg:"rgba(22,23,29,0.95)",chromeBg:"rgba(17,18,23,0.80)",
    closeBg:"rgba(24,25,32,0.95)",closeHover:"rgba(52,55,68,0.98)",scrimRgb:"10,11,15",adaptiveBg:"#191a20",
    vars:{"--background":"#121317","--card":"#1a1c22","--popover":"#1f2128","--muted":"#252830","--secondary":"#2a2d37","--sidebar":"#17181d","--sidebar-muted":"#2a2c35","--border":"#a8b0c428","--ring":"#c8cedf"}
   },
   light:{
    surface:"#f3f4f7",selected:"#e4e6ec",reading:"#fcfcfdf5",hover:"#6b72801f",
    accent:"#525866",accentRgb:"82,88,102",highlightRgb:"255,255,255",line:"#8b92a238",
    glass:"linear-gradient(165deg,rgba(255,255,255,0.95),rgba(240,242,246,0.92))",glassBorder:"rgba(139,146,162,0.34)",
    userBubble:"linear-gradient(145deg,rgba(255,255,255,0.98),rgba(242,244,248,0.95))",userBorder:"rgba(139,146,162,0.44)",userColor:"#181a20",
    pillBg:"rgba(255,255,255,0.72)",pillBorder:"rgba(139,146,162,0.32)",pillHover:"rgba(255,255,255,0.90)",
    codeBg:"rgba(247,248,250,0.93)",cardBg:"rgba(255,255,255,0.95)",chromeBg:"rgba(244,245,248,0.84)",
    closeBg:"rgba(242,244,248,0.96)",closeHover:"rgba(226,230,238,0.98)",scrimRgb:"16,18,24",adaptiveBg:"#eaecf1",
    vars:{"--background":"#f8f9fb","--card":"#ffffff","--popover":"#ffffff","--muted":"#eceef2","--secondary":"#e5e8ee","--sidebar":"#f3f4f7","--sidebar-muted":"#e4e6ec","--border":"#8b92a233","--ring":"#525866"}
   }
  }
 };
 let layer=document.createElement("div");layer.id="agy-dream-wallpaper-v2";layer.setAttribute("aria-hidden","true");
 Object.assign(layer.style,{position:"fixed",inset:"0",zIndex:"0",pointerEvents:"none",overflow:"hidden",backgroundRepeat:"no-repeat",backgroundPosition:"center",backgroundColor:"#f8f6ff",transition:"opacity 0.4s ease"});
 let wallpaperGen=0,incoming=null,committedImage=image,deferred=null,latest=config,retained=[],pendingDecode=null,presentedId=config.wallpaperId||null;
 const foreground=()=>!document.hidden&&document.hasFocus();
 function discardIncoming(){
  for(const el of [...retained,...(incoming?[incoming]:[])]){
   for(const anim of el.getAnimations?.()||[]){anim.onfinish=null;anim.cancel();}
   el.remove();
  }
  retained=[];incoming=null;
 }
 function retainIncoming(){
  if(!incoming)return;
  const alpha=getComputedStyle(incoming).opacity;
  for(const anim of incoming.getAnimations?.()||[]){anim.onfinish=null;anim.cancel();}
  incoming.style.opacity=alpha;
  retained.push(incoming);incoming=null;
 }
 function pauseIncoming(){
  for(const anim of incoming?.getAnimations?.()||[]){
   const time=anim.currentTime;
   anim.pause();
   // pause() alone takes effect on a later rendering opportunity. Hold the
   // current time synchronously so blur cannot advance the visible blend.
   if(time!==null)anim.currentTime=time;
  }
 }
 function deferWallpaper(next){
  deferred=next;
  if(incoming)pauseIncoming();
  else image=committedImage;
 }
 function commitIncoming(url,p,factor,cfg){
  discardIncoming();
  layer.style.backgroundImage='linear-gradient(rgba('+p.scrimRgb+','+cfg.scrim+'),rgba('+p.scrimRgb+','+cfg.scrim+')),url("'+url+'")';
  layer.style.backgroundSize="100% 100%,"+Math.round(image.naturalWidth*factor)+"px "+Math.round(image.naturalHeight*factor)+"px";
  layer.style.backgroundPosition="center,"+(cfg.positionX??50)+"% "+(cfg.positionY??50)+"%";
  layer.style.backgroundColor=cfg.fit==="adaptive"?p.adaptiveBg:"transparent";
  currentSrc=url;committedImage=image;
  presentedId=cfg.wallpaperId||null;
 }
 const userRole='.agy-user-bubble,[data-testid="user-message-bubble"],[data-testid="user-input-step"],user-query,.user-query';
 const aiRole='[data-markdown-root],.markdown-body,.prose,.leading-relaxed.select-text';
 const roleExcluded=`${userRole},:is(${userRole}) *,pre,pre *,.monaco-editor,.monaco-editor *,.cm-editor,.cm-editor *,.xterm,.xterm *,[data-testid="tool-group-collapsible"],[data-testid="tool-group-collapsible"] *`;
 const style=document.createElement("style");style.id="agy-dream-style-v2";style.textContent=`
 html.agy-dream-active-v2 body { background:var(--agy-dream-base-bg)!important; }
 html.agy-dream-active-v2 [data-agy-dream-root] { position:relative;z-index:1; }
 html.agy-dream-active-v2 :is(#root,#app,.agy-shell,.agy-sheet,[data-agy-dream-clear]) { background-color:transparent!important;background-image:none!important; }
 html.agy-dream-active-v2 [data-agy-dream-protect] { background-color:var(--agy-dream-old-bg)!important;backdrop-filter:none!important; }
 html.agy-dream-active-v2 [data-agy-dream-card] { background-color:var(--agy-dream-card-bg)!important;backdrop-filter:blur(12px);border-radius:12px; }
 html.agy-dream-active-v2 [data-agy-dream-chrome] { background-color:var(--agy-dream-chrome-bg)!important;backdrop-filter:blur(12px); }
 html.agy-dream-active-v2 :is(.bg-sidebar,aside,[role=navigation]) {background-color:var(--agy-ui-surface)!important;background-image:none!important;border-color:var(--agy-ui-line)!important;}
 html.agy-dream-active-v2 :is(header,[role=tablist],[role=status],.titlebar) {background-color:var(--agy-ui-surface)!important;border-color:var(--agy-ui-line)!important;}
 html.agy-dream-active-v2 :is(.bg-sidebar,[role=navigation],aside) :is([aria-selected=true],[aria-current=true],[data-state=active],[class~="bg-sidebar-muted"],[class~="bg-sidebar-secondary"]) {background-color:var(--agy-ui-selected)!important;background-image:none!important;box-shadow:inset 3px 0 var(--agy-ui-accent),inset 0 0 0 1px rgba(var(--agy-ui-accent-rgb),0.22);border-radius:9px;}
 html.agy-dream-active-v2 :is(button,a,[role=tab]):hover:not(:disabled) {outline-color:var(--agy-ui-accent);background-color:var(--agy-ui-hover);}
 html.agy-dream-active-v2 :is([role=tab][aria-selected=true],[role=tab][data-state=active]) {background:var(--agy-ui-selected)!important;box-shadow:inset 0 -2px var(--agy-ui-accent);}
 html.agy-dream-active-v2 :is(button,a,input):focus-visible {outline:2px solid var(--agy-ui-accent);outline-offset:2px;}
 html.agy-dream-active-v2 :is([role=menu],[role=dialog],[role=listbox]) {background-color:var(--agy-ui-surface)!important;border-color:var(--agy-ui-line)!important;box-shadow:0 8px 28px rgba(0,0,0,0.28);}
 html.agy-dream-active-v2 .agy-sheet {border-radius:22px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(var(--agy-ui-accent-rgb),0.16);}
 html.agy-dream-active-v2 [data-agy-dream-welcome] { padding-top:0!important;justify-content:flex-end!important;padding-bottom:28px!important; }
 html.agy-dream-active-v2 [data-agy-dream-fade] {background:none!important;box-shadow:none!important;}

 /* Reading & bleed surface transparency without wiping user bubbles, pills or tools */
 html.agy-dream-active-v2 [data-agy-dream-reading] {background:transparent!important;border:0;box-shadow:none;}
 html.agy-dream-active-v2 :is([data-agy-dream-reading],.md-sticky-message-bleed,.surface-composer-card) {background-color:transparent!important;background-image:none!important;}
 html.agy-dream-active-v2 :is([data-agy-dream-reading],.md-sticky-message-bleed) *:not(
   .monaco-editor,.monaco-editor *,.cm-editor,.cm-editor *,.xterm,.xterm *,.integrated-terminal,.integrated-terminal *,
   .agy-user-bubble,.agy-user-bubble *,[data-testid="user-message-bubble"],[data-testid="user-message-bubble"] *,.user-input-buttons-container,.user-input-buttons-container *,
   [data-testid="worked-for-collapsible"],[data-testid="worked-for-collapsible"] *,[data-testid="tool-group-collapsible"],[data-testid="tool-group-collapsible"] *,
   [data-markdown-root],[data-markdown-root] *,
   button,button *
 ) {background-color:transparent!important;background-image:none!important;backdrop-filter:none!important;}

 /* Sticky header gradient cleanup */
 html.agy-dream-active-v2 :is([data-agy-dream-reading],.md-sticky-message-bleed)::after,
 html.agy-dream-active-v2 :is([data-agy-dream-reading],.md-sticky-message-bleed)::before {display:none!important;background:none!important;box-shadow:none!important;}
 html.agy-dream-active-v2 .md-sticky-message-bleed {box-shadow:none!important;}
 html.agy-dream-active-v2 .agy-sheet :has(>.md-sticky-message-bleed){position:relative!important;top:auto!important;}

 /* User Message Bubble - Liquid Dream Glass (High Readability) */
 html.agy-dream-active-v2 .agy-user-bubble-frame {background:transparent!important;border:none!important;box-shadow:none!important;}
 html.agy-dream-active-v2 :is(.agy-user-bubble,[data-testid="user-message-bubble"],user-query,.user-query) {
   background-color:transparent!important;
   background-image:var(--agy-ui-user-bubble)!important;
   backdrop-filter:blur(28px) saturate(140%)!important;
   -webkit-backdrop-filter:blur(28px) saturate(140%)!important;
   border:1px solid var(--agy-ui-user-border)!important;
   border-radius:16px!important;
   box-shadow:0 6px 24px rgba(10,8,20,0.48),inset 0 1px 0 rgba(var(--agy-ui-highlight-rgb),0.32)!important;
   padding:10px 16px!important;
   color:var(--agy-ui-user-color)!important;
 }
 html.agy-dream-active-v2 :is(.agy-user-bubble,[data-testid="user-message-bubble"],user-query,.user-query) [data-quotable="true"] {
   color:var(--agy-ui-user-color)!important;
   text-shadow:0 1px 2px rgba(0,0,0,0.55)!important;
   font-weight:450!important;
 }
 html.agy-dream-active-v2 :is(.agy-user-bubble,[data-testid="user-message-bubble"]) .user-input-buttons-container {
   background-color:var(--agy-ui-surface)!important;
   backdrop-filter:blur(14px)!important;
   -webkit-backdrop-filter:blur(14px)!important;
   border:1px solid var(--agy-ui-user-border)!important;
   border-radius:9999px!important;
   box-shadow:0 2px 10px rgba(0,0,0,0.35)!important;
 }

 /* Thinking & Tool Calls - Single Layer Frosted Crystal Pills */
 html.agy-dream-active-v2 :is([data-testid="worked-for-collapsible"],[data-testid="tool-group-collapsible"]) {
   background-color:var(--agy-ui-pill-bg)!important;
   border:1px solid var(--agy-ui-pill-border)!important;
   border-radius:12px!important;
   backdrop-filter:blur(14px)!important;
   -webkit-backdrop-filter:blur(14px)!important;
   box-shadow:inset 0 1px 0 rgba(var(--agy-ui-highlight-rgb),0.15),0 2px 8px rgba(10,8,20,0.2)!important;
   transition:all 0.2s cubic-bezier(0.2,0,0,1)!important;
   margin-bottom:4px!important;
 }
 html.agy-dream-active-v2 :is([data-testid="worked-for-collapsible"],[data-testid="tool-group-collapsible"]):hover {
   background-color:var(--agy-ui-pill-hover)!important;
   border-color:rgba(var(--agy-ui-accent-rgb),0.45)!important;
   box-shadow:inset 0 1px 0 rgba(var(--agy-ui-highlight-rgb),0.25),0 4px 12px rgba(10,8,20,0.3)!important;
 }

 /* Composer outer container & wrapper - strictly transparent to eliminate black block */
 html.agy-dream-active-v2 :has(> .surface-composer),
 html.agy-dream-active-v2 :has(> * > .surface-composer),
 html.agy-dream-active-v2 :has(> * > * > .surface-composer),
 html.agy-dream-active-v2 :has(> * > * > * > .surface-composer),
 html.agy-dream-active-v2 [class*="px-4"][class*="pb-4"]:has(.surface-composer),
 html.agy-dream-active-v2 .surface-composer-card {
   background-color:transparent!important;
   background-image:none!important;
   backdrop-filter:none!important;
   -webkit-backdrop-filter:none!important;
   box-shadow:none!important;
 }
 /* Composer */
 html.agy-dream-active-v2 .agy-sheet .surface-composer[class] {
   border-radius:22px!important;
   background-color:transparent!important;
   background-image:var(--agy-ui-glass)!important;
   backdrop-filter:blur(24px) saturate(130%)!important;
   -webkit-backdrop-filter:blur(24px) saturate(130%)!important;
   border:1px solid var(--agy-ui-glass-border)!important;
   box-shadow:inset 0 1px 0 rgba(var(--agy-ui-highlight-rgb),0.22),0 10px 30px rgba(10,8,20,0.35)!important;
   transition:border-color 0.25s ease,box-shadow 0.25s ease!important;
 }
 /* Outer card dream-like starlight glow on focus */
 html.agy-dream-active-v2 .agy-sheet .surface-composer:focus-within {
   border-color:rgba(var(--agy-ui-accent-rgb),0.85)!important;
   box-shadow:0 0 0 1px rgba(var(--agy-ui-accent-rgb),0.55),0 0 24px rgba(var(--agy-ui-accent-rgb),0.35),0 12px 36px rgba(10,8,20,0.5),inset 0 1px 0 rgba(var(--agy-ui-highlight-rgb),0.4)!important;
 }
 html.agy-dream-active-v2 .agy-sheet .surface-composer-card {
   border-radius:21px!important;
   background:transparent!important;
 }
 /* Eliminate black block and internal focus outline inside composer */
 html.agy-dream-active-v2 .surface-composer :is([contenteditable="true"],textarea,[data-lexical-editor="true"],.w-full) {
   background-color:transparent!important;
   background-image:none!important;
   backdrop-filter:none!important;
   -webkit-backdrop-filter:none!important;
 }
 html.agy-dream-active-v2 .surface-composer :is([contenteditable="true"],textarea,[data-lexical-editor="true"],input):focus,
 html.agy-dream-active-v2 .surface-composer :is([contenteditable="true"],textarea,[data-lexical-editor="true"],input):focus-visible {
   outline:none!important;
   box-shadow:none!important;
   border-color:transparent!important;
 }
 html.agy-dream-active-v2 .surface-composer *:focus-visible {
   outline:none!important;
 }
 html.agy-dream-active-v2 .surface-composer :is([data-testid="model-selector-trigger"],[data-testid="permissions-selector-trigger"]) {
   background-color:var(--agy-ui-pill-bg)!important;
   border:1px solid var(--agy-ui-pill-border)!important;
   backdrop-filter:blur(10px)!important;
   transition:all 0.2s ease!important;
 }
 html.agy-dream-active-v2 .surface-composer :is([data-testid="model-selector-trigger"],[data-testid="permissions-selector-trigger"]):hover {
   background-color:var(--agy-ui-pill-hover)!important;
   border-color:rgba(var(--agy-ui-accent-rgb),0.5)!important;
 }

 /* Attachment Thumbnails Enlarged & Polished */
 html.agy-dream-active-v2 :is([data-testid="input-attachment"],.group\\/attachment) {
   background-color:var(--agy-ui-surface)!important;
   border:1px solid var(--agy-ui-glass-border)!important;
   border-radius:14px!important;
   backdrop-filter:blur(14px)!important;
   -webkit-backdrop-filter:blur(14px)!important;
   box-shadow:0 4px 16px rgba(10,8,20,0.35)!important;
   padding:3px!important;
   transition:transform 0.2s ease,border-color 0.2s ease!important;
   overflow:visible!important;
 }
 html.agy-dream-active-v2 :is([data-testid="input-attachment"],.group\\/attachment):hover {
   transform:scale(1.03);
   border-color:rgba(var(--agy-ui-accent-rgb),0.65)!important;
 }
 html.agy-dream-active-v2 :is([data-testid="input-attachment"],.group\\/attachment) img {
   width:76px!important;
   height:76px!important;
   min-width:76px!important;
   min-height:76px!important;
   border-radius:11px!important;
   object-fit:cover!important;
   display:block!important;
 }
 html.agy-dream-active-v2 :is([data-testid="input-attachment-remove"],.group\\/attachment button) {
   width:24px!important;
   height:24px!important;
   min-width:24px!important;
   min-height:24px!important;
   background-color:var(--agy-ui-close-bg)!important;
   border:1.5px solid rgba(var(--agy-ui-accent-rgb),0.65)!important;
   border-radius:9999px!important;
   top:-8px!important;
   right:-8px!important;
   opacity:1!important;
   display:flex!important;
   align-items:center!important;
   justify-content:center!important;
   box-shadow:0 2px 8px rgba(0,0,0,0.45)!important;
   cursor:pointer!important;
   z-index:20!important;
   transition:transform 0.15s ease,background-color 0.15s ease,border-color 0.15s ease!important;
 }
 html.agy-dream-active-v2 :is([data-testid="input-attachment-remove"],.group\\/attachment button):hover {
   transform:scale(1.15)!important;
   background-color:var(--agy-ui-close-hover)!important;
   border-color:rgba(var(--agy-ui-highlight-rgb),0.9)!important;
 }
 html.agy-dream-active-v2 :is([data-testid="input-attachment-remove"],.group\\/attachment button) svg {
   width:14px!important;
   height:14px!important;
   stroke:#fdfcff!important;
   color:#fdfcff!important;
   stroke-width:2.5!important;
 }

 /* Overview Floating Panel */
 html.agy-dream-active-v2 .animate-overview-panel {
   background-color:transparent!important;
   background-image:var(--agy-ui-glass)!important;
   backdrop-filter:blur(24px) saturate(135%)!important;
   -webkit-backdrop-filter:blur(24px) saturate(135%)!important;
   border:1px solid var(--agy-ui-glass-border)!important;
   border-radius:16px!important;
   box-shadow:0 12px 36px rgba(10,8,20,0.45),inset 0 1px 0 rgba(var(--agy-ui-highlight-rgb),0.22)!important;
 }
 html.agy-dream-active-v2 .animate-overview-panel :is(.bg-card,.bg-muted) {
   background-color:transparent!important;
 }
 html.agy-dream-active-v2 .animate-overview-panel [class*="border-border"] {
   border-color:var(--agy-ui-glass-border)!important;
 }
 html.agy-dream-active-v2 .animate-overview-panel [class*="hover:bg-"]:hover {
   background-color:var(--agy-ui-hover)!important;
 }

 /* AGY_ROLE_INVARIANT: one user plate, one assistant plate, never per paragraph. */
 /* AGY 2.31 masks its chat scroller after scrolling. An ancestor mask creates
    a backdrop root, so reply blur samples an empty surface instead of wallpaper.
    Unmask only AI-containing chat scrollers in glass mode. CSS keeps late/native
    class and inline-style changes correct on their first frame; no scroll hook. */
 html.agy-dream-active-v2 :is(#root,#app,[data-agy-dream-root])[data-agy-output-mode="glass"] .agy-sheet :is(.overflow-y-auto,.overflow-auto,[role="log"],[data-testid="autoscroll-viewport"],[data-testid="conversation-scroll"],[data-testid="chat-scroll"]):has(:is(${aiRole}):not(:where(${roleExcluded}))) {
  mask-image:none!important;-webkit-mask-image:none!important;
 }
 html.agy-dream-active-v2 :is(#root,#app,[data-agy-dream-root]) :is(.agy-user-bubble,[data-testid="user-message-bubble"],user-query,.user-query) {
  background-color:rgba(var(--agy-chat-rgb,24,18,36),var(--agy-chat-alpha,1))!important;background-image:none!important;
 }
 html.agy-dream-active-v2 :is(#root,#app,[data-agy-dream-root]) :is(${aiRole}):not(:where(${roleExcluded})) {
  background-color:rgba(var(--agy-chat-rgb,24,18,36),var(--agy-reply-alpha,0))!important;background-image:none!important;
  opacity:1!important;border:0!important;box-shadow:none!important;
  backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
 }
 html.agy-dream-active-v2 :is(#root,#app,[data-agy-dream-root])[data-agy-output-mode="glass"] :is(${aiRole}):not(:where(${roleExcluded})) {
  backdrop-filter:blur(28px) saturate(135%)!important;-webkit-backdrop-filter:blur(28px) saturate(135%)!important;
  border-radius:18px!important;border:1px solid var(--agy-ui-glass-border)!important;
  box-shadow:0 8px 32px rgba(10,8,20,0.4),inset 0 1px 0 rgba(var(--agy-ui-highlight-rgb),0.22)!important;
  padding:16px 22px!important;background-clip:padding-box!important;
 }
 html.agy-dream-active-v2 :is(#root,#app,[data-agy-dream-root]) :is([data-markdown-root],.markdown-body,.prose,.leading-relaxed.select-text) :is([data-markdown-root],.markdown-body,.prose,.leading-relaxed.select-text,[data-agy-dream-segment]) {
  background:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important;border:0!important;
  padding:0!important;border-radius:0!important;
 }
 html.agy-dream-active-v2 :is(#root,#app,[data-agy-dream-root]) [data-agy-ai-shell]:not(:where(${userRole},${aiRole})) {
  background:none!important;backdrop-filter:none!important;box-shadow:none!important;
 }
 /* Native reply wrappers must be clear on their first frame, before scan(). */
 html.agy-dream-active-v2 :is(#root,#app,[data-agy-dream-root]) :is(.scroll-mt-4,[role=article],.scroll-mt-4 div,[role=article] div):has(:is(${aiRole})):not(:where(${roleExcluded},${aiRole},:is(${aiRole}) *)):not(:has(:is(${userRole},form,.surface-composer))) {
  background:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important;
 }
 /* Editors, Terminals, Code Blocks */
 html.agy-dream-active-v2 [data-agy-dream-protect] { background-color:var(--agy-dream-old-bg)!important;backdrop-filter:none!important;opacity:1!important; }
 html.agy-dream-active-v2 pre,
 html.agy-dream-active-v2 .monaco-editor,
 html.agy-dream-active-v2 .cm-editor,
 html.agy-dream-active-v2 .xterm {
   background-color:var(--agy-ui-code-bg)!important;
   backdrop-filter:blur(12px)!important;
   border:1px solid rgba(var(--agy-ui-accent-rgb),0.25)!important;
   border-radius:10px!important;
 }
 html.agy-dream-active-v2 :is([role=dialog],[role=menu],[role=listbox]) {border-radius:16px;}
 `;
 function mark(el,attribute){if(!el.hasAttribute(attribute)){saved.push([el,attribute,null]);el.setAttribute(attribute,"");}}
 function variable(el,key,value){
  const global=el===root||el===document.body,tag=(el===root?"r:":el===document.body?"b:":"e:")+key;
  if(!global||!trackedVars.has(tag)){if(global)trackedVars.add(tag);saved.push([el,"style:"+key,el.style.getPropertyValue(key),el.style.getPropertyPriority(key)]);}
  el.style.setProperty(key,value);
 }
 function restore([el,attr,value,priority]){if(attr.startsWith("style:")){const k=attr.slice(6);value?el.style.setProperty(k,value,priority):el.style.removeProperty(k);}else value===null?el.removeAttribute(attr):el.setAttribute(attr,value);}
 mark(root,"data-agy-output-mode");mark(root,"data-agy-theme-preset");mark(root,"data-agy-dream-root");mark(root,"data-agy-dream-clear");mark(root,"data-agy-chat-custom");
 const nativeBackgrounds=new WeakMap([[root,getComputedStyle(root).backgroundColor]]);
 function surfaceBackground(el){
  for(let node=el;node;node=node.parentElement){const bg=nativeBackgrounds.get(node)||getComputedStyle(node).backgroundColor;if(bg!=="transparent"&&bg!=="rgba(0, 0, 0, 0)")return bg;}
  return "#fff";
 }
 const bodyColor=surfaceBackground(root);
 const rgb=bodyColor.match(/[\d.]+/g)?.slice(0,3).map(Number)||[255,255,255],dark=rgb.reduce((a,b)=>a+b,0)<360;
 function applyPalette(presetName){
  const preset=PALETTES[presetName]?presetName:"violet",p=PALETTES[preset][dark?"dark":"light"];
  root.setAttribute("data-agy-theme-preset",preset);
  variable(document.body,"--agy-ui-surface",p.surface);
  variable(document.body,"--agy-ui-selected",p.selected);
  variable(document.body,"--agy-ui-reading",p.reading);
  variable(document.body,"--agy-ui-hover",p.hover);
  variable(document.body,"--agy-ui-accent",p.accent);
  variable(document.body,"--agy-ui-accent-rgb",p.accentRgb);
  variable(document.body,"--agy-ui-highlight-rgb",p.highlightRgb);
  variable(document.body,"--agy-ui-line",p.line);
  variable(document.body,"--agy-ui-glass",p.glass);
  variable(document.body,"--agy-ui-glass-border",p.glassBorder);
  variable(document.body,"--agy-ui-user-bubble",p.userBubble);
  variable(document.body,"--agy-ui-user-border",p.userBorder);
  variable(document.body,"--agy-ui-user-color",p.userColor);
  variable(document.body,"--agy-ui-pill-bg",p.pillBg);
  variable(document.body,"--agy-ui-pill-border",p.pillBorder);
  variable(document.body,"--agy-ui-pill-hover",p.pillHover);
  variable(document.body,"--agy-ui-code-bg",p.codeBg);
  variable(document.body,"--agy-ui-close-bg",p.closeBg);
  variable(document.body,"--agy-ui-close-hover",p.closeHover);
  variable(document.body,"--agy-dream-card-bg",p.cardBg);
  variable(document.body,"--agy-dream-chrome-bg",p.chromeBg);
  variable(document.body,"--agy-dream-base-bg",p.surface);
  for(const [name,value] of Object.entries(p.vars))variable(root,name,value);
  return p;
 }
 applyPalette(config.themePreset);
 let active=true,timer,observer,attrObserver,resize,geometryTarget=null,healing=false,instance;
 function ensureMounted(){
  if(!active||healing||!root.isConnected)return false;
  if(window[key]!==instance){destroy();return false;}
  healing=true;
  try{
   document.querySelectorAll("#agy-dream-wallpaper-v2").forEach(el=>{if(el!==layer)el.remove();});
   document.querySelectorAll("#agy-dream-style-v2").forEach(el=>{if(el!==style)el.remove();});
   if(!document.documentElement.classList.contains("agy-dream-active-v2"))document.documentElement.classList.add("agy-dream-active-v2");
   if(!style.isConnected&&document.head)document.head.append(style);
   if(!layer.isConnected&&document.body)document.body.prepend(layer);
   if(!root.hasAttribute("data-agy-dream-root"))root.setAttribute("data-agy-dream-root","");
   if(!root.hasAttribute("data-agy-dream-clear"))root.setAttribute("data-agy-dream-clear","");
   const wantPreset=PALETTES[config.themePreset]?config.themePreset:"violet";
   if(root.getAttribute("data-agy-theme-preset")!==wantPreset||!document.body.style.getPropertyValue("--agy-ui-surface"))applyPalette(wantPreset);
   const wantMode=config.outputMode==="glass"?"glass":"transparent";
   if(root.getAttribute("data-agy-output-mode")!==wantMode)root.setAttribute("data-agy-output-mode",wantMode);
   syncConversationAppearance();
  }finally{healing=false;}
  return true;
 }
 function geometry(){
  const pane=[...document.querySelectorAll(".agy-sheet")].sort((a,b)=>b.getBoundingClientRect().width*b.getBoundingClientRect().height-a.getBoundingClientRect().width*a.getBoundingClientRect().height)[0];
  const welcome=pane&&[...pane.querySelectorAll("div")].find(e=>e.classList.contains("pt-[30vh]")||e.getAttribute("data-testid")==="welcome-view");
  if(welcome)mark(welcome,"data-agy-dream-welcome");
  const region=pane||root,r=region.getBoundingClientRect();
  if(r.width>0&&r.height>0){
   Object.assign(layer.style,{inset:"auto",left:r.left+"px",top:r.top+"px",width:r.width+"px",height:r.height+"px",borderRadius:pane?"22px":"0"});
   if(resize&&geometryTarget!==region){if(geometryTarget&&geometryTarget!==root)resize.unobserve(geometryTarget);resize.observe(region);geometryTarget=region;}
   function resizeLayer(target,decoded){
    if(!target||!decoded?.naturalWidth||!decoded.naturalHeight)return;
    const factor=(config.fit==="contain"?Math.min(r.width/decoded.naturalWidth,r.height/decoded.naturalHeight):Math.max(r.width/decoded.naturalWidth,r.height/decoded.naturalHeight))*(config.zoom??1);
    const size="100% 100%,"+Math.round(decoded.naturalWidth*factor)+"px "+Math.round(decoded.naturalHeight*factor)+"px";
    const pos="center,"+(config.positionX??50)+"% "+(config.positionY??50)+"%";
    target.style.backgroundSize=size;target.style.backgroundPosition=pos;
   }
   resizeLayer(layer,committedImage);resizeLayer(incoming,image);
  }
  return{region,scope:pane||root,width:r.width,height:r.height};
 }
 function scan(){
  if(!active||!ensureMounted())return;
  // Release removed page nodes; restore them first so reattachment can be themed again.
  for(let i=saved.length-1;i>=0;i--)if(!saved[i][0].isConnected){restore(saved[i]);seen.delete(saved[i][0]);saved.splice(i,1);}
  const area=geometry();
  for(const p of area.scope.querySelectorAll(".surface-composer [data-agy-dream-protect],.surface-composer [data-agy-dream-card]")){p.removeAttribute("data-agy-dream-protect");p.removeAttribute("data-agy-dream-card");p.style.removeProperty("--agy-dream-old-bg");p.style.removeProperty("--agy-dream-card-bg");}
  for(const fade of area.scope.querySelectorAll(".absolute.bottom-0.pointer-events-none")){
   const rect=fade.getBoundingClientRect();
   if(rect.height<=80&&rect.width>area.width*.3&&getComputedStyle(fade).backgroundImage.includes("linear-gradient"))mark(fade,"data-agy-dream-fade");
  }
  for(let parent=area.scope;parent&&root.contains(parent);parent=parent.parentElement){if(!nativeBackgrounds.has(parent))nativeBackgrounds.set(parent,getComputedStyle(parent).backgroundColor);mark(parent,"data-agy-dream-clear");if(parent===root)break;}
  for(const article of area.scope.querySelectorAll(".scroll-mt-4,[role=article],.prose,.markdown-body,[data-markdown-root],.leading-relaxed.select-text")){
   if(article.matches(aiRole)&&!article.parentElement?.closest(aiRole)&&!article.closest(roleExcluded)){
    for(let shell=article.parentElement,depth=0;shell&&shell!==area.scope&&depth<4;shell=shell.parentElement,depth++){
     if(shell.querySelector(userRole+',form,.surface-composer')||shell.matches('button,[role=button],aside,nav'))break;
     mark(shell,'data-agy-ai-shell');
     if(shell.matches('.scroll-mt-4,[role=article]'))break;
    }
   }
   const plate=article.closest(".scroll-mt-4")||article;
   mark(plate,"data-agy-dream-reading");
   seen.add(plate);
   for(const segment of article.querySelectorAll("p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table")){
    if(!segment.parentElement.closest("ul,ol,blockquote,table,pre,.monaco-editor,.cm-editor,.xterm,form,.agy-user-bubble,[data-testid='user-message-bubble']"))
     mark(segment,"data-agy-dream-segment");
   }
  }
  for(const composer of area.scope.querySelectorAll(".surface-composer,form")){
   let parent=composer.parentElement;
   while(parent&&parent!==root&&parent!==document.body){
    if(parent.hasAttribute("data-agy-dream-card")){
     parent.removeAttribute("data-agy-dream-card");
     parent.style.removeProperty("--agy-dream-card-bg");
    }
    if(parent.hasAttribute("data-agy-dream-protect")){
     parent.removeAttribute("data-agy-dream-protect");
     parent.style.removeProperty("--agy-dream-old-bg");
    }
    if(!parent.hasAttribute("data-agy-dream-clear"))mark(parent,"data-agy-dream-clear");
    parent=parent.parentElement;
   }
  }
  for(const el of root.querySelectorAll("div,main,section,aside,nav,header,form,textarea,pre,code,[contenteditable=true],[role=dialog],[role=menu],[role=listbox]")){
   if(!area.scope.contains(el))continue;
   if(el===layer||el===style||el.closest("#agy-dream-wallpaper-v2"))continue;
   const alreadyMarked=el.hasAttribute("data-agy-dream-protect")||el.hasAttribute("data-agy-dream-chrome")||el.hasAttribute("data-agy-dream-card")||el.hasAttribute("data-agy-dream-clear");
   if(seen.has(el)&&alreadyMarked)continue;
   if(el.closest(".agy-user-bubble,[data-testid='user-message-bubble'],.agy-user-bubble-frame,[data-testid='user-input-step'],.surface-composer,form"))continue;
   const rect=el.getBoundingClientRect();if(rect.width<1||rect.height<1)continue;
   const css=getComputedStyle(el),bg=css.backgroundColor;
   nativeBackgrounds.set(el,bg);
   if(el.matches(protect)){
    mark(el,"data-agy-dream-protect");variable(el,"--agy-dream-old-bg",surfaceBackground(el));seen.add(el);continue;
   }
   if(el.closest(protect))continue;
   if(bg!=="rgba(0, 0, 0, 0)"&&bg!=="transparent"&&(el.matches("aside,nav,header,[role=navigation]")||(rect.width<innerWidth*.35&&rect.height>innerHeight*.55)||(rect.top<90&&rect.width>innerWidth*.65&&rect.height<110))){
    mark(el,"data-agy-dream-chrome");seen.add(el);continue;
   }
   if(el.matches(".surface-composer,.surface-composer-card,form")){
    mark(el,"data-agy-dream-card");seen.add(el);continue;
   }
   if(el.matches("div,main,section")&&rect.width>innerWidth*.42&&rect.height>innerHeight*.36){
    mark(el,"data-agy-dream-clear");seen.add(el);
   }
  }
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(scan,120);}
 function onWindowLifecycle(){
  if(!ensureMounted())return;
  schedule();
  if(!foreground()){
   pauseIncoming();
  }else if(deferred){void update(deferred);}
  else if(incoming)for(const anim of incoming.getAnimations?.()||[]){
   if(anim.playState==="finished")anim.onfinish?.();else anim.play();
  }
 }
 const wallpaperKey=value=>JSON.stringify([value.image,value.themePreset,value.scrim,value.fit,value.zoom,value.positionX,value.positionY,value.transition]);
 function syncConversationAppearance(){
  const chatCustom=/^#[0-9a-f]{6}$/i.test(config.chatTint||"")||Number.isFinite(config.chatOpacity);
  if(root.hasAttribute("data-agy-chat-custom")!==chatCustom)root.toggleAttribute("data-agy-chat-custom",chatCustom);
  const chatHex=/^#[0-9a-f]{6}$/i.test(config.chatTint||"")?config.chatTint.slice(1):(dark?"181224":"fffaff");
  const values={"--agy-chat-rgb":[0,2,4].map(i=>parseInt(chatHex.slice(i,i+2),16)).join(","),
   "--agy-chat-alpha":String((Number.isFinite(config.chatOpacity)?Math.max(0,Math.min(100,config.chatOpacity)):100)/100),
   "--agy-reply-alpha":String((Number.isFinite(config.replyOpacity)?Math.max(0,Math.min(100,config.replyOpacity)):(config.outputMode==="glass"?22:0))/100)};
  for(const [name,value] of Object.entries(values))if(root.style.getPropertyValue(name)!==value)variable(root,name,value);
 }
 function applyAppearance(next){
  config=next;
  const p=applyPalette(config.themePreset);
  root.setAttribute("data-agy-output-mode",config.outputMode==="glass"?"glass":"transparent");
  syncConversationAppearance();
  layer.style.opacity=String(config.opacity??.55);
  return p;
 }
 const appearanceKeys=['chatTint','chatOpacity','replyOpacity','opacity','outputMode'];
 function updateAppearance(patch){
  if(!active||window[key]!==instance)return status();
  const values=Object.fromEntries(appearanceKeys.filter(k=>Object.hasOwn(patch,k)).map(k=>[k,patch[k]]));
  latest={...latest,...values};config={...config,...values};
  if(deferred)deferred={...deferred,...values};
  const mode=config.outputMode==='glass'?'glass':'transparent';
  if(root.getAttribute('data-agy-output-mode')!==mode)root.setAttribute('data-agy-output-mode',mode);
  syncConversationAppearance();
  const opacity=String(config.opacity??.55);if(layer.style.opacity!==opacity)layer.style.opacity=opacity;
  return status();
 }
 async function update(next){
  if(!active||window[key]!==instance)return;
  latest=next;
  if(!deferred&&layer.style.backgroundImage&&wallpaperKey(next)===wallpaperKey(config)&&(incoming||next.image===currentSrc)){
   if(pendingDecode!==null){++wallpaperGen;pendingDecode=null;}
   applyAppearance(next);scan();return;
  }
  const thisGen=++wallpaperGen;
  pendingDecode=null;
  const wantsFade=next.transition!=="none"&&Boolean(currentSrc)&&next.image!==currentSrc;
  if(wantsFade&&!foreground()){deferWallpaper(next);return;}
  deferred=null;
  let crossfade=false;
  if(next.image&&next.image!==currentSrc){
   pendingDecode=wallpaperKey(next);
   const fresh=new Image();fresh.src=next.image;
   try{await fresh.decode();}catch{if(thisGen===wallpaperGen){pendingDecode=null;image=committedImage;}return;}
   if(thisGen!==wallpaperGen||!active||!root.isConnected)return;
   pendingDecode=null;
   if(wantsFade&&!foreground()){deferWallpaper(next);return;}
   image=fresh;
   crossfade=next.transition!=="none"&&layer.isConnected&&Boolean(currentSrc);
  }else image=committedImage;
  // A small appearance update can arrive while this image is decoding. Keep
  // that newer preference when committing the wallpaper, without restarting it.
  next={...next,...Object.fromEntries(appearanceKeys.filter(k=>Object.hasOwn(latest,k)).map(k=>[k,latest[k]]))};
  const p=applyAppearance(next);
  document.querySelectorAll("#agy-dream-wallpaper-v2").forEach(el=>{if(el!==layer)el.remove();});
  const region=document.querySelector(".agy-sheet")||root;
  const r=region.getBoundingClientRect();
  const factor=(r.width>0&&r.height>0&&image.naturalWidth>0&&image.naturalHeight>0)?(config.fit==="contain"?Math.min(r.width/image.naturalWidth,r.height/image.naturalHeight):Math.max(r.width/image.naturalWidth,r.height/image.naturalHeight))*(config.zoom??1):1;
  if(!crossfade){
   commitIncoming(config.image,p,factor,config);
  }else{
   retainIncoming();
   const inc=document.createElement("div");inc.className="agy-dream-wallpaper-incoming";
   Object.assign(inc.style,{
    position:"absolute",inset:"0",pointerEvents:"none",borderRadius:"inherit",
    backgroundRepeat:"no-repeat",backgroundPosition:"center,"+(config.positionX??50)+"% "+(config.positionY??50)+"%",
    backgroundImage:'linear-gradient(rgba('+p.scrimRgb+','+config.scrim+'),rgba('+p.scrimRgb+','+config.scrim+')),url("'+config.image+'")',
    backgroundSize:"100% 100%,"+Math.round(image.naturalWidth*factor)+"px "+Math.round(image.naturalHeight*factor)+"px",
    backgroundColor:config.fit==="adaptive"?p.adaptiveBg:"transparent",
    opacity:"0"
   });
   layer.appendChild(inc);incoming=inc;
   try{
    const anim=inc.animate([{opacity:0},{opacity:1}],{duration:1200,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});
    anim.onfinish=()=>{
     if(incoming!==inc)return;
     if(!foreground())return;
     commitIncoming(next.image,p,factor,next);
    };
   }catch{commitIncoming(config.image,p,factor,config);}
  }
  scan();
 }
 function destroy(){
  active=false;clearTimeout(timer);observer?.disconnect();attrObserver?.disconnect();resize?.disconnect();
  window.removeEventListener("focus",onWindowLifecycle);window.removeEventListener("blur",onWindowLifecycle);document.removeEventListener("visibilitychange",onWindowLifecycle);
  deferred=null;discardIncoming();
  style.remove();layer.remove();
  if(window[key]===instance){
   document.documentElement.classList.remove("agy-dream-active-v2");
   for(const entry of saved.reverse())restore(entry);
   delete window[key];
  }
  saved.length=0;
  return{removed:true};
 }
 document.querySelectorAll("#agy-dream-wallpaper-v2").forEach(el => el.remove());
 document.head.append(style);document.body.prepend(layer);document.documentElement.classList.add("agy-dream-active-v2");
 observer=new MutationObserver(schedule);observer.observe(root,{childList:true,subtree:true});
 attrObserver=new MutationObserver(records=>{if(!healing){ensureMounted();if(records.some(r=>r.attributeName==='class'))schedule();}});
 attrObserver.observe(document.documentElement,{attributes:true,attributeFilter:["class","style"]});
 if(document.body)attrObserver.observe(document.body,{attributes:true,attributeFilter:["class","style"]});
 attrObserver.observe(root,{attributes:true,attributeFilter:["class","style"]});
 window.addEventListener("focus",onWindowLifecycle,{passive:true});
 window.addEventListener("blur",onWindowLifecycle,{passive:true});
 document.addEventListener("visibilitychange",onWindowLifecycle,{passive:true});
 resize=new ResizeObserver(schedule);resize.observe(root);
 const status=()=>({defaultChatTint:dark?"#181224":"#fffaff",applied:Boolean(active&&root.isConnected&&layer.isConnected&&style.isConnected&&document.documentElement.classList.contains("agy-dream-active-v2")),wallpaper:{selected:latest.wallpaperId||null,presented:presentedId,transitioning:!!incoming,deferred:!!deferred,decoding:pendingDecode!==null},themePreset:root.getAttribute("data-agy-theme-preset")||"violet",protected:root.querySelectorAll("[data-agy-dream-protect]").length,surfaces:root.querySelectorAll("[data-agy-dream-clear]").length,trackedChanges:saved.length});
 instance={update,updateAppearance,destroy,status,owner:config.owner,engineRevision};window[key]=instance;
 await update(config);return status();
 }catch(error){mounting.error=error;throw error;}
 finally{if(window[mountKey]===mounting)delete window[mountKey];finishMount();}
}
module.exports={installTheme};
