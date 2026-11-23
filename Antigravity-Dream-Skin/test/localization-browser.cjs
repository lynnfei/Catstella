const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { installLocalization } = require("../src/host/localize.cjs");
const dict = require("../assets/localization/zh-CN.json");

async function main() {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.SKIN_BROWSER_CHANNEL || "msedge",
    args: ["--js-flags=--max-old-space-size=96"]
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const html = `
      <!doctype html>
      <html>
        <body>
          <aside aria-label="Sidebar">
            <div class="row"><span>Catstella</span><time>2d</time></div>
            <button aria-label="Pin conversation">Archive conversation</button>
          </aside>
          <main>
            <h2>Agent said</h2>
            <p>16 files changed</p>
            <span>Turn 2 of 6</span>
            <span>Worked for 34s</span>
            <span>Resets in 2d 5h</span>
            <button aria-label="Select model, current: Gemini 4 Hydrogen Extra">Gemini 4 Hydrogen Extra</button>
            <input type="text" placeholder="Message input" value="Raw English input value" />
            <pre><code>Agent said</code></pre>
            <div class="monaco-editor">Load older messages</div>
            <div id="host-shadow"></div>
          </main>
          <script>
            const host = document.getElementById('host-shadow');
            const sr = host.attachShadow({ mode: 'open' });
            sr.innerHTML = '<button title="Filters">Overview</button>';
          </script>
        </body>
      </html>
    `;
    await page.route("https://localization.test/**", (route) =>
      route.fulfill({ contentType: "text/html", body: html })
    );

    // 1. Pre-document injection (document_start before first paint!)
    const cleanDict = Object.fromEntries(Object.entries(dict).filter(([k]) => !k.startsWith("$")));
    await page.addInitScript(({ fnSrc, config }) => {
      const fn = eval("(" + fnSrc + ")");
      window.__initStatusPromise = fn(config);
    }, { fnSrc: installLocalization.toString(), config: { owner: "test-owner", dict: cleanDict } });

    await page.goto("https://localization.test/index.html", { waitUntil: "domcontentloaded" });
    assert.deepEqual(pageErrors, []);

    const snap = await page.evaluate(async () => {
      await window.__initStatusPromise;
      const bodyText = document.body.innerText;
      const shadowBtn = document.getElementById("host-shadow").shadowRoot.querySelector("button");
      const input = document.querySelector("input");
      const code = document.querySelector("pre code");
      const monaco = document.querySelector(".monaco-editor");
      const time = document.querySelector("aside time");
      const modelBtn = document.querySelector('button[aria-label*="Select model"], button[aria-label*="选择模型"]');
      return {
        installed: Boolean(window.__agyZhV1),
        heading: document.querySelector("h2").textContent,
        filesChanged: document.querySelector("p").textContent,
        turn: document.querySelectorAll("main span")[0].textContent,
        worked: document.querySelectorAll("main span")[1].textContent,
        resets: document.querySelectorAll("main span")[2].textContent,
        time: time.textContent,
        inputPlaceholder: input.getAttribute("placeholder"),
        inputValue: input.value,
        codeText: code.textContent,
        monacoText: monaco.textContent,
        shadowText: shadowBtn.textContent,
        shadowTitle: shadowBtn.getAttribute("title"),
        modelAria: modelBtn?.getAttribute("aria-label")
      };
    });

    assert.equal(snap.installed, true);
    assert.equal(snap.heading, "智能体回复");
    assert.equal(snap.filesChanged, "16 个文件已更改");
    assert.equal(snap.turn, "第 2 / 6 轮");
    assert.equal(snap.worked, "已工作 34s");
    assert.equal(snap.resets, "2d 5h 后重置");
    assert.equal(snap.time, "2天前");
    assert.equal(snap.inputPlaceholder, "消息输入框");
    assert.equal(snap.inputValue, "Raw English input value");
    assert.equal(snap.codeText, "Agent said", "Code block must remain untouched");
    assert.equal(snap.monacoText, "Load older messages", "Monaco editor must remain untouched");
    assert.equal(snap.shadowText, "概览");
    assert.equal(snap.shadowTitle, "筛选");
    assert.equal(snap.modelAria, "选择模型，当前：Gemini 4 Hydrogen Extra");

    // 2. Verify ZERO-delay (< 30ms microtask, NOT 240ms!) translation on dynamic menu mount
    const instant = await page.evaluate(async () => {
      const menu = document.createElement("div");
      menu.innerHTML = `<button>Load older messages</button><span>Agent working</span>`;
      document.body.appendChild(menu);
      await Promise.resolve(); // flush microtasks only (0ms timer!)
      return {
        btn: menu.querySelector("button").textContent,
        span: menu.querySelector("span").textContent
      };
    });
    assert.equal(instant.btn, "加载更早消息");
    assert.equal(instant.span, "智能体工作中");

    // 3. Verify destroy() cleanly restores everything including Shadow DOM & attributes
    const restored = await page.evaluate(() => {
      window.__agyZhV1.destroy();
      const shadowBtn = document.getElementById("host-shadow").shadowRoot.querySelector("button");
      return {
        installed: Boolean(window.__agyZhV1),
        heading: document.querySelector("h2").textContent,
        inputPlaceholder: document.querySelector("input").getAttribute("placeholder"),
        shadowText: shadowBtn.textContent,
        shadowTitle: shadowBtn.getAttribute("title")
      };
    });
    assert.equal(restored.installed, false);
    assert.equal(restored.heading, "Agent said");
    assert.equal(restored.inputPlaceholder, "Message input");
    assert.equal(restored.shadowText, "Overview");
    assert.equal(restored.shadowTitle, "Filters");

    console.log("PASS: pre-document zero-flash init, Shadow DOM, 0ms microtask mutation, dynamic patterns, code/editor isolation, and clean destroy().");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
