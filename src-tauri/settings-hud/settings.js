(async function () {
  "use strict";

  const api = window.widgetApi;
  if (!api) return;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  const MODE_KEY = "catstella_hud_mode";
  const SNAP_TICKS = [1, 5, 10, 15, 30, 45, 60];
  const THEME_NAMES = {
    violet: "星语紫",
    pink: "霓音粉",
    ocean: "晴空蓝",
    onyx: "夜幕黑"
  };

  let data = await api.get();
  if (!data) return;

  const baseline = {
    settings: JSON.parse(JSON.stringify(data.settings || {})),
    dreamSkin: JSON.parse(JSON.stringify(data.dreamSkin || {}))
  };

  let startup = { supported: false, autoStart: false, hostLink: false, watcherRegistered: false };
  let catalogItems = [];
  let catalogOffline = true;
  let newCatalogIds = new Set();
  let storeNoticeDismissed = false;
  let updateNotice = null;
  let themePreviewCache = new Map();
  let hdPreviewCache = new Map();
  let hdPreviewPending = new Set();
  let activePage = "pet";
  let activeStoreCat = "all";
  let activeDlgEntry = null;
  let activeDlgIndex = 0;
  let immEntry = null;
  let immIndex = 0;
  let immChatVisible = true;
  let immCompareCurrent = false;
  let immCustomOp = null;
  let immCustomScrim = null;
  let storeGridSignature = null;
  let storeHeroSignature = null;
  let faceTimer = 0;

  try {
    const savedMode = localStorage.getItem(MODE_KEY);
    if (savedMode === "dark" || savedMode === "light") {
      document.documentElement.dataset.mode = savedMode;
    }
  } catch {}

  function say(txt) {
    if ($("#dockTxt") && txt) $("#dockTxt").textContent = txt;
  }

  function normalizePage(raw) {
    const p = String(raw || "").replace(/^#/, "").trim();
    if (p === "skin" || p === "wallpaper") return "skin";
    if (p === "quota" || p === "byok" || p === "models") return "quota";
    if (p === "link" || p === "agy" || p === "about") return "link";
    if (p === "store") return "store";
    return "pet";
  }

  function showPage(rawPage, { renderPage = true } = {}) {
    const p = normalizePage(rawPage);
    activePage = p;
    $$("#side-nav .tab").forEach((t) => {
      const on = t.dataset.p === p;
      t.classList.toggle("on", on);
      if (on) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
    $$(".page").forEach((pg) => pg.classList.toggle("on", pg.dataset.p === p));
    if ($("#main-scroll")) $("#main-scroll").scrollTop = 0;
    if (renderPage) renderActivePage(p);
  }

  function initSwitchFallback() {
    const native = "switch" in HTMLInputElement.prototype;
    $$('input[type="checkbox"][switch]').forEach((el) => {
      if (!native) {
        el.setAttribute("role", "switch");
        el.setAttribute("aria-checked", String(el.checked));
      }
      el.addEventListener("change", () => {
        if (!native) el.setAttribute("aria-checked", String(el.checked));
      });
    });
  }

  function syncSwitchState(el, checked) {
    if (!el) return;
    el.checked = Boolean(checked);
    if (!("switch" in HTMLInputElement.prototype)) {
      el.setAttribute("aria-checked", String(el.checked));
    }
  }

  function attachDialogLightDismiss(dlg) {
    if (!dlg || "closedBy" in HTMLDialogElement.prototype) return;
    let out = false;
    dlg.addEventListener("pointerdown", (e) => {
      if (e.target !== dlg) { out = false; return; }
      const r = dlg.getBoundingClientRect();
      out = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    });
    dlg.addEventListener("pointerup", (e) => {
      if (!out || e.target !== dlg) return;
      out = false;
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    });
  }

  function selectedWallpaper() {
    const walls = data?.wallpapers || [];
    const ds = data?.dreamSkin || {};
    const norm = (v) => String(v || "").replace(/\\/g, "/").toLowerCase();
    const curFile = norm(ds.wallpaperFile);
    return (
      walls.find((w) => w.id === ds.wallpaperId) ||
      (curFile && walls.find((w) => norm(w.filePath) === curFile)) ||
      walls[0] ||
      null
    );
  }

  function resolveHonorific() {
    const s = data?.settings || {};
    if (s.userHonorificMode === "custom") return String(s.customHonorific || "").trim() || "人类";
    return "人类";
  }

  // Reuse the live gauge geometry, palette, unknown state and fill direction.
  function renderStamina(mount, pct5, pct1, variant, orch, scale = 1) {
    const s = data?.settings || {};
    mount.style.setProperty("--gauge-scale", String(scale));
    window.CatstellaSideQuota.applyGaugeAppearance(mount, {
      themePreset: data?.dreamSkin?.themePreset || "violet",
      palette: s.sideQuotaPalette || "theme",
      color: s.sideQuotaColor || "",
      style: s.sideQuotaStyle || "glass",
      opacity: s.sideQuotaOpacity ?? 100
    });
    window.CatstellaSideQuota.updateGaugeMount(mount, variant, mount.id, {
      fiveHour: pct5, weekly: pct1, ghost5h: pct5,
      quotaMode: s.sideQuotaMode === "used" ? "used" : "remaining",
      side: "left", orchestrator: orch, draining: false, surging: false
    });
  }

  function resolveQuotaPair() {
    const s = data?.settings || {};
    const q = data?.quotaWindows || {};
    const gData = q.gemini || q;
    const wq = data?.webCompanion?.quota || null;
    const manual = s.manualQuota === true;

    const agy5 = manual ? Number(s.manualPercent) : gData?.fiveHour;
    const agy1 = manual ? Number(s.manualWeeklyPercent) : gData?.weekly;
    const web5 = wq && typeof wq.fiveHourUsedPct === "number" ? Math.max(0, 100 - wq.fiveHourUsedPct) : null;
    const web1 = wq && typeof wq.weeklyUsedPct === "number" ? Math.max(0, 100 - wq.weeklyUsedPct) : null;

    const metrics = window.CatstellaSideQuota.resolveSideQuotaMetrics(data);
    return {
      agy5, agy1, web5, web1,
      raw5: metrics.fiveHour, raw1: metrics.weekly,
      isOrch: metrics.orchestrator,
      modelLabel: metrics.modelLabel,
      cg5: q.claudeGpt?.fiveHour,
      cg1: q.claudeGpt?.weekly,
      g5Reset: gData?.fiveHourReset || "",
      g1Reset: gData?.weeklyReset || "",
      cg5Reset: q.claudeGpt?.fiveHourReset || "",
      cg1Reset: q.claudeGpt?.weeklyReset || ""
    };
  }

  let previewPlayer = null;
  let previewRequest = 0;

  function stopPreview() {
    previewRequest++;
    previewPlayer?.pause();
    previewPlayer = null;
  }

  async function previewAudio(force = false) {
    stopPreview();
    const request = previewRequest;
    if (!force && !data.settings?.sound) return;
    if (force && Number(data.settings?.volume ?? 0.35) <= 0) {
      say("当前音量为 0%，调高音量后再试听");
      return;
    }
    try {
      const clip = await api.audio("release", force);
      if (request !== previewRequest || !clip?.url || !clip.effectiveVolume) return;
      const player = new Audio(clip.url);
      previewPlayer = player;
      player.volume = clip.effectiveVolume;
      await player.play();
      if (request === previewRequest && force && !data.settings?.sound) {
        say("试听采样（互动音效开关当前关闭）");
      }
    } catch (error) {
      if (request === previewRequest) say("试听失败：" + (error?.message || error));
    }
  }

  window.addEventListener("pagehide", stopPreview);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPreview();
  });

  async function save(patch, notice) {
    try {
      const updated = await api.save(patch);
      if (updated) {
        data = updated;
        render();
        if (notice) say(notice);
      }
      return updated;
    } catch (e) {
      say("保存失败: " + (e?.message || e));
      return null;
    }
  }

  function syncSliderVisual(el, fmt) {
    if (!el) return;
    const min = Number(el.min || 0);
    const max = Number(el.max || 100);
    const val = Number(el.value || 0);
    const p = ((val - min) / Math.max(0.0001, max - min)) * 100;
    el.style.setProperty("--p", p + "%");
    const flt = $("#" + el.id + "F");
    if (flt) {
      flt.style.left = `calc(${p}% + ${(50 - p) * 0.08}px)`;
      flt.textContent = fmt(val);
    }
  }

  function setGroupActive(groupName, val) {
    const g = $(`.pillrow[data-group="${groupName}"]`);
    if (!g) return;
    g.querySelectorAll(".pill").forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.val === String(val));
    });
  }

  function renderHudAndHeader() {
    const s = data.settings || {};
    const ds = data.dreamSkin || {};
    const packs = data.characterPacks || [];
    const activePack = packs.find((p) => p.id === s.characterPack) || packs[0];
    const isPink = activePack?.id === "lin-cat";
    document.documentElement.dataset.skin = isPink ? "pink" : "violet";

    const skinShort = isPink ? "粉毛基米" : "紫毛基米";
    if ($("#hudSkinBadge")) $("#hudSkinBadge").textContent = skinShort;
    if ($("#hudThemeBadge")) $("#hudThemeBadge").textContent = THEME_NAMES[ds.themePreset] || "星语紫";

    const wall = selectedWallpaper();
    const bgImg = $("#hudWallBg");
    if (bgImg && wall?.preview) {
      if (bgImg.getAttribute("src") !== wall.preview) bgImg.src = wall.preview;
      const op = Number.isFinite(Number(ds.opacity)) ? Number(ds.opacity) : 22;
      const scrim = Number.isFinite(Number(ds.scrim)) ? Number(ds.scrim) : 25;
      bgImg.style.opacity = ds.enabled === false ? "0" : String(Math.max(0.12, Math.min(0.60, (op / 100) + 0.14)));
      if ($("#hudWallScrim")) {
        $("#hudWallScrim").style.opacity = String(Math.max(0.35, 0.82 - (op / 200) + (scrim / 200)));
      }
    }

    const petImg = $("#hud-pet-img");
    if (petImg && activePack?.preview && petImg.getAttribute("src") !== activePack.preview) {
      petImg.src = activePack.preview;
    }
    const scale = Number(s.scale || 220);
    if ($("#cat")) {
      $("#cat").style.width = `${44 + ((scale - 140) / 220) * 30}%`;
    }

    const qp = resolveQuotaPair();
    const themePreset = ds.themePreset || "violet";
    const sqVariant = s.sideQuotaVariant || "arc";
    const hudSq = $("#hudSq");
    if (hudSq) {
      hudSq.dataset.theme = themePreset;
      hudSq.hidden = s.sideQuotaEnabled === false;
      if (!hudSq.hidden) {
        renderStamina(hudSq, qp.raw5, qp.raw1, sqVariant, qp.isOrch, 1.0);
      }
    }
    const sqPrev = $("#sqPreview");
    if (sqPrev) {
      sqPrev.dataset.theme = themePreset;
      if (s.sideQuotaEnabled === false) sqPrev.textContent = "已隐藏";
      else renderStamina(sqPrev, qp.raw5, qp.raw1, sqVariant, qp.isOrch, 0.95);
    }

    if ($("#bubble")) $("#bubble").hidden = s.bubbleOn === false;
    if ($("#bubbleModel")) $("#bubbleModel").textContent = qp.modelLabel;
    if ($("#steps")) $("#steps").textContent = String(data.settings?.headPatTotal ?? 0).padStart(5, "0");

    const switcher = $("#hud-char-switcher");
    if (switcher) {
      const sig = packs.map((p) => p.id + ":" + p.preview).join("|");
      if (switcher.dataset.sig !== sig) {
        switcher.dataset.sig = sig;
        switcher.innerHTML = packs.map((p) => {
          const shortDesc = p.id === "lin-cat" ? "粉毛基米" : (p.id === "gemini-star-v1" ? "紫毛基米" : "自定义");
          return `<button type="button" class="char" data-c="${esc(p.id)}" aria-pressed="false"><img src="${esc(p.preview)}" alt=""><span><b>${esc(p.name)}</b><small>${esc(shortDesc)}</small></span></button>`;
        }).join("");
        $$("#hud-char-switcher .char").forEach((btn) => {
          btn.onclick = () => {
            if (data.settings.characterPack !== btn.dataset.c) {
              void save({ characterPack: btn.dataset.c }, `已切换为「${btn.querySelector("b")?.textContent || btn.dataset.c}」`);
            }
          };
        });
      }
      $$("#hud-char-switcher .char").forEach((btn) => {
        const on = btn.dataset.c === s.characterPack;
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-pressed", String(on));
      });
    }

    // Header stats
    if ($("#hName")) $("#hName").textContent = activePack?.name || skinShort;
    const fmtPct = (v) => (typeof v === "number" && Number.isFinite(v) ? `${Math.round(v)}<em>%</em>` : "—");
    if ($("#hAgy5")) $("#hAgy5").innerHTML = fmtPct(qp.agy5);
    if ($("#hAgy1")) $("#hAgy1").innerHTML = fmtPct(qp.agy1);
    if ($("#hWeb5")) $("#hWeb5").innerHTML = fmtPct(qp.web5);
    if ($("#hModel")) $("#hModel").textContent = qp.modelLabel;
  }

  function renderPetPage() {
    const s = data.settings || {};
    if ($("#scale") && document.activeElement !== $("#scale")) {
      $("#scale").value = String(s.scale || 220);
      syncSliderVisual($("#scale"), (v) => `${Math.round(v)} px`);
    }
    if ($("#scaleB")) $("#scaleB").textContent = String(s.scale || 220);

    syncSwitchState($("#hostWindowOnly"), s.hostWindowOnly === true);
    syncSwitchState($("#standaloneDesktopMode"), s.standaloneDesktopMode !== false);
    syncSwitchState($("#alwaysOnTop"), s.alwaysOnTop !== false);
    syncSwitchState($("#reducedMotion"), s.reducedMotion === true);
    syncSwitchState($("#clickThrough"), s.clickThrough === true);
    document.documentElement.toggleAttribute("data-reduced-motion", s.reducedMotion === true);

    setGroupActive("hon", s.userHonorificMode || "none");
    if ($("#custom-hon-row")) $("#custom-hon-row").hidden = (s.userHonorificMode || "none") !== "custom";
    if ($("#customHonorific") && document.activeElement !== $("#customHonorific")) {
      $("#customHonorific").value = s.customHonorific || "";
    }
    setGroupActive("click", s.clickCatAction || "talk");
    syncSwitchState($("#easterEggs"), s.easterEggs !== false);

    syncSwitchState($("#bubbleOn"), s.bubbleOn !== false);
    syncSwitchState($("#ambientChatter"), s.ambientChatter === true);
    setGroupActive("dur", String(s.turnCostDurationMs ?? 5000));
    syncSwitchState($("#soundOn"), s.sound === true);
    setGroupActive("snd", s.soundSet || "bubble-pop");

    const volPct = Math.round((Number.isFinite(Number(s.volume)) ? Number(s.volume) : 0.35) * 100);
    if ($("#vol") && document.activeElement !== $("#vol")) {
      $("#vol").value = String(volPct);
      syncSliderVisual($("#vol"), (v) => `${Math.round(v)}%`);
    }
    if ($("#audio-note")) $("#audio-note").textContent = `${s.sound === true ? "已启用" : "已静音"} · ${volPct}%`;
  }

  function renderSkinPage() {
    const s = data.settings || {};
    const ds = data.dreamSkin || {};
    const walls = data.wallpapers || [];
    const curWall = selectedWallpaper();

    if ($("#wallpaper-count")) $("#wallpaper-count").textContent = `${walls.length} 张`;
    syncSwitchState($("#syncWallpaper"), s.syncWallpaper !== false);

    const wallGrid = $("#walls");
    if (wallGrid) {
      const sig = walls.map((w) => `${w.id}:${w.preview || ""}`).join("|");
      if (wallGrid.dataset.sig !== sig) {
        wallGrid.dataset.sig = sig;
        wallGrid.innerHTML = walls.map((w) =>
          `<button type="button" class="wall" data-wid="${esc(w.id)}" data-fp="${encodeURIComponent(w.filePath || "")}" title="${esc(w.title || w.id)}"><img loading="lazy" decoding="async" src="${esc(w.preview || "")}" alt="${esc(w.title || w.id)}"><span>${esc(w.title || w.fileName || w.id)}</span></button>`
        ).join("");
        $$("#walls .wall").forEach((btn) => {
          btn.onclick = () => {
            const fp = decodeURIComponent(btn.dataset.fp || "");
            const id = btn.dataset.wid;
            void save({ dreamSkin: { wallpaperId: id, wallpaperFile: fp } }, `已切换壁纸「${btn.title}」`);
          };
        });
      }
      $$("#walls .wall").forEach((btn) => {
        btn.classList.toggle("on", curWall && btn.dataset.wid === curWall.id);
      });
    }

    const op = Number.isFinite(Number(ds.opacity)) ? Number(ds.opacity) : 55;
    const scrim = Number.isFinite(Number(ds.scrim)) ? Number(ds.scrim) : 12;
    const iv = Number.isFinite(Number(ds.slideshowIntervalMinutes)) ? Number(ds.slideshowIntervalMinutes) : 5;

    if ($("#op") && document.activeElement !== $("#op")) {
      $("#op").value = String(op);
      syncSliderVisual($("#op"), (v) => `${Math.round(v)}%`);
    }
    if ($("#opB")) $("#opB").textContent = String(Math.round(op));
    if ($("#scrim") && document.activeElement !== $("#scrim")) {
      $("#scrim").value = String(scrim);
      syncSliderVisual($("#scrim"), (v) => `${Math.round(v)}%`);
    }
    if ($("#scrimB")) $("#scrimB").textContent = String(Math.round(scrim));
    if ($("#iv") && document.activeElement !== $("#iv")) {
      $("#iv").value = String(iv);
      syncSliderVisual($("#iv"), (v) => (Math.round(v) === 60 ? "1 小时" : `${Math.round(v)} 分钟`));
    }
    $$("#ivTicks button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) === Math.round(iv)));

    syncSwitchState($("#slideshow"), ds.slideshow !== false);
    syncSwitchState($("#glassMode"), ds.outputMode === "glass");
    syncSwitchState($("#dreamEnabled"), ds.enabled === true);

    const palette = ds.themePreset || "violet";
    setGroupActive("theme", palette);

    if ($("#atelier-wall-img") && curWall?.preview) {
      $("#atelier-wall-img").src = curWall.preview;
    }
    const box = $("#atelier-preview");
    const tint = /^#[0-9a-f]{6}$/i.test(ds.chatTint || "") ? ds.chatTint : "#181224";
    const chatOp = Number.isFinite(Number(ds.chatOpacity)) ? Number(ds.chatOpacity) : 88;
    const replyOp = Number.isFinite(Number(ds.replyOpacity)) ? Number(ds.replyOpacity) : (ds.outputMode === "glass" ? 22 : 0);
    if (box) {
      box.dataset.palette = palette;
      box.style.setProperty("--at-op", String(op / 100));
      box.style.setProperty("--at-scrim", String(scrim / 100));
      const rgb = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16)).join(",");
      box.style.setProperty("--at-rgb", rgb);
      box.style.setProperty("--at-chat-op", String(chatOp / 100));
      box.style.setProperty("--at-reply-op", String(replyOp / 100));
    }
    if ($("#chatTint") && document.activeElement !== $("#chatTint")) $("#chatTint").value = tint;
    if ($("#chatOp") && document.activeElement !== $("#chatOp")) {
      $("#chatOp").value = String(chatOp);
      syncSliderVisual($("#chatOp"), (v) => `${Math.round(v)}%`);
    }
    if ($("#replyOp") && document.activeElement !== $("#replyOp")) {
      $("#replyOp").value = String(replyOp);
      syncSliderVisual($("#replyOp"), (v) => `${Math.round(v)}%`);
    }

    const customList = $("#custom-theme-list");
    if (customList) {
      const themes = Array.isArray(s.customThemes) ? s.customThemes : [];
      const ctSig = JSON.stringify(themes.map((t) => [t.id, t.name, t.palette, t.opacity]));
      if (customList.dataset.sig !== ctSig) {
        customList.dataset.sig = ctSig;
        customList.innerHTML = themes.map((t) =>
          `<span class="custom-theme-pill"><button type="button" data-use-ct="${esc(t.id)}">${esc(t.name)}</button><button type="button" data-del-ct="${esc(t.id)}" aria-label="删除">×</button></span>`
        ).join("");
        customList.querySelectorAll("[data-use-ct]").forEach((b) => {
          b.onclick = () => {
            const item = themes.find((t) => t.id === b.dataset.useCt);
            if (!item) return;
            void save({
              bubbleTint: item.bubbleTint || "",
              bubbleOpacity: item.bubbleOpacity ?? 98,
              dreamSkin: {
                themePreset: item.palette || "violet",
                opacity: item.opacity ?? 55,
                chatTint: item.chatTint || "",
                chatOpacity: item.chatOpacity ?? null,
                replyOpacity: item.replyOpacity ?? null
              }
            }, `已应用主题「${item.name}」`);
          };
        });
        customList.querySelectorAll("[data-del-ct]").forEach((b) => {
          b.onclick = () => {
            const next = themes.filter((t) => t.id !== b.dataset.delCt);
            void save({ customThemes: next }, "已删除自定义主题");
          };
        });
      }
    }
  }

  function renderQuotaPage() {
    const s = data.settings || {};
    const qp = resolveQuotaPair();
    const fmt = (v, rst) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return "—";
      const pct = `${Math.round(v)}%`;
      return rst ? `${pct} (${rst})` : pct;
    };

    if ($("#ms-agy5")) $("#ms-agy5").textContent = typeof qp.agy5 === "number" ? `${Math.round(qp.agy5)}%` : "—";
    if ($("#ms-agy1")) $("#ms-agy1").textContent = typeof qp.agy1 === "number" ? `${Math.round(qp.agy1)}%` : "—";
    if ($("#ms-claude5")) $("#ms-claude5").textContent = typeof qp.cg5 === "number" ? `${Math.round(qp.cg5)}%` : "—";
    if ($("#ms-web5")) $("#ms-web5").textContent = typeof qp.web5 === "number" ? `${Math.round(qp.web5)}%` : "—";
    if ($("#ms-steps")) $("#ms-steps").textContent = String(data?.ledger?.todaySteps || 0);

    if ($("#q-gem-5h")) $("#q-gem-5h").textContent = fmt(qp.agy5, qp.g5Reset);
    if ($("#q-gem-1w")) $("#q-gem-1w").textContent = fmt(qp.agy1, qp.g1Reset);
    if ($("#q-cg-5h")) $("#q-cg-5h").textContent = fmt(qp.cg5, qp.cg5Reset);
    if ($("#q-cg-1w")) $("#q-cg-1w").textContent = fmt(qp.cg1, qp.cg1Reset);
    if ($("#q-web-meta")) {
      const wc = data.webCompanion || {};
      $("#q-web-meta").textContent = wc.online
        ? (typeof qp.web5 === "number" ? `在线 · 5h 余 ${Math.round(qp.web5)}%` : "在线已连接")
        : "未连接";
    }
    if ($("#q-today-tokens")) {
      const total = data?.ledger?.todayTokens?.total;
      $("#q-today-tokens").textContent = typeof total === "number" ? total.toLocaleString() : "0";
    }

    syncSwitchState($("#sqOn"), s.sideQuotaEnabled !== false);
    const variant = s.sideQuotaVariant || "arc";
    $$("#sqCards .sq-card").forEach((c) => c.classList.toggle("on", c.dataset.val === variant));
    setGroupActive("sqMode", s.sideQuotaMode || "remaining");
    setGroupActive("sqSrc", s.sideQuotaSource || "auto");
    setGroupActive("sqSize", s.sideQuotaSize || "md");
    setGroupActive("sqDist", s.sideQuotaDistance || "normal");
    setGroupActive("sqStyle", s.sideQuotaStyle || "glass");

    const sqPalette = s.sideQuotaPalette || "theme";
    $$("#sqPalettes .sq-swatch").forEach((sw) => sw.classList.toggle("on", sw.dataset.sqp === sqPalette));
    const sqPick = $(".sq-color-pick");
    if (sqPick) sqPick.classList.toggle("on", sqPalette === "custom");
    if ($("#sqColor") && document.activeElement !== $("#sqColor")) {
      $("#sqColor").value = /^#[0-9a-f]{6}$/i.test(s.sideQuotaColor || "") ? s.sideQuotaColor : "#7a52db";
    }
    const sqOp = Number.isFinite(Number(s.sideQuotaOpacity)) ? Number(s.sideQuotaOpacity) : 100;
    if ($("#sqOpacity") && document.activeElement !== $("#sqOpacity")) {
      $("#sqOpacity").value = String(sqOp);
      syncSliderVisual($("#sqOpacity"), (v) => `${Math.round(v)}%`);
    }
    if ($("#sqOpacityB")) $("#sqOpacityB").textContent = String(Math.round(sqOp));

    syncSwitchState($("#manualQuota"), s.manualQuota === true);
    if ($("#manual5h") && document.activeElement !== $("#manual5h")) $("#manual5h").value = String(s.manualPercent ?? 84);
    if ($("#manual1w") && document.activeElement !== $("#manual1w")) $("#manual1w").value = String(s.manualWeeklyPercent ?? 91);
  }

  function renderLinkPage() {
    const s = data.settings || {};
    const ds = data.dreamSkin || {};
    const diag = data.hostDiagnostic || {};
    const skin = data.skinStatus || {};
    const l10n = data.localizationStatus || {};
    const q = data.quotaWindows || {};

    const connected = Boolean(skin.connected || diag.connected || q.online);
    const cdpDisabled = !connected && (skin.reason === "cdp-disabled" || diag.state === "running-no-cdp" || q.status === "cdp-disabled");

    if ($("#host-status-txt")) {
      if (connected) {
        const portTxt = diag.port ? ` (端口 ${diag.port})` : "";
        const skinTxt = skin.applied ? "皮肤已应用" : (ds.enabled === true ? "等待注入皮肤" : "皮肤未启用");
        const l10nTxt = l10n.applied ? " · 中文汉化在线" : "";
        $("#host-status-txt").textContent = `🟢 已连接${portTxt} · ${skinTxt}${l10nTxt}`;
      } else if (cdpDisabled) {
        $("#host-status-txt").textContent = "⚠️ 检测到 Antigravity 运行但未开调试端口 — 请点击下方“配置快捷方式”并重启 Antigravity";
      } else if (diag.running) {
        $("#host-status-txt").textContent = "🟡 Antigravity 正在启动或未发现目标窗口…";
      } else {
        $("#host-status-txt").textContent = "⚪ 未检测到 Antigravity 运行";
      }
    }

    if ($("#btnCfgShortcut")) {
      $("#btnCfgShortcut").textContent = diag.shortcutsConfigured ? "✓ 快捷方式已配置" : "配置快捷方式";
    }
    setGroupActive("lang", ds.uiLanguage === "zh-CN" ? "zh-CN" : "en");

    syncSwitchState($("#startupHostLink"), startup.hostLink === true);
    syncSwitchState($("#startupAutoStart"), startup.autoStart === true);
    if ($("#startupHostLink")) $("#startupHostLink").disabled = startup.supported === false;
    if ($("#startupAutoStart")) $("#startupAutoStart").disabled = startup.supported === false;

    const wc = data.webCompanion || {};
    if ($("#web-bridge-status")) {
      const pTxt = wc.port ? `127.0.0.1:${wc.port}` : "127.0.0.1";
      $("#web-bridge-status").textContent = wc.online
        ? `${pTxt} · 🟢 ${wc.active ? "浏览器活跃同步中" : "已连接"}`
        : `${pTxt} · ⚪ 监听就绪，打开 Gemini 网页自动联动`;
    }
    syncSwitchState($("#syncCharacter"), s.syncCharacter !== false);
    syncSwitchState($("#syncInteraction"), s.syncInteraction !== false);
    setGroupActive("dm", s.petDisplayMode || "both");

    syncSwitchState($("#autoUpdateCheck"), s.autoUpdateCheck !== false);
  }

  function isStoreItemInstalled(item) {
    if (item.kind === "wallpaper") {
      return (data.wallpapers || []).some((w) => w.id === item.id || w.id === "online-" + item.id);
    }
    if (item.kind === "character") {
      return (data.characterPacks || []).some((p) => p.id === item.id || p.id === "online-" + item.id);
    }
    return false;
  }

  function isStoreItemActive(item) {
    if (item.kind === "wallpaper") {
      const w = selectedWallpaper();
      return Boolean(w && (w.id === item.id || w.id === "online-" + item.id));
    }
    if (item.kind === "character") {
      const cur = data?.settings?.characterPack;
      return Boolean(cur && (cur === item.id || cur === "online-" + item.id));
    }
    if (item.kind === "theme") {
      const ds = data?.dreamSkin || {};
      const map = { "violet-default": "violet", "midnight-blue": "ocean" };
      return map[item.id] ? ds.themePreset === map[item.id] : ds.onlineThemeId === item.id;
    }
    return false;
  }

  function groupStoreEntries(items) {
    const map = new Map();
    for (const item of items) {
      if (!item || !item.id) continue;
      const gid = item.pack?.id || item.id;
      let entry = map.get(gid);
      if (!entry) {
        entry = {
          id: gid,
          kind: item.kind,
          title: item.pack?.name || item.name || gid,
          source: item.pack?.source || "",
          frames: []
        };
        map.set(gid, entry);
      }
      entry.frames.push(item);
    }
    for (const entry of map.values()) {
      entry.frames.sort((a, b) => (a.pack?.position || 0) - (b.pack?.position || 0));
      entry.isPack = entry.frames.length > 1;
      entry.lead = entry.frames[0];
      entry.preview = entry.lead?.preview || "";
      entry.updatedAt = entry.frames.reduce((latest, it) => ((it.updatedAt || "") > latest ? (it.updatedAt || "") : latest), "");
      entry.description = entry.isPack
        ? `系列图包 · 共 ${entry.frames.length} 张壁纸`
        : (entry.lead?.description || "Catstella 扩展内容资产");
      entry.searchText = [
        entry.title,
        ...entry.frames.flatMap((it) => [it.name || "", it.description || "", it.credit || "", it.author || ""])
      ].join(" ").toLowerCase();
    }
    return [...map.values()];
  }

  function getEntryInstallState(entry) {
    const total = entry.frames.length;
    const installedCount = entry.frames.filter((f) => isStoreItemInstalled(f)).length;
    const activeFrame = entry.frames.find((f) => isStoreItemActive(f)) || null;
    const active = Boolean(activeFrame);
    const allInstalled = total > 0 && installedCount === total;
    const partial = entry.isPack && installedCount > 0 && installedCount < total;

    let badgeTxt = "可安装";
    let stateClass = "";
    if (active) {
      badgeTxt = "使用中";
      stateClass = "on";
    } else if (entry.isPack) {
      if (allInstalled) {
        badgeTxt = `已安装 ${total}/${total}`;
        stateClass = "installed";
      } else if (partial) {
        badgeTxt = `已装 ${installedCount}/${total}`;
        stateClass = "partial";
      }
    } else if (allInstalled) {
      badgeTxt = "已安装";
      stateClass = "installed";
    }

    let btnTxt = entry.isPack ? "安装整套" : "安装并应用";
    if (entry.isPack) {
      if (active && allInstalled) btnTxt = "已应用";
      else if (allInstalled) btnTxt = "应用首张";
      else btnTxt = "安装整套";
    } else {
      if (active) btnTxt = "已应用";
      else if (allInstalled) btnTxt = "应用";
    }

    return { installedCount, total, allInstalled, partial, active, activeFrame, badgeTxt, stateClass, btnTxt };
  }

  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function parseCreditInfo(item, entry) {
    const raw = String(item?.credit || entry?.lead?.credit || item?.author || entry?.author || "Catstella").trim();
    const paren = raw.match(/^([^（(]+)[（(]([^）)]+)[）)](.*)$/);
    if (paren) {
      const author = paren[1].replace(/^原作[:：]\s*/, "").trim() || "Catstella";
      const license = [paren[2].trim(), paren[3].trim()].filter(Boolean).join(" · ");
      return { raw, author, short: author, license };
    }
    const author = raw.replace(/^原作[:：]\s*/, "").trim() || "Catstella";
    const parts = raw.split("·").map((x) => x.trim()).filter(Boolean);
    return {
      raw,
      author: parts[0] || author,
      short: parts[0] || author,
      license: parts.length > 1 ? parts.slice(1).join(" · ") : ""
    };
  }

  function resolveThemeSpec(item) {
    if (!item) return { palette: data?.dreamSkin?.themePreset || "violet", opacity: 75, live: false };
    const cached = themePreviewCache.get(item.id);
    if (cached) return { ...cached, live: true };
    if (item.id === "midnight-blue") return { palette: "ocean", opacity: 75, live: false };
    if (item.id === "violet-default") return { palette: "violet", opacity: 88, live: false };
    return { palette: item.palette || "violet", opacity: Number.isFinite(Number(item.opacity)) ? Number(item.opacity) : 75, live: false };
  }

  function ensureThemePreview(item, onLoaded) {
    if (!item || item.kind !== "theme" || themePreviewCache.has(item.id)) return;
    void api.online("preview-theme", item.id).then((res) => {
      if (res?.ok && res.palette) {
        themePreviewCache.set(item.id, {
          palette: res.palette,
          opacity: Number.isFinite(Number(res.opacity)) ? Number(res.opacity) : 75
        });
        onLoaded?.();
      }
    }).catch(() => {});
  }

  function resolveBestWallpaperSrc(item) {
    if (!item) return "";
    const alt = "online-" + item.id;
    const local = (data?.wallpapers || []).find((w) => w.id === item.id || w.id === alt);
    if (local?.preview) return { src: local.preview, badge: "✓ 本地原图", hd: true };
    const cachedUrl = hdPreviewCache.get(item.id);
    if (cachedUrl) return { src: cachedUrl, badge: "✦ HD 原图", hd: true };
    if (hdPreviewPending.has(item.id)) return { src: item.preview || "", badge: "◌ 加载高清…", hd: false };
    return { src: item.preview || "", badge: "缩略图", hd: false };
  }

  function ensureHdPreview(item, onLoaded) {
    if (!item || item.kind !== "wallpaper") return;
    const alt = "online-" + item.id;
    if ((data?.wallpapers || []).some((w) => (w.id === item.id || w.id === alt) && w.preview)) return;
    if (hdPreviewCache.has(item.id) || hdPreviewPending.has(item.id)) return;
    hdPreviewPending.add(item.id);
    void api.online("preview-image", item.id).then((res) => {
      hdPreviewPending.delete(item.id);
      if (res?.ok && res.url) {
        hdPreviewCache.set(item.id, res.url);
      }
      onLoaded?.();
    }).catch(() => {
      hdPreviewPending.delete(item.id);
    });
  }

  function renderNoticeBar() {
    const bar = $("#hudNoticeBar");
    const dismissedVer = String(data?.settings?.dismissedUpdateVersion || "").trim();
    const showUpdate = Boolean(updateNotice?.latest && updateNotice.latest !== dismissedVer);
    const newCount = storeNoticeDismissed ? 0 : newCatalogIds.size;

    if ($("#dot-link")) $("#dot-link").hidden = !showUpdate;
    if ($("#dot-store")) $("#dot-store").hidden = newCatalogIds.size === 0;
    if (!bar) return;

    const sig = JSON.stringify([showUpdate ? updateNotice.latest : "", newCount]);
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;

    const pieces = [];
    if (showUpdate) {
      pieces.push(`
        <div class="hud-notice-item">
          <div><strong>✨ 发现新版本 v${esc(updateNotice.latest)}</strong><span>当前运行 v${esc(updateNotice.current || "")}</span></div>
          <div class="pillrow">
            <button type="button" class="pill on" data-notice-download>前往下载 ↗</button>
            <button type="button" class="pill" data-notice-dismiss-upd>忽略此版</button>
          </div>
        </div>`);
    }
    if (newCount > 0) {
      pieces.push(`
        <div class="hud-notice-item">
          <div><strong>🎁 内容商店上新 ${newCount} 项素材</strong><span>可一键试看与 SHA-256 校验安装</span></div>
          <div class="pillrow">
            <button type="button" class="pill on" data-notice-store>去看看</button>
            <button type="button" class="pill" data-notice-dismiss-store>知道了</button>
          </div>
        </div>`);
    }
    bar.innerHTML = pieces.join("");
    bar.hidden = pieces.length === 0;

    bar.querySelector("[data-notice-download]")?.addEventListener("click", () => {
      void api.online("release");
    });
    bar.querySelector("[data-notice-dismiss-upd]")?.addEventListener("click", () => {
      const ver = updateNotice?.latest;
      updateNotice = null;
      if (ver) void save({ dismissedUpdateVersion: ver }, `已忽略 v${ver} 提醒`);
      else renderNoticeBar();
    });
    bar.querySelector("[data-notice-store]")?.addEventListener("click", () => {
      showPage("store");
    });
    bar.querySelector("[data-notice-dismiss-store]")?.addEventListener("click", () => {
      void markCatalogSeen();
    });
  }

  async function markCatalogSeen() {
    storeNoticeDismissed = true;
    const allIds = catalogItems.map((i) => i.id).filter(Boolean).slice(0, 128);
    newCatalogIds.clear();
    renderNoticeBar();
    storeGridSignature = null;
    if (activePage === "store") renderStore();
    if (allIds.length) {
      await api.save({ seenCatalogIds: allIds }).then((u) => { if (u) data = u; }).catch(() => {});
    }
  }

  function renderStore() {
    const q = ($("#storeSearch")?.value || "").trim().toLowerCase();
    const kindLabels = { wallpaper: "壁纸", character: "桌宠样式", theme: "主题配色" };
    const entries = groupStoreEntries(catalogItems);
    const entryById = new Map(entries.map((e) => [e.id, e]));

    const featured = entries.find((x) => x.kind === "wallpaper") || entries[0];
    const heroSignature = JSON.stringify(featured ? [featured.id, featured.title, featured.description, featured.preview, featured.frames.length] : null);
    if (featured && storeHeroSignature !== heroSignature) {
      if ($("#storeHeroTitle")) $("#storeHeroTitle").textContent = featured.title || "精选资产";
      if ($("#storeHeroDesc")) $("#storeHeroDesc").textContent = featured.description || "Catstella 在线内容包";
      if ($("#storeHeroImg") && $("#storeHeroImg").getAttribute("src") !== (featured.preview || "")) {
        if (featured.preview) $("#storeHeroImg").src = featured.preview;
        else $("#storeHeroImg").removeAttribute("src");
      }
      $("#storeHeroUse").onclick = () => void applyStoreEntry(featured);
      $("#storeHeroDetail").onclick = () => openStoreDialog(featured);
      storeHeroSignature = heroSignature;
    }

    const list = entries.filter((entry) => {
      if (activeStoreCat === "recent") {
        // show items sorted or flagged recent
      } else if (activeStoreCat !== "all" && entry.kind !== activeStoreCat) {
        return false;
      }
      if (q && !entry.searchText.includes(q)) {
        return false;
      }
      return true;
    });
    if (activeStoreCat === "recent") {
      list.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    }

    const grid = $("#storeGrid");
    if (!grid) return;
    const signature = JSON.stringify([catalogOffline, activeStoreCat, q, [...newCatalogIds].sort(),
      list.map((entry) => [entry.id, entry.kind, entry.title, entry.description, entry.preview, entry.frames.map((f) => f.id)])]);
    if (storeGridSignature !== signature) {
      const focused = grid.contains(document.activeElement) ? document.activeElement : null;
      const focusedId = focused?.closest(".store-card")?.dataset.sid;
      const focusedAction = focused?.hasAttribute("data-apply") ? "[data-apply]" : "[data-detail]";
      const scroll = $("#main-scroll");
      const scrollTop = scroll?.scrollTop;
      storeGridSignature = signature;
      if (!entries.length) {
        grid.innerHTML = `<p class="desc">${catalogOffline ? "离线种子目录为空，可点击刷新目录重试～" : "正在加载内容目录…"}</p>`;
        return;
      }
      grid.innerHTML = list.map((entry) => {
        const st = getEntryInstallState(entry);
        const kindLbl = entry.isPack ? "系列图包" : (kindLabels[entry.kind] || entry.kind);
        const previewUrl = entry.preview || "";
        const credit = parseCreditInfo(entry.lead, entry);
        const isNew = entry.frames.some((f) => newCatalogIds.has(f.id));
        const zoomBtn = entry.kind === "wallpaper" || entry.kind === "theme"
          ? `<button type="button" class="store-cover-zoom" data-zoom="${esc(entry.id)}" title="沉浸预览" aria-label="沉浸预览">⛶</button>`
          : "";
        const coverInner = entry.kind === "theme"
          ? `<div class="store-cover"><div class="store-theme-swatch" style="background:linear-gradient(135deg,#1d1730,#382a5a)"><div class="store-swatch-pills"><span style="width:42px;background:var(--accent)"></span><span style="width:24px;background:var(--accent-2)"></span></div><small style="color:rgba(255,255,255,0.88);font-weight:700">${esc(entry.title)}</small></div>${zoomBtn}</div>`
          : `<div class="store-cover${entry.kind === "character" ? " is-char" : ""}"><img loading="lazy" decoding="async" src="${esc(previewUrl)}" alt="${esc(entry.title)}">${entry.isPack ? `<span class="store-pack-count">${entry.frames.length} 张合集</span>` : ""}${zoomBtn}</div>`;
        return `
          <article class="store-card${entry.isPack ? " is-pack" : ""}${st.active ? " active" : ""}" data-sid="${esc(entry.id)}">
            <div class="store-card-inner">
              ${coverInner}
              <div class="store-card-body">
                <div class="store-meta">
                  <div class="pillrow">
                    <span class="store-badge">${esc(kindLbl)}</span>
                    ${isNew ? '<span class="store-new-pill">NEW</span>' : ""}
                  </div>
                  <span class="store-state-pill${st.stateClass ? " " + st.stateClass : ""}">${esc(st.badgeTxt)}</span>
                </div>
                <h4>${esc(entry.title)}</h4>
                <p>${esc(entry.description)}</p>
                <div class="store-credit-line" title="${esc(credit.raw)}">✦ ${esc(credit.short)}</div>
                <div class="store-actions">
                  <button type="button" class="pill" data-detail="${esc(entry.id)}">详情</button>
                  <button type="button" class="pill on" data-apply="${esc(entry.id)}">${esc(st.btnTxt)}</button>
                </div>
              </div>
            </div>
          </article>`;
      }).join("") || `<p class="desc">没有找到匹配「${esc(q)}」的内容素材～</p>`;

      grid.querySelectorAll("[data-apply]").forEach((b) => {
        b.onclick = () => {
          const entry = entryById.get(b.dataset.apply);
          if (entry) void applyStoreEntry(entry);
        };
      });
      grid.querySelectorAll("[data-detail]").forEach((b) => {
        b.onclick = () => {
          const entry = entryById.get(b.dataset.detail);
          if (entry) openStoreDialog(entry);
        };
      });
      grid.querySelectorAll("[data-zoom]").forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const entry = entryById.get(b.dataset.zoom);
          if (entry) openImmersivePreview(entry, 0);
        };
      });
      if (focusedId) {
        const card = [...grid.querySelectorAll(".store-card")].find((el) => el.dataset.sid === focusedId);
        card?.querySelector(focusedAction)?.focus({ preventScroll: true });
      }
      if (scroll) scroll.scrollTop = scrollTop;
    }
    // State-only snapshots update labels in place, preserving card/button/image nodes.
    const visibleById = new Map(list.map((entry) => [entry.id, entry]));
    for (const card of grid.querySelectorAll(".store-card")) {
      const entry = visibleById.get(card.dataset.sid);
      if (!entry) continue;
      const st = getEntryInstallState(entry);
      card.classList.toggle("active", st.active);
      const pill = card.querySelector(".store-state-pill");
      const apply = card.querySelector("[data-apply]");
      pill.classList.toggle("on", st.stateClass === "on");
      pill.classList.toggle("installed", st.stateClass === "installed");
      pill.classList.toggle("partial", st.stateClass === "partial");
      if (pill.textContent !== st.badgeTxt) pill.textContent = st.badgeTxt;
      if (apply.textContent !== st.btnTxt) apply.textContent = st.btnTxt;
    }
    if (activeDlgEntry && $("#storeDlg")?.open) {
      const latestEntry = entryById.get(activeDlgEntry.id);
      if (latestEntry) {
        activeDlgEntry = latestEntry;
        renderStoreDialog();
      }
    }
  }

  async function applyOnlineItem(item, { refreshDialog = false } = {}) {
    const msg = `正在应用「${item.name || item.id}」…`;
    say(msg);
    if ($("#dlgStatus") && $("#storeDlg")?.open) $("#dlgStatus").textContent = msg;
    const res = await api.online("install", item.id);
    if (res?.ok) {
      data = await api.get() || data;
      render();
      if (refreshDialog && activeDlgEntry && $("#storeDlg")?.open) renderStoreDialog();
      const doneMsg = `已应用「${item.name || item.id}」`;
      say(doneMsg);
      if ($("#dlgStatus") && $("#storeDlg")?.open) $("#dlgStatus").textContent = doneMsg;
    } else {
      const errMsg = res?.reason === "connection" ? "连接 GitHub 失败，请检查网络或代理" : "应用失败，请稍后重试";
      say(errMsg);
      if ($("#dlgStatus") && $("#storeDlg")?.open) $("#dlgStatus").textContent = errMsg;
    }
  }

  async function installPackEntry(entry) {
    const missing = entry.frames.filter((f) => !isStoreItemInstalled(f));
    if (!missing.length) {
      await applyOnlineItem(entry.frames[0], { refreshDialog: true });
      return;
    }
    let done = 0;
    for (const frame of missing) {
      const progMsg = `正在安装「${entry.title}」(${done + 1}/${missing.length})…`;
      say(progMsg);
      if ($("#dlgStatus") && $("#storeDlg")?.open) $("#dlgStatus").textContent = progMsg;
      const res = await api.online("download", frame.id);
      if (!res?.ok) {
        const errMsg = res?.reason === "connection" ? "连接 GitHub 失败，请检查网络或代理" : `安装失败（已完成 ${done}/${missing.length}）`;
        say(errMsg);
        if ($("#dlgStatus") && $("#storeDlg")?.open) $("#dlgStatus").textContent = errMsg;
        data = await api.get() || data;
        render();
        return;
      }
      done++;
    }
    const st = getEntryInstallState(entry);
    if (!st.active && entry.frames[0]) {
      await api.online("install", entry.frames[0].id);
    }
    data = await api.get() || data;
    render();
    if (activeDlgEntry && $("#storeDlg")?.open) renderStoreDialog();
    const okMsg = `已安装整套「${entry.title}」（${entry.frames.length} 张）`;
    say(okMsg);
    if ($("#dlgStatus") && $("#storeDlg")?.open) $("#dlgStatus").textContent = okMsg;
  }

  async function applyStoreEntry(entry) {
    if (!entry) return;
    if (entry.isPack) {
      const st = getEntryInstallState(entry);
      if (!st.allInstalled) {
        await installPackEntry(entry);
      } else {
        await applyOnlineItem(entry.frames[0]);
      }
      return;
    }
    await applyOnlineItem(entry.lead);
  }

  function renderStoreDialog() {
    const entry = activeDlgEntry;
    if (!entry) return;
    if (activeDlgIndex < 0 || activeDlgIndex >= entry.frames.length) activeDlgIndex = 0;
    const item = entry.frames[activeDlgIndex] || entry.lead;
    const kindLabels = { wallpaper: "壁纸", character: "桌宠样式", theme: "主题配色" };
    const credit = parseCreditInfo(item, entry);
    const srcUrl = item.source || entry.source || "";
    const installed = isStoreItemInstalled(item);
    const active = isStoreItemActive(item);

    if ($("#dlgKind")) $("#dlgKind").textContent = entry.isPack ? `系列图包 · ${kindLabels[entry.kind] || entry.kind}` : (kindLabels[entry.kind] || "素材详情");
    if ($("#dlgTitle")) $("#dlgTitle").textContent = entry.isPack ? `${entry.title} · ${item.name || item.id}` : (item.name || item.id);
    if ($("#dlgDesc")) $("#dlgDesc").textContent = item.description || entry.description || "Catstella 扩展内容资产";
    if ($("#dlgAuthor")) $("#dlgAuthor").textContent = `By ${credit.author}`;
    if ($("#dlgLicense")) {
      $("#dlgLicense").textContent = credit.license;
      $("#dlgLicense").hidden = !credit.license;
    }
    if ($("#dlgImmersive")) {
      $("#dlgImmersive").hidden = entry.kind !== "wallpaper" && entry.kind !== "theme";
    }
    const wallBest = entry.kind === "wallpaper" ? resolveBestWallpaperSrc(item) : null;
    if ($("#dlgHdBadge")) {
      $("#dlgHdBadge").hidden = entry.kind !== "wallpaper";
      if (wallBest) $("#dlgHdBadge").textContent = wallBest.badge;
    }

    const media = $("#dlgMedia");
    if (media) {
      if (entry.kind === "theme") {
        const targetSpec = resolveThemeSpec(item);
        const curWall = selectedWallpaper();
        const wallSrc = curWall?.preview || "";
        const curPalette = data?.dreamSkin?.themePreset || "violet";
        const curOpacity = Number.isFinite(Number(data?.dreamSkin?.opacity)) ? Number(data.dreamSkin.opacity) : 55;
        media.innerHTML = `
          <div class="dlg-theme-compare">
            <div class="dlg-compare-pane" data-palette="${esc(curPalette)}" style="--cmp-op:${(curOpacity / 100).toFixed(2)}">
              ${wallSrc ? `<img src="${esc(wallSrc)}" alt="">` : ""}
              <div class="dlg-cmp-scrim"></div>
              <div class="dlg-compare-head"><span>当前搭配</span><span>${esc(THEME_NAMES[curPalette] || curPalette)} · ${Math.round(curOpacity)}%</span></div>
              <div class="dlg-compare-chat"><span>提问气泡预览</span><p>当前 Antigravity 回复底色效果</p></div>
            </div>
            <div class="dlg-compare-pane" data-palette="${esc(targetSpec.palette)}" style="--cmp-op:${(targetSpec.opacity / 100).toFixed(2)}">
              ${wallSrc ? `<img src="${esc(wallSrc)}" alt="">` : ""}
              <div class="dlg-cmp-scrim"></div>
              <div class="dlg-compare-head"><span>✦ 此主题效果</span><span>${esc(THEME_NAMES[targetSpec.palette] || targetSpec.palette)} · ${Math.round(targetSpec.opacity)}%</span></div>
              <div class="dlg-compare-chat"><span>提问气泡预览</span><p>应用后对比效果${targetSpec.live ? "（已实时加载）" : ""}</p></div>
            </div>
          </div>`;
        ensureThemePreview(item, () => {
          if ($("#storeDlg")?.open && activeDlgEntry?.id === entry.id) renderStoreDialog();
        });
      } else {
        const imgSrc = wallBest ? wallBest.src : (item.preview || "");
        media.innerHTML = imgSrc
          ? `<img id="dlgImg" src="${esc(imgSrc)}" alt="${esc(item.name || "")}">`
          : `<small style="padding:24px;color:var(--soft)">无预览图像</small>`;
        $("#dlgImg")?.addEventListener("click", () => {
          if (entry.kind === "wallpaper") openImmersivePreview(entry, activeDlgIndex);
        });
        if (entry.kind === "wallpaper") {
          ensureHdPreview(item, () => {
            if ($("#storeDlg")?.open && activeDlgEntry?.id === entry.id) renderStoreDialog();
          });
        }
      }
    }

    const meta = $("#dlgMeta");
    if (meta) {
      const chips = [];
      chips.push(active ? "✓ 使用中" : (installed ? "已安装本地" : "在线待下载"));
      const sz = formatBytes(item.size);
      if (sz) chips.push(sz);
      if (item.updatedAt) chips.push(`更新 ${item.updatedAt}`);
      if (entry.isPack) chips.push(`合集 ${activeDlgIndex + 1}/${entry.frames.length}`);
      if (item.sha256) chips.push(`SHA-256 ${item.sha256.slice(0, 8)}…`);
      meta.innerHTML = chips.map((c) => `<span class="dlg-meta-chip">${esc(c)}</span>`).join("");
      meta.hidden = chips.length === 0;
    }

    const packNav = $("#dlgPackNav");
    const strip = $("#dlgStrip");
    if (packNav) packNav.hidden = !entry.isPack;
    if ($("#dlgCounter")) $("#dlgCounter").textContent = `${activeDlgIndex + 1} / ${entry.frames.length}`;
    if ($("#dlgSource")) {
      $("#dlgSource").hidden = !srcUrl;
      $("#dlgSource").dataset.url = srcUrl;
    }

    if (strip) {
      strip.hidden = !entry.isPack;
      if (entry.isPack) {
        strip.innerHTML = entry.frames.map((frame, i) => `
          <button type="button" class="dlg-strip-thumb${i === activeDlgIndex ? " on" : ""}" data-frame-idx="${i}" aria-label="${esc(frame.name || frame.id)}">
            <img loading="lazy" decoding="async" src="${esc(frame.preview || "")}" alt="">
            ${isStoreItemInstalled(frame) ? '<span class="dlg-strip-done">✓</span>' : ""}
          </button>`).join("");
        strip.querySelectorAll("[data-frame-idx]").forEach((btn) => {
          btn.onclick = () => {
            activeDlgIndex = Number(btn.dataset.frameIdx) || 0;
            renderStoreDialog();
          };
        });
      } else {
        strip.innerHTML = "";
      }
    }

    const missingCount = entry.isPack ? entry.frames.filter((f) => !isStoreItemInstalled(f)).length : 0;
    if ($("#dlgUninstall")) $("#dlgUninstall").hidden = !installed;
    if ($("#dlgInstallAll")) {
      $("#dlgInstallAll").hidden = !entry.isPack || missingCount === 0;
      $("#dlgInstallAll").textContent = `安装整套 (${missingCount})`;
    }
    if ($("#dlgUse")) {
      $("#dlgUse").textContent = active ? "已应用" : (installed ? "立即应用" : "安装并应用");
    }
  }

  function renderImmersivePreview() {
    const entry = immEntry;
    const dlg = $("#immersiveDlg");
    if (!entry || !dlg) return;
    if (immIndex < 0 || immIndex >= entry.frames.length) immIndex = 0;
    const item = entry.frames[immIndex] || entry.lead;
    const credit = parseCreditInfo(item, entry);
    const srcUrl = item.source || entry.source || "";
    const curWall = selectedWallpaper();
    const curPack = (data?.characterPacks || []).find((p) => p.id === data?.settings?.characterPack) || data?.characterPacks?.[0];

    const isTheme = entry.kind === "theme";
    const themeSpec = isTheme ? resolveThemeSpec(item) : null;
    const curPalette = data?.dreamSkin?.themePreset || "violet";
    const curOp = Number.isFinite(Number(data?.dreamSkin?.opacity)) ? Number(data.dreamSkin.opacity) : 55;
    const curScrim = Number.isFinite(Number(data?.dreamSkin?.scrim)) ? Number(data.dreamSkin.scrim) : 25;

    const activePalette = isTheme ? (immCompareCurrent ? curPalette : themeSpec.palette) : curPalette;
    const defaultOp = isTheme ? (immCompareCurrent ? curOp : themeSpec.opacity) : 100;
    const opVal = immCustomOp !== null ? immCustomOp : defaultOp;
    const scrimVal = immCustomScrim !== null ? immCustomScrim : (isTheme ? curScrim : 18);

    const stage = $("#immStage");
    if (stage) {
      stage.dataset.palette = activePalette;
      stage.style.setProperty("--imm-op", (opVal / 100).toFixed(2));
      stage.style.setProperty("--imm-scrim", (scrimVal / 100).toFixed(2));
    }
    const wallBest = isTheme ? null : resolveBestWallpaperSrc(item);
    if ($("#immHdBadge")) {
      $("#immHdBadge").hidden = isTheme;
      if (wallBest) $("#immHdBadge").textContent = wallBest.badge;
    }
    if ($("#immWall")) {
      const src = isTheme ? (curWall?.preview || "") : (wallBest ? wallBest.src : (item.preview || ""));
      if ($("#immWall").getAttribute("src") !== src) $("#immWall").src = src;
    }
    if (!isTheme) {
      ensureHdPreview(item, () => {
        if ($("#immersiveDlg")?.open && immEntry?.id === entry.id) renderImmersivePreview();
      });
    }
    if ($("#immMockPet") && curPack?.preview && $("#immMockPet").getAttribute("src") !== curPack.preview) {
      $("#immMockPet").src = curPack.preview;
    }
    if ($("#immMockChat")) $("#immMockChat").hidden = !immChatVisible;
    if ($("#immToggleChat")) $("#immToggleChat").classList.toggle("on", immChatVisible);
    if ($("#immCompare")) {
      $("#immCompare").hidden = !isTheme;
      $("#immCompare").classList.toggle("on", immCompareCurrent);
      $("#immCompare").textContent = immCompareCurrent ? "查看目标主题" : "对比当前搭配";
    }
    if ($("#immKind")) $("#immKind").textContent = isTheme ? "主题沉浸预览" : (entry.isPack ? `系列图包 · ${immIndex + 1}/${entry.frames.length}` : "壁纸沉浸预览");
    if ($("#immTitle")) $("#immTitle").textContent = entry.isPack ? `${entry.title} · ${item.name || item.id}` : (item.name || item.id);
    if ($("#immCredit")) $("#immCredit").textContent = `By ${credit.author}${credit.license ? ` · ${credit.license}` : ""}`;
    if ($("#immSource")) {
      $("#immSource").hidden = !srcUrl;
      $("#immSource").dataset.url = srcUrl;
    }
    if ($("#immNav")) $("#immNav").hidden = !entry.isPack;
    if ($("#immCounter")) $("#immCounter").textContent = `${immIndex + 1} / ${entry.frames.length}`;
    if ($("#immOp")) $("#immOp").value = String(Math.round(opVal));
    if ($("#immOpVal")) $("#immOpVal").textContent = `${Math.round(opVal)}%`;
    if ($("#immScrim")) $("#immScrim").value = String(Math.round(scrimVal));
    if ($("#immScrimVal")) $("#immScrimVal").textContent = `${Math.round(scrimVal)}%`;
    if ($("#immApply")) {
      const installed = isStoreItemInstalled(item);
      const active = isStoreItemActive(item);
      $("#immApply").textContent = active ? "✓ 已应用" : (installed ? "✦ 立即应用" : "✦ 安装并应用");
    }
    if (isTheme) {
      ensureThemePreview(item, () => {
        if ($("#immersiveDlg")?.open && immEntry?.id === entry.id) renderImmersivePreview();
      });
    }
  }

  function openImmersivePreview(entry, frameIdx = 0) {
    immEntry = entry;
    immIndex = frameIdx;
    immCompareCurrent = false;
    immCustomOp = null;
    immCustomScrim = null;
    immChatVisible = true;
    renderImmersivePreview();
    if (!$("#immersiveDlg")?.open) $("#immersiveDlg")?.showModal();
  }

  function openStoreDialog(entry, frameIdx = 0) {
    activeDlgEntry = entry;
    activeDlgIndex = frameIdx;
    if ($("#dlgStatus")) $("#dlgStatus").textContent = "";
    renderStoreDialog();
    $("#storeDlg")?.showModal();
  }

  function renderActivePage(page = activePage) {
    if (page === "pet") renderPetPage();
    else if (page === "skin") renderSkinPage();
    else if (page === "quota") renderQuotaPage();
    else if (page === "link") renderLinkPage();
    else if (page === "store") renderStore();
  }

  function render() {
    if (data.settings?.volume === 0) stopPreview();
    renderHudAndHeader();
    renderNoticeBar();
    renderActivePage(activePage);
  }

  function bindAll() {
    initSwitchFallback();
    attachDialogLightDismiss($("#storeDlg"));
    attachDialogLightDismiss($("#immersiveDlg"));

    $$("#side-nav .tab").forEach((t) => {
      t.onclick = () => showPage(t.dataset.p);
    });

    $("#mode").onclick = () => {
      const h = document.documentElement;
      const next = h.dataset.mode === "dark" ? "light" : "dark";
      h.dataset.mode = next;
      try { localStorage.setItem(MODE_KEY, next); } catch {}
      say(next === "dark" ? "已切换深色模式" : "已切换浅色模式");
    };
    $("#win-min").onclick = () => void api.command("settings-minimize");
    $("#win-close").onclick = () => void api.command("settings-close");

    $("#undo").onclick = () => {
      void save({ ...baseline.settings, dreamSkin: baseline.dreamSkin }, "已撤回本次打开设置后的改动");
    };

    $("#cat").onclick = () => {
      const pack = data?.settings?.characterPack === "lin-cat" ? "lin-cat" : "gemini-star-v1";
      const file = pack === "lin-cat" ? "proud.webp" : "proud-v3.webp";
      const fb = pack === "lin-cat" ? "proud.png" : "proud-v3.png";
      const img = $("#hud-pet-img");
      if (img) {
        const curSrc = img.getAttribute("src") || "";
        const ext = curSrc.endsWith(".png") ? fb : file;
        img.src = `../../assets/character-packs/${pack}/frames/${ext}`;
      }
      if ($("#bubbleText")) $("#bubbleText").textContent = `哼哼～${resolveHonorific()}终于识货了嘛，这波稳了喵！`;
      clearTimeout(faceTimer);
      faceTimer = setTimeout(() => {
        const activePack = (data.characterPacks || []).find((p) => p.id === data.settings.characterPack);
        if ($("#hud-pet-img") && activePack?.preview) $("#hud-pet-img").src = activePack.preview;
      }, 2200);
      void api.command("preview-reaction:proud");
      void previewAudio();
    };

    // Sliders (live HUD preview on input, persist on change)
    $("#scale")?.addEventListener("input", () => {
      const v = Number($("#scale").value);
      syncSliderVisual($("#scale"), (x) => `${Math.round(x)} px`);
      if ($("#scaleB")) $("#scaleB").textContent = String(Math.round(v));
      if ($("#cat")) $("#cat").style.width = `${44 + ((v - 140) / 220) * 30}%`;
    });
    $("#scale")?.addEventListener("change", () => {
      void save({ scale: Number($("#scale").value) }, `角色大小已设为 ${$("#scale").value} px`);
    });

    $("#vol")?.addEventListener("input", () => {
      const v = Number($("#vol").value);
      syncSliderVisual($("#vol"), (x) => `${Math.round(x)}%`);
    });
    $("#vol")?.addEventListener("change", () => {
      void save({ volume: Number($("#vol").value) / 100 }, `音量已设为 ${$("#vol").value}%`);
    });

    $("#op")?.addEventListener("input", () => {
      const v = Number($("#op").value);
      syncSliderVisual($("#op"), (x) => `${Math.round(x)}%`);
      if ($("#opB")) $("#opB").textContent = String(Math.round(v));
      $("#atelier-preview")?.style.setProperty("--at-op", String(v / 100));
      $("#hudWallBg")?.style.setProperty("opacity", String(Math.max(0.12, Math.min(0.60, (v / 100) + 0.14))));
    });
    $("#op")?.addEventListener("change", () => {
      void save({ dreamSkin: { opacity: Number($("#op").value) } }, `壁纸可见度 ${$("#op").value}%`);
    });

    $("#scrim")?.addEventListener("input", () => {
      const v = Number($("#scrim").value);
      syncSliderVisual($("#scrim"), (x) => `${Math.round(x)}%`);
      if ($("#scrimB")) $("#scrimB").textContent = String(Math.round(v));
      $("#atelier-preview")?.style.setProperty("--at-scrim", String(v / 100));
    });
    $("#scrim")?.addEventListener("change", () => {
      void save({ dreamSkin: { scrim: Number($("#scrim").value) } }, `背景遮罩 ${$("#scrim").value}%`);
    });

    $("#chatOp")?.addEventListener("input", () => {
      syncSliderVisual($("#chatOp"), (x) => `${Math.round(x)}%`);
      $("#atelier-preview")?.style.setProperty("--at-chat-op", String(Number($("#chatOp").value) / 100));
    });
    $("#chatOp")?.addEventListener("change", () => {
      void save({ dreamSkin: { chatOpacity: Number($("#chatOp").value) } });
    });

    $("#replyOp")?.addEventListener("input", () => {
      syncSliderVisual($("#replyOp"), (x) => `${Math.round(x)}%`);
      $("#atelier-preview")?.style.setProperty("--at-reply-op", String(Number($("#replyOp").value) / 100));
    });
    $("#replyOp")?.addEventListener("change", () => {
      void save({ dreamSkin: { replyOpacity: Number($("#replyOp").value) } });
    });

    $("#iv")?.addEventListener("input", () => {
      const v = Number($("#iv").value);
      let nearest = null;
      let minDist = Infinity;
      for (const anchor of SNAP_TICKS) {
        const d = Math.abs(v - anchor);
        if (d < minDist) { minDist = d; nearest = anchor; }
      }
      if (nearest !== null && minDist <= 1.6 && minDist > 0.05) {
        $("#iv").value = String(Number((v + (nearest - v) * 0.45).toFixed(1)));
      }
      const cur = Math.round(Number($("#iv").value));
      syncSliderVisual($("#iv"), (x) => (Math.round(x) === 60 ? "1 小时" : `${Math.round(x)} 分钟`));
      $$("#ivTicks button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) === cur));
    });
    $("#iv")?.addEventListener("change", () => {
      const v = Number($("#iv").value);
      const nearest = SNAP_TICKS.find((a) => Math.abs(v - a) <= 2.2);
      const finalVal = nearest !== undefined ? nearest : Math.round(v);
      $("#iv").value = String(finalVal);
      syncSliderVisual($("#iv"), (x) => (Math.round(x) === 60 ? "1 小时" : `${Math.round(x)} 分钟`));
      void save({ dreamSkin: { slideshowIntervalMinutes: finalVal } }, `轮播间隔 ${finalVal === 60 ? "1h" : `${finalVal}m`}`);
    });
    $$("#ivTicks button").forEach((b) => {
      b.onclick = () => {
        const m = Number(b.dataset.v);
        $("#iv").value = String(m);
        syncSliderVisual($("#iv"), (x) => (Math.round(x) === 60 ? "1 小时" : `${Math.round(x)} 分钟`));
        void save({ dreamSkin: { slideshowIntervalMinutes: m } }, `轮播间隔 ${b.textContent}`);
      };
    });

    // Switches mapped directly to settings / dreamSkin
    const bindSwitch = (id, toPatch, msg) => {
      $(id)?.addEventListener("change", (e) => {
        void save(toPatch(e.target.checked), typeof msg === "function" ? msg(e.target.checked) : msg);
      });
    };
    bindSwitch("#hostWindowOnly", (v) => ({ hostWindowOnly: v }));
    bindSwitch("#standaloneDesktopMode", (v) => ({ standaloneDesktopMode: v }));
    bindSwitch("#alwaysOnTop", (v) => ({ alwaysOnTop: v }));
    bindSwitch("#reducedMotion", (v) => ({ reducedMotion: v }));
    bindSwitch("#clickThrough", (v) => ({ clickThrough: v }));
    bindSwitch("#easterEggs", (v) => ({ easterEggs: v }));
    bindSwitch("#bubbleOn", (v) => ({ bubbleOn: v }));
    bindSwitch("#ambientChatter", (v) => ({ ambientChatter: v }));
    bindSwitch("#soundOn", (v) => {
      if (!v) stopPreview();
      return { sound: v };
    });
    bindSwitch("#syncWallpaper", (v) => ({ syncWallpaper: v }));
    bindSwitch("#syncCharacter", (v) => ({ syncCharacter: v }));
    bindSwitch("#syncInteraction", (v) => ({ syncInteraction: v }));
    bindSwitch("#autoUpdateCheck", (v) => ({ autoUpdateCheck: v }));
    bindSwitch("#slideshow", (v) => ({ dreamSkin: { slideshow: v } }));
    bindSwitch("#glassMode", (v) => ({ dreamSkin: { outputMode: v ? "glass" : "transparent" } }));
    bindSwitch("#dreamEnabled", (v) => ({ dreamSkin: { enabled: v } }), (v) => (v ? "已启用 Antigravity 皮肤" : "已关闭 Antigravity 皮肤"));
    bindSwitch("#sqOn", (v) => ({ sideQuotaEnabled: v }));
    bindSwitch("#manualQuota", (v) => ({ manualQuota: v }));

    // Pill groups
    $$(".pillrow[data-group]").forEach((g) => {
      const grp = g.dataset.group;
      g.querySelectorAll(".pill").forEach((btn) => {
        btn.onclick = () => {
          const val = btn.dataset.val;
          if (grp === "hon") {
            void save({ userHonorificMode: val });
            if (val === "custom") setTimeout(() => $("#customHonorific")?.focus(), 40);
          } else if (grp === "click") {
            void save({ clickCatAction: val });
          } else if (grp === "dur") {
            void save({ turnCostDurationMs: Number(val) });
          } else if (grp === "snd") {
            void save({ soundSet: val }).then(updated => { if (updated) void previewAudio(); });
          } else if (grp === "theme") {
            void save({ dreamSkin: { themePreset: val } }, `已切换主题：${btn.textContent}`);
          } else if (grp === "sqMode") {
            void save({ sideQuotaMode: val });
          } else if (grp === "sqSrc") {
            void save({ sideQuotaSource: val });
          } else if (grp === "sqSize") {
            void save({ sideQuotaSize: val });
          } else if (grp === "sqDist") {
            void save({ sideQuotaDistance: val });
          } else if (grp === "sqStyle") {
            void save({ sideQuotaStyle: val });
          } else if (grp === "lang") {
            void save({ dreamSkin: { uiLanguage: val } }, `宿主语言已切换为 ${btn.textContent}`);
          } else if (grp === "dm") {
            void save({ petDisplayMode: val });
          }
        };
      });
    });

    $("#customHonorific")?.addEventListener("change", () => {
      void save({ customHonorific: $("#customHonorific").value });
    });

    $$("[data-cmd]").forEach((b) => {
      b.onclick = () => void api.command(b.dataset.cmd);
    });
    $$(".tag[data-e]").forEach((t) => {
      t.onclick = () => {
        void api.command("preview-reaction:" + t.dataset.e);
        void previewAudio();
      };
    });
    $("#audition")?.addEventListener("click", () => void previewAudio(true));
    $("#open-char-dir")?.addEventListener("click", () => void api.command("open-character-dir"));
    $("#open-wall-dir")?.addEventListener("click", () => void api.command("open-wallpaper-dir"));
    $("#nextWall")?.addEventListener("click", () => void api.command("next-wallpaper"));
    $("#refreshQuota")?.addEventListener("click", () => {
      void api.command("quota-refresh");
      say("已请求刷新 Antigravity 配额");
    });

    $("#chatTint")?.addEventListener("change", () => {
      void save({ dreamSkin: { chatTint: $("#chatTint").value } });
    });
    $("#clearTint")?.addEventListener("click", () => {
      void save({ dreamSkin: { chatTint: "" } }, "已恢复默认对话气泡色");
    });
    $("#saveTheme")?.addEventListener("click", () => {
      const name = ($("#themeName")?.value || "").trim() || `星轨配置 ${(data.settings.customThemes || []).length + 1}`;
      const ds = data.dreamSkin || {};
      const item = {
        id: "ct-" + Date.now(),
        name,
        palette: ds.themePreset || "violet",
        opacity: ds.opacity ?? 55,
        bubbleTint: data.settings.bubbleTint || "",
        bubbleOpacity: data.settings.bubbleOpacity ?? 98,
        chatTint: ds.chatTint || "",
        chatOpacity: ds.chatOpacity ?? null,
        replyOpacity: ds.replyOpacity ?? null,
        updatedAt: new Date().toISOString().slice(0, 10)
      };
      const next = [item, ...(data.settings.customThemes || []).slice(0, 19)];
      if ($("#themeName")) $("#themeName").value = "";
      void save({ customThemes: next }, `已保存主题「${name}」`);
    });

    $$("#sqCards .sq-card").forEach((c) => {
      c.onclick = () => void save({ sideQuotaVariant: c.dataset.val }, `耐力计已切换为 ${c.querySelector("b")?.textContent}`);
    });
    $$("#sqPalettes .sq-swatch").forEach((sw) => {
      sw.onclick = () => void save({ sideQuotaPalette: sw.dataset.sqp }, `耐力条配色已更新`);
    });
    $("#sqColor")?.addEventListener("input", () => {
      if (!data.settings) data.settings = {};
      data.settings.sideQuotaPalette = "custom";
      data.settings.sideQuotaColor = $("#sqColor").value;
      renderHudAndHeader();
      renderQuotaPage();
    });
    $("#sqColor")?.addEventListener("change", () => {
      void save({ sideQuotaPalette: "custom", sideQuotaColor: $("#sqColor").value }, "已更新耐力条自定义配色");
    });
    $("#sqOpacity")?.addEventListener("input", () => {
      const v = Number($("#sqOpacity").value);
      syncSliderVisual($("#sqOpacity"), (x) => `${Math.round(x)}%`);
      if ($("#sqOpacityB")) $("#sqOpacityB").textContent = String(Math.round(v));
      $("#hudSq")?.style.setProperty("--sq-opacity", (v / 100).toFixed(2));
      $("#sqPreview")?.style.setProperty("--sq-opacity", (v / 100).toFixed(2));
    });
    $("#sqOpacity")?.addEventListener("change", () => {
      void save({ sideQuotaOpacity: Number($("#sqOpacity").value) }, `耐力条透明度 ${$("#sqOpacity").value}%`);
    });
    $("#jumpSqCustom")?.addEventListener("click", () => {
      showPage("quota");
      $("#sqCards")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    const bindNum = (id, key) => {
      const el = $(id);
      el?.addEventListener("change", () => {
        const n = Number(el.value);
        if (Number.isFinite(n)) {
          void save({ [key]: Math.max(0, Math.min(100, Math.round(n))) });
        }
      });
    };
    bindNum("#manual5h", "manualPercent");
    bindNum("#manual1w", "manualWeeklyPercent");

    // Host diagnostics, shortcut configuration & Windows autostart/hostlink watcher
    $("#btnCfgShortcut")?.addEventListener("click", async () => {
      say("正在配置 Antigravity 快捷方式…");
      const res = await api.host("configure-shortcuts");
      if (res?.diagnostic) data.hostDiagnostic = res.diagnostic;
      renderLinkPage();
      say(res?.ok ? "已为 Antigravity 快捷方式写入调试参数" : (res?.error || "配置快捷方式失败"));
    });
    $("#btnLaunchDebug")?.addEventListener("click", async () => {
      const res = await api.host("launch-debug");
      say(res?.ok ? "正在以调试模式唤醒 Antigravity…" : (res?.message || res?.error || "启动失败"));
    });
    $("#btnRedetect")?.addEventListener("click", async () => {
      const res = await api.host("diagnose");
      if (res?.diagnostic) data.hostDiagnostic = res.diagnostic;
      void api.command("quota-refresh");
      renderLinkPage();
      say("已完成端口重检");
    });

    const syncStartup = async () => {
      const autoStart = Boolean($("#startupAutoStart")?.checked);
      const hostLink = Boolean($("#startupHostLink")?.checked);
      const res = await api.host("set-startup", { autoStart, hostLink });
      if (res?.startup) startup = res.startup;
      renderLinkPage();
      say(hostLink || autoStart ? "已开启后台联动 / 自启守护" : "已关闭联动与开机自启");
    };
    $("#startupHostLink")?.addEventListener("change", () => void syncStartup());
    $("#startupAutoStart")?.addEventListener("change", () => void syncStartup());

    $("#btnOpenRepo")?.addEventListener("click", () => void api.command("open-project-repo"));
    $("#btnOpenUpstream")?.addEventListener("click", () => void api.command("open-upstream-repo"));
    $("#btnRestartSuite")?.addEventListener("click", () => void api.command("restart"));
    $("#btnCheckUpdate")?.addEventListener("click", async () => {
      if ($("#update-status")) $("#update-status").textContent = "正在检查 GitHub 发行版…";
      const res = await api.online("check", true);
      if ($("#update-status")) {
        const msgMap = {
          available: res?.latest ? `发现新版本 v${res.latest}（当前 v${res.current}）` : "发现新版本",
          current: `已是最新版本 v${res?.current || ""}`,
          unpublished: `尚未发布桌面安装包（当前 v${res?.current || ""}）`,
          offline: `离线校验或连接 GitHub 超时（当前 v${res?.current || ""}）`
        };
        $("#update-status").textContent = msgMap[res?.status] || `当前版本 v${res?.current || ""}`;
      }
    });

    // Factory Reset (non-blocking inline confirm)
    const rOpen = $('[data-action="reset-open"]');
    const rBox = $('[data-reset-box]');
    if (rOpen && rBox) {
      const closeReset = (focusBack) => {
        rBox.hidden = true;
        if (focusBack) rOpen.focus({ preventScroll: true });
      };
      rOpen.onclick = () => { rBox.hidden = false; $('[data-action="reset-no"]')?.focus({ preventScroll: true }); };
      $('[data-action="reset-no"]').onclick = () => closeReset(true);
      $('[data-action="reset-yes"]').onclick = async () => {
        await api.command("factory-reset");
        data = await api.get() || data;
        closeReset(true);
        render();
        say("已恢复默认配置");
      };
      rBox.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeReset(true); } });
    }

    // Store controls
    $$("#storeCats .pill").forEach((b) => {
      b.onclick = () => {
        $$("#storeCats .pill").forEach((x) => x.classList.toggle("on", x === b));
        activeStoreCat = b.dataset.cat;
        renderStore();
      };
    });
    $("#storeSearch")?.addEventListener("input", renderStore);
    $("#storeRefreshBtn")?.addEventListener("click", () => void loadCatalog(true));
    $("#dlgClose")?.addEventListener("click", () => $("#storeDlg")?.close());
    $("#dlgPrev")?.addEventListener("click", () => {
      if (!activeDlgEntry?.isPack) return;
      activeDlgIndex = (activeDlgIndex - 1 + activeDlgEntry.frames.length) % activeDlgEntry.frames.length;
      renderStoreDialog();
    });
    $("#dlgNext")?.addEventListener("click", () => {
      if (!activeDlgEntry?.isPack) return;
      activeDlgIndex = (activeDlgIndex + 1) % activeDlgEntry.frames.length;
      renderStoreDialog();
    });
    $("#dlgSource")?.addEventListener("click", () => {
      const url = $("#dlgSource")?.dataset.url || activeDlgEntry?.source;
      if (url) void api.online("source", url);
    });
    $("#dlgImmersive")?.addEventListener("click", () => {
      if (activeDlgEntry) openImmersivePreview(activeDlgEntry, activeDlgIndex);
    });
    $("#immClose")?.addEventListener("click", () => $("#immersiveDlg")?.close());
    $("#immPrev")?.addEventListener("click", () => {
      if (!immEntry?.isPack) return;
      immIndex = (immIndex - 1 + immEntry.frames.length) % immEntry.frames.length;
      renderImmersivePreview();
    });
    $("#immNext")?.addEventListener("click", () => {
      if (!immEntry?.isPack) return;
      immIndex = (immIndex + 1) % immEntry.frames.length;
      renderImmersivePreview();
    });
    $("#immToggleChat")?.addEventListener("click", () => {
      immChatVisible = !immChatVisible;
      renderImmersivePreview();
    });
    $("#immCompare")?.addEventListener("click", () => {
      immCompareCurrent = !immCompareCurrent;
      renderImmersivePreview();
    });
    $("#immOp")?.addEventListener("input", () => {
      immCustomOp = Number($("#immOp").value);
      renderImmersivePreview();
    });
    $("#immScrim")?.addEventListener("input", () => {
      immCustomScrim = Number($("#immScrim").value);
      renderImmersivePreview();
    });
    $("#immSource")?.addEventListener("click", () => {
      const url = $("#immSource")?.dataset.url;
      if (url) void api.online("source", url);
    });
    $("#immApply")?.addEventListener("click", async () => {
      const item = immEntry?.frames?.[immIndex] || immEntry?.lead;
      if (!item) return;
      await applyOnlineItem(item, { refreshDialog: true });
      renderImmersivePreview();
    });
    $("#immersiveDlg")?.addEventListener("keydown", (e) => {
      if (!immEntry?.isPack || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        $("#immPrev")?.click();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        $("#immNext")?.click();
      }
    });
    $("#storeDlg")?.addEventListener("keydown", (e) => {
      if (!activeDlgEntry?.isPack || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        $("#dlgPrev")?.click();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        $("#dlgNext")?.click();
      }
    });
    $("#dlgUse")?.addEventListener("click", () => {
      const item = activeDlgEntry?.frames?.[activeDlgIndex] || activeDlgEntry?.lead;
      if (item) void applyOnlineItem(item, { refreshDialog: true });
      if (!activeDlgEntry?.isPack) $("#storeDlg")?.close();
    });
    $("#dlgInstallAll")?.addEventListener("click", () => {
      if (activeDlgEntry?.isPack) void installPackEntry(activeDlgEntry);
    });
    $("#dlgUninstall")?.addEventListener("click", async () => {
      const item = activeDlgEntry?.frames?.[activeDlgIndex] || activeDlgEntry?.lead;
      if (!item) return;
      await api.online("uninstall", item.id);
      data = await api.get() || data;
      render();
      if (activeDlgEntry?.isPack) {
        renderStoreDialog();
      } else {
        $("#storeDlg")?.close();
      }
      say(`已卸载「${item.name || item.id}」`);
    });
  }

  async function loadCatalog(force = false) {
    try {
      const res = await api.online("catalog", Boolean(force));
      if (res?.ok && Array.isArray(res.items)) {
        catalogItems = res.items;
        catalogOffline = Boolean(res.offline);
        const allIds = catalogItems.map((i) => i.id).filter(Boolean).slice(0, 128);
        const seenList = Array.isArray(data.settings?.seenCatalogIds) ? data.settings.seenCatalogIds : [];
        if (!seenList.length && allIds.length) {
          newCatalogIds.clear();
          void api.save({ seenCatalogIds: allIds }).then((u) => { if (u) data = u; }).catch(() => {});
        } else {
          const seenSet = new Set(seenList);
          newCatalogIds = new Set(allIds.filter((id) => !seenSet.has(id)));
          storeNoticeDismissed = false;
        }
        renderNoticeBar();
        if (activePage === "store") renderStore();
        if (force) {
          say(catalogOffline ? `离线目录缓存（${catalogItems.length} 项）` : `已刷新在线目录（${catalogItems.length} 项）`);
        }
      } else if (force) {
        say(res?.reason === "connection" ? "连接 GitHub 目录失败，请检查网络或代理" : "目录加载失败");
      }
    } catch {}
  }

  bindAll();
  if (window.location.hash) {
    showPage(window.location.hash, { renderPage: false });
  }
  render();

  api.subscribe((next) => {
    if (!next) return;
    data = next;
    render();
  });
  api.onNavigate((page) => showPage(page));

  // Reveal painted window immediately, then stagger background IPC cleanly.
  requestAnimationFrame(() => {
    void api.command("settings-ready");
    setTimeout(() => {
      void loadCatalog();
      void api.host("diagnose").then((res) => {
        if (res?.diagnostic) {
          data.hostDiagnostic = res.diagnostic;
          if (activePage === "link") renderLinkPage();
        }
      }).catch(() => {});
      void api.host("get-startup").then((res) => {
        if (res?.startup) {
          startup = res.startup;
          if (activePage === "link") renderLinkPage();
        }
      }).catch(() => {});
      if (data.settings?.autoUpdateCheck !== false) {
        setTimeout(() => {
          void api.online("check", false).then((res) => {
            if (res?.status === "available" && res.latest) {
              updateNotice = res;
              renderNoticeBar();
            }
          }).catch(() => {});
        }, 250);
      }
    }, 0);
  });
})();
