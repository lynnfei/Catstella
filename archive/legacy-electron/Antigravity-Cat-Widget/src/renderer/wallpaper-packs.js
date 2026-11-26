(() => {
  function groups(items) {
    const result = new Map();
    for (const item of items) {
      const legacy = /^(?:custom:)?online-moriyama-catgirl-(0[1-9])$/.exec(item.id);
      const pack = item.pack || (legacy && {id:'moriyama-catgirl-pack',name:'森山白月壁纸包',position:Number(legacy[1])});
      const grouped = pack && /^[a-z][a-z0-9-]{0,47}$/.test(pack.id) && typeof pack.name === 'string' && pack.name.length > 0 && pack.name.length <= 80;
      const key = grouped ? 'pack:' + pack.id : item.id;
      const group = result.get(key) || {key, name:grouped ? pack.name : '', items:[]};
      group.items.push({item,position:Number.isSafeInteger(pack?.position) ? pack.position : 0});
      result.set(key,group);
    }
    return [...result.values()].map(({key,name,items}) => ({
      key,name,items:items.sort((a,b) => a.position - b.position).map(record => record.item)
    }));
  }

  function attach(cover, key, expanded, createCard) {
    const container = document.createElement('div');
    container.className = 'wallpaper-pack-items';
    container.id = 'wallpaper-items-' + key.slice(5);
    container.setAttribute('role','group');
    container.setAttribute('aria-label',cover.getAttribute('aria-label'));
    cover.setAttribute('aria-controls',container.id);
    cover.after(container);
    let motions = [];
    function paint(open, animate) {
      for (const motion of motions) motion.cancel();
      motions = [];
      cover.setAttribute('aria-expanded',String(open));
      container.inert = !open;
      if (open && !container.hasChildNodes()) createCard(container);
      if (open) container.hidden = false;
      if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        container.hidden = !open;
        return;
      }
      const frames = [{opacity:0,translate:'0 -5px'},{opacity:1,translate:'0 0'}];
      if (!open) frames.reverse();
      motions = [...container.children].map(card => card.animate(frames,{duration:open ? 180 : 130,easing:'ease-out',fill:'both'}));
      const running = motions;
      Promise.all(running.map(motion => motion.finished)).then(() => {
        if (motions !== running) return;
        container.hidden = !open;
        for (const motion of running) motion.cancel();
        motions = [];
      },() => {});
    }
    cover.addEventListener('click',() => {
      const open = !expanded.has(key);
      if (open) expanded.add(key); else expanded.delete(key);
      paint(open,true);
    });
    paint(expanded.has(key),false);
  }
  window.CatstellaWallpaperPacks = {groups,attach};
})();
