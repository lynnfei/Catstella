const{test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const{SettingsManager}=require("../src/domain/settings.cjs"),{UsageLedger,localDate}=require("../src/domain/ledger.cjs"),{TranscriptAdapter}=require("../src/adapters/transcript-adapter.cjs"),{WidgetStateMachine}=require("../src/domain/state-machine.cjs"),{AudioManager}=require("../src/domain/audio-manager.cjs");
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),"star-test-"));
test("missing daily token components and unsafe aggregates remain unknown",()=>{
 const now=()=>new Date(),ledger=new UsageLedger({now});
 const base={sessionId:"a",status:"DONE",created_at:now().toISOString(),cache_read_tokens:0,output_tokens:2};
 ledger.recordStep({...base,step_index:1,input_tokens:10});
 ledger.recordStep({...base,step_index:2,input_tokens:null});
 assert.deepEqual(ledger.getSnapshot().todayTokens,{prompt:null,cache:0,output:4,total:null});
 ledger.recordStep({...base,step_index:2,input_tokens:5});
 assert.deepEqual(ledger.getSnapshot().todayTokens,{prompt:15,cache:0,output:4,total:19});
 const large=new UsageLedger({now});
 for(const step_index of [1,2])large.recordStep({...base,step_index,input_tokens:Number.MAX_SAFE_INTEGER,output_tokens:0});
 assert.equal(large.getSnapshot().todayTokens.prompt,null);
 assert.equal(large.getSnapshot().todayTokens.total,null);
});
test("zero volume, soft-spring, invalid booleans and settings persistence",()=>{const file=path.join(tmp(),"settings.json"),s=new SettingsManager(file);s.update({volume:0,soundSet:"soft-spring",sound:"false",scale:999});assert.equal(s.get("volume"),0);assert.equal(s.get("sound"),false);assert.equal(s.get("scale"),360);assert.equal(new SettingsManager(file).get("soundSet"),"soft-spring");});
test("failed desktop appearance writes keep the live and persisted selections in agreement",()=>{
 const {DreamSkinSettings}=require("../../Antigravity-Dream-Skin/src/domain/settings.cjs");
 for(const [Manager,saved,attempt] of [
  [SettingsManager,{syncCharacter:true,characterPack:"lin-cat"},{syncCharacter:false,characterPack:"gemini-star-v1"}],
  [DreamSkinSettings,{wallpaperId:"current"},{wallpaperId:"replacement"}]
 ]){
  const file=path.join(tmp(),"settings.json"),store=new Manager(file);
  store.update(saved);
  fs.mkdirSync(file+".tmp"); // Deny the atomic staging write without changing the original file.
  assert.throws(()=>store.update(attempt));
  for(const [key,value] of Object.entries(saved)){
   assert.equal(store.get(key),value);
   assert.equal(new Manager(file).get(key),value);
  }
 }
});
test("session-scoped dedup, null metrics, local day, restart persistence and no invented price",()=>{const file=path.join(tmp(),"usage.json"),now=()=>new Date("2026-10-29T12:00:00+08:00"),l=new UsageLedger({storagePath:file,now});const step={step_index:1,status:"DONE",created_at:now().toISOString(),input_tokens:10,cache_read_tokens:20,output_tokens:5};assert.equal(l.getSnapshot().todayTokens.total,null);assert(l.recordStep(step,"A"));assert.equal(l.recordStep(step,"A"),null);assert(l.recordStep(step,"B"));assert.equal(l.getSnapshot().todayTokens.total,70);assert.equal(l.calculateTurnCost(10,5),null);assert.equal(l.recordStep({...step,step_index:2,input_tokens:-1}).tokens.total,null);l.save();assert.equal(new UsageLedger({storagePath:file,now}).records.size,3);assert.equal(localDate(now()),"2026-10-29");l.quotaRemainingPercent=0;assert.equal(l.getQuotaStatus().isKnown,true);l.quotaRemainingPercent=null;assert.equal(l.getQuotaStatus().ariaValueNow,null);});
test("append parser handles split UTF8 JSON, RUNNING->DONE same index, bootstrap silent, truncation and new session",()=>{const dir=tmp(),file=path.join(dir,"transcript_full.jsonl"),events=[];const base={step_index:4,source:"MODEL",type:"PLANNER_RESPONSE",status:"RUNNING",created_at:new Date().toISOString()};fs.writeFileSync(file,JSON.stringify(base)+"\n");const a=new TranscriptAdapter({filePath:file});a.on("turnDone",e=>events.push(e));a.scan();assert.equal(events.length,0);const line=JSON.stringify({...base,status:"DONE",input_tokens:12,cache_read_tokens:0,output_tokens:2,content:"此内容不能输出"});fs.appendFileSync(file,line.slice(0,35));a.scan();assert.equal(events.length,0);fs.appendFileSync(file,line.slice(35)+"\n");a.scan();assert.equal(events.length,1);assert.equal(events[0].historical,false);assert.equal(events[0].content,undefined);a.scan();assert.equal(events.length,1);fs.writeFileSync(file,JSON.stringify({...base,status:"DONE",step_index:1,input_tokens:1})+"\n");a.scan();assert.equal(events[1].historical,true);a.stop();});
test("press is not interrupted by a success bounce; persistent warning restores",()=>{const s=new WidgetStateMachine("warning");s.handlePointerDown();s.handleTurnSuccess();assert.equal(s.currentState,"pressed");s.handlePointerUp();s.clearTransient();assert.equal(s.currentState,"warning");s.destroy();});
test("completion of an older step does not interrupt ongoing work",()=>{const s=new WidgetStateMachine("thinking");s.handleTurnSuccess();assert.equal(s.currentState,"thinking");assert.equal(s.isTransient,false);s.destroy();});
test("all four sound pairs resolve, zero means muted, paths become file URLs",()=>{const a=new AudioManager({enabled:true,volume:0});assert.equal(a.getPresetList().length,4);for(const p of a.getPresetList()){assert(a.setPreset(p.id));for(const k of ["press","release"]){const out=a.getAudioFile(k);assert(fs.existsSync(out.filePath));assert(out.url.startsWith("file:"));assert.equal(out.effectiveVolume,0);}}a.setEnabled(false);assert.equal(a.getAudioFile("press"),null);});

