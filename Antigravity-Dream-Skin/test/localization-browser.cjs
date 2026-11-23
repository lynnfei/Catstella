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
            <span data-testid="worked-multi">Worked for 1m 23s</span>
            <span data-testid="long-ago">5 minutes ago</span>
            <span data-testid="plan-steps">Plan, 3 of 5 steps done</span>
            <span data-testid="diff-lines">3 lines added, 1 lines removed</span>
            <span data-testid="project-label">Project: Catstella</span>
            <span data-testid="swarm-wait">2 waiting on @coordinator</span>
            <button aria-label="Select model, current: Gemini 4 Hydrogen Extra">Gemini 4 Hydrogen Extra</button>
            <div data-testid="user-message-bubble">
              <div data-testid="user-message-content"><span>Done</span><span>Plan</span></div>
            </div>
            <div data-markdown-root>
              <table><tr><th>Status</th><td>Done</td><td>Active</td></tr></table>
              <div><button id="md-copy-btn" aria-label="Copy">file.cjs</button></div>
            </div>
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
      const mdCopyBtn = document.getElementById("md-copy-btn");
      return {
        installed: Boolean(window.__agyZhV1),
        heading: document.querySelector("h2").textContent,
        filesChanged: document.querySelector("p").textContent,
        turn: document.querySelectorAll("main span")[0].textContent,
        worked: document.querySelectorAll("main span")[1].textContent,
        resets: document.querySelectorAll("main span")[2].textContent,
        workedMulti: document.querySelector('[data-testid="worked-multi"]').textContent,
        longAgo: document.querySelector('[data-testid="long-ago"]').textContent,
        planSteps: document.querySelector('[data-testid="plan-steps"]').textContent,
        diffLines: document.querySelector('[data-testid="diff-lines"]').textContent,
        projectLabel: document.querySelector('[data-testid="project-label"]').textContent,
        swarmWait: document.querySelector('[data-testid="swarm-wait"]').textContent,
        userSpans: Array.from(document.querySelectorAll('[data-testid="user-message-content"] span')).map((s) => s.textContent),
        mdCells: Array.from(document.querySelectorAll('[data-markdown-root] th, [data-markdown-root] td')).map((c) => c.textContent),
        mdCopyText: mdCopyBtn.textContent,
        mdCopyAria: mdCopyBtn.getAttribute("aria-label"),
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
    assert.equal(snap.workedMulti, "已工作 1m 23s");
    assert.equal(snap.longAgo, "5 分钟前");
    assert.equal(snap.planSteps, "计划：已完成 3 / 5 步");
    assert.equal(snap.diffLines, "新增 3 行，删除 1 行");
    assert.equal(snap.projectLabel, "项目：Catstella");
    assert.equal(snap.swarmWait, "2 个正在等待 @coordinator");
    assert.deepEqual(snap.userSpans, ["Done", "Plan"], "User message prose must remain untouched");
    assert.deepEqual(snap.mdCells, ["Status", "Done", "Active"], "Markdown prose and table text must remain untouched");
    assert.equal(snap.mdCopyText, "file.cjs");
    assert.equal(snap.mdCopyAria, "复制", "Button aria-label inside markdown root must still be translated");
    assert.equal(snap.time, "2天前");
    assert.equal(snap.inputPlaceholder, "消息输入框");
    assert.equal(snap.inputValue, "Raw English input value");
    assert.equal(snap.codeText, "Agent said", "Code block must remain untouched");
    assert.equal(snap.monacoText, "Load older messages", "Monaco editor must remain untouched");
    assert.equal(snap.shadowText, "概览");
    assert.equal(snap.shadowTitle, "筛选");
    assert.equal(snap.modelAria, "选择模型，当前：Gemini 4 Hydrogen Extra");

    // 2. Verify ZERO-delay (< 30ms microtask, NOT 240ms!) translation on dynamic menu mount & markdown isolation
    const instant = await page.evaluate(async () => {
      const menu = document.createElement("div");
      menu.innerHTML = `<button>Load older messages</button><span>Agent working</span>`;
      document.body.appendChild(menu);
      const mdNew = document.createElement("div");
      mdNew.setAttribute("data-markdown-root", "");
      mdNew.innerHTML = `<p>Done</p><button id="md-dyn-copy" aria-label="Copy">Cancel</button>`;
      document.querySelector("main").appendChild(mdNew);
      await Promise.resolve(); // flush microtasks only (0ms timer!)
      return {
        btn: menu.querySelector("button").textContent,
        span: menu.querySelector("span").textContent,
        mdP: mdNew.querySelector("p").textContent,
        mdBtnText: mdNew.querySelector("#md-dyn-copy").textContent,
        mdBtnAria: mdNew.querySelector("#md-dyn-copy").getAttribute("aria-label")
      };
    });
    assert.equal(instant.btn, "加载更早消息");
    assert.equal(instant.span, "智能体工作中");
    assert.equal(instant.mdP, "Done", "Dynamic markdown paragraph must remain untouched");
    assert.equal(instant.mdBtnText, "Cancel", "Text inside dynamic markdown container must remain untouched");
    assert.equal(instant.mdBtnAria, "复制", "Button aria-label inside dynamic markdown container must be translated");

    // 3. Verify destroy() cleanly restores everything including Shadow DOM & attributes
    const restored = await page.evaluate(() => {
      window.__agyZhV1.destroy();
      const shadowBtn = document.getElementById("host-shadow").shadowRoot.querySelector("button");
      return {
        installed: Boolean(window.__agyZhV1),
        heading: document.querySelector("h2").textContent,
        inputPlaceholder: document.querySelector("input").getAttribute("placeholder"),
        mdCopyAria: document.getElementById("md-copy-btn").getAttribute("aria-label"),
        mdDynCopyAria: document.getElementById("md-dyn-copy").getAttribute("aria-label"),
        shadowText: shadowBtn.textContent,
        shadowTitle: shadowBtn.getAttribute("title")
      };
    });
    assert.equal(restored.installed, false);
    assert.equal(restored.heading, "Agent said");
    assert.equal(restored.inputPlaceholder, "Message input");
    assert.equal(restored.mdCopyAria, "Copy");
    assert.equal(restored.mdDynCopyAria, "Copy");
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
