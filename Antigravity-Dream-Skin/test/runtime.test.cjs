const{test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const{DreamSkinSettings,legacyRotatePatch}=require("../src/domain/settings.cjs"),{DreamSkinThemeLoader}=require("../src/domain/theme-loader.cjs");
test("output glass mode persists, validates and reaches host payload",()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"dream-output-")),"settings.json"),s=new DreamSkinSettings(file);
 assert.equal(s.get("outputMode"),"transparent");s.update({outputMode:"glass"});assert.equal(new DreamSkinSettings(file).get("outputMode"),"glass");
 assert.equal(new DreamSkinThemeLoader().payload(s.getAll()).outputMode,"glass");s.update({outputMode:"invalid"});assert.equal(s.get("outputMode"),"transparent");
});
const TINY_PNG=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64");
test("missing or corrupt wallpaper resources degrade gracefully and stay recoverable",()=>{
 const rootDir=fs.mkdtempSync(path.join(os.tmpdir(),"dream-missing-"));
 const manager=new DreamSkinThemeLoader({rootDir});
 assert.throws(()=>manager.verifyIntegrity(),/未找到可用壁纸包/);
 const packDir=path.join(rootDir,"assets/wallpapers/broken");
 fs.mkdirSync(packDir,{recursive:true});
 fs.writeFileSync(path.join(packDir,"wallpaper.png"),"damaged");
 assert.throws(()=>manager.verifyIntegrity("broken"),/壁纸包不可用/);
 fs.writeFileSync(path.join(packDir,"wallpaper.png"),TINY_PNG);
 const pack=manager.verifyIntegrity("broken");
 assert.equal(pack.verified,true);assert.equal(pack.width,1);assert.equal(pack.height,1);
});
test("disabled by default, zero scrim survives reload, protection cannot be disabled",()=>{const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"dream-test-")),"settings.json"),s=new DreamSkinSettings(file);assert.equal(s.get("enabled"),false);s.update({scrim:0,fit:"cover",protectEditor:false});assert.equal(new DreamSkinSettings(file).get("scrim"),0);assert.equal(s.get("protectEditor"),true);});
test("wallpaper packs are scanned dynamically, traversal paths are rejected, payload keeps the original image",()=>{
 const manager=new DreamSkinThemeLoader();
 assert(manager.listPacks(true).some(pack=>pack.id==="gemini-character-sheet-v1"));
 const verified=manager.verifyIntegrity("gemini-character-sheet-v1");
 assert.equal(verified.width,1672);assert.equal(verified.height,941);assert.equal(verified.verified,true);
 assert(manager.payload({scrim:0,fit:"contain",wallpaperId:"gemini-character-sheet-v1"}).image.startsWith("data:image/png;base64,"));
 assert.equal(manager.payload({scrim:0,wallpaperId:"gemini-character-sheet-v1"}).scrim,0);
 const rootDir=fs.mkdtempSync(path.join(os.tmpdir(),"dream-escape-"));
 const escapeDir=path.join(rootDir,"assets/wallpapers/escape");
 fs.mkdirSync(escapeDir,{recursive:true});
 fs.writeFileSync(path.join(escapeDir,"manifest.json"),JSON.stringify({file:"../escape.png"}));
 const hostile=new DreamSkinThemeLoader({rootDir});
 assert.throws(()=>hostile.verifyIntegrity(),/无效壁纸路径/);
});
test("wallpaperId and extension fields survive sanitize, reload and known-field validation",()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"dream-keep-")),"settings.json");
 const s=new DreamSkinSettings(file);
 s.update({wallpaperId:"star-sky",customWallpaperPath:"D:/walls/x.png",fit:"cover"});
 const restored=new DreamSkinSettings(file);
 assert.equal(restored.get("wallpaperId"),"star-sky");
 assert.equal(restored.get("customWallpaperPath"),"D:/walls/x.png");
 s.update({wallpaperId:42,zoom:9,autoRotate:"15m"});
 assert.equal(s.get("wallpaperId"),"gemini-character-sheet-v1");
 assert.equal(s.get("zoom"),2);
 assert.equal(s.get("autoRotate"),"15m");
 assert.equal(s.get("slideshow"),true);
});

