use crate::assets::image_mime_for_ext;
use crate::state::{now_ms, SharedApp};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use url::Url;

const DEFAULT_BRIDGE_PORTS: [u16; 3] = [3921, 3922, 3923];
const MAX_WALLPAPER_BYTES: u64 = 40 * 1024 * 1024;
const MAX_SYNC_BODY: usize = 262_144;
const MAX_MEMORY_BODY: usize = 1_048_576;

#[derive(Debug, Clone, Default)]
pub struct BridgeSyncEffect {
    pub old_scale: i32,
    pub new_scale: i32,
    pub slideshow_changed: bool,
    pub rotated: bool,
    pub web_changed: bool,
    pub patch_applied: bool,
}

pub fn is_allowed_origin(origin: Option<&str>) -> bool {
    let Some(raw) = origin else {
        return true;
    };
    if raw.is_empty() || raw == "null" {
        return false;
    }
    let Ok(parsed) = Url::parse(raw) else {
        return false;
    };
    let scheme = parsed.scheme();
    if matches!(
        scheme,
        "chrome-extension"
            | "moz-extension"
            | "safari-web-extension"
            | "vscode-webview"
            | "vscode-file"
            | "app"
            | "tauri"
    ) {
        return true;
    }
    if matches!(scheme, "http" | "https") {
        if let Some(host) = parsed.host_str() {
            let lower = host.to_ascii_lowercase();
            return matches!(
                lower.as_str(),
                "127.0.0.1" | "localhost" | "[::1]" | "::1" | "tauri.localhost"
            );
        }
    }
    false
}

pub fn sanitize_web_quota(raw: &Value) -> Option<Value> {
    let obj = raw.as_object()?;
    let num = |k: &str| -> i64 {
        match obj.get(k).and_then(|v| v.as_f64()) {
            Some(n) if n.is_finite() && n >= 0.0 => n.round() as i64,
            _ => 0,
        }
    };
    let pct = |k: &str| -> Value {
        match obj.get(k).and_then(|v| v.as_f64()) {
            Some(n) if n.is_finite() => json!(n.round().clamp(0.0, 100.0) as i64),
            _ => Value::Null,
        }
    };
    let slice_str = |k: &str, max_chars: usize| -> String {
        obj.get(k)
            .and_then(|v| v.as_str())
            .map(|s| s.chars().take(max_chars).collect())
            .unwrap_or_default()
    };
    let budget = num("dailyBudget");
    Some(json!({
        "dailyTotal": num("dailyTotal"),
        "window5hTotal": num("window5hTotal"),
        "flashCount": num("flashCount"),
        "thinkingCount": num("thinkingCount"),
        "proCount": num("proCount"),
        "dailyBudget": if budget > 0 { budget } else { 150 },
        "fiveHourUsedPct": pct("fiveHourUsedPct"),
        "fiveHourRemainingPct": pct("fiveHourRemainingPct"),
        "weeklyUsedPct": pct("weeklyUsedPct"),
        "weeklyRemainingPct": pct("weeklyRemainingPct"),
        "dailyRemainingPct": pct("dailyRemainingPct"),
        "sessionTurns": num("sessionTurns"),
        "sessionTokensEst": num("sessionTokensEst"),
        "displaySource": slice_str("displaySource", 24),
        "lastModel": slice_str("lastModel", 48),
        "resetHint": slice_str("resetHint", 64),
        "weeklyResetHint": slice_str("weeklyResetHint", 64)
    }))
}

