const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { execFileSync, spawn } = require("node:child_process");

const tauriRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(tauriRoot, "..");
const WebSocket = require(path.join(repoRoot, "shared/vendor/ws"));
const exePath = path.join(tauriRoot, "target/release/catstella-tauri.exe");
const evidenceFile = path.join(repoRoot, "evidence/tauri-step3-verify.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
    srv.on("error", reject);
  });
}

function httpReq(port, method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: reqPath, method, headers, timeout: 4000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function startMockCdpServer() {
  const port = await getFreePort();
  const stateByTarget = {
    "page-1": {
      theme: { applied: false, owner: null, opacity: null, wallpaperId: null },
      loc: { installed: false, owner: null },
      docScripts: new Map()
    },
    "iframe-1": {
      theme: { applied: false, owner: null, opacity: null, wallpaperId: null },
      loc: { installed: false, owner: null },
      docScripts: new Map()
    }
  };
  const events = [];
  let scriptSeq = 0;

  const targets = [
    {
      id: "page-1",
      type: "page",
      title: "Antigravity Mock Workbench",
      url: `http://127.0.0.1:${port}/workbench.html`,
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/page-1`
    },
    {
      id: "iframe-1",
      type: "iframe",
      title: "Antigravity Extension Webview",
      url: "vscode-webview://mock-ext/index.html",
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/iframe-1`
    }
  ];

  const httpServer = http.createServer((req, res) => {
    if (req.url === "/json/list") {
      const body = JSON.stringify(targets);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocket.Server({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const m = (req.url || "").match(/\/devtools\/page\/([^/?]+)/);
    const targetId = m ? m[1] : null;
    if (!targetId || !stateByTarget[targetId]) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        const { id, method, params = {} } = msg;
        const st = stateByTarget[targetId];
        const reply = (result) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ id, result }));
          }
        };

        if (method === "Page.enable") {
          return reply({});
        }
        if (method === "Page.addScriptToEvaluateOnNewDocument") {
          const scriptId = `preload-${++scriptSeq}`;
          st.docScripts.set(scriptId, String(params.source || ""));
          events.push({ targetId, type: "loc-preload-add", scriptId });
          return reply({ identifier: scriptId });
        }
        if (method === "Page.removeScriptToEvaluateOnNewDocument") {
          const existed = st.docScripts.delete(String(params.identifier || ""));
          events.push({ targetId, type: "loc-preload-remove", existed });
          return reply({});
        }
        if (method === "Runtime.evaluate") {
          const expr = String(params.expression || "");

          if (expr.includes("queryHostQuota") && expr.includes("extractModelInfo")) {
            events.push({ targetId, type: "quota-eval" });
            return reply({
              result: {
                value: {
                  modelInfo: {
                    modelName: "Gemini 3.5 Pro",
                    thinking: "High",
                    orchestrator: false,
                    fullText: "Gemini 3.5 Pro (High)"
                  },
                  cacheAvailable: true,
                  liveQuery: true,
                  fiveHour: 84,
                  weekly: 62,
                  fiveHourReset: "2小时后重置",
                  weeklyReset: "4天后重置",
                  claudeGpt: { fiveHour: 90, weekly: 95, fiveHourReset: "", weeklyReset: "" }
                }
              }
            });
          }

          if (expr.includes("extractModelInfo") && expr.includes("hasFocus")) {
            return reply({
              result: {
                value: {
                  focused: targetId === "page-1",
                  modelInfo: {
                    modelName: "Gemini 3.5 Pro",
                    thinking: "High",
                    orchestrator: false,
                    fullText: "Gemini 3.5 Pro (High)"
                  }
                }
              }
            });
          }

          if (expr.startsWith("window.__agyDreamSkinV2.updateAppearance(")) {
            const argStr = expr.slice("window.__agyDreamSkinV2.updateAppearance(".length, -1);
            let parsed = {};
            try { parsed = JSON.parse(argStr); } catch {}
            st.theme.opacity = parsed.opacity ?? null;
            events.push({ targetId, type: "theme-update-appearance", opacity: parsed.opacity });
            return reply({ result: { value: { applied: true, themePreset: "violet" } } });
          }

          if (expr.includes("return installTheme;})())(")) {
            const marker = "return installTheme;})())(";
            const idx = expr.lastIndexOf(marker);
            let parsed = {};
            try { parsed = JSON.parse(expr.slice(idx + marker.length, -1)); } catch {}
            st.theme = {
              applied: true,
              owner: parsed.owner || null,
              opacity: parsed.opacity ?? null,
              wallpaperId: parsed.wallpaperId || null
            };
            events.push({
              targetId,
              type: "theme-install",
              owner: parsed.owner || null,
              wallpaperId: parsed.wallpaperId || null,
              hasDataImage: typeof parsed.image === "string" && parsed.image.startsWith("data:image/"),
              opacity: parsed.opacity ?? null
            });
            return reply({ result: { value: { applied: true, themePreset: parsed.themePreset || "violet", protected: 1, surfaces: 2 } } });
          }

          if (expr.includes("__agyDreamSkinV2") && expr.includes(".destroy()")) {
            st.theme = { applied: false, owner: null, opacity: null, wallpaperId: null };
            events.push({ targetId, type: "theme-destroy" });
            return reply({ result: { value: { removed: true } } });
          }

          if (expr.includes("window.__agyDreamSkinV2")) {
            events.push({ targetId, type: "theme-inspect" });
            return reply({
              result: {
                value: {
                  ready: "complete",
                  hydrated: true,
                  themed: st.theme.applied,
                  owner: st.theme.owner,
                  appearance: true
                }
              }
            });
          }

          if (expr.includes("return installLocalization;})())(")) {
            const marker = "return installLocalization;})())(";
            const idx = expr.lastIndexOf(marker);
            let parsed = {};
            try { parsed = JSON.parse(expr.slice(idx + marker.length, -1)); } catch {}
            st.loc = { installed: true, owner: parsed.owner || null };
            events.push({
              targetId,
              type: "loc-install",
              owner: parsed.owner || null,
              dictKeys: parsed.dict ? Object.keys(parsed.dict).length : 0
            });
            return reply({
              result: { value: { applied: true, translated: 120, owner: parsed.owner || null } }
            });
          }

          if (expr.includes("__agyZhV1") && expr.includes(".destroy()")) {
            st.loc = { installed: false, owner: null };
            events.push({ targetId, type: "loc-destroy" });
            return reply({ result: { value: { removed: true } } });
          }

          if (expr.includes("window.__agyZhV1")) {
            return reply({
              result: {
                value: {
                  ready: "complete",
                  installed: st.loc.installed,
                  owner: st.loc.owner
                }
              }
            });
          }

          return reply({ result: { value: null } });
        }
        return reply({});
      });
    });
  });

  await new Promise((resolve) => httpServer.listen(port, "127.0.0.1", resolve));
  return {
    port,
    events,
    stateByTarget,
    close: () =>
      new Promise((resolve) => {
        wss.clients.forEach((c) => { try { c.terminate(); } catch {} });
        wss.close(() => httpServer.close(resolve));
      })
  };
}

