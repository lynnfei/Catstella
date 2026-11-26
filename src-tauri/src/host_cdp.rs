use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use url::Url;

pub const HOST_DEBUG_FLAGS: [&str; 2] = [
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
];

const MAX_HTTP_BODY_BYTES: usize = 1024 * 1024;
const MAX_WS_PAYLOAD_BYTES: usize = 8 * 1024 * 1024;
static WS_NONCE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdpTarget {
    pub id: String,
    pub target_type: String,
    pub url: String,
    pub web_socket_debugger_url: String,
}

#[derive(Debug, Clone)]
pub struct DiscoveredHost {
    pub port: u16,
    pub target: Option<CdpTarget>,
    pub targets: Vec<CdpTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutEntry {
    pub path: String,
    pub target: String,
    pub arguments: String,
    pub has_debug_flag: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutInspectResult {
    pub supported: bool,
    pub shortcuts: Vec<ShortcutEntry>,
    pub all_configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn next_random_bytes<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9e37_79b9_7f4a_7c15);
    let mut state = nanos ^ WS_NONCE_COUNTER.fetch_add(1, Ordering::Relaxed).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    for chunk in out.chunks_mut(8) {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let bytes = state.to_le_bytes();
        let take = chunk.len();
        chunk.copy_from_slice(&bytes[..take]);
    }
    out
}

pub fn validate_loopback_ws_url(raw: &str) -> Result<(String, u16, String), String> {
    let parsed = Url::parse(raw.trim()).map_err(|_| "仅允许本机宿主".to_string())?;
    if parsed.scheme() != "ws" {
        return Err("仅允许本机宿主".into());
    }
    let host = parsed.host_str().unwrap_or("");
    if !host.eq_ignore_ascii_case("127.0.0.1") && !host.eq_ignore_ascii_case("localhost") {
        return Err("仅允许本机宿主".into());
    }
    let port = parsed.port().ok_or_else(|| "仅允许本机宿主".to_string())?;
    let mut path_and_query = parsed.path().to_string();
    if path_and_query.is_empty() {
        path_and_query.push('/');
    }
    if let Some(q) = parsed.query() {
        path_and_query.push('?');
        path_and_query.push_str(q);
    }
    Ok((host.to_string(), port, path_and_query))
}

fn is_loopback_http_url(raw: &str) -> bool {
    let Ok(parsed) = Url::parse(raw.trim()) else {
        return false;
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }
    let host = parsed.host_str().unwrap_or("");
    (host.eq_ignore_ascii_case("127.0.0.1") || host.eq_ignore_ascii_case("localhost"))
        && parsed.port().is_some()
}

pub fn is_primary_host_page(target: &Value) -> bool {
    let Some(t_type) = target.get("type").and_then(|v| v.as_str()) else {
        return false;
    };
    let Some(url) = target.get("url").and_then(|v| v.as_str()) else {
        return false;
    };
    let Some(ws) = target.get("webSocketDebuggerUrl").and_then(|v| v.as_str()) else {
        return false;
    };
    t_type == "page" && is_loopback_http_url(url) && validate_loopback_ws_url(ws).is_ok()
}

pub fn is_localizable_target(target: &Value) -> bool {
    let Some(t_type) = target.get("type").and_then(|v| v.as_str()) else {
        return false;
    };
    let Some(url) = target.get("url").and_then(|v| v.as_str()) else {
        return false;
    };
    let Some(ws) = target.get("webSocketDebuggerUrl").and_then(|v| v.as_str()) else {
        return false;
    };
    if validate_loopback_ws_url(ws).is_err() {
        return false;
    }
    if !matches!(t_type, "page" | "iframe" | "webview" | "app") {
        return false;
    }
    if url.starts_with("data:")
        || url.starts_with("devtools:")
        || url.starts_with("chrome-devtools:")
        || url.starts_with("about:blank")
    {
        return false;
    }
    is_loopback_http_url(url)
        || url.starts_with("plugin://")
        || url.starts_with("vscode-webview://")
        || url.starts_with("vscode-file://")
        || url.starts_with("app://")
}

fn to_cdp_target(v: &Value) -> Option<CdpTarget> {
    Some(CdpTarget {
        id: v
            .get("id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        target_type: v
            .get("type")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        url: v
            .get("url")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        web_socket_debugger_url: v
            .get("webSocketDebuggerUrl")
            .and_then(|x| x.as_str())?
            .to_string(),
    })
}

pub fn get_host_port_files() -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        files.push(PathBuf::from(appdata).join("Antigravity/DevToolsActivePort"));
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home_p = PathBuf::from(home);
        files.push(home_p.join("AppData/Roaming/Antigravity/DevToolsActivePort"));
        files.push(home_p.join("Library/Application Support/Antigravity/DevToolsActivePort"));
        files.push(home_p.join(".config/Antigravity/DevToolsActivePort"));
    }
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
        files.push(PathBuf::from(xdg).join("Antigravity/DevToolsActivePort"));
    }
    let mut seen = HashSet::new();
    files
        .into_iter()
        .filter(|p| seen.insert(p.to_string_lossy().to_ascii_lowercase()))
        .collect()
}

pub fn parse_port_file(path: &Path) -> Option<(u16, Option<String>)> {
    let raw = fs::read_to_string(path).ok()?;
    let mut lines = raw.lines();
    let port_line = lines.next()?.trim();
    let port = port_line.parse::<u16>().ok()?;
    if port == 0 {
        return None;
    }
    let browser_ws = lines
        .next()
        .map(str::trim)
        .filter(|s| s.starts_with('/'))
        .map(|bp| format!("ws://127.0.0.1:{port}{bp}"));
    Some((port, browser_ws))
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
}

