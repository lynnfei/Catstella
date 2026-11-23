// Manual Windows A/B fixture: four marked one-pixel moves, no clicks or keys.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process'),{_electron}=require('playwright');
const root=path.resolve(__dirname,'..'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 if(process.platform!=='win32')return;
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'catstella-mouse-bench-'));let observer,app;
 try{
  const exe=path.join(dir,'MouseLatencyProbe.exe');
  execFileSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:exe','/out:'+exe,path.join(root,'tools/MouseLatencyProbe.cs')]);
  observer=spawn(exe,[],{windowsHide:true,stdio:['pipe','pipe','inherit']});let lines=[],waiters=[],buffer='';
  observer.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(waiters.length)waiters.shift()(line);else lines.push(line);}});
  const next=()=>new Promise((resolve,reject)=>{let timer;const done=line=>{clearTimeout(timer);resolve(line);};if(lines.length)return done(lines.shift());waiters.push(done);timer=setTimeout(()=>reject(Error('probe timeout')),6000);});
  if(await next()!=='ready')throw Error('Probe not ready');
  const bootstrap=path.join(dir,'main.cjs');
  fs.writeFileSync(bootstrap,"const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{global.fixture=new BrowserWindow({width:220,height:220,show:false,transparent:true,frame:false});fixture.loadURL('data:text/html,<body>fixture</body>');});");
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),args:[bootstrap],env});await app.firstWindow();const results=[];
  for(const forward of [true,false]){
   await app.evaluate((_,value)=>global.fixture.setIgnoreMouseEvents(true,{forward:value}),forward);
   observer.stdin.write('probe\n');const idle=JSON.parse(await next());
   await app.evaluate(()=>{setTimeout(()=>{const until=Date.now()+250;while(Date.now()<until){}},30);});
   await sleep(65);observer.stdin.write('probe\n');const busy=JSON.parse(await next());
   results.push({forward,idleMs:idle.delayMs,busyMs:busy.delayMs});
  }
  const result={checkedAt:new Date().toISOString(),loadMs:250,results,improved:results[1].busyMs<results[0].busyMs/2};
  fs.writeFileSync(path.join(root,'evidence/mouse-hook-ab-2026-11-10.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{
  if(app)await app.close();if(observer){observer.stdin.end('quit\n');await sleep(100);if(observer.exitCode===null)observer.kill();}
  fs.rmSync(dir,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});
