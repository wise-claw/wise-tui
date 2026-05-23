//! 读取 `~/.fcc/traces/` 下 FCC HTTP trace 文件（Wise 侧契约，见 design/session-data-link-observability/）。

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const MAX_PREVIEW_CHARS: usize = 24_000;
const DEFAULT_LIMIT: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FccTraceEntry {
    pub id: String,
    pub timestamp_ms: i64,
    pub method: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic_request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_preview: Option<String>,
}

fn fcc_traces_root() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".fcc").join("traces"))
        .unwrap_or_else(|| PathBuf::from(".fcc/traces"))
}

fn truncate_preview(s: &str) -> String {
    if s.len() <= MAX_PREVIEW_CHARS {
        return s.to_string();
    }
    format!("{}…[truncated]", &s[..MAX_PREVIEW_CHARS])
}

fn parse_timestamp_ms(v: &serde_json::Value) -> Option<i64> {
    match v {
        serde_json::Value::Number(n) => n.as_i64(),
        serde_json::Value::String(s) => {
            if let Ok(ms) = s.parse::<i64>() {
                return Some(ms);
            }
            chrono_like_parse(s)
        }
        _ => None,
    }
}

fn chrono_like_parse(s: &str) -> Option<i64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    if let Ok(ms) = t.parse::<i64>() {
        return Some(ms);
    }
    // ISO-8601 → epoch ms（无 chrono 依赖时用简单解析）
    if let Ok(dt) = parse_rfc3339_loose(t) {
        return Some(dt);
    }
    None
}

fn parse_rfc3339_loose(s: &str) -> Result<i64, ()> {
    // 仅处理常见 `2026-05-23T12:00:00.000Z` 形态
    let s = s.trim();
    if s.len() < 20 {
        return Err(());
    }
    let date = &s[0..10];
    let rest = s[10..].trim_start_matches('T').trim_start_matches('t');
    let time_part = rest.split(['Z', 'z', '+', '-']).next().unwrap_or(rest);
    let parts: Vec<&str> = time_part.split(':').collect();
    if parts.len() < 2 {
        return Err(());
    }
    let ymd: Vec<&str> = date.split('-').collect();
    if ymd.len() != 3 {
        return Err(());
    }
    let year: i64 = ymd[0].parse().map_err(|_| ())?;
    let month: i64 = ymd[1].parse().map_err(|_| ())?;
    let day: i64 = ymd[2].parse().map_err(|_| ())?;
    let hour: i64 = parts[0].parse().map_err(|_| ())?;
    let min: i64 = parts[1].parse().map_err(|_| ())?;
    let sec: i64 = parts
        .get(2)
        .and_then(|s| s.split('.').next())
        .unwrap_or("0")
        .parse()
        .unwrap_or(0);
    use std::time::{Duration, UNIX_EPOCH};
    let days_from_epoch = days_since_unix_epoch(year, month, day)?;
    let secs = days_from_epoch * 86_400 + hour * 3600 + min * 60 + sec;
    Ok(UNIX_EPOCH
        .checked_add(Duration::from_secs(secs as u64))
        .ok_or(())?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ())?
        .as_millis() as i64)
}

