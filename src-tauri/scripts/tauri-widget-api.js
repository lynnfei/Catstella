// window.widgetApi 的 Tauri 2 绑定层（Step 2 全功能桌宠与设置中心）。
// 保持与 Electron preload.cjs 同名契约，附加动态 .interactive 矩形采集（仅 pet 窗口）与设置窗口标题栏拖拽。
(function (root) {
  "use strict";

  const tauri = root.__TAURI__;
  const core = tauri && tauri.core;
  const events = tauri && tauri.event;
  if (!core || !events) {
    root.widgetApi = null;
    return;
  }

  const invoke = core.invoke;
  const listen = events.listen;
  const USE_OPTIMIZED_PACK_WEBP = false;

  function normalizeSnapshot(snap) {
    if (!USE_OPTIMIZED_PACK_WEBP || !snap || !Array.isArray(snap.characterPacks)) {
      return snap;
    }
    return {
      ...snap,
      characterPacks: snap.characterPacks.map((pack) => {
        if (
          pack &&
          typeof pack.preview === "string" &&
          pack.preview.startsWith("../../assets/character-packs/") &&
          pack.preview.endsWith(".png")
        ) {
          return { ...pack, preview: pack.preview.replace(/\.png$/, ".webp") };
        }
        return pack;
      })
    };
  }

  function subscribeEvent(eventName, callback) {
    if (typeof callback !== "function") return () => {};
    let disposed = false;
    let unlistenFn = null;
    Promise.resolve(listen(eventName, (event) => {
      if (!disposed) callback(event && event.payload);
    }))
      .then((fn) => {
        if (disposed) {
          try { fn(); } catch {}
        } else {
          unlistenFn = fn;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (unlistenFn) {
        try { unlistenFn(); } catch {}
        unlistenFn = null;
      }
    };
  }

  function unsupported(name) {
    return () => Promise.reject(new Error(`widgetApi.${name}: sealed / unavailable`));
  }

  root.widgetApi = {
    get: () => invoke("widget_get").then(normalizeSnapshot),
    save: (patch) => invoke("widget_save", { patch }).then(normalizeSnapshot),
    rememberBubble: (patch) => {
      void invoke("widget_bubble_preference", { patch }).catch(() => {});
    },
    ready: () => {
      void invoke("widget_ready").catch(() => {});
    },
    byok: unsupported("byok"),
    online: (action, value) => invoke("widget_online", { action, value: value === undefined ? null : value }),
    host: (action, payload) => invoke("widget_host", { action, payload: payload === undefined ? null : payload }),
    releaseNotes: () => invoke("widget_release_notes"),
    markReleaseNotesSeen: (version) => invoke("widget_release_notes_seen", { version }),
    canChatter: () => invoke("widget_can_chatter"),
    command: (action) => invoke("widget_command", { action }).catch(() => {}),
    pointer: (action) => invoke("widget_pointer", { action }),
    drag: (phase, dx = 0, dy = 0) => {
      void invoke("widget_drag", { phase, dx, dy }).catch(() => {});
    },
    hit: (active) => {
      void invoke("widget_hit", { active: Boolean(active) }).catch(() => {});
    },
    audio: (kind, force = false) => invoke("widget_audio", { kind, force: Boolean(force) }),
    subscribe: (cb) => subscribeEvent("widget://snapshot", typeof cb === "function" ? (snap) => cb(normalizeSnapshot(snap)) : null),
    onStep: (cb) => subscribeEvent("widget://step", cb),
    onReaction: (cb) => subscribeEvent("widget://reaction", cb),
    onNavigate: (cb) => subscribeEvent("widget://navigate", cb),
    onRefresh: (cb) => subscribeEvent("widget://refresh", cb),
    onForceRepaint: (cb) => subscribeEvent("widget://force-repaint", cb),
    onMouseLeft: (cb) => subscribeEvent("widget://mouse-left", cb),
    onMouseEntered: (cb) => subscribeEvent("widget://mouse-entered", cb)
  };

  // 动态收集所有可见的 .interactive 元素矩形，推送给 Rust 16ms 鼠标路由线程做纯内存命中判定。
  let lastSig = "";
  let rafId = 0;
  let settleTimer = 0;

  function isElementInteractiveVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.hidden || el.inert) return false;
    if (el.closest("[hidden], [inert]")) return false;
    if (el.id === "bubble" && el.dataset.open === "false") return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") {
      return false;
    }
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const ps = getComputedStyle(node);
      if (ps.display === "none" || ps.visibility === "hidden") return false;
      node = node.parentElement;
    }
    return true;
  }

  function collectAndSendHitRects() {
    rafId = 0;
    const nodes = document.querySelectorAll(".interactive");
    const rects = [];
    const pad = 2;
    for (const el of nodes) {
      if (!isElementInteractiveVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (!Number.isFinite(r.width) || !Number.isFinite(r.height) || r.width < 2 || r.height < 2) {
        continue;
      }
      rects.push({
        x: Math.round((r.left - pad) * 10) / 10,
        y: Math.round((r.top - pad) * 10) / 10,
        w: Math.round((r.width + pad * 2) * 10) / 10,
        h: Math.round((r.height + pad * 2) * 10) / 10
      });
    }
    const sig = rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join(";");
    if (sig === lastSig) return;
    lastSig = sig;
    void invoke("widget_set_hit_rects", { rects }).catch(() => {});
  }

  function scheduleCollect(withSettle = false) {
    if (!rafId) {
      rafId = requestAnimationFrame(collectAndSendHitRects);
    }
    if (withSettle) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (!rafId) rafId = requestAnimationFrame(collectAndSendHitRects);
      }, 220);
    }
  }

  function initHitRectCollector() {
    scheduleCollect(true);
    const rootNode = document.getElementById("widget") || document.body;
    if (rootNode && typeof MutationObserver === "function") {
      const mo = new MutationObserver(() => scheduleCollect(true));
      mo.observe(rootNode, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["hidden", "inert", "class", "style", "data-open", "data-suppressed", "data-dragging", "data-art-ready", "data-facing", "data-rest"]
      });
    }
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => scheduleCollect(false));
      for (const id of ["widget", "mascot", "bubble"]) {
        const el = document.getElementById(id);
        if (el) ro.observe(el);
      }
    }
    root.addEventListener("resize", () => scheduleCollect(false));
    document.addEventListener("transitionend", () => scheduleCollect(false), true);
    setInterval(() => {
      if (!document.hidden) collectAndSendHitRects();
    }, 400);
  }

  function initSettingsTitlebarDrag() {
    const dragHost = document.querySelector(".custom-titlebar") || document.querySelector(".titlebar-drag-area");
    if (!dragHost) return;
    const winApi = tauri && tauri.window;
    const currentWin = winApi && typeof winApi.getCurrentWindow === "function" ? winApi.getCurrentWindow() : null;
    if (!currentWin || typeof currentWin.startDragging !== "function") return;
    dragHost.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target && typeof e.target.closest === "function") {
        if (e.target.closest("button, a, input, select, textarea, .titlebar-controls")) return;
      }
      void currentWin.startDragging().catch(() => {});
    });
  }

  function bootstrapWindowHelpers() {
    if (document.getElementById("mascot")) {
      initHitRectCollector();
    }
    if (document.querySelector(".custom-titlebar") || document.querySelector(".titlebar-drag-area")) {
      initSettingsTitlebarDrag();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrapWindowHelpers, { once: true });
  } else {
    bootstrapWindowHelpers();
  }
})(window);
