// 星语探针 · 只读 DOM 采样 (thinking pill / upload preview / edit mode)
// 设计红线：绝不修改页面、绝不发送消息、绝不触发交互事件；
// 只读取 computed style 并把快照回传本机收集器（经 background SW fetch）。
(() => {
  if (window.__KG_PROBE_ACTIVE__) return;
  window.__KG_PROBE_ACTIVE__ = true;

  const FLUSH_MS = 2000;
  const MAX_BUFFER = 300;
  const buffer = [];
  let seq = 0;

  const now = () => Date.now();
  const pick = (el) => {
    try {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 120),
        kg: el.getAttribute && el.getAttribute('data-kg'),
        bg: cs.backgroundColor,
        bi: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 60) : '',
        bf: cs.backdropFilter !== 'none' ? cs.backdropFilter.slice(0, 30) : '',
        br: cs.borderRadius,
        ov: cs.overflow,
        dp: cs.display,
        op: cs.opacity,
        co: cs.color.slice(0, 28),
        rc: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        tx: el.children.length === 0 ? (el.textContent || '').trim().slice(0, 60) : '',
      };
    } catch (e) { return null; }
  };

  const tree = (root, maxDepth = 8, maxNodes = 60) => {
    const out = [];
    const walk = (el, d) => {
      if (d > maxDepth || out.length >= maxNodes) return;
      const p = pick(el);
      if (p) out.push({ d, ...p });
      [...el.children].forEach((c) => walk(c, d + 1));
    };
    walk(root, 0);
    return out;
  };

  const parents = (el, n = 5) => {
    const out = [];
    let cur = el.parentElement;
    for (let i = 0; cur && i < n; i++) {
      const p = pick(cur);
      if (p) out.push({ lv: i, ...p });
      cur = cur.parentElement;
    }
    return out;
  };

  const env = () => ({
    url: location.pathname,
    skin: document.documentElement.classList.contains('kimino-dream-active'),
    kg: {
      thinking: document.querySelectorAll('[data-kg="thinking"]').length,
      card: document.querySelectorAll('[data-kg="card"]').length,
      composer: document.querySelectorAll('[data-kg="composer"]').length,
    },
  });

  const push = (record) => {
    if (buffer.length >= MAX_BUFFER) buffer.shift();
    buffer.push({ seq: ++seq, ts: now(), ...env(), ...record });
  };

  const sig = (arr) => JSON.stringify(arr.map((x) => [x.tag, x.cls, x.bg, x.bi, x.bf, x.rc])).slice(0, 4000);
  const lastSigs = new Map();

  // ============ 1) 思维链药丸采样 ============
  let thinkingSeen = false;
  const thinkSigKey = 'thinking';
  setInterval(() => {
    const tc = document.querySelector('.thinking-container');
    if (!tc) { thinkingSeen = false; return; }
    const treeArr = tree(tc, 9, 70);
    const parentsArr = parents(tc, 6);
    const key = sig(treeArr) + '|' + sig(parentsArr);
    if (!thinkingSeen || lastSigs.get(thinkSigKey) !== key) {
      thinkingSeen = true;
      lastSigs.set(thinkSigKey, key);
      push({ kind: 'thinking', tree: treeArr, parents: parentsArr });
    }
  }, 300);

  // ============ 2) 上传预览卡采样 ============
  let uploadSig = '';
  setInterval(() => {
    const host = document.querySelector('uploader-file-preview');
    if (!host) { uploadSig = ''; return; }
    const treeArr = tree(host, 9, 70);
    const parentsArr = parents(host, 5);
    const key = sig(treeArr);
    if (uploadSig !== key) {
      uploadSig = key;
      push({ kind: 'upload', tree: treeArr, parents: parentsArr });
    }
  }, 400);

  // ============ 3) 编辑态采样（验证修复用） ============
  let editSig = '';
  setInterval(() => {
    const form = document.querySelector('.edit-form.rich-edit-form');
    const btnArea = document.querySelector('.edit-button-area');
    if (!form && !btnArea) { editSig = ''; return; }
    const treeArr = [...(form ? tree(form, 6, 40) : []), ...(btnArea ? tree(btnArea, 5, 30) : [])];
    const key = sig(treeArr);
    if (editSig !== key) {
      editSig = key;
      push({ kind: 'edit', tree: treeArr });
    }
  }, 500);

  // ============ 4) 壁纸时间线（2026-11-09 壁纸同步风暴排查） ============
  // data URL 动辄数 MB：不落原文，用长度+散布采样指纹区分不同壁纸。
  const wpFingerprint = (s) => {
    if (!s || s.length < 64) return String(s || '').slice(0, 30);
    return 'len' + s.length + ':' + s.charCodeAt(64) + ',' + s.charCodeAt(Math.floor(s.length / 3)) + ',' + s.charCodeAt(Math.floor(s.length * 2 / 3)) + ',' + s.charCodeAt(s.length - 64);
  };
  let wpHooked = false;
  const ensureWpHook = () => {
    if (wpHooked) return;
    const wp = document.getElementById('kimino-dream-wallpaper');
    if (!wp) return;
    wpHooked = true;
    const rec = (ev, detail = {}) => push({ kind: 'wallpaper', ev, vis: document.visibilityState, path: location.pathname, ...detail });
    rec('hook', { fp: wpFingerprint(wp.style.backgroundImage), stage: !!wp.__kgWallpaperStage });
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.attributeName === 'style') {
          const bi = wp.style.backgroundImage || '';
          rec('commit', { fp: wpFingerprint(bi), hasStage: !!wp.__kgWallpaperStage });
        }
      }
    }).observe(wp, { attributes: true, attributeFilter: ['style'] });
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('kimino-wallpaper-incoming')) rec('xfade-start', { fp: wpFingerprint(n.style.backgroundImage || '') });
        }
        for (const n of m.removedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('kimino-wallpaper-incoming')) rec('xfade-end', {});
        }
      }
    }).observe(wp, { childList: true });
  };
  setInterval(ensureWpHook, 700);
  document.addEventListener('visibilitychange', () => push({ kind: 'wallpaper', ev: 'visibility', vis: document.visibilityState, t: Date.now() }), true);
  window.addEventListener('focus', () => push({ kind: 'wallpaper', ev: 'focus', vis: document.visibilityState, t: Date.now() }), true);
  window.addEventListener('blur', () => push({ kind: 'wallpaper', ev: 'blur', vis: document.visibilityState, t: Date.now() }), true);

  // ============ 回传（background SW 统一 fetch，规避 MV3 内容脚本跨域限制） ============
  const flush = () => {
    if (!buffer.length) return;
    const batch = buffer.splice(0, buffer.length);
    try {
      chrome.runtime.sendMessage({ type: 'kg-probe-flush', batch }, () => { void chrome.runtime.lastError; });
    } catch (e) {
      // 扩展上下文失效时静默丢弃，绝不影响页面
    }
  };
  setInterval(flush, FLUSH_MS);
  window.addEventListener('pagehide', () => { try { flush(); } catch (e) {} });

  console.log('[星语探针] 只读采样已启动（thinking/upload/edit → 127.0.0.1:17877）');
})();
