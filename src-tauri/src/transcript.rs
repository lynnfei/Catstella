use crate::state::now_ms;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

const MAX_SCAN_FILES: usize = 64;
const SCAN_READ_BUDGET_BYTES: usize = 8 * 1024 * 1024;
const SCAN_CHUNK_BYTES: usize = 262_144;
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const MAX_SEEN_ENTRIES: usize = 10_000;
const RETENTION_MS: i64 = 90 * 86_400_000;

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = y - if m <= 2 { 1 } else { 0 };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}

#[cfg(windows)]
fn local_offset_seconds() -> i64 {
    use windows_sys::Win32::Foundation::SYSTEMTIME;
    use windows_sys::Win32::System::SystemInformation::{GetLocalTime, GetSystemTime};

    fn st_to_sec(st: &SYSTEMTIME) -> i64 {
        let days = days_from_civil(st.wYear as i64, st.wMonth as i64, st.wDay as i64);
        days * 86_400 + st.wHour as i64 * 3_600 + st.wMinute as i64 * 60 + st.wSecond as i64
    }

    unsafe {
        let mut utc = std::mem::zeroed::<SYSTEMTIME>();
        let mut loc = std::mem::zeroed::<SYSTEMTIME>();
        GetSystemTime(&mut utc);
        GetLocalTime(&mut loc);
        st_to_sec(&loc) - st_to_sec(&utc)
    }
}

#[cfg(not(windows))]
fn local_offset_seconds() -> i64 {
    0
}

pub fn epoch_ms_to_iso_utc(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let rem_ms = ms.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    let hh = sod / 3600;
    let mm = (sod % 3600) / 60;
    let ss = sod % 60;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.{rem_ms:03}Z")
}

