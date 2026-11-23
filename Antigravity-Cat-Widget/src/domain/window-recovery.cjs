const { validBounds } = require("./host-visibility.cjs");

function getWorkArea(display) {
  if (!display || typeof display !== "object") return null;
  const area = display.workArea || display.bounds;
  return validBounds(area) ? area : null;
}

function intersectionArea(a, b) {
  if (!validBounds(a) || !validBounds(b)) return 0;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function isBoundsVisibleOnDisplays(bounds, displays, minOverlapSide = 48) {
  if (!validBounds(bounds)) return false;
  if (bounds.width < 40 || bounds.height < 40) return false;
  // Windows uses (-32000, -32000) for minimized HWND coordinates.
  if (bounds.x <= -20000 || bounds.y <= -20000) return false;
  if (!Array.isArray(displays) || !displays.length) return false;
  const requiredArea = minOverlapSide * minOverlapSide;
  for (const display of displays) {
    const area = getWorkArea(display);
    if (!area) continue;
    if (intersectionArea(bounds, area) >= Math.min(requiredArea, Math.floor((bounds.width * bounds.height) / 4))) {
      return true;
    }
  }
  return false;
}

function hasUsableDisplay(displays) {
  return Array.isArray(displays) && displays.some((display) => {
    const area = getWorkArea(display);
    return Boolean(area && area.width >= 360 && area.height >= 245);
  });
}

function reconcileBoundsForDisplays(currentBounds, displays, resolveFallbackBounds) {
  if (!hasUsableDisplay(displays)) return { actionable: false, changed: false, bounds: null };
  if (isBoundsVisibleOnDisplays(currentBounds, displays)) {
    return { actionable: true, changed: false, bounds: currentBounds };
  }
  const next = typeof resolveFallbackBounds === "function" ? resolveFallbackBounds() : null;
  if (!validBounds(next)) return { actionable: false, changed: false, bounds: null };
  return { actionable: true, changed: true, bounds: next };
}

function shouldWindowBeVisible({
  quitting = false,
  suspended = false,
  screenLocked = false,
  dragPlacement = false,
  hideForWeb = false,
  hostWindowOnly = false,
  hasHostArea = false,
  standaloneDesktopMode = true
} = {}) {
  if (quitting || suspended || screenLocked || dragPlacement) return false;
  if (hideForWeb) return false;
  if (hostWindowOnly && !hasHostArea && !standaloneDesktopMode) return false;
  return true;
}

module.exports = {
  getWorkArea,
  intersectionArea,
  isBoundsVisibleOnDisplays,
  hasUsableDisplay,
  reconcileBoundsForDisplays,
  shouldWindowBeVisible
};
