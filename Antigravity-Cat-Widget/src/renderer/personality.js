(function(root){
 const TALK_CATEGORIES=[
  {id:"all",label:"全部分组智能轮播"},
  {id:"tsundere",label:"傲娇拌嘴"},
  {id:"coding",label:"写码吐槽"},
  {id:"care",label:"护肝叮嘱"},
  {id:"cosmos",label:"星晶幻想"},
  {id:"cheer",label:"元气打气"},
  {id:"nightOwl",label:"深夜值班"}
 ];
 const CATEGORY_LABEL=Object.fromEntries(TALK_CATEGORIES.map(item=>[item.id,item.label]));
 const formatLine=(line,{mode,name}={},values={})=>{
  const custom=mode==="custom"&&typeof name==="string"?name.trim().slice(0,16):"";
  const address=mode==="zayu"?"杂鱼君":custom;
  return (line||"").replace(/\{user(?::([^{}]+))?\}|\{(count|today|step|tools)\}/g,(token,fallback,key)=>
   key?(values[key]??token):(address||fallback||"人类"));
 };
 const cleanLines=lines=>Array.isArray(lines)?[...new Set(lines.filter(line=>typeof line==="string"&&line.trim()))]:[];
 class Personality{
  constructor(lines,random=Math.random,tags={}){
   this.lines=lines;
   this.random=random;
   this.previous=new Map();
   this.lastIdleGroup=null;
   this.shyLines=new Set(tags.shy||[]);
   this.lineGroupMap=new Map();
   this.groups=this._indexGroups(lines?.talkGroups);
  }
  _indexGroups(raw){
   if(!raw||typeof raw!=="object"||Array.isArray(raw))return[];
   const entries=[];
   for(const [key,def] of Object.entries(raw)){
    const pool=cleanLines(def?.lines);
    if(!pool.length)continue;
    const label=typeof def.label==="string"&&def.label.trim()?def.label.trim():(CATEGORY_LABEL[key]||key);
    entries.push({key,label,lines:pool});
    for(const line of pool)if(!this.lineGroupMap.has(line))this.lineGroupMap.set(line,{key,label});
   }
   return entries;
  }
  groupFor(line){
   return this.lineGroupMap.get(line)||null;
  }
  _pickFromPool(bucket,pool){
   const recent=this.previous.get(bucket)||[];
   const available=pool.filter(line=>!recent.includes(line));
   const candidates=available.length?available:pool;
   const line=candidates[Math.floor(this.random()*candidates.length)]||"哼，本喵在呢。";
   this.previous.set(bucket,[line,...recent].slice(0,Math.min(5,Math.max(0,pool.length-1))));
   return line;
  }
  sayWithMeta(state,{category="all",now=new Date()}={}){
   if(state==="idle"&&this.groups.length){
    const specific=category&&category!=="all"?this.groups.find(group=>group.key===category):null;
    if(specific){
     const text=this._pickFromPool(`idle:${specific.key}`,specific.lines);
     this.lastIdleGroup=specific.key;
     return{text,categoryKey:specific.key,categoryLabel:specific.label};
    }
    const eligible=this.groups.filter(group=>group.key!==this.lastIdleGroup);
    const basePool=eligible.length?eligible:this.groups;
    const hour=typeof now?.getHours==="function"?now.getHours():12;
    const weighted=[];
    for(const group of basePool){
     weighted.push(group);
     if((hour>=23||hour<6)&&(group.key==="nightOwl"||group.key==="care"))weighted.push(group);
    }
    const chosen=weighted[Math.floor(this.random()*weighted.length)]||this.groups[0];
    const text=this._pickFromPool(`idle:${chosen.key}`,chosen.lines);
    this.lastIdleGroup=chosen.key;
    return{text,categoryKey:chosen.key,categoryLabel:chosen.label};
   }
   const choices=cleanLines(this.lines?.[state]);
   const pool=choices.length?choices:cleanLines(this.lines?.idle);
   const text=this._pickFromPool(state,pool);
   const group=state==="idle"?this.groupFor(text):null;
   return{text,categoryKey:group?.key||null,categoryLabel:group?.label||null};
  }
  say(state,options){
   return this.sayWithMeta(state,options).text;
  }
  expressionFor(line){return this.shyLines.has(line)?"shy":null;}
 }
 Personality.TALK_CATEGORIES=TALK_CATEGORIES;
 if(typeof module==="object"&&module.exports)module.exports={Personality,formatLine,TALK_CATEGORIES};
 else {root.StarPersonality=Personality;root.CatstellaDialogue={formatLine,TALK_CATEGORIES};}
})(typeof window==="object"?window:globalThis);
