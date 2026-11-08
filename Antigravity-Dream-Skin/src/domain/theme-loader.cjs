const fs=require("node:fs"),path=require("node:path"),{pathToFileURL}=require("node:url");
const {createHash}=require("node:crypto");
const IMAGE_MIME={".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp"};
const DEFAULT_WALLPAPER_ID="gemini-character-sheet-v1";

// 只做轻量格式校验：按文件头解码 PNG/JPEG/WebP 的真实尺寸，返回 null 表示无效或已损坏。
// 绝不引入 SHA256 强校验——用户替换或新增壁纸不应导致崩溃白屏。
function probeImage(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<24)return null;
 if(buffer[0]===0x89&&buffer[1]===0x50&&buffer[2]===0x4e&&buffer[3]===0x47)
  return{mime:"image/png",width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
 if(buffer[0]===0xff&&buffer[1]===0xd8){
  let offset=2;
  while(offset+9<buffer.length){
   if(buffer[offset]!==0xff){offset++;continue;}
   const marker=buffer[offset+1],length=buffer.readUInt16BE(offset+2);
   if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))
    return{mime:"image/jpeg",width:buffer.readUInt16BE(offset+7),height:buffer.readUInt16BE(offset+5)};
   if(length<2)return null;
   offset+=2+length;
  }
  return null;
 }
 if(buffer.toString("latin1",0,4)==="RIFF"&&buffer.toString("latin1",8,12)==="WEBP"){
  const format=buffer.toString("latin1",12,16);
  if(format==="VP8 "&&buffer.length>=30)return{mime:"image/webp",width:buffer.readUInt16LE(26)&0x3fff,height:buffer.readUInt16LE(28)&0x3fff};
  if(format==="VP8L"&&buffer.length>=26){const bits=buffer.readUInt32LE(21);return{mime:"image/webp",width:(bits&0x3fff)+1,height:((bits>>14)&0x3fff)+1};}
  if(format==="VP8X"&&buffer.length>=30)return{mime:"image/webp",width:buffer.readUIntLE(24,3)+1,height:buffer.readUIntLE(27,3)+1};
 }
 return null;
}

// 读取单个壁纸包：目录即包，manifest.json 可选；目录内放图片即可被自动识别。
function readPack(wallpapersDir,name){
 const dir=path.join(wallpapersDir,name);
 let stat;
 try{stat=fs.statSync(dir);}catch{return null;}
 if(!stat.isDirectory())return null;
 let manifest=null;
 try{manifest=JSON.parse(fs.readFileSync(path.join(dir,"manifest.json"),"utf8"));}catch{}
 const id=typeof manifest?.id==="string"&&manifest.id.trim()?manifest.id.trim():name;
 let file=null,error=null;
 if(typeof manifest?.file==="string"&&manifest.file.trim()){
  const resolved=path.resolve(dir,manifest.file.trim());
  // 目录穿越防护：清单声明的文件必须留在壁纸包内部
  if(!resolved.startsWith(dir+path.sep))throw new Error("无效壁纸路径");
  file=resolved;
 }else{
  const images=fs.readdirSync(dir).filter(entry=>IMAGE_MIME[path.extname(entry).toLowerCase()]).sort();
  if(images.length)file=path.join(dir,images[0]);
 }
 let probe=null,digest=null;
 if(!file)error="壁纸包缺少可用图片";
 else{
  try{
   const bytes=fs.readFileSync(file);
   probe=probeImage(bytes);
   if(probe)digest=createHash("sha256").update(bytes).digest("hex");
   if(!probe)error="壁纸图片格式无效或已损坏";
  }catch{error="壁纸图片无法读取";}
 }
 if(!probe)file=null;
 return{
  id,
  name:typeof manifest?.name==="string"&&manifest.name.trim()?manifest.name.trim():id,
  pack:manifest?.pack && /^[a-z][a-z0-9-]{0,47}$/.test(manifest.pack.id||"") &&
   typeof manifest.pack.name==="string"&&manifest.pack.name.length>0&&manifest.pack.name.length<=80
   ? {id:manifest.pack.id,name:manifest.pack.name,position:Number.isSafeInteger(manifest.pack.position)?manifest.pack.position:0} : undefined,
  file,
  width:probe?.width??null,
  height:probe?.height??null,
  mime:probe?.mime??"image/png",
  digest,
  background:typeof manifest?.background==="string"?manifest.background:null,
  revision:typeof manifest?.revision==="string"?manifest.revision:null,
  defaultFit:["cover","contain","adaptive"].includes(manifest?.defaultFit)?manifest.defaultFit:"adaptive",
  previewUrl:file?path.relative(path.join(__dirname,"../renderer"),file).split(path.sep).join("/"):null,
  error
 };
}

// 用户目录里的散装图片：每张图就是一个壁纸包（上游数据目录壁纸的兼容形态）。
function readFlatPack(file){
 let probe=null,digest=null;
 try{const bytes=fs.readFileSync(file);probe=probeImage(bytes);if(probe)digest=createHash("sha256").update(bytes).digest("hex");}catch{}
 const id=path.basename(file).replace(/\.[^.]+$/,"");
 return{
  id,name:id,
  file:probe?file:null,
  width:probe?.width??null,height:probe?.height??null,digest,
  mime:probe?.mime??"image/png",
  background:null,defaultFit:"adaptive",
  previewUrl:probe?pathToFileURL(file).href:null,
  error:probe?null:"壁纸图片格式无效或已损坏"
 };
}

