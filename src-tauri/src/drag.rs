use crate::foreground;
use crate::layout::{self, DisplayInfo, Rect};
use crate::mouse_routing;
use crate::state::SharedApp;
use serde_json::{json, Map};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, WebviewWindow};

#[derive(Debug, Clone)]
struct DragSession {
    gen_id: u64,
    start_bounds_dip: Rect,
    start_visual_x: f64,
    start_top: f64,
    start_art_shift: f64,
    start_art_shift_y: f64,
    start_dock_side: String,
    start_facing: String,
    start_scale: i32,
    start_cursor_phys: Option<(i32, i32)>,
    start_cursor_dip: (f64, f64),
    last_cursor_phys: Option<(i32, i32)>,
    saw_lbutton_down: bool,
    preferred_scale: i32,
    host_area: Option<Rect>,
    host_display: Option<DisplayInfo>,
    active_display: DisplayInfo,
    last_phys_bounds: Option<Rect>,
}

static DRAG_SESSION: OnceLock<Mutex<Option<DragSession>>> = OnceLock::new();

fn session_lock() -> &'static Mutex<Option<DragSession>> {
    DRAG_SESSION.get_or_init(|| Mutex::new(None))
}

fn phys_point_to_dip(pt: (i32, i32), display: &DisplayInfo) -> (f64, f64) {
    let s = if display.scale > 0.1 { display.scale } else { 1.0 };
    (
        display.dip_work.x as f64 + (pt.0 - display.phys_work.x) as f64 / s,
        display.dip_work.y as f64 + (pt.1 - display.phys_work.y) as f64 / s,
    )
}

fn dispatch_bounds_to_main(window: &WebviewWindow, hwnd: isize, phys: Rect) {
    let _ = window.run_on_main_thread(move || {
        foreground::set_window_bounds_phys(hwnd, phys);
    });
}

fn apply_drag_step(
    app_state: &SharedApp,
    window: &WebviewWindow,
    dx_dip: f64,
    dy_dip: f64,
    snap: bool,
    target_display_override: Option<DisplayInfo>,
) -> bool {
    let mut phys_to_apply: Option<Rect> = None;
    let mut host_offsets: Option<(i32, i32, String)> = None;
    let mut desktop_pos: Option<(i32, i32, f64, f64)> = None;
    let mut changed = false;

    // Lock invariant: hold DRAG_SESSION and runtime ONLY for pure math, then release both
    // before touching Win32/Tauri window APIs, disk settings, or event emission.
    {
        let mut sess_guard = session_lock().lock().unwrap();
        let Some(sess) = sess_guard.as_mut() else {
            return false;
        };
        let _ = sess.gen_id;

        let display = sess
            .host_display
            .or(target_display_override)
            .unwrap_or(sess.active_display);
        let area = sess.host_area.unwrap_or(display.dip_work);

        let left = sess.start_visual_x + dx_dip;
        let top = sess.start_top + dy_dip;
        let res = layout::place_dragged_widget(area, sess.preferred_scale, left, top, snap);

        {
            let mut rt = app_state.runtime.lock().unwrap();
            let next_facing = layout::facing_at(
                res.placement.visual_x + res.scale as f64 / 2.0,
                area,
                &rt.facing,
                12.0,
            );
            let direction = if res.side.is_empty() {
                next_facing
            } else {
                res.side.clone()
            };

            if rt.display_scale != res.scale
                || (rt.art_shift - res.placement.art_shift).abs() > 0.01
                || (rt.art_shift_y - res.placement.art_shift_y).abs() > 0.01
                || rt.dock_side != res.side
                || rt.facing != direction
            {
                changed = true;
            }
            rt.display_scale = res.scale;
            rt.art_shift = res.placement.art_shift;
            rt.art_shift_y = res.placement.art_shift_y;
            rt.dock_side = res.side.clone();
            rt.facing = direction;
            rt.active_display = Some(display);

            if snap {
                if sess.host_area.is_some() {
                    host_offsets = Some((res.host_offset_x, res.host_offset_y, res.side.clone()));
                } else {
                    desktop_pos = Some((
                        res.placement.bounds.x,
                        res.placement.bounds.y,
                        res.placement.art_shift,
                        res.placement.art_shift_y,
                    ));
                }
            }
        }

        let phys = display.dip_to_phys(res.placement.bounds);
        if sess.last_phys_bounds != Some(phys) {
            sess.last_phys_bounds = Some(phys);
            phys_to_apply = Some(phys);
        }
    }

    if let Some(phys) = phys_to_apply {
        let hwnd = app_state.pet_hwnd.load(Ordering::Relaxed);
        dispatch_bounds_to_main(window, hwnd, phys);
    }

    if snap {
        if let Some((ox, oy, dock)) = host_offsets {
            let mut patch = Map::new();
            patch.insert("hostOffsetX".into(), json!(ox));
            patch.insert("hostOffsetY".into(), json!(oy));
            patch.insert("hostDock".into(), json!(dock));
            let _ = app_state.update_settings_transactional(&patch, false);
        } else if let Some((x, y, sx, sy)) = desktop_pos {
            let mut patch = Map::new();
            patch.insert("x".into(), json!(x));
            patch.insert("y".into(), json!(y));
            patch.insert("desktopArtShiftX".into(), json!(sx));
            patch.insert("desktopArtShiftY".into(), json!(sy));
            let _ = app_state.update_settings_transactional(&patch, false);
        }
    }

    if changed || snap {
        let _ = window.emit("widget://snapshot", app_state.build_snapshot());
    }
    true
}

