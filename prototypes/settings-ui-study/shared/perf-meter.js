/**
 * Catstella Settings UI Study — Measurable Performance & A11y Telemetry HUD
 *
 * Uses a scoped MutationObserver (excluding the HUD itself) to measure exact
 * DOM mutations triggered by each user interaction, proving zero full-page
 * rebuilds vs legacy render() churn, plus active backdrop-filter layer audit.
 */
(function (global) {
  'use strict';

  function countBackdropBlurLayers(rootEl) {
    if (!rootEl) return 0;
    let count = 0;
    const nodes = rootEl.querySelectorAll('*');
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (el.closest('[data-perf-hud]')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
      if (bf !== 'none' && bf.includes('blur')) {
        count += 1;
      }
    }
    return count;
  }

  function createPerfMonitor({ observeRoot, hudMount, variantLabel }) {
    let pendingMutations = 0;
    let totalOps = 0;
    let totalMutations = 0;
    let lastOpMutations = 0;
    let lastOpMs = 0;
    let lastOpName = '就绪';
    let maxOpMutations = 0;
    let fullRebuildCount = 0;
    let fpsEstimate = 60;
    let blurLayerCount = 0;

    let mutNodesEl = null;
    let opTimeEl = null;
    let blurEl = null;
    let rebuildEl = null;
    let fpsEl = null;
    let opNameEl = null;

    if (hudMount) {
      hudMount.setAttribute('data-perf-hud', 'true');
      hudMount.innerHTML = `
        <div class="perf-pill" aria-label="浏览器实测性能遥测（不含页面演示数值）">
          <span class="perf-badge">${variantLabel} · 浏览器实测</span>
          <span class="perf-metric" title="MutationObserver 实测最近一次交互修改的 DOM 节点/属性数">DOM 变动: <strong data-m="lastMut">0</strong> 节点</span>
          <span class="perf-metric" title="整页重建次数（单次改动 >85 节点判定，目标为 0）">整页重绘: <strong data-m="rebuilds">0</strong></span>
          <span class="perf-metric" title="getComputedStyle 实测当前可视区活跃 backdrop-filter blur 层数">模糊层: <strong data-m="blurs">0</strong></span>
          <span class="perf-metric" title="performance.now 实测同步交互脚本处理耗时">脚本耗时: <strong data-m="ms">0.00ms</strong></span>
          <span class="perf-metric perf-fps" title="requestAnimationFrame 窗口帧率实测">帧率: <strong data-m="fps">60</strong>fps</span>
          <span class="perf-op-label" data-m="opName">待命</span>
        </div>
      `;
      mutNodesEl = hudMount.querySelector('[data-m="lastMut"]');
      rebuildEl = hudMount.querySelector('[data-m="rebuilds"]');
      blurEl = hudMount.querySelector('[data-m="blurs"]');
      opTimeEl = hudMount.querySelector('[data-m="ms"]');
      fpsEl = hudMount.querySelector('[data-m="fps"]');
      opNameEl = hudMount.querySelector('[data-m="opName"]');
    }

    const observer = new MutationObserver((records) => {
      let count = 0;
      for (let i = 0; i < records.length; i += 1) {
        const rec = records[i];
        const target = rec.target;
        if (target && target.nodeType === 1 && target.closest('[data-perf-hud]')) continue;
        if (rec.type === 'childList') {
          count += rec.addedNodes.length + rec.removedNodes.length + 1;
        } else {
          count += 1;
        }
      }
      pendingMutations += count;
    });

    if (observeRoot) {
      observer.observe(observeRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    }

    function refreshBlurCount() {
      blurLayerCount = countBackdropBlurLayers(observeRoot || document.body);
      if (blurEl) blurEl.textContent = String(blurLayerCount);
      return blurLayerCount;
    }

    // Light FPS sampler over 1.2s rolling window without creating permanent jank
    let frames = 0;
    let lastStamp = performance.now();
    let fpsTimer = null;
    function tickFps(now) {
      frames += 1;
      const elapsed = now - lastStamp;
      if (elapsed >= 1000) {
        fpsEstimate = Math.min(60, Math.max(1, Math.round((frames * 1000) / elapsed)));
        if (fpsEl) fpsEl.textContent = String(fpsEstimate);
        frames = 0;
        lastStamp = now;
      }
      fpsTimer = requestAnimationFrame(tickFps);
    }
    fpsTimer = requestAnimationFrame(tickFps);

    function flushHud() {
      if (mutNodesEl) mutNodesEl.textContent = String(lastOpMutations);
      if (rebuildEl) rebuildEl.textContent = String(fullRebuildCount);
      if (opTimeEl) opTimeEl.textContent = `${lastOpMs.toFixed(2)}ms`;
      if (opNameEl) opNameEl.textContent = lastOpName;
    }

    function trackInteraction(opName, fn) {
      observer.takeRecords();
      pendingMutations = 0;
      const t0 = performance.now();
      const res = fn();
      const t1 = performance.now();
      const syncRecords = observer.takeRecords();
      let count = pendingMutations;
      for (let i = 0; i < syncRecords.length; i += 1) {
        const rec = syncRecords[i];
        if (rec.target && rec.target.nodeType === 1 && rec.target.closest('[data-perf-hud]')) continue;
        count += rec.type === 'childList' ? (rec.addedNodes.length + rec.removedNodes.length + 1) : 1;
      }
      lastOpMutations = count;
      lastOpMs = Math.max(0.05, t1 - t0);
      lastOpName = opName;
      totalOps += 1;
      totalMutations += count;
      if (count > maxOpMutations) maxOpMutations = count;
      // Threshold check: in legacy render() switching/toggling touches >80 nodes or wipes innerHTML;
      // intentional page switch only toggles [hidden] on 2 panels (<10 mutations).
      if (count > 85) {
        fullRebuildCount += 1;
      }
      flushHud();
      return res;
    }

    // Initial audit after styles settle
    requestAnimationFrame(() => {
      refreshBlurCount();
      flushHud();
    });

    function getSnapshot() {
      return {
        variantLabel,
        totalOps,
        totalMutations,
        avgMutationsPerOp: totalOps ? Number((totalMutations / totalOps).toFixed(1)) : 0,
        lastOpName,
        lastOpMutations,
        maxOpMutations,
        lastOpMs: Number(lastOpMs.toFixed(2)),
        fullRebuildCount,
        blurLayerCount: refreshBlurCount(),
        fpsEstimate
      };
    }

    function destroy() {
      observer.disconnect();
      if (fpsTimer) cancelAnimationFrame(fpsTimer);
    }

    return {
      trackInteraction,
      refreshBlurCount,
      getSnapshot,
      destroy
    };
  }

  global.CatstellaStudy = Object.assign(global.CatstellaStudy || {}, {
    createPerfMonitor
  });
})(window);
