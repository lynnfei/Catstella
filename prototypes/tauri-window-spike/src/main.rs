#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Catstella Tauri 迁移门槛实验：分区命中 / 拖动捕获 / 独立测试宿主跟随。
// 只使用独立应用标识与本地静态素材，不连接真实 Antigravity。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicIsize, Ordering};
use std::sync::{Arc, OnceLock};
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
    host: OnceLock<WebviewWindow>,
    dragging: AtomicBool,
    follow_stop: Arc<AtomicBool>,
    passthrough: AtomicBool,
}

static SPIKE: OnceLock<Arc<Spike>> = OnceLock::new();

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

// ---- 独立测试宿主 ----

#[tauri::command]
fn open_host() -> Result<(), String> {
    let state = spike();
    let host = state
        .host
        .get()
        .ok_or_else(|| "test host window missing".to_string())?;
    host.show().map_err(|error| error.to_string())
}

#[tauri::command]
fn follow_host() -> Result<(), String> {
    let spike = spike();
    let host = spike
        .host
        .get()
        .ok_or_else(|| "test host window missing".to_string())?;
    stop_follow()?;
    let host_hwnd = host.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let pet_hwnd = spike.pet.hwnd().map_err(|e| e.to_string())?.0 as isize;
    start_follow_engine(host_hwnd, pet_hwnd, spike.follow_stop.clone());
    Ok(())
}

#[tauri::command]
fn stop_follow() -> Result<(), String> {
    spike().follow_stop.store(true, Ordering::Relaxed);
    Ok(())
}