fn finish_drag(
    app_state: &SharedApp,
    window: &WebviewWindow,
    gen_id: u64,
    dx: f64,
    dy: f64,
    cancel: bool,
) {
    let current_gen = app_state.drag_gen.load(Ordering::Relaxed);
    if current_gen != gen_id || !app_state.dragging.load(Ordering::Relaxed) {
        return;
    }

    if cancel {
        let restored = {
            let mut guard = session_lock().lock().unwrap();
            if guard.as_ref().map(|s| s.gen_id) != Some(gen_id) {
                return;
            }
            guard.take()
        };
        app_state.drag_gen.fetch_add(1, Ordering::Relaxed);
        app_state.dragging.store(false, Ordering::Relaxed);
        foreground::set_dragging_flag(false);
        if let Some(sess) = restored {
            {
                let mut rt = app_state.runtime.lock().unwrap();
                rt.display_scale = sess.start_scale;
                rt.art_shift = sess.start_art_shift;
                rt.art_shift_y = sess.start_art_shift_y;
                rt.dock_side = sess.start_dock_side.clone();
                rt.facing = sess.start_facing.clone();
                rt.active_display = Some(sess.active_display);
            }
            let phys = sess.active_display.dip_to_phys(sess.start_bounds_dip);
            dispatch_bounds_to_main(window, app_state.pet_hwnd.load(Ordering::Relaxed), phys);
        }
        mouse_routing::sync_click_through(app_state, window);
        let _ = window.emit("widget://snapshot", app_state.build_snapshot());
        return;
    }

    let sess_meta = {
        let guard = session_lock().lock().unwrap();
        guard
            .as_ref()
            .filter(|s| s.gen_id == gen_id)
            .map(|s| (s.start_cursor_phys, s.start_cursor_dip, s.active_display))
    };

    let Some((start_cursor_phys, start_cursor_dip, active_display)) = sess_meta else {
        return;
    };

    let (final_dx, final_dy, target_display) = match foreground::get_cursor_pos_phys() {
        Some(cur_pt) if start_cursor_phys != Some(cur_pt) => {
            let disp = foreground::display_for_phys_point(cur_pt.0, cur_pt.1)
                .unwrap_or(active_display);
            let cur_dip = phys_point_to_dip(cur_pt, &disp);
            (
                cur_dip.0 - start_cursor_dip.0,
                cur_dip.1 - start_cursor_dip.1,
                Some(disp),
            )
        }
        _ => (dx, dy, None),
    };

    apply_drag_step(app_state, window, final_dx, final_dy, true, target_display);

    {
        let mut guard = session_lock().lock().unwrap();
        if guard.as_ref().map(|s| s.gen_id) == Some(gen_id) {
            *guard = None;
        }
    }
    app_state.drag_gen.fetch_add(1, Ordering::Relaxed);
    app_state.dragging.store(false, Ordering::Relaxed);
    foreground::set_dragging_flag(false);
    mouse_routing::sync_click_through(app_state, window);
    let _ = window.emit("widget://snapshot", app_state.build_snapshot());
}

