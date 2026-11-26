use crate::state::SharedApp;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;

#[cfg(windows)]
pub fn spawn_global_hotkeys<F, G>(
    app_state: Arc<SharedApp>,
    on_recall: F,
    on_unstick_and_recall: G,
) where
    F: Fn() + Send + 'static,
    G: Fn() + Send + 'static,
{
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};

    thread::spawn(move || unsafe {
        const HK_RECALL: i32 = 1;
        const HK_UNSTICK: i32 = 2;
        let vk_g = b'G' as u32;

        // Non-fatal if another live instance (e.g. production Electron) holds these shortcuts.
        let r1 = RegisterHotKey(
            std::ptr::null_mut(),
            HK_RECALL,
            MOD_CONTROL | MOD_ALT | MOD_NOREPEAT,
            vk_g,
        );
        let r2 = RegisterHotKey(
            std::ptr::null_mut(),
            HK_UNSTICK,
            MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT,
            vk_g,
        );

        if r1 == 0 && r2 == 0 {
            return;
        }

        let mut msg = std::mem::zeroed::<MSG>();
        while !app_state.quitting.load(Ordering::Relaxed) {
            let ret = GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0);
            if ret <= 0 || app_state.quitting.load(Ordering::Relaxed) {
                break;
            }
            if msg.message == WM_HOTKEY {
                match msg.wParam as i32 {
                    HK_RECALL => on_recall(),
                    HK_UNSTICK => on_unstick_and_recall(),
                    _ => {}
                }
            }
        }

        if r1 != 0 {
            UnregisterHotKey(std::ptr::null_mut(), HK_RECALL);
        }
        if r2 != 0 {
            UnregisterHotKey(std::ptr::null_mut(), HK_UNSTICK);
        }
    });
}

#[cfg(not(windows))]
pub fn spawn_global_hotkeys<F, G>(
    _app_state: Arc<SharedApp>,
    _on_recall: F,
    _on_unstick_and_recall: G,
) where
    F: Fn() + Send + 'static,
    G: Fn() + Send + 'static,
{
}
