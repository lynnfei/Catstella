const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const {createOnlineActions} = require('../Antigravity-Cat-Widget/src/main/online.cjs');
const {SettingsManager} = require('../Antigravity-Cat-Widget/src/domain/settings.cjs');
const {DreamSkinSettings} = require('../Antigravity-Dream-Skin/src/domain/settings.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zYsAAAAASUVORK5CYII=', 'base64');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'catstella-mutations-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const settings = new SettingsManager(path.join(root,'settings.json'));
  const dream = new DreamSkinSettings(path.join(root,'skin.json'));
  const files = new Map();
  let items = [], failSave = false, gate = null;
  function asset(kind,id,bytes,ext) {
    const name = `${kind}s/${id}.${ext}`;
    files.set(name,bytes);
    const item = {id,kind,name:id,credit:'isolated fixture',path:name,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    items = [...items.filter(x=>x.id!==id),item];
    return item;
  }
  const cat = suffix => asset('character','fixture-cat',Buffer.from(JSON.stringify({schema:1,frames:{idle:'data:image/png;base64,'+png.toString('base64')},...suffix})), 'json');
  cat(); asset('wallpaper','fixture-wall',png,'png');
  asset('theme','fixture-theme',Buffer.from(JSON.stringify({schema:1,palette:'pink',opacity:71})),'json');
  const wallpaperDir=path.join(root,'wallpapers'),characterDir=path.join(root,'characters');
  const actions=createOnlineActions({dataDir:root,wallpaperDir,characterDir,settings,version:'0.6.1',
    nativeImage:{createFromBuffer:()=>({isEmpty:()=>false})},getDreamSkin:()=>dream.getAll(),
    getFallbackWallpaper:()=>({id:'builtin',file:path.join(root,'builtin.png')}),
    apply:patch=>{if(failSave)throw Error('save failed');const{dreamSkin,...rest}=patch;settings.update(rest);if(dreamSkin)dream.update(dreamSkin);},
    fetcher:async url=>{const file=url.split('/online-assets/')[1];if(gate&&file!=='catalog.json')await gate;
      return file==='catalog.json'?Response.json({schema:1,items:items.filter(i=>i.kind!=='character'),characters:items.filter(i=>i.kind==='character')}):new Response(files.get(file));}});
  return {root,settings,dream,actions,cat,characterDir,wallpaperDir,fail:()=>{failSave=true;},gate:value=>{gate=value;}};
}
test('active assets uninstall to valid defaults; failed saves leave their files intact',async t=>{
  const f=fixture(t);
  assert.equal((await f.actions.handle('download','fixture-cat')).ok,true);
  f.settings.update({characterPack:'online-fixture-cat'});
  assert.equal((await f.actions.handle('uninstall','fixture-cat')).ok,true);
  assert.equal(f.settings.get('characterPack'),'gemini-star-v1');
  assert.equal((await f.actions.handle('install','fixture-wall')).ok,true);
  assert.equal((await f.actions.handle('uninstall','fixture-wall')).ok,true);
  assert.equal(f.dream.get('wallpaperId'),'builtin');
  assert.equal(f.dream.get('wallpaperFile'),path.join(f.root,'builtin.png'));
  assert.equal((await f.actions.handle('install','fixture-theme')).ok,true);
  assert.match(f.dream.get('onlineThemeRevision'),/^[a-f0-9]{64}$/);
  assert.equal((await f.actions.handle('uninstall','fixture-theme')).ok,true);
  assert.equal(f.dream.get('themePreset'),'violet');
  assert.equal(f.dream.get('onlineThemeId'),'');
  await f.actions.handle('install','fixture-wall');f.fail();
  assert.equal((await f.actions.handle('uninstall','fixture-wall')).ok,false);
  assert.equal(fs.existsSync(f.dream.get('wallpaperFile')),true);
});
test('a failed update retains the previous character and manifest; the next update succeeds',async t=>{
  const f=fixture(t);await f.actions.handle('download','fixture-cat');
  const dest=path.join(f.characterDir,'online-fixture-cat'),manifest=fs.readFileSync(path.join(dest,'manifest.json'));
  f.cat({revision:2});await f.actions.handle('catalog',true);
  const write=fs.writeFileSync;
  const mock=t.mock.method(fs,'writeFileSync',function(file,...args){
    if(String(file).startsWith(f.characterDir)&&String(file).includes('.install-')&&String(file).includes('manifest.json'))throw Error('disk full');
    return write.call(this,file,...args);
  });
  assert.equal((await f.actions.handle('download','fixture-cat')).ok,false);
  assert.deepEqual(fs.readFileSync(path.join(dest,'manifest.json')),manifest);
  assert.equal(fs.existsSync(path.join(dest,'frames/idle.png')),true);
  mock.mock.restore();
  assert.equal((await f.actions.handle('download','fixture-cat')).ok,true);
  assert.notDeepEqual(fs.readFileSync(path.join(dest,'manifest.json')),manifest);
});
test('uninstall waits for an in-flight install and removes its result',async t=>{
  const f=fixture(t);let release;
  f.gate(new Promise(resolve=>{release=resolve;}));
  const install=f.actions.handle('download','fixture-cat');
  const remove=f.actions.handle('uninstall','fixture-cat');release();
  assert.equal((await install).ok,true);assert.equal((await remove).ok,true);
  assert.equal(fs.existsSync(path.join(f.characterDir,'online-fixture-cat')),false);
});