struct ParsedRequest {
    method: String,
    target: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_http_request(stream: &mut TcpStream) -> Result<ParsedRequest, (u16, &'static str)> {
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut tmp = [0u8; 4096];
    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        if let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
            break pos + 2;
        }
        if buf.len() >= 32 * 1024 {
            return Err((431, "headers_too_large"));
        }
        match stream.read(&mut tmp) {
            Ok(0) => return Err((400, "unexpected_eof")),
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(_) => return Err((400, "read_error")),
        }
    };

    let head_str = String::from_utf8_lossy(&buf[..header_end]);
    let mut lines = head_str.lines();
    let req_line = lines.next().ok_or((400, "empty_request"))?;
    let mut parts = req_line.split_whitespace();
    let method = parts.next().ok_or((400, "missing_method"))?.to_ascii_uppercase();
    let target = parts.next().ok_or((400, "missing_target"))?.to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    let content_len: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let max_body = if target.starts_with("/api/memory/") {
        MAX_MEMORY_BODY
    } else {
        MAX_SYNC_BODY
    };
    if content_len > max_body {
        return Err((413, "payload_too_large"));
    }

    let mut body = buf[header_end..].to_vec();
    while body.len() < content_len {
        let need = content_len - body.len();
        let mut chunk = vec![0u8; need.min(16384)];
        match stream.read(&mut chunk) {
            Ok(0) => return Err((400, "truncated_body")),
            Ok(n) => body.extend_from_slice(&chunk[..n]),
            Err(_) => return Err((400, "body_read_error")),
        }
    }
    body.truncate(content_len);

    Ok(ParsedRequest {
        method,
        target,
        headers,
        body,
    })
}

fn cors_origin_header(origin: Option<&str>) -> String {
    match origin {
        Some(o) if is_allowed_origin(Some(o)) => format!("Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\n"),
        None => "Access-Control-Allow-Origin: *\r\n".to_string(),
        _ => String::new(),
    }
}

fn status_reason(code: u16) -> &'static str {
    match code {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "OK",
    }
}

fn send_bytes(
    stream: &mut TcpStream,
    code: u16,
    content_type: &str,
    extra_headers: &str,
    origin: Option<&str>,
    body: &[u8],
) {
    let cors = cors_origin_header(origin);
    let head = format!(
        "HTTP/1.1 {code} {}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n{cors}Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Catstella-Client\r\nAccess-Control-Allow-Private-Network: true\r\n{extra_headers}\r\n",
        status_reason(code),
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn send_json(stream: &mut TcpStream, code: u16, origin: Option<&str>, val: &Value) {
    let bytes = serde_json::to_vec(val).unwrap_or_else(|_| b"{}".to_vec());
    send_bytes(
        stream,
        code,
        "application/json; charset=utf-8",
        "Cache-Control: no-store\r\n",
        origin,
        &bytes,
    );
}

fn send_text(stream: &mut TcpStream, code: u16, origin: Option<&str>, text: &str) {
    send_bytes(
        stream,
        code,
        "text/plain; charset=utf-8",
        "",
        origin,
        text.as_bytes(),
    );
}

fn loopback_memosyne_addr() -> Option<(SocketAddr, String)> {
    let raw = std::env::var("MEMOSYNE_URL").ok()?;
    let parsed = Url::parse(raw.trim()).ok()?;
    if parsed.scheme() != "http" {
        return None;
    }
    let host = parsed.host_str()?.to_ascii_lowercase();
    if host != "127.0.0.1" && host != "localhost" {
        return None;
    }
    let port = parsed.port_or_known_default()?;
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().ok()?;
    Some((addr, format!("127.0.0.1:{port}")))
}

fn forward_to_memosyne(
    addr: SocketAddr,
    host_hdr: &str,
    method: &str,
    target: &str,
    content_type: Option<&str>,
    body: &[u8],
) -> Option<(u16, String, Vec<u8>)> {
    let mut upstream = TcpStream::connect_timeout(&addr, Duration::from_millis(1200)).ok()?;
    let _ = upstream.set_read_timeout(Some(Duration::from_millis(2500)));
    let _ = upstream.set_write_timeout(Some(Duration::from_millis(1500)));
    let ct = content_type.unwrap_or("application/json");
    let req_head = format!(
        "{method} {target} HTTP/1.1\r\nHost: {host_hdr}\r\nContent-Type: {ct}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    upstream.write_all(req_head.as_bytes()).ok()?;
    if !body.is_empty() {
        upstream.write_all(body).ok()?;
    }
    upstream.flush().ok()?;

    let mut raw_resp = Vec::new();
    let mut buf = [0u8; 4096];
    while let Ok(n) = upstream.read(&mut buf) {
        if n == 0 {
            break;
        }
        raw_resp.extend_from_slice(&buf[..n]);
        if raw_resp.len() > MAX_MEMORY_BODY + 16384 {
            break;
        }
    }
    let head_end = raw_resp.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head_str = String::from_utf8_lossy(&raw_resp[..head_end]);
    let mut lines = head_str.lines();
    let status_line = lines.next()?;
    let code: u16 = status_line.split_whitespace().nth(1)?.parse().ok()?;
    let mut resp_ct = "application/json; charset=utf-8".to_string();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-type") {
                resp_ct = v.trim().to_string();
            }
        }
    }
    Some((code, resp_ct, raw_resp[head_end + 4..].to_vec()))
}

