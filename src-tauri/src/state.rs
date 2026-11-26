use crate::assets::{
    character_pack_to_snapshot_json, compute_art_version, discover_repo_root, is_valid_slug,
    list_character_packs, list_wallpaper_packs, next_wallpaper_id, resolve_character_frame_file,
    resolve_wallpaper_file, select_wallpaper, wallpaper_revision, wallpaper_to_snapshot_json,
    CharacterPack, WallpaperPack,
};
use crate::dream_skin::{
    legacy_rotate_patch, load_or_seed_dream_skin, sanitize_dream_skin, THEME_PRESETS,
};
use crate::layout::{DisplayInfo, Rect};
use crate::transcript::{ModelActivity, SourceStatus, UsageLedger};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DIALOGUE_JSON: &str =
    include_str!("../../Antigravity-Cat-Widget/assets/dialogue/zh-CN.json");
pub const AUDIO_MANIFEST_JSON: &str =
    include_str!("../../Antigravity-Cat-Widget/assets/audio/codex-maid-widget/manifest.json");

const ALLOWED_SOUND_SETS: &[&str] = &["original", "wood-tap", "bubble-pop", "soft-spring"];
const ALLOWED_SIDE_VARIANTS: &[&str] = &["arc", "ring", "bar"];
const ALLOWED_SIDE_DISTANCES: &[&str] = &["compact", "normal", "relaxed"];
const ALLOWED_SIDE_SIZES: &[&str] = &["sm", "md", "lg"];
const ALLOWED_SIDE_MODES: &[&str] = &["remaining", "used"];
const ALLOWED_SIDE_SOURCES: &[&str] = &["auto", "agy", "web"];
const ALLOWED_SIDE_PALETTES: &[&str] = &["theme", "violet", "pink", "ocean", "emerald", "sunset", "gold", "custom"];
const ALLOWED_SIDE_STYLES: &[&str] = &["glass", "neon", "minimal"];
const VALID_PERSISTENT_STATES: &[&str] = &["idle", "thinking", "warning", "error", "offline"];
const VALID_TRANSIENT_STATES: &[&str] = &["pressed", "release", "petting", "success", "error"];
pub const ALLOWED_SETTINGS_KEYS: &[&str] = &[
    "characterPack",
    "scale",
    "alwaysOnTop",
    "reducedMotion",
    "sound",
    "volume",
    "soundSet",
    "bubbleOn",
    "turnCostOn",
    "turnCostDurationMs",
    "clickThrough",
    "bubblePage",
    "manualQuota",
    "manualPercent",
    "manualWeeklyPercent",
    "hostWindowOnly",
    "standaloneDesktopMode",
    "hostOffsetX",
    "hostOffsetY",
    "hostDock",
    "clickCatAction",
    "sideQuotaEnabled",
    "sideQuotaVariant",
    "sideQuotaDistance",
    "sideQuotaSize",
    "sideQuotaMode",
    "sideQuotaSource",
    "sideQuotaPalette",
    "sideQuotaColor",
    "sideQuotaStyle",
    "sideQuotaOpacity",
    "easterEggs",
    "ambientChatter",
    "autoUpdateCheck",
    "syncCharacter",
    "syncWallpaper",
    "syncInteraction",
    "petDisplayMode",
    "userHonorificMode",
    "customHonorific",
    "customThemes",
    "bubbleTint",
    "bubbleOpacity",
    "seenReleaseNotes",
    "seenCatalogIds",
    "dismissedUpdateVersion",
    "x",
    "y",
    "desktopArtShiftX",
    "desktopArtShiftY",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone)]
pub struct AudioPreset {
    pub id: String,
    pub label: String,
    pub gain: f64,
    pub press: String,
    pub release: String,
}

pub struct AudioCatalog {
    pub presets: Vec<AudioPreset>,
}

