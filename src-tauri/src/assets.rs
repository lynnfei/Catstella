use crate::dream_skin::DEFAULT_WALLPAPER_ID;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const WALLPAPER_TITLES: &[(&str, &str)] = &[
    ("01_chibi_star_16_9.jpg", "星语星空 · Q版 Stella"),
    ("02_halloween_duo_16_9.jpg", "万圣双子 · 萌宠同框"),
    ("03_catgirl_witch_16_9.jpg", "星空大魔女 · 骑行法杖"),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageProbe {
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone)]
pub struct WallpaperPackMeta {
    pub id: String,
    pub name: String,
    pub position: i64,
}

#[derive(Debug, Clone)]
pub struct WallpaperPack {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub file: Option<PathBuf>,
    pub width: Option<u32>,
    pub digest: Option<String>,
    pub revision: String,
    pub pack: Option<WallpaperPackMeta>,
    pub aliases: Vec<String>,
    pub alias_files: Vec<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct CharacterPack {
    pub id: String,
    pub name: String,
    pub description: String,
    pub revision: String,
    pub is_user: bool,
    pub dir: PathBuf,
    pub idle_ext: String,
    pub available_frames: Vec<String>,
}

pub fn is_valid_slug(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.is_empty() || bytes.len() > 61 {
        return false;
    }
    bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

pub fn is_valid_pack_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.is_empty() || bytes.len() > 48 {
        return false;
    }
    bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let out = hasher.finalize();
    let mut hex = String::with_capacity(out.len() * 2);
    for b in out {
        hex.push_str(&format!("{b:02x}"));
    }
    hex
}

pub fn image_mime_for_ext(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

pub fn probe_image(bytes: &[u8]) -> Option<ImageProbe> {
    if bytes.len() < 24 {
        return None;
    }
    // PNG IHDR
    if bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4e && bytes[3] == 0x47 {
        let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        if w > 0 && h > 0 {
            return Some(ImageProbe {
                mime: "image/png",
                width: w,
                height: h,
            });
        }
        return None;
    }
    // JPEG SOF
    if bytes[0] == 0xff && bytes[1] == 0xd8 {
        let mut offset = 2usize;
        while offset + 9 < bytes.len() {
            if bytes[offset] != 0xff {
                offset += 1;
                continue;
            }
            let marker = bytes[offset + 1];
            let length = u16::from_be_bytes([bytes[offset + 2], bytes[offset + 3]]) as usize;
            if (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker) {
                let h = u16::from_be_bytes([bytes[offset + 5], bytes[offset + 6]]) as u32;
                let w = u16::from_be_bytes([bytes[offset + 7], bytes[offset + 8]]) as u32;
                if w > 0 && h > 0 {
                    return Some(ImageProbe {
                        mime: "image/jpeg",
                        width: w,
                        height: h,
                    });
                }
                return None;
            }
            if length < 2 {
                return None;
            }
            offset = offset.checked_add(2 + length)?;
        }
        return None;
    }
    // WebP
    if &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        let format = &bytes[12..16];
        if format == b"VP8 " && bytes.len() >= 30 {
            let w = (u16::from_le_bytes([bytes[26], bytes[27]]) & 0x3fff) as u32;
            let h = (u16::from_le_bytes([bytes[28], bytes[29]]) & 0x3fff) as u32;
            if w > 0 && h > 0 {
                return Some(ImageProbe {
                    mime: "image/webp",
                    width: w,
                    height: h,
                });
            }
        } else if format == b"VP8L" && bytes.len() >= 26 {
            let bits = u32::from_le_bytes([bytes[21], bytes[22], bytes[23], bytes[24]]);
            let w = (bits & 0x3fff) + 1;
            let h = ((bits >> 14) & 0x3fff) + 1;
            return Some(ImageProbe {
                mime: "image/webp",
                width: w,
                height: h,
            });
        } else if format == b"VP8X" && bytes.len() >= 30 {
            let w = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]) + 1;
            let h = u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]) + 1;
            return Some(ImageProbe {
                mime: "image/webp",
                width: w,
                height: h,
            });
        }
    }
    None
}

