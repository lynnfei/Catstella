const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeSidePlacement,
  resolveSideQuotaMetrics,
  toDisplayPercent,
  levelForPercent,
  worstLevel
} = require('../src/renderer/side-quota.js');

test('toDisplayPercent handles remaining mode vs Web used mode cleanly', () => {
  assert.equal(toDisplayPercent(72, 'remaining'), 72);
  assert.equal(toDisplayPercent(72, 'used'), 28);
  assert.equal(toDisplayPercent(0, 'remaining'), 0);
  assert.equal(toDisplayPercent(0, 'used'), 100);
  assert.equal(toDisplayPercent(100, 'used'), 0);
  assert.equal(toDisplayPercent(null, 'used'), null);
});

test('levelForPercent and worstLevel always derive warning state from remaining headroom', () => {
  assert.equal(levelForPercent(80), 'normal');
  assert.equal(levelForPercent(25), 'low');
  assert.equal(levelForPercent(15), 'critical');
  assert.equal(levelForPercent(0), 'critical');
  assert.equal(worstLevel(85, 8), 'critical');
  assert.equal(worstLevel(null, 25), 'low');
});

test('computeSidePlacement chooses open side near left/right screen dock and keeps widget inside bounds', () => {
  // Docked right inside 360px window -> mascot shifted right (`x: 160`), open space is LEFT
  const rightDock = computeSidePlacement({
    viewport: { width: 360, height: 604 },
    pet: { x: 160, y: 404, scale: 200 },
    variant: 'arc',
    preferredSide: 'right',
    sideDistance: 'normal',
    sideSize: 'md'
  });
  assert.equal(rightDock.side, 'left');
  assert.ok(rightDock.x >= 6 && rightDock.x + rightDock.widget.width <= 160);

  // Docked left inside 360px window -> mascot shifted left (`x: 0`), open space is RIGHT
  const leftDock = computeSidePlacement({
    viewport: { width: 360, height: 604 },
    pet: { x: 0, y: 404, scale: 200 },
    variant: 'ring',
    preferredSide: 'left',
    sideDistance: 'normal',
    sideSize: 'md'
  });
  assert.equal(leftDock.side, 'right');
  assert.ok(leftDock.x >= 200 && leftDock.x + leftDock.widget.width <= 354);
});

test('computeSidePlacement adapts smoothly across fine-tuned distance and size presets', () => {
  const compact = computeSidePlacement({
    viewport: { width: 360, height: 604 },
    pet: { x: 80, y: 404, scale: 200 },
    variant: 'bar',
    preferredSide: 'left',
    sideDistance: 'compact',
    sideSize: 'sm'
  });
  const relaxed = computeSidePlacement({
    viewport: { width: 360, height: 604 },
    pet: { x: 80, y: 404, scale: 200 },
    variant: 'bar',
    preferredSide: 'left',
    sideDistance: 'relaxed',
    sideSize: 'lg'
  });
  assert.equal(compact.side, 'left');
  assert.equal(relaxed.side, 'left');
  assert.ok(compact.widget.width < relaxed.widget.width);
  // Larger gap puts relaxed gauge further left of mascot (smaller x) when room allows
  assert.ok(relaxed.x < compact.x);
});

test('resolveSideQuotaMetrics handles AGY, manual 0%, Web auto fallback, and explicit source selection', () => {
  const manualZero = resolveSideQuotaMetrics({
    settings: { manualQuota: true, manualPercent: 0, manualWeeklyPercent: 40, sideQuotaSource: 'auto' },
    quotaWindows: { gemini: { fiveHour: 80, weekly: 90 } }
  });
  assert.equal(manualZero.source, 'agy');
  assert.equal(manualZero.fiveHour, 0);
  assert.equal(manualZero.weekly, 40);

  const webAuto = resolveSideQuotaMetrics({
    settings: { manualQuota: false, sideQuotaSource: 'auto' },
    quotaWindows: {},
    webCompanion: {
      online: true,
      quota: {
        fiveHourRemainingPct: 64,
        weeklyRemainingPct: 88,
        resetHint: '2h 10m',
        weeklyResetHint: '4d'
      }
    }
  });
  assert.equal(webAuto.source, 'web');
  assert.equal(webAuto.sourceBadge, 'Web · 剩余');
  assert.equal(webAuto.fiveHour, 64);
  assert.equal(webAuto.weekly, 88);

  const webForcedUsed = resolveSideQuotaMetrics({
    settings: { manualQuota: false, sideQuotaSource: 'web', sideQuotaMode: 'used' },
    quotaWindows: { gemini: { fiveHour: 90, weekly: 95 } },
    webCompanion: {
      online: true,
      quota: {
        fiveHourUsedPct: 35,
        weeklyUsedPct: 12
      }
    }
  });
  assert.equal(webForcedUsed.source, 'web');
  assert.equal(webForcedUsed.sourceBadge, 'Web · 已用');
  assert.equal(webForcedUsed.fiveHour, 65);
  assert.equal(webForcedUsed.weekly, 88);
});

