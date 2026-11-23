// Native software-rendered settings: measure frames while the animation runs.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const variants={baseline:'.card{backdrop-filter:blur(12px)}',final:'',layer:'.page.active{will-change:transform,opacity;backface-visibility:hidden}.page{contain:layout style}',noblur:'.card{backdrop-filter:none}',sharedblur:'.settings-shell{backdrop-filter:blur(12px)}.card{backdrop-filter:none}'};
async function run(variant){
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'catstella-window-'));
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({alwaysOnTop:false,autoUpdateCheck:false,seenReleaseNotes:['0.6.1']}));
 const app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'Antigravity-Cat-Widget/src/main/index.cjs'),'--isolated-dev','--data-dir='+dir],env});
 try{
  const pet=await app.firstWindow();await pet.locator('#mascot[data-art-ready=true]').waitFor();
  const opened=app.waitForEvent('window');await pet.evaluate(()=>widgetApi.command('settings'));const page=await opened;
  await page.getByRole('heading',{name:'常用设置',exact:true}).waitFor();
  if(variants[variant])await page.addStyleTag({content:variants[variant]});
  await page.waitForTimeout(500);
  const result=await page.evaluate(async()=>{
   const sample=async(action,duration=480)=>{
    const times=[],active=[],t=performance.now();let previous=t;action();
    await new Promise(resolve=>{function frame(){const now=performance.now(),delta=now-previous;times.push(delta);if(now-t<=260)active.push(delta);previous=now;if(now-t<duration)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
    const sorted=[...times].sort((a,b)=>a-b),sortedActive=active.sort((a,b)=>a-b);return{frames:times.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...times),over25:times.filter(v=>v>25).length,first:times[0],activeP95:sortedActive[Math.floor(sortedActive.length*.95)]};
   };
   const categories=[];for(let round=0;round<2;round++)for(const name of ['pet','wallpaper','agy','interact','overview'])categories.push({name,...await sample(()=>document.querySelector(`.nav-item[data-page="${name}"]`).click())});
   document.querySelector('.nav-item[data-page="wallpaper"]').click();await new Promise(r=>setTimeout(r,350));
   const scroller=document.querySelector('#content-scroll');let scrolling=true;
   const scroll=await sample(()=>{function step(){scroller.scrollTo({top:scroller.scrollTop+9,behavior:'instant'});if(scrolling)requestAnimationFrame(step);}step();},800);scrolling=false;
   return{categories,scroll,viewTransitions:typeof document.startViewTransition==='function',viewport:{width:innerWidth,height:innerHeight},gpuDisabled:true};
  });
  await page.evaluate(()=>document.querySelector('.nav-item[data-page="overview"]').click());await page.waitForTimeout(400);
  await page.evaluate(()=>{for(const n of document.querySelectorAll('.sync-pill'))n.textContent='等待浏览器扩展连接（隔离测试）';});
  await page.screenshot({path:path.join(root,'evidence/settings-frames-'+variant+'.png')});
  console.log(JSON.stringify({variant,...result}));return{variant,...result};
 }finally{await app.close();}
}
(async()=>{const names=process.argv.slice(2);const results=[];for(const name of names.length?names:['baseline','layer','noblur']){assert(Object.hasOwn(variants,name));results.push(await run(name));}fs.writeFileSync(path.join(root,'evidence/settings-frames-'+(process.env.CATSTELLA_FRAME_LABEL||'probe')+'.json'),JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
