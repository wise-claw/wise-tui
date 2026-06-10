//! OpenCode 内置代理请求 trace（内存环形缓冲，对齐 FCC / LLM 代理面板）。

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

const MAX_TRACES: usize = 200;
const MAX_PREVIEW: usize = 8 * 1024;

static TRACE_STORE: OnceLock<TraceStore> = OnceLock::new();

pub fn trace_store() -> &'static TraceStore {
    TRACE_STORE.get_or_init(TraceStore::new)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeGoProxyTraceEntry {
    pub id: String,
    pub timestamp_ms: i64,
    pub method: String,
    pub path: String,
    pub claude_model: String,
    pub upstream_model: String,
    pub upstream_url: String,
    pub status_code: Option<u16>,
    pub duration_ms: u64,
    pub is_streaming: bool,
    pub request_preview: String,
    pub response_preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

pub struct TraceStore {
    entries: Mutex<VecDeque<OpencodeGoProxyTraceEntry>>,
}

impl TraceStore {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(VecDeque::new()),
        }
    }

    pub fn len(&self) -> usize {
        self.entries
            .lock()
            .map(|q| q.len())
            .unwrap_or(0)
    }

    pub fn clear(&self) -> usize {
        let Ok(mut guard) = self.entries.lock() else {
            return 0;
        };
        let n = guard.len();
        guard.clear();
        n
    }

    pub fn list(&self, limit: usize, since_ms: Option<i64>) -> Vec<OpencodeGoProxyTraceEntry> {
        let Ok(guard) = self.entries.lock() else {
            return Vec::new();
        };
        guard
            .iter()
            .rev()
            .filter(|e| since_ms.is_none_or(|since| e.timestamp_ms >= since))
            .take(limit)
            .cloned()
            .collect()
    }

    fn push(&self, entry: OpencodeGoProxyTraceEntry) {
        let Ok(mut guard) = self.entries.lock() else {
            return;
        };
        guard.push_back(entry);
        while guard.len() > MAX_TRACES {
            guard.pop_front();
        }
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn preview_json(value: &Value) -> String {
    let text = match serde_json::to_string(value) {
        Ok(s) => s,
        Err(_) => value.to_string(),
    };
    truncate_preview(&text)
}

pub fn preview_text(text: &str) -> String {
    truncate_preview(text)
}

fn char_boundary_at_or_before(text: &str, max_bytes: usize) -> usize {
    if text.len() <= max_bytes {
        return text.len();
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    end
}

fn append_preview(buffer: &Mutex<String>, text: &str) {
    if text.is_empty() {
        return;
    }
    let Ok(mut guard) = buffer.lock() else {
        return;
    };
    guard.push_str(text);
    if guard.len() > MAX_PREVIEW {
        let end = char_boundary_at_or_before(&guard, MAX_PREVIEW);
        guard.truncate(end);
        guard.push('…');
    }
}

fn truncate_preview(text: &str) -> String {
    if text.len() <= MAX_PREVIEW {
        return text.to_string();
    }
    let end = char_boundary_at_or_before(text, MAX_PREVIEW);
    format!("{}…", &text[..end])
}

struct TraceMeta {
    started: Instant,
    path: String,
    claude_model: String,
    upstream_model: String,
    upstream_url: String,
    is_streaming: bool,
    request_preview: String,
}

struct TraceCaptureInner {
    meta: TraceMeta,
    response_buffer: Mutex<String>,
    finalized: Mutex<bool>,
}

/// 进行中的 trace：流式响应在结束后调用 `finalize_stream`。
#[derive(Clone)]
pub struct TraceCapture(Arc<TraceCaptureInner>);

impl TraceCapture {
    pub fn begin(
        path: &str,
        claude_model: String,
        upstream_model: String,
        upstream_url: String,
        body: &Value,
        is_streaming: bool,
    ) -> Self {
        Self(Arc::new(TraceCaptureInner {
            meta: TraceMeta {
                started: Instant::now(),
                path: path.to_string(),
                claude_model,
                upstream_model,
                upstream_url,
                is_streaming,
                request_preview: preview_json(body),
            },
            response_buffer: Mutex::new(String::new()),
            finalized: Mutex::new(false),
        }))
    }

    pub fn push_sse_text(&self, text: &str) {
        append_preview(&self.0.response_buffer, text);
    }

    pub fn finish_error(&self, status_code: Option<u16>, message: impl Into<String>) {
        self.commit(status_code, String::new(), Some(message.into()));
    }

    pub fn finish_success(&self, status_code: u16, response_preview: impl Into<String>) {
        self.commit(Some(status_code), response_preview.into(), None);
    }

    pub fn finalize_stream(&self, status_code: u16) {
        let preview = self
            .0
            .response_buffer
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default();
        let preview = if preview.is_empty() {
            "SSE stream (empty)".to_string()
        } else {
            preview
        };
        self.commit(Some(status_code), preview, None);
    }

    fn commit(&self, status_code: Option<u16>, response_preview: String, error_message: Option<String>) {
        {
            let Ok(mut done) = self.0.finalized.lock() else {
                return;
            };
            if *done {
                return;
            }
            *done = true;
        }
        let meta = &self.0.meta;
        trace_store().push(OpencodeGoProxyTraceEntry {
            id: Uuid::new_v4().to_string(),
            timestamp_ms: now_ms(),
            method: "POST".to_string(),
            path: meta.path.clone(),
            claude_model: meta.claude_model.clone(),
            upstream_model: meta.upstream_model.clone(),
            upstream_url: meta.upstream_url.clone(),
            status_code,
            duration_ms: meta.started.elapsed().as_millis() as u64,
            is_streaming: meta.is_streaming,
            request_preview: meta.request_preview.clone(),
            response_preview,
            error_message,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn truncate_preview_respects_utf8_char_boundaries() {
        let cjk = "中".repeat(MAX_PREVIEW);
        let preview = truncate_preview(&cjk);
        assert!(preview.ends_with('…'));
        assert!(preview.is_char_boundary(preview.len() - '…'.len_utf8()));
    }

    #[test]
    fn preview_json_does_not_panic_on_large_cjk_payload() {
        let value = json!({ "text": "中".repeat(MAX_PREVIEW + 16) });
        let preview = preview_json(&value);
        assert!(preview.ends_with('…'));
    }

    #[test]
    fn append_preview_does_not_panic_when_exceeding_limit() {
        let buffer = Mutex::new(String::new());
        append_preview(&buffer, &"中".repeat(MAX_PREVIEW + 8));
        let guard = buffer.lock().expect("lock");
        assert!(guard.ends_with('…'));
        assert!(guard.len() <= MAX_PREVIEW + '…'.len_utf8());
    }
}
