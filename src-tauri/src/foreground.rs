use crate::layout::{DisplayInfo, Rect};
use crate::state::SharedApp;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicIsize, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForegroundUpdate {
    pub foreground_kind: String,
    pub host_bounds_phys: Option<Rect>,
    pub attached: bool,
    pub native_following: bool,
    pub restore_generation: u32,
    pub host_id: String,
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;
    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        ClientToScreen, EnumDisplayMonitors, GetMonitorInfoW, MonitorFromPoint, MonitorFromRect,
        HDC, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
    use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, EnumWindows, GetAncestor, GetClassNameW, GetClientRect,
        GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowRect,
        GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, MsgWaitForMultipleObjectsEx,
        PeekMessageW, SendMessageTimeoutW, SetWindowLongPtrW, SetWindowPos, TranslateMessage,
        EVENT_OBJECT_LOCATIONCHANGE, EVENT_SYSTEM_FOREGROUND, GA_ROOTOWNER, GWL_EXSTYLE,
        GW_HWNDNEXT, GW_OWNER, HWND_BOTTOM, HWND_NOTOPMOST, HWND_TOPMOST, MONITORINFOF_PRIMARY,
        MSG, PM_REMOVE, QS_ALLINPUT, SMTO_ABORTIFHUNG, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WINEVENT_OUTOFCONTEXT, WM_NULL, WS_EX_APPWINDOW,
        WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    };

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(
            hwnd: HWND,
            dw_attribute: u32,
            pv_attribute: *mut core::ffi::c_void,
            cb_attribute: u32,
        ) -> i32;
    }

    #[link(name = "winmm")]
    extern "system" {
        fn timeBeginPeriod(u_period: u32) -> u32;
        fn timeEndPeriod(u_period: u32) -> u32;
    }

    const DWMWA_CLOAKED: u32 = 14;
    const GW_HWNDPREV: u32 = 3;
    const SWP_NOOWNERZORDER: u32 = 0x0200;
    const EVENT_OBJECT_REORDER: u32 = 0x8004;
    const EVENT_SYSTEM_MOVESIZESTART: u32 = 0x000A;
    const EVENT_SYSTEM_MOVESIZEEND: u32 = 0x000B;

    static FOLLOW_HOST: AtomicIsize = AtomicIsize::new(0);
    static FOLLOW_PET: AtomicIsize = AtomicIsize::new(0);
    static FOLLOW_LAST: AtomicI64 = AtomicI64::new(i64::MAX);
    static FOLLOW_ACTIVE: AtomicBool = AtomicBool::new(false);
    static DRAGGING_FLAG: AtomicBool = AtomicBool::new(false);
    static HOST_MOVING: AtomicBool = AtomicBool::new(false);
    static LAST_HOST_MOVE_MS: AtomicU64 = AtomicU64::new(0);
    static WAKE_CHECK: AtomicBool = AtomicBool::new(false);

    fn now_epoch_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    unsafe fn is_topmost(hwnd: HWND) -> bool {
        !hwnd.is_null()
            && IsWindow(hwnd) != 0
            && (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST as isize) != 0
    }

    unsafe fn is_window_available(hwnd: HWND) -> bool {
        if hwnd.is_null() || IsWindow(hwnd) == 0 || IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return false;
        }
        let mut cloaked: i32 = 0;
        let hr = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut i32).cast(),
            std::mem::size_of::<i32>() as u32,
        );
        !(hr == 0 && cloaked != 0)
    }

    pub fn set_dragging_flag(dragging: bool) {
        DRAGGING_FLAG.store(dragging, Ordering::Relaxed);
    }

    pub fn apply_tool_window_style(hwnd_raw: isize) {
        let hwnd = hwnd_raw as HWND;
        if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 {
            return;
        }
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let next = (ex | WS_EX_TOOLWINDOW as isize) & !(WS_EX_APPWINDOW as isize);
            if next != ex {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
            }
        }
    }

    pub fn is_tool_window(hwnd_raw: isize) -> bool {
        let hwnd = hwnd_raw as HWND;
        if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 {
            return false;
        }
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            (ex & WS_EX_TOOLWINDOW as isize) != 0 && (ex & WS_EX_APPWINDOW as isize) == 0
        }
    }

    pub fn get_window_bounds_phys(hwnd_raw: isize) -> Option<Rect> {
        let hwnd = hwnd_raw as HWND;
        if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 {
            return None;
        }
        let mut r = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if unsafe { GetWindowRect(hwnd, &mut r) } == 0 {
            return None;
        }
        Some(Rect {
            x: r.left,
            y: r.top,
            width: r.right - r.left,
            height: r.bottom - r.top,
        })
    }

    pub fn set_window_bounds_phys(hwnd_raw: isize, bounds: Rect) {
        let hwnd = hwnd_raw as HWND;
        if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 {
            return;
        }
        if let Some(cur) = get_window_bounds_phys(hwnd_raw) {
            if cur == bounds {
                return;
            }
        }
        unsafe {
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }

    pub fn set_topmost(hwnd_raw: isize, topmost: bool, force: bool) {
        let hwnd = hwnd_raw as HWND;
        if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 {
            return;
        }
        unsafe {
            let is_topmost = (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST as isize) != 0;
            if !force && is_topmost == topmost {
                return;
            }
            if force && !topmost && !is_topmost {
                return;
            }
            let after = if topmost { HWND_TOPMOST } else { HWND_NOTOPMOST };
            SetWindowPos(
                hwnd,
                after,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }

    pub fn move_top(hwnd_raw: isize) {
        let hwnd = hwnd_raw as HWND;
        if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 {
            return;
        }
        unsafe {
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }

    pub fn get_cursor_pos_phys() -> Option<(i32, i32)> {
        let mut pt = POINT { x: 0, y: 0 };
        if unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut pt) } != 0 {
            Some((pt.x, pt.y))
        } else {
            None
        }
    }

    pub fn is_left_button_down() -> bool {
        let state = unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(0x01) };
        (state as u16 & 0x8000) != 0
    }

    pub fn is_window_responsive(hwnd_raw: isize) -> bool {
        let hwnd = hwnd_raw as HWND;
        if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 {
            return false;
        }
        let mut res: usize = 0;
        unsafe {
            SendMessageTimeoutW(
                hwnd,
                WM_NULL,
                0,
                0,
                SMTO_ABORTIFHUNG,
                1000,
                &mut res,
            ) != 0
        }
    }

    fn monitor_info_to_display(hmon: HMONITOR) -> Option<DisplayInfo> {
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            rcMonitor: RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            rcWork: RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            dwFlags: 0,
        };
        if unsafe { GetMonitorInfoW(hmon, &mut mi) } == 0 {
            return None;
        }
        let mut dpi_x: u32 = 96;
        let mut dpi_y: u32 = 96;
        let hr = unsafe { GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
        let scale = if hr == 0 && dpi_x > 0 {
            dpi_x as f64 / 96.0
        } else {
            1.0
        };
        let phys_work = Rect {
            x: mi.rcWork.left,
            y: mi.rcWork.top,
            width: mi.rcWork.right - mi.rcWork.left,
            height: mi.rcWork.bottom - mi.rcWork.top,
        };
        let dip_work = Rect {
            x: (phys_work.x as f64 / scale).round() as i32,
            y: (phys_work.y as f64 / scale).round() as i32,
            width: (phys_work.width as f64 / scale).round() as i32,
            height: (phys_work.height as f64 / scale).round() as i32,
        };
        Some(DisplayInfo {
            phys_work,
            dip_work,
            scale,
            is_primary: (mi.dwFlags & MONITORINFOF_PRIMARY) != 0,
        })
    }

    pub fn enumerate_displays() -> Vec<DisplayInfo> {
        unsafe extern "system" fn callback(
            hmon: HMONITOR,
            _hdc: HDC,
            _lprc: *mut RECT,
            data: LPARAM,
        ) -> BOOL {
            let list = &mut *(data as *mut Vec<DisplayInfo>);
            if let Some(info) = monitor_info_to_display(hmon) {
                list.push(info);
            }
            1
        }
        let mut list: Vec<DisplayInfo> = Vec::new();
        unsafe {
            EnumDisplayMonitors(
                std::ptr::null_mut(),
                std::ptr::null(),
                Some(callback),
                (&mut list as *mut Vec<DisplayInfo>) as LPARAM,
            );
        }
        list
    }

    pub fn display_for_phys_point(x: i32, y: i32) -> Option<DisplayInfo> {
        let hmon = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST) };
        if hmon.is_null() {
            return None;
        }
        monitor_info_to_display(hmon)
    }

    pub fn display_for_phys_rect(rect: Rect) -> Option<DisplayInfo> {
        let r = RECT {
            left: rect.x,
            top: rect.y,
            right: rect.x + rect.width,
            bottom: rect.y + rect.height,
        };
        let hmon = unsafe { MonitorFromRect(&r, MONITOR_DEFAULTTONEAREST) };
        if hmon.is_null() {
            return None;
        }
        monitor_info_to_display(hmon)
    }

    fn window_class_name(hwnd: HWND) -> String {
        let mut buf = [0u16; 128];
        let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if len <= 0 {
            return String::new();
        }
        OsString::from_wide(&buf[..len as usize])
            .to_string_lossy()
            .into_owned()
    }

    fn process_stem_lower(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return None;
            }
            let mut buf = [0u16; 512];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
            CloseHandle(handle);
            if ok == 0 || size == 0 {
                return None;
            }
            let full = OsString::from_wide(&buf[..size as usize]).to_string_lossy().into_owned();
            let stem = Path::new(&full)
                .file_stem()
                .and_then(|s| s.to_str())?
                .to_ascii_lowercase();
            Some(stem)
        }
    }

    fn host_target_config() -> (String, String) {
        let class_name = std::env::var("CATSTELLA_HOST_CLASS")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Chrome_WidgetWin_1".to_string());
        let proc_name = std::env::var("CATSTELLA_HOST_PROCESS")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "antigravity".to_string())
            .to_ascii_lowercase();
        (class_name, proc_name)
    }

    unsafe fn is_host_window(hwnd: HWND, host_class: &str, host_proc: &str) -> bool {
        if hwnd.is_null() || IsWindow(hwnd) == 0 {
            return false;
        }
        if !GetWindow(hwnd, GW_OWNER).is_null() {
            return false;
        }
        if window_class_name(hwnd) != host_class {
            return false;
        }
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetClientRect(hwnd, &mut rect) == 0 {
            return false;
        }
        if (rect.right - rect.left) < 360 || (rect.bottom - rect.top) < 200 {
            return false;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        matches!(process_stem_lower(pid), Some(stem) if stem == host_proc)
    }

    unsafe fn find_largest_host(host_class: &str, host_proc: &str) -> HWND {
        struct Search<'a> {
            host_class: &'a str,
            host_proc: &'a str,
            best: HWND,
            largest: i64,
        }
        unsafe extern "system" fn enum_cb(hwnd: HWND, data: LPARAM) -> BOOL {
            let state = &mut *(data as *mut Search<'_>);
            if IsWindowVisible(hwnd) != 0 && is_host_window(hwnd, state.host_class, state.host_proc) {
                let mut r = RECT {
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                };
                if GetClientRect(hwnd, &mut r) != 0 {
                    let area = (r.right - r.left) as i64 * (r.bottom - r.top) as i64;
                    if area > state.largest {
                        state.largest = area;
                        state.best = hwnd;
                    }
                }
            }
            1
        }
        let mut search = Search {
            host_class,
            host_proc,
            best: std::ptr::null_mut(),
            largest: 0,
        };
        EnumWindows(Some(enum_cb), (&mut search as *mut Search<'_>) as LPARAM);
        search.best
    }

    unsafe fn client_bounds_phys(hwnd: HWND) -> Option<Rect> {
        if hwnd.is_null() || IsWindow(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return None;
        }
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let mut pt = POINT { x: 0, y: 0 };
        if GetClientRect(hwnd, &mut rect) == 0 || ClientToScreen(hwnd, &mut pt) == 0 {
            return None;
        }
        let w = rect.right - rect.left;
        let h = rect.bottom - rect.top;
        if w <= 0 || h <= 0 {
            return None;
        }
        Some(Rect {
            x: pt.x,
            y: pt.y,
            width: w,
            height: h,
        })
    }

    unsafe fn classify_foreground(
        window: HWND,
        pid: u32,
        self_pid: u32,
        host_class: &str,
        host_proc: &str,
    ) -> String {
        if window.is_null() {
            return "shell".to_string();
        }
        if pid == self_pid {
            return "self".to_string();
        }
        let root_owner = GetAncestor(window, GA_ROOTOWNER);
        if is_host_window(root_owner, host_class, host_proc) {
            return "host".to_string();
        }
        let cls = window_class_name(window);
        if cls == "Progman" || cls == "WorkerW" {
            return "desktop".to_string();
        }
        if matches!(
            cls.as_str(),
            "Shell_TrayWnd"
                | "Shell_SecondaryTrayWnd"
                | "NotifyIconOverflowWindow"
                | "TopLevelWindowForOverflowXamlIsland"
        ) {
            return "shell".to_string();
        }
        if let Some(proc_name) = process_stem_lower(pid) {
            if matches!(
                proc_name.as_str(),
                "shellexperiencehost" | "startmenuexperiencehost" | "shellhost"
            ) {
                return "shell".to_string();
            }
            if matches!(
                proc_name.as_str(),
                "msedge"
                    | "chrome"
                    | "firefox"
                    | "zen"
                    | "brave"
                    | "vivaldi"
                    | "waterfox"
                    | "floorp"
            ) {
                return "browser".to_string();
            }
        }
        "other".to_string()
    }

    unsafe fn follow_tick() {
        if DRAGGING_FLAG.load(Ordering::Relaxed) {
            return;
        }
        let host = FOLLOW_HOST.load(Ordering::Relaxed) as HWND;
        let pet = FOLLOW_PET.load(Ordering::Relaxed) as HWND;
        if !is_window_available(host) || pet.is_null() || IsWindow(pet) == 0 {
            return;
        }
        let mut next = POINT { x: 0, y: 0 };
        let mut widget_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if ClientToScreen(host, &mut next) != 0 && GetWindowRect(pet, &mut widget_rect) != 0 {
            let packed = ((next.x as i64) << 32) | (next.y as i64 & 0xffff_ffff);
            let prev = FOLLOW_LAST.swap(packed, Ordering::Relaxed);
            if prev == i64::MAX || prev == packed {
                return;
            }
            let dx = next.x - (prev >> 32) as i32;
            let dy = next.y - (prev & 0xffff_ffff) as u32 as i32;
            if dx != 0 || dy != 0 {
                SetWindowPos(
                    pet,
                    std::ptr::null_mut(),
                    widget_rect.left + dx,
                    widget_rect.top + dy,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                );
                LAST_HOST_MOVE_MS.store(now_epoch_ms(), Ordering::Relaxed);
            }
        }
    }

    unsafe fn stack_with_host(pet: HWND, host: HWND) {
        if pet.is_null() || IsWindow(pet) == 0 {
            return;
        }
        // Keep the pet in the normal Z-band right above the host rather than toggling WS_EX_TOPMOST.
        if is_topmost(pet) {
            SetWindowPos(
                pet,
                HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            );
        }
        if !is_window_available(host) {
            return;
        }
        let mut above = GetWindow(host, GW_HWNDPREV);
        if above == pet {
            return;
        }
        if !above.is_null() && is_topmost(above) {
            above = std::ptr::null_mut();
        }
        SetWindowPos(
            pet,
            above,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        );
    }

    unsafe extern "system" fn on_host_event(
        _hook: HWINEVENTHOOK,
        event: u32,
        window: HWND,
        object: i32,
        _child: i32,
        _thread: u32,
        _time: u32,
    ) {
        if !FOLLOW_ACTIVE.load(Ordering::Relaxed) || window as isize != FOLLOW_HOST.load(Ordering::Relaxed) {
            return;
        }
        match event {
            EVENT_SYSTEM_MOVESIZESTART => {
                HOST_MOVING.store(true, Ordering::Relaxed);
            }
            EVENT_SYSTEM_MOVESIZEEND => {
                HOST_MOVING.store(false, Ordering::Relaxed);
                LAST_HOST_MOVE_MS.store(now_epoch_ms(), Ordering::Relaxed);
                follow_tick();
            }
            EVENT_OBJECT_LOCATIONCHANGE if object == 0 => {
                follow_tick();
            }
            _ => {}
        }
    }

    unsafe extern "system" fn on_global_event(
        _hook: HWINEVENTHOOK,
        event: u32,
        _window: HWND,
        _object: i32,
        _child: i32,
        _thread: u32,
        _time: u32,
    ) {
        WAKE_CHECK.store(true, Ordering::Relaxed);
        if (event == EVENT_SYSTEM_FOREGROUND || event == EVENT_OBJECT_REORDER)
            && FOLLOW_ACTIVE.load(Ordering::Relaxed)
        {
            let pet = FOLLOW_PET.load(Ordering::Relaxed) as HWND;
            let host = FOLLOW_HOST.load(Ordering::Relaxed) as HWND;
            stack_with_host(pet, host);
        }
    }

    pub fn spawn_foreground_monitor<F>(app_state: Arc<SharedApp>, on_change: F)
    where
        F: Fn(ForegroundUpdate) + Send + Sync + 'static,
    {
        thread::spawn(move || unsafe {
            let self_pid = std::process::id();
            let (host_class, host_proc) = host_target_config();
            let mut last_host: HWND = std::ptr::null_mut();
            let mut tracked_host: HWND = std::ptr::null_mut();
            let mut previous_foreground: HWND = std::ptr::null_mut();
            let mut location_hook: HWINEVENTHOOK = std::ptr::null_mut();
            let mut drag_hook: HWINEVENTHOOK = std::ptr::null_mut();
            let mut focus_hook: HWINEVENTHOOK = std::ptr::null_mut();
            let mut reorder_hook: HWINEVENTHOOK = std::ptr::null_mut();
            let mut precise_timer = false;
            let mut host_was_available = false;
            let mut restore_generation = 0u32;
            let mut foreground_kind = "unknown".to_string();
            let mut last_validation = std::time::Instant::now()
                .checked_sub(std::time::Duration::from_secs(5))
                .unwrap_or_else(std::time::Instant::now);
            let mut last_emitted: Option<ForegroundUpdate> = None;
            let mut msg: MSG = std::mem::zeroed();

            while !app_state.quitting.load(Ordering::Relaxed) {
                while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }

                if !app_state.needs_foreground_monitor() {
                    if !location_hook.is_null() {
                        UnhookWinEvent(location_hook);
                        location_hook = std::ptr::null_mut();
                    }
                    if !drag_hook.is_null() {
                        UnhookWinEvent(drag_hook);
                        drag_hook = std::ptr::null_mut();
                    }
                    if !focus_hook.is_null() {
                        UnhookWinEvent(focus_hook);
                        focus_hook = std::ptr::null_mut();
                    }
                    if !reorder_hook.is_null() {
                        UnhookWinEvent(reorder_hook);
                        reorder_hook = std::ptr::null_mut();
                    }
                    if precise_timer {
                        timeEndPeriod(1);
                        precise_timer = false;
                    }
                    HOST_MOVING.store(false, Ordering::Relaxed);
                    FOLLOW_ACTIVE.store(false, Ordering::Relaxed);
                    FOLLOW_PET.store(0, Ordering::Relaxed);
                    FOLLOW_HOST.store(0, Ordering::Relaxed);
                    tracked_host = std::ptr::null_mut();
                    thread::sleep(std::time::Duration::from_millis(180));
                    continue;
                }

                if focus_hook.is_null() {
                    focus_hook = SetWinEventHook(
                        EVENT_SYSTEM_FOREGROUND,
                        EVENT_SYSTEM_FOREGROUND,
                        std::ptr::null_mut(),
                        Some(on_global_event),
                        0,
                        0,
                        WINEVENT_OUTOFCONTEXT,
                    );
                }
                if reorder_hook.is_null() {
                    reorder_hook = SetWinEventHook(
                        EVENT_OBJECT_REORDER,
                        EVENT_OBJECT_REORDER,
                        std::ptr::null_mut(),
                        Some(on_global_event),
                        0,
                        0,
                        WINEVENT_OUTOFCONTEXT,
                    );
                }

                let fg_win = GetForegroundWindow();
                let mut fg_pid = 0u32;
                if !fg_win.is_null() {
                    GetWindowThreadProcessId(fg_win, &mut fg_pid);
                }
                let fg_changed = fg_win != previous_foreground;
                if fg_changed || foreground_kind == "unknown" {
                    if fg_changed {
                        WAKE_CHECK.store(true, Ordering::Relaxed);
                    }
                    foreground_kind =
                        classify_foreground(fg_win, fg_pid, self_pid, &host_class, &host_proc);
                }
                if fg_changed {
                    let fg_host = GetAncestor(fg_win, GA_ROOTOWNER);
                    if is_host_window(fg_host, &host_class, &host_proc) {
                        last_host = fg_host;
                    }
                }

                if last_validation.elapsed().as_millis() >= 1000
                    || (!last_host.is_null() && IsWindow(last_host) == 0)
                {
                    if !is_host_window(last_host, &host_class, &host_proc) {
                        last_host = find_largest_host(&host_class, &host_proc);
                    }
                    last_validation = std::time::Instant::now();
                }

                let follow_pet = app_state.fg_follow_pet.load(Ordering::Relaxed);
                let pet_hwnd = if follow_pet {
                    app_state.pet_hwnd.load(Ordering::Relaxed) as HWND
                } else {
                    std::ptr::null_mut()
                };

                if !pet_hwnd.is_null() && IsWindow(pet_hwnd) != 0 {
                    FOLLOW_PET.store(pet_hwnd as isize, Ordering::Relaxed);
                    FOLLOW_HOST.store(last_host as isize, Ordering::Relaxed);
                    FOLLOW_ACTIVE.store(!last_host.is_null(), Ordering::Relaxed);

                    if tracked_host != last_host {
                        if !location_hook.is_null() {
                            UnhookWinEvent(location_hook);
                            location_hook = std::ptr::null_mut();
                        }
                        if !drag_hook.is_null() {
                            UnhookWinEvent(drag_hook);
                            drag_hook = std::ptr::null_mut();
                        }
                        HOST_MOVING.store(false, Ordering::Relaxed);
                        tracked_host = last_host;
                        FOLLOW_LAST.store(i64::MAX, Ordering::Relaxed);
                        restore_generation = restore_generation.wrapping_add(1);
                        if !tracked_host.is_null() {
                            let mut h_pid = 0u32;
                            let h_tid = GetWindowThreadProcessId(tracked_host, &mut h_pid);
                            if h_pid != 0 && h_tid != 0 {
                                location_hook = SetWinEventHook(
                                    EVENT_OBJECT_LOCATIONCHANGE,
                                    EVENT_OBJECT_LOCATIONCHANGE,
                                    std::ptr::null_mut(),
                                    Some(on_host_event),
                                    h_pid,
                                    h_tid,
                                    WINEVENT_OUTOFCONTEXT,
                                );
                                drag_hook = SetWinEventHook(
                                    EVENT_SYSTEM_MOVESIZESTART,
                                    EVENT_SYSTEM_MOVESIZEEND,
                                    std::ptr::null_mut(),
                                    Some(on_host_event),
                                    h_pid,
                                    h_tid,
                                    WINEVENT_OUTOFCONTEXT,
                                );
                            }
                        }
                    }

                    if !GetWindow(pet_hwnd, GW_OWNER).is_null() {
                        SetWindowLongPtrW(pet_hwnd, -8, 0);
                    }
                    previous_foreground = fg_win;
                    let available = is_window_available(last_host);
                    if !available {
                        HOST_MOVING.store(false, Ordering::Relaxed);
                    }
                    if available && !host_was_available {
                        FOLLOW_LAST.store(i64::MAX, Ordering::Relaxed);
                        restore_generation = restore_generation.wrapping_add(1);
                    }
                    host_was_available = available;
                    if available {
                        follow_tick();
                    }
                    stack_with_host(pet_hwnd, last_host);
                    let _ = WAKE_CHECK.swap(false, Ordering::Relaxed);
                    let bounds = if available {
                        client_bounds_phys(last_host)
                    } else {
                        None
                    };
                    let update = ForegroundUpdate {
                        foreground_kind: foreground_kind.clone(),
                        host_bounds_phys: bounds,
                        attached: !last_host.is_null(),
                        native_following: true,
                        restore_generation,
                        host_id: (last_host as isize).to_string(),
                    };
                    if last_emitted.as_ref() != Some(&update) {
                        last_emitted = Some(update.clone());
                        on_change(update);
                    }
                } else {
                    if !location_hook.is_null() {
                        UnhookWinEvent(location_hook);
                        location_hook = std::ptr::null_mut();
                    }
                    if !drag_hook.is_null() {
                        UnhookWinEvent(drag_hook);
                        drag_hook = std::ptr::null_mut();
                    }
                    HOST_MOVING.store(false, Ordering::Relaxed);
                    tracked_host = std::ptr::null_mut();
                    FOLLOW_ACTIVE.store(false, Ordering::Relaxed);
                    FOLLOW_PET.store(0, Ordering::Relaxed);
                    FOLLOW_HOST.store(0, Ordering::Relaxed);
                    host_was_available = false;
                    previous_foreground = fg_win;

                    let available = is_window_available(last_host);
                    let bounds = if available {
                        client_bounds_phys(last_host)
                    } else {
                        None
                    };
                    let update = ForegroundUpdate {
                        foreground_kind: foreground_kind.clone(),
                        host_bounds_phys: bounds,
                        attached: false,
                        native_following: false,
                        restore_generation,
                        host_id: (last_host as isize).to_string(),
                    };
                    if last_emitted.as_ref() != Some(&update) {
                        last_emitted = Some(update.clone());
                        on_change(update);
                    }
                }

                if app_state.quitting.load(Ordering::Relaxed) {
                    break;
                }
                let fast = HOST_MOVING.load(Ordering::Relaxed)
                    || now_epoch_ms().saturating_sub(LAST_HOST_MOVE_MS.load(Ordering::Relaxed)) < 120;
                if fast && !precise_timer {
                    precise_timer = timeBeginPeriod(1) == 0;
                } else if !fast && precise_timer {
                    timeEndPeriod(1);
                    precise_timer = false;
                }
                let waited = MsgWaitForMultipleObjectsEx(
                    0,
                    std::ptr::null(),
                    if fast { 2 } else { 32 },
                    QS_ALLINPUT,
                    4, // MWMO_INPUTAVAILABLE
                );
                if waited == 0xFFFF_FFFF {
                    thread::sleep(std::time::Duration::from_millis(if fast { 2 } else { 32 }));
                }
            }

            if !location_hook.is_null() {
                UnhookWinEvent(location_hook);
            }
            if !drag_hook.is_null() {
                UnhookWinEvent(drag_hook);
            }
            if !focus_hook.is_null() {
                UnhookWinEvent(focus_hook);
            }
            if !reorder_hook.is_null() {
                UnhookWinEvent(reorder_hook);
            }
            if precise_timer {
                timeEndPeriod(1);
            }
            let pet_hwnd = FOLLOW_PET.load(Ordering::Relaxed) as HWND;
            if !pet_hwnd.is_null() && IsWindow(pet_hwnd) != 0 {
                SetWindowPos(
                    pet_hwnd,
                    HWND_NOTOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS,
                );
            }
        });
    }
}

#[cfg(not(windows))]
mod win {
    use super::*;
    pub fn set_dragging_flag(_dragging: bool) {}
    pub fn apply_tool_window_style(_hwnd: isize) {}
    pub fn is_tool_window(_hwnd: isize) -> bool {
        false
    }
    pub fn get_window_bounds_phys(_hwnd: isize) -> Option<Rect> {
        None
    }
    pub fn set_window_bounds_phys(_hwnd: isize, _bounds: Rect) {}
    pub fn set_topmost(_hwnd: isize, _topmost: bool, _force: bool) {}
    pub fn move_top(_hwnd: isize) {}
    pub fn get_cursor_pos_phys() -> Option<(i32, i32)> {
        None
    }
    pub fn is_left_button_down() -> bool {
        false
    }
    pub fn is_window_responsive(_hwnd: isize) -> bool {
        true
    }
    pub fn enumerate_displays() -> Vec<DisplayInfo> {
        vec![]
    }
    pub fn display_for_phys_point(_x: i32, _y: i32) -> Option<DisplayInfo> {
        None
    }
    pub fn display_for_phys_rect(_rect: Rect) -> Option<DisplayInfo> {
        None
    }
    pub fn spawn_foreground_monitor<F>(_app_state: Arc<SharedApp>, _on_change: F)
    where
        F: Fn(ForegroundUpdate) + Send + Sync + 'static,
    {
    }
}

pub use win::*;
