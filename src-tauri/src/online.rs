use crate::assets::{probe_image, sha256_hex};
use crate::dream_skin::sanitize_dream_skin;
use crate::state::{atomic_write_json, now_ms, SharedApp};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

pub const RELEASE_NOTES_JSON: &str =
    include_str!("../../Antigravity-Cat-Widget/assets/release-notes.json");
pub const PACKAGE_JSON: &str = include_str!("../../package.json");
const RELEASES_URL: &str = "https://github.com/lynnfei/Catstella/releases";
const RELEASE_API_URL: &str = "https://api.github.com/repos/lynnfei/Catstella/releases?per_page=30";
const ASSET_BASE_URL: &str =
    "https://raw.githubusercontent.com/lynnfei/Catstella/main/online-assets/";

const MAX_CATALOG_BYTES: usize = 2 * 1024 * 1024;
const MAX_WALLPAPER_BYTES: usize = 10 * 1024 * 1024;
const MAX_CHARACTER_BYTES: usize = 3 * 1024 * 1024;
const MAX_THEME_BYTES: usize = 8 * 1024;
const MAX_RELEASES_BYTES: usize = 2 * 1024 * 1024;

#[derive(Default)]
struct CatalogCache {
    items: Vec<Value>,
    fetched_at_ms: u64,
    offline: bool,
}

#[derive(Default)]
struct UpdateCheckCache {
    last: Option<(String, u64, Value)>,
}

static CATALOG_CACHE: OnceLock<Mutex<CatalogCache>> = OnceLock::new();
static UPDATE_CACHE: OnceLock<Mutex<UpdateCheckCache>> = OnceLock::new();

fn catalog_cache() -> &'static Mutex<CatalogCache> {
    CATALOG_CACHE.get_or_init(|| Mutex::new(CatalogCache::default()))
}

fn update_cache() -> &'static Mutex<UpdateCheckCache> {
    UPDATE_CACHE.get_or_init(|| Mutex::new(UpdateCheckCache::default()))
}

pub fn current_app_version() -> String {
    serde_json::from_str::<Value>(PACKAGE_JSON)
        .ok()
        .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| "0.7.0".to_string())
}

pub fn get_unseen_release_notes(settings: &Map<String, Value>) -> Value {
    let current = current_app_version();
    let Ok(notes) = serde_json::from_str::<Value>(RELEASE_NOTES_JSON) else {
        return Value::Null;
    };
    let notes_ver = notes.get("version").and_then(|v| v.as_str()).unwrap_or("");
    if notes_ver != current {
        return Value::Null;
    }
    let seen = settings
        .get("seenReleaseNotes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .any(|s| s == current)
        })
        .unwrap_or(false);
    if seen {
        Value::Null
    } else {
        notes
    }
}

pub fn mark_release_notes_seen(state: &SharedApp, version: &str) -> Result<bool, String> {
    let current = current_app_version();
    let Ok(notes) = serde_json::from_str::<Value>(RELEASE_NOTES_JSON) else {
        return Ok(false);
    };
    let notes_ver = notes.get("version").and_then(|v| v.as_str()).unwrap_or("");
    if version != current || notes_ver != current {
        return Ok(false);
    }

    let mut next_seen: Vec<String> = {
        let rt = state.runtime.lock().unwrap();
        rt.settings
            .get("seenReleaseNotes")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    };
    if !next_seen.iter().any(|s| s == &current) {
        next_seen.push(current);
    }
    if next_seen.len() > 20 {
        let start = next_seen.len() - 20;
        next_seen = next_seen.split_off(start);
    }
    let mut patch = Map::new();
    patch.insert("seenReleaseNotes".into(), json!(next_seen));
    state.update_settings_transactional(&patch, false)?;
    Ok(true)
}

#[cfg(windows)]
fn shell_open_target(target: &str) -> bool {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb: Vec<u16> = "open\0".encode_utf16().collect();
    let file: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let res = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    (res as isize) > 32
}

pub fn open_external_url(url: &str) -> bool {
    if !url.starts_with("https://") {
        return false;
    }
    #[cfg(windows)]
    {
        return shell_open_target(url);
    }
    #[cfg(target_os = "macos")]
    {
        return Command::new("open").arg(url).spawn().is_ok();
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        return Command::new("xdg-open").arg(url).spawn().is_ok();
    }
}

