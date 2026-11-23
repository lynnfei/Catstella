const{contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("widgetApi",{
 get:()=>ipcRenderer.invoke("widget:get"),save:v=>ipcRenderer.invoke("widget:settings",v),
 rememberBubble:v=>ipcRenderer.send("widget:bubble-preference",v),
 ready:()=>ipcRenderer.send("widget:ready"),
/* @byok-dev-start */
 byok:(action,data)=>ipcRenderer.invoke("widget:byok",{action,data}),
/* @byok-dev-end */
 online:(action,value)=>ipcRenderer.invoke("widget:online",action,value),
 releaseNotes:()=>ipcRenderer.invoke("widget:release-notes"),
 markReleaseNotesSeen:version=>ipcRenderer.invoke("widget:release-notes-seen",version),
 canChatter:()=>ipcRenderer.invoke("widget:can-chatter"),
 command:v=>ipcRenderer.send("widget:command",v),pointer:v=>ipcRenderer.invoke("widget:pointer",v),
 drag:(phase,dx=0,dy=0)=>ipcRenderer.send("widget:drag",phase,dx,dy),
 hit:v=>ipcRenderer.send("widget:hit",v),audio:v=>ipcRenderer.invoke("widget:audio",v),
 subscribe:callback=>{const h=(_e,data)=>callback(data);ipcRenderer.on("widget:snapshot",h);return()=>ipcRenderer.removeListener("widget:snapshot",h);},
 onStep:callback=>{const h=(_e,data)=>callback(data);ipcRenderer.on("widget:step",h);return()=>ipcRenderer.removeListener("widget:step",h);},
 onReaction:callback=>{const h=(_e,data)=>callback(data);ipcRenderer.on("widget:reaction",h);return()=>ipcRenderer.removeListener("widget:reaction",h);},
 onNavigate:callback=>{const h=(_e,page)=>callback(page);ipcRenderer.on("widget:navigate",h);return()=>ipcRenderer.removeListener("widget:navigate",h);},
 onRefresh:callback=>{const h=()=>callback();ipcRenderer.on("cat:refresh",h);return()=>ipcRenderer.removeListener("cat:refresh",h);},
 onForceRepaint:callback=>{const h=()=>callback();ipcRenderer.on("widget:force-repaint",h);return()=>ipcRenderer.removeListener("widget:force-repaint",h);},
 onMouseLeft:callback=>{const h=()=>callback();ipcRenderer.on("widget:mouse-left",h);return()=>ipcRenderer.removeListener("widget:mouse-left",h);},
 onMouseEntered:callback=>{const h=(_e,coords)=>callback(coords);ipcRenderer.on("widget:mouse-entered",h);return()=>ipcRenderer.removeListener("widget:mouse-entered",h);}
});
