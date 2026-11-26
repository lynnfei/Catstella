#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![recursion_limit = "256"]

mod assets;
mod companion_bridge;
mod drag;
mod dream_skin;
mod foreground;
mod host_cdp;
mod host_orchestrator;
mod hotkeys;
mod layout;
mod mouse_routing;
mod online;
mod settings_window;
mod startup;
mod state;
mod transcript;

use companion_bridge::BridgeSyncEffect;
use foreground::ForegroundUpdate;
use host_orchestrator::HostOrchestrator;
use layout::{DisplayInfo, Rect};
use online::OnlineMutation;
use serde_json::{json, Map, Value};
use state::{now_ms, resolve_effective_foreground, today_ymd, HitRect, SharedApp};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};

struct CliArgs {
    data_dir: PathBuf,
    skin_dir: PathBuf,
    explicit_data_dir: bool,
    benchmark_out: Option<PathBuf>,
    exit_after_ms: Option<u64>,
    demo_quota: bool,
    gpu_mode: String,
    test_drag: bool,
    settings_on_start: bool,
    bridge_port: Option<u16>,
    transcripts_dir: PathBuf,
    transcript_poll_ms: u64,
    no_transcripts: bool,
    no_hotkeys: bool,
    test_slideshow_ms: Option<u64>,
    isolated: bool,
    test_settings_cycle: bool,
    test_cdp_cycle: bool,
    no_host: bool,
    host_cdp_port: Option<u16>,
}

struct ManagedHost {
    orchestrator: Mutex<Option<Arc<HostOrchestrator>>>,
    explicit_port: Option<u16>,
    allow_host_probe: bool,
}

fn notify_host_changed(app: &AppHandle) {
    if let Some(hm) = app.try_state::<ManagedHost>() {
        if let Some(orch) = hm.orchestrator.lock().unwrap().as_ref().cloned() {
            orch.notify_settings_changed();
        }
    }
}

fn trigger_host_quota_refresh(app: &AppHandle) {
    if let Some(hm) = app.try_state::<ManagedHost>() {
        if let Some(orch) = hm.orchestrator.lock().unwrap().as_ref().cloned() {
            orch.trigger_quota_refresh();
        }
    }
}

fn trigger_host_quota_refresh_debounced(app: &AppHandle) {
    if let Some(hm) = app.try_state::<ManagedHost>() {
        if let Some(orch) = hm.orchestrator.lock().unwrap().as_ref().cloned() {
            orch.trigger_quota_refresh_debounced();
        }
    }
}

fn trigger_host_model_refresh(app: &AppHandle) {
    if let Some(hm) = app.try_state::<ManagedHost>() {
        if let Some(orch) = hm.orchestrator.lock().unwrap().as_ref().cloned() {
            orch.trigger_model_refresh();
        }
    }
}

fn stop_host_orchestrator(app: &AppHandle) {
    if let Some(hm) = app.try_state::<ManagedHost>() {
        let orch = hm.orchestrator.lock().unwrap().take();
        if let Some(o) = orch {
            o.stop();
        }
    }
}

fn filter_restart_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .filter(|arg| {
            !matches!(
                arg.as_str(),
                "--settings" | "--wait-single-instance" | "--test-drag" | "--test-settings-cycle" | "--test-cdp-cycle"
            ) && !arg.starts_with("--exit-after-ms=")
                && !arg.starts_with("--benchmark-out=")
                && !arg.starts_with("--test-slideshow-ms=")
        })
        .collect()
}

fn restart_suite(app: &AppHandle, app_state: &Arc<SharedApp>) {
    let Ok(exe) = std::env::current_exe() else {
        eprintln!("[catstella] restart failed: cannot resolve current executable");
        return;
    };
    if app_state.quitting.swap(true, Ordering::AcqRel) {
        return;
    }
    let h = app.clone();
    let st = Arc::clone(app_state);
    thread::spawn(move || {
        stop_host_orchestrator(&h);
        let now = now_ms() as i64;
        let _ = st.runtime.lock().unwrap().ledger.save(now);
        let child = std::process::Command::new(&exe)
            .args(filter_restart_args(std::env::args().skip(1)))
            .arg("--wait-single-instance")
            .spawn();
        if let Err(error) = child {
            eprintln!("[catstella] restart failed: {error}");
            st.quitting.store(false, Ordering::Release);
            return;
        }
        h.exit(0);
    });
}

#[derive(Clone)]
struct TrayHandles {
    inner: Arc<Mutex<Option<TrayCheckItems>>>,
}

struct TrayCheckItems {
    dream_enabled: CheckMenuItem<Wry>,
    host_only: CheckMenuItem<Wry>,
    standalone: CheckMenuItem<Wry>,
    bubble_on: CheckMenuItem<Wry>,
    always_on_top: CheckMenuItem<Wry>,
    click_through: CheckMenuItem<Wry>,
}