fn decode_chunked_body(raw: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while pos < raw.len() {
        let Some(rel_crlf) = raw[pos..].windows(2).position(|w| w == b"\r\n") else {
            return Err("chunked header incomplete".into());
        };
        let size_line = std::str::from_utf8(&raw[pos..pos + rel_crlf])
            .map_err(|_| "invalid chunk size".to_string())?;
        let hex_part = size_line.split(';').next().unwrap_or("").trim();
        let chunk_size =
            usize::from_str_radix(hex_part, 16).map_err(|_| "invalid chunk hex".to_string())?;
        pos += rel_crlf + 2;
        if chunk_size == 0 {
            return Ok(out);
        }
        if out.len().saturating_add(chunk_size) > MAX_HTTP_BODY_BYTES {
            return Err("http response too large".into());
        }
        if pos + chunk_size + 2 > raw.len() {
            return Err("chunk truncated".into());
        }
        out.extend_from_slice(&raw[pos..pos + chunk_size]);
        pos += chunk_size + 2;
    }
    Ok(out)
}

pub fn http_get_json_loopback(port: u16, resource: &str, timeout_ms: u64) -> Result<Value, String> {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().map_err(|e| format!("{e}"))?;
    let connect_ms = timeout_ms.min(600);
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(connect_ms))
        .map_err(|e| format!("宿主连接失败: {e}"))?;
    let timeout = Duration::from_millis(timeout_ms);
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let req = format!(
        "GET {resource} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("宿主请求发送失败: {e}"))?;
    let _ = stream.flush();

    let mut raw = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let deadline = Instant::now() + timeout;
    let mut parsed_hdr: Option<(usize, Option<usize>, bool)> = None;
    let mut chunked_body: Option<Vec<u8>> = None;

    loop {
        if let Some((hdr_end, content_len, is_chunked)) = parsed_hdr {
            if let Some(cl) = content_len {
                if raw.len() >= hdr_end + cl {
                    break;
                }
            } else if is_chunked {
                if let Ok(decoded) = decode_chunked_body(&raw[hdr_end..]) {
                    chunked_body = Some(decoded);
                    break;
                }
            }
        } else if let Some(hdr_end) = find_header_end(&raw) {
            let header_str = std::str::from_utf8(&raw[..hdr_end])
                .map_err(|_| "宿主端点返回无效数据".to_string())?;
            let status_ok = header_str
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|code| code.parse::<u16>().ok())
                .map(|code| (200..300).contains(&code))
                .unwrap_or(false);
            if !status_ok {
                return Err("宿主端点返回非 2xx 状态".into());
            }
            let mut content_len = None;
            let mut is_chunked = false;
            for line in header_str.lines().skip(1) {
                if let Some((k, v)) = line.split_once(':') {
                    let key = k.trim();
                    if key.eq_ignore_ascii_case("content-length") {
                        if let Ok(n) = v.trim().parse::<usize>() {
                            if n > MAX_HTTP_BODY_BYTES {
                                return Err("宿主响应过大".into());
                            }
                            content_len = Some(n);
                        }
                    } else if key.eq_ignore_ascii_case("transfer-encoding")
                        && v.to_ascii_lowercase().contains("chunked")
                    {
                        is_chunked = true;
                    }
                }
            }
            parsed_hdr = Some((hdr_end, content_len, is_chunked));
            if let Some(cl) = content_len {
                if raw.len() >= hdr_end + cl {
                    break;
                }
            } else if is_chunked {
                if let Ok(decoded) = decode_chunked_body(&raw[hdr_end..]) {
                    chunked_body = Some(decoded);
                    break;
                }
            }
        }

        if Instant::now() >= deadline {
            return Err("宿主响应超时".into());
        }
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                if raw.len().saturating_add(n) > MAX_HTTP_BODY_BYTES + 8192 {
                    return Err("宿主响应过大".into());
                }
                raw.extend_from_slice(&chunk[..n]);
            }
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                return Err("宿主响应超时".into());
            }
            Err(e) => return Err(format!("宿主读取失败: {e}")),
        }
    }

    let (hdr_end, content_len, is_chunked) =
        parsed_hdr.ok_or_else(|| "宿主端点返回无效数据".to_string())?;
    let body_raw = &raw[hdr_end..];
    let body: &[u8] = if let Some(ref dec) = chunked_body {
        dec.as_slice()
    } else if let Some(cl) = content_len {
        if body_raw.len() < cl {
            return Err("宿主响应不完整".into());
        }
        &body_raw[..cl]
    } else if is_chunked {
        return serde_json::from_slice(&decode_chunked_body(body_raw)?)
            .map_err(|_| "宿主端点返回无效数据".into());
    } else {
        body_raw
    };
    serde_json::from_slice(body).map_err(|_| "宿主端点返回无效数据".into())
}

fn probe_port_targets(port: u16, include_sub_targets: bool) -> Result<(Vec<CdpTarget>, Option<CdpTarget>), String> {
    let val = http_get_json_loopback(port, "/json/list", 1200)?;
    let arr = val.as_array().cloned().unwrap_or_default();
    let mut valid = Vec::new();
    let mut primary: Option<CdpTarget> = None;
    for item in &arr {
        let matches = if include_sub_targets {
            is_localizable_target(item)
        } else {
            is_primary_host_page(item)
        };
        if !matches {
            continue;
        }
        if let Some(t) = to_cdp_target(item) {
            if primary.is_none() && is_primary_host_page(item) {
                primary = Some(t.clone());
            }
            valid.push(t);
        }
    }
    if primary.is_none() {
        primary = valid.first().cloned();
    }
    Ok((valid, primary))
}

