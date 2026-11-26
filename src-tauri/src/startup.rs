use crate::host_cdp::is_host_process_running;
use serde_json::{json, Value};
use std::process::Command;
use std::thread;
use std::time::Duration;

#[cfg(windows)]
const STARTUP_REG_KEY: &str = r"HKCU\Software\Catstella\Startup";
#[cfg(windows)]
const RUN_REG_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const RUN_VALUE_NAME: &str = "CatstellaWatcher";

pub fn should_launch(
    auto_start: bool,
    host_link: bool,
    first: bool,
    host_running: bool,
    prev_host_running: bool,
) -> bool {
    (auto_start && first) || (host_link && host_running && !prev_host_running)
}

#[cfg(windows)]
mod win_impl {
    use super::*;
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
    use windows_sys::Win32::System::Threading::{
        OpenEventW, ResetEvent, SetEvent, WaitForSingleObject, CREATE_NO_WINDOW,
        EVENT_MODIFY_STATE,
    };

    const WAIT_OBJECT_0: u32 = 0;
    const SYNCHRONIZE_FLAG: u32 = 0x0010_0000;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateEventW(
            lp_event_attributes: *const c_void,
            b_manual_reset: i32,
            b_initial_state: i32,
            lp_name: *const u16,
        ) -> HANDLE;
        fn CreateMutexW(
            lp_mutex_attributes: *const c_void,
            b_initial_owner: i32,
            lp_name: *const u16,
        ) -> HANDLE;
    }

    fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn run_reg(args: &[&str]) -> Result<String, String> {
        let out = Command::new("reg.exe")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("reg.exe 失败: {e}"))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if err.is_empty() {
                format!("reg.exe 退出码 {:?}", out.status.code())
            } else {
                err
            });
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    fn read_reg_dword(key: &str, name: &str) -> bool {
        let Ok(out) = run_reg(&["query", key, "/v", name]) else {
            return false;
        };
        for line in out.lines() {
            if line.to_ascii_lowercase().contains(&name.to_ascii_lowercase()) {
                if let Some(last) = line.split_whitespace().last() {
                    if let Some(hex) = last.strip_prefix("0x").or_else(|| last.strip_prefix("0X")) {
                        return u64::from_str_radix(hex, 16).unwrap_or(0) == 1;
                    }
                    return last.parse::<u64>().unwrap_or(0) == 1;
                }
            }
        }
        false
    }

    fn has_reg_value(key: &str, name: &str) -> bool {
        run_reg(&["query", key, "/v", name]).is_ok()
    }

    fn create_named_event(name: &str, manual_reset: bool) -> HANDLE {
        let wide = to_wide(name);
        unsafe { CreateEventW(std::ptr::null(), if manual_reset { 1 } else { 0 }, 0, wide.as_ptr()) }
    }

    fn signal_named_event(name: &str) -> bool {
        let wide = to_wide(name);
        unsafe {
            let h = OpenEventW(EVENT_MODIFY_STATE | SYNCHRONIZE_FLAG, 0, wide.as_ptr());
            if h.is_null() {
                return false;
            }
            let ok = SetEvent(h) != 0;
            let _ = CloseHandle(h);
            ok
        }
    }

    fn reset_named_event(h: HANDLE) {
        if !h.is_null() {
            unsafe {
                let _ = ResetEvent(h);
            }
        }
    }

    fn wait_event_zero(h: HANDLE) -> bool {
        if h.is_null() {
            return false;
        }
        unsafe { WaitForSingleObject(h, 0) == WAIT_OBJECT_0 }
    }

    pub struct InstanceGuard {
        handle: HANDLE,
    }

    impl Drop for InstanceGuard {
        fn drop(&mut self) {
            if !self.handle.is_null() {
                unsafe {
                    let _ = CloseHandle(self.handle);
                }
                self.handle = std::ptr::null_mut();
            }
        }
    }

    pub fn try_acquire_single_instance(open_settings: bool, wait_for_exit: bool) -> Option<InstanceGuard> {
        acquire_named_instance(r"Local\CatstellaSingleInstanceMutex", open_settings, wait_for_exit)
    }

    fn acquire_named_instance(name: &str, open_settings: bool, wait_for_exit: bool) -> Option<InstanceGuard> {
        let wide = to_wide(name);
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            let handle = unsafe { CreateMutexW(std::ptr::null(), 1, wide.as_ptr()) };
            if handle.is_null() {
                return None;
            }
            let err = unsafe { GetLastError() };
            if err != ERROR_ALREADY_EXISTS {
                return Some(InstanceGuard { handle });
            }
            unsafe { let _ = CloseHandle(handle); }
            if wait_for_exit {
                if std::time::Instant::now() >= deadline {
                    return None;
                }
                thread::sleep(Duration::from_millis(50));
                continue;
            }
            let evt = if open_settings {
                r"Local\CatstellaOpenSettingsEvent"
            } else {
                r"Local\CatstellaRecallEvent"
            };
            let _ = signal_named_event(evt);
            return None;
        }
    }

    #[test]
    fn restart_waits_for_old_mutex_handle_to_close() {
        let name = format!(r"Local\CatstellaRestartTest-{}", std::process::id());
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let owner_name = name.clone();
        let owner = thread::spawn(move || {
            let guard = acquire_named_instance(&owner_name, false, false).unwrap();
            ready_tx.send(()).unwrap();
            thread::sleep(Duration::from_millis(200));
            drop(guard);
        });
        ready_rx.recv().unwrap();
        let start = std::time::Instant::now();
        let next = acquire_named_instance(&name, false, true).unwrap();
        assert!(start.elapsed() >= Duration::from_millis(150));
        owner.join().unwrap();
        drop(next);
    }

    pub fn signal_quit_existing() {
        let _ = signal_named_event(r"Local\CatstellaQuitEvent");
        let _ = signal_named_event(r"Local\CatstellaWatcherStopEvent");
    }

    pub fn signal_restart_existing() {
        let _ = signal_named_event(r"Local\CatstellaRestartEvent");
    }

    pub fn spawn_ipc_listener<FStop, FQuit, FRecall, FSettings, FRestart>(
        is_quitting: FStop,
        on_quit: FQuit,
        on_recall: FRecall,
        on_settings: FSettings,
        on_restart: FRestart,
    ) where
        FStop: Fn() -> bool + Send + 'static,
        FQuit: Fn() + Send + 'static,
        FRecall: Fn() + Send + 'static,
        FSettings: Fn() + Send + 'static,
        FRestart: Fn() + Send + 'static,
    {
        thread::spawn(move || {
            let quit_ev = create_named_event(r"Local\CatstellaQuitEvent", false);
            let recall_ev = create_named_event(r"Local\CatstellaRecallEvent", false);
            let settings_ev = create_named_event(r"Local\CatstellaOpenSettingsEvent", false);
            let restart_ev = create_named_event(r"Local\CatstellaRestartEvent", false);
            while !is_quitting() {
                if wait_event_zero(quit_ev) {
                    on_quit();
                    break;
                }
                if wait_event_zero(recall_ev) {
                    on_recall();
                }
                if wait_event_zero(settings_ev) {
                    on_settings();
                }
                if wait_event_zero(restart_ev) {
                    on_restart();
                    break;
                }
                thread::sleep(Duration::from_millis(150));
            }
            for h in [quit_ev, recall_ev, settings_ev, restart_ev] {
                if !h.is_null() {
                    unsafe {
                        let _ = CloseHandle(h);
                    }
                }
            }
        });
    }

    pub fn get_startup_config() -> Value {
        let auto_start = read_reg_dword(STARTUP_REG_KEY, "AutoStart");
        let host_link = read_reg_dword(STARTUP_REG_KEY, "HostLink");
        let watcher_registered = has_reg_value(RUN_REG_KEY, RUN_VALUE_NAME);
        json!({
            "supported": true,
            "autoStart": auto_start,
            "hostLink": host_link,
            "watcherRegistered": watcher_registered
        })
    }

    pub fn set_startup_config(auto_start: bool, host_link: bool) -> Result<Value, String> {
        let exe = std::env::current_exe().map_err(|e| format!("无法获取当前程序路径: {e}"))?;
        let install_dir = exe
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let auto_val = if auto_start { "1" } else { "0" };
        let link_val = if host_link { "1" } else { "0" };

        run_reg(&[
            "add",
            STARTUP_REG_KEY,
            "/v",
            "AutoStart",
            "/t",
            "REG_DWORD",
            "/d",
            auto_val,
            "/f",
        ])?;
        run_reg(&[
            "add",
            STARTUP_REG_KEY,
            "/v",
            "HostLink",
            "/t",
            "REG_DWORD",
            "/d",
            link_val,
            "/f",
        ])?;
        if !install_dir.is_empty() {
            run_reg(&[
                "add",
                STARTUP_REG_KEY,
                "/v",
                "InstallPath",
                "/t",
                "REG_SZ",
                "/d",
                &install_dir,
                "/f",
            ])?;
        }

        if auto_start || host_link {
            let cmd = format!("\"{}\" --watch-host", exe.to_string_lossy());
            run_reg(&[
                "add",
                RUN_REG_KEY,
                "/v",
                RUN_VALUE_NAME,
                "/t",
                "REG_SZ",
                "/d",
                &cmd,
                "/f",
            ])?;
            let stop_ev = create_named_event(r"Local\CatstellaWatcherStopEvent", false);
            reset_named_event(stop_ev);
            if !stop_ev.is_null() {
                unsafe {
                    let _ = CloseHandle(stop_ev);
                }
            }
            let _ = Command::new(&exe)
                .arg("--watch-host")
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
        } else {
            let _ = run_reg(&["delete", RUN_REG_KEY, "/v", RUN_VALUE_NAME, "/f"]);
            let _ = signal_named_event(r"Local\CatstellaWatcherStopEvent");
        }

        Ok(get_startup_config())
    }

    pub fn run_host_watcher() {
        let wide = to_wide(r"Local\CatstellaHostWatcherMutex");
        let mutex = unsafe { CreateMutexW(std::ptr::null(), 1, wide.as_ptr()) };
        if mutex.is_null() {
            return;
        }
        let err = unsafe { GetLastError() };
        if err == ERROR_ALREADY_EXISTS {
            unsafe {
                let _ = CloseHandle(mutex);
            }
            return;
        }

        let stop_ev = create_named_event(r"Local\CatstellaWatcherStopEvent", false);
        reset_named_event(stop_ev);

        let Ok(exe) = std::env::current_exe() else {
            unsafe {
                if !stop_ev.is_null() {
                    let _ = CloseHandle(stop_ev);
                }
                let _ = CloseHandle(mutex);
            }
            return;
        };

        let mut first = true;
        let mut prev_host_running = false;

        loop {
            let auto_start = read_reg_dword(STARTUP_REG_KEY, "AutoStart");
            let host_link = read_reg_dword(STARTUP_REG_KEY, "HostLink");
            if !auto_start && !host_link {
                break;
            }
            let host_running = host_link && is_host_process_running();
            if should_launch(auto_start, host_link, first, host_running, prev_host_running) {
                let _ = Command::new(&exe)
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn();
            }
            if !host_link {
                break;
            }
            first = false;
            prev_host_running = host_running;

            let stop_now = !stop_ev.is_null()
                && unsafe { WaitForSingleObject(stop_ev, 2000) == WAIT_OBJECT_0 };
            if stop_now {
                break;
            }
        }

        unsafe {
            if !stop_ev.is_null() {
                let _ = CloseHandle(stop_ev);
            }
            let _ = CloseHandle(mutex);
        }
    }
}

