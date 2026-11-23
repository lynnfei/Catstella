const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const DEFAULT_BRIDGE_PORTS = [3921, 3922, 3923];
const EXTENSION_PROTOCOLS = new Set(["chrome-extension:", "moz-extension:", "safari-web-extension:", "vscode-webview:", "vscode-file:", "app:"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

let cachedMemosyneAdapter = undefined;

function loadMemosyneAdapter(customAdapterPath) {
  if (customAdapterPath) {
    try {
      if (fs.existsSync(customAdapterPath)) return require(customAdapterPath);
    } catch {
      return null;
    }
  }
  if (cachedMemosyneAdapter !== undefined) return cachedMemosyneAdapter;
  const candidates = [
    process.env.MEMOSYNE_ADAPTER_PATH,
    path.resolve(__dirname, "../../Projects/Memosyne/src/catstella-bridge-adapter.cjs"),
    "D:\\Projects\\Memosyne\\src\\catstella-bridge-adapter.cjs"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cachedMemosyneAdapter = require(candidate);
        return cachedMemosyneAdapter;
      }
    } catch {
      // try next candidate
    }
  }
  cachedMemosyneAdapter = null;
  return null;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (typeof origin !== "string" || origin === "null") return false;
  try {
    const parsed = new URL(origin);
    if (EXTENSION_PROTOCOLS.has(parsed.protocol)) return true;
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
      return parsed.origin !== "null";
    }
    return false;
  } catch {
    return false;
  }
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (!origin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Catstella-Client");
}

function sanitizeWebQuota(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
  const pct = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);
  return {
    dailyTotal: num(raw.dailyTotal),
    window5hTotal: num(raw.window5hTotal),
    flashCount: num(raw.flashCount),
    thinkingCount: num(raw.thinkingCount),
    proCount: num(raw.proCount),
    dailyBudget: num(raw.dailyBudget) || 150,
    fiveHourUsedPct: pct(raw.fiveHourUsedPct),
    fiveHourRemainingPct: pct(raw.fiveHourRemainingPct),
    weeklyUsedPct: pct(raw.weeklyUsedPct),
    weeklyRemainingPct: pct(raw.weeklyRemainingPct),
    dailyRemainingPct: pct(raw.dailyRemainingPct),
    sessionTurns: num(raw.sessionTurns),
    sessionTokensEst: num(raw.sessionTokensEst),
    displaySource: typeof raw.displaySource === "string" ? raw.displaySource.slice(0, 24) : "",
    lastModel: typeof raw.lastModel === "string" ? raw.lastModel.slice(0, 48) : "",
    resetHint: typeof raw.resetHint === "string" ? raw.resetHint.slice(0, 64) : "",
    weeklyResetHint: typeof raw.weeklyResetHint === "string" ? raw.weeklyResetHint.slice(0, 64) : ""
  };
}

class CompanionBridgeServer {
  constructor(options = {}) {
    this.ports = Array.isArray(options.ports) && options.ports.length
      ? options.ports
      : (typeof options.port === "number" ? [options.port] : DEFAULT_BRIDGE_PORTS);
    this.getState = options.getState || (() => ({}));
    this.getWallpapers = options.getWallpapers || (() => []);
    this.resolveWallpaperFile = options.resolveWallpaperFile || (() => null);
    this.onPatch = options.onPatch || (() => {});
    this.onWebUpdate = options.onWebUpdate || (() => {});
    this.onOpenSettings = options.onOpenSettings;
    this.portalNonce = this.onOpenSettings ? options.portalNonce || crypto.randomBytes(16).toString("hex") : null;
    this.memosyneOptions = options.memosyneOptions || {};

    this.server = null;
    this.boundPort = null;
    this.webState = {
      lastSeen: 0,
      active: false,
      visible: false,
      quota: null,
      client: ""
    };
  }

  getWebSnapshot() {
    const now = Date.now();
    const online = this.webState.lastSeen > 0 && now - this.webState.lastSeen < 15000;
    const active = online && this.webState.active === true && now - this.webState.lastSeen < 12000;
    return {
      port: this.boundPort,
      online,
      active,
      visible: online && this.webState.visible === true,
      lastSeen: this.webState.lastSeen || null,
      quota: this.webState.quota,
      client: this.webState.client || ""
    };
  }

