window.mountCatstellaStore = async (root, { maintenance, scrollHost } = {}) => {
  const api = window.KIMINO_API;
  const call = (action,value) => api.sendMessage({type:'KG_ONLINE',action,value});
  const keys = ['autoUpdateCheck','customWallpapers','onlineCharacterPacks','character','wallpaperId','onlinePalette','onlineThemeId','syncCharacter','syncWallpaper','agyBridgeState','agySyncedWallpaper',
    'webWallpaperSlideshow','webWallpaperInterval','webWallpaperCycle'];
  let [builtIn, stored] = await Promise.all([
    fetch(api.getURL('assets/gallery.json')).then(response => response.json()).catch(() => ({})),
    api.storageGet(keys)
  ]);
  const checkbox = maintenance.querySelector('#auto-update');
  checkbox.checked = stored.autoUpdateCheck !== false;
  const panel = window.mountCatstellaOnline(maintenance.querySelector('#online-panel'),call,{updatesOnly:true});
  checkbox.onchange = async () => {
    checkbox.disabled = true;
    if (!await api.storageSet({autoUpdateCheck:checkbox.checked})) checkbox.checked = !checkbox.checked;
    checkbox.disabled = false;
    void panel.refresh(false);
  };
  function selection(item) {
    if (item.kind === 'theme') {
      const known = {'violet-default':'violet','midnight-blue':'ocean'}[item.id];
      const active = known ? known === (stored.onlinePalette || 'violet') : stored.onlineThemeId === item.id;
      return {installed:active,active};
    }
    const isPet = item.kind === 'character';
    const built = (isPet ? builtIn.characters : builtIn.wallpapers)?.find(entry => entry.id === item.id);
    const savedId = (isPet ? 'online-' : 'custom:online-') + item.id;
    const saved = isPet ? stored.onlineCharacterPacks?.[savedId] : stored.customWallpapers?.find(wall => wall.id === savedId);
    const id = saved ? savedId : built?.id;
    const state = stored.agyBridgeState;
    const linked = isPet ? stored.syncCharacter : stored.syncWallpaper;
    const desktopId = isPet ? state?.desktop?.characterPack : state?.desktop?.wallpaperId;
    const desktopIds = (isPet ? state?.desktop?.characterPackIds : state?.desktop?.wallpaperIds) || [desktopId];
    const desktopMatch = ['online-' + item.id,item.id].find(candidate => desktopIds.includes(candidate));
    const desktopOnly = !id && !!desktopMatch;
    const local = isPet ? stored.character || 'gemini-star-v1' : window.KiminoWallpaperSettings.id(stored) || 'gemini-character-sheet-v1';
    const activeId = linked !== false && state?.online && desktopId ? desktopId : local;
    const relative = built?.preview || built?.src;
    const desktopActive = linked !== false && state?.online && !!desktopMatch && desktopId === desktopMatch;
    return {id,desktopOnly,desktopMatch,installed:!!id || desktopOnly,
      active:!!id && (activeId === id || desktopActive) || desktopOnly && !isPet && desktopActive,
      canUse:!desktopOnly || !isPet && state?.online === true,
      useLabel:desktopOnly ? (isPet ? '仅桌面端可用' : '同步使用桌面壁纸') : '',
      revision:saved?.revision || '',
      preview:saved?.frames?.idle || saved?.dataUrl || (relative ? api.getURL(relative) : '')};
  }
  const hub = window.mountCatstellaHub(root,{
    scrollHost,
    previewWallpaper: () => {
      if (stored.syncWallpaper !== false && stored.agySyncedWallpaper?.dataUrl) return stored.agySyncedWallpaper.dataUrl;
      const id = window.KiminoWallpaperSettings.id(stored) || 'gemini-character-sheet-v1';
      const custom = stored.customWallpapers?.find(wall => wall.id === id);
      const local = builtIn.wallpapers?.find(wall => wall.id === id);
      return custom?.dataUrl || (local && api.getURL(local.preview || local.src));
    },
    selection,
    currentTheme: () => ({preset:stored.onlinePalette || 'violet',onlineThemeId:stored.onlineThemeId || ''}),
    call:async (action,value) => {
      const result = await call(action,value);
      if ((action === 'download' || action === 'uninstall') && result?.ok) stored = await api.storageGet(keys);
      return result;
    },
    use:async item => {
      if (item.kind === 'theme') {
        const result = await call('install',item.id);
        if (result?.ok) stored = await api.storageGet(keys);
        return result;
      }
      const {id,desktopOnly,desktopMatch} = selection(item);
      if (desktopOnly && item.kind === 'wallpaper' && stored.agyBridgeState?.online) {
        const result = await api.sendMessage({type:'KG_BRIDGE_PATCH',patch:{syncWallpaper:true,dreamSkin:{wallpaperId:desktopMatch}}});
        stored = await api.storageGet(keys);
        return {ok:!!result?.online && stored.syncWallpaper !== false && stored.agyBridgeState?.desktop?.wallpaperId === desktopMatch};
      }
      if (!id) return {ok:false};
      const isPet = item.kind === 'character';
      const sync = isPet ? 'syncCharacter' : 'syncWallpaper';
      const key = isPet ? 'character' : 'wallpaperId';
      // Commit the local choice first. A failed bridge update cannot discard it.
      if (!await api.storageSet(isPet ? {[key]:id} : {[key]:id,webWallpaperCycle:null})) return {ok:false};
      const result = stored[sync] === false ? {ok:true} : await api.sendMessage({type:'KG_BRIDGE_PATCH',patch:{[sync]:false}});
      stored = await api.storageGet(keys);
      return {ok:!!result?.ok && stored[sync] === false};
    },
    openSource:url => window.open(url,'_blank','noopener,noreferrer')
  });
  const appearance = state => JSON.stringify([state?.online,state?.desktop?.characterPack,state?.desktop?.wallpaperId,
    state?.desktop?.characterPackIds,state?.desktop?.wallpaperIds]);
  api.onChanged((changes, area) => {
    if (area !== 'local') return;
    let refresh = false;
    for (const key of keys) {
      if (!changes[key] || key === 'autoUpdateCheck') continue;
      const value = changes[key].newValue;
      if (key !== 'agyBridgeState' || appearance(stored[key]) !== appearance(value)) refresh = true;
      stored[key] = value;
    }
    if (refresh) hub.render();
  });
  const restore = maintenance.querySelector('#restore-palette');
  restore.onclick = async () => {
    const ok = await api.storageSet({onlinePalette:'violet',onlineThemeId:null,wallpaperOpacity:.88});
    restore.textContent = ok ? '已恢复星轨紫配色' : '恢复失败，请重试';
    stored = await api.storageGet(keys);
    hub.render();
  };
  return hub;
};