async function waitFor(predicate, timeoutMs, label) {
  const endAt = Date.now() + timeoutMs;
  while (Date.now() < endAt) {
    const val = await predicate();
    if (val) return val;
    await sleep(120);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function main() {
  if (!fs.existsSync(exePath)) {
    throw new Error(`Missing release binary: ${exePath}`);
  }

  const cdp = await startMockCdpServer();
  const bridgePort = await getFreePort();
  const stamp = Date.now();
  const dataDir = path.join(os.tmpdir(), `catstella-step3-verify-${stamp}`);
  fs.mkdirSync(dataDir, { recursive: true });

  const child = spawn(
    exePath,
    [
      "--isolated",
      `--host-cdp-port=${cdp.port}`,
      `--bridge-port=${bridgePort}`,
      "--no-hotkeys",
      "--no-transcripts",
      "--test-cdp-cycle",
      `--data-dir=${dataDir}`,
      "--exit-after-ms=12000"
    ],
    { cwd: tauriRoot, stdio: "ignore", windowsHide: false }
  );

  let exitCode = null;
  const exitPromise = new Promise((resolve) => {
    child.on("exit", (code) => {
      exitCode = code;
      resolve(code);
    });
  });

  let initialState = null;
  let charFramePngOk = false;
  let webSyncResult = null;
  let installEv = null;
  let appearanceEv = null;
  let installCountAfterAppearance = 0;

  try {
    // 1. Wait for quota poll
    initialState = await waitFor(async () => {
      try {
        const r = await httpReq(bridgePort, "GET", "/companion/state");
        if (r.status !== 200) return null;
        const j = JSON.parse(r.body.toString("utf8"));
        if (j?.desktop?.agyQuota?.fiveHour === 84 && j?.desktop?.agyQuota?.modelName === "Gemini 3.5 Pro") {
          return j;
        }
      } catch {}
      return null;
    }, 9000, "initial mock CDP quota & model poll");

    // 1b. Verify Catstella-web bridge contract (character-frame PNG & extension /companion/sync)
    const rCharFrame = await httpReq(bridgePort, "GET", "/companion/character-frame?pack=gemini-star-v1&frame=idle");
    charFramePngOk =
      rCharFrame.status === 200 &&
      rCharFrame.body.length > 8 &&
      rCharFrame.body[0] === 0x89 &&
      rCharFrame.body[1] === 0x50;

    const webSyncPayload = JSON.stringify({
      webActive: true,
      client: "verify-step3",
      webQuota: { dailyTotal: 14, fiveHourUsedPct: 22, lastModel: "Gemini 3 Flash" }
    });
    const rWebSync = await httpReq(
      bridgePort,
      "POST",
      "/companion/sync",
      {
        Origin: "chrome-extension://verify-step3",
        "Content-Type": "application/json",
        "X-Catstella-Client": "gemini-web-companion",
        "Content-Length": String(Buffer.byteLength(webSyncPayload))
      },
      webSyncPayload
    );
    webSyncResult = rWebSync.status === 200 ? JSON.parse(rWebSync.body.toString("utf8")) : null;

    // 2. Wait for zh-CN localization driven by --test-cdp-cycle apply_settings_patch
    await waitFor(
      () =>
        cdp.events.some((e) => e.targetId === "page-1" && e.type === "loc-install") &&
        cdp.events.some((e) => e.targetId === "iframe-1" && e.type === "loc-install") &&
        cdp.events.some((e) => e.targetId === "page-1" && e.type === "loc-preload-add"),
      8000,
      "zh-CN localization on primary + iframe targets"
    );

    // 3. Wait for DreamSkin installTheme
    installEv = await waitFor(
      () => cdp.events.find((e) => e.targetId === "page-1" && e.type === "theme-install"),
      8000,
      "DreamSkin installTheme | events=" + JSON.stringify(cdp.events)
    );

    // 4. Wait for fast updateAppearance without extra installTheme
    appearanceEv = await waitFor(
      () => cdp.events.find((e) => e.targetId === "page-1" && e.type === "theme-update-appearance"),
      8000,
      "DreamSkin fast updateAppearance"
    );
    installCountAfterAppearance = cdp.events.filter(
      (e) => e.targetId === "page-1" && e.type === "theme-install"
    ).length;

    // 5. Wait for destroy & preload removal
    await waitFor(
      () =>
        cdp.events.some((e) => e.targetId === "page-1" && e.type === "theme-destroy") &&
        cdp.events.some((e) => e.targetId === "page-1" && e.type === "loc-preload-remove") &&
        cdp.events.some((e) => e.targetId === "page-1" && e.type === "loc-destroy") &&
        cdp.events.some((e) => e.targetId === "iframe-1" && e.type === "loc-destroy"),
      8000,
      "DreamSkin destroy and Localization teardown"
    );

    await exitPromise;
  } finally {
    if (exitCode === null) {
      try { child.kill(); } catch {}
    }
    await cdp.close();
    await sleep(400);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }

  // 6. Build Inno Setup Tauri Installer
  const skipPackaging = process.argv.includes("--no-package");
  const installerRaw = skipPackaging ? null : execFileSync(
    process.execPath,
    [path.join(__dirname, "build-tauri-installer.cjs"), "--json"],
    { encoding: "utf8", cwd: repoRoot }
  );
  const installerInfo = skipPackaging ? { skipped: true } : JSON.parse(installerRaw.trim());

  const report = {
    generatedAt: new Date().toISOString(),
    exitCode,
    quotaAndModel: {
      fiveHour: initialState.desktop.agyQuota.fiveHour,
      weekly: initialState.desktop.agyQuota.weekly,
      claudeGptFiveHour: initialState.desktop.agyQuota.claudeGpt?.fiveHour ?? null,
      claudeGptWeekly: initialState.desktop.agyQuota.claudeGpt?.weekly ?? null,
      hasArgonField: Object.prototype.hasOwnProperty.call(initialState.desktop.agyQuota || {}, "argonWeekly"),
      modelName: initialState.desktop.agyQuota.modelName
    },
    catstellaWebBridge: {
      charFramePngOk,
      syncOk: webSyncResult?.ok === true,
      webOnline: webSyncResult?.web?.online === true,
      syncClaudeGptFiveHour: webSyncResult?.desktop?.agyQuota?.claudeGpt?.fiveHour ?? null
    },
    dreamSkin: {
      installTriggered: Boolean(installEv),
      owner: installEv?.owner,
      hasDataImage: installEv?.hasDataImage === true,
      updateAppearanceTriggered: Boolean(appearanceEv),
      updatedOpacity: appearanceEv?.opacity,
      installCountAfterAppearance,
      destroyTriggered: cdp.events.some((e) => e.targetId === "page-1" && e.type === "theme-destroy")
    },
    localization: {
      primaryPreloadAdded: cdp.events.some((e) => e.targetId === "page-1" && e.type === "loc-preload-add"),
      primaryInstalled: cdp.events.some((e) => e.targetId === "page-1" && e.type === "loc-install" && e.dictKeys > 100),
      iframeInstalled: cdp.events.some((e) => e.targetId === "iframe-1" && e.type === "loc-install"),
      preloadRemovedOnDisable: cdp.events.some((e) => e.targetId === "page-1" && e.type === "loc-preload-remove"),
      primaryDestroyedOnDisable: cdp.events.some((e) => e.targetId === "page-1" && e.type === "loc-destroy"),
      iframeDestroyedOnDisable: cdp.events.some((e) => e.targetId === "iframe-1" && e.type === "loc-destroy")
    },
    packaging: installerInfo
  };

  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));

  const pass =
    exitCode === 0 &&
    report.quotaAndModel.fiveHour === 84 &&
    report.quotaAndModel.weekly === 62 &&
    report.quotaAndModel.claudeGptFiveHour === 90 &&
    report.quotaAndModel.claudeGptWeekly === 95 &&
    report.quotaAndModel.hasArgonField === false &&
    report.quotaAndModel.modelName === "Gemini 3.5 Pro" &&
    report.catstellaWebBridge.charFramePngOk &&
    report.catstellaWebBridge.syncOk &&
    report.catstellaWebBridge.webOnline &&
    report.catstellaWebBridge.syncClaudeGptFiveHour === 90 &&
    report.dreamSkin.installTriggered &&
    report.dreamSkin.owner === "catstella-tauri-host" &&
    report.dreamSkin.hasDataImage &&
    report.dreamSkin.updateAppearanceTriggered &&
    Math.abs((report.dreamSkin.updatedOpacity || 0) - 0.42) < 0.001 &&
    report.dreamSkin.installCountAfterAppearance === 1 &&
    report.dreamSkin.destroyTriggered &&
    report.localization.primaryPreloadAdded &&
    report.localization.primaryInstalled &&
    report.localization.iframeInstalled &&
    report.localization.preloadRemovedOnDisable &&
    report.localization.primaryDestroyedOnDisable &&
    report.localization.iframeDestroyedOnDisable &&
    (skipPackaging || (
      report.packaging.ok === true &&
      fs.existsSync(report.packaging.installerPath) &&
      report.packaging.installerBytes > 1024 * 1024
    ));

  if (!pass) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