pub fn local_date_from_epoch_ms(ms: i64) -> String {
    let shifted = ms + local_offset_seconds() * 1000;
    let days = shifted.div_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Parse RFC3339 / ISO-8601 timestamp into UTC epoch millis.
pub fn parse_iso_timestamp_ms(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.len() < 10 {
        return None;
    }
    let bytes = s.as_bytes();
    if bytes.get(4) != Some(&b'-') || bytes.get(7) != Some(&b'-') {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: i64 = s.get(5..7)?.parse().ok()?;
    let day: i64 = s.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let days = days_from_civil(year, month, day);
    if s.len() == 10 {
        return Some(days * 86_400_000);
    }
    let sep = *bytes.get(10)?;
    if sep != b'T' && sep != b't' && sep != b' ' {
        return None;
    }
    let rest = &s[11..];
    if rest.len() < 8 {
        return None;
    }
    let hh: i64 = rest.get(0..2)?.parse().ok()?;
    let mm: i64 = rest.get(3..5)?.parse().ok()?;
    let ss: i64 = rest.get(6..8)?.parse().ok()?;
    if !(0..=23).contains(&hh) || !(0..=59).contains(&mm) || !(0..=60).contains(&ss) {
        return None;
    }
    let mut idx = 8usize;
    let mut frac_ms: i64 = 0;
    if rest.as_bytes().get(idx) == Some(&b'.') {
        idx += 1;
        let start = idx;
        while rest.as_bytes().get(idx).is_some_and(|c| c.is_ascii_digit()) {
            idx += 1;
        }
        let digits = &rest[start..idx];
        if !digits.is_empty() {
            let mut scaled = String::with_capacity(3);
            for ch in digits.chars().take(3) {
                scaled.push(ch);
            }
            while scaled.len() < 3 {
                scaled.push('0');
            }
            frac_ms = scaled.parse().ok()?;
        }
    }
    let tz = rest.get(idx..)?.trim();
    let tz_offset_ms: i64 = if tz.is_empty() {
        local_offset_seconds() * 1000
    } else if tz == "Z" || tz == "z" {
        0
    } else {
        let sign: i64 = match tz.as_bytes().first()? {
            b'+' => 1,
            b'-' => -1,
            _ => return None,
        };
        let body = &tz[1..];
        let (th, tm) = if body.contains(':') {
            let mut parts = body.split(':');
            let h: i64 = parts.next()?.parse().ok()?;
            let m: i64 = parts.next()?.parse().ok()?;
            (h, m)
        } else if body.len() == 4 {
            let h: i64 = body[0..2].parse().ok()?;
            let m: i64 = body[2..4].parse().ok()?;
            (h, m)
        } else if body.len() == 2 {
            (body.parse().ok()?, 0)
        } else {
            return None;
        };
        sign * (th * 3600 + tm * 60) * 1000
    };

    Some(days * 86_400_000 + (hh * 3600 + mm * 60 + ss) * 1000 + frac_ms - tz_offset_ms)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TokenCounts {
    pub input: Option<i64>,
    pub cache: Option<i64>,
    pub output: Option<i64>,
    pub total: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerRecord {
    pub id: String,
    pub session_id: String,
    pub step_index: i64,
    pub timestamp: String,
    pub date: String,
    pub tokens: TokenCounts,
    pub turn_cost: Option<f64>,
    pub status: String,
    pub kind: String,
    pub quality: String,
}

#[derive(Debug, Clone)]
pub struct TranscriptStepEvent {
    pub session_id: String,
    pub step_index: i64,
    pub created_at: String,
    pub status: String,
    pub tools: Vec<String>,
    pub input_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub historical: bool,
}

pub enum TranscriptEvent {
    Step(TranscriptStepEvent),
    TurnDone(TranscriptStepEvent),
    AskUser {
        session_id: String,
        step_index: i64,
        historical: bool,
    },
    UserInput {
        session_id: String,
        step_index: i64,
    },
    TurnRunning {
        session_id: String,
        step_index: i64,
        historical: bool,
    },
    TurnError {
        session_id: String,
        step_index: i64,
        historical: bool,
    },
}

#[derive(Debug, Clone)]
pub struct SourceStatus {
    pub online: bool,
    pub files: usize,
    pub last_updated: Option<String>,
}

impl SourceStatus {
    pub fn to_json(&self) -> Value {
        json!({
            "online": self.online,
            "source": "本机 Antigravity 日志",
            "coverage": "最近 64 份会话 · 模型步骤与工具调用",
            "files": self.files,
            "lastUpdated": self.last_updated
        })
    }
}

fn valid_count(v: Option<i64>) -> Option<i64> {
    v.filter(|&n| n >= 0)
}

fn make_record(
    step_index: i64,
    status: &str,
    created_at: &str,
    input_tokens: Option<i64>,
    cache_read_tokens: Option<i64>,
    output_tokens: Option<i64>,
    session_id: &str,
    previous: Option<&LedgerRecord>,
) -> Option<LedgerRecord> {
    if step_index < 0 || status != "DONE" {
        return None;
    }
    if session_id.is_empty() || session_id.len() > 256 || created_at.trim().is_empty() {
        return None;
    }
    let ts_ms = parse_iso_timestamp_ms(created_at)?;
    let input = previous
        .and_then(|p| p.tokens.input)
        .or_else(|| valid_count(input_tokens));
    let cache = previous
        .and_then(|p| p.tokens.cache)
        .or_else(|| valid_count(cache_read_tokens));
    let output = previous
        .and_then(|p| p.tokens.output)
        .or_else(|| valid_count(output_tokens));
    if input.is_none() && cache.is_none() && output.is_none() {
        return None;
    }
    let total = match (input, cache, output) {
        (Some(i), Some(c), Some(o)) => i.checked_add(c).and_then(|v| v.checked_add(o)),
        _ => None,
    };
    let timestamp = previous
        .map(|p| p.timestamp.clone())
        .unwrap_or_else(|| epoch_ms_to_iso_utc(ts_ms));
    let date_ms = previous
        .and_then(|p| parse_iso_timestamp_ms(&p.timestamp))
        .unwrap_or(ts_ms);
    let date = local_date_from_epoch_ms(date_ms);

    Some(LedgerRecord {
        id: format!("{session_id}:{step_index}"),
        session_id: session_id.to_string(),
        step_index,
        timestamp,
        date,
        tokens: TokenCounts {
            input,
            cache,
            output,
            total,
        },
        turn_cost: None,
        status: "DONE".to_string(),
        kind: "model-step".to_string(),
        quality: "observed".to_string(),
    })
}

pub struct UsageLedger {
    pub storage_path: PathBuf,
    pub records: HashMap<String, LedgerRecord>,
    pub dirty: bool,
}

impl UsageLedger {
    pub fn load(storage_path: PathBuf) -> Self {
        let mut records = HashMap::new();
        if let Ok(bytes) = fs::read(&storage_path) {
            if let Ok(val) = serde_json::from_slice::<Value>(&bytes) {
                if let Some(arr) = val.get("records").and_then(|v| v.as_array()) {
                    for row in arr {
                        let Ok(parsed) = serde_json::from_value::<LedgerRecord>(row.clone()) else {
                            continue;
                        };
                        if let Some(clean) = make_record(
                            parsed.step_index,
                            &parsed.status,
                            &parsed.timestamp,
                            parsed.tokens.input,
                            parsed.tokens.cache,
                            parsed.tokens.output,
                            &parsed.session_id,
                            None,
                        ) {
                            if clean.id == parsed.id {
                                records.insert(clean.id.clone(), clean);
                            }
                        }
                    }
                }
            }
        }
        Self {
            storage_path,
            records,
            dirty: false,
        }
    }

    /// Returns `(record, updated)` if inserted or modified.
    pub fn record_step(
        &mut self,
        step: &TranscriptStepEvent,
        now_epoch_ms: i64,
    ) -> Option<(LedgerRecord, bool)> {
        let key = format!("{}:{}", step.session_id, step.step_index);
        let previous = self.records.get(&key);
        let record = make_record(
            step.step_index,
            &step.status,
            &step.created_at,
            step.input_tokens,
            step.cache_read_tokens,
            step.output_tokens,
            &step.session_id,
            previous,
        )?;
        if step.historical {
            if let Some(ts) = parse_iso_timestamp_ms(&record.timestamp) {
                if ts < now_epoch_ms - RETENTION_MS {
                    return None;
                }
            }
        }
        if let Some(prev) = previous {
            if prev.tokens == record.tokens {
                return None;
            }
        }
        let updated = previous.is_some();
        self.records.insert(key, record.clone());
        self.dirty = true;
        Some((record, updated))
    }

    pub fn save(&mut self, now_epoch_ms: i64) -> Result<(), String> {
        let cutoff = now_epoch_ms - RETENTION_MS;
        let kept: Vec<LedgerRecord> = self
            .records
            .values()
            .filter(|r| {
                parse_iso_timestamp_ms(&r.timestamp)
                    .map(|ts| ts >= cutoff)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        if kept.len() != self.records.len() {
            self.records = kept.iter().map(|r| (r.id.clone(), r.clone())).collect();
        }
        let payload = json!({
            "schemaVersion": 2,
            "records": kept
        });
        let parent = self
            .storage_path
            .parent()
            .ok_or_else(|| "invalid usage storage path".to_string())?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec_pretty(&payload).map_err(|e| e.to_string())?;
        let tmp = parent.join(format!(
            ".usage-v2.json.tmp.{}.{}",
            std::process::id(),
            now_ms()
        ));
        fs::write(&tmp, &bytes).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            e.to_string()
        })?;
        if let Err(err) = fs::rename(&tmp, &self.storage_path) {
            if self.storage_path.exists() {
                let _ = fs::remove_file(&self.storage_path);
                if let Err(err2) = fs::rename(&tmp, &self.storage_path) {
                    let _ = fs::remove_file(&tmp);
                    return Err(err2.to_string());
                }
            } else {
                let _ = fs::remove_file(&tmp);
                return Err(err.to_string());
            }
        }
        self.dirty = false;
        Ok(())
    }

    pub fn get_snapshot(&self, now_epoch_ms: i64, quota_remaining_pct: Option<f64>) -> Value {
        let date = local_date_from_epoch_ms(now_epoch_ms);
        let rows: Vec<&LedgerRecord> = self
            .records
            .values()
            .filter(|r| r.date == date)
            .collect();

        let sum_field = |pick: fn(&TokenCounts) -> Option<i64>| -> Value {
            if rows.is_empty() || rows.iter().any(|r| pick(&r.tokens).is_none()) {
                return Value::Null;
            }
            let mut total: i64 = 0;
            for r in &rows {
                total = match total.checked_add(pick(&r.tokens).unwrap_or(0)) {
                    Some(v) => v,
                    None => return Value::Null,
                };
            }
            json!(total)
        };

        let partial = rows.iter().any(|r| r.tokens.total.is_none());
        let mut latest: Option<&LedgerRecord> = None;
        for r in self.records.values() {
            if latest.is_none_or(|cur| r.timestamp > cur.timestamp) {
                latest = Some(r);
            }
        }

        let quota = match quota_remaining_pct {
            Some(v) if v.is_finite() && (0.0..=100.0).contains(&v) => json!({
                "display": format!("{}%", v.round() as i64),
                "value": v,
                "status": if v <= 20.0 { "critical" } else { "normal" },
                "isKnown": true,
                "source": "手动记录 · 非服务端",
                "quality": "manual",
                "ariaValueNow": v
            }),
            _ => json!({
                "display": "—",
                "value": Value::Null,
                "status": "unknown",
                "isKnown": false,
                "source": "尚未读取真实额度",
                "quality": "unknown",
                "ariaValueNow": Value::Null
            }),
        };

        json!({
            "date": date,
            "todayTokens": {
                "prompt": sum_field(|t| t.input),
                "cache": sum_field(|t| t.cache),
                "output": sum_field(|t| t.output),
                "total": sum_field(|t| t.total),
            },
            "todaySteps": rows.len(),
            "todayTurns": Value::Null,
            "todayCost": Value::Null,
            "accountBalance": Value::Null,
            "latest": latest.map(|l| serde_json::to_value(l).unwrap_or(Value::Null)).unwrap_or(Value::Null),
            "partial": partial,
            "isDemoMode": false,
            "quota": quota
        })
    }
}

#[derive(Debug, Clone)]
struct FinishedActivity {
    kind: String,
    step_index: i64,
    expires_at: u64,
}

#[derive(Debug, Clone)]
struct SessionObserve {
    step_index: i64,
    tools: Vec<String>,
}

pub struct ModelActivity {
    running: Vec<(String, i64)>,
    finished: Option<FinishedActivity>,
    sessions: HashMap<String, SessionObserve>,
    waiting: Vec<(String, i64)>,
    replies: HashMap<String, i64>,
}

impl ModelActivity {
    pub fn new() -> Self {
        Self {
            running: Vec::new(),
            finished: None,
            sessions: HashMap::new(),
            waiting: Vec::new(),
            replies: HashMap::new(),
        }
    }

    pub fn size(&self) -> usize {
        self.running.len()
    }

    pub fn begin(&mut self, id: &str, step_index: i64) -> bool {
        if self.running.iter().any(|(k, _)| k == id) {
            return false;
        }
        self.running.push((id.to_string(), step_index));
        let session = id
            .rfind(':')
            .map(|idx| &id[..idx])
            .unwrap_or("");
        self.waiting
            .retain(|(s, w)| !(s == session && step_index > *w));
        self.finished = None;
        true
    }

    pub fn observe(&mut self, step_index: i64, tools: &[String], session: &str) -> bool {
        if let Some(prev) = self.sessions.get(session) {
            if prev.step_index > step_index {
                return false;
            }
        }
        let mut names: Vec<String> = Vec::new();
        for t in tools {
            if !t.is_empty() && !names.contains(t) {
                names.push(t.clone());
                if names.len() >= 6 {
                    break;
                }
            }
        }
        let changed = match self.sessions.get(session) {
            Some(prev) => prev.step_index != step_index || prev.tools != names,
            None => true,
        };
        self.sessions.insert(
            session.to_string(),
            SessionObserve {
                step_index,
                tools: names,
            },
        );
        self.waiting
            .retain(|(s, w)| !(s == session && step_index > *w));
        changed
    }

    pub fn set_waiting(&mut self, step_index: i64, session: &str) -> bool {
        if let Some(obs) = self.sessions.get(session) {
            if obs.step_index > step_index {
                return false;
            }
        }
        if let Some(&rep) = self.replies.get(session) {
            if rep >= step_index {
                return false;
            }
        }
        if let Some(slot) = self.waiting.iter_mut().find(|(s, _)| s == session) {
            slot.1 = step_index;
        } else {
            self.waiting.push((session.to_string(), step_index));
        }
        true
    }

    pub fn clear_waiting(&mut self, session: &str, step_index: Option<i64>) -> bool {
        if let Some(idx) = step_index {
            let next = self.replies.get(session).copied().unwrap_or(-1).max(idx);
            self.replies.insert(session.to_string(), next);
        }
        let before = self.waiting.len();
        self.waiting.retain(|(s, w)| {
            if s != session {
                return true;
            }
            match step_index {
                Some(idx) => *w > idx,
                None => false,
            }
        });
        self.waiting.len() != before
    }

    pub fn end(&mut self, id: &str, step_index: i64, kind: &str, confirmed: bool, now: u64) -> bool {
        let before = self.running.len();
        self.running.retain(|(k, _)| k != id);
        let tracked = self.running.len() != before;
        if !tracked && (!confirmed || !self.running.is_empty()) {
            return false;
        }
        if self.running.is_empty() {
            self.finished = Some(FinishedActivity {
                kind: kind.to_string(),
                step_index,
                expires_at: now.saturating_add(4500),
            });
        }
        true
    }

    pub fn clear(&mut self) {
        self.running.clear();
        self.finished = None;
        self.sessions.clear();
        self.waiting.clear();
        self.replies.clear();
    }

    pub fn snapshot(&self, now: u64) -> Value {
        if let Some((id, step_index)) = self.running.last() {
            let session = id.rfind(':').map(|idx| &id[..idx]).unwrap_or("");
            let tools = self
                .sessions
                .get(session)
                .or_else(|| self.sessions.get(""))
                .map(|s| s.tools.clone())
                .unwrap_or_default();
            let waiting_user = self.waiting.iter().any(|(s, _)| s == session)
                || (!session.is_empty() && self.waiting.iter().any(|(s, _)| s.is_empty()));
            return json!({
                "kind": "model-running",
                "stepIndex": step_index,
                "tools": tools,
                "waitingUser": waiting_user
            });
        }
        if let Some((session, step_index)) = self.waiting.last() {
            let tools = self
                .sessions
                .get(session)
                .map(|s| s.tools.clone())
                .unwrap_or_default();
            return json!({
                "kind": "model-waiting",
                "stepIndex": step_index,
                "tools": tools,
                "waitingUser": true
            });
        }
        if let Some(ref fin) = self.finished {
            if fin.expires_at > now {
                return json!({
                    "kind": fin.kind,
                    "stepIndex": fin.step_index,
                    "expiresAt": fin.expires_at
                });
            }
        }
        Value::Null
    }
}

struct FileCursor {
    offset: u64,
    pending: Vec<u8>,
    seen: HashMap<String, String>,
    seen_order: VecDeque<String>,
    baseline_size: u64,
    discarding: bool,
}

impl FileCursor {
    fn new(baseline_size: u64) -> Self {
        Self {
            offset: 0,
            pending: Vec::new(),
            seen: HashMap::new(),
            seen_order: VecDeque::new(),
            baseline_size,
            discarding: false,
        }
    }

    fn record_seen(&mut self, key: String, val: String) {
        if !self.seen.contains_key(&key) {
            self.seen_order.push_back(key.clone());
        }
        self.seen.insert(key, val);
        while self.seen.len() > MAX_SEEN_ENTRIES {
            if let Some(oldest) = self.seen_order.pop_front() {
                self.seen.remove(&oldest);
            } else {
                break;
            }
        }
    }
}

pub struct TranscriptScanner {
    app_data_dir: PathBuf,
    cursors: HashMap<PathBuf, FileCursor>,
}

impl TranscriptScanner {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            app_data_dir,
            cursors: HashMap::new(),
        }
    }

    pub fn files(&self) -> Vec<PathBuf> {
        let brain = self.app_data_dir.join("brain");
        let Ok(rd) = fs::read_dir(&brain) else {
            return Vec::new();
        };
        let mut found: Vec<(PathBuf, u128)> = Vec::new();
        for entry in rd.filter_map(|e| e.ok()) {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let p = entry
                .path()
                .join(".system_generated")
                .join("logs")
                .join("transcript_full.jsonl");
            if let Ok(meta) = fs::metadata(&p) {
                if meta.is_file() {
                    let mtime = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis())
                        .unwrap_or(0);
                    found.push((p, mtime));
                }
            }
        }
        found.sort_by(|a, b| b.1.cmp(&a.1));
        found.into_iter().take(MAX_SCAN_FILES).map(|(p, _)| p).collect()
    }

    pub fn scan(&mut self) -> (Vec<TranscriptEvent>, SourceStatus) {
        let files = self.files();
        let active: HashSet<PathBuf> = files.iter().cloned().collect();
        self.cursors.retain(|k, _| active.contains(k));

        let mut events = Vec::new();
        let mut readable = 0usize;
        let mut newest_ms = 0u64;

        for file_path in files {
            let Ok(meta) = fs::metadata(&file_path) else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            let file_size = meta.len();
            let session_id = file_path
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.file_name())
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "local".to_string());

            let need_reset = self
                .cursors
                .get(&file_path)
                .is_none_or(|c| file_size < c.offset);
            if need_reset {
                self.cursors
                    .insert(file_path.clone(), FileCursor::new(file_size));
            }
            let cursor = self.cursors.get_mut(&file_path).unwrap();

            let Ok(mut f) = File::open(&file_path) else {
                continue;
            };
            if f.seek(SeekFrom::Start(cursor.offset)).is_err() {
                continue;
            }

            let mut budget = SCAN_READ_BUDGET_BYTES;
            while cursor.offset < file_size && budget > 0 {
                let to_read = ((file_size - cursor.offset) as usize)
                    .min(SCAN_CHUNK_BYTES)
                    .min(budget);
                if to_read == 0 {
                    break;
                }
                let mut buf = vec![0u8; to_read];
                let Ok(n) = f.read(&mut buf) else {
                    break;
                };
                if n == 0 {
                    break;
                }
                cursor.offset += n as u64;
                budget -= n;
                cursor.pending.extend_from_slice(&buf[..n]);

                while let Some(nl_pos) = cursor.pending.iter().position(|&b| b == b'\n') {
                    let line_bytes: Vec<u8> = cursor.pending.drain(..=nl_pos).collect();
                    let line = &line_bytes[..line_bytes.len() - 1];
                    if cursor.discarding {
                        cursor.discarding = false;
                        continue;
                    }
                    if line.len() > MAX_LINE_BYTES {
                        continue;
                    }
                    let Ok(s) = serde_json::from_slice::<Value>(line) else {
                        continue;
                    };
                    let Some(step_index) = s.get("step_index").and_then(|v| v.as_i64()) else {
                        continue;
                    };
                    let source = s.get("source").and_then(|v| v.as_str()).unwrap_or("");
                    let typ = s.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    let planner = source == "MODEL" && typ == "PLANNER_RESPONSE";
                    let user_reply = source == "USER_EXPLICIT" && typ == "USER_INPUT";
                    if !planner && !user_reply {
                        continue;
                    }

                    let end_offset = cursor.offset.saturating_sub(cursor.pending.len() as u64);
                    let historical = end_offset <= cursor.baseline_size;

                    if user_reply {
                        let rkey = format!("u{step_index}");
                        if cursor.seen.get(&rkey).map(|v| v.as_str()) == Some("user") {
                            continue;
                        }
                        cursor.record_seen(rkey, "user".to_string());
                        if !historical {
                            events.push(TranscriptEvent::UserInput {
                                session_id: session_id.clone(),
                                step_index,
                            });
                        }
                        continue;
                    }

                    let mut tools: Vec<String> = Vec::new();
                    if let Some(arr) = s.get("tool_calls").and_then(|v| v.as_array()) {
                        for tc in arr {
                            if let Some(name) = tc.get("name").and_then(|v| v.as_str()) {
                                if !name.is_empty() && !tools.iter().any(|t| t == name) {
                                    tools.push(name.to_string());
                                    if tools.len() >= 6 {
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    let status = s.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let input_tokens = s.get("input_tokens").and_then(|v| v.as_i64());
                    let cache_read_tokens = s.get("cache_read_tokens").and_then(|v| v.as_i64());
                    let output_tokens = s.get("output_tokens").and_then(|v| v.as_i64());

                    let sig = serde_json::to_string(&json!([
                        status,
                        input_tokens,
                        cache_read_tokens,
                        output_tokens,
                        tools
                    ]))
                    .unwrap_or_default();
                    let skey = step_index.to_string();
                    if cursor.seen.get(&skey) == Some(&sig) {
                        continue;
                    }
                    cursor.record_seen(skey, sig);

                    let created_at = s
                        .get("created_at")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let step_ev = TranscriptStepEvent {
                        session_id: session_id.clone(),
                        step_index,
                        created_at,
                        status: status.clone(),
                        tools: tools.clone(),
                        input_tokens,
                        cache_read_tokens,
                        output_tokens,
                        historical,
                    };
                    events.push(TranscriptEvent::Step(step_ev.clone()));

                    if !historical
                        && status == "DONE"
                        && tools.iter().any(|t| t == "ask_question")
                    {
                        events.push(TranscriptEvent::AskUser {
                            session_id: session_id.clone(),
                            step_index,
                            historical,
                        });
                    }
                    if status == "DONE" {
                        events.push(TranscriptEvent::TurnDone(step_ev));
                    } else if status == "ERROR" {
                        events.push(TranscriptEvent::TurnError {
                            session_id: session_id.clone(),
                            step_index,
                            historical,
                        });
                    } else if status == "RUNNING" {
                        events.push(TranscriptEvent::TurnRunning {
                            session_id: session_id.clone(),
                            step_index,
                            historical,
                        });
                    }
                }

                if cursor.pending.len() > MAX_LINE_BYTES {
                    cursor.pending.clear();
                    cursor.discarding = true;
                }
            }

            readable += 1;
            if let Ok(mtime) = meta.modified() {
                if let Ok(dur) = mtime.duration_since(UNIX_EPOCH) {
                    let ms = dur.as_millis() as u64;
                    if ms > newest_ms {
                        newest_ms = ms;
                    }
                }
            }
        }

        let status = SourceStatus {
            online: readable > 0,
            files: readable,
            last_updated: if newest_ms > 0 {
                Some(epoch_ms_to_iso_utc(newest_ms as i64))
            } else {
                None
            },
        };
        (events, status)
    }
}

pub fn default_transcripts_dir() -> PathBuf {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".gemini").join("antigravity")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_ledger_records_dedupes_prunes_and_summarizes() {
        let root = std::env::temp_dir().join(format!("catstella-ledger-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let path = root.join("usage-v2.json");

        let now_ms = 1_795_560_000_000i64; // 2026-11-24T...Z
        let today_iso = epoch_ms_to_iso_utc(now_ms);
        let old_iso = epoch_ms_to_iso_utc(now_ms - 95 * 86_400_000);

        let mut ledger = UsageLedger::load(path.clone());
        let step1 = TranscriptStepEvent {
            session_id: "sess-a".into(),
            step_index: 1,
            created_at: today_iso.clone(),
            status: "DONE".into(),
            tools: vec![],
            input_tokens: Some(100),
            cache_read_tokens: Some(50),
            output_tokens: Some(25),
            historical: false,
        };
        let (rec, updated) = ledger.record_step(&step1, now_ms).unwrap();
        assert!(!updated);
        assert_eq!(rec.tokens.total, Some(175));

        // Duplicate identical step returns None
        assert!(ledger.record_step(&step1, now_ms).is_none());

        // Old historical step beyond 90d is skipped
        let old_step = TranscriptStepEvent {
            session_id: "sess-a".into(),
            step_index: 0,
            created_at: old_iso,
            status: "DONE".into(),
            tools: vec![],
            input_tokens: Some(10),
            cache_read_tokens: Some(0),
            output_tokens: Some(5),
            historical: true,
        };
        assert!(ledger.record_step(&old_step, now_ms).is_none());

        ledger.save(now_ms).unwrap();
        let reloaded = UsageLedger::load(path);
        let snap = reloaded.get_snapshot(now_ms, Some(84.0));
        assert_eq!(snap["todaySteps"], 1);
        assert_eq!(snap["todayTokens"]["total"], 175);
        assert_eq!(snap["quota"]["display"], "84%");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn model_activity_transitions_and_expiry() {
        let mut ma = ModelActivity::new();
        assert!(ma.begin("s1:1", 1));
        assert!(ma.observe(1, &["read_file".into()], "s1"));
        let snap1 = ma.snapshot(1000);
        assert_eq!(snap1["kind"], "model-running");
        assert_eq!(snap1["stepIndex"], 1);

        assert!(ma.set_waiting(1, "s1"));
        assert!(ma.end("s1:1", 1, "model-done", true, 2000));
        let snap_wait = ma.snapshot(2500);
        assert_eq!(snap_wait["kind"], "model-waiting");

        assert!(ma.clear_waiting("s1", Some(1)));
        let snap_done = ma.snapshot(3000);
        assert_eq!(snap_done["kind"], "model-done");
        // Expired after 2000 + 4500 = 6500
        assert!(ma.snapshot(7000).is_null());
    }

    #[test]
    fn transcript_scanner_separates_baseline_from_live_lines() {
        let root = std::env::temp_dir().join(format!("catstella-tr-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let log_dir = root.join("brain/conv-1/.system_generated/logs");
        fs::create_dir_all(&log_dir).unwrap();
        let log_file = log_dir.join("transcript_full.jsonl");

        let hist_line = r#"{"step_index":0,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-11-24T10:00:00.000Z","input_tokens":100,"cache_read_tokens":20,"output_tokens":30}"#;
        fs::write(&log_file, format!("{hist_line}\n")).unwrap();

        let mut scanner = TranscriptScanner::new(root.clone());
        let (evs1, st1) = scanner.scan();
        assert!(st1.online);
        assert_eq!(st1.files, 1);
        assert!(evs1.iter().any(|e| matches!(e, TranscriptEvent::TurnDone(s) if s.historical && s.step_index == 0)));

        let live_line = r#"{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-11-24T10:01:00.000Z","input_tokens":200,"cache_read_tokens":0,"output_tokens":50,"tool_calls":[{"name":"ask_question"}]}"#;
        let existing = fs::read_to_string(&log_file).unwrap();
        fs::write(&log_file, format!("{existing}{live_line}\n")).unwrap();

        let (evs2, _) = scanner.scan();
        assert!(evs2.iter().any(|e| matches!(e, TranscriptEvent::AskUser { step_index: 1, historical: false, .. })));
        assert!(evs2.iter().any(|e| matches!(e, TranscriptEvent::TurnDone(s) if !s.historical && s.step_index == 1)));

        let _ = fs::remove_dir_all(&root);
    }
}
