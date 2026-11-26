// Catstella · Background (Chromium Service Worker / Firefox Event Page + AGY 桌面端本地桥接)
if (!globalThis.CatstellaOnline && typeof importScripts === 'function') importScripts('online/client.js');
const DEFAULT_CONFIG = {
  enabled: true,
  skinEnabled: true,
  character: 'gemini-star-v1', // 'gemini-star-v1' or 'lin-cat'
  soundEnabled: false,
  widgetScale: 200, // px
  argonMaxSafeTurns: 8,
  argonMaxSafeTokens: 25000,
  soundVolume: 0.5,
  wallpaperOpacity: 0.88,
  bubbleVisible: true,
  quotaDisplay: 'remaining',
  ambientChatter: false,
  autoUpdateCheck: true,
  syncCharacter: true,
  syncWallpaper: true,
  syncInteraction: true,
  syncAgyUsage: true,
  petDisplayMode: 'both' // Web choices: 'both' | 'prefer-desktop'
};
const webDisplayMode = value => value === 'prefer-desktop' ? value : 'both';

// Firefox (browser.*) 与 Chromium (chrome.*) 双命名空间兜底
const extApi = (typeof browser !== 'undefined' && browser && browser.runtime) ? browser
  : (typeof chrome !== 'undefined' ? chrome : null);

const isGecko = typeof browser !== 'undefined' && extApi === browser;
const safeStorageGet = keys => new Promise(resolve => {
  if (!extApi?.storage?.local) { resolve({}); return; }
  try {
    if (isGecko) Promise.resolve(extApi.storage.local.get(keys)).then(value => resolve(value || {}), () => resolve({}));
    else extApi.storage.local.get(keys, value => { void extApi.runtime.lastError; resolve(value || {}); });
  } catch { resolve({}); }
});
const safeStorageSet = value => new Promise(resolve => {
  if (!extApi?.storage?.local) { resolve(false); return; }
  try {
    if (isGecko) Promise.resolve(extApi.storage.local.set(value)).then(() => resolve(true), () => resolve(false));
    else extApi.storage.local.set(value, () => resolve(!extApi.runtime.lastError));
  } catch { resolve(false); }
});