const {HostController}=require("../src/domain/host-controller.cjs");
function fixture(){
 let state={themed:false},blockSnapshot=null,blockApply=null;
 const applied=[],writes=[],appearance=[];
 const client={
  closed:false,
  async evaluate(expression){
   if(expression.startsWith("({ready:")){
    if(blockSnapshot){const gate=blockSnapshot;blockSnapshot=null;await gate;}
    return {...state};
   }
   if(expression.startsWith("(async function installTheme")){
    const payload=JSON.parse(expression.slice(expression.lastIndexOf(")({")+2,-1));
    applied.push(payload);
    if(blockApply){const gate=blockApply;blockApply=null;await gate;}
    state={themed:true,owner:payload.owner,appearance:true};
    return {applied:true};
   }
   if(expression.startsWith('window.__agyDreamSkinV2.updateAppearance(')){
    appearance.push(JSON.parse(expression.slice(expression.indexOf('(')+1,-1)));
    return {applied:true};
   }
   if(expression.includes("destroy()")){
    if(!expression.includes("===")||state.owner===controller.owner){writes.push("destroy");state={themed:false};}
    return null;
   }
   throw new Error("Unexpected operation");
  },
  close(){this.closed=true;}
 };
 const controller=new HostController(
  {payload:settings=>({...settings,image:"data:image/png;base64,fixture"})},
  ()=>{},
  {discover:async()=>({target:{webSocketDebuggerUrl:"ws://127.0.0.1:1/test"}}),createClient:()=>client}
 );
 return {controller,applied,writes,appearance,setState:v=>state=v,holdSnapshot:p=>blockSnapshot=p,holdApply:p=>blockApply=p};
}
const nextTask=()=>new Promise(resolve=>setImmediate(resolve));

test('appearance edits do not reload wallpaper bytes, but wallpaper or missing-host changes require a full apply',async()=>{
 const f=fixture();let settings={enabled:true,wallpaperId:'first',scrim:12,opacity:55,replyOpacity:22};
 await f.controller.update(settings);
 for(let i=0;i<10;i++){settings={...settings,replyOpacity:10+i,opacity:30+i};await f.controller.update(settings);}
 assert.equal(f.applied.length,1,'alpha-only commits must not rebuild the wallpaper payload');
 assert.equal(f.appearance.length,10);assert.equal(f.appearance.at(-1).opacity,.39);
 assert.equal(f.appearance.at(-1).replyOpacity,19);assert.equal('image' in f.appearance[0],false);
 settings={...settings,wallpaperId:'second'};await f.controller.update(settings);assert.equal(f.applied.length,2);
 settings={...settings,scrim:20};await f.controller.update(settings);assert.equal(f.applied.length,3);
 f.setState({themed:false});await f.controller.update({...settings,chatOpacity:40});assert.equal(f.applied.length,4);
 await f.controller.stop();
});

test("latest disabled setting drains an in-flight connection before update resolves",async()=>{
 const f=fixture();let release;f.holdSnapshot(new Promise(resolve=>release=resolve));
 const first=f.controller.update({enabled:true,fit:"contain",scrim:12});
 await nextTask();
 const last=f.controller.update({enabled:false,fit:"cover",scrim:0});
 release();await Promise.all([first,last]);
 assert.equal(f.applied.length,0);
 assert.equal(f.controller.status.applied,false);
 assert.equal(f.controller.settings.scrim,0);
 await f.controller.stop();
});

test("an update during apply is flushed and caller mutations cannot change a queued setting",async()=>{
 const f=fixture();let release;f.holdApply(new Promise(resolve=>release=resolve));
 const settings={enabled:true,fit:"contain",scrim:12};
 const first=f.controller.update(settings);settings.fit="invalid-caller-mutation";
 await nextTask();
 const final=f.controller.update({enabled:true,fit:"cover",scrim:0});
 release();await Promise.all([first,final]);
 assert.equal(f.applied[0].fit,"contain");
 assert.equal(f.applied.at(-1).fit,"cover");
 assert.equal(f.applied.at(-1).scrim,0);
 await f.controller.stop();assert.equal(f.writes.length,1);
});

test("another owner's skin remains untouched and status never falsely claims it was restored",async()=>{
 const f=fixture();f.setState({themed:true,owner:"other-owner"});
 await f.controller.update({enabled:false});
 assert.match(f.controller.status.message,/另一个/);
 await f.controller.update({enabled:true,fit:"contain",scrim:12});
 assert.equal(f.controller.status.connected,true);
 assert.equal(f.controller.status.applied,false);
 assert.equal(f.applied.length,0);
 await f.controller.stop();assert.equal(f.writes.length,0);
});

