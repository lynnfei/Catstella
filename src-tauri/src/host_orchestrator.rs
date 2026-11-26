use crate::host_cdp::{discover_host, is_host_process_running, CdpClient, DiscoveredHost};
use crate::state::{now_ms, SharedApp};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const SKIN_OWNER: &str = "catstella-tauri-host";
pub const LOC_OWNER: &str = "catstella-tauri-zh";

// installTheme chooses its palette from the native background once. During
// cold startup the document can be complete before the workbench CSS arrives.
const INSPECT_SKIN_JS: &str = r#"(() => {
 const skin = window.__agyDreamSkinV2;
 if (skin?.owner === 'catstella-tauri-host') skin.resumeWallpaper?.();
 const root = document.querySelector('#root,#app');
 const sheet = root?.querySelector('.agy-sheet');
 let hydrated = false;
 if (document.readyState === 'complete' && sheet?.getBoundingClientRect().width > 0) {
  if (skin?.status?.().applied) {
   hydrated = true;
  } else if (getComputedStyle(root).getPropertyValue('--background').trim()) {
   for (let node = root; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    const rgb = color.match(/[\d.]+/g)?.map(Number);
    if (!rgb || rgb.length < 3 || (rgb.length > 3 && rgb[3] < 1)) continue;
    const dark = root.closest('.dark,[data-theme="dark"]') || document.body.matches('.dark,.dark-theme,.theme-dark');
    hydrated = !dark || rgb.slice(0,3).reduce((a,b) => a+b,0) < 360;
    break;
   }
  }
 }
 return {ready:document.readyState,hydrated,themed:!!skin?.status?.().applied,
  owner:skin?.owner,appearance:typeof skin?.updateAppearance === 'function'};
})()"#;

pub const THEME_JS_RAW: &str = include_str!("../../Antigravity-Dream-Skin/src/host/theme.cjs");
pub const LOCALIZE_JS_RAW: &str = include_str!("../../Antigravity-Dream-Skin/src/host/localize.cjs");
pub const ZH_CN_DICT_RAW: &str =
    include_str!("../../Antigravity-Dream-Skin/assets/localization/zh-CN.json");

const APPEARANCE_KEYS: &[&str] = &[
    "chatTint",
    "chatOpacity",
    "replyOpacity",
    "opacity",
    "outputMode",
];

pub const EXTRACT_MODEL_INFO_JS: &str = r#"function extractModelInfo(doc=document){
 if(typeof doc==='undefined'||!doc||typeof doc.querySelector!=='function')return null;
 const candidates=[
  doc.querySelector('[data-testid="model-selector-trigger"]'),
  doc.querySelector('button[aria-label*="model" i][aria-label*="current:" i],button[aria-label*="模型"][aria-label*="当前："]'),
  doc.querySelector('button[aria-label*="current:"],button[aria-label*="当前："]')
 ];
 const modelBtn=candidates.find(el=>{
  if(!el)return false;
  if(typeof el.getAttribute!=='function')return true;
  if(el.getAttribute('data-testid')==='permissions-selector-trigger')return false;
  const a=el.getAttribute('aria-label')||'';
  return !/(?:permission|权限)/i.test(a);
 })||null;
 if(!modelBtn)return null;
 const aria=modelBtn.getAttribute('aria-label')||'';
 const currentMatch=aria.match(/(?:current:|当前[：:])\s*(.+)$/i);
 const fullText=(currentMatch?currentMatch[1]:modelBtn.innerText).replace(/\s+/g,' ').trim();
 if(!fullText)return null;
 const parenMatch=fullText.match(/\(\s*(Extra\s+High|Very\s+High|XHigh|Extra|High|Medium|Low|Minimal|Max|None|Off|Extended|Auto)(?:\s+thinking)?\s*\)/i);
 const wordMatch=parenMatch?null:fullText.match(/\b(Extra\s+High|Very\s+High|XHigh|Extra|High|Medium|Low|Minimal|Max|None|Off|Extended|Auto)\b/i);
 const matched=parenMatch||wordMatch;
 const thinking=matched?matched[1].replace(/\s+/g,' ').trim():null;
 const rawModelName=matched?(fullText.slice(0,matched.index)+' '+fullText.slice(matched.index+matched[0].length)).replace(/\s{2,}/g,' ').trim():fullText;
 let orchestrator=false;
 let modelName=rawModelName;
 if(/^Orchestrator(?:\s+|$)/i.test(modelName)){
  orchestrator=true;
  const rest=modelName.replace(/^Orchestrator\s*/i,'').trim();
  if(rest){
   const unwrapped=rest.match(/^\(([^()]+)\)$/);
   modelName=unwrapped?unwrapped[1].trim():rest;
  }
 }
 return {modelName,thinking:thinking||"默认",orchestrator,fullText};
}"#;

pub const QUOTA_AND_MODEL_EVAL_JS: &str = r#"(async()=>{
function extractModelInfo(doc=document){
 if(typeof doc==='undefined'||!doc||typeof doc.querySelector!=='function')return null;
 const candidates=[
  doc.querySelector('[data-testid="model-selector-trigger"]'),
  doc.querySelector('button[aria-label*="model" i][aria-label*="current:" i],button[aria-label*="模型"][aria-label*="当前："]'),
  doc.querySelector('button[aria-label*="current:"],button[aria-label*="当前："]')
 ];
 const modelBtn=candidates.find(el=>{
  if(!el)return false;
  if(typeof el.getAttribute!=='function')return true;
  if(el.getAttribute('data-testid')==='permissions-selector-trigger')return false;
  const a=el.getAttribute('aria-label')||'';
  return !/(?:permission|权限)/i.test(a);
 })||null;
 if(!modelBtn)return null;
 const aria=modelBtn.getAttribute('aria-label')||'';
 const currentMatch=aria.match(/(?:current:|当前[：:])\s*(.+)$/i);
 const fullText=(currentMatch?currentMatch[1]:modelBtn.innerText).replace(/\s+/g,' ').trim();
 if(!fullText)return null;
 const parenMatch=fullText.match(/\(\s*(Extra\s+High|Very\s+High|XHigh|Extra|High|Medium|Low|Minimal|Max|None|Off|Extended|Auto)(?:\s+thinking)?\s*\)/i);
 const wordMatch=parenMatch?null:fullText.match(/\b(Extra\s+High|Very\s+High|XHigh|Extra|High|Medium|Low|Minimal|Max|None|Off|Extended|Auto)\b/i);
 const matched=parenMatch||wordMatch;
 const thinking=matched?matched[1].replace(/\s+/g,' ').trim():null;
 const rawModelName=matched?(fullText.slice(0,matched.index)+' '+fullText.slice(matched.index+matched[0].length)).replace(/\s{2,}/g,' ').trim():fullText;
 let orchestrator=false;
 let modelName=rawModelName;
 if(/^Orchestrator(?:\s+|$)/i.test(modelName)){
  orchestrator=true;
  const rest=modelName.replace(/^Orchestrator\s*/i,'').trim();
  if(rest){
   const unwrapped=rest.match(/^\(([^()]+)\)$/);
   modelName=unwrapped?unwrapped[1].trim():rest;
  }
 }
 return {modelName,thinking:thinking||"默认",orchestrator,fullText};
}
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
 const result={...empty(),claudeGpt:empty(),fetchedAt:null};
 let gemini=null,geminiFallback=null,claude=null;
 const isGeminiFallbackGroup=g=>typeof g?.displayName==='string'&&/gemini/i.test(g.displayName)&&!isModelGroup(g.displayName)&&Array.isArray(g.buckets)&&g.buckets.length>0;
 const groups=typeof nY!=='undefined'&&Array.isArray(nY)?nY:typeof pY!=='undefined'&&Array.isArray(pY)?pY:[];
 for(const g of groups){
  if(!g)continue;
  if(g.displayName==='Gemini Models'&&!gemini)gemini=g;
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
       if(g.displayName==='Gemini Models'&&!gemini)gemini=g;
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
 const timestamp=typeof nY!=='undefined'&&Array.isArray(nY)&&typeof mFb==='number'?mFb:typeof jFb==='number'?jFb:null;
 if(typeof timestamp==='number'&&Number.isFinite(timestamp)&&timestamp>0&&timestamp<=Date.now()+60000)result.fetchedAt=timestamp;
 return result;
}
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
   const gemini=groups.find(g=>g?.displayName==='Gemini Models')||groups.find(g=>typeof g?.displayName==='string'&&/gemini/i.test(g.displayName)&&!isModelGroup(g.displayName)&&Array.isArray(g.buckets)&&g.buckets.length>0);
   if(!gemini)throw Error('Gemini quota group unavailable');
   const result=collect(gemini);
   result.cacheAvailable=true;
   result.liveQuery=true;
   result.claudeGpt=empty();
   const claude=groups.find(g=>isModelGroup(g.displayName));
   if(claude)result.claudeGpt=collect(claude);
   return result;
  }
 }
 return readCache();
}
return {modelInfo:extractModelInfo(),...(await queryHostQuota(readHostQuota))};
})()"#;