const online = globalThis.CatstellaOnline?.create({
  bundled: {
    catalog: async () => (await fetch(extApi.runtime.getURL('online/seed/catalog.json'))).json(),
    file: relative => fetch(extApi.runtime.getURL('online/seed/' + relative))
  },
  loadCheck: async () => (await safeStorageGet(['onlineUpdate'])).onlineUpdate,
  saveCheck: onlineUpdate => safeStorageSet({ onlineUpdate })
});
const onlinePage = () => extApi.runtime.getURL('online/index.html');
async function checkOnlineUpdate(force = false) {
  const current = extApi.runtime.getManifest().version;
  const enabled = (await safeStorageGet(['autoUpdateCheck'])).autoUpdateCheck !== false;
  const result = enabled || force ? await online.check('web', current, force)
    : { status: 'disabled', current, url: globalThis.CatstellaOnline.releases };
  try {
    const action = extApi.action || extApi.browserAction;
    const badge = action?.setBadgeText({ text: result.status === 'available' ? 'NEW' : '' });
    if (badge?.catch) void badge.catch(() => {});
  } catch {}
  return result;
}
let nextAutoCheck = 0;
function maybeCheckUpdate() {
  if (!online || Date.now() < nextAutoCheck) return;
  nextAutoCheck = Date.now() + 30 * 60_000;
  void checkOnlineUpdate().catch(() => {});
}
let installQueue = Promise.resolve();
let bundledGallery;
async function onlineAvailability() {
  try {
    bundledGallery ||= fetch(extApi.runtime.getURL('assets/gallery.json')).then(response => response.json()).catch(() => ({}));
    const [items, bundled, local] = await Promise.all([
      online.list(), bundledGallery, safeStorageGet(['onlineCharacterPacks', 'customWallpapers','onlinePalette','onlineThemeId','onlineThemeRevision','seenOnlineUpdates','agyBridgeState'])
    ]);
    if (online.catalogOffline()) return { ok:false, reason:'connection' };
    const seen = new Set(Array.isArray(local.seenOnlineUpdates) ? local.seenOnlineUpdates : []);
    const desktop = local.agyBridgeState?.desktop;
    const updates = [];
    for (const item of items) {
      const palette = {'violet-default':'violet','midnight-blue':'ocean'}[item.id];
      const installed = item.kind === 'theme' ? (palette ? palette === (local.onlinePalette || 'violet') : local.onlineThemeId === item.id)
        : item.kind === 'character' ? bundled.characters?.some(x => x.id === item.id) || local.onlineCharacterPacks?.['online-' + item.id]
        : bundled.wallpapers?.some(x => x.id === item.id) || local.customWallpapers?.some(x => x.id === 'custom:online-' + item.id);
      const revision = item.id + ':' + item.sha256;
      const savedRevision = item.kind === 'theme' ? local.onlineThemeId === item.id && local.onlineThemeRevision :
        item.kind === 'character' ? local.onlineCharacterPacks?.['online-' + item.id]?.revision :
        local.customWallpapers?.find(w=>w.id === 'custom:online-' + item.id)?.revision;
      const outdated = !!savedRevision && savedRevision !== item.sha256;
      const desktopIds = item.kind === 'wallpaper' ? desktop?.wallpaperIds || [desktop?.wallpaperId]
        : item.kind === 'character' ? desktop?.characterPackIds || [desktop?.characterPack] : [];
      if ((outdated || !installed && !desktopIds.includes(item.id) && !desktopIds.includes('online-' + item.id)) && !seen.has(revision)) {
        updates.push({kind:item.kind,revision});
      }
    }
    return { ok:true, updates };
  } catch (error) {
    return { ok: false, reason: globalThis.CatstellaOnline.failureReason(error) };
  }
}
async function installOnlineAsset(id, applyAfterwards) {
  const asset = await online.download(id);
  if (asset.theme) {
    return { ok: await safeStorageSet({ onlinePalette: asset.theme.palette, onlineThemeId: id, onlineThemeRevision: asset.item.sha256, wallpaperOpacity: asset.theme.opacity / 100 }) };
  }
  if (asset.character) {
    // Decode every frame before changing the saved gallery.
    for (const data of Object.values(asset.character)) {
      const bytes = Uint8Array.from(atob(data.split(',')[1]), char => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const valid = bitmap.width > 0 && bitmap.height > 0 && bitmap.width * bitmap.height <= 1_500_000;
      bitmap.close();
      if (!valid) throw new Error('invalid character frame dimensions');
    }
    const { onlineCharacterPacks } = await safeStorageGet(['onlineCharacterPacks']);
    const packs = { ...onlineCharacterPacks, ['online-' + id]: { name: asset.item.name, description: asset.item.description, revision: asset.item.sha256, frames: asset.character } };
    return { ok: await safeStorageSet({ onlineCharacterPacks: packs }) };
  }
  const blob = new Blob([asset.bytes], { type: asset.item.mime });
  const bitmap = await createImageBitmap(blob);
  let dataUrl;
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16_000_000) throw new Error('invalid image dimensions');
    let saved = blob;
    if (typeof OffscreenCanvas === 'function') {
      const scale = Math.min(1, 1920 / bitmap.width, 1080 / bitmap.height);
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        saved = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 });
      }
    }
    dataUrl = `data:${saved.type};base64,${arrayBufferToBase64(await saved.arrayBuffer())}`;
  } finally { bitmap.close(); }
  const wallpaperId = 'custom:online-' + id;
  const ok = await serializeAppearance(async () => {
    const { customWallpapers = [] } = await safeStorageGet(['customWallpapers']);
    const wallpapers = (Array.isArray(customWallpapers) ? customWallpapers : []).filter(w => w?.id !== wallpaperId);
    wallpapers.push({ id: wallpaperId, title: asset.item.name, revision: asset.item.sha256, dataUrl, ...(asset.item.pack && {pack:asset.item.pack}) });
    const selection = applyAfterwards ? { wallpaperId, webWallpaperCycle:null, ...appearanceIntent({ syncWallpaper: false }) } : {};
    return safeStorageSet({ customWallpapers: wallpapers, ...selection });
  });
  if (ok && applyAfterwards) void syncWithDesktop();
  return { ok };
}
async function onlineAction({ action, value }) {
  try {
    if (action === 'check') return { ok: true, ...(await checkOnlineUpdate(value === true)) };
    if (action === 'release') {
      const result = await checkOnlineUpdate();
      await extApi.tabs.create({ url: globalThis.CatstellaOnline.releaseUrl(result.url) });
      return { ok: true };
    }
    if (action === 'catalog') {
      const items = await online.list(value === true);
      return { ok: true, items, offline: online.catalogOffline() };
    }
    if (action === 'preview-theme' && typeof value === 'string') {
      const item = (await online.list()).find(item => item.id === value && item.kind === 'theme');
      if (!item) return { ok: false };
      const { theme } = await online.download(item.id);
      return theme ? { ok: true, ...theme } : { ok: false };
    }
    if ((action === 'install' || action === 'download') && typeof value === 'string') {
      const task = installQueue.then(() => installOnlineAsset(value, action === 'install'));
      installQueue = task.catch(() => {});
      return await task;
    }
    if (action === 'uninstall' && typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,60}$/i.test(value)) {
      const task = installQueue.then(() => serializeAppearance(async () => {
      // 主题：清回内置星轨紫；桌宠/壁纸：从本地库移除，正在使用的回退默认项。
      const theme = await safeStorageGet(['onlineThemeId']);
      if (theme.onlineThemeId === value) {
        return { ok: await safeStorageSet({ onlineThemeId: null, onlineThemeRevision: null, onlinePalette: 'violet', wallpaperOpacity:.88 }) };
      }
      const { onlineCharacterPacks } = await safeStorageGet(['onlineCharacterPacks']);
      if (onlineCharacterPacks && Object.prototype.hasOwnProperty.call(onlineCharacterPacks, 'online-' + value)) {
        const packs = { ...onlineCharacterPacks };
        delete packs['online-' + value];
        const local = await safeStorageGet(['character']);
        const reset = local.character === 'online-' + value ? { character: 'gemini-star-v1' } : {};
        return { ok: await safeStorageSet({ onlineCharacterPacks: packs, ...reset }) };
      }
      const wallpaperId = 'custom:online-' + value;
      const { customWallpapers = [], wallpaperId: activeId, webWallpaperCycle } = await safeStorageGet(['customWallpapers', 'wallpaperId', 'webWallpaperCycle']);
      if (Array.isArray(customWallpapers) && customWallpapers.some(w => w?.id === wallpaperId)) {
        const wallpapers = customWallpapers.filter(w => w?.id !== wallpaperId);
        const selection = activeId === wallpaperId ? { wallpaperId: 'gemini-character-sheet-v1', webWallpaperCycle: null } :
          webWallpaperCycle?.id === wallpaperId ? { webWallpaperCycle: null } : {};
        return { ok: await safeStorageSet({ customWallpapers: wallpapers, ...selection }) };
      }
      return { ok: false, reason: 'not-installed' };
      }));
      installQueue = task.catch(() => {});
      return await task;
    }
    return { ok: false };
  } catch (error) {
    return { ok: false, reason: globalThis.CatstellaOnline.failureReason(error) };
  }
}

