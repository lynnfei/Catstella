// Native fixed media must keep its viewport containing block when themed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
async function main(){
 const browser=await chromium.launch({headless:true,channel:process.env.SKIN_BROWSER_CHANNEL||'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:900,height:700}});
  await page.setContent(`<style>
   body{margin:0;background:#ddd}.cdk-overlay-container{position:fixed;inset:0;z-index:1000}
   .cdk-overlay-backdrop{position:absolute;inset:0;background:#2229}.cdk-overlay-pane{position:relative}
   [role=dialog]{display:block}header{height:64px;padding:12px;background:#17131e;color:#fff}
   .media-stage{position:fixed;inset:80px 16px 16px}img{width:100%;height:100%;object-fit:contain}
  </style><main>Conversation</main><div class="cdk-overlay-container"><div class="cdk-overlay-backdrop image-expansion-dialog-backdrop"></div><div class="cdk-overlay-pane image-expansion-dialog"><mat-dialog-container role="dialog"><header><button id="back">Back</button> image.png</header><div class="media-stage"><img id="photo"></div></mat-dialog-container></div></div>`);
  await page.locator('#photo').evaluate(n=>{n.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="550"><rect width="800" height="550" fill="#e05060"/><circle cx="400" cy="275" r="100" fill="#30b080"/></svg>');return n.decode();});
  const baseline=await page.locator('.media-stage').boundingBox();
  await page.addStyleTag({path:path.join(root,'content/skin.css')});await page.locator('html').evaluate(n=>n.classList.add('kimino-dream-active'));
  assert.deepEqual(await page.locator('.media-stage').boundingBox(),baseline,'media must not collapse to the header-only dialog box');
  assert.equal(await page.locator('[role=dialog]').evaluate(n=>getComputedStyle(n).backdropFilter),'none');
  assert((await page.locator('#photo').boundingBox()).height>500);
  assert.equal(await page.locator('#photo').evaluate(n=>n.complete&&n.naturalWidth>0),true);
  await page.locator('#photo').evaluate(n=>{const canvas=document.createElement('canvas');canvas.width=800;canvas.height=550;canvas.id='canvas';canvas.style.cssText='width:100%;height:100%';n.replaceWith(canvas);});
  assert.deepEqual(await page.locator('.media-stage').boundingBox(),baseline,'canvas viewers must retain viewport geometry too');
  // A different native media dialog and a late-added image need the same guard.
  await page.locator('.image-expansion-dialog').evaluate(n=>n.classList.remove('image-expansion-dialog'));
  assert.deepEqual(await page.locator('.media-stage').boundingBox(),baseline);
  await page.locator('[role=dialog]').evaluate(n=>{n.innerHTML='<header><button id="back">Back</button> file.png</header><div class="media-stage"></div>';});
  await page.locator('.media-stage').evaluate(n=>{const image=document.createElement('img');image.src='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"/%3E';n.append(image);});
  assert.deepEqual(await page.locator('.media-stage').boundingBox(),baseline,'late-added media must work without waiting for a scanner');
  await page.evaluate(()=>{document.querySelector('#back').onclick=()=>document.querySelector('.cdk-overlay-container').remove();});
  await page.locator('#back').click();assert.equal(await page.locator('.cdk-overlay-container').count(),0);
  await page.setContent('<html class="kimino-dream-active"><div role="dialog">Text-only settings dialog</div></html>');await page.addStyleTag({path:path.join(root,'content/skin.css')});
  assert.match(await page.locator('[role=dialog]').evaluate(n=>getComputedStyle(n).backdropFilter),/blur/,'text-only dialogs keep their glass theme');
  console.log('PASS: native image/canvas viewers retain viewport geometry, late media and close controls; ordinary dialogs retain glass.');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
