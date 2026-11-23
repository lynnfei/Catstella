// Pixel checks for the static fade: wallpaper alignment, alpha, stacking, transforms.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const source = path.join(root, process.argv.includes('--built') ? 'dist/chromium/content' : 'content');
const out = path.resolve(root, '../evidence');

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.SKIN_BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.setContent('<html class="kimino-dream-active"><body><div id="kimino-base-layer"></div><div id="kimino-dream-wallpaper"></div><infinite-scroller class="chat-history"><div id="foreground"><model-response></model-response></div></infinite-scroller><input-container><input-area-v2><rich-textarea contenteditable="true">composer</rich-textarea><button id="composer-button">Click</button><i id="composer-marker"></i></input-area-v2></input-container></body></html>');
    await page.addStyleTag({ content: 'body{margin:0}#kimino-dream-wallpaper{left:100px;top:0;width:900px;height:800px}infinite-scroller{display:block;height:740px;overflow:auto}#foreground{position:fixed;left:100px;top:0;width:900px;height:800px;background:rgb(255,0,0);z-index:0}input-container{position:fixed;left:200px;bottom:80px;width:600px;z-index:2}input-area-v2{display:block;position:relative;height:120px;box-sizing:border-box}#composer-marker{position:absolute;bottom:8px;left:16px;width:12px;height:12px;background:rgb(0,0,255)}' });
    await page.addStyleTag({ path: path.join(source, 'skin.css') });
    await page.addScriptTag({ path: path.join(source, 'fade.js') });
    await page.evaluate(() => {
      const source = document.getElementById('kimino-dream-wallpaper');
      const image = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="800"><defs><pattern id="p" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="#a173d6"/><rect width="50" height="50" fill="#64b9c6"/></pattern></defs><rect width="900" height="800" fill="url(#p)"/></svg>';
      source.style.backgroundImage = 'linear-gradient(rgba(20,15,35,.38),rgba(20,15,35,.62)),url("data:image/svg+xml,' + encodeURIComponent(image) + '")';
      source.style.opacity = '.64';
      window.updateFade = () => window.fade.update(source, .64, document.querySelector('rich-textarea'));
      window.fade = new window.KiminoFixedFade(() => window.updateFade());
      window.updateFade();
      window.clicked = 0;
      document.querySelector('#composer-button').onclick = () => window.clicked++;
    });
    await page.waitForTimeout(700); // Allow image decoding and the shared opacity transition.
    const geometry = await page.locator('input-area-v2').boundingBox();
    const start = geometry.y - 8, end = geometry.y + 56;
    const raw = async () => sharp(await page.screenshot()).removeAlpha().raw().toBuffer();
    const pixel = (bytes, x, y) => [...bytes.subarray((Math.round(y) * 1000 + x) * 3, (Math.round(y) * 1000 + x) * 3 + 3)];
    const delta = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    await page.evaluate(() => { document.getElementById('foreground').style.visibility = 'hidden'; document.getElementById('kimino-static-fade').style.visibility = 'hidden'; });
    const wallpaper = await raw();
    await page.evaluate(() => { document.getElementById('foreground').style.visibility = 'visible'; });
    const foreground = await raw();
    await page.evaluate(() => { document.getElementById('kimino-static-fade').style.visibility = 'visible'; });
    const composite = await raw();
    assert.ok(delta(pixel(composite, 950, end + 20), pixel(wallpaper, 950, end + 20)) <= 2, 'full fade must match the patterned wallpaper exactly');
    assert.ok(delta(pixel(composite, 950, start - 20), pixel(foreground, 950, start - 20)) <= 2, 'content above the band must remain unchanged');
    const middle = pixel(composite, 950, (start + end) / 2);
    assert.ok(delta(middle, pixel(wallpaper, 950, (start + end) / 2)) > 5);
    assert.ok(delta(middle, pixel(foreground, 950, (start + end) / 2)) > 5);
    assert.ok(delta(pixel(composite, 222, geometry.y + geometry.height - 14), [0, 0, 255]) <= 1, 'composer must paint above the fade');
    await page.locator('#composer-button').click();
    assert.equal(await page.evaluate(() => window.clicked), 1, 'fade must not intercept input');
    await page.locator('input-container').evaluate(el => { el.style.transform = 'translate(30px,-10px) scale(.9)'; window.updateFade(); });
    await page.waitForTimeout(100);
    const rect = await page.locator('#kimino-static-fade').boundingBox();
    assert.ok(Math.abs(rect.x - 100) < .5 && Math.abs(rect.y) < .5 && Math.abs(rect.width - 900) < .5 && Math.abs(rect.height - 800) < .5, 'transformed composer must not move/stretch the wallpaper plane');
    const transformed = await raw();
    assert.ok(delta(pixel(transformed, 933, 733), pixel(wallpaper, 933, 733)) <= 3,
      'transformed-host wallpaper must remain aligned: ' + JSON.stringify([pixel(transformed, 933, 733), pixel(wallpaper, 933, 733)]));
    const oldMask = await page.locator('#kimino-static-fade').evaluate(el => el.style.maskImage);
    await page.locator('input-area-v2').evaluate(el => { el.style.height = '160px'; });
    await page.waitForTimeout(100);
    assert.notEqual(await page.locator('#kimino-static-fade').evaluate(el => el.style.maskImage), oldMask, 'composer resizing must update the stationary band without a scroll');
    // Split chat + embedded map: a growing composer must not fade the sibling pane.
    await page.evaluate(() => {
      const scroller=document.querySelector('infinite-scroller');
      scroller.style.cssText='position:fixed;left:100px;top:0;width:520px;height:740px;overflow:auto';
      document.querySelector('input-container').style.cssText='position:fixed;left:120px;bottom:40px;width:380px;z-index:2';
      document.querySelector('input-area-v2').style.height='80px';
      const aside=document.createElement('aside');aside.id='map-panel';
      aside.style.cssText='position:fixed;left:640px;top:20px;width:340px;height:740px;z-index:1';
      const frame=document.createElement('iframe');frame.title='Map';frame.style.cssText='border:0;width:100%;height:100%';
      frame.srcdoc='<body style="margin:0;background:rgb(18,91,68)"><button style="margin:30px" onclick="document.body.dataset.clicks=Number(document.body.dataset.clicks||0)+1">Map marker</button></body>';
      aside.append(frame);document.body.append(aside);window.updateFade();
    });
    await page.frameLocator('#map-panel iframe').getByRole('button',{name:'Map marker'}).waitFor();
    await page.evaluate(()=>{document.querySelector('#foreground').style.visibility='hidden';document.querySelector('#kimino-static-fade').style.visibility='hidden';});
    const splitWallpaper=await raw();
    await page.evaluate(()=>{document.querySelector('#foreground').style.visibility='visible';document.querySelector('#kimino-static-fade').style.visibility='visible';});
    const mapBefore=await raw();
    const mapBounds=await page.locator('#map-panel').boundingBox();
    await page.locator('input-area-v2').evaluate(el => { el.style.height='280px'; });
    await page.waitForTimeout(120);
    const mapAfter=await raw();
    assert.ok(delta(pixel(mapAfter,900,570),pixel(mapBefore,900,570))<=2,'typing/growing input must not paint the chat fade over the map');
    assert.deepEqual(await page.locator('#map-panel').boundingBox(),mapBounds,'input growth cannot move the sidebar');
    assert.ok(delta(pixel(mapAfter,600,720),pixel(splitWallpaper,600,720))<=3,'conversation margins still fade behind the tall composer: '+JSON.stringify({actual:pixel(mapAfter,600,720),expected:pixel(splitWallpaper,600,720),layer:await page.locator('#kimino-static-fade').evaluate(n=>({rect:n.getBoundingClientRect().toJSON(),clip:n.style.clipPath,mask:n.style.maskImage,opacity:n.firstChild.style.opacity})),composer:await page.locator('input-area-v2').boundingBox()}));
    await page.frameLocator('#map-panel iframe').getByRole('button',{name:'Map marker'}).click();
    assert.equal(await page.frameLocator('#map-panel iframe').locator('body').getAttribute('data-clicks'),'1');
    await page.locator('input-container').evaluate(el=>{el.style.transform='translate(12px,-6px) scale(.94)';window.updateFade();});
    assert.ok(delta(pixel(await raw(),900,570),pixel(mapBefore,900,570))<=2,'transformed composer must also preserve the map');
    await page.evaluate(()=>{document.querySelector('infinite-scroller').style.width='680px';const map=document.querySelector('#map-panel');map.style.left='800px';map.style.width='180px';});
    await page.waitForTimeout(120);
    assert.ok(delta(pixel(await raw(),900,570),pixel(mapBefore,900,570))<=2,'resizing the split view must update the fade boundary');
    await page.screenshot({path:path.join(out,'split-pane-long-input.png')});
    await page.evaluate(()=>{document.querySelector('#map-panel').remove();document.querySelector('infinite-scroller').style.width='900px';});
    await page.waitForTimeout(120);
    assert.ok(delta(pixel(await raw(),950,720),pixel(wallpaper,950,720))<=3,'closing the sidebar restores full-width conversation fading');
    await page.evaluate(() => window.fade.destroy());
    assert.equal(await page.locator('#kimino-static-fade').count(), 0);
    assert.equal(await page.locator('[data-kg-fade-host]').count(), 0);
    fs.writeFileSync(path.join(out, 'static-fade-verification.json'), JSON.stringify({ wallpaperAligned: true, opacityComposited: true, contentUnaffectedAboveBand: true, composerAboveFade: true, inputUnblocked: true, translatedScaledHostAligned: true, sidebarPreserved: true, composerGrowthIsolated: true, mapInteractive: true, splitResizeAndClose: true, cleanup: true }, null, 2));
    console.log('PASS: patterned wallpaper/opacity pixels, static fade, composer stacking, pointer input, transformed host, split-pane typing/map/resize/close, cleanup.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