#[cfg(not(windows))]
mod win_impl {
    use super::*;

    pub struct InstanceGuard;

    pub fn try_acquire_single_instance(_open_settings: bool, _wait_for_exit: bool) -> Option<InstanceGuard> {
        Some(InstanceGuard)
    }

    pub fn signal_quit_existing() {}
    pub fn signal_restart_existing() {}

    pub fn spawn_ipc_listener<FStop, FQuit, FRecall, FSettings, FRestart>(
        _is_quitting: FStop,
        _on_quit: FQuit,
        _on_recall: FRecall,
        _on_settings: FSettings,
        _on_restart: FRestart,
    ) where
        FStop: Fn() -> bool + Send + 'static,
        FQuit: Fn() + Send + 'static,
        FRecall: Fn() + Send + 'static,
        FSettings: Fn() + Send + 'static,
        FRestart: Fn() + Send + 'static,
    {
    }

    pub fn get_startup_config() -> Value {
        json!({
            "supported": false,
            "autoStart": false,
            "hostLink": false,
            "watcherRegistered": false
        })
    }

    pub fn set_startup_config(_auto_start: bool, _host_link: bool) -> Result<Value, String> {
        Ok(get_startup_config())
    }

    pub fn run_host_watcher() {}
}

pub use win_impl::{
    get_startup_config, run_host_watcher, set_startup_config, signal_quit_existing,
    spawn_ipc_listener, try_acquire_single_instance,
    signal_restart_existing,
};

#[cfg(test)]
mod tests {
    use super::should_launch;

    #[test]
    fn host_watcher_launch_matrix_matches_contract() {
        // Autostart triggers on first tick even without host
        assert!(should_launch(true, false, true, false, false));
        assert!(!should_launch(true, false, false, false, false));

        // Host-link triggers on offline -> running edge, never every poll while host stays open
        assert!(should_launch(false, true, true, true, false));
        assert!(should_launch(false, true, false, true, false));
        assert!(!should_launch(false, true, false, true, true));
        assert!(!should_launch(false, true, false, false, true));

        // Disabled flags never trigger
        assert!(!should_launch(false, false, true, true, false));
    }
}