struct WakeSignal {
    mu: Mutex<u64>,
    cv: Condvar,
}

impl WakeSignal {
    fn new() -> Self {
        Self {
            mu: Mutex::new(0),
            cv: Condvar::new(),
        }
    }

    fn notify(&self) {
        let mut seq = self.mu.lock().unwrap();
        *seq = seq.wrapping_add(1);
        self.cv.notify_all();
    }

    fn current(&self) -> u64 {
        *self.mu.lock().unwrap()
    }

    fn wait_for_change_or_timeout(&self, last_seq: &mut u64, timeout: Duration, stop: &AtomicBool) {
        let deadline = Instant::now() + timeout;
        let mut seq = self.mu.lock().unwrap();
        loop {
            if stop.load(Ordering::Relaxed) || *seq != *last_seq {
                *last_seq = *seq;
                return;
            }
            let now = Instant::now();
            if now >= deadline {
                return;
            }
            let slice = deadline.saturating_duration_since(now).min(Duration::from_millis(250));
            let (next_seq, _) = self.cv.wait_timeout(seq, slice).unwrap();
            seq = next_seq;
        }
    }
}

pub fn strip_cjs_export(src: &str) -> &str {
    let trimmed = src.trim_end();
    if let Some(pos) = trimmed.rfind("module.exports") {
        let before = &trimmed[..pos];
        if before.is_empty() || before.ends_with('\n') || before.ends_with(';') || before.ends_with('}') {
            return before.trim_end();
        }
    }
    trimmed
}

pub fn filter_localization_dict(raw_json: &str) -> Map<String, Value> {
    let mut out = Map::new();
    if let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(raw_json) {
        for (k, v) in obj {
            if !k.starts_with('$') {
                out.insert(k, v);
            }
        }
    }
    out
}

pub fn appearance_payload_from_skin(settings: &Map<String, Value>) -> Value {
    let output_mode = if settings.get("outputMode").and_then(|v| v.as_str()) == Some("glass") {
        "glass"
    } else {
        "transparent"
    };
    let chat_tint = settings
        .get("chatTint")
        .and_then(|v| v.as_str())
        .filter(|s| s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit()))
        .unwrap_or("");
    let chat_opacity = settings
        .get("chatOpacity")
        .and_then(|v| v.as_f64())
        .filter(|n| n.is_finite())
        .map(|n| json!(n.clamp(0.0, 100.0)))
        .unwrap_or(Value::Null);
    let reply_opacity = settings
        .get("replyOpacity")
        .and_then(|v| v.as_f64())
        .filter(|n| n.is_finite())
        .map(|n| json!(n.clamp(0.0, 100.0)))
        .unwrap_or(Value::Null);
    let opacity = settings
        .get("opacity")
        .and_then(|v| v.as_f64())
        .filter(|n| n.is_finite())
        .unwrap_or(55.0)
        .clamp(0.0, 100.0)
        / 100.0;

    json!({
        "outputMode": output_mode,
        "chatTint": chat_tint,
        "chatOpacity": chat_opacity,
        "replyOpacity": reply_opacity,
        "opacity": opacity
    })
}

pub fn same_wallpaper_settings(previous: &Map<String, Value>, current: &Map<String, Value>) -> bool {
    let mut keys: HashSet<&str> = previous.keys().map(String::as_str).collect();
    keys.extend(current.keys().map(String::as_str));
    for k in keys {
        if APPEARANCE_KEYS.contains(&k) {
            continue;
        }
        if previous.get(k) != current.get(k) {
            return false;
        }
    }
    true
}

fn image_mime_for_file(path: &PathBuf, bytes: &[u8]) -> &'static str {
    if bytes.len() >= 4 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4e && bytes[3] == 0x47 {
        return "image/png";
    }
    if bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] == 0xd8 {
        return "image/jpeg";
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return "image/webp";
    }
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "image/png",
    }
}

fn build_theme_install_expression(
    dream_skin: &Map<String, Value>,
    wallpaper_id: &str,
    wallpaper_path: &PathBuf,
) -> Result<String, String> {
    let bytes = fs::read(wallpaper_path).map_err(|e| format!("读取壁纸失败: {e}"))?;
    let mime = image_mime_for_file(wallpaper_path, &bytes);
    let data_uri = format!("data:{mime};base64,{}", B64.encode(&bytes));

    let theme_preset = match dream_skin.get("themePreset").and_then(|v| v.as_str()) {
        Some(p @ ("violet" | "pink" | "ocean" | "onyx")) => p,
        _ => "violet",
    };
    let app_json = appearance_payload_from_skin(dream_skin);
    let pos_x = dream_skin
        .get("positionX")
        .and_then(|v| v.as_f64())
        .unwrap_or(50.0)
        .clamp(0.0, 100.0);
    let pos_y = dream_skin
        .get("positionY")
        .and_then(|v| v.as_f64())
        .unwrap_or(50.0)
        .clamp(0.0, 100.0);
    let zoom = dream_skin
        .get("zoom")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0)
        .clamp(1.0, 2.0);
    let transition = if dream_skin.get("transition").and_then(|v| v.as_str()) == Some("none") {
        "none"
    } else {
        "fade"
    };
    let fit = match dream_skin.get("fit").and_then(|v| v.as_str()) {
        Some(f @ ("cover" | "contain" | "adaptive")) => f,
        _ => "adaptive",
    };
    let scrim = dream_skin
        .get("scrim")
        .and_then(|v| v.as_f64())
        .unwrap_or(12.0)
        .clamp(0.0, 60.0)
        / 100.0;

    let payload = json!({
        "version": 2,
        "owner": SKIN_OWNER,
        "wallpaperId": wallpaper_id,
        "themePreset": theme_preset,
        "outputMode": app_json["outputMode"],
        "chatTint": app_json["chatTint"],
        "chatOpacity": app_json["chatOpacity"],
        "replyOpacity": app_json["replyOpacity"],
        "opacity": app_json["opacity"],
        "positionX": pos_x,
        "positionY": pos_y,
        "zoom": zoom,
        "transition": transition,
        "fit": fit,
        "scrim": scrim,
        "image": data_uri
    });
    let body = strip_cjs_export(THEME_JS_RAW);
    Ok(format!("((()=>{{{body};return installTheme;}})())({payload})"))
}

