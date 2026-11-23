(() => {
  const tag = 'catstella-usage-viewer';
  if (customElements.get(tag)) return;

  const css = `
    :host {
      display:block; color:var(--usage-text,#f0edf6);
      font:14px/1.45 system-ui,"Microsoft YaHei UI",sans-serif;
      --muted:var(--usage-muted,#aaa5b5);
      --accent:var(--usage-accent,var(--kg-palette-accent,#bda2f2));
      --border:var(--usage-border,rgba(var(--kg-palette-accent-rgb,189,162,242),.20));
    }
    * { box-sizing:border-box }
    [hidden] { display:none !important }
    .panel {
      padding:14px 16px 13px;
      background:var(--usage-surface,var(--kg-palette-base,#211e2d));
      border:1px solid var(--border);
      border-radius:14px;
      box-shadow:0 14px 40px #100a2080;
    }
    header { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px }
    h2 { margin:0; color:var(--muted); font-size:13px; font-weight:500 }
    h2:focus-visible { outline:2px solid var(--accent); outline-offset:3px; border-radius:2px }
    button {
      display:grid; place-items:center; width:26px; height:26px; padding:0;
      border:1px solid transparent; border-radius:7px; background:transparent; color:var(--muted);
      cursor:pointer;
    }
    button:hover { color:inherit; background:#ffffff0d }
    button:focus-visible { outline:2px solid var(--accent); outline-offset:2px }
    button:disabled { opacity:.5; cursor:wait }
    button svg { width:15px; height:15px }
    section + section { margin-top:14px; padding-top:13px; border-top:1px solid #ffffff0d }
    h3 { margin:0 0 6px; font-size:14px; font-weight:650 }
    dl, dd { margin:0 }
    .row { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; align-items:start; padding:5px 0 }
    dt { color:var(--muted); overflow-wrap:anywhere }
    dd { text-align:right; min-width:0 }
    .reading { display:flex; align-items:center; justify-content:flex-end; gap:8px; font-weight:640; font-variant-numeric:tabular-nums; white-space:nowrap }
    .reading.is-muted { color:var(--muted); font-weight:500 }
    .meter { width:17px; height:17px; flex:none; display:block; transform:rotate(-90deg); color:var(--usage-meter,#8ecf80) }
    .meter[data-tone=warning] { color:#e0b674 }
    .meter[data-tone=critical] { color:#ee7d85 }
    .track { stroke:#ffffff24 }
    .arc { stroke:currentColor }
    .reset { display:block; color:var(--muted); font-size:11px; margin-top:2px; overflow-wrap:anywhere }
    .empty { margin:8px 0; color:var(--muted) }
    footer { margin-top:9px; padding-top:9px; border-top:1px solid #ffffff12; color:var(--muted); font-size:11px }
    :host([compact]) { font-size:12px; line-height:1.4; min-width:0 }
    :host([compact]) .panel { padding:7px 10px 8px; border-radius:9px; box-shadow:none }
    :host([compact]) header { margin-bottom:4px }
    :host([compact]) h2 { font-size:11px }
    :host([compact]) h3 { margin-bottom:2px; font-size:12px }
    :host([compact]) section + section { margin-top:5px; padding-top:6px }
    :host([compact]) .row { padding:3px 0; grid-template-columns:minmax(0,1fr) auto; gap:6px }
    :host([compact]) .reading { gap:5px }
    :host([compact]) .meter { width:13px; height:13px }
    :host([compact]) .reset { font-size:10px; margin-top:0 }
    :host([compact]) footer { font-size:10px; margin-top:5px; padding-top:5px }
  `;

  const node = (tagName, className, text) => {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  };
  const ns = 'http://www.w3.org/2000/svg';
  function svg(name, attributes) {
    const el = document.createElementNS(ns, name);
    Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }
  function ring() {
    const el = svg('svg', { viewBox: '0 0 20 20', class: 'meter', 'aria-hidden': 'true' });
    for (const className of ['track', 'arc']) {
      el.append(svg('circle', { cx: 10, cy: 10, r: 8, pathLength: 100, fill: 'none',
        'stroke-width': 2, 'stroke-linecap': 'round', class: className }));
    }
    return el;
  }
  function formatReset(ms) {
    if (ms < 60000) return `${Math.ceil(ms / 1000)} 秒后重置`;
    const minutes = Math.ceil(ms / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor(minutes % 1440 / 60);
    const rest = minutes % 60;
    return `${days ? `${days} 天 ` : ''}${hours ? `${hours} 小时 ` : ''}${!days && rest ? `${rest} 分钟` : ''}`.trim() + '后重置';
  }

  class UsageViewer extends HTMLElement {
    #data = {};
    #rows = [];
    #timer;

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      const style = node('style', '', css);
      this.panel = node('div', 'panel');
      this.panel.setAttribute('role', 'region');
      this.panel.setAttribute('aria-labelledby', 'usage-title');
      const header = node('header');
      this.heading = node('h2', '', '用量');
      this.heading.id = 'usage-title';
      this.heading.tabIndex = -1;
      this.refresh = node('button');
      this.refresh.type = 'button';
      this.refresh.title = '刷新用量';
      this.refresh.setAttribute('aria-label', '刷新用量');
      const icon = svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
      icon.append(svg('path', { d: 'M20 11a8 8 0 1 0-2.3 6M20 5v6h-6' }));
      this.refresh.append(icon);
      this.refresh.addEventListener('click', () => this.dispatchEvent(new CustomEvent('usage-refresh', { bubbles: true, composed: true })));
      header.append(this.heading, this.refresh);
      this.body = node('div');
      this.status = node('footer');
      this.status.setAttribute('role', 'status');
      this.panel.append(header, this.body, this.status);
      this.shadowRoot.append(style, this.panel);
    }

    connectedCallback() {
      this.#render();
      this.#timer = setInterval(() => this.#update(), 1000);
    }

    disconnectedCallback() { clearInterval(this.#timer); }

    set data(value) {
      this.#data = value || {};
      this.#render();
    }

    focusHeading() { this.heading.focus(); }

    #render() {
      const { groups = [], status = '', refreshing = false } = this.#data;
      this.refresh.disabled = refreshing;
      this.status.hidden = !status;
      if (this.status.textContent !== status) this.status.textContent = status;
      this.body.replaceChildren();
      this.#rows = [];
      for (const group of groups) {
        const section = node('section');
        const list = node('dl');
        section.append(node('h3', '', group.name), list);
        for (const row of group.rows) {
          const wrapper = node('div', 'row');
          const details = node('dd');
          const reading = node('div', 'reading');
          const amount = node('span');
          const meter = ring();
          const reset = node('time', 'reset');
          reading.append(amount, meter);
          details.append(reading, reset);
          wrapper.append(node('dt', '', row.label), details);
          list.append(wrapper);
          this.#rows.push({ row, reading, amount, meter, reset });
        }
        this.body.append(section);
      }
      if (!groups.length) this.body.append(node('p', 'empty', '暂无用量数据'));
      this.#update();
    }

    #update() {
      const now = Date.now();
      for (const { row, reading, amount, meter, reset } of this.#rows) {
        const hasReset = Number.isFinite(row.resetAt) && row.resetAt > 0;
        const waiting = row.state === 'pending' || (hasReset && row.resetAt <= now);
        const value = !waiting && Number.isFinite(row.remaining)
          ? Math.round(Math.max(0, Math.min(100, row.remaining))) : null;
        const label = waiting ? '等待更新' : value === null ? '—' : `余 ${value}%`;
        if (amount.textContent !== label) amount.textContent = label;
        reading.classList.toggle('is-muted', value === null);
        meter.style.display = value === null ? 'none' : '';
        if (value !== null) {
          meter.dataset.tone = value <= 10 ? 'critical' : value <= 25 ? 'warning' : 'normal';
          const arc = meter.lastElementChild;
          arc.style.visibility = value === 0 ? 'hidden' : '';
          arc.setAttribute('stroke-dasharray', `${value} 100`);
        }
        const time = waiting ? '已到重置时间' : hasReset ? formatReset(row.resetAt - now) : '';
        reset.hidden = !time;
        if (reset.textContent !== time) reset.textContent = time;
        if (hasReset) {
          reset.dateTime = new Date(row.resetAt).toISOString();
          reset.title = new Date(row.resetAt).toLocaleString();
        } else {
          reset.removeAttribute('datetime');
          reset.removeAttribute('title');
        }
      }
    }
  }

  customElements.define(tag, UsageViewer);
})();
