// Catstella · 跨浏览器兼容垫片 (browser.* / chrome.* 双命名空间 + Promise 安全封装)
// 设计目标：任何 storage / runtime 调用都绝不抛出未捕获的 Promise rejection，
// 保证 Gecko (Firefox / Zen) 上后续 tracker / skin / widget 的初始化永不静默中断。
(() => {
  if (window.__KIMINO_SHIM_READY__) return;
  window.__KIMINO_SHIM_READY__ = true;

  window.KiminoSkinStyle = {
    read: config => ['glass', 'solid', 'native'].includes(config?.skinStyle) ? config.skinStyle
      : config?.skinEnabled === false ? 'native' : 'glass',
    patch: style => ({ skinStyle: style, skinEnabled: style !== 'native' })
  };
  window.KiminoWallpaperSettings = {
    minutes: value => Number.isFinite(value) ? Math.min(60,Math.max(1,Math.round(value))) : 5,
    id(config) {
      const saved = config?.wallpaperId || '';
      const cycle = config?.webWallpaperCycle;
      return config?.syncWallpaper === false && config.webWallpaperSlideshow === true &&
        cycle?.anchor === saved && cycle.minutes === this.minutes(config.webWallpaperInterval) && typeof cycle.id === 'string'
        ? cycle.id : saved;
    }
  };

  const pickApi = () => {
    try {
      if (typeof browser !== 'undefined' && browser && browser.runtime && browser.runtime.id) return browser;
    } catch (e) { /* Firefox 之外的页面上下文无 browser */ }
    try {
      if (typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.runtime.id) return chrome;
    } catch (e) { /* 扩展环境被重载时 runtime 可能失效 */ }
    return null;
  };

  const api = pickApi();
  let isGecko = false;
  try {
    // getBrowserInfo is absent in Firefox content scripts. Select the
    // Promise contract from the namespace we actually chose.
    isGecko = !!(api && typeof browser !== 'undefined' && api === browser);
  } catch (e) { isGecko = false; }

  const KIMINO_API = {
    raw: api,
    available: !!api,
    isGecko,
    getURL(path) {
      try { return api.runtime.getURL(path); } catch (e) { return path; }
    },
    storageGet(keys) {
      if (!api?.storage?.local) return Promise.resolve({});
      return new Promise(resolve => {
        try {
          if (isGecko) Promise.resolve(api.storage.local.get(keys)).then(value => resolve(value || {}), () => resolve({}));
          else api.storage.local.get(keys, value => { void api.runtime.lastError; resolve(value || {}); });
        } catch { resolve({}); }
      });
    },
    storageSet(value) {
      if (!api?.storage?.local) return Promise.resolve(false);
      return new Promise(resolve => {
        try {
          if (isGecko) Promise.resolve(api.storage.local.set(value)).then(() => resolve(true), () => resolve(false));
          else api.storage.local.set(value, () => resolve(!api.runtime.lastError));
        } catch { resolve(false); }
      });
    },
    onChanged(listener) {
      if (!api || !api.storage || !api.storage.onChanged) return;
      try { api.storage.onChanged.addListener(listener); } catch (e) {}
    },
    // 永不 reject 的 runtime.sendMessage 封装（Chromium 回调与 Firefox Promise 双兼容）
    sendMessage(message) {
      return new Promise((resolve) => {
        if (!api || !api.runtime || typeof api.runtime.sendMessage !== 'function') {
          resolve(null);
          return;
        }
        try {
          if (isGecko) {
            const p = api.runtime.sendMessage(message);
            if (p && typeof p.then === 'function') {
              p.then((res) => resolve(res ?? null)).catch(() => resolve(null));
            } else {
              resolve(p ?? null);
            }
          } else {
            api.runtime.sendMessage(message, (res) => {
              try {
                if (api.runtime.lastError) {
                  resolve(null);
                  return;
                }
              } catch (e) {}
              resolve(res ?? null);
            });
          }
        } catch (e) {
          resolve(null);
        }
      });
    }
  };

  window.KIMINO_API = KIMINO_API;

  console.log(`[Catstella] 兼容垫片就绪 (engine: ${KIMINO_API.isGecko ? 'Gecko' : 'Chromium'}, api: ${KIMINO_API.available ? 'ok' : 'missing'}) 喵～`);
})();
