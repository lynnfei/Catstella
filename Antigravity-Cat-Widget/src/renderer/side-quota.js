(function (root) {
  "use strict";

  const VARIANT_BASE_SIZE = {
    arc: { width: 40, height: 94 },
    ring: { width: 60, height: 60 },
    bar: { width: 26, height: 82 }
  };

  const SIDE_DISTANCE_GAPS = {
    compact: 2,
    normal: 10,
    relaxed: 20
  };

  const SIDE_SIZE_FACTORS = {
    sm: 0.86,
    md: 1,
    lg: 1.14
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finitePct(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return Math.round(clamp(value, 0, 100));
  }

  function levelForPercent(pct) {
    if (typeof pct !== "number" || !Number.isFinite(pct)) return "unknown";
    if (pct <= 15) return "critical";
    if (pct <= 30) return "low";
    return "normal";
  }

  function worstLevel(fiveHour, weekly) {
    const order = { unknown: 0, normal: 1, low: 2, critical: 3 };
    const l5 = levelForPercent(fiveHour);
    const l1 = levelForPercent(weekly);
    return order[l1] > order[l5] ? l1 : l5;
  }

  function isUsedMode(mode) {
    return mode === "used";
  }

  function toDisplayPercent(remainingPct, mode = "remaining") {
    const pct = finitePct(remainingPct);
    if (pct === null) return null;
    return isUsedMode(mode) ? 100 - pct : pct;
  }

  function formatPctText(pct) {
    return typeof pct === "number" && Number.isFinite(pct) ? `${Math.round(pct)}%` : "—";
  }

  function formatResetLabel(resetAt, fallback = "等待刷新") {
    if (!resetAt) return fallback;
    if (typeof resetAt === "string") {
      const ms = Date.parse(resetAt);
      if (Number.isFinite(ms)) return formatResetLabel(ms, fallback);
      return resetAt.trim() || fallback;
    }
    if (typeof resetAt === "number" && Number.isFinite(resetAt)) {
      const diff = resetAt - Date.now();
      if (diff <= 0) return "已到刷新窗口";
      const totalMins = Math.ceil(diff / 60_000);
      const days = Math.floor(totalMins / 1440);
      const hours = Math.floor((totalMins % 1440) / 60);
      const mins = totalMins % 60;
      if (days > 0) return `${days}d ${hours}h 后重置`;
      if (hours > 0) return `${hours}h ${mins}m 后重置`;
      return `${mins}m 后重置`;
    }
    return fallback;
  }

  function resolveSideQuotaMetrics(snapshot = {}) {
    const s = snapshot.settings || {};
    const q = snapshot.quotaWindows || {};
    const gData = q.gemini || q;
    const isArgon = Boolean(q.modelInfo?.modelName?.toLowerCase().includes("argon"));
    const manual = s.manualQuota === true;

    const agyFive = manual
      ? finitePct(s.manualPercent)
      : finitePct(isArgon ? (q.argon?.fiveHour ?? gData?.fiveHour ?? q.fiveHour) : (gData?.fiveHour ?? q.fiveHour));
    const agyWeek = manual
      ? finitePct(s.manualWeeklyPercent)
      : finitePct(isArgon ? (q.argon?.weekly ?? gData?.weekly ?? q.weekly) : (gData?.weekly ?? q.weekly));

    const agyResets = isArgon ? (q.argon?.fiveHourReset || gData?.fiveHourReset || q.fiveHourReset || q.argon?.resetsAt || q.resetsAt) : (gData?.fiveHourReset || q.fiveHourReset || q.resetsAt);
    const agyWeekResets = isArgon ? (q.argon?.weeklyReset || q.argon?.weeklyResetsAt || gData?.weeklyReset || q.weeklyReset || q.weeklyResetsAt) : (gData?.weeklyReset || q.weeklyReset || q.weeklyResetsAt);

    const wc = snapshot.webCompanion || {};
    const wq = wc.quota || null;
    const webFive = wq
      ? (finitePct(wq.fiveHourRemainingPct) ?? (finitePct(wq.fiveHourUsedPct) !== null ? 100 - finitePct(wq.fiveHourUsedPct) : null))
      : null;
    const webWeek = wq
      ? (finitePct(wq.weeklyRemainingPct) ?? (finitePct(wq.weeklyUsedPct) !== null ? 100 - finitePct(wq.weeklyUsedPct) : null) ?? finitePct(wq.dailyRemainingPct))
      : null;

    const hasAgy = agyFive !== null || agyWeek !== null || manual;
    const hasWeb = webFive !== null || webWeek !== null;
    const pref = ["auto", "agy", "web"].includes(s.sideQuotaSource) ? s.sideQuotaSource : "auto";

    let source = "agy";
    if (pref === "web") {
      source = "web";
    } else if (pref === "auto") {
      if (s.bubblePage === "webQuota" && hasWeb) source = "web";
      else if (!hasAgy && (hasWeb || wc.online)) source = "web";
    }

    const mode = s.sideQuotaMode === "used" ? "used" : "remaining";

    if (source === "web") {
      const modelLabel = wq?.lastModel || (wc.online ? "Gemini Web" : "Web 缓存");
      const sourceBadge = wc.online
        ? (isUsedMode(mode) ? "Web · 已用" : "Web · 剩余")
        : (wq ? (isUsedMode(mode) ? "缓存 · 已用" : "缓存 · 剩余") : "Web 未连接");
      return {
        source: "web",
        sourceBadge,
        modelLabel: wq?.displaySource === "official" ? `${modelLabel} · 官方` : modelLabel,
        fiveHour: webFive,
        weekly: webWeek,
        fiveHourReset: wq?.resetHint || (wc.online ? "实时同步" : "等待同步"),
        weeklyReset: wq?.weeklyResetHint || (wq?.dailyTotal ? `今日 ${wq.dailyTotal} 次` : (wq?.resetHint || "等待同步")),
        metricMode: mode
      };
    }

    const agyModel = q.modelInfo?.modelName || (manual ? "手动记录" : "Antigravity");
    const thinkingRaw = q.modelInfo?.thinkingLevel || q.modelInfo?.thinking;
    const thinking = thinkingRaw && thinkingRaw !== "默认" ? ` · ${thinkingRaw}` : "";
    return {
      source: "agy",
      sourceBadge: manual
        ? (isUsedMode(mode) ? "手动 · 已用" : "手动 · 剩余")
        : (q.online ? (isUsedMode(mode) ? "AGY · 已用" : "AGY · 剩余") : "本机读取"),
      modelLabel: `${agyModel}${thinking}`,
      fiveHour: agyFive,
      weekly: agyWeek,
      fiveHourReset: manual ? "手动额度兜底" : formatResetLabel(agyResets, agyFive === null ? "尚未读取真实额度" : "本机实时窗口"),
      weeklyReset: manual ? "手动额度兜底" : formatResetLabel(agyWeekResets, agyWeek === null ? "尚未读取周周期" : "本机周窗口"),
      metricMode: mode
    };
  }

  function computeSidePlacement({
    viewport,
    pet,
    variant = "arc",
    prevSide,
    preferredSide = "left",
    isDragging = false,
    sideDistance = "normal",
    sideSize = "md",
    edgeMargin = 6,
    bottomReserved = 6
  }) {
    const sizeFactor = SIDE_SIZE_FACTORS[sideSize] || 1;
    const petFactor = clamp(pet.scale / 220, 0.78, 1.18);
    const gaugeScale = clamp(petFactor * sizeFactor, 0.7, 1.32);
    const base = VARIANT_BASE_SIZE[variant] || VARIANT_BASE_SIZE.arc;
    const widget = {
      width: Math.round(base.width * gaugeScale),
      height: Math.round(base.height * gaugeScale),
      scale: Number(gaugeScale.toFixed(3))
    };

    const baseGap = SIDE_DISTANCE_GAPS[sideDistance] ?? SIDE_DISTANCE_GAPS.normal;
    const sideGap = Math.round(baseGap * petFactor);
    const leftRoom = pet.x - edgeMargin;
    const rightRoom = viewport.width - (pet.x + pet.scale) - edgeMargin;
    const needed = widget.width + sideGap;
    const deadZone = isDragging ? 44 : 18;

    let side = prevSide === "right" || prevSide === "left"
      ? prevSide
      : (preferredSide === "right" ? "right" : "left");

    if (side === "right" && rightRoom < needed && leftRoom >= needed) {
      side = "left";
    } else if (side === "left" && leftRoom < needed && rightRoom >= needed) {
      side = "right";
    } else if (side === "right" && leftRoom - rightRoom > deadZone) {
      side = "left";
    } else if (side === "left" && rightRoom - leftRoom > deadZone) {
      side = "right";
    } else if (Math.abs(leftRoom - rightRoom) <= deadZone && (preferredSide === "left" || preferredSide === "right")) {
      const prefRoom = preferredSide === "right" ? rightRoom : leftRoom;
      const altRoom = preferredSide === "right" ? leftRoom : rightRoom;
      if (prefRoom >= needed || prefRoom >= altRoom - 4) {
        side = preferredSide;
      }
    }

    const chosenRoom = side === "right" ? rightRoom : leftRoom;
    const maxY = Math.max(edgeMargin, viewport.height - widget.height - edgeMargin - bottomReserved);
    const preferredY = clamp(pet.y + pet.scale * 0.22, edgeMargin, maxY);

    let x;
    let y = preferredY;
    let layoutMode = "side-normal";

    if (chosenRoom >= widget.width + sideGap) {
      layoutMode = "side-normal";
      x = side === "right"
        ? pet.x + pet.scale + sideGap
        : pet.x - sideGap - widget.width;
    } else if (chosenRoom >= widget.width + 2) {
      layoutMode = "side-tucked";
      x = side === "right"
        ? viewport.width - edgeMargin - widget.width
        : edgeMargin;
    } else {
      layoutMode = "corner-avoid";
      x = side === "right"
        ? viewport.width - edgeMargin - widget.width
        : edgeMargin;
      if (pet.y >= widget.height * 0.56 + edgeMargin) {
        y = Math.max(edgeMargin, pet.y - widget.height * 0.45);
      } else {
        y = clamp(pet.y + pet.scale - widget.height, edgeMargin, maxY);
      }
    }

    x = clamp(Math.round(x), edgeMargin, Math.max(edgeMargin, viewport.width - widget.width - edgeMargin));
    y = clamp(Math.round(y), edgeMargin, maxY);

    return {
      side,
      x,
      y,
      widget,
      layoutMode,
      leftRoom: Math.round(leftRoom),
      rightRoom: Math.round(rightRoom)
    };
  }

  function paletteStops(level) {
    if (level === "critical") return ["var(--sq-tier-crit-1)", "var(--sq-tier-crit-2)", "var(--sq-tier-crit-2)"];
    if (level === "low") return ["var(--sq-tier-low-1)", "var(--sq-tier-low-2)", "var(--sq-tier-low-2)"];
    return ["var(--sq-grad-start)", "var(--sq-grad-mid)", "var(--sq-grad-end)"];
  }

  function createGaugeMarkup(variant, uid) {
    if (variant === "ring") {
      return `
        <div class="gauge-root gauge-ring-wrap" data-variant="ring">
          <svg class="gauge-svg" viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
            <defs>
              <linearGradient id="${uid}-ring-g5" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
                <stop offset="0%" class="g5-s0" stop-color="var(--sq-grad-start)"/>
                <stop offset="55%" class="g5-s1" stop-color="var(--sq-grad-mid)"/>
                <stop offset="100%" class="g5-s2" stop-color="var(--sq-grad-end)"/>
              </linearGradient>
              <linearGradient id="${uid}-ring-g1" x1="16" y1="16" x2="48" y2="48" gradientUnits="userSpaceOnUse">
                <stop offset="0%" class="g1-s0" stop-color="#87c8ff"/>
                <stop offset="100%" class="g1-s1" stop-color="#e9a4f2"/>
              </linearGradient>
              <linearGradient id="${uid}-star-f" x1="24" y1="24" x2="40" y2="40" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#fff8d6"/>
                <stop offset="50%" stop-color="#9ad5ff"/>
                <stop offset="100%" stop-color="#efb2f5"/>
              </linearGradient>
              <pattern id="${uid}-stripe" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <rect width="3" height="6" fill="rgba(182, 150, 238, 0.45)"/>
              </pattern>
            </defs>
            <circle class="gauge-critical-halo" cx="32" cy="32" r="29" fill="none" stroke="var(--sq-tier-crit-2)" stroke-width="2" opacity="0"/>
            <circle cx="32" cy="32" r="28" fill="var(--sq-glass-bg)" stroke="var(--sq-glass-border)" stroke-width="1.4"/>
            <circle cx="32" cy="32" r="24" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="5"/>
            <circle class="gauge-ring-stripe" cx="32" cy="32" r="24" fill="none" stroke="url(#${uid}-stripe)" stroke-width="5" opacity="0"/>
            <circle class="gauge-ring-ghost" cx="32" cy="32" r="24" fill="none" stroke="#fff3d6" stroke-opacity="0.45" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 32 32)"/>
            <circle class="gauge-ring-fill" cx="32" cy="32" r="24" fill="none" stroke="url(#${uid}-ring-g5)" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 32 32)"/>
            <circle cx="32" cy="32" r="16.2" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"/>
            <circle class="gauge-ring-fill-1w" cx="32" cy="32" r="16.2" fill="none" stroke="url(#${uid}-ring-g1)" stroke-width="3" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 32 32)"/>
            <circle class="gauge-ring-tip" cx="32" cy="8" r="2.7" fill="#fff7d6" stroke="var(--sq-rim)" stroke-width="0.9" opacity="0"/>
            <g class="gauge-star-gem">
              <path class="star-body" d="M32 23.2 34.4 29.6 40.8 32 34.4 34.4 32 40.8 29.6 34.4 23.2 32 29.6 29.6Z" fill="url(#${uid}-star-f)" stroke="#d8b263" stroke-width="1.2" stroke-linejoin="round"/>
            </g>
            <g class="gauge-status-pip" opacity="0">
              <rect x="44" y="4" width="16" height="14" rx="7" fill="#23183d" stroke="#ffd88d" stroke-width="1.1"/>
              <text class="gauge-status-glyph" x="52" y="13.8" text-anchor="middle" font-size="9.5" font-weight="800" fill="#ffe9ad">!</text>
            </g>
          </svg>
        </div>`;
    }

    if (variant === "bar") {
      return `
        <div class="gauge-root gauge-bar-wrap" data-variant="bar">
          <svg class="gauge-svg" viewBox="0 0 28 88" width="100%" height="100%" aria-hidden="true">
            <defs>
              <linearGradient id="${uid}-bar-g5" x1="0" y1="78" x2="0" y2="20" gradientUnits="userSpaceOnUse">
                <stop offset="0%" class="g5-s0" stop-color="var(--sq-grad-start)"/>
                <stop offset="55%" class="g5-s1" stop-color="var(--sq-grad-mid)"/>
                <stop offset="100%" class="g5-s2" stop-color="var(--sq-grad-end)"/>
              </linearGradient>
              <linearGradient id="${uid}-bar-g1" x1="0" y1="78" x2="0" y2="20" gradientUnits="userSpaceOnUse">
                <stop offset="0%" class="g1-s0" stop-color="#87c8ff"/>
                <stop offset="100%" class="g1-s1" stop-color="#eba5ee"/>
              </linearGradient>
              <linearGradient id="${uid}-bar-star" x1="8" y1="3" x2="20" y2="15" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#fff8d6"/>
                <stop offset="55%" stop-color="#9ad5ff"/>
                <stop offset="100%" stop-color="#efb2f5"/>
              </linearGradient>
              <pattern id="${uid}-bar-stripe" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <rect width="3" height="6" fill="rgba(182, 150, 238, 0.45)"/>
              </pattern>
              <clipPath id="${uid}-bar-clip5">
                <rect x="6.5" y="21" width="7.5" height="58" rx="3.75"/>
              </clipPath>
              <clipPath id="${uid}-bar-clip1">
                <rect x="16.5" y="21" width="4" height="58" rx="2"/>
              </clipPath>
            </defs>
            <rect class="gauge-critical-halo" x="2.5" y="17" width="23" height="66" rx="11.5" fill="none" stroke="var(--sq-tier-crit-2)" stroke-width="1.8" opacity="0"/>
            <rect x="3.5" y="18" width="21" height="64" rx="10.5" fill="var(--sq-glass-bg)" stroke="var(--sq-glass-border)" stroke-width="1.35"/>
            <rect x="6.5" y="21" width="7.5" height="58" rx="3.75" fill="rgba(255,255,255,0.12)"/>
            <rect class="gauge-bar-stripe" x="6.5" y="21" width="7.5" height="58" rx="3.75" fill="url(#${uid}-bar-stripe)" opacity="0"/>
            <rect x="16.5" y="21" width="4" height="58" rx="2" fill="rgba(255,255,255,0.1)"/>
            <g clip-path="url(#${uid}-bar-clip5)">
              <rect class="gauge-bar-ghost" x="6.5" y="21" width="7.5" height="58" fill="#fff3d6" fill-opacity="0.45"/>
              <rect class="gauge-bar-fill" x="6.5" y="21" width="7.5" height="58" fill="url(#${uid}-bar-g5)"/>
            </g>
            <g clip-path="url(#${uid}-bar-clip1)">
              <rect class="gauge-bar-fill-1w" x="16.5" y="21" width="4" height="58" fill="url(#${uid}-bar-g1)"/>
            </g>
            <line x1="6.5" y1="35.5" x2="14" y2="35.5" stroke="rgba(255,255,255,0.28)" stroke-width="0.8"/>
            <line x1="6.5" y1="50" x2="14" y2="50" stroke="rgba(255,255,255,0.34)" stroke-width="0.8"/>
            <line x1="6.5" y1="64.5" x2="14" y2="64.5" stroke="rgba(255,255,255,0.28)" stroke-width="0.8"/>
            <g class="gauge-star-gem">
              <path class="star-body" d="M14 2.5 16.3 8.2 22 10.5 16.3 12.8 14 18.5 11.7 12.8 6 10.5 11.7 8.2Z" fill="url(#${uid}-bar-star)" stroke="#d8b263" stroke-width="1.2" stroke-linejoin="round"/>
            </g>
            <g class="gauge-status-pip" opacity="0">
              <rect x="6" y="73" width="16" height="13" rx="6.5" fill="#23183d" stroke="#ffd88d" stroke-width="1.1"/>
              <text class="gauge-status-glyph" x="14" y="82.3" text-anchor="middle" font-size="9" font-weight="800" fill="#ffe9ad">!</text>
            </g>
          </svg>
        </div>`;
    }

    return `
      <div class="gauge-root gauge-arc-wrap" data-variant="arc" data-side="left">
        <svg class="gauge-svg" viewBox="0 0 44 104" width="100%" height="100%" aria-hidden="true">
          <defs>
            <linearGradient id="${uid}-arc-g5" x1="12" y1="92" x2="28" y2="16" gradientUnits="userSpaceOnUse">
              <stop offset="0%" class="g5-s0" stop-color="var(--sq-grad-start)"/>
              <stop offset="55%" class="g5-s1" stop-color="var(--sq-grad-mid)"/>
              <stop offset="100%" class="g5-s2" stop-color="var(--sq-grad-end)"/>
            </linearGradient>
            <linearGradient id="${uid}-arc-g1" x1="8" y1="84" x2="18" y2="26" gradientUnits="userSpaceOnUse">
              <stop offset="0%" class="g1-s0" stop-color="#87c8ff"/>
              <stop offset="100%" class="g1-s1" stop-color="#eba5ee"/>
            </linearGradient>
            <linearGradient id="${uid}-arc-star" x1="4" y1="8" x2="18" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#fff8d6"/>
              <stop offset="55%" stop-color="#9ad5ff"/>
              <stop offset="100%" stop-color="#efb2f5"/>
            </linearGradient>
            <pattern id="${uid}-arc-stripe" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <rect width="3" height="6" fill="rgba(182, 150, 238, 0.48)"/>
            </pattern>
          </defs>
          <g class="gauge-arc-mirror">
            <path class="gauge-critical-halo" d="M 12 94 Q 37 54 12 16" fill="none" stroke="var(--sq-tier-crit-2)" stroke-width="16.5" stroke-linecap="round" opacity="0"/>
            <path d="M 11 94 Q 36 54 11 16" fill="none" stroke="var(--sq-glass-border)" stroke-width="13.5" stroke-linecap="round"/>
            <path d="M 11 94 Q 36 54 11 16" fill="none" stroke="var(--sq-glass-bg)" stroke-width="11" stroke-linecap="round"/>
            <path class="gauge-arc-track5" d="M 13 92 Q 35 54 13 18" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="5.2" stroke-linecap="round"/>
            <path class="gauge-arc-stripe" d="M 13 92 Q 35 54 13 18" fill="none" stroke="url(#${uid}-arc-stripe)" stroke-width="5.2" stroke-linecap="round" opacity="0"/>
            <path class="gauge-arc-ghost" d="M 13 92 Q 35 54 13 18" fill="none" stroke="#fff3d6" stroke-opacity="0.46" stroke-width="5.2" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
            <path class="gauge-arc-fill" d="M 13 92 Q 35 54 13 18" fill="none" stroke="url(#${uid}-arc-g5)" stroke-width="5.2" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
            <path d="M 8 83 Q 22 54 8 27" fill="none" stroke="rgba(255,255,255,0.11)" stroke-width="2.6" stroke-linecap="round"/>
            <path class="gauge-arc-fill-1w" d="M 8 83 Q 22 54 8 27" fill="none" stroke="url(#${uid}-arc-g1)" stroke-width="2.6" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
            <circle class="gauge-arc-tip" cx="13" cy="18" r="2.7" fill="#fff7d6" stroke="var(--sq-rim)" stroke-width="0.9" opacity="0"/>
            <g class="gauge-star-gem">
              <path class="star-body" d="M12 5.5 14.5 12 21 14.5 14.5 17 12 23.5 9.5 17 3 14.5 9.5 12Z" fill="url(#${uid}-arc-star)" stroke="#d8b263" stroke-width="1.2" stroke-linejoin="round"/>
            </g>
          </g>
          <g class="gauge-status-pip" opacity="0">
            <rect x="14" y="84" width="16" height="14" rx="7" fill="#23183d" stroke="#ffd88d" stroke-width="1.1"/>
            <text class="gauge-status-glyph" x="22" y="93.8" text-anchor="middle" font-size="9.5" font-weight="800" fill="#ffe9ad">!</text>
          </g>
        </svg>
      </div>`;
  }

  function updateGaugeMount(mountEl, variant, uid, data) {
    if (mountEl.dataset.mountedVariant !== variant) {
      mountEl.dataset.mountedVariant = variant;
      mountEl.innerHTML = createGaugeMarkup(variant, uid);
    }
    const rootEl = mountEl.querySelector(".gauge-root");
    if (!rootEl) return;

    const { fiveHour, weekly, ghost5h, quotaMode, side, draining, surging } = data;
    const disp5 = toDisplayPercent(fiveHour, quotaMode);
    const disp1 = toDisplayPercent(weekly, quotaMode);
    const dispG5 = toDisplayPercent(ghost5h, quotaMode);

    const known5h = disp5 !== null;
    const known1w = disp1 !== null;
    const l5 = levelForPercent(fiveHour);
    const l1 = levelForPercent(weekly);
    const worst = worstLevel(fiveHour, weekly);

    rootEl.dataset.side = side || "left";
    rootEl.dataset.quotaMode = quotaMode || "remaining";
    rootEl.dataset.surging = String(Boolean(surging));
    rootEl.dataset.level = worst;
    rootEl.dataset.critical = String(worst === "critical");
    rootEl.dataset.normal = String(worst === "normal");

    const stops5 = paletteStops(l5);
    rootEl.querySelector(".g5-s0")?.setAttribute("stop-color", stops5[0]);
    rootEl.querySelector(".g5-s1")?.setAttribute("stop-color", stops5[1]);
    rootEl.querySelector(".g5-s2")?.setAttribute("stop-color", stops5[2]);

    const stops1 = l1 === "critical"
      ? ["var(--sq-tier-crit-1)", "var(--sq-tier-crit-2)"]
      : l1 === "low"
        ? ["var(--sq-tier-low-1)", "var(--sq-tier-low-2)"]
        : ["#87c8ff", "#eba5ee"];
    rootEl.querySelector(".g1-s0")?.setAttribute("stop-color", stops1[0]);
    rootEl.querySelector(".g1-s1")?.setAttribute("stop-color", stops1[1]);

    const pip = rootEl.querySelector(".gauge-status-pip");
    const glyph = rootEl.querySelector(".gauge-status-glyph");
    if (pip && glyph) {
      if (l5 === "unknown") {
        pip.setAttribute("opacity", "1");
        glyph.textContent = "—";
      } else if (worst === "critical") {
        pip.setAttribute("opacity", "1");
        glyph.textContent = !isUsedMode(quotaMode) && fiveHour === 0 ? "0" : "!";
      } else if (worst === "low") {
        pip.setAttribute("opacity", "1");
        glyph.textContent = "!";
      } else {
        pip.setAttribute("opacity", "0");
      }
    }

    const p5 = known5h ? clamp(disp5, 0, 100) : 0;
    const p1 = known1w ? clamp(disp1, 0, 100) : 0;
    const g5 = dispG5 !== null ? clamp(dispG5, 0, 100) : p5;

    if (variant === "ring") {
      const fill5 = rootEl.querySelector(".gauge-ring-fill");
      const ghostEl = rootEl.querySelector(".gauge-ring-ghost");
      const fill1 = rootEl.querySelector(".gauge-ring-fill-1w");
      const stripe = rootEl.querySelector(".gauge-ring-stripe");
      const tip = rootEl.querySelector(".gauge-ring-tip");
      stripe?.setAttribute("opacity", known5h ? "0" : "1");
      if (fill5) fill5.style.strokeDashoffset = String(100 - p5);
      if (ghostEl) {
        ghostEl.style.transitionDelay = draining ? "90ms" : "0ms";
        ghostEl.style.strokeDashoffset = String(100 - (known5h ? g5 : 0));
      }
      if (fill1) fill1.style.strokeDashoffset = String(100 - p1);
      if (tip) {
        if (!known5h || p5 <= 1) {
          tip.setAttribute("opacity", "0");
        } else {
          const angle = (-90 + (p5 / 100) * 360) * (Math.PI / 180);
          tip.setAttribute("cx", (32 + Math.cos(angle) * 24).toFixed(2));
          tip.setAttribute("cy", (32 + Math.sin(angle) * 24).toFixed(2));
          tip.setAttribute("opacity", "1");
        }
      }
    } else if (variant === "bar") {
      const fill5 = rootEl.querySelector(".gauge-bar-fill");
      const ghostEl = rootEl.querySelector(".gauge-bar-ghost");
      const fill1 = rootEl.querySelector(".gauge-bar-fill-1w");
      const stripe = rootEl.querySelector(".gauge-bar-stripe");
      stripe?.setAttribute("opacity", known5h ? "0" : "1");
      if (fill5) fill5.style.transform = `scaleY(${(p5 / 100).toFixed(3)})`;
      if (ghostEl) {
        ghostEl.style.transitionDelay = draining ? "90ms" : "0ms";
        ghostEl.style.transform = `scaleY(${((known5h ? g5 : 0) / 100).toFixed(3)})`;
      }
      if (fill1) {
        fill1.style.transformBox = "fill-box";
        fill1.style.transformOrigin = "bottom center";
        fill1.style.transition = "transform 160ms ease-out";
        fill1.style.transform = `scaleY(${(p1 / 100).toFixed(3)})`;
      }
    } else {
      const mirrorGroup = rootEl.querySelector(".gauge-arc-mirror");
      if (mirrorGroup) {
        mirrorGroup.setAttribute("transform", side === "left" ? "translate(44 0) scale(-1 1)" : "");
      }
      const pipGroup = rootEl.querySelector(".gauge-status-pip");
      if (pipGroup) {
        pipGroup.setAttribute("transform", side === "left" ? "translate(-10 0)" : "");
      }
      const fill5 = rootEl.querySelector(".gauge-arc-fill");
      const ghostEl = rootEl.querySelector(".gauge-arc-ghost");
      const fill1 = rootEl.querySelector(".gauge-arc-fill-1w");
      const stripe = rootEl.querySelector(".gauge-arc-stripe");
      const tip = rootEl.querySelector(".gauge-arc-tip");
      stripe?.setAttribute("opacity", known5h ? "0" : "1");
      if (fill5) fill5.style.strokeDashoffset = String(100 - p5);
      if (ghostEl) {
        ghostEl.style.transitionDelay = draining ? "90ms" : "0ms";
        ghostEl.style.strokeDashoffset = String(100 - (known5h ? g5 : 0));
      }
      if (fill1) fill1.style.strokeDashoffset = String(100 - p1);
      if (tip && fill5 && typeof fill5.getTotalLength === "function") {
        if (!known5h || p5 <= 1) {
          tip.setAttribute("opacity", "0");
        } else {
          const total = fill5.getTotalLength();
          const pt = fill5.getPointAtLength(total * (p5 / 100));
          tip.setAttribute("cx", pt.x.toFixed(2));
          tip.setAttribute("cy", pt.y.toFixed(2));
          tip.setAttribute("opacity", "1");
        }
      }
    }
  }

  class SideQuotaController {
    constructor({ container, mascot, onOpenQuota }) {
      this.container = container;
      this.mascot = mascot;
      this.onOpenQuota = onOpenQuota;
      this.prevSide = null;
      this.lastPlacement = null;
      this.prevFiveHour = null;
      this.prevSourceKey = "";
      this.ghost5h = null;
      this.draining = false;
      this.surging = false;
      this.ghostTimer = 0;
      this.tipHoverTrigger = false;
      this.tipHoverBox = false;
      this.tipFocused = false;
      this.tipSuppressedByEsc = false;
      this.tipOpen = false;
      this.tipHideTimer = 0;
      this.tipLeaveTimer = 0;
      this.recentPointerDownAt = 0;
      this.lastState = null;

      this._buildDom();
      this._bindEvents();
    }

    _buildDom() {
      const slot = document.createElement("aside");
      slot.id = "side-widget-slot";
      slot.className = "side-widget-slot";
      slot.dataset.suppressed = "true";
      slot.dataset.side = "left";
      slot.dataset.flipAnimate = "false";
      slot.setAttribute("aria-label", "额度耐力挂件");

      const shell = document.createElement("div");
      shell.className = "side-widget-shell";

      const trigger = document.createElement("button");
      trigger.id = "side-widget-trigger";
      trigger.type = "button";
      trigger.className = "side-widget-trigger";
      trigger.setAttribute("aria-describedby", "side-widget-tooltip");
      trigger.setAttribute("aria-label", "查看额度耐力");

      const visual = document.createElement("div");
      visual.id = "side-widget-visual";
      visual.className = "side-widget-visual";
      trigger.appendChild(visual);
      shell.appendChild(trigger);
      slot.appendChild(shell);

      const tooltip = document.createElement("div");
      tooltip.id = "side-widget-tooltip";
      tooltip.className = "quota-tooltip";
      tooltip.setAttribute("role", "tooltip");
      tooltip.hidden = true;
      tooltip.dataset.open = "false";
      tooltip.innerHTML = `
        <div class="quota-tooltip__head">
          <strong class="quota-tooltip__model" id="sq-tip-model">Antigravity</strong>
          <span class="quota-tooltip__badge" id="sq-tip-badge">AGY · 剩余</span>
        </div>
        <div class="quota-tooltip__rows">
          <div class="quota-tooltip__row" id="sq-tip-row-5h" data-level="unknown">
            <div class="quota-tooltip__row-top">
              <span class="quota-tooltip__window" id="sq-tip-window-5h">5 小时剩余</span>
              <strong class="quota-tooltip__pct" id="sq-tip-pct-5h">—</strong>
            </div>
            <div class="quota-tooltip__bar"><span class="quota-tooltip__fill" id="sq-tip-fill-5h"></span></div>
            <div class="quota-tooltip__reset" id="sq-tip-reset-5h">—</div>
          </div>
          <div class="quota-tooltip__row" id="sq-tip-row-1w" data-level="unknown">
            <div class="quota-tooltip__row-top">
              <span class="quota-tooltip__window" id="sq-tip-window-1w">1 周剩余</span>
              <strong class="quota-tooltip__pct" id="sq-tip-pct-1w">—</strong>
            </div>
            <div class="quota-tooltip__bar"><span class="quota-tooltip__fill" id="sq-tip-fill-1w"></span></div>
            <div class="quota-tooltip__reset" id="sq-tip-reset-1w">—</div>
          </div>
        </div>
        <div class="quota-tooltip__foot" id="sq-tip-foot">点击展开完整气泡 · Esc 关闭</div>`;

      this.container.appendChild(slot);
      this.container.appendChild(tooltip);

      this.slot = slot;
      this.trigger = trigger;
      this.visual = visual;
      this.tooltip = tooltip;
    }

    _syncHoverVisual() {
      if (this.trigger) {
        this.trigger.dataset.hovered = String(Boolean(this.tipHoverTrigger));
      }
    }

    _scheduleTooltipLeave(source = "both") {
      clearTimeout(this.tipLeaveTimer);
      if (source === "trigger" || source === "both") {
        this.trigger.dataset.hovered = "false";
      }
      this.tipLeaveTimer = setTimeout(() => {
        this.tipLeaveTimer = 0;
        if (source === "trigger") this.tipHoverTrigger = false;
        else if (source === "box") this.tipHoverBox = false;
        else {
          this.tipHoverTrigger = false;
          this.tipHoverBox = false;
        }
        this._syncHoverVisual();
        this.syncTooltipVisibility();
      }, 120);
    }

    handleExternalLeave(immediate = false) {
      if (this.trigger) this.trigger.dataset.hovered = "false";
      if (!this.tipHoverTrigger && !this.tipHoverBox) return;
      if (immediate) {
        clearTimeout(this.tipLeaveTimer);
        this.tipLeaveTimer = 0;
        this.tipHoverTrigger = false;
        this.tipHoverBox = false;
        this._syncHoverVisual();
        this.syncTooltipVisibility(true);
        return;
      }
      if (!this.tipLeaveTimer) this._scheduleTooltipLeave("both");
    }

    handleExternalHoverCheck(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const el = document.elementFromPoint(x, y);
      const overTrigger = Boolean(el && this.trigger.contains(el));
      const overBox = Boolean(el && this.tooltip.contains(el));
      if (!overTrigger && !overBox) return;
      clearTimeout(this.tipLeaveTimer);
      this.tipLeaveTimer = 0;
      this.tipHoverTrigger = overTrigger;
      this.tipHoverBox = overBox;
      if (overTrigger) this.tipSuppressedByEsc = false;
      this._syncHoverVisual();
      this.syncTooltipVisibility();
    }

    _bindEvents() {
      this.trigger.addEventListener("pointerdown", () => {
        this.recentPointerDownAt = Date.now();
      });
      this.trigger.addEventListener("pointerenter", () => {
        clearTimeout(this.tipLeaveTimer);
        this.tipLeaveTimer = 0;
        this.tipHoverTrigger = true;
        this.tipSuppressedByEsc = false;
        this._syncHoverVisual();
        this.syncTooltipVisibility();
      });
      this.trigger.addEventListener("pointermove", () => {
        if (this.tipHoverTrigger) return;
        const s = this.lastState;
        if (!s || s.suppressed || s.dragging || s.clickThrough) return;
        clearTimeout(this.tipLeaveTimer);
        this.tipLeaveTimer = 0;
        this.tipHoverTrigger = true;
        this.tipSuppressedByEsc = false;
        this._syncHoverVisual();
        this.syncTooltipVisibility();
      });
      this.trigger.addEventListener("pointerleave", () => {
        this._scheduleTooltipLeave("trigger");
      });
      this.tooltip.addEventListener("pointerenter", () => {
        clearTimeout(this.tipLeaveTimer);
        this.tipLeaveTimer = 0;
        this.tipHoverBox = true;
        this.syncTooltipVisibility();
      });
      this.tooltip.addEventListener("pointermove", () => {
        if (this.tipHoverBox || !this.tipOpen) return;
        clearTimeout(this.tipLeaveTimer);
        this.tipLeaveTimer = 0;
        this.tipHoverBox = true;
        this.syncTooltipVisibility();
      });
      this.tooltip.addEventListener("pointerleave", () => {
        this._scheduleTooltipLeave("box");
      });
      document.addEventListener("pointermove", (event) => {
        if (!this.tipHoverTrigger && !this.tipHoverBox) return;
        const el = Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
          ? document.elementFromPoint(event.clientX, event.clientY)
          : event.target;
        const overTrigger = Boolean(el && this.trigger.contains(el));
        const overBox = Boolean(el && this.tooltip.contains(el));
        if (!overTrigger && this.tipHoverTrigger) {
          this.trigger.dataset.hovered = "false";
        }
        if (overTrigger || overBox) return;
        if (el && el.closest && el.closest("#motion, #bubble, .widget-tools")) {
          clearTimeout(this.tipLeaveTimer);
          this.tipLeaveTimer = 0;
          this.tipHoverTrigger = false;
          this.tipHoverBox = false;
          this._syncHoverVisual();
          this.syncTooltipVisibility();
          return;
        }
        if (!this.tipLeaveTimer) this._scheduleTooltipLeave("both");
      });
      document.addEventListener("mouseleave", () => {
        this.handleExternalLeave();
      });
      window.addEventListener("blur", () => {
        this.handleExternalLeave(true);
      });
      this.trigger.addEventListener("focusin", () => {
        if (Date.now() - this.recentPointerDownAt < 400 && !this.trigger.matches(":focus-visible")) {
          return;
        }
        this.tipFocused = true;
        this.tipSuppressedByEsc = false;
        this.syncTooltipVisibility();
      });
      this.trigger.addEventListener("focusout", () => {
        this.tipFocused = false;
        this.tipSuppressedByEsc = false;
        this.syncTooltipVisibility();
      });
      this.trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!this.lastState || this.lastState.suppressed) return;
        this.tipFocused = false;
        this.dismissTooltip(true, true);
        if (typeof this.onOpenQuota === "function") {
          this.onOpenQuota(this.lastState.metrics.source);
        }
      });
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this.tipOpen) {
          this.dismissTooltip(true);
        }
      });
      window.addEventListener("resize", () => this.refreshLayout());
    }

    dismissTooltip(suppressedByEsc = false, immediate = false) {
      if (suppressedByEsc) this.tipSuppressedByEsc = true;
      this.tipHoverTrigger = false;
      this.tipHoverBox = false;
      this._syncHoverVisual();
      this.syncTooltipVisibility(immediate);
    }

    _positionTooltip() {
      const placement = this.lastPlacement;
      if (!placement) return;
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const tipW = this.tooltip.offsetWidth || 244;
      const tipH = this.tooltip.offsetHeight || 168;
      const margin = 8;
      const gap = 8;

      const wLeft = placement.x;
      const wRight = placement.x + placement.widget.width;
      const wCenterY = placement.y + placement.widget.height / 2;

      let tipSide = placement.side;
      let tx;
      let ty = clamp(wCenterY - tipH / 2, margin, Math.max(margin, vpH - tipH - margin));

      if (placement.side === "right" && wRight + gap + tipW <= vpW - margin) {
        tx = wRight + gap;
        tipSide = "right";
      } else if (placement.side === "left" && wLeft - gap - tipW >= margin) {
        tx = wLeft - gap - tipW;
        tipSide = "left";
      } else if (placement.y >= tipH + gap + margin) {
        tipSide = "top";
        tx = clamp(placement.x + placement.widget.width / 2 - tipW / 2, margin, Math.max(margin, vpW - tipW - margin));
        ty = placement.y - tipH - gap;
      } else if (placement.y + placement.widget.height + gap + tipH <= vpH - margin) {
        tipSide = "bottom";
        tx = clamp(placement.x + placement.widget.width / 2 - tipW / 2, margin, Math.max(margin, vpW - tipW - margin));
        ty = placement.y + placement.widget.height + gap;
      } else {
        tipSide = placement.side === "right" ? "right" : "left";
        tx = clamp(placement.x + placement.widget.width / 2 - tipW / 2, margin, Math.max(margin, vpW - tipW - margin));
        ty = clamp(margin, margin, Math.max(margin, vpH - tipH - margin));
      }

      this.tooltip.dataset.tipSide = tipSide;
      this.tooltip.style.setProperty("--tip-x", `${Math.round(tx)}px`);
      this.tooltip.style.setProperty("--tip-y", `${Math.round(ty)}px`);
    }

    _syncTooltipContent() {
      if (!this.lastState) return;
      const { metrics, quotaMode } = this.lastState;
      const used = isUsedMode(quotaMode);
      const $ = (id) => this.tooltip.querySelector(`#${id}`);
      $("sq-tip-model").textContent = metrics.modelLabel;
      $("sq-tip-badge").textContent = metrics.sourceBadge;
      $("sq-tip-window-5h").textContent = used ? "5 小时已用" : "5 小时剩余";
      $("sq-tip-window-1w").textContent = used ? "1 周已用" : "1 周剩余";
      $("sq-tip-foot").textContent = used
        ? "Web 正向已用口径 · 点击看详情"
        : "点击展开完整气泡 · Esc 关闭";

      for (const [suffix, val, reset] of [
        ["5h", metrics.fiveHour, metrics.fiveHourReset],
        ["1w", metrics.weekly, metrics.weeklyReset]
      ]) {
        const disp = toDisplayPercent(val, quotaMode);
        const known = disp !== null;
        const lvl = levelForPercent(val);
        const row = $(`sq-tip-row-${suffix}`);
        if (row) row.dataset.level = lvl;
        $(`sq-tip-pct-${suffix}`).textContent = formatPctText(disp);
        $(`sq-tip-fill-${suffix}`).style.width = known ? `${disp}%` : "0%";
        $(`sq-tip-reset-${suffix}`).textContent = reset;
      }
    }

    syncTooltipVisibility(immediate = false) {
      const state = this.lastState;
      const allowed = Boolean(state && !state.suppressed && !state.dragging && !state.clickThrough && !this.tipSuppressedByEsc);
      const wantOpen = allowed && (this.tipHoverTrigger || this.tipHoverBox || this.tipFocused);

      if (wantOpen === this.tipOpen) {
        if (wantOpen) {
          this._syncTooltipContent();
          this._positionTooltip();
        } else if (immediate || !allowed) {
          clearTimeout(this.tipHideTimer);
          this.tooltip.hidden = true;
        }
        return;
      }

      clearTimeout(this.tipHideTimer);
      this.tipOpen = wantOpen;
      if (wantOpen) {
        this._syncTooltipContent();
        this.tooltip.hidden = false;
        this.tooltip.classList.add("interactive");
        this._positionTooltip();
        requestAnimationFrame(() => {
          if (this.tipOpen) this.tooltip.dataset.open = "true";
        });
      } else {
        this.tooltip.dataset.open = "false";
        this.tooltip.classList.remove("interactive");
        const exitMs = (immediate || !allowed || state?.reducedMotion) ? 0 : 160;
        if (exitMs === 0) {
          this.tooltip.hidden = true;
        } else {
          this.tipHideTimer = setTimeout(() => {
            if (!this.tipOpen) this.tooltip.hidden = true;
          }, exitMs);
        }
      }
    }

    refreshLayout() {
      if (!this.lastState) return;
      const { variant, sideDistance, sideSize, dragging, suppressed, reducedMotion } = this.lastState;
      const petRect = this.mascot.getBoundingClientRect();
      if (!petRect.width || !petRect.height) return;

      const facing = this.mascot.dataset.facing || "right";
      const preferredSide = facing === "left" ? "right" : "left";
      const placement = computeSidePlacement({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        pet: {
          x: petRect.left,
          y: petRect.top,
          scale: Math.round(petRect.width)
        },
        variant,
        prevSide: this.prevSide,
        preferredSide,
        isDragging: dragging,
        sideDistance,
        sideSize
      });

      const sideChanged = this.prevSide && this.prevSide !== placement.side;
      this.prevSide = placement.side;
      this.lastPlacement = placement;

      this.slot.dataset.side = placement.side;
      this.slot.dataset.layoutMode = placement.layoutMode;
      this.slot.dataset.flipAnimate = String(Boolean(sideChanged && !dragging && !reducedMotion && !suppressed));
      this.slot.style.setProperty("--gauge-scale", String(placement.widget.scale));
      this.slot.style.transform = `translate3d(${placement.x}px, ${placement.y}px, 0)`;

      updateGaugeMount(this.visual, variant, "cat-sq", {
        fiveHour: this.lastState.metrics.fiveHour,
        weekly: this.lastState.metrics.weekly,
        ghost5h: this.ghost5h,
        quotaMode: this.lastState.quotaMode,
        side: placement.side,
        draining: this.draining,
        surging: this.surging
      });

      if (this.tipOpen) this._positionTooltip();
    }

    update({ snapshot, mainBubbleVisible, dragging, artReady }) {
      const s = snapshot?.settings || {};
      const enabled = s.sideQuotaEnabled !== false;
      const variant = ["arc", "ring", "bar"].includes(s.sideQuotaVariant) ? s.sideQuotaVariant : "arc";
      const sideDistance = ["compact", "normal", "relaxed"].includes(s.sideQuotaDistance) ? s.sideQuotaDistance : "normal";
      const sideSize = ["sm", "md", "lg"].includes(s.sideQuotaSize) ? s.sideQuotaSize : "md";
      const quotaMode = s.sideQuotaMode === "used" ? "used" : "remaining";
      const reducedMotion = Boolean(s.reducedMotion || (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches));
      const clickThrough = Boolean(s.clickThrough);
      const suppressed = !enabled || Boolean(mainBubbleVisible) || !artReady;

      const theme = snapshot?.dreamSkin?.themePreset;
      if (["violet", "pink", "ocean", "onyx"].includes(theme)) {
        document.body.dataset.theme = theme;
      } else {
        delete document.body.dataset.theme;
      }
      document.body.dataset.reducedMotion = String(Boolean(s.reducedMotion));

      const metrics = resolveSideQuotaMetrics(snapshot);
      const sourceKey = `${metrics.source}:${quotaMode}`;
      if (this.prevSourceKey !== sourceKey) {
        this.prevSourceKey = sourceKey;
        this.prevFiveHour = metrics.fiveHour;
        this.ghost5h = metrics.fiveHour;
        this.draining = false;
        this.surging = false;
      } else if (typeof metrics.fiveHour === "number" && typeof this.prevFiveHour === "number") {
        const delta = metrics.fiveHour - this.prevFiveHour;
        if (delta < 0) {
          this.ghost5h = isUsedMode(quotaMode) ? metrics.fiveHour : this.prevFiveHour;
          this.draining = true;
          this.surging = isUsedMode(quotaMode);
          clearTimeout(this.ghostTimer);
          this.ghostTimer = setTimeout(() => {
            this.ghost5h = metrics.fiveHour;
            this.draining = false;
            this.surging = false;
            this.refreshLayout();
          }, 420);
        } else {
          this.ghost5h = metrics.fiveHour;
          this.draining = false;
          this.surging = false;
        }
        this.prevFiveHour = metrics.fiveHour;
      } else {
        this.prevFiveHour = metrics.fiveHour;
        this.ghost5h = metrics.fiveHour;
      }

      this.slot.hidden = !enabled || !artReady;
      this.slot.dataset.suppressed = String(suppressed);
      this.slot.dataset.dragging = String(Boolean(dragging));
      this.slot.dataset.clickThrough = String(clickThrough);

      const interactiveActive = enabled && artReady && !suppressed && !dragging && !clickThrough;
      this.trigger.inert = !interactiveActive;
      this.trigger.tabIndex = interactiveActive ? 0 : -1;
      this.trigger.classList.toggle("interactive", interactiveActive);

      const used = isUsedMode(quotaMode);
      const disp5 = toDisplayPercent(metrics.fiveHour, quotaMode);
      const disp1 = toDisplayPercent(metrics.weekly, quotaMode);
      const metricWord = used ? "已用" : "剩余";
      this.trigger.setAttribute(
        "aria-label",
        `${metrics.sourceBadge}：5小时${metricWord} ${formatPctText(disp5)}，1周${metricWord} ${formatPctText(disp1)}`
      );

      if (!interactiveActive && (this.tipOpen || !this.tooltip.hidden)) {
        this.tipFocused = false;
        this.dismissTooltip(false, true);
      }

      this.lastState = {
        variant,
        sideDistance,
        sideSize,
        quotaMode,
        reducedMotion,
        clickThrough,
        dragging: Boolean(dragging),
        suppressed,
        metrics
      };

      if (enabled && artReady) {
        this.refreshLayout();
      }
      if (this.tipOpen) {
        this._syncTooltipContent();
        this._positionTooltip();
      }
    }
  }

  const api = {
    VARIANT_BASE_SIZE,
    SIDE_DISTANCE_GAPS,
    SIDE_SIZE_FACTORS,
    levelForPercent,
    worstLevel,
    toDisplayPercent,
    formatPctText,
    resolveSideQuotaMetrics,
    computeSidePlacement,
    updateGaugeMount,
    SideQuotaController
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CatstellaSideQuota = api;
})(typeof window === "object" ? window : globalThis);
