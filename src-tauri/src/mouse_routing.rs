use crate::state::{HitRect, SharedApp};
use serde_json::json;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, WebviewWindow};

pub fn hit_test(rects: &[HitRect], lx: f64, ly: f64) -> bool {
    rects.iter().any(|r| {
        r.w > 0.0 && r.h > 0.0 && lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h
    })
}

pub fn set_ignored_with_notify(
    app_state: &SharedApp,
    window: &WebviewWindow,
    want_ignored: bool,
    coords: Option<(f64, f64)>,
) {
    let prev = app_state.ignored.swap(want_ignored, Ordering::Relaxed);
    if prev == want_ignored {
        return;
    }
    let w = window.clone();
    let _ = window.run_on_main_thread(move || {
        let _ = w.set_ignore_cursor_events(want_ignored);
    });
    if want_ignored {
        let _ = window.emit("widget://mouse-left", ());
    } else if let Some((x, y)) = coords {
        let _ = window.emit("widget://mouse-entered", json!({ "x": x, "y": y }));
    }
}

pub fn sync_click_through(app_state: &SharedApp, window: &WebviewWindow) {
    if app_state.dragging.load(Ordering::Relaxed) {
        let prev = app_state.ignored.swap(false, Ordering::Relaxed);
        if prev {
            let w = window.clone();
            let _ = window.run_on_main_thread(move || {
                let _ = w.set_ignore_cursor_events(false);
            });
        }
        return;
    }
    if app_state.click_through.load(Ordering::Relaxed) {
        set_ignored_with_notify(app_state, window, true, None);
    }
}

#[cfg(windows)]
pub fn spawn_mouse_routing(app_state: Arc<SharedApp>, window: WebviewWindow) {
    thread::spawn(move || {
        use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
        use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
        use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetClientRect, GetCursorPos, IsWindow};

        while !app_state.quitting.load(Ordering::Relaxed) {
            let hwnd = app_state.pet_hwnd.load(Ordering::Relaxed) as HWND;
            if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 {
                thread::sleep(Duration::from_millis(50));
                continue;
            }
            if app_state.dragging.load(Ordering::Relaxed) {
                if app_state.ignored.swap(false, Ordering::Relaxed) {
                    let w = window.clone();
                    let _ = window.run_on_main_thread(move || {
                        let _ = w.set_ignore_cursor_events(false);
                    });
                }
                thread::sleep(Duration::from_millis(24));
                continue;
            }
            let visible = app_state.runtime.lock().unwrap().window_visible;
            if !visible {
                thread::sleep(Duration::from_millis(50));
                continue;
            }
            if app_state.click_through.load(Ordering::Relaxed) {
                set_ignored_with_notify(&app_state, &window, true, None);
                thread::sleep(Duration::from_millis(50));
                continue;
            }

            let mut pt = POINT { x: 0, y: 0 };
            let mut client_rect = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            let mut origin = POINT { x: 0, y: 0 };
            let ok = unsafe {
                GetCursorPos(&mut pt) != 0
                    && GetClientRect(hwnd, &mut client_rect) != 0
                    && ClientToScreen(hwnd, &mut origin) != 0
            };
            if !ok {
                thread::sleep(Duration::from_millis(50));
                continue;
            }

            let px = pt.x - origin.x;
            let py = pt.y - origin.y;
            let pw = client_rect.right - client_rect.left;
            let ph = client_rect.bottom - client_rect.top;
            if px < 0 || py < 0 || px >= pw || py >= ph {
                set_ignored_with_notify(&app_state, &window, true, None);
                thread::sleep(Duration::from_millis(50));
                continue;
            }

            let dpi = unsafe { GetDpiForWindow(hwnd) };
            let scale = if dpi > 0 { dpi as f64 / 96.0 } else { 1.0 };
            let lx = px as f64 / scale;
            let ly = py as f64 / scale;

            let active = {
                let rects = app_state.hit_rects.lock().unwrap();
                hit_test(&rects, lx, ly)
            };
            let want_ignored = app_state.click_through.load(Ordering::Relaxed) || !active;
            set_ignored_with_notify(
                &app_state,
                &window,
                want_ignored,
                if want_ignored { None } else { Some((lx, ly)) },
            );

            thread::sleep(Duration::from_millis(16));
        }
    });
}

#[cfg(not(windows))]
pub fn spawn_mouse_routing(_app_state: Arc<SharedApp>, _window: WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hit_test_matches_multiple_dynamic_rects_and_rejects_gaps() {
        let rects = vec![
            HitRect {
                x: 10.0,
                y: 8.0,
                w: 338.0,
                h: 210.0,
            },
            HitRect {
                x: 70.0,
                y: 380.0,
                w: 220.0,
                h: 220.0,
            },
            HitRect {
                x: 295.0,
                y: 440.0,
                w: 44.0,
                h: 98.0,
            },
        ];

        assert!(hit_test(&rects, 120.0, 100.0)); // bubble
        assert!(!hit_test(&rects, 180.0, 290.0)); // transparent gap
        assert!(hit_test(&rects, 180.0, 480.0)); // mascot
        assert!(hit_test(&rects, 315.0, 480.0)); // side quota trigger
        assert!(!hit_test(&rects, 4.0, 500.0)); // outside all rects
    }
}
