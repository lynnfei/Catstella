const {EventEmitter}=require("node:events"),{spawn}=require("node:child_process"),path=require("node:path"),fs=require('node:fs'),crypto=require('node:crypto');
function nativeHelperPath(){
 const dir=path.join(__dirname,'../native');
 if(process.platform==='darwin'){
  const bin=path.join(dir,'ForegroundHost-mac');
  if(!fs.existsSync(bin)){
   const src=path.join(dir,'ForegroundHost-mac.swift');
   if(fs.existsSync(src)){
    try{require('node:child_process').execFileSync('swiftc',['-O',src,'-o',bin],{stdio:'ignore'});}catch{}
   }
  }
  return bin;
 }
 try{const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'ForegroundHost.cs'))).digest('hex').slice(0,12);const versioned=path.join(dir,'ForegroundHost.'+hash+'.exe');if(fs.existsSync(versioned))return versioned;}catch{}
 return path.join(dir,'ForegroundHost.exe'); // Installers compile this canonical file from the same source.
}
function validBounds(value){return value&&["x","y","width","height"].every(key=>Number.isSafeInteger(value[key])&&Math.abs(value[key])<100000)&&value.width>0&&value.height>0;}
function widgetLayout(area,preferredScale){
 // The artwork occupies a square. Reserve room above it for the bubble, its tail, and its shadow.
 const scale=Math.max(1,Math.floor(Math.min(preferredScale,area.width-80,area.height-245)));
 const width=Math.min(area.width,Math.max(360,scale+80));
 const height=Math.min(area.height,scale+384);
 return{scale,width,height};
}
function characterPlacement(area,size,dimensions,left,top){
 const gap=(dimensions.width-size)/2;
 const visualX=Math.max(area.x,Math.min(area.x+area.width-size,left));
 const x=Math.round(Math.max(area.x,Math.min(area.x+area.width-dimensions.width,visualX-gap)));
 const y=Math.round(Math.max(area.y,Math.min(area.y+area.height-dimensions.height,top)));
 return{bounds:{...dimensions,x,y},artShift:visualX-x-gap,visualX};
}
function hostPlacement(state,scale,offsetX=18,offsetY=18,dock=""){
 if(!["host","self"].includes(state.kind)||!validBounds(state.bounds))return null;
 const area=state.bounds;
 const {scale:effectiveScale,width,height}=widgetLayout(area,scale);
 if(effectiveScale<140||area.width<360)return null;
 return{scale:effectiveScale,...characterPlacement(area,effectiveScale,{width,height},dock==="left"?area.x:dock==="right"?area.x+area.width-effectiveScale:area.x+area.width-effectiveScale-offsetX,area.y+area.height-height-offsetY)};
}
function placeDraggedWidget(area,preferredScale,left,top,{following=false,snap=false}={}){
 const {scale,width,height}=widgetLayout(area,preferredScale);
 const gap=following?0:(width-scale)/2;
 const first=area.x+gap,right=area.x+area.width-scale-gap,bottom=area.y+area.height-height;
 const side=snap?(left<=first+20?"left":left>=right-20?"right":""):"";
 const placement=characterPlacement(area,scale,{width,height},
  side==="left"?first:side==="right"?right:Math.max(first,Math.min(right,left)),snap&&top>=bottom-20?bottom:top);
 return {...placement,scale,side,hostOffsetX:Math.round(right-placement.visualX),hostOffsetY:bottom-placement.bounds.y};
}
function facingAt(centerX,area,previous="right",deadZone=12){
 const offset=centerX-(area.x+area.width/2);
 return offset < -deadZone ? "left" : offset > deadZone ? "right" : previous;
}
class ForegroundMonitor extends EventEmitter{
 constructor(){super();this.state={kind:"unknown",bounds:null};this.lastReport=0;}
 start(handle){
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
   // Linux falls back to pure desktop pet mode.
   return;
  }
  if(this.child&&Date.now()-this.lastReport>5000)this.stop();
  if(this.child)return;
  this.lastReport=Date.now();
  const helper=nativeHelperPath();
  if(!fs.existsSync(helper))return;
  const child=spawn(helper,[String(process.pid),...(handle?[handle.readBigUInt64LE().toString()]:[])],{windowsHide:true,stdio:["pipe","pipe","ignore"]});this.child=child;this.bound=!!handle;
  let pending="";
  child.stdout.on("data",chunk=>{
   if(this.child!==child)return;
   this.lastReport=Date.now();pending+=chunk.toString();let index;
   while((index=pending.indexOf("\n"))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);try{const state=JSON.parse(line);if(["host","self","other","unknown"].includes(state.kind)&&(!state.bounds||validBounds(state.bounds))){this.state=state;this.emit("change",state);}}catch{}}
   if(pending.length>8192)pending="";
  });
  const ended=()=>{if(this.child!==child)return;this.child=null;this.state={kind:"unknown",bounds:null};this.emit("change",this.state);};
  child.on("error",ended);child.on("exit",ended);
 }
 stop(){const child=this.child;this.child=null;if(child&&!this.bound){child.kill();return;}if(child){child.stdin.end("detach\n");const timer=setTimeout(()=>child.kill(),1000);timer.unref();}this.state={kind:"unknown",bounds:null};}
}
module.exports={ForegroundMonitor,hostPlacement,validBounds,characterPlacement,widgetLayout,placeDraggedWidget,facingAt};