fn handle_client<F>(mut stream: TcpStream, state: Arc<SharedApp>, on_sync: F)
where
    F: Fn(BridgeSyncEffect) + Send + 'static,
{
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

    let req = match read_http_request(&mut stream) {
        Ok(r) => r,
        Err((code, msg)) => {
            send_json(&mut stream, code, None, &json!({ "ok": false, "error": msg }));
            return;
        }
    };

    let origin = req.headers.get("origin").map(|s| s.as_str());
    if !is_allowed_origin(origin) {
        send_text(&mut stream, 403, None, "Forbidden origin");
        return;
    }

    if req.method == "OPTIONS" {
        send_bytes(&mut stream, 204, "text/plain; charset=utf-8", "", origin, b"");
        return;
    }

    let full_url = format!("http://127.0.0.1{}", req.target);
    let Ok(parsed) = Url::parse(&full_url) else {
        send_json(&mut stream, 400, origin, &json!({ "ok": false, "error": "bad_url" }));
        return;
    };
    let path = parsed.path();

    if path.starts_with("/api/memory/") {
        if let Some((addr, host_hdr)) = loopback_memosyne_addr() {
            let ct = req.headers.get("content-type").map(|s| s.as_str());
            if let Some((code, resp_ct, resp_body)) =
                forward_to_memosyne(addr, &host_hdr, &req.method, &req.target, ct, &req.body)
            {
                send_bytes(
                    &mut stream,
                    code,
                    &resp_ct,
                    "Cache-Control: no-store\r\n",
                    origin,
                    &resp_body,
                );
                return;
            }
        }
        send_json(
            &mut stream,
            503,
            origin,
            &json!({ "ok": false, "error": "memosyne_unavailable" }),
        );
        return;
    }

    if req.method == "GET" && path == "/companion/state" {
        let payload = state.build_companion_state_payload(true);
        send_json(&mut stream, 200, origin, &payload);
        return;
    }

    if req.method == "GET" && path == "/companion/wallpapers" {
        let payload = state.build_companion_wallpapers_payload();
        send_json(&mut stream, 200, origin, &payload);
        return;
    }

    if req.method == "GET" && path == "/companion/wallpaper-image" {
        let id = parsed
            .query_pairs()
            .find(|(k, _)| k == "id")
            .map(|(_, v)| v.to_string())
            .unwrap_or_default();
        let req_id = if id.is_empty() { None } else { Some(id.as_str()) };
        let Some(file_path) = state.resolve_wallpaper_path(req_id) else {
            send_json(
                &mut stream,
                404,
                origin,
                &json!({ "ok": false, "error": "wallpaper_not_found" }),
            );
            return;
        };
        serve_image_file(&mut stream, origin, &file_path);
        return;
    }

    if req.method == "GET" && path == "/companion/character-frame" {
        let mut pack_id = String::new();
        let mut frame = String::new();
        for (k, v) in parsed.query_pairs() {
            if k == "pack" {
                pack_id = v.to_string();
            } else if k == "frame" {
                frame = v.to_string();
            }
        }
        let Some(file_path) = state.resolve_character_frame_path(&pack_id, &frame) else {
            send_json(
                &mut stream,
                404,
                origin,
                &json!({ "ok": false, "error": "character_frame_not_found" }),
            );
            return;
        };
        serve_image_file(&mut stream, origin, &file_path);
        return;
    }

    if req.method == "POST" && path == "/companion/sync" {
        let client_hdr = req.headers.get("x-catstella-client").map(|s| s.as_str());
        if client_hdr != Some("gemini-web-companion") {
            send_json(
                &mut stream,
                403,
                origin,
                &json!({ "ok": false, "error": "missing_client_header" }),
            );
            return;
        }
        let Ok(body_val) = (if req.body.is_empty() {
            Ok(json!({}))
        } else {
            serde_json::from_slice::<Value>(&req.body)
        }) else {
            send_json(
                &mut stream,
                400,
                origin,
                &json!({ "ok": false, "error": "invalid_json" }),
            );
            return;
        };
        let Some(body_obj) = body_val.as_object() else {
            send_json(
                &mut stream,
                400,
                origin,
                &json!({ "ok": false, "error": "invalid_json" }),
            );
            return;
        };

        let include_agy = body_obj
            .get("includeAgyQuota")
            .and_then(|v| v.as_bool())
            != Some(false);

        let effect = apply_companion_sync(&state, body_obj);
        if let Some(turn) = body_obj.get("completedTurn").filter(|v| v.is_object()).cloned() {
            if let Some((addr, host_hdr)) = loopback_memosyne_addr() {
                thread::spawn(move || {
                    if let Ok(bytes) = serde_json::to_vec(&turn) {
                        let _ = forward_to_memosyne(
                            addr,
                            &host_hdr,
                            "POST",
                            "/api/memory/ingest-turn",
                            Some("application/json"),
                            &bytes,
                        );
                    }
                });
            }
        }

        let payload = state.build_companion_state_payload(include_agy);
        send_json(&mut stream, 200, origin, &payload);

        if effect.web_changed || effect.patch_applied || effect.rotated || effect.slideshow_changed {
            on_sync(effect);
        }
        return;
    }

    send_json(&mut stream, 404, origin, &json!({ "ok": false, "error": "not_found" }));
}

