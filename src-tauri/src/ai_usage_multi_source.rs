//! 扩展 Token / 代码编辑量统计：在 Claude Code JSONL 之外，合并
//! Codex（`~/.codex/sessions`）、OpenCode（`~/.local/share/opencode`）、
//! Cursor Composer（`state.vscdb` composerHeaders）。
//! Cursor IDE 本地暂无可靠 token 用量落盘，故 Cursor 仅计入代码编辑量。

use chrono::{Local, NaiveDate, TimeZone, Utc};
use rusqlite::Connection;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

const MAX_JSONL_FILES: usize = 5000;
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const READ_BUF_CAP: usize = 256 * 1024;

#[derive(Default, Clone)]
pub struct TokenDayAcc {
    pub input: u64,
    pub output: u64,
    pub cache_create: u64,
    pub cache_read: u64,
    pub cost_sum: f64,
    pub cost_entries: u64,
}

impl TokenDayAcc {
    pub fn merge(&mut self, o: &TokenDayAcc) {
        self.input += o.input;
        self.output += o.output;
        self.cache_create += o.cache_create;
        self.cache_read += o.cache_read;
        self.cost_sum += o.cost_sum;
        self.cost_entries += o.cost_entries;
    }
}

#[derive(Default, Clone)]
pub struct EditDayAcc {
    pub lines_added: u64,
    pub lines_removed: u64,
    pub diffs: u64,
}

impl EditDayAcc {
    pub fn merge(&mut self, o: &EditDayAcc) {
        self.lines_added += o.lines_added;
        self.lines_removed += o.lines_removed;
        self.diffs += o.diffs;
    }

    pub fn lines_edited(&self) -> u64 {
        self.lines_added + self.lines_removed
    }
}

#[derive(Default)]
pub struct SourceScanMeta {
    pub scanned_files: u32,
    pub events: u64,
    pub data_roots: Vec<String>,
}

impl SourceScanMeta {
    fn push_root(&mut self, path: &Path) {
        let s = path.to_string_lossy().into_owned();
        if !self.data_roots.iter().any(|x| x == &s) {
            self.data_roots.push(s);
        }
    }
}

fn day_key(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn ms_to_local_day(ms: i64) -> Option<NaiveDate> {
    if ms <= 0 {
        return None;
    }
    let secs = ms / 1000;
    Utc.timestamp_opt(secs, 0)
        .single()
        .map(|dt| dt.with_timezone(&Local).date_naive())
}

fn parse_rfc3339_day(ts: &str) -> Option<NaiveDate> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|d| d.with_timezone(&Local).date_naive())
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S%.3fZ")
                .ok()
                .map(|naive| Utc.from_utc_datetime(&naive).with_timezone(&Local).date_naive())
        })
}

fn normalize_path_key(raw: &str) -> String {
    let t = raw.trim().replace('\\', "/");
    t.trim_end_matches('/').to_string()
}

/// `project_path` 为空时全部计入；否则要求 `candidate` 等于或位于该仓库路径之下。
fn path_matches_project(candidate: &str, project_path: Option<&str>) -> bool {
    let Some(proj) = project_path.map(str::trim).filter(|s| !s.is_empty()) else {
        return true;
    };
    let c = normalize_path_key(candidate);
    let p = normalize_path_key(proj);
    if c.is_empty() || p.is_empty() {
        return false;
    }
    c == p || c.starts_with(&(p.clone() + "/"))
}

fn json_u64(v: &Value, key: &str) -> Option<u64> {
    let n = v.get(key)?;
    if let Some(u) = n.as_u64() {
        return Some(u);
    }
    if let Some(i) = n.as_i64() {
        return Some(i.max(0) as u64);
    }
    let f = n.as_f64()?;
    if f.is_finite() && f >= 0.0 {
        return Some(f as u64);
    }
    None
}

fn split_lines(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    text.replace("\r\n", "\n")
        .split('\n')
        .map(String::from)
        .collect()
}

