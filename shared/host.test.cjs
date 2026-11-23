const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const {
  HOST_DEBUG_FLAGS,
  discover,
  isPrimaryHostPage,
  hasDebugArgs,
  stripDebugArgs,
  mergeDebugArgs,
  inspectHostShortcuts,
  configureHostShortcuts,
  detectHostInstall,
  diagnoseHost,
  launchHostWithDebug
} = require("./host.cjs");

test("hasDebugArgs, stripDebugArgs and mergeDebugArgs handle flags idempotently while preserving custom arguments", () => {
  assert.equal(hasDebugArgs(""), false);
  assert.equal(hasDebugArgs("--user-data-dir=foo --remote-debugging-port="), false);
  assert.equal(hasDebugArgs("--remote-debugging-port=0"), true);
  assert.equal(hasDebugArgs("--foo --remote-debugging-port=9222 --bar"), true);

  assert.equal(mergeDebugArgs(""), "--remote-debugging-port=0 --remote-debugging-address=127.0.0.1");
  assert.equal(
    mergeDebugArgs('--user-data-dir="C:\\My Dir" --foo=1'),
    '--user-data-dir="C:\\My Dir" --foo=1 --remote-debugging-port=0 --remote-debugging-address=127.0.0.1'
  );
  // Idempotent on second call and replaces stale port/address flags cleanly.
  assert.equal(
    mergeDebugArgs('--foo --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --bar'),
    '--foo --bar --remote-debugging-port=0 --remote-debugging-address=127.0.0.1'
  );
  assert.equal(
    mergeDebugArgs(mergeDebugArgs('--foo --bar')),
    '--foo --bar --remote-debugging-port=0 --remote-debugging-address=127.0.0.1'
  );
  assert.equal(stripDebugArgs(mergeDebugArgs('--user-data-dir="C:\\My Dir" --bar')), '--user-data-dir="C:\\My Dir" --bar');
  assert.equal(stripDebugArgs("--remote-debugging-port=0 --remote-debugging-address=127.0.0.1"), "");
});

test("isPrimaryHostPage accepts 127.0.0.1 and localhost loopback targets and rejects remote hosts", () => {
  assert.equal(isPrimaryHostPage({
    type: "page",
    url: "https://127.0.0.1:6547/",
    webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1"
  }), true);
  assert.equal(isPrimaryHostPage({
    type: "page",
    url: "http://localhost:8080/app",
    webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/2"
  }), true);
  assert.equal(isPrimaryHostPage({
    type: "page",
    url: "https://evil.example/",
    webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/3"
  }), false);
  assert.equal(isPrimaryHostPage({
    type: "page",
    url: "https://127.0.0.1:6547/",
    webSocketDebuggerUrl: "ws://192.168.1.2:9222/devtools/page/4"
  }), false);
});

