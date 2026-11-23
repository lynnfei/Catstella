const path=require('node:path');
// An explicit id is authoritative. File paths are compatibility metadata, except
// for the legacy file-only picker/migration that has no explicit selection id.
function selectWallpaper(manager, state, {fileOnly=false}={}) {
  const packs=manager.usablePacks();
  const byId=packs.find(p=>p.id===state.wallpaperId||p.aliases?.includes(state.wallpaperId));
  const byFile=state.wallpaperFile&&packs.find(p=>[p.file,...(p.aliasFiles||[])].some(f=>f&&path.resolve(f)===path.resolve(state.wallpaperFile)));
  const selected=(fileOnly?byFile||byId:byId||byFile)||packs.find(p=>p.id===manager.defaultId)||packs[0];
  return selected?{wallpaperId:selected.id,wallpaperFile:selected.file}:null;
}
module.exports={selectWallpaper};