test("a local peer that never upgrades to WebSocket has a bounded handshake",async t=>{
 const net=require("node:net"),{Cdp}=require("../../shared/host.cjs"),sockets=new Set();
 const server=net.createServer(socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 const client=new Cdp("ws://127.0.0.1:"+server.address().port+"/",{handshakeTimeout:40});
 const start=Date.now();
 await assert.rejects(client.send("Runtime.evaluate"),/handshake.*timed out/i);
 client.close();assert(Date.now()-start<3000);
});

test('wallpaper positioning and zoom survive restart and clamp invalid ranges',()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'dream-pan-')),'settings.json'),s=new DreamSkinSettings(file);
 s.update({positionX:12,positionY:73,zoom:1.4});const restored=new DreamSkinSettings(file);assert.equal(restored.get('positionX'),12);assert.equal(restored.get('positionY'),73);assert.equal(restored.get('zoom'),1.4);
 s.update({positionX:-1,positionY:999,zoom:99});assert.equal(s.get('positionX'),0);assert.equal(s.get('positionY'),100);assert.equal(s.get('zoom'),2);
 const payload=new DreamSkinThemeLoader().payload(restored.getAll());assert.equal(payload.positionX,12);assert.equal(payload.positionY,73);assert.equal(payload.zoom,1.4);
});
const TINY_JPEG=Buffer.from([0xFF,0xD8,0xFF,0xC0,0x00,0x11,0x08,0x00,0x01,0x00,0x01,0x03,0x01,0x22,0x00,0x02,0x11,0x01,0x03,0x11,0x01,0xFF,0xD9,0x00,0x00]);
test("user wallpaper directory files register as packs and reach the payload",()=>{
 const rootDir=fs.mkdtempSync(path.join(os.tmpdir(),"dream-user-")),userDir=path.join(rootDir,"walls");
 fs.mkdirSync(userDir,{recursive:true});
 fs.writeFileSync(path.join(userDir,"legacy-wall.jpg"),TINY_JPEG);
 fs.writeFileSync(path.join(userDir,"broken.jpg"),"damaged");
 const manager=new DreamSkinThemeLoader({rootDir,userDir});
 const packs=manager.listPacks(true);
 const pack=packs.find(p=>p.id==="legacy-wall");
 assert(pack&&pack.file);assert.equal(pack.width,1);assert.equal(pack.height,1);
 assert(pack.previewUrl.startsWith("file:"));
 assert(packs.find(p=>p.id==="broken")?.error);
 const payload=manager.payload({wallpaperId:"legacy-wall",scrim:0,fit:"contain"});
 assert(payload.image.startsWith("data:image/jpeg;base64,"));
 assert.equal(manager.verifyIntegrity("legacy-wall").verified,true);
});
test("legacy autoRotate fields migrate to the slideshow single source",()=>{
 assert.deepEqual(legacyRotatePatch({autoRotate:"off"}),{slideshow:false});
 assert.deepEqual(legacyRotatePatch({autoRotate:"15m"}),{slideshow:true,slideshowIntervalMinutes:15});
 assert.deepEqual(legacyRotatePatch({autoRotate:"1h"}),{slideshow:true,slideshowIntervalMinutes:60});
 assert.equal(legacyRotatePatch({autoRotate:"boot"}),null);
 assert.equal(legacyRotatePatch({}),null);
 assert.equal(legacyRotatePatch(null),null);
});

test("themePreset persists, validates known presets, and flows to payload",()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"dream-preset-")),"settings.json"),s=new DreamSkinSettings(file),loader=new DreamSkinThemeLoader();
 assert.equal(s.get("themePreset"),"violet");
 for(const preset of ["pink","ocean","onyx","violet"]){
  s.update({themePreset:preset});
  assert.equal(new DreamSkinSettings(file).get("themePreset"),preset);
  assert.equal(loader.payload(s.getAll()).themePreset,preset);
 }
 s.update({themePreset:"neon-invalid"});
 assert.equal(s.get("themePreset"),"violet");
 assert.equal(loader.payload({themePreset:"neon-invalid"}).themePreset,"violet");
});