impl AudioCatalog {
    pub fn load() -> Self {
        let parsed: Value = serde_json::from_str(AUDIO_MANIFEST_JSON).unwrap_or_else(|_| json!({}));
        let presets = parsed
            .get("presets")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|p| {
                        let id = p.get("id")?.as_str()?.to_string();
                        let label = p.get("label")?.as_str().unwrap_or(&id).to_string();
                        let gain = p.get("gain").and_then(|v| v.as_f64()).unwrap_or(1.0);
                        let press = p.get("press").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let release = p
                            .get("release")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        Some(AudioPreset {
                            id,
                            label,
                            gain,
                            press,
                            release,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self { presets }
    }

    pub fn preset_list_json(&self) -> Value {
        Value::Array(
            self.presets
                .iter()
                .map(|p| {
                    json!({
                        "id": p.id,
                        "label": p.label,
                        "gain": p.gain
                    })
                })
                .collect(),
        )
    }

    pub fn resolve_audio(
        &self,
        enabled: bool,
        volume: f64,
        sound_set: &str,
        kind: &str,
    ) -> Option<Value> {
        if !enabled {
            return None;
        }
        let preset = self.presets.iter().find(|p| p.id == sound_set)?;
        let rel = match kind {
            "press" => preset.press.as_str(),
            "release" => preset.release.as_str(),
            _ => return None,
        };
        if rel.is_empty() {
            return None;
        }
        let effective = (volume * preset.gain).clamp(0.0, 1.0);
        Some(json!({
            "url": format!("../../assets/audio/codex-maid-widget/{rel}"),
            "gain": preset.gain,
            "effectiveVolume": effective
        }))
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn today_ymd() -> String {
    #[cfg(windows)]
    unsafe {
        let mut st = std::mem::zeroed::<windows_sys::Win32::Foundation::SYSTEMTIME>();
        windows_sys::Win32::System::SystemInformation::GetLocalTime(&mut st);
        return format!("{}-{}-{}", st.wYear, st.wMonth, st.wDay);
    }
    #[cfg(not(windows))]
    {
        "2026-11-24".to_string()
    }
}

pub fn default_settings() -> Map<String, Value> {
    let v: Value = serde_json::from_str(
        r#"{
        "x": null,
        "y": null,
        "desktopArtShiftX": 0,
        "desktopArtShiftY": 0,
        "scale": 220,
        "alwaysOnTop": true,
        "reducedMotion": false,
        "sound": false,
        "volume": 0.35,
        "soundSet": "bubble-pop",
        "bubbleOn": true,
        "turnCostOn": true,
        "turnCostDurationMs": 5000,
        "clickThrough": false,
        "hostWindowOnly": false,
        "standaloneDesktopMode": true,
        "hostOffsetX": 18,
        "hostOffsetY": 18,
        "hostDock": "",
        "easterEggs": true,
        "ambientChatter": false,
        "autoUpdateCheck": true,
        "clickCatAction": "talk",
        "sideQuotaEnabled": true,
        "sideQuotaVariant": "arc",
        "sideQuotaDistance": "normal",
        "sideQuotaSize": "md",
        "sideQuotaMode": "remaining",
        "sideQuotaSource": "auto",
        "sideQuotaPalette": "theme",
        "sideQuotaColor": "",
        "sideQuotaStyle": "glass",
        "sideQuotaOpacity": 100,
        "characterPack": "gemini-star-v1",
        "syncCharacter": true,
        "syncWallpaper": true,
        "syncInteraction": true,
        "petDisplayMode": "both",
        "currency": "CNY",
        "bubblePage": "quota",
        "manualQuota": false,
        "manualPercent": null,
        "manualWeeklyPercent": null,
        "userHonorificMode": "none",
        "customHonorific": "",
        "customThemes": [],
        "seenReleaseNotes": [],
        "seenCatalogIds": [],
        "dismissedUpdateVersion": "",
        "bubbleTint": "",
        "bubbleOpacity": 98,
        "headPatTotal": 0,
        "headPatToday": 0,
        "headPatDay": ""
    }"#,
    )
    .unwrap_or_else(|_| json!({}));
    v.as_object().cloned().unwrap_or_default()
}

fn as_bool(v: Option<&Value>, fallback: bool) -> bool {
    v.and_then(|x| x.as_bool()).unwrap_or(fallback)
}

fn as_finite_f64(v: Option<&Value>, fallback: f64, min: f64, max: f64) -> f64 {
    match v.and_then(|x| x.as_f64()) {
        Some(n) if n.is_finite() => n.clamp(min, max),
        _ => fallback,
    }
}

fn as_opt_finite_f64(v: Option<&Value>, min: f64, max: f64) -> Value {
    match v.and_then(|x| x.as_f64()) {
        Some(n) if n.is_finite() => json!(n.clamp(min, max)),
        _ => Value::Null,
    }
}

fn as_enum(v: Option<&Value>, allowed: &[&str], fallback: &str) -> String {
    match v.and_then(|x| x.as_str()) {
        Some(s) if allowed.contains(&s) => s.to_string(),
        _ => fallback.to_string(),
    }
}

fn is_hex_color(s: &str) -> bool {
    s.len() == 7
        && s.starts_with('#')
        && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn sanitize_themes(input: Option<&Value>) -> Value {
    let Some(arr) = input.and_then(|v| v.as_array()) else {
        return json!([]);
    };
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for raw in arr.iter().take(24) {
        let Some(obj) = raw.as_object() else { continue };
        let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if id.is_empty()
            || id.len() > 40
            || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || !seen.insert(id.to_string())
        {
            continue;
        }
        let name = obj
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.chars().take(24).collect::<String>())
            .unwrap_or_else(|| "未命名主题".to_string());
        let palette = as_enum(obj.get("palette"), THEME_PRESETS, "violet");
        let opacity = as_finite_f64(obj.get("opacity"), 88.0, 0.0, 100.0);
        let bubble_tint = match obj.get("bubbleTint").and_then(|v| v.as_str()) {
            Some(c) if is_hex_color(c) => json!(c.to_ascii_lowercase()),
            _ => Value::Null,
        };
        let bubble_opacity = as_opt_finite_f64(obj.get("bubbleOpacity"), 30.0, 100.0);
        let chat_tint = match obj.get("chatTint").and_then(|v| v.as_str()) {
            Some(c) if is_hex_color(c) => json!(c.to_ascii_lowercase()),
            _ => Value::Null,
        };
        let chat_opacity = as_opt_finite_f64(obj.get("chatOpacity"), 0.0, 100.0);
        let reply_opacity = as_opt_finite_f64(obj.get("replyOpacity"), 0.0, 100.0);
        let updated_at = obj
            .get("updatedAt")
            .and_then(|v| v.as_str())
            .map(|s| s.chars().take(10).collect::<String>())
            .unwrap_or_default();
        out.push(json!({
            "id": id,
            "name": name,
            "palette": palette,
            "opacity": opacity,
            "bubbleTint": bubble_tint,
            "bubbleOpacity": bubble_opacity,
            "chatTint": chat_tint,
            "chatOpacity": chat_opacity,
            "replyOpacity": reply_opacity,
            "updatedAt": updated_at
        }));
    }
    Value::Array(out)
}

fn sanitize_seen_catalog_ids(input: Option<&Value>) -> Value {
    let Some(arr) = input.and_then(|v| v.as_array()) else {
        return json!([]);
    };
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for val in arr {
        let Some(s) = val.as_str().map(|st| st.trim()).filter(|st| is_valid_slug(st)) else {
            continue;
        };
        if seen.insert(s.to_string()) {
            out.push(json!(s));
            if out.len() >= 128 {
                break;
            }
        }
    }
    Value::Array(out)
}

fn sanitize_seen_release_notes(input: Option<&Value>) -> Value {
    let Some(arr) = input.and_then(|v| v.as_array()) else {
        return json!([]);
    };
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for val in arr {
        let Some(s) = val.as_str().map(|st| st.trim()).filter(|st| !st.is_empty()) else {
            continue;
        };
        let clean: String = s.chars().take(32).collect();
        if seen.insert(clean.clone()) {
            out.push(json!(clean));
        }
    }
    if out.len() > 20 {
        let start = out.len() - 20;
        out = out.split_off(start);
    }
    Value::Array(out)
}

pub fn sanitize_settings(input: &Map<String, Value>) -> Map<String, Value> {
    let defaults = default_settings();
    let mut s = defaults.clone();
    for (k, v) in input {
        s.insert(k.clone(), v.clone());
    }
    s.remove("talkCategory");

    for k in [
        "alwaysOnTop",
        "reducedMotion",
        "sound",
        "bubbleOn",
        "turnCostOn",
        "clickThrough",
        "hostWindowOnly",
        "standaloneDesktopMode",
        "easterEggs",
        "ambientChatter",
        "autoUpdateCheck",
        "syncCharacter",
        "syncWallpaper",
        "syncInteraction",
        "sideQuotaEnabled",
        "manualQuota",
    ] {
        let def = defaults.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
        s.insert(k.to_string(), json!(as_bool(s.get(k), def)));
    }

    for k in ["hostOffsetX", "hostOffsetY"] {
        let val = as_finite_f64(s.get(k), 18.0, 0.0, 100_000.0).round() as i32;
        s.insert(k.to_string(), json!(val));
    }
    for k in ["desktopArtShiftX", "desktopArtShiftY"] {
        let val = as_finite_f64(s.get(k), 0.0, -100_000.0, 100_000.0);
        s.insert(k.to_string(), json!(val));
    }
    for k in ["x", "y"] {
        let val = match s.get(k).and_then(|v| v.as_f64()) {
            Some(n) if n.is_finite() => json!(n.round() as i32),
            _ => Value::Null,
        };
        s.insert(k.to_string(), val);
    }

    s.insert("hostDock".into(), json!(as_enum(s.get("hostDock"), &["left", "right", ""], "")));
    s.insert("scale".into(), json!(as_finite_f64(s.get("scale"), 220.0, 140.0, 360.0).round() as i32));
    s.insert("volume".into(), json!(as_finite_f64(s.get("volume"), 0.35, 0.0, 1.0)));
    s.insert("soundSet".into(), json!(as_enum(s.get("soundSet"), ALLOWED_SOUND_SETS, "bubble-pop")));
    s.insert(
        "turnCostDurationMs".into(),
        json!(as_finite_f64(s.get("turnCostDurationMs"), 5000.0, 0.0, 60000.0).round() as i64),
    );
    s.insert(
        "petDisplayMode".into(),
        json!(as_enum(s.get("petDisplayMode"), &["both", "prefer-desktop", "prefer-web"], "both")),
    );
    s.insert(
        "bubblePage".into(),
        json!(as_enum(
            s.get("bubblePage"),
            &["quota", "webQuota", "claudeGpt", "today", "latest", "talk"],
            "quota"
        )),
    );
    s.insert("sideQuotaVariant".into(), json!(as_enum(s.get("sideQuotaVariant"), ALLOWED_SIDE_VARIANTS, "arc")));
    s.insert("sideQuotaDistance".into(), json!(as_enum(s.get("sideQuotaDistance"), ALLOWED_SIDE_DISTANCES, "normal")));
    s.insert("sideQuotaSize".into(), json!(as_enum(s.get("sideQuotaSize"), ALLOWED_SIDE_SIZES, "md")));
    s.insert("sideQuotaMode".into(), json!(as_enum(s.get("sideQuotaMode"), ALLOWED_SIDE_MODES, "remaining")));
    s.insert("sideQuotaSource".into(), json!(as_enum(s.get("sideQuotaSource"), ALLOWED_SIDE_SOURCES, "auto")));
    s.insert("sideQuotaPalette".into(), json!(as_enum(s.get("sideQuotaPalette"), ALLOWED_SIDE_PALETTES, "theme")));
    let side_color = match s.get("sideQuotaColor").and_then(|v| v.as_str()) {
        Some(c) if is_hex_color(c) => c.to_ascii_lowercase(),
        _ => String::new(),
    };
    s.insert("sideQuotaColor".into(), json!(side_color));
    s.insert("sideQuotaStyle".into(), json!(as_enum(s.get("sideQuotaStyle"), ALLOWED_SIDE_STYLES, "glass")));
    s.insert(
        "sideQuotaOpacity".into(),
        json!(as_finite_f64(s.get("sideQuotaOpacity"), 100.0, 40.0, 100.0).round() as i64),
    );
    s.insert("manualPercent".into(), as_opt_finite_f64(s.get("manualPercent"), 0.0, 100.0));
    s.insert("manualWeeklyPercent".into(), as_opt_finite_f64(s.get("manualWeeklyPercent"), 0.0, 100.0));

    let pack = match s.get("characterPack").and_then(|v| v.as_str()) {
        Some(p) if is_valid_slug(p) => p,
        _ => "gemini-star-v1",
    };
    s.insert("characterPack".into(), json!(pack));

    let click_action = match s.get("clickCatAction") {
        Some(Value::String(st)) => json!(st),
        Some(Value::Bool(b)) => json!(b),
        _ => json!("talk"),
    };
    s.insert("clickCatAction".into(), click_action);

    s.insert(
        "userHonorificMode".into(),
        json!(as_enum(s.get("userHonorificMode"), &["none", "custom"], "none")),
    );
    let custom_honor = s
        .get("customHonorific")
        .and_then(|v| v.as_str())
        .map(|st| st.chars().take(16).collect::<String>())
        .unwrap_or_default();
    s.insert("customHonorific".into(), json!(custom_honor));

    let themes = sanitize_themes(s.get("customThemes"));
    s.insert("customThemes".into(), themes);

    let seen_notes = sanitize_seen_release_notes(s.get("seenReleaseNotes"));
    s.insert("seenReleaseNotes".into(), seen_notes);
    let seen_catalog = sanitize_seen_catalog_ids(s.get("seenCatalogIds"));
    s.insert("seenCatalogIds".into(), seen_catalog);
    let dismissed_ver = s
        .get("dismissedUpdateVersion")
        .and_then(|v| v.as_str())
        .map(|st| st.trim().chars().take(32).collect::<String>())
        .unwrap_or_default();
    s.insert("dismissedUpdateVersion".into(), json!(dismissed_ver));

    let tint = match s.get("bubbleTint").and_then(|v| v.as_str()) {
        Some(c) if is_hex_color(c) => c.to_ascii_lowercase(),
        _ => String::new(),
    };
    s.insert("bubbleTint".into(), json!(tint));
    s.insert("bubbleOpacity".into(), json!(as_finite_f64(s.get("bubbleOpacity"), 98.0, 30.0, 100.0)));

    for k in ["headPatTotal", "headPatToday"] {
        let val = s.get(k).and_then(|v| v.as_u64()).unwrap_or(0);
        s.insert(k.to_string(), json!(val));
    }
    let day = s
        .get("headPatDay")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    s.insert("headPatDay".into(), json!(day));

    s
}

pub fn atomic_write_json(file_path: &Path, map: &Map<String, Value>) -> Result<(), String> {
    let parent = file_path
        .parent()
        .ok_or_else(|| "invalid json file path".to_string())?;
    let stem = file_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("config.json");
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(&Value::Object(map.clone())).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(".{stem}.tmp.{}.{}", std::process::id(), now_ms()));
    fs::write(&tmp, &bytes).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    if let Err(err) = fs::rename(&tmp, file_path) {
        if file_path.exists() {
            let _ = fs::remove_file(file_path);
            if let Err(err2) = fs::rename(&tmp, file_path) {
                let _ = fs::remove_file(&tmp);
                return Err(err2.to_string());
            }
        } else {
            let _ = fs::remove_file(&tmp);
            return Err(err.to_string());
        }
    }
    Ok(())
}

pub struct StateMachine {
    pub persistent_state: String,
    pub transient_state: Option<String>,
    pub transient_gen: u64,
    pub last_petting_ms: u64,
}

impl StateMachine {
    pub fn new(initial: &str) -> Self {
        let p = if VALID_PERSISTENT_STATES.contains(&initial) {
            initial
        } else {
            "idle"
        };
        Self {
            persistent_state: p.to_string(),
            transient_state: None,
            transient_gen: 0,
            last_petting_ms: 0,
        }
    }

    pub fn current_state(&self) -> &str {
        self.transient_state
            .as_deref()
            .unwrap_or(&self.persistent_state)
    }

    pub fn display_state(&self) -> &str {
        match self.current_state() {
            "pressed" | "release" => &self.persistent_state,
            other => other,
        }
    }

    pub fn set_persistent_state(&mut self, state: &str) -> bool {
        if !VALID_PERSISTENT_STATES.contains(&state) || self.persistent_state == state {
            return false;
        }
        self.persistent_state = state.to_string();
        true
    }

    pub fn trigger_transient(&mut self, state: &str) -> Option<u64> {
        if !VALID_TRANSIENT_STATES.contains(&state) {
            return None;
        }
        self.transient_gen = self.transient_gen.wrapping_add(1);
        self.transient_state = Some(state.to_string());
        Some(self.transient_gen)
    }

    pub fn clear_transient(&mut self) -> bool {
        if self.transient_state.is_some() {
            self.transient_gen = self.transient_gen.wrapping_add(1);
            self.transient_state = None;
            true
        } else {
            false
        }
    }

    pub fn clear_if_gen(&mut self, expected_gen: u64) -> bool {
        if self.transient_gen == expected_gen && self.transient_state.is_some() {
            self.transient_state = None;
            true
        } else {
            false
        }
    }

    pub fn handle_petting(&mut self) -> Option<u64> {
        let now = now_ms();
        if self.last_petting_ms > 0 && now.saturating_sub(self.last_petting_ms) < 12_000 {
            return None;
        }
        self.last_petting_ms = now;
        self.trigger_transient("petting")
    }

    pub fn handle_turn_success(&mut self) -> Option<u64> {
        if self.current_state() == "pressed" {
            return None;
        }
        self.trigger_transient("success")
    }
}

pub fn resolve_effective_foreground(kind: &str, prev: &str) -> String {
    match kind {
        "host" | "browser" | "desktop" | "other" => kind.to_string(),
        "self" | "shell" if matches!(prev, "host" | "browser" | "desktop" | "other") => {
            prev.to_string()
        }
        _ => "unknown".to_string(),
    }
}

/// Port of Antigravity-Cat-Widget/src/domain/companion-visibility.cjs
#[derive(Debug, Default)]
pub struct CompanionVisibility {
    pub web_owns_display: bool,
}

impl CompanionVisibility {
    pub fn hide_desktop(
        &mut self,
        pet_display_mode: &str,
        web_online: bool,
        web_active: bool,
        web_visible: bool,
        foreground_kind: &str,
    ) -> bool {
        if pet_display_mode != "prefer-web" || !web_online || !web_visible {
            self.web_owns_display = false;
            return false;
        }
        if matches!(foreground_kind, "host" | "self" | "desktop" | "other") {
            self.web_owns_display = false;
            return false;
        }
        if foreground_kind == "shell" {
            if !web_visible {
                self.web_owns_display = false;
                return false;
            }
            self.web_owns_display = self.web_owns_display || web_active;
            return self.web_owns_display;
        }
        self.web_owns_display = web_active;
        self.web_owns_display
    }
}

#[derive(Debug, Clone, Default)]
pub struct WebCompanionState {
    pub last_seen_ms: u64,
    pub active: bool,
    pub visible: bool,
    pub quota: Option<Value>,
    pub client: String,
}

impl WebCompanionState {
    pub fn snapshot(&self, port: Option<u16>, now: u64) -> Value {
        let online = self.last_seen_ms > 0 && now.saturating_sub(self.last_seen_ms) < 15_000;
        let active = online && self.active && now.saturating_sub(self.last_seen_ms) < 12_000;
        let visible = online && self.visible;
        json!({
            "port": port,
            "online": online,
            "active": active,
            "visible": visible,
            "lastSeen": if self.last_seen_ms > 0 { json!(self.last_seen_ms) } else { Value::Null },
            "quota": self.quota.clone().unwrap_or(Value::Null),
            "client": self.client
        })
    }

    pub fn status_tuple(&self, now: u64) -> (bool, bool, bool) {
        let online = self.last_seen_ms > 0 && now.saturating_sub(self.last_seen_ms) < 15_000;
        let active = online && self.active && now.saturating_sub(self.last_seen_ms) < 12_000;
        let visible = online && self.visible;
        (online, active, visible)
    }
}

pub fn build_quota_windows_json(demo_quota: bool) -> Value {
    if demo_quota {
        json!({
            "status": "ready",
            "online": true,
            "fiveHour": 84,
            "weekly": 91,
            "fiveHourReset": "2小时15分钟后重置",
            "weeklyReset": "3天后重置",
            "claudeGpt": {
                "fiveHour": 76,
                "weekly": 88,
                "fiveHourReset": "",
                "weeklyReset": ""
            },
            "modelInfo": {
                "modelName": "Gemini 4 Neon",
                "thinking": "XHigh",
                "orchestrator": true,
                "fullText": "Orchestrator Gemini 4 Neon (XHigh)"
            },
            "cached": false,
            "stale": false
        })
    } else {
        json!({
            "status": "waiting-host",
            "online": false,
            "fiveHour": null,
            "weekly": null,
            "fiveHourReset": "",
            "weeklyReset": "",
            "claudeGpt": { "fiveHour": null, "weekly": null, "fiveHourReset": "", "weeklyReset": "" },
            "modelInfo": null,
            "cached": false,
            "stale": false
        })
    }
}

pub struct RuntimeData {
    pub wv2_dir: PathBuf,
    pub settings_path: PathBuf,
    pub settings: Map<String, Value>,
    pub dream_skin_path: PathBuf,
    pub dream_skin: Map<String, Value>,
    pub sm: StateMachine,
    pub ledger: UsageLedger,
    pub model_activity: ModelActivity,
    pub source_status: SourceStatus,
    pub web_companion: WebCompanionState,
    pub companion_visibility: CompanionVisibility,
    pub bridge_port: Option<u16>,
    pub bundled_wallpapers_dir: Option<PathBuf>,
    pub bundled_characters_dir: Option<PathBuf>,
    pub online_seed_dir: Option<PathBuf>,
    pub user_wallpapers_dir: PathBuf,
    pub user_characters_dir: PathBuf,
    pub character_packs: Vec<CharacterPack>,
    pub wallpapers: Vec<WallpaperPack>,
    pub art_version: String,
    pub art_shift: f64,
    pub art_shift_y: f64,
    pub dock_side: String,
    pub facing: String,
    pub display_scale: i32,
    pub host_area: Option<Rect>,
    pub host_area_phys: Option<Rect>,
    pub host_layout_key: String,
    pub foreground_kind: String,
    pub effective_foreground: String,
    pub native_attached: bool,
    pub window_visible: bool,
    pub displays: Vec<DisplayInfo>,
    pub active_display: Option<DisplayInfo>,
    pub demo_quota: bool,
    pub gpu_mode: String,
    pub browser_args: String,
    pub test_drag: bool,
    pub test_slideshow_ms: Option<u64>,
    pub dom_probe: Option<Value>,
    pub ready_reported: bool,
    pub benchmark_out: Option<PathBuf>,
    pub slideshow_gen: u64,
    pub host_quota: Value,
    pub skin_status: Value,
    pub localization_status: Value,
    pub host_diagnostic: Value,
}

pub struct SharedApp {
    pub runtime: Mutex<RuntimeData>,
    pub hit_rects: Mutex<Vec<HitRect>>,
    pub dialogue_lines: Value,
    pub dialogue_tags: Value,
    pub audio_catalog: AudioCatalog,
    pub pet_hwnd: AtomicIsize,
    pub dragging: AtomicBool,
    pub drag_gen: AtomicU64,
    pub click_through: AtomicBool,
    pub ignored: AtomicBool,
    pub quitting: AtomicBool,
    pub fg_follow_pet: AtomicBool,
    pub fg_enabled: AtomicBool,
    pub hit_rect_updates: AtomicU64,
}

impl SharedApp {
    pub fn new(
        data_dir: PathBuf,
        skin_dir: PathBuf,
        wv2_dir: PathBuf,
        benchmark_out: Option<PathBuf>,
        demo_quota: bool,
        gpu_mode: String,
        browser_args: String,
        test_drag: bool,
        isolated: bool,
        test_slideshow_ms: Option<u64>,
        displays: Vec<DisplayInfo>,
    ) -> Arc<Self> {
        let settings_path = data_dir.join("settings.json");
        let skip_home_seed = isolated;
        let initial_settings = load_or_seed_settings(&settings_path, benchmark_out.is_some(), skip_home_seed);

        let _ = fs::create_dir_all(&skin_dir);
        let dream_skin_path = skin_dir.join("settings.json");
        let mut initial_dream_skin = load_or_seed_dream_skin(&dream_skin_path, skip_home_seed);

        let user_wallpapers_dir = skin_dir.join("wallpapers");
        let user_characters_dir = data_dir.join("character-packs");

        let repo_root = discover_repo_root();
        let bundled_wallpapers_dir = repo_root
            .as_ref()
            .map(|r| r.join("Antigravity-Dream-Skin/assets/wallpapers"))
            .filter(|p| p.is_dir());
        let bundled_characters_dir = repo_root
            .as_ref()
            .map(|r| r.join("Antigravity-Cat-Widget/assets/character-packs"))
            .filter(|p| p.is_dir())
            .or_else(|| {
                let fd = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("frontend-dist/assets/character-packs");
                if fd.is_dir() { Some(fd) } else { None }
            });
        let online_seed_dir = repo_root
            .as_ref()
            .map(|r| r.join("online-assets"))
            .filter(|p| p.is_dir());

        let wallpapers = list_wallpaper_packs(bundled_wallpapers_dir.as_deref(), &user_wallpapers_dir);
        let character_packs = list_character_packs(bundled_characters_dir.as_deref(), &user_characters_dir);
        let art_version = compute_art_version(bundled_characters_dir.as_deref(), &user_characters_dir);

        // Migrate legacy autoRotate & sync initial wallpaperFile / wallpaperId
        let migrating = initial_dream_skin
            .get("legacyMigrated")
            .and_then(|v| v.as_bool())
            != Some(true);
        if migrating {
            if let Some(rot_patch) = legacy_rotate_patch(&initial_dream_skin) {
                for (k, v) in rot_patch {
                    initial_dream_skin.insert(k, v);
                }
            }
            initial_dream_skin.insert("legacyMigrated".into(), json!(true));
        }
        if let Some((sel_id, sel_file)) = select_wallpaper(&wallpapers, &initial_dream_skin, migrating) {
            initial_dream_skin.insert("wallpaperId".into(), json!(sel_id));
            initial_dream_skin.insert("wallpaperFile".into(), json!(sel_file));
        }
        initial_dream_skin = sanitize_dream_skin(&initial_dream_skin);
        let _ = atomic_write_json(&dream_skin_path, &initial_dream_skin);

        let ledger = UsageLedger::load(data_dir.join("usage-v2.json"));
        let dialogue: Value =
            serde_json::from_str(DIALOGUE_JSON).unwrap_or_else(|_| json!({}));
        let dialogue_lines = dialogue.get("lines").cloned().unwrap_or_else(|| json!({}));
        let dialogue_tags = dialogue
            .get("expressionTags")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let audio_catalog = AudioCatalog::load();

        let click_through = initial_settings
            .get("clickThrough")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let scale = initial_settings
            .get("scale")
            .and_then(|v| v.as_i64())
            .unwrap_or(220) as i32;
        let host_only = initial_settings
            .get("hostWindowOnly")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let side_quota = initial_settings
            .get("sideQuotaEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let pet_mode = initial_settings
            .get("petDisplayMode")
            .and_then(|v| v.as_str())
            .unwrap_or("both");
        let need_fg = host_only || pet_mode == "prefer-web" || side_quota;
        let primary = displays
            .iter()
            .find(|d| d.is_primary)
            .or_else(|| displays.first())
            .copied();

        Arc::new(Self {
            runtime: Mutex::new(RuntimeData {
                wv2_dir,
                settings_path,
                settings: initial_settings,
                dream_skin_path,
                dream_skin: initial_dream_skin,
                sm: StateMachine::new("offline"),
                ledger,
                model_activity: ModelActivity::new(),
                source_status: SourceStatus {
                    online: false,
                    files: 0,
                    last_updated: None,
                },
                web_companion: WebCompanionState::default(),
                companion_visibility: CompanionVisibility::default(),
                bridge_port: None,
                bundled_wallpapers_dir,
                bundled_characters_dir,
                online_seed_dir,
                user_wallpapers_dir,
                user_characters_dir,
                character_packs,
                wallpapers,
                art_version,
                art_shift: 0.0,
                art_shift_y: 0.0,
                dock_side: String::new(),
                facing: "right".to_string(),
                display_scale: scale,
                host_area: None,
                host_area_phys: None,
                host_layout_key: String::new(),
                foreground_kind: "unknown".to_string(),
                effective_foreground: "unknown".to_string(),
                native_attached: false,
                window_visible: false,
                displays,
                active_display: primary,
                demo_quota,
                gpu_mode,
                browser_args,
                test_drag,
                test_slideshow_ms,
                dom_probe: None,
                ready_reported: false,
                benchmark_out,
                slideshow_gen: 1,
                host_quota: build_quota_windows_json(demo_quota),
                skin_status: json!({
                    "connected": false,
                    "applied": false,
                    "reason": Value::Null,
                    "message": "等待连接 Antigravity"
                }),
                localization_status: json!({
                    "applied": false,
                    "reason": Value::Null,
                    "message": "翻译层未启用"
                }),
                host_diagnostic: json!({
                    "state": "not-connected",
                    "connected": false,
                    "running": false,
                    "cdpAvailable": false,
                    "shortcutsSupported": cfg!(windows),
                    "shortcutsConfigured": false
                }),
            }),
            hit_rects: Mutex::new(Vec::new()),
            dialogue_lines,
            dialogue_tags,
            audio_catalog,
            pet_hwnd: AtomicIsize::new(0),
            dragging: AtomicBool::new(false),
            drag_gen: AtomicU64::new(0),
            click_through: AtomicBool::new(click_through),
            ignored: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
            fg_follow_pet: AtomicBool::new(host_only),
            fg_enabled: AtomicBool::new(need_fg),
            hit_rect_updates: AtomicU64::new(0),
        })
    }

    pub fn build_snapshot(&self) -> Value {
        let rt = self.runtime.lock().unwrap();
        let now = now_ms();
        let quota_windows = if rt.demo_quota {
            build_quota_windows_json(true)
        } else {
            rt.host_quota.clone()
        };
        let manual_pct = if rt.settings.get("manualQuota").and_then(|v| v.as_bool()) == Some(true) {
            rt.settings.get("manualPercent").and_then(|v| v.as_f64())
        } else {
            None
        };
        let char_packs: Vec<Value> = rt
            .character_packs
            .iter()
            .map(|p| character_pack_to_snapshot_json(p, rt.bridge_port))
            .collect();
        let wall_list: Vec<Value> = rt
            .wallpapers
            .iter()
            .filter(|w| w.file.is_some())
            .map(|w| wallpaper_to_snapshot_json(w, rt.bridge_port))
            .collect();

        json!({
            "artShift": rt.art_shift,
            "artShiftY": rt.art_shift_y,
            "dockSide": rt.dock_side,
            "modelActivity": rt.model_activity.snapshot(now),
            "quotaWindows": quota_windows,
            "webCompanion": rt.web_companion.snapshot(rt.bridge_port, now),
            "byok": { "available": false, "gatewayOnline": false },
            "facing": rt.facing,
            "state": rt.sm.display_state(),
            "persistentState": rt.sm.persistent_state,
            "dialogue": self.dialogue_lines,
            "dialogueTags": self.dialogue_tags,
            "settings": Value::Object(rt.settings.clone()),
            "dreamSkin": Value::Object(rt.dream_skin.clone()),
            "skinStatus": rt.skin_status.clone(),
            "localizationStatus": rt.localization_status.clone(),
            "hostDiagnostic": rt.host_diagnostic.clone(),
            "characterPacks": char_packs,
            "wallpapers": wall_list,
            "artVersion": rt.art_version,
            "displayScale": rt.display_scale,
            "visibility": {
                "visible": rt.window_visible,
                "supported": cfg!(windows),
                "foreground": rt.foreground_kind,
                "foregroundKind": rt.foreground_kind,
                "effectiveForeground": rt.effective_foreground,
                "nativeAttached": rt.native_attached,
                "withinHost": rt.host_area.is_some()
            },
            "ledger": rt.ledger.get_snapshot(now as i64, manual_pct),
            "source": rt.source_status.to_json(),
            "presets": self.audio_catalog.preset_list_json()
        })
    }

    pub fn build_companion_state_payload(&self, include_agy_quota: bool) -> Value {
        let rt = self.runtime.lock().unwrap();
        let now = now_ms();
        let ds = &rt.dream_skin;
        let settings = &rt.settings;

        let usable_walls: Vec<&WallpaperPack> =
            rt.wallpapers.iter().filter(|w| w.file.is_some()).collect();
        let sel = select_wallpaper(&rt.wallpapers, ds, false);
        let active_wall_id = sel
            .as_ref()
            .map(|(id, _)| id.clone())
            .or_else(|| {
                ds.get("wallpaperId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "gemini-character-sheet-v1".to_string());
        let active_wall = usable_walls.iter().copied().find(|w| w.id == active_wall_id);

        let wall_mtime_ms: u64 = active_wall
            .and_then(|w| w.file.as_ref())
            .and_then(|fp| fs::metadata(fp).ok())
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let sync_interaction = settings
            .get("syncInteraction")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let honor_mode = settings
            .get("userHonorificMode")
            .and_then(|v| v.as_str())
            .unwrap_or("none");
        let honorific = if sync_interaction {
            json!({
                "mode": honor_mode,
                "name": if honor_mode == "custom" {
                    settings.get("customHonorific").and_then(|v| v.as_str()).unwrap_or("")
                } else { "" }
            })
        } else {
            Value::Null
        };

        let chat_tint = ds
            .get("chatTint")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("#181224");
        let chat_opacity = ds
            .get("chatOpacity")
            .and_then(|v| v.as_f64())
            .unwrap_or(100.0);
        let output_mode = ds
            .get("outputMode")
            .and_then(|v| v.as_str())
            .unwrap_or("transparent");
        let reply_opacity = ds
            .get("replyOpacity")
            .and_then(|v| v.as_f64())
            .unwrap_or(if output_mode == "glass" { 22.0 } else { 0.0 });

        let mut desktop = Map::new();
        desktop.insert(
            "characterPack".into(),
            json!(settings.get("characterPack").and_then(|v| v.as_str()).unwrap_or("gemini-star-v1")),
        );
        desktop.insert(
            "characterPackIds".into(),
            json!(rt.character_packs.iter().map(|p| p.id.clone()).collect::<Vec<_>>()),
        );
        desktop.insert("scale".into(), json!(settings.get("scale").and_then(|v| v.as_i64()).unwrap_or(220)));
        desktop.insert("sound".into(), json!(settings.get("sound").and_then(|v| v.as_bool()).unwrap_or(false)));
        desktop.insert("easterEggs".into(), json!(settings.get("easterEggs").and_then(|v| v.as_bool()).unwrap_or(true)));
        desktop.insert("clickCatAction".into(), settings.get("clickCatAction").cloned().unwrap_or_else(|| json!("talk")));
        desktop.insert("honorific".into(), honorific);
        desktop.insert("modelActivity".into(), rt.model_activity.snapshot(now));
        desktop.insert("themePreset".into(), json!(ds.get("themePreset").and_then(|v| v.as_str()).unwrap_or("violet")));
        desktop.insert("chatAppearance".into(), json!({
            "tint": chat_tint,
            "opacity": chat_opacity,
            "reply": reply_opacity
        }));
        desktop.insert("skinEnabled".into(), json!(ds.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false)));
        desktop.insert("wallpaperId".into(), json!(active_wall_id));
        desktop.insert(
            "wallpaperIds".into(),
            json!(usable_walls.iter().map(|w| w.id.clone()).collect::<Vec<_>>()),
        );
        desktop.insert(
            "wallpaperTitle".into(),
            json!(active_wall.map(|w| w.title.as_str()).unwrap_or("默认星语设定集")),
        );
        desktop.insert("wallpaperRev".into(), json!(format!("{active_wall_id}:{wall_mtime_ms}")));
        desktop.insert(
            "wallpaperTransition".into(),
            json!(if ds.get("transition").and_then(|v| v.as_str()) == Some("none") { "none" } else { "fade" }),
        );
        desktop.insert("wallpaperFit".into(), json!(ds.get("fit").and_then(|v| v.as_str()).unwrap_or("adaptive")));
        desktop.insert("opacity".into(), ds.get("opacity").cloned().unwrap_or_else(|| json!(22)));
        desktop.insert("scrim".into(), ds.get("scrim").cloned().unwrap_or_else(|| json!(25)));
        desktop.insert("slideshow".into(), json!(ds.get("slideshow").and_then(|v| v.as_bool()).unwrap_or(true)));
        desktop.insert(
            "slideshowIntervalMinutes".into(),
            ds.get("slideshowIntervalMinutes").cloned().unwrap_or_else(|| json!(5)),
        );
        desktop.insert("hostActive".into(), json!(rt.foreground_kind == "host"));

        if include_agy_quota {
            let manual = settings.get("manualQuota").and_then(|v| v.as_bool()) == Some(true);
            let q = if rt.demo_quota {
                build_quota_windows_json(true)
            } else {
                rt.host_quota.clone()
            };
            let model_name = q
                .get("modelInfo")
                .and_then(|m| m.get("modelName"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let five_hour = if manual {
                settings.get("manualPercent").cloned().unwrap_or(Value::Null)
            } else {
                q.get("fiveHour").cloned().unwrap_or(Value::Null)
            };
            let weekly = if manual {
                settings.get("manualWeeklyPercent").cloned().unwrap_or(Value::Null)
            } else {
                q.get("weekly").cloned().unwrap_or(Value::Null)
            };
            desktop.insert("agyQuota".into(), json!({
                "fiveHour": five_hour,
                "weekly": weekly,
                "fiveHourReset": if manual { json!("") } else { q.get("fiveHourReset").cloned().unwrap_or_else(|| json!("")) },
                "weeklyReset": if manual { json!("") } else { q.get("weeklyReset").cloned().unwrap_or_else(|| json!("")) },
                "geminiWeekly": if manual { settings.get("manualWeeklyPercent").cloned().unwrap_or(Value::Null) } else { q.get("weekly").cloned().unwrap_or(Value::Null) },
                "geminiWeeklyReset": if manual { json!("") } else { q.get("weeklyReset").cloned().unwrap_or_else(|| json!("")) },
                "claudeGpt": q.get("claudeGpt").cloned().unwrap_or(Value::Null),
                "modelName": model_name,
                "orchestrator": q.get("modelInfo").and_then(|m| m.get("orchestrator")).and_then(|v| v.as_bool()).unwrap_or(false)
            }));
        }

        json!({
            "ok": true,
            "ts": now,
            "port": rt.bridge_port,
            "sync": {
                "syncCharacter": settings.get("syncCharacter").and_then(|v| v.as_bool()).unwrap_or(true),
                "syncWallpaper": settings.get("syncWallpaper").and_then(|v| v.as_bool()).unwrap_or(true),
                "syncInteraction": sync_interaction,
                "petDisplayMode": settings.get("petDisplayMode").and_then(|v| v.as_str()).unwrap_or("both")
            },
            "desktop": Value::Object(desktop),
            "web": rt.web_companion.snapshot(rt.bridge_port, now)
        })
    }

    pub fn build_companion_wallpapers_payload(&self) -> Value {
        let rt = self.runtime.lock().unwrap();
        let items: Vec<Value> = rt
            .wallpapers
            .iter()
            .filter(|w| w.file.is_some())
            .map(|w| {
                let mut obj = wallpaper_to_snapshot_json(w, rt.bridge_port);
                if let Some(m) = obj.as_object_mut() {
                    m.insert("revision".into(), json!(wallpaper_revision(w)));
                }
                obj
            })
            .collect();
        json!({ "ok": true, "wallpapers": items })
    }

    pub fn resolve_wallpaper_path(&self, requested_id: Option<&str>) -> Option<PathBuf> {
        let rt = self.runtime.lock().unwrap();
        let fallback_id = rt
            .dream_skin
            .get("wallpaperId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let fallback_file = rt
            .dream_skin
            .get("wallpaperFile")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        resolve_wallpaper_file(&rt.wallpapers, requested_id, fallback_id, fallback_file)
    }

    pub fn resolve_character_frame_path(&self, pack_id: &str, frame: &str) -> Option<PathBuf> {
        let rt = self.runtime.lock().unwrap();
        resolve_character_frame_file(&rt.character_packs, pack_id, frame)
    }

    pub fn refresh_assets(&self) {
        let mut rt = self.runtime.lock().unwrap();
        rt.wallpapers =
            list_wallpaper_packs(rt.bundled_wallpapers_dir.as_deref(), &rt.user_wallpapers_dir);
        rt.character_packs =
            list_character_packs(rt.bundled_characters_dir.as_deref(), &rt.user_characters_dir);
        rt.art_version =
            compute_art_version(rt.bundled_characters_dir.as_deref(), &rt.user_characters_dir);

        let selected_pack = rt
            .settings
            .get("characterPack")
            .and_then(|v| v.as_str())
            .unwrap_or("gemini-star-v1")
            .to_string();
        if !rt.character_packs.iter().any(|p| p.id == selected_pack) {
            rt.settings.insert("characterPack".into(), json!("gemini-star-v1"));
            let _ = atomic_write_json(&rt.settings_path, &rt.settings);
        }
    }

    pub fn update_dream_skin_transactional(
        &self,
        patch: &Map<String, Value>,
    ) -> Result<(Map<String, Value>, bool), String> {
        let mut rt = self.runtime.lock().unwrap();
        let previous = rt.dream_skin.clone();
        let mut merged = previous.clone();
        for (k, v) in patch {
            if k == "legacyMigrated" {
                continue;
            }
            merged.insert(k.clone(), v.clone());
        }
        if patch.contains_key("wallpaperId") || patch.contains_key("wallpaperFile") {
            let file_only = !patch.contains_key("wallpaperId");
            if let Some((sel_id, sel_file)) = select_wallpaper(&rt.wallpapers, &merged, file_only) {
                merged.insert("wallpaperId".into(), json!(sel_id));
                merged.insert("wallpaperFile".into(), json!(sel_file));
            }
        }
        let sanitized = sanitize_dream_skin(&merged);
        atomic_write_json(&rt.dream_skin_path, &sanitized)?;
        rt.dream_skin = sanitized.clone();

        let slideshow_changed = ["slideshow", "slideshowIntervalMinutes", "wallpaperId"]
            .iter()
            .any(|k| sanitized.get(*k) != previous.get(*k));
        if slideshow_changed {
            rt.slideshow_gen = rt.slideshow_gen.wrapping_add(1);
        }
        Ok((sanitized, slideshow_changed))
    }

    pub fn next_wallpaper_patch(&self) -> Option<Map<String, Value>> {
        let rt = self.runtime.lock().unwrap();
        let cur_id = rt
            .dream_skin
            .get("wallpaperId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let next = next_wallpaper_id(&rt.wallpapers, cur_id)?;
        if next == cur_id {
            return None;
        }
        let next_file = rt
            .wallpapers
            .iter()
            .find(|w| w.id == next)
            .and_then(|w| w.file.as_ref())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let mut patch = Map::new();
        patch.insert("wallpaperId".into(), json!(next));
        patch.insert("wallpaperFile".into(), json!(next_file));
        Some(patch)
    }

    pub fn update_settings_transactional(
        &self,
        patch: &Map<String, Value>,
        allow_all_keys: bool,
    ) -> Result<Map<String, Value>, String> {
        let mut rt = self.runtime.lock().unwrap();
        let mut candidate = rt.settings.clone();
        for (k, v) in patch {
            if k == "characterPack" {
                if let Some(pack_id) = v.as_str() {
                    if !rt.character_packs.iter().any(|p| p.id == pack_id) {
                        continue;
                    }
                }
            }
            if allow_all_keys || ALLOWED_SETTINGS_KEYS.contains(&k.as_str()) {
                candidate.insert(k.clone(), v.clone());
            }
        }
        let sanitized = sanitize_settings(&candidate);
        atomic_write_json(&rt.settings_path, &sanitized)?;
        rt.settings = sanitized.clone();
        let ct = sanitized
            .get("clickThrough")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        self.click_through.store(ct, Ordering::Relaxed);
        let host_only = sanitized
            .get("hostWindowOnly")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let side_quota = sanitized
            .get("sideQuotaEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let pet_mode = sanitized
            .get("petDisplayMode")
            .and_then(|v| v.as_str())
            .unwrap_or("both");
        self.fg_follow_pet.store(host_only, Ordering::Relaxed);
        self.fg_enabled
            .store(host_only || pet_mode == "prefer-web" || side_quota, Ordering::Relaxed);
        Ok(sanitized)
    }

    pub fn needs_foreground_monitor(&self) -> bool {
        self.fg_enabled.load(Ordering::Relaxed)
    }

    pub fn reset_to_defaults(&self, dream_enabled_default: bool) -> Result<(), String> {
        let mut rt = self.runtime.lock().unwrap();
        let next_settings = sanitize_settings(&default_settings());
        let mut next_skin = crate::dream_skin::sanitize_dream_skin(&crate::dream_skin::default_dream_skin());
        next_skin.insert("enabled".into(), json!(dream_enabled_default));
        if let Some((sel_id, sel_file)) = select_wallpaper(&rt.wallpapers, &next_skin, false) {
            next_skin.insert("wallpaperId".into(), json!(sel_id));
            next_skin.insert("wallpaperFile".into(), json!(sel_file));
        }
        next_skin = crate::dream_skin::sanitize_dream_skin(&next_skin);
        atomic_write_json(&rt.settings_path, &next_settings)?;
        atomic_write_json(&rt.dream_skin_path, &next_skin)?;
        rt.settings = next_settings.clone();
        rt.dream_skin = next_skin;
        self.click_through.store(false, Ordering::Relaxed);
        self.fg_follow_pet.store(false, Ordering::Relaxed);
        self.fg_enabled.store(true, Ordering::Relaxed);
        rt.slideshow_gen = rt.slideshow_gen.wrapping_add(1);
        Ok(())
    }
}

fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn load_or_seed_settings(
    settings_path: &Path,
    is_benchmark: bool,
    skip_home_seed: bool,
) -> Map<String, Value> {
    if let Ok(bytes) = fs::read(settings_path) {
        if let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(&bytes) {
            return sanitize_settings(&map);
        }
    }
    if !skip_home_seed {
        if let Some(home) = user_home_dir() {
            let prod_settings = home.join(".antigravity-cat-widget").join("settings.json");
            if let Ok(bytes) = fs::read(prod_settings) {
                if let Ok(Value::Object(mut map)) = serde_json::from_slice::<Value>(&bytes) {
                    if is_benchmark {
                        map.insert("x".into(), json!(64));
                        map.insert("y".into(), json!(80));
                        map.insert("desktopArtShiftX".into(), json!(0));
                        map.insert("desktopArtShiftY".into(), json!(0));
                        map.insert("clickThrough".into(), json!(false));
                        map.insert("hostWindowOnly".into(), json!(false));
                        map.insert("standaloneDesktopMode".into(), json!(true));
                        map.insert("bubbleOn".into(), json!(true));
                        map.insert("sideQuotaEnabled".into(), json!(true));
                    }
                    let sanitized = sanitize_settings(&map);
                    let _ = atomic_write_json(settings_path, &sanitized);
                    return sanitized;
                }
            }
        }
    }
    let defaults = sanitize_settings(&default_settings());
    let _ = atomic_write_json(settings_path, &defaults);
    defaults
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_settings_clamps_bounds_and_enums() {
        let mut raw = Map::new();
        raw.insert("scale".into(), json!(999));
        raw.insert("volume".into(), json!(2.5));
        raw.insert("soundSet".into(), json!("invalid-sound"));
        raw.insert("bubbleTint".into(), json!("#AABBCC"));
        raw.insert("bubbleOpacity".into(), json!(5));
        raw.insert("talkCategory".into(), json!("legacy"));
        raw.insert("characterPack".into(), json!("online-custom-cat"));
        raw.insert("userHonorificMode".into(), json!("zayu"));

        let s = sanitize_settings(&raw);
        assert_eq!(s.get("scale").unwrap().as_i64().unwrap(), 360);
        assert_eq!(s.get("volume").unwrap().as_f64().unwrap(), 1.0);
        assert_eq!(s.get("soundSet").unwrap().as_str().unwrap(), "bubble-pop");
        assert_eq!(s.get("bubbleTint").unwrap().as_str().unwrap(), "#aabbcc");
        assert_eq!(s.get("bubbleOpacity").unwrap().as_f64().unwrap(), 30.0);
        assert_eq!(s.get("characterPack").unwrap().as_str().unwrap(), "online-custom-cat");
        assert!(!s.contains_key("talkCategory"));
        assert_eq!(s["userHonorificMode"], "none");
        raw.insert("userHonorificMode".into(), json!("custom"));
        raw.insert("customHonorific".into(), json!("朋友"));
        assert_eq!(sanitize_settings(&raw)["customHonorific"], "朋友");

        raw.insert("sideQuotaPalette".into(), json!("bogus"));
        raw.insert("sideQuotaColor".into(), json!("#FF66AA"));
        raw.insert("sideQuotaStyle".into(), json!("bad-style"));
        raw.insert("sideQuotaOpacity".into(), json!(12));
        raw.insert("seenCatalogIds".into(), json!(["bad/../id", "pack-1", "pack-1", "pack-2"]));
        raw.insert("dismissedUpdateVersion".into(), json!("  0.8.0  "));
        let s2 = sanitize_settings(&raw);
        assert_eq!(s2["sideQuotaPalette"], "theme");
        assert_eq!(s2["sideQuotaColor"], "#ff66aa");
        assert_eq!(s2["sideQuotaStyle"], "glass");
        assert_eq!(s2["sideQuotaOpacity"], 40);
        assert_eq!(s2["seenCatalogIds"], json!(["pack-1", "pack-2"]));
        assert_eq!(s2["dismissedUpdateVersion"], "0.8.0");
    }

    #[test]
    fn companion_visibility_handles_prefer_web_and_shell_latch() {
        let mut cv = CompanionVisibility::default();
        assert!(!cv.hide_desktop("both", true, true, true, "browser"));
        assert!(!cv.hide_desktop("prefer-desktop", true, true, true, "browser"));
        assert!(cv.hide_desktop("prefer-web", true, true, true, "browser"));
        assert!(cv.hide_desktop("prefer-web", true, false, true, "shell"));
        assert!(!cv.hide_desktop("prefer-web", true, true, false, "shell"));
        assert!(!cv.hide_desktop("prefer-web", true, true, false, "browser"));
        assert!(cv.hide_desktop("prefer-web", true, true, true, "browser"));
        assert!(!cv.hide_desktop("prefer-web", true, true, true, "host"));
        assert!(!cv.hide_desktop("prefer-web", false, true, true, "browser"));
    }

    #[test]
    fn transactional_write_preserves_memory_when_disk_write_fails() {
        let dir = std::env::temp_dir().join(format!("catstella-state-txn-{}", std::process::id()));
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

        let mut p1 = Map::new();
        p1.insert("scale".into(), json!(260));
        let ok = app.update_settings_transactional(&p1, false).unwrap();
        assert_eq!(ok.get("scale").unwrap().as_i64().unwrap(), 260);

        // Make settings.json a directory so rename fails on write.
        let settings_path = dir.join("settings.json");
        fs::remove_file(&settings_path).unwrap();
        fs::create_dir(&settings_path).unwrap();

        let mut p2 = Map::new();
        p2.insert("scale".into(), json!(180));
        let err = app.update_settings_transactional(&p2, false);
        assert!(err.is_err());

        let current = app.runtime.lock().unwrap().settings.get("scale").unwrap().as_i64().unwrap();
        assert_eq!(current, 260);

        let _ = fs::remove_dir_all(&dir);
    }
}