fn browser_args_for_gpu_mode(mode: &str) -> &'static str {
    match mode {
        "default" => "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
        "disable-gpu" => {
            "--disable-gpu --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        }
        "disable-gpu-compositing" => {
            "--disable-gpu --disable-gpu-compositing --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        }
        "low-mem" => {
            "--disable-gpu --renderer-process-limit=1 --js-flags=--max-old-space-size=96 --disable-extensions --disable-background-networking --disable-component-update --disable-sync --disable-default-apps --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,Translate,OptimizationHints,MediaRouter,BackForwardCache,PaintHolding"
        }
        "low-mem-sw" => {
            "--disable-gpu --disable-gpu-compositing --renderer-process-limit=1 --js-flags=--max-old-space-size=96 --disable-extensions --disable-background-networking --disable-component-update --disable-sync --disable-default-apps --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,Translate,OptimizationHints,MediaRouter,BackForwardCache,PaintHolding"
        }
        _ => "--disable-gpu --renderer-process-limit=1 --js-flags=--max-old-space-size=96 --disable-extensions --disable-background-networking --disable-component-update --disable-sync --disable-default-apps --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,Translate,OptimizationHints,MediaRouter,BackForwardCache,PaintHolding",
    }
}

fn parse_args() -> CliArgs {
    let mut data_dir = std::env::temp_dir().join("catstella");
    let mut explicit_data_dir = false;
    let mut benchmark_out = None;
    let mut exit_after_ms = None;
    let mut demo_quota = false;
    let mut gpu_mode = "low-mem".to_string();
    let mut test_drag = false;
    let mut settings_on_start = false;
    let mut bridge_port = None;
    let mut transcripts_dir = transcript::default_transcripts_dir();
    let mut transcript_poll_ms = 800u64;
    let mut no_transcripts = false;
    let mut no_hotkeys = false;
    let mut test_slideshow_ms = None;
    let mut isolated = false;
    let mut test_settings_cycle = false;
    let mut test_cdp_cycle = false;
    let mut no_host = false;
    let mut host_cdp_port = None;

    for arg in std::env::args().skip(1) {
        if let Some(val) = arg.strip_prefix("--data-dir=") {
            if !val.trim().is_empty() {
                data_dir = PathBuf::from(val);
                explicit_data_dir = true;
            }
        } else if let Some(val) = arg.strip_prefix("--benchmark-out=") {
            if !val.trim().is_empty() {
                benchmark_out = Some(PathBuf::from(val));
            }
        } else if let Some(val) = arg.strip_prefix("--exit-after-ms=") {
            if let Ok(ms) = val.parse::<u64>() {
                exit_after_ms = Some(ms);
            }
        } else if let Some(val) = arg.strip_prefix("--gpu-mode=") {
            if !val.trim().is_empty() {
                gpu_mode = val.trim().to_string();
            }
        } else if let Some(val) = arg.strip_prefix("--bridge-port=") {
            if let Ok(p) = val.parse::<u16>() {
                bridge_port = Some(p);
            }
        } else if let Some(val) = arg.strip_prefix("--transcripts-dir=") {
            if !val.trim().is_empty() {
                transcripts_dir = PathBuf::from(val);
            }
        } else if let Some(val) = arg.strip_prefix("--transcript-poll-ms=") {
            if let Ok(ms) = val.parse::<u64>() {
                transcript_poll_ms = ms.max(100);
            }
        } else if let Some(val) = arg.strip_prefix("--test-slideshow-ms=") {
            if let Ok(ms) = val.parse::<u64>() {
                test_slideshow_ms = Some(ms);
            }
        } else if arg == "--demo-quota" {
            demo_quota = true;
        } else if arg == "--test-drag" {
            test_drag = true;
        } else if arg == "--settings" {
            settings_on_start = true;
        } else if arg == "--no-transcripts" {
            no_transcripts = true;
        } else if arg == "--no-hotkeys" {
            no_hotkeys = true;
        } else if arg == "--isolated" {
            isolated = true;
        } else if arg == "--test-settings-cycle" {
            test_settings_cycle = true;
        } else if arg == "--test-cdp-cycle" {
            test_cdp_cycle = true;
        } else if arg == "--no-host" {
            no_host = true;
        } else if let Some(val) = arg.strip_prefix("--host-cdp-port=") {
            if let Ok(p) = val.parse::<u16>() {
                if p > 0 {
                    host_cdp_port = Some(p);
                }
            }
        }
    }

    let home_dir = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    if !explicit_data_dir {
        data_dir = if isolated {
            std::env::temp_dir().join("catstella-isolated")
        } else if let Some(ref home) = home_dir {
            home.join(".antigravity-cat-widget")
        } else {
            std::env::temp_dir().join("catstella")
        };
    }
    let skin_dir = if !explicit_data_dir && !isolated {
        home_dir
            .as_ref()
            .map(|h| h.join(".antigravity-dream-skin"))
            .unwrap_or_else(|| data_dir.join("skin"))
    } else {
        data_dir.join("skin")
    };

    CliArgs {
        data_dir,
        skin_dir,
        explicit_data_dir,
        benchmark_out,
        exit_after_ms,
        demo_quota,
        gpu_mode,
        test_drag,
        settings_on_start,
        bridge_port,
        transcripts_dir,
        transcript_poll_ms,
        no_transcripts,
        no_hotkeys,
        test_slideshow_ms,
        isolated,
        test_settings_cycle,
        test_cdp_cycle,
        no_host,
        host_cdp_port,
    }
}

fn broadcast_snapshot(app: &AppHandle, app_state: &SharedApp) {
    let snap = app_state.build_snapshot();
    if let Some(pet) = app.get_webview_window("pet") {
        let _ = pet.emit("widget://snapshot", &snap);
    }
    if let Some(settings) = app.get_webview_window("settings") {
        let _ = settings.emit("widget://snapshot", &snap);
    }
}

fn sync_tray_checks(app: &AppHandle, app_state: &SharedApp) {
    let Some(handles) = app.try_state::<TrayHandles>() else {
        return;
    };
    let guard = handles.inner.lock().unwrap();
    let Some(ref items) = *guard else {
        return;
    };
    let (host_only, standalone, bubble_on, always_on_top, click_through, dream_on) = {
        let rt = app_state.runtime.lock().unwrap();
        (
            rt.settings
                .get("hostWindowOnly")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            rt.settings
                .get("standaloneDesktopMode")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            rt.settings
                .get("bubbleOn")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            rt.settings
                .get("alwaysOnTop")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            rt.settings
                .get("clickThrough")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            rt.dream_skin
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        )
    };
    let _ = items.dream_enabled.set_checked(dream_on);
    let _ = items.host_only.set_checked(host_only);
    let _ = items.standalone.set_checked(host_only && standalone);
    let _ = items.standalone.set_enabled(host_only);
    let _ = items.bubble_on.set_checked(bubble_on);
    let _ = items.always_on_top.set_checked(!host_only && always_on_top);
    let _ = items.always_on_top.set_enabled(!host_only);
    let _ = items.click_through.set_checked(click_through);
}

fn schedule_slideshow(app: &AppHandle, app_state: &Arc<SharedApp>) {
    let (enabled, interval_ms, gen_id) = {
        let rt = app_state.runtime.lock().unwrap();
        let enabled = rt
            .dream_skin
            .get("slideshow")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let minutes = rt
            .dream_skin
            .get("slideshowIntervalMinutes")
            .and_then(|v| v.as_f64())
            .unwrap_or(5.0)
            .clamp(1.0, 60.0);
        let ms = match rt.test_slideshow_ms {
            Some(probe) if (100..=5000).contains(&probe) => probe,
            _ => (minutes * 60_000.0).round() as u64,
        };
        (enabled, ms, rt.slideshow_gen)
    };
    if !enabled {
        return;
    }
    let st = Arc::clone(app_state);
    let handle = app.clone();
    thread::spawn(move || {
        let mut elapsed = 0u64;
        while elapsed < interval_ms {
            if st.quitting.load(Ordering::Relaxed) {
                return;
            }
            let cur_gen = st.runtime.lock().unwrap().slideshow_gen;
            if cur_gen != gen_id {
                return;
            }
            let step = (interval_ms - elapsed).min(500);
            thread::sleep(Duration::from_millis(step));
            elapsed += step;
        }
        if st.quitting.load(Ordering::Relaxed) {
            return;
        }
        let cur_gen = st.runtime.lock().unwrap().slideshow_gen;
        if cur_gen != gen_id {
            return;
        }
        rotate_wallpaper(&handle, &st);
    });
}

fn rotate_wallpaper(app: &AppHandle, app_state: &Arc<SharedApp>) {
    let Some(patch) = app_state.next_wallpaper_patch() else {
        return;
    };
    if let Ok((_, ss_changed)) = app_state.update_dream_skin_transactional(&patch) {
        if ss_changed {
            schedule_slideshow(app, app_state);
        }
        notify_host_changed(app);
        let h = app.clone();
        let st = Arc::clone(app_state);
        let _ = app.run_on_main_thread(move || {
            broadcast_snapshot(&h, &st);
        });
    }
}

fn compute_desktop_placement(
    app_state: &SharedApp,
    saved_x: Option<i32>,
    saved_y: Option<i32>,
    previous_dip: Option<Rect>,
) -> Option<(layout::DesktopPlacement, DisplayInfo)> {
    let displays = foreground::enumerate_displays();
    let mut rt = app_state.runtime.lock().unwrap();
    if !displays.is_empty() {
        rt.displays = displays;
    }
    let preferred_scale = rt
        .settings
        .get("scale")
        .and_then(|v| v.as_i64())
        .unwrap_or(220) as i32;
    let saved_shift_x = rt
        .settings
        .get("desktopArtShiftX")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let saved_shift_y = rt
        .settings
        .get("desktopArtShiftY")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    layout::desktop_bounds(
        saved_x,
        saved_y,
        previous_dip,
        &rt.displays,
        preferred_scale,
        saved_shift_x,
        saved_shift_y,
        rt.art_shift,
        rt.art_shift_y,
    )
}

fn place_window_desktop(app_state: &SharedApp, window: &WebviewWindow, previous_dip: Option<Rect>) {
    let (saved_x, saved_y) = {
        let rt = app_state.runtime.lock().unwrap();
        let x = rt.settings.get("x").and_then(|v| v.as_i64()).map(|n| n as i32);
        let y = rt.settings.get("y").and_then(|v| v.as_i64()).map(|n| n as i32);
        (x, y)
    };
    if let Some((placed, disp)) = compute_desktop_placement(app_state, saved_x, saved_y, previous_dip) {
        let phys = disp.dip_to_phys(placed.placement.bounds);
        let hwnd = app_state.pet_hwnd.load(Ordering::Relaxed);
        foreground::set_window_bounds_phys(hwnd, phys);
        let mut rt = app_state.runtime.lock().unwrap();
        rt.display_scale = placed.scale;
        rt.art_shift = placed.placement.art_shift;
        rt.art_shift_y = placed.placement.art_shift_y;
        rt.dock_side = placed.dock_side;
        rt.active_display = Some(disp);
        rt.host_area = None;
        rt.host_area_phys = None;
        rt.host_layout_key.clear();
        let center_x = placed.placement.visual_x + placed.scale as f64 / 2.0;
        rt.facing = layout::facing_at(center_x, disp.dip_work, &rt.facing, 12.0);
    } else {
        let _ = window;
    }
}

fn apply_standalone_topmost(app_state: &SharedApp, force: bool) {
    let (want_top, host_only) = {
        let rt = app_state.runtime.lock().unwrap();
        (
            rt.settings
                .get("alwaysOnTop")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            rt.settings
                .get("hostWindowOnly")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        )
    };
    if host_only {
        return;
    }
    let hwnd = app_state.pet_hwnd.load(Ordering::Relaxed);
    foreground::set_topmost(hwnd, want_top, force);
}

fn sync_visibility(app_state: &SharedApp, window: &WebviewWindow) {
    if app_state.dragging.load(Ordering::Relaxed) {
        return;
    }
    let hwnd = app_state.pet_hwnd.load(Ordering::Relaxed);
    let (
        hide_for_web,
        host_only,
        standalone_fallback,
        scale,
        offset_x,
        offset_y,
        dock,
        host_phys,
    ) = {
        let now = now_ms();
        let mut rt = app_state.runtime.lock().unwrap();
        let pet_mode = rt
            .settings
            .get("petDisplayMode")
            .and_then(|v| v.as_str())
            .unwrap_or("both")
            .to_string();
        let (web_online, web_active, web_visible) = rt.web_companion.status_tuple(now);
        let fg_kind = rt.foreground_kind.clone();
        let hide_web = rt.companion_visibility.hide_desktop(
            &pet_mode,
            web_online,
            web_active,
            web_visible,
            &fg_kind,
        );
        (
            hide_web,
            rt.settings
                .get("hostWindowOnly")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            rt.settings
                .get("standaloneDesktopMode")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            rt.settings
                .get("scale")
                .and_then(|v| v.as_i64())
                .unwrap_or(220) as i32,
            rt.settings
                .get("hostOffsetX")
                .and_then(|v| v.as_i64())
                .unwrap_or(18) as i32,
            rt.settings
                .get("hostOffsetY")
                .and_then(|v| v.as_i64())
                .unwrap_or(18) as i32,
            rt.settings
                .get("hostDock")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            rt.host_area_phys,
        )
    };

    if hide_for_web {
        let _ = window.hide();
        app_state.runtime.lock().unwrap().window_visible = false;
        return;
    }

    if !host_only {
        apply_standalone_topmost(app_state, false);
        let was_visible = app_state.runtime.lock().unwrap().window_visible;
        if !was_visible {
            foreground::apply_tool_window_style(hwnd);
            let _ = window.show();
            apply_standalone_topmost(app_state, true);
            app_state.runtime.lock().unwrap().window_visible = true;
        }
        return;
    }

    let Some(h_phys) = host_phys else {
        let was_following = app_state.runtime.lock().unwrap().host_area.is_some();
        if standalone_fallback {
            if was_following || !app_state.runtime.lock().unwrap().window_visible {
                place_window_desktop(app_state, window, None);
                foreground::apply_tool_window_style(hwnd);
                let _ = window.show();
                apply_standalone_topmost(app_state, true);
                app_state.runtime.lock().unwrap().window_visible = true;
            }
        } else {
            let _ = window.hide();
            let mut rt = app_state.runtime.lock().unwrap();
            rt.host_area = None;
            rt.host_layout_key.clear();
            rt.window_visible = false;
        }
        return;
    };

    let Some(h_disp) = foreground::display_for_phys_rect(h_phys) else {
        return;
    };
    let h_dip = h_disp.phys_to_dip(h_phys);
    let Some(placed) = layout::host_placement("host", Some(h_dip), scale, offset_x, offset_y, &dock)
    else {
        let was_following = app_state.runtime.lock().unwrap().host_area.is_some();
        if standalone_fallback {
            if was_following {
                place_window_desktop(app_state, window, None);
                apply_standalone_topmost(app_state, true);
            }
        } else {
            let _ = window.hide();
            let mut rt = app_state.runtime.lock().unwrap();
            rt.host_area = None;
            rt.host_layout_key.clear();
            rt.window_visible = false;
        }
        return;
    };

    let layout_key = format!(
        "{}:{}:{}:{}:{}:{}:{}",
        placed.scale, h_dip.width, h_dip.height, offset_x, offset_y, dock, h_disp.scale
    );
    let need_reposition = {
        let mut rt = app_state.runtime.lock().unwrap();
        let prev_area = rt.host_area;
        let changed = rt.host_layout_key != layout_key || prev_area.is_none();
        rt.host_area = Some(h_dip);
        rt.host_layout_key = layout_key;
        rt.display_scale = placed.scale;
        rt.art_shift = placed.placement.art_shift;
        rt.art_shift_y = placed.placement.art_shift_y;
        rt.dock_side = if (placed.placement.visual_x - h_dip.x as f64).abs() < 2.0 {
            "left".to_string()
        } else if (placed.placement.visual_x + placed.scale as f64 - (h_dip.x + h_dip.width) as f64).abs() < 2.0 {
            "right".to_string()
        } else {
            String::new()
        };
        rt.facing = layout::facing_at(
            placed.placement.visual_x + placed.scale as f64 / 2.0,
            h_dip,
            &rt.facing,
            12.0,
        );
        rt.active_display = Some(h_disp);
        changed
    };

    if need_reposition {
        let target_phys = h_disp.dip_to_phys(placed.placement.bounds);
        foreground::set_window_bounds_phys(hwnd, target_phys);
    }

    let was_visible = app_state.runtime.lock().unwrap().window_visible;
    if !was_visible {
        foreground::apply_tool_window_style(hwnd);
        let _ = window.show();
        app_state.runtime.lock().unwrap().window_visible = true;
    }
}

fn dock_widget(app: &AppHandle, app_state: &SharedApp, _window: &WebviewWindow, side: &str) {
    let hwnd = app_state.pet_hwnd.load(Ordering::Relaxed);
    let displays = foreground::enumerate_displays();
    let (scale, host_area, host_phys, cur_disp, facing_prev) = {
        let mut rt = app_state.runtime.lock().unwrap();
        if !displays.is_empty() {
            rt.displays = displays;
        }
        (
            rt.settings.get("scale").and_then(|v| v.as_i64()).unwrap_or(220) as i32,
            rt.host_area,
            rt.host_area_phys,
            rt.active_display
                .or_else(|| rt.displays.iter().find(|d| d.is_primary).copied())
                .or_else(|| rt.displays.first().copied()),
            rt.facing.clone(),
        )
    };
    let disp = host_phys
        .and_then(foreground::display_for_phys_rect)
        .or(cur_disp)
        .unwrap_or(DisplayInfo {
            phys_work: Rect { x: 0, y: 0, width: 1920, height: 1080 },
            dip_work: Rect { x: 0, y: 0, width: 1920, height: 1080 },
            scale: 1.0,
            is_primary: true,
        });
    let area = host_area.unwrap_or(disp.dip_work);
    let dims = layout::widget_layout(area, scale);
    let target_left = if side == "left" {
        area.x as f64
    } else {
        (area.x + area.width - dims.scale) as f64
    };
    let target_top = (area.y + area.height - dims.height) as f64;
    let placed = layout::character_placement(area, dims.scale, dims, target_left, target_top);

    let phys = disp.dip_to_phys(placed.bounds);
    foreground::set_window_bounds_phys(hwnd, phys);

    {
        let mut rt = app_state.runtime.lock().unwrap();
        rt.display_scale = dims.scale;
        rt.art_shift = placed.art_shift;
        rt.art_shift_y = placed.art_shift_y;
        rt.dock_side = side.to_string();
        rt.facing = if side.is_empty() { facing_prev } else { side.to_string() };
        rt.active_display = Some(disp);
    }

    let mut patch = Map::new();
    if host_area.is_some() {
        patch.insert(
            "hostOffsetX".into(),
            json!(if side == "left" { area.width - dims.scale } else { 0 }),
        );
        patch.insert("hostOffsetY".into(), json!(0));
        patch.insert("hostDock".into(), json!(side));
    } else {
        patch.insert("x".into(), json!(placed.bounds.x));
        patch.insert("y".into(), json!(placed.bounds.y));
        patch.insert("desktopArtShiftX".into(), json!(placed.art_shift));
        patch.insert("desktopArtShiftY".into(), json!(placed.art_shift_y));
    }
    let _ = app_state.update_settings_transactional(&patch, false);
    broadcast_snapshot(app, app_state);
}

fn reset_widget(app: &AppHandle, app_state: &SharedApp, window: &WebviewWindow) {
    let is_host = {
        let rt = app_state.runtime.lock().unwrap();
        rt.settings
            .get("hostWindowOnly")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
            && rt.host_area.is_some()
    };
    if is_host {
        let mut patch = Map::new();
        patch.insert("hostOffsetX".into(), json!(18));
        patch.insert("hostOffsetY".into(), json!(18));
        patch.insert("hostDock".into(), json!(""));
        let _ = app_state.update_settings_transactional(&patch, false);
        sync_visibility(app_state, window);
        broadcast_snapshot(app, app_state);
        return;
    }

    if let Some((placed, disp)) = compute_desktop_placement(app_state, None, None, None) {
        let phys = disp.dip_to_phys(placed.placement.bounds);
        foreground::set_window_bounds_phys(app_state.pet_hwnd.load(Ordering::Relaxed), phys);
        {
            let mut rt = app_state.runtime.lock().unwrap();
            rt.display_scale = placed.scale;
            rt.art_shift = 0.0;
            rt.art_shift_y = 0.0;
            rt.dock_side.clear();
            rt.active_display = Some(disp);
        }
        let mut patch = Map::new();
        patch.insert("x".into(), json!(placed.placement.bounds.x));
        patch.insert("y".into(), json!(placed.placement.bounds.y));
        patch.insert("desktopArtShiftX".into(), json!(0));
        patch.insert("desktopArtShiftY".into(), json!(0));
        let _ = app_state.update_settings_transactional(&patch, false);
        recall_widget(app, app_state, window);
        broadcast_snapshot(app, app_state);
    }
}

fn recall_widget(app: &AppHandle, app_state: &SharedApp, window: &WebviewWindow) {
    let hwnd = app_state.pet_hwnd.load(Ordering::Relaxed);
    foreground::apply_tool_window_style(hwnd);
    let host_only = app_state
        .runtime
        .lock()
        .unwrap()
        .settings
        .get("hostWindowOnly")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !host_only {
        if let Some(cur_phys) = foreground::get_window_bounds_phys(hwnd) {
            if let Some(disp) = foreground::display_for_phys_rect(cur_phys) {
                let cur_dip = disp.phys_to_dip(cur_phys);
                let dip_areas: Vec<Rect> = app_state
                    .runtime
                    .lock()
                    .unwrap()
                    .displays
                    .iter()
                    .map(|d| d.dip_work)
                    .collect();
                let res = layout::reconcile_bounds_for_displays(cur_dip, &dip_areas, || {
                    compute_desktop_placement(app_state, None, None, None)
                        .map(|(p, _)| p.placement.bounds)
                });
                if res.actionable && res.changed {
                    if let Some(next_dip) = res.bounds {
                        foreground::set_window_bounds_phys(hwnd, disp.dip_to_phys(next_dip));
                    }
                }
            }
        }
        apply_standalone_topmost(app_state, true);
    } else {
        foreground::move_top(hwnd);
    }
    let _ = window.show();
    app_state.runtime.lock().unwrap().window_visible = true;
    sync_visibility(app_state, window);
    mouse_routing::sync_click_through(app_state, window);
    let _ = window.emit("widget://force-repaint", ());
    let _ = app;
}

fn apply_settings_patch(
    app: &AppHandle,
    app_state: &Arc<SharedApp>,
    pet_win: &WebviewWindow,
    patch: &Map<String, Value>,
) -> Result<Value, String> {
    if let Some(dream_val) = patch.get("dreamSkin").and_then(|v| v.as_object()) {
        let (_, ss_changed) = app_state.update_dream_skin_transactional(dream_val)?;
        if ss_changed {
            schedule_slideshow(app, app_state);
        }
        notify_host_changed(app);
    }

    let (old_scale, old_host_only) = {
        let rt = app_state.runtime.lock().unwrap();
        (
            rt.settings.get("scale").and_then(|v| v.as_i64()).unwrap_or(220) as i32,
            rt.settings
                .get("hostWindowOnly")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        )
    };

    let mut effective_patch = patch.clone();
    effective_patch.remove("dreamSkin");
    if !old_host_only && patch.get("hostWindowOnly").and_then(|v| v.as_bool()) == Some(true) {
        let hwnd = app_state.pet_hwnd.load(Ordering::Relaxed);
        if let Some(phys) = foreground::get_window_bounds_phys(hwnd) {
            if let Some(disp) = foreground::display_for_phys_rect(phys) {
                let dip = disp.phys_to_dip(phys);
                effective_patch.insert("x".into(), json!(dip.x));
                effective_patch.insert("y".into(), json!(dip.y));
            }
        }
    }

    let updated = app_state.update_settings_transactional(&effective_patch, false)?;
    let new_scale = updated.get("scale").and_then(|v| v.as_i64()).unwrap_or(220) as i32;
    let new_host_only = updated
        .get("hostWindowOnly")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if !new_host_only && old_host_only {
        {
            let mut rt = app_state.runtime.lock().unwrap();
            rt.art_shift = 0.0;
            rt.dock_side.clear();
        }
        place_window_desktop(app_state, pet_win, None);
    } else if new_scale != old_scale && app_state.runtime.lock().unwrap().host_area.is_none() {
        let hwnd = app_state.pet_hwnd.load(Ordering::Relaxed);
        let prev_dip = foreground::get_window_bounds_phys(hwnd).and_then(|p| {
            foreground::display_for_phys_rect(p).map(|d| d.phys_to_dip(p))
        });
        place_window_desktop(app_state, pet_win, prev_dip);
        let (pos_opt, sx, sy) = {
            let rt = app_state.runtime.lock().unwrap();
            (
                rt.active_display
                    .and_then(|d| {
                        foreground::get_window_bounds_phys(hwnd).map(|p| d.phys_to_dip(p))
                    })
                    .map(|b| (b.x, b.y)),
                rt.art_shift,
                rt.art_shift_y,
            )
        };
        if let Some((bx, by)) = pos_opt {
            let mut save_pos = Map::new();
            save_pos.insert("x".into(), json!(bx));
            save_pos.insert("y".into(), json!(by));
            save_pos.insert("desktopArtShiftX".into(), json!(sx));
            save_pos.insert("desktopArtShiftY".into(), json!(sy));
            let _ = app_state.update_settings_transactional(&save_pos, false);
        }
    }

    if !new_host_only {
        apply_standalone_topmost(app_state, false);
    }
    mouse_routing::sync_click_through(app_state, pet_win);
    sync_visibility(app_state, pet_win);
    sync_tray_checks(app, app_state);
    broadcast_snapshot(app, app_state);
    Ok(app_state.build_snapshot())
}

#[tauri::command]
fn widget_get(window: WebviewWindow, state: State<'_, Arc<SharedApp>>) -> Result<Value, String> {
    if !matches!(window.label(), "pet" | "settings") {
        return Err("forbidden window".into());
    }
    Ok(state.build_snapshot())
}

#[tauri::command]
fn widget_save(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
    patch: Value,
) -> Result<Value, String> {
    if !matches!(window.label(), "pet" | "settings") {
        return Err("forbidden window".into());
    }
    let map = patch
        .as_object()
        .ok_or_else(|| "patch must be a JSON object".to_string())?;
    let pet = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window missing".to_string())?;
    apply_settings_patch(&app, &state, &pet, map)
}

#[tauri::command]
fn widget_bubble_preference(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
    patch: Value,
) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("forbidden window".into());
    }
    let Some(obj) = patch.as_object() else {
        return Ok(());
    };
    let mut filtered = Map::new();
    if let Some(page) = obj.get("bubblePage").and_then(|v| v.as_str()) {
        if ["quota", "webQuota", "claudeGpt", "today", "latest", "talk"].contains(&page) {
            filtered.insert("bubblePage".into(), json!(page));
        }
    }
    if let Some(on) = obj.get("bubbleOn").and_then(|v| v.as_bool()) {
        filtered.insert("bubbleOn".into(), json!(on));
    }
    if filtered.is_empty() {
        return Ok(());
    }
    let _ = state.update_settings_transactional(&filtered, false);
    broadcast_snapshot(&app, &state);
    Ok(())
}