  buildPayload(includeAgyQuota = true) {
    let base = this.getState() || {};
    if (!includeAgyQuota && base.desktop) {
      const desktop = { ...base.desktop };
      delete desktop.agyQuota;
      base = { ...base, desktop };
    }
    return {
      ok: true,
      ts: Date.now(),
      port: this.boundPort,
      ...base,
      web: this.getWebSnapshot()
    };
  }

  sendJson(req, res, statusCode, body) {
    setCorsHeaders(req, res);
    const json = JSON.stringify(body);
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(json)
    });
    res.end(json);
  }

  handleRequest(req, res) {
    if (!isAllowedOrigin(req.headers.origin)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden origin");
      return;
    }

    if (req.method === "OPTIONS") {
      setCorsHeaders(req, res);
      res.writeHead(204);
      res.end();
      return;
    }

    let parsed;
    try {
      parsed = new URL(req.url || "/", "http://127.0.0.1");
    } catch {
      this.sendJson(req, res, 400, { ok: false, error: "bad_url" });
      return;
    }

    if (parsed.pathname.startsWith("/api/memory/")) {
      setCorsHeaders(req, res);
      const adapter = loadMemosyneAdapter(this.memosyneOptions.adapterPath);
      if (!adapter || typeof adapter.dispatchMemosyneCompanionRequest !== "function") {
        this.sendJson(req, res, 503, { ok: false, error: "memosyne_unavailable" });
        return;
      }
      Promise.resolve(adapter.dispatchMemosyneCompanionRequest(req, res, parsed, this.memosyneOptions))
        .then((handled) => {
          if (!handled && !res.writableEnded) {
            this.sendJson(req, res, 404, { ok: false, error: "memory_route_not_found" });
          }
        })
        .catch((err) => {
          if (!res.writableEnded) {
            this.sendJson(req, res, 500, { ok: false, error: String(err?.message || err) });
          }
        });
      return;
    }

    if (req.method === "GET" && parsed.pathname === "/companion/state") {
      this.sendJson(req, res, 200, this.buildPayload());
      return;
    }

    if (req.method === "GET" && parsed.pathname === "/companion/wallpapers") {
      const items = (this.getWallpapers() || []).map((w) => ({
        id: w.id,
        title: w.title || w.name || w.id,
        fileName: w.fileName || "",
        preview: w.preview || "",
        pack: w.pack,
        revision: (() => { try { const stat = fs.statSync(this.resolveWallpaperFile(w.id)); return w.id + ':' + Math.round(stat.mtimeMs) + ':' + stat.size; } catch { return w.id; } })()
      }));
      this.sendJson(req, res, 200, { ok: true, wallpapers: items });
      return;
    }

    if (req.method === "GET" && parsed.pathname === "/companion/wallpaper-image") {
      const id = parsed.searchParams.get("id") || "";
      const filePath = this.resolveWallpaperFile(id);
      if (!filePath || typeof filePath !== "string" || !fs.existsSync(filePath)) {
        this.sendJson(req, res, 404, { ok: false, error: "wallpaper_not_found" });
        return;
      }
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > 40 * 1024 * 1024) {
          this.sendJson(req, res, 404, { ok: false, error: "invalid_wallpaper_file" });
        } else {
          const ext = path.extname(filePath).toLowerCase();
          const mime = MIME_BY_EXT[ext] || "application/octet-stream";
          setCorsHeaders(req, res);
          res.writeHead(200, {
            "Content-Type": mime,
            "Content-Length": stat.size,
            "Cache-Control": "private, max-age=300"
          });
          fs.createReadStream(filePath).pipe(res);
        }
      } catch {
        this.sendJson(req, res, 500, { ok: false, error: "wallpaper_read_failed" });
      }
      return;
    }

    if (this.onOpenSettings && req.method === "POST" && parsed.pathname === "/companion/open-settings") {
      let raw = "";
      req.on("data", chunk => {
        raw += chunk.toString("utf8");
        if (raw.length > 16384) req.destroy();
      });
      req.on("end", () => {
        try {
          const body = raw ? JSON.parse(raw) : {};
          if (typeof body.nonce !== "string" || body.nonce !== this.portalNonce) {
            this.sendJson(req, res, 403, { ok: false, error: "invalid_portal_nonce" });
            return;
          }
          const tab = typeof body.tab === "string" ? body.tab.slice(0, 32) : "byok";
          try { this.onOpenSettings(tab); } catch {}
          this.sendJson(req, res, 200, { ok: true, opened: tab });
        } catch {
          this.sendJson(req, res, 400, { ok: false, error: "invalid_json" });
        }
      });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/companion/sync") {
      if (req.headers["x-catstella-client"] !== "gemini-web-companion") {
        this.sendJson(req, res, 403, { ok: false, error: "missing_client_header" });
        return;
      }
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk.toString("utf8");
        if (raw.length > 262144) req.destroy();
      });
      req.on("end", () => {
        try {
          const body = raw ? JSON.parse(raw) : {};
          const prevOnline = this.getWebSnapshot().online;
          const prevActive = this.webState.active;
          const prevVisible = this.webState.visible;
          const prevQuotaJson = JSON.stringify(this.webState.quota);

          this.webState.lastSeen = Date.now();
          if (typeof body.webActive === "boolean") {
            this.webState.active = body.webActive;
          }
          this.webState.visible = typeof body.webVisible === 'boolean' ? body.webVisible : body.webActive === true;
          if (body.webQuota && typeof body.webQuota === "object") {
            this.webState.quota = sanitizeWebQuota(body.webQuota);
          }
          if (typeof body.client === "string") {
            this.webState.client = body.client.slice(0, 48);
          }

          if (body.patch && typeof body.patch === "object" && !Array.isArray(body.patch)) {
            this.onPatch(body.patch);
          }

          if (body.completedTurn && typeof body.completedTurn === "object") {
            const adapter = loadMemosyneAdapter(this.memosyneOptions.adapterPath);
            if (adapter && typeof adapter.getMemosyneBridgeHandler === "function") {
              adapter.getMemosyneBridgeHandler(this.memosyneOptions)
                .then(({ store }) => {
                  const { userPrompt, modelResponse, source = "Web" } = body.completedTurn;
                  if (userPrompt && modelResponse) {
                    return store.ingestTurnAndExtract({ userPrompt, modelResponse, source });
                  }
                })
                .catch(() => {});
            }
          }

          const changed =
            !prevOnline ||
            prevActive !== this.webState.active ||
            prevVisible !== this.webState.visible ||
            prevQuotaJson !== JSON.stringify(this.webState.quota);

          if (changed) {
            try { this.onWebUpdate(this.getWebSnapshot()); } catch {}
          }

          this.sendJson(req, res, 200, this.buildPayload(body.includeAgyQuota !== false));
        } catch {
          this.sendJson(req, res, 400, { ok: false, error: "invalid_json" });
        }
      });
      return;
    }

    this.sendJson(req, res, 404, { ok: false, error: "not_found" });
  }

  async start() {
    if (this.server) return this.boundPort;
    for (const candidatePort of this.ports) {
      try {
        const port = await new Promise((resolve, reject) => {
          const srv = http.createServer((req, res) => this.handleRequest(req, res));
          const onError = (err) => {
            srv.close();
            reject(err);
          };
          srv.once("error", onError);
          srv.listen(candidatePort, "127.0.0.1", () => {
            srv.removeListener("error", onError);
            this.server = srv;
            const addr = srv.address();
            resolve(typeof addr === "object" && addr ? addr.port : candidatePort);
          });
        });
        this.boundPort = port;
        return port;
      } catch {
        // Try next candidate port
      }
    }
    return null;
  }

  stop() {
    const srv = this.server;
    this.server = null;
    this.boundPort = null;
    if (!srv) return Promise.resolve();
    return new Promise((resolve) => srv.close(() => resolve()));
  }
}

module.exports = {
  CompanionBridgeServer,
  DEFAULT_BRIDGE_PORTS,
  sanitizeWebQuota,
  isAllowedOrigin
};