fn build_localization_install_expression(dict: &Map<String, Value>) -> String {
    let body = strip_cjs_export(LOCALIZE_JS_RAW);
    let cfg = json!({
        "owner": LOC_OWNER,
        "dict": Value::Object(dict.clone())
    });
    format!("((()=>{{{body};return installLocalization;}})())({cfg})")
}

fn clamp_percent(v: Option<&Value>) -> Value {
    match v.and_then(|x| x.as_f64()) {
        Some(n) if n.is_finite() && (0.0..=100.0).contains(&n) => json!(n),
        _ => Value::Null,
    }
}

fn normalize_channel(c: Option<&Value>, prev: Option<&Value>) -> Value {
    let empty = || json!({ "fiveHour": null, "weekly": null, "fiveHourReset": "", "weeklyReset": "" });
    let src = c.or(prev).cloned().unwrap_or_else(empty);
    let five_hour = clamp_percent(src.get("fiveHour"));
    let weekly = clamp_percent(src.get("weekly"));
    let five_reset = src
        .get("fiveHourReset")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let week_reset = src
        .get("weeklyReset")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    json!({
        "fiveHour": five_hour,
        "weekly": weekly,
        "fiveHourReset": five_reset,
        "weeklyReset": week_reset
    })
}

fn set_skin_status<F: Fn() + Send + Sync + 'static>(
    state: &SharedApp,
    on_update: &F,
    next: Value,
) {
    let changed = {
        let mut rt = state.runtime.lock().unwrap();
        if rt.skin_status == next {
            false
        } else {
            rt.skin_status = next;
            true
        }
    };
    if changed {
        on_update();
    }
}

fn set_localization_status<F: Fn() + Send + Sync + 'static>(
    state: &SharedApp,
    on_update: &F,
    next: Value,
) {
    let changed = {
        let mut rt = state.runtime.lock().unwrap();
        if rt.localization_status == next {
            false
        } else {
            rt.localization_status = next;
            true
        }
    };
    if changed {
        on_update();
    }
}

fn set_host_quota<F: Fn() + Send + Sync + 'static>(
    state: &SharedApp,
    on_update: &F,
    next: Value,
) {
    let changed = {
        let mut rt = state.runtime.lock().unwrap();
        if rt.host_quota == next {
            false
        } else {
            rt.host_quota = next;
            true
        }
    };
    if changed {
        on_update();
    }
}

fn read_focused_model_info(host: &DiscoveredHost) -> Option<Value> {
    let targets = if host.targets.len() > 1 {
        host.targets.as_slice()
    } else if let Some(ref t) = host.target {
        std::slice::from_ref(t)
    } else {
        return None;
    };
    if targets.is_empty() {
        return None;
    }
    if targets.len() == 1 {
        let mut c = CdpClient::connect(&targets[0].web_socket_debugger_url, 4000).ok()?;
        let expr = format!("({EXTRACT_MODEL_INFO_JS})()");
        let val = c.evaluate(&expr, 5000).ok()?;
        if val.get("modelName").and_then(|v| v.as_str()).is_some() {
            return Some(val);
        }
        return None;
    }
    let expr = format!(
        "(()=>{{const modelInfo=({EXTRACT_MODEL_INFO_JS})();return {{focused:typeof document!=='undefined'&&typeof document.hasFocus==='function'?document.hasFocus():false,modelInfo}};}})()"
    );
    let mut fallback: Option<Value> = None;
    for t in targets {
        let Ok(mut c) = CdpClient::connect(&t.web_socket_debugger_url, 4000) else {
            continue;
        };
        if let Ok(res) = c.evaluate(&expr, 5000) {
            if let Some(info) = res.get("modelInfo") {
                if info.get("modelName").and_then(|v| v.as_str()).is_some() {
                    if res.get("focused").and_then(|v| v.as_bool()) == Some(true) {
                        return Some(info.clone());
                    }
                    if fallback.is_none() {
                        fallback = Some(info.clone());
                    }
                }
            }
        }
    }
    fallback
}

pub struct HostOrchestrator {
    stop_flag: Arc<AtomicBool>,
    skin_wake: Arc<WakeSignal>,
    loc_wake: Arc<WakeSignal>,
    quota_wake: Arc<WakeSignal>,
    model_wake: Arc<WakeSignal>,
    last_forced_quota_ms: AtomicU64,
    handles: Mutex<Vec<JoinHandle<()>>>,
}

impl HostOrchestrator {
    pub fn start<F>(state: Arc<SharedApp>, explicit_port: Option<u16>, on_update: F) -> Arc<Self>
    where
        F: Fn() + Send + Sync + 'static,
    {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let skin_wake = Arc::new(WakeSignal::new());
        let loc_wake = Arc::new(WakeSignal::new());
        let quota_wake = Arc::new(WakeSignal::new());
        let model_wake = Arc::new(WakeSignal::new());
        let cb = Arc::new(on_update);

        let mut handles = Vec::new();
        handles.push(spawn_quota_worker(
            Arc::clone(&state),
            explicit_port,
            Arc::clone(&stop_flag),
            Arc::clone(&quota_wake),
            Arc::clone(&cb),
        ));
        handles.push(spawn_model_worker(
            Arc::clone(&state),
            explicit_port,
            Arc::clone(&stop_flag),
            Arc::clone(&model_wake),
            Arc::clone(&cb),
        ));
        handles.push(spawn_skin_worker(
            Arc::clone(&state),
            explicit_port,
            Arc::clone(&stop_flag),
            Arc::clone(&skin_wake),
            Arc::clone(&cb),
        ));
        handles.push(spawn_localization_worker(
            Arc::clone(&state),
            explicit_port,
            Arc::clone(&stop_flag),
            Arc::clone(&loc_wake),
            Arc::clone(&cb),
        ));

        Arc::new(Self {
            stop_flag,
            skin_wake,
            loc_wake,
            quota_wake,
            model_wake,
            last_forced_quota_ms: AtomicU64::new(0),
            handles: Mutex::new(handles),
        })
    }

    pub fn notify_settings_changed(&self) {
        self.skin_wake.notify();
        self.loc_wake.notify();
    }

    pub fn trigger_quota_refresh(&self) {
        self.last_forced_quota_ms.store(now_ms(), Ordering::Relaxed);
        self.quota_wake.notify();
        self.model_wake.notify();
    }

    pub fn trigger_quota_refresh_debounced(&self) {
        let now = now_ms();
        let prev = self.last_forced_quota_ms.load(Ordering::Relaxed);
        if now.saturating_sub(prev) < 3000 {
            return;
        }
        if self
            .last_forced_quota_ms
            .compare_exchange(prev, now, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
        {
            self.quota_wake.notify();
        }
    }

    pub fn trigger_model_refresh(&self) {
        self.model_wake.notify();
    }

    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        self.skin_wake.notify();
        self.loc_wake.notify();
        self.quota_wake.notify();
        self.model_wake.notify();
        let handles: Vec<JoinHandle<()>> = self.handles.lock().unwrap().drain(..).collect();
        for h in handles {
            let _ = h.join();
        }
    }
}

