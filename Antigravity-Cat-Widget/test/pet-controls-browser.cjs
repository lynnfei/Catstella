const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { DEFAULT_SETTINGS } = require('../src/domain/settings.cjs');
const root = path.resolve(__dirname, '..');
const base = 'https://pet-controls.test';
const types = { '.html': 'text/html', '.css': 'text/css', '.cjs': 'text/javascript', '.js': 'text/javascript',
  '.png': 'image/png', '.svg': 'image/svg+xml' };

(async () => {
  const browser = await chromium.launch({ headless:true, channel:process.env.SKIN_BROWSER_CHANNEL || 'msedge',
    args:['--js-flags=--max-old-space-size=96'] });
  try {
    const page = await browser.newPage({ viewport:{width:410,height:650}, reducedMotion:'no-preference' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(base + '/**', route => {
      const file = path.resolve(root, '.' + new URL(route.request().url()).pathname);
      const type = types[path.extname(file)];
      if (!file.startsWith(root + path.sep) || !type || !fs.existsSync(file)) return route.abort();
      let body=fs.readFileSync(file);
      if(file.endsWith(path.join('renderer','ambient.js')))body=Buffer.from(body.toString()+`\nconst BaseChatter=window.CatstellaChatter;window.CatstellaChatter=class extends BaseChatter{constructor(options){super(options);window.fixtureAmbientSpeak=options.speak;}};`);
      return route.fulfill({ contentType:type, body });
    });
    await page.addInitScript(({ settings, dialogue }) => {
      const calls = window.calls = { gestures:[], drag:[], commands:[], animations:[],preferences:[] };
      let pats=0;
      const nativeAnimate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = nativeAnimate.apply(this,args);
        calls.animations.push(animation);
        return animation;
      };
      const snapshot = { state:'idle', settings:{...settings, clickCatAction:'toggle', bubblePage:'talk'}, dialogue,
        ledger:{todayTokens:{total:0},todayTurns:0}, quotaWindows:{}, source:{} };
      const subscribers = [];
      window.setActivity = modelActivity => subscribers.forEach(handler => handler({ ...snapshot, modelActivity }));
      window.setHonorific = customHonorific => Object.assign(snapshot.settings, { userHonorificMode:'custom', customHonorific });
      window.widgetApi = {
        get: async () => snapshot,
        ready() {}, save() {}, hit() {}, rememberBubble: value => calls.preferences.push(value),
        subscribe: handler => subscribers.push(handler),
        onStep() {}, canChatter:async()=>false,
        command: action => calls.commands.push(action), pointer: async action => {
          calls.gestures.push(action);
          if(action==='head-pat')return {total:++pats,today:pats};
        },
        drag: (...values) => calls.drag.push(values),
        onReaction: handler => { window.react = handler; }
      };
    }, { settings: DEFAULT_SETTINGS, dialogue: require('../assets/dialogue/zh-CN.json').lines });
    await page.goto(base + '/src/renderer/index.html');
    await page.locator('#mascot[data-art-ready=true]').waitFor();
    const box = await page.locator('#motion').boundingBox();
    const x = box.x + box.width / 2, y = box.y + 72;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 50, y - 35, {steps:5});
    await page.mouse.up();
    const drag = await page.evaluate(() => window.calls.drag);
    assert.deepEqual(drag[0], ['start']);
    assert.deepEqual(drag.at(-1), ['end', -50, -35]);
    assert.equal(await page.locator('#bubble').getAttribute('data-open'), 'false');
    assert.ok(!(await page.evaluate(() => window.calls.gestures)).includes('pet'));
    assert.ok(!(await page.evaluate(() => window.calls.gestures)).includes('head-pat'));
    await page.mouse.click(x, y);
    await page.locator('#bubble[data-open=true]').waitFor();
    assert.equal(await page.evaluate(() => calls.gestures.filter(action => action==='head-pat').length),1);
    assert.equal(await page.evaluate(() => calls.animations.filter(a=>a.id==='catstella-head-spark').length),0);
    assert.equal(await page.locator('.agy-bubble__title button').count(),1);
    assert.equal(await page.locator('.agy-bubble__title #title').isVisible(),true);
    const centeredInside = () => page.evaluate(() => {
      const bubble = document.querySelector('#bubble').getBoundingClientRect();
      const title = document.querySelector('#title');
      const box = title.getBoundingClientRect();
      const text = document.createRange();
      text.selectNodeContents(title);
      const centerX = bubble.left + bubble.width / 2;
      const centerY = bubble.top + bubble.height / 2;
      const inside = (x,y) => ((x-centerX)/(bubble.width/2))**2 + ((y-centerY)/(bubble.height/2))**2 <= 1;
      const lines = [...text.getClientRects()];
      return Math.abs(box.left + box.width / 2 - centerX) < 1 && lines.length === 1 &&
        lines.every(rect => inside(rect.left,rect.top) && inside(rect.right,rect.top));
    });
    await page.waitForFunction(() => document.querySelector('#bubble').getAnimations().length === 0);
    assert.equal(await centeredInside(),true, 'desktop title must be centered and inside the ellipse');
    await page.setViewportSize({width:272,height:580});
    assert.equal(await centeredInside(),true, 'desktop title must remain within the ellipse in a narrow window');
    await page.setViewportSize({width:410,height:650});
    assert.equal(await page.locator('#side-widget-slot').getAttribute('data-suppressed'), 'true');
    await page.mouse.click(x,y);
    await page.mouse.click(x,y);
    assert.doesNotMatch(await page.locator('#value').innerText(), /3 次/);
    for(let i=0;i<9;i++)await page.mouse.click(x,y);
    const quip = await page.locator('#value').innerText();
    assert.match(quip,/12 次/);
    for(let i=0;i<3;i++)await page.mouse.click(x,y);
    assert.equal(await page.locator('#value').innerText(),quip);
    assert.equal(await page.evaluate(() => calls.gestures.filter(action=>action==='head-pat').length),15);
    assert.equal(await page.evaluate(() => calls.preferences.length),2,'a burst changes only quota and talk preferences');
    assert.equal(await page.evaluate(() => window.calls.animations.filter(a=>a.id==='catstella-quota-success').length),0);
    await page.evaluate(() => window.react({source:'quota-refresh'}));
    assert.equal(await page.evaluate(() => window.calls.animations.filter(a=>a.id==='catstella-quota-success').length),1);
    assert.equal(await page.locator('#title').innerText(), '喵言喵语');
    await page.evaluate(() => {
      window.setHonorific('指挥官');
      window.setActivity({ kind:'model-running', stepIndex:9 });
    });
    assert.match(await page.locator('#value').innerText(), /步骤 #9/);
    assert.match(await page.locator('#value').innerText(), /指挥官/);
    await page.evaluate(() => window.setActivity({ kind:'model-done', stepIndex:9, expiresAt:Date.now()+500 }));
    assert.match(await page.locator('#value').innerText(), /模型步骤 #9 完成/);
    await page.waitForFunction(() => !document.querySelector('#value').textContent.includes('#9'));
    const ordinaryFont=await page.locator('#value').evaluate(n=>getComputedStyle(n).fontSize);
    // Ambient speech must not depend on which quota/statistics page came before it.
    await page.locator('#next').click();
    for(const viewport of [{width:360,height:604},{width:272,height:580}]){
      await page.setViewportSize(viewport);
      const states=await page.evaluate(()=>{
        const lines=['星星也会休息，本喵刚刚替它值了会儿班。','今天的星光够亮了，剩下的明天再攒。','小小伸个懒腰，尾巴也要算上。','本喵悄悄记下了一个愿望：晚饭多一条鱼。','路过一颗小行星，顺手给它起名叫糯米。','刚整理了猫耳朵，灵感的接收信号满格。'];
        return lines.map(line=>{CatstellaChatter.pickLine=()=>line;fixtureAmbientSpeak();const value=document.querySelector('#value'),body=document.querySelector('#bubble-body');return {font:getComputedStyle(value).fontSize,verticalOverflow:body.scrollHeight>body.clientHeight+1,horizontalOverflow:body.scrollWidth>body.clientWidth+1,text:value.textContent};});
      });
      for(const state of states){assert.equal(state.font,ordinaryFont,'ambient and ordinary dialogue must use exactly the same font');assert.equal(state.verticalOverflow,false,state.text);assert.equal(state.horizontalOverflow,false,state.text);}
    }
    assert.deepEqual(errors, []);

    // Verify head-pat reflection never flashes to another talk line before auto-hide closes the bubble.
    const stablePage = await browser.newPage({ viewport: { width: 410, height: 650 }, reducedMotion: 'reduce' });
    stablePage.on('pageerror', err => errors.push(err.message));
    await stablePage.clock.install();
    await stablePage.route(base + '/**', route => {
      const file = path.resolve(root, '.' + new URL(route.request().url()).pathname);
      const type = types[path.extname(file)];
      if (!file.startsWith(root + path.sep) || !type || !fs.existsSync(file)) return route.abort();
      return route.fulfill({ contentType: type, body: fs.readFileSync(file) });
    });
    await stablePage.addInitScript(({ settings, dialogue }) => {
      let pats = 0;
      const snapshot = {
        state: 'idle',
        settings: { ...settings, clickCatAction: 'talk', bubblePage: 'talk' },
        dialogue,
        dialogueTags: {},
        ledger: { todayTokens: { total: 0 }, todayTurns: 0 },
        quotaWindows: {},
        source: {}
      };
      window.widgetApi = {
        get: async () => snapshot,
        ready() {}, save() {}, hit() {}, rememberBubble() {}, subscribe() {}, onStep() {},
        canChatter: async () => false, command() {},
        pointer: async action => action === 'head-pat' ? { total: ++pats, today: pats } : undefined,
        drag() {}, onReaction() {}
      };
    }, { settings: DEFAULT_SETTINGS, dialogue: require('../assets/dialogue/zh-CN.json').lines });
    await stablePage.goto(base + '/src/renderer/index.html');
    await stablePage.clock.runFor(50);
    await stablePage.locator('#mascot[data-art-ready=true]').waitFor();
    const sBox = await stablePage.locator('#motion').boundingBox();
    const sx = sBox.x + sBox.width / 2, sy = sBox.y + 72;
    for (let i = 0; i < 12; i++) {
      await stablePage.mouse.click(sx, sy);
      await stablePage.clock.runFor(220);
    }
    const lockedQuip = await stablePage.locator('#value').innerText();
    assert.match(lockedQuip, /12 次/);
    // Past 5500ms patReflection unlock: displayed text must NOT snap to another talk line before closing.
    await stablePage.clock.runFor(5700);
    assert.equal(await stablePage.locator('#bubble').getAttribute('data-open'), 'true');
    assert.equal(await stablePage.locator('#value').innerText(), lockedQuip);
    // Past 6500ms autoHide: bubble closes cleanly without ever showing a different sentence first.
    await stablePage.clock.runFor(1000);
    assert.equal(await stablePage.locator('#bubble').getAttribute('data-open'), 'false');
    await stablePage.close();
    assert.deepEqual(errors, []);

    console.log('PASS: desktop drag, classic touch feedback, title layout and confirmed-only quota motion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
