(() => {
  const labels = {wallpaper:'壁纸', character:'桌宠样式', theme:'主题配色'};
  const carouselDelay = 4500;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const button = (text, action, cls = '') => {
    const node = el('button', 'hub-button ' + cls, text);
    node.type = 'button'; node.onclick = action; return node;
  };
  function groups(items) {
    const result = new Map();
    for (const item of items) {
      const id = item.pack?.id || item.id;
      const entry = result.get(id) || {id, kind:item.kind, title:item.pack?.name || item.name, source:item.pack?.source, frames:[]};
      entry.frames.push(item);
      result.set(id, entry);
    }
    for (const entry of result.values()) {
      entry.frames.sort((a,b) => (a.pack?.position || 0) - (b.pack?.position || 0));
      entry.search = [entry.title,...entry.frames.flatMap(item => [item.name,item.description,item.credit])].join(' ').toLocaleLowerCase();
      entry.date = entry.frames.reduce((latest,item) => item.updatedAt > latest ? item.updatedAt : latest,'');
    }
    return [...result.values()];
  }
  const builtinThemes = new Set(['violet-default','midnight-blue']);
  const issueTemplate = ['### 想适配的素材','- 名称：','- 分类（桌宠 / 壁纸 / 主题配色）：','',
    '### 希望如何使用','- 平台（桌面端 / Gemini 网页 / 两者）：','- 想保留的效果或需要调整的地方：','',
    '### 授权情况','- 原创 / 已获授权 / 尚待确认：','- 许可链接或可公开的授权说明（如有）：','',
    '### 参考资料（可选）','- 可公开分享的截图或示例链接：'].join('\n');
  window.mountCatstellaHub = (root, {call, selection, use, openSource, onCount, previewWallpaper, scrollHost, currentTheme}) => {
    root.classList.add('catstella-hub');
    const search = el('input', 'hub-search');
    search.type = 'search'; search.placeholder = '搜索名称、作者或素材'; search.setAttribute('aria-label', '搜索内容');
    const views = el('div','hub-filters'), filters = el('nav','hub-tabs'), tools = el('div','hub-tools');
    filters.setAttribute('aria-label','素材分类');
    views.setAttribute('aria-label','浏览方式');
    const hero = el('div','hub-hero'), grid = el('div','hub-grid'), status = el('p','hub-status');
    status.setAttribute('role','status');
    const notice = el('p','hub-status'); notice.setAttribute('role','status');
    const dialog = el('dialog','hub-dialog');
    const issueDialog = el('dialog','hub-dialog hub-issue');
    const header = el('div','hub-tools');
    header.append(el('div','hub-eyebrow','CATSTELLA HUB · 测试版'), button('适配请求', () => {
      issueDraft.href = issueUrl;
      issueText.value = issueTemplate;
      issueStatus.textContent = '';
      issueDialog.showModal();
    }), button('刷新目录', () => void load(true)));
    tools.append(views,search);
    notice.classList.add('hub-notice');
    const scroller = scrollHost || root.closest('#content-scroll') || document.scrollingElement;
    dialog.setAttribute('aria-labelledby','hub-detail-title');
    const issueUrl = new URL('https://github.com/lynnfei/Catstella/issues/new');
    issueUrl.searchParams.set('title','[适配请求][分类] 素材名称');
    issueUrl.searchParams.set('body',issueTemplate);
    const issueDraft = button('在 GitHub 打开',() => { if (openSource) openSource(issueUrl.href); },'primary');
    const issueText = el('textarea','hub-issue-text');
    issueText.readOnly = true; issueText.rows = 12; issueText.setAttribute('aria-label','适配请求模板');
    const issueStatus = el('span','hub-issue-status'); issueStatus.setAttribute('role','status');
    const issueHead = el('div','hub-detail-head');
    const issueHeading = el('h2','','适配请求指引'); issueHeading.id = 'hub-issue-title';
    const issueClose = button('关闭',() => issueDialog.close(),'hub-close'); issueClose.autofocus = true;
    issueHead.append(issueHeading,issueClose);
    const issueBody = el('div','hub-issue-body');
    const issueCopy = button('复制模板',async () => {
      try { await navigator.clipboard.writeText(issueText.value); issueStatus.textContent = '已复制模板。'; }
      catch { issueText.focus(); issueText.select(); issueStatus.textContent = '已选中模板，可按 Ctrl+C 复制。'; }
    });
    const issueActions = el('div','hub-issue-actions');
    issueActions.append(issueDraft,issueCopy,issueStatus);
    issueBody.append(el('p','','想让大家也能用上你喜欢的桌宠、壁纸或配色？按模板开一个 Issue，附上原作链接与授权情况，方便跟进适配。'),
      issueText,issueActions);
    issueDialog.setAttribute('aria-labelledby','hub-issue-title');
    issueDialog.append(issueHead,issueBody);
    issueDialog.addEventListener('close',() => { const target = cards.get(current?.id)?.open; target?.focus({preventScroll:true}); },{once:false});
    root.replaceChildren(header,filters,hero,tools,status,grid,notice,dialog,issueDialog);
    let entries = [], view = 'all', kind = 'all', current, currentIndex = 0, busy = false, loaded = false, pending;
    let gridMotion, dialogMotion, closing = false, shownPicture, modal, featuredEntry, banner, catalogOnline = false, searchFrame;
    let compareCurrent = false, removeArm = false;
    const cards = new Map(), palettePreviews = new Map(), assetStates = new Map();
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    const motionAllowed = () => !motionPreference.matches;
    function assetState(item) {
      if (!assetStates.has(item.id)) assetStates.set(item.id,selection(item));
      return assetStates.get(item.id);
    }
    // 已安装的 revision 与目录不一致即视为有更新；旧版安装没有 revision，不误报。
    function hasUpdate(item) {
      const state = assetState(item);
      return !!state.revision && !!item.sha256 && state.revision !== item.sha256;
    }
    function refreshAssets() {
      assetStates.clear();
      if (onCount) onCount(catalogOnline ? entries.flatMap(entry => entry.frames).filter(item => !assetState(item).installed) : []);
    }
    function rotation(stage, advance, active = () => true) {
      let playing = motionAllowed(), visible = false, hovering = false, timer;
      const control = button('',() => { playing = !playing; sync(); },'hub-rotation');
      function sync() {
        clearTimeout(timer);
        const label = playing ? '暂停轮播' : '播放轮播';
        if (control.textContent !== label) control.textContent = label;
        if (playing && visible && !hovering && !document.hidden && active()) {
          timer = setTimeout(() => { advance(); sync(); },carouselDelay);
        }
      }
      const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
      observer.observe(stage);
      const enter = () => { hovering = true; sync(); };
      const leave = () => { hovering = false; sync(); };
      const preferenceChanged = () => { if (!motionAllowed()) { playing = false; sync(); } };
      stage.addEventListener('pointerenter',enter);
      stage.addEventListener('pointerleave',leave);
      document.addEventListener('visibilitychange',sync);
      motionPreference.addEventListener('change',preferenceChanged);
      sync();
      return {control,sync,pause:() => { playing = false; sync(); },dispose:() => {
        clearTimeout(timer); observer.disconnect();
        stage.removeEventListener('pointerenter',enter);
        stage.removeEventListener('pointerleave',leave);
        document.removeEventListener('visibilitychange',sync);
        motionPreference.removeEventListener('change',preferenceChanged);
      }};
    }
    function reveal(node, offset = 6, duration = 190) {
      return motionAllowed() ? node.animate(
        [{opacity:.2,transform:'translateY(' + offset + 'px)'},{opacity:1,transform:'translateY(0)'}],
        {duration,easing:'cubic-bezier(.2,.72,.25,1)'}) : null;
    }
    let favorites = new Set();
    try { const saved = JSON.parse(localStorage.getItem('catstella.hub.favorites.v1')); if (Array.isArray(saved)) favorites = new Set(saved); } catch {}
    const viewOptions = [['all','探索内容'],['recent','最近更新'],['installed','已安装'],['favorites','收藏夹']];
    const filterOptions = [['all','全部'], ...Object.entries(labels)];
    const tabs = (list, host, change) => {
      const controls = list.map(([value,title]) => [value,button(title,() => change(value))]);
      host.append(...controls.map(([,b]) => b));
      return selected => {
        for (const [value,b] of controls) b.setAttribute('aria-pressed',String(selected === value));
      };
    };
    const paintView = tabs(viewOptions,views,value => { if (view !== value) { view = value; render(true); } });
    const paintKind = tabs(filterOptions,filters,value => { if (kind !== value) { kind = value; render(true); } });
    function art(item, large = false) {
      const box = el('div','hub-art hub-' + item.kind);
      const local = assetState(item)?.preview;
      const image = large ? local || item.preview : item.preview || local;
      if (image) {
        const img = el('img');
        img.alt = large ? item.name : ''; img.loading = large ? 'eager' : 'lazy'; img.decoding = 'async';
        img.src = image;
        img.addEventListener('error',() => {
          if (item.preview && img.getAttribute('src') !== item.preview) img.src = item.preview;
          else box.replaceChildren(el('span','hub-art-placeholder','预览暂不可用'));
        });
        box.append(img);
      }
      else if (item.kind === 'theme') {
        const theme = el('div','hub-theme-sample');
        const page = el('div','hub-theme-page');
        page.append(el('span','','Gemini'),el('i'),el('i'),el('b','','问问 Gemini'));
        theme.append(el('aside','','✦'),page);
        if (large) {
          theme.classList.add('hub-theme-scene');
          const wallpaper = previewWallpaper?.();
          const backdrop = wallpaper ? el('img','hub-theme-wallpaper') : el('div','hub-theme-wallpaper');
          if (wallpaper) { backdrop.src = wallpaper; backdrop.alt = ''; backdrop.decoding = 'async'; }
          theme.prepend(backdrop);
          const welcome = el('div','hub-theme-welcome');
          welcome.append(el('strong','','今天想做些什么？'));
          const shortcuts = el('div','hub-theme-shortcuts');
          for (const label of ['探索灵感','整理思路','润色文字']) shortcuts.append(el('span','',label));
          welcome.append(shortcuts);
          const reading = el('div','hub-theme-reading');
          reading.append(el('span','hub-theme-prompt','帮我整理今天的计划'),
            el('p','','先挑一件最重要的事，把它拆成可以马上开始的小步骤。'));
          page.replaceChildren(el('span','hub-theme-brand','Gemini'),welcome,reading,el('b','hub-theme-input','＋  问问 Gemini'));
        }
        const hint = el('span','hub-theme-hint','配色示意');
        box.append(theme,hint);
        const known = {'midnight-blue':'ocean','violet-default':'violet'}[item.id];
        if (known) box.dataset.palette = known;
        if (large) {
          if (compareCurrent) {
            // 搭配对比：用当前正在使用的配色渲染同一块示意场景。
            const activeTheme = currentTheme?.();
            hint.textContent = '当前搭配';
            const key = 'current:' + (activeTheme?.onlineThemeId || activeTheme?.preset || 'violet');
            if (!palettePreviews.has(key)) palettePreviews.set(key,
              activeTheme?.onlineThemeId ? Promise.resolve().then(() => call('preview-theme',activeTheme.onlineThemeId)).catch(() => null)
                : Promise.resolve({ok:true,palette:activeTheme?.preset === 'ocean' ? 'ocean' : 'violet'}));
            void palettePreviews.get(key).then(result => {
              if (!result?.ok) { hint.textContent = '暂无法读取当前搭配'; return; }
              box.dataset.palette = result.palette;
            });
          } else {
            const key = item.id + ':' + item.sha256;
            if (!palettePreviews.has(key)) {
              palettePreviews.set(key, Promise.resolve().then(() => call('preview-theme',item.id)).catch(() => null)
                .then(result => {
                  if (!result?.ok) palettePreviews.delete(key);
                  return result;
                }));
            }
            void palettePreviews.get(key).then(result => {
              if (!result?.ok) { hint.textContent = known ? '配色示意' : '暂无法读取此主题的配色'; return; }
              box.dataset.palette = result.palette;
              theme.style.setProperty('--sample-opacity',String(result.opacity / 100));
              hint.textContent = '壁纸不透明度 ' + result.opacity + '%';
            });
          }
        }
      } else box.append(el('span','hub-art-placeholder','安装后可预览'));
      return box;
    }
    function paintFavorite(control, entry) {
      const marked = favorites.has(entry.id);
      control.textContent = marked ? '♥ 已收藏' : '♡ 收藏';
      control.setAttribute('aria-pressed',String(marked));
    }
    function favorite(entry) {
      const b = button('', () => {
        if (favorites.has(entry.id)) favorites.delete(entry.id); else favorites.add(entry.id);
        try { localStorage.setItem('catstella.hub.favorites.v1',JSON.stringify([...favorites])); } catch {}
        render();
        if (dialog.open) paintFavorite(modal.favorite,entry);
      });
      paintFavorite(b,entry);
      return b;
    }
    function show(entry, opener) {
      if (dialog.open || closing) return;
      const scrollTop = scroller.scrollTop;
      current = entry; currentIndex = opener === banner?.opener ? banner.index : 0; shownPicture = null;
      mountDetail(entry);
      dialog.showModal();
      banner?.rotation.sync();
      dialogMotion = reveal(dialog, 9, 230);
      dialog.addEventListener('close',() => {
        modal?.rotation?.dispose();
        current = modal = null; closing = false; dialogMotion = null;
        banner?.rotation.sync();
        const fallback = cards.get(entry.id)?.open;
        const target = opener?.isConnected && !opener.closest('[hidden]') ? opener :
          fallback?.isConnected ? fallback : views.querySelector('[aria-pressed=true]');
        target?.focus({preventScroll:true});
        if (scroller.scrollTop !== scrollTop) scroller.scrollTo({top:scrollTop,behavior:'instant'});
      },{once:true});
    }
    function closeDetail() {
      if (closing || !dialog.open) return;
      closing = true;
      if (!motionAllowed()) { dialog.close(); return; }
      const opacity = getComputedStyle(dialog).opacity;
      dialogMotion?.cancel();
      dialogMotion = dialog.animate([{opacity},{opacity:0,transform:'translateY(7px)'}],
        {duration:145,easing:'ease-in',fill:'forwards'});
      dialogMotion.finished.then(() => {
        dialog.close();
        dialogMotion?.cancel();
      }, () => {});
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
    async function run(action, frames) {
      if (busy || !frames.length) return;
      const operationModal = modal;
      operationModal.rotation?.pause();
      const showProgress = message => {
        notice.textContent = message;
        if (modal === operationModal) modal.feedback.textContent = message;
      };
      busy = true;
      showProgress(action === 'apply' ? '正在应用…' : action === 'uninstall' ? '正在卸载…' : '正在准备安装…');
      detail();
      let completed = 0;
      try {
        for (const item of frames) {
          const result = action === 'apply' ? await use(item) : action === 'uninstall' ? await call('uninstall',item.id) : await call('download',item.id);
          if (!result?.ok) throw Error(result?.reason === 'connection' ? '连不上 GitHub，请检查网络或代理。' : '素材操作失败，请重试。');
          completed++;
          if (frames.length > 1) showProgress((action === 'uninstall' ? '已卸载 ' : '已安装 ') + completed + ' / ' + frames.length);
        }
        showProgress(action === 'apply' ? '已应用 ' + frames[0].name : action === 'uninstall' ? '已卸载，可随时重新安装。' : '已安装 ' + completed + ' 项，可从本地图库切换。');
      } catch (error) { showProgress((completed ? '已完成 ' + completed + ' 项。' : '') + error.message); }
      finally { busy = false; refreshAssets(); render(); if (dialog.open) detail(); }
    }
    function selectFrame(index, moveFocus = false, manual = true) {
      if (index < 0 || index >= current.frames.length || index === currentIndex) return;
      if (manual) modal.rotation?.pause();
      removeArm = false;
      currentIndex = index;
      detail();
      const thumb = modal.strip.children[index];
      if (moveFocus) thumb.focus({preventScroll:true});
      const left = thumb.offsetLeft, right = left + thumb.offsetWidth;
      if (left < modal.strip.scrollLeft) modal.strip.scrollLeft = left;
      else if (right > modal.strip.scrollLeft + modal.strip.clientWidth) modal.strip.scrollLeft = right - modal.strip.clientWidth;
    }
    dialog.addEventListener('keydown',event => {
      if (event.altKey || event.ctrlKey || event.metaKey || !current || current.frames.length < 2) return;
      const index = event.key === 'ArrowLeft' ? currentIndex - 1 : event.key === 'ArrowRight' ? currentIndex + 1 : null;
      if (index === null) return;
      event.preventDefault();
      selectFrame(index,modal.strip.contains(document.activeElement));
    });
    function mountDetail(entry) {
      const top = el('header','hub-detail-head');
      const heading = el('h2','',entry.title); heading.id = 'hub-detail-title';
      const close = button('关闭',closeDetail,'hub-close'); close.autofocus = true;
      top.append(heading,close);
      const stage = el('div','hub-stage');
      const player = entry.frames.length > 1 ? rotation(stage,() => selectFrame((currentIndex + 1) % entry.frames.length,false,false),() => dialog.open && !closing) : null;
      const browse = el('div','hub-preview-nav'), counter = el('span','hub-preview-count');
      const previous = button('‹',() => selectFrame(currentIndex - 1),'hub-prev');
      const next = button('›',() => selectFrame(currentIndex + 1),'hub-next');
      previous.setAttribute('aria-label','上一张'); next.setAttribute('aria-label','下一张');
      browse.append(previous,counter,next);
      if (player) browse.append(player.control);
      browse.hidden = !player;
      const strip = el('div','hub-strip');
      for (const [i,frame] of entry.frames.entries()) if (entry.frames.length > 1) {
        const thumb = button('',() => selectFrame(i));
        thumb.setAttribute('aria-label',frame.name);
        thumb.append(art(frame)); strip.append(thumb);
      }
      strip.hidden = entry.frames.length < 2;
      const actions = el('footer','hub-detail-actions');
      const secondary = el('div','hub-detail-secondary'), primary = el('div','hub-detail-primary');
      const useButton = button('', () => {
        const item = current.frames[currentIndex], state = assetState(item);
        if (busy) return;
        if (hasUpdate(item)) { void run('install',[item]); return; }
        if (!state.active && state.canUse !== false) void run(item.kind === 'theme' || state.installed ? 'apply' : 'install',[item]);
      },'primary');
      const packButton = button('',() => void run('install',entry.frames.filter(frame => !assetState(frame).installed)));
      const copyButton = button('另存到网页',() => {
        const item = current.frames[currentIndex];
        if (assetState(item).desktopOnly) void run('install',[item]);
      });
      const removeButton = button('卸载',() => {
        if (busy || !removeArm) { removeArm = !removeArm; removeButton.textContent = removeArm ? '确认卸载？' : '卸载'; return; }
        removeArm = false;
        void run('uninstall',[current.frames[currentIndex]]);
      });
      const favoriteButton = favorite(entry);
      if (player) {
        primary.addEventListener('focusin',() => player.pause());
        strip.addEventListener('focusin',() => player.pause());
      }
      primary.append(useButton,packButton,copyButton,removeButton);
      secondary.append(favoriteButton);
      if (entry.source && openSource) secondary.append(button('原作发布页',() => openSource(entry.source)));
      const feedback = el('p','hub-status hub-feedback'); feedback.setAttribute('role','status');
      const title = el('h3'), description = el('p'), credit = el('p'), badge = el('span','hub-badge hub-state');
      const info = el('section','hub-detail-info'); info.append(title,badge,description,credit);
      const themeTools = el('div','hub-preview-nav hub-theme-tools');
      if (entry.kind === 'theme') {
        const setMode = tabs([['welcome','欢迎页'],['reading','阅读区']],themeTools,mode => {
          stage.dataset.mode = mode;
          setMode(mode);
        });
        setMode('welcome');
        const setCompare = tabs([['asset','此素材'],['current','当前搭配']],themeTools,mode => {
          const next = mode === 'current';
          if (next !== compareCurrent) { compareCurrent = next; shownPicture = null; detail(); }
        });
        setCompare('asset');
      }
      themeTools.hidden = entry.kind !== 'theme';
      actions.append(secondary,primary,feedback);
      dialog.replaceChildren(top,stage,themeTools,browse,strip,info,actions);
      modal = {stage,counter,previous,next,strip,title,description,credit,badge,useButton,packButton,copyButton,removeButton,favorite:favoriteButton,feedback,rotation:player};
      compareCurrent = false; removeArm = false;
      detail();
    }
    function detail() {
      if (!modal) return;
      const entry = current, item = entry.frames[currentIndex], state = assetState(item);
      const missing = entry.frames.filter(frame => !assetState(frame).installed);
      const updating = hasUpdate(item);
      const canRemove = state.installed && !state.desktopOnly && !builtinThemes.has(item.id);
      const {stage,counter,previous,next,strip,title,description,credit,badge,useButton,packButton,copyButton,removeButton} = modal;
      paintState(badge,updating ? 'update' : state.active ? 'active' : state.installed ? 'installed' : 'available',
        updating ? '可更新' : state.active ? '正在使用' : state.desktopOnly ? '桌面端已安装' : state.installed ? '已安装' : item.kind === 'theme' ? '在线 · 可应用' : '在线 · 未安装');
      useButton.textContent = updating ? '更新到最新版' : state.active ? '正在使用' : state.useLabel || (item.kind === 'theme' ? '应用配色' : state.installed ? '使用这项素材' : '安装这项素材');
      useButton.setAttribute('aria-disabled',String(busy || !updating && (state.active || state.canUse === false)));
      if (!state.desktopOnly && document.activeElement === copyButton) useButton.focus({preventScroll:true});
      copyButton.hidden = !state.desktopOnly;
      copyButton.setAttribute('aria-disabled',String(busy));
      const hidePack = entry.frames.length < 2 || !missing.length;
      if (hidePack && document.activeElement === packButton) useButton.focus({preventScroll:true});
      packButton.hidden = hidePack;
      packButton.setAttribute('aria-disabled',String(busy));
      packButton.textContent = '安装整套（' + missing.length + ' 张）';
      removeButton.hidden = !canRemove;
      removeButton.setAttribute('aria-disabled',String(busy));
      const removeLabel = removeArm ? '确认卸载？' : '卸载';
      if (removeButton.textContent !== removeLabel) removeButton.textContent = removeLabel;
      if (removeButton.hidden && document.activeElement === removeButton) useButton.focus({preventScroll:true});
      if (shownPicture?.id !== item.id || shownPicture.preview !== state.preview) {
        const picture = art(item,true); picture.classList.add('hub-detail-art');
        stage.replaceChildren(picture);
        if (dialog.open) reveal(picture, 3, 160);
        shownPicture = {id:item.id,preview:state.preview};
      }
      title.textContent = item.name; title.hidden = entry.title === item.name;
      description.textContent = item.description; description.hidden = !item.description;
      credit.textContent = item.credit;
      counter.textContent = (currentIndex + 1) + ' / ' + entry.frames.length;
      previous.setAttribute('aria-disabled',String(currentIndex === 0));
      next.setAttribute('aria-disabled',String(currentIndex === entry.frames.length - 1));
      for (const [i,thumb] of [...strip.children].entries()) {
        thumb.setAttribute('aria-pressed',String(i === currentIndex));
      }
    }
    function paintState(badge, state, label) {
      if (badge.dataset.state !== state) badge.dataset.state = state;
      if (badge.textContent !== label) badge.textContent = label;
    }
    function render(animate = false) {
      paintView(view);
      paintKind(kind);
      const featured = entries.find(entry => entry.frames.length > 1);
      const query = search.value.trim().toLocaleLowerCase();
      const hideHero = !featured || view !== 'all' || !['all','wallpaper'].includes(kind) || !!query;
      if (hero.hidden !== hideHero) {
        hero.hidden = hideHero;
        banner?.rotation.sync();
      }
      if (!hero.hidden && featured !== featuredEntry) {
        banner?.rotation.dispose();
        const stage = el('div','hub-hero-stage');
        const picture = el('div','hub-hero-picture');
        const controls = el('div','hub-hero-controls'), caption = el('span','hub-hero-caption');
        const paint = index => {
          banner.index = (index + featured.frames.length) % featured.frames.length;
          const frame = featured.frames[banner.index];
          const cover = art(frame);
          picture.replaceChildren(cover);
          reveal(cover,0,230);
          caption.textContent = (banner.index + 1) + ' / ' + featured.frames.length + ' · ' + frame.name;
        };
        const copy = el('div','hub-hero-copy');
        const go = button('查看壁纸包',() => show(featured,go),'primary');
        const player = rotation(stage,() => paint(banner.index + 1),() => !hero.hidden && !dialog.open);
        const previous = button('‹',() => { player.pause(); paint(banner.index - 1); });
        const next = button('›',() => { player.pause(); paint(banner.index + 1); });
        previous.setAttribute('aria-label','上一张推荐壁纸'); next.setAttribute('aria-label','下一张推荐壁纸');
        controls.append(caption,previous,next,player.control);
        stage.append(picture,controls);
        banner = {index:0,opener:go,rotation:player};
        paint(0);
        copy.append(el('span','hub-eyebrow','推荐壁纸 · ' + featured.frames.length + ' 张'),el('h2','',featured.title),
          el('p','',featured.frames[0].credit),go);
        hero.replaceChildren(copy,stage);
        featuredEntry = featured;
      }
      const matches = entries.filter(entry => (kind === 'all' || entry.kind === kind) &&
        (view === 'all' || view === 'recent' || (view === 'installed' && entry.frames.some(f => assetState(f).installed)) || (view === 'favorites' && favorites.has(entry.id))) &&
        (!query || entry.search.includes(query)));
      if (view === 'recent') matches.sort((a,b) => b.date.localeCompare(a.date));
      function makeCard(entry) {
        const first = entry.frames[0], card = el('article','hub-card');
        const cover = button('',() => show(entry,cover),'hub-cover');
        cover.setAttribute('aria-label','预览 ' + entry.title); cover.append(art(first));
        const info = el('div','hub-card-info');
        const meta = el('div','hub-tools');
        const badge = el('span','hub-badge hub-state'), date = el('p','hub-date');
        meta.append(el('span','hub-badge',labels[entry.kind] + (entry.frames.length > 1 ? ' · ' + entry.frames.length + ' 张' : '')),badge);
        const actions = el('div','hub-tools');
        const open = button('查看详情',() => show(entry,open),'primary');
        const bookmark = favorite(entry);
        actions.append(open,bookmark);
        info.append(meta,el('h3','',entry.title),el('p','',first.credit),date,actions);
        card.append(cover,info);
        const record = {entry,card,cover,badge,date,open,bookmark,preview:assetState(first).preview};
        cards.set(entry.id,record);
        return record;
      }
      for (const [id,record] of cards) {
        if (!entries.includes(record.entry)) { record.card.remove(); cards.delete(id); }
      }
      const visibleCards = new Set();
      matches.forEach((entry,index) => {
        const record = cards.get(entry.id) || makeCard(entry);
        const first = entry.frames[0], state = assetState(first);
        if (!first.preview && state.preview !== record.preview) {
          record.cover.replaceChildren(art(first));
          record.preview = state.preview;
        }
        const installed = entry.frames.filter(f => assetState(f).installed).length;
        const active = entry.frames.some(f => assetState(f).active);
        const updated = entry.frames.some(f => hasUpdate(f));
        const desktopOnly = entry.frames.every(f => assetState(f).desktopOnly);
        const label = updated ? '可更新' : active ? '正在使用' : desktopOnly ? '桌面端已安装' : installed === entry.frames.length ? '已安装' :
          installed ? '已安装 ' + installed + ' / ' + entry.frames.length : entry.kind === 'theme' ? '在线 · 可应用' : '在线 · 未安装';
        paintState(record.badge,updated ? 'update' : active ? 'active' : installed === entry.frames.length ? 'installed' : installed ? 'partial' : 'available',label);
        const dateLabel = entry.date ? entry.date + ' 更新' : '目录未标注更新时间';
        record.date.hidden = view !== 'recent';
        if (record.date.textContent !== dateLabel) record.date.textContent = dateLabel;
        paintFavorite(record.bookmark,entry);
        visibleCards.add(record.card);
        if (grid.children[index] !== record.card) grid.insertBefore(record.card,grid.children[index] || null);
      });
      for (const child of [...grid.children]) if (!visibleCards.has(child)) child.remove();
      if (!matches.length && loaded) grid.append(el('p','hub-empty',query ? '没有匹配的内容。' : view === 'favorites' ? '收藏的素材会显示在这里。' : '这个分类暂时没有内容。'));
      if (animate === true) {
        gridMotion?.cancel();
        gridMotion = reveal(grid);
      }
    }
    let sequence = 0;
    async function load(force) {
      if (pending && !force) return pending;
      const rev = ++sequence;
      status.textContent = '正在读取在线目录…';
      pending = (async () => {
        let result;
        try { result = await call('catalog',force); } catch {}
        if (rev !== sequence) return;
        loaded = true;
        if (result?.ok) {
          entries = groups(result.items || []);
          for (const {card} of cards.values()) card.remove();
          cards.clear();
        }
        catalogOnline = !!result?.ok && !result.offline;
        refreshAssets();
        status.textContent = !result?.ok || result.offline ? '无法连接 GitHub，请检查网络或代理。已安装和测试包自带的内容仍可使用。' : '';
        render(true);
      })();
      try { await pending; } finally { if (rev === sequence) pending = null; }
    }
    search.oninput = () => {
      if (searchFrame) return;
      searchFrame = requestAnimationFrame(() => { searchFrame = null; render(); });
    };
    render();
    return {load,render:()=>{refreshAssets();render();if(dialog.open && !busy)detail();},
      filter:(value, mode = 'all') => {kind=value;view=mode;search.value='';render();}};
  };
})();
