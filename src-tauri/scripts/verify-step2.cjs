const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { execFileSync, spawn } = require("node:child_process");

const tauriRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(tauriRoot, "..");
const explicitExe = process.argv.find((a) => a.startsWith("--exe="))?.slice(6);
const exePath = explicitExe ? path.resolve(explicitExe) : path.join(tauriRoot, "target/release/catstella-tauri.exe");
const evidenceFile = path.join(repoRoot, "evidence/tauri-step2-verify.json");
const skipMemory = process.argv.includes("--no-memory");

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

function runPowerShellJson(script, env = {}) {
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, ...env }
    }
  ).trim();
  return out ? JSON.parse(out) : [];
}

function sampleTauriProcessTree(rootPid, wv2Folder) {
  if (skipMemory) return {skipped:true, privateWorkingSetMB:0};
  const ps = `
$rootPid = [int]$env:CATSTELLA_ROOT_PID
$wv2 = $env:CATSTELLA_WV2_FOLDER
$all = @(Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -like 'catstella-tauri*') -or ($_.Name -like 'msedgewebview2*')
})
$byPid = @{}
$byParent = @{}
foreach ($p in $all) {
  $id = [int]$p.ProcessId
  $byPid[$id] = $p
  $ppid = [int]$p.ParentProcessId
  if (-not $byParent.ContainsKey($ppid)) { $byParent[$ppid] = New-Object System.Collections.Generic.List[object] }
  $byParent[$ppid].Add($p)
}
$selected = @{}
$queue = New-Object System.Collections.Generic.Queue[int]
if ($byPid.ContainsKey($rootPid)) {
  $queue.Enqueue($rootPid)
}
while ($queue.Count -gt 0) {
  $cur = $queue.Dequeue()
  if ($selected.ContainsKey($cur)) { continue }
  $proc = $byPid[$cur]
  if ($proc) {
    if ($cur -eq $rootPid -or ($proc.Name -like 'msedgewebview2*')) {
      $selected[$cur] = $proc
      if ($byParent.ContainsKey($cur)) {
        foreach ($ch in $byParent[$cur]) {
          if ($ch.Name -like 'msedgewebview2*') {
            $queue.Enqueue([int]$ch.ProcessId)
          }
        }
      }
    }
  }
}
foreach ($p in $all) {
  if (($p.Name -like 'msedgewebview2*') -and $p.CommandLine -and $p.CommandLine.IndexOf($wv2, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    $selected[[int]$p.ProcessId] = $p
  }
}
$perfMap = @{}
foreach ($pf in (Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction SilentlyContinue)) {
  if ($pf.IDProcess) { $perfMap[[int]$pf.IDProcess] = $pf }
}
$rows = foreach ($pr in $selected.Values) {
  $id = [int]$pr.ProcessId
  $perf = $perfMap[$id]
  $wsPriv = if ($perf -and $perf.WorkingSetPrivate) { [double]$perf.WorkingSetPrivate } else { [double]$pr.PrivatePageCount }
  [PSCustomObject]@{
    pid = $id
    name = $pr.Name
    workingSetMB = [math]::Round($pr.WorkingSetSize / 1MB, 2)
    privateWorkingSetMB = [math]::Round($wsPriv / 1MB, 2)
    privateCommitMB = [math]::Round($pr.PrivatePageCount / 1MB, 2)
  }
}
ConvertTo-Json -InputObject @($rows) -Compress
`;
  const rows = runPowerShellJson(ps, {
    CATSTELLA_ROOT_PID: String(rootPid),
    CATSTELLA_WV2_FOLDER: wv2Folder
  });
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    processCount: list.length,
    workingSetMB: round2(list.reduce((s, r) => s + (r.workingSetMB || 0), 0)),
    privateWorkingSetMB: round2(list.reduce((s, r) => s + (r.privateWorkingSetMB || 0), 0)),
    privateCommitMB: round2(list.reduce((s, r) => s + (r.privateCommitMB || 0), 0))
  };
}

