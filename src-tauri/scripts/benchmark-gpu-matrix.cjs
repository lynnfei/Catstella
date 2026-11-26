const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const tauriRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(tauriRoot, "..");
const cargoToml = path.join(tauriRoot, "Cargo.toml");
const exePath = path.join(tauriRoot, "target/release/catstella-tauri.exe");
const prepareScript = path.join(__dirname, "prepare-frontend.cjs");
const evidenceFile = path.join(repoRoot, "evidence/tauri-gpu-matrix-benchmark.json");

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

function summarizeProcesses(rows) {
  const round2 = (n) => Math.round(n * 100) / 100;
  let gpuPrivateWS = 0;
  let gpuProcs = 0;
  let rendererPrivateWS = 0;
  let rustMainPrivateWS = 0;
  for (const r of rows) {
    const cmd = (r.cmd || "").toLowerCase();
    const name = (r.name || "").toLowerCase();
    if (cmd.includes("--type=gpu-process")) {
      gpuPrivateWS += r.privateWorkingSetMB || 0;
      gpuProcs += 1;
    } else if (cmd.includes("--type=renderer")) {
      rendererPrivateWS += r.privateWorkingSetMB || 0;
    } else if (name.startsWith("catstella-tauri")) {
      rustMainPrivateWS += r.privateWorkingSetMB || 0;
    }
  }
  return {
    processCount: rows.length,
    gpuProcessCount: gpuProcs,
    gpuPrivateWSMB: round2(gpuPrivateWS),
    rendererPrivateWSMB: round2(rendererPrivateWS),
    rustMainPrivateWSMB: round2(rustMainPrivateWS),
    workingSetMB: round2(rows.reduce((s, r) => s + (r.workingSetMB || 0), 0)),
    privateWorkingSetMB: round2(rows.reduce((s, r) => s + (r.privateWorkingSetMB || 0), 0)),
    privateCommitMB: round2(rows.reduce((s, r) => s + (r.privateCommitMB || 0), 0)),
    processes: rows
  };
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
    cmd = if ($pr.CommandLine -and $pr.CommandLine.Length -gt 160) { $pr.CommandLine.Substring(0, 160) } else { [string]$pr.CommandLine }
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
    cmd = if ($pr.CommandLine -and $pr.CommandLine.Length -gt 160) { $pr.CommandLine.Substring(0, 160) } else { [string]$pr.CommandLine }
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

async function runMode({ label, gpuMode, exeMB, artLabel }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `catstella-gpu-${label}-`));
  const readyFile = path.join(tempDir, "ready.json");
  const wv2Dir = path.join(tempDir, "webview2");

  const child = spawn(
    exePath,
    [
      `--data-dir=${tempDir}`,
      `--benchmark-out=${readyFile}`,
      `--gpu-mode=${gpuMode}`,
      "--demo-quota",
      "--test-drag",
      "--exit-after-ms=18000"
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
  const deadline = Date.now() + 14000;
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
    await Promise.race([exitPromise, sleep(20000)]);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    throw new Error(`[${label}] Timed out waiting for ready.json`);
  }

  // Wait 5s for steady-state memory stabilization after drag & probes complete.
  await sleep(5000);
  const memory = sampleTauriProcessTree(ready.pid || child.pid, wv2Dir);

  const exitResult = await Promise.race([
    exitPromise,
    sleep(22000).then(() => ({ code: null, signal: "TIMEOUT" }))
  ]);

  await sleep(600);
  const leftovers = countRemaining(ready.pid || child.pid, wv2Dir);
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  const checks = {
    artReady: ready.artReady === true,
    faceReady: ready.faceReady === true,
    transparentStyleOk: ready.transparentStyleOk === true,
    sideQuotaReady: ready.sideQuotaReady === true,
    toolWindowStyle: ready.toolWindowStyle === true,
    hitRectCountOk: Number(ready.hitRectCount) >= 2,
    dragTestPass: ready.dragTestPass === true && ready.dragUiResponsiveOk === true && ready.dragMovedOk === true,
    exitClean: exitResult.code === 0 && leftovers === 0
  };
  const allPassed = Object.values(checks).every(Boolean);

  return {
    label,
    artLabel,
    gpuMode,
    exeMB,
    ready,
    checks,
    allPassed,
    memory
  };
}