pub fn open_directory(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    #[cfg(windows)]
    {
        return shell_open_target(&dir.to_string_lossy());
    }
    #[cfg(target_os = "macos")]
    {
        return Command::new("open").arg(dir).spawn().is_ok();
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        return Command::new("xdg-open").arg(dir).spawn().is_ok();
    }
}

fn http_get_bytes(url: &str, max_bytes: usize, extra_headers: &[&str]) -> Result<Vec<u8>, &'static str> {
    if !url.starts_with("https://") {
        return Err("failed");
    }
    let bin = if cfg!(windows) { "curl.exe" } else { "curl" };
    let mut cmd = Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.args([
        "--silent",
        "--show-error",
        "--fail",
        "--proto",
        "=https",
        "--tlsv1.2",
        "--max-time",
        "15",
        "--max-filesize",
        &max_bytes.to_string(),
        "-H",
        "User-Agent: Catstella",
    ]);
    for header in extra_headers {
        cmd.args(["-H", header]);
    }
    cmd.arg(url);

    let out = cmd.output().map_err(|_| "connection")?;
    if !out.status.success() {
        return Err("connection");
    }
    if out.stdout.len() > max_bytes {
        return Err("failed");
    }
    Ok(out.stdout)
}

fn is_valid_source_url(url: &str) -> bool {
    if let Some(rest) = url.strip_prefix("https://www.bilibili.com/video/BV") {
        let bv_part = rest.strip_suffix('/').unwrap_or(rest);
        return !bv_part.is_empty() && bv_part.bytes().all(|b| b.is_ascii_alphanumeric());
    }
    url.starts_with("https://github.com/lynnfei/Catstella/issues/new?")
}

fn is_valid_id_slug(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.is_empty() || bytes.len() > 48 {
        return false;
    }
    bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

fn is_valid_uninstall_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.is_empty() || bytes.len() > 61 {
        return false;
    }
    bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'-')
}

fn is_hex_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn parse_catalog_bytes(raw: &[u8]) -> Result<Vec<Value>, &'static str> {
    let data: Value = serde_json::from_slice(raw).map_err(|_| "failed")?;
    if data.get("schema").and_then(|v| v.as_i64()) != Some(1) {
        return Err("failed");
    }
    let Some(items) = data.get("items").and_then(|v| v.as_array()) else {
        return Err("failed");
    };
    let chars = data
        .get("characters")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if items.len() + chars.len() > 60 {
        return Err("failed");
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for mut item in items.iter().cloned().chain(chars) {
        let Some(obj) = item.as_object_mut() else {
            continue;
        };
        let Some(id) = obj.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
            continue;
        };
        if !is_valid_id_slug(&id) || !seen.insert(id.clone()) {
            continue;
        }
        let kind = obj.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let path_str = obj.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let sha = obj.get("sha256").and_then(|v| v.as_str()).unwrap_or("");
        let size = obj.get("size").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        if !is_hex_sha256(sha) || size == 0 {
            continue;
        }
        let ext = Path::new(path_str)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        let expected_path = format!("{kind}s/{id}.{ext}");
        if path_str != expected_path {
            continue;
        }
        let mime = match kind {
            "wallpaper" if size <= MAX_WALLPAPER_BYTES => match ext {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                _ => continue,
            },
            "theme" if ext == "json" && size <= MAX_THEME_BYTES => "application/json",
            "character" if ext == "json" && size <= MAX_CHARACTER_BYTES => "application/json",
            _ => continue,
        };
        obj.insert("mime".into(), json!(mime));
        out.push(item);
    }
    Ok(out)
}

fn read_seed_catalog(seed_dir: Option<&Path>) -> Vec<Value> {
    let Some(dir) = seed_dir else {
        return Vec::new();
    };
    fs::read(dir.join("catalog.json"))
        .ok()
        .and_then(|raw| parse_catalog_bytes(&raw).ok())
        .unwrap_or_default()
}

fn merge_catalog(primary: Vec<Value>, fallback: Vec<Value>) -> Vec<Value> {
    let mut merged = Vec::new();
    let mut seen = HashSet::new();
    for item in primary.into_iter().chain(fallback) {
        if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
            if seen.insert(id.to_string()) {
                merged.push(item);
            }
        }
    }
    merged
}