static FOLLOW_HOST: AtomicIsize = AtomicIsize::new(0);
static FOLLOW_PET: AtomicIsize = AtomicIsize::new(0);
static FOLLOW_LAST: AtomicI64 = AtomicI64::new(i64::MAX);
static FOLLOW_ACTIVE: AtomicBool = AtomicBool::new(false);

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
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER};
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
static Z_CALLS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

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
        if !pet_topmost && GetWindow(foreground, GW_HWNDNEXT) == pet {
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
    use super::{zone_at, Spike, ART_BOTTOM, ART_TOP, BUBBLE_BOTTOM, BUBBLE_TOP, WIN_W};
    use tauri::{Manager, WebviewWindow};
    use std::fmt::Write as _;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        ReleaseDC, SelectObject, BITMAPFILEHEADER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
        DIB_RGB_COLORS, SRCCOPY,
    };
    use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE,
        MOUSEINPUT,
    };
    use windows_sys::Win32::Graphics::Gdi::EnumDisplayMonitors;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindow,
        GetWindowLongPtrW, GetWindowRect, SetCursorPos, SetForegroundWindow, SetWindowPos, WindowFromPoint,
        GA_ROOT, GW_HWNDNEXT, GWL_EXSTYLE, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
        WS_EX_TOPMOST,
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
            return Err(format!("invalid capture rect l={} t={} r={} b={}", rect.left, rect.top, rect.right, rect.bottom));
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
        let row = (width * 4) as u32;
        let file_header = BITMAPFILEHEADER {
            bfType: 0x4d42,
            bfSize: std::mem::size_of::<BITMAPFILEHEADER>() as u32
                + std::mem::size_of::<BITMAPINFOHEADER>() as u32
                + row * height as u32,
            bfReserved1: 0,
            bfReserved2: 0,
            bfOffBits: std::mem::size_of::<BITMAPFILEHEADER>() as u32 + std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        };
        let mut bytes = Vec::with_capacity(bytes_header_len() + pixels.len());
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

    fn bytes_header_len() -> usize {
        std::mem::size_of::<BITMAPFILEHEADER>() + std::mem::size_of::<BITMAPINFOHEADER>()
    }

    unsafe fn ClientToScreenSpike(window: HWND, point: &mut POINT) -> i32 {
        windows_sys::Win32::Graphics::Gdi::ClientToScreen(window, point)
    }

    unsafe fn GetClientRectSpike(window: HWND, rect: &mut RECT) -> i32 {
        windows_sys::Win32::UI::WindowsAndMessaging::GetClientRect(window, rect)
    }

    // 前台锁允许真实输入路径：点击目标窗口来切换前台（SetForegroundWindow 会被间歇拒绝）。
    unsafe fn activate_by_click(hwnd: HWND) -> bool {
        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return false;
        }
        let cx = (rect.left + rect.right) / 2;
        let cy = (rect.top + rect.bottom) / 2;
        SetCursorPos(cx, cy);
        thread::sleep(Duration::from_millis(120));
        send_mouse(MOUSEEVENTF_LEFTDOWN, 0, 0);
        thread::sleep(Duration::from_millis(60));
        send_mouse(MOUSEEVENTF_LEFTUP, 0, 0);
        thread::sleep(Duration::from_millis(300));
        GetForegroundWindow() == hwnd
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

    pub fn run(pet: WebviewWindow, backdrop: WebviewWindow, host: WebviewWindow, out_dir: PathBuf, spike: Arc<Spike>) {
        thread::spawn(move || {
            let passed = probe_body(&pet, &backdrop, &host, &out_dir, &spike);
            pet.app_handle().exit(if passed { 0 } else { 1 });
        });
    }

    fn probe_body(
        pet: &WebviewWindow,
        backdrop: &WebviewWindow,
        host: &WebviewWindow,
        out_dir: &PathBuf,
        spike: &Arc<Spike>,
    ) -> bool {
        let _ = std::fs::create_dir_all(out_dir);
        let mut report = Reporter::new();
        let mut passed = true;
        unsafe {
            let pet_hwnd = match pet.hwnd() {
                Ok(handle) => handle.0,
                Err(error) => {
                    report.kv("error", format!("hwnd: {error}"));
                    let _ = std::fs::write(out_dir.join("report.txt"), report.finish());
                    return false;
                }
            };
            let backdrop_hwnd = backdrop.hwnd().map(|h| h.0).unwrap_or(std::ptr::null_mut());
            let host_hwnd = host.hwnd().map(|h| h.0).unwrap_or(std::ptr::null_mut());
            let scale = GetDpiForWindow(pet_hwnd) as f64 / 96.0;

            report.section("环境");
            report.kv("scale", scale);
            report.kv("monitors", monitor_count());
            report.kv("mixed_dpi", "deferred(单屏，混合 DPI 留待多屏环境)");

            // 摆位：底板垫在桌宠后面，测试宿主放右侧不重叠。
            let mut pet_rect0 = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut pet_rect0);
            let _ = backdrop.set_position(tauri::PhysicalPosition::new(pet_rect0.left - 15, pet_rect0.top - 15));
            let _ = backdrop.show();
            let _ = pet.show();
            let _ = pet.set_always_on_top(false);
            let _ = pet.set_always_on_top(true);
            thread::sleep(Duration::from_millis(900));

            let original_cursor = {
                let mut point = POINT { x: 0, y: 0 };
                GetCursorPos(&mut point);
                (point.x, point.y)
            };
            let zone_point = |base: &RECT, logical: (f64, f64)| POINT {
                x: base.left + (logical.0 * scale).round() as i32,
                y: base.top + (logical.1 * scale).round() as i32,
            };

            // ---- 批次 A：分区命中（分区动态穿透轮询驱动，真实移动光标）----
            report.section("A 分区命中（轮询驱动动态穿透）");
            let mut blank_pass = false;
            let mut bubble_pass = false;
            let mut art_pass = false;
            for (name, logical) in [
                ("bubble", (WIN_W / 2.0, (BUBBLE_TOP + BUBBLE_BOTTOM) / 2.0)),
                ("blank", (WIN_W / 2.0, (BUBBLE_BOTTOM + ART_TOP) / 2.0)),
                ("art", (WIN_W / 2.0, (ART_TOP + ART_BOTTOM) / 2.0)),
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

            // ---- 批次 B：拖动跨出命中区仍保持捕获，松手恢复穿透 ----
            report.section("B 拖动捕获");
            let art_point = zone_point(&pet_rect0, (WIN_W / 2.0, (ART_TOP + ART_BOTTOM) / 2.0));
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
            let click_ok = send_mouse(MOUSEEVENTF_LEFTDOWN, 0, 0);
            thread::sleep(Duration::from_millis(150));
            for _ in 0..8 {
                send_mouse(MOUSEEVENTF_MOVE, 30, 18);
                thread::sleep(Duration::from_millis(45));
            }
            thread::sleep(Duration::from_millis(150));
            let _ = send_mouse(MOUSEEVENTF_LEFTUP, 0, 0);
            thread::sleep(Duration::from_millis(120));
            SAMPLER_DONE.store(true, Ordering::Relaxed);
            let _ = sampler.join();
            report.kv("click_sent", click_ok);
            let track = samples.lock().unwrap().clone();
            let drag_ok = if track.len() > 4 {
                let first = track[0];
                let last = *track.last().unwrap();
                let moved = (last.0 - first.0, last.1 - first.1);
                let distinct = track.iter().collect::<std::collections::BTreeSet<_>>().len();
                report.kv("drag_delta", format!("({},{})", moved.0, moved.1));
                // SendInput 相对位移受系统指针速度倍率影响，记录实际倍率而不是硬性期望值。
                let ratio_x = moved.0 as f64 / 240.0;
                let ratio_y = moved.1 as f64 / 144.0;
                report.kv("pointer_speed_ratio", format!("x={ratio_x:.2} y={ratio_y:.2}"));
                report.kv("capture_distinct_positions", distinct);
                let consistent = ratio_x > 0.5 && ratio_x < 8.0 && (ratio_x - ratio_y).abs() / ratio_x.max(0.001) < 0.3;
                let ok = moved.0.abs() > 60 && moved.1.abs() > 30 && distinct > 3 && consistent;
                report.kv("capture_kept", ok);
                ok
            } else {
                report.kv("capture_kept", false);
                false
            };
            passed &= drag_ok;
            thread::sleep(Duration::from_millis(400));

            // 松手后重新摆底板再测恢复。
            let mut after_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut after_rect);
            let _ = backdrop.set_position(tauri::PhysicalPosition::new(after_rect.left - 15, after_rect.top - 15));
            thread::sleep(Duration::from_millis(250));
            report.section("B2 松手恢复");
            for (name, logical) in [
                ("blank", (WIN_W / 2.0, (BUBBLE_BOTTOM + ART_TOP) / 2.0)),
                ("art", (WIN_W / 2.0, (ART_TOP + ART_BOTTOM) / 2.0)),
            ] {
                let point = zone_point(&after_rect, logical);
                SetCursorPos(point.x, point.y);
                thread::sleep(Duration::from_millis(200));
                let (kind, _) = classify(point, pet_hwnd, backdrop_hwnd);
                let ok = kind == if name == "blank" { "backdrop" } else { "pet" };
                report.kv(&format!("restore_{name}"), kind);
                passed &= ok;
            }

            // ---- 批次 C：独立测试宿主跟随 ----
            report.section("C 独立测试宿主跟随");
            let _ = host.set_position(tauri::PhysicalPosition::new(after_rect.right + 80, after_rect.top));
            let _ = host.show();
            thread::sleep(Duration::from_millis(350));
            super::FOLLOW_HOST.store(host_hwnd as isize, Ordering::Relaxed);
            super::FOLLOW_PET.store(pet_hwnd as isize, Ordering::Relaxed);
            super::start_follow_engine(
                host_hwnd as isize,
                pet_hwnd as isize,
                spike.follow_stop.clone(),
            );
            thread::sleep(Duration::from_millis(500));
            let mut host_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(host_hwnd, &mut host_rect);
            let mut pet_before = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut pet_before);
            report.kv("host_left_top", format!("({},{})", host_rect.left, host_rect.top));
            report.kv("pet_left_top", format!("({},{})", pet_before.left, pet_before.top));
            SetWindowPos(
                host_hwnd,
                std::ptr::null_mut(),
                host_rect.left + 120,
                host_rect.top + 80,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
            thread::sleep(Duration::from_millis(700));
            let mut pet_after_follow = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut pet_after_follow);
            let followed = (
                pet_after_follow.left - pet_before.left,
                pet_after_follow.top - pet_before.top,
            );
            report.kv("pet_followed_delta", format!("({},{})", followed.0, followed.1));
            report.kv("host_moved_by", "(120,80)");
            let follow_ok = followed.0.abs() >= 110 && followed.1.abs() >= 70;
            report.kv("follow_pass", follow_ok);
            passed &= follow_ok;

            // z 序对齐生产 wantTop：宿主前台 → 桌宠置顶；其他窗口前台 → 桌宠退普通层级紧贴其下。
            let activated_host = activate_by_click(host_hwnd);
            let mut pet_topmost_when_host = false;
            for _ in 0..12 {
                thread::sleep(Duration::from_millis(100));
                pet_topmost_when_host =
                    (GetWindowLongPtrW(pet_hwnd, GWL_EXSTYLE) & (WS_EX_TOPMOST as isize)) != 0;
                if pet_topmost_when_host {
                    break;
                }
            }
            let fg_is_host = GetForegroundWindow() == host_hwnd;
            report.kv("activated_by_click", activated_host);
            report.kv("fg_is_host", fg_is_host);
            report.kv("pet_topmost_when_host_fg", pet_topmost_when_host);
            passed &= pet_topmost_when_host;

            // 空闲防刷：宿主持续前台 2.5s，manage_z 不得重复调用 SetWindowPos（防浮动任务栏重影）。
            let z_before = super::Z_CALLS.load(Ordering::Relaxed);
            thread::sleep(Duration::from_millis(2500));
            let z_after = super::Z_CALLS.load(Ordering::Relaxed);
            report.kv("z_setwindowpos_calls_idle", z_after - z_before);
            passed &= z_after == z_before;

            let activated_backdrop = activate_by_click(backdrop_hwnd);
            // z 序收敛允许钩子/兜底轮询最多 1.2s，而不是卡死某一拍。
            let mut pet_topmost_when_other = true;
            let mut below_foreground = false;
            for _ in 0..12 {
                thread::sleep(Duration::from_millis(100));
                pet_topmost_when_other =
                    (GetWindowLongPtrW(pet_hwnd, GWL_EXSTYLE) & (WS_EX_TOPMOST as isize)) != 0;
                below_foreground = GetWindow(backdrop_hwnd, GW_HWNDNEXT) == pet_hwnd;
                if !pet_topmost_when_other && below_foreground {
                    break;
                }
            }
            let fg_is_other = GetForegroundWindow() == backdrop_hwnd;
            report.kv("activated_by_click_other", activated_backdrop);
            report.kv("fg_is_other", fg_is_other);
            report.kv("pet_topmost_when_other_fg", pet_topmost_when_other);
            report.kv("pet_directly_below_other_fg", below_foreground);
            passed &= !pet_topmost_when_other && below_foreground;

            // 负坐标平移：宿主移到屏幕外负坐标区，桌宠平移量须一致（单屏可测平移数学）。
            let mut host_before_neg = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(host_hwnd, &mut host_before_neg);
            let mut pet_before_neg = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut pet_before_neg);
            SetWindowPos(
                host_hwnd,
                std::ptr::null_mut(),
                -220,
                host_before_neg.top,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
            thread::sleep(Duration::from_millis(700));
            let mut pet_after_neg = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(pet_hwnd, &mut pet_after_neg);
            let neg_delta = (pet_after_neg.left - pet_before_neg.left, pet_after_neg.top - pet_before_neg.top);
            let host_delta = (-220 - host_before_neg.left, 0);
            report.kv("negative_host_delta", format!("({},{})", host_delta.0, host_delta.1));
            report.kv("negative_pet_delta", format!("({},{})", neg_delta.0, neg_delta.1));
            let neg_ok = (neg_delta.0 - host_delta.0).abs() <= 2 && neg_delta.1.abs() <= 2;
            report.kv("negative_translation_pass", neg_ok);
            passed &= neg_ok;
            // 宿主挪回可见区，避免后续截图在屏外。
            SetWindowPos(
                host_hwnd,
                std::ptr::null_mut(),
                host_before_neg.left,
                host_before_neg.top,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
            thread::sleep(Duration::from_millis(500));
            spike.follow_stop.store(true, Ordering::Relaxed);
            thread::sleep(Duration::from_millis(300));

            // ---- 批次 F：真实 ForegroundHost 辅助进程（参数化副本）接管 Tauri 窗口 ----
            report.section("F ForegroundHost 辅助进程绑定测试宿主");
            let pet_class_name = window_class(pet_hwnd);
            let host_class_name = window_class(host_hwnd);
            report.kv("pet_top_level_class", &pet_class_name);
            report.kv("host_top_level_class", &host_class_name);
            let helper_path = std::env::current_exe().ok().and_then(|exe| {
                let dir = exe.parent()?;
                // 开发树里 exe 在 target/release/，仓库实验在 ../../host-check/；发布布局则同级。
                let mut candidates = vec![dir.join("host-check")];
                if let Some(release) = dir.parent() {
                    if let Some(root) = release.parent() {
                        candidates.push(root.join("host-check"));
                    }
                }
                candidates.into_iter().map(|dir| dir.join("ForegroundHostSpike.exe")).find(|path| path.exists())
            });
            if let Some(helper_path) = helper_path.filter(|path| path.exists()) {
                use std::io::BufRead;
                use std::process::{Command, Stdio};
                let spawn_result = Command::new(&helper_path)
                    .arg(std::process::id().to_string())
                    .arg((pet_hwnd as isize).to_string())
                    .env("SPIKE_HOST_PROCESS", "catstella-window-spike")
                    .env("SPIKE_HOST_CLASS", &host_class_name)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn();
                match spawn_result {
                    Ok(mut spawned) => {
                        let mut reader = spawned.stdout.take().expect("helper stdout");
                        let mut error_reader = spawned.stderr.take().expect("helper stderr");
                        let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
                        let errors: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
                        let error_sink = errors.clone();
                        let error_thread = std::thread::spawn(move || {
                            let mut buffered = std::io::BufReader::new(error_reader);
                            let mut line = String::new();
                            while let Ok(n) = buffered.read_line(&mut line) {
                                if n == 0 { break; }
                                error_sink.lock().unwrap().push_str(&line);
                                line.clear();
                            }
                        });
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
                        // 对照变体：widget=0 未绑定限时运行，区分"绑定模式无输出"与"任何模式都无输出"。
                        let control = Command::new(&helper_path)
                            .arg(std::process::id().to_string())
                            .arg("0")
                            .env("SPIKE_HOST_PROCESS", "catstella-window-spike")
                            .env("SPIKE_HOST_CLASS", &host_class_name)
                            .stdin(Stdio::null())
                            .stdout(Stdio::piped())
                            .stderr(Stdio::null())
                            .spawn();
                        let mut control_lines = 0usize;
                        if let Ok(mut control) = control {
                            let mut control_reader = std::io::BufReader::new(control.stdout.take().expect("control stdout"));
                            let control_sink: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
                            let control_drain = control_sink.clone();
                            std::thread::spawn(move || {
                                let mut line = String::new();
                                loop {
                                    line.clear();
                                    match control_reader.read_line(&mut line) {
                                        Ok(0) | Err(_) => break,
                                        Ok(_) => { control_drain.lock().unwrap().push(line.trim().to_string()); }
                                    }
                                }
                            });
                            for _ in 0..10 {
                                thread::sleep(Duration::from_millis(120));
                                if control.try_wait().ok().flatten().is_some() { break; }
                            }
                            control_lines = control_sink.lock().unwrap().len();
                            let _ = control.kill();
                            let _ = control.wait();
                        }
                        report.kv("helper_control_lines", control_lines);
                        SetForegroundWindow(host_hwnd);
                        // 辅助进程心跳 1s，等两拍保证至少输出两行。
                        thread::sleep(Duration::from_millis(2500));
                        let exited_early = spawned.try_wait().ok().flatten();
                        report.kv(
                            "helper_exit_early",
                            exited_early.map(|s| s.to_string()).unwrap_or_else(|| "running".into()),
                        );
                        let snapshot = lines.lock().unwrap().clone();
                        report.kv("helper_lines", snapshot.len());
                        if snapshot.is_empty() {
                            let stderr_text = errors.lock().unwrap().trim().to_string();
                            if !stderr_text.is_empty() {
                                report.kv("helper_stderr", stderr_text);
                            }
                        }
                        let kind_marker = concat!("\"kind\":\"host\"");
                        let attached_marker = concat!("\"attached\":true");
                        let host_json = snapshot.iter().rev().find(|l| l.contains(kind_marker));
                        match host_json {
                            Some(line) => {
                                report.kv("helper_kind", "host");
                                let attached = line.contains(attached_marker);
                                report.kv("helper_attached", attached);
                                // bounds 是宿主客户区（原点 ClientToScreen + 客户区尺寸）。
                                let mut client_origin = POINT { x: 0, y: 0 };
                                ClientToScreenSpike(host_hwnd, &mut client_origin);
                                let mut client_size = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                                GetClientRectSpike(host_hwnd, &mut client_size);
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
                                // 宿主挪回可见区；关闭 stdin 触发辅助进程优雅退出。
                                SetWindowPos(host_hwnd, std::ptr::null_mut(), after_rect.right + 80, after_rect.top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
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
                                let _ = error_thread.join();
                            }
                        }
                    }
                    Err(error) => {
                        report.kv("helper_spawn_error", error.to_string());
                        passed = false;
                    }
                }
            } else {
                report.kv("helper_present", false);
                passed = false;
            }

            // ---- 批次 D：DPI 与截图 ----
            report.section("D DPI 与截图");
            // 跟随实验后重新取实时位置，保证截图与报告坐标一致。
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
            SetCursorPos(original_cursor.0, original_cursor.1);
        }
        let _ = zone_at; // 保留引用，避免未使用告警（分区逻辑由窗口轮询线程使用）。
        report.section("结论");
        report.kv("all_pass", passed);
        let _ = std::fs::write(out_dir.join("report.txt"), report.finish());
        passed
    }
}