#[tauri::command]
fn widget_report_render_probe(
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
    report: Value,
) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("forbidden window".into());
    }
    state.runtime.lock().unwrap().dom_probe = Some(report);
    Ok(())
}

#[tauri::command]
fn widget_ready(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("forbidden window".into());
    }
    recall_widget(&app, &state, &window);
    broadcast_snapshot(&app, &state);

    let (
        bench_path,
        already,
        fg_kind,
        eff_fg,
        art_shift,
        art_shift_y,
        scale,
        gpu_mode,
        browser_args,
        test_drag,
        bridge_port,
        orig_x,
        orig_y,
        orig_sx,
        orig_sy,
    ) = {
        let mut rt = state.runtime.lock().unwrap();
        let was = rt.ready_reported;
        rt.ready_reported = true;
        (
            rt.benchmark_out.clone(),
            was,
            rt.foreground_kind.clone(),
            rt.effective_foreground.clone(),
            rt.art_shift,
            rt.art_shift_y,
            rt.display_scale,
            rt.gpu_mode.clone(),
            rt.browser_args.clone(),
            rt.test_drag,
            rt.bridge_port,
            rt.settings.get("x").cloned().unwrap_or(Value::Null),
            rt.settings.get("y").cloned().unwrap_or(Value::Null),
            rt.settings
                .get("desktopArtShiftX")
                .cloned()
                .unwrap_or(json!(0)),
            rt.settings
                .get("desktopArtShiftY")
                .cloned()
                .unwrap_or(json!(0)),
        )
    };

    if !already {
        if let Some(out_path) = bench_path {
            let state_clone = Arc::clone(&state);
            let win_clone = window.clone();
            let app_clone = app.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(600));
                let hwnd = state_clone.pet_hwnd.load(Ordering::Relaxed);

                let probe_js = r#"(() => {
                  const face = document.querySelector('.agy-face');
                  const idle = document.querySelector('.agy-frame--idle');
                  const mascot = document.getElementById('mascot');
                  const sq = document.querySelector('.side-widget-slot');
                  const sqSvg = sq && sq.querySelector('svg');
                  const sqRect = sqSvg ? sqSvg.getBoundingClientRect() : null;
                  const fRect = face ? face.getBoundingClientRect() : null;
                  const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
                  const bodyBg = getComputedStyle(document.body).backgroundColor;
                  const report = {
                    faceReady: Boolean(
                      face && fRect && fRect.width >= 20 && fRect.height >= 20 &&
                      idle && idle.complete && idle.naturalWidth > 0 && idle.naturalHeight > 0 &&
                      mascot && mascot.dataset.artReady === 'true'
                    ),
                    idleNaturalSize: idle ? [idle.naturalWidth || 0, idle.naturalHeight || 0] : [0, 0],
                    transparentStyleOk: (htmlBg === 'rgba(0, 0, 0, 0)' || htmlBg === 'transparent') &&
                                        (bodyBg === 'rgba(0, 0, 0, 0)' || bodyBg === 'transparent'),
                    sideQuotaReady: Boolean(sq && !sq.hidden && sqSvg && sqRect && sqRect.width > 0 && sqRect.height > 0)
                  };
                  if (window.__TAURI__ && window.__TAURI__.core) {
                    window.__TAURI__.core.invoke('widget_report_render_probe', { report }).catch(() => {});
                  }
                })()"#;

                {
                    let w = win_clone.clone();
                    let _ = win_clone.run_on_main_thread(move || {
                        let _ = w.eval(probe_js);
                    });
                }

                let mut dom_probe: Option<Value> = None;
                for _ in 0..30 {
                    if let Some(p) = state_clone.runtime.lock().unwrap().dom_probe.clone() {
                        dom_probe = Some(p);
                        break;
                    }
                    thread::sleep(Duration::from_millis(50));
                }

                let face_ready = dom_probe
                    .as_ref()
                    .and_then(|p| p.get("faceReady"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let transparent_style_ok = dom_probe
                    .as_ref()
                    .and_then(|p| p.get("transparentStyleOk"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let side_quota_ready = dom_probe
                    .as_ref()
                    .and_then(|p| p.get("sideQuotaReady"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let (drag_moved_ok, drag_ui_responsive_ok, drag_test_pass) = if test_drag {
                    let initial_bounds = foreground::get_window_bounds_phys(hwnd);
                    let eval_js = |js: String| {
                        let w = win_clone.clone();
                        let _ = win_clone.run_on_main_thread(move || {
                            let _ = w.eval(&js);
                        });
                    };
                    eval_js("window.widgetApi && window.widgetApi.drag('start')".to_string());
                    thread::sleep(Duration::from_millis(40));
                    let mut responsive_all = foreground::is_window_responsive(hwnd);
                    let mut moved_any = false;
                    for step in 1..=30 {
                        let dx = -(step as i32) * 3;
                        let dy = -(step as i32) * 2;
                        eval_js(format!(
                            "window.widgetApi && window.widgetApi.drag('move', {dx}, {dy})"
                        ));
                        thread::sleep(Duration::from_millis(16));
                        if !foreground::is_window_responsive(hwnd) {
                            responsive_all = false;
                        }
                        if let Some(cur) = foreground::get_window_bounds_phys(hwnd) {
                            if Some(cur) != initial_bounds {
                                moved_any = true;
                            }
                        }
                    }
                    eval_js(
                        "window.widgetApi && window.widgetApi.drag('end', -90, -60)".to_string(),
                    );
                    thread::sleep(Duration::from_millis(140));
                    if !foreground::is_window_responsive(hwnd) {
                        responsive_all = false;
                    }
                    let st_restore = Arc::clone(&state_clone);
                    let w_restore = win_clone.clone();
                    let h_restore = app_clone.clone();
                    let rx = orig_x.clone();
                    let ry = orig_y.clone();
                    let rsx = orig_sx.clone();
                    let rsy = orig_sy.clone();
                    let _ = win_clone.run_on_main_thread(move || {
                        let mut p = Map::new();
                        p.insert("x".into(), rx);
                        p.insert("y".into(), ry);
                        p.insert("desktopArtShiftX".into(), rsx);
                        p.insert("desktopArtShiftY".into(), rsy);
                        let _ = st_restore.update_settings_transactional(&p, false);
                        place_window_desktop(&st_restore, &w_restore, None);
                        broadcast_snapshot(&h_restore, &st_restore);
                    });
                    thread::sleep(Duration::from_millis(150));
                    if !foreground::is_window_responsive(hwnd) {
                        responsive_all = false;
                    }
                    (moved_any, responsive_all, moved_any && responsive_all)
                } else {
                    (false, foreground::is_window_responsive(hwnd), true)
                };

                let hit_count = state_clone.hit_rects.lock().unwrap().len();
                let hit_updates = state_clone.hit_rect_updates.load(Ordering::Relaxed);
                let payload = json!({
                    "ok": true,
                    "pid": std::process::id(),
                    "hwnd": hwnd,
                    "bridgePort": bridge_port,
                    "gpuMode": gpu_mode,
                    "browserArgs": browser_args,
                    "toolWindowStyle": foreground::is_tool_window(hwnd),
                    "artReady": true,
                    "faceReady": face_ready,
                    "transparentStyleOk": transparent_style_ok,
                    "sideQuotaReady": side_quota_ready,
                    "domProbe": dom_probe,
                    "hitRectCount": hit_count,
                    "hitRectUpdates": hit_updates,
                    "foregroundKind": fg_kind,
                    "effectiveForeground": eff_fg,
                    "displayScale": scale,
                    "artShift": art_shift,
                    "artShiftY": art_shift_y,
                    "dragTestRan": test_drag,
                    "dragMovedOk": drag_moved_ok,
                    "dragUiResponsiveOk": drag_ui_responsive_ok,
                    "dragTestPass": drag_test_pass,
                    "readyAtMs": now_ms()
                });
                if let Some(parent) = out_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(
                    &out_path,
                    serde_json::to_string_pretty(&payload).unwrap_or_default(),
                );
            });
        }
    }
    Ok(())
}

#[tauri::command]
fn widget_can_chatter(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
) -> Result<bool, String> {
    if window.label() != "pet" {
        return Ok(false);
    }
    if app.get_webview_window("settings").is_some() {
        return Ok(false);
    }
    let rt = state.runtime.lock().unwrap();
    let (_, web_active, _) = rt.web_companion.status_tuple(now_ms());
    if web_active {
        return Ok(false);
    }
    let chatter = rt
        .settings
        .get("ambientChatter")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let bubble_on = rt
        .settings
        .get("bubbleOn")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let state_ok = matches!(rt.sm.current_state(), "idle" | "offline");
    Ok(rt.window_visible && chatter && bubble_on && state_ok)
}

#[tauri::command]
async fn widget_command(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
    action: String,
) -> Result<(), String> {
    if !matches!(window.label(), "pet" | "settings") {
        return Err("forbidden window".into());
    }
    let Some(pet) = app.get_webview_window("pet") else {
        return Ok(());
    };
    match action.as_str() {
        "settings" => settings_window::open_settings(&app, &state, ""),
        "settings-close" => settings_window::close_settings(&app),
        "settings-minimize" => settings_window::minimize_settings(&app),
        "next-wallpaper" => rotate_wallpaper(&app, &state),
        "open-character-dir" => {
            let dir = state.runtime.lock().unwrap().user_characters_dir.clone();
            online::open_directory(&dir);
        }
        "open-wallpaper-dir" => {
            let dir = state.runtime.lock().unwrap().user_wallpapers_dir.clone();
            online::open_directory(&dir);
        }
        "open-project-repo" => {
            online::open_external_url("https://github.com/lynnfei/Catstella");
        }
        "open-upstream-repo" => {
            online::open_external_url("https://github.com/Monokumakuki/Antigravity-Star-Suite");
        }
        "menu" => {
            if let Ok(popup) = MenuBuilder::new(&app)
                .items(&[
                    &MenuItemBuilder::with_id("recall", "显示 / 唤回挂件").build(&app).map_err(|e| e.to_string())?,
                    &MenuItemBuilder::with_id("settings", "统一设置中心").build(&app).map_err(|e| e.to_string())?,
                    &MenuItemBuilder::with_id("next-wallpaper", "切换下一张壁纸").build(&app).map_err(|e| e.to_string())?,
                    &MenuItemBuilder::with_id("quit", "退出 Catstella").build(&app).map_err(|e| e.to_string())?,
                ])
                .build()
            {
                let _ = pet.popup_menu(&popup);
            } else {
                settings_window::open_settings(&app, &state, "");
            }
        }
        "reset" => reset_widget(&app, &state, &pet),
        "factory-reset" => {
            if state.reset_to_defaults(true).is_ok() {
                schedule_slideshow(&app, &state);
                notify_host_changed(&app);
                place_window_desktop(&state, &pet, None);
                mouse_routing::sync_click_through(&state, &pet);
                sync_visibility(&state, &pet);
                sync_tray_checks(&app, &state);
                broadcast_snapshot(&app, &state);
            }
        }
        "dock-left" => dock_widget(&app, &state, &pet, "left"),
        "dock-right" => dock_widget(&app, &state, &pet, "right"),
        "show-bubble" => {
            let mut p = Map::new();
            p.insert("bubbleOn".into(), json!(true));
            let _ = apply_settings_patch(&app, &state, &pet, &p);
        }
        "refresh" | "refresh-state" => {
            state.refresh_assets();
            trigger_host_quota_refresh(&app);
            broadcast_snapshot(&app, &state);
            let _ = pet.emit("widget://refresh", ());
        }
        "quota-refresh" => {
            trigger_host_quota_refresh(&app);
            broadcast_snapshot(&app, &state);
        }
        "restart" => restart_suite(&app, &state),
        "quit" => {
            state.quitting.store(true, Ordering::Relaxed);
            let app_stop = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                stop_host_orchestrator(&app_stop);
            })
            .await;
            let now = now_ms() as i64;
            let _ = state.runtime.lock().unwrap().ledger.save(now);
            app.exit(0);
        }
        other if other == "preview-reaction" || other.starts_with("preview-reaction:") => {
            let expr = other.split(':').nth(1).unwrap_or("proud");
            if ["proud", "shy", "angry", "nap"].contains(&expr) {
                let _ = pet.emit(
                    "widget://reaction",
                    json!({ "source": "preview", "expression": expr }),
                );
            }
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
async fn widget_online(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
    action: String,
    value: Option<Value>,
) -> Result<Value, String> {
    if window.label() != "settings" {
        return Err("forbidden window".into());
    }
    let st = Arc::clone(state.inner());
    let (res, mut_kind) = tauri::async_runtime::spawn_blocking(move || {
        online::handle_online_action(&st, &action, value.as_ref())
    })
    .await
    .map_err(|e| e.to_string())?;
    match mut_kind {
        OnlineMutation::None => {}
        OnlineMutation::DreamSkinUpdated(ss) | OnlineMutation::SettingsAndDreamSkinUpdated(ss) => {
            if ss {
                schedule_slideshow(&app, &state);
            }
            notify_host_changed(&app);
            sync_tray_checks(&app, &state);
            broadcast_snapshot(&app, &state);
        }
        OnlineMutation::AssetsUpdated => {
            sync_tray_checks(&app, &state);
            broadcast_snapshot(&app, &state);
        }
    }
    Ok(res)
}

#[tauri::command]
async fn widget_host(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
    host_mgr: State<'_, ManagedHost>,
    action: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    if window.label() != "settings" {
        return Err("forbidden window".into());
    }
    let allow_probe = host_mgr.allow_host_probe;
    let explicit_port = host_mgr.explicit_port;
    match action.as_str() {
        "diagnose" => {
            if !allow_probe {
                let diag = state.runtime.lock().unwrap().host_diagnostic.clone();
                return Ok(json!({ "ok": true, "diagnostic": diag }));
            }
            let diag = tauri::async_runtime::spawn_blocking(move || {
                host_cdp::diagnose_host(explicit_port)
            })
            .await
            .map_err(|e| format!("{e}"))?;
            state.runtime.lock().unwrap().host_diagnostic = diag.clone();
            broadcast_snapshot(&app, &state);
            Ok(json!({ "ok": true, "diagnostic": diag }))
        }
        "configure-shortcuts" | "restore-shortcuts" => {
            let enable = action == "configure-shortcuts";
            let (mut res, diag) = tauri::async_runtime::spawn_blocking(move || {
                let res = host_cdp::configure_host_shortcuts(enable);
                let diag = host_cdp::diagnose_host(explicit_port);
                (res, diag)
            })
            .await
            .map_err(|e| format!("{e}"))?;
            state.runtime.lock().unwrap().host_diagnostic = diag.clone();
            broadcast_snapshot(&app, &state);
            if let Some(obj) = res.as_object_mut() {
                obj.insert("diagnostic".into(), diag);
            }
            Ok(res)
        }
        "launch-debug" => tauri::async_runtime::spawn_blocking(move || {
            host_cdp::launch_host_with_debug(explicit_port)
        })
        .await
        .map_err(|e| format!("{e}")),
        "get-startup" => tauri::async_runtime::spawn_blocking(move || {
            json!({ "ok": true, "startup": startup::get_startup_config() })
        })
        .await
        .map_err(|e| format!("{e}")),
        "set-startup" => {
            let auto_start = payload
                .as_ref()
                .and_then(|v| v.get("autoStart"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let host_link = payload
                .as_ref()
                .and_then(|v| v.get("hostLink"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            tauri::async_runtime::spawn_blocking(move || {
                match startup::set_startup_config(auto_start, host_link) {
                    Ok(cfg) => json!({ "ok": true, "startup": cfg }),
                    Err(e) => json!({ "ok": false, "error": e }),
                }
            })
            .await
            .map_err(|e| format!("{e}"))
        }
        _ => Ok(json!({ "ok": false, "error": "unsupported-action" })),
    }
}

#[tauri::command]
fn widget_release_notes(
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
) -> Result<Value, String> {
    if window.label() != "settings" {
        return Err("forbidden window".into());
    }
    let rt = state.runtime.lock().unwrap();
    Ok(online::get_unseen_release_notes(&rt.settings))
}

#[tauri::command]
fn widget_release_notes_seen(
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
    version: String,
) -> Result<bool, String> {
    if window.label() != "settings" {
        return Err("forbidden window".into());
    }
    online::mark_release_notes_seen(&state, &version)
}

fn schedule_transient_clear(app: AppHandle, app_state: Arc<SharedApp>, gen_id: u64, ms: u64) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(ms));
        if app_state.quitting.load(Ordering::Relaxed) {
            return;
        }
        let changed = {
            let mut rt = app_state.runtime.lock().unwrap();
            rt.sm.clear_if_gen(gen_id)
        };
        if changed {
            let st = Arc::clone(&app_state);
            let h = app.clone();
            let _ = app.run_on_main_thread(move || {
                broadcast_snapshot(&h, &st);
            });
        }
    });
}

#[tauri::command]
fn widget_pointer(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
    action: String,
) -> Result<Value, String> {
    if window.label() != "pet" {
        return Err("forbidden window".into());
    }
    match action.as_str() {
        "down" => {
            {
                let mut rt = state.runtime.lock().unwrap();
                rt.sm.trigger_transient("pressed");
            }
            broadcast_snapshot(&app, &state);
            Ok(Value::Null)
        }
        "up" => {
            let cleared_gen = {
                let mut rt = state.runtime.lock().unwrap();
                if rt.sm.current_state() == "pressed" {
                    rt.sm.trigger_transient("release")
                } else {
                    None
                }
            };
            if let Some(g) = cleared_gen {
                broadcast_snapshot(&app, &state);
                schedule_transient_clear(app, Arc::clone(&state), g, 560);
            }
            Ok(Value::Null)
        }
        "cancel" => {
            let changed = {
                let mut rt = state.runtime.lock().unwrap();
                if rt.sm.current_state() == "pressed" {
                    rt.sm.clear_transient()
                } else {
                    false
                }
            };
            if changed {
                broadcast_snapshot(&app, &state);
            }
            Ok(Value::Null)
        }
        "pet" => {
            let gen_opt = {
                let mut rt = state.runtime.lock().unwrap();
                rt.sm.handle_petting()
            };
            if let Some(g) = gen_opt {
                broadcast_snapshot(&app, &state);
                schedule_transient_clear(app, Arc::clone(&state), g, 1600);
            }
            Ok(Value::Null)
        }
        "head-pat" => {
            let today = today_ymd();
            let (total, today_count, patch) = {
                let rt = state.runtime.lock().unwrap();
                let prev_day = rt
                    .settings
                    .get("headPatDay")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let prev_total = rt
                    .settings
                    .get("headPatTotal")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let prev_today = if prev_day == today {
                    rt.settings
                        .get("headPatToday")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0)
                } else {
                    0
                };
                let next_total = prev_total.saturating_add(1);
                let next_today = prev_today.saturating_add(1);
                let mut p = Map::new();
                p.insert("headPatDay".into(), json!(today));
                p.insert("headPatTotal".into(), json!(next_total));
                p.insert("headPatToday".into(), json!(next_today));
                (next_total, next_today, p)
            };
            let _ = state.update_settings_transactional(&patch, true);
            Ok(json!({ "total": total, "today": today_count }))
        }
        _ => Ok(Value::Null),
    }
}

#[tauri::command]
fn widget_drag(
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
    phase: String,
    dx: Option<f64>,
    dy: Option<f64>,
) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("forbidden window".into());
    }
    drag::handle_drag(
        &state,
        &window,
        &phase,
        dx.unwrap_or(0.0),
        dy.unwrap_or(0.0),
    );
    Ok(())
}

