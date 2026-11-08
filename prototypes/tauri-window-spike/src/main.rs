#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Catstella Tauri 迁移门槛实验：分区命中 / 拖动捕获 / 独立进程宿主跟随。
// 只使用独立应用标识与本地静态素材，不连接真实 Antigravity。
// 底板与测试宿主由独立进程 spike-external.exe 提供，点击送达经日志验证。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicIsize, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{Manager, WebviewWindow};

// ---- 窗口分区（逻辑 px，须与 ui/style.css 一致）----
const WIN_W: f64 = 340.0;
const WIN_H: f64 = 420.0;
const BUBBLE_TOP: f64 = 0.0;
const BUBBLE_BOTTOM: f64 = 150.0;
const ART_TOP: f64 = 230.0;
const ART_BOTTOM: f64 = 420.0;
// 计数/配置按钮中心（逻辑 px，对应 style.css 的固定定位）。
const PING_CENTER: (f64, f64) = (72.0, 120.0);
const CONFIG_CENTER: (f64, f64) = (176.0, 120.0);

const EXTERNAL_CLASS: &str = "SpikeExternalWindow";
const BACKDROP_TITLE: &str = "Catstella Spike · 底板";
const HOST_TITLE: &str = "Catstella Spike · 测试宿主";

fn zone_at(x: f64, y: f64) -> &'static str {
    let _ = x;
    if y >= BUBBLE_TOP && y < BUBBLE_BOTTOM {
        "bubble"
    } else if y >= ART_TOP && y < ART_BOTTOM {
        "art"
    } else {
        "blank"
    }
}

struct Spike {
    pet: WebviewWindow,
    dragging: AtomicBool,
    // 可替换的停止标志：重新绑定跟随引擎时换新标志，避免旧线程复活。
    follow_stop: Mutex<Arc<AtomicBool>>,
    passthrough: AtomicBool,
}

static SPIKE: OnceLock<Arc<Spike>> = OnceLock::new();
static PING_COUNT: AtomicU32 = AtomicU32::new(0);
static PING_LOG: OnceLock<PathBuf> = OnceLock::new();

fn spike() -> Arc<Spike> {
    SPIKE.get().expect("spike state").clone()
}

#[tauri::command]
fn drag(window: WebviewWindow) -> Result<(), String> {
    let spike = spike();
    spike.dragging.store(true, Ordering::Relaxed);
    // 松手检测：模态拖动循环吞掉 pointerup，用异步按键状态收尾。
    let spike_for_release = spike.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(30));
        let pressed = (unsafe { get_async_key_state() } as u16) & 0x8000 != 0;
        if !pressed {
            // 松手后恢复分区穿透轮询。
            spike_for_release.dragging.store(false, Ordering::Relaxed);
            break;
        }
    });
    spike
        .pet
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())?;
    spike.passthrough.store(false, Ordering::Relaxed);
    window.start_dragging().map_err(|error| error.to_string())
}

#[cfg(windows)]
fn get_async_key_state() -> i16 {
    unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(0x01) }
}
#[cfg(not(windows))]
fn get_async_key_state() -> i16 {
    0
}

#[tauri::command]
fn ignore_temporarily(window: WebviewWindow) -> Result<(), String> {
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(3));
        let _ = window.set_ignore_cursor_events(false);
    });
    Ok(())
}

#[tauri::command]
fn exit_spike(window: WebviewWindow) {
    window.app_handle().exit(0);
}

#[tauri::command]
fn bubble_ping() -> Result<(), String> {
    PING_COUNT.fetch_add(1, Ordering::Relaxed);
    if let Some(path) = PING_LOG.get() {
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            use std::io::Write as _;
            let _ = writeln!(file, "ping tick={}", PING_COUNT.load(Ordering::Relaxed));
        }
    }
    Ok(())
}

// ---- 隔离配置目录（迁移门槛：设置与本机数据）----
// 模拟 widgetApi 的设置持久化模式：Rust 拥有 JSON 文件与隔离目录，页面经 IPC 读写。
static CONFIG_STORE: OnceLock<Mutex<std::collections::BTreeMap<String, serde_json::Value>>> = OnceLock::new();

fn config_dir() -> PathBuf {
    // 临时隔离目录，绝不触碰真实配置 ~/.antigravity-cat-widget
    std::env::temp_dir().join("catstella-window-spike-config")
}

fn config_file() -> PathBuf {
    config_dir().join("settings.json")
}

fn load_config() -> &'static Mutex<std::collections::BTreeMap<String, serde_json::Value>> {
    CONFIG_STORE.get_or_init(|| {
        let map = std::fs::read(config_file())
            .ok()
            .and_then(|bytes| serde_json::from_slice::<std::collections::BTreeMap<String, serde_json::Value>>(&bytes).ok())
            .unwrap_or_default();
        Mutex::new(map)
    })
}

fn cfg_write(key: &str, value: serde_json::Value) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let store = load_config();
    let mut map = store.lock().unwrap();
    map.insert(key.to_string(), value);
    // 原子写：临时文件 + rename（Windows 的 rename 带 MOVEFILE_REPLACE_EXISTING 语义）。
    let temp = dir.join(".settings.tmp");
    let bytes = serde_json::to_vec_pretty(&*map).map_err(|error| error.to_string())?;
    std::fs::write(&temp, bytes).map_err(|error| error.to_string())?;
    std::fs::rename(&temp, config_file()).map_err(|error| error.to_string())
}

fn cfg_read(key: &str) -> Option<serde_json::Value> {
    load_config().lock().unwrap().get(key).cloned()
}

// ---- 联动协议门槛：Rust 侧最小 /companion/* 服务 ----
// 只绑备用端口 3922/3923（3921 归生产实例），schema 对照 shared/companion-bridge.cjs。
static BRIDGE_PORT: AtomicU32 = AtomicU32::new(0);
static BRIDGE_LOG: OnceLock<PathBuf> = OnceLock::new();

fn bridge_port() -> u16 {
    BRIDGE_PORT.load(Ordering::Relaxed) as u16
}

fn bridge_log(line: &str) {
    if let Some(path) = BRIDGE_LOG.get() {
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            use std::io::Write as _;
            let _ = writeln!(file, "{line}");
            let _ = file.flush();
        }
    }
}

fn spike_asset(name: &str) -> Option<PathBuf> {
    // exe 在 target/release/，仓库布局下素材在 ../../ui/assets/；发布布局则在同级 ui/assets/。
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let mut candidates = vec![exe_dir.join("ui").join("assets")];
    if let Some(release) = exe_dir.parent() {
        if let Some(root) = release.parent() {
            candidates.push(root.join("ui").join("assets"));
        }
    }
    candidates.into_iter().map(|dir| dir.join(name)).find(|path| path.exists())
}

fn start_bridge() {
    // 先于探针启动；生产实例占着 3921 的 127.0.0.1，本服务必须落到备用端口。
    // 同时绑 127.0.0.2：浏览器实验用 --host-resolver-rules 把 127.0.0.1 改写到这里，
    // 让 3921 对测试浏览器彻底不可达（零竞态、零生产接触），spike 仍在 127.0.0.2 可达。
    thread::spawn(|| {
        for port in [3922u16, 3923u16] {
            match std::net::TcpListener::bind(("127.0.0.1", port)) {
                Ok(listener) => {
                    BRIDGE_PORT.store(port as u32, Ordering::Relaxed);
                    thread::spawn(move || {
                        for stream in listener.incoming() {
                            if let Ok(stream) = stream {
                                thread::spawn(move || unsafe { handle_bridge(stream) });
                            }
                        }
                    });
                    if let Ok(alt) = std::net::TcpListener::bind(("127.0.0.2", port)) {
                        thread::spawn(move || {
                            for stream in alt.incoming() {
                                if let Ok(stream) = stream {
                                    thread::spawn(move || unsafe { handle_bridge(stream) });
                                }
                            }
                        });
                    }
                    return;
                }
                Err(_) => continue,
            }
        }
    });
}

fn origin_allowed(origin: Option<&str>) -> bool {
    // 镜像 shared/companion-bridge.cjs 的 isAllowedOrigin：扩展协议与回环 http(s) 放行。
    let Some(origin) = origin else { return true };
    if origin == "null" {
        return false;
    }
    let Some((protocol, rest)) = origin.split_once(':') else { return false };
    match protocol {
        "chrome-extension" | "moz-extension" | "safari-web-extension" | "vscode-webview" | "vscode-file" | "app" => true,
        "http" | "https" => {
            let host = rest.trim_start_matches("//");
            let host = host.split('/').next().unwrap_or("");
            let host = host.split(':').next().unwrap_or("");
            matches!(host.to_ascii_lowercase().as_str(), "127.0.0.1" | "localhost" | "::1")
        }
        _ => false,
    }
}

fn cors_headers(origin: Option<&str>) -> String {
    let allow = match origin {
        Some(value) if origin_allowed(Some(value)) => format!("Access-Control-Allow-Origin: {value}\r\nVary: Origin\r\n"),
        Some(_) => String::new(),
        None => "Access-Control-Allow-Origin: *\r\n".into(),
    };
    format!(
        "{allow}Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Catstella-Client\r\n"
    )
}

fn http_respond(stream: &mut std::net::TcpStream, status: u16, reason: &str, origin: Option<&str>, body: &str) {
    use std::io::Write as _;
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\n{}Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        cors_headers(origin),
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
}

