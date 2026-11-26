use crate::state::{now_ms, SharedApp};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

static SETTINGS_OPENING: AtomicBool = AtomicBool::new(false);

struct OpeningGuard;

impl Drop for OpeningGuard {
    fn drop(&mut self) {
        SETTINGS_OPENING.store(false, Ordering::Release);
    }
}

fn normalize_page(page: &str) -> &'static str {
    match page.trim() {
        "skin" | "wallpaper" => "skin",
        "quota" | "byok" | "models" => "quota",
        "link" | "agy" | "about" => "link",
        "store" => "store",
        "pet" | "overview" | "interact" | "" => "pet",
        _ => "pet",
    }
}

fn focus_existing(win: &WebviewWindow, page: &str) {
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
    if !page.is_empty() {
        let _ = win.emit("widget://navigate", normalize_page(page));
    }
}

fn log_open_error(data_dir: &Path, err: &str) {
    eprintln!("[catstella] open_settings failed: {err}");
    let _ = fs::create_dir_all(data_dir);
    let log_path = data_dir.join("settings-window.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(file, "[{}] open_settings failed: {err}", now_ms());
    }
}

pub fn open_settings(app: &AppHandle, state: &Arc<SharedApp>, target_page: &str) {
    let app = app.clone();
    let state = Arc::clone(state);
    let page = target_page.trim().to_string();

    if let Some(existing) = app.get_webview_window("settings") {
        thread::spawn(move || {
            focus_existing(&existing, &page);
        });
        return;
    }

    if SETTINGS_OPENING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    // Never call WebviewWindowBuilder::build() synchronously inside WebMessageReceived or MenuEvent
    // callbacks on Windows WebView2 (tauri-apps/wry#583 deadlock).
    thread::spawn(move || {
        let _guard = OpeningGuard;

        if let Some(existing) = app.get_webview_window("settings") {
            focus_existing(&existing, &page);
            return;
        }

        let (work_w, work_h, wv2_dir, browser_args, data_dir): (
            f64,
            f64,
            PathBuf,
            String,
            PathBuf,
        ) = {
            let rt = state.runtime.lock().unwrap();
            let primary = rt
                .displays
                .iter()
                .find(|d| d.is_primary)
                .or_else(|| rt.displays.first())
                .copied();
            let (w, h) = primary
                .map(|d| (d.dip_work.width as f64, d.dip_work.height as f64))
                .unwrap_or((1920.0, 1040.0));
            let data_dir = rt
                .settings_path
                .parent()
                .map(Path::to_path_buf)
                .or_else(|| rt.wv2_dir.parent().map(Path::to_path_buf))
                .unwrap_or_else(std::env::temp_dir);
            (w, h, rt.wv2_dir.clone(), rt.browser_args.clone(), data_dir)
        };

        let pw = (work_w - 80.0).clamp(980.0, 1220.0);
        let ph = (work_h - 60.0).clamp(640.0, 800.0);
        let rel_url = if page.is_empty() {
            "src/renderer/settings.html".to_string()
        } else {
            format!("src/renderer/settings.html#{}", normalize_page(&page))
        };

        let mut builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(rel_url.into()))
            .title("Catstella · 设置中心")
            .inner_size(pw, ph)
            .min_inner_size(880.0, 600.0)
            .transparent(true)
            .decorations(false)
            .shadow(true)
            .resizable(true)
            .center();
        #[cfg(windows)]
        {
            builder = builder
                .data_directory(wv2_dir)
                .additional_browser_args(&browser_args);
        }
        #[cfg(not(windows))]
        {
            let _ = (&wv2_dir, &browser_args);
        }

        match builder.build()
        {
            Ok(win) => {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
                // Close MUST destroy the WebView2 instance so idle memory drops back to ~77 MB.
                win.on_window_event(|event| {
                    if let WindowEvent::Destroyed = event {
                        // Destroyed natively without keeping a hidden resident WebView2 instance.
                    }
                });
            }
            Err(err) => {
                log_open_error(&data_dir, &err.to_string());
            }
        }
    });
}

pub fn close_settings(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.close();
    }
}

pub fn minimize_settings(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.minimize();
    }
}