pub fn discover_repo_root() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(parent) = manifest_dir.parent() {
        if parent.join("Antigravity-Dream-Skin/assets/wallpapers").is_dir()
            || parent.join("online-assets/catalog.json").is_file()
        {
            return Some(parent.to_path_buf());
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent();
        while let Some(dir) = cur {
            if dir.join("Antigravity-Dream-Skin/assets/wallpapers").is_dir()
                || dir.join("online-assets/catalog.json").is_file()
            {
                return Some(dir.to_path_buf());
            }
            cur = dir.parent();
        }
    }
    None
}

fn title_for_file(file_name: &str, fallback_name: &str) -> String {
    for (k, v) in WALLPAPER_TITLES {
        if *k == file_name {
            return (*v).to_string();
        }
    }
    fallback_name.to_string()
}

fn strip_win_verbatim(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = p.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    p
}

fn read_dir_wallpaper_pack(wallpapers_dir: &Path, name: &str) -> Option<WallpaperPack> {
    let dir = wallpapers_dir.join(name);
    if !dir.is_dir() {
        return None;
    }
    let manifest: Option<Value> = fs::read_to_string(dir.join("manifest.json"))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok());

    let id = manifest
        .as_ref()
        .and_then(|m| m.get("id"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(name)
        .to_string();

    let mut file: Option<PathBuf> = None;

    if let Some(rel) = manifest
        .as_ref()
        .and_then(|m| m.get("file"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        let cand = dir.join(rel);
        match (fs::canonicalize(&dir), fs::canonicalize(&cand)) {
            (Ok(canon_dir), Ok(canon_file)) if canon_file.starts_with(&canon_dir) => {
                file = Some(strip_win_verbatim(canon_file));
            }
            _ => {
                return Some(WallpaperPack {
                    id: name.to_string(),
                    title: name.to_string(),
                    file_name: String::new(),
                    file: None,
                    width: None,
                    digest: None,
                    revision: String::new(),
                    pack: None,
                    aliases: Vec::new(),
                    alias_files: Vec::new(),
                });
            }
        }
    } else if let Ok(entries) = fs::read_dir(&dir) {
        let mut images: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let fname = e.file_name().to_string_lossy().to_string();
                let ext = Path::new(&fname).extension()?.to_str()?;
                image_mime_for_ext(ext).map(|_| fname)
            })
            .collect();
        images.sort();
        if let Some(first) = images.first() {
            file = Some(dir.join(first));
        }
    }

    let mut probe = None;
    let mut digest = None;
    if let Some(ref fp) = file {
        if let Ok(bytes) = fs::read(fp) {
            probe = probe_image(&bytes);
            if probe.is_some() {
                digest = Some(sha256_hex(&bytes));
            }
        }
    }

    if probe.is_none() {
        file = None;
    }

    let pack_meta = manifest.as_ref().and_then(|m| {
        let p = m.get("pack")?.as_object()?;
        let pid = p.get("id")?.as_str()?;
        let pname = p.get("name")?.as_str()?;
        if !is_valid_pack_id(pid) || pname.is_empty() || pname.chars().count() > 80 {
            return None;
        }
        let pos = p.get("position").and_then(|v| v.as_i64()).unwrap_or(0);
        Some(WallpaperPackMeta {
            id: pid.to_string(),
            name: pname.to_string(),
            position: pos,
        })
    });

    let pack_name = manifest
        .as_ref()
        .and_then(|m| m.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(&id)
        .to_string();
    let revision = manifest
        .as_ref()
        .and_then(|m| m.get("revision"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let file_name = file
        .as_ref()
        .and_then(|f| f.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let title = title_for_file(&file_name, &pack_name);

    Some(WallpaperPack {
        id,
        title,
        file_name,
        file,
        width: probe.as_ref().map(|p| p.width),
        digest,
        revision,
        pack: pack_meta,
        aliases: Vec::new(),
        alias_files: Vec::new(),
    })
}

fn read_flat_wallpaper_pack(file: PathBuf) -> WallpaperPack {
    let mut probe = None;
    let mut digest = None;
    if let Ok(bytes) = fs::read(&file) {
        probe = probe_image(&bytes);
        if probe.is_some() {
            digest = Some(sha256_hex(&bytes));
        }
    }
    let file_name = file
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let id = file
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.clone());
    let title = title_for_file(&file_name, &id);
    WallpaperPack {
        id,
        title,
        file_name,
        file: if probe.is_some() { Some(file) } else { None },
        width: probe.as_ref().map(|p| p.width),
        digest,
        revision: String::new(),
        pack: None,
        aliases: Vec::new(),
        alias_files: Vec::new(),
    }
}

fn scan_wallpaper_root(root: &Path) -> Vec<WallpaperPack> {
    let Ok(rd) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut names: Vec<String> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();

    let mut packs = Vec::new();
    for name in names {
        let full = root.join(&name);
        if full.is_dir() {
            if let Some(p) = read_dir_wallpaper_pack(root, &name) {
                packs.push(p);
            }
        } else if full.is_file() {
            if let Some(ext) = full.extension().and_then(|s| s.to_str()) {
                if image_mime_for_ext(ext).is_some() {
                    packs.push(read_flat_wallpaper_pack(full));
                }
            }
        }
    }
    packs
}

pub fn list_wallpaper_packs(bundled_dir: Option<&Path>, user_dir: &Path) -> Vec<WallpaperPack> {
    let mut bundled = bundled_dir.map(scan_wallpaper_root).unwrap_or_default();
    if let Some(idx) = bundled.iter().position(|p| p.id == DEFAULT_WALLPAPER_ID) {
        if idx > 0 {
            let item = bundled.remove(idx);
            bundled.insert(0, item);
        }
    }

    let mut digest_to_idx: HashMap<String, usize> = HashMap::new();
    for (idx, p) in bundled.iter().enumerate() {
        if let Some(ref d) = p.digest {
            digest_to_idx.entry(d.clone()).or_insert(idx);
        }
    }

    for user_pack in scan_wallpaper_root(user_dir) {
        if let Some(ref d) = user_pack.digest {
            if let Some(&idx) = digest_to_idx.get(d) {
                bundled[idx].aliases.push(user_pack.id.clone());
                if let Some(f) = user_pack.file {
                    bundled[idx].alias_files.push(f);
                }
                continue;
            }
        }
        bundled.push(user_pack);
    }

    bundled
}

fn normalize_path_cmp(p: &Path) -> String {
    let canon = fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    canon.to_string_lossy().replace('\\', "/").to_ascii_lowercase()
}

/// Port of Antigravity-Dream-Skin/src/domain/wallpaper-selection.cjs
pub fn select_wallpaper(
    packs: &[WallpaperPack],
    dream_skin: &Map<String, Value>,
    file_only: bool,
) -> Option<(String, String)> {
    let usable: Vec<&WallpaperPack> = packs
        .iter()
        .filter(|p| p.file.is_some() && p.width.is_some())
        .collect();
    if usable.is_empty() {
        return None;
    }

    let wanted_id = dream_skin
        .get("wallpaperId")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let wanted_file = dream_skin
        .get("wallpaperFile")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let by_id = usable
        .iter()
        .copied()
        .find(|p| !wanted_id.is_empty() && (p.id == wanted_id || p.aliases.iter().any(|a| a == wanted_id)));

    let by_file = if !wanted_file.is_empty() {
        let wanted_norm = normalize_path_cmp(Path::new(wanted_file));
        usable.iter().copied().find(|p| {
            p.file
                .iter()
                .chain(p.alias_files.iter())
                .any(|f| normalize_path_cmp(f) == wanted_norm)
        })
    } else {
        None
    };

    let selected = if file_only {
        by_file.or(by_id)
    } else {
        by_id.or(by_file)
    }
    .or_else(|| usable.iter().copied().find(|p| p.id == DEFAULT_WALLPAPER_ID))
    .or_else(|| usable.first().copied())?;

    let file_str = selected
        .file
        .as_ref()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    Some((selected.id.clone(), file_str))
}

pub fn next_wallpaper_id(packs: &[WallpaperPack], current_id: &str) -> Option<String> {
    let usable: Vec<&WallpaperPack> = packs
        .iter()
        .filter(|p| p.file.is_some() && p.width.is_some())
        .collect();
    if usable.is_empty() {
        return None;
    }
    if usable.len() < 2 {
        return Some(usable[0].id.clone());
    }
    let idx = usable
        .iter()
        .position(|p| p.id == current_id || p.aliases.iter().any(|a| a == current_id))
        .unwrap_or(0);
    Some(usable[(idx + 1) % usable.len()].id.clone())
}

pub fn resolve_wallpaper_file(
    packs: &[WallpaperPack],
    requested_id: Option<&str>,
    fallback_id: &str,
    fallback_file: &str,
) -> Option<PathBuf> {
    let usable: Vec<&WallpaperPack> = packs.iter().filter(|p| p.file.is_some()).collect();
    let target = requested_id.filter(|s| !s.is_empty()).unwrap_or(fallback_id);
    if let Some(found) = usable
        .iter()
        .find(|p| p.id == target || p.aliases.iter().any(|a| a == target))
    {
        return found.file.clone();
    }
    if requested_id.is_some() {
        return None;
    }
    if !fallback_file.is_empty() {
        let p = PathBuf::from(fallback_file);
        if p.is_file() {
            return Some(p);
        }
    }
    usable.first().and_then(|p| p.file.clone())
}

pub fn wallpaper_preview_url(id: &str, bridge_port: Option<u16>) -> String {
    let Some(port) = bridge_port else {
        return String::new();
    };
    let encoded = utf8_percent_encode(id, NON_ALPHANUMERIC).to_string();
    format!("http://127.0.0.1:{port}/companion/wallpaper-image?id={encoded}")
}

pub fn wallpaper_revision(pack: &WallpaperPack) -> String {
    if let Some(ref fp) = pack.file {
        if let Ok(meta) = fs::metadata(fp) {
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0);
            return format!("{}:{}:{}", pack.id, mtime_ms, meta.len());
        }
    }
    pack.id.clone()
}

pub fn wallpaper_to_snapshot_json(pack: &WallpaperPack, bridge_port: Option<u16>) -> Value {
    let file_path = pack
        .file
        .as_ref()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    let pack_val = match pack.pack {
        Some(ref pm) => json!({
            "id": pm.id,
            "name": pm.name,
            "position": pm.position
        }),
        None => Value::Null,
    };
    let mut obj = Map::new();
    obj.insert("id".into(), json!(pack.id));
    obj.insert("fileName".into(), json!(pack.file_name));
    obj.insert("filePath".into(), json!(file_path));
    obj.insert("title".into(), json!(pack.title));
    obj.insert("revision".into(), json!(pack.revision));
    obj.insert("preview".into(), json!(wallpaper_preview_url(&pack.id, bridge_port)));
    if !pack_val.is_null() {
        obj.insert("pack".into(), pack_val);
    }
    Value::Object(obj)
}

pub fn list_character_packs(bundled_dir: Option<&Path>, user_dir: &Path) -> Vec<CharacterPack> {
    let mut packs: Vec<CharacterPack> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let scan_root = |root: &Path, is_user: bool, out: &mut Vec<CharacterPack>, seen: &mut HashSet<String>| {
        let Ok(rd) = fs::read_dir(root) else {
            return;
        };
        let mut entries: Vec<String> = rd
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        entries.sort();

        for name in entries {
            if !is_valid_slug(&name) || seen.contains(&name) {
                continue;
            }
            let dir = root.join(&name);
            let Ok(manifest_raw) = fs::read_to_string(dir.join("manifest.json")) else {
                continue;
            };
            let Ok(manifest) = serde_json::from_str::<Value>(&manifest_raw) else {
                continue;
            };
            let frames_dir = dir.join("frames");
            let idle_ext = if frames_dir.join("idle.png").is_file() {
                "png".to_string()
            } else if !is_user && frames_dir.join("idle.webp").is_file() {
                "webp".to_string()
            } else {
                continue;
            };
            let mut available = Vec::new();
            if is_user {
                for frame in ["idle", "blink", "proud", "sad", "shy"] {
                    if frames_dir.join(format!("{frame}.png")).is_file() {
                        available.push(frame.to_string());
                    }
                }
            }
            let pack_name = manifest
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&name)
                .to_string();
            let description = manifest
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let revision = manifest
                .get("revision")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            seen.insert(name.clone());
            out.push(CharacterPack {
                id: name,
                name: pack_name,
                description,
                revision,
                is_user,
                dir,
                idle_ext,
                available_frames: available,
            });
        }
    };

    if let Some(bd) = bundled_dir {
        scan_root(bd, false, &mut packs, &mut seen);
    }
    scan_root(user_dir, true, &mut packs, &mut seen);

    if packs.is_empty() {
        packs.push(CharacterPack {
            id: "gemini-star-v1".into(),
            name: "星语".into(),
            description: "星空魔女 · 紫发异色瞳".into(),
            revision: String::new(),
            is_user: false,
            dir: PathBuf::new(),
            idle_ext: "png".into(),
            available_frames: Vec::new(),
        });
        packs.push(CharacterPack {
            id: "lin-cat".into(),
            name: "霓音".into(),
            description: "粉色猫娘 · 全息航行服".into(),
            revision: String::new(),
            is_user: false,
            dir: PathBuf::new(),
            idle_ext: "png".into(),
            available_frames: Vec::new(),
        });
    }
    packs
}

pub fn character_pack_to_snapshot_json(pack: &CharacterPack, bridge_port: Option<u16>) -> Value {
    let encoded_pack = utf8_percent_encode(&pack.id, NON_ALPHANUMERIC).to_string();
    let preview = if pack.is_user {
        if let Some(port) = bridge_port {
            format!("http://127.0.0.1:{port}/companion/character-frame?pack={encoded_pack}&frame=idle")
        } else {
            String::new()
        }
    } else {
        format!(
            "../../assets/character-packs/{}/frames/idle.{}",
            pack.id, pack.idle_ext
        )
    };

    let frames = if pack.is_user {
        if let Some(port) = bridge_port {
            let mut map = Map::new();
            for frame in &pack.available_frames {
                let encoded_frame = utf8_percent_encode(frame, NON_ALPHANUMERIC).to_string();
                map.insert(
                    frame.clone(),
                    json!(format!(
                        "http://127.0.0.1:{port}/companion/character-frame?pack={encoded_pack}&frame={encoded_frame}"
                    )),
                );
            }
            Value::Object(map)
        } else {
            Value::Null
        }
    } else {
        Value::Null
    };

    json!({
        "id": pack.id,
        "name": pack.name,
        "description": pack.description,
        "revision": pack.revision,
        "preview": preview,
        "frames": frames
    })
}

pub fn resolve_character_frame_file(
    packs: &[CharacterPack],
    pack_id: &str,
    frame: &str,
) -> Option<PathBuf> {
    if !is_valid_slug(pack_id) || !matches!(frame, "idle" | "blink" | "proud" | "sad" | "shy") {
        return None;
    }
    let pack = packs.iter().find(|p| p.id == pack_id)?;
    let frames_dir = pack.dir.join("frames");
    let png = frames_dir.join(format!("{frame}.png"));
    if png.is_file() {
        return Some(png);
    }
    if frame == "proud" {
        let proud_v3 = frames_dir.join("proud-v3.png");
        if proud_v3.is_file() {
            return Some(proud_v3);
        }
    }
    let webp = frames_dir.join(format!("{frame}.webp"));
    if webp.is_file() {
        return Some(webp);
    }
    None
}

pub fn compute_art_version(bundled_dir: Option<&Path>, user_dir: &Path) -> String {
    fn walk(dir: &Path, parts: &mut Vec<String>) {
        let Ok(rd) = fs::read_dir(dir) else {
            return;
        };
        let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name().to_string_lossy().to_string());
        for entry in entries {
            let full = entry.path();
            if full.is_dir() {
                walk(&full, parts);
            } else if let Ok(meta) = fs::metadata(&full) {
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                parts.push(format!(
                    "{}:{}:{}",
                    entry.file_name().to_string_lossy(),
                    meta.len(),
                    mtime
                ));
            }
        }
    }
    let mut parts = Vec::new();
    if let Some(bd) = bundled_dir {
        walk(bd, &mut parts);
    }
    if user_dir.is_dir() {
        walk(user_dir, &mut parts);
    }
    if parts.is_empty() {
        return "0".to_string();
    }
    sha256_hex(parts.join("|").as_bytes())
        .chars()
        .take(10)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_image_parses_png_jpeg_webp_and_rejects_corrupt() {
        let mut png = vec![0u8; 32];
        png[0..8].copy_from_slice(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        png[12..16].copy_from_slice(b"IHDR");
        png[16..20].copy_from_slice(&1280u32.to_be_bytes());
        png[20..24].copy_from_slice(&720u32.to_be_bytes());
        assert_eq!(
            probe_image(&png),
            Some(ImageProbe {
                mime: "image/png",
                width: 1280,
                height: 720
            })
        );

        let mut jpg = vec![0u8; 32];
        jpg[0..4].copy_from_slice(&[0xff, 0xd8, 0xff, 0xc0]);
        jpg[4..6].copy_from_slice(&11u16.to_be_bytes());
        jpg[6] = 8;
        jpg[7..9].copy_from_slice(&1080u16.to_be_bytes());
        jpg[9..11].copy_from_slice(&1920u16.to_be_bytes());
        assert_eq!(
            probe_image(&jpg),
            Some(ImageProbe {
                mime: "image/jpeg",
                width: 1920,
                height: 1080
            })
        );

        let mut webp = vec![0u8; 32];
        webp[0..4].copy_from_slice(b"RIFF");
        webp[8..12].copy_from_slice(b"WEBP");
        webp[12..16].copy_from_slice(b"VP8X");
        // width-1 = 639 -> 0x027f, height-1 = 479 -> 0x01df
        webp[24..27].copy_from_slice(&[0x7f, 0x02, 0x00]);
        webp[27..30].copy_from_slice(&[0xdf, 0x01, 0x00]);
        assert_eq!(
            probe_image(&webp),
            Some(ImageProbe {
                mime: "image/webp",
                width: 640,
                height: 480
            })
        );

        assert_eq!(probe_image(b"not an image"), None);
    }

    #[test]
    fn wallpaper_scanner_orders_default_first_dedupes_sha256_and_selects() {
        let root = std::env::temp_dir().join(format!("catstella-wall-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let bundled = root.join("bundled");
        let user = root.join("user");
        fs::create_dir_all(bundled.join("alpha-wall")).unwrap();
        fs::create_dir_all(bundled.join(DEFAULT_WALLPAPER_ID)).unwrap();
        fs::create_dir_all(&user).unwrap();

        let make_png = |w: u32, h: u32| -> Vec<u8> {
            let mut png = vec![0u8; 32];
            png[0..8].copy_from_slice(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
            png[12..16].copy_from_slice(b"IHDR");
            png[16..20].copy_from_slice(&w.to_be_bytes());
            png[20..24].copy_from_slice(&h.to_be_bytes());
            png
        };

        let def_bytes = make_png(1600, 900);
        let alpha_bytes = make_png(1280, 720);
        let custom_bytes = make_png(800, 600);

        fs::write(bundled.join(DEFAULT_WALLPAPER_ID).join("wallpaper.png"), &def_bytes).unwrap();
        fs::write(bundled.join("alpha-wall").join("wallpaper.png"), &alpha_bytes).unwrap();
        // Duplicate in user dir should collapse into alpha-wall alias
        fs::write(user.join("dup-alpha.png"), &alpha_bytes).unwrap();
        fs::write(user.join("user-custom.png"), &custom_bytes).unwrap();

        let packs = list_wallpaper_packs(Some(&bundled), &user);
        assert_eq!(packs.len(), 3);
        assert_eq!(packs[0].id, DEFAULT_WALLPAPER_ID);
        assert_eq!(packs[1].id, "alpha-wall");
        assert_eq!(packs[1].aliases, vec!["dup-alpha"]);
        assert_eq!(packs[2].id, "user-custom");

        assert_eq!(
            next_wallpaper_id(&packs, DEFAULT_WALLPAPER_ID).as_deref(),
            Some("alpha-wall")
        );
        assert_eq!(
            next_wallpaper_id(&packs, "user-custom").as_deref(),
            Some(DEFAULT_WALLPAPER_ID)
        );

        let mut ds = Map::new();
        ds.insert("wallpaperId".into(), json!("dup-alpha"));
        let sel = select_wallpaper(&packs, &ds, false).unwrap();
        assert_eq!(sel.0, "alpha-wall");

        let _ = fs::remove_dir_all(&root);
    }
}