class WallpaperManager{
 constructor(options={}){
  this.rootDir=options.rootDir||path.resolve(__dirname,"../..");
  this.wallpapersDir=options.wallpapersDir||path.join(this.rootDir,"assets/wallpapers");
  // 用户壁纸目录（如 数据目录/wallpapers）：散图即包，子目录按完整壁纸包解析。
  this.userDir=options.userDir||null;
  this.defaultId=options.defaultId||DEFAULT_WALLPAPER_ID;
 }
 scanRoot(root){
  let names=[];
  try{names=fs.readdirSync(root).sort();}catch{return[];}
  const packs=[];
  for(const name of names){
   const full=path.join(root,name);
   let stat;
   try{stat=fs.statSync(full);}catch{continue;}
   if(stat.isDirectory()){
    try{const pack=readPack(root,name);if(pack)packs.push(pack);}
    catch(error){packs.push({id:name,name,file:null,width:null,height:null,mime:"image/png",previewUrl:null,error:error.message});}
   }else if(IMAGE_MIME[path.extname(name).toLowerCase()])packs.push(readFlatPack(full));
  }
  return packs;
 }
 // 动态扫描仓库 assets/wallpapers/ 与用户壁纸目录下的全部壁纸包；损坏的包记录 error 而不是抛出。
 // 不做结果缓存：新放入的文件夹即刻可被识别，覆盖/修复图片也立即生效。
 listPacks(){
  const bundled=this.scanRoot(this.wallpapersDir);
  const defaultIndex=bundled.findIndex(pack=>pack.id===this.defaultId);
  if(defaultIndex>0)bundled.unshift(...bundled.splice(defaultIndex,1));
  const byDigest=new Map(bundled.filter(pack=>pack.digest).map(pack=>[pack.digest,pack]));
  for(const userPack of this.userDir?this.scanRoot(this.userDir):[]){
   const duplicate=userPack.digest&&byDigest.get(userPack.digest);
   if(duplicate){
    (duplicate.aliases??=[]).push(userPack.id);
    (duplicate.aliasFiles??=[]).push(userPack.file);
   }else bundled.push(userPack);
  }
  return bundled;
 }
 usablePacks(){return this.listPacks().filter(pack=>pack.file&&pack.width);}
 // 用户选择 → 默认包 → 首个可用包；单个包损坏时静默回退，绝不崩溃。
 resolve(wallpaperId){
  const packs=this.usablePacks();
  const wanted=(typeof wallpaperId==="string"&&packs.find(pack=>pack.id===wallpaperId||pack.aliases?.includes(wallpaperId)))||packs.find(pack=>pack.id===this.defaultId)||packs[0];
  if(!wanted){
   const broken=this.listPacks().find(pack=>pack.error);
   throw new Error(broken?`壁纸包不可用：${broken.error}`:"未找到可用壁纸包，请检查 assets/wallpapers 目录");
  }
  return wanted;
 }
 orderedIds(){return this.usablePacks().map(pack=>pack.id);}
 // 轮转用：按扫描顺序取下一个可用壁纸包。
 nextId(currentId){
  const packs=this.usablePacks();
  if(packs.length<2)return packs[0]?.id||null;
  const index=packs.findIndex(pack=>pack.id===currentId||pack.aliases?.includes(currentId));
  return packs[(index+1)%packs.length].id;
 }
 // 兼容旧调用：校验当前壁纸并返回带实测尺寸的包信息（仅格式与可读性校验，无 SHA256）。
 verifyIntegrity(wallpaperId){return{...this.resolve(wallpaperId),verified:true};}
 payload(settings={}){
  let pack,buffer;
  try{pack=this.resolve(settings.wallpaperId);buffer=fs.readFileSync(pack.file);}
  catch(error){pack=this.resolve(settings.wallpaperId);buffer=fs.readFileSync(pack.file);}
  return{
   version:2,themePreset:["violet","pink","ocean","onyx"].includes(settings.themePreset)?settings.themePreset:"violet",
   outputMode:settings.outputMode==="glass"?"glass":"transparent",
   positionX:Math.max(0,Math.min(100,settings.positionX??50)),
   positionY:Math.max(0,Math.min(100,settings.positionY??50)),
   zoom:Math.max(1,Math.min(2,settings.zoom??1)),
   opacity:Math.max(0,Math.min(100,settings.opacity??55))/100,
   transition:settings.transition==="none"?"none":"fade",fit:["cover","contain","adaptive"].includes(settings.fit)?settings.fit:"adaptive",
   scrim:Math.max(0,Math.min(60,settings.scrim??12))/100,
   image:"data:"+pack.mime+";base64,"+buffer.toString("base64")
  };
 }
}
module.exports={WallpaperManager,DreamSkinThemeLoader:WallpaperManager,DEFAULT_WALLPAPER_ID,probeImage};