test("late numeric metadata fills missing values without double counting or replay notification",()=>{
 const file=path.join(tmp(),"usage.json"),now=()=>new Date(),ledger=new UsageLedger({storagePath:file,now});
 const step={sessionId:"session-a",step_index:7,status:"DONE",created_at:now().toISOString(),input_tokens:12};
 assert(ledger.recordStep(step));
 assert.equal(ledger.getSnapshot().todayTokens.total,null);
 const enriched=ledger.recordStep({...step,cache_read_tokens:0,output_tokens:3});
 assert.equal(enriched.updated,true);
 assert.equal(ledger.getSnapshot().todaySteps,1);
 assert.equal(ledger.getSnapshot().todayTokens.total,15);
 assert.equal(ledger.recordStep({...step,input_tokens:999,cache_read_tokens:0,output_tokens:3}),null);
 ledger.save();
 const restored=new UsageLedger({storagePath:file,now});
 assert.equal(restored.getSnapshot().todayTokens.total,15);
 assert.equal(restored.records.get("session-a:7").updated,undefined);
});

test("corrupt persisted record shapes cannot crash startup or restore arbitrary fields",()=>{
 const file=path.join(tmp(),"usage.json");
 fs.writeFileSync(file,JSON.stringify({records:{bad:true}}));
 assert.equal(new UsageLedger({storagePath:file}).records.size,0);
 const step={sessionId:"a",step_index:1,status:"DONE",created_at:new Date().toISOString(),input_tokens:1,cache_read_tokens:0,output_tokens:2};
 const valid=new UsageLedger().recordStep(step);
 fs.writeFileSync(file,JSON.stringify({records:[null,{}, {...valid,tokens:{input:-1}}, {...valid,content:"must not persist"}]}));
 const ledger=new UsageLedger({storagePath:file});
 assert.equal(ledger.records.size,1);
 assert.equal(ledger.records.get("a:1").content,undefined);
 ledger.save();assert(!fs.readFileSync(file,"utf8").includes("must not persist"));
});

test("non-model records cannot suppress matching model metadata",()=>{
 const file=path.join(tmp(),"transcript_full.jsonl"),adapter=new TranscriptAdapter({filePath:file}),events=[];
 const step={step_index:2,type:"PLANNER_RESPONSE",status:"DONE",created_at:new Date().toISOString(),input_tokens:1,cache_read_tokens:0,output_tokens:1};
 fs.writeFileSync(file,JSON.stringify({...step,source:"TOOL"})+"\n"+JSON.stringify({...step,source:"MODEL"})+"\n");
 adapter.on("turnDone",event=>events.push(event));adapter.scan();
 assert.equal(events.length,1);assert.equal(events[0].historical,true);adapter.stop();
});