async function main() {
  const electron = sampleElectronBaseline();

  // Build 100% PNG variant once and run all 5 GPU/memory modes against identical asset payload.
  const pngPrep = JSON.parse(runNode(prepareScript, []));
  const pngExeMB = runCargoRelease();

  const modes = ["default", "disable-gpu", "disable-gpu-compositing", "low-mem", "low-mem-sw"];
  const results = [];
  for (const mode of modes) {
    console.log(`Running matrix mode: ${mode} (100% PNG)...`);
    const row = await runMode({
      label: `png-${mode}`,
      gpuMode: mode,
      exeMB: pngExeMB,
      artLabel: "100% PNG"
    });
    results.push(row);
  }

  // Only select default candidate from modes that preserve DWM transparent composition
  // (without --disable-gpu-compositing), while still reporting all 5 modes in the matrix.
  const safeCandidateModes = new Set(["default", "disable-gpu", "low-mem"]);
  const passingPng = results
    .filter((r) => r.allPassed && safeCandidateModes.has(r.gpuMode))
    .sort((a, b) => a.memory.privateWorkingSetMB - b.memory.privateWorkingSetMB || a.memory.privateCommitMB - b.memory.privateCommitMB);

  if (passingPng.length === 0) {
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, JSON.stringify({ checkedAt: new Date().toISOString(), electron, results }, null, 2));
    throw new Error("No safe GPU mode passed all DOM render/drag gates! See " + evidenceFile);
  }

  const bestMode = passingPng[0].gpuMode;

  // Also test bestMode + 640px WebP art compression combo.
  const optPrep = JSON.parse(runNode(prepareScript, ["--optimize-art"]));
  const optExeMB = runCargoRelease();
  console.log(`Running combo: ${bestMode} + 640px WebP...`);
  const comboRow = await runMode({
    label: `webp-${bestMode}`,
    gpuMode: bestMode,
    exeMB: optExeMB,
    artLabel: "640px WebP"
  });
  results.push(comboRow);

  // Restore 100% PNG frontend-dist & release binary.
  runNode(prepareScript, []);
  runCargoRelease();

  const tableRows = [
    {
      Variant: "Electron (Live StarSuite+Host)",
      Art: "100% PNG",
      ExeMB: "—",
      Procs: electron.processCount,
      GpuWS_MB: electron.gpuPrivateWSMB,
      PrivWS_MB: electron.privateWorkingSetMB,
      TotalWS_MB: electron.workingSetMB,
      Commit_MB: electron.privateCommitMB,
      DomRender: "—",
      DragPass: "—"
    },
    ...results.map((r) => ({
      Variant: `Tauri (${r.gpuMode})`,
      Art: r.artLabel,
      ExeMB: `${r.exeMB} MB`,
      Procs: r.memory.processCount,
      GpuWS_MB: r.memory.gpuPrivateWSMB,
      PrivWS_MB: r.memory.privateWorkingSetMB,
      TotalWS_MB: r.memory.workingSetMB,
      Commit_MB: r.memory.privateCommitMB,
      DomRender: (r.checks.faceReady && r.checks.transparentStyleOk && r.checks.sideQuotaReady) ? "PASS" : "FAIL",
      DragPass: r.checks.dragTestPass ? "PASS" : "FAIL"
    }))
  ];

  console.table(tableRows);

  const report = {
    checkedAt: new Date().toISOString(),
    electron,
    pngPrep,
    optPrep,
    bestMode,
    notes: "disable-gpu-compositing and low-mem-sw excluded from automatic default selection to avoid software compositing transparency regressions; screen pixel composite transparency requires visual confirmation on interactive desktop.",
    results
  };
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2));
  console.log(`Best passing mode: ${bestMode}`);
  console.log(`Evidence written: ${evidenceFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
