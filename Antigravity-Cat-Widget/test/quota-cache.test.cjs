const test=require('node:test'),assert=require('node:assert/strict');
const {HostQuotaAdapter}=require('../src/adapters/host-quota.cjs');
test('closed Models cache and transient errors retain labelled last observation; host switch clears it',async()=>{
 let now=1000,id='ws://127.0.0.1:1/one',sample={cacheAvailable:true,fiveHour:0,weekly:76,fetchedAt:null},fail=false;
 class Client{async evaluate(){if(fail)throw Error('timeout');return sample;}close(){}}
 const a=new HostQuotaAdapter({discover:async()=>({target:{webSocketDebuggerUrl:id}}),Client,now:()=>now});a.active=true;
 assert.equal(await a.openNativeQuota(),false,'cached data must not confirm a manual refresh');assert.equal(a.snapshot.fiveHour,0);assert.equal(a.snapshot.stale,false);
 sample={fiveHour:null,weekly:null};now+=301000;await a.tick();assert.equal(a.snapshot.weekly,76);assert.equal(a.snapshot.stale,true);assert.equal(a.snapshot.cached,true);
 fail=true;await a.tick();assert.equal(a.snapshot.weekly,76);assert.equal(a.snapshot.online,false);
 fail=false;id='ws://127.0.0.1:1/two';await a.tick();assert.equal(a.snapshot.weekly,null);
 sample={cacheAvailable:true,liveQuery:true,fiveHour:50,weekly:60};assert.equal(await a.openNativeQuota(),true);assert.equal(a.snapshot.weekly,60);assert.equal(a.snapshot.stale,false);a.stop();
});
test('every startup reads immediately without opening Models, including empty caches and changed hosts',async()=>{
 let id='ws://127.0.0.1:1/a',reads=0;
 class Client{async evaluate(expression){assert(!expression.includes('.click('));reads++;return {fiveHour:null,weekly:null};}close(){}}
 const a=new HostQuotaAdapter({discover:async()=>({target:{webSocketDebuggerUrl:id}}),Client});
 a.openNativeQuota=async()=>{assert.fail('must not open Models automatically');};
 try{
  a.start();while(a.busy)await new Promise(r=>setImmediate(r));assert.equal(reads,1);
  a.start();assert.equal(reads,1);
  await a.tick();assert.equal(reads,2);
  id='ws://127.0.0.1:1/b';await a.tick();assert.equal(reads,3);
  a.stop();a.start();while(a.busy)await new Promise(r=>setImmediate(r));assert.equal(reads,4);
  await new Promise(r=>setTimeout(r,2200));assert.equal(reads,4);
 }finally{a.stop();}
});

test('updated host nY cache reads two quota windows without opening UI',()=>{
 const vm=require('node:vm'),{readHostQuota}=require('../src/adapters/host-quota.cjs');
 const sample=vm.runInNewContext('('+readHostQuota.toString()+')()',{
  nY:[{displayName:'Gemini Models',buckets:[{bucketId:'gemini-5h',remaining:{case:'remainingFraction',value:0}},{bucketId:'gemini-weekly',remaining:{case:'remainingFraction',value:.42}}]}],mFb:1000,jFb:()=>{},
 });
 assert.equal(sample.fiveHour,0);assert.equal(sample.weekly,42);assert.equal(sample.fetchedAt,1000);
});

