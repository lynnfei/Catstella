// Catstella · Dream Skin —— 增量表面标注 (JS 结构标注 + 常驻 CSS 渲染)
// 架构：不再让 CSS 猜 Google 的类名（A/B 分流导致类名随会话漂移），
// 而是由本引擎按产品级语义锚点（user-query / model-response / rich-textarea /
// bard-sidenav 等，比类名稳定一个数量级）定位表面，向上爬到真正绘制背景的
// 视觉容器后打上 data-kg 标记；skin.css 只认 [data-kg="..."]。
// 任何一处标注失败 → 该表面保持 Google 原生暗色（优雅降级，永远可读）。
(() => {
  if (window.__KIMINO_SKIN_READY__) return;
  window.__KIMINO_SKIN_READY__ = true;

  const api = window.KIMINO_API || {
    available: false,
    getURL: (p) => p,
    storageGet: async () => ({}),
    onChanged: () => {}
  };

  let wallpaperEl = null;
  let wallpaperController = null;
  let wallpaperTransition = 'fade';
  let usingDesktopWallpaper = false;
  let baseLayer = null;
  let wallpaperSrc = null; // 自定义或同步壁纸 dataURL，或 null（用默认）
  let skinCurrentlyEnabled = true;
  let currentSkinOpacity = 0.88;
  let opacityRevision = 0;
  let blurRevision = 0;
  const fixedFade = window.KiminoFixedFade ? new window.KiminoFixedFade(() => scheduleGeometry()) : null;

  const getWallpaperUrl = () => wallpaperSrc || api.getURL('assets/wallpapers/gemini-sheet.png');
  const setWallpaperOpacity = opacity => {
    if (usingDesktopWallpaper) return;
    ++opacityRevision;
    currentSkinOpacity = typeof opacity === 'number' ? opacity : 0.88;
    if (!wallpaperEl || !skinCurrentlyEnabled) return;
    wallpaperEl.style.opacity = String(currentSkinOpacity);
    fixedFade?.syncWallpaper(wallpaperEl, currentSkinOpacity);
  };
  window.KiminoPreviewWallpaperOpacity = setWallpaperOpacity;
  const setWallpaperBlur = blur => {
    ++blurRevision;
    const radius = Number.isFinite(blur) ? Math.max(0, Math.min(24, blur)) : 0;
    const root = document.documentElement;
    if (radius > 0) {
      root.style.setProperty('--kg-wallpaper-filter', `blur(${radius}px)`);
      root.setAttribute('data-kg-wallpaper-blurred', '');
    } else {
      root.style.removeProperty('--kg-wallpaper-filter');
      root.removeAttribute('data-kg-wallpaper-blurred');
    }
  };
  window.KiminoPreviewWallpaperBlur = setWallpaperBlur;

  const applySkin = (enabled = true, opacity = 0.88) => {
    skinCurrentlyEnabled = !!enabled;
    currentSkinOpacity = typeof opacity === 'number' ? opacity : 0.88;
    try {
      if (enabled) {
        const mountRoot = document.documentElement || document.body;
        // 基底层：全窗基底色（z -100000，位于壁纸之下；body 保持透明不遮挡）
        if (!baseLayer || !baseLayer.isConnected) {
          baseLayer = document.getElementById('kimino-base-layer') || document.createElement('div');
          baseLayer.id = 'kimino-base-layer';
          baseLayer.setAttribute('aria-hidden', 'true');
          if (!baseLayer.isConnected && mountRoot) mountRoot.appendChild(baseLayer);
        }
        baseLayer.style.display = 'block';

        const imgUrl = getWallpaperUrl();
        if (!wallpaperEl || !wallpaperEl.isConnected) {
          wallpaperController?.stop();
          wallpaperEl = document.getElementById('kimino-dream-wallpaper') || document.createElement('div');
          wallpaperEl.id = 'kimino-dream-wallpaper';
          wallpaperEl.__kgSrc = '';
          if (!wallpaperEl.isConnected && mountRoot) mountRoot.appendChild(wallpaperEl);
          wallpaperController = window.KiminoWallpaper ? new window.KiminoWallpaper(wallpaperEl, () => {
            fixedFade?.syncWallpaper(wallpaperEl, currentSkinOpacity);
            scheduleGeometry();
          }) : null;
        }
        if (wallpaperController) {
          const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
          void wallpaperController.setSource(imgUrl, reduced ? 'none' : wallpaperTransition);
        } else if (wallpaperEl.__kgSrc !== imgUrl) {
          wallpaperEl.__kgSrc = imgUrl;
          wallpaperEl.style.backgroundImage = `linear-gradient(rgba(20, 15, 35, 0.38), rgba(20, 15, 35, 0.62)), url("${imgUrl}")`;
        }
        wallpaperEl.style.opacity = currentSkinOpacity.toString();
        wallpaperEl.style.display = 'block';
        fixedFade?.syncWallpaper(wallpaperEl, currentSkinOpacity);
        if (!document.documentElement.classList.contains('kimino-dream-active')) {
          document.documentElement.classList.add('kimino-dream-active');
        }
      } else {
        wallpaperController?.stop();
        if (wallpaperEl) {
          wallpaperEl.style.display = 'none';
        }
        if (baseLayer) {
          baseLayer.style.display = 'none';
        }
        document.documentElement.classList.remove('kimino-dream-active');
        resetManagedStyles();
      }
    } catch (e) {
      console.warn('[Catstella] 皮肤应用异常:', e);
    }
  };

  // 画廊清单（构建期生成 assets/manifest.json；skin 侧用于解析内置壁纸 id → src）
  let kgManifestPromise = null;
  const loadGalleryManifest = () => {
    if (!kgManifestPromise) {
      kgManifestPromise = fetch(api.getURL('assets/manifest.json'))
        .then((r) => r.json())
        .catch(() => ({ wallpapers: [], characters: [] }));
    }
    return kgManifestPromise;
  };

  let configRevision = 0;
  let chatRevision = 0, chatReady = false;
  const chatKeys = ['chatTint','chatOpacity','replyOpacity','syncChatStyle','agyBridgeState'];
  const chatConfig = {};
  const readChatStyle = config => {
    const desktop = config.agyBridgeState?.desktop?.chatAppearance;
    if (config.syncChatStyle === true && config.agyBridgeState?.online === true && desktop &&
        /^#[0-9a-f]{6}$/i.test(desktop.tint || '') && Number.isFinite(desktop.opacity) && Number.isFinite(desktop.reply)) {
      return { tint:desktop.tint, opacity:desktop.opacity, reply:desktop.reply, following:true };
    }
    return { tint:config.chatTint, opacity:config.chatOpacity, reply:config.replyOpacity, following:false };
  };
  window.KiminoReadChatStyle = readChatStyle;
  const applyChatConfig = () => {
    const {tint,opacity,reply} = readChatStyle(chatConfig);
    paintChatStyle(tint,opacity,reply);
  };
  const paintChatStyle = (tint, opacity, reply) => {
    if (typeof opacity === 'string' && opacity.trim()) opacity = Number(opacity);
    if (typeof reply === 'string' && reply.trim()) reply = Number(reply);
    const root = document.documentElement;
    const replyCustom = Number.isFinite(reply);
    const custom = /^#[0-9a-f]{6}$/i.test(tint || '') || Number.isFinite(opacity) || replyCustom;
    root.toggleAttribute('data-kg-chat-custom', custom);
    const hex = /^#[0-9a-f]{6}$/i.test(tint || '') ? tint.slice(1) : '181224';
    root.style.setProperty('--kg-chat-rgb',[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)).join(','));
    const chatAlpha = (Number.isFinite(opacity) ? Math.max(0,Math.min(100,opacity)) : 76)/100;
    root.style.setProperty('--kg-chat-alpha',String(chatAlpha));
    // 回答透明度：未设置时与用户气泡同值（保持既有视觉）；0=全透、1=不透。
    // 记住最后已知值：跨标签页只广播一个键的变更时，另一维度不回退。
    const chatReply = replyCustom ? Math.max(0,Math.min(100,reply)) : null;
    root.style.setProperty('--kg-reply-alpha',String(chatReply === null ? chatAlpha : chatReply/100));
  };
  window.KiminoPreviewChatStyle = (...values) => {
    ++chatRevision;
    paintChatStyle(...values);
  };
  const loadAndApply = async () => {
    const revision = ++configRevision;
    const previousOpacityRevision = opacityRevision;
    const previousBlurRevision = blurRevision;
    const previousChatRevision = chatRevision;
    const res = await api.storageGet([
      'skinStyle', 'skinEnabled', 'wallpaperOpacity', 'wallpaperBlur', 'wallpaperId', 'customWallpapers', 'customWallpaper',
      'syncWallpaper', 'agyBridgeState', 'agySyncedWallpaper', 'onlinePalette',
      'webWallpaperSlideshow','webWallpaperInterval','webWallpaperCycle','webWallpaperFit','webWallpaperTransition',...chatKeys.filter(key=>key!=='agyBridgeState')
    ]);
    const style = window.KiminoSkinStyle?.read(res) ?? (res?.skinEnabled === false ? 'native' : 'glass');
    if (!chatReady) {
      chatReady = true;
      for (const key of chatKeys) if (!Object.hasOwn(chatConfig,key)) chatConfig[key] = res[key];
      if (previousChatRevision === chatRevision) applyChatConfig();
    }
    const isEnabled = style !== 'native';
    const opacity = res && typeof res.wallpaperOpacity === 'number' ? res.wallpaperOpacity : 0.88;

    let src = null;
    // 双端壁纸同步模式：启用同步且存在桌面端同步壁纸时优先应用桌面壁纸（支持轮播自动跟进）
    const usingDesktop = res?.syncWallpaper !== false && !!res?.agySyncedWallpaper?.dataUrl;
    if (usingDesktop) {
      src = res.agySyncedWallpaper.dataUrl;
    }

    // 独立模式或尚未与桌面端首次握手：解析 Web 本地画廊壁纸
    if (!src) {
      const configured = window.KiminoWallpaperSettings?.id(res) || res?.wallpaperId || '';
      const wid = configured === 'gemini-sheet' ? 'gemini-character-sheet-v1' : configured;
      if (wid.startsWith('custom:')) {
        const c = ((res && res.customWallpapers) || []).find((x) => x.id === wid);
        if (c) src = c.dataUrl;
      } else if (wid) {
        try {
          const man = await loadGalleryManifest();
          const w = (man.wallpapers || []).find((x) => x.id === wid);
          if (w) src = api.getURL(w.src);
        } catch (e) {}
      }
      if (!src && res && res.customWallpaper) src = res.customWallpaper; // 旧版单图迁移兜底
    }

    if (revision !== configRevision) return; // A slow gallery lookup cannot undo a newer toggle.
    const palette = res?.onlinePalette;
    const root = document.documentElement;
    if (style === 'solid') root.dataset.kiminoStyle = style;
    else delete root.dataset.kiminoStyle;
    if (isEnabled && ['pink', 'ocean', 'onyx'].includes(palette)) root.dataset.kiminoPalette = palette;
    else delete root.dataset.kiminoPalette;
    const desktop = usingDesktop ? res.agyBridgeState?.desktop : null;
    usingDesktopWallpaper = usingDesktop;
    wallpaperTransition = (usingDesktop ? desktop?.wallpaperTransition : res?.webWallpaperTransition) === 'none' ? 'none' : 'fade';
    const fit = (usingDesktop ? desktop?.wallpaperFit : res?.webWallpaperFit) === 'contain' ? 'contain' : 'cover';
    root.style.setProperty('--kg-wallpaper-fit',fit);
    wallpaperSrc = src; // null → getWallpaperUrl 回落默认
    if (usingDesktop || previousBlurRevision === blurRevision) setWallpaperBlur(usingDesktop ? 0 : res?.wallpaperBlur);
    const desktopOpacity = Number.isFinite(desktop?.opacity) ? Math.max(0,Math.min(1,desktop.opacity / 100)) : null;
    applySkin(isEnabled, desktopOpacity ?? (previousOpacityRevision === opacityRevision ? opacity : currentSkinOpacity));
    if (isEnabled) schedule();
  };

  // Surface discovery is incremental. CSS owns appearance, JS owns only geometry/semantics.
  const mark = (el, kind) => {
    if (el && el.getAttribute('data-kg') !== kind) el.setAttribute('data-kg', kind);
  };
  const scoped = (root, selector) => [
    ...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)
  ];
  const queryComposerTextarea = () =>
    document.querySelector('input-area-v2 rich-textarea:not(.edit-rich-textarea)') ||
    document.querySelector('input-container rich-textarea:not(.edit-rich-textarea)') ||
    document.querySelector('rich-textarea:not(.edit-rich-textarea)');
  const climbToPainted = (el, hops = 6) => {
    for (let cur = el; cur && cur !== document.body && hops-- > 0; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none') return cur;
    }
    return null;
  };
  const tagExpandButtons = (root) => {
    scoped(root, 'button, [role="button"]').forEach(button => {
      if (button.closest('bard-sidenav, [data-test-id="side-nav"]') ||
          !button.closest('user-query, model-response')) return;
      const icon = button.querySelector('mat-icon');
      const text = (button.textContent || '').trim();
      if (button.matches('.luminous-toggle-button, [aria-expanded]') ||
          /展开|收起|show more|read more|expand|collapse/i.test(button.getAttribute('aria-label') || text) ||
          /expand_more|expand_less|keyboard_arrow_down|keyboard_arrow_up/.test(icon?.textContent || '')) {
        if (!button.hasAttribute('data-kg-expand-btn')) button.setAttribute('data-kg-expand-btn', 'true');
      }
    });
  };
  const annotate = (root = document) => {
    if (!skinCurrentlyEnabled || (root !== document && !root.isConnected)) return;
    scoped(root, 'user-query').forEach(uq => {
      mark(uq, 'query-root');
      const edit = uq.querySelector('.edit-form.rich-edit-form');
      let bubble = edit || uq.querySelector('.user-query-bubble-with-background');
      // Bounded semantic fallback for a different host class: inspect this query's
      // content shells only, never every element in the conversation/page.
      if (!bubble) {
        const content = uq.querySelector('user-query-content, .user-query-content') || uq;
        bubble = [...content.children].find(el => {
          const cs = getComputedStyle(el);
          return (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none') &&
            el.getBoundingClientRect().height > 16;
        });
      }
      if (bubble) mark(bubble, 'bubble');
    });
    scoped(root, 'model-response').forEach(mr => {
      mark(mr, 'card');
      const thoughts = [...mr.querySelectorAll('model-thoughts, .thought-container, .thought-box, .thinking-container, [data-test-id="thinking-process"]')];
      thoughts.forEach(node => {
        if (!node.closest('response-footer, .response-footer') && !thoughts.some(other => other !== node && other.contains(node))) mark(node, 'thinking');
      });
    });
    const rt = queryComposerTextarea();
    if (rt && (root === document || root.contains(rt) || rt.closest('[data-kg="composer"]') === root)) {
      const composer = rt.closest('input-area-v2') || climbToPainted(rt) || rt;
      mark(composer, 'composer');
    }
    // Notification live-region was the known dark box; never inspect every body descendant.
    scoped(root, 'aside[aria-label="Notifications"]').forEach(el => mark(el, 'ghost'));
    if (location.pathname === '/usage') {
      scoped(root, 'li').forEach(el => {
        if (!/重置时间|resets?/i.test(el.textContent) || !/当前用量|每周限额|usage|weekly/i.test(el.textContent)) return;
        mark(el, 'usage-card');
        let shell = el.parentElement;
        for (let depth = 0; shell && depth < 5 && shell.matches('ul, div, section'); depth++, shell = shell.parentElement) {
          // Require the shared usage surface, never an individual card or the app shell.
          if (shell.matches('section') || shell.matches('ul') || shell.querySelector('h1,h2')) {
            shell.setAttribute('data-kg-usage-shell', '');
          }
        }
      });
      scoped(root, 'section').forEach(el => {
        if (/AI Ultra/.test(el.textContent) && /升级|upgrade/i.test(el.textContent)) mark(el, 'usage-banner');
      });
    }
    tagExpandButtons(root);
  };

  let columnWidth = 720;
  const sizedCards = new Map();
  const updateGeometry = () => {
    if (!skinCurrentlyEnabled) return;
    // Read all shared geometry before any writes. Unchanged widths never invalidate layout.
    const uq = document.querySelector('user-query');
    const rt = queryComposerTextarea();
    const pill = rt?.closest('input-area-v2');
    const measured = uq ? uq.getBoundingClientRect().width : (pill ? pill.getBoundingClientRect().width + 48 : 720);
    columnWidth = measured >= 480 && measured <= 880 ? Math.round(measured) : 720;
    updatePaneGeometry();
    for (const card of sizedCards.keys()) if (!card.isConnected) sizedCards.delete(card);
    document.querySelectorAll('model-response').forEach(card => {
      const value = columnWidth + 'px';
      const current = card.style.getPropertyValue('max-width');
      const saved = sizedCards.get(card);
      if (!saved || current !== saved.written) {
        sizedCards.set(card, { value: current, priority: card.style.getPropertyPriority('max-width'), written: value });
      } else saved.written = value;
      if (current !== value) card.style.setProperty('max-width', value, 'important');
    });
    fixedFade?.update(wallpaperEl, currentSkinOpacity, rt);
  };
  const updatePaneGeometry = () => {
    if (!wallpaperEl || !skinCurrentlyEnabled) return;
    const nav = document.querySelector('bard-sidenav');
    const left = Math.max(0, Math.round(nav ? nav.getBoundingClientRect().right : 0));
    const values = { left: left + 'px', top: '0px', width: Math.max(240, window.innerWidth - left) + 'px', height: window.innerHeight + 'px', right: 'auto', bottom: 'auto', 'border-radius': '22px', 'box-shadow': 'inset 0 0 0 1px rgba(174, 142, 218, 0.14)' };
    for (const [key, value] of Object.entries(values)) {
      if (wallpaperEl.style.getPropertyValue(key) !== value) wallpaperEl.style.setProperty(key, value, 'important');
    }
  };

  let annotateTimer = null;
  let animGateUntil = 0;
  const dirtyRoots = new Set();
  const schedule = (root = document) => {
    if (!skinCurrentlyEnabled) return;
    if (root === document) { dirtyRoots.clear(); dirtyRoots.add(document); }
    else if (!dirtyRoots.has(document)) dirtyRoots.add(root);
    if (annotateTimer !== null) return;
    annotateTimer = setTimeout(flushAnnotations, 60);
  };
  const flushAnnotations = () => {
    annotateTimer = null;
    if (!skinCurrentlyEnabled) { dirtyRoots.clear(); return; }
    const wait = animGateUntil - performance.now();
    if (wait > 0) { annotateTimer = setTimeout(flushAnnotations, wait + 16); return; }
    document.documentElement.toggleAttribute('data-kg-usage-page', location.pathname === '/usage');
    const roots = [...dirtyRoots];
    dirtyRoots.clear();
    roots.filter(root => !roots.some(other => other !== root && other.contains(root))).forEach(root => annotate(root));
    updateGeometry();
  };
  const enterAnimGate = (button) => {
    if (!skinCurrentlyEnabled) return;
    // Defer measurement only. Never disable a stylesheet, flip a root class or remove blur.
    animGateUntil = performance.now() + 400;
    schedule(button.closest('user-query, model-response') || button);
  };
  const toastSelector = 'mat-snack-bar-container, snack-bar, [role="status"], [role="alert"]';
  const copiedPrompt = /^(?:已复制提示(?:词)?|已複製提示(?:詞)?|prompt copied(?: to clipboard)?)[。.!！]?(?:\s*(?:发起新对话|發起新對話|start new chat|start a new chat))?$/i;
  let copyAnchor, copyAt = -Infinity, activeToast;
  const placeCopyToast = () => {
    if (!activeToast?.isConnected) { activeToast = null; return; }
    const { width, height } = activeToast.getBoundingClientRect();
    const anchor = copyAnchor?.isConnected && performance.now() - copyAt < 5000 ? copyAnchor.getBoundingClientRect() : null;
    const composer = document.querySelector('input-container, input-area-v2')?.getBoundingClientRect();
    const limit = (value, end) => Math.max(8, Math.min(value, end - 8));
    const near = anchor && anchor.bottom > 0 && anchor.top < innerHeight;
    const center = near ? (anchor.left + anchor.right) / 2 : innerWidth / 2;
    const fallback = composer?.top > height + 16 && composer.top < innerHeight ? composer.top - height - 12 : innerHeight - height - 20;
    const y = near && anchor.top >= height + 16 ? anchor.top - height - 8
      : near && anchor.bottom + height + 16 < innerHeight ? anchor.bottom + 8 : fallback;
    activeToast.style.setProperty('--kg-toast-left', limit(center - width / 2, innerWidth - width) + 'px');
    activeToast.style.setProperty('--kg-toast-top', limit(y, innerHeight - height) + 'px');
    activeToast.setAttribute('data-kg-copy-toast', '');
  };
  const findCopyToast = node => {
    const candidates = new Set([node.closest(toastSelector), ...node.querySelectorAll(toastSelector)]);
    for (const candidate of candidates) {
      if (!candidate || !copiedPrompt.test(candidate.textContent.trim().replace(/\s+/g, ' '))) continue;
      activeToast?.removeAttribute('data-kg-copy-toast');
      activeToast = candidate.closest('mat-snack-bar-container, snack-bar') || candidate;
      placeCopyToast();
      break;
    }
  };
  const queueMutation = (mutation) => {
    const parent = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
    if (!parent || parent.closest('#kimino-companion-root')) return;
    for (const node of mutation.addedNodes) {
      if (node.nodeType === 3 && parent.closest(toastSelector)) findCopyToast(parent);
      if (node.nodeType !== 1 || node.id?.startsWith('kimino-')) continue;
      if (node.matches(toastSelector) || node.closest(toastSelector) || node.querySelector(toastSelector)) findCopyToast(node);
      const anchors = 'user-query, model-response, input-area-v2, input-container, rich-textarea, bard-sidenav, aside[aria-label="Notifications"], details, model-thoughts, .thought-container, .thought-box, .thinking-container';
      const queryControl = node.matches('button, [role="button"]') && node.closest('user-query, model-response');
      const quotaSurface = location.pathname === '/usage' && (node.matches('li, section') || node.querySelector('li, section'));
      if (!queryControl && !quotaSurface && !node.matches(anchors) && !node.querySelector(anchors + ', button, [role="button"]')) continue;
      // CSS already covers recreated bubbles/buttons in the first frame. Mark only this subtree.
      const scope = node.closest('user-query, model-response, input-area-v2, input-container, bard-sidenav') || node;
      schedule(scope);
    }
  };
  const resetManagedStyles = () => {
    if (geometryTimer !== null) clearTimeout(geometryTimer);
    geometryTimer = null;
    if (annotateTimer !== null) clearTimeout(annotateTimer);
    annotateTimer = null;
    dirtyRoots.clear();
    for (const [card, saved] of sizedCards) {
      if (card.style.getPropertyValue('max-width') !== saved.written) continue;
      if (saved.value) card.style.setProperty('max-width', saved.value, saved.priority);
      else card.style.removeProperty('max-width');
    }
    sizedCards.clear();
    fixedFade?.destroy();
  };

  let geometryTimer = null;
  const scheduleGeometry = () => {
    if (!skinCurrentlyEnabled || geometryTimer !== null) return;
    geometryTimer = setTimeout(() => {
      geometryTimer = null;
      updateGeometry();
    }, 16);
  };

  // ============ 启动 ============
  (async () => {
    try {
      api.onChanged((changes, area) => {
        if (area !== 'local') return;
        if (chatKeys.some(key=>changes[key])) {
          const previous = JSON.stringify(readChatStyle(chatConfig));
          for (const key of chatKeys) if (changes[key]) chatConfig[key] = changes[key].newValue;
          if (previous !== JSON.stringify(readChatStyle(chatConfig))) applyChatConfig();
        }
        if (changes.wallpaperOpacity) setWallpaperOpacity(changes.wallpaperOpacity.newValue);
        if (changes.wallpaperBlur && !usingDesktopWallpaper) setWallpaperBlur(changes.wallpaperBlur.newValue);
        const before = changes.agyBridgeState?.oldValue;
        const after = changes.agyBridgeState?.newValue;
        const bridgeAffectsWallpaper = before?.online !== after?.online ||
          before?.desktop?.wallpaperTransition !== after?.desktop?.wallpaperTransition ||
          before?.desktop?.wallpaperFit !== after?.desktop?.wallpaperFit || before?.desktop?.opacity !== after?.desktop?.opacity;
        if (
          changes.skinStyle || changes.skinEnabled || changes.onlinePalette || changes.customWallpaper ||
          changes.wallpaperId || changes.customWallpapers || changes.syncWallpaper ||
          changes.agySyncedWallpaper || bridgeAffectsWallpaper ||
          changes.webWallpaperSlideshow || changes.webWallpaperCycle || changes.webWallpaperInterval ||
          changes.webWallpaperFit || changes.webWallpaperTransition
        ) {
          loadAndApply();
        }
      });
      await loadAndApply();
    } catch (err) {
      console.warn('[Catstella] 初始化皮肤配置异常，使用默认参数兜底:', err);
      applySkin(true, 0.88);
    }
    try {
      annotate();
      updateGeometry();

      // 自愈守护：防止窗口失焦、切换标签页或 SPA 重置 html.class 时主题/壁纸脱落
      const ensureSkinAlive = () => {
        if (skinCurrentlyEnabled) {
          if (
            !document.documentElement.classList.contains('kimino-dream-active') ||
            !baseLayer || !baseLayer.isConnected ||
            !wallpaperEl || !wallpaperEl.isConnected
          ) {
            applySkin(skinCurrentlyEnabled, currentSkinOpacity);
            updatePaneGeometry();
          }
        }
        schedule();
        scheduleGeometry();
      };
      const htmlAttrMo = new MutationObserver(() => {
        if (skinCurrentlyEnabled && !document.documentElement.classList.contains('kimino-dream-active')) {
          applySkin(skinCurrentlyEnabled, currentSkinOpacity);
        }
      });
      if (document.documentElement) {
        htmlAttrMo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
      }
      window.addEventListener('focus', ensureSkinAlive);
      window.addEventListener('blur', ensureSkinAlive);
      document.addEventListener('visibilitychange', () => {
        wallpaperController?.setVisible(!document.hidden);
        ensureSkinAlive();
      });
      // 收起/展开切换 → 进入动画禁窗（捕获阶段，键盘 Enter 触发的 click 同样命中）
      document.addEventListener('click', (ev) => {
        const control = ev.target?.closest?.('user-query button, user-query [role="button"]');
        const label = control?.getAttribute('aria-label') || control?.getAttribute('title') || '';
        if (/复制|複製|\bcopy\b/i.test(label)) {
          copyAnchor = control;
          copyAt = performance.now();
        }
        const b = ev.target && ev.target.closest && ev.target.closest('.luminous-toggle-button, [data-kg-expand-btn="true"]');
        if (b && !b.closest('bard-sidenav') && !b.closest('[data-test-id="side-nav"]')) enterAnimGate(b);
      }, { capture: true, passive: true });

      const mo = new MutationObserver(muts => {
        if (skinCurrentlyEnabled) muts.forEach(queueMutation);
      });
      const start = () => {
        const t = document.body;
        if (t) {
          mo.observe(t, { childList: true, subtree: true });
          schedule();

        } else {
          setTimeout(start, 500);
        }
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
      else start();
      setInterval(() => {
        if (!skinCurrentlyEnabled) return;
        if (!baseLayer?.isConnected || !wallpaperEl?.isConnected || !document.documentElement.classList.contains('kimino-dream-active')) {
          applySkin(true, currentSkinOpacity);
        }
        scheduleGeometry(); // Recovery only; no periodic full-page annotation.
      }, 15000);
      window.addEventListener('resize', scheduleGeometry);
      window.addEventListener('resize', placeCopyToast, { passive: true });
      window.addEventListener('popstate', () => schedule());
    } catch (e) {}
    console.log('[Catstella] Dream Skin 增量标注与固定渐隐就绪喵～✨');
  })();
})();
