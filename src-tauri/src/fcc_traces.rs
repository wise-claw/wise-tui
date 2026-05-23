//! 读取 FCC HTTP trace：`~/.fcc/traces/` 文件 + `~/.fcc/logs/server.log` TRACE 行。

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const MAX_PREVIEW_CHARS: usize = 24_000;
const DEFAULT_LIMIT: usize = 200;
const MAX_LOG_TAIL_BYTES: usize = 3 * 1024 * 1024;

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

fn fcc_home() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".fcc"))
        .unwrap_or_else(|| PathBuf::from(".fcc"))
}

fn fcc_traces_root() -> PathBuf {
    fcc_home().join("traces")
}

fn fcc_server_log_path() -> PathBuf {
    fcc_home().join("logs").join("server.log")
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
    use chrono::{DateTime, NaiveDateTime};

    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    if let Ok(ms) = t.parse::<i64>() {
        return Some(ms);
    }

    const FCC_LOG_FMTS: &[&str] = &[
        "%Y-%m-%d %H:%M:%S%.f%:z",
        "%Y-%m-%d %H:%M:%S%:z",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S",
    ];
    for fmt in FCC_LOG_FMTS {
        if let Ok(dt) = DateTime::parse_from_str(t, fmt) {
            return Some(dt.timestamp_millis());
        }
    }

    if let Ok(dt) = DateTime::parse_from_rfc3339(t) {
        return Some(dt.timestamp_millis());
    }

    // `2026-05-23 17:39:29+08:00` → RFC3339
    if t.contains(' ') && !t.contains('T') {
        let iso = t.replacen(' ', "T", 1);
        if let Ok(dt) = DateTime::parse_from_rfc3339(&iso) {
            return Some(dt.timestamp_millis());
        }
    }

    // 无时区：按 UTC 字面量（trace 文件若只存墙钟且无 offset）
    const NAIVE_FMTS: &[&str] = &["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S"];
    for fmt in NAIVE_FMTS {
        if let Ok(naive) = NaiveDateTime::parse_from_str(t, fmt) {
            return Some(naive.and_utc().timestamp_millis());
        }
    }

    None
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

#[derive(Debug, Default)]
struct PendingServerLogTrace {
    timestamp_ms: i64,
    method: String,
    path: String,
    model: Option<String>,
    request_preview: Option<String>,
    upstream_preview: Option<String>,
    response_preview: Option<String>,
    status_code: Option<u16>,
    end_ms: Option<i64>,
}

fn json_value_preview(v: &serde_json::Value) -> String {
    truncate_preview(&v.to_string())
}

fn ingest_server_log_event(
    v: &serde_json::Value,
    pending: &mut HashMap<String, PendingServerLogTrace>,
    last_by_path: &mut HashMap<String, String>,
) {
    let event = match v.get("event").and_then(|e| e.as_str()) {
        Some(e) => e,
        None => return,
    };
    let trace_flag = v.get("trace").and_then(|t| t.as_bool()).unwrap_or(false);
    if !trace_flag && !event.starts_with("api.") && !event.starts_with("provider.") {
        return;
    }
    let time_ms = v
        .get("time")
        .and_then(|t| t.as_str())
        .and_then(chrono_like_parse)
        .unwrap_or(0);
    let method = v
        .get("http_method")
        .and_then(|m| m.as_str())
        .unwrap_or("POST")
        .to_string();
    let path = v
        .get("http_path")
        .and_then(|p| p.as_str())
        .unwrap_or("/v1/messages")
        .to_string();

    match event {
        "api.request.received" => {
            let Some(request_id) = v.get("request_id").and_then(|r| r.as_str()) else {
                return;
            };
            let model = v
                .get("snapshot")
                .and_then(|s| s.get("model"))
                .and_then(|m| m.as_str())
                .map(str::to_string)
                .or_else(|| {
                    v.get("gateway_model")
                        .and_then(|m| m.as_str())
                        .map(str::to_string)
                });
            let request_preview = v
                .get("snapshot")
                .map(json_value_preview);
            pending.insert(
                request_id.to_string(),
                PendingServerLogTrace {
                    timestamp_ms: time_ms,
                    method: method.clone(),
                    path: path.clone(),
                    model,
                    request_preview,
                    ..Default::default()
                },
            );
            last_by_path.insert(path, request_id.to_string());
        }
        "provider.request.sent" => {
            let target = last_by_path.get(&path).cloned();
            let Some(id) = target else { return };
            if let Some(slot) = pending.get_mut(&id) {
                if let Some(body) = v.get("body") {
                    slot.upstream_preview = Some(json_value_preview(body));
                }
                if slot.model.is_none() {
                    slot.model = v
                        .get("gateway_model")
                        .and_then(|m| m.as_str())
                        .map(str::to_string);
                }
            }
        }
        "api.response.stream_completed" | "api.response.completed" => {
            let Some(request_id) = v.get("request_id").and_then(|r| r.as_str()) else {
                return;
            };
            let Some(slot) = pending.get_mut(request_id) else {
                return;
            };
            slot.end_ms = Some(time_ms);
            let outcome = v.get("outcome").and_then(|o| o.as_str()).unwrap_or("ok");
            slot.status_code = Some(if outcome == "ok" { 200 } else { 502 });
            let summary = serde_json::json!({
                "type": "stream",
                "outcome": outcome,
                "streamChunks": v.get("stream_chunks").or_else(|| v.get("sse_chunks_out")),
                "streamBytes": v.get("stream_bytes").or_else(|| v.get("sse_bytes_out")),
                "providerId": v.get("provider_id").or_else(|| v.get("provider")),
                "gatewayModel": v.get("gateway_model"),
            });
            slot.response_preview = Some(json_value_preview(&summary));
            if slot.model.is_none() {
                slot.model = v
                    .get("gateway_model")
                    .and_then(|m| m.as_str())
                    .map(str::to_string);
            }
        }
        _ => {}
    }
}

fn pending_to_entry(id: &str, p: PendingServerLogTrace) -> FccTraceEntry {
    let duration_ms = p
        .end_ms
        .filter(|end| *end >= p.timestamp_ms)
        .map(|end| (end - p.timestamp_ms) as u64);
    FccTraceEntry {
        id: id.to_string(),
        timestamp_ms: p.timestamp_ms,
        method: p.method,
        path: p.path,
        status_code: p.status_code,
        duration_ms,
        model: p.model,
        request_preview: p.request_preview,
        response_preview: p.response_preview,
        session_hint: None,
        anthropic_request_id: Some(id.to_string()),
        upstream_preview: p.upstream_preview,
    }
}

fn read_log_tail(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    let len = meta.len();
    let mut file = File::open(path).ok()?;
    let start = len.saturating_sub(MAX_LOG_TAIL_BYTES as u64);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = String::new();
    file.read_to_string(&mut buf).ok()?;
    if start > 0 {
        if let Some(idx) = buf.find('\n') {
            buf = buf[idx + 1..].to_string();
        }
    }
    Some(buf)
}

fn collect_from_server_log(path: &Path, out: &mut Vec<FccTraceEntry>) {
    let text = match read_log_tail(path) {
        Some(t) if !t.is_empty() => t,
        _ => match fs::read_to_string(path) {
            Ok(t) => t,
            Err(_) => return,
        },
    };
    let mut pending: HashMap<String, PendingServerLogTrace> = HashMap::new();
    let mut last_by_path: HashMap<String, String> = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with('{') {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        ingest_server_log_event(&v, &mut pending, &mut last_by_path);
    }
    for (id, p) in pending {
        if p.path != "/v1/messages" && !p.path.contains("messages") {
            continue;
        }
        if p.request_preview.is_none() && p.response_preview.is_none() {
            continue;
        }
        out.push(pending_to_entry(&id, p));
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
    let mut removed = 0u32;
    let root = fcc_traces_root();
    if root.is_dir() {
        removed += remove_trace_files(&root);
    }
    let log_path = fcc_server_log_path();
    if log_path.is_file() {
        if fs::write(&log_path, "").is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

fn merge_trace_lists(file_traces: Vec<FccTraceEntry>, log_traces: Vec<FccTraceEntry>) -> Vec<FccTraceEntry> {
    let mut by_id: HashMap<String, FccTraceEntry> = HashMap::new();
    for e in file_traces {
        by_id.insert(e.id.clone(), e);
    }
    for e in log_traces {
        by_id
            .entry(e.id.clone())
            .and_modify(|existing| {
                if existing.request_preview.is_none() {
                    existing.request_preview = e.request_preview.clone();
                }
                if existing.response_preview.is_none() {
                    existing.response_preview = e.response_preview.clone();
                }
                if existing.upstream_preview.is_none() {
                    existing.upstream_preview = e.upstream_preview.clone();
                }
                if existing.status_code.is_none() {
                    existing.status_code = e.status_code;
                }
                if existing.duration_ms.is_none() {
                    existing.duration_ms = e.duration_ms;
                }
                if existing.model.is_none() {
                    existing.model = e.model.clone();
                }
            })
            .or_insert(e);
    }
    by_id.into_values().collect()
}

#[tauri::command]
pub(crate) fn list_fcc_traces(
    since_ms: Option<i64>,
    limit: Option<u32>,
    session_hint: Option<String>,
) -> Result<Vec<FccTraceEntry>, String> {
    let mut file_traces = Vec::new();
    let root = fcc_traces_root();
    if root.is_dir() {
        walk_traces_dir(&root, &mut file_traces);
    }
    let mut log_traces = Vec::new();
    let log_path = fcc_server_log_path();
    if log_path.is_file() {
        collect_from_server_log(&log_path, &mut log_traces);
    }
    let mut all = merge_trace_lists(file_traces, log_traces);
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

    #[test]
    fn fcc_server_log_time_respects_timezone_offset() {
        let ms = chrono_like_parse("2026-05-23 17:39:29.099940+08:00").expect("parse");
        let utc = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms).expect("epoch");
        assert_eq!(
            utc.format("%Y-%m-%d %H:%M:%S").to_string(),
            "2026-05-23 09:39:29"
        );
        let east8 = chrono::FixedOffset::east_opt(8 * 3600).expect("offset");
        assert_eq!(
            utc.with_timezone(&east8).format("%H:%M:%S").to_string(),
            "17:39:29"
        );
    }

    #[test]
    fn server_log_trace_events_merge_into_request() {
        let mut pending = HashMap::new();
        let mut last = HashMap::new();
        let recv = serde_json::json!({
            "time": "2026-05-23 17:39:29.099940+08:00",
            "event": "api.request.received",
            "trace": true,
            "request_id": "req_test",
            "http_method": "POST",
            "http_path": "/v1/messages",
            "snapshot": { "model": "qwen3.6-plus", "messages": [] }
        });
        ingest_server_log_event(&recv, &mut pending, &mut last);
        let done = serde_json::json!({
            "time": "2026-05-23 17:39:32.727667+08:00",
            "event": "api.response.stream_completed",
            "trace": true,
            "request_id": "req_test",
            "http_method": "POST",
            "http_path": "/v1/messages",
            "outcome": "ok",
            "stream_chunks": 10,
            "stream_bytes": 100
        });
        ingest_server_log_event(&done, &mut pending, &mut last);
        let p = pending.remove("req_test").expect("pending");
        let e = pending_to_entry("req_test", p);
        assert_eq!(e.id, "req_test");
        assert_eq!(e.status_code, Some(200));
        assert!(e.request_preview.is_some());
        assert!(e.response_preview.is_some());
        let east8 = chrono::FixedOffset::east_opt(8 * 3600).expect("offset");
        assert_eq!(
            chrono::DateTime::<chrono::Utc>::from_timestamp_millis(e.timestamp_ms)
                .expect("epoch")
                .with_timezone(&east8)
                .format("%H:%M:%S")
                .to_string(),
            "17:39:29"
        );
    }
}
