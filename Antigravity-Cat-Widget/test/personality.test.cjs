const test=require('node:test'),assert=require('node:assert/strict');
const {Personality}=require('../src/renderer/personality.js');
const {PetBehavior}=require('../src/renderer/pet-behavior.js');
const {ModelActivity}=require('../src/domain/model-activity.cjs');
const {hostPlacement,ForegroundMonitor}=require('../src/domain/host-visibility.cjs');
test('native heartbeat stays live while stationary and stale helper is replaced',async()=>{
 const monitor=new ForegroundMonitor();try{
  const next=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('heartbeat timeout')),3500);monitor.once('change',s=>{clearTimeout(timer);resolve(s);});});
  let waiting=next();monitor.start();await waiting;
  const child=monitor.child;await next();assert.equal(monitor.child,child);
  monitor.lastReport=Date.now()-6000;waiting=next();monitor.start();await waiting;assert.notEqual(monitor.child,child);
 }finally{monitor.stop();}
});
const idleContext = {visible:true,idle:true,rest:true,expressions:true};
test('only a short, stationary primary gesture qualifies as a petting click',()=>{
 assert.equal(PetBehavior.isTap(0,0),true);
 assert.equal(PetBehavior.isTap(PetBehavior.tapLimit,PetBehavior.tapSlop),true);
 assert.equal(PetBehavior.isTap(PetBehavior.tapLimit+1,0),false);
 assert.equal(PetBehavior.isTap(200,PetBehavior.tapSlop+1),false);
 assert.equal(PetBehavior.isTap(Number.NaN,0),false);
});
test('a head touch can show proud and three quick gestures take priority with angry',()=>{
 let hits=0;
 for(let i=0;i<100;i++){
  const pet=new PetBehavior(()=>{}, {random:()=>i/100});
  pet.sync(idleContext);
  if(pet.tap()==="proud")hits++;
  pet.dispose();
 }
 assert.equal(hits,35);
 let now=0;
 const pet=new PetBehavior(()=>{}, {now:()=>now,random:()=>0});
 pet.sync(idleContext);
 assert.equal(pet.tap(),'proud');
 now+=400;
 assert.equal(pet.tap(),null);
 now+=600;
 assert.equal(pet.tap(),'angry');
 pet.dispose();
});
test('spaced head taps can show shy without counting separate visits or overriding a preview',()=>{
 const reactions=(interval,random,preview=false)=>{
  let now=0;
  const pet=new PetBehavior(()=>{}, {now:()=>now,random:()=>random});
  pet.sync(idleContext);
  if(preview) pet.show('angry','preview');
  const results=[];
  for(let i=0;i<8;i++){
   now=i*interval;
   results.push(pet.tap());
  }
  pet.dispose();
  return results;
 };
 assert.deepEqual(reactions(1000,.40),[null,null,null,'shy',null,null,'shy',null]);
 assert.ok(reactions(1000,.46).every(result=>result===null));
 assert.ok(reactions(1900,.40).every(result=>result===null));
 assert.ok(reactions(1000,.40,true).every(result=>result===null));
 assert.ok(reactions(750,.46).every(result=>result===null), 'evenly spaced taps should not be mistaken for rapid repeated taps');
});
test('preview survives state and settings changes for its full duration',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let visual;
 const pet=new PetBehavior(next=>visual=next);
 pet.sync(idleContext);
 assert.equal(pet.show('proud','preview'),true);
 pet.sync({...idleContext,idle:false,rest:false,expressions:false});
 t.mock.timers.tick(3199);
 assert.equal(visual.expression,'proud');
 pet.sync(idleContext);
 assert.equal(pet.show('shy','dialogue'),false);
 t.mock.timers.tick(1);
 assert.equal(visual.expression,undefined);
 pet.dispose();
});
test('idle pet blinks, naps with eyes closed, and a click wakes with a rebound',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let visual;
 const pet=new PetBehavior(next=>visual=next,{random:()=>0});
 pet.sync(idleContext);
 t.mock.timers.tick(4200);
 assert.equal(visual.blink,true);
 t.mock.timers.tick(140);
 assert.equal(visual.blink,false);
 t.mock.timers.tick(180000-4340);
 assert.equal(visual.rest,'sleeping');
 assert.equal(visual.blink,true);
 assert.equal(pet.activity(),false);
 assert.equal(visual.rest,'sleeping');
 assert.equal(pet.activity(true),true);
 assert.equal(visual.rest,'waking');
 assert.equal(visual.blink,false);
 assert.equal(pet.show('proud','system'),false,'refresh must not interrupt the wake motion');
 t.mock.timers.tick(PetBehavior.wakeTime);
 assert.equal(visual.rest,'awake');
 pet.dispose();
});

