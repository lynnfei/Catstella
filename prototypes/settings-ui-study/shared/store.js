/**
 * Catstella Settings UI Study — Shared Reactive Store & Mock Domain Data
 *
 * Designed specifically to solve legacy full-page redraw churn:
 *  - Fine-grained key-level listeners (subscribeKey / subscribeKeys)
 *  - Magnetic 1m..60m slideshow interval damping matching desktop settings
 *  - Undo history stack + Dirty draft comparison + Simulated save feedback
 */
(function (global) {
  'use strict';

  const ASSET_ROOT = '../../../';

  const CHARACTER_PACKS = [
    {
      id: 'gemini-star-v1',
      name: '星语 · Stella',
      subtitle: '星空魔女 · 紫发异色瞳',
      tag: '内置默认',
      badge: '✦ 看板猫',
      frames: {
        idle: `${ASSET_ROOT}Antigravity-Cat-Widget/assets/character-packs/gemini-star-v1/frames/idle.png`,
        proud: `${ASSET_ROOT}Antigravity-Cat-Widget/assets/character-packs/gemini-star-v1/frames/proud.png`,
        shy: `${ASSET_ROOT}Antigravity-Cat-Widget/assets/character-packs/gemini-star-v1/frames/shy.png`,
        angry: `${ASSET_ROOT}Antigravity-Cat-Widget/assets/character-packs/gemini-star-v1/frames/angry.png`
      },
      expressions: [
        { id: 'idle', label: '待机' },
        { id: 'proud', label: '得意' },
        { id: 'shy', label: '傲娇害羞' },
        { id: 'angry', label: '炸毛警觉' }
      ],
      sampleLine: 'Token 可以省，给本喵顺毛的夸夸可不能省喵～'
    },
    {
      id: 'lin-cat',
      name: '霓音 · LinCat',
      subtitle: '粉色双马尾 · 全息航行服',
      tag: '全息皮肤',
      badge: '🎧 林猫形态',
      frames: {
        idle: `${ASSET_ROOT}Antigravity-Cat-Widget/assets/character-packs/lin-cat/frames/idle.png`,
        proud: `${ASSET_ROOT}Antigravity-Cat-Widget/assets/character-packs/lin-cat/frames/proud.png`,
        shy: `${ASSET_ROOT}Antigravity-Cat-Widget/assets/character-packs/lin-cat/frames/shy.png`,
        angry: `${ASSET_ROOT}Antigravity-Cat-Widget/assets/character-packs/lin-cat/frames/angry.png`
      },
      expressions: [
        { id: 'idle', label: '待机' },
        { id: 'proud', label: '元气' },
        { id: 'shy', label: '耳灯发烫' },
        { id: 'angry', label: '警告口牙' }
      ],
      sampleLine: '耳灯亮度正常，RJ45 尾巴信号满格，随时开工口牙！'
    }
  ];

  const WALLPAPERS = [
    {
      id: 'gemini-character-sheet-v1',
      name: '星语 · 星幕夜话',
      pack: '星语夜曲包',
      packId: 'stella-night',
      resolution: '1672 × 941',
      src: `${ASSET_ROOT}Antigravity-Dream-Skin/assets/wallpapers/gemini-character-sheet-v1/wallpaper.png`,
      accentHex: '#7a52db'
    },
    {
      id: 'stella-halloween',
      name: '星语 · 万圣星夜',
      pack: '星语夜曲包',
      packId: 'stella-night',
      resolution: '1376 × 768',
      src: `${ASSET_ROOT}Antigravity-Dream-Skin/assets/wallpapers/stella-halloween/wallpaper.jpg`,
      accentHex: '#b18ef3'
    },
    {
      id: 'aica-clouds',
      name: '霓音 · 云端来信',
      pack: 'Aica 漫游包',
      packId: 'aica-voyage',
      resolution: '1671 × 941',
      src: `${ASSET_ROOT}Antigravity-Dream-Skin/assets/wallpapers/aica-clouds/wallpaper.png`,
      accentHex: '#5da9f6'
    },
    {
      id: 'aica-starship',
      name: '霓音 · 星舱漫游',
      pack: 'Aica 漫游包',
      packId: 'aica-voyage',
      resolution: '1672 × 941',
      src: `${ASSET_ROOT}Antigravity-Dream-Skin/assets/wallpapers/aica-starship/wallpaper.jpg`,
      accentHex: '#e68cb5'
    }
  ];

  const THEME_PRESETS = {
    violet: {
      id: 'violet',
      name: '星轨紫',
      sub: 'Catstella 经典暗紫',
      swatch: 'linear-gradient(135deg, #8b68e0, #24193c)',
      vars: {
        base: '#21192f',
        page: '#3e2c58',
        card: '#594472',
        accent: '#e5c7ff',
        tintOpacity: '0.26'
      }
    },
    pink: {
      id: 'pink',
      name: '梦幻粉',
      sub: '莓果糖霜氛围',
      swatch: 'linear-gradient(135deg, #f59cc6, #3b1830)',
      vars: {
        base: '#331a2b',
        page: '#5a2c48',
        card: '#794764',
        accent: '#ffcae5',
        tintOpacity: '0.28'
      }
    },
    ocean: {
      id: 'ocean',
      name: '深海蓝',
      sub: '静谧航行暮蓝',
      swatch: 'linear-gradient(135deg, #5da9f6, #0f1d35)',
      vars: {
        base: '#132039',
        page: '#233e61',
        card: '#3d5a80',
        accent: '#c2ddff',
        tintOpacity: '0.25'
      }
    },
    onyx: {
      id: 'onyx',
      name: '曜石黑',
      sub: '专注极客高对比',
      swatch: 'linear-gradient(135deg, #666c82, #121318)',
      vars: {
        base: '#17181d',
        page: '#292d38',
        card: '#444957',
        accent: '#e0e3ed',
        tintOpacity: '0.22'
      }
    }
  };

  const DEFAULT_STATE = {
    // 桌宠 & 形象
    characterPack: 'gemini-star-v1',
    previewExpression: 'idle',
    petVisible: true,
    petTopmost: true,
    petSize: 0.92,
    petOpacity: 0.96,
    bubbleAutoHideSec: 12,
    soundPack: 'bubble-pop',
    syncWebCharacter: true,

    // 壁纸 & 宿主皮肤
    wallpaperEnabled: true,
    wallpaperId: 'gemini-character-sheet-v1',
    galleryViewMode: 'carousel', // 'carousel' | 'grid'
    packAutoPlay: true,
    slideshowIntervalMin: 15,
    bgOpacity: 0.28,
    bgScrim: 0.34,
    localizeEnabled: true,
    themePreset: 'violet',
    themeHue: 256,
    themeTint: '#8b68e0',
    themeBlurPx: 0,

    // 用量 & 网关
    quotaViewMode: 'detailed', // 'compact' | 'detailed'
    quotaDisplayMode: 'remaining', // 'remaining' | 'used'
    quotaWarnPct: 20,
    syncWebUsage: true,
    manualFiveHourLeft: 96,
    manualWeeklyLeft: 95,
    byokEnabled: true,
    byokProviders: [
      { id: 'gemini', name: 'Google Gemini', model: 'Gemini 3.8 Flash', enabled: true, quotaNote: '5h 96% · 延迟 380ms', active: true },
      { id: 'anthropic', name: 'Claude via Vertex', model: 'Claude Sonnet 5.5', enabled: true, quotaNote: '5h 75% · Thinking Low', active: false },
      { id: 'deepseek', name: 'DeepSeek OpenAI', model: 'DeepSeek-V3.2', enabled: false, quotaNote: '未激活 · 备用节点', active: false }
    ],

    // 互动 & 碎碎念
    honorificMode: 'zayu', // 'zayu' | 'human' | 'custom'
    honorificCustom: '指挥官',
    ambientChatter: true,
    ambientIntervalSec: 45,
    desktopPriority: true,
    headPatToday: 18,
    headPatTotal: 1954,

    // 研究/持久化策略偏好与沙盒模拟开关
    autoSave: true,
    reducedMotionSim: false,
    simulateSaveFailure: false
  };

  // Magnetic damp matching Antigravity-Cat-Widget/src/renderer/settings.cjs
  const MAJOR_STOPS = [1, 5, 10, 15, 30, 45, 60];
  const MINOR_STOPS = [3, 20, 25, 35, 40, 50, 55];

  function magneticDamp(raw) {
    const num = Number(raw);
    if (!Number.isFinite(num)) return { visual: 15, committed: 15 };
    for (const stop of MAJOR_STOPS) {
      const diff = num - stop;
      const ad = Math.abs(diff);
      if (ad <= 1.55) {
        if (ad <= 0.65) return { visual: stop, committed: stop };
        const t = (ad - 0.65) / 0.9;
        const eased = stop + Math.sign(diff) * Math.pow(t, 2.2) * 1.55;
        return { visual: eased, committed: Math.round(eased) };
      }
    }
    for (const stop of MINOR_STOPS) {
      if (Math.abs(num - stop) <= 0.45) {
        return { visual: stop, committed: stop };
      }
    }
    const clamped = Math.max(1, Math.min(60, num));
    return { visual: clamped, committed: Math.round(clamped) };
  }

  function formatMinutes(min) {
    if (min >= 60) return '1 小时';
    return `${min} 分钟`;
  }

  function cloneState(src) {
    return JSON.parse(JSON.stringify(src));
  }

  function createSettingsStore(variantId, initialOverrides) {
    const seed = Object.assign(cloneState(DEFAULT_STATE), initialOverrides || {});
    let committed = cloneState(seed);
    let draft = cloneState(seed);
    const undoStack = [];
    const keyListeners = new Map();
    const anyListeners = new Set();

    function emitKey(key, nextVal, prevVal, meta) {
      const set = keyListeners.get(key);
      if (set) {
        set.forEach((fn) => fn(nextVal, prevVal, key, meta));
      }
    }

    const META_KEYS = new Set(['autoSave', 'reducedMotionSim', 'simulateSaveFailure']);

    function computeDirtyKeys() {
      const dirty = [];
      for (const key of Object.keys(draft)) {
        if (META_KEYS.has(key)) continue;
        if (JSON.stringify(draft[key]) !== JSON.stringify(committed[key])) {
          dirty.push(key);
        }
      }
      return dirty;
    }

    function notifyAll(changedKeys, meta) {
      const info = {
        changedKeys,
        dirtyKeys: computeDirtyKeys(),
        undoCount: undoStack.length,
        committed: draft.autoSave && !draft.simulateSaveFailure,
        meta: meta || {}
      };
      anyListeners.forEach((fn) => fn(draft, info));
    }

    function set(key, value, meta = {}) {
      const prev = cloneState(draft[key]);
      if (JSON.stringify(prev) === JSON.stringify(value)) return { ok: true, changed: false };

      if (!meta.skipUndo && !META_KEYS.has(key)) {
        undoStack.push({ type: 'single', key, prevValue: prev, label: meta.label || key });
        if (undoStack.length > 25) undoStack.shift();
      }

      draft[key] = cloneState(value);
      const isMeta = META_KEYS.has(key);
      const saveBlocked = !isMeta && (draft.autoSave || meta.forceCommit) && draft.simulateSaveFailure;

      if (isMeta || ((draft.autoSave || meta.forceCommit) && !draft.simulateSaveFailure)) {
        committed[key] = cloneState(value);
      }

      emitKey(key, draft[key], prev, meta);
      const nextMeta = saveBlocked
        ? Object.assign({}, meta, {
            action: 'save-error',
            error: '模拟持久化失败：IPC / settings.json 写入被拒绝，已保留本地草稿（可点「重试保存」或「放弃改动」回退）'
          })
        : meta;
      notifyAll([key], nextMeta);
      return { ok: !saveBlocked, changed: true };
    }

    function setMany(patch, meta = {}) {
      const prevBatch = {};
      const changedKeys = [];
      for (const [k, v] of Object.entries(patch)) {
        if (JSON.stringify(draft[k]) !== JSON.stringify(v)) {
          prevBatch[k] = cloneState(draft[k]);
          draft[k] = cloneState(v);
          const isMeta = META_KEYS.has(k);
          if (isMeta || ((draft.autoSave || meta.forceCommit) && !draft.simulateSaveFailure)) {
            committed[k] = cloneState(v);
          }
          changedKeys.push(k);
        }
      }
      if (!changedKeys.length) return { ok: true, changed: false };
      if (!meta.skipUndo) {
        undoStack.push({ type: 'batch', prevBatch, label: meta.label || '批量更新' });
        if (undoStack.length > 25) undoStack.shift();
      }
      for (const k of changedKeys) {
        emitKey(k, draft[k], prevBatch[k], meta);
      }
      const saveBlocked = (draft.autoSave || meta.forceCommit) && draft.simulateSaveFailure;
      const nextMeta = saveBlocked
        ? Object.assign({}, meta, {
            action: 'save-error',
            error: '模拟持久化失败：批量写入被拒绝，已保留本地草稿，支持重试或回退'
          })
        : meta;
      notifyAll(changedKeys, nextMeta);
      return { ok: !saveBlocked, changed: true };
    }

    function commitDraft() {
      const dirtyKeys = computeDirtyKeys();
      if (draft.simulateSaveFailure) {
        notifyAll(dirtyKeys, {
          action: 'save-error',
          error: '模拟保存失败：IPC 通道拒绝写入，草稿改动已保留，请关闭模拟失败后重试或点「放弃改动」回退'
        });
        return { ok: false, dirtyCount: dirtyKeys.length };
      }
      committed = cloneState(draft);
      notifyAll(dirtyKeys, { action: 'commit' });
      return { ok: true, dirtyCount: dirtyKeys.length };
    }

    function discardDraft() {
      const dirtyKeys = computeDirtyKeys();
      if (!dirtyKeys.length) return [];
      const prevDraft = cloneState(draft);
      draft = cloneState(committed);
      for (const k of dirtyKeys) {
        emitKey(k, draft[k], prevDraft[k], { action: 'discard' });
      }
      notifyAll(dirtyKeys, { action: 'discard' });
      return dirtyKeys;
    }

    function undo() {
      const entry = undoStack.pop();
      if (!entry) return null;
      const changed = [];
      let blocked = false;
      if (entry.type === 'single') {
        const prev = cloneState(draft[entry.key]);
        draft[entry.key] = cloneState(entry.prevValue);
        if (draft.autoSave && !draft.simulateSaveFailure) {
          committed[entry.key] = cloneState(entry.prevValue);
        } else if (draft.autoSave && draft.simulateSaveFailure) {
          blocked = true;
        }
        changed.push(entry.key);
        emitKey(entry.key, draft[entry.key], prev, { action: 'undo' });
      } else if (entry.type === 'batch') {
        for (const [k, val] of Object.entries(entry.prevBatch)) {
          const prev = cloneState(draft[k]);
          draft[k] = cloneState(val);
          if (draft.autoSave && !draft.simulateSaveFailure) {
            committed[k] = cloneState(val);
          } else if (draft.autoSave && draft.simulateSaveFailure) {
            blocked = true;
          }
          changed.push(k);
          emitKey(k, draft[k], prev, { action: 'undo' });
        }
      }
      notifyAll(
        changed,
        blocked
          ? { action: 'save-error', label: entry.label, error: '已撤销前端草稿，但模拟保存失败导致未落盘，可取消模拟失败后点立即保存' }
          : { action: 'undo', label: entry.label }
      );
      return entry;
    }

    function resetDefaults() {
      const patch = {};
      for (const k of Object.keys(DEFAULT_STATE)) {
        if (META_KEYS.has(k)) continue;
        patch[k] = DEFAULT_STATE[k];
      }
      return setMany(patch, { label: '恢复默认设置', forceCommit: draft.autoSave });
    }

    function subscribeKey(key, fn) {
      if (!keyListeners.has(key)) keyListeners.set(key, new Set());
      keyListeners.get(key).add(fn);
      fn(draft[key], undefined, key, { init: true });
      return () => keyListeners.get(key)?.delete(fn);
    }

    function subscribeKeys(keys, fn) {
      const unsubs = keys.map((k) => subscribeKey(k, () => fn(draft, k)));
      return () => unsubs.forEach((u) => u());
    }

    function subscribe(fn) {
      anyListeners.add(fn);
      fn(draft, {
        changedKeys: [],
        dirtyKeys: computeDirtyKeys(),
        undoCount: undoStack.length,
        committed: draft.autoSave,
        meta: { init: true }
      });
      return () => anyListeners.delete(fn);
    }

    return {
      variantId,
      getState: () => draft,
      get: (key) => draft[key],
      getDirtyKeys: computeDirtyKeys,
      getUndoCount: () => undoStack.length,
      set,
      setMany,
      commitDraft,
      discardDraft,
      undo,
      resetDefaults,
      subscribeKey,
      subscribeKeys,
      subscribe
    };
  }

  global.CatstellaStudy = Object.assign(global.CatstellaStudy || {}, {
    ASSET_ROOT,
    CHARACTER_PACKS,
    WALLPAPERS,
    THEME_PRESETS,
    DEFAULT_STATE,
    MAJOR_STOPS,
    MINOR_STOPS,
    magneticDamp,
    formatMinutes,
    createSettingsStore
  });
})(window);