#[tauri::command]
fn widget_hit(
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
    active: bool,
) -> Result<(), String> {
    if window.label() != "pet" || state.dragging.load(Ordering::Relaxed) {
        return Ok(());
    }
    let want_ignored = state.click_through.load(Ordering::Relaxed) || !active;
    mouse_routing::set_ignored_with_notify(&state, &window, want_ignored, None);
    Ok(())
}

#[tauri::command]
fn widget_set_hit_rects(
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
    rects: Vec<HitRect>,
) -> Result<(), String> {
    if window.label() != "pet" {
        return Ok(());
    }
    *state.hit_rects.lock().unwrap() = rects;
    state.hit_rect_updates.fetch_add(1, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn widget_audio(
    window: WebviewWindow,
    state: State<'_, Arc<SharedApp>>,
    kind: String,
    force: Option<bool>,
) -> Result<Value, String> {
    if !matches!(window.label(), "pet" | "settings") {
        return Err("forbidden window".into());
    }
    let allow_force = force == Some(true) && window.label() == "settings";
    let rt = state.runtime.lock().unwrap();
    let enabled = rt
        .settings
        .get("sound")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let volume = rt
        .settings
        .get("volume")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.35);
    let sound_set = rt
        .settings
        .get("soundSet")
        .and_then(|v| v.as_str())
        .unwrap_or("bubble-pop");
    Ok(state
        .audio_catalog
        .resolve_audio(enabled || allow_force, volume, sound_set, &kind)
        .unwrap_or(Value::Null))
}

fn setup_tray(app: &AppHandle, app_state: &Arc<SharedApp>, pet_win: &WebviewWindow) {
    let (host_only, standalone, bubble_on, always_on_top, click_through, dream_on) = {
        let rt = app_state.runtime.lock().unwrap();
        (
            rt.settings
                .get("hostWindowOnly")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            rt.settings
                .get("standaloneDesktopMode")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            rt.settings
                .get("bubbleOn")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            rt.settings
                .get("alwaysOnTop")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            rt.settings
                .get("clickThrough")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            rt.dream_skin
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        )
    };

    let Ok(show_item) = MenuItemBuilder::with_id("recall", "显示 / 唤回挂件").build(app) else {
        return;
    };
    let Ok(settings_item) = MenuItemBuilder::with_id("settings", "统一设置中心").build(app) else {
        return;
    };
    let Ok(restart_item) = MenuItemBuilder::with_id("restart", "重启套件").build(app) else {
        return;
    };
    let Ok(dream_item) = CheckMenuItem::with_id(
        app,
        "dream-enabled",
        "应用到 Antigravity（皮肤）",
        true,
        dream_on,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(next_wall_item) = MenuItemBuilder::with_id("next-wallpaper", "切换下一张壁纸").build(app)
    else {
        return;
    };
    let Ok(host_item) = CheckMenuItem::with_id(
        app,
        "host-only",
        "仅在 Antigravity 窗口内显示",
        true,
        host_only,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(standalone_item) = CheckMenuItem::with_id(
        app,
        "standalone-fallback",
        "无宿主时退守桌面显示",
        host_only,
        host_only && standalone,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(bubble_item) =
        CheckMenuItem::with_id(app, "bubble-on", "显示气泡", true, bubble_on, None::<&str>)
    else {
        return;
    };
    let Ok(topmost_item) = CheckMenuItem::with_id(
        app,
        "always-on-top",
        "桌面模式始终置顶",
        !host_only,
        !host_only && always_on_top,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(ct_item) = CheckMenuItem::with_id(
        app,
        "click-through",
        "鼠标穿透 · Ctrl+Alt+Shift+G 恢复",
        true,
        click_through,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(dock_l) = MenuItemBuilder::with_id("dock-left", "停靠左下角").build(app) else {
        return;
    };
    let Ok(dock_r) = MenuItemBuilder::with_id("dock-right", "停靠右下角").build(app) else {
        return;
    };
    let Ok(reset_item) = MenuItemBuilder::with_id("reset", "重置位置").build(app) else {
        return;
    };
    let Ok(quit_item) = MenuItemBuilder::with_id("quit", "退出 Catstella").build(app) else {
        return;
    };
    let Ok(sep1) = PredefinedMenuItem::separator(app) else {
        return;
    };
    let Ok(sep2) = PredefinedMenuItem::separator(app) else {
        return;
    };
    let Ok(sep3) = PredefinedMenuItem::separator(app) else {
        return;
    };

    if let Some(handles) = app.try_state::<TrayHandles>() {
        *handles.inner.lock().unwrap() = Some(TrayCheckItems {
            dream_enabled: dream_item.clone(),
            host_only: host_item.clone(),
            standalone: standalone_item.clone(),
            bubble_on: bubble_item.clone(),
            always_on_top: topmost_item.clone(),
            click_through: ct_item.clone(),
        });
    }

    let Ok(menu) = MenuBuilder::new(app)
        .items(&[
            &show_item,
            &settings_item,
            &restart_item,
            &sep1,
            &dream_item,
            &next_wall_item,
            &sep2,
            &host_item,
            &standalone_item,
            &bubble_item,
            &topmost_item,
            &ct_item,
            &dock_l,
            &dock_r,
            &reset_item,
            &sep3,
            &quit_item,
        ])
        .build()
    else {
        return;
    };

    let mut builder = TrayIconBuilder::with_id("catstella-tray")
        .menu(&menu)
        .tooltip("Catstella");
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let tray_state = Arc::clone(app_state);
    builder = builder.on_tray_icon_event(move |tray, event| {
        if matches!(event, tauri::tray::TrayIconEvent::DoubleClick {
            button: tauri::tray::MouseButton::Left, ..
        }) {
            settings_window::open_settings(tray.app_handle(), &tray_state, "");
        }
    });
    let app_clone = Arc::clone(app_state);
    let win_clone = pet_win.clone();
    let _ = builder
        .on_menu_event(move |app_handle, event| {
            let id = event.id().as_ref();
            match id {
                "recall" => recall_widget(app_handle, &app_clone, &win_clone),
                "settings" => settings_window::open_settings(app_handle, &app_clone, ""),
                "restart" => restart_suite(app_handle, &app_clone),
                "dream-enabled" => {
                    let next = app_clone
                        .runtime
                        .lock()
                        .unwrap()
                        .dream_skin
                        .get("enabled")
                        .and_then(|v| v.as_bool())
                        != Some(true);
                    let mut p = Map::new();
                    p.insert("dreamSkin".into(), json!({ "enabled": next }));
                    let _ = apply_settings_patch(app_handle, &app_clone, &win_clone, &p);
                }
                "next-wallpaper" => rotate_wallpaper(app_handle, &app_clone),
                "host-only" => {
                    let next = !app_clone
                        .runtime
                        .lock()
                        .unwrap()
                        .settings
                        .get("hostWindowOnly")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let mut p = Map::new();
                    p.insert("hostWindowOnly".into(), json!(next));
                    let _ = apply_settings_patch(app_handle, &app_clone, &win_clone, &p);
                }
                "standalone-fallback" => {
                    let next = !app_clone
                        .runtime
                        .lock()
                        .unwrap()
                        .settings
                        .get("standaloneDesktopMode")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);
                    let mut p = Map::new();
                    p.insert("standaloneDesktopMode".into(), json!(next));
                    let _ = apply_settings_patch(app_handle, &app_clone, &win_clone, &p);
                }
                "bubble-on" => {
                    let next = !app_clone
                        .runtime
                        .lock()
                        .unwrap()
                        .settings
                        .get("bubbleOn")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);
                    let mut p = Map::new();
                    p.insert("bubbleOn".into(), json!(next));
                    let _ = apply_settings_patch(app_handle, &app_clone, &win_clone, &p);
                }
                "always-on-top" => {
                    let next = !app_clone
                        .runtime
                        .lock()
                        .unwrap()
                        .settings
                        .get("alwaysOnTop")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);
                    let mut p = Map::new();
                    p.insert("alwaysOnTop".into(), json!(next));
                    let _ = apply_settings_patch(app_handle, &app_clone, &win_clone, &p);
                }
                "click-through" => {
                    let next = !app_clone.click_through.load(Ordering::Relaxed);
                    let mut p = Map::new();
                    p.insert("clickThrough".into(), json!(next));
                    let _ = apply_settings_patch(app_handle, &app_clone, &win_clone, &p);
                }
                "dock-left" => dock_widget(app_handle, &app_clone, &win_clone, "left"),
                "dock-right" => dock_widget(app_handle, &app_clone, &win_clone, "right"),
                "reset" => reset_widget(app_handle, &app_clone, &win_clone),
                "quit" => {
                    app_clone.quitting.store(true, Ordering::Relaxed);
                    let h = app_handle.clone();
                    let st = Arc::clone(&app_clone);
                    thread::spawn(move || {
                        stop_host_orchestrator(&h);
                        let now = now_ms() as i64;
                        let _ = st.runtime.lock().unwrap().ledger.save(now);
                        h.exit(0);
                    });
                }
                _ => {}
            }
        })
        .build(app);
}

fn spawn_transcript_monitor(
    app: &AppHandle,
    app_state: Arc<SharedApp>,
    transcripts_dir: PathBuf,
    poll_ms: u64,
) {
    let handle = app.clone();
    thread::spawn(move || {
        let mut scanner = transcript::TranscriptScanner::new(transcripts_dir);
        let mut dirty_ledger_since: Option<u64> = None;

        loop {
            if app_state.quitting.load(Ordering::Relaxed) {
                if app_state.runtime.lock().unwrap().ledger.dirty {
                    let now = now_ms() as i64;
                    let _ = app_state.runtime.lock().unwrap().ledger.save(now);
                }
                break;
            }

            let (events, status) = scanner.scan();
            let now = now_ms();
            let mut should_publish = false;
            let mut had_live_turn_done = false;
            let mut steps_to_emit: Vec<Value> = Vec::new();
            let mut transients_to_clear: Vec<(u64, u64)> = Vec::new();

            {
                let mut rt = app_state.runtime.lock().unwrap();
                let source_changed = rt.source_status.online != status.online
                    || rt.source_status.files != status.files
                    || rt.source_status.last_updated != status.last_updated;
                rt.source_status = status.clone();
                if !status.online {
                    rt.model_activity.clear();
                    if rt.sm.set_persistent_state("offline") {
                        should_publish = true;
                    }
                } else if rt.sm.persistent_state == "offline" {
                    let target = if rt.model_activity.size() > 0 {
                        "thinking"
                    } else {
                        "idle"
                    };
                    if rt.sm.set_persistent_state(target) {
                        should_publish = true;
                    }
                }
                if source_changed {
                    should_publish = true;
                }

                for ev in events {
                    match ev {
                        transcript::TranscriptEvent::Step(step) => {
                            if !step.historical
                                && rt.model_activity.observe(
                                    step.step_index,
                                    &step.tools,
                                    &step.session_id,
                                )
                            {
                                should_publish = true;
                            }
                        }
                        transcript::TranscriptEvent::TurnDone(step) => {
                            let recorded = rt.ledger.record_step(&step, now as i64);
                            let act_id = format!("{}:{}", step.session_id, step.step_index);
                            let confirmed = matches!(recorded, Some((_, false)));
                            if !step.historical
                                && rt.model_activity.end(
                                    &act_id,
                                    step.step_index,
                                    "model-done",
                                    confirmed,
                                    now,
                                )
                            {
                                should_publish = true;
                            }
                            if !step.historical {
                                had_live_turn_done = true;
                                let target = if rt.model_activity.size() > 0 {
                                    "thinking"
                                } else {
                                    "idle"
                                };
                                if rt.sm.set_persistent_state(target) {
                                    should_publish = true;
                                }
                            }
                            if let Some((rec, updated)) = recorded {
                                if dirty_ledger_since.is_none() {
                                    dirty_ledger_since = Some(now);
                                }
                                if !step.historical && !updated {
                                    if let Some(gen_id) = rt.sm.handle_turn_success() {
                                        transients_to_clear.push((gen_id, 1200));
                                    }
                                    if let Ok(val) = serde_json::to_value(rec) {
                                        steps_to_emit.push(val);
                                    }
                                    should_publish = true;
                                }
                            }
                        }
                        transcript::TranscriptEvent::AskUser {
                            session_id,
                            step_index,
                            historical,
                        } => {
                            if !historical && rt.model_activity.set_waiting(step_index, &session_id)
                            {
                                should_publish = true;
                            }
                        }
                        transcript::TranscriptEvent::UserInput {
                            session_id,
                            step_index,
                        } => {
                            if rt.model_activity.clear_waiting(&session_id, Some(step_index)) {
                                should_publish = true;
                            }
                        }
                        transcript::TranscriptEvent::TurnRunning {
                            session_id,
                            step_index,
                            historical,
                        } => {
                            if !historical {
                                let act_id = format!("{session_id}:{step_index}");
                                if rt.model_activity.begin(&act_id, step_index) {
                                    rt.sm.set_persistent_state("thinking");
                                    should_publish = true;
                                }
                            }
                        }
                        transcript::TranscriptEvent::TurnError {
                            session_id,
                            step_index,
                            historical,
                        } => {
                            if !historical {
                                let act_id = format!("{session_id}:{step_index}");
                                if rt.model_activity.end(
                                    &act_id,
                                    step_index,
                                    "model-error",
                                    true,
                                    now,
                                ) {
                                    let fallback = if rt.source_status.online {
                                        "idle"
                                    } else {
                                        "offline"
                                    };
                                    let target = if rt.model_activity.size() > 0 {
                                        "thinking"
                                    } else {
                                        fallback
                                    };
                                    rt.sm.set_persistent_state(target);
                                    if rt.model_activity.size() == 0
                                        && rt.sm.current_state() != "pressed"
                                    {
                                        if let Some(gen_id) = rt.sm.trigger_transient("error") {
                                            transients_to_clear.push((gen_id, 2400));
                                        }
                                    }
                                    should_publish = true;
                                }
                            }
                        }
                    }
                }

                if let Some(since) = dirty_ledger_since {
                    if now.saturating_sub(since) >= 1000 && rt.ledger.dirty {
                        if rt.ledger.save(now as i64).is_ok() {
                            dirty_ledger_since = None;
                        }
                    }
                }
            }

            for (gen_id, ms) in transients_to_clear {
                schedule_transient_clear(handle.clone(), Arc::clone(&app_state), gen_id, ms);
            }

            if had_live_turn_done {
                trigger_host_quota_refresh_debounced(&handle);
            }

            if !steps_to_emit.is_empty() || should_publish {
                let h = handle.clone();
                let st = Arc::clone(&app_state);
                let _ = handle.run_on_main_thread(move || {
                    if let Some(pet) = h.get_webview_window("pet") {
                        for step_val in steps_to_emit {
                            let _ = pet.emit("widget://step", step_val);
                        }
                    }
                    if should_publish {
                        broadcast_snapshot(&h, &st);
                    }
                });
            }

            thread::sleep(Duration::from_millis(poll_ms));
        }
    });
}

fn write_benchmark_probe_field(state: &Arc<SharedApp>, key: &str, value: Value) {
    let out_path = {
        let rt = state.runtime.lock().unwrap();
        rt.benchmark_out.clone()
    };
    let Some(out_path) = out_path else {
        return;
    };
    if let Ok(raw) = std::fs::read_to_string(&out_path) {
        if let Ok(mut existing) = serde_json::from_str::<Value>(&raw) {
            if let Some(obj) = existing.as_object_mut() {
                obj.insert(key.to_string(), value);
                let _ = std::fs::write(
                    &out_path,
                    serde_json::to_string_pretty(&existing).unwrap_or_default(),
                );
            }
        }
    }
}

#[tauri::command]
fn widget_settings_cycle_report(
    state: State<'_, Arc<SharedApp>>,
    report: Value,
) -> Result<(), String> {
    write_benchmark_probe_field(&state, "settingsCycleDom", report);
    Ok(())
}

#[tauri::command]
fn widget_pet_bubble_report(
    state: State<'_, Arc<SharedApp>>,
    report: Value,
) -> Result<(), String> {
    write_benchmark_probe_field(&state, "petBubbleCheck", report);
    Ok(())
}

fn spawn_settings_cycle_probe(app: AppHandle, app_state: Arc<SharedApp>) {
    thread::spawn(move || {
        // Wait for baseline pet window & benchmark_out initial write (~1.5s), then hold idle until 3.5s
        // so the test runner can sample clean idle baseline memory first.
        thread::sleep(Duration::from_millis(3500));
        if app_state.quitting.load(Ordering::Relaxed) {
            return;
        }
        // Trigger Settings Center via the real `#settings` button click inside `"pet"` WebView2.
        if let Some(pet) = app.get_webview_window("pet") {
            let pet_clone = pet.clone();
            let _ = pet.run_on_main_thread(move || {
                let js = r#"(() => {
                  const btn = document.getElementById('settings');
                  if (btn) btn.click();
                  else if (window.widgetApi) window.widgetApi.command('settings');
                })()"#;
                let _ = pet_clone.eval(js);
            });
        }

        // Poll up to 4s (100ms interval) for the `"settings"` window to appear and check pet responsiveness.
        let mut opened_via_click = false;
        for _ in 0..40 {
            if app_state.quitting.load(Ordering::Relaxed) {
                return;
            }
            if app.get_webview_window("settings").is_some() {
                opened_via_click = true;
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        let pet_hwnd = app_state.pet_hwnd.load(Ordering::Relaxed);
        let mut pet_responsive_while_open = foreground::is_window_responsive(pet_hwnd);

        // Give Settings WebView2 ~1.8s to finish loading DOM cards before evaluating.
        thread::sleep(Duration::from_millis(1800));
        if app_state.quitting.load(Ordering::Relaxed) {
            return;
        }
        pet_responsive_while_open =
            pet_responsive_while_open && foreground::is_window_responsive(pet_hwnd);

        if let Some(out_path) = app_state.runtime.lock().unwrap().benchmark_out.clone() {
            if let Ok(raw) = std::fs::read_to_string(&out_path) {
                if let Ok(mut existing) = serde_json::from_str::<Value>(&raw) {
                    if let Some(obj) = existing.as_object_mut() {
                        obj.insert("settingsOpenedViaClick".into(), json!(opened_via_click));
                        obj.insert(
                            "petResponsiveWhileSettingsOpen".into(),
                            json!(pet_responsive_while_open),
                        );
                        let _ = std::fs::write(
                            &out_path,
                            serde_json::to_string_pretty(&existing).unwrap_or_default(),
                        );
                    }
                }
            }
        }

        if let Some(sw) = app.get_webview_window("settings") {
            let sw_clone = sw.clone();
            let _ = sw.run_on_main_thread(move || {
                let js = r#"(async () => {
                  const waitMs = ms => new Promise(r => setTimeout(r, ms));
                  const wallNav = document.querySelector('#side-nav [data-p="skin"]');
                  if (wallNav) wallNav.click();
                  let wallThumbsLoaded = 0;
                  let hudPetReady = false;
                  let hudPetCentered = false;
                  let hudSideQuotaReady = false;
                  let hudArcMirrored = false;
                  for (let i = 0; i < 22; i++) {
                    const wImgs = Array.from(document.querySelectorAll('#walls .wall img'));
                    wallThumbsLoaded = wImgs.filter(img => img.complete && img.naturalWidth > 0).length;
                    const hudPet = document.getElementById('hud-pet-img');
                    const hudStage = document.getElementById('hudStage');
                    hudPetReady = Boolean(hudPet && hudPet.complete && hudPet.naturalWidth > 0);
                    if (hudPetReady && hudStage) {
                      const pr = hudPet.getBoundingClientRect();
                      const sr = hudStage.getBoundingClientRect();
                      const petCx = pr.left + pr.width / 2;
                      const stageCx = sr.left + sr.width / 2;
                      hudPetCentered = pr.width > 20 && Math.abs(petCx - stageCx) <= 8;
                    }
                    const hudSqSvg = document.querySelector('#hudSq svg');
                    const hudSqRect = hudSqSvg ? hudSqSvg.getBoundingClientRect() : null;
                    hudSideQuotaReady = Boolean(hudSqSvg && hudSqRect && hudSqRect.width > 0 && hudSqRect.height > 0);
                    const arcMirror = document.querySelector('#hudSq .gauge-arc-mirror');
                    hudArcMirrored = Boolean(arcMirror && (arcMirror.getAttribute('transform') || '').includes('scale(-1 1)'));
                    if (wallThumbsLoaded >= 4 && hudPetReady && hudPetCentered && hudSideQuotaReady && hudArcMirrored) break;
                    await waitMs(100);
                  }
                  const report = {
                    charCards: document.querySelectorAll('#hud-char-switcher .char').length,
                    wallCards: document.querySelectorAll('#walls .wall').length,
                    wallThumbsLoaded,
                    hudPetReady,
                    hudPetCentered,
                    hudSideQuotaReady,
                    hudArcMirrored,
                    settingsHasArgon: document.body.innerText.includes('Argon'),
                    savedOk: false,
                    savedScale: null,
                    savedTheme: null,
                    error: null
                  };
                  try {
                    const updated = await window.widgetApi.save({ scale: 240, dreamSkin: { themePreset: 'pink' } });
                    report.savedOk = Boolean(updated && updated.settings && updated.settings.scale === 240 && updated.dreamSkin && updated.dreamSkin.themePreset === 'pink');
                    report.savedScale = updated?.settings?.scale ?? null;
                    report.savedTheme = updated?.dreamSkin?.themePreset ?? null;
                  } catch (e) {
                    report.error = String(e && e.message || e);
                  }
                  if (window.__TAURI__ && window.__TAURI__.core) {
                    window.__TAURI__.core.invoke('widget_settings_cycle_report', { report }).catch(() => {});
                  }
                })()"#;
                let _ = sw_clone.eval(js);
            });
        }
        // Keep settings open until ~8.5s so external sampler can observe peak settings-open RAM
        thread::sleep(Duration::from_millis(3000));
        if app_state.quitting.load(Ordering::Relaxed) {
            return;
        }
        // Close Settings via the real UI path (`widgetApi.command('settings-close')`), falling back if eval fails.
        let closed_via_ui = if let Some(sw) = app.get_webview_window("settings") {
            let sw_clone = sw.clone();
            sw.run_on_main_thread(move || {
                let _ = sw_clone.eval(
                    "if (window.widgetApi) { window.widgetApi.command('settings-close'); }",
                );
            })
            .is_ok()
        } else {
            false
        };
        if !closed_via_ui {
            let h = app.clone();
            let _ = app.run_on_main_thread(move || {
                settings_window::close_settings(&h);
            });
        }
        let mut still_exists = true;
        for _ in 0..20 {
            if app_state.quitting.load(Ordering::Relaxed) {
                return;
            }
            thread::sleep(Duration::from_millis(100));
            if app.get_webview_window("settings").is_none() {
                still_exists = false;
                break;
            }
        }
        if still_exists {
            still_exists = app.get_webview_window("settings").is_some();
        }
        write_benchmark_probe_field(
            &app_state,
            "settingsDestroyedAfterClose",
            json!(!still_exists),
        );

        // Verify the pet bubble cycles cleanly onto the `"Claude / GPT"` page with zero Argon labels.
        if let Some(pet) = app.get_webview_window("pet") {
            let pet_clone = pet.clone();
            let _ = pet.run_on_main_thread(move || {
                let js = r#"(async () => {
                  const waitMs = ms => new Promise(r => setTimeout(r, ms));
                  let claudeGptBubbleOk = false;
                  let claudeTitle = null;
                  let claudePercent = null;
                  let claudeWeekPercent = null;
                  let bubbleHasArgon = document.getElementById('bubble')?.innerText.includes('Argon') ?? false;
                  const nextBtn = document.getElementById('next');
                  for (let i = 0; i < 8; i++) {
                    if (document.getElementById('title')?.textContent === 'Claude / GPT') {
                      const pct = document.getElementById('percent')?.textContent || '';
                      const wk = document.getElementById('percent-week')?.textContent || '';
                      const qHidden = document.getElementById('quota')?.hidden === true;
                      const txt = document.getElementById('bubble')?.innerText || '';
                      if (txt.includes('Argon')) bubbleHasArgon = true;
                      claudeTitle = document.getElementById('title')?.textContent || null;
                      claudePercent = pct;
                      claudeWeekPercent = wk;
                      claudeGptBubbleOk = !qHidden && pct === '76%' && wk === '88%';
                      break;
                    }
                    if (nextBtn) nextBtn.click();
                    await waitMs(60);
                  }
                  const report = {
                    claudeGptBubbleOk,
                    claudeTitle,
                    claudePercent,
                    claudeWeekPercent,
                    bubbleHasArgon
                  };
                  if (window.__TAURI__ && window.__TAURI__.core) {
                    window.__TAURI__.core.invoke('widget_pet_bubble_report', { report }).catch(() => {});
                  }
                })()"#;
                let _ = pet_clone.eval(js);
            });
        }
    });
}

