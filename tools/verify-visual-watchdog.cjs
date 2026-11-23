const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {_electron} = require('playwright');

const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'catstella-window-'));
const boot = path.join(dir, 'watchdog-fixture.cjs');
const mainDir = path.resolve(__dirname, '../Antigravity-Cat-Widget/src/main');
const log = () => fs.readFileSync(path.join(dir, 'recovery.log'), 'utf8');
fs.writeFileSync(boot, `
const mod = require(${JSON.stringify(path.join(mainDir, 'visual-watchdog.cjs'))});
globalThis.watchdogTime = 0;
mod.VisualWatchdog = class extends mod.VisualWatchdog {
 constructor(options) {
  super({...options, now: () => watchdogTime, timeout: 300});
  globalThis.watchdog = this;
 }
};
require(${JSON.stringify(path.join(mainDir, 'index.cjs'))});
`);

async function main() {
 const env = {...process.env};
 delete env.ELECTRON_RUN_AS_NODE;
 const app = await _electron.launch({executablePath: require('electron'),
  args: [boot, '--isolated-dev', '--data-dir=' + dir], env});
 const child = app.process();
 const waitVisibility = async visible => {
  const end = Date.now() + 8000;
  while ((await state()).visible !== visible) {
   if (Date.now() > end) throw Error('Window visibility did not become ' + visible);
   await new Promise(resolve => setTimeout(resolve, 50));
  }
 };
 const ready = async page => {
  await page.locator('#mascot[data-art-ready=true]').waitFor();
  await waitVisibility(true);
 };
 const state = () => app.evaluate(({BrowserWindow}) => {
  const win = BrowserWindow.getAllWindows()[0];
  return {id: win?.id, visible: win?.isVisible(), failures: watchdog.failures, pid: process.pid};
 });
 const tick = (elapsed = 0) => app.evaluate(async (_, elapsed) => {
  watchdogTime += elapsed;
  await watchdog.tick(15000);
 }, elapsed);
 const replace = async action => {
  const [page] = await Promise.all([app.waitForEvent('window', {timeout: 10000}), action()]);
  await ready(page);
  return page;
 };
 try {
  const pet = await app.firstWindow();
  await ready(pet);
  const original = await state();
  await pet.evaluate(() => widgetApi.save({clickThrough: true}));
  await app.evaluate(({BrowserWindow}) => {
   const win = BrowserWindow.getAllWindows()[0];
   const wc = win.webContents;
   const execute = wc.executeJavaScript.bind(wc);
   const capture = wc.capturePage.bind(wc);
   globalThis.inject = {layout: 'normal', capture: 'normal', layoutCalls: 0, captureCalls: 0};
   wc.executeJavaScript = (script, ...args) => {
    if (!script.includes("querySelector('.agy-face')")) return execute(script, ...args);
    inject.layoutCalls++;
    if (inject.layout === 'pending') return new Promise(resolve => {inject.finishLayout = resolve;});
    if (inject.layout === 'invalid') return Promise.resolve(false);
    return execute(script, ...args);
   };
   wc.capturePage = (...args) => {
    inject.captureCalls++;
    if (args[1]?.stayHidden !== true) throw new Error('The probe must preserve hidden state');
    if (inject.capture === 'pending') return new Promise(resolve => {inject.finishCapture = resolve;});
    if (inject.capture === 'blank') return Promise.resolve({toBitmap: () => Buffer.alloc(2000)});
    return capture(...args);
   };
  });
  await tick(5000);
  assert.equal((await state()).failures, 0, 'click-through must allow a healthy probe');
  await app.evaluate(() => {inject.layout = 'invalid';});
  await tick(15000);
  assert.deepEqual(await state(), {...original, failures: 1}, 'one DOM failure leaves the window intact');
  const calls = await app.evaluate(() => inject.layoutCalls);
  await tick(29999);
  assert.equal(await app.evaluate(() => inject.layoutCalls), calls, 'failures back off');
  await app.evaluate(() => {inject.layout = 'normal';});
  await tick(1);
  assert.deepEqual(await state(), original, 'a healthy frame clears the failure streak');

  await app.evaluate(() => {inject.capture = 'pending';});
  await tick(15000);
  assert.deepEqual(await state(), {...original, failures: 1}, 'one capture timeout leaves the window intact');
  await app.evaluate(() => {
   inject.capture = 'normal';
   inject.finishCapture({toBitmap: () => Buffer.alloc(2000, 255)});
  });
  await tick(30000);
  assert.deepEqual(await state(), original);

  // An old capture settles while a fresh check for the same window is active.
  // Hide/show must retire the old result and cancel its watchdog deadline.
  await app.evaluate(async ({BrowserWindow, powerMonitor}) => {
   const win = BrowserWindow.getAllWindows()[0];
   inject.capture = 'pending';
   watchdogTime += 15000;
   const sample = watchdog.tick(15000);
   while (watchdog.active && !watchdog.operations.get(win)?.has('capture')) {
    await new Promise(resolve => setTimeout(resolve, 5));
   }
   if (!watchdog.active) throw Error('Capture did not start');
   powerMonitor.emit('suspend');
   await sample;
   win.hide();
   watchdogTime += 60000;
   await watchdog.tick(15000);
   if (win.isVisible()) throw Error('Hidden window was shown by visual recovery');
   powerMonitor.emit('lock-screen');
   powerMonitor.emit('resume');
   const callsWhileLocked = inject.layoutCalls;
   watchdogTime += 60000;
   await watchdog.tick(15000);
   if (inject.layoutCalls !== callsWhileLocked) throw Error('Resume must not probe a locked screen');
   powerMonitor.emit('unlock-screen');
   inject.capture = 'normal';
   watchdogTime += 5000;
   const resumed = watchdog.tick(15000);
   inject.finishCapture({toBitmap: () => {throw Error('Retired capture was consumed');}});
   await resumed;
  });
  assert.deepEqual(await state(), original, 'sleep/hide retires an in-flight capture');
  await app.evaluate(async ({BrowserWindow}) => {
   const win = BrowserWindow.getAllWindows()[0];
   inject.layout = 'pending';
   watchdogTime += 15000;
   const beforeHide = watchdog.tick(15000);
   win.hide();
   await beforeHide;
   win.showInactive();
   watchdogTime += 5000;
   const resumed = watchdog.tick(15000);
   inject.finishLayout(false);
   inject.layout = 'normal';
   await resumed;
  });
  assert.deepEqual(await state(), original, 'hide/show retires an in-flight DOM response');

  await pet.evaluate(() => widgetApi.drag('start'));
  const callsBeforeDrag = await app.evaluate(() => inject.layoutCalls);
  await tick(30000);
  assert.equal(await app.evaluate(() => inject.layoutCalls), callsBeforeDrag);
  await pet.evaluate(() => widgetApi.drag('cancel'));

  await app.evaluate(() => {inject.capture = 'blank';});
  await tick(15000);
  assert.deepEqual(await state(), {...original, failures: 1});
  await replace(() => tick(30000));
  const recovered = await state();
  assert.notEqual(recovered.id, original.id);
  assert.equal(recovered.pid, original.pid);
  assert.match(log(), /visual-watchdog-recreate reason=blank-surface/);
  await tick(59999);
  assert.deepEqual(await state(), recovered, 'a replacement gets a cooldown');

  // A renderer exit bypasses visual backoff. A late probe from the destroyed
  // instance must have no effect after a new window becomes visible.
  const postCrash = await replace(() => app.evaluate(({BrowserWindow}) => {
   const win = BrowserWindow.getAllWindows()[0];
   const execute = win.webContents.executeJavaScript.bind(win.webContents);
   win.webContents.executeJavaScript = (script, ...args) => {
    if (!script.includes("querySelector('.agy-face')")) return execute(script, ...args);
    return new Promise(resolve => {globalThis.completeOldLayout = resolve;});
   };
   watchdogTime += 1;
   globalThis.oldProbe = watchdog.tick(15000);
   win.webContents.forcefullyCrashRenderer();
  }));
  const fresh = await state();
  assert.notEqual(fresh.id, recovered.id);
  assert.equal(fresh.pid, original.pid);
  await app.evaluate(async () => {completeOldLayout(false); await oldProbe;});
  await tick(5000);
  assert.deepEqual(await state(), fresh);
  assert.match(log(), /renderer-gone reason=/);
  assert.equal((log().match(/visual-watchdog-recreate/g) || []).length, 1);

  // Exercise the real Web ownership policy.
  await postCrash.evaluate(() => widgetApi.save({petDisplayMode: 'prefer-web'}));
  const {webCompanion} = await postCrash.evaluate(() => widgetApi.get());
  const response = await fetch('http://127.0.0.1:' + webCompanion.port + '/companion/sync', {
   method: 'POST', headers: {'Content-Type': 'application/json', 'X-Catstella-Client': 'gemini-web-companion'},
   body: JSON.stringify({webActive: true, webVisible: true})
  });
  assert.equal(response.status, 200);
  await waitVisibility(false);
  await tick(60000);
  assert.deepEqual(await state(), {...fresh, visible: false});

  await postCrash.evaluate(() => widgetApi.save({petDisplayMode: 'both'}));
  await waitVisibility(true);
  await app.evaluate(({BrowserWindow}) => {
   const wc = BrowserWindow.getAllWindows()[0].webContents;
   const execute = wc.executeJavaScript.bind(wc);
   globalThis.pendingLayouts = 0;
   wc.executeJavaScript = (script, ...args) => {
    if (!script.includes("querySelector('.agy-face')")) return execute(script, ...args);
    pendingLayouts++;
    return new Promise(() => {});
   };
  });
  await tick(5000);
  assert.deepEqual(await state(), {...fresh, failures: 1}, 'one layout timeout leaves the window intact');
  await replace(() => tick(30000));
  assert.equal(await app.evaluate(() => pendingLayouts), 1, 'a timed-out request must not accumulate native calls');
  assert.match(log(), /visual-watchdog-recreate reason=layout-timeout/);
  assert.equal((await state()).pid, original.pid);
  await app.close();
  assert.match(log(), /exit code=0 reason=/);
  console.log('PASS: transient layout/capture failures, healthy reset, backoff, hidden/retired windows, drag, sustained blank/timeout, renderer exit, Web ownership and quit');
 } finally {
  if (child.exitCode === null && child.signalCode === null) await app.close().catch(() => {});
 }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
