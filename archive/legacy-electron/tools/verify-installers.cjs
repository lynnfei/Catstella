const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {_electron}=require('playwright');
const {detectWebCompanion}=require('./web-companion-path.cjs');
const {checksumLine}=require('./release-checksums.cjs');
const root=path.resolve(__dirname,'..'),version=process.env.CATSTELLA_BUILD_VERSION||require('../package.json').version;
const installerDir=path.resolve(process.env.CATSTELLA_INSTALLER_OUT||path.join(root,'dist/installers'));
const testRoot=fs.mkdtempSync(path.join(root,'dist','安装验证-')),checks=[];
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;

function legacyLogFixture(){
 const appId=fs.readFileSync(path.join(__dirname,'installer/star-suite.iss'),'utf8').match(/^#define AppId "([^"\r\n]+)"/m)[1];
 const fixture=path.join(testRoot,'legacy-log-fixture.iss');
 fs.writeFileSync(fixture,[
  '[Setup]','AppId='+appId,'AppName=Catstella','AppVersion='+version,
  'DefaultDirName={localappdata}\\CatstellaLegacyTest','PrivilegesRequired=lowest',
  'OutputDir='+testRoot,'OutputBaseFilename=legacy-log-fixture',
  '[Dirs]','Name: "{app}"',
  '[UninstallDelete]','Type: filesandordirs; Name: "{app}"'
 ].join('\r\n'));
 execFileSync(path.join(__dirname,'vendor/InnoSetup/ISCC.exe'),[fixture],{env,timeout:60000});
 return path.join(testRoot,'legacy-log-fixture.exe');
}

(async()=>{
 for(const [kind,name,exe] of [['Suite','Catstella','StarSuite.exe']]){
  const setup=path.join(installerDir,name+'-Setup-'+version+'-x64.exe'),dir=path.join(testRoot,kind);
  const checksum=await checksumLine(setup);
  assert.equal(fs.readFileSync(setup+'.sha256','ascii'),checksum,'Installer checksum must match the tested EXE');
  const installArgs=['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/DIR='+dir,'/COMPONENTS=core,webext','/TASKS='];
  const legacy=process.env.CATSTELLA_LEGACY_INSTALLER||(process.argv.includes('--verify-legacy-log')?legacyLogFixture():null);
  const userFile=path.join(dir,'user-files','keep.txt'),userData='User-owned data; preserve on uninstall.\n';
  fs.mkdirSync(path.dirname(userFile),{recursive:true});
  fs.writeFileSync(userFile,userData);
  const debugLog=path.join(dir,'debug.log');
  if(legacy){
   assert.notEqual(path.resolve(legacy),setup,'Use a separate copy of the old installer');
   execFileSync(path.resolve(legacy),[...installArgs,'/LOG='+path.join(testRoot,'legacy-install.log')],{env,timeout:300000});
   fs.writeFileSync(debugLog,userData);
  }
  // Inno 静默沙箱安装：全组件 + 无任务（自启动/联动标志不写入测试机）。
  execFileSync(setup,[...installArgs,'/LOG='+path.join(testRoot,'install.log')],{env,timeout:300000});
  assert(fs.existsSync(path.join(dir,exe)));assert.equal(fs.readFileSync(path.join(dir,'.starsuite-install'),'utf8').trim(),kind);
  assert(fs.existsSync(path.join(dir,'LICENSES.chromium.html')));assert(fs.existsSync(path.join(dir,'resources/app/NOTICE.md')));
  assert(fs.existsSync(path.join(dir,'resources/app/Antigravity-Cat-Widget/src/main/index.cjs')));
  assert(fs.existsSync(path.join(dir,'resources/app/Antigravity-Dream-Skin/src/domain/host-controller.cjs')));
  assert(fs.existsSync(path.join(dir,'resources/app/Antigravity-Dream-Skin/src/host/theme.cjs')));
  assert(!fs.existsSync(path.join(dir,'resources/app/Antigravity-Dream-Skin/src/main')),'Legacy Dream Skin main process must not ship');
  assert(!fs.existsSync(path.join(dir,'resources/app/Antigravity-Dream-Skin/src/renderer')),'Legacy Dream Skin control window must not ship');
  assert(!fs.existsSync(path.join(dir,'locales')),'Chromium locale packs must not ship');
  assert(!fs.existsSync(path.join(dir,'GeneratedVersion.cs')),'Build-only version source must not ship');
  assert(!fs.existsSync(path.join(dir,'IconSwap.exe')),'Build-only icon helper must not ship');
  assert(fs.existsSync(path.join(dir,'icons/launch.ico')));assert(fs.existsSync(path.join(dir,'icons/settings.ico')));assert(fs.existsSync(path.join(dir,'icons/uninstall.ico')));
  assert(fs.existsSync(path.join(dir,'web-extension/web-plugin-guide.html')));
  const web=detectWebCompanion();
  assert(web,'Verification requires the Web build used to package the installer');
  const archives=['kimino-gemini-companion-edge-chrome.zip','kimino-gemini-companion.xpi'];
  const webChecksums=[];
  for(const archive of archives){
   const line=await checksumLine(path.join(web.dist,archive));
   webChecksums.push(line);
   assert.equal(await checksumLine(path.join(dir,'web-extension',archive)),line,'Bundled Web archive must match the source build');
  }
  assert.equal(fs.readFileSync(path.join(web.dist,'SHA256SUMS.txt'),'ascii'),webChecksums.join(''));
  assert(!fs.existsSync(path.join(dir,'resources/app/Gemini-Web-Companion')));
  const appDir=path.join(dir,'resources/app');
  const appMetadata=JSON.parse(fs.readFileSync(path.join(appDir,'package.json'),'utf8'));
  assert.equal(appMetadata.version,version);
  assert.equal(appMetadata.byokDevelopment,false);
  assert(!fs.existsSync(path.join(appDir,'shared/gateway')),'The release must exclude the experimental gateway');
  assert(!fs.existsSync(path.join(appDir,'Antigravity-Dream-Skin/src/host/byok-portal.cjs')));
  assert(!fs.readdirSync(path.join(dir,'resources/app/Antigravity-Cat-Widget/src/native')).some(file=>/^ForegroundHost\.[0-9a-f]{12}\.exe$/i.test(file)), 'Development helper caches must not ship');
  assert(!fs.existsSync(path.join(dir,'node_modules')));checks.push(kind+': Inno silent install in non-ASCII directory; licenses, both suite projects, expression icons and webext component');
  execFileSync(path.join(dir,'StartupSettings.exe'),['--self-test'],{env,timeout:15000,windowsHide:true,encoding:'utf8'});
  checks.push(kind+': autostart/link flags, host transition decision, and temporary registry cleanup');
  const profile=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'catstella-window-'));
  const app=await _electron.launch({executablePath:path.join(dir,exe),args:['--isolated-dev','--data-dir='+profile],env,timeout:30000});
  try{
   const page=await app.firstWindow();await page.waitForFunction(()=>window.widgetApi,{},{timeout:20000});
   const state=await page.evaluate(async()=>await window.widgetApi.get());assert(state.settings);assert(state.dreamSkin);assert(Array.isArray(state.wallpapers));
   assert.equal(state.byok.available,false);
   assert.equal(await page.evaluate(()=>typeof window.widgetApi.byok),'undefined');
   await page.screenshot({path:path.join(root,'evidence','installer-'+kind+'.png')});checks.push(kind+': installed EXE opens unified renderer without Node or source workspace');
  }finally{
   await app.close();
   // playwright 的 close() 可能只断开连接留下孤儿进程锁住安装目录；按测试 data-dir 精准清理（不触碰真实实例）。
   await new Promise(r=>setTimeout(r,2000));
   execFileSync('powershell.exe',['-NoProfile','-Command',"Get-CimInstance Win32_Process -Filter \"Name='StarSuite.exe'\" | Where-Object { $_.ExecutablePath -eq $env:CATSTELLA_TEST_EXE } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],{env:{...env,CATSTELLA_TEST_EXE:path.join(dir,exe)},timeout:30000});
   await new Promise(r=>setTimeout(r,1500));
  }
  if(!legacy&&!fs.existsSync(debugLog))fs.writeFileSync(debugLog,'[1105/203818.939:WARNING:ui\\base\\resource\\resource_bundle.cc:528] locale_file_path.empty() for locale \r\n');
  // Inno may relaunch the uninstaller from a temporary directory.
  execFileSync(path.join(dir,'unins000.exe'),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LOG='+path.join(testRoot,'uninstall.log')],{env,timeout:120000});
  for(let i=0;i<45&&fs.existsSync(path.join(dir,'unins000.exe'));i++)await new Promise(r=>setTimeout(r,1000));
  for(const entry of [exe,'unins000.exe','.starsuite-install','resources','web-extension'])assert(!fs.existsSync(path.join(dir,entry)),`Uninstall left behind ${entry}`);
  assert.equal(fs.readFileSync(userFile,'utf8'),userData,'Uninstall must preserve pre-existing files');
  if(legacy)assert(fs.readFileSync(debugLog,'utf8').startsWith(userData),'Upgrade/uninstall must preserve a pre-existing debug.log');
  else assert(!fs.existsSync(debugLog),'Uninstall must remove the Chromium-only locale warning log');
  assert.equal(await checksumLine(setup),checksum,'Tested installer must not change during verification');
  checks.push(kind+': uninstall preserves user files'+(legacy?' after upgrading the prerelease installer':' and removes the Chromium-only warning log'));
 }
 const report={checkedAt:new Date().toISOString(),version,result:'pass',checks,secondComputerVerified:false};
 fs.writeFileSync(path.join(root,'evidence/installer-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