test('background query extracts Gemini only and never opens UI or serializes credentials',async()=>{
 const vm=require('node:vm'),{queryHostQuota}=require('../src/adapters/host-quota.cjs');let calls=0;
 const el={__reactFiber$test:{memoizedProps:{value:{core:{cloudCodeService:{retrieveUserQuotaSummary:async(a,b)=>{
  calls++;assert.equal(a,undefined);assert.equal(b,false);
  return {response:{groups:[{displayName:'Gemini Models',buckets:[{bucketId:'gemini-5h',remaining:{case:'remainingFraction',value:0}},{bucketId:'gemini-weekly',remaining:{case:'remainingFraction',value:.75}},{bucketId:'other',remaining:{case:'remainingFraction',value:1}}]}]},secret:'must not leave host'};
 }}}}}}};
 const out=await vm.runInNewContext('('+queryHostQuota.toString()+')(()=>{throw Error("unexpected cache fallback")})',{document:{querySelectorAll:selector=>{assert.equal(selector,'body *');return [el];}}});
 assert.equal(calls,1);assert.equal(out.fiveHour,0);assert.equal(out.weekly,75);assert.equal(JSON.stringify(out).includes('secret'),false);;assert.equal(out.cacheAvailable,true,'service path must flag cacheAvailable or the adapter discards the sample')
});
test('background quota query propagates service failures instead of claiming fresh data',async()=>{
 const {queryHostQuota}=require('../src/adapters/host-quota.cjs');const previous=global.document;
 global.document={querySelectorAll:()=>[{__reactFiber$test:{memoizedProps:{value:{core:{cloudCodeService:{retrieveUserQuotaSummary:async()=>{throw Error('offline');}}}}}}}]};
 try{await assert.rejects(queryHostQuota(()=>({})),/offline/);}finally{global.document=previous;}
});

test('retry backoff is bounded, success restores 30s polling and concurrent ticks are deduplicated',async()=>{
 let online=false,reads=0,release;const scheduled=[];
 class Client{async evaluate(){reads++;await new Promise(r=>release=r);return {cacheAvailable:true,fiveHour:100,weekly:0};}close(){}}
 const a=new HostQuotaAdapter({discover:async()=>online?{target:{webSocketDebuggerUrl:'ws://127.0.0.1/test'}}:null,Client,setTimer:(fn,ms)=>{scheduled.push(ms);return 1;},clearTimer:()=>{}});a.active=true;
 for(let i=0;i<6;i++)await a.tick();assert.deepEqual(scheduled,[3000,6000,12000,24000,30000,30000]);assert.equal(a.snapshot.status,'waiting-host');
 online=true;const pending=a.tick();while(!release)await new Promise(r=>setImmediate(r));await a.tick();assert.equal(reads,1);release();await pending;
 assert.equal(a.snapshot.weekly,0);assert.equal(a.snapshot.status,'ready');assert.equal(scheduled.at(-1),30000);a.stop();
});
test('late response after stop cannot overwrite or publish quota',async()=>{
 let release,events=0;class Client{async evaluate(){return await new Promise(r=>release=r);}close(){}}
 const a=new HostQuotaAdapter({discover:async()=>({target:{webSocketDebuggerUrl:'ws://127.0.0.1/test'}}),Client});a.on('change',()=>events++);a.start();while(!release)await new Promise(r=>setImmediate(r));a.stop();release({cacheAvailable:true,fiveHour:99});await new Promise(r=>setImmediate(r));assert.equal(events,0);assert.equal(a.snapshot.fiveHour,null);
});