fn count_edit_lines_split(old_str: &str, new_str: &str) -> (u64, u64) {
    if old_str.is_empty() && !new_str.is_empty() {
        return (split_lines(new_str).len() as u64, 0);
    }
    let a = split_lines(old_str);
    let b = split_lines(new_str);
    let n = a.len();
    let m = b.len();
    if n == 0 && m == 0 {
        return (0, 0);
    }
    // 大片段降级为粗估，避免 O(nm) 拖垮扫描。
    if n > 400 || m > 400 {
        let added = m.saturating_sub(n) as u64;
        let removed = n.saturating_sub(m) as u64;
        let changed = n.min(m) as u64;
        return (added + changed, removed + changed);
    }
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if a[i] == b[j] {
                dp[i + 1][j + 1] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }
    let mut added = 0u64;
    let mut removed = 0u64;
    let mut i = 0usize;
    let mut j = 0usize;
    while i < n && j < m {
        if a[i] == b[j] {
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            removed += 1;
            i += 1;
        } else {
            added += 1;
            j += 1;
        }
    }
    removed += (n - i) as u64;
    added += (m - j) as u64;
    (added, removed)
}

fn count_apply_patch_lines(patch: &str) -> (u64, u64) {
    let mut added = 0u64;
    let mut removed = 0u64;
    for line in patch.lines() {
        if line.starts_with("+++")
            || line.starts_with("---")
            || line.starts_with("***")
            || line.starts_with("@@")
            || line.starts_with("diff ")
            || line.starts_with("index ")
        {
            continue;
        }
        if line.starts_with('+') {
            added += 1;
        } else if line.starts_with('-') {
            removed += 1;
        }
    }
    (added, removed)
}

