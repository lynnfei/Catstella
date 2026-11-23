const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CompanionBridgeServer, sanitizeWebQuota, isAllowedOrigin } = require("./companion-bridge.cjs");

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

test("CompanionBridgeServer syncs dual-end quota, serves desktop wallpaper bytes, applies patches, and rejects untrusted origins", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-bridge-"));
  const wallFile = path.join(tmpDir, "star.png");
  fs.writeFileSync(wallFile, TINY_PNG);

  let state = {
    sync: { syncCharacter: true, syncWallpaper: true, syncInteraction: true, petDisplayMode: "both" },
    desktop: { characterPack: "gemini-star-v1", wallpaperId: "star", wallpaperRev: "star:1", agyQuota: { fiveHour: 75 } }
  };
  const patches = [];
  let webUpdates = 0;

  const bridge = new CompanionBridgeServer({
    port: 0,
    getState: () => state,
    getWallpapers: () => [{ id: "star", title: "Star Sheet", fileName: "star.png", preview: "data:image/png;base64,xx" }],
    resolveWallpaperFile: (id) => (!id || id === "star" ? wallFile : null),
    onPatch: (p) => {
      patches.push(p);
      if (p.characterPack) state.desktop.characterPack = p.characterPack;
      if (p.syncWallpaper !== undefined) state.sync.syncWallpaper = Boolean(p.syncWallpaper);
    },
    onWebUpdate: () => { webUpdates++; }
  });

  let port = await bridge.start();
  assert(typeof port === "number" && port > 0);
  t.after(async () => {
    await bridge.stop();
  });

  // 1. State endpoint works for extension origin
  let stateRes;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      stateRes = await fetch(`http://127.0.0.1:${port}/companion/state`, {
        headers: { Origin: "chrome-extension://abcdefghijklmnop" }
      });
      break;
    } catch (error) {
      // Port 0 can allocate a Fetch-blocked port on this Windows setup. Retry
      // only that client-side refusal; never hide a real bridge/network failure.
      if (error.cause?.message !== 'bad port' || attempt === 11) throw error;
      await bridge.stop();
      port = await bridge.start();
    }
  }
  assert.equal(stateRes.status, 200);
  const stateJson = await stateRes.json();
  assert.equal(stateJson.ok, true);
  assert.equal(stateJson.desktop.characterPack, "gemini-star-v1");
  assert.equal(stateJson.web.online, false);

  // 2. Rejects untrusted public web origin
  const badOriginRes = await fetch(`http://127.0.0.1:${port}/companion/state`, {
    headers: { Origin: "https://evil.example.com" }
  });
  assert.equal(badOriginRes.status, 403);
  assert.equal(isAllowedOrigin("https://evil.example.com"), false);
  assert.equal(isAllowedOrigin("moz-extension://1234-5678"), true);

  // 3. Rejects POST without X-Catstella-Client header
  const noHeaderPost = await fetch(`http://127.0.0.1:${port}/companion/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webActive: true })
  });
  assert.equal(noHeaderPost.status, 403);

  // 4. Accepts valid Web Companion sync & patch
  const syncRes = await fetch(`http://127.0.0.1:${port}/companion/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Catstella-Client": "gemini-web-companion"
    },
    body: JSON.stringify({
      webActive: true,
      webVisible: true,
      webQuota: { dailyTotal: 18, window5hTotal: 6, flashCount: 10, thinkingCount: 5, proCount: 3, lastModel: "Thinking" },
      patch: { characterPack: "lin-cat", syncWallpaper: false }
    })
  });
  assert.equal(syncRes.status, 200);
  const synced = await syncRes.json();
  assert.equal(synced.web.online, true);
  assert.equal(synced.web.active, true);
  assert.equal(synced.web.visible, true);
  assert.equal(synced.web.quota.dailyTotal, 18);
  assert.equal(synced.desktop.characterPack, "lin-cat");
  assert.deepEqual(synced.desktop.agyQuota, { fiveHour: 75 });
  assert.equal(synced.sync.syncWallpaper, false);
  assert.equal(patches.length, 1);
  assert.equal(webUpdates, 1);

  const withoutQuota = await fetch(`http://127.0.0.1:${port}/companion/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Catstella-Client": "gemini-web-companion" },
    body: JSON.stringify({ webActive: true, webVisible: true, includeAgyQuota: false })
  }).then(response => response.json());
  assert.equal(withoutQuota.desktop.agyQuota, undefined);
  assert.equal(withoutQuota.desktop.wallpaperId, "star");
  assert.equal(withoutQuota.web.quota.dailyTotal, 18);
  assert.deepEqual(state.desktop.agyQuota, { fiveHour: 75 }, "a Web preference must not modify desktop quota");

  // 5. Serves raw desktop wallpaper bytes
  const imgRes = await fetch(`http://127.0.0.1:${port}/companion/wallpaper-image?id=star`);
  assert.equal(imgRes.status, 200);
  assert.equal(imgRes.headers.get("content-type"), "image/png");
  const bytes = Buffer.from(await imgRes.arrayBuffer());
  assert.deepEqual(bytes, TINY_PNG);

  // 6. Sanitize clamps invalid values safely
  assert.equal(sanitizeWebQuota({ dailyTotal: -5, fiveHourRemainingPct: 999 }).dailyTotal, 0);
  assert.equal(sanitizeWebQuota({ fiveHourRemainingPct: 999 }).fiveHourRemainingPct, 100);

  // 7. Dispatches /api/memory/* routes to Memosyne bridge adapter when present
  const memStateRes = await fetch(`http://127.0.0.1:${port}/api/memory/status`, {
    headers: { Origin: "chrome-extension://abcdefghijklmnop" }
  });
  if (fs.existsSync("D:\\Projects\\Memosyne\\src\\catstella-bridge-adapter.cjs")) {
    assert.equal(memStateRes.status, 200);
    const memStateJson = await memStateRes.json();
    assert.equal(memStateJson.ok, true);
    assert(typeof memStateJson.counts.memories === "number");
  }
});