// ---- AGY Desktop Companion Bridge (127.0.0.1:3921..3923) ----
const BRIDGE_PORTS = [3921, 3922, 3923];
let preferredPort = 3921;
let lastStateSig = '';
let lastSyncedWallpaperRev = '';
let wallpaperFetchInFlight = false;
let syncInFlight = null;
let syncQueued = false;
let requestedWallpaper = null;
let latestWebQuota = null;
const tabFocusMap = new Map(); // tabId -> { active, ts }

function hasGeminiTab(flag) {
  const now = Date.now();
  for (const [tabId, info] of tabFocusMap.entries()) {
    if (now - info.ts > 15000) {
      tabFocusMap.delete(tabId);
      continue;
    }
    if (info[flag]) return true;
  }
  return false;
}

const isAnyGeminiTabFocused = () => hasGeminiTab('active');
const isAnyGeminiTabVisible = () => hasGeminiTab('visible');

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}

// Fetch through the extension, not a Gemini <img> pointing at localhost. Keep a
// bounded preview cache and at most two decodes/downloads running concurrently.
const wallpaperPreviews = new Map();
const previewTasks = new Map();
const previewQueue = [];
let previewWorkers = 0;
function drainPreviews() {
  while (previewWorkers < 2 && previewQueue.length) {
    const work = previewQueue.shift();
    previewWorkers++;
    work().finally(() => { previewWorkers--; drainPreviews(); });
  }
}
function wallpaperPreview(id, revision = '') {
  if (typeof id !== 'string' || !id || id.length > 256) return Promise.resolve(null);
  const key = id + ':' + revision;
  const cached = wallpaperPreviews.get(key);
  if (cached && Date.now() - cached.at < 300000) return Promise.resolve(cached.dataUrl);
  if (previewTasks.has(key)) return previewTasks.get(key);
  const task = new Promise(resolve => {
    previewQueue.push(async () => {
      let dataUrl = null;
      try {
        const hit = await fetchBridge('/companion/wallpaper-image?id=' + encodeURIComponent(id), { timeoutMs: 4500 });
        if (hit) {
          const mime = hit.resp.headers.get('content-type') || '';
          const bytes = await hit.resp.arrayBuffer();
          if (mime.startsWith('image/') && bytes.byteLength > 0 && bytes.byteLength <= 25 * 1024 * 1024) {
            let blob = new Blob([bytes], { type: mime });
            if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
              try {
                const bitmap = await createImageBitmap(blob);
                try {
                  const ratio = Math.min(1, 320 / bitmap.width, 180 / bitmap.height);
                  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * ratio)), Math.max(1, Math.round(bitmap.height * ratio)));
                  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                  blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .78 });
                } finally { bitmap.close(); }
              } catch { /* Older engines or SVG decoders can still display the original image. */ }
            }
            dataUrl = 'data:' + blob.type + ';base64,' + arrayBufferToBase64(await blob.arrayBuffer());
            if (dataUrl.length < 2 * 1024 * 1024) {
              wallpaperPreviews.set(key, { dataUrl, at: Date.now() });
              while (wallpaperPreviews.size > 16) wallpaperPreviews.delete(wallpaperPreviews.keys().next().value);
            }
          }
        }
      } catch { /* A failed tile remains retryable; do not cache failures. */ }
      resolve(dataUrl);
    });
    drainPreviews();
  });
  previewTasks.set(key, task);
  task.finally(() => previewTasks.delete(key));
  return task;
}

