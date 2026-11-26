// Verify Dream Skin confines wide breakout Markdown tables cleanly within AI reply cards.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { installTheme } = require('../Antigravity-Dream-Skin/src/host/theme.cjs');

const SVG_WALL = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">'
  + '<rect width="1200" height="900" fill="#211834"/>'
  + '<circle cx="900" cy="180" r="110" fill="#fde68a" opacity="0.25"/>'
  + '</svg>'
);

async function main() {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.SKIN_BROWSER_CHANNEL || 'msedge'
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`);
    });

    const cols = [
      '方案', '立绘规格', '单 EXE 体积', '进程数', 'GPU 进程 Private WS',
      '整树 Private WS', '整树 Working Set', '整树 Private Commit', 'DOM 渲染', '30步并发拖动'
    ];
    const headerHtml = cols.map((c) => `<th>${c}</th>`).join('');
    const rowHtml = (name, extra) => `<tr>${[name, ...extra].map((c) => `<td>${c}</td>`).join('')}</tr>`;

    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <style>
            body { margin: 0; background: #16121c; color: #f5f2ff; font-family: system-ui, sans-serif; }
            #root { width: 1280px; height: 900px; }
            .agy-sheet { width: 1280px; height: 900px; display: flex; justify-content: center; overflow-y: auto; }
            .scroll-mt-4 { width: 720px; padding: 32px 0; }
            /* Simulate AGY native wide-table breakout geometry */
            #breakout-outer {
              position: relative;
              left: 50%;
              transform: translateX(-50%);
              width: calc(100% + 320px);
              margin-inline: -160px;
            }
          </style>
        </head>
        <body>
          <main id="root">
            <section class="agy-sheet">
              <div class="scroll-mt-4">
                <div data-testid="agent-response">
                  <div class="prose" id="ai-card">
                    <p>二、WebView2 GPU / 低内存参数矩阵实测（同工况 A/B）</p>
                    <div id="breakout-outer">
                      <div id="breakout-inner">
                        <table id="wide-table">
                          <thead><tr>${headerHtml}</tr></thead>
                          <tbody>
                            ${rowHtml('Electron 现役 (StarSuite + ForegroundHost)', ['100% PNG', '~308 MB 运行时', '5', '4.50 MB', '105.82 MB', '193.52 MB', '227.05 MB', '—', '—'])}
                            ${rowHtml('Tauri (low-mem) (已设为默认)', ['100% PNG', '21.31 MB', '7', '7.61 MB', '77.14 MB (-27.1%)', '376.00 MB', '117.49 MB (-48.3%)', 'PASS', 'PASS'])}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div id="narrow-wrap">
                      <table id="narrow-table">
                        <thead><tr><th>项目</th><th>结论</th></tr></thead>
                        <tbody><tr><td>状态</td><td>正常收敛</td></tr></tbody>
                      </table>
                    </div>

                    <table id="bare-table">
                      <thead><tr>${headerHtml}</tr></thead>
                      <tbody>
                        ${rowHtml('Tauri (default)', ['100% PNG', '21.31 MB', '7', '83.23 MB', '155.21 MB', '473.86 MB', '229.26 MB', 'PASS', 'PASS'])}
                      </tbody>
                    </table>
                    <p>核心结论总结段。</p>
                  </div>
                </div>
              </div>
            </section>
          </main>
        </body>
      </html>
    `);

    const config = {
      owner: 'table-overflow-test',
      image: SVG_WALL,
      wallpaperId: 'wall-1',
      opacity: 0.72,
      scrim: 0.12,
      outputMode: 'glass',
      replyOpacity: 24,
      transition: 'none'
    };
    await page.evaluate(installTheme, config);
    await page.waitForTimeout(260);

    // 1. Breakout 10-column table containment + scroll + accessibility + sticky first column
    const wideCheck = await page.evaluate(() => {
      const card = document.getElementById('ai-card');
      const outer = document.getElementById('breakout-outer');
      const inner = document.getElementById('breakout-inner');
      const firstCell = document.querySelector('#wide-table tbody td:first-child');
      const cardRect = card.getBoundingClientRect();
      const outerRect = outer.getBoundingClientRect();
      const innerRect = inner.getBoundingClientRect();
      const innerCss = getComputedStyle(inner);
      const firstCellCss = getComputedStyle(firstCell);
      return {
        cardLeft: cardRect.left,
        cardRight: cardRect.right,
        outerLeft: outerRect.left,
        outerRight: outerRect.right,
        innerLeft: innerRect.left,
        innerRight: innerRect.right,
        scrollWidth: inner.scrollWidth,
        clientWidth: inner.clientWidth,
        overflowX: innerCss.overflowX,
        hasScrollAttr: inner.hasAttribute('data-agy-table-scroll'),
        tabindex: inner.getAttribute('tabindex'),
        role: inner.getAttribute('role'),
        firstCellPos: firstCellCss.position
      };
    });

    assert(wideCheck.outerLeft >= wideCheck.cardLeft - 1, `outer breakout left escaped card: ${JSON.stringify(wideCheck)}`);
    assert(wideCheck.outerRight <= wideCheck.cardRight + 1, `outer breakout right escaped card: ${JSON.stringify(wideCheck)}`);
    assert(wideCheck.innerLeft >= wideCheck.cardLeft - 1, `inner wrapper left escaped card: ${JSON.stringify(wideCheck)}`);
    assert(wideCheck.innerRight <= wideCheck.cardRight + 1, `inner wrapper right escaped card: ${JSON.stringify(wideCheck)}`);
    assert(wideCheck.scrollWidth > wideCheck.clientWidth, `wide table should overflow inside scroll container: ${JSON.stringify(wideCheck)}`);
    assert.equal(wideCheck.overflowX, 'auto');
    assert.equal(wideCheck.hasScrollAttr, true);
    assert.equal(wideCheck.tabindex, '0');
    assert.equal(wideCheck.role, 'region');
    assert.equal(wideCheck.firstCellPos, 'sticky');

    // Scroll horizontally and verify first-column td stays anchored near innerRect.left
    const stickyAfterScroll = await page.evaluate(() => {
      const inner = document.getElementById('breakout-inner');
      const firstCell = document.querySelector('#wide-table tbody td:first-child');
      const beforeCell = firstCell.getBoundingClientRect().left;
      inner.scrollLeft = 220;
      const innerLeft = inner.getBoundingClientRect().left;
      const afterCell = firstCell.getBoundingClientRect().left;
      return { scrollLeft: inner.scrollLeft, innerLeft, beforeCell, afterCell };
    });
    assert(stickyAfterScroll.scrollLeft >= 150, `table wrapper did not scroll: ${JSON.stringify(stickyAfterScroll)}`);
    assert(Math.abs(stickyAfterScroll.afterCell - stickyAfterScroll.innerLeft) <= 4,
      `sticky first column drifted after horizontal scroll: ${JSON.stringify(stickyAfterScroll)}`);

    // 2. Narrow 2-column table should fit without scroll attr or sticky first col
    const narrowCheck = await page.evaluate(() => {
      const wrap = document.getElementById('narrow-wrap');
      const firstCell = document.querySelector('#narrow-table tbody td:first-child');
      return {
        scrollWidth: wrap.scrollWidth,
        clientWidth: wrap.clientWidth,
        hasScrollAttr: wrap.hasAttribute('data-agy-table-scroll'),
        firstCellPos: getComputedStyle(firstCell).position
      };
    });
    assert(narrowCheck.scrollWidth <= narrowCheck.clientWidth + 1, `narrow table overflowed: ${JSON.stringify(narrowCheck)}`);
    assert.equal(narrowCheck.hasScrollAttr, false);
    assert.notEqual(narrowCheck.firstCellPos, 'sticky');

    // 3. Bare unwrapped table directly inside .prose
    const bareCheck = await page.evaluate(() => {
      const card = document.getElementById('ai-card');
      const bare = document.getElementById('bare-table');
      const cardRect = card.getBoundingClientRect();
      const bareRect = bare.getBoundingClientRect();
      return {
        cardLeft: cardRect.left,
        cardRight: cardRect.right,
        bareLeft: bareRect.left,
        bareRight: bareRect.right,
        overflowX: getComputedStyle(bare).overflowX,
        scrollWidth: bare.scrollWidth,
        clientWidth: bare.clientWidth,
        hasScrollAttr: bare.hasAttribute('data-agy-table-scroll')
      };
    });
    assert(bareCheck.bareLeft >= bareCheck.cardLeft - 1, `bare table left escaped card: ${JSON.stringify(bareCheck)}`);
    assert(bareCheck.bareRight <= bareCheck.cardRight + 1, `bare table right escaped card: ${JSON.stringify(bareCheck)}`);
    assert.equal(bareCheck.overflowX, 'auto');
    assert.equal(bareCheck.hasScrollAttr, true);

    // 4. destroy() cleanup
    await page.evaluate(() => window.__agyDreamSkinV2.destroy());
    const afterDestroy = await page.evaluate(() => ({
      scrollCount: document.querySelectorAll('[data-agy-table-scroll]').length,
      innerTabindex: document.getElementById('breakout-inner').getAttribute('tabindex'),
      innerRole: document.getElementById('breakout-inner').getAttribute('role'),
      bareTabindex: document.getElementById('bare-table').getAttribute('tabindex')
    }));
    assert.deepEqual(afterDestroy, {
      scrollCount: 0,
      innerTabindex: null,
      innerRole: null,
      bareTabindex: null
    });

    assert.deepEqual(errors, [], `unexpected page/console errors: ${JSON.stringify(errors)}`);
    console.log('PASS: Dream Skin confines breakout, wrapped, and bare wide tables cleanly inside AI reading cards.', {
      wideCheck,
      stickyAfterScroll,
      narrowCheck,
      bareCheck
    });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