async function main() {
  if (!fs.existsSync(exePath)) {
    throw new Error(`Missing release binary: ${exePath}`);
  }
  const stamp = Date.now();
  const dataDir = path.join(os.tmpdir(), `catstella-step2-verify-${stamp}`);
  const transcriptsDir = path.join(dataDir, "transcripts");
  const sessionLogDir = path.join(transcriptsDir, "brain", "verify-session", ".system_generated", "logs");
  const logFile = path.join(sessionLogDir, "transcript_full.jsonl");
  const wv2Dir = path.join(dataDir, "webview2");
  const benchJson = path.join(dataDir, "probe.json");

  fs.mkdirSync(sessionLogDir, { recursive: true });
  const nowIso = new Date().toISOString();
  const baseLine = JSON.stringify({
    step_index: 0,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: nowIso,
    input_tokens: 100,
    cache_read_tokens: 20,
    output_tokens: 30
  });
  fs.writeFileSync(logFile, baseLine + "\n", "utf8");

  const bridgePort = await getFreePort();
  const child = spawn(
    exePath,
    [
      `--data-dir=${dataDir}`,
      `--transcripts-dir=${transcriptsDir}`,
      "--transcript-poll-ms=250",
      `--bridge-port=${bridgePort}`,
      "--no-hotkeys",
      "--demo-quota",
      "--isolated",
      "--test-settings-cycle",
      `--benchmark-out=${benchJson}`,
      "--exit-after-ms=20000"
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

  function readProbeSafe() {
    try {
      return JSON.parse(fs.readFileSync(benchJson, "utf8"));
    } catch {
      return null;
    }
  }

  async function waitForProbe(predicate, timeoutMs, label) {
    const endAt = Date.now() + timeoutMs;
    while (Date.now() < endAt) {
      const p = readProbeSafe();
      if (p && predicate(p)) return p;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for probe condition: ${label}`);
  }

  // Wait for initial pet render probe
  await waitForProbe((p) => p.ok === true && typeof p.readyAtMs === "number", 10000, "initial render probe");

  // Wait slightly so steady idle memory settles before settings window opens at t=3.5s
  await sleep(600);
  const memIdleBefore = sampleTauriProcessTree(child.pid, wv2Dir);

  // Test Companion Bridge API endpoints
  const rState = await httpReq(bridgePort, "GET", "/companion/state");
  const jState = JSON.parse(rState.body.toString("utf8"));

  const rWalls = await httpReq(bridgePort, "GET", "/companion/wallpapers");
  const jWalls = JSON.parse(rWalls.body.toString("utf8"));

  const rImg = await httpReq(bridgePort, "GET", "/companion/wallpaper-image?id=gemini-character-sheet-v1");
  const isPng = rImg.status === 200 && rImg.body.length > 8 && rImg.body[0] === 0x89 && rImg.body[1] === 0x50;

  const rBadOrigin = await httpReq(bridgePort, "GET", "/companion/state", { Origin: "https://evil.example" });
  const rNoHdr = await httpReq(bridgePort, "POST", "/companion/sync", { "Content-Length": "2" }, "{}");

  const syncBody = JSON.stringify({
    webActive: true,
    client: "verify-step2",
    webQuota: { dailyTotal: 11, fiveHourUsedPct: 35, lastModel: "Gemini 3 Flash" },
    patch: { characterPack: "lin-cat" }
  });
  const rSync = await httpReq(
    bridgePort,
    "POST",
    "/companion/sync",
    {
      Origin: "chrome-extension://verify",
      "Content-Type": "application/json",
      "X-Catstella-Client": "gemini-web-companion",
      "Content-Length": String(Buffer.byteLength(syncBody))
    },
    syncBody
  );
  const jSync = JSON.parse(rSync.body.toString("utf8"));

  const rMem = await httpReq(bridgePort, "GET", "/api/memory/status");
  const jMem = JSON.parse(rMem.body.toString("utf8"));

  // Append a live transcript step and verify ledger persistence
  const liveLine = JSON.stringify({
    step_index: 1,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: new Date().toISOString(),
    input_tokens: 1200,
    cache_read_tokens: 0,
    output_tokens: 350
  });
  fs.appendFileSync(logFile, liveLine + "\n", "utf8");

  // Event-driven: wait for Settings window DOM probe report while Settings is open, then sample memory
  await waitForProbe((p) => Boolean(p.settingsCycleDom), 10000, "settingsCycleDom");
  const memSettingsOpen = sampleTauriProcessTree(child.pid, wv2Dir);

  // Event-driven: wait until Settings window is destroyed and pet bubble check completes, then wait 3000ms for WebView2 renderer teardown
  const finalProbe = await waitForProbe(
    (p) => typeof p.settingsDestroyedAfterClose === "boolean" && Boolean(p.petBubbleCheck),
    12000,
    "settingsDestroyedAfterClose & petBubbleCheck"
  );
  await sleep(3000);
  const memAfterClose = sampleTauriProcessTree(child.pid, wv2Dir);

  const rStatePost = await httpReq(bridgePort, "GET", "/companion/state");
  const jStatePost = JSON.parse(rStatePost.body.toString("utf8"));

  const usagePath = path.join(dataDir, "usage-v2.json");
  const usageData = fs.existsSync(usagePath) ? JSON.parse(fs.readFileSync(usagePath, "utf8")) : null;
  const savedSettings = JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8"));
  const savedDreamSkin = JSON.parse(fs.readFileSync(path.join(dataDir, "skin/settings.json"), "utf8"));

  await exitPromise;
  await sleep(600);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}

  const report = {
    generatedAt: new Date().toISOString(),
    exitCode,
    baselineRender: {
      faceReady: finalProbe.faceReady,
      transparentStyleOk: finalProbe.transparentStyleOk,
      sideQuotaReady: finalProbe.sideQuotaReady,
      bridgePort: finalProbe.bridgePort
    },
    companionBridge: {
      stateOk: rState.status === 200 && jState.ok === true && jState.port === bridgePort,
      wallpaperCount: Array.isArray(jWalls.wallpapers) ? jWalls.wallpapers.length : 0,
      wallpaperImagePngOk: isPng,
      badOriginStatus: rBadOrigin.status,
      missingHeaderStatus: rNoHdr.status,
      syncStatus: rSync.status,
      syncUpdatedCharacter: jSync?.desktop?.characterPack,
      syncWebOnline: jSync?.web?.online,
      memoryUnavailableStatus: rMem.status,
      memoryUnavailableError: jMem?.error
    },
    transcriptAndLedger: {
      recordsCount: Array.isArray(usageData?.records) ? usageData.records.length : 0,
      hasLiveStep1: Array.isArray(usageData?.records) && usageData.records.some((r) => r.stepIndex === 1 && r.tokens?.input === 1200)
    },
    settingsCycle: {
      openedViaClick: finalProbe.settingsOpenedViaClick === true,
      petResponsiveWhileSettingsOpen: finalProbe.petResponsiveWhileSettingsOpen === true,
      dom: finalProbe.settingsCycleDom || null,
      destroyedAfterClose: finalProbe.settingsDestroyedAfterClose === true,
      persistedScale: savedSettings?.scale,
      persistedThemePreset: savedDreamSkin?.themePreset,
      bridgeStateScale: jStatePost?.desktop?.scale,
      bridgeStateTheme: jStatePost?.desktop?.themePreset
    },
    petBubbleCheck: finalProbe.petBubbleCheck || null,
    memoryReclaim: {
      skipped: skipMemory,
      idleBefore: memIdleBefore,
      settingsOpen: memSettingsOpen,
      afterClose: memAfterClose,
      reclaimedPrivateWSMB: Math.round((memSettingsOpen.privateWorkingSetMB - memAfterClose.privateWorkingSetMB) * 100) / 100,
      deltaVsIdleBeforeMB: Math.round((memAfterClose.privateWorkingSetMB - memIdleBefore.privateWorkingSetMB) * 100) / 100
    }
  };

  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));

  const pass =
    exitCode === 0 &&
    report.baselineRender.faceReady &&
    report.baselineRender.transparentStyleOk &&
    report.companionBridge.stateOk &&
    report.companionBridge.wallpaperCount >= 4 &&
    report.companionBridge.wallpaperImagePngOk &&
    report.companionBridge.badOriginStatus === 403 &&
    report.companionBridge.missingHeaderStatus === 403 &&
    report.companionBridge.syncStatus === 200 &&
    report.companionBridge.syncUpdatedCharacter === "lin-cat" &&
    report.companionBridge.memoryUnavailableStatus === 503 &&
    report.companionBridge.memoryUnavailableError === "memosyne_unavailable" &&
    report.transcriptAndLedger.hasLiveStep1 &&
    report.settingsCycle.openedViaClick &&
    report.settingsCycle.petResponsiveWhileSettingsOpen &&
    report.settingsCycle.dom?.charCards >= 2 &&
    report.settingsCycle.dom?.wallCards >= 4 &&
    report.settingsCycle.dom?.wallThumbsLoaded >= 4 &&
    report.settingsCycle.dom?.hudPetReady === true &&
    report.settingsCycle.dom?.hudPetCentered === true &&
    report.settingsCycle.dom?.hudSideQuotaReady === true &&
    report.settingsCycle.dom?.hudArcMirrored === true &&
    report.settingsCycle.dom?.settingsHasArgon === false &&
    report.settingsCycle.dom?.savedOk === true &&
    report.settingsCycle.destroyedAfterClose &&
    finalProbe.petBubbleCheck?.claudeGptBubbleOk === true &&
    finalProbe.petBubbleCheck?.bubbleHasArgon === false &&
    report.settingsCycle.persistedScale === 240 &&
    report.settingsCycle.persistedThemePreset === "pink" &&
    (skipMemory || report.memoryReclaim.deltaVsIdleBeforeMB <= 40);

  if (!pass) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