async function fetchBridge(pathname, options = {}) {
  const ports = [preferredPort, ...BRIDGE_PORTS.filter((p) => p !== preferredPort)];
  for (const port of ports) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 1400);
    try {
      const resp = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        method: options.method || 'GET',
        headers: {
          'X-Catstella-Client': 'gemini-web-companion',
          ...(options.headers || {})
        },
        body: options.body,
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timer);
      if (resp.ok) {
        preferredPort = port;
        return { port, resp };
      }
    } catch (e) {
      clearTimeout(timer);
    }
  }
  return null;
}

async function syncDesktopWallpaperIfNeeded(port, desktop, syncCfg) {
  requestedWallpaper = { desktop, syncCfg };
  if (wallpaperFetchInFlight) return;
  wallpaperFetchInFlight = true;
  try {
    while (requestedWallpaper) {
      const request = requestedWallpaper;
      requestedWallpaper = null;
      const { desktop, syncCfg } = request;
      if (!desktop?.wallpaperId || syncCfg?.syncWallpaper === false) continue;
      const rev = desktop.wallpaperRev || desktop.wallpaperId;
      if (rev === lastSyncedWallpaperRev) continue;
      const cached = await safeStorageGet(['agySyncedWallpaper']);
      if (cached.agySyncedWallpaper?.rev === rev && cached.agySyncedWallpaper?.dataUrl) { lastSyncedWallpaperRev = rev; continue; }
      const hit = await fetchBridge('/companion/wallpaper-image?id=' + encodeURIComponent(desktop.wallpaperId), { timeoutMs: 4500 });
      if (!hit) continue;
      const mime = hit.resp.headers.get('content-type') || '';
      const bytes = await hit.resp.arrayBuffer();
      if (!mime.startsWith('image/') || !bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024) continue;
      if (requestedWallpaper && (requestedWallpaper.syncCfg?.syncWallpaper === false || (requestedWallpaper.desktop?.wallpaperRev || requestedWallpaper.desktop?.wallpaperId) !== rev)) continue;
      const current = await safeStorageGet(['syncWallpaper', 'agyBridgeState']);
      const currentWall = current.agyBridgeState?.desktop;
      if (current.syncWallpaper === false || current.agyBridgeState?.online !== true ||
          (currentWall?.wallpaperRev || currentWall?.wallpaperId) !== rev) continue;
      const ok = await safeStorageSet({ agySyncedWallpaper: {
        rev, id: desktop.wallpaperId, title: desktop.wallpaperTitle || desktop.wallpaperId,
        dataUrl: 'data:' + mime + ';base64,' + arrayBufferToBase64(bytes), updatedAt: Date.now()
      } });
      if (ok) lastSyncedWallpaperRev = rev;
    }
  } catch { /* Keep the previous wallpaper if the desktop disappears. */ }
  finally { wallpaperFetchInFlight = false; }
}