test('stopping inside change listener cannot leave a scheduled poll',async()=>{
 let schedules=0;class Client{async evaluate(){return {cacheAvailable:true,fiveHour:100};}close(){}}
 const a=new HostQuotaAdapter({discover:async()=>({target:{webSocketDebuggerUrl:'ws://127.0.0.1/test'}}),Client,setTimer:()=>schedules++,clearTimer:()=>{}});a.once('change',()=>a.stop());a.start();while(a.busy)await new Promise(r=>setImmediate(r));assert.equal(schedules,0);
});
test('reset descriptions and Claude/GPT channel parse from the same cache',()=>{
 const vm=require('node:vm'),{readHostQuota}=require('../src/adapters/host-quota.cjs');
 const sample=vm.runInNewContext('('+readHostQuota.toString()+')()',{
  nY:[
   {displayName:'Gemini Models',buckets:[{bucketId:'gemini-5h',remaining:{case:'remainingFraction',value:.5},description:'Resets in 2 hours, 5 minutes.'},{bucketId:'gemini-weekly',remaining:{case:'remainingFraction',value:1},description:'Resets in 3 days.'}]},
   {displayName:'Claude & GPT Models',buckets:[{bucketId:'claude-5h',remaining:{case:'remainingFraction',value:.25},description:'Resets in 30 minutes.'},{bucketId:'gpt-weekly',remaining:{case:'remainingFraction',value:.9},description:''}]},
   {displayName:'Claude & GPT Models',buckets:[{bucketId:'claude-5h',remaining:{case:'remainingFraction',value:.1},description:'later duplicate wins nothing'}]}
  ],mFb:1000,jFb:()=>{},
 });
 assert.equal(sample.fiveHour,50);assert.equal(sample.fiveHourReset,"2小时5分钟后重置");
 assert.equal(sample.weekly,100);assert.equal(sample.weeklyReset,"满额");
 assert.equal(sample.claudeGpt.fiveHour,25);assert.equal(sample.claudeGpt.fiveHourReset,"30分钟后重置");
 assert.equal(sample.claudeGpt.weekly,90);
});
test('model and thinking info rides along the quota sample and survives stale ticks',async()=>{
 let sample={cacheAvailable:true,fiveHour:80,weekly:80,modelInfo:{modelName:'Gemini 3 Pro',thinking:'High',fullText:'Gemini 3 Pro High'},claudeGpt:{fiveHour:10,weekly:20,fiveHourReset:'',weeklyReset:''}};
 class Client{async evaluate(){return sample;}close(){}}
 const a=new HostQuotaAdapter({discover:async()=>({target:{webSocketDebuggerUrl:'ws://127.0.0.1/m'}}),Client});a.active=true;
 await a.tick();assert.equal(a.snapshot.modelInfo.modelName,'Gemini 3 Pro');assert.equal(a.snapshot.modelInfo.thinking,'High');
 assert.equal(a.snapshot.claudeGpt.fiveHour,10);assert.equal(a.snapshot.claudeGpt.weekly,20);
 assert.equal(a.snapshot.status,'ready');
 sample={fiveHour:null,weekly:null};await a.tick();
 assert.equal(a.snapshot.modelInfo.modelName,'Gemini 3 Pro');
 assert.equal(a.snapshot.claudeGpt.fiveHour,10);
 assert.equal(a.snapshot.cached,true);a.stop();
});
test('host switch clears model info and claude channel along with quota',async()=>{
 let id='ws://127.0.0.1:1/one';
 const first={cacheAvailable:true,fiveHour:50,weekly:60,modelInfo:{modelName:'Gemini 3 Pro',thinking:'Low',fullText:'x'},claudeGpt:{fiveHour:30,weekly:40,fiveHourReset:'',weeklyReset:''}};
 const second={cacheAvailable:true,fiveHour:70,weekly:80};
 class Client{async evaluate(){return id.endsWith('one')?first:second;}close(){}}
 const a=new HostQuotaAdapter({discover:async()=>({target:{webSocketDebuggerUrl:id}}),Client});a.active=true;
 await a.tick();assert.equal(a.snapshot.modelInfo.modelName,'Gemini 3 Pro');assert.equal(a.snapshot.claudeGpt.fiveHour,30);
 id='ws://127.0.0.1:1/two';await a.tick();
 assert.equal(a.snapshot.modelInfo,null);assert.equal(a.snapshot.claudeGpt.fiveHour,null);assert.equal(a.snapshot.weekly,80);a.stop();
});
test('parseResetTime converts English refresh text and caps full quota',()=>{
 const {parseResetTime}=require('../src/adapters/host-quota.cjs');
 assert.equal(parseResetTime('Resets in 2 hours, 5 minutes.',.5),"2小时5分钟后重置");
 assert.equal(parseResetTime('Resets in 30 minutes.',.5),"30分钟后重置");
 assert.equal(parseResetTime('Resets in 3 days.',.5),"3天后重置");
 assert.equal(parseResetTime('anything',1),"满额");
 assert.equal(parseResetTime('',.5),"");
 assert.equal(parseResetTime(undefined,.5),"");
});

