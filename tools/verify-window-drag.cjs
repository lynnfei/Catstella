// Run the current source in real Electron windows with disposable configuration.
// This check does not need a packaged app, an AGY connection, or a browser account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { widgetLayout } = require('../Antigravity-Cat-Widget/src/domain/host-visibility.cjs');
const executablePath = require('electron');
const entry = path.resolve(__dirname, '../Antigravity-Cat-Widget/src/main/index.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catstella-window-'));
const settingsFile = path.join(directory, 'settings.json');
const bootstrap = path.join(directory, 'drag-fixture.cjs');
fs.writeFileSync(bootstrap, `
const { app, BrowserWindow, ipcMain, screen } = require('electron');
globalThis.dragTrace = [];
globalThis.unpressedMoves = [];
globalThis.syntheticPress = false;
globalThis.fixtureCursor = {x: -100000, y: -100000};
// CDP dispatches mouse events without moving the OS cursor. Give the real
// mouse-routing loop the same synthetic screen coordinates in this process.
app.whenReady().then(() => { screen.getCursorScreenPoint = () => fixtureCursor; });
app.on('browser-window-created', (_, win) => {
  win.webContents.on('before-mouse-event', (event, mouse) => {
    // A moved window can receive a real mousemove under the stationary OS
    // cursor. That event has no pressed button and cancels CDP's capture.
    if (!syntheticPress || mouse.type !== 'mouseMove' || mouse.button === 'left') return;
    if (unpressedMoves.length < 10) unpressedMoves.push({x: mouse.globalX, y: mouse.globalY});
    event.preventDefault();
  });
  const ignore = win.setIgnoreMouseEvents.bind(win);
  win.setIgnoreMouseEvents = (ignored, options) => {
    globalThis.mouseIgnored = ignored;
    return ignore(ignored, options);
  };
});
require(${JSON.stringify(entry)});
ipcMain.on('widget:drag', (_event, phase, dx, dy) => {
  const win = BrowserWindow.getAllWindows()[0];
  dragTrace.push({ phase, dx, dy, bounds: win.getBounds(),
    cursor: screen.getCursorScreenPoint(), ignored: mouseIgnored });
});
`);
fs.writeFileSync(settingsFile, JSON.stringify({
  bubbleOn: true, alwaysOnTop: false, clickThrough: false, autoUpdateCheck: false,
  hostWindowOnly: false, petDisplayMode: 'both', characterPack: 'lin-cat'
}));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const close = async app => {
  const process = app.process();
  let timer;
  try {
    await Promise.race([app.close(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Isolated Electron window did not close')), 6000);
    })]);
  } finally {
    clearTimeout(timer);
    if (process.exitCode === null && process.signalCode === null) process.kill();
  }
};
const settings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
const bounds = app => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
const contentBounds = app => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, message, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(30);
  }
  throw Error(message);
}
async function launch() {
  const app = await _electron.launch({
    executablePath, args: [bootstrap, '--data-dir=' + directory, '--isolated-dev'], env, timeout: 25000
  });
  try {
    const page = await app.firstWindow();
    await page.locator('#mascot[data-art-ready=true]').waitFor({ timeout: 12000 });
    await waitFor(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), 'Window did not become visible');
    const snapshot = await page.evaluate(() => window.widgetApi.get());
    assert.ok(snapshot.webCompanion.port > 0 && ![3921,3922,3923].includes(snapshot.webCompanion.port), 'the extension cannot find the isolated bridge');
    assert.equal(snapshot.webCompanion.online, false);
    assert.equal(snapshot.source.online, false);
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), path.join(directory, 'runtime'));
    return { app, page };
  } catch (error) {
    await close(app);
    throw error;
  }
}
const button = page => page.locator('#motion');
async function waitForOrigin(page, rect) {
  await page.waitForFunction(({x,y}) => screenX === x && screenY === y, rect, {timeout:3000});
}
function setCursor(app, point) {
  return app.evaluate((_, point) => {
    fixtureCursor = {x: Math.round(point.x), y: Math.round(point.y)};
  }, point);
}
function hitState(app, ignored) {
  if (process.platform !== 'win32') return Promise.resolve();
  return waitFor(() => app.evaluate((_, ignored) => mouseIgnored === ignored, ignored),
    ignored ? 'Transparent space must pass through' : 'Artwork must accept pointer input');
}
async function dragBy(app, page, dx, dy, expected) {
  const start = await bounds(app), nativeStart = await contentBounds(app);
  await waitForOrigin(page, nativeStart);
  const artStart = await page.evaluate(()=>widgetApi.get()).then(s=>[s.artShift,s.artShiftY]);
  const rect = await button(page).boundingBox();
  assert.ok(rect);
  const origin = { x: rect.x + rect.width / 2, y: rect.y + Math.min(rect.height / 3, 72) };
  const initialHit = await page.evaluate(({x,y}) => {
    window.dragTrace = [];
    if (!window.dragTraceReady) {
      window.dragTraceReady = true;
      for (const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture']) {
        document.addEventListener(type, e => window.dragTrace.push({type, target:e.target.id||e.target.className,
          client:[e.clientX,e.clientY], screen:[e.screenX,e.screenY], origin:[screenX,screenY], buttons:e.buttons}), true);
      }
      window.addEventListener('blur', () => window.dragTrace.push({type:'blur'}));
    }
    const target = document.elementFromPoint(x,y);
    return {target: target?.id || target?.className, motion: !!target?.closest('#motion'),
      origin: [screenX,screenY], viewport:[innerWidth,innerHeight], dpr:devicePixelRatio,
      facing: document.querySelector('#mascot').dataset.facing};
  }, origin);
  const press = {x:nativeStart.x + origin.x, y:nativeStart.y + origin.y};
  const release = {x:press.x + dx, y:press.y + dy};
  let moved;
  let saved;
  try {
    assert(initialHit.motion, 'The planned press must hit the artwork');
    await setCursor(app, {x:nativeStart.x+5, y:nativeStart.y+5});
    await hitState(app, true);
    await setCursor(app, press);
    await hitState(app, false);
    await app.evaluate(() => {dragTrace.length = 0; unpressedMoves.length = 0;});
    await page.mouse.move(origin.x, origin.y);
    await app.evaluate(() => {syntheticPress = true;});
    await page.mouse.down();
    await setCursor(app, release);
    await page.mouse.move(origin.x + dx, origin.y + dy);
    moved = await waitFor(async () => {
      const actual = await bounds(app);
      const s = await page.evaluate(()=>widgetApi.get());
      return actual.x !== start.x || actual.y !== start.y || s.artShift!==artStart[0] || s.artShiftY!==artStart[1] ? actual : null;
    }, 'The real Electron window did not move before mouseup');
    assert.equal(settings().x, expected.previousX, 'do not write settings during movement');
    if (expected.facing) {
      await page.locator('#mascot[data-facing="' + expected.facing + '"]').waitFor({ timeout:3000 });
    }
    // Wait for Chromium's screen origin to catch up with the native move
    // before translating the same screen point back to renderer coordinates.
    const movedContent = await contentBounds(app);
    await waitForOrigin(page, movedContent);
    await page.mouse.move(release.x - movedContent.x, release.y - movedContent.y);
    await page.mouse.up();
    saved = await waitFor(() => {
      const saved = settings();
      // The injected pointer may round a DIP at fractional Windows scaling.
      const tolerance = expected.tolerance ?? 0;
      return Math.abs(saved.x - expected.x) <= tolerance && Math.abs(saved.y - expected.y) <= tolerance ? saved : null;
    }, 'Position was not saved at ' + JSON.stringify({ x: expected.x, y: expected.y }));
  } catch (error) {
    console.error(JSON.stringify({ start, nativeStart, artStart, rect, origin, initialHit, moved, final:await bounds(app), requested:{dx,dy},
      saved:{x:settings().x,y:settings().y}, renderer:await page.evaluate(() => window.dragTrace),
      main:await app.evaluate(() => ({ipc:dragTrace, unpressedMoves})) }));
    throw error;
  } finally {
    await app.evaluate(() => {syntheticPress = false;});
  }
  const final = await bounds(app);
  assert.equal(final.x, saved.x);
  assert.equal(final.y, saved.y);
  assert.equal(await page.locator('#bubble').getAttribute('data-open'), 'false', 'dragging does not open the bubble');
  const renderer = await page.evaluate(() => window.dragTrace);
  const ipc = await app.evaluate(() => dragTrace);
  const down = renderer.find(event => event.type === 'pointerdown');
  const up = renderer.find(event => event.type === 'pointerup');
  const move = ipc.find(event => event.phase === 'move');
  const end = ipc.find(event => event.phase === 'end');
  assert(renderer.some(event => event.type === 'gotpointercapture' && event.target === 'motion'));
  assert.equal(ipc[0]?.phase, 'start');
  assert(down && up && move && end, 'the renderer and main process must agree on the full drag');
  assert(ipc.every(event => event.ignored === false || event.phase === 'end'), 'native hit testing stays enabled while dragging');
  for (const event of [move, end]) {
    assert(Math.abs(event.dx-dx) <= 2 && Math.abs(event.dy-dy) <= 2,
      'IPC must carry the screen-space drag delta before and after the native window moves');
  }
  if (expected.facing) console.log(JSON.stringify({check:'first-drag-after-restart', start, hit:initialHit, press, release, down, up, moved, final, ipc,
    unpressedMoves:await app.evaluate(() => unpressedMoves)}));
  return final;
}