function syncWithDesktop(patch = null) {
  if (syncInFlight) {
    if (patch) return syncInFlight.then(() => syncWithDesktop(patch));
    syncQueued = true;
    return syncInFlight;
  }
  syncInFlight = performDesktopSync(patch).finally(() => {
    syncInFlight = null;
    if (syncQueued) { syncQueued = false; void syncWithDesktop(); }
  });
  return syncInFlight;
}

const pendingSyncKeys = { syncCharacter: 'pendingOnlineCharacter', syncWallpaper: 'pendingOnlineWallpaper' };
let appearanceWrites = Promise.resolve();
let appearanceSequence = 0;
const appearanceEpoch = Math.random().toString(36).slice(2);
function serializeAppearance(task) {
  const next = appearanceWrites.then(task);
  appearanceWrites = next.catch(() => {});
  return next;
}
function appearanceIntent(patch) {
  const updates = {};
  for (const [key, pending] of Object.entries(pendingSyncKeys)) {
    if (typeof patch[key] !== 'boolean') continue;
    updates[key] = patch[key];
    if (key === 'syncWallpaper') updates.webWallpaperCycle = null;
    updates[pending] = { enabled: patch[key], token: appearanceEpoch + ':' + ++appearanceSequence };
  }
  return updates;
}
function pendingAppearance(value) {
  // Existing installations stored `true` for a queued switch to independent mode.
  if (value === true) return { enabled: false, token: 'legacy' };
  return typeof value?.enabled === 'boolean' && typeof value?.token === 'string' ? value : null;
}
async function markBridgeOffline() {
  const { agyBridgeState: previous, syncAgyUsage } = await safeStorageGet(['agyBridgeState', 'syncAgyUsage']);
  const desktop = { ...previous?.desktop };
  if (syncAgyUsage === false) delete desktop.agyQuota;
  if ((previous?.online === false && !(syncAgyUsage === false && previous.desktop?.agyQuota)) || await safeStorageSet({
    agyBridgeState: { ...previous, desktop, online: false, ts: Date.now() }
  })) lastStateSig = 'offline';
  return { ok: false, online: false };
}
async function performDesktopSync(patch = null) {
  try {
    const pendingBefore = await serializeAppearance(() => safeStorageGet(['syncAgyUsage', ...Object.values(pendingSyncKeys)]));
    const effectivePatch = { ...patch };
    for (const [key, pending] of Object.entries(pendingSyncKeys)) {
      const intent = pendingAppearance(pendingBefore[pending]);
      if (intent) effectivePatch[key] = intent.enabled;
    }
    if (effectivePatch.syncCharacter === false) delete effectivePatch.characterPack;
    if (effectivePatch.syncWallpaper === false) {
      delete effectivePatch.dreamSkin;
      if (effectivePatch.action === 'next-wallpaper') delete effectivePatch.action;
    }
    const bodyObj = {
      client: 'gemini-web-companion',
      webActive: isAnyGeminiTabFocused(),
      webVisible: isAnyGeminiTabVisible(),
      webQuota: latestWebQuota || undefined,
      includeAgyQuota: pendingBefore.syncAgyUsage !== false,
      patch: Object.keys(effectivePatch).length ? effectivePatch : undefined
    };
    const hit = await fetchBridge('/companion/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj)
    });

    if (!hit) return markBridgeOffline();

    const payload = await hit.resp.json();
    if (!payload?.ok) return markBridgeOffline();

    const syncCfg = payload.sync || {};
    const desktop = { ...payload.desktop };
    const nextBridgeState = {
      online: true,
      port: hit.port,
      sync: syncCfg,
      desktop
    };
    const useWallpaper = await serializeAppearance(async () => {
      const stored = await safeStorageGet([
        'soundEnabled', 'syncCharacter', 'syncWallpaper', 'syncInteraction', 'syncAgyUsage', 'petDisplayMode', ...Object.values(pendingSyncKeys)
      ]);
      // Older desktop versions may ignore includeAgyQuota; never cache their
      // quota while disabled or let an in-flight response undo the switch.
      if (!bodyObj.includeAgyQuota || stored.syncAgyUsage === false) delete desktop.agyQuota;
      const nextSig = JSON.stringify(nextBridgeState);
      const updates = {};

      if (nextSig !== lastStateSig) updates.agyBridgeState = { ...nextBridgeState, ts: Date.now() };

      for (const [key, pending] of Object.entries(pendingSyncKeys)) {
        const sent = pendingAppearance(pendingBefore[pending]);
        const current = pendingAppearance(stored[pending]);
        if (current && sent?.token === current.token && syncCfg[key] === current.enabled) updates[pending] = false;
        if (!current && typeof syncCfg[key] === 'boolean' && stored[key] !== syncCfg[key]) {
          updates[key] = syncCfg[key];
          if (key === 'syncWallpaper') updates.webWallpaperCycle = null;
        }
      }
      if (typeof syncCfg.syncInteraction === 'boolean' && stored.syncInteraction !== syncCfg.syncInteraction) updates.syncInteraction = syncCfg.syncInteraction;
      if (typeof syncCfg.petDisplayMode === 'string' && stored.petDisplayMode !== webDisplayMode(syncCfg.petDisplayMode)) {
        updates.petDisplayMode = webDisplayMode(syncCfg.petDisplayMode);
      }
      if (syncCfg.syncInteraction !== false && typeof desktop.sound === 'boolean' && stored.soundEnabled !== desktop.sound) updates.soundEnabled = desktop.sound;

      if (!Object.keys(updates).length || await safeStorageSet(updates)) lastStateSig = nextSig;
      return (updates.syncWallpaper ?? stored.syncWallpaper) !== false && syncCfg.syncWallpaper !== false;
    });
    if (useWallpaper) void syncDesktopWallpaperIfNeeded(hit.port, desktop, syncCfg);
    return { ok: true, online: true, state: nextBridgeState };
  } catch (e) {
    return markBridgeOffline();
  }
}