fn serve_image_file(stream: &mut TcpStream, origin: Option<&str>, file_path: &Path) {
    let Ok(meta) = fs::metadata(file_path) else {
        send_json(
            stream,
            404,
            origin,
            &json!({ "ok": false, "error": "wallpaper_not_found" }),
        );
        return;
    };
    if !meta.is_file() || meta.len() > MAX_WALLPAPER_BYTES {
        send_json(
            stream,
            404,
            origin,
            &json!({ "ok": false, "error": "invalid_wallpaper_file" }),
        );
        return;
    }
    let Ok(bytes) = fs::read(file_path) else {
        send_json(
            stream,
            500,
            origin,
            &json!({ "ok": false, "error": "wallpaper_read_failed" }),
        );
        return;
    };
    let ext = file_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let mime = image_mime_for_ext(ext).unwrap_or("application/octet-stream");
    send_bytes(
        stream,
        200,
        mime,
        "Cache-Control: private, max-age=300\r\nCross-Origin-Resource-Policy: cross-origin\r\n",
        origin,
        &bytes,
    );
}

fn apply_companion_sync(state: &SharedApp, body: &Map<String, Value>) -> BridgeSyncEffect {
    let now = now_ms();
    let (old_scale, changed, mut patch, rotate_wallpaper) = {
        let mut rt = state.runtime.lock().unwrap();
        let old_scale = rt.settings.get("scale").and_then(|v| v.as_i64()).unwrap_or(220) as i32;

        let prev_tuple = rt.web_companion.status_tuple(now);
        let prev_quota_str = rt
            .web_companion
            .quota
            .as_ref()
            .map(|q| q.to_string())
            .unwrap_or_default();

        rt.web_companion.last_seen_ms = now;
        if let Some(active) = body.get("webActive").and_then(|v| v.as_bool()) {
            rt.web_companion.active = active;
        }
        rt.web_companion.visible = body
            .get("webVisible")
            .and_then(|v| v.as_bool())
            .unwrap_or_else(|| body.get("webActive").and_then(|v| v.as_bool()) == Some(true));
        if let Some(raw_q) = body.get("webQuota").filter(|v| v.is_object()) {
            rt.web_companion.quota = sanitize_web_quota(raw_q);
        }
        if let Some(client) = body.get("client").and_then(|v| v.as_str()) {
            rt.web_companion.client = client.chars().take(48).collect();
        }

        let next_tuple = rt.web_companion.status_tuple(now);
        let next_quota_str = rt
            .web_companion
            .quota
            .as_ref()
            .map(|q| q.to_string())
            .unwrap_or_default();
        let changed = prev_tuple != next_tuple || prev_quota_str != next_quota_str;

        let mut patch = Map::new();
        let mut rotate = false;

        if let Some(patch_obj) = body.get("patch").and_then(|v| v.as_object()) {
            let char_sync = patch_obj
                .get("syncCharacter")
                .and_then(|v| v.as_bool())
                .unwrap_or_else(|| {
                    rt.settings
                        .get("syncCharacter")
                        .and_then(|v| v.as_bool())
                        != Some(false)
                });
            let wall_sync = patch_obj
                .get("syncWallpaper")
                .and_then(|v| v.as_bool())
                .unwrap_or_else(|| {
                    rt.settings
                        .get("syncWallpaper")
                        .and_then(|v| v.as_bool())
                        != Some(false)
                });

            for k in [
                "syncCharacter",
                "syncWallpaper",
                "syncInteraction",
                "petDisplayMode",
                "clickCatAction",
                "scale",
                "sound",
            ] {
                if let Some(v) = patch_obj.get(k) {
                    if rt.settings.get(k) != Some(v) {
                        patch.insert(k.to_string(), v.clone());
                    }
                }
            }
            if char_sync {
                if let Some(cp) = patch_obj.get("characterPack") {
                    if cp.is_string() && rt.settings.get("characterPack") != Some(cp) {
                        patch.insert("characterPack".into(), cp.clone());
                    }
                }
            }
            if wall_sync {
                if let Some(ds_obj) = patch_obj.get("dreamSkin").and_then(|v| v.as_object()) {
                    let mut ds_patch = Map::new();
                    for dk in [
                        "wallpaperId",
                        "slideshow",
                        "slideshowIntervalMinutes",
                        "opacity",
                        "scrim",
                        "themePreset",
                    ] {
                        if let Some(val) = ds_obj.get(dk) {
                            ds_patch.insert(dk.to_string(), val.clone());
                        }
                    }
                    if let Some(wid) = ds_patch.get("wallpaperId").and_then(|v| v.as_str()).map(|s| s.to_string()) {
                        if let Some(pack) = rt.wallpapers.iter().find(|w| w.id == wid && w.file.is_some()) {
                            if let Some(ref f) = pack.file {
                                ds_patch.insert("wallpaperFile".into(), json!(f.to_string_lossy().to_string()));
                            }
                        } else {
                            ds_patch.remove("wallpaperId");
                        }
                    }
                    ds_patch.retain(|k, v| rt.dream_skin.get(k) != Some(v));
                    if !ds_patch.is_empty() {
                        patch.insert("dreamSkin".into(), Value::Object(ds_patch));
                    }
                }
                if patch_obj.get("action").and_then(|v| v.as_str()) == Some("next-wallpaper") {
                    rotate = true;
                }
            }
        }
        (old_scale, changed, patch, rotate)
    };

    let mut slideshow_changed = false;
    let mut patch_applied = false;
    let mut rotated = false;

    if let Some(ds_val) = patch.remove("dreamSkin") {
        if let Some(ds_map) = ds_val.as_object() {
            if let Ok((_, ss)) = state.update_dream_skin_transactional(ds_map) {
                slideshow_changed = ss;
                patch_applied = true;
            }
        }
    }
    if !patch.is_empty() && state.update_settings_transactional(&patch, false).is_ok() {
        patch_applied = true;
    }
    if rotate_wallpaper {
        if let Some(rp) = state.next_wallpaper_patch() {
            if let Ok((_, ss)) = state.update_dream_skin_transactional(&rp) {
                rotated = true;
                if ss {
                    slideshow_changed = true;
                }
            }
        }
    }
    let new_scale = state
        .runtime
        .lock()
        .unwrap()
        .settings
        .get("scale")
        .and_then(|v| v.as_i64())
        .unwrap_or(220) as i32;

    BridgeSyncEffect {
        old_scale,
        new_scale,
        slideshow_changed,
        rotated,
        web_changed: changed,
        patch_applied,
    }
}