fn open_sqlite_readonly(path: &Path) -> Option<Connection> {
    if !path.is_file() {
        return None;
    }
    let uri = format!("file:{}?mode=ro", path.display());
    Connection::open_with_flags(
        &uri,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .ok()
}

fn codex_sessions_root() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let p = home.join(".codex").join("sessions");
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

fn opencode_db_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let candidates = [
        home.join(".local")
            .join("share")
            .join("opencode")
            .join("opencode.db"),
        home.join("Library")
            .join("Application Support")
            .join("opencode")
            .join("opencode.db"),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

fn cursor_state_vscdb_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let candidates = [
        home.join("Library")
            .join("Application Support")
            .join("Cursor")
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"),
        home.join(".config")
            .join("Cursor")
            .join("User")
            .join("globalStorage")
            .join("state.vscdb"),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

fn collect_jsonl_under(root: &Path, cap: usize, sink: &mut Vec<PathBuf>) {
    if !root.is_dir() {
        return;
    }
    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
    {
        if sink.len() >= cap {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) == Some("jsonl") {
            sink.push(p.to_path_buf());
        }
    }
}

fn extract_codex_cwd(v: &Value) -> Option<String> {
    let payload = v.get("payload")?;
    payload
        .get("cwd")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn extract_codex_last_token_usage(v: &Value) -> Option<TokenDayAcc> {
    let payload = v.get("payload")?;
    if payload.get("type").and_then(|t| t.as_str()) != Some("token_count") {
        return None;
    }
    let info = payload.get("info")?;
    let usage = info.get("last_token_usage")?;
    let input = json_u64(usage, "input_tokens").unwrap_or(0);
    let output = json_u64(usage, "output_tokens").unwrap_or(0);
    let cache_read = json_u64(usage, "cached_input_tokens").unwrap_or(0);
    if input == 0 && output == 0 && cache_read == 0 {
        return None;
    }
    Some(TokenDayAcc {
        input,
        output,
        cache_create: 0,
        cache_read,
        cost_sum: 0.0,
        cost_entries: 0,
    })
}

fn extract_codex_apply_patch(v: &Value) -> Option<(u64, u64)> {
    let payload = v.get("payload")?;
    if payload.get("type").and_then(|t| t.as_str()) != Some("function_call") {
        return None;
    }
    let name = payload.get("name").and_then(|n| n.as_str()).unwrap_or("");
    if name != "apply_patch" {
        return None;
    }
    let args_raw = payload.get("arguments")?;
    let patch = if let Some(s) = args_raw.as_str() {
        let parsed: Value = serde_json::from_str(s).unwrap_or(Value::Null);
        parsed
            .get("command")
            .and_then(|c| c.as_str())
            .or_else(|| parsed.get("patch").and_then(|c| c.as_str()))
            .unwrap_or(s)
            .to_string()
    } else if let Some(obj) = args_raw.as_object() {
        obj.get("command")
            .and_then(|c| c.as_str())
            .or_else(|| obj.get("patch").and_then(|c| c.as_str()))
            .unwrap_or("")
            .to_string()
    } else {
        return None;
    };
    let (added, removed) = count_apply_patch_lines(&patch);
    if added == 0 && removed == 0 {
        None
    } else {
        Some((added, removed))
    }
}

fn scan_one_codex_jsonl(
    fp: &Path,
    min_day: NaiveDate,
    project_path: Option<&str>,
) -> (HashMap<String, TokenDayAcc>, HashMap<String, EditDayAcc>, u64, u64) {
    let mut tokens: HashMap<String, TokenDayAcc> = HashMap::new();
    let mut edits: HashMap<String, EditDayAcc> = HashMap::new();
    let mut token_events = 0u64;
    let mut edit_events = 0u64;
    let f = match File::open(fp) {
        Ok(x) => x,
        Err(_) => return (tokens, edits, 0, 0),
    };
    let reader = BufReader::with_capacity(READ_BUF_CAP, f);
    let mut cwd_checked = false;
    let mut include = project_path.is_none();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.len() > MAX_LINE_BYTES {
            continue;
        }
        if line.contains("session_meta") && line.contains("cwd") {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if v.get("type").and_then(|t| t.as_str()) == Some("session_meta") {
                    if let Some(c) = extract_codex_cwd(&v) {
                        include = path_matches_project(&c, project_path);
                        cwd_checked = true;
                        if !include {
                            return (HashMap::new(), HashMap::new(), 0, 0);
                        }
                    }
                }
            }
        }
        if project_path.is_some() && !cwd_checked {
            // 尚无 cwd 时暂缓过滤：多数 rollout 首行即为 session_meta。
            continue;
        }
        if !include {
            break;
        }

        let ts_day = {
            let look = if line.len() > 80 { &line[..80] } else { &line };
            if !look.contains("timestamp") {
                None
            } else {
                serde_json::from_str::<Value>(&line).ok().and_then(|v| {
                    v.get("timestamp")
                        .and_then(|t| t.as_str())
                        .and_then(parse_rfc3339_day)
                })
            }
        };
        let Some(day) = ts_day else { continue };
        if day < min_day {
            continue;
        }

        if line.contains("token_count") {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if let Some(acc) = extract_codex_last_token_usage(&v) {
                    tokens.entry(day_key(day)).or_default().merge(&acc);
                    token_events += 1;
                }
            }
        }
        if line.contains("apply_patch") {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if let Some((added, removed)) = extract_codex_apply_patch(&v) {
                    edits.entry(day_key(day)).or_default().merge(&EditDayAcc {
                        lines_added: added,
                        lines_removed: removed,
                        diffs: 1,
                    });
                    edit_events += 1;
                }
            }
        }
    }
    (tokens, edits, token_events, edit_events)
}

fn merge_token_maps(dst: &mut HashMap<String, TokenDayAcc>, src: HashMap<String, TokenDayAcc>) {
    for (k, v) in src {
        dst.entry(k).or_default().merge(&v);
    }
}

fn merge_edit_maps(dst: &mut HashMap<String, EditDayAcc>, src: HashMap<String, EditDayAcc>) {
    for (k, v) in src {
        dst.entry(k).or_default().merge(&v);
    }
}

fn scan_codex_sources(
    min_day: NaiveDate,
    project_path: Option<&str>,
) -> (
    HashMap<String, TokenDayAcc>,
    HashMap<String, EditDayAcc>,
    SourceScanMeta,
) {
    let mut tokens = HashMap::new();
    let mut edits = HashMap::new();
    let mut meta = SourceScanMeta::default();
    let Some(root) = codex_sessions_root() else {
        return (tokens, edits, meta);
    };
    meta.push_root(&root);
    let mut files = Vec::new();
    collect_jsonl_under(&root, MAX_JSONL_FILES, &mut files);
    meta.scanned_files = files.len() as u32;
    for fp in files {
        let (t, e, te, ee) = scan_one_codex_jsonl(&fp, min_day, project_path);
        merge_token_maps(&mut tokens, t);
        merge_edit_maps(&mut edits, e);
        meta.events += te + ee;
    }
    (tokens, edits, meta)
}

