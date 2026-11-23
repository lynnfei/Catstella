// Real source Electron windows, disposable data, bundled offline assets only.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'catstella-window-'));
const settingsFile=path.join(directory,'settings.json');
const transcripts=['isolation-a','isolation-b'].map(session=>{
  const file=path.join(directory,'transcripts/brain',session,'.system_generated/logs/transcript_full.jsonl');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'');return file;
});
fs.writeFileSync(settingsFile,JSON.stringify({bubbleOn:true,bubblePage:'talk',turnCostOn:false,alwaysOnTop:false,autoUpdateCheck:false,
  seenReleaseNotes:[require('../package.json').version],customThemes:[{id:'old-theme',name:'旧主题',palette:'pink',opacity:64}]}));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const launch=()=>_electron.launch({executablePath:require('electron'),args:[path.join(root,'Antigravity-Cat-Widget/src/main/index.cjs'),'--isolated-dev','--test-transcripts','--data-dir='+directory],env,timeout:30000});
async function close(app){
  const child=app.process();let timer;
  try{await Promise.race([app.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('test instance close timeout')),6000);})]);}
  finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill();}
}
async function waitState(page,predicate){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
    const value=await page.evaluate(()=>widgetApi.get());
    if(predicate(value))return value;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error('Timed out waiting for native activity state');
}
async function main(){
  let app;
  const errors=[];
  try{
    app=await launch();const pet=await app.firstWindow();pet.on('pageerror',e=>errors.push(e.message));
    await pet.locator('#mascot[data-art-ready=true]').waitFor();
    const state=await pet.evaluate(()=>widgetApi.get());
    assert.equal(state.source.files,2);assert(![3921,3922,3923].includes(state.webCompanion.port));
    const append=(index,step)=>fs.appendFileSync(transcripts[index],JSON.stringify({created_at:new Date().toISOString(),source:'MODEL',type:'PLANNER_RESPONSE',...step})+'\n');
    append(0,{step_index:11,status:'RUNNING',tool_calls:[{name:'read_file'}]});
    await waitState(pet,s=>s.modelActivity?.tools?.includes('read_file'));
    append(0,{step_index:11,status:'DONE',tool_calls:[{name:'ask_question'}]});
    await waitState(pet,s=>s.modelActivity?.kind==='model-waiting');
    await pet.locator('#toggle').click();
    await pet.locator('#bubble[data-open=true]').waitFor();
    await pet.waitForFunction(()=>document.querySelector('#value').textContent.includes('11') && /确认|拿主意/.test(document.querySelector('#value').textContent));
    append(1,{step_index:200,status:'DONE',source:'USER_EXPLICIT',type:'USER_INPUT'});
    append(1,{step_index:201,status:'RUNNING',tool_calls:[{name:'edit_file'}]});
    await waitState(pet,s=>s.modelActivity?.stepIndex===201);
    const concurrent=await pet.evaluate(()=>widgetApi.get());
    assert.equal(concurrent.modelActivity?.waitingUser,false,JSON.stringify({activity:concurrent.modelActivity,source:concurrent.source}));
    append(1,{step_index:201,status:'DONE'});
    await waitState(pet,s=>s.modelActivity?.kind==='model-waiting');
    append(0,{step_index:12,status:'DONE',source:'USER_EXPLICIT',type:'USER_INPUT'});
    await waitState(pet,s=>s.modelActivity?.waitingUser!==true);
    const [settings]=await Promise.all([app.waitForEvent('window'),pet.evaluate(()=>widgetApi.command('settings'))]);
    settings.on('pageerror',e=>errors.push(e.message));
    await settings.locator('.nav-item[data-page=agy]').click();
    await settings.locator('#atelier-grid .theme-card').filter({hasText:'旧主题'}).waitFor();
    await settings.getByRole('button',{name:'深海蓝',exact:true}).click();
    await settings.locator('#atelier-opacity').fill('44');
    await settings.locator('#atelier-chat-tint').fill('#abc123');
    await settings.locator('#atelier-chat-opacity').fill('63');
    await settings.locator('#atelier-reply-opacity').fill('17');
    await waitState(pet,s=>s.dreamSkin.chatTint==='#abc123' && s.dreamSkin.chatOpacity===63 && s.dreamSkin.replyOpacity===17);
    assert.equal(await pet.locator('#mascot').evaluate(el=>el.style.getPropertyValue('--bubble-tint')),'');
    await settings.locator('#atelier-name').fill('原生窗口测试');await settings.locator('#atelier-save').click();
    await settings.locator('#atelier-grid .theme-card').filter({hasText:'原生窗口测试'}).waitFor();
    assert.equal(await settings.locator('#atelier-grid .theme-card').count(),2);
    await settings.locator('#atelier-grid .theme-card').filter({hasText:'旧主题'}).click();
    await settings.getByText('已应用主题「旧主题」').waitFor();
    assert.equal((await pet.evaluate(()=>widgetApi.get())).dreamSkin.chatTint,'#abc123');
    assert.equal((await pet.evaluate(()=>widgetApi.get())).dreamSkin.replyOpacity,17,'old themes must preserve the independent AI appearance');
    await settings.locator('#atelier-grid .theme-card').filter({hasText:'原生窗口测试'}).click();
    await settings.getByText('已应用主题「原生窗口测试」').waitFor();
    assert.equal((await pet.evaluate(()=>widgetApi.get())).dreamSkin.themePreset,'ocean');
    await settings.locator('.nav-item[data-page=store]').click();
    await settings.getByRole('button',{name:'查看壁纸包'}).click();
    const detail=settings.getByRole('dialog');
    await detail.getByRole('button',{name:'安装这项素材',exact:true}).click();
    await detail.getByRole('button',{name:'使用这项素材',exact:true}).click();
    await detail.getByRole('button',{name:'正在使用',exact:true}).waitFor();
    const applied=await pet.evaluate(()=>widgetApi.get());
    assert(applied.dreamSkin.wallpaperId.startsWith('online-'));
    const file=applied.dreamSkin.wallpaperFile;
    assert(path.resolve(file).startsWith(path.join(directory,'skin')+path.sep));
    assert(fs.existsSync(file));
    // A previous revision is updated through the same button users see.
    const manifestFile=path.join(path.dirname(file),'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile));
    manifest.revision='0'.repeat(64);fs.writeFileSync(manifestFile,JSON.stringify(manifest));
    // An external file edit needs the actual refresh entry. Opacity edits must
    // no longer force a full asset scan merely to refresh this test fixture.
    await settings.evaluate(()=>{widgetApi.command('refresh-state');return widgetApi.save({dreamSkin:{opacity:44}});});
    await detail.getByRole('button',{name:'关闭'}).click();await detail.waitFor({state:'hidden'});
    await settings.reload();await settings.getByRole('button',{name:'查看壁纸包'}).click();
    await detail.getByRole('button',{name:'更新到最新版',exact:true}).click();
    await detail.getByText('已安装 1 项，可从本地图库切换。').waitFor();
    await detail.getByRole('button',{name:'正在使用',exact:true}).waitFor();
    assert.notEqual(JSON.parse(fs.readFileSync(manifestFile)).revision,manifest.revision);
    // A prior-release manifest without a revision remains usable without a false update.
    delete manifest.revision;fs.writeFileSync(manifestFile,JSON.stringify(manifest));
    await settings.evaluate(()=>{widgetApi.command('refresh-state');return widgetApi.save({dreamSkin:{opacity:44}});});
    await detail.getByRole('button',{name:'关闭'}).click();await detail.waitFor({state:'hidden'});
    await settings.reload();
    await settings.getByRole('button',{name:'查看壁纸包'}).click();
    await detail.getByRole('button',{name:'正在使用',exact:true}).waitFor();
    // Refresh may recreate the pet's native window; settings remains the stable
    // user-facing client of the same snapshot and installation state.
    assert.equal((await settings.evaluate(()=>widgetApi.get())).wallpapers.find(w=>w.id===applied.dreamSkin.wallpaperId).revision,'');
    assert.equal(await detail.getByRole('button',{name:'更新到最新版'}).count(),0);
    await detail.getByRole('button',{name:'卸载',exact:true}).click();
    await detail.getByRole('button',{name:'确认卸载？',exact:true}).click();
    await detail.getByText('已卸载，可随时重新安装。').waitFor();
    const removed=await settings.evaluate(()=>widgetApi.get());
    assert(!removed.dreamSkin.wallpaperId.startsWith('online-'));
    assert(fs.existsSync(removed.dreamSkin.wallpaperFile));assert(!fs.existsSync(file));
    await detail.getByRole('button',{name:'关闭'}).click();await detail.waitFor({state:'hidden'});
    await settings.locator('.nav-item[data-page=agy]').click();
    const evidence=path.join(root,'evidence/2026-11-09-acceptance');fs.mkdirSync(evidence,{recursive:true});
    await settings.locator('#atelier-preview').scrollIntoViewIfNeeded();
    await settings.screenshot({path:path.join(evidence,'native-settings.png')});
    await close(app);app=null;
    app=await launch();const restarted=await app.firstWindow();
    await restarted.locator('#mascot[data-art-ready=true]').waitFor();
    const after=await restarted.evaluate(()=>widgetApi.get());
    assert.equal(after.settings.customThemes.length,2);assert.equal(after.dreamSkin.chatOpacity,63);
    assert.equal(after.dreamSkin.replyOpacity,17);
    assert.equal(after.dreamSkin.chatTint,'#abc123');assert.equal(after.dreamSkin.themePreset,'ocean');
    assert.equal(after.dreamSkin.opacity,44);
    assert.equal(await restarted.locator('#mascot').evaluate(el=>el.style.getPropertyValue('--bubble-alpha')),'');
    assert.deepEqual(errors,[]);
    console.log('PASS: native settings workshop, old theme, live pet appearance, offline store install/use/uninstall and restart persistence.');
  }finally{
    if(app)await close(app);
    try{fs.rmSync(directory,{recursive:true,force:true});}catch{console.warn('Temporary test data remains at '+directory);}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
