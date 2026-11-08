'use strict';

// Display snapshot of the catalog and character packs in online-assets. Demo revisions and local state
// are deliberately independent of the app's installed assets and user settings.
const kinds = {
  character: { label: '桌宠', icon: 'paw' },
  wallpaper: { label: '壁纸', icon: 'image' },
  theme: { label: '主题配色', icon: 'palette' }
};
const petRoot = '../../Antigravity-Cat-Widget/assets/character-packs';
const wallpaperRoot = '../../online-assets/wallpapers';
const moriyamaRoot = wallpaperRoot;

const singleItems = [
  { id: 'gemini-star-v1', kind: 'character', name: '星语', alias: 'Stella', description: '紫色猫耳 · 星空魔女礼装', size: 912272, art: `${petRoot}/gemini-star-v1/frames/idle.png` },
  { id: 'lin-cat', kind: 'character', name: '霓音', alias: 'Aica', description: '粉色猫耳 · 全息航行服', size: 896800, art: `${petRoot}/lin-cat/frames/idle.png`, style: 'aica' },
  { id: 'gemini-character-sheet-v1', kind: 'wallpaper', name: '星语 · 星幕夜话', description: '1672 × 941', size: 1923996, art: `${wallpaperRoot}/gemini-character-sheet-v1.png` },
  { id: 'aica-clouds', kind: 'wallpaper', name: '霓音 · 云端来信', description: '1671 × 941', size: 2420968, art: `${wallpaperRoot}/aica-clouds.png` },
  { id: 'violet-default', kind: 'theme', name: '星轨紫', description: '星轨紫配色 · 壁纸透明度 88%', size: 58 },
  { id: 'midnight-blue', kind: 'theme', name: '深海星夜', description: '蓝色玻璃配色 · 壁纸透明度 75%', size: 57, style: 'ocean' },
  { id: 'aica-starship', kind: 'wallpaper', name: '霓音 · 星舱漫游', description: '1376 × 768', size: 1618113, art: `${wallpaperRoot}/aica-starship.jpg` },
  { id: 'stella-halloween', kind: 'wallpaper', name: '星语 · 万圣星夜', description: '1376 × 768', size: 845169, art: `${wallpaperRoot}/stella-halloween.jpg` }
];

const packFrames = ['gemini-character-sheet-v1', 'aica-clouds', 'aica-starship', 'stella-halloween']
  .map(id => singleItems.find(item => item.id === id));

const starlightPack = {
  id: 'starlight-wallpaper-pack', kind: 'wallpaper', name: '星海漫游 · 壁纸包',
  description: '星语与霓音的四幕星空', frames: packFrames, art: packFrames[0].art,
  size: packFrames.reduce((total, frame) => total + frame.size, 0)
};

const moriyamaFrames = [
  { id: 'moriyama-01', kind: 'wallpaper', name: '壁纸 01', description: '2432 × 1664 · 原作 @森山白月', size: 1246121, art: `${moriyamaRoot}/moriyama-catgirl-01.jpg` },
  { id: 'moriyama-02', kind: 'wallpaper', name: '壁纸 02', description: '2432 × 1664 · 原作 @森山白月', size: 1141212, art: `${moriyamaRoot}/moriyama-catgirl-02.jpg` },
  { id: 'moriyama-03', kind: 'wallpaper', name: '壁纸 03', description: '2432 × 1664 · 原作 @森山白月', size: 1223878, art: `${moriyamaRoot}/moriyama-catgirl-03.jpg` },
  { id: 'moriyama-04', kind: 'wallpaper', name: '壁纸 04', description: '2432 × 1664 · 原作 @森山白月', size: 1264046, art: `${moriyamaRoot}/moriyama-catgirl-04.jpg` },
  { id: 'moriyama-05', kind: 'wallpaper', name: '壁纸 05', description: '2432 × 1664 · 原作 @森山白月', size: 755220, art: `${moriyamaRoot}/moriyama-catgirl-05.jpg` },
  { id: 'moriyama-06', kind: 'wallpaper', name: '壁纸 06', description: '2432 × 1664 · 原作 @森山白月', size: 735626, art: `${moriyamaRoot}/moriyama-catgirl-06.jpg` },
  { id: 'moriyama-07', kind: 'wallpaper', name: '壁纸 07', description: '2432 × 1664 · 原作 @森山白月', size: 1161190, art: `${moriyamaRoot}/moriyama-catgirl-07.jpg` },
  { id: 'moriyama-08', kind: 'wallpaper', name: '壁纸 08', description: '2432 × 1664 · 原作 @森山白月', size: 649401, art: `${moriyamaRoot}/moriyama-catgirl-08.jpg` },
  { id: 'moriyama-09', kind: 'wallpaper', name: '壁纸 09', description: '2432 × 1664 · 原作 @森山白月', size: 1113669, art: `${moriyamaRoot}/moriyama-catgirl-09.jpg` }
];