fn scan_opencode_tokens(
    min_day: NaiveDate,
    project_path: Option<&str>,
    meta: &mut SourceScanMeta,
) -> HashMap<String, TokenDayAcc> {
    let mut out = HashMap::new();
    let Some(db_path) = opencode_db_path() else {
        return out;
    };
    meta.push_root(db_path.parent().unwrap_or(&db_path));
    let Some(conn) = open_sqlite_readonly(&db_path) else {
        return out;
    };
    meta.scanned_files = meta.scanned_files.saturating_add(1);
    let min_ms = min_day
        .and_hms_opt(0, 0, 0)
        .map(|ndt| Local.from_local_datetime(&ndt).single())
        .flatten()
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0);

    let sql = "SELECT p.data, p.time_created, s.directory
         FROM part p
         INNER JOIN session s ON s.id = p.session_id
         WHERE p.time_created >= ?1
           AND p.data LIKE '%\"type\":\"step-finish\"%'";

    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return out,
    };

    let rows = stmt.query_map(rusqlite::params![min_ms], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
        ))
    });

    let Ok(iter) = rows else {
        return out;
    };
    for row in iter.flatten() {
        let (data, time_created, directory) = row;
        if !path_matches_project(&directory, project_path) {
            continue;
        }
        let Some(day) = ms_to_local_day(time_created) else {
            continue;
        };
        if day < min_day {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("step-finish") {
            continue;
        }
        let Some(tokens) = v.get("tokens") else {
            continue;
        };
        let input = json_u64(tokens, "input").unwrap_or(0);
        let output = json_u64(tokens, "output").unwrap_or(0);
        let cache = tokens.get("cache").cloned().unwrap_or(Value::Null);
        let cache_read = json_u64(&cache, "read").unwrap_or(0);
        let cache_write = json_u64(&cache, "write").unwrap_or(0);
        let cost = v.get("cost").and_then(|c| c.as_f64()).unwrap_or(0.0);
        if input == 0 && output == 0 && cache_read == 0 && cache_write == 0 {
            continue;
        }
        let (cost_sum, cost_entries) = if cost.is_finite() && cost > 0.0 {
            (cost, 1u64)
        } else {
            (0.0, 0)
        };
        out.entry(day_key(day)).or_default().merge(&TokenDayAcc {
            input,
            output,
            cache_create: cache_write,
            cache_read,
            cost_sum,
            cost_entries,
        });
        meta.events += 1;
    }
    out
}

