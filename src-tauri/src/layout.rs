use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DisplayInfo {
    pub phys_work: Rect,
    pub dip_work: Rect,
    pub scale: f64,
    pub is_primary: bool,
}

impl DisplayInfo {
    pub fn dip_to_phys(&self, dip: Rect) -> Rect {
        let s = if self.scale > 0.1 { self.scale } else { 1.0 };
        Rect {
            x: self.phys_work.x + (((dip.x - self.dip_work.x) as f64) * s).round() as i32,
            y: self.phys_work.y + (((dip.y - self.dip_work.y) as f64) * s).round() as i32,
            width: ((dip.width as f64) * s).round() as i32,
            height: ((dip.height as f64) * s).round() as i32,
        }
    }

    pub fn phys_to_dip(&self, phys: Rect) -> Rect {
        let s = if self.scale > 0.1 { self.scale } else { 1.0 };
        Rect {
            x: self.dip_work.x + (((phys.x - self.phys_work.x) as f64) / s).round() as i32,
            y: self.dip_work.y + (((phys.y - self.phys_work.y) as f64) / s).round() as i32,
            width: ((phys.width as f64) / s).round() as i32,
            height: ((phys.height as f64) / s).round() as i32,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LayoutDims {
    pub scale: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    pub bounds: Rect,
    pub art_shift: f64,
    pub art_shift_y: f64,
    pub visual_x: f64,
    pub visual_y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HostPlacement {
    pub scale: i32,
    pub placement: Placement,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DragPlacementResult {
    pub placement: Placement,
    pub scale: i32,
    pub side: String,
    pub host_offset_x: i32,
    pub host_offset_y: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DesktopPlacement {
    pub scale: i32,
    pub placement: Placement,
    pub dock_side: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReconcileResult {
    pub actionable: bool,
    pub changed: bool,
    pub bounds: Option<Rect>,
}

pub fn valid_bounds(value: &Rect) -> bool {
    value.x.abs() < 100_000
        && value.y.abs() < 100_000
        && value.width > 0
        && value.width < 100_000
        && value.height > 0
        && value.height < 100_000
}

pub fn widget_layout(area: Rect, preferred_scale: i32) -> LayoutDims {
    let scale = 1.max(preferred_scale.min(area.width - 80).min(area.height - 245));
    let width = area.width.min(360.max(scale + 80));
    let height = area.height.min(scale + 384);
    LayoutDims { scale, width, height }
}

pub fn character_placement(
    area: Rect,
    size: i32,
    dims: LayoutDims,
    left: f64,
    top: f64,
) -> Placement {
    let gap = (dims.width - size) as f64 / 2.0;
    let visual_x = left
        .max(area.x as f64)
        .min((area.x + area.width - size) as f64);
    let x = (visual_x - gap)
        .max(area.x as f64)
        .min((area.x + area.width - dims.width) as f64)
        .round() as i32;
    let y = top
        .max(area.y as f64)
        .min((area.y + area.height - dims.height) as f64)
        .round() as i32;
    // Constrain the artwork, not the empty bubble reserve above it.
    let reserve = (dims.height - size) as f64;
    let visual_y = (top + reserve)
        .max((area.y + 10) as f64)
        .min((area.y + area.height - size) as f64);
    Placement {
        bounds: Rect {
            x,
            y,
            width: dims.width,
            height: dims.height,
        },
        art_shift: visual_x - (x as f64) - gap,
        art_shift_y: visual_y - (y as f64) - reserve,
        visual_x,
        visual_y,
    }
}

pub fn host_placement(
    kind: &str,
    bounds: Option<Rect>,
    scale: i32,
    offset_x: i32,
    offset_y: i32,
    dock: &str,
) -> Option<HostPlacement> {
    if kind != "host" && kind != "self" {
        return None;
    }
    let area = bounds.filter(valid_bounds)?;
    let dims = widget_layout(area, scale);
    if dims.scale < 140 || area.width < 360 {
        return None;
    }
    let left = match dock {
        "left" => area.x as f64,
        "right" => (area.x + area.width - dims.scale) as f64,
        _ => (area.x + area.width - dims.scale - offset_x) as f64,
    };
    let top = (area.y + area.height - dims.height - offset_y) as f64;
    let placement = character_placement(area, dims.scale, dims, left, top);
    Some(HostPlacement {
        scale: dims.scale,
        placement,
    })
}

pub fn place_dragged_widget(
    area: Rect,
    preferred_scale: i32,
    left: f64,
    top: f64,
    snap: bool,
) -> DragPlacementResult {
    let dims = widget_layout(area, preferred_scale);
    let first = area.x as f64;
    let right = (area.x + area.width - dims.scale) as f64;
    let bottom = (area.y + area.height - dims.height) as f64;
    let side = if snap {
        if left <= first + 20.0 {
            "left"
        } else if left >= right - 20.0 {
            "right"
        } else {
            ""
        }
    } else {
        ""
    };
    let target_left = match side {
        "left" => first,
        "right" => right,
        _ => left.max(first).min(right),
    };
    let target_top = if snap && top >= bottom - 20.0 {
        bottom
    } else {
        top
    };
    let placement = character_placement(area, dims.scale, dims, target_left, target_top);
    let host_offset_x = (right - placement.visual_x).round() as i32;
    let host_offset_y =
        ((bottom - placement.bounds.y as f64) - placement.art_shift_y).round() as i32;
    DragPlacementResult {
        placement,
        scale: dims.scale,
        side: side.to_string(),
        host_offset_x,
        host_offset_y,
    }
}

pub fn facing_at(center_x: f64, area: Rect, previous: &str, dead_zone: f64) -> String {
    let offset = center_x - (area.x as f64 + area.width as f64 / 2.0);
    if offset < -dead_zone {
        "left".to_string()
    } else if offset > dead_zone {
        "right".to_string()
    } else if previous == "left" || previous == "right" {
        previous.to_string()
    } else {
        "right".to_string()
    }
}

pub fn intersection_area(a: Rect, b: Rect) -> i64 {
    if !valid_bounds(&a) || !valid_bounds(&b) {
        return 0;
    }
    let x1 = a.x.max(b.x);
    let y1 = a.y.max(b.y);
    let x2 = (a.x + a.width).min(b.x + b.width);
    let y2 = (a.y + a.height).min(b.y + b.height);
    if x2 <= x1 || y2 <= y1 {
        return 0;
    }
    (x2 - x1) as i64 * (y2 - y1) as i64
}

pub fn is_bounds_visible_on_displays(
    bounds: Rect,
    displays: &[Rect],
    min_overlap_side: i32,
) -> bool {
    if !valid_bounds(&bounds) || bounds.width < 40 || bounds.height < 40 {
        return false;
    }
    if bounds.x <= -20_000 || bounds.y <= -20_000 {
        return false;
    }
    if displays.is_empty() {
        return false;
    }
    let required_area = (min_overlap_side as i64 * min_overlap_side as i64)
        .min((bounds.width as i64 * bounds.height as i64) / 4);
    displays.iter().any(|&area| {
        valid_bounds(&area) && intersection_area(bounds, area) >= required_area
    })
}

pub fn has_usable_display(displays: &[Rect]) -> bool {
    displays
        .iter()
        .any(|d| valid_bounds(d) && d.width >= 360 && d.height >= 245)
}

pub fn reconcile_bounds_for_displays<F>(
    current_bounds: Rect,
    displays: &[Rect],
    resolve_fallback: F,
) -> ReconcileResult
where
    F: FnOnce() -> Option<Rect>,
{
    if !has_usable_display(displays) {
        return ReconcileResult {
            actionable: false,
            changed: false,
            bounds: None,
        };
    }
    if is_bounds_visible_on_displays(current_bounds, displays, 48) {
        return ReconcileResult {
            actionable: true,
            changed: false,
            bounds: Some(current_bounds),
        };
    }
    match resolve_fallback() {
        Some(next) if valid_bounds(&next) => ReconcileResult {
            actionable: true,
            changed: true,
            bounds: Some(next),
        },
        _ => ReconcileResult {
            actionable: false,
            changed: false,
            bounds: None,
        },
    }
}

pub fn display_matching_rect<'a>(rect: Rect, displays: &'a [DisplayInfo]) -> Option<&'a DisplayInfo> {
    if displays.is_empty() {
        return None;
    }
    displays
        .iter()
        .max_by_key(|d| intersection_area(rect, d.dip_work))
        .or_else(|| displays.iter().find(|d| d.is_primary))
        .or_else(|| displays.first())
}

pub fn display_nearest_dip_point<'a>(
    x: i32,
    y: i32,
    displays: &'a [DisplayInfo],
) -> Option<&'a DisplayInfo> {
    if displays.is_empty() {
        return None;
    }
    displays
        .iter()
        .min_by_key(|d| {
            let cx = x.clamp(d.dip_work.x, d.dip_work.x + d.dip_work.width);
            let cy = y.clamp(d.dip_work.y, d.dip_work.y + d.dip_work.height);
            let dx = (x - cx) as i64;
            let dy = (y - cy) as i64;
            dx * dx + dy * dy
        })
        .or_else(|| displays.first())
}

pub fn desktop_bounds(
    saved_x: Option<i32>,
    saved_y: Option<i32>,
    previous: Option<Rect>,
    displays: &[DisplayInfo],
    preferred_scale: i32,
    saved_shift_x: f64,
    saved_shift_y: f64,
    cur_shift_x: f64,
    cur_shift_y: f64,
) -> Option<(DesktopPlacement, DisplayInfo)> {
    let display = if let Some(prev) = previous {
        display_matching_rect(prev, displays)?
    } else if let (Some(sx), Some(sy)) = (saved_x, saved_y) {
        display_nearest_dip_point(sx, sy, displays)?
    } else {
        displays
            .iter()
            .find(|d| d.is_primary)
            .or_else(|| displays.first())?
    };

    let area = display.dip_work;
    let dims = widget_layout(area, preferred_scale);
    let saved = saved_x.is_some() && saved_y.is_some();

    let left = if let Some(prev) = previous {
        (prev.x + prev.width - dims.width) as f64
    } else if let Some(sx) = saved_x {
        sx as f64
    } else {
        (area.x + area.width - dims.width - 18) as f64
    };
    let top = if let Some(prev) = previous {
        (prev.y + prev.height - dims.height) as f64
    } else if let Some(sy) = saved_y {
        sy as f64
    } else {
        (area.y + area.height - dims.height - 18) as f64
    };

    let shift_x = if saved && previous.is_none() {
        saved_shift_x
    } else if previous.is_some() {
        cur_shift_x
    } else {
        0.0
    };
    let shift_y = if saved && previous.is_none() {
        saved_shift_y
    } else if previous.is_some() {
        cur_shift_y
    } else {
        0.0
    };

    let placement = character_placement(
        area,
        dims.scale,
        dims,
        left + (dims.width - dims.scale) as f64 / 2.0 + shift_x,
        top + shift_y,
    );

    let dock_side = if (placement.visual_x - area.x as f64).abs() < 2.0 {
        "left".to_string()
    } else if (placement.visual_x + dims.scale as f64 - (area.x + area.width) as f64).abs() < 2.0 {
        "right".to_string()
    } else {
        String::new()
    };

    Some((
        DesktopPlacement {
            scale: dims.scale,
            placement,
            dock_side,
        },
        *display,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_area() -> Rect {
        Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1032,
        }
    }

    fn sample_displays() -> Vec<DisplayInfo> {
        vec![DisplayInfo {
            phys_work: Rect {
                x: 0,
                y: 0,
                width: 2880,
                height: 1548,
            },
            dip_work: sample_area(),
            scale: 1.5,
            is_primary: true,
        }]
    }

    #[test]
    fn default_desktop_placement_matches_electron() {
        let displays = sample_displays();
        let (res, disp) = desktop_bounds(None, None, None, &displays, 220, 0.0, 0.0, 0.0, 0.0).unwrap();
        assert_eq!(res.scale, 220);
        assert_eq!(res.placement.bounds.width, 360);
        assert_eq!(res.placement.bounds.height, 604);
        assert_eq!(res.placement.bounds.x, 1920 - 360 - 18);
        assert_eq!(res.placement.bounds.y, 1032 - 604 - 18);
        assert_eq!(res.placement.art_shift, 0.0);
        assert_eq!(res.placement.art_shift_y, 0.0);

        let phys = disp.dip_to_phys(res.placement.bounds);
        assert_eq!(disp.phys_to_dip(phys), res.placement.bounds);
    }

    #[test]
    fn drag_breaks_top_bubble_reserve_with_negative_art_shift_y() {
        let area = sample_area();
        // Dragging high enough that window hits top=0 while art climbs into reserve zone
        let res = place_dragged_widget(area, 220, 500.0, -250.0, false);
        assert_eq!(res.placement.bounds.y, 0);
        assert!(res.placement.art_shift_y < 0.0);
        assert!(res.placement.visual_y >= 10.0);
    }

    #[test]
    fn drag_snaps_within_20px_of_edges_and_bottom() {
        let area = sample_area();
        let left_snap = place_dragged_widget(area, 220, 15.0, 300.0, true);
        assert_eq!(left_snap.side, "left");
        assert_eq!(left_snap.placement.visual_x, 0.0);
        assert_eq!(left_snap.placement.bounds.x, 0);
        assert!(left_snap.placement.art_shift < 0.0);

        let right_snap = place_dragged_widget(area, 220, (1920 - 220 - 12) as f64, 420.0, true);
        assert_eq!(right_snap.side, "right");
        assert_eq!(right_snap.placement.visual_x, (1920 - 220) as f64);
        assert!(right_snap.placement.art_shift > 0.0);
    }

    #[test]
    fn host_placement_supports_negative_coordinates_and_docks() {
        let neg_host = Rect {
            x: -1600,
            y: 40,
            width: 1200,
            height: 900,
        };
        let left = host_placement("host", Some(neg_host), 220, 18, 18, "left").unwrap();
        assert_eq!(left.placement.visual_x, -1600.0);
        assert_eq!(left.placement.bounds.x, -1600);

        let right = host_placement("host", Some(neg_host), 220, 18, 18, "right").unwrap();
        assert_eq!(right.placement.visual_x, (-1600 + 1200 - 220) as f64);
    }

    #[test]
    fn offscreen_bounds_reconcile_to_fallback() {
        let displays = vec![sample_area()];
        let offscreen = Rect {
            x: 5000,
            y: 5000,
            width: 360,
            height: 604,
        };
        let res = reconcile_bounds_for_displays(offscreen, &displays, || {
            Some(Rect {
                x: 1542,
                y: 410,
                width: 360,
                height: 604,
            })
        });
        assert!(res.actionable);
        assert!(res.changed);
        assert_eq!(res.bounds.unwrap().x, 1542);
    }
}
