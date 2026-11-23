/**
 * Catstella Web Companion Branch Demo — Arbitration State Machine
 *
 * Strictly separates:
 *  - `idle-collapsed`: pet button only
 *  - `speech-only`: auto-chatter whisper quote bubble (auto-retracts cleanly)
 *  - `full-panel`: manual user-woken full quota/settings panel (NEVER auto-closes)
 *
 * Enforces deterministic Preemption & Yield:
 *  - Collision A: User wakes pet during `speech-only` -> immediately clears auto-retract timer & promotes to `full-panel`
 *  - Collision B: Ambient chatter fires during `full-panel` -> yields/defers silently without clobbering user's open panel
 *  - Hover/Focus Lock: Pointer hover or keyboard focus inside speech bubble pauses countdown cleanly
 */
(function () {
  'use strict';

  const CHATTER_LINES = [
    '已经安静看文档好久啦，记得眨眨眼喝口水喵～',
    'Token 可以省，给本喵顺毛的夸夸不能省！',
    '刚才 Gemini 3.8 Flash 跑得好快呀，本喵耳朵都竖起来了！',
    '哼，才没有在偷看你的终端报错呢……真的需要帮忙可以点我打开面板。',
    '杂鱼君写代码别弓着背呀，脖子要抗议了口牙！'
  ];

  const RETRACT_MS = 3200;

  window.addEventListener('DOMContentLoaded', () => {
    const modeBadge = document.getElementById('web-mode-badge');
    const speechBubble = document.getElementById('speech-only-bubble');
    const speechTextEl = document.getElementById('speech-only-text');
    const speechTimerTextEl = document.getElementById('speech-countdown-text');
    const speechBarFill = document.getElementById('retract-bar-fill');
    const fullPanel = document.getElementById('web-full-panel');
    const fullPanelLineEl = document.getElementById('panel-dialogue-line');
    const catAvatarImg = document.getElementById('web-cat-avatar');
    const catWakeBtn = document.getElementById('web-cat-wake-btn');
    const catSubEl = document.getElementById('web-cat-sub');
    const closePanelBtn = document.getElementById('btn-close-web-panel');
    const stateJsonEl = document.getElementById('state-readout-json');
    const eventLogEl = document.getElementById('arbitration-log');
    const composerInput = document.getElementById('sim-gemini-prompt');
    const typingBadge = document.getElementById('typing-guard-check');
    const reducedMotionBox = document.getElementById('demo-reduced-motion');
    const packSelect = document.getElementById('demo-character-select');

    const tabs = Array.from(fullPanel.querySelectorAll('[role="tab"]'));

    const state = {
      surfaceMode: 'idle-collapsed', // 'idle-collapsed' | 'speech-only' | 'full-panel'
      owner: 'none',                 // 'none' | 'ambient' | 'manual'
      retractRemainingMs: 0,
      hoverPaused: false,
      focusPaused: false,
      userTyping: false,
      deferredChatterWaiting: false,
      preemptCount: 0,
      yieldCount: 0,
      retractCount: 0,
      lineIndex: 0,
      characterPack: 'gemini-star-v1',
      expression: 'idle'
    };

    let tickerId = null;
    let lastTick = 0;

    function assetFor(packId, expr) {
      const safePack = packId === 'lin-cat' ? 'lin-cat' : 'gemini-star-v1';
      return `../../../Antigravity-Cat-Widget/assets/character-packs/${safePack}/frames/${expr}.png`;
    }

    function pushLog(kind, msg) {
      const now = new Date();
      const ts = now.toTimeString().slice(0, 8);
      const li = document.createElement('li');
      li.dataset.kind = kind;
      li.textContent = `[${ts}] ${msg}`;
      eventLogEl.prepend(li);
      while (eventLogEl.children.length > 18) {
        eventLogEl.removeChild(eventLogEl.lastElementChild);
      }
    }

    function renderUI() {
      const modeNames = {
        'idle-collapsed': '空闲收起 (仅挂件)',
        'speech-only': '自动碎碎念 · 极简台词气泡',
        'full-panel': '手动唤醒 · 完整面板'
      };
      modeBadge.dataset.mode = state.surfaceMode;
      modeBadge.textContent = modeNames[state.surfaceMode];

      speechBubble.hidden = state.surfaceMode !== 'speech-only';
      fullPanel.hidden = state.surfaceMode !== 'full-panel';

      catWakeBtn.setAttribute('aria-expanded', state.surfaceMode === 'full-panel' ? 'true' : 'false');
      catAvatarImg.src = assetFor(state.characterPack, state.expression);

      const paused = state.hoverPaused || state.focusPaused;
      speechBubble.classList.toggle('is-paused', paused);

      if (state.surfaceMode === 'speech-only') {
        const secs = (state.retractRemainingMs / 1000).toFixed(1);
        speechTimerTextEl.textContent = paused ? `已暂停 (${secs}s)` : `${secs}s 后自然收起`;
        const ratio = Math.max(0, Math.min(1, state.retractRemainingMs / RETRACT_MS));
        speechBarFill.style.transform = `scaleX(${ratio.toFixed(3)})`;
        catSubEl.textContent = '点我切换完整面板';
      } else if (state.surfaceMode === 'full-panel') {
        catSubEl.textContent = '完整面板已锁定';
      } else {
        catSubEl.textContent = state.userTyping ? '输入避让中…' : '点我手动唤醒';
      }

      stateJsonEl.textContent = JSON.stringify({
        surfaceMode: state.surfaceMode,
        owner: state.owner,
        retractRemainingMs: Math.max(0, Math.round(state.retractRemainingMs)),
        hoverOrFocusLock: paused,
        userTypingGuard: state.userTyping,
        deferredChatterWaiting: state.deferredChatterWaiting,
        preemptCount: state.preemptCount,
        yieldCount: state.yieldCount,
        retractCount: state.retractCount
      }, null, 2);
    }

    function stopTicker() {
      if (tickerId) {
        cancelAnimationFrame(tickerId);
        tickerId = null;
      }
    }

    function startTicker() {
      stopTicker();
      lastTick = performance.now();
      function frame(now) {
        if (state.surfaceMode !== 'speech-only' || state.owner !== 'ambient') {
          stopTicker();
          return;
        }
        const dt = now - lastTick;
        lastTick = now;
        if (!state.hoverPaused && !state.focusPaused) {
          state.retractRemainingMs -= dt;
          if (state.retractRemainingMs <= 0) {
            state.retractRemainingMs = 0;
            state.surfaceMode = 'idle-collapsed';
            state.owner = 'none';
            state.expression = 'idle';
            state.retractCount += 1;
            stopTicker();
            pushLog('info', 'AUTO_RETRACT: 碎碎念播放完毕，台词气泡已自然收起');
            renderUI();
            return;
          }
        }
        renderUI();
        tickerId = requestAnimationFrame(frame);
      }
      tickerId = requestAnimationFrame(frame);
    }

    function triggerAmbientChatter(sourceLabel = '定时触发') {
      // Yield Rule B: Manual full panel owns surface -> auto-chatter MUST yield cleanly!
      if (state.surfaceMode === 'full-panel' && state.owner === 'manual') {
        state.yieldCount += 1;
        state.deferredChatterWaiting = true;
        pushLog('yield', `YIELD(${sourceLabel}): 检测到用户已打开完整面板，自动碎碎念主动让位（不覆盖、不启动自动关闭）`);
        renderUI();
        return 'yielded-to-manual-panel';
      }
      // Guard Rule C: User typing inside Gemini prompt
      if (state.userTyping) {
        state.yieldCount += 1;
        state.deferredChatterWaiting = true;
        pushLog('yield', `YIELD(${sourceLabel}): 用户正在输入框打字，自动碎碎念暂缓冒泡`);
        renderUI();
        return 'yielded-to-typing';
      }

      const line = CHATTER_LINES[state.lineIndex % CHATTER_LINES.length];
      state.lineIndex += 1;
      state.surfaceMode = 'speech-only';
      state.owner = 'ambient';
      state.retractRemainingMs = RETRACT_MS;
      state.deferredChatterWaiting = false;
      state.expression = 'shy';
      speechTextEl.textContent = line;
      pushLog('info', `AMBIENT(${sourceLabel}): 仅展示台词气泡 (${RETRACT_MS / 1000}s 后自然收起)`);
      renderUI();
      startTicker();
      return 'shown-speech-only';
    }

    function wakeFullPanel(triggerSource = '点击猫猫头像') {
      const wasSpeechOnly = state.surfaceMode === 'speech-only';
      const hadSpeechFocus = document.activeElement === speechBubble || speechBubble.contains(document.activeElement);
      if (wasSpeechOnly) {
        // Preemption Rule A: Kill pending retract timer cleanly and promote!
        stopTicker();
        state.retractRemainingMs = 0;
        state.preemptCount += 1;
        state.expression = 'proud';
        fullPanelLineEl.textContent = `${speechTextEl.textContent}（已锁定完整面板，不再自动收起）`;
        pushLog('preempt', `PREEMPT(${triggerSource}): 自动碎碎念立即让位！已清除收起计时并升级为完整面板`);
      } else {
        state.expression = 'proud';
        fullPanelLineEl.textContent = CHATTER_LINES[state.lineIndex % CHATTER_LINES.length];
        pushLog('info', `MANUAL_WAKE(${triggerSource}): 打开完整额度与设置面板（无自动收起）`);
      }
      state.surfaceMode = 'full-panel';
      state.owner = 'manual';
      state.hoverPaused = false;
      state.focusPaused = false;
      renderUI();
      if (hadSpeechFocus || triggerSource.includes('键盘')) {
        closePanelBtn.focus();
      }
    }

    function closeFullPanel() {
      if (state.surfaceMode !== 'full-panel') return;
      state.surfaceMode = 'idle-collapsed';
      state.owner = 'none';
      state.expression = 'idle';
      pushLog('info', 'MANUAL_CLOSE: 用户收起完整面板，回到待机挂件状态');
      if (state.deferredChatterWaiting) {
        state.deferredChatterWaiting = false;
        pushLog('info', 'QUEUE_INFO: 此前被让位的碎碎念已过期丢弃，绝不突兀补弹打扰');
      }
      renderUI();
      catWakeBtn.focus();
    }

    // Bind Cat Mascot Click & Speech Bubble Click -> Manual Wake / Toggle
    catWakeBtn.addEventListener('click', () => {
      if (state.surfaceMode === 'full-panel') closeFullPanel();
      else wakeFullPanel('点击桌宠挂件');
    });

    speechBubble.addEventListener('click', () => wakeFullPanel('点击碎碎念台词气泡'));
    speechBubble.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        wakeFullPanel('键盘回车台词气泡');
      }
    });

    speechBubble.addEventListener('mouseenter', () => {
      if (state.surfaceMode === 'speech-only') {
        state.hoverPaused = true;
        renderUI();
      }
    });
    speechBubble.addEventListener('mouseleave', () => {
      state.hoverPaused = false;
      renderUI();
    });
    speechBubble.addEventListener('focusin', () => {
      if (state.surfaceMode === 'speech-only') {
        state.focusPaused = true;
        renderUI();
      }
    });
    speechBubble.addEventListener('focusout', () => {
      state.focusPaused = false;
      renderUI();
    });

    closePanelBtn.addEventListener('click', closeFullPanel);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.surfaceMode !== 'idle-collapsed') {
        stopTicker();
        if (state.surfaceMode === 'full-panel') {
          closeFullPanel();
        } else if (state.surfaceMode === 'speech-only') {
          state.surfaceMode = 'idle-collapsed';
          state.owner = 'none';
          state.expression = 'idle';
          pushLog('info', 'ESC_DISMISS: 键盘 Esc 收起台词气泡');
          renderUI();
          catWakeBtn.focus();
        }
      }
    });

    // Panel WAI-ARIA tabs
    tabs.forEach((tab, idx) => {
      tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
      function activate(targetTab, focusIt = false) {
        tabs.forEach((t) => {
          const sel = t === targetTab;
          t.setAttribute('aria-selected', sel ? 'true' : 'false');
          t.tabIndex = sel ? 0 : -1;
          const p = document.getElementById(t.getAttribute('aria-controls'));
          if (p) p.hidden = !sel;
        });
        if (focusIt) targetTab.focus();
      }
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', (e) => {
        let n = -1;
        if (e.key === 'ArrowRight') n = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') n = (idx - 1 + tabs.length) % tabs.length;
        if (n >= 0) { e.preventDefault(); activate(tabs[n], true); }
      });
    });

    // TestBench Controls
    document.getElementById('btn-sim-ambient').addEventListener('click', () => triggerAmbientChatter('手动演练'));
    document.getElementById('btn-sim-manual').addEventListener('click', () => {
      if (state.surfaceMode === 'full-panel') closeFullPanel();
      else wakeFullPanel('测试台手动唤醒');
    });
    document.getElementById('btn-sim-collision-a').addEventListener('click', () => {
      triggerAmbientChatter('碰撞A·先出碎碎念');
      setTimeout(() => wakeFullPanel('碰撞A·用户400ms后抢占唤醒'), 400);
    });
    document.getElementById('btn-sim-collision-b').addEventListener('click', () => {
      if (state.surfaceMode !== 'full-panel') wakeFullPanel('碰撞B·先打开完整面板');
      setTimeout(() => triggerAmbientChatter('碰撞B·后台碎碎念到点'), 300);
    });
    document.getElementById('btn-sim-reset').addEventListener('click', () => {
      stopTicker();
      state.surfaceMode = 'idle-collapsed';
      state.owner = 'none';
      state.retractRemainingMs = 0;
      state.hoverPaused = false;
      state.focusPaused = false;
      state.deferredChatterWaiting = false;
      state.expression = 'idle';
      pushLog('info', 'RESET: 状态机已重置到空闲等待态');
      renderUI();
    });

    typingBadge.addEventListener('change', () => {
      state.userTyping = typingBadge.checked;
      renderUI();
    });
    composerInput.addEventListener('focus', () => {
      state.userTyping = true;
      typingBadge.checked = true;
      renderUI();
    });
    composerInput.addEventListener('blur', () => {
      state.userTyping = false;
      typingBadge.checked = false;
      renderUI();
    });
    reducedMotionBox.addEventListener('change', () => {
      document.documentElement.setAttribute('data-reduced-motion', reducedMotionBox.checked ? 'true' : 'false');
    });
    packSelect.addEventListener('change', () => {
      state.characterPack = packSelect.value;
      renderUI();
    });

    window.__catstellaWebDemo = {
      getState: () => Object.assign({}, state),
      triggerAmbientChatter,
      wakeFullPanel,
      closeFullPanel
    };

    pushLog('info', 'INIT: 状态机就绪，自动碎碎念与手动面板严格分流');
    renderUI();
  });
})();
