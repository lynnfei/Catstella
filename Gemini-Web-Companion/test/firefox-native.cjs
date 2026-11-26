const fs=require('node:fs'),net=require('node:net'),http=require('node:http'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'catstella-gecko-'));
 const ext=path.join(dir,'extension');fs.cpSync(path.resolve('dist/firefox'),ext,{recursive:true});
 const requests=[];
 const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{
  if(req.url.startsWith('/companion/')){if(body)requests.push(JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,sync:{syncCharacter:false,syncWallpaper:false,syncInteraction:false},desktop:{},web:{}}));}
  else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><title>Gemini test</title><body><main>fixture</main></body></html>');}
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const webPort=server.address().port;
 const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json')));
 manifest.host_permissions=['http://127.0.0.1/*'];
 for(const group of manifest.content_scripts)group.matches=['http://127.0.0.1/*'];
 for(const group of manifest.web_accessible_resources)group.matches=['http://127.0.0.1/*'];
 const scripts=manifest.content_scripts.find(g=>g.js.includes('content/widget.js')).js;scripts.unshift('content/native-probe.js');
 fs.writeFileSync(path.join(ext,'content/native-probe.js'),`const err=console.error;console.error=(...args)=>{document.documentElement.setAttribute('data-fixture-errors',(document.documentElement.getAttribute('data-fixture-errors')||'')+args.map(String).join(' ')+'\\n');err(...args)};window.addEventListener('error',e=>document.documentElement.setAttribute('data-fixture-error',e.message));`);
 // Instrument the genuine Gecko audio API, without replacing decoding/playback.
 fs.appendFileSync(path.join(ext,'content/native-probe.js'),';('+function () {
  const proto = window.AudioContext.prototype;
  const decode = proto.decodeAudioData;
  const create = proto.createBufferSource;
  const createGain = proto.createGain;
  let analyser;
  proto.createGain = function (...args) {
    const gain=createGain.apply(this,args);
    analyser=this.createAnalyser();analyser.fftSize=256;gain.connect(analyser);
    return gain;
  };
  let decoded = 0, lastInput = 0;
  const samples = [];
  for (const type of ['pointerdown','pointerup']) document.addEventListener(type, () => { lastInput=performance.now(); },true);
  proto.decodeAudioData = function (...args) {
    return decode.apply(this,args).then(buffer => {
      document.documentElement.setAttribute('data-audio-decoded',String(++decoded));
      return buffer;
    });
  };
  proto.createBufferSource = function (...args) {
    const node=create.apply(this,args),start=node.start;
    node.start=function (...params) {
      samples.push(performance.now()-lastInput);
      document.documentElement.setAttribute('data-audio-starts',JSON.stringify(samples));
      const requested=lastInput,until=performance.now()+1000,data=new Float32Array(256);
      const check=()=>{
        analyser.getFloatTimeDomainData(data);
        if(data.some(value=>Math.abs(value)>.005)) {
          const waves=JSON.parse(document.documentElement.getAttribute('data-audio-waves')||'[]');
          waves.push(performance.now()-requested);
          document.documentElement.setAttribute('data-audio-waves',JSON.stringify(waves));
        } else if(performance.now()<until)setTimeout(check,5);
      };
      setTimeout(check,5);
      return start.apply(this,params);
    };
    return node;
  };
 }.toString()+')();');
 fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify(manifest));
 const bgPath=path.join(ext,'background.js');fs.writeFileSync(bgPath,fs.readFileSync(bgPath,'utf8').replace('const BRIDGE_PORTS = [3921, 3922, 3923];','const BRIDGE_PORTS = ['+webPort+'];').replace('let preferredPort = 3921;','let preferredPort = '+webPort+';').replace('let nextAutoCheck = 0;','let nextAutoCheck = Infinity;').replace('autoUpdateCheck: true','autoUpdateCheck: false').replace('soundEnabled: false','soundEnabled: true'));
 const portServer=net.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));
 const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const profile=path.join(dir,'profile');fs.mkdirSync(profile);
 fs.writeFileSync(path.join(profile,'user.js'),'user_pref("marionette.port",'+port+');\nuser_pref("browser.shell.checkDefaultBrowser",false);');
 const p=spawn('C:/Program Files/Mozilla Firefox/firefox.exe',['-headless','-no-remote','-profile',profile,'--marionette'],{stdio:'ignore',windowsHide:true});
 let s;for(let i=0;i<100;i++){try{s=await new Promise((res,rej)=>{const c=net.connect(port,'127.0.0.1',()=>res(c));c.once('error',rej)});break}catch{await new Promise(r=>setTimeout(r,100))}}
 if(!s){p.kill();throw Error('No Firefox endpoint')}
 let buf=Buffer.alloc(0),seq=0,pending=new Map();
 s.on('data',d=>{buf=Buffer.concat([buf,d]);while(true){const c=buf.indexOf(58);if(c<0)return;const len=Number(buf.subarray(0,c).toString());if(buf.length<c+1+len)return;const m=JSON.parse(buf.subarray(c+1,c+1+len));buf=buf.subarray(c+1+len);if(Array.isArray(m)){const q=pending.get(m[1]);if(q){pending.delete(m[1]);m[2]?q[1](Error(JSON.stringify(m[2]))):q[0](m[3])}}}});
 const call=(method,args={})=>new Promise((res,rej)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);rej(Error('Firefox command timed out: '+method))},15000);pending.set(id,[value=>{clearTimeout(timer);res(value)},error=>{clearTimeout(timer);rej(error)}]);const t=JSON.stringify([0,id,method,args]);s.write(Buffer.byteLength(t)+':'+t)});
 const js=async script=>(await call('WebDriver:ExecuteScript',{script,args:[]})).value;
 try{
 const session=await call('WebDriver:NewSession',{capabilities:{}});console.log('Firefox',session.capabilities.browserVersion);
 await call('Addon:Install',{path:ext,temporary:true});
 await call('WebDriver:Navigate',{url:'http://127.0.0.1:'+webPort+'/app'});
 await new Promise(r=>setTimeout(r,2000));
 const status=await js(`const s=document.querySelector('#kimino-companion-root')?.shadowRoot;return {errors:document.documentElement.getAttribute('data-fixture-errors'),error:document.documentElement.getAttribute('data-fixture-error'),settings:!!s?.querySelector('.btn-open-settings')}`);
 assert.equal(status.errors,null);assert.equal(status.error,null);assert.equal(status.settings,true);
 assert.equal(requests.some(r=>r.webVisible),true,'initialized widget must send visible heartbeats');
 const click=async selector=>{
  const element=await js(`return document.querySelector('#kimino-companion-root').shadowRoot.querySelector(${JSON.stringify(selector)})`);
  await call('WebDriver:ElementClick',{id:element['element-6066-11e4-a52e-4f735466cecf']});
 };
 for(let attempt=0;attempt<50;attempt++){
  if(await js(`return document.documentElement.getAttribute('data-audio-decoded') === '2'`))break;
  await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(await js(`return document.documentElement.getAttribute('data-audio-decoded')`),'2','native Gecko must decode both extension WAV assets before input');
 await click('.kimino-character-box');
 await new Promise(r=>setTimeout(r,1000));
 const first=await js(`return {starts:JSON.parse(document.documentElement.getAttribute('data-audio-starts')||'[]'),waves:JSON.parse(document.documentElement.getAttribute('data-audio-waves')||'[]')}`);
 assert.equal(first.starts.length,2,'first isolated click must schedule both press and release');
 assert.ok(first.waves.length>0,'first single click must produce real PCM, without another click');
 console.log('First isolated click PCM latency (includes cold audio device startup, not speaker latency):',Math.min(...first.waves));
 await new Promise(r=>setTimeout(r,6000));
 await js(`document.documentElement.removeAttribute('data-audio-waves');`);
 await click('.kimino-character-box');
 await new Promise(r=>setTimeout(r,1000));
 const afterIdle=await js(`return JSON.parse(document.documentElement.getAttribute('data-audio-waves')||'[]')`);
 assert.ok(afterIdle.length>0,'idle return must produce PCM from a single click');
 assert.ok(Math.min(...afterIdle)<150,'idle return must not pay another audio device startup');
 console.log('Single click after six seconds idle, PCM latency (not speaker latency):',Math.min(...afterIdle));
 const baseline=await js(`return JSON.parse(document.documentElement.getAttribute('data-audio-starts')||'[]').length`);
 for(let i=0;i<8;i++){await click('.kimino-character-box');await new Promise(r=>setTimeout(r,25));}
 const samples=(await js(`return JSON.parse(document.documentElement.getAttribute('data-audio-starts')||'[]')`)).slice(baseline);
 assert.equal(samples.length,16,'each native press/release starts a predecoded sound');
 assert.equal(await js(`return document.documentElement.getAttribute('data-audio-decoded')`),'2','rapid taps reuse the decoded sounds');
 console.log('Audio event-to-source scheduling (not speaker latency):',JSON.stringify({samples:samples.length,maxMs:Math.max(...samples),averageMs:samples.reduce((a,b)=>a+b,0)/samples.length}));
 await click('.btn-open-settings');
 assert.equal(await js(`return getComputedStyle(document.querySelector('#kimino-companion-root').shadowRoot.querySelector('.kimino-settings')).display`),'flex');
 await click('.kg-btn-close');
 assert.equal(await js(`return document.querySelector('#kimino-companion-root').shadowRoot.querySelector('.kimino-settings').inert`),true);
 console.log('PASS: native Firefox content scripts initialize, settings respond to real clicks, visible heartbeats reach isolated bridge.');
 }finally{await call('Marionette:Quit',{flags:['eForceQuit']}).catch(()=>{});s.destroy();p.kill();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
