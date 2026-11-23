(async () => {
  const api = window.widgetApi;
  const $ = id => document.getElementById(id);
  let data = await api.get();
  let active = null;
  let generation = 0;

/* @byok-dev-start */
  // BYOK state
  let byokMounted = false;
  let selectedProviderId = "";
  let keyRevealed = false;
  let editingModelOriginalId = null;
  const pingingKeys = new Set();

/* @byok-dev-end */
  // 1. 无边框窗口控制
  if ($("win-min-btn")) $("win-min-btn").onclick = () => api.command("settings-minimize");
  if ($("win-close-btn")) $("win-close-btn").onclick = () => api.command("settings-close");

  // 1.5 动态条件挂载 BYOK 标签页（严格遵循零侵入：未启用时完全不渲染 DOM）
  let navItems = [];
  let pages = [];

  function refreshNavLists() {
    navItems = [...document.querySelectorAll(".nav-item")];
    pages = [...document.querySelectorAll(".page")];
    navItems.forEach(b => {
      b.onclick = () => showPage(b.dataset.page);
    });
  }

  let onlinePanel, contentHub;
  function showPage(name) {
    if (name === "audio") name = "pet";
    if (name === "about" && !onlinePanel && api.online) onlinePanel = window.mountCatstellaOnline($("online-panel"), api.online, {updatesOnly:true});
    if (!pages.some(p => p.dataset.page === name)) name = "overview";
    navItems.forEach(b => {
      const current = b.dataset.page === name;
      b.classList.toggle("active", current);
      if (current) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    pages.forEach(p => p.classList.toggle("active", p.dataset.page === name));
    const scroller = $("content-scroll");
    if (scroller) scroller.scrollTo({top:0,behavior:"instant"});
    try { localStorage.setItem("cat_settings_page", name); } catch {}
  }

/* @byok-dev-start */
  function mountByokIfAvailable() {
    const isAvailable = data?.byok?.available === true;
    const hintEl = $("clickCatAction-hint");
    if (hintEl) {
      hintEl.textContent = isAvailable
        ? "选择切换页面：依次查看反重力额度、Web 伴侣用量、BYOK 网关与对话。"
        : "选择切换页面：依次查看反重力额度、Web 伴侣用量、喵言喵语陪伴对话与本机统计。";
    }
    if (!isAvailable || byokMounted) return;

    const navTpl = $("byok-nav-template");
    const pageTpl = $("byok-page-template");
    const sideNav = $("side-nav");
    const scrollContainer = $("content-scroll");
    if (!navTpl || !pageTpl || !sideNav || !scrollContainer) return;

    const spacer = sideNav.querySelector(".nav-spacer");
    sideNav.insertBefore(navTpl.content.cloneNode(true), spacer || null);
    scrollContainer.appendChild(pageTpl.content.cloneNode(true));
    byokMounted = true;
    selectedProviderId = data.byok.activeProviderId || data.byok.providers?.[0]?.id || "deepseek";
    refreshNavLists();
    bindByokEvents();
  }

/* @byok-dev-end */
  const mountOptionalSettings = typeof mountByokIfAvailable === "function" ? mountByokIfAvailable : () => {};
  refreshNavLists();
  mountOptionalSettings();
  const resolveInitialPage = () => {
    const hash = (window.location.hash || "").replace(/^#/, "").trim();
    if (hash === "byok" || hash === "models") return "models";
    if (hash) return hash;
    try { return localStorage.getItem("cat_settings_page") || "overview"; } catch { return "overview"; }
  };
  showPage(resolveInitialPage());
  if (api.onNavigate) {
    api.onNavigate(target => {
      mountOptionalSettings();
      showPage(target === "byok" ? "models" : target);
    });
  }
  window.addEventListener("hashchange", () => {
    const hash = (window.location.hash || "").replace(/^#/, "").trim();
    if (hash) {
      mountOptionalSettings();
      showPage(hash === "byok" ? "models" : hash);
    }
  });

  // 2. 音效选项填充
  for (const p of data.presets || []) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label;
    $("soundSet").append(o);
  }

  const keys = [
    "characterPack", "hostWindowOnly", "standaloneDesktopMode", "easterEggs", "scale", "alwaysOnTop",
    "reducedMotion", "clickThrough", "bubbleOn", "turnCostOn", "ambientChatter", "autoUpdateCheck",
    "turnCostDurationMs", "sound", "soundSet", "volume", "manualQuota",
    "manualPercent", "manualWeeklyPercent", "clickCatAction", "sideQuotaEnabled", "sideQuotaVariant", "sideQuotaDistance", "sideQuotaSize", "sideQuotaMode", "sideQuotaSource",
    "syncCharacter", "syncWallpaper", "syncInteraction", "petDisplayMode",
    "userHonorificMode", "customThemes", "bubbleTint", "bubbleOpacity"
  ];
  const original = Object.fromEntries(keys.map(key => [key, data.settings[key]]));
  const originalDreamSkin = data.dreamSkin ? { ...data.dreamSkin } : null;
  const appearanceKeys = ["syncCharacter", "syncWallpaper"];
  const savingAppearance = new Map();
  let pending = Promise.resolve();
  const settingDrafts = new Map();
  let renderFrame = 0;
  function queueRender() {
    if (!renderFrame) renderFrame = requestAnimationFrame(() => { renderFrame = 0; render(); });
  }
  const dreamDrafts = new Map();
  const dreamValue = (key, fallback) => dreamDrafts.get(key)?.value ?? data.dreamSkin?.[key] ?? fallback;
  function setControlValue(id, value) {
    if ($(id).value !== String(value)) $(id).value = value;
  }
  function bindDreamAdjustment(id, key, paint, message = "已保存", read = Number) {
    const el = $(id);
    const preview = () => {
      const entry = {value:read(el.value), queued:false};
      dreamDrafts.set(key, entry);
      paint(entry.value);
    };
    const commit = () => {
      const entry = dreamDrafts.get(key);
      if (!entry || entry.queued) return;
      if (entry.value === data.dreamSkin?.[key]) { dreamDrafts.delete(key); return; }
      entry.queued = true;
      save({dreamSkin:{[key]:entry.value}}, message).then(() => {
        if (dreamDrafts.get(key) === entry) { dreamDrafts.delete(key); render(); }
      });
    };
    el.addEventListener("input", preview);
    el.addEventListener("change", () => { if (!dreamDrafts.has(key)) preview(); commit(); });
    el.addEventListener("blur", commit);
  }

  function save(partial, message = "已保存") {
    const intent = {};
    for (const key of appearanceKeys) {
      if (typeof partial[key] === "boolean") savingAppearance.set(key, { intent, value: partial[key] });
    }
    pending = pending.then(async () => {
      try {
        data = await api.save(typeof partial === "function" ? partial() : partial);
        stop();
        $("saved").textContent = message;
        return true;
      } catch {
        $("saved").textContent = "保存失败，请重试";
        return false;
      } finally {
        for (const key of appearanceKeys) if (savingAppearance.get(key)?.intent === intent) savingAppearance.delete(key);
        queueRender();
      }
    });
    return pending;
  }

  // 3. 视图模式切换与记忆 (横向滚动 vs 2xN 网格)
  let charViewMode = localStorage.getItem("cat_char_view_mode") || "carousel";
  let wallViewMode = localStorage.getItem("cat_wall_view_mode") || "carousel";

  function setupViewToggle(toggleId, galleryId, getMode, setMode) {
    const toggle = $(toggleId);
    const gallery = $(galleryId);
    if (!toggle || !gallery) return;

    function applyMode(mode) {
      if (gallery.dataset.mode === mode) return;
      gallery.classList.add("switching");
      setTimeout(() => {
        gallery.className = "gallery-container mode-" + mode;
        gallery.dataset.mode = mode;
        toggle.querySelectorAll(".view-btn").forEach(btn => {
          btn.classList.toggle("active", btn.dataset.mode === mode);
        });
        setMode(mode);
        requestAnimationFrame(() => {
          gallery.classList.remove("switching");
        });
      }, 100);
    }

    toggle.querySelectorAll(".view-btn").forEach(btn => {
      btn.onclick = () => applyMode(btn.dataset.mode);
    });

    applyMode(getMode());
  }

  setupViewToggle("char-view-toggle", "character-gallery", () => charViewMode, m => { charViewMode = m; localStorage.setItem("cat_char_view_mode", m); });
  setupViewToggle("wall-view-toggle", "wallpaper-gallery", () => wallViewMode, m => { wallViewMode = m; localStorage.setItem("cat_wall_view_mode", m); });

  function galleryTile(gallery, {id, name, description, preview, active, kind, select}) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "gallery-card" + (active ? " active" : "");
    card.dataset.assetId = id;
    card.setAttribute("aria-pressed", String(active));
    card.title = "使用「" + name + "」";
    const append = (parent, tag, css, text = "") => {
      const element = document.createElement(tag);
      element.className = css;
      element.textContent = text;
      parent.appendChild(element);
      return element;
    };
    if (active) append(card, "span", "card-badge", "✓ 使用中");
    const thumb = append(card, "span", kind === "character" ? "card-char-thumb" : "card-wall-thumb");
    if (preview) {
      const image = append(thumb, "img", "");
      image.src = preview;
      image.alt = "";
      image.loading = "lazy";
    } else append(thumb, "span", "card-wall-placeholder", kind === "character" ? "🐱" : "🖼️");
    const info = append(card, "span", "card-info");
    append(info, "span", "card-title", name);
    append(info, "span", "card-desc", description);
    card.onclick = select;
    gallery.appendChild(card);
    return card;
  }

  const gallerySnapshots = new Map();
  function renderGallery(gallery, items, fields, active, build) {
    const previous = gallerySnapshots.get(gallery);
    if (previous && previous.active === active && previous.items.length === items.length &&
        previous.items.every((item, index) => fields.every(key => item[key] === items[index][key]))) return;
    gallerySnapshots.set(gallery, { items, active });
    const focused = gallery.contains(document.activeElement) ? document.activeElement.dataset.assetId : null;
    const scrollLeft = gallery.scrollLeft;
    gallery.replaceChildren();
    for (const item of items) build(item);
    gallery.scrollLeft = scrollLeft;
    if (focused) [...gallery.querySelectorAll("[data-asset-id]")].find(card => card.dataset.assetId === focused)?.focus({preventScroll:true});
  }

  function describeAppearance(kind, name, syncKey, enabled = true) {
    $("desktop-current-" + kind).textContent = "当前桌面：" + (name || "默认");
    const follows = savingAppearance.get(syncKey)?.value ?? data.settings[syncKey] !== false;
    let detail = follows
      ? (data.webCompanion?.online ? "同步中 · 网页的独立选择会保留" : "同步待连接 · 网页暂用自己的选择")
      : "独立设置 · 网页使用自己的选择";
    if (!enabled) detail += " · 反重力外观已关闭";
    $("desktop-" + kind + "-mode").textContent = detail;
  }

  function renderCharacterGallery() {
    const gallery = $("character-gallery"), packs = data.characterPacks || [];
    const selected = data.settings.characterPack;
    describeAppearance("character", packs.find(pack => pack.id === selected)?.name, "syncCharacter");
    $("character-count").textContent = packs.length + " 款形态";
    renderGallery(gallery, packs, ["id", "name", "description", "preview"], selected, pack => {
      const active = selected === pack.id;
      galleryTile(gallery, {
        id: pack.id,
        name: pack.name, description: pack.description || pack.id, preview: pack.preview, active, kind: "character",
        select: () => { if (!active) save({ characterPack: pack.id }, "已切换为「" + pack.name + "」"); }
      });
    });
  }

  const expandedWallpaperPacks = new Set();
  function renderWallpaperGallery() {
    const gallery = $("wallpaper-gallery"), walls = data.wallpapers || [];
    $("wallpaper-count").textContent = walls.length + " 张";
    const selected = selectedWallpaper(walls);
    describeAppearance("wallpaper", selected?.title, "syncWallpaper", data.dreamSkin?.enabled === true);
    const previous = gallerySnapshots.get(gallery);
    const fields = ["id", "title", "fileName", "filePath", "preview"];
    if (previous && previous.active === selected?.id && previous.items.length === walls.length &&
        previous.items.every((wall,i) => fields.every(key => wall[key] === walls[i][key]) && wall.packKey === JSON.stringify(walls[i].pack))) return;
    const groups = window.CatstellaWallpaperPacks.groups(walls);
    const membership = new Map(groups.filter(group => group.name).flatMap(group => group.items.map(wall => [wall.id,group])));
    const drawn = new Set();
    const addWall = (parent,wall) => {
      const active = selected?.id === wall.id;
      galleryTile(parent, {
        id: wall.id,
        name: wall.title, description: wall.fileName, preview: wall.preview, active, kind: "wallpaper",
        select: () => { if (!active) save({ dreamSkin: { wallpaperFile: wall.filePath } }, "已切换至「" + wall.title + "」"); }
      });
    };
    const galleryRows = walls.map(wall => ({...wall, packKey:JSON.stringify(wall.pack)}));
    renderGallery(gallery, galleryRows, ["id", "title", "fileName", "filePath", "preview", "packKey"], selected?.id, wall => {
      const group = membership.get(wall.id);
      if (!group) { addWall(gallery,wall); return; }
      if (drawn.has(group.key)) return;
      drawn.add(group.key);
      const current = group.items.find(item => item.id === selected?.id);
      const cover = galleryTile(gallery,{
        id:group.key,name:group.name,description:group.items.length + " 张壁纸 · 展开 / 收起",
        preview:(current || group.items[0]).preview,active:!!current,kind:"wallpaper"
      });
      cover.classList.add("wallpaper-pack");
      cover.title = group.name;
      cover.removeAttribute("aria-pressed");
      cover.setAttribute("aria-label",group.name + "，" + group.items.length + " 张壁纸");
      window.CatstellaWallpaperPacks.attach(cover,group.key,expandedWallpaperPacks,parent => {
        for (const item of group.items) addWall(parent,item);
      });
    });
  }

  function selectedWallpaper(walls = data.wallpapers || []) {
    const normalizePath = value => (value || "").replace(/\\/g, "/").toLowerCase();
    const current = normalizePath(data.dreamSkin?.wallpaperFile);
    return walls.find(wall => wall.id === data.dreamSkin?.wallpaperId) ||
      (current && walls.find(wall => normalizePath(wall.filePath) === current)) || walls[0];
  }

  const storeCategories = { theme: "主题", wallpaper: "壁纸", character: "桌宠" };
  const seenStoreKey = "catstella.hub.seen-updates.v1";
  let seenStoreUpdates = new Map(), unseenStoreUpdates = [];
  try { seenStoreUpdates = new Map(JSON.parse(localStorage.getItem(seenStoreKey) || "[]")); } catch {}
  const storeRevision = item => item.sha256 || item.updatedAt || item.id;
  function updateOnlineNotice(items) {
    unseenStoreUpdates = items.filter(item => seenStoreUpdates.get(item.id) !== storeRevision(item));
    const available = new Set(unseenStoreUpdates.map(item => item.kind));
    const labels = Object.keys(storeCategories).filter(kind => available.has(kind)).map(kind => storeCategories[kind]);
    $("online-notice").hidden = !labels.length;
    const message = labels.length ? "内容商店有" + labels.join("、") + "更新" : "";
    if ($("online-notice-text").textContent !== message) $("online-notice-text").textContent = message;
  }
  function acknowledgeStoreUpdates() {
    for (const item of unseenStoreUpdates) {
      seenStoreUpdates.delete(item.id);
      seenStoreUpdates.set(item.id,storeRevision(item));
    }
    seenStoreUpdates = new Map([...seenStoreUpdates].slice(-180));
    try { localStorage.setItem(seenStoreKey,JSON.stringify([...seenStoreUpdates])); } catch {}
    updateOnlineNotice([]);
  }
  function openOnlineGallery(kind) {
    showPage("store");
    contentHub?.filter(kind);
  }
  $("online-characters").onclick = () => openOnlineGallery("character");
  $("online-wallpapers").onclick = () => openOnlineGallery("wallpaper");
  $("view-online-updates").onclick = () => {
    acknowledgeStoreUpdates();
    showPage("store");
    contentHub?.filter("all","recent");
    $("content-hub").querySelector('.hub-filters [aria-pressed=true]')?.focus({preventScroll:true});
  };
  $("dismiss-online-notice").onclick = acknowledgeStoreUpdates;
  if (api.online) {
    const installedAsset = item => (data[item.kind === "character" ? "characterPacks" : "wallpapers"] || [])
      .find(asset => asset.id === item.id || asset.id === "online-" + item.id);
    contentHub = window.mountCatstellaHub($("content-hub"), {
      call: async (action,value) => {
        const result = await api.online(action,value);
        if ((action === "download" || action === "uninstall") && result?.ok) data = await api.get() || data;
        return result;
      },
      selection: item => {
        if (item.kind === "theme") {
          const known = {"violet-default":"violet","midnight-blue":"ocean"}[item.id];
          const active = known ? known === data.dreamSkin.themePreset : data.dreamSkin.onlineThemeId === item.id;
          return {installed:active,active,revision:data.dreamSkin.onlineThemeId === item.id ? data.dreamSkin.onlineThemeRevision || "" : ""};
        }
        const asset = installedAsset(item);
        return {installed:!!asset,active:!!asset && (item.kind === "character" ? data.settings.characterPack === asset.id :
          selectedWallpaper()?.id === asset.id),revision:asset?.revision || "",
          preview:(asset?.filePath ? ("file:///" + asset.filePath.replace(/\\/g, "/")) : asset?.frames?.idle || asset?.preview)};
      },
      currentTheme: () => ({preset:data.dreamSkin.themePreset,opacity:data.dreamSkin.opacity}),
      use: async item => {
        if (item.kind === "theme") {
          const result = await api.online("install",item.id);
          if(result?.ok) data = await api.get() || data;
          return result;
        }
        const asset = installedAsset(item);
        if (!asset) return {ok:false};
        const updated = await api.save(item.kind === "character" ? {characterPack:asset.id} : {dreamSkin:{wallpaperFile:asset.filePath}});
        if(updated) data = updated;
        return {ok:item.kind === "character" ? data.settings.characterPack === asset.id : selectedWallpaper()?.id === asset.id};
      },
      openSource: url => void api.online("source",url),
      previewWallpaper: () => selectedWallpaper()?.preview,
      onCount: updateOnlineNotice
    });
    void contentHub.load();
  }

  // 5.5 双端联动看板与状态胶囊渲染
  function renderDualCompanionStatus() {
    const wc = data?.webCompanion || {};
    const wq = wc.quota || null;
    const pillClass = wc.online ? "sync-pill online" : (wq ? "sync-pill cached" : "sync-pill offline");
    const pillText = wc.online
      ? (wc.active ? "🟢 Web 伴侣活跃同步中" : "🟢 Web 伴侣已连接")
      : (wq ? "🟣 已缓存 Web 快照（浏览器未打开）" : `⚪ 等待浏览器扩展连接 (${wc.port ? "127.0.0.1:" + wc.port : "本地桥接"})`);

    for (const id of ["overview-bridge-pill", "pet-bridge-pill", "quota-bridge-pill"]) {
      const el = $(id);
      if (el) {
        el.className = pillClass;
        el.textContent = pillText;
      }
    }

    // AGY 用量卡片
    const q = data?.quotaWindows || {};
    const gData = q.gemini || q;
    const manual = data?.settings?.manualQuota === true;
    const isArgon = Boolean(q.modelInfo?.modelName?.toLowerCase().includes("argon"));
    const fiveVal = manual ? data.settings.manualPercent : (isArgon ? (q.argon?.fiveHour ?? gData?.fiveHour) : gData?.fiveHour);
    const weekVal = manual ? data.settings.manualWeeklyPercent : (isArgon ? (q.argon?.weekly ?? gData?.weekly) : gData?.weekly);
    if ($("dq-agy-model")) $("dq-agy-model").textContent = q.modelInfo?.modelName || (manual ? "手动记录" : "本机读取");
    if ($("dq-agy-5h")) $("dq-agy-5h").textContent = typeof fiveVal === "number" ? `${Math.round(fiveVal)}%` : "—";
    if ($("dq-agy-week")) $("dq-agy-week").textContent = typeof weekVal === "number" ? `${Math.round(weekVal)}%` : "—";
    if ($("dq-agy-steps")) {
      const argonBrief = typeof q.argon?.weekly === "number" ? ` · 🪐 Argon 余 ${Math.round(q.argon.weekly)}%` : "";
      $("dq-agy-steps").textContent = `${data?.ledger?.todaySteps || 0} 步${argonBrief}`;
    }

    // Web 用量卡片
    if ($("dq-web-model")) {
      $("dq-web-model").textContent = wq?.displaySource === "official"
        ? "官方账本"
        : (wq?.lastModel || (wc.online ? "已连接" : "待同步"));
    }
    if ($("dq-web-5h")) {
      $("dq-web-5h").textContent = wq
        ? (typeof wq.fiveHourUsedPct === "number" ? `剩余 ${Math.max(0, 100 - wq.fiveHourUsedPct)}%` : `${wq.window5hTotal} 次`)
        : "—";
    }
    if ($("dq-web-daily")) {
      $("dq-web-daily").textContent = wq
        ? (typeof wq.weeklyUsedPct === "number" ? `剩余 ${Math.max(0, 100 - wq.weeklyUsedPct)}%` : (wq.dailyTotal ? `${wq.dailyTotal} / ${wq.dailyBudget || 150} 次` : "待同步"))
        : "—";
    }
    if ($("dq-web-split")) {
      $("dq-web-split").textContent = wq
        ? (wq.resetHint ? `重置 ${wq.resetHint} · 第 ${wq.sessionTurns || 0} 轮` : `第 ${wq.sessionTurns || 0} 轮 · ~${((wq.sessionTokensEst || 0) / 1000).toFixed(1)}k`)
        : "—";
    }
  }

  // =========================================================================
/* @byok-dev-start */
  // 6. BYOK 双栏视图渲染与交互控制器
  // =========================================================================
  const STATUS_LAMP = {
    online: { dot: "🟢", label: "联通正常" },
    warning: { dot: "🟡", label: "未测试或待配置" },
    error: { dot: "🔴", label: "连接失败" },
    disabled: { dot: "⚪", label: "已禁用" }
  };

  function getSelectedProvider() {
    const providers = data?.byok?.providers || [];
    return providers.find(p => p.id === selectedProviderId) || providers[0] || null;
  }

  function renderByokPanel() {
    if (!byokMounted || !data?.byok?.available) return;
    const byok = data.byok;
    const providers = byok.providers || [];
    if (providers.length && !providers.some(p => p.id === selectedProviderId)) {
      selectedProviderId = byok.activeProviderId || providers[0].id;
    }

    if ($("byok-gateway-banner")) {
      const routeText = byok.activeProvider?.enabled
        ? ` · 当前活跃路由：${byok.activeProvider.name} / ${byok.activeProvider.activeModel || "默认"}`
        : "";
      $("byok-gateway-banner").textContent = byok.gatewayOnline
        ? `🟢 本地网关运行中 · ${byok.endpoint}${routeText}`
        : `🔴 本地网关未就绪 · 目标端点 ${byok.endpoint}`;
    }
    if ($("byok-today-stat")) {
      $("byok-today-stat").textContent = `今日请求 ${byok.todayRequests || 0} 次`;
    }

    // 网关进阶配置开关同步
    const gw = byok.gateway || {};
    if ($("byok-cfg-mcp") && document.activeElement !== $("byok-cfg-mcp")) {
      $("byok-cfg-mcp").checked = gw.mcpBridgeEnabled === true;
    }
    if ($("byok-cfg-portal") && document.activeElement !== $("byok-cfg-portal")) {
      $("byok-cfg-portal").checked = gw.hostPortalEnabled !== false;
    }
    if ($("byok-cfg-failover") && document.activeElement !== $("byok-cfg-failover")) {
      $("byok-cfg-failover").checked = gw.failoverEnabled !== false;
    }
    if ($("byok-cfg-token") && document.activeElement !== $("byok-cfg-token")) {
      $("byok-cfg-token").checked = gw.gatewayTokenEnabled === true;
    }
    const tokenOn = gw.gatewayTokenEnabled === true;
    if ($("byok-copy-gw-token")) $("byok-copy-gw-token").hidden = !tokenOn;
    if ($("byok-regen-gw-token")) $("byok-regen-gw-token").hidden = !tokenOn;
    if ($("byok-cfg-token-hint")) {
      $("byok-cfg-token-hint").textContent = tokenOn && gw.gatewayTokenMasked
        ? `已启用专属口令（${gw.gatewayTokenMasked}）· 客户端需携带此 Bearer Token`
        : "可选：要求本机客户端携带网关专属 Bearer Token，外部网页 Origin 已默认拦截";
    }

    // 左栏：渲染供应商列表
    const listEl = $("byok-provider-list");
    if (listEl) {
      listEl.innerHTML = "";
      for (const p of providers) {
        const lamp = STATUS_LAMP[p.status] || STATUS_LAMP.warning;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "byok-prov-item" + (p.id === selectedProviderId ? " active" : "");
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-selected", String(p.id === selectedProviderId));
        btn.title = `${p.name} · ${lamp.label}`;

        const left = document.createElement("span");
        left.className = "byok-prov-left";
        const dot = document.createElement("span");
        dot.className = "byok-dot";
        dot.textContent = lamp.dot;
        const nm = document.createElement("span");
        nm.className = "byok-prov-name";
        nm.textContent = p.name;
        left.append(dot, nm);

        const meta = document.createElement("span");
        meta.className = "byok-prov-meta";
        meta.textContent = p.balance?.formatted
          ? p.balance.formatted
          : (typeof p.pingMs === "number" ? `${p.pingMs}ms` : `${p.models.length}`);

        btn.append(left, meta);
        btn.onclick = async () => {
          if (selectedProviderId !== p.id) {
            selectedProviderId = p.id;
            keyRevealed = false;
            if ($("byok-api-key")) {
              $("byok-api-key").type = "password";
              $("byok-api-key").value = "";
              delete $("byok-api-key").dataset.dirty;
            }
            if ($("byok-key-eye")) $("byok-key-eye").textContent = "👁️";
            if (p.enabled) {
              try { data.byok = await api.byok("setActiveProvider", { providerId: p.id }); } catch {}
            }
            renderByokPanel();
          }
        };
        listEl.appendChild(btn);
      }
    }

    // 右栏：渲染当前选中的供应商详情
    const prov = getSelectedProvider();
    const detailCol = $("byok-detail-col");
    if (!prov) {
      if (detailCol) detailCol.hidden = true;
      return;
    }
    if (detailCol) detailCol.hidden = false;

    $("byok-prov-title").textContent = prov.name;
    $("byok-prov-badge").textContent = prov.builtin ? "内置预设" : "自定义";
    const balChip = $("byok-prov-balance");
    if (balChip) {
      const balText = prov.balance?.formatted || "";
      balChip.hidden = !balText;
      balChip.textContent = balText ? `💰 ${balText}` : "";
    }
    if (document.activeElement !== $("byok-prov-enabled")) $("byok-prov-enabled").checked = prov.enabled === true;
    if (document.activeElement !== $("byok-prov-name")) $("byok-prov-name").value = prov.name;
    if (document.activeElement !== $("byok-protocol")) $("byok-protocol").value = prov.protocol || "openai";
    if (document.activeElement !== $("byok-base-url")) $("byok-base-url").value = prov.baseUrl || "";

    const keyInput = $("byok-api-key");
    if (keyInput && document.activeElement !== keyInput && keyInput.dataset.dirty !== "true" && !keyRevealed) {
      keyInput.value = "";
      keyInput.placeholder = prov.hasApiKey
        ? `${prov.apiKeyMasked}（已本地安全存储 · 输入新值覆盖）`
        : (prov.id === "ollama" ? "本地 Ollama 可留空" : "输入 API Key (例如 sk-...)");
    }

    const lamp = STATUS_LAMP[prov.status] || STATUS_LAMP.warning;
    const statusLine = $("byok-prov-status-line");
    if (statusLine) {
      let msg = `${lamp.dot} 状态：${lamp.label}`;
      if (typeof prov.pingMs === "number") msg += ` · 最近延迟 ${prov.pingMs} ms`;
      if (prov.balance?.formatted) msg += ` · 账户余额/额度：${prov.balance.formatted}`;
      if (prov.lastError) msg += ` · 诊断：${prov.lastError}`;
      statusLine.textContent = msg;
    }

    // 渲染模型卡片列表
    if ($("byok-model-count")) $("byok-model-count").textContent = `${prov.models.length} 个模型`;
    const activeProvId = byok.activeProvider?.id || byok.activeProviderId;
    const activeModId = byok.activeProvider?.activeModel || byok.activeModelId;
    const modelListEl = $("byok-model-list");
    if (modelListEl) {
      modelListEl.innerHTML = "";
      for (const m of prov.models) {
        const pingKey = `${prov.id}::${m.id}`;
        const isPinging = pingingKeys.has(pingKey);
        const mPing = prov.modelPings?.[m.id];
        const isDefaultActive = activeProvId === prov.id && activeModId === m.id && m.enabled !== false;

        const card = document.createElement("div");
        card.className = "byok-model-card"
          + (m.enabled === false ? " disabled-model" : "")
          + (isDefaultActive ? " active-route-model" : "")
          + (isPinging ? " is-pinging" : "");

        const main = document.createElement("div");
        main.className = "byok-model-main";

        const idSpan = document.createElement("span");
        idSpan.className = "byok-model-id";
        idSpan.textContent = m.id;

        const badges = document.createElement("div");
        badges.className = "byok-badges";

        if (isDefaultActive) {
          const defB = document.createElement("span");
          defB.className = "byok-badge active-route";
          defB.textContent = "⭐ 默认活跃";
          badges.appendChild(defB);
        }

        if (m.contextLength) {
          const ctxB = document.createElement("span");
          ctxB.className = "byok-badge ctx";
          ctxB.textContent = m.contextLength;
          badges.appendChild(ctxB);
        }

        for (const tag of m.tags || []) {
          const tb = document.createElement("span");
          const cls = tag === "视觉" ? "tag-vision" : tag === "推理" ? "tag-reason" : "tag-tools";
          tb.className = `byok-badge ${cls}`;
          tb.textContent = tag;
          badges.appendChild(tb);
        }

        if (isPinging) {
          const pb = document.createElement("span");
          pb.className = "byok-badge ping-busy";
          pb.textContent = "⚡ 测速中…";
          badges.appendChild(pb);
        } else if (mPing) {
          const pb = document.createElement("span");
          if (mPing.status === "online" && typeof mPing.pingMs === "number") {
            pb.className = "byok-badge ping-ok";
            pb.textContent = `⚡ ${mPing.pingMs} ms`;
          } else if (mPing.status === "error") {
            pb.className = "byok-badge ping-err";
            pb.textContent = `🔴 ${mPing.error || "连接失败"}`;
            pb.title = mPing.error || "连接失败";
          }
          if (pb.textContent) badges.appendChild(pb);
        }

        main.append(idSpan, badges);

        const actions = document.createElement("div");
        actions.className = "byok-model-actions";

        const starBtn = document.createElement("button");
        starBtn.type = "button";
        starBtn.className = "byok-act-btn" + (isDefaultActive ? " active-star" : "");
        starBtn.title = isDefaultActive ? "当前默认活跃路由模型" : "设为网关默认活跃模型（同步气泡与 Claude Code 回退）";
        starBtn.textContent = isDefaultActive ? "⭐" : "☆";
        starBtn.onclick = async () => {
          try {
            data.byok = await api.byok("setActiveModel", { providerId: prov.id, modelId: m.id });
            renderByokPanel();
            $("saved").textContent = `已将 ${prov.name} / ${m.id} 设为默认活跃模型`;
          } catch (err) {
            $("saved").textContent = err?.message || "切换默认模型失败";
          }
        };

        const pingBtn = document.createElement("button");
        pingBtn.type = "button";
        pingBtn.className = "byok-act-btn";
        pingBtn.title = "一键连通性测速 Ping";
        pingBtn.textContent = "⚡";
        pingBtn.disabled = isPinging;
        pingBtn.onclick = () => triggerModelPing(prov.id, m.id);

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "byok-act-btn";
        editBtn.title = "编辑模型";
        editBtn.textContent = "✏️";
        editBtn.onclick = () => openModelDialog(prov.id, m);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "byok-act-btn danger";
        delBtn.title = "删除模型";
        delBtn.textContent = "🗑️";
        delBtn.onclick = async () => {
          try {
            data.byok = await api.byok("deleteModel", { providerId: prov.id, modelId: m.id });
            renderByokPanel();
            $("saved").textContent = `已删除模型 ${m.id}`;
          } catch (err) {
            $("saved").textContent = err?.message || "删除模型失败";
          }
        };

        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.setAttribute("switch", "");
        toggle.checked = m.enabled !== false;
        toggle.title = m.enabled !== false ? "点击禁用该模型" : "点击启用该模型";
        toggle.onchange = async () => {
          try {
            data.byok = await api.byok("upsertModel", {
              providerId: prov.id,
              previousModelId: m.id,
              model: { ...m, enabled: toggle.checked }
            });
            renderByokPanel();
            $("saved").textContent = `${m.id} 已${toggle.checked ? "启用" : "禁用"}`;
          } catch (err) {
            $("saved").textContent = err?.message || "更新失败";
          }
        };

        actions.append(pingBtn, starBtn, editBtn, delBtn, toggle);
        card.append(main, actions);
        modelListEl.appendChild(card);
      }
    }
  }

  let byokSaveChain = Promise.resolve();

  function saveCurrentProvider(customMsg) {
    byokSaveChain = byokSaveChain.then(async () => {
      const prov = getSelectedProvider();
      if (!prov) return;
      const keyInput = $("byok-api-key");
      const payload = {
        id: prov.id,
        name: $("byok-prov-name").value.trim() || prov.name,
        enabled: $("byok-prov-enabled").checked,
        baseUrl: $("byok-base-url").value.trim(),
        protocol: $("byok-protocol").value,
        setActive: $("byok-prov-enabled").checked
      };
      let submittedApiKey;
      if (keyInput && keyInput.dataset.dirty === "true") {
        submittedApiKey = keyInput.value.trim();
        payload.apiKey = submittedApiKey;
      }
      try {
        data.byok = await api.byok("upsertProvider", payload);
        if (keyInput && submittedApiKey !== undefined && keyInput.value.trim() === submittedApiKey) {
          delete keyInput.dataset.dirty;
          if (!keyRevealed) keyInput.value = "";
        }
        renderByokPanel();
        $("saved").textContent = customMsg || `已保存「${payload.name}」配置`;
      } catch (err) {
        $("saved").textContent = err?.message || "保存供应商配置失败";
      }
    });
    return byokSaveChain;
  }

  async function triggerModelPing(providerId, modelId) {
    const pingKey = `${providerId}::${modelId || "*"}`;
    pingingKeys.add(pingKey);
    renderByokPanel();
    $("saved").textContent = `正在测速 ${modelId || providerId}…`;
    try {
      const res = await api.byok("ping", { providerId, modelId });
      if (res?.snapshot) data.byok = res.snapshot;
      $("saved").textContent = res?.ok
        ? `⚡ 测速成功：${modelId || providerId} 延迟 ${res.pingMs} ms`
        : `🔴 测速失败：${res?.error || "无法连接"}`;
    } catch (err) {
      $("saved").textContent = `🔴 测速异常：${err?.message || "请求失败"}`;
    } finally {
      pingingKeys.delete(pingKey);
      renderByokPanel();
    }
  }

  function openModelDialog(providerId, existingModel = null) {
    const dlg = $("byok-model-dialog");
    if (!dlg) return;
    editingModelOriginalId = existingModel ? existingModel.id : null;
    $("byok-model-dialog-title").textContent = existingModel ? "编辑模型" : "添加模型";
    $("dlg-model-id").value = existingModel ? existingModel.id : "";
    $("dlg-model-ctx").value = ["32K", "64K", "128K", "200K", "1M"].includes(existingModel?.contextLength)
      ? existingModel.contextLength
      : "128K";
    const tags = existingModel?.tags || ["工具"];
    $("dlg-tag-vision").checked = tags.includes("视觉");
    $("dlg-tag-reason").checked = tags.includes("推理");
    $("dlg-tag-tools").checked = tags.includes("工具");
    dlg.returnValue = "";
    dlg.showModal();
  }

  function attachDialogLightDismissFallback(dialog) {
    if (!dialog || ("closedBy" in HTMLDialogElement.prototype)) return;
    let pointerDownOutside = false;
    dialog.addEventListener("pointerdown", e => {
      if (e.target !== dialog) { pointerDownOutside = false; return; }
      const r = dialog.getBoundingClientRect();
      pointerDownOutside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    });
    dialog.addEventListener("pointerup", e => {
      if (!pointerDownOutside || e.target !== dialog) return;
      pointerDownOutside = false;
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        dialog.close("dismiss");
      }
    });
  }

  function bindByokEvents() {
    for (const dlgId of ["byok-provider-dialog", "byok-model-dialog", "byok-env-dialog"]) {
      attachDialogLightDismissFallback($(dlgId));
    }

    // 接入代码片段 Popover 菜单
    const snippetsPopover = $("byok-snippets-popover");
    if (snippetsPopover) {
      snippetsPopover.querySelectorAll("[data-snippet]").forEach(btn => {
        btn.onclick = async () => {
          const kind = btn.dataset.snippet;
          try {
            const snippets = await api.byok("getSnippets", { providerId: getSelectedProvider()?.id });
            const text = kind === "endpoint"
              ? ((data?.byok?.endpoint || "http://127.0.0.1:3920") + "/v1")
              : (snippets?.[kind] || "");
            if (text) {
              await navigator.clipboard.writeText(text);
              $("saved").textContent = `已复制「${btn.textContent.trim()}」到剪贴板`;
            }
          } catch (err) {
            $("saved").textContent = err?.message || "复制接入配置失败";
          } finally {
            try { snippetsPopover.hidePopover?.(); } catch {}
          }
        };
      });
    }

    // 网关进阶配置开关 (Switch read .checked on change)
    const bindGatewaySwitch = (id, key, onLabel, offLabel) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("change", async () => {
        try {
          data.byok = await api.byok("updateGatewayConfig", { [key]: el.checked });
          renderByokPanel();
          $("saved").textContent = el.checked ? onLabel : offLabel;
        } catch (err) {
          $("saved").textContent = err?.message || "更新网关配置失败";
          renderByokPanel();
        }
      });
    };
    bindGatewaySwitch("byok-cfg-mcp", "mcpBridgeEnabled", "已注册 Antigravity MCP 会诊桥插件（重载宿主窗口即可调用）", "已移除 Antigravity MCP 会诊桥插件");
    bindGatewaySwitch("byok-cfg-portal", "hostPortalEnabled", "已开启反重力设置页只读传送门", "已关闭反重力设置页传送门");
    bindGatewaySwitch("byok-cfg-failover", "failoverEnabled", "已开启上游 429/5xx 自动容灾回退", "已关闭自动容灾回退");
    bindGatewaySwitch("byok-cfg-token", "gatewayTokenEnabled", "已启用本机网关专属安全口令", "已停用本机网关专属口令");

    if ($("byok-copy-gw-token")) {
      $("byok-copy-gw-token").onclick = async () => {
        try {
          const res = await api.byok("revealGatewayToken");
          if (res?.gatewayToken) {
            await navigator.clipboard.writeText(res.gatewayToken);
            $("saved").textContent = "已复制网关专属 Bearer 口令";
          }
        } catch (err) {
          $("saved").textContent = err?.message || "读取网关口令失败";
        }
      };
    }

    if ($("byok-regen-gw-token")) {
      $("byok-regen-gw-token").onclick = async () => {
        try {
          data.byok = await api.byok("updateGatewayConfig", { gatewayTokenEnabled: true, regenerateToken: true });
          renderByokPanel();
          const res = await api.byok("revealGatewayToken");
          if (res?.gatewayToken) await navigator.clipboard.writeText(res.gatewayToken);
          $("saved").textContent = "已轮换网关专属口令并复制到剪贴板";
        } catch (err) {
          $("saved").textContent = err?.message || "轮换网关口令失败";
        }
      };
    }

    // 一键探测本地 Ollama
    if ($("byok-discover-ollama-btn")) {
      $("byok-discover-ollama-btn").onclick = async () => {
        const btn = $("byok-discover-ollama-btn");
        btn.disabled = true;
        $("saved").textContent = "正在扫描本地 127.0.0.1:11434 Ollama 实例…";
        try {
          const res = await api.byok("discoverOllama");
          if (res?.snapshot) data.byok = res.snapshot;
          if (res?.ok) {
            selectedProviderId = "ollama";
            renderByokPanel();
            $("saved").textContent = res.total
              ? `🦙 已连接本地 Ollama：同步 ${res.total} 个模型（新增 ${res.added} 个）`
              : "🦙 本地 Ollama 在线，但尚未拉取任何模型（可执行 ollama pull）";
          } else {
            $("saved").textContent = `未检测到运行中的本地 Ollama（${res?.error || "127.0.0.1:11434 未响应"}）`;
          }
        } catch (err) {
          $("saved").textContent = err?.message || "探测 Ollama 失败";
        } finally {
          btn.disabled = false;
        }
      };
    }

    // 扫描并确认导入本机环境变量 API Key
    const envDlg = $("byok-env-dialog");
    const envListEl = $("byok-env-list");
    if ($("byok-scan-env-btn") && envDlg && envListEl) {
      $("byok-scan-env-btn").onclick = async () => {
        try {
          const res = await api.byok("scanEnvKeys");
          const found = res?.found || [];
          if (!found.length) {
            $("saved").textContent = "未在本机环境变量中检测到 DeepSeek / Anthropic / OpenAI / OpenRouter / SiliconFlow 密钥";
            return;
          }
          envListEl.innerHTML = "";
          for (const item of found) {
            const row = document.createElement("label");
            row.className = "byok-env-item";
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.setAttribute("switch", "");
            cb.value = item.providerId;
            cb.checked = !item.alreadyConfigured;
            const info = document.createElement("span");
            info.className = "byok-env-info";
            const title = document.createElement("b");
            title.textContent = `${item.providerName || item.name} (${item.envVar || item.envName})`;
            const sub = document.createElement("small");
            sub.textContent = `${item.maskedKey || item.masked}${item.alreadyConfigured ? " · 本地已有密钥（勾选将覆盖）" : " · 本地未配置"}`;
            info.append(title, sub);
            row.append(info, cb);
            envListEl.appendChild(row);
          }
          envDlg.returnValue = "";
          envDlg.showModal();
        } catch (err) {
          $("saved").textContent = err?.message || "扫描环境变量失败";
        }
      };
      envDlg.addEventListener("close", async () => {
        const choice = envDlg.returnValue;
        envDlg.returnValue = "";
        if (choice !== "confirm") return;
        const providerIds = [...envListEl.querySelectorAll('input[type="checkbox"]')].filter(c => c.checked).map(c => c.value);
        if (!providerIds.length) {
          $("saved").textContent = "未选择需要导入的环境变量密钥";
          return;
        }
        try {
          const res = await api.byok("importEnvKeys", { providerIds });
          if (res?.snapshot) data.byok = res.snapshot;
          renderByokPanel();
          const count = typeof res?.imported === "number" ? res.imported : (res?.imported?.length || 0);
          $("saved").textContent = `🔑 已加密导入 ${count} 项环境变量 API Key`;
        } catch (err) {
          $("saved").textContent = err?.message || "导入环境变量失败";
        }
      });
    }

    // 查询真实账户余额 / 额度
    if ($("byok-check-balance-btn")) {
      $("byok-check-balance-btn").onclick = async () => {
        const prov = getSelectedProvider();
        if (!prov) return;
        const btn = $("byok-check-balance-btn");
        btn.disabled = true;
        $("saved").textContent = `正在查询「${prov.name}」账户余额…`;
        try {
          await saveCurrentProvider();
          const res = await api.byok("fetchBalance", { providerId: prov.id });
          if (res?.snapshot) data.byok = res.snapshot;
          renderByokPanel();
          if (res?.balance?.ok) {
            $("saved").textContent = `💰 ${prov.name} 账户余额：${res.balance.formatted}`;
          } else {
            $("saved").textContent = `${prov.name} 暂不支持自动查余或查询失败（${res?.balance?.error || "无公开个人余额接口"}）`;
          }
        } catch (err) {
          $("saved").textContent = err?.message || "查询余额失败";
        } finally {
          btn.disabled = false;
        }
      };
    }

    if ($("byok-prov-enabled")) {
      $("byok-prov-enabled").onchange = () => {
        saveCurrentProvider($("byok-prov-enabled").checked ? "已启用供应商" : "已禁用供应商");
      };
    }

    for (const id of ["byok-prov-name", "byok-protocol", "byok-base-url"]) {
      if ($(id)) $(id).onchange = () => saveCurrentProvider();
    }

    if ($("byok-api-key")) {
      $("byok-api-key").oninput = () => {
        $("byok-api-key").dataset.dirty = "true";
      };
      $("byok-api-key").onkeydown = e => {
        if (e.key === "Enter") {
          e.preventDefault();
          saveCurrentProvider("已加密保存 API Key");
        }
      };
    }

    if ($("byok-save-provider-btn")) {
      $("byok-save-provider-btn").onclick = () => saveCurrentProvider("已加密保存供应商与 API Key");
    }

    if ($("byok-key-eye")) {
      $("byok-key-eye").onclick = async () => {
        await byokSaveChain;
        const prov = getSelectedProvider();
        const keyInput = $("byok-api-key");
        if (!prov || !keyInput) return;
        if (!keyRevealed) {
          keyRevealed = true;
          keyInput.type = "text";
          $("byok-key-eye").textContent = "🙈";
          if (keyInput.dataset.dirty !== "true" && prov.hasApiKey) {
            try {
              const res = await api.byok("revealKey", { providerId: prov.id });
              keyInput.value = res?.apiKey || "";
            } catch {}
          }
        } else {
          keyRevealed = false;
          keyInput.type = "password";
          if (keyInput.dataset.dirty !== "true") keyInput.value = "";
          $("byok-key-eye").textContent = "👁️";
          renderByokPanel();
        }
      };
    }

    if ($("byok-delete-provider-btn")) {
      $("byok-delete-provider-btn").onclick = async () => {
        const prov = getSelectedProvider();
        if (!prov) return;
        try {
          data.byok = await api.byok("deleteProvider", { providerId: prov.id });
          selectedProviderId = data.byok.activeProviderId || data.byok.providers?.[0]?.id || "";
          renderByokPanel();
          $("saved").textContent = `已移除供应商「${prov.name}」`;
        } catch (err) {
          $("saved").textContent = err?.message || "移除失败";
        }
      };
    }

    if ($("byok-refresh-all-btn")) {
      $("byok-refresh-all-btn").onclick = async () => {
        const enabled = (data?.byok?.providers || []).filter(p => p.enabled);
        if (!enabled.length) {
          $("saved").textContent = "尚未启用任何供应商";
          return;
        }
        $("saved").textContent = `正在批量检测 ${enabled.length} 个已启用供应商并同步余额…`;
        for (const p of enabled) {
          await triggerModelPing(p.id, p.models.find(m => m.enabled)?.id || null);
          try {
            const balRes = await api.byok("fetchBalance", { providerId: p.id });
            if (balRes?.snapshot) data.byok = balRes.snapshot;
          } catch {}
        }
        renderByokPanel();
      };
    }

    if ($("byok-fetch-models-btn")) {
      $("byok-fetch-models-btn").onclick = async () => {
        const prov = getSelectedProvider();
        if (!prov) return;
        const btn = $("byok-fetch-models-btn");
        btn.disabled = true;
        btn.textContent = "⏳ 拉取中…";
        $("saved").textContent = `正在从 ${prov.baseUrl}/v1/models 拉取模型列表…`;
        try {
          await saveCurrentProvider();
          const res = await api.byok("fetchModels", { providerId: prov.id });
          if (res?.snapshot) data.byok = res.snapshot;
          renderByokPanel();
          $("saved").textContent = `拉取完成：新增 ${res.added} 个模型（共 ${res.total} 个，延迟 ${res.pingMs} ms）`;
        } catch (err) {
          $("saved").textContent = err?.message || "拉取模型列表失败";
        } finally {
          btn.disabled = false;
          btn.textContent = "📥 从 /v1/models 拉取";
        }
      };
    }

    // 添加供应商模态框
    const provDlg = $("byok-provider-dialog");
    const tplSelect = $("dlg-prov-template");
    if (tplSelect) {
      tplSelect.onchange = () => {
        const val = tplSelect.value;
        const preset = (data?.byok?.presets || []).find(p => p.id === val);
        if (preset) {
          $("dlg-prov-name").value = preset.name;
          $("dlg-prov-url").value = preset.baseUrl;
          $("dlg-prov-protocol").value = preset.protocol;
        } else {
          $("dlg-prov-name").value = "";
          $("dlg-prov-url").value = "";
          $("dlg-prov-protocol").value = "openai";
        }
      };
    }
    if ($("byok-add-provider-btn") && provDlg) {
      $("byok-add-provider-btn").onclick = () => {
        tplSelect.value = "custom";
        $("dlg-prov-name").value = "";
        $("dlg-prov-url").value = "";
        $("dlg-prov-protocol").value = "openai";
        $("dlg-prov-key").value = "";
        provDlg.returnValue = "";
        provDlg.showModal();
      };
      provDlg.addEventListener("close", async () => {
        const choice = provDlg.returnValue;
        provDlg.returnValue = "";
        if (choice !== "confirm") return;
        const tpl = tplSelect.value;
        const name = $("dlg-prov-name").value.trim();
        const baseUrl = $("dlg-prov-url").value.trim();
        const protocol = $("dlg-prov-protocol").value;
        const apiKey = $("dlg-prov-key").value.trim();
        if (!baseUrl) {
          $("saved").textContent = "请填写有效的 Base URL";
          return;
        }
        const id = tpl !== "custom" && !(data.byok.providers || []).some(p => p.id === tpl)
          ? tpl
          : `custom-${Date.now().toString(36)}`;
        try {
          data.byok = await api.byok("upsertProvider", {
            id,
            name: name || id,
            enabled: true,
            baseUrl,
            protocol,
            apiKey,
            setActive: true
          });
          selectedProviderId = id;
          renderByokPanel();
          $("saved").textContent = `已添加供应商「${name || id}」`;
        } catch (err) {
          $("saved").textContent = err?.message || "添加供应商失败";
        }
      });
    }

    // 添加 / 编辑模型模态框
    const modelDlg = $("byok-model-dialog");
    if ($("byok-add-model-btn") && modelDlg) {
      $("byok-add-model-btn").onclick = () => {
        const prov = getSelectedProvider();
        if (prov) openModelDialog(prov.id, null);
      };
      modelDlg.addEventListener("close", async () => {
        const choice = modelDlg.returnValue;
        modelDlg.returnValue = "";
        if (choice !== "confirm") return;
        const prov = getSelectedProvider();
        const modelId = $("dlg-model-id").value.trim();
        if (!prov || !modelId) {
          $("saved").textContent = "模型标识不能为空";
          return;
        }
        const tags = [];
        if ($("dlg-tag-vision").checked) tags.push("视觉");
        if ($("dlg-tag-reason").checked) tags.push("推理");
        if ($("dlg-tag-tools").checked) tags.push("工具");
        try {
          data.byok = await api.byok("upsertModel", {
            providerId: prov.id,
            previousModelId: editingModelOriginalId,
            model: {
              id: modelId,
              name: modelId,
              contextLength: $("dlg-model-ctx").value,
              tags,
              enabled: true
            }
          });
          renderByokPanel();
          $("saved").textContent = `已保存模型 ${modelId}`;
        } catch (err) {
          $("saved").textContent = err?.message || "保存模型失败";
        }
      });
    }
  }

/* @byok-dev-end */
  // 1 小时 (1..60m) 真实比例磁吸阻尼曲线：靠近刻度点平滑产生吸附阻力，松手精准归位整数分钟
  const MAJOR_STOPS = [1, 5, 10, 15, 30, 45, 60];
  const MINOR_STOPS = [3, 20, 25, 35, 40, 50, 55];

  function magneticDamp(raw) {
    for (const stop of MAJOR_STOPS) {
      const diff = raw - stop;
      const ad = Math.abs(diff);
      if (ad <= 1.55) {
        if (ad <= 0.65) return { visual: stop, committed: stop };
        const t = (ad - 0.65) / 0.9; // 0..1
        const eased = stop + Math.sign(diff) * Math.pow(t, 2.2) * 1.55;
        return { visual: eased, committed: Math.round(eased) };
      }
    }
    for (const stop of MINOR_STOPS) {
      if (Math.abs(raw - stop) <= 0.45) {
        return { visual: stop, committed: stop };
      }
    }
    const clamped = Math.max(1, Math.min(60, raw));
    return { visual: clamped, committed: Math.round(clamped) };
  }

  function formatIntervalLabel(minutes) {
    const m = Math.max(1, Math.min(60, Math.round(minutes)));
    return m === 60 ? "1 小时 (60 分钟)" : `${m} 分钟`;
  }

  function syncIntervalSliderVisual(visualVal, committedVal) {
    const slider = $("slideshow-interval");
    if (!slider) return;
    const pct = Math.max(0, Math.min(100, ((visualVal - 1) / 59) * 100));
    slider.style.setProperty("--slider-pct", `${pct.toFixed(2)}%`);
    if ($("slideshow-interval-value")) {
      $("slideshow-interval-value").textContent = formatIntervalLabel(committedVal);
    }
    document.querySelectorAll(".ruler-tick[data-val]").forEach(btn => {
      btn.classList.toggle("active", Number(btn.dataset.val) === committedVal);
    });
  }

  function render() {
    mountOptionalSettings();

    // 渲染常规表单控件
    for (const key of keys) {
      const el = $(key);
      if (el && appearanceKeys.includes(key)) {
        el.checked = savingAppearance.get(key)?.value ?? data.settings[key] !== false;
        continue;
      }
      if (el && (document.activeElement !== el || el.type === "range" && !settingDrafts.has(key))) {
        if (el.type === "checkbox") el.checked = data.settings[key];
        else el.value = settingDrafts.get(key)?.value ?? (key === "volume" ? Math.round(data.settings.volume * 100) : data.settings[key]);
      }
    }
    $("scale-value").textContent = (settingDrafts.get("scale")?.value ?? data.settings.scale) + " px";
    $("volume-value").textContent = (settingDrafts.get("volume")?.value ?? Math.round(data.settings.volume * 100)) + "%";
    $("source").textContent = (data.source.online ? "已找到 " + data.source.files + " 份日志" : "未检测到会话日志") + " · 本机只读";
    $("audio-note").textContent = data.settings.sound ? "已启用" : "已静音";

    const honorificMode = data.settings.userHonorificMode || "none";
    if ($("userHonorificMode") && document.activeElement !== $("userHonorificMode")) {
      $("userHonorificMode").value = honorificMode;
    }
    if ($("customHonorific")) {
      $("customHonorific").style.display = honorificMode === "custom" ? "inline-block" : "none";
      if (document.activeElement !== $("customHonorific")) {
        $("customHonorific").value = data.settings.customHonorific || "";
      }
    }

    // 渲染 Dream Skin 轮播与调节
    if (data.dreamSkin) {
      const ds = data.dreamSkin;
      if (document.activeElement !== $("slideshow-enabled")) $("slideshow-enabled").checked = ds.slideshow !== false;
      const savedMinutes = Math.max(1, Math.min(60, Math.round(Number(ds.slideshowIntervalMinutes) || 5)));
      if (document.activeElement !== $("slideshow-interval")) {
        $("slideshow-interval").value = savedMinutes;
        syncIntervalSliderVisual(savedMinutes, savedMinutes);
      } else {
        syncIntervalSliderVisual(Number($("slideshow-interval").value) || savedMinutes, savedMinutes);
      }
      setControlValue("dream-opacity", dreamValue("opacity",22));
      $("dream-opacity-value").textContent = $("dream-opacity").value + "%";
      setControlValue("dream-scrim", dreamValue("scrim",25));
      $("dream-scrim-value").textContent = $("dream-scrim").value + "%";
      if (document.activeElement !== $("dream-output-mode")) $("dream-output-mode").checked = ds.outputMode === "glass";
      if (document.activeElement !== $("uiLanguage")) $("uiLanguage").value = ds.uiLanguage || "en";
      if ($("dream-enabled") && document.activeElement !== $("dream-enabled")) $("dream-enabled").checked = ds.enabled === true;
      if ($("dream-transition") && document.activeElement !== $("dream-transition")) $("dream-transition").value = ds.transition === "none" ? "none" : "fade";
      const currentTheme = ds.themePreset || "violet";
      document.querySelectorAll(".theme-card[data-theme]").forEach(card => card.classList.toggle("active", card.dataset.theme === currentTheme));
      if (!atelierDirty) {
        atelierPalette = currentTheme;
        setControlValue("atelier-opacity", Math.round(dreamValue("opacity",88)));
      }
      const tint = dreamValue("chatTint", "");
      atelierChatTint = /^#[0-9a-f]{6}$/i.test(tint) ? tint : "#181224";
      setControlValue("atelier-chat-tint",atelierChatTint);
      setControlValue("atelier-chat-opacity",Math.round(dreamValue("chatOpacity",100)));
      setControlValue("atelier-reply-opacity",Math.round(dreamValue("replyOpacity",ds.outputMode === "glass" ? 22 : 0)));
      atelierPaint();
      renderAtelier();
    }

    renderDualCompanionStatus();
    renderCharacterGallery();
    renderWallpaperGallery();
    if (typeof renderByokPanel === "function") renderByokPanel();
  }

  function stop() {
    generation++;
    active?.pause();
    active = null;
  }

  for (const key of keys) {
    const el = $(key);
    if (el) {
      if (el.type === "range") {
        const preview = () => {
          settingDrafts.set(key,{value:Number(el.value),queued:false});
          const label = $(key + "-value");
          if (label) label.textContent = el.value + (key === "scale" ? " px" : key === "volume" ? "%" : "");
        };
        const commit = () => {
          const entry = settingDrafts.get(key);
          if (!entry || entry.queued) return;
          entry.queued = true;
          save({[key]:key === "volume" ? entry.value/100 : entry.value}).then(() => {
            if (settingDrafts.get(key) === entry) { settingDrafts.delete(key); queueRender(); }
          });
        };
        el.addEventListener("input",preview);
        el.addEventListener("change",() => { if (!settingDrafts.has(key)) preview(); commit(); });
        el.addEventListener("blur",commit);
        continue;
      }
      el.addEventListener("change", () => {
        const v = el.type === "checkbox" ? el.checked : (el.type === "range" || el.type === "number" || key === "turnCostDurationMs") ? (el.value === "" ? null : Number(el.value)) : el.value;
        if (key === "userHonorificMode" && $("customHonorific")) {
          const isCustom = v === "custom";
          $("customHonorific").style.display = isCustom ? "inline-block" : "none";
          if (isCustom) $("customHonorific").focus();
        }
        const saved = save({ [key]: key === "volume" ? v / 100 : v });
        if (key === "autoUpdateCheck") void saved.then(() => onlinePanel?.refresh(false));
      });
    }
  }

  if ($("customHonorific")) {
    const saveCustom = () => {
      const val = $("customHonorific").value.trim();
      if (val !== data.settings.customHonorific) {
        save({ customHonorific: val });
      }
    };
    $("customHonorific").addEventListener("change", saveCustom);
    $("customHonorific").addEventListener("blur", saveCustom);
    $("customHonorific").addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveCustom();
        $("customHonorific").blur();
      }
    });
  }

  // 资源目录入口
  if ($("open-character-dir")) $("open-character-dir").onclick = () => api.command("open-character-dir");
  for (const [id, command] of [["project-repo", "open-project-repo"], ["upstream-repo", "open-upstream-repo"]]) {
    $(id).onclick = event => { event.preventDefault(); api.command(command); };
  }
  if ($("open-wallpaper-dir")) $("open-wallpaper-dir").onclick = () => api.command("open-wallpaper-dir");
  if ($("next-wallpaper")) $("next-wallpaper").onclick = async () => { await api.command("next-wallpaper"); $("saved").textContent = "已切换至下一张壁纸～"; };

  // 轮播与 1h 真实比例磁吸滑块绑定
  $("slideshow-enabled").onchange = () => save({ dreamSkin: { slideshow: $("slideshow-enabled").checked } });

  let lastSavedInterval = Number(data?.dreamSkin?.slideshowIntervalMinutes) || 5;
  $("slideshow-interval").oninput = () => {
    const raw = Number($("slideshow-interval").value);
    const { visual, committed } = magneticDamp(raw);
    $("slideshow-interval").value = visual;
    syncIntervalSliderVisual(visual, committed);
    if (committed !== lastSavedInterval) {
      lastSavedInterval = committed;
      save({ dreamSkin: { slideshowIntervalMinutes: committed } }, `轮播间隔已设为 ${formatIntervalLabel(committed)}`);
    }
  };

  $("slideshow-interval").onchange = () => {
    const raw = Number($("slideshow-interval").value);
    const { committed } = magneticDamp(raw);
    $("slideshow-interval").value = committed;
    syncIntervalSliderVisual(committed, committed);
    lastSavedInterval = committed;
    save({ dreamSkin: { slideshowIntervalMinutes: committed } }, `轮播间隔已设为 ${formatIntervalLabel(committed)}`);
  };

  document.querySelectorAll(".ruler-tick[data-val]").forEach(btn => {
    btn.onclick = () => {
      const val = Number(btn.getAttribute("data-val"));
      $("slideshow-interval").value = val;
      lastSavedInterval = val;
      syncIntervalSliderVisual(val, val);
      save({ dreamSkin: { slideshowIntervalMinutes: val } }, `轮播间隔已设为 ${formatIntervalLabel(val)}`);
    };
  });

  bindDreamAdjustment("dream-opacity","opacity",value => { $("dream-opacity-value").textContent=value+"%"; });
  bindDreamAdjustment("dream-scrim","scrim",value => { $("dream-scrim-value").textContent=value+"%"; });

  $("dream-output-mode").onchange = () => {
    save({ dreamSkin: { outputMode: $("dream-output-mode").checked ? "glass" : "transparent" } });
  };

  if ($("uiLanguage")) $("uiLanguage").onchange = () => {
    save({ dreamSkin: { uiLanguage: $("uiLanguage").value } }, "已切换界面语言");
  };

  // 表情预览使用独立的显示时限。
  for (const [id, name] of [["proud", "得意"], ["shy", "害羞"], ["angry", "气恼"], ["nap", "打盹"]]) {
    const button = $("preview-" + id);
    if (button) button.onclick = () => {
      api.command("preview-reaction:" + id);
      $("saved").textContent = "正在预览「" + name + "」";
    };
  }
  if ($("preview-reaction")) $("preview-reaction").onclick = () => api.command("preview-reaction");

  if ($("dream-enabled")) $("dream-enabled").onchange = () => save({ dreamSkin: { enabled: $("dream-enabled").checked } }, $("dream-enabled").checked ? "已应用到 Antigravity" : "已从 Antigravity 还原");
  if ($("dream-transition")) $("dream-transition").onchange = () => save({ dreamSkin: { transition: $("dream-transition").value } }, "已更新切换动画");
  document.querySelectorAll(".theme-card[data-theme]").forEach(card => {
    card.onclick = () => {
      const preset = card.dataset.theme;
      if ((data.dreamSkin?.themePreset || "violet") !== preset) {
        save({ dreamSkin: { themePreset: preset } }, "已切换为「" + (card.dataset.label || preset) + "」主题");
      }
    };
  });

  // 主题工坊：本地配色 + 不透明度组合，实时预览，保存后可反复应用或导出目录 JSON。
  const atelierLabels = {violet:"星轨紫",pink:"梦幻粉",ocean:"深海蓝",onyx:"曜石黑"};
  const atelierSwatchStyles = {violet:"linear-gradient(135deg,#8b68e0,#24193c)",pink:"linear-gradient(135deg,#f59cc6,#3b1830)",
    ocean:"linear-gradient(135deg,#5da9f6,#0f1d35)",onyx:"linear-gradient(135deg,#666c82,#121318)"};
  let atelierPalette = data.dreamSkin?.themePreset || "violet";
  let atelierDirty = false, atelierGridKey = "", atelierSequence = 0;
  let atelierChatTint = /^#[0-9a-f]{6}$/i.test(data.dreamSkin?.chatTint || "") ? data.dreamSkin.chatTint : "#181224";
  function atelierPaint() {
    const atelierOpacity = $("atelier-opacity");
    if (!atelierOpacity) return;
    const value = Number(atelierOpacity.value);
    $("atelier-opacity-value").textContent = value + "%";
    const preview = $("atelier-preview");
    preview.dataset.palette = atelierPalette;
    preview.style.setProperty("--at-opacity", String(value / 100));
    $("atelier-hint").textContent = (atelierLabels[atelierPalette] || atelierPalette) + " · 壁纸不透明度 " + value + "%";
    document.querySelectorAll(".atelier-swatch").forEach(swatch => swatch.classList.toggle("active", swatch.dataset.palette === atelierPalette));
    // User and assistant preview backgrounds have independent alpha.
    const bubbleAlpha = Number($("atelier-chat-opacity").value);
    preview.style.setProperty("--at-chat-rgb", [1,3,5].map(i => parseInt(atelierChatTint.slice(i,i+2),16)).join(","));
    preview.style.setProperty("--at-chat-alpha", String(bubbleAlpha / 100));
    $("atelier-chat-opacity-value").textContent = bubbleAlpha + "%";
    preview.style.setProperty("--at-reply-alpha",String(Number($("atelier-reply-opacity").value)/100));
    $("atelier-reply-opacity-value").textContent = $("atelier-reply-opacity").value + "%";
  }
  function renderAtelier() {
    const grid = $("atelier-grid");
    if (!grid) return;
    const themes = Array.isArray(data.settings.customThemes) ? data.settings.customThemes : [];
    const key = JSON.stringify([themes,data.dreamSkin?.themePreset,data.dreamSkin?.opacity,data.dreamSkin.chatTint,data.dreamSkin.chatOpacity,data.dreamSkin.replyOpacity]);
    if (key === atelierGridKey) return;
    atelierGridKey = key;
    grid.replaceChildren(...themes.map(theme => {
      const wrapper = document.createElement("div");
      wrapper.className = "atelier-card";
      const card = document.createElement("button");
      card.type = "button"; card.className = "theme-card";
      const active = (data.dreamSkin?.themePreset || "violet") === theme.palette &&
        Math.round(data.dreamSkin?.opacity ?? -1) === Math.round(theme.opacity) &&
        (typeof theme.replyOpacity !== "number" || data.dreamSkin.replyOpacity === theme.replyOpacity) &&
        (typeof theme.chatOpacity !== "number" ||
          data.dreamSkin.chatOpacity === theme.chatOpacity && (data.dreamSkin.chatTint || "") === (theme.chatTint || ""));
      if (active) card.classList.add("active");
      const swatch = document.createElement("i");
      swatch.style.background = atelierSwatchStyles[theme.palette] || "";
      const name = document.createElement("b"); name.textContent = theme.name;
      const meta = document.createElement("small");
      meta.textContent = (atelierLabels[theme.palette] || theme.palette) + " · 不透明度 " + Math.round(theme.opacity) + "%" + (active ? " · 使用中" : "");
      card.append(swatch,name,meta);
      card.onclick = () => {
        atelierDirty = false;
        const patch = { dreamSkin: { themePreset: theme.palette, opacity: Math.round(theme.opacity) } };
        // 旧主题没有气泡参数时不覆盖当前气泡外观。
        if (typeof theme.chatOpacity === "number") {
          patch.dreamSkin.chatTint = theme.chatTint || "";
          patch.dreamSkin.chatOpacity = Math.round(theme.chatOpacity);
        }
        if (typeof theme.replyOpacity === "number") patch.dreamSkin.replyOpacity = theme.replyOpacity;
        save(patch, "已应用主题「" + theme.name + "」");
      };
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "atelier-remove"; remove.textContent = "×";
      remove.setAttribute("aria-label","删除主题 " + theme.name);
      remove.onclick = event => {
        event.stopPropagation();
        save(() => ({ customThemes: (data.settings.customThemes || []).filter(t => t.id !== theme.id) }), "已删除主题「" + theme.name + "」");
      };
      wrapper.append(card,remove);
      return wrapper;
    }));
  }
  $("atelier-opacity").addEventListener("input", () => { atelierDirty = true; atelierPaint(); });
  document.querySelectorAll(".atelier-swatch").forEach(swatch => {
    swatch.onclick = () => { atelierDirty = true; atelierPalette = swatch.dataset.palette; atelierPaint(); };
  });
  // 对话阅读面外观：通过皮肤设置更新宿主，旧桌宠外观字段保留但不再由此控件读写。
  $("atelier-chat-tint").value = atelierChatTint;
  bindDreamAdjustment("atelier-chat-tint","chatTint",value => { atelierChatTint=value; atelierPaint(); },"对话气泡颜色已更新",String);
  bindDreamAdjustment("atelier-chat-opacity","chatOpacity",atelierPaint,"对话气泡透明度已更新");
  bindDreamAdjustment("atelier-reply-opacity","replyOpacity",atelierPaint,"AI 回复透明度已更新");
  $("atelier-save").onclick = async () => {
    const value = Number($("atelier-opacity").value);
    const name = ($("atelier-name").value || "").trim() || (atelierLabels[atelierPalette] || atelierPalette) + " · " + value + "%";
    const theme = { id: "local-" + Date.now().toString(36) + "-" + (++atelierSequence), name,
      palette: atelierPalette, opacity: value, chatTint: atelierChatTint,
      chatOpacity: Number($("atelier-chat-opacity").value), replyOpacity:Number($("atelier-reply-opacity").value), updatedAt: new Date().toISOString().slice(0,10) };
    if (await save(() => ({ customThemes: [...(data.settings.customThemes || []),theme].slice(-24) }), "已保存主题「" + name + "」")) {
      $("atelier-name").value = "";
      $("atelier-status").textContent = "";
    }
  };
  $("atelier-export").onclick = async () => {
    const payload = JSON.stringify({ schema: 1, palette: atelierPalette, opacity: Number($("atelier-opacity").value) }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      $("atelier-status").textContent = "已复制目录 JSON，可提交到内容商店收录。";
    } catch {
      $("atelier-status").textContent = "复制失败，请手动复制：" + payload;
    }
  };

  $("undo").onclick = () => { atelierDirty = false; return save(originalDreamSkin ? { ...original, dreamSkin: { ...originalDreamSkin } } : original, "已恢复到打开设置时"); };
  $("dock-left").onclick = () => api.command("dock-left");
  $("dock-right").onclick = () => api.command("dock-right");
  $("reset").onclick = () => api.command("reset");
  $("quota-refresh").onclick = () => api.command("quota-refresh");
  $("refresh").onclick = () => api.command("refresh");

  $("audition").onclick = async () => {
    stop();
    if (!data.settings.sound || !data.settings.volume) {
      $("audio-note").textContent = "请先启用音效并提高音量";
      return;
    }
    const token = generation;
    const first = await api.audio("press");
    if (!first || token !== generation) return;
    active = new Audio(first.url);
    active.volume = first.effectiveVolume;
    active.onended = async () => {
      const p = await api.audio("release");
      if (p && token === generation) {
        active = new Audio(p.url);
        active.volume = p.effectiveVolume;
        active.play().catch(() => {});
      }
    };
    active.play().catch(() => $("audio-note").textContent = "播放未成功");
  };

  const storeSelection = state => JSON.stringify([
    state.settings.characterPack, state.dreamSkin?.themePreset, state.dreamSkin?.onlineThemeId, state.dreamSkin?.opacity,
    state.dreamSkin?.wallpaperId, state.dreamSkin?.wallpaperFile,
    state.characterPacks?.map(pack => pack.id), state.wallpapers?.map(wall => wall.id), state.artVersion
  ]);
  // Position, breath/interaction state and bridge heartbeat timestamps do not
  // change this form. Do not invalidate all cards while they animate/scroll.
  const settingsViewKey = state => JSON.stringify([
    keys.map(key=>state.settings[key]),state.settings.customHonorific,
    state.dreamSkin,state.byok,state.source?.online,state.source?.files,
    state.quotaWindows,state.ledger?.todaySteps,
    state.webCompanion?.online,state.webCompanion?.active,state.webCompanion?.port,state.webCompanion?.quota,
    state.artVersion
  ]);
  function sameAssets(before,after) {
    return ["characterPacks","wallpapers"].every(key=>{
      const a=before[key]||[],b=after[key]||[];
      return a.length===b.length&&a.every((item,i)=>Object.keys(item).length===Object.keys(b[i]).length&&
        Object.keys(item).every(field=>typeof item[field]==="object" ? JSON.stringify(item[field])===JSON.stringify(b[i][field]) : item[field]===b[i][field]));
    });
  }
  api.subscribe(next => {
    if (next.settings.sound !== data.settings.sound || next.settings.volume !== data.settings.volume || next.settings.soundSet !== data.settings.soundSet) stop();
    const refreshStore = contentHub && storeSelection(next) !== storeSelection(data);
    const changed=settingsViewKey(next)!==settingsViewKey(data)||!sameAssets(data,next);
    data = next;
    if(changed)queueRender();
    if (refreshStore) contentHub.render();
  });

  window.addEventListener("beforeunload", stop);
  render();
  async function showReleaseNotes() {
    if (!api.releaseNotes || !api.markReleaseNotesSeen) return;
    try {
      const notes = await api.releaseNotes();
      if (!notes || !Array.isArray(notes.items) || !notes.items.length) return;
      // Let a dialog opened while fetching finish before showing the announcement.
      while (document.querySelector("dialog[open]")) {
        await new Promise(resolve => document.querySelector("dialog[open]").addEventListener("close", resolve, { once: true }));
      }
      const focus = document.activeElement;
      const dialog = document.createElement("dialog");
      dialog.className = "release-notes";
      dialog.setAttribute("aria-labelledby", "release-notes-title");
      const title = document.createElement("h2");
      title.id = "release-notes-title";
      title.textContent = notes.title;
      const list = document.createElement("ul");
      for (const item of notes.items) {
        const li = document.createElement("li");
        li.textContent = item;
        list.append(li);
      }
      const close = document.createElement("button");
      close.className = "btn primary";
      close.textContent = "知道了";
      close.onclick = () => dialog.close();
      dialog.append(title, list, close);
      dialog.addEventListener("close", () => {
        dialog.remove();
        if (focus?.isConnected) focus.focus({ preventScroll: true });
      }, { once: true });
      document.body.append(dialog);
      dialog.showModal();
      await api.markReleaseNotesSeen(notes.version);
    } catch (error) { console.warn("Catstella: could not show release notes", error); }
  }
  void showReleaseNotes();
})();
