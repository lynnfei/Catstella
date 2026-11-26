const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CompanionVisibility } = require('../src/domain/companion-visibility.cjs');
const { ForegroundMonitor, hostPlacement, placeDraggedWidget, facingAt } = require('../src/domain/host-visibility.cjs');
const nativeDir = path.join(__dirname, '..', 'src', 'native');
const hasLegacyNativeHelper = process.platform === 'win32'
  && fs.existsSync(nativeDir)
  && fs.readdirSync(nativeDir).some((name) => /^ForegroundHost.*\.exe$/i.test(name));
test('drag facing follows the image center and stays stable in the center dead zone', () => {
  const area = { x:-1280, width:1280 };
  assert.equal(facingAt(-644, area, 'right'), 'right');
  assert.equal(facingAt(-660, area, 'right'), 'left');
  assert.equal(facingAt(-636, area, 'left'), 'left');
  assert.equal(facingAt(-620, area, 'left'), 'right');
});
test('widget drag keeps free movement and persists a snapped host placement on a negative-coordinate screen', () => {
  const area = { x:-1280, y:-100, width:1280, height:900 };
  const target = placeDraggedWidget(area, 220, -1271, 184, { following:true });
  assert.equal(target.visualX,-1271);
  assert.equal(target.side,'');
  const snapped = placeDraggedWidget(area,220,-1271,184,{following:true,snap:true});
  assert.equal(snapped.side,'left');
  const restored = hostPlacement({kind:'host',bounds:area},220,snapped.hostOffsetX,snapped.hostOffsetY,snapped.side);
  assert.deepEqual(restored.bounds,snapped.bounds);
  assert.equal(restored.artShift,snapped.artShift);
  const standalone = placeDraggedWidget(area,220,-1290,300,{snap:true});
  assert.equal(standalone.bounds.x,area.x);
  assert.equal(standalone.visualX,area.x,'standalone artwork can touch the display edge');
  assert.equal(standalone.artShift,-70);
});
test('artwork reaches both halves and both edges while the transparent window stays in bounds', () => {
  for (const area of [{x:0,y:0,width:1280,height:900},{x:-1920,y:-200,width:1920,height:1080}]) {
    for (const scale of [140,220,360]) for (const following of [false,true]) {
      const top=placeDraggedWidget(area,scale,area.x-100,area.y-1000,{following,snap:true});
      assert.equal(top.visualX,area.x);
      assert.equal(top.visualY,area.y+10);
      assert.equal(top.bounds.y,area.y);
      assert(top.artShiftY<0);
      const bottom=placeDraggedWidget(area,scale,area.x+area.width,area.y+area.height,{following,snap:true});
      assert.equal(bottom.visualX+scale,area.x+area.width);
      assert.equal(bottom.visualY+scale,area.y+area.height);
      for(const p of [top,bottom]) {
        assert(p.bounds.x>=area.x&&p.bounds.y>=area.y);
        assert(p.bounds.x+p.bounds.width<=area.x+area.width);
        assert(p.bounds.y+p.bounds.height<=area.y+area.height);
        if(following) {
          const restored=hostPlacement({kind:'host',bounds:area},scale,p.hostOffsetX,p.hostOffsetY,p.side);
          assert.deepEqual(restored.bounds,p.bounds);assert.equal(restored.artShiftY,p.artShiftY);
        }
      }
    }
  }
});
test('mutual visibility uses real foreground and retains the Web owner through a taskbar excursion', () => {
  const policy = new CompanionVisibility();
  const web = { online: true, active: true, visible: true };
  assert.equal(policy.hideDesktop('prefer-web', web, { kind: 'host', foregroundKind: 'browser' }), true, 'background IDE availability must not force the desktop pet visible');
  assert.equal(policy.hideDesktop('prefer-web', { ...web, active: false }, { foregroundKind: 'shell' }), true);
  assert.equal(policy.hideDesktop('prefer-web', { ...web, active: false }, { foregroundKind: 'browser' }), false, 'another browser tab/window must release the owner');
  policy.hideDesktop('prefer-web', web, { foregroundKind: 'browser' });
  assert.equal(policy.hideDesktop('prefer-web', web, { foregroundKind: 'other' }), false, 'another real application takes precedence over a stale heartbeat');
  policy.hideDesktop('prefer-web', web, { foregroundKind: 'browser' });
  assert.equal(policy.hideDesktop('prefer-web', { ...web, active: false, visible: false }, { foregroundKind: 'shell' }), false);
  assert.equal(policy.hideDesktop('prefer-web', web, { foregroundKind: 'host' }), false);
  assert.equal(policy.hideDesktop('both', web, { foregroundKind: 'browser' }), false);
  assert.equal(policy.hideDesktop('prefer-web', { online: false }, { foregroundKind: 'shell' }), false);
});
test('versioned native helper reports actual foreground metadata without controlling a window', async (t) => {
  if (!hasLegacyNativeHelper) { t.skip('legacy C# ForegroundHost*.exe helper not built'); return; }
  const monitor = new ForegroundMonitor();
  try {
    const state = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('native metadata timeout')), 5000);
      monitor.once('change', value => { clearTimeout(timeout); resolve(value); });
      monitor.start(); // No window handle: metadata only.
    });
    assert.ok(['host', 'self', 'desktop', 'shell', 'browser', 'other'].includes(state.foregroundKind));
  } finally { monitor.stop(); }
});
