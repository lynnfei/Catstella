class ModelActivity {
  constructor(now = Date.now) {
    this.now = now;
    this.running = new Map();
    this.finished = null;
    this.sessions = new Map();
    this.waiting = new Map();
    this.replies = new Map();
  }
  get size() { return this.running.size; }
  begin(id, stepIndex) {
    if (this.running.has(id)) return false;
    this.running.set(id, stepIndex);
    const session = id.includes(':') ? id.slice(0,id.lastIndexOf(':')) : '';
    if (stepIndex > this.waiting.get(session)) this.waiting.delete(session);
    this.finished = null;
    return true;
  }
  // 记录最新步骤携带的工具名；比等待步骤更新的模型步骤说明用户已回应，等待态解除。
  observe(stepIndex, tools = [], session = '') {
    const previous = this.sessions.get(session);
    if (previous && previous.stepIndex > stepIndex) return false;
    const names = [...new Set(Array.isArray(tools) ? tools : [])].filter(name => typeof name === "string" && name).slice(0, 6);
    const changed = !previous || previous.stepIndex !== stepIndex || JSON.stringify(previous.tools) !== JSON.stringify(names);
    this.sessions.set(session, {stepIndex,tools:names});
    if (stepIndex > this.waiting.get(session)) this.waiting.delete(session);
    return changed;
  }
  setWaiting(stepIndex, session = '') {
    if (this.sessions.get(session)?.stepIndex > stepIndex || this.replies.get(session) >= stepIndex) return false;
    this.waiting.set(session,stepIndex);
    return true;
  }
  clearWaiting(session, stepIndex) {
    if (session === undefined) { const had = !!this.waiting.size; this.waiting.clear(); return had; }
    if (Number.isSafeInteger(stepIndex)) this.replies.set(session,Math.max(this.replies.get(session) ?? -1,stepIndex));
    const had = this.waiting.has(session) && (!Number.isSafeInteger(stepIndex) || this.waiting.get(session) <= stepIndex);
    if (had) this.waiting.delete(session);
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
    this.sessions.clear();
    this.waiting.clear();
    this.replies.clear();
  }
  snapshot() {
    if (this.running.size) {
      let stepIndex, session;
      for (const [id,index] of this.running) { stepIndex = index; session = id.includes(':') ? id.slice(0,id.lastIndexOf(':')) : ''; }
      const info = this.sessions.get(session) || this.sessions.get('');
      return { kind: "model-running", stepIndex, tools: info?.tools.slice() || [], waitingUser: this.waiting.has(session) || session !== '' && this.waiting.has('') };
    }
    if (this.waiting.size) {
      const [session,stepIndex] = [...this.waiting].at(-1);
      return { kind: "model-waiting", stepIndex, tools: this.sessions.get(session)?.tools.slice() || [], waitingUser: true };
    }
    return this.finished?.expiresAt > this.now() ? this.finished : null;
  }
}
module.exports = { ModelActivity };