fn load_catalog(seed_dir: Option<&Path>, force: bool) -> Result<(Vec<Value>, bool), &'static str> {
    let now = now_ms();
    if !force {
        let guard = catalog_cache().lock().unwrap();
        let ttl = if guard.offline { 30_000 } else { 15 * 60_000 };
        if !guard.items.is_empty() && now.saturating_sub(guard.fetched_at_ms) < ttl {
            return Ok((guard.items.clone(), guard.offline));
        }
    }

    let local = read_seed_catalog(seed_dir);
    let remote = http_get_bytes(&format!("{ASSET_BASE_URL}catalog.json"), MAX_CATALOG_BYTES, &[])
        .and_then(|raw| parse_catalog_bytes(&raw));

    let (items, offline) = match remote {
        Ok(remote_items) => (merge_catalog(remote_items, local), false),
        Err(err) => {
            let cached = catalog_cache().lock().unwrap().items.clone();
            let fallback = merge_catalog(cached, local);
            if fallback.is_empty() {
                return Err(err);
            }
            (fallback, true)
        }
    };

    {
        let mut guard = catalog_cache().lock().unwrap();
        guard.items = items.clone();
        guard.fetched_at_ms = now_ms();
        guard.offline = offline;
    }
    Ok((items, offline))
}

fn resolve_seed_asset_path(seed_dir: &Path, rel: &str) -> Result<PathBuf, &'static str> {
    if rel.contains("..") || Path::new(rel).is_absolute() {
        return Err("failed");
    }
    let root = fs::canonicalize(seed_dir).map_err(|_| "failed")?;
    let target = fs::canonicalize(seed_dir.join(rel)).map_err(|_| "failed")?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err("failed");
    }
    Ok(target)
}

fn load_asset_bytes(
    seed_dir: Option<&Path>,
    rel: &str,
    expected_sha: &str,
    max_bytes: usize,
) -> Result<Vec<u8>, &'static str> {
    if rel.contains("..") || Path::new(rel).is_absolute() {
        return Err("failed");
    }
    if let Some(dir) = seed_dir {
        if let Ok(fp) = resolve_seed_asset_path(dir, rel) {
            if let Ok(bytes) = fs::read(&fp) {
                if bytes.len() <= max_bytes
                    && (expected_sha.is_empty() || sha256_hex(&bytes) == expected_sha)
                {
                    return Ok(bytes);
                }
            }
        }
    }
    let bytes = http_get_bytes(&format!("{ASSET_BASE_URL}{rel}"), max_bytes, &[])?;
    if !expected_sha.is_empty() && sha256_hex(&bytes) != expected_sha {
        return Err("failed");
    }
    Ok(bytes)
}

fn parse_semver3(text: &str) -> Option<(u64, u64, u64)> {
    let mut parts = text.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?.parse::<u64>().ok()?;
    let patch = parts.next()?.parse::<u64>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

fn split_prerelease(current: &str) -> (&str, bool) {
    if let Some((base, rest)) = current.split_once("-beta.") {
        if !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()) {
            return (base, true);
        }
    }
    if let Some((base, rest)) = current.split_once("-rc.") {
        if !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()) {
            return (base, true);
        }
    }
    (current, false)
}

fn select_release(list: &[Value], current: &str) -> Value {
    let (current_base, is_pre) = split_prerelease(current);
    let Some(cur_ver) = parse_semver3(current_base) else {
        return json!({
            "status": "offline",
            "current": current,
            "latest": Value::Null,
            "url": RELEASES_URL
        });
    };

    let mut best: Option<((u64, u64, u64), String, String)> = None;
    for r in list {
        if r.get("draft").and_then(|v| v.as_bool()) != Some(false)
            || r.get("prerelease").and_then(|v| v.as_bool()) != Some(false)
        {
            continue;
        }
        let Some(tag) = r.get("tag_name").and_then(|v| v.as_str()) else {
            continue;
        };
        let raw_ver = if let Some(v) = tag.strip_prefix("desktop-v") {
            v
        } else if let Some(v) = tag.strip_prefix('v') {
            v
        } else {
            continue;
        };
        let Some(parsed) = parse_semver3(raw_ver) else {
            continue;
        };
        let expected_asset = format!("Catstella-Setup-{raw_ver}-x64.exe");
        let has_pkg = r
            .get("assets")
            .and_then(|v| v.as_array())
            .map(|assets| {
                assets.iter().any(|a| {
                    a.get("state").and_then(|v| v.as_str()) == Some("uploaded")
                        && a.get("name").and_then(|v| v.as_str()) == Some(expected_asset.as_str())
                })
            })
            .unwrap_or(false);
        if !has_pkg {
            continue;
        }
        let url = format!("{RELEASES_URL}/tag/{tag}");
        if best.as_ref().map(|b| parsed > b.0).unwrap_or(true) {
            best = Some((parsed, raw_ver.to_string(), url));
        }
    }

    match best {
        None => json!({
            "status": "unpublished",
            "current": current,
            "latest": Value::Null,
            "url": RELEASES_URL
        }),
        Some((best_ver, latest, url)) => {
            let status = if best_ver > cur_ver || (best_ver == cur_ver && is_pre) {
                "available"
            } else {
                "current"
            };
            json!({
                "status": status,
                "current": current,
                "latest": latest,
                "url": url
            })
        }
    }
}

