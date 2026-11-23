/**
 * Catstella Settings UI Study — Shared Declarative Controller
 *
 * Binds any variant's semantic DOM markup (Compact, Frosted, Journal) to the
 * reactive Store & PerfMonitor WITHOUT full-page render() cycles or innerHTML resets.
 */
(function (global) {
  'use strict';

  const Study = global.CatstellaStudy;

  function mountSettingsApp({
    variantId,
    variantLabel,
    rootEl,
    hudMount,
    onSavedFeedback
  }) {
    const store = Study.createSettingsStore(variantId);
    const perf = Study.createPerfMonitor({
      observeRoot: rootEl,
      hudMount,
      variantLabel
    });

    const pages = Array.from(rootEl.querySelectorAll('.settings-page[data-page]'));
    const navItems = Array.from(rootEl.querySelectorAll('.nav-item[data-target]'));
    const statusLiveEl = rootEl.querySelector('[data-role="save-status"]');
    const dirtyBadgeEl = rootEl.querySelector('[data-role="dirty-badge"]');
    const undoBtn = rootEl.querySelector('[data-action="undo"]');
    const saveBtn = rootEl.querySelector('[data-action="save-now"]');
    const discardBtn = rootEl.querySelector('[data-action="discard-draft"]');
    const reducedMotionCheckbox = rootEl.querySelector('[data-sim="reduced-motion"]') || document.querySelector('[data-sim="reduced-motion"]');
    const narrowCheckbox = rootEl.querySelector('[data-sim="narrow-frame"]') || document.querySelector('[data-sim="narrow-frame"]');
    const failSimCheckbox = rootEl.querySelector('[data-sim="save-failure"]') || document.querySelector('[data-sim="save-failure"]');
    const resetTrigger = rootEl.querySelector('[data-action="reset-confirm-open"]');
    const resetConfirmBox = rootEl.querySelector('[data-reset-confirm-box]');
    const resetApplyBtn = rootEl.querySelector('[data-action="reset-apply"]');
    const resetCancelBtn = rootEl.querySelector('[data-action="reset-cancel"]');

    let activePage = navItems.find((b) => b.getAttribute('aria-current') === 'page')?.dataset.target || 'overview';
    let byokRowCache = null;

    function setText(el, next) {
      const str = String(next);
      if (el && el.textContent !== str) el.textContent = str;
    }

    function setAttr(el, name, next) {
      const str = String(next);
      if (el && el.getAttribute(name) !== str) el.setAttribute(name, str);
    }

    function setClass(el, cls, on) {
      if (el && el.classList.contains(cls) !== Boolean(on)) el.classList.toggle(cls, Boolean(on));
    }

    function setStyleProp(el, prop, next) {
      const str = String(next);
      if (el && el.style.getPropertyValue(prop) !== str) el.style.setProperty(prop, str);
    }

    function announceStatus(text, tone = 'ok') {
      if (!statusLiveEl) return;
      setText(statusLiveEl, text);
      if (statusLiveEl.dataset.tone !== tone) statusLiveEl.dataset.tone = tone;
    }

    // 1. Category Navigation (ARIA aria-current="page" + Roving Arrow Keys)
    function switchPage(nextPage, focusNav = false) {
      if (!nextPage || nextPage === activePage) return;
      perf.trackInteraction(`切换分类:${nextPage}`, () => {
        activePage = nextPage;
        if (resetConfirmBox && !resetConfirmBox.hidden) resetConfirmBox.hidden = true;
        for (const btn of navItems) {
          const match = btn.dataset.target === nextPage;
          setClass(btn, 'active', match);
          setAttr(btn, 'aria-current', match ? 'page' : 'false');
          if (match && focusNav) btn.focus();
        }
        for (const pageEl of pages) {
          const show = pageEl.dataset.page === nextPage;
          if (pageEl.hidden !== !show) pageEl.hidden = !show;
          setClass(pageEl, 'is-entering', show);
        }
        perf.refreshBlurCount();
      });
    }

    navItems.forEach((btn, idx) => {
      btn.addEventListener('click', () => switchPage(btn.dataset.target));
      btn.addEventListener('keydown', (e) => {
        let nextIdx = -1;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nextIdx = (idx + 1) % navItems.length;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nextIdx = (idx - 1 + navItems.length) % navItems.length;
        else if (e.key === 'Home') nextIdx = 0;
        else if (e.key === 'End') nextIdx = navItems.length - 1;
        if (nextIdx >= 0) {
          e.preventDefault();
          switchPage(navItems[nextIdx].dataset.target, true);
        }
      });
    });

    // Optional page shortcut buttons inside overview
    rootEl.querySelectorAll('[data-jump-page]').forEach((el) => {
      el.addEventListener('click', () => switchPage(el.dataset.jumpPage, true));
    });

    // 2. WAI-ARIA Tablists (Inside Sub-Views)
    rootEl.querySelectorAll('[role="tablist"]').forEach((tablist) => {
      const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
      function activateTab(tab, moveFocus = false) {
        perf.trackInteraction(`子标签:${tab.textContent.trim()}`, () => {
          const panelId = tab.getAttribute('aria-controls');
          tabs.forEach((t) => {
            const selected = t === tab;
            t.setAttribute('aria-selected', selected ? 'true' : 'false');
            t.tabIndex = selected ? 0 : -1;
            const pId = t.getAttribute('aria-controls');
            const panel = pId ? rootEl.querySelector(`#${pId}`) : null;
            if (panel) panel.hidden = !selected;
          });
          if (moveFocus) tab.focus();
          if (panelId) {
            const activePanel = rootEl.querySelector(`#${panelId}`);
            if (activePanel) activePanel.hidden = false;
          }
        });
      }

      tabs.forEach((tab, idx) => {
        tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
        tab.addEventListener('click', () => activateTab(tab, false));
        tab.addEventListener('keydown', (e) => {
          let nextIdx = -1;
          if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
          else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
          else if (e.key === 'Home') nextIdx = 0;
          else if (e.key === 'End') nextIdx = tabs.length - 1;
          if (nextIdx >= 0) {
            e.preventDefault();
            activateTab(tabs[nextIdx], true);
          }
        });
      });
    });

    // 3. Surgical Key Bindings ([data-bind-key])
    function formatOutput(key, value) {
      if (key === 'petSize') return `${Math.round(value * 100)}%`;
      if (key === 'petOpacity' || key === 'bgOpacity' || key === 'bgScrim') return `${Math.round(value * 100)}%`;
      if (key === 'slideshowIntervalMin') return Study.formatMinutes(value);
      if (key === 'bubbleAutoHideSec') return value === 0 ? '常驻不收' : `${value}s`;
      if (key === 'ambientIntervalSec') return `${value} 秒`;
      if (key === 'quotaWarnPct' || key === 'manualFiveHourLeft' || key === 'manualWeeklyLeft') return `${value}%`;
      if (key === 'themeBlurPx') return `${value}px`;
      if (key === 'headPatToday') return `${value} 次`;
      return String(value);
    }

    function updateRangeVisual(input) {
      const min = Number(input.min || 0);
      const max = Number(input.max || 100);
      const val = Number(input.value);
      const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
      input.style.setProperty('--control-value', `${Math.max(0, Math.min(100, pct)).toFixed(2)}%`);
    }

    rootEl.querySelectorAll('[data-bind-key]').forEach((ctrl) => {
      const key = ctrl.dataset.bindKey;
      const valueType = ctrl.dataset.bindType || (ctrl.type === 'checkbox' ? 'boolean' : ctrl.type === 'range' || ctrl.type === 'number' ? 'number' : 'string');

      if (ctrl.tagName === 'INPUT' && ctrl.type === 'checkbox') {
        store.subscribeKey(key, (val) => {
          if (ctrl.checked !== !!val) ctrl.checked = !!val;
        });
        ctrl.addEventListener('change', () => {
          perf.trackInteraction(`开关:${key}`, () => {
            store.set(key, ctrl.checked, { label: ctrl.dataset.label || key });
          });
        });
      } else if (ctrl.tagName === 'INPUT' && ctrl.type === 'range') {
        const isMagnetic = ctrl.dataset.magnetic === 'interval';
        store.subscribeKey(key, (val) => {
          if (Number(ctrl.value) !== Number(val)) ctrl.value = String(val);
          updateRangeVisual(ctrl);
        });
        ctrl.addEventListener('input', () => {
          perf.trackInteraction(`滑块:${key}`, () => {
            let nextVal = Number(ctrl.value);
            if (isMagnetic) {
              const damped = Study.magneticDamp(nextVal);
              ctrl.value = String(damped.visual);
              nextVal = damped.committed;
            }
            updateRangeVisual(ctrl);
            store.set(key, nextVal, { label: ctrl.dataset.label || key });
          });
        });
      } else if (ctrl.tagName === 'SELECT' || (ctrl.tagName === 'INPUT' && (ctrl.type === 'text' || ctrl.type === 'number'))) {
        store.subscribeKey(key, (val) => {
          if (String(ctrl.value) !== String(val)) ctrl.value = String(val);
        });
        const evt = ctrl.tagName === 'SELECT' ? 'change' : 'input';
        ctrl.addEventListener(evt, () => {
          if (valueType === 'number' && ctrl.value.trim() === '') return;
          perf.trackInteraction(`输入:${key}`, () => {
            let nextVal = ctrl.value;
            if (valueType === 'number') {
              const min = ctrl.min !== '' ? Number(ctrl.min) : -Infinity;
              const max = ctrl.max !== '' ? Number(ctrl.max) : Infinity;
              const parsed = Number(nextVal);
              if (!Number.isFinite(parsed)) return;
              nextVal = Math.max(min, Math.min(max, Math.round(parsed)));
            }
            store.set(key, nextVal, { label: ctrl.dataset.label || key });
          });
        });
        if (valueType === 'number') {
          const normalizeOnCommit = () => {
            const min = ctrl.min !== '' ? Number(ctrl.min) : -Infinity;
            const max = ctrl.max !== '' ? Number(ctrl.max) : Infinity;
            const raw = ctrl.value.trim();
            if (raw === '' || !Number.isFinite(Number(raw))) {
              ctrl.value = String(store.get(key));
              return;
            }
            const clamped = Math.max(min, Math.min(max, Math.round(Number(raw))));
            if (String(clamped) !== ctrl.value) ctrl.value = String(clamped);
            if (clamped !== store.get(key)) {
              perf.trackInteraction(`输入:${key}`, () => {
                store.set(key, clamped, { label: ctrl.dataset.label || key });
              });
            }
          };
          ctrl.addEventListener('change', normalizeOnCommit);
          ctrl.addEventListener('blur', normalizeOnCommit);
        }
      }
    });

    // Surgical output badges ([data-bind-text])
    rootEl.querySelectorAll('[data-bind-text]').forEach((outEl) => {
      const key = outEl.dataset.bindText;
      store.subscribeKey(key, (val) => {
        const formatted = formatOutput(key, val);
        if (outEl.textContent !== formatted) outEl.textContent = formatted;
      });
    });

    // Ruler active stop highlighting
    const rulerTickEls = Array.from(rootEl.querySelectorAll('[data-ruler-stop]'));
    if (rulerTickEls.length) {
      store.subscribeKey('slideshowIntervalMin', (val) => {
        for (const el of rulerTickEls) {
          const stopVal = Number(el.dataset.rulerStop);
          el.classList.toggle('is-active', Math.abs(stopVal - val) <= 1);
        }
      });
    }

    // Honorific custom row visibility
    const honorificCustomRow = rootEl.querySelector('[data-cond="honorific-custom"]');
    if (honorificCustomRow) {
      store.subscribeKey('honorificMode', (mode) => {
        honorificCustomRow.hidden = mode !== 'custom';
      });
    }

    // 4. Character Pack Cards & Live Expressions
    const charCards = Array.from(rootEl.querySelectorAll('[data-char-id]'));
    charCards.forEach((card) => {
      card.addEventListener('click', () => {
        perf.trackInteraction(`切换桌宠:${card.dataset.charId}`, () => {
          store.set('characterPack', card.dataset.charId, { label: '切换桌宠形象' });
        });
      });
    });

    const exprButtons = Array.from(rootEl.querySelectorAll('[data-expr-id]'));
    exprButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        perf.trackInteraction(`试看表情:${btn.dataset.exprId}`, () => {
          store.set('previewExpression', btn.dataset.exprId, { label: '切换试看表情' });
        });
      });
    });

    // Pet Live Preview Stage
    const petStageImg = rootEl.querySelector('[data-preview="pet-img"]');
    const petStageName = rootEl.querySelector('[data-preview="pet-name"]');
    const petStageLine = rootEl.querySelector('[data-preview="pet-line"]');
    const petStageShell = rootEl.querySelector('[data-preview="pet-shell"]');
    const petStageStateBadge = rootEl.querySelector('[data-preview="pet-state-badge"]');

    function refreshPetPreview() {
      const st = store.getState();
      const pack = Study.CHARACTER_PACKS.find((c) => c.id === st.characterPack) || Study.CHARACTER_PACKS[0];
      const expr = st.previewExpression || 'idle';
      const src = pack.frames[expr] || pack.frames.idle;
      if (petStageImg && petStageImg.getAttribute('src') !== src) {
        petStageImg.setAttribute('src', src);
        setAttr(petStageImg, 'alt', `${pack.name} · ${expr}`);
      }
      if (petStageImg) {
        setStyleProp(petStageImg, 'transform', `scale(${st.petSize.toFixed(2)})`);
        setStyleProp(petStageImg, 'opacity', st.petVisible ? String(st.petOpacity) : '0.24');
      }
      setClass(petStageShell, 'is-hidden-pet', !st.petVisible);
      setText(petStageStateBadge, st.petVisible ? (st.petTopmost ? '置顶显示中' : '普通窗口层') : '已隐藏');
      setText(petStageName, pack.name);
      if (petStageLine) {
        const prefix = st.honorificMode === 'zayu' ? '杂鱼君' : st.honorificMode === 'custom' ? (st.honorificCustom || '指挥官') : '人类';
        const lineMap = {
          idle: pack.sampleLine,
          proud: `哼哼，${prefix}快夸本喵！这个响应速度够丝滑吧？`,
          shy: `才、才不是特意为了${prefix}调整界面的呢……（耳灯变粉）`,
          angry: `${prefix}凌晨不睡觉还在改设置，小心键盘冒火星口牙！`
        };
        setText(petStageLine, lineMap[expr] || pack.sampleLine);
      }
      charCards.forEach((card) => {
        const active = card.dataset.charId === pack.id;
        setClass(card, 'is-selected', active);
        setAttr(card, 'aria-pressed', active ? 'true' : 'false');
      });
      exprButtons.forEach((btn) => {
        const active = btn.dataset.exprId === expr;
        setClass(btn, 'is-selected', active);
        setAttr(btn, 'aria-pressed', active ? 'true' : 'false');
      });
    }
    store.subscribeKeys(['characterPack', 'previewExpression', 'petVisible', 'petTopmost', 'petSize', 'petOpacity', 'honorificMode', 'honorificCustom'], refreshPetPreview);

    // 5. Wallpaper Gallery + Carousel/Grid View Toggle + Host Atelier Live Preview
    const wpContainer = rootEl.querySelector('[data-gallery-list]');
    const wpCards = Array.from(rootEl.querySelectorAll('[data-wallpaper-id]'));
    const wpViewBtns = Array.from(rootEl.querySelectorAll('[data-wp-view]'));
    const wpSelectedName = rootEl.querySelector('[data-preview="wp-name"]');
    const wpSelectedMeta = rootEl.querySelector('[data-preview="wp-meta"]');

    wpViewBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        perf.trackInteraction(`画廊视图:${btn.dataset.wpView}`, () => {
          store.set('galleryViewMode', btn.dataset.wpView, { label: '切换壁纸视图' });
        });
      });
    });

    wpCards.forEach((card) => {
      card.addEventListener('click', () => {
        perf.trackInteraction(`选择壁纸:${card.dataset.wallpaperId}`, () => {
          store.set('wallpaperId', card.dataset.wallpaperId, { label: '切换壁纸' });
        });
      });
    });

    store.subscribeKey('galleryViewMode', (mode) => {
      if (wpContainer) {
        wpContainer.classList.toggle('is-grid', mode === 'grid');
        wpContainer.classList.toggle('is-carousel', mode !== 'grid');
      }
      wpViewBtns.forEach((btn) => {
        const active = btn.dataset.wpView === mode;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    });

    const themePresetCards = Array.from(rootEl.querySelectorAll('[data-theme-preset]'));
    themePresetCards.forEach((card) => {
      card.addEventListener('click', () => {
        perf.trackInteraction(`主题预设:${card.dataset.themePreset}`, () => {
          store.set('themePreset', card.dataset.themePreset, { label: `切换主题:${card.dataset.themePreset}` });
        });
      });
    });

    const atelierStages = Array.from(rootEl.querySelectorAll('[data-preview="atelier-stage"]'));
    function refreshWallpaperAndTheme() {
      const st = store.getState();
      const wp = Study.WALLPAPERS.find((w) => w.id === st.wallpaperId) || Study.WALLPAPERS[0];
      const theme = Study.THEME_PRESETS[st.themePreset] || Study.THEME_PRESETS.violet;

      wpCards.forEach((card) => {
        const active = card.dataset.wallpaperId === wp.id;
        setClass(card, 'is-selected', active);
        setAttr(card, 'aria-pressed', active ? 'true' : 'false');
      });
      setText(wpSelectedName, wp.name);
      setText(wpSelectedMeta, `${wp.pack} · ${wp.resolution}`);

      themePresetCards.forEach((card) => {
        const active = card.dataset.themePreset === theme.id;
        setClass(card, 'is-selected', active);
        setAttr(card, 'aria-pressed', active ? 'true' : 'false');
      });

      atelierStages.forEach((stage) => {
        setStyleProp(stage, '--sample-base', theme.vars.base);
        setStyleProp(stage, '--sample-page', theme.vars.page);
        setStyleProp(stage, '--sample-card', theme.vars.card);
        setStyleProp(stage, '--sample-accent', theme.vars.accent);
        setStyleProp(stage, '--sample-wp-opacity', st.wallpaperEnabled ? String(st.bgOpacity) : '0');
        setStyleProp(stage, '--sample-scrim', String(st.bgScrim));
        const img = stage.querySelector('.atelier-bg-img');
        if (img && img.getAttribute('src') !== wp.src) {
          img.setAttribute('src', wp.src);
          setAttr(img, 'alt', wp.name);
        }
        const badge = stage.querySelector('[data-atelier-theme-name]');
        if (badge) {
          setText(badge, st.wallpaperEnabled ? `${theme.name} · ${wp.name}` : `${theme.name}（纯色护眼）`);
        }
      });
    }
    store.subscribeKeys(['wallpaperEnabled', 'wallpaperId', 'bgOpacity', 'bgScrim', 'themePreset'], refreshWallpaperAndTheme);

    // 6. Quota Calibration & Keyed BYOK Incremental Reconciliation (No innerHTML wipes!)
    const agyFiveBar = rootEl.querySelector('[data-quota="agy-5h-bar"]');
    const agyFiveText = rootEl.querySelector('[data-quota="agy-5h-text"]');
    const agyWeekBar = rootEl.querySelector('[data-quota="agy-1w-bar"]');
    const agyWeekText = rootEl.querySelector('[data-quota="agy-1w-text"]');
    const webFiveBar = rootEl.querySelector('[data-quota="web-5h-bar"]');
    const webFiveText = rootEl.querySelector('[data-quota="web-5h-text"]');

    function refreshQuotaView() {
      const st = store.getState();
      const useLeft = st.quotaDisplayMode !== 'used';
      const f5 = useLeft ? st.manualFiveHourLeft : 100 - st.manualFiveHourLeft;
      const f1w = useLeft ? st.manualWeeklyLeft : 100 - st.manualWeeklyLeft;
      const webLeft = st.syncWebUsage ? 72 : null;
      const webVal = webLeft === null ? null : (useLeft ? webLeft : 100 - webLeft);
      const label = useLeft ? '剩余' : '已用';

      if (agyFiveBar) agyFiveBar.style.width = `${f5}%`;
      if (agyFiveText) agyFiveText.textContent = `${label} ${f5}%`;
      if (agyWeekBar) agyWeekBar.style.width = `${f1w}%`;
      if (agyWeekText) agyWeekText.textContent = `${label} ${f1w}%`;
      if (webFiveBar) webFiveBar.style.width = webVal === null ? '0%' : `${webVal}%`;
      if (webFiveText) webFiveText.textContent = webVal === null ? '已暂停同步' : `${label} ${webVal}%`;
    }
    store.subscribeKeys(['manualFiveHourLeft', 'manualWeeklyLeft', 'quotaDisplayMode', 'syncWebUsage'], refreshQuotaView);

    const byokMount = rootEl.querySelector('[data-byok-list]');
    function ensureByokRows(providers) {
      if (!byokMount) return;
      if (!byokRowCache) {
        byokRowCache = new Map();
        const frag = document.createDocumentFragment();
        providers.forEach((p) => {
          const row = document.createElement('div');
          row.className = 'byok-row';
          row.dataset.providerId = p.id;
          row.innerHTML = `
            <div class="byok-info">
              <div class="byok-title-line">
                <strong class="byok-name"></strong>
                <span class="byok-pill"></span>
              </div>
              <div class="byok-meta"></div>
            </div>
            <div class="byok-actions">
              <button type="button" class="cs-btn byok-toggle-btn"></button>
            </div>
          `;
          const toggleBtn = row.querySelector('.byok-toggle-btn');
          toggleBtn.addEventListener('click', () => {
            perf.trackInteraction(`切换网关:${p.id}`, () => {
              const curr = store.get('byokProviders').map((item) =>
                item.id === p.id ? Object.assign({}, item, { enabled: !item.enabled }) : item
              );
              store.set('byokProviders', curr, { label: `切换 ${p.name}` });
            });
          });
          byokRowCache.set(p.id, row);
          frag.appendChild(row);
        });
        byokMount.appendChild(frag);
      }

      // Incremental surgical patch — only touch text/classes that actually changed
      providers.forEach((p) => {
        const row = byokRowCache.get(p.id);
        if (!row) return;
        const nameEl = row.querySelector('.byok-name');
        const pillEl = row.querySelector('.byok-pill');
        const metaEl = row.querySelector('.byok-meta');
        const btnEl = row.querySelector('.byok-toggle-btn');
        if (nameEl.textContent !== p.name) nameEl.textContent = p.name;
        const pillText = p.enabled ? (p.active ? '主通道' : '已启用') : '停用';
        if (pillEl.textContent !== pillText) pillEl.textContent = pillText;
        pillEl.dataset.state = p.enabled ? 'on' : 'off';
        const metaText = `${p.model} · ${p.quotaNote}`;
        if (metaEl.textContent !== metaText) metaEl.textContent = metaText;
        const btnText = p.enabled ? '停用' : '启用';
        if (btnEl.textContent !== btnText) btnEl.textContent = btnText;
        btnEl.setAttribute('aria-pressed', p.enabled ? 'true' : 'false');
      });
    }
    store.subscribeKey('byokProviders', ensureByokRows);

    // 7. Interactive Verification Toggles (Reduced Motion + Narrow Frame) & Head Pat Test
    if (reducedMotionCheckbox) {
      store.subscribeKey('reducedMotionSim', (val) => {
        reducedMotionCheckbox.checked = !!val;
        document.documentElement.setAttribute('data-reduced-motion', val ? 'true' : 'false');
      });
      reducedMotionCheckbox.addEventListener('change', () => {
        perf.trackInteraction('切换减弱动效', () => {
          store.set('reducedMotionSim', reducedMotionCheckbox.checked, { label: '模拟减弱动效', skipUndo: true });
        });
      });
    }

    if (narrowCheckbox) {
      narrowCheckbox.addEventListener('change', () => {
        perf.trackInteraction('切换窄窗模拟', () => {
          rootEl.classList.toggle('is-narrow-preview', narrowCheckbox.checked);
        });
      });
    }

    if (failSimCheckbox) {
      store.subscribeKey('simulateSaveFailure', (val) => {
        failSimCheckbox.checked = !!val;
      });
      failSimCheckbox.addEventListener('change', () => {
        perf.trackInteraction('切换模拟保存失败', () => {
          store.set('simulateSaveFailure', failSimCheckbox.checked, { label: '模拟保存失败开关', skipUndo: true });
        });
      });
    }

    const headPatBtn = rootEl.querySelector('[data-action="pat-cat"]');
    if (headPatBtn) {
      headPatBtn.addEventListener('click', () => {
        perf.trackInteraction('摸摸猫猫头', () => {
          const today = store.get('headPatToday') + 1;
          const total = store.get('headPatTotal') + 1;
          store.setMany({ headPatToday: today, headPatTotal: total, previewExpression: 'shy' }, { label: '摸头互动' });
        });
      });
    }

    const totalPatOut = rootEl.querySelector('[data-bind-text="headPatTotal"]');
    if (totalPatOut) {
      store.subscribeKey('headPatTotal', (v) => {
        setText(totalPatOut, `${v} 次`);
      });
    }

    // 8. Save Feedback, Draft Mode, Failure Recovery & Undo Controls
    store.subscribe((state, info) => {
      const dirtyCount = info.dirtyKeys.length;
      const isSaveError = info.meta.action === 'save-error';
      if (dirtyBadgeEl) {
        const badgeText = isSaveError
          ? `写入失败 · 待重试 (${dirtyCount})`
          : dirtyCount > 0
            ? `未保存改动 (${dirtyCount})`
            : state.autoSave ? '已自动同步生效 ✓' : '配置已保存 ✓';
        setText(dirtyBadgeEl, badgeText);
        const nextDirtyState = dirtyCount > 0 ? 'true' : 'false';
        if (dirtyBadgeEl.dataset.dirty !== nextDirtyState) dirtyBadgeEl.dataset.dirty = nextDirtyState;
      }
      if (undoBtn) {
        if (undoBtn.disabled !== (info.undoCount === 0)) undoBtn.disabled = info.undoCount === 0;
        setText(undoBtn, info.undoCount > 0 ? `撤销 (${info.undoCount})` : '撤销');
      }
      if (saveBtn) {
        const hideSave = state.autoSave && dirtyCount === 0 && !isSaveError;
        if (saveBtn.hidden !== hideSave) saveBtn.hidden = hideSave;
        setText(saveBtn, isSaveError || (state.autoSave && dirtyCount > 0) ? '重试保存' : '立即保存');
      }
      if (discardBtn) {
        const hideDiscard = dirtyCount === 0;
        if (discardBtn.hidden !== hideDiscard) discardBtn.hidden = hideDiscard;
      }
      if (!info.meta.init) {
        if (info.meta.action === 'save-error') {
          announceStatus(info.meta.error || '模拟保存失败，请重试或放弃改动回退', 'error');
        } else if (info.meta.action === 'undo') {
          announceStatus(`已撤销「${info.meta.label || '上一步'}」`, 'undo');
        } else if (info.meta.action === 'commit') {
          announceStatus('已保存全部设置快照并同步到桌宠与宿主 ✓', 'saved');
          if (onSavedFeedback) onSavedFeedback('saved');
        } else if (info.meta.action === 'discard') {
          announceStatus('已放弃草稿修改并回退至最近已保存快照 ✓', 'undo');
        } else if (info.changedKeys.every((k) => k === 'autoSave' || k === 'reducedMotionSim' || k === 'simulateSaveFailure')) {
          let modeName = '';
          if (info.changedKeys.includes('autoSave')) {
            modeName = state.autoSave ? '已切换为「修改即自动保存」✓' : '已切换为「草稿暂存模式」（改动后点立即保存）';
          } else if (info.changedKeys.includes('simulateSaveFailure')) {
            modeName = state.simulateSaveFailure
              ? '已开启「模拟保存失败」：后续修改将保留草稿等待重试或回退'
              : '已恢复正常持久化通道（若有未保存改动，可点「重试保存」）';
          } else {
            modeName = state.reducedMotionSim ? '已开启减弱动效模式 ✓' : '已恢复常规动效模式';
          }
          announceStatus(modeName, info.changedKeys.includes('simulateSaveFailure') && state.simulateSaveFailure ? 'dirty' : 'saved');
        } else if (state.autoSave) {
          announceStatus(`已即时保存：${info.meta.label || info.changedKeys.join(', ')} ✓`, 'saved');
          if (onSavedFeedback) onSavedFeedback('auto');
        } else {
          announceStatus(`草稿已修改「${info.meta.label || info.changedKeys[0]}」（待点击保存）`, 'dirty');
        }
      }
    });

    if (undoBtn) {
      undoBtn.addEventListener('click', () => {
        perf.trackInteraction('撤销改动', () => store.undo());
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        perf.trackInteraction('手动保存快照', () => store.commitDraft());
      });
    }

    if (discardBtn) {
      discardBtn.addEventListener('click', () => {
        perf.trackInteraction('放弃草稿', () => store.discardDraft());
      });
    }

    // Reset with non-blocking inline confirmation & Escape keyboard return
    if (resetTrigger && resetConfirmBox) {
      const closeResetDialog = (restoreFocus = true) => {
        resetConfirmBox.hidden = true;
        if (restoreFocus) resetTrigger.focus();
      };
      resetTrigger.addEventListener('click', () => {
        resetConfirmBox.hidden = false;
        resetCancelBtn?.focus();
      });
      resetCancelBtn?.addEventListener('click', () => closeResetDialog(true));
      resetConfirmBox.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeResetDialog(true);
        }
      });
      resetApplyBtn?.addEventListener('click', () => {
        perf.trackInteraction('恢复默认设置', () => {
          store.resetDefaults();
          closeResetDialog(true);
        });
      });
    }

    // Preview dock collapse toggle (narrow starts collapsed until toggled so settings fit first screen)
    const previewDock = rootEl.querySelector('[data-preview-dock]');
    const previewToggleBtn = rootEl.querySelector('[data-action="toggle-preview-dock"]');
    if (previewDock && previewToggleBtn) {
      if (!previewDock.hasAttribute('tabindex')) previewDock.setAttribute('tabindex', '-1');
      previewDock.classList.remove('is-open-narrow');
      previewToggleBtn.setAttribute('aria-expanded', 'false');
      previewToggleBtn.addEventListener('click', () => {
        const expanded = previewToggleBtn.getAttribute('aria-expanded') === 'true';
        const next = !expanded;
        previewToggleBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
        previewToggleBtn.textContent = next ? '收起预览' : '实时预览';
        previewDock.classList.toggle('is-open-narrow', next);
        if (next) {
          const reduced = store.get('reducedMotionSim') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          previewDock.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
          previewDock.focus({ preventScroll: true });
        }
      });
    }

    // Expose programmatic test/inspector hooks cleanly
    const api = {
      store,
      perf,
      switchPage,
      getActivePage: () => activePage,
      destroy: () => perf.destroy()
    };
    rootEl.__catstellaApp = api;
    return api;
  }

  Study.mountSettingsApp = mountSettingsApp;
})(window);