unsafe fn handle_bridge(mut stream: std::net::TcpStream) {
    use std::io::{Read as _, Write as _};
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let mut raw = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                raw.extend_from_slice(&chunk[..n]);
                if raw.windows(4).any(|window| window == b"\r\n\r\n") || raw.len() > 64 * 1024 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let text = String::from_utf8_lossy(&raw);
    let mut lines = text.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split(' ');
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let path = target.split('?').next().unwrap_or(target);
    let mut origin: Option<String> = None;
    let mut client_header = String::new();
    for line in lines {
        let Some((name, value)) = line.split_once(':') else { continue };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim().to_string();
        if name == "origin" {
            origin = Some(value);
        } else if name == "x-catstella-client" {
            client_header = value;
        }
    }
    let origin_ref = origin.as_deref();
    if !origin_allowed(origin_ref) {
        let head = format!(
            "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 16\r\nConnection: close\r\n\r\n"
        );
        let _ = stream.write_all(head.as_bytes());
        let _ = stream.write_all(b"Forbidden origin");
        return;
    }
    if method == "OPTIONS" {
        let head = format!("HTTP/1.1 204 No Content\r\n{}Content-Length: 0\r\nConnection: close\r\n\r\n", cors_headers(origin_ref));
        let _ = stream.write_all(head.as_bytes());
        return;
    }
    if method == "GET" && path == "/companion/state" {
        bridge_log(&format!("{} GET /companion/state", now_ms()));
        let body = format!(
            "{{\"ok\":true,\"ts\":{},\"port\":{},\"pet\":{{\"kind\":\"tauri-spike\"}},\"desktop\":{{\"wallpaperId\":\"spike-gemini-star-v1\",\"wallpaperTitle\":\"星语 · 实验立绘\",\"wallpaperRev\":\"spike-1\",\"characterPack\":\"gemini-star-v1\"}},\"web\":{{\"port\":{},\"online\":false,\"active\":false,\"visible\":false,\"lastSeen\":null,\"quota\":null,\"client\":\"\"}}}}",
            now_ms(), bridge_port(), bridge_port()
        );
        http_respond(&mut stream, 200, "OK", origin_ref, &body);
        return;
    }
    if method == "GET" && path == "/companion/wallpaper-image" {
        let id = target.split("?id=").nth(1).unwrap_or("").to_string();
        bridge_log(&format!("{} GET /companion/wallpaper-image id={}", now_ms(), id));
        if id == "spike-gemini-star-v1" {
            if let Some(asset) = spike_asset("idle.png") {
                if let Ok(bytes) = std::fs::read(&asset) {
                    use std::io::Write as _;
                    let head = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nCache-Control: private, max-age=300\r\nConnection: close\r\n\r\n",
                        bytes.len()
                    );
                    let _ = stream.write_all(head.as_bytes());
                    let _ = stream.write_all(&bytes);
                    return;
                }
            }
        }
        http_respond(&mut stream, 404, "Not Found", origin_ref, "{\"ok\":false,\"error\":\"wallpaper_not_found\"}");
        return;
    }
    if method == "GET" && path == "/companion/wallpapers" {
        let body = "{\"ok\":true,\"wallpapers\":[{\"id\":\"spike-gemini-star-v1\",\"title\":\"星语 · 实验立绘\",\"fileName\":\"idle.png\",\"preview\":\"\",\"revision\":\"spike\"}]}";
        http_respond(&mut stream, 200, "OK", origin_ref, body);
        return;
    }
    if method == "POST" && path == "/companion/sync" {
        if client_header != "gemini-web-companion" {
            http_respond(&mut stream, 403, "Forbidden", origin_ref, "{\"ok\":false,\"error\":\"missing_client_header\"}");
            return;
        }
        bridge_log(&format!("{} POST /companion/sync accepted client={client_header}", now_ms()));
        http_respond(&mut stream, 200, "OK", origin_ref, "{\"ok\":true,\"accepted\":true,\"sync\":{},\"desktop\":{\"wallpaperId\":\"spike-gemini-star-v1\",\"wallpaperTitle\":\"星语 · 实验立绘\",\"wallpaperRev\":\"spike-1\"}}");
        return;
    }
    http_respond(&mut stream, 404, "Not Found", origin_ref, "{\"ok\":false,\"error\":\"not_found\"}");
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
fn cfg_experiment(phase: u32) -> Result<serde_json::Value, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    cfg_write("spikePhase", serde_json::json!(phase))?;
    cfg_write("bubbleTint", serde_json::json!("#aabbcc"))?;
    cfg_write("nested", serde_json::json!({"opacity": 88, "tags": ["a", "b"]}))?;
    cfg_write("writtenAt", serde_json::json!(stamp))?;
    let readback = cfg_read("bubbleTint");
    Ok(serde_json::json!({"phase": phase, "readback": readback}))
}

// ---- 独立进程外部窗口（底板/测试宿主）----

fn external_exe() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(|dir| dir.join("spike-external.exe"))
        .filter(|path| path.exists())
}

#[cfg(windows)]
fn spawn_external(role: &str, title: &str, log: &PathBuf, color: &str) -> Result<std::process::Child, String> {
    std::process::Command::new(external_exe().ok_or_else(|| "spike-external.exe missing".to_string())?)
        .arg(format!("--role={role}"))
        .arg(format!("--title={title}"))
        .arg(format!("--log={}", log.display()))
        .arg(format!("--color={color}"))
        .spawn()
        .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
fn spawn_external(_role: &str, _title: &str, _log: &PathBuf, _color: &str) -> Result<std::process::Child, String> {
    Err("windows only".into())
}

#[cfg(windows)]
fn find_external(title: &str) -> Option<(windows_sys::Win32::Foundation::HWND, u32)> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowThreadProcessId};
    let class_wide: Vec<u16> = EXTERNAL_CLASS.encode_utf16().chain(std::iter::once(0)).collect();
    let title_wide: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
    for _ in 0..30 {
        let hwnd = unsafe { FindWindowW(class_wide.as_ptr(), title_wide.as_ptr()) };
        if !hwnd.is_null() {
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
            return Some((hwnd, pid));
        }
        thread::sleep(Duration::from_millis(100));
    }
    None
}
#[cfg(not(windows))]
fn find_external(_title: &str) -> Option<(*mut std::ffi::c_void, u32)> {
    None
}

#[tauri::command]
fn open_host() -> Result<(), String> {
    let log = std::env::temp_dir().join("catstella-window-spike-host-clicks.log");
    let _ = std::fs::remove_file(&log);
    spawn_external("host", HOST_TITLE, &log, "1F2630")?;
    if find_external(HOST_TITLE).is_none() {
        return Err("external host window not found".into());
    }
    Ok(())
}

#[tauri::command]
fn follow_host() -> Result<(), String> {
    let spike = spike();
    let (host_hwnd, _) = find_external(HOST_TITLE).ok_or_else(|| "external host window not found".to_string())?;
    stop_follow()?;
    let pet_hwnd = spike.pet.hwnd().map_err(|e| e.to_string())?.0 as isize;
    start_follow_engine(host_hwnd as isize, pet_hwnd, spike.replace_follow_stop());
    Ok(())
}

#[tauri::command]
fn stop_follow() -> Result<(), String> {
    let stop = spike().current_follow_stop();
    stop.store(true, Ordering::Relaxed);
    Ok(())
}

static FOLLOW_HOST: AtomicIsize = AtomicIsize::new(0);
static FOLLOW_PET: AtomicIsize = AtomicIsize::new(0);
static FOLLOW_LAST: AtomicI64 = AtomicI64::new(i64::MAX);
static FOLLOW_ACTIVE: AtomicBool = AtomicBool::new(false);

impl Spike {
    fn current_follow_stop(&self) -> Arc<AtomicBool> {
        self.follow_stop.lock().unwrap().clone()
    }
    fn replace_follow_stop(&self) -> Arc<AtomicBool> {
        let fresh = Arc::new(AtomicBool::new(false));
        *self.follow_stop.lock().unwrap() = fresh.clone();
        fresh
    }
}

#[cfg(windows)]
fn start_follow_engine(host_hwnd: isize, pet_hwnd: isize, stop: Arc<AtomicBool>) {
    FOLLOW_ACTIVE.store(true, Ordering::Relaxed);
    FOLLOW_LAST.store(i64::MAX, Ordering::Relaxed);
    FOLLOW_HOST.store(host_hwnd, Ordering::Relaxed);
    FOLLOW_PET.store(pet_hwnd, Ordering::Relaxed);
    stop.store(false, Ordering::Relaxed);
    thread::spawn(move || unsafe { follow_loop(stop) });
}
#[cfg(not(windows))]
fn start_follow_engine(_host: isize, _pet: isize, _stop: Arc<AtomicBool>) {}

// 记录宿主客户区原点并把桌宠窗口平移同样的差值——与 ForegroundHost.followHost 相同策略。
#[cfg(windows)]
unsafe fn follow_tick() -> Option<(i32, i32)> {
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
    };
    let host = FOLLOW_HOST.load(Ordering::Relaxed) as windows_sys::Win32::Foundation::HWND;
    let pet = FOLLOW_PET.load(Ordering::Relaxed) as windows_sys::Win32::Foundation::HWND;
    if host.is_null() || pet.is_null() {
        return None;
    }
    let mut point = POINT { x: 0, y: 0 };
    if ClientToScreen(host, &mut point) == 0 {
        return None;
    }
    let packed = ((point.x as i64) << 32) | (point.y as i64 & 0xffff_ffff);
    let previous = FOLLOW_LAST.swap(packed, Ordering::Relaxed);
    if previous == i64::MAX || previous == packed {
        return Some((0, 0));
    }
    let dx = point.x - (previous >> 32) as i32;
    let dy = point.y - (previous & 0xffff_ffff) as u32 as i32;
    if dx == 0 && dy == 0 {
        return Some((0, 0));
    }
    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    if GetWindowRect(pet, &mut rect) == 0 {
        return None;
    }
    SetWindowPos(
        pet,
        std::ptr::null_mut(),
        rect.left + dx,
        rect.top + dy,
        0,
        0,
        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
    );
    Some((dx, dy))
}

