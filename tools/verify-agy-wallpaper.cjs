const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { installTheme } = require('../Antigravity-Dream-Skin/src/host/theme.cjs');

async function main() {
  const browser = await chromium.launch({ headless:true,channel: process.env.SKIN_BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<main id="root" style="width:100vw;height:100vh"><section class="agy-sheet" style="width:900px;height:650px">host fixture</section></main>');
    await page.evaluate(() => {
      window.foreground = true;
      document.hasFocus = () => window.foreground;
      window.focusHost = value => { window.foreground = value; window.dispatchEvent(new Event(value ? 'focus' : 'blur')); };
      window.config = { owner: 'test', opacity: 1, scrim: 0, transition: 'fade' };
      window.images = ['red', 'blue', 'lime', 'purple'].map((color, i) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${180 + i * 20}" height="120"><rect width="100%" height="100%" fill="${color}"/></svg>`));
      window.layer = () => document.querySelector('#agy-dream-wallpaper-v2');
      window.update = index => window.__agyDreamSkinV2.update({ ...config, image: images[index] });
    });
    const config = await page.evaluate(() => ({ ...window.config, image: images[0] }));
    assert.equal((await page.evaluate(installTheme, config)).applied, true);
    // An unchanged-image update must invalidate a different image still decoding.
    await page.evaluate(()=>{
      const decode=Image.prototype.decode;
      Image.prototype.decode=function(){return decode.call(this).then(()=>new Promise(resolve=>{window.finishDecode=resolve;}));};
      window.restoreDecode=()=>{Image.prototype.decode=decode;};
      window.lateUpdate=update(1);
    });
    await page.waitForFunction(()=>typeof window.finishDecode==='function');
    await page.evaluate(async()=>{await update(0);restoreDecode();finishDecode();await lateUpdate;});
    assert.equal(await page.locator('.agy-dream-wallpaper-incoming').count(),0,'late decoding cannot overwrite the newest selection of the already-presented image');
    assert.equal(await page.evaluate(()=>layer().style.backgroundImage.includes(images[0])),true);
    // An appearance-only edit must survive a concurrently decoding wallpaper.
    await page.evaluate(()=>{
      const decode=Image.prototype.decode;
      Image.prototype.decode=function(){return decode.call(this).then(()=>new Promise(resolve=>{window.finishDecode=resolve;}));};
      window.restoreDecode=()=>{Image.prototype.decode=decode;};window.finishDecode=null;
      window.lateUpdate=update(1);
    });
    await page.waitForFunction(()=>typeof window.finishDecode==='function');
    await page.evaluate(async()=>{__agyDreamSkinV2.updateAppearance({replyOpacity:37});restoreDecode();finishDecode();await lateUpdate;});
    assert.equal(await page.locator('#root').evaluate(n=>n.style.getPropertyValue('--agy-reply-alpha')),'0.37','a late decoded image must not restore stale opacity');
    await page.evaluate(()=>__agyDreamSkinV2.update({...config,image:images[0],transition:'none'}));
    await page.evaluate(()=>update(1));
    await page.waitForFunction(()=>Number(getComputedStyle(layer().lastElementChild).opacity)>.12);
    const progress=await page.evaluate(()=>{
      window.originalIncoming=layer().lastElementChild;
      return Number(getComputedStyle(originalIncoming).opacity);
    });
    await page.evaluate(async()=>{
      for(let i=0;i<8;i++)await __agyDreamSkinV2.update({...config,image:images[1],chatOpacity:40+i});
    });
    assert.equal(await page.evaluate(()=>layer().lastElementChild===originalIncoming),true,'same-wallpaper setting changes must retain the active animation');
    assert(await page.evaluate(()=>Number(getComputedStyle(originalIncoming).opacity))>=progress,'duplicate settings must not reset fade progress');
    await page.evaluate(()=>focusHost(false));
    const paused=await page.evaluate(()=>Number(getComputedStyle(originalIncoming).opacity));
    await page.waitForTimeout(150);
    assert(Math.abs(await page.evaluate(()=>Number(getComputedStyle(originalIncoming).opacity))-paused)<.01,'blur must freeze the presented blend, not jump back to the old image');
    await page.evaluate(()=>focusHost(true));
    await page.waitForFunction(()=>layer().style.backgroundImage.includes(images[1])&&!layer().firstElementChild);
    await page.evaluate(()=>__agyDreamSkinV2.update({...config,image:images[0],transition:'none'}));
    await page.evaluate(async () => { await update(1); focusHost(false); await update(2); await update(3); });
    assert.equal(await page.evaluate(() => layer().style.backgroundImage.includes(images[0])), true);
    assert.ok(await page.locator('.agy-dream-wallpaper-incoming').count()<=1,'a paused blend may remain visible while a newer background wallpaper is queued');
    await page.evaluate(() => focusHost(true));
    await page.waitForFunction(() => layer().lastElementChild?.style.backgroundImage.includes(images[3]));
    assert.equal(await page.evaluate(() => layer().style.backgroundImage.includes(images[0])), true, 'the last presented wallpaper stays below the fade');
    await page.waitForFunction(() => layer().style.backgroundImage.includes(images[3]) && !layer().firstElementChild);
    await page.evaluate(async () => { focusHost(false); await __agyDreamSkinV2.update({ ...config, image: images[1], transition: 'none' }); });
    assert.equal(await page.evaluate(() => layer().style.backgroundImage.includes(images[1])), true, 'explicit no-transition settings still apply directly');
    assert.deepEqual(errors, []);
    console.log('PASS: AGY wallpaper keeps the committed background and fades only the latest queued image on activation.');
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
