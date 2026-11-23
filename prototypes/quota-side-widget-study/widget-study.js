(() => {
  "use strict";

  // =========================================================================
  // 1. Catstella Data Presets, Assets & Appearance Tokens
  // =========================================================================
  const QUOTA_PRESETS = {
    abundant: {
      id: "abundant",
      label: "充沛 84%",
      usedLabel: "充裕 16%",
      modelName: "Gemini 3.8 Flash",
      thinking: "High",
      fiveHour: 84,
      weekly: 72,
      fiveHourReset: "2小时15分钟后重置",
      weeklyReset: "4天3小时后重置"
    },
    steady: {
      id: "steady",
      label: "稳健 52%",
      usedLabel: "半程 48%",
      modelName: "Gemini 3.8 Flash",
      thinking: "High",
      fiveHour: 52,
      weekly: 61,
      fiveHourReset: "1小时40分钟后重置",
      weeklyReset: "3天18小时后重置"
    },
    low: {
      id: "low",
      label: "偏低 24%",
      usedLabel: "偏高 76%",
      modelName: "Gemini 3.8 Pro",
      thinking: "High",
      fiveHour: 24,
      weekly: 48,
      fiveHourReset: "48分钟后重置",
      weeklyReset: "2天9小时后重置"
    },
    critical: {
      id: "critical",
      label: "告急 8%",
      usedLabel: "告急 92%",
      modelName: "Gemini 3.8 Pro",
      thinking: "Extended",
      fiveHour: 8,
      weekly: 19,
      fiveHourReset: "14分钟后重置",
      weeklyReset: "1天2小时后重置"
    },
    "weekly-tight": {
      id: "weekly-tight",
      label: "周限紧 76/9%",
      usedLabel: "周限紧 24/91%",
      modelName: "Gemini 3.8 Flash",
      thinking: "Medium",
      fiveHour: 76,
      weekly: 9,
      fiveHourReset: "3小时5分钟后重置",
      weeklyReset: "16小时后重置"
    },
    empty: {
      id: "empty",
      label: "耗尽 0%",
      usedLabel: "打满 100%",
      modelName: "Gemini 3.8 Pro",
      thinking: "High",
      fiveHour: 0,
      weekly: 14,
      fiveHourReset: "32分钟后重置",
      weeklyReset: "2天1小时后重置"
    },
    unknown: {
      id: "unknown",
      label: "未读取 —",
      usedLabel: "未读取 —",
      modelName: "Gemini Models",
      thinking: "默认",
      fiveHour: null,
      weekly: null,
      fiveHourReset: "尚未读取重置窗口",
      weeklyReset: "尚未读取重置窗口"
    }
  };

  const CHARACTER_PACKS = {
    "gemini-star-v1": {
      name: "星语",
      base: "../../Antigravity-Cat-Widget/assets/character-packs/gemini-star-v1/frames/",
      files: {
        idle: "idle.png",
        blink: "blink.png",
        proud: "proud-v3.png",
        shy: "shy.png",
        angry: "sad.png"
      }
    },
    "lin-cat": {
      name: "霓音",
      base: "../../Antigravity-Cat-Widget/assets/character-packs/lin-cat/frames/",
      files: {
        idle: "idle.png",
        blink: "blink.png",
        proud: "proud.png",
        shy: "shy.png",
        angry: "sad.png"
      }
    }
  };

  const CHATTER_LINES = [
    "星星也会休息，本喵刚刚替它值了会儿班。",
    "少熬夜！才不是担心你呢。",
    "凌晨的灵感很贵，明天的黑眼圈更贵。",
    "本喵悄悄记下了一个愿望：晚饭多一条鱼。",
    "刚整理了猫耳朵，灵感的接收信号满格。"
  ];

  const VARIANT_BASE_SIZE = {
    ring: { width: 60, height: 60 },
    bar: { width: 26, height: 82 },
    arc: { width: 40, height: 94 }
  };

  const SIDE_DISTANCE_GAPS = {
    compact: 2,
    normal: 10,
    relaxed: 20
  };

  const SIDE_SIZE_FACTORS = {
    sm: 0.86,
    md: 1.0,
    lg: 1.14
  };

  // =========================================================================
  // 2. Application State
  // =========================================================================
  const state = {
    variant: "arc",
    pack: "gemini-star-v1",
    theme: "violet",
    backdrop: "ide",
    scale: 220,
    sideDistance: "normal",
    sideSize: "md",

    // Quota state
    quotaMode: "remaining", // "remaining" (AGY 剩余) | "used" (Web 正向已用)
    presetId: "abundant",
    modelName: QUOTA_PRESETS.abundant.modelName,
    thinking: QUOTA_PRESETS.abundant.thinking,
    fiveHour: QUOTA_PRESETS.abundant.fiveHour,
    weekly: QUOTA_PRESETS.abundant.weekly,
    fiveHourReset: QUOTA_PRESETS.abundant.fiveHourReset,
    weeklyReset: QUOTA_PRESETS.abundant.weeklyReset,
    ghost5h: QUOTA_PRESETS.abundant.fiveHour,
    ghost1w: QUOTA_PRESETS.abundant.weekly,
    trailMode: "idle", // "idle" | "drain" | "surge"
    visual5hOverride: null,

    // Pet & bubble state
    petX: null,
    petY: null,
    facing: "left",
    side: "left",
    bubbleOpen: false,
    bubblePage: "quota", // "quota" | "talk"
    bubbleTemp: null, // null | { kind: "chatter" | "turncost", title, body, detail, meta }
    dragging: false,
    reducedMotion: false,
    clickThrough: false,
    hitbox: false,

    // Tooltip state
    tipOpen: false,
    tipHoverTrigger: false,
    tipHoverBox: false,
    tipFocused: false,
    tipSuppressedByEsc: false,

    // Runtime timers & logs
    chatterIndex: 0,
    stressRunning: false
  };

  const timers = {
    bubbleAutoHide: null,
    bubbleExitCleanup: null,
    tempMessage: null,
    tipLeave: null,
    blink: null,
    expression: null,
    drain: null,
    stress: []
  };

  // =========================================================================
  // 3. DOM References
  // =========================================================================
  const $ = (id) => document.getElementById(id);
  const stageViewport = $("stage-viewport");
  const petAnchor = $("pet-anchor");
  const mascot = $("mascot");
  const motion = $("motion");
  const bubble = $("bubble");
  const sideSlot = $("side-widget-slot");
  const sideTrigger = $("side-widget-trigger");
  const sideVisual = $("side-widget-visual");
  const tooltip = $("side-widget-tooltip");
  const stressLog = $("stress-log");

  const range5h = $("range-5h");
  const range1w = $("range-1w");
  const lbl5h = $("lbl-5h");
  const lbl1w = $("lbl-1w");

  // =========================================================================
  // 4. Pure Helpers: Quota Levels, Geometry & Side Placement Solver
  // =========================================================================
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function levelForPercent(pct) {
    if (typeof pct !== "number" || !Number.isFinite(pct)) return "unknown";
    if (pct <= 10) return "critical";
    if (pct <= 30) return "low";
    return "normal";
  }

  function worstLevel(fiveHour, weekly) {
    const order = { unknown: 0, normal: 1, low: 2, critical: 3 };
    const l5 = levelForPercent(fiveHour);
    const l1 = levelForPercent(weekly);
    if (l5 === "unknown" && l1 === "unknown") return "unknown";
    return order[l1] > order[l5] ? l1 : l5;
  }

  function formatPctText(pct) {
    return typeof pct === "number" && Number.isFinite(pct) ? `${Math.round(pct)}%` : "—";
  }

  function isUsedMode(mode = state.quotaMode) {
    return mode === "used";
  }

  function toDisplayPercent(remainingPct, mode = state.quotaMode) {
    if (typeof remainingPct !== "number" || !Number.isFinite(remainingPct)) return null;
    const clamped = clamp(remainingPct, 0, 100);
    return isUsedMode(mode) ? 100 - clamped : clamped;
  }

  function fromDisplayPercent(displayPct, mode = state.quotaMode) {
    if (typeof displayPct !== "number" || !Number.isFinite(displayPct)) return null;
    const clamped = clamp(displayPct, 0, 100);
    return isUsedMode(mode) ? 100 - clamped : clamped;
  }

  /**
   * Reusable placement solver for Catstella desktop production handoff.
   * Picks the roomier horizontal side with hysteresis, respects viewport bounds,
   * avoids overlapping .widget-tools or face center, and falls back to corner-avoid on narrow panes.
   */
  function computeSidePlacement({
    viewport,
    pet,
    variant,
    prevSide,
    isDragging,
    sideDistance = "normal",
    sideSize = "md",
    bottomReserved = 12
  }) {
    const sizeFactor = SIDE_SIZE_FACTORS[sideSize] || 1;
    const petFactor = clamp(pet.scale / 220, 0.78, 1.18);
    const gaugeScale = clamp(petFactor * sizeFactor, 0.7, 1.32);
    const base = VARIANT_BASE_SIZE[variant] || VARIANT_BASE_SIZE.arc;
    const widget = {
      width: Math.round(base.width * gaugeScale),
      height: Math.round(base.height * gaugeScale),
      scale: gaugeScale
    };

    const edgeMargin = 10;
    const baseGap = SIDE_DISTANCE_GAPS[sideDistance] ?? SIDE_DISTANCE_GAPS.normal;
    const sideGap = Math.round(baseGap * petFactor);
    const leftRoom = pet.x - edgeMargin;
    const rightRoom = viewport.width - (pet.x + pet.scale) - edgeMargin;
    const needed = widget.width + sideGap;
    const deadZone = isDragging ? 44 : 18;

    let side = prevSide === "right" ? "right" : "left";
    if (side === "right" && rightRoom < needed && leftRoom >= needed) {
      side = "left";
    } else if (side === "left" && leftRoom < needed && rightRoom >= needed) {
      side = "right";
    } else if (side === "right" && leftRoom - rightRoom > deadZone) {
      side = "left";
    } else if (side === "left" && rightRoom - leftRoom > deadZone) {
      side = "right";
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
      // Elevate above outer shoulder if headroom exists; otherwise hug outer lower edge
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

  // =========================================================================
  // 5. Star-Crystal SVG Gauge Builders & Updaters (All 3 Variants)
  // =========================================================================
  const SVG_NS = "http://www.w3.org/2000/svg";

  function paletteStops(level) {
    if (level === "critical") return ["var(--tier-crit-1)", "var(--tier-crit-2)", "var(--tier-crit-2)"];
    if (level === "low") return ["var(--tier-low-1)", "var(--tier-low-2)", "var(--tier-low-2)"];
    return ["var(--cat-grad-start)", "var(--cat-grad-mid)", "var(--cat-grad-end)"];
  }

  function createGaugeMarkup(variant, uid) {
    if (variant === "ring") {
      return `
        <div class="gauge-root gauge-ring-wrap" data-variant="ring">
          <svg class="gauge-svg" viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
            <defs>
              <linearGradient id="${uid}-ring-g5" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
                <stop offset="0%" class="g5-s0" stop-color="var(--cat-grad-start)"/>
                <stop offset="55%" class="g5-s1" stop-color="var(--cat-grad-mid)"/>
                <stop offset="100%" class="g5-s2" stop-color="var(--cat-grad-end)"/>
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
            <circle class="gauge-critical-halo" cx="32" cy="32" r="29" fill="none" stroke="var(--tier-crit-2)" stroke-width="2" opacity="0"/>
            <circle cx="32" cy="32" r="28" fill="var(--cat-glass-bg)" stroke="var(--cat-glass-border)" stroke-width="1.4"/>
            <circle cx="32" cy="32" r="24" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="5"/>
            <circle class="gauge-ring-stripe" cx="32" cy="32" r="24" fill="none" stroke="url(#${uid}-stripe)" stroke-width="5" opacity="0"/>
            <circle class="gauge-ring-ghost" cx="32" cy="32" r="24" fill="none" stroke="#fff3d6" stroke-opacity="0.45" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 32 32)"/>
            <circle class="gauge-ring-fill" cx="32" cy="32" r="24" fill="none" stroke="url(#${uid}-ring-g5)" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="16" transform="rotate(-90 32 32)"/>

            <circle cx="32" cy="32" r="16.2" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"/>
            <circle class="gauge-ring-fill-1w" cx="32" cy="32" r="16.2" fill="none" stroke="url(#${uid}-ring-g1)" stroke-width="3" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="28" transform="rotate(-90 32 32)"/>

            <circle class="gauge-ring-tip" cx="32" cy="8" r="2.7" fill="#fff7d6" stroke="var(--cat-rim)" stroke-width="0.9"/>

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
                <stop offset="0%" class="g5-s0" stop-color="var(--cat-grad-start)"/>
                <stop offset="55%" class="g5-s1" stop-color="var(--cat-grad-mid)"/>
                <stop offset="100%" class="g5-s2" stop-color="var(--cat-grad-end)"/>
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
            <rect class="gauge-critical-halo" x="2.5" y="17" width="23" height="66" rx="11.5" fill="none" stroke="var(--tier-crit-2)" stroke-width="1.8" opacity="0"/>
            <rect x="3.5" y="18" width="21" height="64" rx="10.5" fill="var(--cat-glass-bg)" stroke="var(--cat-glass-border)" stroke-width="1.35"/>

            <!-- Tracks -->
            <rect x="6.5" y="21" width="7.5" height="58" rx="3.75" fill="rgba(255,255,255,0.12)"/>
            <rect class="gauge-bar-stripe" x="6.5" y="21" width="7.5" height="58" rx="3.75" fill="url(#${uid}-bar-stripe)" opacity="0"/>
            <rect x="16.5" y="21" width="4" height="58" rx="2" fill="rgba(255,255,255,0.1)"/>

            <!-- 5h Ghost & Fill -->
            <g clip-path="url(#${uid}-bar-clip5)">
              <rect class="gauge-bar-ghost" x="6.5" y="21" width="7.5" height="58" fill="#fff3d6" fill-opacity="0.45"/>
              <rect class="gauge-bar-fill" x="6.5" y="21" width="7.5" height="58" fill="url(#${uid}-bar-g5)"/>
            </g>

            <!-- 1w Companion Bar -->
            <g clip-path="url(#${uid}-bar-clip1)">
              <rect class="gauge-bar-fill-1w" x="16.5" y="21" width="4" height="58" fill="url(#${uid}-bar-g1)"/>
            </g>

            <!-- Subtle glass tick marks -->
            <line x1="6.5" y1="35.5" x2="14" y2="35.5" stroke="rgba(255,255,255,0.28)" stroke-width="0.8"/>
            <line x1="6.5" y1="50" x2="14" y2="50" stroke="rgba(255,255,255,0.34)" stroke-width="0.8"/>
            <line x1="6.5" y1="64.5" x2="14" y2="64.5" stroke="rgba(255,255,255,0.28)" stroke-width="0.8"/>

            <!-- Top Star Finial -->
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

    // Variant: arc (Genshin-inspired Star-Track Crescent)
    return `
      <div class="gauge-root gauge-arc-wrap" data-variant="arc" data-side="left">
        <svg class="gauge-svg" viewBox="0 0 44 104" width="100%" height="100%" aria-hidden="true">
          <defs>
            <linearGradient id="${uid}-arc-g5" x1="12" y1="92" x2="28" y2="16" gradientUnits="userSpaceOnUse">
              <stop offset="0%" class="g5-s0" stop-color="var(--cat-grad-start)"/>
              <stop offset="55%" class="g5-s1" stop-color="var(--cat-grad-mid)"/>
              <stop offset="100%" class="g5-s2" stop-color="var(--cat-grad-end)"/>
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
            <!-- Frosted crescent housing -->
            <path class="gauge-critical-halo" d="M 12 94 Q 37 54 12 16" fill="none" stroke="var(--tier-crit-2)" stroke-width="16.5" stroke-linecap="round" opacity="0"/>
            <path d="M 11 94 Q 36 54 11 16" fill="none" stroke="var(--cat-glass-border)" stroke-width="13.5" stroke-linecap="round"/>
            <path d="M 11 94 Q 36 54 11 16" fill="none" stroke="var(--cat-glass-bg)" stroke-width="11" stroke-linecap="round"/>

            <!-- 5h Outer Crescent Track, Stripe, Ghost & Fill -->
            <path class="gauge-arc-track5" d="M 13 92 Q 35 54 13 18" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="5.2" stroke-linecap="round"/>
            <path class="gauge-arc-stripe" d="M 13 92 Q 35 54 13 18" fill="none" stroke="url(#${uid}-arc-stripe)" stroke-width="5.2" stroke-linecap="round" opacity="0"/>
            <path class="gauge-arc-ghost" d="M 13 92 Q 35 54 13 18" fill="none" stroke="#fff3d6" stroke-opacity="0.46" stroke-width="5.2" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
            <path class="gauge-arc-fill" d="M 13 92 Q 35 54 13 18" fill="none" stroke="url(#${uid}-arc-g5)" stroke-width="5.2" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="16"/>

            <!-- 1w Inner Companion Arc -->
            <path d="M 8 83 Q 22 54 8 27" fill="none" stroke="rgba(255,255,255,0.11)" stroke-width="2.6" stroke-linecap="round"/>
            <path class="gauge-arc-fill-1w" d="M 8 83 Q 22 54 8 27" fill="none" stroke="url(#${uid}-arc-g1)" stroke-width="2.6" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="28"/>

            <!-- Active frontier starlight bead -->
            <circle class="gauge-arc-tip" cx="13" cy="18" r="2.7" fill="#fff7d6" stroke="var(--cat-rim)" stroke-width="0.9"/>

            <!-- Top Apex 4-Pointed Star Crystal -->
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

  function ensureGaugeMounted(mountEl, variant, uid) {
    if (mountEl.dataset.mountedVariant === variant) return;
    mountEl.dataset.mountedVariant = variant;
    mountEl.innerHTML = createGaugeMarkup(variant, uid);
  }

  function updateGaugeMount(mountEl, variant, uid, data) {
    ensureGaugeMounted(mountEl, variant, uid);
    const root = mountEl.querySelector(".gauge-root");
    if (!root) return;

    const { fiveHour, weekly, fill5h, fill1w, ghost5h, quotaMode, side, draining, surging } = data;
    const disp5 = fill5h !== undefined ? fill5h : toDisplayPercent(fiveHour, quotaMode);
    const disp1 = fill1w !== undefined ? fill1w : toDisplayPercent(weekly, quotaMode);
    const dispG5 = toDisplayPercent(ghost5h, quotaMode);

    const known5h = typeof disp5 === "number" && Number.isFinite(disp5);
    const known1w = typeof disp1 === "number" && Number.isFinite(disp1);
    const l5 = levelForPercent(fiveHour);
    const l1 = levelForPercent(weekly);
    const worst = worstLevel(fiveHour, weekly);

    root.dataset.side = side || "left";
    root.dataset.quotaMode = quotaMode || "remaining";
    root.dataset.surging = String(Boolean(surging));
    root.dataset.level = worst;
    root.dataset.critical = String(worst === "critical");
    root.dataset.normal = String(worst === "normal");

    // Color gradients for 5h and 1w separately so bottlenecks stay visible
    const stops5 = paletteStops(l5);
    root.querySelector(".g5-s0")?.setAttribute("stop-color", stops5[0]);
    root.querySelector(".g5-s1")?.setAttribute("stop-color", stops5[1]);
    root.querySelector(".g5-s2")?.setAttribute("stop-color", stops5[2]);

    const stops1 = l1 === "critical"
      ? ["var(--tier-crit-1)", "var(--tier-crit-2)"]
      : l1 === "low"
        ? ["var(--tier-low-1)", "var(--tier-low-2)"]
        : ["#87c8ff", "#eba5ee"];
    root.querySelector(".g1-s0")?.setAttribute("stop-color", stops1[0]);
    root.querySelector(".g1-s1")?.setAttribute("stop-color", stops1[1]);

    // Status pip (non-color accessibility indicator for low / critical / unknown / empty)
    const pip = root.querySelector(".gauge-status-pip");
    const glyph = root.querySelector(".gauge-status-glyph");
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
    const g5 = typeof dispG5 === "number" && Number.isFinite(dispG5) ? clamp(dispG5, 0, 100) : p5;

    if (variant === "ring") {
      const fill5 = root.querySelector(".gauge-ring-fill");
      const ghostEl = root.querySelector(".gauge-ring-ghost");
      const fill1 = root.querySelector(".gauge-ring-fill-1w");
      const stripe = root.querySelector(".gauge-ring-stripe");
      const tip = root.querySelector(".gauge-ring-tip");

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
      const fill5 = root.querySelector(".gauge-bar-fill");
      const ghostEl = root.querySelector(".gauge-bar-ghost");
      const fill1 = root.querySelector(".gauge-bar-fill-1w");
      const stripe = root.querySelector(".gauge-bar-stripe");

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
      // Arc variant
      const mirrorGroup = root.querySelector(".gauge-arc-mirror");
      if (mirrorGroup) {
        mirrorGroup.setAttribute("transform", side === "left" ? "translate(44 0) scale(-1 1)" : "");
      }
      const pipGroup = root.querySelector(".gauge-status-pip");
      if (pipGroup) {
        pipGroup.setAttribute("transform", side === "left" ? "translate(-10 0)" : "");
      }
      const fill5 = root.querySelector(".gauge-arc-fill");
      const ghostEl = root.querySelector(".gauge-arc-ghost");
      const fill1 = root.querySelector(".gauge-arc-fill-1w");
      const stripe = root.querySelector(".gauge-arc-stripe");
      const tip = root.querySelector(".gauge-arc-tip");

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

  // =========================================================================
  // 6. Pet Artwork, Blink & Expressions
  // =========================================================================
  function syncArtwork(packId) {
    const pack = CHARACTER_PACKS[packId] || CHARACTER_PACKS["gemini-star-v1"];
    const map = {
      ".agy-frame--idle": pack.base + pack.files.idle,
      ".agy-frame--blink": pack.base + pack.files.blink,
      ".agy-expression--proud": pack.base + pack.files.proud,
      ".agy-expression--shy": pack.base + pack.files.shy,
      ".agy-expression--angry": pack.base + pack.files.angry
    };
    for (const [sel, src] of Object.entries(map)) {
      const img = mascot.querySelector(sel);
      if (img && img.getAttribute("src") !== src) img.src = src;
    }
    mascot.dataset.artReady = "true";

    // Sync 3-way comparison mini-pet thumbnails
    document.querySelectorAll(".compare-pet-img").forEach((img) => {
      if (img.getAttribute("src") !== pack.base + pack.files.idle) {
        img.src = pack.base + pack.files.idle;
      }
    });
  }

  function showExpression(kind, duration = 2200) {
    clearTimeout(timers.expression);
    mascot.dataset.expression = kind;
    timers.expression = setTimeout(() => {
      delete mascot.dataset.expression;
    }, duration);
  }

  function scheduleBlink() {
    clearTimeout(timers.blink);
    mascot.dataset.blink = "false";
    if (state.reducedMotion) return;
    timers.blink = setTimeout(() => {
      if (!mascot.dataset.expression && !state.reducedMotion) {
        mascot.dataset.blink = "true";
        setTimeout(() => {
          mascot.dataset.blink = "false";
          scheduleBlink();
        }, 140);
      } else {
        scheduleBlink();
      }
    }, 3600 + Math.random() * 2800);
  }

  // =========================================================================
  // 7. Bubble, Auto-Chatter & Side Widget Synchronization
  // =========================================================================
  function isMainBubbleVisible() {
    return state.bubbleOpen || state.bubbleTemp !== null;
  }

  function armBubbleAutoHide() {
    clearTimeout(timers.bubbleAutoHide);
    if (!state.bubbleOpen || state.bubbleTemp) return;
    timers.bubbleAutoHide = setTimeout(() => {
      state.bubbleOpen = false;
      render();
    }, 6500);
  }

  function renderBubble() {
    const visible = isMainBubbleVisible();
    clearTimeout(timers.bubbleExitCleanup);
    bubble.inert = !visible;
    bubble.setAttribute("aria-hidden", String(!visible));

    if (visible) {
      bubble.hidden = false;
      void bubble.offsetWidth;
      bubble.dataset.open = "true";
    } else {
      bubble.dataset.open = "false";
      const exitMs = state.reducedMotion ? 0 : 180;
      timers.bubbleExitCleanup = setTimeout(() => {
        if (!isMainBubbleVisible()) bubble.hidden = true;
      }, exitMs);
    }

    const qView = $("bubble-quota-view");
    const tView = $("bubble-talk-view");
    const nView = $("bubble-notice-view");
    qView.hidden = true;
    tView.hidden = true;
    nView.hidden = true;

    if (state.bubbleTemp) {
      $("bubble-title").textContent = state.bubbleTemp.title;
      if (state.bubbleTemp.kind === "chatter") {
        tView.hidden = false;
        tView.textContent = state.bubbleTemp.body;
      } else {
        nView.hidden = false;
        $("bubble-notice-value").textContent = state.bubbleTemp.body;
        $("bubble-notice-detail").textContent = state.bubbleTemp.detail;
        $("bubble-notice-meta").textContent = state.bubbleTemp.meta;
      }
      return;
    }

    if (state.bubblePage === "talk") {
      $("bubble-title").textContent = "喵言喵语";
      tView.hidden = false;
      tView.textContent = CHATTER_LINES[state.chatterIndex % CHATTER_LINES.length];
      $("bubble-page-num").textContent = "2 / 2";
    } else {
      $("bubble-title").textContent = isUsedMode() ? "Gemini Web 用量" : "Gemini Models";
      qView.hidden = false;
      $("bubble-model-name").textContent = state.modelName;
      $("bubble-thinking").textContent = "思考: " + state.thinking;

      $("bubble-label-5h").textContent = isUsedMode() ? "5 小时已用" : "5 小时剩余";
      $("bubble-label-1w").textContent = isUsedMode() ? "1 周已用" : "1 周剩余";
      $("bubble-caption").textContent = isUsedMode() ? "演示 · Web 端正向已用计量" : "演示 · 模拟剩余额度";

      for (const [suffix, val, reset, periodAria] of [
        ["5h", state.fiveHour, state.fiveHourReset, "五小时"],
        ["1w", state.weekly, state.weeklyReset, "一周"]
      ]) {
        const disp = toDisplayPercent(val);
        const known = typeof disp === "number" && Number.isFinite(disp);
        const lvl = levelForPercent(val);
        const track = $("bubble-track-" + suffix);
        const fill = $("bubble-fill-" + suffix);
        $("bubble-percent-" + suffix).textContent = formatPctText(disp);
        $("bubble-reset-" + suffix).textContent = reset;
        track.dataset.known = String(known);
        track.dataset.level = lvl;
        track.setAttribute("aria-label", `${periodAria}${isUsedMode() ? "已用用量" : "剩余额度"}`);
        fill.style.width = known ? `${disp}%` : "100%";
        if (known) track.setAttribute("aria-valuenow", String(Math.round(disp)));
        else track.removeAttribute("aria-valuenow");
      }
      $("bubble-page-num").textContent = "1 / 2";
    }
  }

  function openBubble(page = "quota") {
    clearTimeout(timers.tempMessage);
    state.bubbleTemp = null;
    state.bubblePage = page;
    state.bubbleOpen = true;
    dismissTooltip(true);
    armBubbleAutoHide();
    render();
  }

  function closeBubble() {
    clearTimeout(timers.bubbleAutoHide);
    clearTimeout(timers.tempMessage);
    state.bubbleTemp = null;
    state.bubbleOpen = false;
    render();
  }

  function triggerChatter() {
    clearTimeout(timers.tempMessage);
    clearTimeout(timers.bubbleAutoHide);
    state.bubbleOpen = false;
    state.chatterIndex = (state.chatterIndex + 1) % CHATTER_LINES.length;
    state.bubbleTemp = {
      kind: "chatter",
      title: "喵言喵语 · 自动碎碎念",
      body: CHATTER_LINES[state.chatterIndex]
    };
    dismissTooltip(true);
    render();
    logStatus("触发自动碎碎念（4.5s 后自动收起并渐显旁侧挂件）。");
    timers.tempMessage = setTimeout(() => {
      state.bubbleTemp = null;
      render();
      logStatus("碎碎念收起完成，旁侧挂件自然渐显恢复交互。");
    }, 4500);
  }

  function triggerTurnCost() {
    clearTimeout(timers.tempMessage);
    clearTimeout(timers.bubbleAutoHide);
    state.bubbleOpen = false;
    state.bubbleTemp = {
      kind: "turncost",
      title: "模型步骤完成",
      body: "1,420 tokens",
      detail: "输入 880 · 输出 540",
      meta: "演示模拟记录 · 3.2s 后收起"
    };
    dismissTooltip(true);
    render();
    logStatus("触发步骤消耗弹窗，旁侧挂件自动避让渐隐。");
    timers.tempMessage = setTimeout(() => {
      state.bubbleTemp = null;
      render();
    }, 3200);
  }

  // =========================================================================
  // 8. Tooltip Positioning & WCAG 1.4.13 Hover/Focus/Escape Behavior
  // =========================================================================
  function syncTooltipContent() {
    $("tip-model").textContent = `${state.modelName} · ${state.thinking}`;
    $("tip-badge").textContent = isUsedMode() ? "演示 · Web 已用" : "演示 · 剩余";
    $("tip-window-5h").textContent = isUsedMode() ? "5 小时已用" : "5 小时剩余";
    $("tip-window-1w").textContent = isUsedMode() ? "1 周已用" : "1 周剩余";
    $("tip-foot").textContent = isUsedMode() ? "Web 正向已用计量 · Esc 关闭" : "悬停或聚焦查看详情 · Esc 关闭";
    for (const [suffix, val, reset] of [
      ["5h", state.fiveHour, state.fiveHourReset],
      ["1w", state.weekly, state.weeklyReset]
    ]) {
      const disp = toDisplayPercent(val);
      const known = typeof disp === "number" && Number.isFinite(disp);
      const lvl = levelForPercent(val);
      $("tip-row-" + suffix).dataset.level = lvl;
      $("tip-pct-" + suffix).textContent = formatPctText(disp);
      $("tip-fill-" + suffix).style.width = known ? `${disp}%` : "0%";
      $("tip-reset-" + suffix).textContent = reset;
    }
  }

  function positionTooltip(placement) {
    const vp = stageViewport.getBoundingClientRect();
    const tipW = tooltip.offsetWidth || 256;
    const tipH = tooltip.offsetHeight || 168;
    const margin = 10;
    const gap = 10;

    const wLeft = placement.x;
    const wRight = placement.x + placement.widget.width;
    const wCenterY = placement.y + placement.widget.height / 2;

    let tipSide = placement.side;
    let tx;
    let ty = clamp(wCenterY - tipH / 2, margin, Math.max(margin, vp.height - tipH - 12));

    if (placement.side === "right") {
      if (wRight + gap + tipW <= vp.width - margin) {
        tx = wRight + gap;
        tipSide = "right";
      } else if (wLeft - gap - tipW >= margin && state.petX > tipW + 24) {
        tx = wLeft - gap - tipW;
        tipSide = "left";
      } else {
        tipSide = placement.y > tipH + 20 ? "top" : "bottom";
        tx = clamp(placement.x + placement.widget.width / 2 - tipW / 2, margin, vp.width - tipW - margin);
        ty = tipSide === "top" ? placement.y - tipH - gap : placement.y + placement.widget.height + gap;
      }
    } else {
      if (wLeft - gap - tipW >= margin) {
        tx = wLeft - gap - tipW;
        tipSide = "left";
      } else if (wRight + gap + tipW <= vp.width - margin && vp.width - (state.petX + state.scale) > tipW + 24) {
        tx = wRight + gap;
        tipSide = "right";
      } else {
        tipSide = placement.y > tipH + 20 ? "top" : "bottom";
        tx = clamp(placement.x + placement.widget.width / 2 - tipW / 2, margin, vp.width - tipW - margin);
        ty = tipSide === "top" ? placement.y - tipH - gap : placement.y + placement.widget.height + gap;
      }
    }

    ty = clamp(Math.round(ty), margin, Math.max(margin, vp.height - tipH - 12));
    tx = clamp(Math.round(tx), margin, Math.max(margin, vp.width - tipW - margin));

    tooltip.dataset.tipSide = tipSide;
    tooltip.style.setProperty("--tip-x", `${tx}px`);
    tooltip.style.setProperty("--tip-y", `${ty}px`);
  }

  function updateTooltipVisibility(placement) {
    const allowed = !isMainBubbleVisible() && !state.dragging && !state.clickThrough && !state.tipSuppressedByEsc;
    const wantOpen = allowed && (state.tipHoverTrigger || state.tipHoverBox || state.tipFocused);
    if (wantOpen === state.tipOpen) {
      if (wantOpen && placement) positionTooltip(placement);
      return;
    }
    state.tipOpen = wantOpen;
    if (wantOpen) {
      syncTooltipContent();
      tooltip.hidden = false;
      if (placement) positionTooltip(placement);
      requestAnimationFrame(() => {
        if (state.tipOpen) tooltip.dataset.open = "true";
      });
    } else {
      tooltip.dataset.open = "false";
      if (state.reducedMotion) tooltip.hidden = true;
      else setTimeout(() => { if (!state.tipOpen) tooltip.hidden = true; }, 140);
    }
  }

  function dismissTooltip(immediate = false) {
    clearTimeout(timers.tipLeave);
    state.tipHoverTrigger = false;
    state.tipHoverBox = false;
    state.tipFocused = false;
    state.tipOpen = false;
    tooltip.dataset.open = "false";
    if (immediate || state.reducedMotion) tooltip.hidden = true;
    else setTimeout(() => { if (!state.tipOpen) tooltip.hidden = true; }, 140);
  }

  // =========================================================================
  // 9. Master Render Pipeline
  // =========================================================================
  let lastSideForAnim = state.side;
  let lastModeForAnim = "side-normal";

  function ensurePetInViewport() {
    const vpW = stageViewport.clientWidth || 820;
    const vpH = stageViewport.clientHeight || 540;
    if (state.petX === null || state.petY === null) {
      state.petX = Math.max(16, vpW - state.scale - 28);
      state.petY = Math.max(18, vpH - state.scale - 16);
    }
    state.petX = clamp(state.petX, 8, Math.max(8, vpW - state.scale - 8));
    state.petY = clamp(state.petY, 10, Math.max(10, vpH - state.scale - 14));
    return { width: vpW, height: vpH };
  }

  function render({ allowFlipAnim = false } = {}) {
    document.body.dataset.theme = state.theme;
    document.body.dataset.reducedMotion = String(state.reducedMotion);
    stageViewport.dataset.backdrop = state.backdrop;
    stageViewport.dataset.clickThrough = String(state.clickThrough);
    stageViewport.dataset.hitbox = String(state.hitbox);
    mascot.dataset.reducedMotion = String(state.reducedMotion);

    const vp = ensurePetInViewport();
    syncArtwork(state.pack);

    // Facing direction toward center of stage
    const petCenterX = state.petX + state.scale / 2;
    if (petCenterX < vp.width / 2 - 14) state.facing = "right";
    else if (petCenterX > vp.width / 2 + 14) state.facing = "left";
    mascot.dataset.facing = state.facing;

    // Bubble vertical flip detection (identical to Catstella renderer.cjs)
    const above = state.petY - 70;
    const below = vp.height - state.petY - state.scale - 64;
    mascot.dataset.bubbleBelow = String(below > above);

    // Warning pet expression when quota <= 20%
    const lowest = Math.min(
      typeof state.fiveHour === "number" ? state.fiveHour : 100,
      typeof state.weekly === "number" ? state.weekly : 100
    );
    mascot.dataset.state = lowest <= 20 ? "warning" : "idle";

    // Apply pet scale, coordinates & viewport-clamped bubble shift
    mascot.style.setProperty("--agy-width", state.scale + "px");
    const bubbleW = Math.min(312, Math.max(220, vp.width - 28));
    bubble.style.width = bubbleW + "px";
    const idealCenter = state.petX + state.scale / 2;
    const minCenter = bubbleW / 2 + 12;
    const maxCenter = Math.max(minCenter, vp.width - bubbleW / 2 - 12);
    const clampedCenter = clamp(idealCenter, minCenter, maxCenter);
    mascot.style.setProperty("--bubble-shift", `${Math.round(clampedCenter - idealCenter)}px`);
    petAnchor.style.transform = `translate3d(${Math.round(state.petX)}px, ${Math.round(state.petY)}px, 0)`;

    renderBubble();

    // Compute Side Widget Placement
    const placement = computeSidePlacement({
      viewport: vp,
      pet: { x: state.petX, y: state.petY, scale: state.scale },
      variant: state.variant,
      prevSide: state.side,
      isDragging: state.dragging,
      sideDistance: state.sideDistance,
      sideSize: state.sideSize
    });

    const flipped = placement.side !== lastSideForAnim || placement.layoutMode !== lastModeForAnim;
    state.side = placement.side;
    lastSideForAnim = placement.side;
    lastModeForAnim = placement.layoutMode;

    sideSlot.dataset.variant = state.variant;
    sideSlot.dataset.side = placement.side;
    sideSlot.dataset.layoutMode = placement.layoutMode;
    sideSlot.dataset.flipAnimate = String(allowFlipAnim && flipped && !state.dragging && !state.reducedMotion);
    sideSlot.style.setProperty("--gauge-scale", placement.widget.scale.toFixed(3));
    sideSlot.style.transform = `translate3d(${placement.x}px, ${placement.y}px, 0)`;

    const suppressed = isMainBubbleVisible();
    sideSlot.dataset.suppressed = String(suppressed);
    sideSlot.dataset.dragging = String(state.dragging);
    sideSlot.setAttribute("aria-hidden", String(suppressed));
    sideTrigger.disabled = suppressed || state.clickThrough;
    sideTrigger.tabIndex = suppressed || state.clickThrough ? -1 : 0;

    // Accessible ARIA progress attributes (mirrors quota-spec.json & Web positive mode)
    const disp5 = toDisplayPercent(state.fiveHour);
    const disp1 = toDisplayPercent(state.weekly);
    const known5 = typeof disp5 === "number" && Number.isFinite(disp5);
    sideTrigger.setAttribute(
      "aria-label",
      isUsedMode()
        ? `Web端已用用量挂件：5小时已用 ${formatPctText(disp5)}，1周已用 ${formatPctText(disp1)}`
        : `模型剩余额度挂件：5小时剩余 ${formatPctText(disp5)}，1周剩余 ${formatPctText(disp1)}`
    );
    if (known5) sideTrigger.setAttribute("aria-valuenow", String(Math.round(disp5)));
    else sideTrigger.removeAttribute("aria-valuenow");

    const activeVisual5 = state.visual5hOverride !== null ? state.visual5hOverride : state.fiveHour;
    const gaugeData = {
      fiveHour: state.fiveHour,
      weekly: state.weekly,
      fill5h: toDisplayPercent(activeVisual5),
      fill1w: disp1,
      ghost5h: state.ghost5h,
      quotaMode: state.quotaMode,
      side: placement.side,
      draining: state.trailMode === "drain",
      surging: state.trailMode === "surge"
    };
    updateGaugeMount(sideVisual, state.variant, "stage", gaugeData);

    // Sync 3-way gallery previews (also reflect fine-tuned distance & size)
    const cmpSize = SIDE_SIZE_FACTORS[state.sideSize] || 1;
    const cmpGap = { compact: 2, normal: 8, relaxed: 16 }[state.sideDistance] ?? 8;
    document.querySelectorAll(".compare-card__preview").forEach((el) => {
      el.style.setProperty("--cmp-gap", `${cmpGap}px`);
    });
    for (const v of ["ring", "bar", "arc"]) {
      const mount = $("compare-mount-" + v);
      if (mount) {
        mount.style.setProperty("--gauge-scale", cmpSize.toFixed(3));
        updateGaugeMount(mount, v, "cmp-" + v, { ...gaugeData, side: "right" });
      }
    }

    // Update Telemetry Strip
    const modeLabel = {
      "side-normal": "正常贴侧",
      "side-tucked": "贴边收紧",
      "corner-avoid": "窄屏肩角避让"
    }[placement.layoutMode];
    $("tele-meter").textContent = `计量: ${isUsedMode() ? "已用 (Web)" : "剩余 (AGY)"}`;
    $("tele-facing").textContent = `朝向: ${state.facing === "left" ? "面向左" : "面向右"}`;
    $("tele-side").textContent = `挂件侧: ${placement.side === "left" ? "左" : "右"}`;
    $("tele-mode").textContent = `避让: ${modeLabel}`;
    $("tele-rooms").textContent = `左余 ${placement.leftRoom}px · 右余 ${placement.rightRoom}px`;
    $("tele-state").textContent = suppressed
      ? (state.bubbleTemp ? "挂件: 碎碎念避让渐隐" : "挂件: 气泡唤醒渐隐")
      : state.dragging
        ? "挂件: 随拖拽柔和跟随"
        : state.clickThrough
          ? "挂件: 穿透不拦截"
          : "挂件: 显露待命";

    syncTooltipContent();
    updateTooltipVisibility(placement);
    syncControlsUI();
  }

  function syncControlsUI() {
    const usedMode = isUsedMode();
    document.querySelectorAll("#quota-mode-group .pill-btn").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.quotaMode === state.quotaMode);
    });
    document.querySelectorAll(".variant-tab").forEach((el) => {
      const active = el.dataset.variant === state.variant;
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".compare-card").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.variant === state.variant);
    });
    document.querySelectorAll("#quota-presets .preset-btn").forEach((el) => {
      const p = QUOTA_PRESETS[el.dataset.preset];
      if (p) el.textContent = usedMode ? p.usedLabel : p.label;
      el.classList.toggle("is-active", el.dataset.preset === state.presetId);
    });
    document.querySelectorAll("#backdrop-group .pill-btn").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.backdrop === state.backdrop);
    });
    document.querySelectorAll("#pack-group .pill-btn").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.pack === state.pack);
    });
    document.querySelectorAll("#theme-group .pill-btn").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.themePick === state.theme);
    });
    document.querySelectorAll("#scale-group .pill-btn").forEach((el) => {
      el.classList.toggle("is-active", Number(el.dataset.scale) === state.scale);
    });
    document.querySelectorAll("#distance-group .pill-btn").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.distance === state.sideDistance);
    });
    document.querySelectorAll("#size-group .pill-btn").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.size === state.sideSize);
    });

    const disp5 = toDisplayPercent(state.fiveHour);
    const disp1 = toDisplayPercent(state.weekly);
    $("lbl-title-5h").textContent = usedMode ? "5h 已用" : "5h 剩余";
    $("lbl-title-1w").textContent = usedMode ? "1w 已用" : "1w 剩余";
    lbl5h.textContent = formatPctText(disp5);
    lbl1w.textContent = formatPctText(disp1);
    if (typeof disp5 === "number") range5h.value = String(Math.round(disp5));
    if (typeof disp1 === "number") range1w.value = String(Math.round(disp1));

    $("btn-consume-step").textContent = usedMode ? "模拟对话用量 +10%" : "模拟对话消耗 -10%";
    $("btn-refill").textContent = usedMode ? "重置已用 0%" : "恢复满额";
  }

  function logStatus(msg) {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    stressLog.textContent = `[${time}] ${msg}`;
  }

  // =========================================================================
  // 10. Quota Actions & Bidirectional Ghost Trail Helper
  // =========================================================================
  let trailSeq = 0;

  function setQuotaValues(next5h, next1w, presetId = "custom", meta = null, { animateTrail = true } = {}) {
    const prev5 = typeof state.fiveHour === "number" ? state.fiveHour : null;
    const prev1 = typeof state.weekly === "number" ? state.weekly : 0;
    const seq = ++trailSeq;

    state.presetId = presetId;
    if (meta) {
      state.modelName = meta.modelName;
      state.thinking = meta.thinking;
      state.fiveHourReset = meta.fiveHourReset;
      state.weeklyReset = meta.weeklyReset;
    }

    state.fiveHour = next5h;
    state.weekly = next1w;
    state.ghost1w = prev1;

    clearTimeout(timers.drain);
    state.trailMode = "idle";
    state.visual5hOverride = null;

    if (animateTrail && !state.reducedMotion && typeof prev5 === "number" && typeof next5h === "number") {
      const prevDisp = toDisplayPercent(prev5);
      const nextDisp = toDisplayPercent(next5h);
      if (!isUsedMode() && nextDisp < prevDisp) {
        // AGY remaining drop: fill drops fast, warm trail chases downward
        state.trailMode = "drain";
        state.ghost5h = prev5;
        render();
        requestAnimationFrame(() => {
          if (seq !== trailSeq) return;
          state.ghost5h = next5h;
          render();
        });
        timers.drain = setTimeout(() => {
          if (seq !== trailSeq) return;
          state.trailMode = "idle";
          render();
        }, 480);
        return;
      }
      if (isUsedMode() && nextDisp > prevDisp) {
        // Web positive usage increase: ghost previews higher target while fill rises to meet it
        state.trailMode = "surge";
        state.ghost5h = next5h;
        state.visual5hOverride = prev5;
        render();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (seq !== trailSeq) return;
            state.visual5hOverride = null;
            render();
          });
        });
        timers.drain = setTimeout(() => {
          if (seq !== trailSeq) return;
          state.trailMode = "idle";
          render();
        }, 440);
        return;
      }
    }

    state.ghost5h = next5h;
    render();
  }

  function applyPreset(presetId) {
    const p = QUOTA_PRESETS[presetId];
    if (!p) return;
    setQuotaValues(p.fiveHour, p.weekly, p.id, p);
    logStatus(`切换额度档位：${isUsedMode() ? p.usedLabel : p.label}`);
  }

  // =========================================================================
  // 11. Pointer Drag + Tap Discrimination (mirrors PetBehavior)
  // =========================================================================
  let pointerState = null;

  motion.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    pointerState = {
      id: e.pointerId,
      startedAt: performance.now(),
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPetX: state.petX,
      startPetY: state.petY,
      distance: 0,
      dragging: false
    };
    motion.setPointerCapture(e.pointerId);
    motion.dataset.pressed = "true";
  });

  motion.addEventListener("pointermove", (e) => {
    if (!pointerState || pointerState.id !== e.pointerId) return;
    const dx = e.clientX - pointerState.startClientX;
    const dy = e.clientY - pointerState.startClientY;
    pointerState.distance = Math.max(pointerState.distance, Math.hypot(dx, dy));

    if (pointerState.distance > 10 || pointerState.dragging) {
      if (!pointerState.dragging) {
        pointerState.dragging = true;
        state.dragging = true;
        motion.dataset.pressed = "false";
        dismissTooltip(true);
      }
      state.petX = pointerState.startPetX + dx;
      state.petY = pointerState.startPetY + dy;
      render({ allowFlipAnim: true });
    }
  });

  function finishPointer(e, cancelled = false) {
    if (!pointerState || (e && pointerState.id !== e.pointerId)) return;
    const elapsed = performance.now() - pointerState.startedAt;
    const isTap = !cancelled && !pointerState.dragging && elapsed <= 700 && pointerState.distance <= 10;
    const wasDragging = pointerState.dragging;
    pointerState = null;
    motion.dataset.pressed = "false";
    state.dragging = false;

    if (wasDragging) {
      render({ allowFlipAnim: true });
      logStatus(`拖拽落位完成，挂件自动停靠在空间更宽裕的${state.side === "left" ? "左" : "右"}侧。`);
      return;
    }

    if (isTap) {
      if (isMainBubbleVisible()) {
        closeBubble();
        logStatus("收起完整气泡，旁侧挂件渐显。");
      } else {
        openBubble("quota");
        showExpression("proud", 1600);
        logStatus("点击桌宠唤醒完整气泡，旁侧挂件同步渐隐避让。");
      }
    }
  }

  motion.addEventListener("pointerup", (e) => finishPointer(e, false));
  motion.addEventListener("pointercancel", (e) => finishPointer(e, true));

  motion.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (e.repeat) return;
    if (isMainBubbleVisible()) closeBubble();
    else openBubble("quota");
  });

  // =========================================================================
  // 12. Tooltip Events, Bubble Controls & Global Esc
  // =========================================================================
  sideTrigger.addEventListener("pointerenter", () => {
    clearTimeout(timers.tipLeave);
    state.tipSuppressedByEsc = false;
    state.tipHoverTrigger = true;
    render();
  });

  sideTrigger.addEventListener("pointerleave", () => {
    state.tipHoverTrigger = false;
    state.tipSuppressedByEsc = false;
    clearTimeout(timers.tipLeave);
    timers.tipLeave = setTimeout(() => render(), 130);
  });

  tooltip.addEventListener("pointerenter", () => {
    clearTimeout(timers.tipLeave);
    state.tipHoverBox = true;
    render();
  });

  tooltip.addEventListener("pointerleave", () => {
    state.tipHoverBox = false;
    clearTimeout(timers.tipLeave);
    timers.tipLeave = setTimeout(() => render(), 130);
  });

  sideTrigger.addEventListener("focus", () => {
    state.tipSuppressedByEsc = false;
    state.tipFocused = true;
    render();
  });

  sideTrigger.addEventListener("blur", () => {
    state.tipFocused = false;
    clearTimeout(timers.tipLeave);
    timers.tipLeave = setTimeout(() => render(), 60);
  });

  sideTrigger.addEventListener("click", () => {
    // On touch or intentional click on the side gauge, toggle the full bubble directly
    if (state.tipOpen) {
      openBubble("quota");
    } else {
      state.tipSuppressedByEsc = false;
      state.tipFocused = true;
      render();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (state.tipOpen) {
        state.tipSuppressedByEsc = true;
        dismissTooltip(true);
        logStatus("按 Esc 关闭详情浮层（焦点未丢失，符合 WCAG 1.4.13）。");
      } else if (isMainBubbleVisible()) {
        closeBubble();
      }
    }
  });

  $("bubble-close").addEventListener("click", closeBubble);
  $("bubble-prev").addEventListener("click", () => {
    state.bubblePage = state.bubblePage === "quota" ? "talk" : "quota";
    armBubbleAutoHide();
    render();
  });
  $("bubble-next").addEventListener("click", () => {
    state.bubblePage = state.bubblePage === "quota" ? "talk" : "quota";
    armBubbleAutoHide();
    render();
  });
  bubble.addEventListener("pointerenter", () => clearTimeout(timers.bubbleAutoHide));
  bubble.addEventListener("pointerleave", armBubbleAutoHide);

  $("tool-toggle").addEventListener("click", () => {
    if (isMainBubbleVisible()) closeBubble();
    else openBubble("quota");
  });
  $("tool-chatter").addEventListener("click", triggerChatter);

  $("bg-click-probe").addEventListener("click", () => {
    const btn = $("bg-click-probe");
    btn.classList.add("is-pinged");
    logStatus("背景穿透点击命中成功：旁侧挂件未拦截宿主操作区点击。");
    setTimeout(() => btn.classList.remove("is-pinged"), 650);
  });

  // =========================================================================
  // 13. Workbench Controls Wiring
  // =========================================================================
  document.querySelectorAll(".variant-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.variant = btn.dataset.variant;
      render({ allowFlipAnim: true });
      logStatus(`切换主舞台方案为：${btn.textContent.trim()}`);
    });
  });

  document.querySelectorAll("[data-promote]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.variant = btn.dataset.promote;
      render({ allowFlipAnim: true });
      stageViewport.scrollIntoView({ behavior: state.reducedMotion ? "auto" : "smooth", block: "nearest" });
      logStatus(`已将 ${state.variant.toUpperCase()} 方案切入主舞台。`);
    });
  });

  document.querySelectorAll("#quota-mode-group .pill-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextMode = btn.dataset.quotaMode === "used" ? "used" : "remaining";
      if (state.quotaMode === nextMode) return;
      state.quotaMode = nextMode;
      ++trailSeq;
      clearTimeout(timers.drain);
      state.trailMode = "idle";
      state.visual5hOverride = null;
      state.ghost5h = state.fiveHour;
      render();
      logStatus(
        isUsedMode()
          ? "已切换为 Web 正向已用计量（0% → 100% 递增，数值与进度条表示已消耗额度）。"
          : "已切换为 AGY 剩余计量（100% → 0% 递减，数值与进度条表示当前可用余量）。"
      );
    });
  });

  document.querySelectorAll("#quota-presets .preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });

  range5h.addEventListener("input", () => {
    const v5 = fromDisplayPercent(Number(range5h.value));
    const v1 = typeof state.weekly === "number" ? state.weekly : fromDisplayPercent(Number(range1w.value));
    setQuotaValues(v5, v1, "custom", null, { animateTrail: false });
  });

  range1w.addEventListener("input", () => {
    const v5 = typeof state.fiveHour === "number" ? state.fiveHour : fromDisplayPercent(Number(range5h.value));
    const v1 = fromDisplayPercent(Number(range1w.value));
    setQuotaValues(v5, v1, "custom", null, { animateTrail: false });
  });

  $("btn-consume-step").addEventListener("click", () => {
    const cur5 = typeof state.fiveHour === "number" ? state.fiveHour : 100;
    const cur1 = typeof state.weekly === "number" ? state.weekly : 100;
    const next5 = Math.max(0, cur5 - 10);
    const next1 = Math.max(0, cur1 - 2);
    setQuotaValues(next5, next1, "custom");
    if (next5 <= 20) showExpression("shy", 1800);
    if (isUsedMode()) {
      logStatus(`模拟单步用量 +10%（5h 已用: ${toDisplayPercent(cur5)}% → ${toDisplayPercent(next5)}%），观察正向推进与余量风险着色。`);
    } else {
      logStatus(`模拟单步消耗 -10%（5h 剩余: ${cur5}% → ${next5}%），观察耐力拖尾泄能效果。`);
    }
  });

  $("btn-refill").addEventListener("click", () => {
    setQuotaValues(100, 100, "abundant", {
      modelName: "Gemini 3.8 Flash",
      thinking: "High",
      fiveHourReset: "满额",
      weeklyReset: "满额"
    });
    showExpression("proud", 1600);
    logStatus(isUsedMode() ? "已用额度已重置归零 (0%)，重置窗口满血可用。" : "额度已恢复满额 100%。");
  });

  document.querySelectorAll("#backdrop-group .pill-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.backdrop = btn.dataset.backdrop;
      render({ allowFlipAnim: true });
      requestAnimationFrame(() => render({ allowFlipAnim: true }));
      setTimeout(() => render({ allowFlipAnim: true }), 270);
      logStatus(`切换舞台背景：${btn.textContent}`);
    });
  });

  document.querySelectorAll("#pack-group .pill-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.pack = btn.dataset.pack;
      render();
    });
  });

  document.querySelectorAll("#theme-group .pill-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.theme = btn.dataset.themePick;
      render();
    });
  });

  document.querySelectorAll("#scale-group .pill-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.scale = Number(btn.dataset.scale);
      render({ allowFlipAnim: true });
      logStatus(`桌宠缩放调整为 ${state.scale}px，挂件尺寸与间隙等比自适应。`);
    });
  });

  document.querySelectorAll("#distance-group .pill-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.sideDistance = btn.dataset.distance;
      render({ allowFlipAnim: true });
      logStatus(`挂件距离微调为「${btn.textContent}」。`);
    });
  });

  document.querySelectorAll("#size-group .pill-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.sideSize = btn.dataset.size;
      render({ allowFlipAnim: true });
      logStatus(`挂件大小微调为「${btn.textContent}」。`);
    });
  });

  // Quick Snap buttons
  function snapPet(mode) {
    const vpW = stageViewport.clientWidth || 820;
    const vpH = stageViewport.clientHeight || 540;
    if (mode === "left") {
      state.petX = 12;
      state.petY = Math.max(16, vpH - state.scale - 16);
    } else if (mode === "right") {
      state.petX = Math.max(12, vpW - state.scale - 12);
      state.petY = Math.max(16, vpH - state.scale - 16);
    } else if (mode === "center") {
      state.petX = Math.round((vpW - state.scale) / 2);
      state.petY = Math.max(16, vpH - state.scale - 16);
    } else if (mode === "top") {
      state.petX = Math.max(12, vpW - state.scale - 18);
      state.petY = 14;
    }
    render({ allowFlipAnim: true });
    logStatus(`快速停靠 [${mode}]：挂件自动切换至 ${state.side === "left" ? "左侧" : "右侧"}（模式：${sideSlot.dataset.layoutMode}）。`);
  }

  $("btn-snap-left").addEventListener("click", () => snapPet("left"));
  $("btn-snap-right").addEventListener("click", () => snapPet("right"));
  $("btn-snap-center").addEventListener("click", () => snapPet("center"));
  $("btn-snap-top").addEventListener("click", () => snapPet("top"));

  $("btn-toggle-bubble").addEventListener("click", () => {
    if (isMainBubbleVisible()) closeBubble();
    else openBubble("quota");
  });
  $("btn-trigger-chatter").addEventListener("click", triggerChatter);
  $("btn-trigger-turncost").addEventListener("click", triggerTurnCost);

  // Rapid toggle & edge-flip stress test
  $("btn-rapid-stress").addEventListener("click", () => {
    const btn = $("btn-rapid-stress");
    if (state.stressRunning) return;
    state.stressRunning = true;
    btn.classList.add("is-busy");
    logStatus("开始快速来回切压力测试：连切气泡 + 碎碎念 + 左右贴边换边…");

    const steps = [
      [0, () => openBubble("quota")],
      [90, () => closeBubble()],
      [170, () => openBubble("talk")],
      [260, () => closeBubble()],
      [350, () => openBubble("quota")],
      [430, () => closeBubble()],
      [620, () => snapPet("left")],
      [980, () => snapPet("right")],
      [1350, () => triggerChatter()],
      [1900, () => {
        closeBubble();
        state.stressRunning = false;
        btn.classList.remove("is-busy");
        logStatus("压力测试通过：快速来回切无残影闪烁、无点击残留、换边与收起衔接正常。");
      }]
    ];

    for (const [delay, fn] of steps) {
      timers.stress.push(setTimeout(fn, delay));
    }
  });

  $("chk-reduced-motion").addEventListener("change", (e) => {
    state.reducedMotion = e.target.checked;
    scheduleBlink();
    render();
    logStatus(state.reducedMotion ? "已开启减少动态效果：禁用呼吸/拖尾与弹性位移动画。" : "已恢复完整灵动动效。");
  });

  $("chk-click-through").addEventListener("change", (e) => {
    state.clickThrough = e.target.checked;
    if (state.clickThrough) dismissTooltip(true);
    render();
    logStatus(state.clickThrough ? "已开启穿透模式：挂件不再拦截底层点击。" : "已恢复正常交互。");
  });

  $("chk-hitbox").addEventListener("change", (e) => {
    state.hitbox = e.target.checked;
    render();
  });

  // Resize observer keeps edge clamping & narrow-screen side flipping reactive
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => render({ allowFlipAnim: false })).observe(stageViewport);
  } else {
    window.addEventListener("resize", () => render({ allowFlipAnim: false }));
  }

  // Boot
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    state.reducedMotion = true;
    $("chk-reduced-motion").checked = true;
  }
  scheduleBlink();
  render();
})();
