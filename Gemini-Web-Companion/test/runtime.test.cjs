const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('web pet behavior accepts only short, stationary clicks', () => {
  const ctx = vm.createContext({});
  vm.runInContext(source('content/pet-behavior.js'), ctx);
  const PetBehavior = ctx.CatstellaPetBehavior;
  assert.equal(PetBehavior.isTap(0, 0), true);
  assert.equal(PetBehavior.isTap(PetBehavior.tapLimit, PetBehavior.tapSlop), true);
  assert.equal(PetBehavior.isTap(PetBehavior.tapLimit + 1, 0), false);
  assert.equal(PetBehavior.isTap(200, PetBehavior.tapSlop + 1), false);
  assert.equal(PetBehavior.isTap(Number.NaN, 0), false);
});

test('web expression preview does not queue head taps and the wake motion keeps priority', () => {
  const ctx = vm.createContext({ setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(source('content/pet-behavior.js'), ctx);
  let now = 0;
  const pet = new ctx.CatstellaPetBehavior(() => {}, { now: () => now, random: () => 0 });
  pet.sync({ visible: true, idle: true, rest: true, expressions: true });
  pet.show('shy', 'preview');
  assert.equal(pet.tap(), null);
  now += 300;
  assert.equal(pet.tap(), null);
  pet.clearExpression();
  now += 300;
  assert.equal(pet.tap(), 'proud');
  pet.previewNap();
  assert.equal(pet.activity(true), true);
  assert.equal(pet.show('proud', 'system'), false);
  assert.equal(pet.tap(), null);
});

for (const gecko of [false, true]) {
  for (const target of ['content', 'background']) {
    test(`${target} storage uses one ${gecko ? 'Promise' : 'callback'} invocation and awaits completion`, async () => {
      const calls = [];
      let finish;
      // Firefox content scripts expose browser.runtime without getBrowserInfo.
      const runtime = { id: 'fixture' };
      const api = { runtime, storage: { local: {
        get(keys, callback) {
          calls.push(['get', keys]);
          if (gecko) assert.equal(callback, undefined);
          if (gecko) return Promise.resolve({ enabled: false });
          callback({ enabled: false });
        },
        set(value, callback) {
          calls.push(['set', value]);
          if (gecko) assert.equal(callback, undefined);
          if (gecko) return new Promise(resolve => { finish = resolve; });
          finish = callback;
        }
      } } };
      const window = {};
      const ctx = vm.createContext({ window, console: { log() {} }, ...(gecko ? { browser: api } : { chrome: api }) });
      if (target === 'content') vm.runInContext(source('content/shim.js'), ctx);
      else vm.runInContext(source('background.js').split('// ---- AGY Desktop')[0] + '\nglobalThis.methods = { storageGet: safeStorageGet, storageSet: safeStorageSet };', ctx);
      const methods = target === 'content' ? window.KIMINO_API : ctx.methods;
      assert.equal((await methods.storageGet(['enabled'])).enabled, false);
      let settled = false;
      const setting = methods.storageSet({ enabled: true }).then(value => { settled = true; return value; });
      await Promise.resolve();
      assert.equal(settled, false, 'write must not resolve before storage has completed');
      finish();
      assert.equal(await setting, true);
      assert.equal(calls.filter(c => c[0] === 'get').length, 1);
      assert.equal(calls.filter(c => c[0] === 'set').length, 1);
      api.storage.local.get = () => { throw Error('context unavailable'); };
      api.storage.local.set = () => gecko ? Promise.reject(Error('storage rejected')) : (() => { throw Error('context unavailable'); })();
      assert.equal(Object.keys(await methods.storageGet(null)).length, 0);
      assert.equal(await methods.storageSet({}), false);
    });
  }
}

test('Firefox content heartbeat uses Promise messaging without getBrowserInfo and with both namespaces', async () => {
  const sent = [];
  const api = {runtime:{id:'firefox-fixture',
    sendMessage(message, options) {
      if (options !== undefined) throw Error('Unexpected argument types for runtime.sendMessage');
      sent.push(message);
      return Promise.resolve({ok:true,online:true});
    }}};
  const window = {};
  const ctx = vm.createContext({window,browser:api,chrome:api,console:{log(){}}});
  vm.runInContext(source('content/shim.js'),ctx);
  const message = {type:'KG_TAB_HEARTBEAT',active:true,visible:true};
  const result = await window.KIMINO_API.sendMessage(message);
  assert.equal(result?.online,true);
  assert.deepEqual(sent,[message]);
});

test('wallpaper previews are fetched once per revision, cached, and limited to two workers', async () => {
  let requests = 0, active = 0, peak = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const ctx = vm.createContext({ chrome: { runtime: {} }, console, Date, AbortController, Uint8Array, Blob, btoa,
    setTimeout, clearTimeout,
    fetch: async () => {
      requests++; active++; peak = Math.max(peak, active);
      await gate; active--;
      return new Response(Uint8Array.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    }
  });
  vm.runInContext(source('background.js').split('async function syncDesktopWallpaperIfNeeded')[0] + '\nglobalThis.preview = wallpaperPreview;', ctx);
  const first = ctx.preview('one', '1');
  assert.equal(ctx.preview('one', '1'), first, 'concurrent preview requests must share one download');
  const rest = ['two', 'three', 'four'].map(id => ctx.preview(id, '1'));
  await Promise.resolve();
  assert.equal(requests, 2);
  release();
  const previews = await Promise.all([first, ...rest]);
  assert.equal(peak, 2);
  assert.ok(previews.every(value => value.startsWith('data:image/png;base64,')));
  await ctx.preview('one', '1');
  assert.equal(requests, 4);
  await ctx.preview('one', '2');
  assert.equal(requests, 5, 'new file revisions must invalidate the cache');
});

test('a slow wallpaper transfer does not block focus/visibility synchronization', async () => {
  let handler, releaseImage;
  const bodies = [];
  const memory = {};
  const api = { runtime: { onMessage: { addListener(fn) { handler = fn; } }, onInstalled: { addListener() {} } },
    storage: { local: { get(keys, callback) { callback(memory); }, set(value, callback) { Object.assign(memory, value); callback(); } } }, tabs: { onRemoved: { addListener() {} } } };
  const imageReady = new Promise(resolve => { releaseImage = resolve; });
  const ctx = vm.createContext({ chrome: api, console, Date, AbortController, Uint8Array, btoa, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => {
      if (url.includes('/companion/sync')) {
        bodies.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ ok: true, sync: { syncWallpaper: true }, desktop: { wallpaperId: 'one', wallpaperRev: 'one:1' } }), { headers: { 'content-type': 'application/json' } });
      }
      await imageReady;
      return new Response(Uint8Array.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    }
  });
  vm.runInContext(source('background.js'), ctx);
  await new Promise(resolve => handler({ type: 'KG_TAB_HEARTBEAT', active: true, visible: true }, { tab: { id: 1 } }, resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(bodies.some(body => body.webActive && body.webVisible));
  await new Promise(resolve => handler({ type: 'KG_TAB_HEARTBEAT', active: false, visible: true }, { tab: { id: 1 } }, resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bodies.at(-1).webActive, false);
  assert.equal(bodies.at(-1).webVisible, true);
  releaseImage();
});

function appearanceBridgeFixture() {
  let handler, online = true, rejectWrite = false, invalidReply = false, gate, worker;
  const store = { character: 'lin-cat', customCharacter: 'data:image/png;base64,web', wallpaperId: 'custom:online-one' };
  const desktop = { characterPack: 'gemini-star-v1', agyQuota: { fiveHour: 75 } };
  const sync = { syncCharacter: true, syncWallpaper: true };
  const stateWrites = [];
  const requests = [];
  function boot() {
    const runtime = { id: 'catstella', getURL: file => 'chrome-extension://catstella/' + file,
      onMessage: { addListener(fn) { handler = fn; } }, onInstalled: { addListener() {} } };
    const api = { runtime, storage: { local: {
      get(keys, cb) { cb(structuredClone(store)); },
      set(value, cb) {
        if (rejectWrite) {
          runtime.lastError = new Error('storage unavailable');
          try { cb(); } finally { delete runtime.lastError; }
          return;
        }
        stateWrites.push(structuredClone(value));
        Object.assign(store, structuredClone(value));
        cb();
      }
    } }, tabs: { onRemoved: { addListener() {} } } };
    worker = vm.createContext({ chrome: api, Date, URL, AbortController, Uint8Array, btoa,
      setTimeout: callback => callback.name === 'flushHeadPats' ? setTimeout(callback,0) : 1,
      clearTimeout: timer => { if (typeof timer === 'object') clearTimeout(timer); },
      fetch: async (_url, options) => {
        if (_url.endsWith('/assets/gallery.json')) return new Response(JSON.stringify({wallpapers:[{id:'built-in'}]}));
        if (!online) throw new Error('offline');
        const request = JSON.parse(options.body);
        requests.push(request);
        const { patch } = request;
        const pause = gate;
        gate = null;
        for (const key of Object.keys(sync)) if (typeof patch?.[key] === 'boolean') sync[key] = patch[key];
        if (patch?.characterPack && sync.syncCharacter) desktop.characterPack = patch.characterPack;
        const payload = invalidReply ? 'invalid' : JSON.stringify({ ok: true, sync, desktop });
        if (pause) { pause.sent(patch); await pause.wait; }
        return new Response(payload);
      }
    });
    vm.runInContext(source('background.js'), worker);
  }
  function pauseNextResponse() {
    let sent, release;
    const requested = new Promise(resolve => { sent = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    gate = { sent, wait };
    return { requested, release };
  }
  const send = (message, sender = { tab: { id: 1 } }) => new Promise(resolve => {
    if (handler(message, sender, resolve) !== true) resolve(undefined);
  });
  const ping = () => send({ type: 'KG_TAB_HEARTBEAT', active: true });
  const patch = value => send({ type: 'KG_BRIDGE_PATCH', patch: value });
  boot();
  const settle = () => vm.runInContext('(async () => { while (syncInFlight) await syncInFlight; })()', worker);
  return { boot, ping, patch, send, settle, store, desktop, sync, stateWrites, requests, pauseNextResponse,
    cycle:()=>vm.runInContext('checkLocalWallpaperCycle()',worker),
    setOnline: value => { online = value; },
    invalidReply: value => { invalidReply = value; },
    rejectWrite: value => { rejectWrite = value; }
  };
}

test('head pats are counted once across tabs and persisted without accepting other origins', async () => {
  const bridge = appearanceBridgeFixture();
  await bridge.settle();
  const pat = { type: 'KG_HEAD_PAT' };
  const sender = { id: 'catstella', frameId: 0, url: 'https://gemini.google.com/app' };
  assert.equal(await bridge.send(pat, { ...sender, url: 'https://example.test/' }), undefined);
  assert.equal(await bridge.send(pat, { ...sender, frameId: 2 }), undefined);
  const counts = await Promise.all([bridge.send(pat, sender), bridge.send(pat, { ...sender, tab: { id: 2 } })]);
  assert.deepEqual(counts.map(result => result.total), [1, 2]);
  assert.deepEqual(counts.map(result => result.today), [1, 2]);
  assert.equal(bridge.stateWrites.filter(value => value.headPatTotal).length,1);
  bridge.boot();
  assert.equal((await bridge.send(pat, sender)).today, 3);
  bridge.store.headPatDay = '2000-1-1';
  const nextDay = await bridge.send(pat, sender);
  assert.equal(nextDay.total, 4);
  assert.equal(nextDay.today, 1);
});

test('only independent Web wallpaper settings can advance their own persistent cycle',async () => {
  const bridge=appearanceBridgeFixture();
  await bridge.settle();
  const before=bridge.stateWrites.length;
  const {store}=bridge;
  Object.assign(store,{
    syncWallpaper:true,webWallpaperSlideshow:true,webWallpaperInterval:2,
    customWallpapers:[{id:'custom:online-one'},{id:'custom:online-two'}],
    webWallpaperCycle:{anchor:store.wallpaperId,id:store.wallpaperId,minutes:2,nextAt:Date.now()-1}
  });
  await bridge.cycle();
  assert.equal(store.webWallpaperCycle.id,'custom:online-one');
  assert.equal(bridge.stateWrites.length,before);
  store.syncWallpaper=false;
  bridge.sync.syncWallpaper=false;
  await Promise.all([bridge.cycle(),bridge.cycle()]);
  assert.equal(store.webWallpaperCycle.id,'custom:online-two');
  assert.equal(bridge.stateWrites.length,before+1,'two tabs share one cycle');
  assert.equal(store.wallpaperId,'custom:online-one','the cycle leaves the manual choice available');
  store.wallpaperId='built-in';
  await bridge.cycle();
  assert.equal(store.webWallpaperCycle.id,'built-in');
});

test('AGY usage is opt-out, independent of other synchronization, and rejects stale quota replies', async () => {
  const bridge = appearanceBridgeFixture();
  await bridge.ping();
  await bridge.settle();
  assert.equal(bridge.store.agyBridgeState.desktop.agyQuota.fiveHour, 75);
  const paused = bridge.pauseNextResponse();
  const ping = bridge.ping();
  await paused.requested;
  bridge.store.syncAgyUsage = false;
  paused.release();
  await ping;
  assert.equal(bridge.store.agyBridgeState.desktop.agyQuota, undefined);
  await bridge.ping();
  assert.equal(bridge.requests.at(-1).includeAgyQuota, false);
  assert.equal(bridge.store.agyBridgeState.desktop.agyQuota, undefined, 'legacy desktop replies still contain quota');
  assert.equal(bridge.store.agyBridgeState.desktop.characterPack, 'gemini-star-v1');
  assert.equal(bridge.store.syncWallpaper, true);
  bridge.store.syncAgyUsage = true;
  await bridge.ping();
  assert.equal(bridge.requests.at(-1).includeAgyQuota, true);
  assert.equal(bridge.store.agyBridgeState.desktop.agyQuota.fiveHour, 75);
});

test('appearance sync preserves Web selections through offline changes, reconnect and worker restart', async () => {
  const bridge = appearanceBridgeFixture();
  const { store, desktop, sync } = bridge;
  await bridge.ping();
  assert.equal(store.character, 'lin-cat');
  assert.equal(store.customCharacter, 'data:image/png;base64,web');
  assert.equal((await bridge.patch({ characterPack: 'lin-cat' })).ok, true);
  assert.equal(desktop.characterPack, 'lin-cat');
  assert.equal(store.customCharacter, 'data:image/png;base64,web');

  bridge.setOnline(false);
  await bridge.ping();
  assert.equal(store.agyBridgeState.online, false);
  assert.equal((await bridge.patch({ syncCharacter: false, syncWallpaper: false })).ok, true);
  assert.equal(store.pendingOnlineCharacter.enabled, false);
  assert.equal(store.pendingOnlineWallpaper.enabled, false);
  await bridge.ping();
  await bridge.settle(); // Retire this worker before booting its replacement.
  bridge.boot();
  bridge.setOnline(true);
  await bridge.ping();
  await bridge.settle();
  assert.deepEqual(sync, { syncCharacter: false, syncWallpaper: false });
  assert.equal(store.pendingOnlineWallpaper, false);

  bridge.setOnline(false);
  assert.equal((await bridge.patch({ syncCharacter: true, syncWallpaper: true })).ok, true);
  await bridge.ping();
  await bridge.settle();
  bridge.boot();
  bridge.setOnline(true);
  bridge.invalidReply(true);
  await bridge.ping();
  await bridge.settle();
  assert.equal(store.agyBridgeState.online, false);
  assert.equal(store.pendingOnlineCharacter.enabled, true);
  bridge.invalidReply(false);
  await bridge.ping();
  await bridge.settle();
  assert.deepEqual(sync, { syncCharacter: true, syncWallpaper: true });
  assert.equal(store.pendingOnlineCharacter, false);
  assert.equal(store.pendingOnlineWallpaper, false);
  assert.equal(store.wallpaperId, 'custom:online-one');
  assert.equal(store.customCharacter, 'data:image/png;base64,web');
  assert.equal(store.agyBridgeState.online, true);
  const writes = bridge.stateWrites.length;
  await bridge.ping();
  assert.equal(bridge.stateWrites.length, writes, 'unchanged heartbeats must not emit storage changes');

  bridge.rejectWrite(true);
  assert.equal((await bridge.patch({ syncWallpaper: false })).ok, false);
  assert.equal(store.syncWallpaper, true);
});

test('a delayed desktop acknowledgement cannot roll back a newer Web choice', async () => {
  const bridge = appearanceBridgeFixture();
  await bridge.ping();
  const paused = bridge.pauseNextResponse();
  assert.equal((await bridge.patch({ syncCharacter: false })).localOnly, true);
  assert.equal((await paused.requested).syncCharacter, false);
  assert.equal((await bridge.patch({ syncCharacter: true })).ok, true, 'local UI stays responsive while the bridge is busy');
  const token = bridge.store.pendingOnlineCharacter.token;
  const next = bridge.pauseNextResponse();
  paused.release();
  assert.equal((await next.requested).syncCharacter, true);
  assert.equal(bridge.store.syncCharacter, true);
  assert.equal(bridge.store.pendingOnlineCharacter.token, token);
  next.release();
  await bridge.ping();
  assert.equal(bridge.store.pendingOnlineCharacter, false);
  assert.equal(bridge.store.character, 'lin-cat');
});

test('the retired Web display choice falls back locally without changing desktop policy', async () => {
  const bridge = appearanceBridgeFixture();
  bridge.sync.petDisplayMode = 'prefer-web';
  await bridge.ping();
  await bridge.settle();
  assert.equal(bridge.store.petDisplayMode, 'both');
  assert.equal(bridge.sync.petDisplayMode, 'prefer-web');
  bridge.sync.petDisplayMode = 'prefer-desktop';
  await bridge.ping();
  await bridge.settle();
  assert.equal(bridge.store.petDisplayMode, 'prefer-desktop');
});

function trackerFixture(DateClass = Date) {
  const callbacks = new Map();
  const intervals = [];
  const timeouts = [];
  const window = { location: { pathname: '/app/fixture' }, KIMINO_API: { storageGet: () => new Promise(() => {}) }, addEventListener: (type, callback) => callbacks.set(type, callback) };
  const document = { hidden: false, addEventListener: (type, callback) => callbacks.set(type, callback) };
  const context = vm.createContext({ window, document, Date: DateClass, console, setInterval: (callback, delay) => intervals.push({ callback, delay }), setTimeout: (callback, delay) => timeouts.push({ callback, delay }), clearTimeout() {} });
  vm.runInContext(source('content/tracker.js'), context);
  return { tracker: window.__KIMINO_TRACKER__, window, document, callbacks, intervals, timeouts, context };
}

test('independent quota boundaries refresh on return from a hidden tab and reject unconfirmed periods', () => {
  let now = Date.UTC(2026, 10, 6, 9);
  const { tracker, document, callbacks, intervals } = trackerFixture(class extends Date { static now() { return now; } });
  const start = now;
  const requests = [];
  tracker.refreshUsageLedger = (...args) => requests.push(args);
  tracker.startCountdownTimer();
  tracker.mergeQuota({ currentUsagePercent: 100, fiveResetEpoch: start + 1000, weeklyUsagePercent: 45, weeklyResetEpoch: start + 8000, resetSource: 'usage-ledger' });
  tracker.notify();
  document.hidden = true;
  now = start + 1200;
  callbacks.get('visibilitychange')();
  assert.equal(requests.length, 0);
  document.hidden = false;
  callbacks.get('visibilitychange')();
  assert.equal(tracker.sessionData.realQuota.fivePending, true);
  assert.equal(tracker.sessionData.fatiguePercent, null);
  assert.equal(tracker.sessionData.realQuota.weeklyPending, false);
  assert.deepEqual(requests, [['after-reset', true]]);
  tracker.mergeQuota({ currentUsagePercent: 100, fiveResetEpoch: start + 1000 });
  tracker.mergeQuota({ currentUsagePercent: 0 });
  tracker.notify();
  assert.equal(tracker.sessionData.realQuota.fivePending, true, 'neither the old period nor a percentage without a boundary confirms a reset');
  assert.equal(tracker.sessionData.quotaReset, undefined);
  intervals[0].callback();
  assert.equal(requests.length, 1, 'pending retries are throttled');
  tracker.mergeQuota({ currentUsagePercent: 6, fiveResetEpoch: start + 18_000_000 });
  tracker.notify();
  assert.equal(tracker.sessionData.fatiguePercent, 6, 'display the actual new percentage, not a guessed zero');
  assert.equal(tracker.sessionData.quotaReset.cycle, 'five');
  now = start + 8100;
  intervals[0].callback();
  assert.equal(requests.length, 2, 'a different pool can expire during the retry cooldown');
  assert.equal(tracker.sessionData.realQuota.weeklyPending, true);
  assert.equal(tracker.sessionData.fatiguePercent, 6);
  tracker.mergeQuota({ weeklyUsagePercent: 0, weeklyResetEpoch: start + 7 * 86400000 });
  tracker.notify();
  assert.equal(tracker.sessionData.realQuota.weeklyPending, false);
  assert.equal(tracker.sessionData.realQuota.weeklyUsagePercent, 0);
  assert.equal(tracker.sessionData.quotaReset.cycle, 'weekly');
});

test('SSR ledger parses split usage chunks and ignores unrelated RPC/chat data', () => {
  const { tracker } = trackerFixture();
  const payload = JSON.stringify([{ data: { viewer: { rpcs: { getUsageInfo: { subscriptionTier: 'TIER1', pools: [
    { poolType: 'GXU_FIVE_HOURLY', percentageUsed: 0, windowRefreshesAt: '2026-11-06T13:30:00.123456Z' },
    { poolType: 'GXU_WEEKLY', percentageUsed: .42, windowRefreshesAt: '2026-11-07T13:30:00Z' }
  ] } } } } }]);
  const html = [payload.slice(0, 70), payload.slice(70)].map(chunk => '<script type="application/json">' + JSON.stringify({ events: [{ id: 'usage:0', kind: 'chunk', chunk }] }) + '</script>').join('');
  const result = tracker.parseUsageLedgerHtml(html);
  assert.equal(result.five.percentageUsed, 0);
  assert.equal(result.weekly.percentageUsed, .42);
  assert.equal(tracker.isoToMs(result.five.windowRefreshesAt), Date.parse('2026-11-06T13:30:00.123Z'));
  assert.equal(tracker.parseUsageLedgerHtml('<script type="application/json">{"rpc":"chat-list"}</script>'), null);
});

test('manual quota refresh joins an in-flight read and requires a current official period', async () => {
  const now = Date.UTC(2026, 10, 6, 9);
  const { tracker, context } = trackerFixture(class extends Date { static now() { return now; } });
  context.console = { log() {}, warn() {} };
  let complete, calls = 0;
  context.fetch = () => {
    calls++;
    return new Promise(resolve => { complete = resolve; });
  };
  tracker.mergeQuota({ currentUsagePercent: 100, fiveResetEpoch: now - 1000 });
  const reply = (reset, nested) => {
    const windowRefreshesAt = new Date(reset).toISOString();
    const pools = [{ poolType: 'GXU_FIVE_HOURLY', percentageUsed: 0,
      ...(nested ? { gxu: { windowRefreshesAt } } : { windowRefreshesAt }) }];
    const chunk = JSON.stringify({ pools });
    const text = '<script type="application/json">' + JSON.stringify({ events: [{ id: 'usage:0', kind: 'chunk', chunk }] }) + '</script>';
    complete(new Response(text));
  };
  const stale = tracker.refreshUsageLedger('after-reset', true);
  const manual = tracker.refreshUsageLedger('widget', true);
  assert.equal(manual, stale);
  assert.equal(calls, 1);
  reply(now - 1000, true);
  assert.equal(await manual, false);
  assert.equal(tracker.sessionData.realQuota.fivePending, true);
  const fresh = tracker.refreshUsageLedger('widget', true);
  assert.equal(calls, 2);
  reply(now + 18_000_000, false);
  assert.equal(await fresh, true);
  assert.equal(tracker.sessionData.realQuota.fivePending, false);
  assert.equal(tracker.sessionData.realQuota.currentUsagePercent, 0);
});

test('newest stream owns activity; errors and duplicate or late events do not confirm success', () => {
  const { tracker, window, callbacks, intervals, timeouts } = trackerFixture();
  tracker.startQuotaRefreshLoop();
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 300000);
  assert.equal(timeouts.length, 0);
  const refreshes = [];
  tracker.refreshUsageLedger = reason => refreshes.push(reason);
  tracker.scheduleScrape = () => {};
  tracker.notify = () => {};
  tracker.initNetworkListener();
  const emit = (type, streamId, successful, origin = window) => callbacks.get('message')({
    source: origin, data: { source: 'KIMINO_INTERCEPTOR', type, data: { streamId, successful } }
  });
  emit('STREAM_START', 99, false, {});
  assert.equal(tracker.sessionData.status, 'idle');
  emit('STREAM_START', 1);
  emit('STREAM_START', 2);
  emit('STREAM_COMPLETE', 1, true);
  emit('STREAM_ERROR', 1);
  assert.equal(tracker.sessionData.activity.kind, 'generating');
  assert.deepEqual(refreshes, []);
  emit('STREAM_COMPLETE', 2, true);
  emit('STREAM_COMPLETE', 2, true);
  emit('STREAM_START', 2);
  assert.equal(tracker.sessionData.activity.kind, 'completed');
  assert.deepEqual(refreshes, ['after-turn']);
  emit('STREAM_START', 3);
  emit('STREAM_ERROR', 3);
  assert.equal(tracker.sessionData.activity.kind, 'interrupted');
  assert.equal(tracker.sessionData.status, 'idle');
});

test('reinjection retains the existing tracker instead of adding competing observers and timers', () => {
  const window = { __KIMINO_TRACKER__: { sentinel: true } };
  vm.runInNewContext(source('content/tracker.js'), { window });
  assert.equal(window.__KIMINO_TRACKER__.sentinel, true);
});

test('interceptor passes host requests through, ignores metadata and emits no content payloads', async () => {
  const messages = [], requests = [], listeners = [];
  let completed;
  const done = new Promise(resolve => { completed = resolve; });
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('private reply RESOURCE_EXH'));
    controller.enqueue(new TextEncoder().encode('AUSTED private reply'));
    controller.close();
  } }));
  const metadata = { ok: true, clone() { throw Error('Metadata must not be read'); } };
  const window = {
    fetch: async (...args) => { requests.push(args); return args[0].includes('batchexecute') ? metadata : response; },
    postMessage(message) { messages.push(message); if (message.type === 'STREAM_COMPLETE') completed(); },
    addEventListener(type, callback) { listeners.push(callback); }
  };
  const ctx = vm.createContext({ window, Date, TextDecoder, console });
  vm.runInContext(source('content/interceptor.js'), ctx);
  assert.equal(await window.fetch('/_/BardChatUi/data/batchexecute?rpcids=MaZiqc', { body: 'private request' }), metadata);
  assert.equal(messages.filter(m => m.type === 'STREAM_START').length, 0);
  const options = { method: 'POST', body: 'private prompt' };
  assert.equal(await window.fetch('/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate', options), response);
  await done;
  assert.equal(requests.length, 2);
  assert.equal(requests[1][1], options);
  assert.equal(messages.filter(m => m.type === 'RATE_LIMIT_HIT').length, 1);
  assert.ok(!JSON.stringify(messages).includes('private'));
  assert.ok(!JSON.stringify(messages).includes('responseText'));
  const count = messages.length;
  listeners[0]({ source: window, data: { source: 'KIMINO_TRACKER', type: 'QUOTA_RPC_REPLAY' } });
  assert.equal(requests.length, 2, 'legacy replay messages have no handler');
  listeners[0]({ source: window, data: { source: 'KIMINO_BRIDGE', type: 'INTERCEPTOR_PING' } });
  assert.equal(messages.length, count + 1);
  assert.equal(messages.at(-1).type, 'INTERCEPTOR_READY');
});