// z 序策略对齐 ForegroundHost 的 wantTop：宿主或桌宠在前台 → 桌宠置顶（浮在宿主上）；
// 其他窗口在前台 → 桌宠退为普通层级并紧贴该窗口下方（被其遮挡）。
// 空闲心跳绝不刷 SetWindowPos——生产注释明确这会引发 Win11 浮动任务栏 z 序重影；
// 只有目标层级、置顶位或邻居关系漂移时才调用，调用次数由 Z_CALLS 计量。
#[cfg(windows)]
static Z_CALLS: AtomicU32 = AtomicU32::new(0);

#[cfg(windows)]
unsafe fn manage_z() -> String {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindow, GetWindowLongPtrW, SetWindowPos, GW_HWNDNEXT, GWL_EXSTYLE,
        HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_TOPMOST,
    };
    let host = FOLLOW_HOST.load(Ordering::Relaxed) as HWND;
    let pet = FOLLOW_PET.load(Ordering::Relaxed) as HWND;
    if host.is_null() || pet.is_null() {
        return "inactive".into();
    }
    let foreground = GetForegroundWindow();
    if foreground.is_null() {
        return "no-foreground".into();
    }
    let topmost = |window: HWND| (GetWindowLongPtrW(window, GWL_EXSTYLE) & (WS_EX_TOPMOST as isize)) != 0;
    // 「在 fg 之下」= 沿 z 链向下数步内可见（IME 等系统窗口可能插在中间，不必紧贴）。
    let below = |fg: HWND| -> bool {
        let mut walker = fg;
        for _ in 0..8 {
            walker = GetWindow(walker, GW_HWNDNEXT);
            if walker.is_null() {
                return false;
            }
            if walker == pet {
                return true;
            }
        }
        false
    };
    let want_top = foreground == host || foreground == pet;
    let pet_topmost = topmost(pet);
    if want_top {
        if pet_topmost {
            return "kept-topmost".into();
        }
        Z_CALLS.fetch_add(1, Ordering::Relaxed);
        SetWindowPos(pet, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        "topmost".into()
    } else {
        if !pet_topmost && below(foreground) {
            return "kept-below-foreground".into();
        }
        if pet_topmost {
            Z_CALLS.fetch_add(1, Ordering::Relaxed);
            SetWindowPos(pet, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
        Z_CALLS.fetch_add(1, Ordering::Relaxed);
        SetWindowPos(pet, foreground, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        "below-foreground".into()
    }
}

#[cfg(windows)]
unsafe fn follow_loop(stop: Arc<AtomicBool>) {
    use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, EVENT_OBJECT_LOCATIONCHANGE,
        EVENT_SYSTEM_FOREGROUND, MSG, PM_REMOVE, WINEVENT_OUTOFCONTEXT,
    };
    let location_hook = SetWinEventHook(
        EVENT_OBJECT_LOCATIONCHANGE,
        EVENT_OBJECT_LOCATIONCHANGE,
        std::ptr::null_mut(),
        Some(on_host_moved),
        0,
        0,
        WINEVENT_OUTOFCONTEXT,
    );
    let foreground_hook = SetWinEventHook(
        EVENT_SYSTEM_FOREGROUND,
        EVENT_SYSTEM_FOREGROUND,
        std::ptr::null_mut(),
        Some(on_foreground_changed),
        0,
        0,
        WINEVENT_OUTOFCONTEXT,
    );
    follow_tick();
    manage_z();
    let mut fallback = 0u32;
    let mut message: MSG = std::mem::zeroed();
    while !stop.load(Ordering::Relaxed) {
        let pumped = PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE);
        if pumped != 0 {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        } else {
            thread::sleep(Duration::from_millis(8));
        }
        fallback += 1;
        if fallback >= 25 {
            // 钩子失效时的兜底轮询，约 200ms 一次。
            fallback = 0;
            let _ = follow_tick();
            let _ = manage_z();
        }
    }
    if !location_hook.is_null() {
        UnhookWinEvent(location_hook);
    }
    if !foreground_hook.is_null() {
        UnhookWinEvent(foreground_hook);
    }
    FOLLOW_ACTIVE.store(false, Ordering::Relaxed);
}

#[cfg(windows)]
unsafe extern "system" fn on_host_moved(
    _hook: windows_sys::Win32::UI::Accessibility::HWINEVENTHOOK,
    _event: u32,
    window: windows_sys::Win32::Foundation::HWND,
    _object: i32,
    _child: i32,
    _thread: u32,
    _time: u32,
) {
    if !FOLLOW_ACTIVE.load(Ordering::Relaxed) || window as isize != FOLLOW_HOST.load(Ordering::Relaxed) {
        return;
    }
    let _ = follow_tick();
}

#[cfg(windows)]
unsafe extern "system" fn on_foreground_changed(
    _hook: windows_sys::Win32::UI::Accessibility::HWINEVENTHOOK,
    _event: u32,
    _window: windows_sys::Win32::Foundation::HWND,
    _object: i32,
    _child: i32,
    _thread: u32,
    _time: u32,
) {
    if !FOLLOW_ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    let _ = manage_z();
}

// ---- 分区动态穿透轮询（对应 Electron forward:true 的物理坐标替代方案）----

fn start_zone_poller(spike: Arc<Spike>) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(16));
        // 拖动模态循环期间保持可交互，避免 toggle 干扰捕获。
        if spike.dragging.load(Ordering::Relaxed) {
            continue;
        }
        let Some((rect, scale)) = pet_rect(&spike.pet) else { continue };
        let Some((cursor_x, cursor_y)) = cursor_pos() else { continue };
        let inside = cursor_x >= rect.0 && cursor_x < rect.2 && cursor_y >= rect.1 && cursor_y < rect.3;
        let want_ignore = if !inside {
            true
        } else {
            let logical_x = (cursor_x - rect.0) as f64 / scale;
            let logical_y = (cursor_y - rect.1) as f64 / scale;
            zone_at(logical_x, logical_y) == "blank"
        };
        if want_ignore != spike.passthrough.swap(want_ignore, Ordering::Relaxed) {
            let _ = spike.pet.set_ignore_cursor_events(want_ignore);
        }
    });
}

// (left, top, right, bottom) 物理像素 + 缩放。
#[cfg(windows)]
fn pet_rect(pet: &WebviewWindow) -> Option<((i32, i32, i32, i32), f64)> {
    let hwnd = pet.hwnd().ok()?.0;
    unsafe {
        let mut rect = windows_sys::Win32::Foundation::RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut rect) == 0 {
            return None;
        }
        let dpi = windows_sys::Win32::UI::HiDpi::GetDpiForWindow(hwnd);
        Some(((rect.left, rect.top, rect.right, rect.bottom), dpi as f64 / 96.0))
    }
}
#[cfg(not(windows))]
fn pet_rect(_pet: &WebviewWindow) -> Option<((i32, i32, i32, i32), f64)> {
    None
}

#[cfg(windows)]
fn cursor_pos() -> Option<(i32, i32)> {
    let mut point = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
    unsafe {
        if windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point) == 0 {
            return None;
        }
    }
    Some((point.x, point.y))
}
#[cfg(not(windows))]
fn cursor_pos() -> Option<(i32, i32)> {
    None
}

// ---- 自动探针 ----

