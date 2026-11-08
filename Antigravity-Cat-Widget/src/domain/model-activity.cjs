class ModelActivity {
  constructor(now = Date.now) {
    this.now = now;
    this.running = new Map();
    this.finished = null;
    this.tools = [];
    this.waitingStep = null;
  }
  get size() { return this.running.size; }
  begin(id, stepIndex) {
    if (this.running.has(id)) return false;
    this.running.set(id, stepIndex);
    this.finished = null;
    return true;
  }
  // 记录最新步骤携带的工具名；比等待步骤更新的模型步骤说明用户已回应，等待态解除。
  observe(stepIndex, tools = []) {
    this.tools = [...new Set(Array.isArray(tools) ? tools : [])].filter(name => typeof name === "string" && name).slice(0, 6);
    if (this.waitingStep !== null && stepIndex > this.waitingStep) this.waitingStep = null;
  }
  setWaiting(stepIndex) { this.waitingStep = stepIndex; }
  clearWaiting() {
    const had = this.waitingStep !== null;
    this.waitingStep = null;
    return had;
  }
  end(id, stepIndex, kind, confirmed = false) {
    const tracked = this.running.delete(id);
    if (!tracked && (!confirmed || this.running.size)) return false;
    if (!this.running.size) this.finished = { kind, stepIndex, expiresAt: this.now() + 4500 };
    return true;
  }
  clear() {
    this.running.clear();
    this.finished = null;
    this.tools = [];
    this.waitingStep = null;
  }
  snapshot() {
    if (this.running.size) {
      let stepIndex;
      for (const index of this.running.values()) stepIndex = index;
      return { kind: "model-running", stepIndex, tools: this.tools.slice(), waitingUser: this.waitingStep !== null };
    }
    if (this.waitingStep !== null) {
      return { kind: "model-waiting", stepIndex: this.waitingStep, tools: this.tools.slice(), waitingUser: true };
    }
    return this.finished?.expiresAt > this.now() ? this.finished : null;
  }
}
module.exports = { ModelActivity };