fn spawn_model_worker<F: Fn() + Send + Sync + 'static>(
    state: Arc<SharedApp>,
    explicit_port: Option<u16>,
    stop: Arc<AtomicBool>,
    wake: Arc<WakeSignal>,
    on_update: Arc<F>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut wake_seq = wake.current();
        while !stop.load(Ordering::Relaxed) {
            let is_host = state.runtime.lock().unwrap().foreground_kind == "host";
            let woken = wake.current() != wake_seq;
            if is_host || woken {
                if let Some(host) = discover_host(explicit_port, false) {
                    if let Some(next_info) = read_focused_model_info(&host) {
                        let changed = {
                            let mut rt = state.runtime.lock().unwrap();
                            let prev = rt.host_quota.get("modelInfo").cloned();
                            if prev.as_ref() != Some(&next_info) {
                                if let Some(obj) = rt.host_quota.as_object_mut() {
                                    obj.insert("modelInfo".into(), next_info);
                                    true
                                } else {
                                    false
                                }
                            } else {
                                false
                            }
                        };
                        if changed {
                            on_update();
                        }
                    }
                }
            }
            let delay_ms = if is_host { 2_500 } else { 15_000 };
            wake.wait_for_change_or_timeout(&mut wake_seq, Duration::from_millis(delay_ms), &stop);
        }
    })
}

fn spawn_quota_worker<F: Fn() + Send + Sync + 'static>(
    state: Arc<SharedApp>,
    explicit_port: Option<u16>,
    stop: Arc<AtomicBool>,
    wake: Arc<WakeSignal>,
    on_update: Arc<F>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut wake_seq = wake.current();
        let mut host_identity: Option<String> = None;
        let mut sample_at: Option<u64> = None;
        let mut failures: u32 = 0;

        while !stop.load(Ordering::Relaxed) {
            let found = discover_host(explicit_port, false);
            let mut ready = false;
            let prev_quota = state.runtime.lock().unwrap().host_quota.clone();

            if let Some(ref host) = found {
                if let Some(ref primary) = host.target {
                    let ws_url = primary.web_socket_debugger_url.clone();
                    let reset_identity = host_identity.as_ref().is_some_and(|h| h != &ws_url);
                    host_identity = Some(ws_url.clone());

                    let mut working = if reset_identity {
                        sample_at = None;
                        json!({
                            "status": "querying",
                            "fiveHour": null,
                            "weekly": null,
                            "fiveHourReset": "",
                            "weeklyReset": "",
                            "claudeGpt": { "fiveHour": null, "weekly": null, "fiveHourReset": "", "weeklyReset": "" },
                            "modelInfo": null,
                            "fetchedAt": null,
                            "online": true
                        })
                    } else {
                        let mut p = prev_quota.clone();
                        if let Some(obj) = p.as_object_mut() {
                            obj.insert("status".into(), json!("querying"));
                        }
                        p
                    };

                    if let Ok(mut client) = CdpClient::connect(&ws_url, 4000) {
                        if let Ok(sample) = client.evaluate(QUOTA_AND_MODEL_EVAL_JS, 15000) {
                            let mut next_model = sample
                                .get("modelInfo")
                                .filter(|m| m.get("modelName").and_then(|v| v.as_str()).is_some())
                                .cloned();
                            client.close();

                            if host.targets.len() > 1 {
                                if let Some(focused) = read_focused_model_info(host) {
                                    next_model = Some(focused);
                                }
                            }

                            let cache_ok = sample
                                .get("cacheAvailable")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);

                            if !cache_ok {
                                let merged_model = next_model
                                    .or_else(|| working.get("modelInfo").cloned())
                                    .unwrap_or(Value::Null);
                                if let Some(obs) = sample_at {
                                    let stale = now_ms().saturating_sub(obs) >= 300_000;
                                    working = json!({
                                        "status": "unsupported-or-initializing",
                                        "fiveHour": working.get("fiveHour").cloned().unwrap_or(Value::Null),
                                        "weekly": working.get("weekly").cloned().unwrap_or(Value::Null),
                                        "fiveHourReset": working.get("fiveHourReset").cloned().unwrap_or_else(|| json!("")),
                                        "weeklyReset": working.get("weeklyReset").cloned().unwrap_or_else(|| json!("")),
                                        "claudeGpt": normalize_channel(None, working.get("claudeGpt")),
                                        "modelInfo": merged_model,
                                        "online": true,
                                        "cached": true,
                                        "stale": stale,
                                        "observedAt": obs,
                                        "fetchedAt": working.get("fetchedAt").cloned().unwrap_or(Value::Null)
                                    });
                                } else {
                                    working = json!({
                                        "status": "unsupported-or-initializing",
                                        "fiveHour": null,
                                        "weekly": null,
                                        "fiveHourReset": "",
                                        "weeklyReset": "",
                                        "claudeGpt": normalize_channel(None, working.get("claudeGpt")),
                                        "modelInfo": merged_model,
                                        "fetchedAt": null,
                                        "online": true
                                    });
                                }
                            } else {
                                let fh = clamp_percent(sample.get("fiveHour"));
                                let wk = clamp_percent(sample.get("weekly"));
                                ready = fh.is_number() || wk.is_number();
                                if ready {
                                    sample_at = Some(now_ms());
                                }
                                let prev_fh_reset = working
                                    .get("fiveHourReset")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let prev_wk_reset = working
                                    .get("weeklyReset")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                working = json!({
                                    "status": if ready { "ready" } else { "quota-unavailable" },
                                    "fiveHour": fh,
                                    "weekly": wk,
                                    "fiveHourReset": sample.get("fiveHourReset").and_then(|v| v.as_str()).unwrap_or(prev_fh_reset),
                                    "weeklyReset": sample.get("weeklyReset").and_then(|v| v.as_str()).unwrap_or(prev_wk_reset),
                                    "claudeGpt": normalize_channel(sample.get("claudeGpt"), working.get("claudeGpt")),
                                    "modelInfo": next_model.or_else(|| working.get("modelInfo").cloned()).unwrap_or(Value::Null),
                                    "cached": false,
                                    "stale": false,
                                    "observedAt": sample_at,
                                    "fetchedAt": sample.get("fetchedAt").filter(|v| v.is_number()).cloned().unwrap_or(Value::Null),
                                    "online": true
                                });
                            }
                        } else {
                            if let Some(obj) = working.as_object_mut() {
                                obj.insert("status".into(), json!("query-failed"));
                                obj.insert("online".into(), json!(false));
                                obj.insert("cached".into(), json!(true));
                                obj.insert("stale".into(), json!(true));
                            }
                        }
                    } else if let Some(obj) = working.as_object_mut() {
                        obj.insert("status".into(), json!("query-failed"));
                        obj.insert("online".into(), json!(false));
                        obj.insert("cached".into(), json!(true));
                        obj.insert("stale".into(), json!(true));
                    }

                    set_host_quota(&state, on_update.as_ref(), working);
                }
            } else {
                let running = is_host_process_running();
                let mut offline = prev_quota.clone();
                if let Some(obj) = offline.as_object_mut() {
                    obj.insert(
                        "status".into(),
                        json!(if running { "cdp-disabled" } else { "waiting-host" }),
                    );
                    obj.insert("online".into(), json!(false));
                    obj.insert("cached".into(), json!(true));
                    obj.insert("stale".into(), json!(true));
                }
                set_host_quota(&state, on_update.as_ref(), offline);
            }

            failures = if ready { 0 } else { failures.saturating_add(1).min(5) };
            let is_host = state.runtime.lock().unwrap().foreground_kind == "host";
            let delay_ms = if ready {
                if is_host {
                    10_000u64
                } else {
                    20_000u64
                }
            } else {
                let exp = 1u64 << failures.saturating_sub(1);
                (3_000u64 * exp).min(30_000)
            };
            wake.wait_for_change_or_timeout(&mut wake_seq, Duration::from_millis(delay_ms), &stop);
        }
    })
}

