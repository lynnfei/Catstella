const path=require("node:path"),os=require("node:os"),{readJson,writeJson,finite,bool}=require("../../../shared/storage.cjs");
const DEFAULT_SETTINGS={x:null,y:null,scale:220,alwaysOnTop:true,reducedMotion:false,sound:false,volume:.35,soundSet:"bubble-pop",bubbleOn:true,turnCostOn:true,turnCostDurationMs:5000,clickThrough:false,hostWindowOnly:process.platform==="darwin",standaloneDesktopMode:process.platform!=="darwin",hostOffsetX:18,hostOffsetY:18,hostDock:"",easterEggs:true,ambientChatter:false,autoUpdateCheck:true,clickCatAction:"talk",characterPack:"gemini-star-v1",syncCharacter:true,syncWallpaper:true,syncInteraction:true,petDisplayMode:"both",currency:"CNY",bubblePage:"quota",manualQuota:false,manualPercent:null,manualWeeklyPercent:null,userHonorificMode:"none",customHonorific:""};
const ALLOWED_SCALES=[140,180,220,260,300],ALLOWED_SOUND_SETS=["original","wood-tap","bubble-pop","soft-spring"];
class SettingsManager{
 constructor(file=path.join(os.homedir(),".antigravity-cat-widget/settings.json")){this.filePath=file;this.data=this.sanitize(readJson(file,DEFAULT_SETTINGS));}
 sanitize(input){const s={...DEFAULT_SETTINGS,...input};for(const k of ["alwaysOnTop","reducedMotion","sound","bubbleOn","turnCostOn","clickThrough","hostWindowOnly","standaloneDesktopMode","easterEggs","ambientChatter","autoUpdateCheck","syncCharacter","syncWallpaper","syncInteraction"])s[k]=bool(s[k],DEFAULT_SETTINGS[k]);for(const k of ["hostOffsetX","hostOffsetY"])s[k]=finite(s[k],18,0,100000);s.hostDock=["left","right", ""].includes(s.hostDock)?s.hostDock:"";s.scale=finite(s.scale,220,140,360);s.volume=finite(s.volume,.35,0,1);for(const k of ["x","y"])s[k]=typeof s[k]==="number"&&Number.isFinite(s[k])?Math.round(s[k]):null;s.soundSet=ALLOWED_SOUND_SETS.includes(s.soundSet)?s.soundSet:"bubble-pop";s.turnCostDurationMs=finite(s.turnCostDurationMs,5000,0,60000);s.petDisplayMode=["both","prefer-desktop","prefer-web"].includes(s.petDisplayMode)?s.petDisplayMode:"both";s.bubblePage=["quota","webQuota","claudeGpt","today","latest","talk"].includes(s.bubblePage)?s.bubblePage:"quota";s.manualWeeklyPercent=finite(s.manualWeeklyPercent,null,0,100);s.manualQuota=bool(s.manualQuota,false);s.manualPercent=finite(s.manualPercent,null,0,100);s.clickCatAction=typeof s.clickCatAction==="string"||typeof s.clickCatAction==="boolean"?s.clickCatAction:DEFAULT_SETTINGS.clickCatAction;s.userHonorificMode=["none","zayu","custom"].includes(s.userHonorificMode)?s.userHonorificMode:"none";s.customHonorific=typeof s.customHonorific==="string"?s.customHonorific.slice(0,16):"";return s;}
 save(){writeJson(this.filePath,this.data);return true;}
 update(partial,{persist=true}={}){
  const next=this.sanitize({...this.data,...partial});
  if(persist)writeJson(this.filePath,next);
  this.data=next;
  return this.getAll();
 }
 get(k){return this.data[k];}getAll(){return{...this.data};}
}
module.exports={SettingsManager,DEFAULT_SETTINGS,ALLOWED_SCALES,ALLOWED_SOUND_SETS};
