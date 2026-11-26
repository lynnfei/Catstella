use crate::state::atomic_write_json;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_WALLPAPER_ID: &str = "gemini-character-sheet-v1";
pub const THEME_PRESETS: &[&str] = &["violet", "pink", "ocean", "onyx"];
const FIT_MODES: &[&str] = &["cover", "contain", "adaptive"];
const UI_LANGUAGES: &[&str] = &["en", "zh-CN"];

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn is_hex_color(s: &str) -> bool {
    s.len() == 7
        && s.starts_with('#')
        && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn finite_number(v: Option<&Value>, fallback: f64, min: f64, max: f64) -> Value {
    let val = match v.and_then(|x| x.as_f64()) {
        Some(n) if n.is_finite() => n.clamp(min, max),
        _ => fallback,
    };
    if (val - val.round()).abs() < 1e-9 {
        json!(val.round() as i64)
    } else {
        json!(val)
    }
}

fn opt_finite_number(v: Option<&Value>, min: f64, max: f64) -> Value {
    match v.and_then(|x| x.as_f64()) {
        Some(n) if n.is_finite() => {
            let clamped = n.clamp(min, max);
            if (clamped - clamped.round()).abs() < 1e-9 {
                json!(clamped.round() as i64)
            } else {
                json!(clamped)
            }
        }
        _ => Value::Null,
    }
}

pub fn default_dream_skin() -> Map<String, Value> {
    let v: Value = serde_json::from_str(
        r#"{
        "enabled": false,
        "themePreset": "violet",
        "outputMode": "transparent",
        "chatTint": "",
        "chatOpacity": null,
        "replyOpacity": null,
        "positionX": 50,
        "positionY": 50,
        "zoom": 1,
        "fit": "adaptive",
        "scrim": 12,
        "opacity": 55,
        "wallpaperId": "gemini-character-sheet-v1",
        "wallpaperFile": "",
        "slideshow": true,
        "slideshowIntervalMinutes": 5,
        "uiLanguage": "en",
        "transition": "fade",
        "protectEditor": true,
        "protectTerminal": true
    }"#,
    )
    .unwrap_or_else(|_| json!({}));
    v.as_object().cloned().unwrap_or_default()
}

/// Sanitize DreamSkin settings preserving unknown/legacy extension fields while validating known ones.
pub fn sanitize_dream_skin(input: &Map<String, Value>) -> Map<String, Value> {
    let mut s = default_dream_skin();
    for (k, v) in input {
        s.insert(k.clone(), v.clone());
    }

    let theme_preset = match input.get("themePreset").and_then(|v| v.as_str()) {
        Some(t) if THEME_PRESETS.contains(&t) => t,
        _ => "violet",
    };
    s.insert("themePreset".into(), json!(theme_preset));

    let output_mode = match input.get("outputMode").and_then(|v| v.as_str()) {
        Some("glass") => "glass",
        _ => "transparent",
    };
    s.insert("outputMode".into(), json!(output_mode));

    let enabled = input
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    s.insert("enabled".into(), json!(enabled));

    s.insert("positionX".into(), finite_number(input.get("positionX"), 50.0, 0.0, 100.0));
    s.insert("positionY".into(), finite_number(input.get("positionY"), 50.0, 0.0, 100.0));
    s.insert("zoom".into(), finite_number(input.get("zoom"), 1.0, 1.0, 2.0));

    let fit = match input.get("fit").and_then(|v| v.as_str()) {
        Some(f) if FIT_MODES.contains(&f) => f,
        _ => "adaptive",
    };
    s.insert("fit".into(), json!(fit));

    s.insert("scrim".into(), finite_number(input.get("scrim"), 12.0, 0.0, 60.0));
    s.insert("opacity".into(), finite_number(input.get("opacity"), 55.0, 0.0, 100.0));

    let wallpaper_id = input
        .get("wallpaperId")
        .and_then(|v| v.as_str())
        .map(|st| st.trim())
        .filter(|st| !st.is_empty())
        .unwrap_or(DEFAULT_WALLPAPER_ID)
        .to_string();
    s.insert("wallpaperId".into(), json!(wallpaper_id));

    let wallpaper_file = input
        .get("wallpaperFile")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    s.insert("wallpaperFile".into(), json!(wallpaper_file));

    let slideshow = input
        .get("slideshow")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    s.insert("slideshow".into(), json!(slideshow));

    s.insert(
        "slideshowIntervalMinutes".into(),
        finite_number(input.get("slideshowIntervalMinutes"), 5.0, 1.0, 60.0),
    );

    let ui_lang = match input.get("uiLanguage").and_then(|v| v.as_str()) {
        Some(l) if UI_LANGUAGES.contains(&l) => l,
        _ => "en",
    };
    s.insert("uiLanguage".into(), json!(ui_lang));

    let transition = match input.get("transition").and_then(|v| v.as_str()) {
        Some("none") => "none",
        _ => "fade",
    };
    s.insert("transition".into(), json!(transition));

    let chat_tint = match s.get("chatTint").and_then(|v| v.as_str()) {
        Some(c) if is_hex_color(c) => c.to_ascii_lowercase(),
        _ => String::new(),
    };
    s.insert("chatTint".into(), json!(chat_tint));

    s.insert("chatOpacity".into(), opt_finite_number(s.get("chatOpacity"), 0.0, 100.0));
    s.insert("replyOpacity".into(), opt_finite_number(s.get("replyOpacity"), 0.0, 100.0));

    if let Some(id) = s.get("onlineThemeId").and_then(|v| v.as_str()) {
        let clean: String = id.chars().take(64).collect();
        s.insert("onlineThemeId".into(), json!(clean));
    }
    if let Some(rev) = s.get("onlineThemeRevision").and_then(|v| v.as_str()) {
        let clean: String = rev.chars().take(128).collect();
        s.insert("onlineThemeRevision".into(), json!(clean));
    }

    s.insert("protectEditor".into(), json!(true));
    s.insert("protectTerminal".into(), json!(true));
    s
}

