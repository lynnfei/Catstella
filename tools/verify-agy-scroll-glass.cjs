// Native scroll masks form a backdrop root. Verify pixels, not just blur CSS.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),sharp=require('sharp');
const {installTheme}=require('../Antigravity-Dream-Skin/src/host/theme.cjs');
const root=path.resolve(__dirname,'..');
async function main(){
 const browser=await chromium.launch({headless:true,channel:process.env.SKIN_BROWSER_CHANNEL||'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:800}});
  await page.setContent(`<style>
   body{margin:0;background:#17121c}#root{height:800px}.agy-sheet{height:800px;width:1000px}
   #chat{height:650px;overflow-y:auto;isolation:isolate;container-type:size;overflow-anchor:none;mask-image:linear-gradient(transparent,black 28px)}
   .scroll-mt-4{padding-top:60px;width:720px;margin-left:120px}.answer{height:1200px}
  </style><main id="root"><section class="agy-sheet"><div data-testid="autoscroll-viewport" class="h-full overflow-y-auto isolate outline-none" id="chat"><div class="scroll-mt-4"><div data-testid="agent-response"><div class="px-2 py-1"><div class="answer leading-relaxed select-text"></div></div></div></div></div></section></main>`);
  const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><defs><pattern id="p" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#100040"/><rect width="8" height="16" fill="#fff080"/></pattern></defs><rect width="1000" height="800" fill="url(#p)"/></svg>');
  const config={owner:'scroll-glass-test',image,wallpaperId:'stripes',opacity:1,scrim:0,outputMode:'glass',replyOpacity:0,transition:'none'};
  await page.evaluate(installTheme,config);
  await page.waitForTimeout(350);
  const contrast=async()=>{
   const {data,info}=await sharp(await page.screenshot()).removeAlpha().raw().toBuffer({resolveWithObject:true});
   const range=(left,right)=>{const values=[];for(let x=left;x<right;x++)values.push(data[(300*info.width+x)*3]);return Math.max(...values)-Math.min(...values);};
   return{inside:range(300,420),outside:range(30,110)};
  };
  const masked=await contrast();
  assert(masked.outside>150,'wallpaper stripe reference must remain sharp');
  assert(masked.inside<masked.outside*.2,'reply must visibly blur the wallpaper through the native scroll wrapper: '+JSON.stringify(masked));
  const samples=[masked];
  for(const top of [120,310,200]){
   await page.locator('#chat').evaluate((n,top)=>{n.scrollTop=top;n.style.maskImage='none';setTimeout(()=>{n.style.maskImage='linear-gradient(transparent,black 28px)';},60);},top);
   await page.waitForTimeout(180);
   const sample=await contrast();samples.push(sample);
   assert(sample.inside<sample.outside*.2,'blur must survive native mask restoration after scrolling: '+JSON.stringify(sample));
  }
  const late=await page.evaluate(()=>{
   const chat=document.querySelector('#chat');chat.scrollTop=0;
   chat.innerHTML='<div class="scroll-mt-4"><div data-testid="agent-response"><div class="answer markdown-body"></div></div></div>';
   chat.className='isolate';
   chat.style.maskImage='linear-gradient(transparent,black 28px)';
   return getComputedStyle(chat).maskImage;
  });
  assert.equal(late,'none','virtualized/late replies work on their first frame without waiting for scan');
  await page.waitForTimeout(180);const recycled=await contrast();samples.push(recycled);
  assert(recycled.inside<recycled.outside*.2);
  await page.evaluate(()=>{
   const add=(parent,id,html)=>{const node=document.createElement('div');node.id=id;node.className='overflow-y-auto';node.style.cssText='position:fixed;top:720px;left:20px;width:80px;height:40px;mask-image:linear-gradient(transparent,black 28px)';node.innerHTML=html;parent.append(node);return node;};
   add(document.body,'aux-scroll','<div class="prose">Reference pane</div>');
   add(document.querySelector('.agy-sheet'),'user-only-scroll','<div data-testid="user-message-bubble">User</div>');
   const editor=add(document.querySelector('.agy-sheet'),'editor-scroll','<div class="prose">Editor</div>');editor.classList.add('monaco-editor');
  });
  for(const id of ['aux-scroll','user-only-scroll','editor-scroll'])assert.match(await page.locator('#'+id).evaluate(n=>getComputedStyle(n).maskImage),/gradient/,'unrelated masks must be preserved: '+id);
  await page.evaluate(()=>__agyDreamSkinV2.updateAppearance({replyOpacity:27}));
  assert.equal(await page.locator('.answer').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(24, 18, 36, 0.27)','keep independently configured reply alpha');
  await page.evaluate(()=>__agyDreamSkinV2.updateAppearance({replyOpacity:0}));
  await page.screenshot({path:path.join(root,'evidence/agy-scroll-glass-2026-11-11.png')});
  await page.evaluate(c=>__agyDreamSkinV2.update({...c,outputMode:'transparent'}),config);
  assert.match(await page.locator('#chat').evaluate(n=>getComputedStyle(n).maskImage),/gradient/,'native scroll fade is retained outside glass mode');
  await page.evaluate(()=>__agyDreamSkinV2.destroy());
  assert.match(await page.locator('#chat').evaluate(n=>getComputedStyle(n).maskImage),/gradient/,'disabling the skin restores native behavior');
  fs.writeFileSync(path.join(root,'evidence/agy-scroll-glass-2026-11-11.json'),JSON.stringify({samples,lateReplyFirstFrame:true,unrelatedMasksPreserved:true,replyAlphaPreserved:true,transparentModePreserved:true,destroyRestoresNative:true},null,2));
  console.log('PASS: actual blur pixels persist through native scroll masks, delayed restoration, mode switch and skin removal.');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