pub fn start_companion_bridge<F, G>(
    state: Arc<SharedApp>,
    explicit_port: Option<u16>,
    on_sync: F,
    on_heartbeat_change: G,
) -> Option<u16>
where
    F: Fn(BridgeSyncEffect) + Send + Sync + Clone + 'static,
    G: Fn() + Send + 'static,
{
    let candidates: Vec<u16> = match explicit_port {
        Some(p) => vec![p],
        None => DEFAULT_BRIDGE_PORTS.to_vec(),
    };

    let mut listener: Option<TcpListener> = None;
    let mut bound_port: Option<u16> = None;
    for port in candidates {
        if let Ok(l) = TcpListener::bind(("127.0.0.1", port)) {
            if let Ok(addr) = l.local_addr() {
                bound_port = Some(addr.port());
                listener = Some(l);
                break;
            }
        }
    }

    let (listener, port) = (listener?, bound_port?);
    state.runtime.lock().unwrap().bridge_port = Some(port);

    let accept_state = Arc::clone(&state);
    thread::spawn(move || {
        for conn in listener.incoming() {
            if accept_state.quitting.load(Ordering::Relaxed) {
                break;
            }
            if let Ok(stream) = conn {
                let st = Arc::clone(&accept_state);
                let cb = on_sync.clone();
                thread::spawn(move || handle_client(stream, st, cb));
            }
        }
    });

    // Heartbeat expiry monitor: notifies when Web companion goes offline/inactive after TTL.
    let hb_state = Arc::clone(&state);
    thread::spawn(move || {
        let mut prev_tuple = (false, false, false);
        loop {
            thread::sleep(Duration::from_millis(3500));
            if hb_state.quitting.load(Ordering::Relaxed) {
                break;
            }
            let cur = {
                let rt = hb_state.runtime.lock().unwrap();
                rt.web_companion.status_tuple(now_ms())
            };
            if cur != prev_tuple {
                prev_tuple = cur;
                on_heartbeat_change();
            }
        }
    });

    Some(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_allowlist_matches_production() {
        assert!(is_allowed_origin(None));
        assert!(is_allowed_origin(Some("chrome-extension://abcdef")));
        assert!(is_allowed_origin(Some("moz-extension://fixture")));
        assert!(is_allowed_origin(Some("http://127.0.0.1:3921")));
        assert!(is_allowed_origin(Some("http://localhost:8080")));
        assert!(is_allowed_origin(Some("http://[::1]:3921")));
        assert!(is_allowed_origin(Some("http://tauri.localhost")));
        assert!(is_allowed_origin(Some("tauri://localhost")));
        assert!(!is_allowed_origin(Some("null")));
        assert!(!is_allowed_origin(Some("https://evil.example")));
    }

    #[test]
    fn sanitize_web_quota_clamps_and_truncates() {
        let raw = json!({
            "dailyTotal": 12.6,
            "fiveHourUsedPct": 150,
            "weeklyUsedPct": -4,
            "lastModel": "Gemini 4",
            "dailyBudget": 0
        });
        let q = sanitize_web_quota(&raw).unwrap();
        assert_eq!(q["dailyTotal"], 13);
        assert_eq!(q["dailyBudget"], 150);
        assert_eq!(q["fiveHourUsedPct"], 100);
        assert_eq!(q["weeklyUsedPct"], 0);
        assert_eq!(q["lastModel"], "Gemini 4");
    }

    fn raw_http(port: u16, req: &str) -> (u16, Vec<u8>) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(req.as_bytes()).unwrap();
        s.flush().unwrap();
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).unwrap();
        let head_end = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let head = String::from_utf8_lossy(&buf[..head_end]);
        let code: u16 = head
            .lines()
            .next()
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        (code, buf[head_end + 4..].to_vec())
    }

    #[test]
    fn loopback_bridge_serves_state_wallpapers_sync_and_memosyne_503() {
        let dir = std::env::temp_dir().join(format!("catstella-bridge-test-{}", std::process::id()));
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

        let port = start_companion_bridge(
            Arc::clone(&state),
            Some(0),
            |_eff| {},
            || {},
        )
        .unwrap();

        let (c_state, b_state) = raw_http(port, "GET /companion/state HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        assert_eq!(c_state, 200);
        let j_state: Value = serde_json::from_slice(&b_state).unwrap();
        assert_eq!(j_state["ok"], true);
        assert_eq!(j_state["port"], port);

        let (c_walls, b_walls) = raw_http(port, "GET /companion/wallpapers HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        assert_eq!(c_walls, 200);
        let j_walls: Value = serde_json::from_slice(&b_walls).unwrap();
        assert!(!j_walls["wallpapers"].as_array().unwrap().is_empty());

        let (c_img, b_img) = raw_http(
            port,
            "GET /companion/wallpaper-image?id=gemini-character-sheet-v1 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
        );
        assert_eq!(c_img, 200);
        assert_eq!(&b_img[0..4], &[0x89, 0x50, 0x4e, 0x47]);

        // Forbidden origin
        let (c_evil, _) = raw_http(
            port,
            "GET /companion/state HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: https://evil.example\r\n\r\n",
        );
        assert_eq!(c_evil, 403);

        // Missing X-Catstella-Client header
        let (c_nohdr, _) = raw_http(
            port,
            "POST /companion/sync HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 2\r\n\r\n{}",
        );
        assert_eq!(c_nohdr, 403);

        // Valid sync updating characterPack & webQuota
        let body = r#"{"webActive":true,"client":"test-ext","webQuota":{"dailyTotal":7,"fiveHourUsedPct":20,"lastModel":"Gemini 3 Pro"},"patch":{"characterPack":"lin-cat"}}"#;
        let req = format!(
            "POST /companion/sync HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: chrome-extension://abc\r\nContent-Type: application/json\r\nX-Catstella-Client: gemini-web-companion\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        let (c_sync, b_sync) = raw_http(port, &req);
        assert_eq!(c_sync, 200);
        let j_sync: Value = serde_json::from_slice(&b_sync).unwrap();
        assert_eq!(j_sync["desktop"]["characterPack"], "lin-cat");
        assert_eq!(j_sync["web"]["online"], true);
        assert_eq!(j_sync["web"]["quota"]["dailyTotal"], 7);
        for origin in [None, Some("moz-extension://fixture")] {
            let origin_header = origin.map(|o| format!("Origin: {o}\r\n")).unwrap_or_default();
            let req = format!(
                "POST /companion/sync HTTP/1.1\r\nHost: 127.0.0.1\r\n{origin_header}X-Catstella-Client: gemini-web-companion\r\nContent-Length: {}\r\n\r\n{body}", body.len()
            );
            assert_eq!(raw_http(port, &req).0, 200);
            let mut socket = TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(socket, "OPTIONS /companion/sync HTTP/1.1\r\nHost: 127.0.0.1\r\n{origin_header}Access-Control-Request-Private-Network: true\r\n\r\n").unwrap();
            let mut response = String::new();
            socket.read_to_string(&mut response).unwrap();
            assert!(response.starts_with("HTTP/1.1 204"));
            assert!(response.contains("Access-Control-Allow-Private-Network: true"));
            assert!(response.contains("Access-Control-Allow-Headers: Content-Type, X-Catstella-Client"));
        }

        // Memosyne decoupled 503
        if std::env::var_os("MEMOSYNE_URL").is_none() {
            let (c_mem, b_mem) = raw_http(port, "GET /api/memory/status HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
            assert_eq!(c_mem, 503);
            let j_mem: Value = serde_json::from_slice(&b_mem).unwrap();
            assert_eq!(j_mem["error"], "memosyne_unavailable");
        }

        state.quitting.store(true, Ordering::Relaxed);
        let _ = fs::remove_dir_all(&dir);
    }
}
