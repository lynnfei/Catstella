(function () {
  const node = (tag, text, parent) => {
    const el = document.createElement(tag);
    el.textContent = text;
    parent.appendChild(el);
    return el;
  };
  const button = (text, parent) => {
    const el = node('button', text, parent);
    el.type = 'button';
    el.className = 'btn small';
    return el;
  };
  const connectionHint = '无法连接 GitHub。请检查网络或代理设置后重试。';
  const catalogMessage = result => result?.reason === 'unpublished' ? '在线目录尚未发布。' :
    result?.reason === 'connection' || !result ? connectionHint : '在线目录暂不可用，请稍后重试。';
  window.mountCatstellaOnline = function (root, call, options = {}) {
    const row = node('div', '', root);
    row.className = 'btn-row';
    const check = button('检查更新', row);
    const release = button('查看发行页', row);
    const checkStatus = node('p', '', root);
    checkStatus.className = 'hint';
    checkStatus.setAttribute('role', 'status');
    const catalog = button(options.themeOnly ? '浏览在线配色' : '加载在线主题与壁纸', root);
    const status = node('p', '', root);
    status.className = 'hint';
    status.setAttribute('role', 'status');
    const items = node('div', '', root);
    items.className = 'online-items';
    if (options.updatesOnly) for (const element of [catalog,status,items]) element.hidden = true;
    const run = async (control, work, target, failure) => {
      if (control.disabled) return;
      control.disabled = true;
      try { await work(); } catch { target.textContent = failure; }
      finally { control.disabled = false; }
    };
    const refresh = force => run(check, async () => {
      checkStatus.textContent = '正在检查…';
      const result = await call('check', force);
      if (!result?.ok) throw new Error();
      const labels = {
        available: `发现新版本 ${result.latest}，可在发行页下载。`,
        current: '已是最新版本。',
        unpublished: '暂未找到本端的正式发行包。',
        offline: connectionHint,
        disabled: '自动检查已关闭。'
      };
      checkStatus.textContent = `当前 ${result.current} · ${labels[result.status] || ''}`;
    }, checkStatus, '暂时无法检查更新。');
    check.onclick = () => refresh(true);
    release.onclick = () => run(release, async () => {
      if (!(await call('release'))?.ok) throw new Error();
    }, checkStatus, '无法打开发行页。');
    catalog.onclick = () => run(catalog, async () => {
      status.textContent = '正在加载目录…';
      const result = await call('catalog', true);
      if (!result?.ok) {
        status.textContent = catalogMessage(result);
        return;
      }
      items.replaceChildren();
      const entries = result.items.filter(item => options.themeOnly ? item.kind === 'theme' : item.kind !== 'character');
      status.textContent = entries.length ? '请选择要应用的内容。' : '目录暂无可下载的内容。';
      for (const entry of entries) {
        const item = node('section', '', items);
        node('b', (entry.kind === 'theme' ? '🎨 ' : '🖼️ ') + entry.name, item);
        const detail = node('p', [entry.description, entry.credit].filter(Boolean).join(' · '), item);
        detail.className = 'hint';
        const install = button(entry.kind === 'theme' ? '下载并应用配色' : '下载并使用壁纸', item);
        install.onclick = () => run(install, async () => {
          status.textContent = `正在下载「${entry.name}」…`;
          if (!(await call('install', entry.id))?.ok) throw new Error();
          status.textContent = `已应用「${entry.name}」。`;
        }, status, '下载或应用失败，请重试。');
      }
    }, status, '暂时无法读取在线目录。');
    void refresh(false);
    return { refresh };
  };
  window.mountCatstellaGallery = function (root, { call, kind, installed, onCount = () => {}, onInstall = () => {} }) {
    const label = kind === 'character' ? '桌宠' : '壁纸';
    const header = node('div', '', root);
    header.className = 'gallery-header';
    const title = node('b', '在线' + label, header);
    title.className = 'gallery-label';
    const refresh = button('刷新', header);
    const status = node('p', '', root);
    status.className = 'hint';
    status.setAttribute('role', 'status');
    const grid = node('div', '', root);
    grid.className = 'gallery-container mode-grid online-gallery';
    let items = [], loading = false;
    const justInstalled = new Set();
    function render() {
      const available = items.filter(item => !installed(item) && !justInstalled.has(item.id));
      onCount(available.length);
      grid.replaceChildren();
      for (const item of items) {
        const present = installed(item) || justInstalled.has(item.id);
        const card = node('article', '', grid);
        card.className = 'gallery-card';
        const thumb = node('div', '', card);
        thumb.className = kind === 'character' ? 'card-char-thumb' : 'card-wall-thumb';
        if (item.preview) {
          const img = node('img', '', thumb);
          img.src = item.preview;
          img.alt = item.name;
          img.loading = 'lazy';
        } else node('span', kind === 'character' ? '🐱' : '🖼️', thumb).className = 'card-wall-placeholder';
        const info = node('div', '', card);
        info.className = 'card-info';
        node('b', item.name, info).className = 'card-title';
        node('span', [item.description, item.credit].filter(Boolean).join(' · '), info).className = 'card-desc';
        const install = button(present ? '已安装' : '安装', info);
        install.disabled = present;
        install.setAttribute('aria-label', present ? item.name + ' 已安装' : '安装 ' + item.name);
        install.onclick = async () => {
          install.disabled = true;
          status.textContent = '正在安装「' + item.name + '」…';
          let result;
          try { result = await call('download', item.id); } catch {}
          if (!result?.ok) {
            status.textContent = result?.reason === 'connection' ? connectionHint : '安装失败，请稍后重试。';
            install.disabled = false;
            return;
          }
          justInstalled.add(item.id);
          status.textContent = '「' + item.name + '」已加入本地图库。';
          onInstall(item);
          render();
        };
      }
    }
    async function load(force = false) {
      if (loading) return;
      loading = refresh.disabled = true;
      status.textContent = '正在检查在线' + label + '…';
      try {
        const result = await call('catalog', force);
        if (!result?.ok) { status.textContent = catalogMessage(result); return; }
        items = result.items.filter(item => item.kind === kind);
        const count = items.filter(item => !installed(item) && !justInstalled.has(item.id)).length;
        status.textContent = count ? count + ' 款可安装' : '已安装全部在线' + label + '。';
        if (!items.length) status.textContent = '目前没有在线' + label + '。';
        render();
      } catch {
        status.textContent = connectionHint;
      } finally {
        loading = refresh.disabled = false;
      }
    }
    refresh.onclick = () => load(true);
    return { load, render };
  };
})();
