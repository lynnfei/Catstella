const { discover, Cdp } = require("../../../shared/host.cjs");
const { installTheme } = require("../host/theme.cjs");
const { appearancePayload } = require("./theme-loader.cjs");
const appearanceKeys=new Set(['chatTint','chatOpacity','replyOpacity','opacity','outputMode']);
function sameWallpaperSettings(signature,settings){
 if(!signature)return false;
 const previous=JSON.parse(signature),keys=new Set([...Object.keys(previous),...Object.keys(settings)]);
 return [...keys].every(key=>appearanceKeys.has(key)||JSON.stringify(previous[key])===JSON.stringify(settings[key]));
}
class HostController {
  constructor(loader, onStatus, options = {}) {
    this.owner = options.owner || require("node:crypto").randomUUID();
    this.loader = loader;
    this.onStatus = onStatus;
    this.discover = options.discover || discover;
    this.createClient = options.createClient || (url => new Cdp(url));
    this.client = null;
    this.primaryUrl = null;
    this.extraClients = new Map();
    this.settings = { enabled: false };
    this.status = { connected: false, applied: false, message: "等待连接 Antigravity" };
    this.signature = null;
    this.revision = 0;
  }
  report(value) {
    this.status = { ...this.status, ...value };
    try { this.onStatus(this.status); } catch (error) {
      console.warn("皮肤状态通知失败：", error.message);
    }
  }
  tick() {
    if (this.stopping) return Promise.resolve();
    if (!this.inflight) {
      this.inflight = this.drain().finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }
  async drain() {
    let revision;
    do {
      revision = this.revision;
      await this.runTick(revision);
    } while (!this.stopping && revision !== this.revision);
  }
  async applyTheme(client,current,settings,previousSignature){
    if(current.themed&&current.appearance&&sameWallpaperSettings(previousSignature,settings)){
      return client.evaluate('window.__agyDreamSkinV2.updateAppearance('+JSON.stringify(appearancePayload(settings))+')');
    }
    const payload={...this.loader.payload(settings),owner:this.owner};
    return client.evaluate('('+installTheme.toString()+')('+JSON.stringify(payload)+')');
  }
  async syncSecondaryTargets(targets, settings, signature, revision) {
    if (!Array.isArray(targets) || targets.length <= 1) {
      for (const [url, entry] of this.extraClients.entries()) {
        entry.client?.close();
        this.extraClients.delete(url);
      }
      return;
    }
    const activeUrls = new Set();
    for (const target of targets) {
      const wsUrl = target?.webSocketDebuggerUrl;
      if (!wsUrl || wsUrl === this.primaryUrl) continue;
      activeUrls.add(wsUrl);
      let entry = this.extraClients.get(wsUrl);
      if (!entry || entry.client.closed) {
        try {
          entry = { client: this.createClient(wsUrl), signature: null };
          this.extraClients.set(wsUrl, entry);
        } catch { continue; }
      }
      try {
        const cur = await entry.client.evaluate(
          "({ready:document.readyState,themed:!!window.__agyDreamSkinV2?.status().applied,owner:window.__agyDreamSkinV2?.owner,appearance:typeof window.__agyDreamSkinV2?.updateAppearance==='function'})"
        );
        if (revision !== this.revision || this.stopping) return;
        if (!settings.enabled) {
          if (cur.themed && cur.owner === this.owner) {
            await entry.client.evaluate("window.__agyDreamSkinV2?.destroy()");
          }
          entry.signature = null;
          continue;
        }
        if (cur.themed && cur.owner !== this.owner) continue;
        if (!cur.themed || entry.signature !== signature) {
          await this.applyTheme(entry.client,cur,settings,entry.signature);
          entry.signature = signature;
        }
      } catch {
        entry.client?.close();
        this.extraClients.delete(wsUrl);
      }
    }
    for (const [url, entry] of this.extraClients.entries()) {
      if (!activeUrls.has(url)) {
        entry.client?.close();
        this.extraClients.delete(url);
      }
    }
  }
  async runTick(revision) {
    const settings = { ...this.settings };
    try {
      let foundTargets = null;
      if (!this.client || this.client.closed) {
        const found = await this.discover();
        if (!found) {
          this.report({ connected: false, applied: false, message: "请先打开 Antigravity，检测到后自动连接" });
          return;
        }
        this.primaryUrl = found.target.webSocketDebuggerUrl;
        this.client = this.createClient(this.primaryUrl);
        this.signature = null;
        foundTargets = found.targets || null;
      } else if (this.discover === discover) {
        try {
          const found = await this.discover();
          foundTargets = found?.targets || null;
        } catch {}
      }
      const current = await this.client.evaluate(
        "({ready:document.readyState,themed:!!window.__agyDreamSkinV2?.status().applied,owner:window.__agyDreamSkinV2?.owner,appearance:typeof window.__agyDreamSkinV2?.updateAppearance==='function'})"
      );
      if (revision !== this.revision || this.stopping) return;
      if (!settings.enabled) {
        if (current.themed && current.owner === this.owner) {
          await this.client.evaluate("window.__agyDreamSkinV2?.destroy()");
        }
        this.signature = null;
        if (foundTargets) await this.syncSecondaryTargets(foundTargets, settings, null, revision);
        this.report({
          connected: true, applied: false,
          message: current.themed && current.owner !== this.owner
            ? "已连接 · 当前实例未启用，另一个皮肤实例正在运行"
            : "已连接 · 皮肤已关闭，宿主恢复原样"
        });
        return;
      }
      if (current.themed && current.owner !== this.owner) {
        this.report({ connected: true, applied: false, message: "已连接 · 皮肤由另一个运行实例管理" });
        return;
      }
      const signature = JSON.stringify(settings);
      if (!current.themed || signature !== this.signature) {
        const result = await this.applyTheme(this.client,current,settings,this.signature);
        this.signature = signature;
        this.report({
          connected: true, ...result,
          message: result.applied ? "已应用到真实 Antigravity · 可随时关闭" : "宿主布局已变化，等待重新应用"
        });
      }
      if (foundTargets) await this.syncSecondaryTargets(foundTargets, settings, signature, revision);
    } catch (error) {
      this.client?.close();
      this.client = null;
      this.primaryUrl = null;
      this.signature = null;
      this.report({ connected: false, applied: false, message: "暂未接入：" + error.message });
    }
  }
  start(settings) {
    clearInterval(this.timer);
    this.stopping = false;
    this.update(settings);
    this.timer = setInterval(() => this.tick(), 2500);
  }
  update(settings) {
    this.settings = { ...settings };
    this.revision++;
    return this.tick();
  }
  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    try { await this.inflight; } catch {}
    try {
      if (this.client && !this.client.closed) {
        await this.client.evaluate("window.__agyDreamSkinV2?.owner===" + JSON.stringify(this.owner) + " ? window.__agyDreamSkinV2.destroy() : null");
      }
    } catch {}
    this.client?.close();
    for (const [, entry] of this.extraClients.entries()) {
      try {
        if (entry.client && !entry.client.closed) {
          await entry.client.evaluate("window.__agyDreamSkinV2?.owner===" + JSON.stringify(this.owner) + " ? window.__agyDreamSkinV2.destroy() : null");
        }
      } catch {}
      entry.client?.close();
    }
    this.extraClients.clear();
  }
}
module.exports = { HostController };