test('AGY activity keeps the current step through late and duplicate events',()=>{
 let now=0;
 const activity=new ModelActivity(()=>now);
 assert.equal(activity.begin('first',3),true);
 assert.equal(activity.begin('first',3),false);
 assert.equal(activity.begin('second',9),true);
 now=6000;
 assert.deepEqual(activity.snapshot(),{kind:'model-running',stepIndex:9,tools:[],waitingUser:false});
 activity.end('first',3,'model-done',true);
 assert.deepEqual(activity.snapshot(),{kind:'model-running',stepIndex:9,tools:[],waitingUser:false});
 assert.equal(activity.end('unknown',11,'model-done',true),false);
 assert.equal(activity.end('second',9,'model-error'),true);
 assert.equal(activity.end('second',9,'model-error'),false);
 assert.deepEqual(activity.snapshot(),{kind:'model-error',stepIndex:9,expiresAt:10500});
 now=10500;
 assert.equal(activity.snapshot(),null);
 activity.end('next',10,'model-done',true);
 assert.equal(activity.snapshot().kind,'model-done');
 activity.begin('another',1);
 activity.clear();
 assert.equal(activity.snapshot(),null);
});
test('nap preview works with the bubble open and can finish automatically or by waking early',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let visual;
 const pet=new PetBehavior(next=>visual=next);
 pet.sync({...idleContext,rest:false});
 pet.previewNap();
 pet.sync({...idleContext,rest:false,idle:false,expressions:false});
 t.mock.timers.tick(3199);
 assert.equal(visual.rest,'sleeping');
 assert.equal(visual.blink,true);
 t.mock.timers.tick(1);
 assert.equal(visual.rest,'waking');
 t.mock.timers.tick(PetBehavior.wakeTime);
 assert.equal(visual.rest,'awake');
 pet.previewNap();
 assert.equal(pet.activity(true),true);
 t.mock.timers.tick(3200);
 assert.equal(visual.rest,'awake');
 pet.previewNap();
 assert.equal(pet.show('angry','preview'),true);
 assert.deepEqual(visual,{expression:'angry',rest:'awake',blink:false});
 pet.dispose();
});
test('quips do not repeat and only tagged dialogue gets a shy expression',()=>{
 const personality=new Personality({idle:['甲','乙']},()=>0,{shy:['乙']});
 assert.equal(personality.say('idle'),'甲');
 assert.equal(personality.expressionFor('甲'),null);
 const next=personality.say('idle');
 assert.equal(next,'乙');
 assert.equal(personality.expressionFor(next),'shy');
});
test('host placement fits negative-coordinate workspaces and hides small or inactive hosts',()=>{
 for(const scale of [140,220,360]){const area={x:-1200,y:20,width:1100,height:800},p=hostPlacement({kind:'host',bounds:area},scale);assert(p);assert(p.bounds.x>=area.x&&p.bounds.y>=area.y);assert(p.bounds.x+p.bounds.width<=area.x+area.width);assert(p.bounds.y+p.bounds.height<=area.y+area.height);}
 assert.equal(hostPlacement({kind:'other',bounds:null},220),null);
 assert.equal(hostPlacement({kind:'host',bounds:{x:0,y:0,width:350,height:400}},220),null);
 const compactArea={x:-500,y:20,width:370,height:420};
 const compact=hostPlacement({kind:'host',bounds:compactArea},360,0,0);
 assert(compact,'a short host can keep the square character and a usable bubble');
 assert.equal(compact.bounds.height,compactArea.height);
 assert.ok(compact.bounds.height-compact.scale>=245,'leave room for the bubble above the character');
});
test('native foreground helper returns bounded metadata without interacting with windows',async()=>{
 const monitor=new ForegroundMonitor();try{const state=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('helper timeout')),5000);monitor.once('change',s=>{clearTimeout(timer);resolve(s);});monitor.start();});assert(['host','self','other','unknown'].includes(state.kind));}finally{monitor.stop();}
});