fn scan_opencode_edits(
    min_day: NaiveDate,
    project_path: Option<&str>,
    meta: &mut SourceScanMeta,
) -> HashMap<String, EditDayAcc> {
    let mut out = HashMap::new();
    let Some(db_path) = opencode_db_path() else {
        return out;
    };
    meta.push_root(db_path.parent().unwrap_or(&db_path));
    let Some(conn) = open_sqlite_readonly(&db_path) else {
        return out;
    };
    meta.scanned_files = meta.scanned_files.saturating_add(1);
    let min_ms = min_day
        .and_hms_opt(0, 0, 0)
        .map(|ndt| Local.from_local_datetime(&ndt).single())
        .flatten()
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0);

    let sql = "SELECT p.data, p.time_created, s.directory
         FROM part p
         INNER JOIN session s ON s.id = p.session_id
         WHERE p.time_created >= ?1
           AND (p.data LIKE '%\"tool\":\"edit\"%' OR p.data LIKE '%\"tool\":\"write\"%')";

    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return out,
    };
    let rows = stmt.query_map(rusqlite::params![min_ms], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
        ))
    });
    let Ok(iter) = rows else {
        return out;
    };
    for row in iter.flatten() {
        let (data, time_created, directory) = row;
        if !path_matches_project(&directory, project_path) {
            continue;
        }
        let Some(day) = ms_to_local_day(time_created) else {
            continue;
        };
        if day < min_day {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&data) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("tool") {
            continue;
        }
        let tool = v.get("tool").and_then(|t| t.as_str()).unwrap_or("");
        let state = v.get("state").cloned().unwrap_or(Value::Null);
        if state.get("status").and_then(|s| s.as_str()) == Some("error") {
            continue;
        }
        let input = state.get("input").cloned().unwrap_or(Value::Null);
        let (added, removed) = match tool {
            "write" => {
                let content = input
                    .get("content")
                    .or_else(|| input.get("contents"))
                    .or_else(|| input.get("text"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                if content.is_empty() {
                    continue;
                }
                (split_lines(content).len() as u64, 0)
            }
            "edit" => {
                let old = input
                    .get("oldString")
                    .or_else(|| input.get("old_string"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                let new = input
                    .get("newString")
                    .or_else(|| input.get("new_string"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                if old.is_empty() && new.is_empty() {
                    continue;
                }
                count_edit_lines_split(old, new)
            }
            _ => continue,
        };
        if added == 0 && removed == 0 {
            continue;
        }
        out.entry(day_key(day)).or_default().merge(&EditDayAcc {
            lines_added: added,
            lines_removed: removed,
            diffs: 1,
        });
        meta.events += 1;
    }
    out
}

fn composer_workspace_path(composer: &Value) -> Option<String> {
    let wi = composer.get("workspaceIdentifier")?;
    wi.get("uri")
        .and_then(|u| u.get("fsPath").or_else(|| u.get("path")))
        .and_then(|p| p.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            wi.get("uri")
                .and_then(|u| u.get("external"))
                .and_then(|p| p.as_str())
                .and_then(|ext| ext.strip_prefix("file://"))
                .map(|s| {
                    // percent-decode is best-effort; ASCII paths dominate.
                    percent_decode_path(s)
                })
                .filter(|s| !s.is_empty())
        })
}

fn percent_decode_path(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = |c: u8| -> Option<u8> {
                match c {
                    b'0'..=b'9' => Some(c - b'0'),
                    b'a'..=b'f' => Some(c - b'a' + 10),
                    b'A'..=b'F' => Some(c - b'A' + 10),
                    _ => None,
                }
            };
            if let (Some(a), Some(b)) = (h(bytes[i + 1]), h(bytes[i + 2])) {
                out.push(char::from(a * 16 + b));
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn scan_cursor_composer_edits(
    min_day: NaiveDate,
    project_path: Option<&str>,
    meta: &mut SourceScanMeta,
) -> HashMap<String, EditDayAcc> {
    let mut out = HashMap::new();
    let Some(db_path) = cursor_state_vscdb_path() else {
        return out;
    };
    meta.push_root(&db_path);
    let Some(conn) = open_sqlite_readonly(&db_path) else {
        return out;
    };
    meta.scanned_files = meta.scanned_files.saturating_add(1);
    let raw: String = match conn.query_row(
        "SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'",
        [],
        |row| row.get(0),
    ) {
        Ok(v) => v,
        Err(_) => return out,
    };
    let Ok(root) = serde_json::from_str::<Value>(&raw) else {
        return out;
    };
    let Some(composers) = root.get("allComposers").and_then(|v| v.as_array()) else {
        return out;
    };
    let mut seen_ids: HashSet<String> = HashSet::new();
    for composer in composers {
        let id = composer
            .get("composerId")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        if !id.is_empty() && !seen_ids.insert(id) {
            continue;
        }
        if let Some(ws) = composer_workspace_path(composer) {
            if !path_matches_project(&ws, project_path) {
                continue;
            }
        } else if project_path.is_some() {
            // 无工作区路径时无法归属到当前仓库，跳过以免污染仓库口径。
            continue;
        }
        let created = composer
            .get("createdAt")
            .and_then(|x| x.as_i64())
            .or_else(|| composer.get("createdAt").and_then(|x| x.as_f64()).map(|f| f as i64))
            .unwrap_or(0);
        let Some(day) = ms_to_local_day(created) else {
            continue;
        };
        if day < min_day {
            continue;
        }
        let added = json_u64(composer, "totalLinesAdded").unwrap_or(0);
        let removed = json_u64(composer, "totalLinesRemoved").unwrap_or(0);
        if added == 0 && removed == 0 {
            continue;
        }
        out.entry(day_key(day)).or_default().merge(&EditDayAcc {
            lines_added: added,
            lines_removed: removed,
            diffs: 1,
        });
        meta.events += 1;
    }
    out
}

/// Token：Codex + OpenCode（Cursor 本地无可靠 token 落盘，不计入）。
pub fn scan_extra_token_sources(
    min_day: NaiveDate,
    project_path: Option<&str>,
) -> (HashMap<String, TokenDayAcc>, SourceScanMeta) {
    let mut tokens = HashMap::new();
    let mut meta = SourceScanMeta::default();

    let (codex_tokens, _codex_edits, mut codex_meta) = scan_codex_sources(min_day, project_path);
    merge_token_maps(&mut tokens, codex_tokens);
    meta.scanned_files += codex_meta.scanned_files;
    meta.events += codex_meta.events;
    meta.data_roots.append(&mut codex_meta.data_roots);

    let opencode_tokens = scan_opencode_tokens(min_day, project_path, &mut meta);
    merge_token_maps(&mut tokens, opencode_tokens);

    (tokens, meta)
}

/// 代码编辑量：Cursor Composer + OpenCode + Codex。
pub fn scan_extra_edit_sources(
    min_day: NaiveDate,
    project_path: Option<&str>,
) -> (HashMap<String, EditDayAcc>, SourceScanMeta) {
    let mut edits = HashMap::new();
    let mut meta = SourceScanMeta::default();

    let (_codex_tokens, codex_edits, mut codex_meta) = scan_codex_sources(min_day, project_path);
    merge_edit_maps(&mut edits, codex_edits);
    meta.scanned_files += codex_meta.scanned_files;
    meta.events += codex_meta.events;
    meta.data_roots.append(&mut codex_meta.data_roots);

    let opencode_edits = scan_opencode_edits(min_day, project_path, &mut meta);
    merge_edit_maps(&mut edits, opencode_edits);

    let cursor_edits = scan_cursor_composer_edits(min_day, project_path, &mut meta);
    merge_edit_maps(&mut edits, cursor_edits);

    (edits, meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn path_matches_project_prefix() {
        assert!(path_matches_project(
            "/Users/a/proj/src/a.ts",
            Some("/Users/a/proj")
        ));
        assert!(path_matches_project("/Users/a/proj", Some("/Users/a/proj")));
        assert!(!path_matches_project(
            "/Users/a/proj-other",
            Some("/Users/a/proj")
        ));
        assert!(path_matches_project("/any", None));
    }

    #[test]
    fn count_apply_patch_lines_ignores_headers() {
        let patch = "*** Begin Patch\n*** Update File: a.rs\n@@\n-old\n+new\n+new2\n*** End Patch\n";
        assert_eq!(count_apply_patch_lines(patch), (2, 1));
    }

    #[test]
    fn extract_codex_last_token_usage_reads_last_not_total() {
        let v = json!({
            "type": "event_msg",
            "timestamp": "2026-06-21T15:13:51.111Z",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 99999,
                        "cached_input_tokens": 1,
                        "output_tokens": 1,
                        "total_tokens": 100001
                    },
                    "last_token_usage": {
                        "input_tokens": 100,
                        "cached_input_tokens": 40,
                        "output_tokens": 10,
                        "total_tokens": 110
                    }
                }
            }
        });
        let acc = extract_codex_last_token_usage(&v).unwrap();
        assert_eq!(acc.input, 100);
        assert_eq!(acc.output, 10);
        assert_eq!(acc.cache_read, 40);
    }

    #[test]
    fn composer_workspace_path_from_uri() {
        let c = json!({
            "workspaceIdentifier": {
                "uri": { "fsPath": "/Users/sjl/Documents/github/wise-tui" }
            }
        });
        assert_eq!(
            composer_workspace_path(&c).as_deref(),
            Some("/Users/sjl/Documents/github/wise-tui")
        );
    }
}
