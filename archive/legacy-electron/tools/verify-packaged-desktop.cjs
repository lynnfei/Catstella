const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

async function main() {
  const executablePath = path.resolve(process.argv[2]);
  const dataDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'catstella-window-'));
  fs.writeFileSync(path.join(dataDir,'settings.json'),JSON.stringify({x:90000,y:90000,clickThrough:false}));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath, args: ['--isolated-dev','--data-dir=' + dataDir], env, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.widgetApi && document.getElementById('mascot')?.dataset.artReady === 'true');
    const state = await page.evaluate(() => window.widgetApi.get());
    assert(state.settings && state.dreamSkin && state.wallpapers.length);
    assert.equal(state.byok.available, false);
    assert.equal(await page.evaluate(() => typeof window.widgetApi.byok), 'undefined');
    const initial = await app.evaluate(({BrowserWindow,screen}) => {
      const win=BrowserWindow.getAllWindows()[0],bounds=win.getBounds(),area=screen.getDisplayMatching(bounds).workArea;
      return {bounds,area};
    });
    // Fractional display scaling can round native bounds by one DIP.
    assert(initial.bounds.x>=initial.area.x-2 && initial.bounds.x+initial.bounds.width<=initial.area.x+initial.area.width+2);
    assert(initial.bounds.y>=initial.area.y-2 && initial.bounds.y+initial.bounds.height<=initial.area.y+initial.area.height+2);
    await app.evaluate(({BrowserWindow}) => {
      const win=BrowserWindow.getAllWindows()[0],setIgnore=win.setIgnoreMouseEvents.bind(win);
      globalThis.ignoreDuringDrag=[];
      win.setIgnoreMouseEvents=(ignore,...args)=>{globalThis.ignoreDuringDrag.push(ignore);return setIgnore(ignore,...args);};
    });
    await page.evaluate(()=>{
      window.widgetApi.drag('start');
      window.widgetApi.hit(false);
      window.widgetApi.drag('move',-40,-25);
    });
    await page.waitForTimeout(100);
    const during=await app.evaluate(({BrowserWindow})=>({bounds:BrowserWindow.getAllWindows()[0].getBounds(),ignored:globalThis.ignoreDuringDrag}));
    assert(during.bounds.x!==initial.bounds.x || during.bounds.y!==initial.bounds.y,'the packaged native window must move');
    assert(!during.ignored.includes(true),'moving off the hit region must not interrupt dragging');
    await page.evaluate(()=>window.widgetApi.drag('end',-40,-25));
    await page.waitForTimeout(100);
    const saved=JSON.parse(fs.readFileSync(path.join(dataDir,'settings.json'),'utf8'));
    assert(Number.isFinite(saved.x)&&saved.x!==90000&&Number.isFinite(saved.y)&&saved.y!==90000);
    const [settingsPage]=await Promise.all([app.waitForEvent('window'),page.evaluate(()=>window.widgetApi.command('settings'))]);
    const notes=settingsPage.getByRole('dialog',{name:/更新内容/});
    await notes.waitFor();
    await settingsPage.waitForFunction(async()=>await window.widgetApi.releaseNotes()===null);
    assert(JSON.parse(fs.readFileSync(path.join(dataDir,'settings.json'),'utf8')).seenReleaseNotes.includes(state.version || require('../package.json').version));
    await notes.getByRole('button',{name:'知道了'}).click();
    await settingsPage.reload();
    await settingsPage.waitForFunction(()=>Boolean(window.widgetApi));
    assert.equal(await settingsPage.evaluate(()=>window.widgetApi.releaseNotes()),null,'seen release notes stay dismissed after reopening settings');
    console.log('PASS: packaged app restores an on-screen position, drags without click-through, and saves its location.');
  } finally {
    await app.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