pub fn discover_host(explicit_port: Option<u16>, include_sub_targets: bool) -> Option<DiscoveredHost> {
    // When an explicit loopback test/override port is supplied (--host-cdp-port),
    // never touch the user's live DevToolsActivePort file.
    if let Some(port) = explicit_port.filter(|&p| p > 0) {
        if let Ok((targets, primary)) = probe_port_targets(port, include_sub_targets) {
            if !targets.is_empty() {
                return Some(DiscoveredHost {
                    port,
                    target: primary,
                    targets,
                });
            }
        }
        return None;
    }

    for file in get_host_port_files() {
        let Some((port, _browser_ws)) = parse_port_file(&file) else {
            continue;
        };
        if let Ok((targets, primary)) = probe_port_targets(port, include_sub_targets) {
            if !targets.is_empty() {
                return Some(DiscoveredHost {
                    port,
                    target: primary,
                    targets,
                });
            }
        }
    }

    let env_port = std::env::var("CATSTELLA_HOST_CDP_PORT")
        .ok()
        .or_else(|| std::env::var("AGY_CDP_PORT").ok())
        .and_then(|s| s.trim().parse::<u16>().ok())
        .filter(|&p| p > 0);
    if let Some(port) = env_port {
        if let Ok((targets, primary)) = probe_port_targets(port, include_sub_targets) {
            if !targets.is_empty() {
                return Some(DiscoveredHost {
                    port,
                    target: primary,
                    targets,
                });
            }
        }
    }
    None
}

pub struct CdpClient {
    stream: TcpStream,
    read_buf: Vec<u8>,
    next_id: u64,
    closed: bool,
}