test('MouseRouting notifies onIgnored when cursor exits bounds/hit-zone and onEntered on re-entry', async () => {
  const { MouseRouting } = require('../src/domain/mouse-routing.cjs');
  let cursor = { x: 120, y: 200 };
  let activeInDom = true;
  const events = [];
  const win = {
    id: 1,
    isDestroyed: () => false,
    isVisible: () => true,
    getContentBounds: () => ({ x: 100, y: 100, width: 360, height: 600 }),
    setIgnoreMouseEvents: (val) => events.push(['set', val]),
    webContents: { executeJavaScript: async () => activeInDom }
  };
  const routing = new MouseRouting({
    window: () => win,
    screen: { getCursorScreenPoint: () => cursor },
    clickThrough: () => false,
    dragging: () => false,
    platform: 'win32',
    onIgnored: () => events.push(['ignored']),
    onEntered: (_w, coords) => events.push(['entered', coords.x, coords.y])
  });

  routing.stopped = false;
  await routing.tick();
  clearTimeout(routing.timer);
  assert.deepEqual(events, [['set', false], ['entered', 20, 100]]);

  // Exit straight out of window left edge (no Chromium pointerleave fired).
  events.length = 0;
  cursor = { x: 95, y: 200 };
  await routing.tick();
  clearTimeout(routing.timer);
  assert.deepEqual(events, [['set', true], ['ignored']]);

  // Move onto tooltip across gap and stop.
  events.length = 0;
  cursor = { x: 112, y: 210 };
  activeInDom = true;
  await routing.tick();
  clearTimeout(routing.timer);
  assert.deepEqual(events, [['set', false], ['entered', 12, 110]]);

  // Exit downward onto transparent area inside bounds.
  events.length = 0;
  cursor = { x: 112, y: 250 };
  activeInDom = false;
  await routing.tick();
  routing.stop();
  assert.deepEqual(events, [['set', true], ['ignored']]);
});

test('resolveSideQuotaMetrics reads HostQuotaAdapter fiveHourReset/weeklyReset, argon reset and thinking fields', () => {
  const agySnap = resolveSideQuotaMetrics({
    settings: { manualQuota: false, sideQuotaSource: 'agy' },
    quotaWindows: {
      online: true,
      fiveHour: 88,
      weekly: 92,
      fiveHourReset: '2小时5分钟后重置',
      weeklyReset: '4天后重置',
      modelInfo: { modelName: 'Gemini 4 Pro', thinking: 'High' }
    }
  });
  assert.equal(agySnap.source, 'agy');
  assert.equal(agySnap.fiveHour, 88);
  assert.equal(agySnap.weekly, 92);
  assert.equal(agySnap.fiveHourReset, '2小时5分钟后重置');
  assert.equal(agySnap.weeklyReset, '4天后重置');
  assert.equal(agySnap.modelLabel, 'Gemini 4 Pro · High');

  const argonSnap = resolveSideQuotaMetrics({
    settings: { manualQuota: false, sideQuotaSource: 'agy' },
    quotaWindows: {
      online: true,
      fiveHour: 85,
      weekly: 70,
      fiveHourReset: '1小时后重置',
      argon: { weekly: 12, weeklyReset: '6天20小时后重置' },
      modelInfo: { modelName: 'Gemini 4 Argon', thinking: '默认' }
    }
  });
  assert.equal(argonSnap.fiveHour, 85);
  assert.equal(argonSnap.weekly, 12);
  assert.equal(argonSnap.fiveHourReset, '1小时后重置');
  assert.equal(argonSnap.weeklyReset, '6天20小时后重置');
  assert.equal(argonSnap.modelLabel, 'Gemini 4 Argon');
  assert.equal(argonSnap.orchestrator, false);
});

test('resolveSideQuotaMetrics strips Orchestrator prefix and exposes orchestrator flag cleanly', () => {
  const structured = resolveSideQuotaMetrics({
    settings: { manualQuota: false, sideQuotaSource: 'agy' },
    quotaWindows: {
      online: true,
      fiveHour: 100,
      weekly: 100,
      modelInfo: { modelName: 'Gemini 4 Neon', thinking: 'Extra High', orchestrator: true }
    }
  });
  assert.equal(structured.orchestrator, true);
  assert.equal(structured.modelLabel, 'Gemini 4 Neon · Extra High');

  const legacyUnstripped = resolveSideQuotaMetrics({
    settings: { manualQuota: false, sideQuotaSource: 'agy' },
    quotaWindows: {
      online: true,
      fiveHour: 90,
      weekly: 95,
      modelInfo: { modelName: 'Orchestrator Gemini 4 Neon', thinking: 'Extra High' }
    }
  });
  assert.equal(legacyUnstripped.orchestrator, true);
  assert.equal(legacyUnstripped.modelLabel, 'Gemini 4 Neon · Extra High');

  const manualFallback = resolveSideQuotaMetrics({
    settings: { manualQuota: true, manualPercent: 50, manualWeeklyPercent: 75, sideQuotaSource: 'agy' },
    quotaWindows: { modelInfo: { modelName: 'Gemini 4 Neon', thinking: 'Extra High', orchestrator: true } }
  });
  assert.equal(manualFallback.orchestrator, false);

  const webFallback = resolveSideQuotaMetrics({
    settings: { manualQuota: false, sideQuotaSource: 'web' },
    quotaWindows: { modelInfo: { modelName: 'Gemini 4 Neon', thinking: 'Extra High', orchestrator: true } },
    webCompanion: { online: true, quota: { fiveHourRemainingPct: 80, weeklyRemainingPct: 90 } }
  });
  assert.equal(webFallback.orchestrator, false);
});