#[cfg(windows)]
mod probe {
    use super::{Spike, ART_BOTTOM, ART_TOP, BUBBLE_BOTTOM, BUBBLE_TOP, CONFIG_CENTER, PING_CENTER, WIN_W};
    use std::fmt::Write as _;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri::{Manager, WebviewWindow};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        ReleaseDC, SelectObject, BITMAPFILEHEADER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
        DIB_RGB_COLORS, SRCCOPY,
    };
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX};
    use windows_sys::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
    use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE,
        MOUSEINPUT,
    };
    use windows_sys::Win32::Graphics::Gdi::EnumDisplayMonitors;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, GetAncestor, GetClassNameW, GetForegroundWindow,
        GetClientRect, GetWindow, GetWindowLongPtrW, GetWindowRect, PostMessageW, SetCursorPos,
        SetWindowPos, WindowFromPoint, GA_ROOT, GW_HWNDNEXT, GWL_EXSTYLE, SWP_NOACTIVATE,
        SWP_NOSIZE, SWP_NOZORDER, WM_CLOSE, WS_EX_TOPMOST,
    };

    static SAMPLER_PET: AtomicIsize = AtomicIsize::new(0);
    static SAMPLER_DONE: AtomicBool = AtomicBool::new(false);

    struct Reporter {
        lines: String,
    }

    impl Reporter {
        fn new() -> Self {
            Self { lines: String::new() }
        }
        fn line(&mut self, text: &str) {
            let _ = writeln!(self.lines, "{text}");
        }
        fn kv(&mut self, key: &str, value: impl std::fmt::Display) {
            self.line(&format!("{key}={value}"));
        }
        fn section(&mut self, title: &str) {
            self.line("");
            self.line(&format!("== {title} =="));
        }
        fn finish(self) -> String {
            self.lines
        }
    }

    unsafe fn window_class(window: HWND) -> String {
        let mut buffer = [0u16; 128];
        let length = GetClassNameW(window, buffer.as_mut_ptr(), buffer.len() as i32);
        if length <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buffer[..length as usize])
    }

    // 返回 (根窗口归类, 命中窗口类名)——根窗口对比避免 WebView2 子 HWND 干扰。
    unsafe fn classify(point: POINT, pet: HWND, backdrop: HWND) -> (String, String) {
        let hit = WindowFromPoint(point);
        let root = GetAncestor(hit, GA_ROOT);
        let kind = if root == pet {
            "pet"
        } else if root == backdrop {
            "backdrop"
        } else if hit.is_null() {
            "none"
        } else {
            "other"
        };
        (kind.to_string(), window_class(hit))
    }

    unsafe fn send_mouse(flags: u32, dx: i32, dy: i32) -> bool {
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT { dx, dy, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
            },
        };
        SendInput(1, [input].as_ptr(), std::mem::size_of::<INPUT>() as i32) == 1
    }

    unsafe fn click_at(point: POINT) {
        SetCursorPos(point.x, point.y);
        thread::sleep(Duration::from_millis(140));
        send_mouse(MOUSEEVENTF_LEFTDOWN, 0, 0);
        thread::sleep(Duration::from_millis(60));
        send_mouse(MOUSEEVENTF_LEFTUP, 0, 0);
        thread::sleep(Duration::from_millis(220));
    }

    // 真实点击激活窗口：SetForegroundWindow 会被前台锁间歇拒绝。
    unsafe fn activate_by_click(hwnd: HWND) -> bool {
        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return false;
        }
        let point = POINT { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
        click_at(point);
        GetForegroundWindow() == hwnd
    }

    unsafe fn monitor_count() -> u32 {
        static COUNT: AtomicI32 = AtomicI32::new(0);
        unsafe extern "system" fn count_callback(
            _monitor: windows_sys::Win32::Graphics::Gdi::HMONITOR,
            _hdc: windows_sys::Win32::Graphics::Gdi::HDC,
            _rect: *mut RECT,
            _data: LPARAM,
        ) -> i32 {
            COUNT.fetch_add(1, Ordering::Relaxed);
            1
        }
        COUNT.store(0, Ordering::Relaxed);
        EnumDisplayMonitors(std::ptr::null_mut(), std::ptr::null_mut(), Some(count_callback), 0);
        COUNT.load(Ordering::Relaxed) as u32
    }

    unsafe fn capture_bmp(rect: RECT, path: &PathBuf) -> Result<(), String> {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return Err(format!(
                "invalid capture rect l={} t={} r={} b={}",
                rect.left, rect.top, rect.right, rect.bottom
            ));
        }
        let screen = GetDC(std::ptr::null_mut());
        if screen.is_null() {
            return Err("GetDC failed".into());
        }
        let memory = CreateCompatibleDC(screen);
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        let previous = SelectObject(memory, bitmap);
        let blit = BitBlt(memory, 0, 0, width, height, screen, rect.left, rect.top, SRCCOPY | CAPTUREBLT);
        SelectObject(memory, previous);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [windows_sys::Win32::Graphics::Gdi::RGBQUAD {
                rgbBlue: 0,
                rgbGreen: 0,
                rgbRed: 0,
                rgbReserved: 0,
            }],
        };
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let copied = GetDIBits(memory, bitmap, 0, height as u32, pixels.as_mut_ptr().cast(), &mut info, DIB_RGB_COLORS);
        DeleteObject(bitmap);
        DeleteDC(memory);
        ReleaseDC(std::ptr::null_mut(), screen);
        if blit == 0 || copied == 0 {
            return Err("BitBlt/GetDIBits failed".into());
        }
        let file_header = BITMAPFILEHEADER {
            bfType: 0x4d42,
            bfSize: std::mem::size_of::<BITMAPFILEHEADER>() as u32
                + std::mem::size_of::<BITMAPINFOHEADER>() as u32
                + (width * 4) as u32 * height as u32,
            bfReserved1: 0,
            bfReserved2: 0,
            bfOffBits: std::mem::size_of::<BITMAPFILEHEADER>() as u32 + std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        };
        let mut bytes = Vec::with_capacity(
            std::mem::size_of::<BITMAPFILEHEADER>() + std::mem::size_of::<BITMAPINFOHEADER>() + pixels.len(),
        );
        bytes.extend_from_slice(std::slice::from_raw_parts(
            &file_header as *const _ as *const u8,
            std::mem::size_of::<BITMAPFILEHEADER>(),
        ));
        bytes.extend_from_slice(std::slice::from_raw_parts(
            &info.bmiHeader as *const _ as *const u8,
            std::mem::size_of::<BITMAPINFOHEADER>(),
        ));
        bytes.extend_from_slice(&pixels);
        std::fs::write(path, bytes).map_err(|error| error.to_string())
    }

    unsafe fn ClientToScreenSpike(window: HWND, point: &mut POINT) -> i32 {
        windows_sys::Win32::Graphics::Gdi::ClientToScreen(window, point)
    }

    // 从辅助进程 JSON 行解析 "bounds":{"x":..,"y":..,"width":..,"height":..}。
    fn parse_bounds(line: &str) -> Option<(i32, i32, i32, i32)> {
        let start = line.find("\"bounds\":")? + "\"bounds\":".len();
        let tail = &line[start..];
        let end = tail.find('}')?;
        let body = &tail[..end];
        let mut fields = body.split(',');
        let value_of = |piece: &str| -> Option<i32> {
            let (_, raw) = piece.split_once(':')?;
            raw.trim().trim_matches('"').parse::<i32>().ok()
        };
        Some((
            value_of(fields.next()?)?,
            value_of(fields.next()?)?,
            value_of(fields.next()?)?,
            value_of(fields.next()?)?,
        ))
    }

    // ---- 资源基线 ----

    unsafe fn memory_kb(pid: u32) -> Option<(u64, u64)> {
        let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut counters: PROCESS_MEMORY_COUNTERS_EX = std::mem::zeroed();
        counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
        let ok = GetProcessMemoryInfo(handle, &mut counters as *mut _ as *mut _, counters.cb) != 0;
        let result = (ok).then(|| ((counters.WorkingSetSize / 1024) as u64, (counters.PrivateUsage / 1024) as u64));
        windows_sys::Win32::Foundation::CloseHandle(handle);
        result
    }

    unsafe fn thread_count(pid: u32) -> u32 {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snapshot == -1isize as HWND || snapshot.is_null() {
            return 0;
        }
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        let mut count = 0u32;
        if Thread32First(snapshot, &mut entry) != 0 {
            loop {
                if entry.th32OwnerProcessID == pid {
                    count += 1;
                }
                if Thread32Next(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        windows_sys::Win32::Foundation::CloseHandle(snapshot);
        count
    }

    unsafe fn cpu_percent(pid: u32, sample: Duration) -> Option<f64> {
        let handle = OpenProcess(PROCESS_QUERY_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let times = |handle: HWND| -> Option<(u64, u64)> {
            let mut creation = 0u64; let mut exit = 0u64; let mut kernel = 0u64; let mut user = 0u64;
            if GetProcessTimes(
                handle,
                &mut creation as *mut u64 as *mut _,
                &mut exit as *mut u64 as *mut _,
                &mut kernel as *mut u64 as *mut _,
                &mut user as *mut u64 as *mut _,
            ) == 0
            {
                return None;
            }
            Some((kernel, user))
        };
        let first = times(handle)?;
        let started = Instant::now();
        thread::sleep(sample);
        let second = times(handle)?;
        let wall = started.elapsed().as_nanos() as u64;
        let delta = (second.0.wrapping_sub(first.0)) + second.1.wrapping_sub(first.1);
        windows_sys::Win32::Foundation::CloseHandle(handle);
        if wall == 0 {
            return None;
        }
        Some(delta as f64 / wall as f64 * 100.0)
    }

    // 桥接协议自请求：返回 (状态码, 响应头, 响应体)。
    fn bridge_request(port: u16, request: &str) -> Option<(u16, String, String)> {
        use std::io::{Read as _, Write as _};
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).ok()?;
        let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
        let _ = stream.write_all(request.as_bytes());
        let mut raw = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    raw.extend_from_slice(&chunk[..n]);
                    if raw.windows(4).any(|window| window == b"\r\n\r\n") {
                        let head_end = raw.windows(4).position(|window| window == b"\r\n\r\n")? + 4;
                        let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
                        let length: Option<usize> = head.lines().find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse().ok())?
                        });
                        if let Some(length) = length {
                            if raw.len() >= head_end + length {
                                break;
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
        let split = raw.windows(4).position(|window| window == b"\r\n\r\n")?;
        let head = String::from_utf8_lossy(&raw[..split]).to_string();
        let body = String::from_utf8_lossy(&raw[split + 4..]).to_string();
        let status: u16 = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        Some((status, head, body))
    }

    fn count_clicks(path: &PathBuf) -> usize {
        std::fs::read_to_string(path)
            .map(|content| content.lines().filter(|line| line.starts_with("click ")).count())
            .unwrap_or(0)
    }

    pub fn run(pet: WebviewWindow, out_dir: PathBuf, spike: Arc<Spike>) {
        thread::spawn(move || {
            let passed = probe_body(&pet, &out_dir, &spike);
            pet.app_handle().exit(if passed { 0 } else { 1 });
        });
    }

    fn probe_body(pet: &WebviewWindow, out_dir: &PathBuf, spike: &Arc<Spike>) -> bool {
        let _ = std::fs::create_dir_all(out_dir);
        let mut report = Reporter::new();
        let mut passed = true;
        let backdrop_log = out_dir.join("backdrop-clicks.log");
        let host_log = out_dir.join("host-clicks.log");
        let _ = std::fs::remove_file(&backdrop_log);
        let _ = std::fs::remove_file(&host_log);
        let mut backdrop_child: Option<std::process::Child> = None;
        let mut host_child: Option<std::process::Child> = None;
        unsafe {
            let pet_hwnd = match pet.hwnd() {
                Ok(handle) => handle.0,
                Err(error) => {
                    report.kv("error", format!("hwnd: {error}"));
                    let _ = std::fs::write(out_dir.join("report.txt"), report.finish());
                    return false;
                }
            };
            let scale = GetDpiForWindow(pet_hwnd) as f64 / 96.0;
            let pet_pid = std::process::id();

            // ---- 环境与独立进程摆位 ----
            report.section("环境与独立进程");
            report.kv("scale", scale);
            report.kv("monitors", monitor_count());
            report.kv("mixed_dpi", "deferred(单屏，混合 DPI 留待多屏环境)");
            report.kv("pet_hwnd", pet_hwnd as isize);
            report.kv("pet_pid", pet_pid);
            backdrop_child = super::spawn_external("backdrop", super::BACKDROP_TITLE, &backdrop_log, "28445A").ok();
            host_child = super::spawn_external("host", super::HOST_TITLE, &host_log, "1F2630").ok();
            if backdrop_child.is_none() || host_child.is_none() {
                report.kv("external_spawn", false);
                let _ = std::fs::write(out_dir.join("report.txt"), report.finish());
                return false;
            }
            let Some((backdrop_hwnd, backdrop_pid)) = super::find_external(super::BACKDROP_TITLE) else {
                report.kv("external_backdrop_found", false);
                let _ = std::fs::write(out_dir.join("report.txt"), report.finish());
                return false;
            };
            let Some((mut host_hwnd, mut host_pid)) = super::find_external(super::HOST_TITLE) else {
                report.kv("external_host_found", false);
                let _ = std::fs::write(out_dir.join("report.txt"), report.finish());
                return false;
            };
            thread::sleep(Duration::from_millis(400));
            let mut pet_rect0 = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut pet_rect0);
            // 底板垫在桌宠后面，宿主放右侧；都是独立进程窗口。
            SetWindowPos(backdrop_hwnd, std::ptr::null_mut(), pet_rect0.left - 15, pet_rect0.top - 15, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            SetWindowPos(host_hwnd, std::ptr::null_mut(), pet_rect0.right + 80, pet_rect0.top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            let _ = pet.show();
            let _ = pet.set_always_on_top(false);
            let _ = pet.set_always_on_top(true);
            thread::sleep(Duration::from_millis(700));
            report.kv("backdrop_hwnd", backdrop_hwnd as isize);
            report.kv("backdrop_pid", backdrop_pid);
            report.kv("host_hwnd", host_hwnd as isize);
            report.kv("host_pid", host_pid);
            let cross_pid = backdrop_pid != pet_pid && host_pid != pet_pid && backdrop_pid != host_pid;
            report.kv("cross_process_windows", cross_pid);
            passed &= cross_pid;

            let zone_point = |base: &RECT, logical: (f64, f64)| POINT {
                x: base.left + (logical.0 * scale).round() as i32,
                y: base.top + (logical.1 * scale).round() as i32,
            };
            let blank_logical = (WIN_W / 2.0, (BUBBLE_BOTTOM + ART_TOP) / 2.0);
            let art_logical = (WIN_W / 2.0, (ART_TOP + ART_BOTTOM) / 2.0);

            // ---- 资源基线（静置：跟随引擎未开）----
            report.section("资源基线 · 静置");
            let mem_idle = memory_kb(pet_pid);
            report.kv("mem_idle_ws_kb", mem_idle.map(|m| m.0).unwrap_or(0));
            report.kv("mem_idle_private_kb", mem_idle.map(|m| m.1).unwrap_or(0));
            report.kv("threads_idle", thread_count(pet_pid));
            let cpu_idle = cpu_percent(pet_pid, Duration::from_millis(1500));
            report.kv("cpu_idle_percent", cpu_idle.map(|v| format!("{v:.1}")).unwrap_or_default());

            // ---- 批次 A：分区命中（轮询驱动动态穿透，真实移动光标）----
            report.section("A 分区命中（轮询驱动动态穿透）");
            let mut blank_pass = false;
            let mut bubble_pass = false;
            let mut art_pass = false;
            for (name, logical) in [
                ("bubble", (WIN_W / 2.0, (BUBBLE_TOP + BUBBLE_BOTTOM) / 2.0)),
                ("blank", blank_logical),
                ("art", art_logical),
            ] {
                let point = zone_point(&pet_rect0, logical);
                SetCursorPos(point.x, point.y);
                thread::sleep(Duration::from_millis(200));
                let (kind, class) = classify(point, pet_hwnd, backdrop_hwnd);
                report.kv(&format!("zone_{name}"), format!("{kind} (class={class})"));
                match name {
                    "blank" => blank_pass = kind == "backdrop",
                    "bubble" => bubble_pass = kind == "pet",
                    _ => art_pass = kind == "pet",
                }
            }
            report.kv("zoned_hit_pass", blank_pass && bubble_pass && art_pass);
            passed &= blank_pass && bubble_pass && art_pass;

            // ---- 批次 B：拖动捕获 + 真实点击送达 ----
            report.section("B 拖动捕获与点击送达");
            // 气泡按钮：计数按钮真实点击 → JS → Rust 命令递增计数。
            let ping_before = super::PING_COUNT.load(Ordering::Relaxed);
            click_at(zone_point(&pet_rect0, PING_CENTER));
            let mut ping_after = ping_before;
            for _ in 0..10 {
                thread::sleep(Duration::from_millis(100));
                ping_after = super::PING_COUNT.load(Ordering::Relaxed);
                if ping_after > ping_before {
                    break;
                }
            }
            report.kv("bubble_ping_delivered", ping_after > ping_before);
            passed &= ping_after > ping_before;
            // 配置实验：真实点击 → IPC → Rust 写隔离配置目录；再直接读磁盘验证。
            click_at(zone_point(&pet_rect0, CONFIG_CENTER));
            let mut cfg_ok = false;
            for _ in 0..10 {
                thread::sleep(Duration::from_millis(100));
                if super::config_file().exists() {
                    if let Ok(bytes) = std::fs::read(super::config_file()) {
                        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                            let phase_ok = value["spikePhase"] == serde_json::json!(1);
                            let tint_ok = value["bubbleTint"] == serde_json::json!("#aabbcc");
                            let nested_ok = value["nested"]["opacity"] == serde_json::json!(88)
                                && value["nested"]["tags"][1] == serde_json::json!("b");
                            if phase_ok && tint_ok && nested_ok {
                                cfg_ok = true;
                            }
                        }
                    }
                    if cfg_ok {
                        break;
                    }
                }
            }
            let cfg_dir_text = super::config_dir().display().to_string();
            let isolated = cfg_dir_text.contains("catstella-window-spike-config")
                && !cfg_dir_text.contains("antigravity-cat-widget");
            report.kv("cfg_roundtrip_delivered", cfg_ok);
            report.kv("cfg_dir_isolated", isolated);
            report.kv("cfg_dir", cfg_dir_text);
            passed &= cfg_ok && isolated;

            // ---- 批次 I：联动协议门槛（Rust 侧 /companion/* 最小服务，备用端口）----
            report.section("I 联动协议（Rust 侧 /companion/*）");
            let port = super::bridge_port();
            report.kv("bridge_port", port);
            // 生产实例占 3921，spike 服务必须落在备用端口。
            report.kv("bridge_port_is_backup", port == 3922 || port == 3923);
            passed &= port == 3922 || port == 3923;
            let mut bridge_ok = true;
            // GET state
            let request = format!("GET /companion/state HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
            if let Some((status, head, body)) = bridge_request(port, &request) {
                let ok = status == 200
                    && body.contains("\"ok\":true")
                    && body.contains(&format!("\"port\":{port}"))
                    && body.contains("\"kind\":\"tauri-spike\"")
                    && head.to_ascii_lowercase().contains("access-control-allow-origin: *");
                let detail = format!("fail status={status} body={body}");
                report.kv("state_endpoint", if ok { "pass".to_string() } else { detail });
                bridge_ok &= ok;
            } else {
                report.kv("state_endpoint", "no-response");
                bridge_ok = false;
            }
            // GET wallpapers
            let request = format!("GET /companion/wallpapers HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
            if let Some((status, _, body)) = bridge_request(port, &request) {
                let ok = status == 200 && body.contains("spike-gemini-star-v1") && body.contains("\"revision\":\"spike\"");
                let detail = format!("fail status={status} body={body}");
                report.kv("wallpapers_endpoint", if ok { "pass".to_string() } else { detail });
                bridge_ok &= ok;
            } else {
                report.kv("wallpapers_endpoint", "no-response");
                bridge_ok = false;
            }
            // POST sync：缺客户端头 → 403
            let request = format!("POST /companion/sync HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}");
            if let Some((status, _, body)) = bridge_request(port, &request) {
                let ok = status == 403 && body.contains("missing_client_header");
                let detail = format!("fail status={status} body={body}");
                report.kv("sync_without_header", if ok { "pass(403)".to_string() } else { detail });
                bridge_ok &= ok;
            } else {
                report.kv("sync_without_header", "no-response");
                bridge_ok = false;
            }
            // POST sync：带客户端头 → 200
            let request = format!(
                "POST /companion/sync HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Catstella-Client: gemini-web-companion\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
            );
            if let Some((status, _, body)) = bridge_request(port, &request) {
                let ok = status == 200 && body.contains("\"accepted\":true");
                let detail = format!("fail status={status} body={body}");
                report.kv("sync_with_header", if ok { "pass".to_string() } else { detail });
                bridge_ok &= ok;
            } else {
                report.kv("sync_with_header", "no-response");
                bridge_ok = false;
            }
            // Origin 校验：外部站点拒绝
            let request = format!(
                "GET /companion/state HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://evil.example\r\nConnection: close\r\n\r\n"
            );
            if let Some((status, _, body)) = bridge_request(port, &request) {
                let ok = status == 403 && body.contains("Forbidden origin");
                let detail = format!("fail status={status} body={body}");
                report.kv("origin_rejected", if ok { "pass(403)".to_string() } else { detail });
                bridge_ok &= ok;
            } else {
                report.kv("origin_rejected", "no-response");
                bridge_ok = false;
            }
            // Origin 校验：扩展协议放行 + CORS 回显
            let request = format!(
                "GET /companion/state HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: chrome-extension://abcdef\r\nConnection: close\r\n\r\n"
            );
            if let Some((status, head, _)) = bridge_request(port, &request) {
                let ok = status == 200
                    && head.to_ascii_lowercase().contains("access-control-allow-origin: chrome-extension://abcdef");
                let detail = format!("fail status={status}");
                report.kv("origin_extension_allowed", if ok { "pass".to_string() } else { detail });
                bridge_ok &= ok;
            } else {
                report.kv("origin_extension_allowed", "no-response");
                bridge_ok = false;
            }
            report.kv("bridge_protocol_pass", bridge_ok);
            passed &= bridge_ok;
            // 空隙真实点击 → 穿透送达独立进程底板（点击日志计数）。
            let backdrop_clicks_before = count_clicks(&backdrop_log);
            click_at(zone_point(&pet_rect0, blank_logical));
            let mut blank_delivered = false;
            for _ in 0..8 {
                thread::sleep(Duration::from_millis(120));
                if count_clicks(&backdrop_log) > backdrop_clicks_before {
                    blank_delivered = true;
                    break;
                }
            }
            report.kv("blank_click_delivered_to_backdrop", blank_delivered);
            passed &= blank_delivered;
            // 拖动捕获：立绘按下 → 原生拖动 → 跨出窗口后折返。
            let art_point = zone_point(&pet_rect0, art_logical);
            SetCursorPos(art_point.x, art_point.y);
            thread::sleep(Duration::from_millis(250));
            let mut before = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut before);
            SAMPLER_PET.store(pet_hwnd as isize, Ordering::Relaxed);
            SAMPLER_DONE.store(false, Ordering::Relaxed);
            let samples: Arc<Mutex<Vec<(i32, i32)>>> = Arc::new(Mutex::new(Vec::new()));
            let sampler_samples = samples.clone();
            let sampler = thread::spawn(move || loop {
                thread::sleep(Duration::from_millis(30));
                let hwnd = SAMPLER_PET.load(Ordering::Relaxed) as HWND;
                let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                unsafe { GetWindowRect(hwnd, &mut rect) };
                sampler_samples.lock().unwrap().push((rect.left, rect.top));
                if SAMPLER_DONE.load(Ordering::Relaxed) {
                    break;
                }
            });
            let _ = send_mouse(MOUSEEVENTF_LEFTDOWN, 0, 0);
            thread::sleep(Duration::from_millis(150));
            for _ in 0..4 {
                send_mouse(MOUSEEVENTF_MOVE, 30, 18);
                thread::sleep(Duration::from_millis(45));
            }
            let mut mid = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut mid);
            for _ in 0..4 {
                send_mouse(MOUSEEVENTF_MOVE, -30, -18);
                thread::sleep(Duration::from_millis(45));
            }
            thread::sleep(Duration::from_millis(150));
            let _ = send_mouse(MOUSEEVENTF_LEFTUP, 0, 0);
            thread::sleep(Duration::from_millis(120));
            SAMPLER_DONE.store(true, Ordering::Relaxed);
            let _ = sampler.join();
            let mut after = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut after);
            let track = samples.lock().unwrap().clone();
            let moved_out = ((mid.left - before.left).abs(), (mid.top - before.top).abs());
            let net = ((after.left - before.left).abs(), (after.top - before.top).abs());
            let distinct = track.iter().collect::<std::collections::BTreeSet<_>>().len();
            let drag_ok = moved_out.0 > 60 && moved_out.1 > 30 && distinct > 3 && net.0 <= 60 && net.1 <= 60;
            report.kv("drag_moved_out", format!("({},{})", moved_out.0, moved_out.1));
            report.kv("drag_net_return", format!("({},{})", net.0, net.1));
            report.kv("capture_distinct_positions", distinct);
            report.kv("capture_kept", drag_ok);
            passed &= drag_ok;
            thread::sleep(Duration::from_millis(300));

            // ---- 批次 F：真实 ForegroundHost 辅助进程（参数化副本）----
            report.section("F ForegroundHost 辅助进程绑定独立宿主");
            let pet_class_name = window_class(pet_hwnd);
            let host_class_name = window_class(host_hwnd);
            report.kv("pet_top_level_class", &pet_class_name);
            report.kv("host_top_level_class", &host_class_name);
            let helper_path = std::env::current_exe().ok().and_then(|exe| {
                let dir = exe.parent()?;
                let mut candidates = vec![dir.join("host-check")];
                if let Some(release) = dir.parent() {
                    if let Some(root) = release.parent() {
                        candidates.push(root.join("host-check"));
                    }
                }
                candidates.into_iter().map(|dir| dir.join("ForegroundHostSpike.exe")).find(|path| path.exists())
            });
            match helper_path.filter(|path| path.exists()) {
                Some(helper_path) => {
                    use std::io::BufRead;
                    use std::process::Stdio;
                    let spawn_result = std::process::Command::new(&helper_path)
                        .arg(std::process::id().to_string())
                        .arg((pet_hwnd as isize).to_string())
                        .env("SPIKE_HOST_PROCESS", "spike-external")
                        .env("SPIKE_HOST_CLASS", &host_class_name)
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::null())
                        .spawn();
                    match spawn_result {
                        Ok(mut spawned) => {
                            let reader = spawned.stdout.take().expect("helper stdout");
                            let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
                            let sink = lines.clone();
                            let reader_thread = std::thread::spawn(move || {
                                let mut buffered = std::io::BufReader::new(reader);
                                let mut line = String::new();
                                while let Ok(n) = buffered.read_line(&mut line) {
                                    if n == 0 { break; }
                                    let trimmed = line.trim().to_string();
                                    if !trimmed.is_empty() {
                                        sink.lock().unwrap().push(trimmed);
                                    }
                                    line.clear();
                                }
                            });
                            // 宿主是独立进程窗口：点击激活它，等辅助进程心跳两拍。
                            activate_by_click(host_hwnd);
                            thread::sleep(Duration::from_millis(2500));
                            let snapshot = lines.lock().unwrap().clone();
                            report.kv("helper_lines", snapshot.len());
                            let kind_marker = concat!("\"kind\":\"host\"");
                            let attached_marker = concat!("\"attached\":true");
                            let host_json = snapshot.iter().rev().find(|l| l.contains(kind_marker));
                            match host_json {
                                Some(line) => {
                                    report.kv("helper_kind", "host");
                                    let attached = line.contains(attached_marker);
                                    report.kv("helper_attached", attached);
                                    let mut client_origin = POINT { x: 0, y: 0 };
                                    ClientToScreenSpike(host_hwnd, &mut client_origin);
                                    let mut client_size = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                                    GetClientRect(host_hwnd, &mut client_size);
                                    let expected = (
                                        client_origin.x,
                                        client_origin.y,
                                        client_size.right - client_size.left,
                                        client_size.bottom - client_size.top,
                                    );
                                    let reported = parse_bounds(line);
                                    report.kv("helper_bounds_expected", format!("{:?}", expected));
                                    report.kv("helper_bounds_reported", format!("{:?}", reported));
                                    let bounds_match = match reported {
                                        Some(value) => {
                                            value.0.abs_diff(expected.0) <= 3
                                                && value.1.abs_diff(expected.1) <= 3
                                                && value.2.abs_diff(expected.2) <= 3
                                                && value.3.abs_diff(expected.3) <= 3
                                        }
                                        None => false,
                                    };
                                    report.kv("helper_bounds_match", bounds_match);
                                    let mut helper_pass = attached && bounds_match;
                                    // 宿主移动 → 辅助进程自带 followHost 应平移桌宠。
                                    let mut pet_before_helper = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                                    GetWindowRect(pet_hwnd, &mut pet_before_helper);
                                    let mut host_before_helper = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                                    GetWindowRect(host_hwnd, &mut host_before_helper);
                                    SetWindowPos(host_hwnd, std::ptr::null_mut(), -200, 120, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                                    thread::sleep(Duration::from_millis(900));
                                    let mut pet_after_helper = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                                    GetWindowRect(pet_hwnd, &mut pet_after_helper);
                                    let helper_delta = (
                                        pet_after_helper.left - pet_before_helper.left,
                                        pet_after_helper.top - pet_before_helper.top,
                                    );
                                    let host_moved = (-200 - host_before_helper.left, 120 - host_before_helper.top);
                                    report.kv("helper_host_moved", format!("({},{})", host_moved.0, host_moved.1));
                                    report.kv("helper_follow_delta", format!("({},{})", helper_delta.0, helper_delta.1));
                                    let helper_follow_ok = helper_delta.0.abs() >= 20 && helper_delta.1.abs() >= 10;
                                    report.kv("helper_follow_pass", helper_follow_ok);
                                    helper_pass &= helper_follow_ok;
                                    passed &= helper_pass;
                                    SetWindowPos(host_hwnd, std::ptr::null_mut(), pet_rect0.right + 80, pet_rect0.top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                                    drop(spawned.stdin.take());
                                    let _ = spawned.wait();
                                    let _ = spawned.kill();
                                    let _ = reader_thread.join();
                                }
                                None => {
                                    report.kv("helper_kind", "not-found");
                                    if let Some(last) = snapshot.last() {
                                        report.kv("sample_line", last.clone());
                                    }
                                    passed = false;
                                    drop(spawned.stdin.take());
                                    let _ = spawned.kill();
                                    let _ = reader_thread.join();
                                }
                            }
                        }
                        Err(error) => {
                            report.kv("helper_spawn_error", error.to_string());
                            passed = false;
                        }
                    }
                }
                None => {
                    report.kv("helper_present", false);
                    passed = false;
                }
            }
            // 宿主在 F 里被移过，恢复摆位。
            SetWindowPos(host_hwnd, std::ptr::null_mut(), pet_rect0.right + 80, pet_rect0.top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);

            // ---- 批次 C：跟随引擎 + 30 轮循环 ----
            report.section("C 跟随引擎与 30 轮循环");
            super::start_follow_engine(
                host_hwnd as isize,
                pet_hwnd as isize,
                spike.replace_follow_stop(),
            );
            thread::sleep(Duration::from_millis(500));

            // 空闲防刷：宿主持续前台 2.5s，manage_z 不得重复调用 SetWindowPos。
            activate_by_click(host_hwnd);
            thread::sleep(Duration::from_millis(400));
            let z_before = super::Z_CALLS.load(Ordering::Relaxed);
            thread::sleep(Duration::from_millis(2500));
            let z_after = super::Z_CALLS.load(Ordering::Relaxed);
            report.kv("z_setwindowpos_calls_idle", z_after - z_before);
            passed &= z_after == z_before;

            // 负坐标平移：宿主移到屏幕外负坐标区，桌宠平移量须一致。
            let mut host_before_neg = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(host_hwnd, &mut host_before_neg);
            let mut pet_before_neg = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut pet_before_neg);
            SetWindowPos(host_hwnd, std::ptr::null_mut(), -220, host_before_neg.top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            thread::sleep(Duration::from_millis(700));
            let mut pet_after_neg = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut pet_after_neg);
            let neg_delta = (pet_after_neg.left - pet_before_neg.left, pet_after_neg.top - pet_before_neg.top);
            let neg_host = (-220 - host_before_neg.left, 0);
            report.kv("negative_host_delta", format!("({},{})", neg_host.0, neg_host.1));
            report.kv("negative_pet_delta", format!("({},{})", neg_delta.0, neg_delta.1));
            let neg_ok = (neg_delta.0 - neg_host.0).abs() <= 2 && neg_delta.1.abs() <= 2;
            report.kv("negative_translation_pass", neg_ok);
            passed &= neg_ok;
            SetWindowPos(host_hwnd, std::ptr::null_mut(), pet_rect0.right + 80, pet_rect0.top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            thread::sleep(Duration::from_millis(400));

            // 30 轮：ping 点击 / 拖动折返 / 空隙点击送达底板 / 前台切换 z 序；第 10/11/12 轮注入异常场景。
            let mut cycles_ok = 0usize;
            let mut cycle_failures: Vec<String> = Vec::new();
            let threads_before_cycles = thread_count(pet_pid);
            let mem_before_cycles = memory_kb(pet_pid);
            for cycle in 1..=30u32 {
                let mut fails: Vec<String> = Vec::new();
                // 每轮把桌宠归位到锚点，底板垫回，保证坐标确定性。
                SetWindowPos(pet_hwnd, std::ptr::null_mut(), pet_rect0.left, pet_rect0.top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                SetWindowPos(backdrop_hwnd, std::ptr::null_mut(), pet_rect0.left - 15, pet_rect0.top - 15, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                thread::sleep(Duration::from_millis(120));
                if windows_sys::Win32::UI::WindowsAndMessaging::IsWindow(pet_hwnd) == 0 {
                    fails.push("pet-window-lost".into());
                    cycle_failures.push(format!("cycle{cycle}: {}", fails.join(",")));
                    break;
                }

                // 异常场景注入：10=宿主进程关闭；11=宿主重建句柄；12=无效句柄。
                match cycle {
                    10 => {
                        if let Some(child) = host_child.as_mut() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                        thread::sleep(Duration::from_millis(400));
                        report.kv("cycle10_host_killed", true);
                    }
                    11 => {
                        let _ = std::fs::remove_file(&host_log);
                        host_child = super::spawn_external("host", super::HOST_TITLE, &host_log, "1F2630").ok();
                        match super::find_external(super::HOST_TITLE) {
                            Some((new_hwnd, new_pid)) if new_hwnd != host_hwnd => {
                                host_hwnd = new_hwnd;
                                host_pid = new_pid;
                                super::stop_follow().ok();
                                thread::sleep(Duration::from_millis(250));
                                super::start_follow_engine(host_hwnd as isize, pet_hwnd as isize, spike.replace_follow_stop());
                                thread::sleep(Duration::from_millis(500));
                                report.kv("cycle11_host_rebuilt", format!("hwnd={} pid={host_pid}", new_hwnd as isize));
                            }
                            _ => {
                                fails.push("host-rebuild-failed".into());
                            }
                        }
                    }
                    12 => {
                        super::FOLLOW_HOST.store(0xdead_beef_isize, Ordering::Relaxed);
                        thread::sleep(Duration::from_millis(400));
                        let alive = windows_sys::Win32::UI::WindowsAndMessaging::IsWindow(pet_hwnd) != 0
                            && windows_sys::Win32::UI::WindowsAndMessaging::IsWindow(host_hwnd) != 0;
                        super::FOLLOW_HOST.store(host_hwnd as isize, Ordering::Relaxed);
                        thread::sleep(Duration::from_millis(300));
                        report.kv("cycle12_invalid_handle_survived", alive);
                        if !alive {
                            fails.push("invalid-handle-crash".into());
                        }
                    }
                    _ => {}
                }

                // 0) 点击宿主恢复前台（宿主不与桌宠重叠，点击必然生效）→ 桌宠应置顶。
                //    cycle 10 宿主已被杀：桌宠按生产语义沉底被盖住，交互断言全部预期退化，只验证存活。
                let degraded = cycle == 10;
                if !degraded {
                    if !activate_by_click(host_hwnd) {
                        fails.push("host-click-activation".into());
                    }
                    let mut host_top_ok = false;
                    for _ in 0..12 {
                        thread::sleep(Duration::from_millis(100));
                        if (GetWindowLongPtrW(pet_hwnd, GWL_EXSTYLE) & (WS_EX_TOPMOST as isize)) != 0 {
                            host_top_ok = true;
                            break;
                        }
                    }
                    if !host_top_ok {
                        fails.push("z-not-topmost-over-host".into());
                    }
                }

                // 1) 气泡按钮真实点击送达。
                let ping_before = super::PING_COUNT.load(Ordering::Relaxed);
                let mut live = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                GetWindowRect(pet_hwnd, &mut live);
                click_at(zone_point(&live, PING_CENTER));
                let mut ping_ok = false;
                for _ in 0..10 {
                    thread::sleep(Duration::from_millis(100));
                    if super::PING_COUNT.load(Ordering::Relaxed) > ping_before {
                        ping_ok = true;
                        break;
                    }
                }
                if !ping_ok && !degraded {
                    fails.push("ping-not-delivered".into());
                }

                // 2) 拖动跨区折返（捕获不丢，窗口回归锚点）。
                let art_point = zone_point(&live, art_logical);
                SetCursorPos(art_point.x, art_point.y);
                thread::sleep(Duration::from_millis(220));
                let mut drag_before = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                GetWindowRect(pet_hwnd, &mut drag_before);
                let _ = send_mouse(MOUSEEVENTF_LEFTDOWN, 0, 0);
                thread::sleep(Duration::from_millis(130));
                for _ in 0..4 {
                    send_mouse(MOUSEEVENTF_MOVE, 30, 18);
                    thread::sleep(Duration::from_millis(40));
                }
                let mut drag_mid = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                GetWindowRect(pet_hwnd, &mut drag_mid);
                for _ in 0..4 {
                    send_mouse(MOUSEEVENTF_MOVE, -30, -18);
                    thread::sleep(Duration::from_millis(40));
                }
                thread::sleep(Duration::from_millis(140));
                let _ = send_mouse(MOUSEEVENTF_LEFTUP, 0, 0);
                thread::sleep(Duration::from_millis(140));
                let mut drag_after = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                GetWindowRect(pet_hwnd, &mut drag_after);
                let moved_out = ((drag_mid.left - drag_before.left).abs(), (drag_mid.top - drag_before.top).abs());
                let net = ((drag_after.left - drag_before.left).abs(), (drag_after.top - drag_before.top).abs());
                if !degraded && (moved_out.0 <= 60 || moved_out.1 <= 30 || net.0 > 60 || net.1 > 60) {
                    fails.push(format!("drag out=({},{}) net=({},{})", moved_out.0, moved_out.1, net.0, net.1));
                }

                // 3) 空隙真实点击穿透送达独立底板（松手后穿透恢复证据）。
                let backdrop_before = count_clicks(&backdrop_log);
                let mut live2 = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                GetWindowRect(pet_hwnd, &mut live2);
                click_at(zone_point(&live2, blank_logical));
                let mut blank_ok = false;
                for _ in 0..8 {
                    thread::sleep(Duration::from_millis(120));
                    if count_clicks(&backdrop_log) > backdrop_before {
                        blank_ok = true;
                        break;
                    }
                }
                if !blank_ok && !degraded {
                    fails.push("blank-click-not-delivered".into());
                }

                // 4) 空隙点击已让底板成为前台 → 桌宠应退普通层级并被前台窗口遮挡。
                //    「在 fg 之下」= 沿 z 链向下数步内可见；IME/MSCTFIME 等系统窗口
                //    会紧跟激活窗口插入，不必紧贴，与生产 ForegroundHost 的目标一致。
                if cycle != 10 {
                    let mut below_ok = false;
                    for _ in 0..12 {
                        thread::sleep(Duration::from_millis(100));
                        if (GetWindowLongPtrW(pet_hwnd, GWL_EXSTYLE) & (WS_EX_TOPMOST as isize)) == 0 {
                            let mut walker = backdrop_hwnd;
                            for _ in 0..8 {
                                walker = GetWindow(walker, GW_HWNDNEXT);
                                if walker.is_null() {
                                    break;
                                }
                                if walker == pet_hwnd {
                                    below_ok = true;
                                    break;
                                }
                            }
                        }
                        if below_ok {
                            break;
                        }
                    }
                    if !below_ok {
                        // 诊断：记录当前前台窗口与桌宠层级，定位 manage_z 是否生效。
                        let fg = GetForegroundWindow();
                        let fg_desc = if fg.is_null() {
                            "none".to_string()
                        } else {
                            let mut fg_pid = 0u32;
                            windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(fg, &mut fg_pid);
                            format!("{} pid={fg_pid} root={}", window_class(fg), windows_sys::Win32::UI::WindowsAndMessaging::GetAncestor(fg, GA_ROOT) as isize)
                        };
                        let pet_top = (GetWindowLongPtrW(pet_hwnd, GWL_EXSTYLE) & (WS_EX_TOPMOST as isize)) != 0;
                        fails.push(format!(
                            "z-sink fg=[{fg_desc}] pet_topmost={pet_top} zcalls={}",
                            super::Z_CALLS.load(Ordering::Relaxed)
                        ));
                    }
                }

                if fails.is_empty() {
                    cycles_ok += 1;
                } else {
                    cycle_failures.push(format!("cycle{cycle}: {}", fails.join(",")));
                }
            }
            report.kv("cycles_passed", format!("{cycles_ok}/30"));
            for failure in cycle_failures.iter().take(6) {
                report.kv("cycle_failure", failure);
            }
            passed &= cycles_ok == 30;

            // ---- 资源基线（跟随中）----
            report.section("资源基线 · 跟随中");
            activate_by_click(host_hwnd);
            thread::sleep(Duration::from_millis(300));
            let cpu_follow = cpu_percent(pet_pid, Duration::from_millis(2000));
            report.kv("cpu_follow_percent", cpu_follow.map(|v| format!("{v:.1}")).unwrap_or_default());
            let mem_follow = memory_kb(pet_pid);
            report.kv("mem_follow_ws_kb", mem_follow.map(|m| m.0).unwrap_or(0));
            report.kv("mem_follow_private_kb", mem_follow.map(|m| m.1).unwrap_or(0));
            if let (Some(before), Some(after)) = (mem_before_cycles, mem_follow) {
                report.kv("mem_ws_delta_cycles_kb", after.0 as i64 - before.0 as i64);
            }
            report.kv("threads_before_cycles", threads_before_cycles);
            report.kv("threads_after_cycles", thread_count(pet_pid));
            spike.current_follow_stop().store(true, Ordering::Relaxed);
            thread::sleep(Duration::from_millis(300));

            // ---- 批次 D：截图与退出清理 ----
            report.section("D 截图与退出清理");
            let mut final_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut final_rect);
            let physical_w = final_rect.right - final_rect.left;
            let physical_h = final_rect.bottom - final_rect.top;
            report.kv("pet_logical", format!("{:.0}x{:.0}", physical_w as f64 / scale, physical_h as f64 / scale));
            report.kv("pet_physical", format!("{physical_w}x{physical_h}"));
            let shot_rect = RECT {
                left: final_rect.left - 60,
                top: final_rect.top - 60,
                right: final_rect.right + 60,
                bottom: final_rect.bottom + 60,
            };
            match capture_bmp(shot_rect, &out_dir.join("pet-region.bmp")) {
                Ok(()) => report.kv("screenshot", "pet-region.bmp"),
                Err(error) => {
                    report.kv("screenshot_error", error);
                    passed = false;
                }
            }
            // 退出清理：先礼貌关闭（WM_CLOSE → 优雅写日志），超时强杀。
            PostMessageW(backdrop_hwnd, WM_CLOSE, 0, 0);
            PostMessageW(host_hwnd, WM_CLOSE, 0, 0);
            let mut cleanup_ok = true;
            for child in [&mut backdrop_child, &mut host_child].into_iter().flatten() {
                let mut exited = false;
                for _ in 0..15 {
                    if let Some(status) = child.try_wait().ok().flatten() {
                        let _ = status;
                        exited = true;
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                if !exited {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            // 进程对象已退出（句柄 wait 成功）即视为清理完成；再确认窗口消失。
            let class_wide: Vec<u16> = super::EXTERNAL_CLASS.encode_utf16().chain(std::iter::once(0)).collect();
            let backdrop_wide: Vec<u16> = super::BACKDROP_TITLE.encode_utf16().chain(std::iter::once(0)).collect();
            if FindWindowW(class_wide.as_ptr(), backdrop_wide.as_ptr()) != std::ptr::null_mut() {
                cleanup_ok = false;
            }
            report.kv("cleanup_pass", cleanup_ok);
            passed &= cleanup_ok;
            SetCursorPos(pet_rect0.left + 20, pet_rect0.bottom + 40);
        }
        report.section("结论");
        report.kv("all_pass", passed);
        let _ = std::fs::write(out_dir.join("report.txt"), report.finish());
        passed
    }

}

#[cfg(windows)]
fn main() {
    let probe_arg = std::env::args().find_map(|arg| arg.strip_prefix("--probe-output=").map(PathBuf::from));
    let verify_arg = std::env::args().find_map(|arg| arg.strip_prefix("--probe-verify-config=").map(PathBuf::from));
    let bridge_only = std::env::args().find_map(|arg| arg.strip_prefix("--bridge-only=").map(PathBuf::from));
    if let Some(log) = bridge_only {
        // 无窗口桥接模式：给浏览器对接实验用；stdin 关闭即优雅退出。
        let _ = BRIDGE_LOG.set(log);
        start_bridge();
        bridge_log(&format!("{} bridge-only start port-wait", now_ms()));
        thread::spawn(|| {
            let mut line = String::new();
            let _ = std::io::stdin().read_line(&mut line);
            bridge_log(&format!("{} bridge-only stop", now_ms()));
            std::process::exit(0);
        });
        loop {
            thread::sleep(Duration::from_millis(500));
            if bridge_port() != 0 {
                break;
            }
        }
        bridge_log(&format!("{} bridge-only listening port={}", now_ms(), bridge_port()));
        loop {
            thread::sleep(Duration::from_millis(500));
        }
    }
    if let Some(out_dir) = &probe_arg {
        let _ = PING_LOG.set(out_dir.join("bubble-pings.log"));
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            drag,
            ignore_temporarily,
            exit_spike,
            bubble_ping,
            cfg_experiment,
            open_host,
            follow_host,
            stop_follow
        ])
        .setup(move |app| {
            let pet = app.get_webview_window("pet").expect("configured pet window");
            let state = Arc::new(Spike {
                pet: pet.clone(),
                dragging: AtomicBool::new(false),
                follow_stop: Mutex::new(Arc::new(AtomicBool::new(false))),
                passthrough: AtomicBool::new(false),
            });
            let _ = SPIKE.set(state.clone());
            start_zone_poller(state.clone());
            start_bridge();
            if let Some(out_dir) = probe_arg {
                probe::run(pet, out_dir, state);
                return Ok(());
            }
            if let Some(out_dir) = verify_arg {
                // 第二阶段：新进程启动后核对第一阶段写入的配置（跨进程持久化验证）。
                let _ = pet;
                std::thread::spawn(move || {
                    let mut report = String::new();
                    let phase = cfg_read("spikePhase");
                    let tint = cfg_read("bubbleTint");
                    let nested = cfg_read("nested");
                    report.push_str(&format!("spikePhase={phase:?}\n"));
                    report.push_str(&format!("bubbleTint={tint:?}\n"));
                    report.push_str(&format!("nested={nested:?}\n"));
                    let pass = phase == Some(serde_json::json!(1))
                        && tint == Some(serde_json::json!("#aabbcc"))
                        && nested == Some(serde_json::json!({"opacity": 88, "tags": ["a", "b"]}));
                    report.push_str(&format!("config_persistence_pass={pass}\n"));
                    let _ = std::fs::create_dir_all(&out_dir);
                    let _ = std::fs::write(out_dir.join("config-verify.txt"), report);
                    std::process::exit(if pass { 0 } else { 1 });
                });
                return Ok(());
            }
            pet.show()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run isolated Tauri window spike");
}

#[cfg(not(windows))]
fn main() {
    panic!("此实验仅面向 Windows：验证 WebView2 的分区命中与宿主跟随。");
}
