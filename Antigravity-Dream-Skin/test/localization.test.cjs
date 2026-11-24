const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { LocalizationController } = require("../src/domain/localization-controller.cjs");
const { isLocalizableTarget, isPrimaryHostPage } = require("../../shared/host.cjs");

test("zh-CN dictionary loads cleanly with expanded Antigravity UI coverage", () => {
  const dictPath = path.join(__dirname, "../assets/localization/zh-CN.json");
  const raw = JSON.parse(fs.readFileSync(dictPath, "utf8"));
  const keys = Object.keys(raw).filter((k) => !k.startsWith("$"));
  assert(keys.length >= 2450, `Expected >= 2450 dictionary entries, got ${keys.length}`);
  for (const k of keys) {
    assert.equal(typeof raw[k], "string", `Non-string value for "${k}"`);
    assert(raw[k].trim().length > 0, `Empty translation for "${k}"`);
  }
  assert.equal(Object.hasOwn(raw, "Orchestrator"), false, 'Standalone "Orchestrator" must remain untranslated for model selector badge clarity');
  for (const required of [
    "Agent said",
    "You said",
    "Agent working",
    "Load older messages",
    "Pin conversation",
    "Unpin conversation",
    "Fork Conversation",
    "Overview",
    "Board",
    "Members",
    "Graph",
    "Raw",
    "Voice Mode",
    "Remote Control",
    "Build With Google Plugins",
    "Signed-in accounts",
    "Breadcrumb",
    "Response actions",
    "Orchestrator Settings",
    "Orchestrator Model",
    "Executor Model",
    "Enable terminal sandbox",
    "Clear Browsing Data?",
    "Hive",
    "Export GIF",
    "Graph view",
    "Filters (active)",
    "Compare with now",
    "Waiting on @coordinator",
    "Knowledge Work",
    "Simplified interface for research, writing, and everyday tasks.",
    "Software Engineering",
    "Full interface for coding, developer tools, and managing agents.",
    "Input Box",
    "App",
    "Not set",
    "The voice used in Voice mode. Powered by Gemini Live.",
    "Bottom Panel",
    "Side Panel"
  ]) {
    assert.equal(typeof raw[required], "string", `Missing translation for "${required}"`);
    assert(raw[required].length > 0, `Empty translation for "${required}"`);
  }
});

test("host target filter captures main pages and plugin/webview iframes while skipping splash data URLs", () => {
  const mainPage = {
    type: "page",
    url: "https://127.0.0.1:10408/c/abc?project=xyz",
    webSocketDebuggerUrl: "ws://127.0.0.1:10394/devtools/page/1"
  };
  const swarmFrame = {
    type: "iframe",
    url: "plugin://swarm--swarm_board-7508/?token=123",
    webSocketDebuggerUrl: "ws://127.0.0.1:10394/devtools/page/2"
  };
  const dataSplash = {
    type: "page",
    url: "data:text/html,<html></html>",
    webSocketDebuggerUrl: "ws://127.0.0.1:10394/devtools/page/3"
  };
  const devtools = {
    type: "page",
    url: "devtools://devtools/bundled/inspector.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:10394/devtools/page/4"
  };

  assert.equal(isPrimaryHostPage(mainPage), true);
  assert.equal(isPrimaryHostPage(swarmFrame), false);
  assert.equal(isLocalizableTarget(mainPage), true);
  assert.equal(isLocalizableTarget(swarmFrame), true);
  assert.equal(isLocalizableTarget(dataSplash), false);
  assert.equal(isLocalizableTarget(devtools), false);
});

test("LocalizationController registers preload document scripts, covers plugin iframes, and cleans up on disable/stop", async () => {
  const clients = new Map();
  let nextScriptId = 1;
  const targets = [
    { type: "page", url: "https://127.0.0.1:10408/main", webSocketDebuggerUrl: "ws://127.0.0.1:10394/devtools/page/main" },
    { type: "iframe", url: "plugin://swarm--swarm_board/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:10394/devtools/page/swarm" }
  ];

  const makeClient = (url) => {
    const record = {
      url,
      closed: false,
      installed: false,
      owner: null,
      sent: [],
      preloads: new Map(),
      async send(method, params) {
        this.sent.push({ method, params });
        if (method === "Page.addScriptToEvaluateOnNewDocument") {
          const id = `script-${nextScriptId++}`;
          this.preloads.set(id, params.source);
          return { identifier: id };
        }
        if (method === "Page.removeScriptToEvaluateOnNewDocument") {
          this.preloads.delete(params.identifier);
          return {};
        }
        return {};
      },
      async evaluate(expr) {
        if (expr.startsWith("({ready:")) {
          return { ready: "complete", installed: this.installed, owner: this.owner };
        }
        if (expr.includes("installLocalization")) {
          const m = expr.match(/"owner":"([^"]+)"/);
          this.installed = true;
          this.owner = m ? m[1] : null;
          return { applied: true, translated: 5 };
        }
        if (expr.includes(".destroy()")) {
          this.installed = false;
          this.owner = null;
          return { removed: true };
        }
        return null;
      },
      close() {
        this.closed = true;
      }
    };
    clients.set(url, record);
    return record;
  };

  const statuses = [];
  const controller = new LocalizationController(
    (s) => statuses.push(s),
    {
      dict: { Overview: "概览" },
      discover: async () => ({ target: targets[0], targets }),
      createClient: makeClient
    }
  );

  await controller.update({ uiLanguage: "zh-CN" });
  const main = clients.get(targets[0].webSocketDebuggerUrl);
  const swarm = clients.get(targets[1].webSocketDebuggerUrl);
  assert.ok(main && swarm, "Both main page and plugin iframe must receive clients");
  assert.equal(main.installed, true);
  assert.equal(swarm.installed, true);
  assert.equal(main.preloads.size, 1, "Preload script registered on main page for instant reload localization");
  assert.equal(swarm.preloads.size, 1, "Preload script registered on plugin iframe");
  assert.equal(statuses.at(-1)?.applied, true);

  await controller.update({ uiLanguage: "en" });
  assert.equal(main.installed, false);
  assert.equal(swarm.installed, false);
  assert.equal(main.preloads.size, 0, "Preload script removed when disabling localization");
  assert.equal(swarm.preloads.size, 0);
  await controller.stop();
});