test('Gemini 4 Argon independent metering channel extracts WTU weekly bucket and integrates with queryHostQuota and readHostQuota',async()=>{
 const vm=require('node:vm'),{readHostQuota,queryHostQuota}=require('../src/adapters/host-quota.cjs');
 const groups=[
  {displayName:'Gemini Models',buckets:[{bucketId:'gemini-5h',remaining:{case:'remainingFraction',value:.85}},{bucketId:'gemini-weekly',remaining:{case:'remainingFraction',value:.65}}]},
  {displayName:'Claude and GPT models',buckets:[{bucketId:'3p-5h',remaining:{case:'remainingFraction',value:0}}]},
  {displayName:'Gemini 4 Argon',buckets:[{bucketId:'gemini-argon-wtu-weekly',description:'You have used some of your weekly limit, it will fully refresh in 6 days, 20 hours.',remaining:{case:'remainingFraction',value:.09}}]}
 ];
 const sample=vm.runInNewContext('('+readHostQuota.toString()+')()',{nY:groups,mFb:2000});
 assert.equal(sample.fiveHour,85);
 assert.equal(sample.weekly,65);
 assert.equal(sample.argon.weekly,9);
 assert.equal(sample.argon.weeklyReset,'6天20小时后重置');

 const el={__reactFiber$test:{memoizedProps:{value:{core:{cloudCodeService:{retrieveUserQuotaSummary:async()=>({response:{groups}})}}}}}};
 const queryRes=await vm.runInNewContext('('+queryHostQuota.toString()+')(()=>{throw Error("fallback")})',{document:{querySelectorAll:()=>[el]}});
 assert.equal(queryRes.fiveHour,85);
 assert.equal(queryRes.argon.weekly,9);
 assert.equal(queryRes.argon.weeklyReset,'6天20小时后重置');
});

test('HostQuotaAdapter reports cdp-disabled when host process runs without CDP and parses 2.33 fallback group/model selectors', async () => {
 const vm = require('node:vm');
 const { readHostQuota, queryHostQuota, extractModelInfo } = require('../src/adapters/host-quota.cjs');
 const a = new HostQuotaAdapter({
  discover: async () => null,
  isHostProcessRunning: async () => true,
  setTimer: () => 1,
  clearTimer: () => {}
 });
 a.active = true;
 await a.tick();
 assert.equal(a.snapshot.status, 'cdp-disabled');
 assert.equal(a.snapshot.online, false);
 a.stop();

 const groups = [
  { displayName: 'Gemini 4 Models', buckets: [{ bucketId: 'gemini-5h', remaining: { case: 'remainingFraction', value: .64 }, description: 'Resets in 1 hour.' }, { bucketId: 'gemini-weekly', remaining: { case: 'remainingFraction', value: .9 } }] },
  { displayName: 'Claude & GPT', buckets: [{ bucketId: '3p-5h', remaining: { case: 'remainingFraction', value: .5 } }] }
 ];
 const cached = vm.runInNewContext('(' + readHostQuota.toString() + ')()', { nY: groups, mFb: 3000 });
 assert.equal(cached.fiveHour, 64);
 assert.equal(cached.weekly, 90);
 assert.equal(cached.fiveHourReset, '1小时后重置');

 const el = { __reactFiber$test: { memoizedProps: { value: { core: { cloudCodeService: { retrieveUserQuotaSummary: async () => ({ response: { groups } }) } } } } } };
 const queried = await vm.runInNewContext('(' + queryHostQuota.toString() + ')(()=>{throw Error("fallback")})', { document: { querySelectorAll: () => [el] } });
 assert.equal(queried.fiveHour, 64);
 assert.equal(queried.weekly, 90);

 const mockDoc = {
  querySelector: sel => sel.includes('aria-label*="current:"')
   ? { getAttribute: () => '选择模型，当前：Gemini 4 Pro Minimal', innerText: 'Gemini 4 Pro Minimal' }
   : null
 };
 const model = extractModelInfo(mockDoc);
 assert.equal(model.modelName, 'Gemini 4 Pro');
 assert.equal(model.thinking, 'Minimal');
});