test("discover reads DevToolsActivePort files and falls back to explicitPort while ignoring remote targets", async (t) => {
  const targets = [
    { type: "page", url: "https://evil.example/", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/bad" },
    { type: "page", url: "https://localhost:6547/", webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/good" }
  ];
  const server = http.createServer((req, res) => {
    if (req.url === "/json/list") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(targets));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catstella-port-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const portFile = path.join(dir, "DevToolsActivePort");
  fs.writeFileSync(portFile, `${port}\n/devtools/browser/abc\n`);

  const fromFile = await discover({ portFiles: [portFile] });
  assert.equal(fromFile.port, port);
  assert.equal(fromFile.browserWsUrl, `ws://127.0.0.1:${port}/devtools/browser/abc`);
  assert.equal(fromFile.target.webSocketDebuggerUrl, "ws://localhost:9222/devtools/page/good");

  const fromExplicit = await discover({ portFiles: [path.join(dir, "missing")], explicitPort: port });
  assert.equal(fromExplicit.port, port);
  assert.equal(fromExplicit.browserWsUrl, null);
  assert.equal(fromExplicit.target.webSocketDebuggerUrl, "ws://localhost:9222/devtools/page/good");

  // External non-loopback target list only -> rejected
  targets.splice(1, 1);
  const rejected = await discover({ portFiles: [portFile], explicitPort: port });
  assert.equal(rejected, null);
});

test("detectHostInstall resolves candidate files without touching real registry when mocked", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "catstella-install-"));
  try {
    const fakeExe = path.join(tmpDir, "Antigravity.exe");
    fs.writeFileSync(fakeExe, "stub");
    assert.equal(detectHostInstall({
      platform: "win32",
      candidates: [path.join(tmpDir, "missing.exe"), fakeExe]
    }), fakeExe);
    assert.equal(detectHostInstall({
      platform: "win32",
      candidates: [path.join(tmpDir, "missing.exe")],
      shortcutLookup: () => [],
      registryLookup: () => []
    }), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("diagnoseHost covers connected, running-no-cdp, not-running and not-installed states", async () => {
  const connected = await diagnoseHost({
    discover: async () => ({ port: 9333, target: { webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/1" } }),
    isHostProcessRunning: async () => true,
    detectHostInstall: () => "D:/Program Files/Antigravity/Antigravity.exe",
    inspectHostShortcuts: async () => ({ supported: true, allConfigured: true, shortcuts: [{ path: "desktop", hasDebugFlag: true }] })
  });
  assert.equal(connected.state, "connected");
  assert.equal(connected.connected, true);
  assert.equal(connected.port, 9333);
  assert.equal(connected.shortcutsConfigured, true);

  const runningNoCdp = await diagnoseHost({
    discover: async () => null,
    isHostProcessRunning: async () => true,
    detectHostInstall: () => "D:/Program Files/Antigravity/Antigravity.exe",
    inspectHostShortcuts: async () => ({ supported: true, allConfigured: false, shortcuts: [] })
  });
  assert.equal(runningNoCdp.state, "running-no-cdp");
  assert.equal(runningNoCdp.connected, false);
  assert.equal(runningNoCdp.running, true);

  const notRunning = await diagnoseHost({
    discover: async () => null,
    isHostProcessRunning: async () => false,
    detectHostInstall: () => "D:/Program Files/Antigravity/Antigravity.exe",
    inspectHostShortcuts: async () => ({ supported: false, allConfigured: false, shortcuts: [] })
  });
  assert.equal(notRunning.state, "not-running");
  assert.equal(notRunning.running, false);

  const notInstalled = await diagnoseHost({
    discover: async () => null,
    isHostProcessRunning: async () => false,
    detectHostInstall: () => null,
    inspectHostShortcuts: async () => ({ supported: false, allConfigured: false, shortcuts: [] })
  });
  assert.equal(notInstalled.state, "not-installed");
  assert.equal(notInstalled.installPath, null);
});

test("launchHostWithDebug refuses to kill or respawn when Antigravity is running without CDP, and spawns debug flags when offline", async () => {
  let spawnCalls = 0;
  const blocked = await launchHostWithDebug({
    discover: async () => null,
    isHostProcessRunning: async () => true,
    detectHostInstall: () => "D:/Program Files/Antigravity/Antigravity.exe",
    spawn: () => { spawnCalls++; return { pid: 1 }; }
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "already-running-no-cdp");
  assert.equal(spawnCalls, 0);

  let spawnedArgs = null;
  let unreffed = false;
  const launched = await launchHostWithDebug({
    discover: async () => null,
    isHostProcessRunning: async () => false,
    detectHostInstall: () => "D:/Program Files/Antigravity/Antigravity.exe",
    spawn: (exe, args, opts) => {
      spawnCalls++;
      spawnedArgs = { exe, args, opts };
      return { pid: 4321, unref: () => { unreffed = true; } };
    }
  });
  assert.equal(launched.ok, true);
  assert.equal(launched.pid, 4321);
  assert.equal(spawnCalls, 1);
  assert.equal(unreffed, true);
  assert.equal(spawnedArgs.exe, "D:/Program Files/Antigravity/Antigravity.exe");
  assert.deepEqual(spawnedArgs.args, [...HOST_DEBUG_FLAGS]);
  assert.equal(spawnedArgs.opts.detached, true);
});

test("configureHostShortcuts enables and strips debug flags across user shortcuts", async () => {
  if (process.platform === "win32") {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "catstella-lnk-"));
    try {
      const fakeExe = path.join(tmpDir, "Antigravity.exe");
      const lnk1 = path.join(tmpDir, "Desktop.lnk");
      fs.writeFileSync(fakeExe, "stub");
      const created = await configureHostShortcuts({ paths: [lnk1], installPath: fakeExe, enable: true });
      assert.equal(created.ok, true);
      assert.equal(created.allConfigured, true);
      assert.equal(created.shortcuts.length, 1);
      assert.equal(created.shortcuts[0].hasDebugFlag, true);

      const inspected = await inspectHostShortcuts({ paths: [lnk1] });
      assert.equal(inspected.allConfigured, true);

      const restored = await configureHostShortcuts({ paths: [lnk1], enable: false });
      assert.equal(restored.ok, true);
      assert.equal(restored.allConfigured, false);
      assert.equal(restored.shortcuts[0].arguments, "");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    return;
  }

  let currentArgs = "--existing";
  const lnkPath = "/tmp/Antigravity.lnk";
  const applied = await configureHostShortcuts({
    platform: "win32",
    paths: [lnkPath],
    existsSync: () => true,
    readShortcuts: async () => [{ path: lnkPath, target: "D:\\Program Files\\Antigravity\\Antigravity.exe", arguments: currentArgs }],
    writeShortcuts: async tasks => { currentArgs = tasks[0].arguments; },
    enable: true
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.allConfigured, true);
  assert.match(currentArgs, /^--existing --remote-debugging-port=0/);
});
