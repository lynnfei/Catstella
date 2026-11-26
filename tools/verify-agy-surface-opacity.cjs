// Verify Dream Skin preserves frosted surface opacity on @ popups, interactive question cards,
// dialogs containing forms, and Option-style textareas (instead of clearing them or painting solid black).
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { installTheme } = require('../Antigravity-Dream-Skin/src/host/theme.cjs');

const SVG_WALL = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="900">'
  + '<rect width="1280" height="900" fill="#231639"/>'
  + '<circle cx="960" cy="240" r="140" fill="#f59cc6" opacity="0.35"/>'
  + '</svg>'
);

function parseRgbaAlpha(colorStr) {
  const m = String(colorStr || '').match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (!m) return 0;
  return m[1] === undefined ? 1 : Number(m[1]);
}

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

    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; background: #121212; color: #f5f2ff; font-family: system-ui, sans-serif; }
            #root { width: 1280px; height: 900px; background: #121212; }
            .agy-sheet {
              position: relative;
              width: 1280px;
              height: 900px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: space-between;
              padding: 24px;
            }
            /* Interactive ask_question card (7 options + Option 8 textarea) */
            #question-card {
              width: 720px;
              min-height: 360px;
              border: 1px solid #3c3650;
              border-radius: 14px;
              padding: 16px;
              background: #1b1924;
            }
            #question-card button {
              display: block;
              width: 100%;
              text-align: left;
              padding: 6px 10px;
              margin: 4px 0;
              background: transparent;
              color: #eee;
              border: 1px solid #332d45;
              border-radius: 8px;
            }
            #option-8-textarea {
              width: 100%;
              min-height: 44px;
              padding: 8px 10px;
              background: transparent;
              color: #fff;
              border: 1px solid #3a3450;
              border-radius: 8px;
            }
            /* Dialog containing a <form> */
            #modal-dialog {
              width: 360px;
              padding: 14px;
              border: 1px solid #444;
              border-radius: 12px;
              background: #1e1c28;
            }
            /* Main composer with .w-full mention popup + textarea + pointer-events-none fade */
            #composer-wrap {
              position: relative;
              width: 720px;
            }
            .surface-composer {
              position: relative;
              width: 720px;
              padding: 12px;
              border: 1px solid #3a3450;
              border-radius: 22px;
              background: #1d1b26;
            }
            #mention-popup {
              position: absolute;
              left: 0;
              bottom: calc(100% + 10px);
              width: 100%;
              height: 220px;
              z-index: 50;
              border: 1px solid #423c57;
              border-radius: 12px;
              background: #1e1b28;
              padding: 8px;
            }
            #composer-textarea {
              width: 100%;
              min-height: 36px;
              background: transparent;
              color: #fff;
              border: 0;
            }
            #fade-overlay {
              position: absolute;
              left: 0;
              bottom: 90px;
              width: 720px;
              height: 48px;
              pointer-events: none;
              z-index: 20;
              background-image: linear-gradient(to top, #121212, transparent);
            }
          </style>
        </head>
        <body>
          <main id="root">
            <section class="agy-sheet">
              <div id="question-card">
                <div>哪怕为了克制体验要做减法，下面哪些“灵魂功能”必须在第一版保留？</div>
                <button type="button">1. 自由无限画布</button>
                <button type="button">2. 角色立绘差分管理</button>
                <button type="button">3. 手稿里 @角色</button>
                <button type="button">4. 全局「闪记」胶囊</button>
                <button type="button">5. 同源一键切</button>
                <button type="button">6. 伏笔轨道</button>
                <button type="button">7. 轻量 3D 机位</button>
                <textarea id="option-8-textarea">3和4的功能其实是同一个目的的两种实现</textarea>
              </div>

              <div id="modal-dialog" role="dialog">
                <form id="dialog-form">
                  <input id="dialog-input" type="text" value="setting" />
                  <button type="submit">保存</button>
                </form>
              </div>

              <div id="composer-wrap">
                <div id="fade-overlay" class="absolute bottom-0 pointer-events-none"></div>
                <form class="surface-composer">
                  <div id="mention-popup" class="w-full">
                    <div id="mention-listbox" role="listbox">
                      <div role="option">Google Drive</div>
                      <div role="option">catstella-byok</div>
                    </div>
                  </div>
                  <div class="surface-composer-card">
                    <textarea id="composer-textarea">@</textarea>
                  </div>
                </form>
              </div>
            </section>
          </main>
        </body>
      </html>
    `);

    const config = {
      owner: 'surface-opacity-test',
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

    const results = await page.evaluate(() => {
      const read = (id) => {
        const el = document.getElementById(id);
        const cs = getComputedStyle(el);
        return {
          bg: cs.backgroundColor,
          bgImg: cs.backgroundImage,
          blur: cs.backdropFilter,
          borderTopWidth: cs.borderTopWidth,
          surfaceAttr: el.hasAttribute('data-agy-dream-surface'),
          clearAttr: el.hasAttribute('data-agy-dream-clear'),
          protectAttr: el.hasAttribute('data-agy-dream-protect')
        };
      };
      return {
        mentionPopup: read('mention-popup'),
        mentionListbox: read('mention-listbox'),
        questionCard: read('question-card'),
        option8Textarea: read('option-8-textarea'),
        modalDialog: read('modal-dialog'),
        composerTextarea: read('composer-textarea'),
        fadeOverlay: read('fade-overlay')
      };
    });

    // 1. @ Mention popup inside .surface-composer (.w-full)
    assert.equal(results.mentionPopup.surfaceAttr, true, `mention-popup missing surface attr: ${JSON.stringify(results.mentionPopup)}`);
    assert.equal(results.mentionPopup.clearAttr, false, `mention-popup must not be cleared: ${JSON.stringify(results.mentionPopup)}`);
    assert(parseRgbaAlpha(results.mentionPopup.bg) >= 0.9, `mention-popup bg too transparent: ${results.mentionPopup.bg}`);
    assert.match(results.mentionPopup.blur, /blur\(24px\)/, `mention-popup missing blur(24px): ${results.mentionPopup.blur}`);
    assert.equal(results.mentionListbox.borderTopWidth, '0px', `nested listbox must not double-border: ${results.mentionListbox.borderTopWidth}`);
    assert.equal(results.mentionListbox.blur, 'none', `nested listbox must not double-blur: ${results.mentionListbox.blur}`);

    // 2. Interactive ask_question card + Option 8 textarea
    assert.equal(results.questionCard.surfaceAttr, true, `question-card missing surface attr: ${JSON.stringify(results.questionCard)}`);
    assert.equal(results.questionCard.clearAttr, false, `question-card must not be cleared: ${JSON.stringify(results.questionCard)}`);
    assert(parseRgbaAlpha(results.questionCard.bg) >= 0.9, `question-card bg too transparent: ${results.questionCard.bg}`);
    assert.match(results.questionCard.blur, /blur\(24px\)/, `question-card missing blur(24px): ${results.questionCard.blur}`);
    assert.equal(results.option8Textarea.protectAttr, false, `option-8 textarea must not get dream-protect: ${JSON.stringify(results.option8Textarea)}`);
    assert.notEqual(results.option8Textarea.bg, 'rgb(18, 18, 18)', 'option-8 textarea must not revert to solid #121212 black');
    const optionAlpha = parseRgbaAlpha(results.option8Textarea.bg);
    assert(optionAlpha > 0 && optionAlpha < 0.5, `option-8 textarea should use pill translucency, got ${results.option8Textarea.bg}`);

    // 3. Dialog containing a <form>
    assert.equal(results.modalDialog.clearAttr, false, `modal-dialog must not be cleared: ${JSON.stringify(results.modalDialog)}`);
    assert(parseRgbaAlpha(results.modalDialog.bg) >= 0.9, `modal-dialog bg too transparent: ${results.modalDialog.bg}`);
    assert.match(results.modalDialog.blur, /blur\(24px\)/, `modal-dialog missing blur(24px): ${results.modalDialog.blur}`);

    // 4. Non-regression: composer textarea transparent & fade overlay not promoted to surface
    assert.equal(results.composerTextarea.bg, 'rgba(0, 0, 0, 0)', `composer textarea must remain transparent: ${results.composerTextarea.bg}`);
    assert.equal(results.fadeOverlay.surfaceAttr, false, `fade overlay must not receive data-agy-dream-surface: ${JSON.stringify(results.fadeOverlay)}`);

    // 5. destroy() cleanup
    await page.evaluate(() => window.__agyDreamSkinV2.destroy());
    const remainingSurfaces = await page.evaluate(() => document.querySelectorAll('[data-agy-dream-surface]').length);
    assert.equal(remainingSurfaces, 0, 'destroy() must remove all data-agy-dream-surface attributes');

    assert.deepEqual(errors, [], `unexpected page/console errors: ${JSON.stringify(errors)}`);
    console.log('PASS: Dream Skin keeps popovers, interactive question cards, dialogs, and option inputs crisp and translucent.', results);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