test('five-hour and weekly manual quotas persist independently; fifty new quips are available',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{SettingsManager}=require('../src/domain/settings.cjs');
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'gemini-windows-')),'settings.json'),s=new SettingsManager(file);
 s.update({manualQuota:true,manualPercent:0,manualWeeklyPercent:68});const restored=new SettingsManager(file);
 assert.equal(restored.get('manualPercent'),0);assert.equal(restored.get('manualWeeklyPercent'),68);
 s.update({manualWeeklyPercent:101});assert.equal(s.get('manualWeeklyPercent'),100);assert.equal(s.get('manualPercent'),0);
 const lines=require('../assets/dialogue/zh-CN.json').lines.idle;assert(lines.length>=64);assert.equal(new Set(lines).size,lines.length);
});

test('native quota cache reads Gemini windows only, preserves zero and rejects invalid fractions',()=>{
 const vm=require('node:vm'),{readHostQuota}=require('../src/adapters/host-quota.cjs');
 const result=vm.runInNewContext('('+readHostQuota.toString()+')()',{pY:[{displayName:'Other',buckets:[{bucketId:'gemini-5h',remaining:{case:'remainingFraction',value:1}}]},{displayName:'Gemini Models',buckets:[{bucketId:'gemini-5h',remaining:{case:'remainingFraction',value:0}},{bucketId:'gemini-weekly',remaining:{case:'remainingFraction',value:.68}}]}],jFb:1000});
 assert.equal(result.fiveHour,0);assert.equal(result.weekly,68);assert.equal(result.fetchedAt,1000);
 const missing=vm.runInNewContext('('+readHostQuota.toString()+')()');assert.equal(missing.fiveHour,null);
});

test('Desktop Models quota cache is read without calling services',()=>{
 const vm=require('node:vm'),{readHostQuota}=require('../src/adapters/host-quota.cjs');
 const groups=[{displayName:'Gemini Models',buckets:[{bucketId:'gemini-5h',remaining:{case:'remainingFraction',value:.42}},{bucketId:'gemini-weekly',remaining:{case:'remainingFraction',value:0}}]}];
 const el={};el['__reactFiber'+String.fromCharCode(36)+'test']={memoizedState:{memoizedState:groups,next:null},return:null};
 const sample=vm.runInNewContext('('+readHostQuota.toString()+')()',{document:{querySelectorAll:()=>[el]}});
 assert.equal(sample.fiveHour,42);assert.equal(sample.weekly,0);assert.equal(sample.fetchedAt,null);assert.equal(sample.cacheAvailable,true);
});

