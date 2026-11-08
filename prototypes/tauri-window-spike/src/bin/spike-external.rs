// 独立进程实验窗口：给 Tauri 桌宠 spike 提供真正跨进程的底板与测试宿主。
// 用法：spike-external.exe --title=窗口标题 --log=点击日志路径 --color=RRGGBB
// 启动时写入 start/hwnd/pid 行；每次 WM_LBUTTONDOWN 追加 click 行，供探针验证点击真实送达本进程。

#![windows_subsystem = "windows"]

use std::ffi::OsStr;
use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;
use std::sync::OnceLock;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

fn arg_value(name: &str) -> Option<String> {
    std::env::args().find_map(|arg| arg.strip_prefix(&format!("--{name}=")).map(str::to_string))
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn append_log(line: &str) {
    if let Some(path) = LOG_PATH.get() {
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
            let _ = file.flush();
        }
    }
}

fn main() {
    let title = arg_value("title").unwrap_or_else(|| "Spike 外部窗口".into());
    let role = arg_value("role").unwrap_or_else(|| "backdrop".into());
    let color = arg_value("color").unwrap_or_else(|| "28445A".into());
    if let Some(log) = arg_value("log") {
        let _ = LOG_PATH.set(PathBuf::from(&log));
        append_log(&format!("start pid={} role={role}", std::process::id()));
    }

    let title_wide = wide(&title);
    let class_wide = wide("SpikeExternalWindow");
    unsafe {
        let instance = windows_sys::Win32::System::LibraryLoader::GetModuleHandleW(std::ptr::null());
        let brush = gdi_brush(&color);
        let class = windows_sys::Win32::UI::WindowsAndMessaging::WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: brush,
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_wide.as_ptr(),
        };
        windows_sys::Win32::UI::WindowsAndMessaging::RegisterClassW(&class);
        let hwnd = windows_sys::Win32::UI::WindowsAndMessaging::CreateWindowExW(
            0,
            class_wide.as_ptr(),
            title_wide.as_ptr(),
            windows_sys::Win32::UI::WindowsAndMessaging::WS_OVERLAPPEDWINDOW
                | windows_sys::Win32::UI::WindowsAndMessaging::WS_VISIBLE,
            0x8000_0000u32 as i32, // CW_USEDEFAULT
            0x8000_0000u32 as i32,
            640,
            480,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );
        if hwnd.is_null() {
            return;
        }
        append_log(&format!("hwnd={} pid={}", hwnd as isize, std::process::id()));

        let mut message: windows_sys::Win32::UI::WindowsAndMessaging::MSG = std::mem::zeroed();
        while windows_sys::Win32::UI::WindowsAndMessaging::GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            windows_sys::Win32::UI::WindowsAndMessaging::TranslateMessage(&message);
            windows_sys::Win32::UI::WindowsAndMessaging::DispatchMessageW(&message);
        }
        append_log(&format!("quit pid={}", std::process::id()));
    }
}

unsafe fn gdi_brush(color_hex: &str) -> windows_sys::Win32::Graphics::Gdi::HBRUSH {
    let value = u32::from_str_radix(color_hex, 16).unwrap_or(0x28445A);
    let red = ((value >> 16) & 0xff) as u32;
    let green = ((value >> 8) & 0xff) as u32;
    let blue = (value & 0xff) as u32;
    windows_sys::Win32::Graphics::Gdi::CreateSolidBrush((red << 16) | (green << 8) | blue)
}

unsafe extern "system" fn wnd_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    message: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    match message {
        windows_sys::Win32::UI::WindowsAndMessaging::WM_LBUTTONDOWN => {
            append_log(&format!("click pid={} tick={}", std::process::id(), now_ms()));
            0
        }
        windows_sys::Win32::UI::WindowsAndMessaging::WM_DESTROY => {
            windows_sys::Win32::UI::WindowsAndMessaging::PostQuitMessage(0);
            0
        }
        _ => windows_sys::Win32::UI::WindowsAndMessaging::DefWindowProcW(hwnd, message, wparam, lparam),
    }
}