const moriyamaPack = {
  id: 'moriyama-catgirl-pack', kind: 'wallpaper',
  name: '全部人类都会控猫猫的 · 壁纸包',
  alias: 'All Humans Love Catgirls',
  description: '是猫猫，傻傻的元气娘，是猫娘还有异色瞳，只要是人类就不可能拒绝！全套 9 张授权壁纸',
  frames: moriyamaFrames,
  art: moriyamaFrames[0].art,
  size: moriyamaFrames.reduce((total, frame) => total + frame.size, 0),
  author: '@森山白月',
  authorUrl: 'https://space.bilibili.com/2146089',
  sourceUrl: 'https://www.bilibili.com/video/BV17PxC6SERc/',
  sourceTitle: '【NovelAI】Gemini - 全部人类都会控猫猫的 壁纸分享',
  credit: '原作：@森山白月 · B站授权壁纸（BV17PxC6SERc）'
};

const featuredPack = moriyamaPack;
const catalog = [featuredPack, starlightPack, ...singleItems.filter(item => !packFrames.includes(item))];
// Keep prior single-wallpaper selections and installs readable in the demo.
const items = [...catalog, ...packFrames, ...moriyamaFrames];
const latest = item => item.id === 'lin-cat' ? 2 : 1;
const views = {
  explore: ['在线内容商店', '发现桌宠、星空壁纸与主题配色，装点你的 Catstella。', '全部内容'],
  library: ['在线内容商店', '管理已安装的内容，更新版本或切换正在使用的素材。', '本地图库'],
  favorites: ['在线内容商店', '把喜欢的内容放在这里，随时预览、安装或切换。', '我的收藏'],
  guide: ['在线内容商店', '有想在 Catstella 使用的素材？可以提交适配请求。', '']
};
const storageKey = 'catstella.content-store.demo.v2';
const defaults = {
  installed: { 'gemini-star-v1': 1, 'lin-cat': 1, 'violet-default': 1, 'moriyama-catgirl-pack': 1 },
  favorites: ['gemini-star-v1', moriyamaPack.id, starlightPack.id],
  active: { character: 'gemini-star-v1', theme: 'violet-default', wallpaper: 'moriyama-01' }
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && saved.installed && Array.isArray(saved.favorites) && saved.active) {
      return {
        installed: Object.fromEntries(items.filter(x => [1, latest(x)].includes(saved.installed[x.id])).map(x => [x.id, saved.installed[x.id]])),
        favorites: items.filter(x => saved.favorites.includes(x.id)).map(x => x.id),
        active: Object.fromEntries(items.filter(x => saved.active[x.kind] === x.id && [1, latest(x)].includes(saved.installed[x.id])).map(x => [x.kind, x.id]))
      };
    }
  } catch { /* File previews may restrict storage. */ }
  return structuredClone(defaults);
}

const state = loadState();
const $ = selector => document.querySelector(selector);
const grid = $('#grid');
const search = $('#store-search');
const dialog = $('#dialog');
const detailPage = $('#detail-page');
const resultsTitle = $('#results-title');
resultsTitle.tabIndex = -1;
let view = 'explore';
let category = 'all';
let detail;
let detailReturn;
let previewMode = 'effect';
let previewComparison = 'candidate';
let listingScroll = 0;
let toastTimer;

const icon = name => `<svg class="icon" aria-hidden="true"><use href="#${name}"/></svg>`;
const version = number => `v1.${number - 1}`;
const fileSize = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
const installed = item => state.installed[item.id];
const hasUpdate = item => installed(item) && installed(item) < latest(item);
const inUse = item => state.active[item.kind] === item.id;
const isFavorite = item => state.favorites.includes(item.id);
const fullName = item => item.alias ? `${item.name} ${item.alias}` : item.name;
const currentAsset = kind => items.find(item => item.id === state.active[kind]);

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const carouselStates = new Map();
const carouselDelay = 4000;

function carouselState(item, scope) {
  const key = `${scope}:${item.id}`;
  if (!carouselStates.has(key)) carouselStates.set(key, { index: 0, playing: !reducedMotion.matches, due: performance.now() + carouselDelay });
  return carouselStates.get(key);
}

function carouselAttrs(item, scope) {
  return `data-carousel="${scope}" data-pack="${item.id}"`;
}

function carouselTrack(item, scope, decorative = false) {
  const { index } = carouselState(item, scope);
  return `<div class="pack-window"${decorative ? ' aria-hidden="true"' : ''}>${item.frames.map((frame, i) =>
    `<img class="pack-slide" src="${frame.art}" alt="${decorative ? '' : frame.name}" aria-hidden="${i !== index}" decoding="async">`).join('')}</div>`;
}