fn days_since_unix_epoch(year: i64, month: i64, day: i64) -> Result<i64, ()> {
    fn is_leap(y: i64) -> bool {
        (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
    }
    let mut days: i64 = 0;
    for y in 1970..year {
        days += if is_leap(y) { 366 } else { 365 };
    }
    let month_days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for m in 1..month {
        let mut md = month_days[(m - 1) as usize] as i64;
        if m == 2 && is_leap(year) {
            md += 1;
        }
        days += md;
    }
    days += day - 1;
    Ok(days)
}

fn entry_from_json_value(v: &serde_json::Value, fallback_id: &str) -> Option<FccTraceEntry> {
    let obj = v.as_object()?;
    let timestamp_ms = obj
        .get("timestampMs")
        .or_else(|| obj.get("timestamp_ms"))
        .and_then(parse_timestamp_ms)
        .or_else(|| {
            obj.get("timestamp")
                .and_then(|t| parse_timestamp_ms(t))
        })?;
    let method = obj
        .get("method")
        .and_then(|m| m.as_str())
        .unwrap_or("POST")
        .to_string();
    let path = obj
        .get("path")
        .and_then(|p| p.as_str())
        .unwrap_or("/v1/messages")
        .to_string();
    let id = obj
        .get("id")
        .and_then(|i| i.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| fallback_id.to_string());
    let request_preview = obj
        .get("requestPreview")
        .or_else(|| obj.get("request_preview"))
        .and_then(|v| v.as_str())
        .map(truncate_preview);
    let response_preview = obj
        .get("responsePreview")
        .or_else(|| obj.get("response_preview"))
        .and_then(|v| v.as_str())
        .map(truncate_preview);
    Some(FccTraceEntry {
        id,
        timestamp_ms,
        method,
        path,
        status_code: obj
            .get("statusCode")
            .or_else(|| obj.get("status_code"))
            .and_then(|v| v.as_u64())
            .map(|n| n as u16),
        duration_ms: obj
            .get("durationMs")
            .or_else(|| obj.get("duration_ms"))
            .and_then(|v| v.as_u64()),
        model: obj
            .get("model")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        request_preview,
        response_preview,
        session_hint: obj
            .get("sessionHint")
            .or_else(|| obj.get("session_hint"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        anthropic_request_id: obj
            .get("anthropicRequestId")
            .or_else(|| obj.get("anthropic_request_id"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        upstream_preview: obj
            .get("upstreamPreview")
            .or_else(|| obj.get("upstream_preview"))
            .and_then(|v| v.as_str())
            .map(truncate_preview),
    })
}

fn collect_from_file(path: &Path, out: &mut Vec<FccTraceEntry>) {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return,
    };
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("trace");
    if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
        for (i, line) in text.lines().enumerate() {
            let line = line.trim();
            if !line.starts_with('{') {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(entry) = entry_from_json_value(&v, &format!("{stem}-{i}")) {
                    out.push(entry);
                }
            }
        }
        return;
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(arr) = v.as_array() {
            for (i, item) in arr.iter().enumerate() {
                if let Some(entry) = entry_from_json_value(item, &format!("{stem}-{i}")) {
                    out.push(entry);
                }
            }
            return;
        }
        if let Some(entry) = entry_from_json_value(&v, stem) {
            out.push(entry);
        }
    }
}

fn walk_traces_dir(dir: &Path, out: &mut Vec<FccTraceEntry>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for ent in entries.flatten() {
        let path = ent.path();
        if path.is_dir() {
            walk_traces_dir(&path, out);
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str());
        if ext == Some("json") || ext == Some("jsonl") {
            collect_from_file(&path, out);
        }
    }
}

fn matches_session_hint(entry: &FccTraceEntry, hint: &str) -> bool {
    let h = hint.trim();
    if h.is_empty() {
        return true;
    }
    let session_hint = entry.session_hint.as_deref().unwrap_or("");
    if session_hint.contains(h) || h.contains(session_hint) {
        return true;
    }
    entry
        .anthropic_request_id
        .as_deref()
        .is_some_and(|id| id.contains(h) || h.contains(id))
}

fn remove_trace_files(dir: &Path) -> u32 {
    let mut removed = 0u32;
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    for ent in entries.flatten() {
        let path = ent.path();
        if path.is_dir() {
            removed += remove_trace_files(&path);
            if fs::read_dir(&path).map(|mut d| d.next().is_none()).unwrap_or(false) {
                let _ = fs::remove_dir(&path);
            }
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str());
        if ext == Some("json") || ext == Some("jsonl") {
            if fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

#[tauri::command]
pub(crate) fn clear_fcc_traces() -> Result<u32, String> {
    let root = fcc_traces_root();
    if !root.is_dir() {
        return Ok(0);
    }
    Ok(remove_trace_files(&root))
}

#[tauri::command]
pub(crate) fn list_fcc_traces(
    since_ms: Option<i64>,
    limit: Option<u32>,
    session_hint: Option<String>,
) -> Result<Vec<FccTraceEntry>, String> {
    let root = fcc_traces_root();
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut all = Vec::new();
    walk_traces_dir(&root, &mut all);
    if let Some(since) = since_ms {
        all.retain(|e| e.timestamp_ms >= since);
    }
    if let Some(ref hint) = session_hint {
        let h = hint.trim();
        if !h.is_empty() {
            all.retain(|e| matches_session_hint(e, h));
        }
    }
    all.sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms));
    let cap = limit.unwrap_or(DEFAULT_LIMIT as u32).min(500) as usize;
    all.truncate(cap);
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_from_minimal_json() {
        let v: serde_json::Value = serde_json::json!({
            "timestampMs": 1_700_000_000_000i64,
            "method": "POST",
            "path": "/v1/messages",
            "statusCode": 200
        });
        let e = entry_from_json_value(&v, "t0").expect("parse");
        assert_eq!(e.path, "/v1/messages");
        assert_eq!(e.status_code, Some(200));
    }
}