fn spawn_cdp_cycle_probe(app: AppHandle, app_state: Arc<SharedApp>) {
    thread::spawn(move || {
        let steps: &[(u64, &str)] = &[
            (1200, r#"{"dreamSkin":{"uiLanguage":"zh-CN"}}"#),
            (1800, r#"{"dreamSkin":{"enabled":true}}"#),
            (2000, r#"{"dreamSkin":{"opacity":42}}"#),
            (1800, r#"{"dreamSkin":{"enabled":false,"uiLanguage":"en"}}"#),
        ];
        for (wait_ms, raw_patch) in steps {
            thread::sleep(Duration::from_millis(*wait_ms));
            if app_state.quitting.load(Ordering::Relaxed) {
                return;
            }
            let Ok(Value::Object(patch)) = serde_json::from_str::<Value>(raw_patch) else {
                continue;
            };
            let h = app.clone();
            let st = Arc::clone(&app_state);
            let _ = app.run_on_main_thread(move || {
                if let Some(pet) = h.get_webview_window("pet") {
                    let _ = apply_settings_patch(&h, &st, &pet, &patch);
                }
            });
        }
    });
}

fn main() {
    for arg in std::env::args().skip(1) {
        if arg == "--watch-host" {
            startup::run_host_watcher();
            return;
        }
        if arg == "--configure-host-shortcuts" {
            let _ = host_cdp::configure_host_shortcuts(true);
            return;
        }
        if arg == "--quit" {
            startup::signal_quit_existing();
            return;
        }
        if arg == "--restart" {
            startup::signal_restart_existing();
            return;
        }
    }

    let args = parse_args();
    let is_single_instance_mode = !args.isolated
        && !args.explicit_data_dir
        && args.benchmark_out.is_none()
        && args.exit_after_ms.is_none();
    let _instance_guard = if is_single_instance_mode {
        let wait = std::env::args().any(|arg| arg == "--wait-single-instance");
        match startup::try_acquire_single_instance(args.settings_on_start, wait) {
            Some(guard) => Some(guard),
            None => return,
        }
    } else {
        None
    };

    let _ = std::fs::create_dir_all(&args.data_dir);
    let _ = std::fs::create_dir_all(&args.skin_dir);
    let wv2_dir = args.data_dir.join("webview2");
    let _ = std::fs::create_dir_all(&wv2_dir);
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &wv2_dir);

    let browser_args = browser_args_for_gpu_mode(&args.gpu_mode).to_string();
    let displays = foreground::enumerate_displays();
    let shared = SharedApp::new(
        args.data_dir.clone(),
        args.skin_dir.clone(),
        wv2_dir.clone(),
        args.benchmark_out.clone(),
        args.demo_quota,
        args.gpu_mode.clone(),
        browser_args.clone(),
        args.test_drag,
        args.isolated,
        args.test_slideshow_ms,
        displays,
    );

    let exit_after_ms = args.exit_after_ms;
    let settings_on_start = args.settings_on_start;
    let bridge_port_arg = args.bridge_port;
    let transcripts_dir = args.transcripts_dir.clone();
    let transcript_poll_ms = args.transcript_poll_ms;
    let no_transcripts = args.no_transcripts;
    let no_hotkeys = args.no_hotkeys;
    let test_settings_cycle = args.test_settings_cycle;
    let test_cdp_cycle = args.test_cdp_cycle;
    let no_host = args.no_host;
    let host_cdp_port = args.host_cdp_port;
    let allow_host_probe = !no_host && (!args.isolated || host_cdp_port.is_some());
    let wv2_dir_for_setup = wv2_dir;
    let browser_args_for_setup = browser_args;
    let shared_for_setup = Arc::clone(&shared);
    let shared_for_state = Arc::clone(&shared);
    let shared_for_run = Arc::clone(&shared);

    let app = tauri::Builder::default()
        .manage(shared_for_state)
        .manage(TrayHandles {
            inner: Arc::new(Mutex::new(None)),
        })
        .manage(ManagedHost {
            orchestrator: Mutex::new(None),
            explicit_port: host_cdp_port,
            allow_host_probe,
        })
        .invoke_handler(tauri::generate_handler![
            widget_get,
            widget_save,
            widget_bubble_preference,
            widget_ready,
            widget_report_render_probe,
            widget_settings_cycle_report,
            widget_pet_bubble_report,
            widget_can_chatter,
            widget_command,
            widget_pointer,
            widget_drag,
            widget_hit,
            widget_set_hit_rects,
            widget_audio,
            widget_online,
            widget_host,
            widget_release_notes,
            widget_release_notes_seen
        ])
        .setup(move |app| {
            let app_state = Arc::clone(&shared_for_setup);
            let handle_for_bridge = app.handle().clone();
            let state_for_bridge = Arc::clone(&app_state);
            let handle_for_hb = app.handle().clone();
            let state_for_hb = Arc::clone(&app_state);

            companion_bridge::start_companion_bridge(
                Arc::clone(&app_state),
                bridge_port_arg,
                move |eff: BridgeSyncEffect| {
                    let h = handle_for_bridge.clone();
                    let st = Arc::clone(&state_for_bridge);
                    let _ = handle_for_bridge.run_on_main_thread(move || {
                        if eff.slideshow_changed {
                            schedule_slideshow(&h, &st);
                        }
                        notify_host_changed(&h);
                        if let Some(pet) = h.get_webview_window("pet") {
                            if eff.new_scale != eff.old_scale
                                && st.runtime.lock().unwrap().host_area.is_none()
                            {
                                let hwnd = st.pet_hwnd.load(Ordering::Relaxed);
                                let prev_dip = foreground::get_window_bounds_phys(hwnd).and_then(|p| {
                                    foreground::display_for_phys_rect(p).map(|d| d.phys_to_dip(p))
                                });
                                place_window_desktop(&st, &pet, prev_dip);
                            }
                            sync_visibility(&st, &pet);
                            sync_tray_checks(&h, &st);
                            broadcast_snapshot(&h, &st);
                        }
                    });
                },
                move || {
                    let h = handle_for_hb.clone();
                    let st = Arc::clone(&state_for_hb);
                    let _ = handle_for_hb.run_on_main_thread(move || {
                        if let Some(pet) = h.get_webview_window("pet") {
                            sync_visibility(&st, &pet);
                            broadcast_snapshot(&h, &st);
                        }
                    });
                },
            );

            let mut pet_builder = WebviewWindowBuilder::new(
                app,
                "pet",
                WebviewUrl::App("src/renderer/index.html".into()),
            )
            .title("Catstella · 桌宠")
            .inner_size(360.0, 604.0)
            .visible(false)
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true);
            #[cfg(windows)]
            {
                pet_builder = pet_builder
                    .data_directory(wv2_dir_for_setup)
                    .additional_browser_args(&browser_args_for_setup);
            }
            #[cfg(not(windows))]
            {
                let _ = (&wv2_dir_for_setup, &browser_args_for_setup);
            }
            let pet = pet_builder.build()?;

            #[cfg(windows)]
            if let Ok(hwnd) = pet.hwnd() {
                let raw = hwnd.0 as isize;
                app_state.pet_hwnd.store(raw, Ordering::Relaxed);
                foreground::apply_tool_window_style(raw);
            }

            place_window_desktop(&app_state, &pet, None);
            setup_tray(app.handle(), &app_state, &pet);
            schedule_slideshow(app.handle(), &app_state);

            mouse_routing::spawn_mouse_routing(Arc::clone(&app_state), pet.clone());

            if is_single_instance_mode {
                let ipc_stop = Arc::clone(&app_state);
                let ipc_app = app.handle().clone();
                let ipc_state = Arc::clone(&app_state);
                let ipc_pet = pet.clone();
                startup::spawn_ipc_listener(
                    move || ipc_stop.quitting.load(Ordering::Relaxed),
                    {
                        let h = ipc_app.clone();
                        let st = Arc::clone(&ipc_state);
                        move || {
                            st.quitting.store(true, Ordering::Relaxed);
                            stop_host_orchestrator(&h);
                            let now = now_ms() as i64;
                            let _ = st.runtime.lock().unwrap().ledger.save(now);
                            h.exit(0);
                        }
                    },
                    {
                        let h = ipc_app.clone();
                        let st = Arc::clone(&ipc_state);
                        let p = ipc_pet.clone();
                        move || {
                            let h2 = h.clone();
                            let st2 = Arc::clone(&st);
                            let p2 = p.clone();
                            let _ = h.run_on_main_thread(move || {
                                recall_widget(&h2, &st2, &p2);
                            });
                        }
                    },
                    {
                        let h = ipc_app.clone();
                        let st = Arc::clone(&ipc_state);
                        move || {
                            settings_window::open_settings(&h, &st, "");
                        }
                    },
                    {
                        let h = ipc_app.clone();
                        let st = Arc::clone(&ipc_state);
                        move || restart_suite(&h, &st)
                    },
                );
            }

            {
                let fg_state = Arc::clone(&app_state);
                let fg_win = pet.clone();
                let fg_app = app.handle().clone();
                foreground::spawn_foreground_monitor(
                    Arc::clone(&app_state),
                    move |upd: ForegroundUpdate| {
                        let (fg_changed, entered_host) = {
                            let mut rt = fg_state.runtime.lock().unwrap();
                            let prev_fg = rt.foreground_kind.clone();
                            let next_eff = resolve_effective_foreground(
                                &upd.foreground_kind,
                                &rt.effective_foreground,
                            );
                            let changed = upd.foreground_kind != rt.foreground_kind
                                || next_eff != rt.effective_foreground
                                || upd.native_following != rt.native_attached
                                || upd.host_bounds_phys != rt.host_area_phys;
                            let entered = prev_fg != "host" && upd.foreground_kind == "host";
                            rt.foreground_kind = upd.foreground_kind;
                            rt.effective_foreground = next_eff;
                            rt.native_attached = upd.native_following && upd.attached;
                            rt.host_area_phys = upd.host_bounds_phys;
                            (changed, entered)
                        };
                        if entered_host {
                            trigger_host_model_refresh(&fg_app);
                        }
                        let st_main = Arc::clone(&fg_state);
                        let w_main = fg_win.clone();
                        let h_main = fg_app.clone();
                        let _ = fg_win.run_on_main_thread(move || {
                            sync_visibility(&st_main, &w_main);
                            if fg_changed {
                                broadcast_snapshot(&h_main, &st_main);
                            }
                        });
                    },
                );
            }

            if !no_transcripts {
                spawn_transcript_monitor(
                    app.handle(),
                    Arc::clone(&app_state),
                    transcripts_dir,
                    transcript_poll_ms,
                );
            }

            if !no_hotkeys {
                let hk_app = app.handle().clone();
                let hk_state = Arc::clone(&app_state);
                let hk_pet = pet.clone();
                let hk_app2 = app.handle().clone();
                let hk_state2 = Arc::clone(&app_state);
                let hk_pet2 = pet.clone();
                hotkeys::spawn_global_hotkeys(
                    Arc::clone(&app_state),
                    move || {
                        let h = hk_app.clone();
                        let st = Arc::clone(&hk_state);
                        let p = hk_pet.clone();
                        let _ = hk_app.run_on_main_thread(move || {
                            recall_widget(&h, &st, &p);
                        });
                    },
                    move || {
                        let h = hk_app2.clone();
                        let st = Arc::clone(&hk_state2);
                        let p = hk_pet2.clone();
                        let _ = hk_app2.run_on_main_thread(move || {
                            let mut patch = Map::new();
                            patch.insert("clickThrough".into(), json!(false));
                            let _ = apply_settings_patch(&h, &st, &p, &patch);
                            recall_widget(&h, &st, &p);
                        });
                    },
                );
            }

            if settings_on_start {
                settings_window::open_settings(app.handle(), &app_state, "");
            }

            if allow_host_probe {
                let orch_app = app.handle().clone();
                let orch_state = Arc::clone(&app_state);
                let orch = HostOrchestrator::start(
                    Arc::clone(&app_state),
                    host_cdp_port,
                    move || {
                        let h = orch_app.clone();
                        let st = Arc::clone(&orch_state);
                        let _ = orch_app.run_on_main_thread(move || {
                            broadcast_snapshot(&h, &st);
                        });
                    },
                );
                if let Some(hm) = app.try_state::<ManagedHost>() {
                    *hm.orchestrator.lock().unwrap() = Some(orch);
                }
            }

            if test_settings_cycle {
                spawn_settings_cycle_probe(app.handle().clone(), Arc::clone(&app_state));
            }

            if test_cdp_cycle {
                spawn_cdp_cycle_probe(app.handle().clone(), Arc::clone(&app_state));
            }

            {
                let show_state = Arc::clone(&app_state);
                let show_win = pet.clone();
                let show_app = app.handle().clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(5000));
                    if show_state.quitting.load(Ordering::Relaxed) {
                        return;
                    }
                    let ready = show_state.runtime.lock().unwrap().ready_reported;
                    if !ready {
                        let st = Arc::clone(&show_state);
                        let w = show_win.clone();
                        let h = show_app.clone();
                        let _ = show_win.run_on_main_thread(move || {
                            let _ = w.show();
                            sync_visibility(&st, &w);
                            broadcast_snapshot(&h, &st);
                        });
                    }
                });
            }

            if let Some(ms) = exit_after_ms {
                let exit_state = Arc::clone(&app_state);
                let handle = app.handle().clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(ms));
                    exit_state.quitting.store(true, Ordering::Relaxed);
                    stop_host_orchestrator(&handle);
                    let now = now_ms() as i64;
                    let _ = exit_state.runtime.lock().unwrap().ledger.save(now);
                    handle.exit(0);
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building catstella");

    let exit_handle = app.handle().clone();
    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !shared_for_run.quitting.load(Ordering::Relaxed) {
                api.prevent_exit();
            }
        }
    });

    shared.quitting.store(true, Ordering::Relaxed);
    stop_host_orchestrator(&exit_handle);
    let now = now_ms() as i64;
    let _ = shared.runtime.lock().unwrap().ledger.save(now);
}

#[cfg(test)]
mod restart_tests {
    use super::filter_restart_args;

    #[test]
    fn restart_args_strip_oneshot_and_preserve_runtime_flags() {
        let input = vec![
            "--settings".to_string(),
            "--wait-single-instance".to_string(),
            "--data-dir=C:/temp/cat".to_string(),
            "--gpu-mode=low-mem".to_string(),
            "--exit-after-ms=5000".to_string(),
            "--test-drag".to_string(),
            "--test-settings-cycle".to_string(),
            "--test-cdp-cycle".to_string(),
            "--benchmark-out=out.json".to_string(),
            "--test-slideshow-ms=300".to_string(),
            "--bridge-port=3922".to_string(),
            "--isolated".to_string(),
        ];
        assert_eq!(
            filter_restart_args(input),
            vec![
                "--data-dir=C:/temp/cat".to_string(),
                "--gpu-mode=low-mem".to_string(),
                "--bridge-port=3922".to_string(),
                "--isolated".to_string(),
            ]
        );
    }
}