const frameNumber = (index, total) => `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
const playLabel = playing => playing ? '暂停轮播' : '播放轮播';

function carouselControls(item, scope) {
  const { index, playing } = carouselState(item, scope);
  const playback = scope === 'card' ? '' : `<button type="button" class="pack-control" data-pack-command="play" aria-label="${playLabel(playing)}" title="${playLabel(playing)}">${icon(playing ? 'pack-pause' : 'pack-play')}</button>`;
  return `<div class="pack-controls" role="group" aria-label="壁纸包轮播控制">
    <span class="pack-counter" data-pack-counter>${frameNumber(index, item.frames.length)}</span>
    <button type="button" class="pack-control pack-prev" data-pack-command="prev" aria-label="上一张" title="上一张">${icon('pack-chevron')}</button>
    ${playback}
    <button type="button" class="pack-control" data-pack-command="next" aria-label="下一张" title="下一张">${icon('pack-chevron')}</button>
  </div>`;
}

function carouselThumbnails(item) {
  const { index } = carouselState(item, 'detail');
  return `<div class="pack-thumbnails" role="group" aria-label="选择包内壁纸">${item.frames.map((frame, i) =>
    `<button type="button" class="pack-thumb" data-pack-command="${i}" aria-pressed="${i === index}" aria-label="${frame.name}" title="${frame.name}"><img src="${frame.art}" alt="" decoding="async"><span class="pack-thumb-index">${i + 1}</span></button>`).join('')}</div>`;
}

function updateCarousel(root, item, nextIndex, direction = 1) {
  const state = carouselState(item, root.dataset.carousel);
  const slides = Array.from(root.querySelectorAll('.pack-slide'));
  const outgoing = slides[state.index];
  state.index = (nextIndex + item.frames.length) % item.frames.length;
  state.due = performance.now() + carouselDelay;
  const incoming = slides[state.index];
  for (const slide of slides) {
    for (const animation of slide.getAnimations()) animation.cancel();
    slide.setAttribute('aria-hidden', slide !== incoming);
  }
  if (outgoing !== incoming && !reducedMotion.matches) {
    const timing = { duration: 410, easing: 'cubic-bezier(.22,.65,.3,1)' };
    outgoing.animate([{ transform: 'translateX(0)', visibility: 'visible' }, { transform: `translateX(${-direction * 100}%)`, visibility: 'visible' }], timing);
    incoming.animate([{ transform: `translateX(${direction * 100}%)` }, { transform: 'translateX(0)' }], timing);
  }
  root.querySelector('[data-pack-counter]').textContent = frameNumber(state.index, item.frames.length);
  const caption = root.querySelector('[data-pack-caption]');
  if (caption) caption.textContent = item.frames[state.index].name;
  for (const thumb of root.querySelectorAll('.pack-thumb')) {
    const isCurrent = Number(thumb.dataset.packCommand) === state.index;
    thumb.setAttribute('aria-pressed', isCurrent);
    if (isCurrent && typeof thumb.scrollIntoView === 'function') {
      thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }
}

function toggleCarousel(root, item, playing) {
  const state = carouselState(item, root.dataset.carousel);
  state.playing = playing;
  state.due = performance.now() + carouselDelay;
  const button = root.querySelector('[data-pack-command="play"]');
  button.setAttribute('aria-label', playLabel(playing));
  button.title = playLabel(playing);
  button.innerHTML = icon(playing ? 'pack-pause' : 'pack-play');
}

function tickCarousels() {
  const now = performance.now();
  const viewport = $('#content').getBoundingClientRect();
  for (const root of document.querySelectorAll('[data-carousel]')) {
    const item = items.find(asset => asset.id === root.dataset.pack);
    if (!item || !item.frames) continue;
    const state = carouselState(item, root.dataset.carousel);
    if (!state.playing) continue;
    const box = root.querySelector('.pack-window')?.getBoundingClientRect();
    if (!box || document.hidden || dialog.open || !box.height || box.bottom <= viewport.top || box.top >= viewport.bottom) {
      state.due = now + carouselDelay;
    } else if (now >= state.due) {
      updateCarousel(root, item, state.index + 1);
    }
  }
}

function renderFeatured(item) {
  const section = $('#featured');
  section.dataset.carousel = 'hero';
  section.dataset.pack = item.id;
  const authorBadge = item.author ? `<span class="hero-author-pill">${item.author} 授权</span>` : '';
  section.innerHTML = `<div class="hero-copy">
    <div class="hero-tag-row">
      <p class="hero-tag">✦ &nbsp; 精选壁纸包</p>
      ${authorBadge}
    </div>
    <h2 id="featured-title">${item.name.split(' · ')[0]}</h2>
    <p>${item.description} · ${item.frames.length} 张全景壁纸</p>
    <div class="hero-actions">
      ${action(item, 'detail', '预览壁纸包', 'primary', 'arrow')}
      ${item.sourceUrl ? `<a class="btn quiet hero-source-link" href="${item.sourceUrl}" target="_blank" rel="noopener noreferrer">${icon('external')} 原片发布</a>` : ''}
    </div>
  </div>
  <div class="hero-pack-art">${carouselTrack(item, 'hero')}
    <div class="hero-pack-overlay"><span data-pack-caption>${item.frames[carouselState(item, 'hero').index].name}</span>${carouselControls(item, 'hero')}</div>
  </div>`;
}

function settingsDemo() {
  const toggle = (label, hint, on = false) => `<label class="row"><span class="row-text"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" ${on ? 'checked' : ''}></label>`;
  const card = (title, content) => `<div class="card"><h3>${title}</h3>${content}</div>`;
  const storeLink = (label, kind = 'all', target = 'explore') => `<button class="btn small" type="button" data-action="jump-store" data-filter="${kind}" data-target-view="${target}">${label} ${icon('arrow')}</button>`;
  const appearance = (kind, title, caption) => card(title, `<div class="local-gallery"><div class="local-selection" data-current="${kind}"></div><div><p>${caption}</p><div class="btn-row">${storeLink('管理已安装',kind,'library')}${storeLink('浏览在线内容',kind)}</div></div></div>`);
  const pages = {
    overview: `<div class="hero"><div><p class="hero-tag">GEMINI STAR / COMPANION</p><h1>Catstella</h1><span class="hero-sub">桌宠、壁纸和 Gemini 伴侣</span></div><span class="sync-pill cached">设置预览</span></div>
      ${card('常用设置', toggle('应用到 Antigravity','在工作区显示壁纸与主题配色',true) + toggle('仅在 Antigravity 窗口内显示','未打开反重力时退守桌面') + toggle('显示气泡','',true))}
      ${card('个性化',`<div class="row"><span class="row-text"><b>在线内容商店</b><small>在一个地方浏览、安装和管理桌宠、壁纸与主题。</small></span>${storeLink('打开商店')}</div>`)}`,
    pet: `<h1 class="page-title">桌宠</h1>${appearance('character','形态选择','这里显示正在使用的桌宠。更多形象在内容商店。')}${card('双端联动与样式同步',toggle('同步到网页','让 Gemini 网页跟随桌面端的桌宠形象',true))}`,
    wallpaper: `<h1 class="page-title">壁纸</h1>${appearance('wallpaper','壁纸图库','这里显示正在使用的壁纸。安装后可从本地图库选用。')}${card('壁纸设置',toggle('同步到网页','让 Gemini 网页跟随桌面的壁纸选择',true) + toggle('自动轮播','轮换本地壁纸'))}`,
    agy: `<h1 class="page-title">反重力</h1>${card('工作区外观',toggle('启用工作区外观','应用壁纸和配色',true))}${appearance('theme','当前配色','在内容商店安装和切换配色。')}`,
    interact: `<h1 class="page-title">互动</h1>${card('桌宠互动',toggle('启用摸头反馈','轻点桌宠时播放反馈',true) + toggle('自动碎碎念','空闲时偶尔说一句本地短句') + toggle('播放音效','',true))}`,
    quota: `<h1 class="page-title">用量</h1>${card('双端用量实时看板 <span class="chip">示例数据</span>', '<div class="dual-quota-grid"><div class="dual-quota-box"><div class="dq-head"><b>🪐 Antigravity</b></div><div class="dq-stat-row"><span>5 小时剩余额度</span><strong>82%</strong></div><div class="dq-stat-row"><span>1 周剩余额度</span><strong>64%</strong></div></div><div class="dual-quota-box"><div class="dq-head"><b>🌐 Gemini Web</b></div><div class="dq-stat-row"><span>连接状态</span><strong>待同步</strong></div></div></div>')}`,
    about: `<h1 class="page-title">关于</h1>${card('Catstella · Gemini Companion','<p>桌面设置与在线内容商店的交互预览。</p>')}`
  };
  $('#settings-demo').innerHTML = Object.entries(pages).map(([key, html]) => `<section data-demo="${key}" hidden>${html}</section>`).join('');
}