// ---- 隐藏 /usage 兜底标签页管理 ----
let usageFallbackTabId = null;
let lastUsageFallbackAt = 0;

const createUsageTab = () => new Promise(resolve => {
  const properties = { url: 'https://gemini.google.com/usage', active: false };
  try {
    if (isGecko) Promise.resolve(extApi.tabs.create(properties)).then(resolve, () => resolve(null));
    else extApi.tabs.create(properties, tab => { resolve(extApi.runtime.lastError ? null : tab); });
  } catch { resolve(null); }
});
const closeUsageTab = id => {
  try {
    const result = extApi.tabs.remove(id);
    if (result?.catch) result.catch(() => {});
  } catch {}
  if (usageFallbackTabId === id) usageFallbackTabId = null;
};

let headPatWrites = Promise.resolve();
let localWallpaperCheck;
function checkLocalWallpaperCycle() {
  if (localWallpaperCheck) return localWallpaperCheck;
  const keys = ['syncWallpaper','webWallpaperSlideshow','webWallpaperInterval','webWallpaperCycle','wallpaperId'];
  const fingerprint = state => JSON.stringify(keys.map(key => state[key]));
  localWallpaperCheck = (async () => {
    const state = await safeStorageGet(keys);
    if (state.syncWallpaper !== false || state.webWallpaperSlideshow !== true) return;
    const anchor = state.wallpaperId || '';
    const minutes = Number.isFinite(state.webWallpaperInterval) ? Math.min(60,Math.max(1,Math.round(state.webWallpaperInterval))) : 5;
    const interval = minutes * 60_000;
    const previous = state.webWallpaperCycle;
    const now = Date.now();
    const matches = previous?.anchor === anchor && previous.minutes === minutes && Number.isFinite(previous.nextAt);
    let cycle = {anchor,minutes,id:anchor,nextAt:now + interval};
    if (matches) {
      if (now < previous.nextAt) return;
      bundledGallery ||= fetch(extApi.runtime.getURL('assets/gallery.json')).then(response => response.json()).catch(() => ({}));
      const [gallery,{customWallpapers}] = await Promise.all([bundledGallery,safeStorageGet(['customWallpapers'])]);
      const ids = [...new Set([...(gallery.wallpapers || []),...(customWallpapers || [])].map(item => item.id).filter(Boolean))];
      const index = Math.max(0,ids.indexOf(previous.id || anchor));
      const steps = Math.floor((now - previous.nextAt) / interval) + 1;
      cycle = {anchor,minutes,id:ids[(index + steps) % ids.length] || anchor,nextAt:previous.nextAt + steps * interval};
    }
    await serializeAppearance(async () => {
      if (fingerprint(await safeStorageGet(keys)) === fingerprint(state)) await safeStorageSet({webWallpaperCycle:cycle});
    });
  })().finally(() => { localWallpaperCheck = null; });
  return localWallpaperCheck;
}
let pendingHeadPats = [], headPatTimer;
function flushHeadPats() {
  clearTimeout(headPatTimer);
  headPatTimer = null;
  const batch = pendingHeadPats;
  pendingHeadPats = [];
  const record = headPatWrites.then(async () => {
    const {headPatTotal,headPatToday,headPatDay} = await safeStorageGet(['headPatTotal','headPatToday','headPatDay']);
    const increment = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value + 1,Number.MAX_SAFE_INTEGER) : 1;
    let total = headPatTotal, today = headPatToday, day = headPatDay;
    const counts = batch.map(tap => {
      total = increment(total);
      today = tap.day === day ? increment(today) : 1;
      day = tap.day;
      return {total,today};
    });
    return await safeStorageSet({headPatTotal:total,headPatToday:today,headPatDay:day}) ? counts : null;
  });
  headPatWrites = record.catch(() => null);
  headPatWrites.then(counts => batch.forEach((tap,index) => {
    try { tap.reply(counts?.[index] || null); } catch {}
  }));
}
extApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;

  if (message.type === 'KG_HEAD_PAT') {
    let valid = false;
    try { valid = sender.id === extApi.runtime.id && sender.frameId === 0 && new URL(sender.url).origin === 'https://gemini.google.com'; } catch {}
    if (!valid) return;
    const now = new Date();
    pendingHeadPats.push({day:[now.getFullYear(),now.getMonth() + 1,now.getDate()].join('-'),reply:sendResponse});
    if (pendingHeadPats.length >= 32) flushHeadPats();
    else headPatTimer ??= setTimeout(flushHeadPats,140);
    return true;
  }

  if (message.type === 'KG_ONLINE' && online) {
    const fromGemini = sender.frameId === 0 && /^https:\/\/gemini\.google\.com(?:[/?#]|$)/.test(sender.url || '');
    if (sender.id !== extApi.runtime.id || (!fromGemini && sender.url?.split('#')[0] !== onlinePage())) return;
    onlineAction(message).then(sendResponse);
    return true;
  }
  if (message.type === 'KG_ONLINE_AVAILABILITY' && online && sender.id === extApi.runtime.id) {
    onlineAvailability().then(sendResponse);
    return true;
  }

  if (message.type === 'KG_USAGE_FALLBACK') {
    const now = Date.now();
    if (now - lastUsageFallbackAt < 5 * 60 * 1000) {
      sendResponse({ ok: false, reason: 'cooldown' });
      return;
    }
    lastUsageFallbackAt = now;
    createUsageTab().then(tab => {
      if (!Number.isInteger(tab?.id)) {
        lastUsageFallbackAt = 0;
        sendResponse({ ok: false, reason: 'tab-create-failed' });
        return;
      }
      const id = tab.id;
      usageFallbackTabId = id;
      sendResponse({ ok: true, tabId: id });
      setTimeout(() => {
        if (usageFallbackTabId === id) closeUsageTab(id);
      }, 45000);
    });
    return true;
  }

  if (message.type === 'KG_USAGE_FALLBACK_DONE') {
    if (usageFallbackTabId !== null && sender?.tab?.id === usageFallbackTabId) closeUsageTab(usageFallbackTabId);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'KG_TAB_HEARTBEAT') {
    maybeCheckUpdate();
    void checkLocalWallpaperCycle().catch(() => {});
    const tabId = sender?.tab?.id ?? 'default';
    tabFocusMap.set(tabId, { active: !!message.active, visible: typeof message.visible === 'boolean' ? message.visible : !!message.active, ts: Date.now() });
    if (message.webQuota && typeof message.webQuota === 'object') {
      latestWebQuota = message.webQuota;
    }
    syncWithDesktop().then((res) => sendResponse(res || { ok: false })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'KG_BRIDGE_GET') {
    syncWithDesktop().then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'KG_BRIDGE_PATCH') {
    const patch = message.patch && typeof message.patch === 'object' ? message.patch : {};
    const localMirror = appearanceIntent(patch);
    const { syncCharacter, syncWallpaper, ...remotePatch } = patch;
    if (typeof patch.syncInteraction === 'boolean') localMirror.syncInteraction = patch.syncInteraction;
    if (typeof patch.petDisplayMode === 'string') remotePatch.petDisplayMode = localMirror.petDisplayMode = webDisplayMode(patch.petDisplayMode);
    if (typeof patch.sound === 'boolean') localMirror.soundEnabled = patch.sound;
    serializeAppearance(() => Object.keys(localMirror).length ? safeStorageSet(localMirror) : true).then(async (saved) => {
      if (!saved) return sendResponse({ ok: false });
      if (!Object.keys(remotePatch).length) {
        void syncWithDesktop();
        return sendResponse({ ok: true, localOnly: true });
      }
      sendResponse(await syncWithDesktop(remotePatch));
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'KG_GET_DESKTOP_WALLPAPERS') {
    fetchBridge('/companion/wallpapers', { method: 'GET', timeoutMs: 2200 })
      .then(async (hit) => {
        if (!hit) { sendResponse({ ok: false, wallpapers: [] }); return; }
        const data = await hit.resp.json();
        sendResponse({ ok: true, port: hit.port, wallpapers: data?.wallpapers || [] });
      })
      .catch(() => sendResponse({ ok: false, wallpapers: [] }));
    return true;
  }

  if (message.type === 'KG_GET_WALLPAPER_PREVIEW') {
    wallpaperPreview(message.id, typeof message.revision === 'string' ? message.revision : '')
      .then(dataUrl => sendResponse({ ok: !!dataUrl, dataUrl }));
    return true;
  }

  if (message.type === 'GET_CONFIG') {
    safeStorageGet(null).then(sendResponse);
    return true;
  }
  if (message.type === 'SET_CONFIG') {
    safeStorageSet(message.payload).then((ok) => sendResponse({ success: ok }));
    return true;
  }
});

if (extApi && extApi.tabs && extApi.tabs.onRemoved) {
  try {
    extApi.tabs.onRemoved.addListener((tabId) => {
      if (usageFallbackTabId === tabId) usageFallbackTabId = null;
      if (tabFocusMap.has(tabId)) {
        tabFocusMap.delete(tabId);
        syncWithDesktop();
      }
    });
  } catch (e) {}
}

extApi.runtime.onInstalled.addListener(async () => {
  try {
    const current = await safeStorageGet(null);
    const updated = { ...DEFAULT_CONFIG, ...current };
    await safeStorageSet(updated);
    maybeCheckUpdate();
    syncWithDesktop();
    console.log('[Catstella] 初始化配置完成');
  } catch (err) {
    console.warn('[Catstella] onInstalled error:', err);
  }
});
extApi.runtime.onStartup?.addListener(maybeCheckUpdate);
extApi.storage.onChanged?.addListener((changes, area) => {
  if (area === 'local' && changes.syncAgyUsage) void syncWithDesktop();
  if (area === 'local' && (changes.syncWallpaper || changes.webWallpaperSlideshow || changes.webWallpaperInterval || changes.wallpaperId))
    void checkLocalWallpaperCycle().catch(() => {});
});

// 启动时探测一次本地 AGY 套件
syncWithDesktop();
