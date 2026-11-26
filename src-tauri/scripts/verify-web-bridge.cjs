const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const vm = require("node:vm");
const {spawn} = require("node:child_process");
const {detectWebCompanion} = require("../../tools/web-companion-path.cjs");

const root = path.resolve(__dirname,"../..");
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function main() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"catstella-bridge-runtime-"));
  const child = spawn(path.join(root,"src-tauri/target/release/catstella-tauri.exe"),
    ["--isolated","--no-host","--no-hotkeys","--no-transcripts","--data-dir="+dir,"--bridge-port="+port,"--exit-after-ms=20000"],
    {windowsHide:true,stdio:"ignore"});
  const exit = new Promise(resolve => child.once("exit",resolve));
  const base = "http://127.0.0.1:"+port;
  try {
    let connected = false;
    for(let i=0;i<100;i++){
      try {if((await fetch(base+"/companion/state")).ok){connected=true;break;}} catch {}
      if(child.exitCode !== null) throw Error("Tauri exited before bridge startup");
      await sleep(50);
    }
    assert(connected,"The isolated bridge must start");
    const web = detectWebCompanion({root});
    const source = fs.readFileSync(path.join(web.base,"background.js"),"utf8")
      .replace("const BRIDGE_PORTS = [3921, 3922, 3923];","const BRIDGE_PORTS = ["+port+"];")
      .replace("let preferredPort = 3921;","let preferredPort = "+port+";");
    for(const gecko of [false,true]){
      const stored = {syncWallpaper:false,autoUpdateCheck:false};
      let handler;
      const runtime = {id:"fixture",getURL:file=>"chrome-extension://fixture/"+file,
        onMessage:{addListener(fn){handler=fn;}},onInstalled:{addListener(){}}};
      const api = {runtime,storage:{local:{
        get(_keys,cb){if(gecko)return Promise.resolve({...stored});cb({...stored});},
        set(value,cb){Object.assign(stored,value);if(gecko)return Promise.resolve();cb();}
      }},tabs:{onRemoved:{addListener(){}}}};
      const worker = vm.createContext({[gecko?"browser":"chrome"]:api,console,Date,URL,AbortController,Uint8Array,btoa,
        setTimeout:(fn,ms)=>setTimeout(fn,ms).unref(),clearTimeout,
        fetch:async(url,options={})=>{
          const target = new URL(url);
          assert.equal(target.origin,base,"The extension fixture may contact only its isolated bridge");
          const headers = new Headers(options.headers);
          if(gecko)headers.set("Origin","moz-extension://fixture");
          return fetch(url,{...options,headers});
        }});
      vm.runInContext(source,worker);
      await vm.runInContext("(async()=>{while(syncInFlight)await syncInFlight})()",worker);
      runtime.sendMessage = (message, options) => {
        assert.equal(options, undefined, "Firefox Promise messages must not receive a callback as options");
        return new Promise(resolve => handler(message,{tab:{id:1}},resolve));
      };
      const contentWindow = {};
      const content = vm.createContext({window:contentWindow,console,
        ...(gecko ? {browser:api,chrome:api} : {chrome:api})});
      if(!gecko)runtime.sendMessage = (message, callback) => handler(message,{tab:{id:1}},callback);
      vm.runInContext(fs.readFileSync(path.join(web.base,"content/shim.js"),"utf8"),content);
      const result = await contentWindow.KIMINO_API.sendMessage(
        {type:"KG_TAB_HEARTBEAT",active:true,visible:true,webQuota:{dailyTotal:12,fiveHourUsedPct:17}});
      assert.equal(result?.ok,true);
      assert.equal(stored.agyBridgeState?.online,true);
      const payload = await (await fetch(base+"/companion/state")).json();
      assert.equal(payload.web.active,true);
      assert.equal(payload.web.visible,true);
      assert.equal(payload.web.quota.dailyTotal,12);
      const preflight = await fetch(base+"/companion/sync",{method:"OPTIONS",
        headers:{Origin:gecko?"moz-extension://fixture":"chrome-extension://fixture",
          "Access-Control-Request-Private-Network":"true"}});
      assert.equal(preflight.status,204);
      assert.equal(preflight.headers.get("access-control-allow-private-network"),"true");
    }
    console.log("PASS: Chromium and Firefox content shim -> background -> real Tauri bridge, including quota, focus, visibility and private-network preflight");
    assert.equal(await exit,0);
  } finally {
    if(child.exitCode === null)child.kill();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