function updateSelections() {
  for (const el of document.querySelectorAll('[data-current]')) {
    const item = currentAsset(el.dataset.current);
    el.innerHTML = item ? `${artwork(item)}<b>${fullName(item)}</b>` : '<div class="no-selection">尚未选择</div>';
  }
}

function switchSetting(next) {
  const selected = $(`[data-setting="${next}"]`);
  if (!selected) return;
  for (const button of document.querySelectorAll('[data-setting]')) {
    button.classList.toggle('active', button === selected);
    if (button === selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#store-page').hidden = next !== 'store';
  $('#settings-demo').hidden = next === 'store';
  for (const page of document.querySelectorAll('[data-demo]')) page.hidden = page.dataset.demo !== next;
  $('#status-label').textContent = next === 'store' ? `目录快照 · ${catalog.length} 件素材` : '桌面设置预览';
  if (next !== 'store') updateSelections();
  $('#content').scrollTo({ top: 0, behavior: 'instant' });
}

function saveState() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch { /* Actions remain available for the current session. */ }
}

function action(item, name, label, skin = '', glyph = '', disabled = false) {
  return `<button class="btn small ${skin}" type="button" data-action="${name}" data-id="${item.id}" ${disabled ? 'disabled' : ''}>${glyph ? icon(glyph) : ''}${label}</button>`;
}

function mainAction(item) {
  if (hasUpdate(item)) return action(item, 'update', '更新', 'soft', 'update');
  if (!installed(item)) return action(item, 'install', '安装', 'primary', 'download');
  if (inUse(item)) return action(item, 'apply', '使用中', '', 'check', true);
  return action(item, 'apply', '使用', 'soft', 'check');
}

function favoriteButton(item) {
  const selected = isFavorite(item);
  return `<button class="favorite" type="button" data-action="favorite" data-id="${item.id}" aria-pressed="${selected}" aria-label="收藏${fullName(item)}" title="${selected ? '取消收藏' : '收藏'}">${icon('heart')}</button>`;
}

function artwork(item, expanded = false) {
  const media = item.kind === 'theme'
    ? '<div class="palette-preview" aria-hidden="true"><span></span><div class="palette-colors"><i></i><i></i><i></i><i></i></div></div>'
    : `<img src="${item.art}" alt="${expanded ? `${fullName(item)}预览` : ''}" decoding="async">`;
  return `<div class="art ${item.kind} ${item.style || ''} ${expanded ? 'dialog-art' : ''}">${media}</div>`;
}

function card(item) {
  const kind = kinds[item.kind];
  const badge = hasUpdate(item) ? `<span class="asset-status update">${icon('update')} 可更新</span>`
    : installed(item) ? `<span class="asset-status installed">${icon('check')} 已安装</span>` : '';
  const cover = item.frames ? `<div class="art wallpaper pack-cover">${carouselTrack(item, 'card', true)}</div>` : artwork(item);
  const authorTag = item.author ? `<span class="asset-author-tag">${item.author}</span>` : '';
  return `<article class="store-card" data-item="${item.id}" ${item.frames ? carouselAttrs(item, 'card') : ''}>
    <div class="card-cover">
      <button class="cover-button" type="button" data-action="detail" data-id="${item.id}" aria-label="预览${fullName(item)}">${cover}</button>
      ${badge || (item.frames ? `<span class="asset-status">${icon('box')} ${item.frames.length} 张一包</span>` : '')}${favoriteButton(item)}
      ${item.frames ? carouselControls(item, 'card') : ''}
    </div>
    <div class="asset-body">
      <div class="asset-meta">
        <span>${icon(kind.icon)} ${item.frames ? '壁纸包' : kind.label}</span>
        <span>${authorTag || fileSize(item.size)}</span>
      </div>
      <h3>${fullName(item)}</h3><p>${item.description}</p>
      <div class="asset-actions">${action(item, 'detail', '详情', 'quiet')}${mainAction(item)}</div>
    </div>
  </article>`;
}

function render() {
  const [title, subtitle, section] = views[view];
  $('#page-title').textContent = title;
  $('#page-subtitle').textContent = subtitle;
  const query = search.value.trim().toLocaleLowerCase();
  $('#featured').hidden = view !== 'explore' || !!query || !['all', 'wallpaper'].includes(category);
  $('#installed-count').textContent = items.filter(installed).length;
  $('#favorite-count').textContent = state.favorites.length;
  for (const button of document.querySelectorAll('[data-view]')) {
    const current = button.dataset.view === view;
    button.classList.toggle('active', current);
    if (current) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const button of document.querySelectorAll('[data-kind]')) {
    const current = button.dataset.kind === category;
    button.classList.toggle('active', current);
    button.setAttribute('aria-pressed', current);
  }

  $('#listing').hidden = view === 'guide' || !!detail;
  detailPage.hidden = !detail;
  $('#guide-page').hidden = view !== 'guide';
  if (detail || view === 'guide') return;

  const collection = view === 'explore' ? catalog : items.filter(view === 'library' ? installed : isFavorite);
  const visible = collection.filter(item =>
    (category === 'all' || item.kind === category) &&
    `${fullName(item)} ${item.description} ${kinds[item.kind].label} ${item.author || ''} ${item.frames?.map(frame => frame.name).join(' ') || ''}`.toLocaleLowerCase().includes(query)
  );
  resultsTitle.textContent = query ? '搜索结果' : category === 'all' ? section : kinds[category].label;
  $('#result-count').textContent = `${visible.length} 件内容`;
  if (visible.length) {
    grid.innerHTML = visible.map(card).join('');
    return;
  }

  const filtered = query || category !== 'all';
  const empty = filtered ? ['没有找到匹配的内容', '试试其他关键词或切换分类。']
    : view === 'favorites' ? ['收藏夹还是空的', '点击素材上的爱心，就能在这里找到它。']
      : ['还没有安装内容', '去探索内容，挑一件喜欢的素材。'];
  grid.innerHTML = `<div class="empty-state">${icon(filtered ? 'search' : view === 'favorites' ? 'heart' : 'box')}
    <h3>${empty[0]}</h3><p>${empty[1]}</p>
    <button class="btn small" type="button" data-action="${filtered ? 'clear-filters' : 'browse'}">${filtered ? '清除筛选' : '探索内容'}</button>
  </div>`;
}

function switchView(next) {
  if (!Object.hasOwn(views, next)) return;
  detail = undefined;
  view = next;
  category = 'all';
  search.value = '';
  $('#content').scrollTo({ top: 0, behavior: 'instant' });
  render();
}

function dialogFrame(label, contents) {
  dialog.innerHTML = `<div class="dialog-bar"><span>${label}</span><button type="button" class="titlebar-btn close-dialog" data-action="close" aria-label="关闭" autofocus>${icon('close')}</button></div><div class="dialog-body">${contents}</div>`;
  if (!dialog.open) dialog.showModal();
}

const themeLooks = {
  'midnight-blue': { name: '深海星夜', surface: '#eef5fd', edge: '#d9e9fb', ink: '#122033', accent: '#3b7dd8', opacity: .75 },
  'violet-default': { name: '星轨紫', surface: '#f3edfc', edge: '#e5d8f6', ink: '#1c1828', accent: '#9370db', opacity: .88 }
};

function effectPreview(item, rotating) {
  const chosen = kind => previewComparison === 'candidate' && item.kind === kind ? item : currentAsset(kind);
  const pet = chosen('character');
  const wallpaper = chosen('wallpaper');
  const theme = themeLooks[chosen('theme')?.id] || themeLooks['violet-default'];
  return `<figure class="effect-preview">
    <div class="scene" style="--scene-surface:${theme.surface};--scene-edge:${theme.edge};--scene-accent:${theme.accent};--scene-ink:${theme.ink};--scene-opacity:${theme.opacity}">
      ${rotating ? `<div class="scene-wallpaper">${carouselTrack(item, 'detail', true)}</div>` : wallpaper ? `<img class="scene-wallpaper" src="${wallpaper.art}" alt="">` : ''}
      <div class="scene-title"><span class="scene-dots"><i></i><i></i><i></i></span><span>Antigravity · 工作区</span><span class="scene-caption">界面示意</span></div>
      <div class="scene-window" aria-hidden="true"><div class="scene-side"><b>资源管理器</b><span>▾ &nbsp; 项目</span><span>◇ &nbsp; notes.md</span><span>◇ &nbsp; README.md</span></div><div class="scene-editor"><b>notes.md</b><div class="scene-lines"><i></i><i></i><i></i><i></i></div></div></div>
      ${pet ? `<div class="scene-pet"><span class="scene-bubble">准备好啦 ✦</span><img src="${pet.art}" alt="${fullName(pet)}"></div>` : ''}
    </div>
    <figcaption>${pet ? fullName(pet) : '无桌宠'} <span>·</span> ${rotating ? `<b data-pack-caption>${item.frames[carouselState(item, 'detail').index].name}</b>` : wallpaper ? wallpaper.name : '无壁纸'} <span>·</span> ${theme.name}</figcaption>
  </figure>`;
}

function renderCredit(item) {
  if (item.authorUrl && item.sourceUrl) {
    return `<a class="detail-source-link" href="${item.authorUrl}" target="_blank" rel="noopener noreferrer">${item.author}</a> · <a class="detail-source-link" href="${item.sourceUrl}" target="_blank" rel="noopener noreferrer" title="${item.sourceTitle || '查看发布源'}">B站授权壁纸 (BV17PxC6SERc) ${icon('external')}</a>`;
  }
  if (item.credit) return item.credit;
  return item.kind === 'theme' ? 'Catstella · CC0' : 'Catstella · 项目素材';
}

function renderDetail(item, message = '') {
  const kind = kinds[item.kind];
  const status = hasUpdate(item) ? '有可用更新' : inUse(item) ? '正在使用' : installed(item) ? '已安装' : '未安装';
  const revisions = hasUpdate(item) ? `${version(installed(item))} → ${version(latest(item))}` : version(latest(item));
  const creditHtml = renderCredit(item);
  const authorBadge = item.author ? `<span class="detail-author-pill">${item.author} 授权</span>` : '';
  const sourceCard = item.sourceTitle ? `
    <div class="detail-callout">
      <div class="detail-callout-head">
        ${icon('external')}
        <b>原发布视频</b>
        <a href="${item.sourceUrl}" target="_blank" rel="noopener noreferrer" class="callout-link">去 Bilibili 观看</a>
      </div>
      <p class="callout-title">${item.sourceTitle}</p>
      <p class="hint callout-desc">“${item.description}”</p>
    </div>` : '';

  detailPage.innerHTML = `
    <button class="btn small quiet detail-back" type="button" data-action="back-detail">${icon('arrow')} 返回${view === 'library' ? '已安装' : view === 'favorites' ? '收藏夹' : '探索'}</button>
    <div class="detail-layout">
      <section class="card detail-preview" aria-label="素材预览">
        <div class="preview-toolbar"><div class="view-mode-toggle" role="group" aria-label="预览方式">
          <button class="view-btn" type="button" data-preview="effect">应用效果</button><button class="view-btn" type="button" data-preview="asset">素材原样</button>
        </div></div>
        <div id="preview-content"></div>
        <div class="preview-compare" id="preview-compare"><span>搭配对比</span><div class="view-mode-toggle" role="group" aria-label="搭配对比">
          <button class="view-btn" type="button" data-compare="current">当前搭配</button><button class="view-btn" type="button" data-compare="candidate">试用此素材</button>
        </div></div>
      </section>
      <aside class="card detail-info">
        <div class="eyebrow-row">
          <span class="eyebrow">${item.frames ? '壁纸包' : kind.label}</span>
          ${authorBadge}
        </div>
        <h2 id="detail-title" tabindex="-1">${fullName(item)}</h2>
        <p class="hint">${item.description}</p>
        <dl class="detail-data">
          ${item.frames ? `<dt>包内壁纸</dt><dd>${item.frames.length} 张全景</dd>` : ''}
          <dt>状态</dt><dd>${status}</dd>
          <dt>演示版本</dt><dd>${revisions}</dd>
          <dt>大小</dt><dd>${fileSize(item.size)}</dd>
          <dt>来源</dt><dd class="detail-source-cell">${creditHtml}</dd>
        </dl>
        ${sourceCard}
        <div class="dialog-actions">${mainAction(item)}${hasUpdate(item) && !inUse(item) ? action(item, 'apply', '使用已安装版') : ''}${favoriteButton(item)}${installed(item) ? action(item, 'confirm-remove', '卸载', 'danger') : ''}</div>
        ${message ? `<p class="detail-feedback" role="status">${message}</p>` : ''}
        ${item.frames ? '<p class="hint pack-note">整包安装与收藏。轮播可随时暂停与选图预览，使用时应用包内首张壁纸。</p>' : ''}
      </aside>
    </div>`;
  renderPreview(item);
}

function renderPreview(item) {
  for (const [key, active] of [['preview', previewMode], ['compare', previewComparison]]) {
    for (const button of detailPage.querySelectorAll(`[data-${key}]`)) {
      button.classList.toggle('active', button.dataset[key] === active);
      button.setAttribute('aria-pressed', button.dataset[key] === active);
    }
  }
  $('#preview-compare').hidden = previewMode === 'asset';
  const rotating = item.frames && (previewMode === 'asset' || previewComparison === 'candidate');
  const preview = previewMode === 'effect' ? effectPreview(item, rotating)
    : rotating ? `<div class="art wallpaper dialog-art pack-original">${carouselTrack(item, 'detail')}</div>` : artwork(item, true);
  $('#preview-content').innerHTML = rotating ? `<div ${carouselAttrs(item, 'detail')}>
    ${preview}
    <div class="pack-detail-strip">${carouselThumbnails(item)}${carouselControls(item, 'detail')}</div>
  </div>` : preview;
}

function showDetail(item, opener) {
  detail = item;
  detailReturn = { action: opener.dataset.action, id: item.id, cover: opener.classList.contains('cover-button'), featured: !!opener.closest('#featured') };
  listingScroll = $('#content').scrollTop;
  previewMode = 'effect';
  previewComparison = 'candidate';
  if (item.frames) {
    const origin = opener.closest('[data-carousel]');
    const previewState = carouselState(item, 'detail');
    previewState.index = origin ? carouselState(item, origin.dataset.carousel).index : 0;
    previewState.due = performance.now() + carouselDelay;
  }
  render();
  renderDetail(item);
  $('#content').scrollTo({ top: 0, behavior: 'instant' });
  $('#detail-title').focus({ preventScroll: true });
}

function backToListing() {
  detail = undefined;
  render();
  $('#content').scrollTo({ top: listingScroll, behavior: 'instant' });
  const { id, action: name, cover, featured } = detailReturn || {};
  const target = featured ? $('#featured [data-action="detail"]') : grid.querySelector(`${cover ? '.cover-button' : '.asset-actions button'}[data-id="${id}"][data-action="${name}"]`);
  (target || resultsTitle).focus({ preventScroll: true });
}

function confirmRemoval(item) {
  dialogFrame('管理已安装内容', `<h2 id="dialog-title">卸载 ${fullName(item)}？</h2>
    <p>${inUse(item) ? '卸载后，此素材的「使用中」状态会清除。' : '卸载后仍可以在商店重新安装。'}收藏记录会保留。</p>
    <div class="dialog-actions"><button class="btn small" type="button" data-action="close">取消</button>${action(item, 'remove', '确认卸载', 'danger')}</div>`);
  dialog.querySelector('.dialog-actions [data-action="close"]').focus();
}

function prepareGuide() {
  const body = ['### 想适配的素材', '- 名称：', '- 分类（桌宠 / 壁纸 / 主题配色）：', '- 原作链接与作者：', '',
    '### 希望如何使用', '- 平台（桌面端 / Gemini 网页 / 两者）：', '- 想保留的效果或需要调整的地方：', '',
    '### 授权情况', '- 原创 / 已获授权 / 尚待确认：', '- 许可链接或可公开的授权说明（如有）：', '',
    '### 参考资料（可选）', '- 可公开分享的截图或示例链接：'].join('\n');
  const draft = new URL('https://github.com/lynnfei/Catstella/issues/new');
  draft.searchParams.set('title', '[适配请求][分类] 素材名称');
  draft.searchParams.set('body', body);
  $('#issue-draft').href = draft.href;
  $('#issue-template').value = body;
}

async function copyIssue() {
  const template = $('#issue-template');
  try {
    await navigator.clipboard.writeText(template.value);
    $('#copy-status').textContent = '已复制';
  } catch {
    template.focus();
    template.select();
    $('#copy-status').textContent = '已选中模板，可按 Ctrl+C 或 ⌘C 复制。';
  }
}

function notify(message) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function applyAction(name, item, button) {
  let message;
  if (name === 'favorite') {
    const saved = isFavorite(item);
    state.favorites = saved ? state.favorites.filter(id => id !== item.id) : [...state.favorites, item.id];
    message = saved ? `已取消收藏 ${item.name}` : `已收藏 ${item.name}`;
  } else if ((name === 'install' && !installed(item)) || (name === 'update' && hasUpdate(item))) {
    state.installed[item.id] = latest(item);
    message = name === 'install' ? `已安装 ${item.name}` : `已将 ${item.name} 更新到 ${version(latest(item))}`;
  } else if (name === 'apply' && installed(item)) {
    state.active[item.kind] = item.id;
    message = `正在使用 ${item.name}`;
  } else if (name === 'remove' && dialog.open && installed(item)) {
    delete state.installed[item.id];
    if (inUse(item)) delete state.active[item.kind];
    message = `已卸载 ${item.name}`;
    dialog.close();
  } else return;

  saveState();
  render();
  const sameAction = `[data-id="${item.id}"][data-action="${name}"]:not(:disabled)`;
  if (detail) {
    renderDetail(item, message);
    const nextAction = { install: 'apply', update: 'apply', remove: 'install' }[name];
    const replacement = detailPage.querySelector(sameAction) || (nextAction && detailPage.querySelector(`[data-action="${nextAction}"]:not(:disabled)`));
    (replacement || $('#detail-title')).focus({ preventScroll: true });
  } else {
    const replacement = grid.querySelector(sameAction) || grid.querySelector(`[data-item="${item.id}"] .cover-button`);
    (replacement || resultsTitle).focus({ preventScroll: true });
    notify(message);
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const command = button.dataset.packCommand;
  if (command !== undefined) {
    const root = button.closest('[data-carousel]');
    const item = items.find(asset => asset.id === root.dataset.pack);
    if (!item) return;
    const state = carouselState(item, root.dataset.carousel);
    if (command === 'play') toggleCarousel(root, item, !state.playing);
    else if (command === 'next') updateCarousel(root, item, state.index + 1);
    else if (command === 'prev') updateCarousel(root, item, state.index - 1, -1);
    else updateCarousel(root, item, Number(command), Number(command) < state.index ? -1 : 1);
    return;
  }
  const { action: name, id, kind, view: next, setting, preview, compare } = button.dataset;
  const item = items.find(x => x.id === id);
  if (setting) switchSetting(setting);
  else if (next) switchView(next);
  else if (preview && detail) { previewMode = preview; renderPreview(detail); }
  else if (compare && detail) { previewComparison = compare; renderPreview(detail); }
  else if (kind) { category = kind; render(); }
  else if (name === 'clear-filters') { category = 'all'; search.value = ''; render(); search.focus(); }
  else if (name === 'browse') { switchView('explore'); $('[data-view="explore"]').focus(); }
  else if (name === 'jump-store') {
    switchSetting('store');
    switchView(button.dataset.targetView);
    category = button.dataset.filter;
    render();
    $(`[data-view="${view}"]`).focus();
  }
  else if (name === 'back-detail') backToListing();
  else if (name === 'copy-issue') copyIssue();
  else if (name === 'close') dialog.close();
  else if (name === 'detail' && item) showDetail(item, button);
  else if (name === 'confirm-remove' && item) confirmRemoval(item);
  else if (item) applyAction(name, item, button);
});

dialog.addEventListener('close', () => {
  detailPage.querySelector('[data-action="confirm-remove"]')?.focus({ preventScroll: true });
});
search.addEventListener('input', render);
settingsDemo();
prepareGuide();
renderFeatured(featuredPack);
const initialSetting = location.hash.slice(1);
switchSetting(['overview','pet','wallpaper','store','agy','interact','quota','about'].includes(initialSetting) ? initialSetting : 'store');
render();
setInterval(tickCarousels, 250);
