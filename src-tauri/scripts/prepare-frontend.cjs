const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");
const widgetRoot = path.join(repoRoot, "Antigravity-Cat-Widget");
const tauriRoot = path.resolve(__dirname, "..");
const outDir = path.join(tauriRoot, "frontend-dist");
const optimizeArt = process.argv.includes("--optimize-art");

function copyFileRel(srcBase, relPath) {
  const src = path.join(srcBase, relPath);
  const dst = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDirRel(srcBase, relDir) {
  const src = path.join(srcBase, relDir);
  const dst = path.join(outDir, relDir);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

async function optimizeCharacterPacks() {
  const sharp = require("sharp");
  const packsRoot = path.join(outDir, "assets/character-packs");
  const keepMap = {
    "gemini-star-v1": new Set(["idle.png", "blink.png", "proud-v3.png", "sad.png", "shy.png"]),
    "lin-cat": new Set(["idle.png", "blink.png", "proud.png", "sad.png", "shy.png"])
  };

  for (const packId of Object.keys(keepMap)) {
    const framesDir = path.join(packsRoot, packId, "frames");
    if (!fs.existsSync(framesDir)) continue;
    const keep = keepMap[packId];
    for (const entry of fs.readdirSync(framesDir)) {
      const full = path.join(framesDir, entry);
      if (!keep.has(entry)) {
        fs.rmSync(full, { force: true });
        continue;
      }
      const webpPath = full.replace(/\.png$/i, ".webp");
      await sharp(full)
        .resize(640, 640, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 90, alphaQuality: 95, effort: 5 })
        .toFile(webpPath);
      fs.rmSync(full, { force: true });
    }
  }

  // Only update the staged frontend-dist copy so renderer.cjs and widgetApi load the .webp frames.
  const stagedRenderer = path.join(outDir, "src/renderer/renderer.cjs");
  let code = fs.readFileSync(stagedRenderer, "utf8");
  code = replaceRequired(code,
    'const files={idle:"idle.png",blink:"blink.png",proud:pack==="lin-cat"?"proud.png":"proud-v3.png",sad:"sad.png",shy:"shy.png"};',
    'const files={idle:"idle.webp",blink:"blink.webp",proud:pack==="lin-cat"?"proud.webp":"proud-v3.webp",sad:"sad.webp",shy:"shy.webp"};'
  );
  fs.writeFileSync(stagedRenderer, code, "utf8");

  const stagedApiPath = path.join(outDir, "src/renderer/tauri-widget-api.js");
  let stagedApi = fs.readFileSync(stagedApiPath, "utf8").replace(/\r\n/g, "\n");
  stagedApi = replaceRequired(
    stagedApi,
    "const USE_OPTIMIZED_PACK_WEBP = false;",
    "const USE_OPTIMIZED_PACK_WEBP = true;",
    "tauri-widget-api.js USE_OPTIMIZED_PACK_WEBP"
  );
  fs.writeFileSync(stagedApiPath, stagedApi, "utf8");
}

function patchStagedIndexHtml() {
  const htmlPath = path.join(outDir, "src/renderer/index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = replaceRequired(html,
    "connect-src 'none'",
    "connect-src 'self' ipc: http://ipc.localhost"
  );
  html = replaceRequired(html,
    "img-src 'self' file:;",
    "img-src 'self' data: http://127.0.0.1:*;"
  );
  if (!html.includes('src="tauri-widget-api.js"')) {
    html = replaceRequired(html,
      '<script src="personality.js"></script>',
      '<script src="tauri-widget-api.js"></script><script src="personality.js"></script>'
    );
  }
  fs.writeFileSync(htmlPath, html, "utf8");
}

function replaceRequired(text, target, replacement, label = target) {
  if (!text.includes(target)) {
    throw new Error(`Expected pattern (${label}) was not found during frontend staging`);
  }
  return text.replace(target, replacement);
}

function stageHudSettingsFiles() {
  const hudRoot = path.join(tauriRoot, "settings-hud");
  for (const name of ["settings.html", "settings.css", "settings.js"]) {
    const src = path.join(hudRoot, name);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing HUD settings asset: ${src}`);
    }
    const dst = path.join(outDir, "src/renderer", name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

function patchStagedPetScripts() {
  const personalityPath = path.join(outDir, "src/renderer/personality.js");
  const personality = replaceRequired(
    fs.readFileSync(personalityPath, "utf8"),
    'mode==="zayu"?"杂鱼君":custom',
    'custom',
    "personality.js honorific migration"
  );
  fs.writeFileSync(personalityPath, personality, "utf8");
  const sideQuotaPath = path.join(outDir, "src/renderer/side-quota.js");
  let sideQuota = fs.readFileSync(sideQuotaPath, "utf8").replace(/\r\n/g, "\n");
  sideQuota = replaceRequired(
    sideQuota,
`    const isArgon = Boolean(q.modelInfo?.modelName?.toLowerCase().includes("argon"));
    const manual = s.manualQuota === true;

    const agyFive = manual
      ? finitePct(s.manualPercent)
      : finitePct(isArgon ? (q.argon?.fiveHour ?? gData?.fiveHour ?? q.fiveHour) : (gData?.fiveHour ?? q.fiveHour));
    const agyWeek = manual
      ? finitePct(s.manualWeeklyPercent)
      : finitePct(isArgon ? (q.argon?.weekly ?? gData?.weekly ?? q.weekly) : (gData?.weekly ?? q.weekly));

    const agyResets = isArgon ? (q.argon?.fiveHourReset || gData?.fiveHourReset || q.fiveHourReset || q.argon?.resetsAt || q.resetsAt) : (gData?.fiveHourReset || q.fiveHourReset || q.resetsAt);
    const agyWeekResets = isArgon ? (q.argon?.weeklyReset || q.argon?.weeklyResetsAt || gData?.weeklyReset || q.weeklyReset || q.weeklyResetsAt) : (gData?.weeklyReset || q.weeklyReset || q.weeklyResetsAt);`,
`    const manual = s.manualQuota === true;

    const agyFive = manual ? finitePct(s.manualPercent) : finitePct(gData?.fiveHour ?? q.fiveHour);
    const agyWeek = manual ? finitePct(s.manualWeeklyPercent) : finitePct(gData?.weekly ?? q.weekly);

    const agyResets = gData?.fiveHourReset || q.fiveHourReset || q.resetsAt;
    const agyWeekResets = gData?.weeklyReset || q.weeklyReset || q.weeklyResetsAt;`,
    "side-quota.js Argon removal"
  );
  fs.writeFileSync(sideQuotaPath, sideQuota, "utf8");

  const rendererPath = path.join(outDir, "src/renderer/renderer.cjs");
  let renderer = fs.readFileSync(rendererPath, "utf8").replace(/\r\n/g, "\n");
  renderer = replaceRequired(
    renderer,
` const getPages=()=>{
  const list=["quota"];
  if(hasWebData())list.push("webQuota");
/* @byok-dev-start */
  if(snapshot?.byok?.available)list.push("claudeGpt");
/* @byok-dev-end */
  list.push("talk","today","latest");
  return list;
 };`,
` const hasClaudeGptQuota=()=>{
  const cg=snapshot?.quotaWindows?.claudeGpt;
  return Boolean(cg&&(typeof cg.fiveHour==="number"||typeof cg.weekly==="number"));
 };
 const getPages=()=>{
  const list=["quota"];
  if(hasWebData())list.push("webQuota");
  if(hasClaudeGptQuota()||snapshot?.byok?.available)list.push("claudeGpt");
  list.push("talk","today","latest");
  return list;
 };`,
    "renderer.cjs getPages claudeGpt"
  );
  renderer = replaceRequired(
    renderer,
`   const gData=q?.gemini||q;
   const isArgon=Boolean(q?.modelInfo?.modelName?.toLowerCase().includes("argon"));
   const hasArgonQuota=typeof q?.argon?.weekly==="number";
   const fiveVal=s.manualQuota?s.manualPercent:gData?.fiveHour;
   const weekVal=s.manualQuota?s.manualWeeklyPercent:(isArgon&&hasArgonQuota?q.argon.weekly:gData?.weekly);
   const fiveReset=s.manualQuota?"":gData?.fiveHourReset||"";
   const weekReset=s.manualQuota?"":(isArgon&&hasArgonQuota?(q.argon.weeklyReset||""):gData?.weeklyReset||"");
   if($("label-5h"))$("label-5h").textContent=isArgon?"5 小时 (共享)":"5 小时";
   if($("label-week"))$("label-week").textContent=isArgon?"1 周 (Argon WTU)":"1 周";`,
`   const gData=q?.gemini||q;
   const fiveVal=s.manualQuota?s.manualPercent:gData?.fiveHour;
   const weekVal=s.manualQuota?s.manualWeeklyPercent:gData?.weekly;
   const fiveReset=s.manualQuota?"":gData?.fiveHourReset||"";
   const weekReset=s.manualQuota?"":gData?.weeklyReset||"";
   if($("label-5h"))$("label-5h").textContent="5 小时";
   if($("label-week"))$("label-week").textContent="1 周";`,
    "renderer.cjs quota Argon removal"
  );
  renderer = replaceRequired(
    renderer,
`   let extraHint="";if(isArgon&&typeof gData?.weekly==="number"){extraHint=" · 通用周额度余 "+Math.round(gData.weekly)+"%";}else if(!isArgon&&hasArgonQuota){extraHint=" · 🪐 Argon 余 "+Math.round(q.argon.weekly)+"%";}`,
`   const extraHint="";`,
    "renderer.cjs extraHint Argon removal"
  );
  renderer = replaceRequired(
    renderer,
`/* @byok-dev-start */
  }else if(selected==="claudeGpt"){
   const b=snapshot.byok||{},ap=b.activeProvider,choices=Array.isArray(b.enabledModelChoices)?b.enabledModelChoices:[];`,
`  }else if(selected==="claudeGpt"&&hasClaudeGptQuota()){
   $("quota").hidden=false;
   $("title").textContent="Claude / GPT";
   const q=snapshot.quotaWindows,cg=q?.claudeGpt||{};
   const tag=$("model-tag");if(tag)tag.hidden=true;
   if($("label-5h"))$("label-5h").textContent="5 小时";
   if($("label-week"))$("label-week").textContent="1 周";
   for(const [suffix,value,resetStr] of [["",cg.fiveHour,cg.fiveHourReset||""],["-week",cg.weekly,cg.weeklyReset||""]]){
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
   $("caption").textContent=q?.stale?"上次读取 · 待更新":q?.cached?"上次读取":"共享配额池 · Antigravity";
   $("meta").textContent="";
/* @byok-dev-start */
  }else if(selected==="claudeGpt"){
   const b=snapshot.byok||{},ap=b.activeProvider,choices=Array.isArray(b.enabledModelChoices)?b.enabledModelChoices:[];`,
    "renderer.cjs claudeGpt render"
  );
  renderer = replaceRequired(
    renderer,
`  if((nextClicks===2||nextClicks===3)&&snapshot?.byok?.available&&selected!=="claudeGpt"&&selected!=="talk")return false;`,
`  if((nextClicks===2||nextClicks===3)&&(hasClaudeGptQuota()||snapshot?.byok?.available)&&selected!=="claudeGpt"&&selected!=="talk")return false;`,
    "renderer.cjs willLandOnTalk claudeGpt"
  );
  renderer = replaceRequired(
    renderer,
`  } else if ((consecutiveClicks === 2 || consecutiveClicks === 3) && snapshot?.byok?.available && selected !== "claudeGpt" && selected !== "talk") {`,
`  } else if ((consecutiveClicks === 2 || consecutiveClicks === 3) && (hasClaudeGptQuota() || snapshot?.byok?.available) && selected !== "claudeGpt" && selected !== "talk") {`,
    "renderer.cjs activate claudeGpt"
  );
  fs.writeFileSync(rendererPath, renderer, "utf8");
}

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

async function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const rendererFiles = [
    "src/renderer/index.html",
    "src/renderer/widget.css",
    "src/renderer/side-quota.css",
    "src/renderer/personality.js",
    "src/renderer/pet-behavior.js",
    "src/renderer/ambient.js",
    "src/renderer/side-quota.js",
    "src/renderer/renderer.cjs"
  ];
  for (const rel of rendererFiles) copyFileRel(widgetRoot, rel);

  copyFileRel(widgetRoot, "assets/motions/gemini-widget.css");
  for (const fx of ["thinking-dots.svg", "sparkle.svg", "teardrop.svg", "heart.svg"]) {
    copyFileRel(widgetRoot, `assets/ui/effects/${fx}`);
  }
  copyFileRel(widgetRoot, "assets/audio/codex-maid-widget/manifest.json");
  copyDirRel(widgetRoot, "assets/audio/codex-maid-widget/files");

  for (const pack of ["gemini-star-v1", "lin-cat"]) {
    copyFileRel(widgetRoot, `assets/character-packs/${pack}/manifest.json`);
    const framesDir = path.join(widgetRoot, `assets/character-packs/${pack}/frames`);
    for (const file of fs.readdirSync(framesDir)) {
      if (file.endsWith(".png")) {
        copyFileRel(widgetRoot, `assets/character-packs/${pack}/frames/${file}`);
      }
    }
  }

  fs.copyFileSync(
    path.join(__dirname, "tauri-widget-api.js"),
    path.join(outDir, "src/renderer/tauri-widget-api.js")
  );
  patchStagedIndexHtml();
  stageHudSettingsFiles();
  patchStagedPetScripts();

  if (optimizeArt) {
    await optimizeCharacterPacks();
  }

  const totalBytes = dirSizeBytes(outDir);
  const artBytes = dirSizeBytes(path.join(outDir, "assets/character-packs"));
  console.log(JSON.stringify({
    ok: true,
    optimizeArt,
    frontendDist: outDir,
    totalMB: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
    characterPacksMB: Math.round((artBytes / (1024 * 1024)) * 100) / 100
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
