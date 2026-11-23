const { readJson, writeJson } = require("../../../shared/storage.cjs");
const validCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function localDate(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function makeRecord(step, sessionId, previous) {
  if (!Number.isSafeInteger(step?.step_index) || step.step_index < 0 || step.status !== "DONE") return null;
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 256) return null;
  if (typeof step.created_at !== "string" || !step.created_at.trim()) return null;
  const date = new Date(step.created_at);
  if (!Number.isFinite(date.getTime())) return null;
  const tokens = {
    input: previous?.tokens.input ?? validCount(step.input_tokens),
    cache: previous?.tokens.cache ?? validCount(step.cache_read_tokens),
    output: previous?.tokens.output ?? validCount(step.output_tokens)
  };
  if (Object.values(tokens).every(value => value === null)) return null;
  tokens.total = Object.values(tokens).every(value => value !== null)
    ? tokens.input + tokens.cache + tokens.output : null;
  if (!Number.isSafeInteger(tokens.total)) tokens.total = null;
  return {
    id: sessionId + ":" + step.step_index, sessionId, stepIndex: step.step_index,
    timestamp: previous?.timestamp || date.toISOString(),
    date: localDate(previous ? new Date(previous.timestamp) : date),
    tokens, turnCost: null, status: "DONE", kind: "model-step", quality: "observed"
  };
}
class UsageLedger {
  constructor(options = {}) {
    this.storagePath = options.storagePath || null;
    this.now = options.now || (() => new Date());
    this.records = new Map();
    this.cachedSummary = null;
    this.quotaRemainingPercent = null;
    if (this.storagePath) {
      const stored = readJson(this.storagePath, { records: [] });
      for (const row of Array.isArray(stored.records) ? stored.records : []) {
        if (!row || typeof row !== "object") continue;
        const record = makeRecord({
          step_index: row.stepIndex, status: row.status, created_at: row.timestamp,
          input_tokens: row.tokens?.input, cache_read_tokens: row.tokens?.cache,
          output_tokens: row.tokens?.output
        }, row.sessionId);
        if (record && record.id === row.id) this.records.set(record.id, record);
      }
    }
  }
  recordStep(step, sessionId = step?.sessionId || "local") {
    const previous = this.records.get(sessionId + ":" + step?.step_index);
    const record = makeRecord(step, sessionId, previous);
    if (!record) return null;
    if (step.historical && Date.parse(record.timestamp) < this.now().getTime() - 90 * 86400000) return null;
    if (previous && JSON.stringify(previous.tokens) === JSON.stringify(record.tokens)) return null;
    this.records.set(record.id, record);
    this.cachedSummary = null;
    // Fill late numeric metadata without another completion bubble or sound.
    return previous ? { ...record, updated: true } : record;
  }
  save() {
    if (!this.storagePath) return;
    const cutoff = this.now().getTime() - 90 * 86400000;
    const records = [...this.records.values()].filter(row => Date.parse(row.timestamp) >= cutoff);
    writeJson(this.storagePath, { schemaVersion: 2, records });
    if (records.length !== this.records.size) {
      this.records = new Map(records.map(row => [row.id, row]));
      this.cachedSummary = null;
    }
  }
  calculateTurnCost() { return null; }
  getQuotaStatus() {
    const value = this.quotaRemainingPercent;
    const known = typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
    return {
      display: known ? Math.round(value) + "%" : "—", value: known ? value : null,
      status: known ? (value <= 20 ? "critical" : "normal") : "unknown", isKnown: known,
      source: known ? "手动记录 · 非服务端" : "尚未读取真实额度",
      quality: known ? "manual" : "unknown", ariaValueNow: known ? value : null
    };
  }
  getSnapshot() {
    const date = localDate(this.now());
    if (this.cachedSummary?.date === date) return { ...this.cachedSummary, quota: this.getQuotaStatus() };
    const rows = [...this.records.values()].filter(row => row.date === date);
    const sum = key => {
      if (!rows.length || rows.some(row => row.tokens[key] === null)) return null;
      const value = rows.reduce((total, row) => total + row.tokens[key], 0);
      return Number.isSafeInteger(value) ? value : null;
    };
    const partial = rows.some(row => row.tokens.total === null);
    let latest = null;
    for (const row of this.records.values()) if (!latest || row.timestamp > latest.timestamp) latest = row;
    this.cachedSummary = {
      date, todayTokens: {
        prompt: sum("input"), cache: sum("cache"), output: sum("output"),
        total: sum("total")
      },
      todaySteps: rows.length, todayTurns: null, todayCost: null,
      accountBalance: null, latest, partial, isDemoMode: false
    };
    return { ...this.cachedSummary, quota: this.getQuotaStatus() };
  }
  get todayTotalTokens() { return this.getSnapshot().todayTokens.total; }
}
module.exports = { UsageLedger, localDate, validCount };