fn apply_theme_to_client(
    client: &mut CdpClient,
    dream_skin: &Map<String, Value>,
    wallpaper_id: &str,
    wallpaper_path: &PathBuf,
    prev_skin: Option<&Map<String, Value>>,
    cur_themed: bool,
    cur_appearance: bool,
) -> Result<Value, String> {
    if cur_themed
        && cur_appearance
        && prev_skin.is_some_and(|prev| same_wallpaper_settings(prev, dream_skin))
    {
        let app_payload = appearance_payload_from_skin(dream_skin);
        let expr = format!("window.__agyDreamSkinV2.updateAppearance({app_payload})");
        return client.evaluate(&expr, 10_000);
    }
    let expr = build_theme_install_expression(dream_skin, wallpaper_id, wallpaper_path)?;
    client.evaluate(&expr, 20_000)
}

fn spawn_skin_worker<F: Fn() + Send + Sync + 'static>(
    state: Arc<SharedApp>,
    explicit_port: Option<u16>,
    stop: Arc<AtomicBool>,
    wake: Arc<WakeSignal>,
    on_update: Arc<F>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut wake_seq = wake.current();
        let mut primary_url: Option<String> = None;
        let mut client: Option<CdpClient> = None;
        let mut primary_applied_skin: Option<Map<String, Value>> = None;
        let mut extra_clients: HashMap<String, (CdpClient, Option<Map<String, Value>>)> =
            HashMap::new();

        while !stop.load(Ordering::Relaxed) {
            let (dream_skin, wallpaper_id, wallpaper_path) = {
                let rt = state.runtime.lock().unwrap();
                let wid = rt
                    .dream_skin
                    .get("wallpaperId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("gemini-character-sheet-v1")
                    .to_string();
                let wp = crate::assets::resolve_wallpaper_file(&rt.wallpapers, Some(&wid), &wid, "");
                (rt.dream_skin.clone(), wid, wp)
            };
            let enabled = dream_skin
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let mut found_targets = Vec::new();
            let mut connected_ok = false;

            if client.as_ref().is_none_or(CdpClient::is_closed) {
                client = None;
                primary_url = None;
                primary_applied_skin = None;
                if let Some(found) = discover_host(explicit_port, false) {
                    if let Some(ref primary) = found.target {
                        if let Ok(c) = CdpClient::connect(&primary.web_socket_debugger_url, 4000) {
                            primary_url = Some(primary.web_socket_debugger_url.clone());
                            client = Some(c);
                            found_targets = found.targets;
                        }
                    }
                } else {
                    let running = is_host_process_running();
                    set_skin_status(
                        &state,
                        on_update.as_ref(),
                        if running {
                            json!({
                                "connected": false,
                                "applied": false,
                                "reason": "cdp-disabled",
                                "message": "Antigravity 已运行但未开启本地调试通道（v2.33+ 默认关闭），请配置快捷方式后重启 Antigravity"
                            })
                        } else {
                            json!({
                                "connected": false,
                                "applied": false,
                                "reason": "host-offline",
                                "message": "请先打开 Antigravity，检测到后自动连接"
                            })
                        },
                    );
                }
            } else if let Some(found) = discover_host(explicit_port, false) {
                found_targets = found.targets;
            }

            if let Some(ref mut c) = client {
                match c.evaluate(INSPECT_SKIN_JS, 7000) {
                    Ok(cur) => {
                        connected_ok = true;
                        let cur_themed = cur.get("themed").and_then(|v| v.as_bool()).unwrap_or(false);
                        let cur_owner = cur.get("owner").and_then(|v| v.as_str()).unwrap_or("");
                        let cur_app = cur.get("appearance").and_then(|v| v.as_bool()).unwrap_or(false);

                        if !enabled {
                            if cur_themed && cur_owner == SKIN_OWNER {
                                let _ = c.evaluate("window.__agyDreamSkinV2?.destroy()", 7000);
                            }
                            primary_applied_skin = None;
                            set_skin_status(
                                &state,
                                on_update.as_ref(),
                                json!({
                                    "connected": true,
                                    "applied": false,
                                    "reason": Value::Null,
                                    "message": if cur_themed && !cur_owner.is_empty() && cur_owner != SKIN_OWNER {
                                        "已连接 · 当前实例未启用，另一个皮肤实例正在运行"
                                    } else {
                                        "已连接 · 皮肤已关闭，宿主恢复原样"
                                    }
                                }),
                            );
                        } else if cur_themed && !cur_owner.is_empty() && cur_owner != SKIN_OWNER {
                            set_skin_status(
                                &state,
                                on_update.as_ref(),
                                json!({
                                    "connected": true,
                                    "applied": false,
                                    "reason": Value::Null,
                                    "message": "已连接 · 皮肤由另一个运行实例管理"
                                }),
                            );
                        } else if cur.get("hydrated").and_then(Value::as_bool) != Some(true) {
                            primary_applied_skin = None;
                            set_skin_status(&state, on_update.as_ref(), json!({
                                "connected": true, "applied": false, "reason": "workbench-loading",
                                "message": "等待 Antigravity 工作台与主题加载完成"
                            }));
                        } else if !cur_themed
                            || primary_applied_skin.as_ref() != Some(&dream_skin)
                        {
                            if let Some(ref wp) = wallpaper_path {
                                match apply_theme_to_client(
                                    c,
                                    &dream_skin,
                                    &wallpaper_id,
                                    wp,
                                    primary_applied_skin.as_ref(),
                                    cur_themed,
                                    cur_app,
                                ) {
                                    Ok(res) => {
                                        let applied = res
                                            .get("applied")
                                            .and_then(|v| v.as_bool())
                                            .unwrap_or(false);
                                        primary_applied_skin = applied.then(|| dream_skin.clone());
                                        let mut status_obj = res.as_object().cloned().unwrap_or_default();
                                        status_obj.insert("connected".into(), json!(true));
                                        status_obj.insert("reason".into(), Value::Null);
                                        status_obj.insert(
                                            "message".into(),
                                            json!(if applied {
                                                "已应用到真实 Antigravity · 可随时关闭"
                                            } else {
                                                "宿主布局已变化，等待重新应用"
                                            }),
                                        );
                                        set_skin_status(
                                            &state,
                                            on_update.as_ref(),
                                            Value::Object(status_obj),
                                        );
                                    }
                                    Err(err) => {
                                        c.close();
                                        client = None;
                                        primary_url = None;
                                        primary_applied_skin = None;
                                        set_skin_status(
                                            &state,
                                            on_update.as_ref(),
                                            json!({
                                                "connected": false,
                                                "applied": false,
                                                "reason": "connect-error",
                                                "message": format!("暂未接入：{err}")
                                            }),
                                        );
                                        connected_ok = false;
                                    }
                                }
                            } else {
                                set_skin_status(
                                    &state,
                                    on_update.as_ref(),
                                    json!({
                                        "connected": true,
                                        "applied": false,
                                        "reason": "no-wallpaper",
                                        "message": "未找到可用壁纸文件"
                                    }),
                                );
                            }
                        }
                    }
                    Err(err) => {
                        c.close();
                        client = None;
                        primary_url = None;
                        primary_applied_skin = None;
                        set_skin_status(
                            &state,
                            on_update.as_ref(),
                            json!({
                                "connected": false,
                                "applied": false,
                                "reason": "connect-error",
                                "message": format!("暂未接入：{err}")
                            }),
                        );
                    }
                }
            }

            if connected_ok {
                let mut active_urls = HashSet::new();
                for t in &found_targets {
                    let ws_url = &t.web_socket_debugger_url;
                    if primary_url.as_ref() == Some(ws_url) {
                        continue;
                    }
                    active_urls.insert(ws_url.clone());
                    let need_new = extra_clients
                        .get(ws_url)
                        .is_none_or(|(ec, _)| ec.is_closed());
                    if need_new {
                        if let Ok(ec) = CdpClient::connect(ws_url, 4000) {
                            extra_clients.insert(ws_url.clone(), (ec, None));
                        } else {
                            continue;
                        }
                    }
                    let mut remove_entry = false;
                    if let Some((ref mut ec, ref mut sig)) = extra_clients.get_mut(ws_url) {
                        match ec.evaluate(
                            INSPECT_SKIN_JS,
                            7000,
                        ) {
                            Ok(cur) => {
                                let cur_themed = cur.get("themed").and_then(|v| v.as_bool()).unwrap_or(false);
                                let cur_owner = cur.get("owner").and_then(|v| v.as_str()).unwrap_or("");
                                let cur_app = cur.get("appearance").and_then(|v| v.as_bool()).unwrap_or(false);
                                if !enabled {
                                    if cur_themed && cur_owner == SKIN_OWNER {
                                        let _ = ec.evaluate("window.__agyDreamSkinV2?.destroy()", 7000);
                                    }
                                    *sig = None;
                                } else if !(cur_themed && !cur_owner.is_empty() && cur_owner != SKIN_OWNER)
                                    && cur.get("hydrated").and_then(Value::as_bool) == Some(true)
                                    && (!cur_themed || sig.as_ref() != Some(&dream_skin))
                                {
                                    if let Some(ref wp) = wallpaper_path {
                                        if let Ok(result) = apply_theme_to_client(
                                            ec,
                                            &dream_skin,
                                            &wallpaper_id,
                                            wp,
                                            sig.as_ref(),
                                            cur_themed,
                                            cur_app,
                                        ) {
                                            *sig = (result.get("applied").and_then(Value::as_bool) == Some(true))
                                                .then(|| dream_skin.clone());
                                        }
                                    }
                                }
                            }
                            Err(_) => remove_entry = true,
                        }
                    }
                    if remove_entry {
                        extra_clients.remove(ws_url);
                    }
                }
                extra_clients.retain(|u, _| active_urls.contains(u));
            }

            wake.wait_for_change_or_timeout(&mut wake_seq, Duration::from_millis(2500), &stop);
        }

        // Cleanup on stop: destroy only our owned Dream Skin overlays cleanly.
        if let Some(ref mut c) = client {
            if !c.is_closed() {
                let expr = format!(
                    "window.__agyDreamSkinV2?.owner==={} ? window.__agyDreamSkinV2.destroy() : null",
                    json!(SKIN_OWNER)
                );
                let _ = c.evaluate(&expr, 3000);
            }
        }
        for (_, (mut ec, _)) in extra_clients {
            if !ec.is_closed() {
                let expr = format!(
                    "window.__agyDreamSkinV2?.owner==={} ? window.__agyDreamSkinV2.destroy() : null",
                    json!(SKIN_OWNER)
                );
                let _ = ec.evaluate(&expr, 3000);
            }
        }
    })
}