impl CdpClient {
    pub fn connect(ws_url: &str, timeout_ms: u64) -> Result<Self, String> {
        let (_host, port, path) = validate_loopback_ws_url(ws_url)?;
        let addr: SocketAddr = format!("127.0.0.1:{port}").parse().map_err(|e| format!("{e}"))?;
        let timeout = Duration::from_millis(timeout_ms.clamp(100, 15000));
        let mut stream = TcpStream::connect_timeout(&addr, timeout)
            .map_err(|e| format!("连接 CDP 失败: {e}"))?;
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));
        let _ = stream.set_nodelay(true);

        let key = B64.encode(next_random_bytes::<16>());
        let req = format!(
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        );
        stream
            .write_all(req.as_bytes())
            .map_err(|e| format!("握手发送失败: {e}"))?;
        let _ = stream.flush();

        let mut buf = Vec::with_capacity(1024);
        let mut tmp = [0u8; 1024];
        let deadline = Instant::now() + timeout;
        let hdr_end = loop {
            if let Some(pos) = find_header_end(&buf) {
                break pos;
            }
            if Instant::now() >= deadline {
                return Err("CDP 握手超时".into());
            }
            if buf.len() > 16 * 1024 {
                return Err("CDP 握手响应过大".into());
            }
            let n = stream
                .read(&mut tmp)
                .map_err(|e| format!("CDP 握手读取失败: {e}"))?;
            if n == 0 {
                return Err("CDP 握手连接已关闭".into());
            }
            buf.extend_from_slice(&tmp[..n]);
        };

        let hdr_str = std::str::from_utf8(&buf[..hdr_end]).map_err(|_| "CDP 握手头无效".to_string())?;
        let first_line = hdr_str.lines().next().unwrap_or("");
        if !first_line.contains(" 101 ") {
            return Err(format!("CDP 握手被拒绝: {first_line}"));
        }
        let leftover = buf[hdr_end..].to_vec();
        Ok(Self {
            stream,
            read_buf: leftover,
            next_id: 0,
            closed: false,
        })
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }

    fn read_exact_buffered(&mut self, len: usize, deadline: Instant) -> Result<Vec<u8>, String> {
        while self.read_buf.len() < len {
            let now = Instant::now();
            if now >= deadline {
                return Err("宿主操作超时".into());
            }
            let remain = deadline.saturating_duration_since(now);
            let _ = self.stream.set_read_timeout(Some(remain));
            let mut tmp = [0u8; 8192];
            match self.stream.read(&mut tmp) {
                Ok(0) => {
                    self.closed = true;
                    return Err("宿主已断开".into());
                }
                Ok(n) => self.read_buf.extend_from_slice(&tmp[..n]),
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    return Err("宿主操作超时".into());
                }
                Err(e) => {
                    self.closed = true;
                    return Err(format!("宿主已断开: {e}"));
                }
            }
        }
        let out: Vec<u8> = self.read_buf.drain(..len).collect();
        Ok(out)
    }

    fn write_frame(&mut self, opcode: u8, payload: &[u8]) -> Result<(), String> {
        if self.closed {
            return Err("宿主已断开".into());
        }
        if payload.len() > MAX_WS_PAYLOAD_BYTES {
            return Err("CDP 消息过大".into());
        }
        let mask = next_random_bytes::<4>();
        let mut frame = Vec::with_capacity(14 + payload.len());
        frame.push(0x80 | (opcode & 0x0f));
        let len = payload.len();
        if len < 126 {
            frame.push(0x80 | (len as u8));
        } else if len <= u16::MAX as usize {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(len as u16).to_be_bytes());
        } else {
            frame.push(0x80 | 127);
            frame.extend_from_slice(&(len as u64).to_be_bytes());
        }
        frame.extend_from_slice(&mask);
        let offset = frame.len();
        frame.extend_from_slice(payload);
        for (i, b) in frame[offset..].iter_mut().enumerate() {
            *b ^= mask[i & 3];
        }
        self.stream.write_all(&frame).map_err(|e| {
            self.closed = true;
            format!("宿主发送失败: {e}")
        })?;
        let _ = self.stream.flush();
        Ok(())
    }

    fn read_frame(&mut self, deadline: Instant) -> Result<(bool, u8, Vec<u8>), String> {
        let hdr = self.read_exact_buffered(2, deadline)?;
        let fin = (hdr[0] & 0x80) != 0;
        let opcode = hdr[0] & 0x0f;
        let masked = (hdr[1] & 0x80) != 0;
        let mut len = (hdr[1] & 0x7f) as usize;
        if len == 126 {
            let ext = self.read_exact_buffered(2, deadline)?;
            len = u16::from_be_bytes([ext[0], ext[1]]) as usize;
        } else if len == 127 {
            let ext = self.read_exact_buffered(8, deadline)?;
            let raw_len = u64::from_be_bytes([
                ext[0], ext[1], ext[2], ext[3], ext[4], ext[5], ext[6], ext[7],
            ]);
            if raw_len > MAX_WS_PAYLOAD_BYTES as u64 {
                return Err("CDP 帧过大".into());
            }
            len = raw_len as usize;
        }
        if len > MAX_WS_PAYLOAD_BYTES {
            return Err("CDP 帧过大".into());
        }
        let mask_key = if masked {
            Some(self.read_exact_buffered(4, deadline)?)
        } else {
            None
        };
        let mut payload = if len > 0 {
            self.read_exact_buffered(len, deadline)?
        } else {
            Vec::new()
        };
        if let Some(key) = mask_key {
            for (i, b) in payload.iter_mut().enumerate() {
                *b ^= key[i & 3];
            }
        }
        Ok((fin, opcode, payload))
    }

    fn read_text_message(&mut self, deadline: Instant) -> Result<String, String> {
        let mut frag_buf: Option<Vec<u8>> = None;
        loop {
            let (fin, opcode, payload) = self.read_frame(deadline)?;
            match opcode {
                0x8 => {
                    self.closed = true;
                    return Err("宿主已断开".into());
                }
                0x9 => {
                    // Control frame: respond to Ping with masked Pong, preserving continuation state.
                    let _ = self.write_frame(0xA, &payload);
                }
                0xA => {
                    // Ignore unsolicited Pong.
                }
                0x1 | 0x2 => {
                    if fin {
                        return String::from_utf8(payload)
                            .map_err(|_| "CDP 消息非 UTF-8".to_string());
                    }
                    frag_buf = Some(payload);
                }
                0x0 => {
                    let Some(ref mut acc) = frag_buf else {
                        return Err("CDP 续帧状态无效".into());
                    };
                    if acc.len().saturating_add(payload.len()) > MAX_WS_PAYLOAD_BYTES {
                        return Err("CDP 分片消息过大".into());
                    }
                    acc.extend_from_slice(&payload);
                    if fin {
                        let done = frag_buf.take().unwrap_or_default();
                        return String::from_utf8(done)
                            .map_err(|_| "CDP 消息非 UTF-8".to_string());
                    }
                }
                _ => {}
            }
        }
    }

    pub fn send(&mut self, method: &str, params: Value, timeout_ms: u64) -> Result<Value, String> {
        self.next_id = self.next_id.saturating_add(1);
        let req_id = self.next_id;
        let msg = json!({
            "id": req_id,
            "method": method,
            "params": params
        });
        let raw = serde_json::to_vec(&msg).map_err(|e| format!("{e}"))?;
        let deadline = Instant::now() + Duration::from_millis(timeout_ms.clamp(100, 60000));
        self.write_frame(0x1, &raw)?;

        loop {
            let text = self.read_text_message(deadline)?;
            let Ok(parsed) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            let Some(resp_id) = parsed.get("id").and_then(|v| v.as_u64()) else {
                // Async CDP event frame; skip while waiting for RPC reply.
                continue;
            };
            if resp_id != req_id {
                continue;
            }
            if let Some(err_obj) = parsed.get("error") {
                let msg = err_obj
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("CDP 调用失败");
                return Err(msg.to_string());
            }
            return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    pub fn evaluate(&mut self, expression: &str, timeout_ms: u64) -> Result<Value, String> {
        let out = self.send(
            "Runtime.evaluate",
            json!({
                "expression": expression,
                "returnByValue": true,
                "awaitPromise": true
            }),
            timeout_ms,
        )?;
        if let Some(exc) = out.get("exceptionDetails") {
            let desc = exc
                .get("exception")
                .and_then(|e| e.get("description"))
                .and_then(|v| v.as_str())
                .or_else(|| exc.get("text").and_then(|v| v.as_str()))
                .unwrap_or("宿主执行失败");
            return Err(desc.to_string());
        }
        Ok(out
            .get("result")
            .and_then(|r| r.get("value"))
            .cloned()
            .unwrap_or(Value::Null))
    }

    pub fn close(&mut self) {
        if !self.closed {
            let _ = self.write_frame(0x8, &[]);
            self.closed = true;
            let _ = self.stream.shutdown(std::net::Shutdown::Both);
        }
    }
}

impl Drop for CdpClient {
    fn drop(&mut self) {
        self.close();
    }
}

pub fn has_debug_args(arg_str: &str) -> bool {
    let trimmed = arg_str.trim();
    if trimmed.is_empty() {
        return false;
    }
    trimmed.split_whitespace().any(|tok| {
        if let Some(val) = tok.strip_prefix("--remote-debugging-port=") {
            if val == "0" {
                return true;
            }
            let mut chars = val.chars();
            matches!(chars.next(), Some('1'..='9')) && chars.all(|c| c.is_ascii_digit())
        } else {
            false
        }
    })
}

pub fn strip_debug_args(arg_str: &str) -> String {
    arg_str
        .split_whitespace()
        .filter(|tok| {
            !tok.starts_with("--remote-debugging-port")
                && !tok.starts_with("--remote-debugging-address")
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn merge_debug_args(arg_str: &str) -> String {
    let base = strip_debug_args(arg_str);
    let flags = HOST_DEBUG_FLAGS.join(" ");
    if base.is_empty() {
        flags
    } else {
        format!("{base} {flags}")
    }
}

pub fn get_host_app_candidates() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut out = Vec::new();
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            out.push(PathBuf::from(local).join("Programs/Antigravity/Antigravity.exe"));
        } else if let Some(home) = std::env::var_os("USERPROFILE") {
            out.push(PathBuf::from(home).join("AppData/Local/Programs/Antigravity/Antigravity.exe"));
        }
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            out.push(PathBuf::from(pf).join("Antigravity/Antigravity.exe"));
        } else {
            out.push(PathBuf::from("C:/Program Files/Antigravity/Antigravity.exe"));
        }
        if let Some(pf86) = std::env::var_os("ProgramFiles(x86)") {
            out.push(PathBuf::from(pf86).join("Antigravity/Antigravity.exe"));
        } else {
            out.push(PathBuf::from("C:/Program Files (x86)/Antigravity/Antigravity.exe"));
        }
        out.push(PathBuf::from("D:/Program Files/Antigravity/Antigravity.exe"));
        out.push(PathBuf::from("E:/Program Files/Antigravity/Antigravity.exe"));
        out
    }
    #[cfg(not(windows))]
    {
        vec![
            PathBuf::from("/Applications/Antigravity.app"),
            PathBuf::from("/opt/Antigravity/antigravity"),
            PathBuf::from("/usr/bin/antigravity"),
            PathBuf::from("/usr/share/antigravity/antigravity"),
        ]
    }
}