pub fn handle_drag(
    app_state: &Arc<SharedApp>,
    window: &WebviewWindow,
    phase: &str,
    dx: f64,
    dy: f64,
) {
    if !dx.is_finite() || !dy.is_finite() || dx.abs() > 100_000.0 || dy.abs() > 100_000.0 {
        return;
    }

    match phase {
        "start" => {
            let hwnd = app_state.pet_hwnd.load(Ordering::Relaxed);
            let phys_bounds = foreground::get_window_bounds_phys(hwnd);
            let cur_pt = foreground::get_cursor_pos_phys();
            let displays = foreground::enumerate_displays();
            let lbutton_down = foreground::is_left_button_down();
            let phys_rect_display = phys_bounds.and_then(foreground::display_for_phys_rect);
            let cursor_display_probe = cur_pt.and_then(|(x, y)| foreground::display_for_phys_point(x, y));

            let (sess, gen_id) = {
                let rt = app_state.runtime.lock().unwrap();
                let active_display = phys_rect_display
                    .or(rt.active_display)
                    .or_else(|| displays.iter().find(|d| d.is_primary).copied())
                    .or_else(|| displays.first().copied())
                    .unwrap_or(DisplayInfo {
                        phys_work: Rect {
                            x: 0,
                            y: 0,
                            width: 1920,
                            height: 1080,
                        },
                        dip_work: Rect {
                            x: 0,
                            y: 0,
                            width: 1920,
                            height: 1080,
                        },
                        scale: 1.0,
                        is_primary: true,
                    });

                let start_bounds_dip = phys_bounds
                    .map(|p| active_display.phys_to_dip(p))
                    .unwrap_or(Rect {
                        x: active_display.dip_work.x + active_display.dip_work.width - 378,
                        y: active_display.dip_work.y + active_display.dip_work.height - 622,
                        width: 360,
                        height: 604,
                    });

                let scale = if rt.display_scale > 0 {
                    rt.display_scale
                } else {
                    rt.settings
                        .get("scale")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(220) as i32
                };
                let preferred_scale = rt
                    .settings
                    .get("scale")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(220) as i32;

                let start_visual_x = start_bounds_dip.x as f64
                    + (start_bounds_dip.width - scale) as f64 / 2.0
                    + rt.art_shift;
                let start_top = start_bounds_dip.y as f64 + rt.art_shift_y;
                let host_display = rt
                    .host_area_phys
                    .and_then(foreground::display_for_phys_rect);

                let cursor_display = cursor_display_probe.unwrap_or(active_display);
                let start_cursor_dip = cur_pt
                    .map(|pt| phys_point_to_dip(pt, &cursor_display))
                    .unwrap_or((0.0, 0.0));

                let gen_id = app_state.drag_gen.fetch_add(1, Ordering::Relaxed) + 1;
                (
                    DragSession {
                        gen_id,
                        start_bounds_dip,
                        start_visual_x,
                        start_top,
                        start_art_shift: rt.art_shift,
                        start_art_shift_y: rt.art_shift_y,
                        start_dock_side: rt.dock_side.clone(),
                        start_facing: rt.facing.clone(),
                        start_scale: scale,
                        start_cursor_phys: cur_pt,
                        start_cursor_dip,
                        last_cursor_phys: cur_pt,
                        saw_lbutton_down: lbutton_down,
                        preferred_scale,
                        host_area: rt.host_area,
                        host_display,
                        active_display,
                        last_phys_bounds: phys_bounds,
                    },
                    gen_id,
                )
            };

            {
                let mut guard = session_lock().lock().unwrap();
                *guard = Some(sess);
            }
            app_state.dragging.store(true, Ordering::Relaxed);
            foreground::set_dragging_flag(true);
            app_state.ignored.store(false, Ordering::Relaxed);
            let w = window.clone();
            let _ = window.run_on_main_thread(move || {
                let _ = w.set_ignore_cursor_events(false);
            });

            let app_clone = Arc::clone(app_state);
            let win_clone = window.clone();
            thread::spawn(move || {
                while !app_clone.quitting.load(Ordering::Relaxed)
                    && app_clone.dragging.load(Ordering::Relaxed)
                    && app_clone.drag_gen.load(Ordering::Relaxed) == gen_id
                {
                    let pressed = foreground::is_left_button_down();
                    let cur_pt = foreground::get_cursor_pos_phys();
                    let mut should_finish = false;
                    let mut moved_pt: Option<((i32, i32), (f64, f64), DisplayInfo)> = None;

                    {
                        let mut guard = session_lock().lock().unwrap();
                        if let Some(sess) = guard.as_mut() {
                            if sess.gen_id != gen_id {
                                break;
                            }
                            if pressed {
                                sess.saw_lbutton_down = true;
                            } else if sess.saw_lbutton_down {
                                should_finish = true;
                            }
                            if !should_finish {
                                if let Some(pt) = cur_pt {
                                    if sess.last_cursor_phys != Some(pt) {
                                        sess.last_cursor_phys = Some(pt);
                                        moved_pt = Some((pt, sess.start_cursor_dip, sess.active_display));
                                    }
                                }
                            }
                        } else {
                            break;
                        }
                    }

                    if should_finish {
                        finish_drag(&app_clone, &win_clone, gen_id, 0.0, 0.0, false);
                        break;
                    }
                    if let Some((pt, start_dip, fallback_disp)) = moved_pt {
                        let disp = foreground::display_for_phys_point(pt.0, pt.1)
                            .unwrap_or(fallback_disp);
                        let cur_dip = phys_point_to_dip(pt, &disp);
                        apply_drag_step(
                            &app_clone,
                            &win_clone,
                            cur_dip.0 - start_dip.0,
                            cur_dip.1 - start_dip.1,
                            false,
                            Some(disp),
                        );
                    }
                    thread::sleep(Duration::from_millis(8));
                }
            });
        }
        "move" => {
            if !app_state.dragging.load(Ordering::Relaxed) {
                return;
            }
            let start_pt = {
                let guard = session_lock().lock().unwrap();
                guard.as_ref().map(|sess| sess.start_cursor_phys)
            };
            let use_ipc_delta = match (start_pt, foreground::get_cursor_pos_phys()) {
                (Some(start_cursor), Some(pt)) => start_cursor == Some(pt),
                (Some(_), None) => true,
                _ => false,
            };
            if use_ipc_delta {
                apply_drag_step(app_state, window, dx, dy, false, None);
            }
        }
        "end" => {
            let gen_id = app_state.drag_gen.load(Ordering::Relaxed);
            finish_drag(app_state, window, gen_id, dx, dy, false);
        }
        "cancel" => {
            let gen_id = app_state.drag_gen.load(Ordering::Relaxed);
            finish_drag(app_state, window, gen_id, dx, dy, true);
        }
        _ => {}
    }
}
