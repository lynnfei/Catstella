// Windows forward:true installs a process-wide WH_MOUSE_LL hook. Never put
// other applications' mouse input on the Electron main thread's critical path.
class MouseRouting {
 constructor({window,screen,clickThrough,dragging,onIgnored,onEntered,platform=process.platform}){
  Object.assign(this,{window,screen,clickThrough,dragging,onIgnored,onEntered,platform});this.states=new WeakMap();this.stopped=true;
 }
 setIgnored(value,coords=null){
  const w=this.window();if(!w||w.isDestroyed())return;
  value=!!value;const prev=this.states.get(w);if(prev===value)return;
  w.setIgnoreMouseEvents(value,{forward:this.platform!=='win32'});this.states.set(w,value);
  if(value){if(typeof this.onIgnored==='function')this.onIgnored(w);}
  else if(coords&&typeof this.onEntered==='function'){this.onEntered(w,coords);}
 }
 start(){if(this.platform!=='win32'||!this.stopped)return;this.stopped=false;void this.tick();}
 stop(){this.stopped=true;clearTimeout(this.timer);}
 async tick(){
  let delay=50;const w=this.window();
  try{
   if(!w||w.isDestroyed()||!w.isVisible()||this.dragging())return;
   if(this.clickThrough()){this.setIgnored(true);return;}
   const p=this.screen.getCursorScreenPoint(),b=w.getContentBounds(),x=p.x-b.x,y=p.y-b.y;
   if(x<0||y<0||x>=b.width||y>=b.height){this.setIgnored(true);this.lastPoint=null;return;}
   delay=16;
   const key=[w.id,x,y,b.width,b.height].join(':');
   if(key===this.lastPoint&&Date.now()-this.lastCheck<150)return;
   this.lastPoint=key;this.lastCheck=Date.now();
   const active=await w.webContents.executeJavaScript(`!!document.elementFromPoint(${JSON.stringify(x)},${JSON.stringify(y)})?.closest('.interactive')`);
   if(!this.stopped&&w===this.window()&&!w.isDestroyed()&&!this.dragging())this.setIgnored(this.clickThrough()||!active,{x,y});
  }catch{this.lastPoint=null;}
  finally{if(!this.stopped)this.timer=setTimeout(()=>void this.tick(),delay);}
 }
}
module.exports={MouseRouting};