#[cfg(windows)]
fn main() {
    let probe_arg = std::env::args().find_map(|arg| arg.strip_prefix("--probe-output=").map(PathBuf::from));
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            drag,
            ignore_temporarily,
            exit_spike,
            open_host,
            follow_host,
            stop_follow
        ])
        .setup(move |app| {
            let pet = app.get_webview_window("pet").expect("configured pet window");
            let host = app.get_webview_window("testhost").expect("configured test host window");
            let state = Arc::new(Spike {
                pet: pet.clone(),
                host: OnceLock::new(),
                dragging: AtomicBool::new(false),
                follow_stop: Arc::new(AtomicBool::new(false)),
                passthrough: AtomicBool::new(false),
            });
            let _ = state.host.set(host.clone());
            let _ = SPIKE.set(state.clone());
            start_zone_poller(state.clone());
            if let Some(out_dir) = probe_arg {
                let backdrop = tauri::WebviewWindowBuilder::new(
                    app,
                    "behind",
                    tauri::WebviewUrl::App("behind.html".into()),
                )
                .inner_size(380.0, 500.0)
                .decorations(false)
                .skip_taskbar(true)
                .always_on_top(false)
                .visible(false)
                .build()?;
                probe::run(pet, backdrop, host, out_dir, state);
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
