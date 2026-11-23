const os=require("node:os"),path=require("node:path"),{readJson,writeJson,finite,bool}=require("../../../shared/storage.cjs");
const THEME_PRESETS=["violet","pink","ocean","onyx"];const DEFAULT_SETTINGS={enabled:false,themePreset:"violet",outputMode:"transparent",chatTint:"",chatOpacity:null,replyOpacity:null,positionX:50,positionY:50,zoom:1,fit:"adaptive",scrim:12,opacity:55,wallpaperId:"gemini-character-sheet-v1",wallpaperFile:"",slideshow:true,slideshowIntervalMinutes:5,uiLanguage:"en",transition:"fade",protectEditor:true,protectTerminal:true};
class DreamSkinSettings{
 constructor(file=path.join(os.homedir(),".antigravity-dream-skin/settings.json")){this.filePath=file;this.data=this.sanitize(readJson(file,DEFAULT_SETTINGS));}
 // 先合并入参、再逐项校验已知字段、保留未污染的扩展字段——绝不丢弃合法配置（含 autoRotate 等旧字段）。
 sanitize(v){const s={...DEFAULT_SETTINGS,...(v&&typeof v==="object"&&!Array.isArray(v)?v:{})};s.themePreset=THEME_PRESETS.includes(v?.themePreset)?v.themePreset:"violet";s.outputMode=v?.outputMode==="glass"?"glass":"transparent";s.enabled=bool(v?.enabled,false);s.positionX=finite(v?.positionX,50,0,100);s.positionY=finite(v?.positionY,50,0,100);s.zoom=finite(v?.zoom,1,1,2);s.fit=["cover","contain","adaptive"].includes(v?.fit)?v.fit:"adaptive";s.scrim=finite(v?.scrim,12,0,60);s.opacity=finite(v?.opacity,55,0,100);s.wallpaperId=typeof v?.wallpaperId==="string"&&v.wallpaperId.trim()?v.wallpaperId:DEFAULT_SETTINGS.wallpaperId;s.wallpaperFile=typeof v?.wallpaperFile==="string"?v.wallpaperFile:"";s.slideshow=bool(v?.slideshow,true);s.slideshowIntervalMinutes=finite(v?.slideshowIntervalMinutes,5,1,60);s.uiLanguage=["en","zh-CN"].includes(v?.uiLanguage)?v.uiLanguage:"en";s.transition=v?.transition==="none"?"none":"fade";s.chatTint=/^#[0-9a-f]{6}$/i.test(s.chatTint||"")?s.chatTint.toLowerCase():"";s.chatOpacity=typeof s.chatOpacity==="number"&&Number.isFinite(s.chatOpacity)?finite(s.chatOpacity,76,0,100):null;s.replyOpacity=typeof s.replyOpacity==="number"&&Number.isFinite(s.replyOpacity)?finite(s.replyOpacity,0,0,100):null;s.protectEditor=true;s.protectTerminal=true;return s;}
 update(v){const next=this.sanitize({...this.data,...v});writeJson(this.filePath,next);this.data=next;return this.getAll();}
 get(k){return this.data[k];}getAll(){return{...this.data};}
}
// 旧版兼容：autoRotate(off|15m|1h) → slideshow+slideshowIntervalMinutes 单一真源；boot 无法精确映射，交由默认轮播。
function legacyRotatePatch(data){
 if(!data||typeof data.autoRotate!=="string")return null;
 if(data.autoRotate==="off")return{slideshow:false};
 if(data.autoRotate==="15m")return{slideshow:true,slideshowIntervalMinutes:15};
 if(data.autoRotate==="1h")return{slideshow:true,slideshowIntervalMinutes:60};
 return null;
}
module.exports={DreamSkinSettings,DEFAULT_SETTINGS,THEME_PRESETS,legacyRotatePatch};