for (const gecko of [false, true]) {
  test(`hidden quota fallback uses ${gecko ? 'Promise' : 'callback'} tabs and only closes its own page`, async () => {
    let handler;
    const removed = [];
    const api = {
      runtime: { ...(gecko ? { getBrowserInfo() {} } : {}), onMessage: { addListener(fn) { handler = fn; } }, onInstalled: { addListener() {} } },
      storage: { local: { get(keys, callback) { if (gecko) return Promise.resolve({}); callback({}); }, set(value, callback) { if (gecko) return Promise.resolve(); callback(); } } },
      tabs: {
        create(properties, callback) { assert.equal(properties.active, false); if (gecko) { assert.equal(callback, undefined); return Promise.resolve({ id: 123 }); } callback({ id: 123 }); },
        remove(id) { removed.push(id); return Promise.resolve(); },
        onRemoved: { addListener() {} }
      }
    };
    const ctx = vm.createContext({ ...(gecko ? { browser: api } : { chrome: api }), console, Date, AbortController,
      fetch: async () => { throw Error('No desktop during unit tests'); }, setTimeout: () => 1, clearTimeout() {} });
    vm.runInContext(source('background.js'), ctx);
    const response = await new Promise(resolve => {
      assert.equal(handler({ type: 'KG_USAGE_FALLBACK' }, { tab: { id: 1 } }, resolve), true);
    });
    assert.equal(response.ok, true);
    assert.equal(response.tabId, 123);
    handler({ type: 'KG_USAGE_FALLBACK_DONE' }, { tab: { id: 1 } }, () => {});
    assert.deepEqual(removed, []);
    handler({ type: 'KG_USAGE_FALLBACK_DONE' }, { tab: { id: 123 } }, () => {});
    assert.deepEqual(removed, [123]);
  });
}