pub fn legacy_rotate_patch(data: &Map<String, Value>) -> Option<Map<String, Value>> {
    let mode = data.get("autoRotate").and_then(|v| v.as_str())?;
    let mut patch = Map::new();
    match mode {
        "off" => {
            patch.insert("slideshow".into(), json!(false));
            Some(patch)
        }
        "15m" => {
            patch.insert("slideshow".into(), json!(true));
            patch.insert("slideshowIntervalMinutes".into(), json!(15));
            Some(patch)
        }
        "1h" => {
            patch.insert("slideshow".into(), json!(true));
            patch.insert("slideshowIntervalMinutes".into(), json!(60));
            Some(patch)
        }
        _ => None,
    }
}

pub fn load_or_seed_dream_skin(skin_path: &Path, skip_home_seed: bool) -> Map<String, Value> {
    if let Ok(bytes) = fs::read(skin_path) {
        if let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(&bytes) {
            return sanitize_dream_skin(&map);
        }
    }
    if !skip_home_seed {
        if let Some(home) = home_dir() {
            let prod_skin = home.join(".antigravity-dream-skin").join("settings.json");
            if let Ok(bytes) = fs::read(prod_skin) {
                if let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(&bytes) {
                    let sanitized = sanitize_dream_skin(&map);
                    let _ = atomic_write_json(skin_path, &sanitized);
                    return sanitized;
                }
            }
        }
    }
    let mut defaults = sanitize_dream_skin(&default_dream_skin());
    if !skip_home_seed {
        defaults.insert("enabled".into(), json!(true));
    }
    let _ = atomic_write_json(skin_path, &defaults);
    defaults
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_dream_skin_validates_bounds_and_preserves_extensions() {
        let mut raw = Map::new();
        raw.insert("themePreset".into(), json!("pink"));
        raw.insert("outputMode".into(), json!("glass"));
        raw.insert("opacity".into(), json!(150));
        raw.insert("scrim".into(), json!(-5));
        raw.insert("zoom".into(), json!(3.5));
        raw.insert("slideshowIntervalMinutes".into(), json!(0));
        raw.insert("chatTint".into(), json!("#12AB34"));
        raw.insert("chatOpacity".into(), json!(82));
        raw.insert("uiLanguage".into(), json!("zh-CN"));
        raw.insert("customExtensionField".into(), json!("keep-me"));

        let s = sanitize_dream_skin(&raw);
        assert_eq!(s.get("themePreset").unwrap().as_str().unwrap(), "pink");
        assert_eq!(s.get("outputMode").unwrap().as_str().unwrap(), "glass");
        assert_eq!(s.get("opacity").unwrap().as_i64().unwrap(), 100);
        assert_eq!(s.get("scrim").unwrap().as_i64().unwrap(), 0);
        assert_eq!(s.get("zoom").unwrap().as_i64().unwrap(), 2);
        assert_eq!(s.get("slideshowIntervalMinutes").unwrap().as_i64().unwrap(), 1);
        assert_eq!(s.get("chatTint").unwrap().as_str().unwrap(), "#12ab34");
        assert_eq!(s.get("chatOpacity").unwrap().as_i64().unwrap(), 82);
        assert_eq!(s.get("uiLanguage").unwrap().as_str().unwrap(), "zh-CN");
        assert!(s.get("replyOpacity").unwrap().is_null());
        assert_eq!(s.get("customExtensionField").unwrap().as_str().unwrap(), "keep-me");
    }

    #[test]
    fn legacy_rotate_patch_maps_known_intervals() {
        let mut off = Map::new();
        off.insert("autoRotate".into(), json!("off"));
        assert_eq!(legacy_rotate_patch(&off).unwrap().get("slideshow"), Some(&json!(false)));

        let mut quarter = Map::new();
        quarter.insert("autoRotate".into(), json!("15m"));
        let qp = legacy_rotate_patch(&quarter).unwrap();
        assert_eq!(qp.get("slideshow"), Some(&json!(true)));
        assert_eq!(qp.get("slideshowIntervalMinutes"), Some(&json!(15)));

        let mut hour = Map::new();
        hour.insert("autoRotate".into(), json!("1h"));
        let hp = legacy_rotate_patch(&hour).unwrap();
        assert_eq!(hp.get("slideshowIntervalMinutes"), Some(&json!(60)));

        let mut unknown = Map::new();
        unknown.insert("autoRotate".into(), json!("boot"));
        assert!(legacy_rotate_patch(&unknown).is_none());
    }
}
