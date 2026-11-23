// Fixed wallpaper-composited fade. Messages and their backdrop filters are never masked.
// update() runs for layout/settings changes only; there are no scroll/wheel handlers.
(() => {
  if (window.KiminoFixedFade) return;
  window.KiminoFixedFade = class {
    constructor(schedule) {
      this.host = null;
      this.layer = null;
      this.wallpaper = null;
      this.signature = '';
      this.observer = window.ResizeObserver ? new ResizeObserver(schedule) : null;
      this.observed = [];
    }

    destroy() {
      this.wallpaper?.__kgMirrorAnimation?.cancel();
      this.layer?.remove();
      this.host?.removeAttribute('data-kg-fade-host');
      this.host = this.layer = this.wallpaper = null;
      this.signature = '';
      this.observer?.disconnect();
      this.observed = [];
    }

    syncWallpaper(source, opacity) {
      if (!this.wallpaper || !source) return;
      const image = source.style.backgroundImage;
      if (window.KiminoWallpaper) window.KiminoWallpaper.mirror(source, this.wallpaper);
      else if (this.wallpaper.style.backgroundImage !== image) this.wallpaper.style.backgroundImage = image;
      const alpha = String(opacity);
      if (this.wallpaper.style.opacity !== alpha) this.wallpaper.style.opacity = alpha;
    }

    update(source, opacity, textarea) {
      if (!source?.isConnected || !textarea?.isConnected) { this.destroy(); return; }
      // 主页 / 新会话没有任何消息可溶解：这层只会把暗色底板画在壁纸上，
      // 形成主页对话框上方的黑雾（2026-11-09 用户实机反馈）。直接不建。
      if (!document.querySelector('model-response, user-query')) { this.destroy(); return; }
      const pill = textarea.closest('input-area-v2') || textarea.closest('[data-kg="composer"]');
      // Mount outside the blurred pill: backdrop-filter changes fixed containing blocks.
      const host = textarea.closest('input-container') || pill?.parentElement;
      const scroller = document.querySelector('infinite-scroller.chat-history') ||
        document.querySelector('model-response, user-query')?.closest('infinite-scroller');
      if (!pill || !host || !scroller || host.contains(scroller)) { this.destroy(); return; }
      const composer = pill.getBoundingClientRect();
      const pane = source.getBoundingClientRect();
      const chat = scroller.getBoundingClientRect();
      // The wallpaper spans the whole workspace, including Maps/Canvas panes.
      // Keep its full geometry for image alignment, but paint only within chat.
      const chatLeft = Math.max(pane.left, chat.left);
      const chatRight = Math.min(pane.right, chat.right);
      if (composer.height <= 0 || pane.width <= 0 || chat.width <= 0 || chatRight <= chatLeft) { this.destroy(); return; }
      const banner = host.querySelector('.inline-upgrade-banner-row, .gem-banner-container, [data-test-id="gem-banner-description-input"]');
      const bannerRect = banner?.getBoundingClientRect();
      const top = bannerRect && bannerRect.height > 0 && bannerRect.top > 50 && bannerRect.top < composer.top
        ? bannerRect.top : composer.top;
      const start = Math.max(0, Math.round(top - 8));
      const end = Math.max(start + 24, Math.round(Math.min(top + 56, composer.bottom)));
      const signature = [pane.left, pane.top, pane.width, pane.height, composer.left, chatLeft, chatRight, start, end].join('_');

      if (this.host !== host || !this.layer?.isConnected) {
        this.destroy();
        this.host = host;
        host.setAttribute('data-kg-fade-host', '');
        this.layer = document.createElement('div');
        this.layer.id = 'kimino-static-fade';
        this.layer.setAttribute('aria-hidden', 'true');
        this.wallpaper = document.createElement('div');
        this.wallpaper.className = 'kimino-fade-wallpaper';
        this.layer.appendChild(this.wallpaper);
        host.prepend(this.layer);
      }
      const nav = document.querySelector('bard-sidenav');
      const targets = [pill, host, source, scroller, ...(nav ? [nav] : []), ...(banner ? [banner] : [])];
      if (targets.length !== this.observed.length || targets.some((node, i) => node !== this.observed[i])) {
        this.observer?.disconnect();
        targets.forEach(node => this.observer?.observe(node));
        this.observed = targets;
      }
      this.syncWallpaper(source, opacity);
      if (signature === this.signature) return;
      this.signature = signature;
      const style = this.layer.style;
      style.left = pane.left + 'px';
      style.top = pane.top + 'px';
      style.width = pane.width + 'px';
      style.height = pane.height + 'px';

      // Translated/scaled composer shells are common. Correct only at geometry changes,
      // with one bounded layout read, never in the scrolling path.
      const actual = this.layer.getBoundingClientRect();
      const sx = actual.width / pane.width || 1;
      const sy = actual.height / pane.height || 1;
      style.left = (pane.left + (pane.left - actual.left) / sx) + 'px';
      style.top = (pane.top + (pane.top - actual.top) / sy) + 'px';
      style.width = (pane.width / sx) + 'px';
      style.height = (pane.height / sy) + 'px';
      const a = Math.max(0, (start - pane.top) / sy);
      const b = Math.max(a + 1, (end - pane.top) / sy);
      style.setProperty('clip-path', `inset(0px ${Math.max(0, (pane.right - chatRight) / sx)}px 0px ${Math.max(0, (chatLeft - pane.left) / sx)}px)`);
      const span = b - a;
      const mask = `linear-gradient(to bottom, transparent 0px, transparent ${a}px, rgba(0,0,0,.05) ${a + span * .18}px, rgba(0,0,0,.20) ${a + span * .38}px, rgba(0,0,0,.48) ${a + span * .60}px, rgba(0,0,0,.76) ${a + span * .80}px, rgba(0,0,0,.94) ${a + span * .94}px, black ${b}px, black 100%)`;
      style.setProperty('mask-image', mask);
      style.setProperty('-webkit-mask-image', mask);
    }
  };
})();