fn install_loc_preload(
    client: &mut CdpClient,
    ws_url: &str,
    doc_script_ids: &mut HashMap<String, String>,
    expr: &str,
) {
    if let Some(prev_id) = doc_script_ids.remove(ws_url) {
        let _ = client.send(
            "Page.removeScriptToEvaluateOnNewDocument",
            json!({ "identifier": prev_id }),
            1500,
        );
    }
    let _ = client.send("Page.enable", json!({}), 1500);
    if let Ok(res) = client.send(
        "Page.addScriptToEvaluateOnNewDocument",
        json!({ "source": expr }),
        1500,
    ) {
        if let Some(id) = res.get("identifier").and_then(|v| v.as_str()) {
            doc_script_ids.insert(ws_url.to_string(), id.to_string());
        }
    }
}

fn destroy_loc_in_client(
    client: &mut CdpClient,
    ws_url: &str,
    doc_script_ids: &mut HashMap<String, String>,
) {
    if client.is_closed() {
        return;
    }
    if let Some(prev_id) = doc_script_ids.remove(ws_url) {
        let _ = client.send(
            "Page.removeScriptToEvaluateOnNewDocument",
            json!({ "identifier": prev_id }),
            1500,
        );
    }
    let expr = format!(
        "window.__agyZhV1&&window.__agyZhV1.owner==={} ? window.__agyZhV1.destroy() : null",
        json!(LOC_OWNER)
    );
    let _ = client.evaluate(&expr, 4000);
}