(async () => {
  const first = await launch();
  let final, displayCount, upperSaved;
  try {
    const start = await bounds(first.app);
    const displays = await first.app.evaluate(({ screen }) => screen.getAllDisplays().map(d => ({...d.workArea,scaleFactor:d.scaleFactor})));
    console.log('Windows displays:', displays);
    displayCount = displays.length;
    const area = displays.find(d => start.x >= d.x && start.x < d.x + d.width && start.y >= d.y && start.y < d.y + d.height);
    assert.ok(area, 'The window must start in a display work area');
    // At fractional DPI, Win32 can report a different outer size before the
    // first setBounds. Snapping uses the app's logical window dimensions.
    const layout = widgetLayout(area, settings().scale || 220);
    const right = area.x + area.width - layout.width, bottom = area.y + area.height - layout.height;
    assert.ok(start.x - area.x >= 70 && start.y - area.y >= 26, 'need enough free workspace to exercise a diagonal drag');
    const free = await dragBy(first.app, first.page, -65, -24, { previousX:undefined, x:start.x-65, y:start.y-24, tolerance:2 });
    const top = await dragBy(first.app,first.page,0,area.y-free.y-374,{previousX:free.x,x:free.x,y:area.y,tolerance:2});
    const topArt=await first.page.locator('#mascot').boundingBox();
    console.log('Upper placement:',{top,topArt,viewport:await first.page.evaluate(()=>({height:innerHeight,widget:document.querySelector('#widget').getBoundingClientRect().toJSON()})),native:await first.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getContentBounds()),snapshot:await first.page.evaluate(()=>widgetApi.get()).then(s=>({shift:s.artShiftY,scale:s.displayScale}))});
    assert(Math.abs(top.y+topArt.y-area.y-10)<3,'artwork reaches the upper work area');
    await first.page.locator('#toggle').click();
    // The bubble must use the space below the artwork rather than clip above the screen.
    await first.page.waitForTimeout(220);
    assert.equal(await first.page.locator('#mascot').getAttribute('data-bubble-below'),'true');
    const upperBubble=await first.page.locator('#bubble').boundingBox();
    assert(upperBubble&&upperBubble.y>=0&&upperBubble.y+upperBubble.height<=top.height,'upper artwork bubble is fully inside the window');
    await first.page.locator('#close').click();
    const upper=await first.page.evaluate(()=>widgetApi.get());
    const left=await dragBy(first.app,first.page,area.x-upper.settings.x-70-upper.artShift,0,{previousX:top.x,x:area.x,y:area.y,tolerance:2});
    const leftArt=await first.page.locator('#mascot').boundingBox();
    assert(Math.abs(left.x+leftArt.x-area.x)<3,'left docking reaches the actual artwork edge');
    upperSaved=settings();
    const reset=await first.app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return w.getBounds();});
    const pos=await first.page.evaluate(()=>widgetApi.get());
    // Move from the upper-left artwork back to the lower-right work area.
    const dx=area.x+area.width-pos.displayScale-(reset.x+(reset.width-pos.displayScale)/2+pos.artShift);
    const dy=bottom-(reset.y+pos.artShiftY);
    final = await dragBy(first.app, first.page, dx, dy, {
      previousX:left.x, x:right, y:bottom,tolerance:2
    });
    const rect = await button(first.page).boundingBox();
    await first.page.mouse.click(rect.x + rect.width / 2, rect.y + Math.min(rect.height / 3, 72));
    await first.page.locator('#bubble[data-open=true]').waitFor({ timeout:5000 });
  } finally { await close(first.app); }
  const restarted = await launch();
  try {
    assert.deepEqual(await bounds(restarted.app), final, 'Restart must restore the snapped native window bounds');
    assert.equal((await restarted.page.evaluate(()=>widgetApi.get())).dockSide,'right','restart restores the artwork edge, not only the window');
    const area = await restarted.app.evaluate(({screen}, rect) => screen.getDisplayMatching(rect).workArea, final);
    const {artShift,displayScale} = await restarted.page.evaluate(()=>widgetApi.get());
    const artCenter = final.x + final.width/2 + artShift;
    const targetCenter = Math.round(area.x + area.width/2 - 42);
    const targetX = targetCenter - widgetLayout(area, displayScale).width/2;
    await dragBy(restarted.app, restarted.page, targetCenter-artCenter, 0, {
      previousX:final.x, x:targetX, y:final.y, tolerance:2, facing:'left'
    });
  }
  finally { await close(restarted.app); }
  fs.writeFileSync(settingsFile,JSON.stringify(upperSaved));
  const upperRestart=await launch();
  try{
    const s=await upperRestart.page.evaluate(()=>widgetApi.get());
    assert.equal(s.artShiftY,upperSaved.desktopArtShiftY);assert.equal(s.dockSide,'left');
    const b=await bounds(upperRestart.app),art=await upperRestart.page.locator('#mascot').boundingBox();
    const area=await upperRestart.app.evaluate(({screen},b)=>screen.getDisplayMatching(b).workArea,b);
    assert(Math.abs(b.x+art.x-area.x)<3&&Math.abs(b.y+art.y-area.y-10)<3,'upper-left artwork position survives restart');
    await upperRestart.page.evaluate(()=>widgetApi.save({scale:260}));
    await upperRestart.page.waitForFunction(()=>document.querySelector('#mascot').style.getPropertyValue('--agy-width')==='260px');
    const scaledBounds=await bounds(upperRestart.app),scaledArt=await upperRestart.page.locator('#mascot').boundingBox();
    assert(Math.abs(scaledBounds.x+scaledArt.x-area.x)<3&&Math.abs(scaledBounds.y+scaledArt.y-area.y-10)<3,'resizing must not send an upper dock back to the bottom');
  }finally{await close(upperRestart.app);}
  console.log(JSON.stringify({ passed:['native-window-drag','upper-half','bubble-below','dock-left-right','snap-right-bottom','save-on-release','tap-after-drag','restart-upper-left-and-lower-right','facing-before-release'], displayCount, temporarySettings:directory }));
})().catch(error => { console.error(error); process.exitCode = 1; });
