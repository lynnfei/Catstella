const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {chromium} = require("../../node_modules/playwright");
const {installTheme} = require("../../Antigravity-Dream-Skin/src/host/theme.cjs");

async function main() {
  const tauriRoot = path.resolve(__dirname, "..");
  const rust = fs.readFileSync(path.join(tauriRoot, "src/host_orchestrator.rs"), "utf8");
  const inspect = rust.match(/const INSPECT_SKIN_JS: &str = r#"([\s\S]*?)"#;/)?.[1];
  assert(inspect, "Test the exact production readiness expression");
  const browser = await chromium.launch({channel:"msedge", headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<style>body{background:white}</style><main id="root"></main>');
    assert.equal((await page.evaluate(inspect)).hydrated, false);
    await page.locator("#root").evaluate(node => {
      node.innerHTML = '<section class="agy-sheet" style="width:800px;height:600px"></section>';
    });
    assert.equal((await page.evaluate(inspect)).hydrated, false, "The shell exists before CSS hydration");
    await page.evaluate(() => {
      document.body.className = "dark";
      document.querySelector("#root").style.setProperty("--background", "#181224");
    });
    assert.equal((await page.evaluate(inspect)).hydrated, false, "Dark theme tokens must agree with the native background");
    await page.addStyleTag({content:"body{background:rgb(24,18,36)}"});
    assert.equal((await page.evaluate(inspect)).hydrated, true);
    const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="purple"/></svg>');
    await page.evaluate(installTheme, {owner:"cold-test",image,outputMode:"glass",opacity:.5,scrim:.1});
    const surface = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--agy-ui-surface"));
    assert.equal(surface, "#211e2d", "Cold startup must select the dark palette");
    assert.equal((await page.evaluate(inspect)).hydrated, true);
    await page.evaluate(() => __agyDreamSkinV2.destroy());
    await page.locator(".agy-sheet").evaluate(node => node.remove());
    assert.equal((await page.evaluate(inspect)).hydrated, false, "Navigation must wait for a new workbench");
    await page.evaluate(() => {
      document.body.className = "";
      document.body.style.background = "rgb(255,255,255)";
      document.querySelector("#root").innerHTML = '<section class="agy-sheet" style="width:800px;height:600px"></section>';
    });
    assert.equal((await page.evaluate(inspect)).hydrated, true, "Light mode remains supported");
  } finally {
    await browser.close();
  }
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(tauriRoot,"frontend-dist/src/renderer/personality.js"),"utf8"),ctx);
  assert(!fs.readFileSync(path.join(tauriRoot,"frontend-dist/src/renderer/personality.js"),"utf8").includes("杂鱼君"));
  assert(!fs.readFileSync(path.join(tauriRoot,"frontend-dist/src/renderer/settings.html"),"utf8").includes('data-val="zayu"'));
  console.log("PASS: cold workbench hydration, dark/light palette, navigation and staged honorific migration");
}
main().catch(error => {console.error(error);process.exitCode = 1;});