test('character placement and host offsets agree across the available width',()=>{
 const {characterPlacement,hostPlacement}=require('../src/domain/host-visibility.cjs');
 const area={x:100,y:50,width:1200,height:800},size=220,dim={width:360,height:524};
 let previous=null;
 for(let left=area.x;left<=area.x+area.width-size;left+=10){
  const p=characterPlacement(area,size,dim,left,area.y+area.height-dim.height);
  assert.equal(p.bounds.x+(dim.width-size)/2+p.artShift,left);
  if(previous!==null)assert.equal(p.visualX-previous,10);previous=p.visualX;
  const restored=hostPlacement({kind:'host',bounds:area},size,area.x+area.width-p.visualX-size,0);
  assert.equal(restored.visualX,p.visualX);assert.equal(restored.artShift,p.artShift);
 }
 const right=characterPlacement(area,size,dim,99999,99999);assert.equal(right.visualX+size,area.x+area.width);assert.equal(right.bounds.y+dim.height,area.y+area.height);
});

test('explicit host docking stays at the same side after resizing',()=>{
 for(const side of ['left','right'])for(const width of [700,1100]){
 const area={x:30,y:50,width,height:800},p=hostPlacement({kind:'host',bounds:area},220,400,0,side);
 assert.equal(side==='left'?p.visualX:p.visualX+p.scale,side==='left'?area.x:area.x+area.width);
 }
});

test('pet reflection dialogue contains count placeholders and honors honorific substitution',()=>{
 const dialogue=require('../assets/dialogue/zh-CN.json');
 const {formatLine}=require('../src/renderer/personality.js');
 const {HeadPatDialogue}=require('../src/renderer/pet-behavior.js');
 for(const [category,field] of [['petReflection','count'],['petDaily','today']]){
  assert.ok(dialogue.lines[category].length>=4);
  for(const line of dialogue.lines[category]){
   assert.ok(line.includes(`{${field}}`)&&line.includes('{user}'));
   assert.match(formatLine(line,{mode:'custom',name:' 用户甲 '},{[field]:42}),/用户甲/);
  }
 }
 assert.equal(formatLine('{user:杂鱼君}，人类历史。',{mode:'custom',name:'  '}),'杂鱼君，人类历史。');
 assert.equal(formatLine('{user}，AGY 模型步骤 #{step}',{mode:'zayu'},{step:7}),'杂鱼君，AGY 模型步骤 #7');
 let now=0;
 const talk=new HeadPatDialogue(()=>now);
 // Early rapid taps must not blurt today's count before sustained patting.
 for(let i=1;i<=11;i++)assert.equal(talk.next({total:19+i,today:i},true),null);
 assert.deepEqual(talk.next({total:31,today:12},true),{category:'petDaily',fields:{count:31,today:12}});
 for(let total=32;total<=36;total++)assert.equal(talk.next({total,today:total-19},true),null);
 now=20_000;
 assert.deepEqual(talk.next({total:37,today:18},true),{category:'petReflection',fields:{count:37,today:18}});
 // Elapsed active stretch (15s+, >=6 session taps, >=8 today) also unlocks the quip.
 let delayedNow=0;
 const delayedTalk=new HeadPatDialogue(()=>delayedNow);
 for(let i=1;i<=5;i++)assert.equal(delayedTalk.next({total:7+i,today:4+i},true),null);
 delayedNow=16_000;
 assert.deepEqual(delayedTalk.next({total:13,today:10},true),{category:'petDaily',fields:{count:13,today:10}});
});

