// Inspect actual Win32 flags, rather than trusting BrowserWindow's options.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{_electron}=require('playwright');
const root=path.resolve(__dirname,'..');
function nativeFlags(info){
 assert(/^\d+$/.test(info.handle));assert(Number.isSafeInteger(info.pid)&&info.pid>0);
 const ps=`Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CatstellaResidency {
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetLong(IntPtr h,int index);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
}
'@
$window=[IntPtr][Int64]${info.handle}
$actual=[uint32]0
[void][CatstellaResidency]::GetWindowThreadProcessId($window,[ref]$actual)
if($actual -ne ${info.pid}){throw 'Window belongs to another process'}
$style=[CatstellaResidency]::GetLong($window,-20).ToInt64()
@{toolWindow=($style -band 0x80) -ne 0;appWindow=($style -band 0x40000) -ne 0;transparent=($style -band 0x20) -ne 0} | ConvertTo-Json -Compress`;
 return {...info,...JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{encoding:'utf8',windowsHide:true,timeout:15000}))};
}
async function main(){
 if(process.platform!=='win32'){console.log('Windows tray-window flags: not applicable on this platform.');return;}
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'catstella-window-'));
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({hostWindowOnly:false,standaloneDesktopMode:true,petDisplayMode:'both',alwaysOnTop:false,autoUpdateCheck:false,seenReleaseNotes:[require('../package.json').version]}));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'Antigravity-Cat-Widget/src/main/index.cjs'),'--isolated-dev','--data-dir='+dir],env,timeout:30000});
  const pet=await app.firstWindow();await pet.locator('#mascot[data-art-ready=true]').waitFor();
  const inspect=async label=>{
   const info=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()&&w.webContents.getURL().includes('/renderer/index.html'));return {pid:process.pid,handle:w.getNativeWindowHandle().readBigUInt64LE().toString(),focusable:w.isFocusable()};});
   const state={label,...nativeFlags(info)};
   assert.equal(state.toolWindow,true,label+': pet must remain excluded from Windows taskbar/Alt-Tab');
   assert.equal(state.appWindow,false);assert.equal(state.focusable,true,'hiding the taskbar entry must preserve interaction');
   return state;
  };
  const checks=[await inspect('startup')];
  await app.evaluate(({BrowserWindow,screen})=>{
   global.savedCursor=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>global.fixtureCursor||{x:-99999,y:-99999};
   global.mouseCalls=[];const w=BrowserWindow.getAllWindows()[0],set=w.setIgnoreMouseEvents.bind(w);
   w.setIgnoreMouseEvents=(ignored,options)=>{if(options?.forward)throw Error('Global forwarding must never be enabled');mouseCalls.push({ignored,forward:options?.forward});return set(ignored,options);};
  });
  await pet.waitForTimeout(120);
  assert.equal((await inspect('cursor outside')).transparent,true);
  const target=await pet.locator('#motion').evaluate(n=>{const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
  await app.evaluate(({BrowserWindow},p)=>{const b=BrowserWindow.getAllWindows()[0].getContentBounds();global.fixtureCursor={x:b.x+p.x,y:b.y+p.y};},target);
  await pet.waitForTimeout(220);
  assert.equal((await inspect('cursor over pet')).transparent,false,'polling must restore hit testing without forwarded moves');
  await pet.evaluate(()=>widgetApi.drag('start'));
  await app.evaluate(()=>{global.fixtureCursor={x:-99999,y:-99999};});await pet.waitForTimeout(100);
  assert.equal((await inspect('pointer capture')).transparent,false,'polling cannot release an active drag');
  await pet.evaluate(()=>widgetApi.drag('cancel'));await pet.waitForTimeout(120);
  assert.equal((await inspect('drag ended')).transparent,true);
  await app.evaluate(({screen})=>{screen.getCursorScreenPoint=global.savedCursor;});
  await pet.evaluate(()=>widgetApi.save({hostWindowOnly:true}));await pet.waitForTimeout(1200);
  checks.push(await inspect('native host following'));
  await pet.evaluate(()=>widgetApi.save({hostWindowOnly:false}));await pet.waitForTimeout(1200);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.hide();w.showInactive();w.setAlwaysOnTop(true);w.setAlwaysOnTop(false);});
  const opened=app.waitForEvent('window');await pet.evaluate(()=>widgetApi.command('settings'));const settings=await opened;
  await settings.waitForLoadState('domcontentloaded');const closed=settings.waitForEvent('close');await settings.evaluate(()=>widgetApi.command('settings-close'));await closed;
  checks.push(await inspect('standalone, reshow, z-order and settings close'));
  fs.writeFileSync(path.join(root,'evidence/tray-window-2026-11-09.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,passed:true},null,2));
  console.log('PASS: Windows tray flags and hook-free cursor enter/leave, drag capture, following and settings close.');
 }finally{
  if(app){const child=app.process();let timer;try{await Promise.race([app.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('test app close timeout')),6000);})]);}finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill();}}
  fs.rmSync(dir,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
