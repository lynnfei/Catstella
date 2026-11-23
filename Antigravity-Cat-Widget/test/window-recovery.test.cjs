const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isBoundsVisibleOnDisplays,
  hasUsableDisplay,
  reconcileBoundsForDisplays,
  shouldWindowBeVisible
} = require("../src/domain/window-recovery.cjs");

test("isBoundsVisibleOnDisplays detects offscreen, minimized, zero-size, and disconnected monitor bounds", () => {
  const displays = [
    { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }
  ];
  assert.equal(isBoundsVisibleOnDisplays({ x: 1500, y: 400, width: 320, height: 600 }, displays), true);
  assert.equal(isBoundsVisibleOnDisplays({ x: 2400, y: 300, width: 320, height: 600 }, displays), true);
  // Edge overlap (>= 48x48) remains reachable
  assert.equal(isBoundsVisibleOnDisplays({ x: -120, y: 200, width: 320, height: 600 }, displays), true);
  // Windows Win32 minimized sentinel
  assert.equal(isBoundsVisibleOnDisplays({ x: -32000, y: -32000, width: 160, height: 28 }, displays), false);
  // Completely outside displays (e.g. removed monitor or far offscreen)
  assert.equal(isBoundsVisibleOnDisplays({ x: 4500, y: 300, width: 320, height: 600 }, displays), false);
  assert.equal(isBoundsVisibleOnDisplays({ x: 100, y: 1200, width: 320, height: 600 }, displays), false);
  assert.equal(isBoundsVisibleOnDisplays({ x: 0, y: 0, width: 0, height: 0 }, displays), false);
});

test("reconcileBoundsForDisplays ignores dummy/empty sleep topologies without overwriting coordinates", () => {
  const dummyDisplays = [{ workArea: { x: 0, y: 0, width: 10, height: 10 } }];
  assert.equal(hasUsableDisplay(dummyDisplays), false);
  assert.equal(hasUsableDisplay([]), false);
  const res = reconcileBoundsForDisplays({ x: 1500, y: 400, width: 320, height: 600 }, dummyDisplays, () => ({ x: 100, y: 100, width: 320, height: 600 }));
  assert.deepEqual(res, { actionable: false, changed: false, bounds: null });

  const realDisplays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
  const offscreen = reconcileBoundsForDisplays({ x: 2400, y: 300, width: 320, height: 600 }, realDisplays, () => ({ x: 1582, y: 422, width: 320, height: 600 }));
  assert.equal(offscreen.actionable, true);
  assert.equal(offscreen.changed, true);
  assert.deepEqual(offscreen.bounds, { x: 1582, y: 422, width: 320, height: 600 });
});

test("shouldWindowBeVisible distinguishes intentional hiding from unexpected disappearance", () => {
  assert.equal(shouldWindowBeVisible({}), true);
  assert.equal(shouldWindowBeVisible({ quitting: true }), false);
  assert.equal(shouldWindowBeVisible({ suspended: true }), false);
  assert.equal(shouldWindowBeVisible({ screenLocked: true }), false);
  assert.equal(shouldWindowBeVisible({ dragPlacement: true }), false);
  assert.equal(shouldWindowBeVisible({ hideForWeb: true }), false);
  assert.equal(shouldWindowBeVisible({ hostWindowOnly: true, hasHostArea: false, standaloneDesktopMode: false }), false);
  assert.equal(shouldWindowBeVisible({ hostWindowOnly: true, hasHostArea: false, standaloneDesktopMode: true }), true);
  assert.equal(shouldWindowBeVisible({ hostWindowOnly: true, hasHostArea: true, standaloneDesktopMode: false }), true);
});