fn replace_dir_atomic(base_dir: &Path, pack_id: &str, pending_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(base_dir).map_err(|e| e.to_string())?;
    let dest = base_dir.join(pack_id);
    if dest.exists() {
        let backup = base_dir.join(format!(".replace-{pack_id}-{}", now_ms()));
        fs::rename(&dest, &backup).map_err(|e| e.to_string())?;
        if let Err(err) = fs::rename(pending_dir, &dest) {
            let _ = fs::rename(&backup, &dest);
            return Err(err.to_string());
        }
        let _ = fs::remove_dir_all(&backup);
    } else {
        fs::rename(pending_dir, &dest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub enum OnlineMutation {
    None,
    DreamSkinUpdated(bool),
    AssetsUpdated,
    SettingsAndDreamSkinUpdated(bool),
}

pub fn handle_online_action(
    state: &SharedApp,
    action: &str,
    value: Option<&Value>,
) -> (Value, OnlineMutation) {
    let (version, auto_update, seed_dir, wallpaper_dir, character_dir) = {
        let rt = state.runtime.lock().unwrap();
        (
            current_app_version(),
            rt.settings
                .get("autoUpdateCheck")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            rt.online_seed_dir.clone(),
            rt.user_wallpapers_dir.clone(),
            rt.user_characters_dir.clone(),
        )
    };

    match action {
        "check" => {
            let force = value.and_then(|v| v.as_bool()) == Some(true);
            if !auto_update && !force {
                return (
                    json!({
                        "ok": true,
                        "status": "disabled",
                        "current": version,
                        "url": RELEASES_URL
                    }),
                    OnlineMutation::None,
                );
            }
            let now = now_ms();
            {
                let guard = update_cache().lock().unwrap();
                if let Some((ref ver, checked_at, ref cached)) = guard.last {
                    if ver == &version {
                        let status = cached.get("status").and_then(|v| v.as_str()).unwrap_or("");
                        let interval = if force {
                            30_000
                        } else if status == "offline" {
                            30 * 60_000
                        } else {
                            12 * 60 * 60_000
                        };
                        if now.saturating_sub(checked_at) < interval {
                            let mut out = cached.clone();
                            if let Some(obj) = out.as_object_mut() {
                                obj.insert("ok".into(), json!(true));
                            }
                            return (out, OnlineMutation::None);
                        }
                    }
                }
            }

            let checked = match http_get_bytes(
                RELEASE_API_URL,
                MAX_RELEASES_BYTES,
                &["Accept: application/vnd.github+json"],
            )
            .ok()
            .and_then(|raw| serde_json::from_slice::<Vec<Value>>(&raw).ok())
            {
                Some(list) => select_release(&list, &version),
                None => json!({
                    "status": "offline",
                    "current": version,
                    "latest": Value::Null,
                    "url": RELEASES_URL
                }),
            };

            {
                let mut guard = update_cache().lock().unwrap();
                guard.last = Some((version, now_ms(), checked.clone()));
            }
            let mut out = checked;
            if let Some(obj) = out.as_object_mut() {
                obj.insert("ok".into(), json!(true));
            }
            (out, OnlineMutation::None)
        }
        "release" => {
            open_external_url(RELEASES_URL);
            (json!({ "ok": true }), OnlineMutation::None)
        }
        "source" => {
            let url = value.and_then(|v| v.as_str()).unwrap_or("");
            if is_valid_source_url(url) {
                open_external_url(url);
                (json!({ "ok": true }), OnlineMutation::None)
            } else {
                (json!({ "ok": false }), OnlineMutation::None)
            }
        }
        "catalog" => {
            let force = value.and_then(|v| v.as_bool()) == Some(true);
            match load_catalog(seed_dir.as_deref(), force) {
                Ok((items, offline)) => (
                    json!({ "ok": true, "items": items, "offline": offline }),
                    OnlineMutation::None,
                ),
                Err(reason) => (
                    json!({ "ok": false, "reason": reason }),
                    OnlineMutation::None,
                ),
            }
        }
        "preview-theme" => {
            let Some(id) = value.and_then(|v| v.as_str()) else {
                return (json!({ "ok": false }), OnlineMutation::None);
            };
            let Ok((items, _)) = load_catalog(seed_dir.as_deref(), false) else {
                return (json!({ "ok": false, "reason": "connection" }), OnlineMutation::None);
            };
            let Some(item) = items.into_iter().find(|i| {
                i.get("id").and_then(|v| v.as_str()) == Some(id)
                    && i.get("kind").and_then(|v| v.as_str()) == Some("theme")
            }) else {
                return (json!({ "ok": false }), OnlineMutation::None);
            };
            let rel = item.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let expected_sha = item.get("sha256").and_then(|v| v.as_str()).unwrap_or("");
            let Ok(bytes) = load_asset_bytes(seed_dir.as_deref(), rel, expected_sha, MAX_THEME_BYTES) else {
                return (json!({ "ok": false }), OnlineMutation::None);
            };
            let Ok(theme) = serde_json::from_slice::<Value>(&bytes) else {
                return (json!({ "ok": false }), OnlineMutation::None);
            };
            let Some(palette) = theme.get("palette").and_then(|v| v.as_str()) else {
                return (json!({ "ok": false }), OnlineMutation::None);
            };
            let Some(opacity) = theme.get("opacity").and_then(|v| v.as_i64()) else {
                return (json!({ "ok": false }), OnlineMutation::None);
            };
            (
                json!({ "ok": true, "palette": palette, "opacity": opacity }),
                OnlineMutation::None,
            )
        }
        "install" | "download" => {
            let apply_after = action == "install";
            let Some(id) = value.and_then(|v| v.as_str()) else {
                return (json!({ "ok": false }), OnlineMutation::None);
            };
            let (items, _) = match load_catalog(seed_dir.as_deref(), false) {
                Ok(pair) => pair,
                Err(reason) => {
                    return (
                        json!({ "ok": false, "reason": reason }),
                        OnlineMutation::None,
                    )
                }
            };
            let Some(item) = items
                .into_iter()
                .find(|i| i.get("id").and_then(|v| v.as_str()) == Some(id))
            else {
                return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
            };
            let kind = item.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            let rel = item.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let expected_sha = item.get("sha256").and_then(|v| v.as_str()).unwrap_or("");
            let max_bytes = match kind {
                "wallpaper" => MAX_WALLPAPER_BYTES,
                "character" => MAX_CHARACTER_BYTES,
                "theme" => MAX_THEME_BYTES,
                _ => return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None),
            };
            let bytes = match load_asset_bytes(seed_dir.as_deref(), rel, expected_sha, max_bytes) {
                Ok(b) => b,
                Err(reason) => {
                    return (
                        json!({ "ok": false, "reason": reason }),
                        OnlineMutation::None,
                    )
                }
            };

            match kind {
                "theme" => {
                    let Ok(theme) = serde_json::from_slice::<Value>(&bytes) else {
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    };
                    let Some(palette) = theme.get("palette").and_then(|v| v.as_str()) else {
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    };
                    let Some(opacity) = theme.get("opacity").and_then(|v| v.as_i64()) else {
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    };
                    let mut patch = Map::new();
                    patch.insert("themePreset".into(), json!(palette));
                    patch.insert("opacity".into(), json!(opacity));
                    patch.insert("onlineThemeId".into(), json!(id));
                    patch.insert("onlineThemeRevision".into(), json!(expected_sha));
                    if let Ok((_, ss_changed)) = state.update_dream_skin_transactional(&patch) {
                        (
                            json!({ "ok": true, "kind": "theme" }),
                            OnlineMutation::DreamSkinUpdated(ss_changed),
                        )
                    } else {
                        (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None)
                    }
                }
                "character" => {
                    let Ok(char_val) = serde_json::from_slice::<Value>(&bytes) else {
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    };
                    let Some(frames) = char_val.get("frames").and_then(|v| v.as_object()) else {
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    };
                    if !frames.contains_key("idle") {
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    }
                    let pack_id = format!("online-{id}");
                    let pending = character_dir.join(format!(".install-{}", now_ms()));
                    let frame_dir = pending.join("frames");
                    if fs::create_dir_all(&frame_dir).is_err() {
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    }
                    for (fname, data_val) in frames {
                        if !matches!(fname.as_str(), "idle" | "blink" | "proud" | "sad" | "shy" | "angry") {
                            let _ = fs::remove_dir_all(&pending);
                            return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                        }
                        let Some(data_str) = data_val.as_str().and_then(|s| s.strip_prefix("data:image/png;base64,")) else {
                            let _ = fs::remove_dir_all(&pending);
                            return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                        };
                        let Ok(img_bytes) = B64.decode(data_str) else {
                            let _ = fs::remove_dir_all(&pending);
                            return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                        };
                        let Some(probe) = probe_image(&img_bytes) else {
                            let _ = fs::remove_dir_all(&pending);
                            return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                        };
                        if probe.mime != "image/png" || (probe.width as u64 * probe.height as u64) > 1_500_000 {
                            let _ = fs::remove_dir_all(&pending);
                            return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                        }
                        if fs::write(frame_dir.join(format!("{fname}.png")), &img_bytes).is_err() {
                            let _ = fs::remove_dir_all(&pending);
                            return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                        }
                    }
                    let manifest = json!({
                        "id": pack_id,
                        "name": item.get("name").cloned().unwrap_or_else(|| json!(id)),
                        "description": item.get("description").cloned().unwrap_or_else(|| json!("")),
                        "credit": item.get("credit").cloned().unwrap_or_else(|| json!("")),
                        "revision": expected_sha
                    });
                    if atomic_write_json(&pending.join("manifest.json"), manifest.as_object().unwrap()).is_err()
                        || replace_dir_atomic(&character_dir, &pack_id, &pending).is_err()
                    {
                        let _ = fs::remove_dir_all(&pending);
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    }
                    state.refresh_assets();
                    if apply_after {
                        let mut p = Map::new();
                        p.insert("characterPack".into(), json!(pack_id));
                        let _ = state.update_settings_transactional(&p, false);
                        return (
                            json!({ "ok": true, "kind": "character" }),
                            OnlineMutation::SettingsAndDreamSkinUpdated(false),
                        );
                    }
                    (json!({ "ok": true, "kind": "character" }), OnlineMutation::AssetsUpdated)
                }
                "wallpaper" => {
                    let expected_mime = item.get("mime").and_then(|v| v.as_str()).unwrap_or("");
                    let Some(probe) = probe_image(&bytes) else {
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    };
                    if probe.mime != expected_mime || (probe.width as u64 * probe.height as u64) > 16_000_000 {
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    }
                    let pack_id = format!("online-{id}");
                    let ext = Path::new(rel).extension().and_then(|s| s.to_str()).unwrap_or("png");
                    let filename = format!("wallpaper.{ext}");
                    let pending = wallpaper_dir.join(format!(".install-{}", now_ms()));
                    if fs::create_dir_all(&pending).is_err() {
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    }
                    if fs::write(pending.join(&filename), &bytes).is_err() {
                        let _ = fs::remove_dir_all(&pending);
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    }
                    let mut manifest = Map::new();
                    manifest.insert("id".into(), json!(pack_id));
                    manifest.insert("file".into(), json!(filename));
                    manifest.insert("name".into(), item.get("name").cloned().unwrap_or_else(|| json!(id)));
                    manifest.insert("credit".into(), item.get("credit").cloned().unwrap_or_else(|| json!("")));
                    manifest.insert("revision".into(), json!(expected_sha));
                    if let Some(pack_val) = item.get("pack").filter(|v| v.is_object()) {
                        manifest.insert("pack".into(), pack_val.clone());
                    }
                    if atomic_write_json(&pending.join("manifest.json"), &manifest).is_err()
                        || replace_dir_atomic(&wallpaper_dir, &pack_id, &pending).is_err()
                    {
                        let _ = fs::remove_dir_all(&pending);
                        return (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None);
                    }
                    state.refresh_assets();
                    let dest_file = wallpaper_dir.join(&pack_id).join(&filename);
                    let current_wall_id = state
                        .runtime
                        .lock()
                        .unwrap()
                        .dream_skin
                        .get("wallpaperId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if apply_after || current_wall_id == pack_id {
                        let mut ds_patch = Map::new();
                        ds_patch.insert("wallpaperId".into(), json!(pack_id));
                        ds_patch.insert("wallpaperFile".into(), json!(dest_file.to_string_lossy().to_string()));
                        if let Ok((_, ss_changed)) = state.update_dream_skin_transactional(&ds_patch) {
                            return (
                                json!({ "ok": true, "kind": "wallpaper" }),
                                OnlineMutation::DreamSkinUpdated(ss_changed),
                            );
                        }
                    }
                    (json!({ "ok": true, "kind": "wallpaper" }), OnlineMutation::AssetsUpdated)
                }
                _ => (json!({ "ok": false, "reason": "failed" }), OnlineMutation::None),
            }
        }
        "uninstall" => {
            let Some(id) = value.and_then(|v| v.as_str()) else {
                return (json!({ "ok": false, "reason": "invalid" }), OnlineMutation::None);
            };
            if !is_valid_uninstall_id(id) {
                return (json!({ "ok": false, "reason": "invalid" }), OnlineMutation::None);
            }
            let pack_id = format!("online-{id}");
            let char_dest = character_dir.join(&pack_id);
            let wall_dest = wallpaper_dir.join(&pack_id);
            let mut kind: Option<&'static str> = None;
            let mut remove_dir: Option<PathBuf> = None;

            if char_dest.is_dir() {
                kind = Some("character");
                remove_dir = Some(char_dest);
            } else if wall_dest.is_dir() {
                kind = Some("wallpaper");
                remove_dir = Some(wall_dest);
            } else {
                let online_theme = state
                    .runtime
                    .lock()
                    .unwrap()
                    .dream_skin
                    .get("onlineThemeId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if online_theme == id {
                    kind = Some("theme");
                }
            }

            let Some(kind) = kind else {
                return (
                    json!({ "ok": false, "reason": "not-installed" }),
                    OnlineMutation::None,
                );
            };

            let mut ss_changed = false;
            match kind {
                "character" => {
                    let cur = state
                        .runtime
                        .lock()
                        .unwrap()
                        .settings
                        .get("characterPack")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if cur == pack_id {
                        let mut p = Map::new();
                        p.insert("characterPack".into(), json!("gemini-star-v1"));
                        let _ = state.update_settings_transactional(&p, false);
                    }
                }
                "wallpaper" => {
                    let (cur_wid, fallback) = {
                        let rt = state.runtime.lock().unwrap();
                        let wid = rt
                            .dream_skin
                            .get("wallpaperId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let fb = rt
                            .wallpapers
                            .iter()
                            .find(|w| w.file.is_some() && !w.id.starts_with("online-"))
                            .map(|w| {
                                (
                                    w.id.clone(),
                                    w.file
                                        .as_ref()
                                        .map(|f| f.to_string_lossy().to_string())
                                        .unwrap_or_default(),
                                )
                            });
                        (wid, fb)
                    };
                    if cur_wid == pack_id {
                        let (fb_id, fb_file) = fallback
                            .unwrap_or_else(|| ("gemini-character-sheet-v1".to_string(), String::new()));
                        let mut ds_patch = Map::new();
                        ds_patch.insert("wallpaperId".into(), json!(fb_id));
                        ds_patch.insert("wallpaperFile".into(), json!(fb_file));
                        if let Ok((_, ch)) = state.update_dream_skin_transactional(&ds_patch) {
                            ss_changed = ch;
                        }
                    }
                }
                "theme" => {
                    let defaults = sanitize_dream_skin(&Map::new());
                    let mut ds_patch = Map::new();
                    ds_patch.insert(
                        "themePreset".into(),
                        defaults.get("themePreset").cloned().unwrap_or_else(|| json!("violet")),
                    );
                    ds_patch.insert(
                        "opacity".into(),
                        defaults.get("opacity").cloned().unwrap_or_else(|| json!(55)),
                    );
                    ds_patch.insert("onlineThemeId".into(), json!(""));
                    ds_patch.insert("onlineThemeRevision".into(), json!(""));
                    if let Ok((_, ch)) = state.update_dream_skin_transactional(&ds_patch) {
                        ss_changed = ch;
                    }
                }
                _ => {}
            }

            if let Some(dir) = remove_dir {
                let _ = fs::remove_dir_all(&dir);
            }
            state.refresh_assets();
            (
                json!({ "ok": true, "kind": kind }),
                OnlineMutation::SettingsAndDreamSkinUpdated(ss_changed),
            )
        }
        _ => (json!({ "ok": false }), OnlineMutation::None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_catalog_preserves_pack_and_rejects_traversal() {
        let sha = "a".repeat(64);
        let raw = json!({
            "schema": 1,
            "items": [
                {
                    "id": "pack-wall-01",
                    "kind": "wallpaper",
                    "path": "wallpapers/pack-wall-01.png",
                    "sha256": sha,
                    "size": 1024,
                    "name": "Wall 01",
                    "credit": "Catstella",
                    "pack": { "id": "series-a", "name": "Series A", "position": 1, "source": "https://www.bilibili.com/video/BV17PxC6SERc/" }
                },
                {
                    "id": "bad-traversal",
                    "kind": "wallpaper",
                    "path": "../secret.png",
                    "sha256": sha,
                    "size": 1024,
                    "name": "Bad",
                    "credit": "Catstella"
                }
            ]
        });
        let parsed = parse_catalog_bytes(&serde_json::to_vec(&raw).unwrap()).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0]["pack"]["id"], "series-a");
        assert_eq!(parsed[0]["mime"], "image/png");
    }

    #[test]
    fn select_release_picks_latest_stable_and_handles_prerelease() {
        let releases = vec![
            json!({
                "tag_name": "desktop-v0.6.0",
                "draft": false,
                "prerelease": false,
                "assets": [{ "state": "uploaded", "name": "Catstella-Setup-0.6.0-x64.exe" }]
            }),
            json!({
                "tag_name": "v0.7.0",
                "draft": false,
                "prerelease": false,
                "assets": [{ "state": "uploaded", "name": "Catstella-Setup-0.7.0-x64.exe" }]
            }),
            json!({
                "tag_name": "v0.8.0-beta.1",
                "draft": false,
                "prerelease": true,
                "assets": [{ "state": "uploaded", "name": "Catstella-Setup-0.8.0-beta.1-x64.exe" }]
            }),
        ];
        assert_eq!(select_release(&releases, "0.6.0")["status"], "available");
        assert_eq!(select_release(&releases, "0.6.0")["latest"], "0.7.0");
        assert_eq!(select_release(&releases, "0.7.0")["status"], "current");
        assert_eq!(select_release(&releases, "0.7.0-beta.1")["status"], "available");
    }

    #[test]
    #[ignore]
    fn live_github_store_catalog_install_uninstall_and_check() {
        let dir = std::env::temp_dir().join(format!("catstella-online-live-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let state = SharedApp::new(
            dir.clone(),
            dir.join("skin"),
            dir.join("wv2"),
            None,
            true,
            "low-mem".into(),
            String::new(),
            false,
            true,
            None,
            vec![],
        );
        state.runtime.lock().unwrap().online_seed_dir = None;

        let (cat, _) = handle_online_action(&state, "catalog", Some(&json!(true)));
        assert_eq!(cat["ok"], true, "catalog failed: {cat}");
        assert_eq!(cat["offline"], false, "expected live remote catalog");
        let items = cat["items"].as_array().unwrap();
        let pack_count = items
            .iter()
            .filter(|i| i.pointer("/pack/id").and_then(|v| v.as_str()) == Some("moriyama-catgirl-pack"))
            .count();
        assert!(pack_count >= 2, "expected series pack frames, got {pack_count}");

        let (theme_res, _) = handle_online_action(&state, "install", Some(&json!("midnight-blue")));
        assert_eq!(theme_res["ok"], true, "theme install failed: {theme_res}");

        let (wall_res, _) = handle_online_action(&state, "install", Some(&json!("moriyama-catgirl-01")));
        assert_eq!(wall_res["ok"], true, "wallpaper install failed: {wall_res}");
        assert!(dir.join("skin/wallpapers/online-moriyama-catgirl-01/manifest.json").is_file());

        let (un_wall, _) = handle_online_action(&state, "uninstall", Some(&json!("moriyama-catgirl-01")));
        assert_eq!(un_wall["ok"], true);
        assert!(!dir.join("skin/wallpapers/online-moriyama-catgirl-01").exists());

        let (chk, _) = handle_online_action(&state, "check", Some(&json!(true)));
        assert_eq!(chk["ok"], true);
        assert_ne!(chk["status"], "offline", "expected live GitHub release check: {chk}");

        let _ = fs::remove_dir_all(&dir);
        println!("LIVE ONLINE STORE OK: pack_frames={pack_count}, check={chk}");
    }
}
