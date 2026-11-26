const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const renderer = path.join(root, 'Antigravity-Cat-Widget/src/renderer');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1060, height: 520 }, deviceScaleFactor: 2 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setContent(`<html><head><meta charset="utf-8"></head><body>
      <h1>Catstella · 星晶耐力计</h1><p>四芒星晶 / Omnitrix 表盘 / 双轨星徽 / 纤薄竖条</p>
      <main></main><footer>实际组件 · 5h 余 68% / 周余 42% · 左右贴边与主题配色继续沿用原设置</footer></body></html>`);
    await page.addStyleTag({ path: path.join(renderer, 'side-quota.css') });
    await page.addStyleTag({ content: `body{margin:0;padding:36px;background:radial-gradient(ellipse at 30% 0%,#3c3159,#181423 75%);color:#f4edff;font:14px "Segoe UI","Microsoft YaHei",sans-serif}h1{font-size:22px;margin:0 0 8px}p,footer{color:#b8abc9;font-size:12px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:28px 0}article{height:280px;background:#ffffff05;border:1px solid #dac5ff26;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px}h2{font-size:13px;font-weight:500;margin:0}.mount{height:180px;display:grid;place-items:center;--gauge-scale:1.8}.small{--gauge-scale:1;height:100px}` });
    await page.addScriptTag({ path: path.join(renderer, 'side-quota.js') });
    await page.evaluate(() => {
      for (const [index, variant, orch, title] of [[0,'arc',false,'四芒星晶'],[1,'arc',true,'Omnitrix'],[2,'ring',false,'双轨星徽'],[3,'bar',false,'星辉竖条']]) {
        const article = document.createElement('article');
        article.innerHTML = `<div class="mount" id="g${index}"></div><h2>${title}</h2>`;
        document.querySelector('main').append(article);
        window.CatstellaSideQuota.updateGaugeMount(article.firstElementChild, variant, `preview-${index}`, {
          fiveHour:68,weekly:42,ghost5h:68,quotaMode:'remaining',side:'right',orchestrator:orch
        });
      }
    });
    const evidence = path.join(root, 'evidence');
    fs.mkdirSync(evidence, { recursive: true });
    for (const theme of ['violet','pink','ocean','onyx']) {
      await page.evaluate(theme => { document.body.dataset.theme = theme; },theme);
      await page.screenshot({ path: path.join(evidence, `stamina-${theme}-2026-11-26.png`) });
    }
    const result = await page.evaluate(() => {
      for (const selector of ['#g0 .gauge-arc-tip','#g2 .gauge-ring-tip']) {
        const tip=document.querySelector(selector);
        if(tip?.tagName.toLowerCase()!=='path'||tip.getAttribute('fill')!=='#fff'||!tip.getAttribute('transform')?.startsWith('translate(')) throw Error('Progress star is missing or misplaced');
      }
      if(document.querySelector('#g3 .gauge-star-gem')) throw Error('Vertical gauge must not have a crown icon');
      if(document.querySelector('#g1 .orch-body path[fill="#ce65b5"]')===null) throw Error('Orchestrator icon must use berry purple');
      const mount = document.querySelector('#g3');
      const update = values => window.CatstellaSideQuota.updateGaugeMount(mount,'bar','preview-3', {
        fiveHour:68,weekly:42,ghost5h:68,quotaMode:'used',side:'left',...values
      });
      update({});
      const used = mount.querySelector('.gauge-bar-fill').style.transform;
      const previous = mount.querySelector('svg');
      update({weekly:41});
      const stable = previous === mount.querySelector('svg');
      mount.textContent = '已隐藏';
      update({fiveHour:null,weekly:null});
      const recovered = !!mount.querySelector('svg');
      const unknown = mount.querySelector('.gauge-bar-stripe').getAttribute('opacity');
      return {used,stable,recovered,unknown};
    });
    assert.deepEqual(result,{used:'scaleY(0.32)',stable:true,recovered:true,unknown:'1'});
    console.log('PASS: gauge visuals, single conversion for used mode, stable SVG nodes, unknown state and hide/show recovery.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