pub fn get_user_shortcut_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        out.push(PathBuf::from(home).join("Desktop/Antigravity.lnk"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        out.push(
            PathBuf::from(appdata).join("Microsoft/Windows/Start Menu/Programs/Antigravity.lnk"),
        );
    }
    out
}

#[cfg(windows)]
fn run_powershell(script: &str, envs: &[(&str, &str)]) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let output = cmd.output().map_err(|e| format!("PowerShell 启动失败: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("PowerShell 退出码 {:?}", output.status.code())
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(windows)]
pub fn is_host_process_running() -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == -1isize as _ || snap.is_null() {
            return false;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        if Process32FirstW(snap, &mut entry) != 0 {
            loop {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                if name.eq_ignore_ascii_case("antigravity.exe") {
                    found = true;
                    break;
                }
                if Process32NextW(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
        found
    }
}

#[cfg(not(windows))]
pub fn is_host_process_running() -> bool {
    false
}

pub fn detect_host_install() -> Option<String> {
    let mut seen = HashSet::new();
    for c in get_host_app_candidates() {
        let key = c.to_string_lossy().to_ascii_lowercase();
        if !seen.insert(key) {
            continue;
        }
        if c.is_file() {
            return Some(c.to_string_lossy().to_string());
        }
    }
    #[cfg(windows)]
    {
        let paths: Vec<String> = get_user_shortcut_paths()
            .into_iter()
            .filter(|p| p.exists())
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        if !paths.is_empty() {
            let payload = B64.encode(json!({ "items": paths }).to_string().as_bytes());
            if let Ok(out) = run_powershell(
                "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$obj=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:CATSTELLA_SHORTCUT_PATHS_B64))|ConvertFrom-Json;$ws=New-Object -ComObject WScript.Shell;$res=@();foreach($p in $obj.items){if($p -and (Test-Path -LiteralPath $p)){$res+=$ws.CreateShortcut($p).TargetPath}};ConvertTo-Json -InputObject @($res) -Compress",
                &[("CATSTELLA_SHORTCUT_PATHS_B64", &payload)],
            ) {
                if let Ok(val) = serde_json::from_str::<Value>(&out) {
                    let items = val
                        .as_array()
                        .cloned()
                        .unwrap_or_else(|| vec![val]);
                    for item in items {
                        if let Some(t) = item.as_str() {
                            let p = Path::new(t);
                            if p.file_name()
                                .and_then(|n| n.to_str())
                                .is_some_and(|n| n.eq_ignore_ascii_case("antigravity.exe"))
                                && p.is_file()
                            {
                                return Some(t.to_string());
                            }
                        }
                    }
                }
            }
        }

        if let Ok(out) = run_powershell(
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$ErrorActionPreference='SilentlyContinue';$keys=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');$res=@();foreach($it in (Get-ItemProperty $keys|Where-Object{$_.DisplayName -match 'Antigravity'})){if($it.InstallLocation){$res+=(Join-Path $it.InstallLocation 'Antigravity.exe')};if($it.DisplayIcon){$res+=(($it.DisplayIcon -replace ',\\d+$','').Trim('\"').Trim())}};ConvertTo-Json -InputObject @($res) -Compress",
            &[],
        ) {
            if let Ok(val) = serde_json::from_str::<Value>(&out) {
                let items = val.as_array().cloned().unwrap_or_else(|| vec![val]);
                for item in items {
                    if let Some(t) = item.as_str() {
                        let p = Path::new(t);
                        if p.file_name()
                            .and_then(|n| n.to_str())
                            .is_some_and(|n| n.eq_ignore_ascii_case("antigravity.exe"))
                            && p.is_file()
                        {
                            return Some(t.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

pub fn inspect_host_shortcuts() -> ShortcutInspectResult {
    #[cfg(not(windows))]
    {
        ShortcutInspectResult {
            supported: false,
            shortcuts: Vec::new(),
            all_configured: false,
            error: None,
        }
    }
    #[cfg(windows)]
    {
        let paths: Vec<String> = get_user_shortcut_paths()
            .into_iter()
            .filter(|p| p.exists())
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        if paths.is_empty() {
            return ShortcutInspectResult {
                supported: true,
                shortcuts: Vec::new(),
                all_configured: false,
                error: None,
            };
        }
        let b64 = B64.encode(json!({ "items": paths }).to_string().as_bytes());
        match run_powershell(
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$obj=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:CATSTELLA_SHORTCUT_PATHS_B64))|ConvertFrom-Json;$ws=New-Object -ComObject WScript.Shell;$res=@();foreach($p in $obj.items){if($p -and (Test-Path -LiteralPath $p)){$sc=$ws.CreateShortcut($p);$res+=[PSCustomObject]@{path=$p;target=[string]$sc.TargetPath;arguments=[string]$sc.Arguments}}};ConvertTo-Json -InputObject @($res) -Compress",
            &[("CATSTELLA_SHORTCUT_PATHS_B64", &b64)],
        ) {
            Ok(out) => {
                let parsed: Value = if out.is_empty() {
                    json!([])
                } else {
                    serde_json::from_str(&out).unwrap_or_else(|_| json!([]))
                };
                let rows = parsed.as_array().cloned().unwrap_or_else(|| vec![parsed]);
                let shortcuts: Vec<ShortcutEntry> = rows
                    .into_iter()
                    .filter_map(|row| {
                        let target = row.get("target").and_then(|v| v.as_str())?.to_string();
                        let fname = Path::new(&target).file_name()?.to_str()?;
                        if !fname.eq_ignore_ascii_case("antigravity.exe") {
                            return None;
                        }
                        let path = row.get("path").and_then(|v| v.as_str())?.to_string();
                        let arguments = row
                            .get("arguments")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        let has_debug_flag = has_debug_args(&arguments);
                        Some(ShortcutEntry {
                            path,
                            target,
                            arguments,
                            has_debug_flag,
                        })
                    })
                    .collect();
                let all_configured =
                    !shortcuts.is_empty() && shortcuts.iter().all(|s| s.has_debug_flag);
                ShortcutInspectResult {
                    supported: true,
                    shortcuts,
                    all_configured,
                    error: None,
                }
            }
            Err(err) => ShortcutInspectResult {
                supported: true,
                shortcuts: Vec::new(),
                all_configured: false,
                error: Some(err),
            },
        }
    }
}

pub fn configure_host_shortcuts(enable: bool) -> Value {
    #[cfg(not(windows))]
    {
        let _ = enable;
        json!({
            "ok": false,
            "supported": false,
            "reason": "unsupported-platform",
            "updated": [],
            "shortcuts": [],
            "allConfigured": false
        })
    }
    #[cfg(windows)]
    {
        let inspected = inspect_host_shortcuts();
        let mut tasks: Vec<Value> = Vec::new();
        if enable {
            if !inspected.shortcuts.is_empty() {
                for sc in &inspected.shortcuts {
                    let next_args = merge_debug_args(&sc.arguments);
                    if next_args != sc.arguments || !sc.has_debug_flag {
                        tasks.push(json!({
                            "path": sc.path,
                            "target": sc.target,
                            "arguments": next_args,
                            "create": false
                        }));
                    }
                }
            } else {
                let Some(exe) = detect_host_install() else {
                    return json!({
                        "ok": false,
                        "supported": true,
                        "reason": "not-installed",
                        "updated": [],
                        "shortcuts": [],
                        "allConfigured": false
                    });
                };
                let desktop_lnk = get_user_shortcut_paths()
                    .into_iter()
                    .next()
                    .unwrap_or_else(|| PathBuf::from("Antigravity.lnk"))
                    .to_string_lossy()
                    .to_string();
                tasks.push(json!({
                    "path": desktop_lnk,
                    "target": exe,
                    "arguments": HOST_DEBUG_FLAGS.join(" "),
                    "create": true
                }));
            }
        } else {
            for sc in &inspected.shortcuts {
                let next_args = strip_debug_args(&sc.arguments);
                if next_args != sc.arguments {
                    tasks.push(json!({
                        "path": sc.path,
                        "target": sc.target,
                        "arguments": next_args,
                        "create": false
                    }));
                }
            }
        }

        let updated: Vec<String> = tasks
            .iter()
            .filter_map(|t| t.get("path").and_then(|v| v.as_str()).map(str::to_string))
            .collect();

        if !tasks.is_empty() {
            let b64 = B64.encode(json!({ "items": tasks }).to_string().as_bytes());
            if let Err(err) = run_powershell(
                "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$obj=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:CATSTELLA_SHORTCUT_TASKS_B64))|ConvertFrom-Json;$ws=New-Object -ComObject WScript.Shell;foreach($t in $obj.items){$d=Split-Path -Parent $t.path;if($d -and -not (Test-Path -LiteralPath $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null};$sc=$ws.CreateShortcut($t.path);if($t.create -and $t.target){$sc.TargetPath=[string]$t.target;$sc.WorkingDirectory=Split-Path -Parent $t.target};$sc.Arguments=[string]$t.arguments;$sc.Save()}",
                &[("CATSTELLA_SHORTCUT_TASKS_B64", &b64)],
            ) {
                return json!({
                    "ok": false,
                    "supported": true,
                    "error": err,
                    "updated": [],
                    "shortcuts": inspected.shortcuts,
                    "allConfigured": inspected.all_configured
                });
            }
        }

        let after = inspect_host_shortcuts();
        let ok = if enable {
            after.all_configured
        } else {
            after.shortcuts.iter().all(|s| !s.has_debug_flag)
        };
        json!({
            "ok": ok,
            "supported": true,
            "updated": updated,
            "shortcuts": after.shortcuts,
            "allConfigured": after.all_configured
        })
    }
}

pub fn diagnose_host(explicit_port: Option<u16>) -> Value {
    let found = discover_host(explicit_port, false);
    let running = is_host_process_running();
    let shortcuts_info = inspect_host_shortcuts();
    let install_path = detect_host_install();

    let state = if found.as_ref().and_then(|f| f.target.as_ref()).is_some() {
        "connected"
    } else if running {
        "running-no-cdp"
    } else if install_path.is_some() {
        "not-running"
    } else {
        "not-installed"
    };

    json!({
        "state": state,
        "connected": state == "connected",
        "running": running,
        "cdpAvailable": state == "connected",
        "port": found.map(|f| f.port),
        "installPath": install_path,
        "shortcutsSupported": shortcuts_info.supported,
        "shortcutsConfigured": shortcuts_info.all_configured,
        "shortcuts": shortcuts_info.shortcuts
    })
}

pub fn launch_host_with_debug(explicit_port: Option<u16>) -> Value {
    let found = discover_host(explicit_port, false);
    if let Some(f) = found {
        if f.target.is_some() {
            return json!({
                "ok": true,
                "alreadyConnected": true,
                "port": f.port,
                "message": "Antigravity 已在调试模式运行并已连接"
            });
        }
    }
    if is_host_process_running() {
        return json!({
            "ok": false,
            "reason": "already-running-no-cdp",
            "message": "Antigravity 正在运行但未开启调试通道。请先保存并完全退出 Antigravity，再点击启动（或使用桌面快捷方式重新打开）。"
        });
    }
    let Some(exe) = detect_host_install() else {
        return json!({
            "ok": false,
            "reason": "not-installed",
            "message": "未检测到 Antigravity 安装路径"
        });
    };

    match Command::new(&exe).args(HOST_DEBUG_FLAGS).spawn() {
        Ok(child) => json!({
            "ok": true,
            "pid": child.id(),
            "exePath": exe,
            "message": "已以兼容模式启动 Antigravity"
        }),
        Err(err) => json!({
            "ok": false,
            "reason": "spawn-failed",
            "message": format!("启动 Antigravity 失败：{err}")
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn debug_args_helpers_match_contract() {
        assert!(!has_debug_args(""));
        assert!(!has_debug_args("--foo=bar"));
        assert!(has_debug_args("--remote-debugging-port=0"));
        assert!(has_debug_args("--user-data-dir=foo --remote-debugging-port=9222"));
        assert!(!has_debug_args("--remote-debugging-port=abc"));

        let cleaned = strip_debug_args(
            "--foo --remote-debugging-port=9222 --bar --remote-debugging-address=127.0.0.1",
        );
        assert_eq!(cleaned, "--foo --bar");

        let merged = merge_debug_args("--foo --remote-debugging-port=9222");
        assert_eq!(
            merged,
            "--foo --remote-debugging-port=0 --remote-debugging-address=127.0.0.1"
        );
    }

    #[test]
    fn target_filtering_and_ws_validation_enforce_loopback() {
        assert!(validate_loopback_ws_url("ws://127.0.0.1:9222/devtools/page/1").is_ok());
        assert!(validate_loopback_ws_url("ws://localhost:9222/devtools/page/1").is_ok());
        assert!(validate_loopback_ws_url("ws://evil.example:9222/devtools/page/1").is_err());
        assert!(validate_loopback_ws_url("wss://127.0.0.1:9222/devtools/page/1").is_err());

        let valid_page = json!({
            "type": "page",
            "url": "http://127.0.0.1:3000/index.html",
            "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/page/1"
        });
        assert!(is_primary_host_page(&valid_page));
        assert!(is_localizable_target(&valid_page));

        let devtools_page = json!({
            "type": "page",
            "url": "devtools://devtools/bundled/inspector.html",
            "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/page/2"
        });
        assert!(!is_primary_host_page(&devtools_page));
        assert!(!is_localizable_target(&devtools_page));

        let remote_iframe = json!({
            "type": "iframe",
            "url": "https://evil.example/app",
            "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/page/3"
        });
        assert!(!is_localizable_target(&remote_iframe));

        let plugin_iframe = json!({
            "type": "iframe",
            "url": "vscode-webview://1234/index.html",
            "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/page/4"
        });
        assert!(is_localizable_target(&plugin_iframe));
    }

    fn read_client_frame(stream: &mut TcpStream) -> (u8, Vec<u8>) {
        let mut hdr = [0u8; 2];
        stream.read_exact(&mut hdr).unwrap();
        let opcode = hdr[0] & 0x0f;
        let masked = (hdr[1] & 0x80) != 0;
        let mut len = (hdr[1] & 0x7f) as usize;
        if len == 126 {
            let mut ext = [0u8; 2];
            stream.read_exact(&mut ext).unwrap();
            len = u16::from_be_bytes(ext) as usize;
        } else if len == 127 {
            let mut ext = [0u8; 8];
            stream.read_exact(&mut ext).unwrap();
            len = u64::from_be_bytes(ext) as usize;
        }
        let mut mask = [0u8; 4];
        if masked {
            stream.read_exact(&mut mask).unwrap();
        }
        let mut payload = vec![0u8; len];
        if len > 0 {
            stream.read_exact(&mut payload).unwrap();
        }
        if masked {
            for (i, b) in payload.iter_mut().enumerate() {
                *b ^= mask[i & 3];
            }
        }
        (opcode, payload)
    }

    fn write_server_frame(stream: &mut TcpStream, fin: bool, opcode: u8, payload: &[u8]) {
        let mut frame = Vec::new();
        frame.push((if fin { 0x80 } else { 0 }) | (opcode & 0x0f));
        if payload.len() < 126 {
            frame.push(payload.len() as u8);
        } else if payload.len() <= u16::MAX as usize {
            frame.push(126);
            frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        } else {
            frame.push(127);
            frame.extend_from_slice(&(payload.len() as u64).to_be_bytes());
        }
        frame.extend_from_slice(payload);
        stream.write_all(&frame).unwrap();
        stream.flush().unwrap();
    }

    #[test]
    fn cdp_client_handles_handshake_large_payload_fragments_and_ping() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let srv = thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            let mut tmp = [0u8; 1024];
            loop {
                let n = conn.read(&mut tmp).unwrap();
                buf.extend_from_slice(&tmp[..n]);
                if find_header_end(&buf).is_some() {
                    break;
                }
            }
            let resp = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";
            conn.write_all(resp.as_bytes()).unwrap();
            conn.flush().unwrap();

            // 1. Read large request (>70 KB)
            let (op1, p1) = read_client_frame(&mut conn);
            assert_eq!(op1, 0x1);
            let req1: Value = serde_json::from_slice(&p1).unwrap();
            let expr = req1["params"]["expression"].as_str().unwrap();
            let digest = format!("{:x}", Sha256::digest(expr.as_bytes()));

            // Send Ping + unsolicited event + fragmented response!
            write_server_frame(&mut conn, true, 0x9, b"ping!");
            let (pong_op, pong_payload) = read_client_frame(&mut conn);
            assert_eq!(pong_op, 0xA);
            assert_eq!(pong_payload, b"ping!");

            let evt = json!({ "method": "Runtime.consoleAPICalled", "params": {} }).to_string();
            write_server_frame(&mut conn, true, 0x1, evt.as_bytes());

            let reply = json!({
                "id": req1["id"],
                "result": { "result": { "value": { "digest": digest, "len": expr.len() } } }
            })
            .to_string();
            let split_at = reply.len() / 2;
            write_server_frame(&mut conn, false, 0x1, &reply.as_bytes()[..split_at]);
            write_server_frame(&mut conn, true, 0x0, &reply.as_bytes()[split_at..]);

            // Expect close frame on client close
            let (close_op, _) = read_client_frame(&mut conn);
            assert_eq!(close_op, 0x8);
        });

        let ws_url = format!("ws://127.0.0.1:{port}/devtools/page/mock");
        let mut client = CdpClient::connect(&ws_url, 3000).unwrap();
        let big_expr = "x".repeat(72 * 1024);
        let expected_digest = format!("{:x}", Sha256::digest(big_expr.as_bytes()));
        let val = client.evaluate(&big_expr, 5000).unwrap();
        assert_eq!(val["digest"].as_str().unwrap(), expected_digest);
        assert_eq!(val["len"].as_u64().unwrap(), (72 * 1024) as u64);
        client.close();

        srv.join().unwrap();
    }

    #[test]
    fn http_get_json_handles_keep_alive_content_length() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let body = r#"[{"id":"page-1","type":"page","url":"http://127.0.0.1:1/"}]"#;

        let srv = thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            let mut tmp = [0u8; 512];
            loop {
                let n = conn.read(&mut tmp).unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
                if find_header_end(&buf).is_some() {
                    break;
                }
            }
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Length:{}\r\nContent-Type:application/json; charset=UTF-8\r\n\r\n{}",
                body.len(),
                body
            );
            conn.write_all(resp.as_bytes()).unwrap();
            conn.flush().unwrap();
            // Hold open without EOF for 3s to simulate Chromium DevTools HTTP keep-alive.
            thread::sleep(Duration::from_millis(3000));
        });

        let started = Instant::now();
        let val = http_get_json_loopback(port, "/json/list", 2000).unwrap();
        let elapsed = started.elapsed();
        assert!(elapsed < Duration::from_millis(500), "unexpected stall: {elapsed:?}");
        assert_eq!(val.as_array().unwrap().len(), 1);
        assert_eq!(val[0]["id"].as_str().unwrap(), "page-1");
        drop(srv);
    }
}