fn spawn_localization_worker<F: Fn() + Send + Sync + 'static>(
    state: Arc<SharedApp>,
    explicit_port: Option<u16>,
    stop: Arc<AtomicBool>,
    wake: Arc<WakeSignal>,
    on_update: Arc<F>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let dict = filter_localization_dict(ZH_CN_DICT_RAW);
        let dict_count = dict.len();
        let install_expr = build_localization_install_expression(&dict);

        let mut wake_seq = wake.current();
        let mut primary_url: Option<String> = None;
        let mut client: Option<CdpClient> = None;
        let mut applied_lang: Option<String> = None;
        let mut sig_state: Option<String> = None;
        let mut extra_clients: HashMap<String, (CdpClient, Option<String>)> = HashMap::new();
        let mut doc_script_ids: HashMap<String, String> = HashMap::new();
        let mut fast_until = Instant::now() + Duration::from_secs(6);

        while !stop.load(Ordering::Relaxed) {
            let ui_lang = {
                let rt = state.runtime.lock().unwrap();
                rt.dream_skin
                    .get("uiLanguage")
                    .and_then(|v| v.as_str())
                    .unwrap_or("en")
                    .to_string()
            };
            let enabled = ui_lang == "zh-CN";

            if !enabled {
                if let Some(mut c) = client.take() {
                    if let Some(ref u) = primary_url {
                        destroy_loc_in_client(&mut c, u, &mut doc_script_ids);
                    }
                    c.close();
                }
                primary_url = None;
                applied_lang = None;
                for (u, (mut ec, _)) in extra_clients.drain() {
                    destroy_loc_in_client(&mut ec, &u, &mut doc_script_ids);
                    ec.close();
                }
                if sig_state.is_some() {
                    sig_state = None;
                    set_localization_status(
                        &state,
                        on_update.as_ref(),
                        json!({
                            "applied": false,
                            "reason": Value::Null,
                            "message": "翻译层未启用"
                        }),
                    );
                }
            } else {
                let mut found_targets = Vec::new();
                if client.as_ref().is_none_or(CdpClient::is_closed) {
                    client = None;
                    primary_url = None;
                    applied_lang = None;
                    if let Some(found) = discover_host(explicit_port, true) {
                        if let Some(ref primary) = found.target {
                            if let Ok(c) = CdpClient::connect(&primary.web_socket_debugger_url, 4000)
                            {
                                primary_url = Some(primary.web_socket_debugger_url.clone());
                                client = Some(c);
                                found_targets = found.targets;
                            }
                        }
                    } else {
                        let running = is_host_process_running();
                        let next_sig = if running { "cdp-disabled" } else { "waiting" };
                        if sig_state.as_deref() != Some(next_sig) {
                            sig_state = Some(next_sig.to_string());
                            set_localization_status(
                                &state,
                                on_update.as_ref(),
                                if running {
                                    json!({
                                        "applied": false,
                                        "reason": "cdp-disabled",
                                        "message": "Antigravity 未开启本地调试通道，配置快捷方式并重启后自动注入汉化"
                                    })
                                } else {
                                    json!({
                                        "applied": false,
                                        "reason": "host-offline",
                                        "message": "等待 Antigravity 连接后注入翻译层"
                                    })
                                },
                            );
                        }
                    }
                } else if let Some(found) = discover_host(explicit_port, true) {
                    found_targets = found.targets;
                }

                let mut connected_ok = false;
                if let (Some(ref mut c), Some(ref p_url)) = (&mut client, &primary_url) {
                    let inspect = "({ready:document.readyState,installed:!!window.__agyZhV1,owner:window.__agyZhV1&&window.__agyZhV1.owner})";
                    match c.evaluate(inspect, 7000) {
                        Ok(cur) => {
                            connected_ok = true;
                            let installed = cur.get("installed").and_then(|v| v.as_bool()).unwrap_or(false);
                            let owner = cur.get("owner").and_then(|v| v.as_str()).unwrap_or("");
                            if installed && !owner.is_empty() && owner != LOC_OWNER {
                                set_localization_status(
                                    &state,
                                    on_update.as_ref(),
                                    json!({
                                        "applied": false,
                                        "reason": Value::Null,
                                        "message": "翻译层由另一个运行实例管理"
                                    }),
                                );
                            } else if !installed || applied_lang.as_deref() != Some("zh-CN") {
                                install_loc_preload(c, p_url, &mut doc_script_ids, &install_expr);
                                match c.evaluate(&install_expr, 15_000) {
                                    Ok(res) => {
                                        applied_lang = Some("zh-CN".into());
                                        sig_state = Some("zh-CN".into());
                                        let ok = res
                                            .get("applied")
                                            .and_then(|v| v.as_bool())
                                            .unwrap_or(false);
                                        set_localization_status(
                                            &state,
                                            on_update.as_ref(),
                                            json!({
                                                "applied": true,
                                                "reason": Value::Null,
                                                "message": if ok {
                                                    format!("汉化已注入 · 字典 {dict_count} 条")
                                                } else {
                                                    "宿主未就绪，稍后重试".to_string()
                                                }
                                            }),
                                        );
                                    }
                                    Err(err) => {
                                        c.close();
                                        client = None;
                                        primary_url = None;
                                        applied_lang = None;
                                        sig_state = None;
                                        connected_ok = false;
                                        set_localization_status(
                                            &state,
                                            on_update.as_ref(),
                                            json!({
                                                "applied": false,
                                                "reason": "connect-error",
                                                "message": format!("翻译层未接入：{err}")
                                            }),
                                        );
                                    }
                                }
                            }
                        }
                        Err(err) => {
                            c.close();
                            client = None;
                            primary_url = None;
                            applied_lang = None;
                            sig_state = None;
                            set_localization_status(
                                &state,
                                on_update.as_ref(),
                                json!({
                                    "applied": false,
                                    "reason": "connect-error",
                                    "message": format!("翻译层未接入：{err}")
                                }),
                            );
                        }
                    }
                }

                if connected_ok {
                    let mut active_urls = HashSet::new();
                    for t in &found_targets {
                        let ws_url = &t.web_socket_debugger_url;
                        if primary_url.as_ref() == Some(ws_url) {
                            continue;
                        }
                        active_urls.insert(ws_url.clone());
                        let need_new = extra_clients
                            .get(ws_url)
                            .is_none_or(|(ec, _)| ec.is_closed());
                        if need_new {
                            if let Ok(ec) = CdpClient::connect(ws_url, 4000) {
                                extra_clients.insert(ws_url.clone(), (ec, None));
                            } else {
                                continue;
                            }
                        }
                        let mut remove_entry = false;
                        if let Some((ref mut ec, ref mut sig)) = extra_clients.get_mut(ws_url) {
                            match ec.evaluate(
                                "({ready:document.readyState,installed:!!window.__agyZhV1,owner:window.__agyZhV1&&window.__agyZhV1.owner})",
                                7000,
                            ) {
                                Ok(cur) => {
                                    let installed = cur.get("installed").and_then(|v| v.as_bool()).unwrap_or(false);
                                    let owner = cur.get("owner").and_then(|v| v.as_str()).unwrap_or("");
                                    if !(installed && !owner.is_empty() && owner != LOC_OWNER)
                                        && (!installed || sig.as_deref() != Some("zh-CN"))
                                    {
                                        install_loc_preload(
                                            ec,
                                            ws_url,
                                            &mut doc_script_ids,
                                            &install_expr,
                                        );
                                        if ec.evaluate(&install_expr, 15_000).is_ok() {
                                            *sig = Some("zh-CN".into());
                                        }
                                    }
                                }
                                Err(_) => remove_entry = true,
                            }
                        }
                        if remove_entry {
                            extra_clients.remove(ws_url);
                        }
                    }
                    extra_clients.retain(|u, _| active_urls.contains(u));
                }
            }

            let delay_ms = if client.is_none() {
                if Instant::now() < fast_until {
                    250
                } else {
                    450
                }
            } else {
                2000
            };
            let prev_seq = wake_seq;
            wake.wait_for_change_or_timeout(&mut wake_seq, Duration::from_millis(delay_ms), &stop);
            if wake_seq != prev_seq {
                fast_until = Instant::now() + Duration::from_secs(3);
            }
        }

        if let (Some(mut c), Some(ref u)) = (client.take(), primary_url) {
            destroy_loc_in_client(&mut c, u, &mut doc_script_ids);
            c.close();
        }
        for (u, (mut ec, _)) in extra_clients.drain() {
            destroy_loc_in_client(&mut ec, &u, &mut doc_script_ids);
            ec.close();
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appearance_only_change_detected() {
        let mut prev = Map::new();
        prev.insert("enabled".into(), json!(true));
        prev.insert("wallpaperId".into(), json!("gemini-character-sheet-v1"));
        prev.insert("opacity".into(), json!(22));
        prev.insert("chatTint".into(), json!("#181224"));

        let mut same_wall = prev.clone();
        same_wall.insert("opacity".into(), json!(45));
        same_wall.insert("chatTint".into(), json!("#ffffff"));
        assert!(same_wallpaper_settings(&prev, &same_wall));

        let mut diff_wall = prev.clone();
        diff_wall.insert("wallpaperId".into(), json!("other-wall"));
        assert!(!same_wallpaper_settings(&prev, &diff_wall));
    }

    #[test]
    fn strip_cjs_export_produces_valid_wrapper() {
        let t_stripped = strip_cjs_export(THEME_JS_RAW);
        assert!(t_stripped.contains("async function installTheme(config)"));
        assert!(!t_stripped.ends_with("module.exports={installTheme};"));

        let l_stripped = strip_cjs_export(LOCALIZE_JS_RAW);
        assert!(l_stripped.contains("async function installLocalization(config)"));
        assert!(!l_stripped.ends_with("module.exports={installLocalization};"));

        let dict = filter_localization_dict(ZH_CN_DICT_RAW);
        assert!(dict.len() > 100);
        assert!(!dict.keys().any(|k| k.starts_with('$')));
    }

    #[test]
    fn skin_and_loc_workers_complete_install_appearance_and_destroy() {
        use std::io::{Read, Write};
        use std::net::{TcpListener, TcpStream};

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let ev_srv = Arc::clone(&events);
        let srv_stop = Arc::new(AtomicBool::new(false));
        let srv_stop_c = Arc::clone(&srv_stop);

        fn read_ws_frame(stream: &mut TcpStream) -> Option<(u8, Vec<u8>)> {
            let mut hdr = [0u8; 2];
            if stream.read_exact(&mut hdr).is_err() {
                return None;
            }
            let op = hdr[0] & 0x0f;
            let masked = (hdr[1] & 0x80) != 0;
            let mut len = (hdr[1] & 0x7f) as usize;
            if len == 126 {
                let mut ext = [0u8; 2];
                stream.read_exact(&mut ext).ok()?;
                len = u16::from_be_bytes(ext) as usize;
            } else if len == 127 {
                let mut ext = [0u8; 8];
                stream.read_exact(&mut ext).ok()?;
                len = u64::from_be_bytes(ext) as usize;
            }
            let mut mask = [0u8; 4];
            if masked {
                stream.read_exact(&mut mask).ok()?;
            }
            let mut payload = vec![0u8; len];
            if len > 0 {
                stream.read_exact(&mut payload).ok()?;
            }
            if masked {
                for (i, b) in payload.iter_mut().enumerate() {
                    *b ^= mask[i & 3];
                }
            }
            Some((op, payload))
        }

        fn write_ws_text(stream: &mut TcpStream, s: &str) {
            let b = s.as_bytes();
            let mut frame = Vec::with_capacity(10 + b.len());
            frame.push(0x81);
            if b.len() < 126 {
                frame.push(b.len() as u8);
            } else if b.len() <= u16::MAX as usize {
                frame.push(126);
                frame.extend_from_slice(&(b.len() as u16).to_be_bytes());
            } else {
                frame.push(127);
                frame.extend_from_slice(&(b.len() as u64).to_be_bytes());
            }
            frame.extend_from_slice(b);
            let _ = stream.write_all(&frame);
            let _ = stream.flush();
        }

        let _srv = thread::spawn(move || {
            let _ = listener.set_nonblocking(true);
            while !srv_stop_c.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut conn, _)) => {
                        let _ = conn.set_nonblocking(false);
                        let _ = conn.set_read_timeout(Some(Duration::from_millis(2000)));
                        let ev_conn = Arc::clone(&ev_srv);
                        thread::spawn(move || {
                            let mut buf = Vec::new();
                            let mut tmp = [0u8; 1024];
                            loop {
                                match conn.read(&mut tmp) {
                                    Ok(0) | Err(_) => return,
                                    Ok(n) => {
                                        buf.extend_from_slice(&tmp[..n]);
                                        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                                            break;
                                        }
                                    }
                                }
                            }
                            let head = String::from_utf8_lossy(&buf);
                            if head.starts_with("GET /json/list ") {
                                let body = serde_json::to_string(&json!([{
                                    "id": "p1",
                                    "type": "page",
                                    "url": format!("http://127.0.0.1:{port}/index.html"),
                                    "webSocketDebuggerUrl": format!("ws://127.0.0.1:{port}/devtools/page/p1")
                                }]))
                                .unwrap();
                                let resp = format!(
                                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                    body.len(),
                                    body
                                );
                                let _ = conn.write_all(resp.as_bytes());
                                let _ = conn.flush();
                                return;
                            }
                            let _ = conn.write_all(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
                            let _ = conn.flush();
                            let _ = conn.set_read_timeout(Some(Duration::from_millis(8000)));
                            let mut themed = false;
                            let mut loc = false;
                            while let Some((op, payload)) = read_ws_frame(&mut conn) {
                                if op == 0x8 {
                                    break;
                                }
                                if op != 0x1 {
                                    continue;
                                }
                                let req: Value = serde_json::from_slice(&payload).unwrap();
                                let id = req["id"].as_u64().unwrap();
                                let method = req["method"].as_str().unwrap_or("");
                                let expr = req["params"]["expression"].as_str().unwrap_or("");
                                let result = if method == "Page.enable" || method == "Page.removeScriptToEvaluateOnNewDocument" {
                                    ev_conn.lock().unwrap().push(method.to_string());
                                    json!({})
                                } else if method == "Page.addScriptToEvaluateOnNewDocument" {
                                    ev_conn.lock().unwrap().push("preload-add".to_string());
                                    json!({ "identifier": "s1" })
                                } else if expr.contains("queryHostQuota") {
                                    ev_conn.lock().unwrap().push("quota".to_string());
                                    json!({ "result": { "value": { "cacheAvailable": true, "fiveHour": 84, "weekly": 62 } } })
                                } else if expr.starts_with("window.__agyDreamSkinV2.updateAppearance(") {
                                    ev_conn.lock().unwrap().push("theme-appearance".to_string());
                                    json!({ "result": { "value": { "applied": true } } })
                                } else if expr.contains("return installTheme;})())(") {
                                    themed = true;
                                    ev_conn.lock().unwrap().push("theme-install".to_string());
                                    json!({ "result": { "value": { "applied": true } } })
                                } else if expr.contains("__agyDreamSkinV2") && expr.contains(".destroy()") {
                                    themed = false;
                                    ev_conn.lock().unwrap().push("theme-destroy".to_string());
                                    json!({ "result": { "value": { "removed": true } } })
                                } else if expr.contains("__agyDreamSkinV2") {
                                    ev_conn.lock().unwrap().push("theme-inspect".to_string());
                                    json!({ "result": { "value": { "ready": "complete", "hydrated": true, "themed": themed, "owner": if themed { SKIN_OWNER } else { "" }, "appearance": true } } })
                                } else if expr.contains("return installLocalization;})())(") {
                                    loc = true;
                                    ev_conn.lock().unwrap().push("loc-install".to_string());
                                    json!({ "result": { "value": { "applied": true } } })
                                } else if expr.contains("__agyZhV1") && expr.contains(".destroy()") {
                                    loc = false;
                                    ev_conn.lock().unwrap().push("loc-destroy".to_string());
                                    json!({ "result": { "value": { "removed": true } } })
                                } else if expr.contains("__agyZhV1") {
                                    ev_conn.lock().unwrap().push("loc-inspect".to_string());
                                    json!({ "result": { "value": { "ready": "complete", "installed": loc, "owner": if loc { LOC_OWNER } else { "" } } } })
                                } else {
                                    json!({ "result": { "value": null } })
                                };
                                write_ws_text(&mut conn, &json!({ "id": id, "result": result }).to_string());
                            }
                        });
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });

        let dir = std::env::temp_dir().join(format!("catstella-orch-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let app = SharedApp::new(
            dir.clone(),
            dir.join("skin"),
            dir.join("wv2"),
            None,
            false,
            "disable-gpu".into(),
            String::new(),
            false,
            true,
            None,
            vec![],
        );
        let orch = HostOrchestrator::start(Arc::clone(&app), Some(port), || {});
        thread::sleep(Duration::from_millis(400));

        let mut p1 = Map::new();
        p1.insert("enabled".into(), json!(true));
        p1.insert("uiLanguage".into(), json!("zh-CN"));
        app.update_dream_skin_transactional(&p1).unwrap();
        orch.notify_settings_changed();
        thread::sleep(Duration::from_millis(800));

        let mut p2 = Map::new();
        p2.insert("opacity".into(), json!(42));
        app.update_dream_skin_transactional(&p2).unwrap();
        orch.notify_settings_changed();
        thread::sleep(Duration::from_millis(500));

        let mut p3 = Map::new();
        p3.insert("enabled".into(), json!(false));
        p3.insert("uiLanguage".into(), json!("en"));
        app.update_dream_skin_transactional(&p3).unwrap();
        orch.notify_settings_changed();
        thread::sleep(Duration::from_millis(500));

        orch.stop();
        srv_stop.store(true, Ordering::Relaxed);
        let _ = fs::remove_dir_all(&dir);

        let ev = events.lock().unwrap().clone();
        eprintln!("ORCH EVENTS = {:?}", ev);
        assert!(ev.contains(&"quota".to_string()), "ev={ev:?}");
        assert!(ev.contains(&"theme-install".to_string()), "ev={ev:?}");
        assert!(ev.contains(&"theme-appearance".to_string()), "ev={ev:?}");
        assert!(ev.contains(&"theme-destroy".to_string()), "ev={ev:?}");
        assert!(ev.contains(&"preload-add".to_string()), "ev={ev:?}");
        assert!(ev.contains(&"loc-install".to_string()), "ev={ev:?}");
        assert!(ev.contains(&"loc-destroy".to_string()), "ev={ev:?}");
    }
}