test('categorized idle chatter supports explicit topic filtering, anti-repeat group rotation and late-night bias',()=>{
 const dialogue=require('../assets/dialogue/zh-CN.json');
 const {Personality,TALK_CATEGORIES}=require('../src/renderer/personality.js');
 const groups=TALK_CATEGORIES.filter(item=>item.id!=='all');
 assert.ok(groups.length>=6);
 assert.ok(dialogue.lines.talkGroups,'zh-CN.json must define talkGroups');
 for(const item of groups){
  const group=dialogue.lines.talkGroups[item.id];
  assert.ok(group&&Array.isArray(group.lines)&&group.lines.length>=12,`${item.id} should have >=12 lines`);
  for(const line of group.lines)assert.ok(dialogue.lines.idle.includes(line),`idle must include ${item.id} line`);
 }
 const p=new Personality(dialogue.lines,()=>0.25,dialogue.expressionTags);
 for(const item of groups){
  const picked=p.sayWithMeta('idle',{category:item.id});
  assert.equal(picked.categoryKey,item.id);
  assert.ok(dialogue.lines.talkGroups[item.id].lines.includes(picked.text));
 }
 const allA=p.sayWithMeta('idle',{category:'all',now:new Date(2026,10,16,14,0)});
 const allB=p.sayWithMeta('idle',{category:'all',now:new Date(2026,10,16,14,5)});
 assert.notEqual(allA.categoryKey,allB.categoryKey,'auto category mode should not repeat the same group twice in a row');
 const late=new Personality(dialogue.lines,()=>0.99,dialogue.expressionTags);
 const nightPick=late.sayWithMeta('idle',{category:'all',now:new Date(2026,10,16,2,30)});
 assert.ok(nightPick.categoryKey==='nightOwl'||nightPick.categoryKey==='care');
});

test('settings sanitization validates side quota widget and strips legacy talkCategory',()=>{
 const fs=require('node:fs');
 const os=require('node:os');
 const path=require('node:path');
 const {SettingsManager,DEFAULT_SETTINGS}=require('../src/domain/settings.cjs');
 assert.equal(Object.hasOwn(DEFAULT_SETTINGS,'talkCategory'),false);
 assert.equal(DEFAULT_SETTINGS.sideQuotaEnabled,true);
 assert.equal(DEFAULT_SETTINGS.sideQuotaVariant,'arc');
 assert.equal(DEFAULT_SETTINGS.sideQuotaDistance,'normal');
 assert.equal(DEFAULT_SETTINGS.sideQuotaSize,'md');
 assert.equal(DEFAULT_SETTINGS.sideQuotaMode,'remaining');
 assert.equal(DEFAULT_SETTINGS.sideQuotaSource,'auto');
 const tmpDir=fs.mkdtempSync(path.join(os.tmpdir(),'cat-settings-'));
 try{
  const manager=new SettingsManager(path.join(tmpDir,'settings.json'));
  const cleaned=manager.sanitize({
   talkCategory:'nightOwl',
   sideQuotaEnabled:false,
   sideQuotaVariant:'ring',
   sideQuotaDistance:'compact',
   sideQuotaSize:'lg',
   sideQuotaMode:'used',
   sideQuotaSource:'web'
  });
  assert.equal(Object.hasOwn(cleaned,'talkCategory'),false);
  assert.deepEqual({
   sideQuotaEnabled:cleaned.sideQuotaEnabled,
   sideQuotaVariant:cleaned.sideQuotaVariant,
   sideQuotaDistance:cleaned.sideQuotaDistance,
   sideQuotaSize:cleaned.sideQuotaSize,
   sideQuotaMode:cleaned.sideQuotaMode,
   sideQuotaSource:cleaned.sideQuotaSource
  },{
   sideQuotaEnabled:false,
   sideQuotaVariant:'ring',
   sideQuotaDistance:'compact',
   sideQuotaSize:'lg',
   sideQuotaMode:'used',
   sideQuotaSource:'web'
  });
  const fallback=manager.sanitize({
   sideQuotaVariant:'hexagon',
   sideQuotaDistance:'huge',
   sideQuotaSize:'xxl',
   sideQuotaMode:'bogus',
   sideQuotaSource:'mars'
  });
  assert.equal(fallback.sideQuotaVariant,'arc');
  assert.equal(fallback.sideQuotaDistance,'normal');
  assert.equal(fallback.sideQuotaSize,'md');
  assert.equal(fallback.sideQuotaMode,'remaining');
  assert.equal(fallback.sideQuotaSource,'auto');
 }finally{
  fs.rmSync(tmpDir,{recursive:true,force:true});
 }
});
