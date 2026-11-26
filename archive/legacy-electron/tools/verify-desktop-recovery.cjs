const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'catstella-window-'));
const logFile = path.join(dir, 'recovery.log');
const ledgerPath = path.join(dir, 'usage-v2.json');
const transcript = path.join(dir, 'transcripts/brain/fixture/.system_generated/logs/transcript_full.jsonl');
const boot = path.join(dir, 'boot.cjs');
const executablePath = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const args = [boot, '--isolated-dev', '--test-transcripts', '--data-dir=' + dir];
const log = () => fs.readFileSync(logFile, 'utf8');
const elapsed = () => Math.round((performance.now() - started) / 1000);
const started = performance.now();

fs.mkdirSync(path.dirname(transcript), { recursive:true });
fs.writeFileSync(transcript, '');
fs.mkdirSync(ledgerPath); // Deliberately fail the atomic ledger rename.
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ bubblePage:'talk', sound:false, turnCostOn:false }));
fs.writeFileSync(boot, `const adapter = require(${JSON.stringify(path.join(root,'Antigravity-Cat-Widget/src/adapters/host-quota.cjs'))});
const HostQuotaAdapter = adapter.HostQuotaAdapter;
adapter.HostQuotaAdapter = class extends HostQuotaAdapter {
  constructor(options) { super(options); globalThis.fixtureQuota = this; }
};
require(${JSON.stringify(path.join(root,'Antigravity-Cat-Widget/src/main/index.cjs'))});`);

async function waitUntil(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('Condition timed out');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function main() {
  const app = await _electron.launch({ executablePath, args, env });
  const child = app.process();
  const pid = await app.evaluate(()=>process.pid);
  let closed = false;
  const errors = [];
  const append = (index,status) => fs.appendFileSync(transcript,JSON.stringify({
    step_index:index,status,source:'MODEL',type:'PLANNER_RESPONSE',created_at:new Date().toISOString(),input_tokens:3,output_tokens:4
  })+'\n');
  try {
    const pet = await app.firstWindow();
    pet.on('pageerror',error=>errors.push(error.message));
    const mascot = pet.locator('#mascot');
    await pet.locator('#mascot[data-art-ready=true]').waitFor();
    const before = await pet.evaluate(()=>widgetApi.get());
    assert(![3921,3922,3923].includes(before.webCompanion.port));

    const duplicate = spawn(executablePath,[...args,'--background'],{env,stdio:'ignore',windowsHide:true});
    await new Promise((resolve,reject)=>{
      duplicate.once('error',reject);
      duplicate.once('exit',code=>code===0?resolve():reject(new Error('Duplicate exited '+code)));
    });
    assert.equal((log().match(/ start parent=/g)||[]).length,1);

    const quota = model => app.evaluate((_,model)=>{
      fixtureQuota.snapshot = {...fixtureQuota.snapshot,modelInfo:{modelName:model,thinking:'默认'},fiveHour:100,weekly:91,argon:{weekly:7.5}};
      fixtureQuota.emit('change');
    },model);
    await quota('Gemini 3.8 Flash');
    assert.equal(await mascot.getAttribute('data-state'),'idle');
    await pet.locator('#toggle').click();
    await pet.locator('#bubble[data-open=true]').waitFor();
    const lines = new Set();
    for(let i=0;i<6;i++){
      await pet.locator('#motion').press('Enter');
      lines.add(await pet.locator('#value').textContent());
    }
    assert.equal(lines.size,6);
    await pet.locator('#mascot[data-expression]').waitFor({state:'detached',timeout:6000});

    await quota('Gemini Argon');
    await pet.locator('#mascot[data-alert-effect=warning]').waitFor();
    await pet.locator('.agy-effect--tear').waitFor({timeout:3000});
    await pet.evaluate(()=>widgetApi.command('preview-reaction:proud'));
    await pet.locator('.agy-effect--heart').waitFor();
    await pet.locator('.agy-effect--tear').waitFor({state:'hidden'});
    await pet.locator('.agy-effect--heart').waitFor({state:'hidden'});
    await pet.locator('#mascot[data-alert-effect]').waitFor({state:'detached'});
    assert.equal(await mascot.getAttribute('data-state'),'warning');
    await quota('Gemini 3.8 Flash');

    append(1,'RUNNING');
    await pet.locator('#mascot[data-state=thinking]').waitFor();
    append(1,'ERROR');
    await pet.locator('#mascot[data-state=error]').waitFor();
    await pet.locator('#mascot[data-state=idle]').waitFor();
    append(2,'DONE');
    await waitUntil(()=>log().includes('usage-save-failed'));
    assert.equal((await pet.evaluate(()=>widgetApi.get())).ledger.todaySteps,1);
    fs.rmdirSync(ledgerPath);
    await waitUntil(()=>fs.existsSync(ledgerPath)&&fs.statSync(ledgerPath).isFile(),21000);
    assert.equal(JSON.parse(fs.readFileSync(ledgerPath,'utf8')).records.length,1);

    const base = 'http://127.0.0.1:'+before.webCompanion.port;
    const state = async () => (await fetch(base+'/companion/state')).json();
    assert.deepEqual((await state()).desktop.chatAppearance,{tint:'#181224',opacity:100,reply:0});
    await pet.evaluate(()=>widgetApi.save({dreamSkin:{outputMode:'glass',chatOpacity:0,replyOpacity:null}}));
    const appearance = (await state()).desktop.chatAppearance;
    assert.deepEqual(appearance,{tint:'#181224',opacity:0,reply:22});
    const response = await fetch(base+'/companion/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Catstella-Client':'gemini-web-companion'},body:JSON.stringify({patch:{dreamSkin:{chatOpacity:91,replyOpacity:99}}})});
    assert.equal(response.status,200);
    assert.deepEqual((await state()).desktop.chatAppearance,appearance);

    const [replacement] = await Promise.all([
      app.waitForEvent('window'),
      app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())
    ]);
    await replacement.locator('#mascot[data-art-ready=true]').waitFor();
    assert.equal(await app.evaluate(()=>process.pid),pid);
    assert.match(log(),/renderer-gone reason=/);
    assert.match(log(),/window-closed-recreate/);
    assert.equal((await replacement.evaluate(()=>widgetApi.get())).ledger.todaySteps,1);
    assert.deepEqual(errors,[]);
    await app.close();
    closed = true;
    assert.match(log(),/exit code=0 reason=/);
    const evidence = {pid,seconds:elapsed(),lines:[...lines],desktopAppearance:appearance,recoveryLog:log().trim().split('\n')};
    fs.writeFileSync(path.join(root,'evidence/desktop-recovery-2026-11-12.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify(evidence));
  } finally {
    if (!closed && child.exitCode === null && child.signalCode === null) await app.close().catch(()=>{});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