test("oversized log lines cannot turn their tail into a model event; rotated cursors are released",()=>{
 const dir=tmp(),file=path.join(dir,"transcript_full.jsonl"),a=new TranscriptAdapter({filePath:file}),events=[];
 const step={step_index:1,source:"MODEL",type:"PLANNER_RESPONSE",status:"DONE",created_at:new Date().toISOString(),input_tokens:1};
 fs.writeFileSync(file,Buffer.alloc(5*1024*1024,32));a.scan();
 assert.equal(a.cursors.get(file).discarding,true);
 fs.appendFileSync(file,JSON.stringify(step)+"\n"+JSON.stringify({...step,step_index:2})+"\n");
 a.on("turnDone",event=>events.push(event));a.scan();
 assert.deepEqual(events.map(event=>event.step_index),[2]);
 const next=path.join(dir,"next.jsonl");fs.writeFileSync(next,"");a.filePath=next;a.scan();
 assert.equal(a.cursors.size,1);assert(a.cursors.has(next));
 let status;a.on("status",value=>status=value);a.filePath=dir;a.scan();
 assert.equal(status.online,false);assert.equal(status.files,0);
});
test("upstream click settings survive sanitize with normalized types",()=>{
 const file=path.join(tmp(),"settings.json"),s=new SettingsManager(file);
 s.update({clickCatAction:"talk"});
 assert.equal(new SettingsManager(file).get("clickCatAction"),"talk");
 s.update({clickCatAction:false,bubblePage:"claudeGpt"});
 assert.equal(s.get("clickCatAction"),false);
 assert.equal(s.get("bubblePage"),"claudeGpt");
 s.update({bubblePage:"bogus"});
 assert.equal(s.get("bubblePage"),"quota");
});

test("dual-end sync settings, display modes, webQuota page, and unknown extension fields survive sanitize",()=>{
 const file=path.join(tmp(),"settings-sync.json"),s=new SettingsManager(file);
 assert.equal(s.get("syncCharacter"),true);
 assert.equal(s.get("syncWallpaper"),true);
 assert.equal(s.get("petDisplayMode"),"both");
 s.update({bubblePage:"webQuota",syncCharacter:false,syncWallpaper:false,syncInteraction:false,petDisplayMode:"prefer-web",customExtField:"keep-me"});
 const restored=new SettingsManager(file);
 assert.equal(restored.get("bubblePage"),"webQuota");
 assert.equal(restored.get("syncCharacter"),false);
 assert.equal(restored.get("syncWallpaper"),false);
 assert.equal(restored.get("syncInteraction"),false);
 assert.equal(restored.get("petDisplayMode"),"prefer-web");
 assert.equal(restored.get("customExtField"),"keep-me");
 restored.update({petDisplayMode:"bogus-mode"});
 assert.equal(restored.get("petDisplayMode"),"both");
});
test("custom themes sanitize to preset palettes with dedup and bounds",()=>{const file=path.join(tmp(),"settings.json"),s=new SettingsManager(file);s.update({customThemes:[{id:"local-violet-1",name:"  轻透  ",palette:"ocean",opacity:120,updatedAt:"2026-11-09"},{id:"bad id!",name:"x",palette:"nope",opacity:50},{id:"local-violet-1",name:"dup",palette:"pink",opacity:30},"junk",{name:"no-id",palette:"violet",opacity:10}]});assert.deepEqual(new SettingsManager(file).get("customThemes"),[{id:"local-violet-1",name:"轻透",palette:"ocean",opacity:100,bubbleTint:null,bubbleOpacity:null,chatTint:null,chatOpacity:null,replyOpacity:null,updatedAt:"2026-11-09"}]);});
test('preview rescans reuse unchanged images, invalidate changed files and bound the cache',()=>{
 const {PreviewCache}=require('../src/domain/preview-cache.cjs');
 let decodes=0,revision=1;
 const cache=new PreviewCache({createFromPath:file=>({resize:({width})=>({toDataURL:()=>file+':'+width+':'+(++decodes)})})},{stat:()=>({size:10,mtimeMs:revision}),limit:2});
 const first=cache.get('a',600);assert.equal(cache.get('a',600),first);assert.equal(decodes,1);
 revision++;assert.notEqual(cache.get('a',600),first);assert.equal(decodes,2);
 cache.get('a',384);cache.get('b',600);assert.equal(cache.entries.size,2);
 cache.clear();assert.equal(cache.entries.size,0);
});
