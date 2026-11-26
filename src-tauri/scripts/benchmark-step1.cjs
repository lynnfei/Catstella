const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const tauriRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(tauriRoot, "..");
const cargoToml = path.join(tauriRoot, "Cargo.toml");
const exePath = path.join(tauriRoot, "target/release/catstella-tauri.exe");
const prepareScript = path.join(__dirname, "prepare-frontend.cjs");
const evidenceFile = path.join(repoRoot, "evidence/tauri-step1-benchmark.json");

function runNode(script, args = []) {
  const out = execFileSync(process.execPath, [script, ...args], {
    cwd: tauriRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return out.trim();
}

function runCargoRelease() {
  execFileSync(
    "cargo",
    ["build", "--manifest-path", cargoToml, "--release", "--offline"],
    { cwd: tauriRoot, stdio: "inherit" }
  );
  const stat = fs.statSync(exePath);
  return Math.round((stat.size / (1024 * 1024)) * 100) / 100;
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

function sampleElectronBaseline() {
  const ps = `
$procs = @(Get-CimInstance Win32_Process -Filter "Name LIKE 'StarSuite%' OR Name LIKE 'ForegroundHost%'")
$perfMap = @{}
foreach ($p in (Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction SilentlyContinue)) {
  if ($p.IDProcess) { $perfMap[[int]$p.IDProcess] = $p }
}
$rows = foreach ($pr in $procs) {
  $id = [int]$pr.ProcessId
  $perf = $perfMap[$id]
  $wsPriv = if ($perf -and $perf.WorkingSetPrivate) { [double]$perf.WorkingSetPrivate } else { [double]$pr.PrivatePageCount }
  [PSCustomObject]@{
    pid = $id
    name = $pr.Name
    workingSetMB = [math]::Round($pr.WorkingSetSize / 1MB, 2)
    privateWorkingSetMB = [math]::Round($wsPriv / 1MB, 2)
    privateCommitMB = [math]::Round($pr.PrivatePageCount / 1MB, 2)
    cmd = if ($pr.CommandLine -and $pr.CommandLine.Length -gt 120) { $pr.CommandLine.Substring(0, 120) } else { [string]$pr.CommandLine }
  }
}
ConvertTo-Json -InputObject @($rows) -Compress
`;
  const rows = runPowerShellJson(ps);
  return summarizeProcesses(Array.isArray(rows) ? rows : rows ? [rows] : []);
}

function sampleTauriProcessTree(rootPid, wv2Folder) {
  const ps = `
$rootPid = [int]$env:CATSTELLA_ROOT_PID
$wv2 = $env:CATSTELLA_WV2_FOLDER
$all = @(Get-CimInstance Win32_Process)
$byParent = @{}
foreach ($p in $all) {
  $ppid = [int]$p.ParentProcessId
  if (-not $byParent.ContainsKey($ppid)) { $byParent[$ppid] = New-Object System.Collections.Generic.List[object] }
  $byParent[$ppid].Add($p)
}
$selected = @{}
$queue = New-Object System.Collections.Generic.Queue[int]
$queue.Enqueue($rootPid)
while ($queue.Count -gt 0) {
  $cur = $queue.Dequeue()
  if ($selected.ContainsKey($cur)) { continue }
  $proc = $all | Where-Object { [int]$_.ProcessId -eq $cur } | Select-Object -First 1
  if ($proc) {
    $selected[$cur] = $proc
    if ($byParent.ContainsKey($cur)) {
      foreach ($ch in $byParent[$cur]) { $queue.Enqueue([int]$ch.ProcessId) }
    }
  }
}
foreach ($p in $all) {
  if ($p.CommandLine -and $p.CommandLine.IndexOf($wv2, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
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
    cmd = if ($pr.CommandLine -and $pr.CommandLine.Length -gt 120) { $pr.CommandLine.Substring(0, 120) } else { [string]$pr.CommandLine }
  }
}
ConvertTo-Json -InputObject @($rows) -Compress
`;
  const rows = runPowerShellJson(ps, {
    CATSTELLA_ROOT_PID: String(rootPid),
    CATSTELLA_WV2_FOLDER: wv2Folder
  });
  return summarizeProcesses(Array.isArray(rows) ? rows : rows ? [rows] : []);
}

function summarizeProcesses(rows) {
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    processCount: rows.length,
    workingSetMB: round2(rows.reduce((s, r) => s + (r.workingSetMB || 0), 0)),
    privateWorkingSetMB: round2(rows.reduce((s, r) => s + (r.privateWorkingSetMB || 0), 0)),
    privateCommitMB: round2(rows.reduce((s, r) => s + (r.privateCommitMB || 0), 0)),
    processes: rows
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function countRemaining(rootPid, wv2Folder) {
  const ps = `
$rootPid = [int]$env:CATSTELLA_ROOT_PID
$wv2 = $env:CATSTELLA_WV2_FOLDER
$hits = @(Get-CimInstance Win32_Process | Where-Object {
  ([int]$_.ProcessId -eq $rootPid) -or ($_.CommandLine -and $_.CommandLine.IndexOf($wv2, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
})
ConvertTo-Json -InputObject @($hits.Count) -Compress
`;
  const res = runPowerShellJson(ps, {
    CATSTELLA_ROOT_PID: String(rootPid),
    CATSTELLA_WV2_FOLDER: wv2Folder
  });
  return Array.isArray(res) ? Number(res[0] || 0) : Number(res || 0);
}

async function runVariant(label, optimizeArt) {
  const prepOut = JSON.parse(runNode(prepareScript, optimizeArt ? ["--optimize-art"] : []));
  const exeMB = runCargoRelease();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `catstella-tauri-${label}-`));
  const readyFile = path.join(tempDir, "ready.json");
  const wv2Dir = path.join(tempDir, "webview2");

  const child = spawn(
    exePath,
    [
      `--data-dir=${tempDir}`,
      `--benchmark-out=${readyFile}`,
      "--demo-quota",
      "--exit-after-ms=16000"
    ],
    {
      cwd: tauriRoot,
      stdio: "ignore",
      windowsHide: false
    }
  );

  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  let ready = null;
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (fs.existsSync(readyFile)) {
      try {
        ready = JSON.parse(fs.readFileSync(readyFile, "utf8"));
        if (ready && ready.ok) break;
      } catch {}
    }
    await sleep(250);
  }

  if (!ready) {
    throw new Error(`[${label}] Timed out waiting for ready.json`);
  }

  // Wait 5s for WebView2 image decode, side-quota render & memory stabilization.
  await sleep(5000);
  const memory = sampleTauriProcessTree(ready.pid || child.pid, wv2Dir);

  const exitResult = await Promise.race([
    exitPromise,
    sleep(20000).then(() => ({ code: null, signal: "TIMEOUT" }))
  ]);

  // Brief wait for WebView2 child teardown, then verify zero leftovers.
  await sleep(600);
  const leftovers = countRemaining(ready.pid || child.pid, wv2Dir);

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  const assertions = {
    artReady: ready.artReady === true,
    toolWindowStyle: ready.toolWindowStyle === true,
    hitRectCountOk: Number(ready.hitRectCount) >= 2,
    foregroundKindOk: typeof ready.foregroundKind === "string" && ready.foregroundKind.length > 0,
    exitClean: exitResult.code === 0 && leftovers === 0
  };

  if (!Object.values(assertions).every(Boolean)) {
    throw new Error(`[${label}] Assertions failed: ${JSON.stringify({ assertions, ready, exitResult, leftovers })}`);
  }

  return {
    label,
    optimizeArt,
    exeMB,
    frontendDistMB: prepOut.totalMB,
    characterPacksMB: prepOut.characterPacksMB,
    ready,
    assertions,
    memory
  };
}

async function main() {
  const electron = sampleElectronBaseline();
  const tauriPng = await runVariant("png", false);
  const tauriOpt = await runVariant("opt", true);

  // Restore lossless PNG frontend-dist & release binary for user preview.
  runNode(prepareScript, []);
  const restoredExeMB = runCargoRelease();

  const pctDelta = (base, next) =>
    base > 0 ? Math.round(((next - base) / base) * 1000) / 10 : null;

  const report = {
    checkedAt: new Date().toISOString(),
    electron,
    tauriPng,
    tauriOptimized: tauriOpt,
    restoredExeMB,
    comparison: {
      pngVsElectronPrivateWorkingSetPct: pctDelta(
        electron.privateWorkingSetMB,
        tauriPng.memory.privateWorkingSetMB
      ),
      pngVsElectronPrivateCommitPct: pctDelta(
        electron.privateCommitMB,
        tauriPng.memory.privateCommitMB
      ),
      optVsElectronPrivateWorkingSetPct: pctDelta(
        electron.privateWorkingSetMB,
        tauriOpt.memory.privateWorkingSetMB
      ),
      optVsElectronPrivateCommitPct: pctDelta(
        electron.privateCommitMB,
        tauriOpt.memory.privateCommitMB
      )
    }
  };

  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2));

  console.table([
    {
      Variant: "Electron (Live StarSuite + ForegroundHost)",
      Procs: electron.processCount,
      ExeOrAppMB: "—",
      PrivateWS_MB: electron.privateWorkingSetMB,
      WorkingSet_MB: electron.workingSetMB,
      PrivateCommit_MB: electron.privateCommitMB
    },
    {
      Variant: "Tauri Step1 (100% PNG)",
      Procs: tauriPng.memory.processCount,
      ExeOrAppMB: `${tauriPng.exeMB} MB`,
      PrivateWS_MB: tauriPng.memory.privateWorkingSetMB,
      WorkingSet_MB: tauriPng.memory.workingSetMB,
      PrivateCommit_MB: tauriPng.memory.privateCommitMB
    },
    {
      Variant: "Tauri Step1 (640px WebP)",
      Procs: tauriOpt.memory.processCount,
      ExeOrAppMB: `${tauriOpt.exeMB} MB`,
      PrivateWS_MB: tauriOpt.memory.privateWorkingSetMB,
      WorkingSet_MB: tauriOpt.memory.workingSetMB,
      PrivateCommit_MB: tauriOpt.memory.privateCommitMB
    }
  ]);
  console.log("Evidence written:", evidenceFile);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
