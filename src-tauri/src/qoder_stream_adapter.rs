//! Map Qoder CLI `--output-format=stream-json` stdout into Claude Code stream-json lines.
//!
//! Qoder Agent SDK / CLI largely mirrors Claude Code message shapes (`assistant`, `result`,
//! `stream_event`, …). Unknown JSON and plain text are wrapped as assistant text.

use serde_json::{json, Value};

#[derive(Debug, PartialEq, Eq)]
pub enum QoderStdoutMap {
    PlainText,
    StreamLines(Vec<String>),
}

#[derive(Default)]
pub struct QoderStdoutMapper {
    emitted_session_id: Option<String>,
    last_error: Option<String>,
}

impl QoderStdoutMapper {
    pub fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }

    pub fn map_line(&mut self, raw_line: &str) -> QoderStdoutMap {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            return QoderStdoutMap::StreamLines(vec![]);
        }
        if !trimmed.starts_with('{') {
            return QoderStdoutMap::PlainText;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            return QoderStdoutMap::PlainText;
        };
        if !value.is_object() {
            return QoderStdoutMap::PlainText;
        }
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !looks_like_qoder_or_claude_event(event_type) {
            return QoderStdoutMap::PlainText;
        }
        QoderStdoutMap::StreamLines(self.map_event(event_type, trimmed, &value))
    }
}

fn looks_like_qoder_or_claude_event(event_type: &str) -> bool {
    matches!(
        event_type,
        "system"
            | "assistant"
            | "user"
            | "result"
            | "stream_event"
            | "error"
            | "tool_progress"
            | "qoder_session"
    )
}

pub fn qoder_session_stream_line(session_id: &str) -> String {
    json!({
        "type": "qoder_session",
        "sessionId": session_id,
    })
    .to_string()
}

pub fn qoder_session_clear_line() -> String {
    qoder_session_stream_line("")
}

pub fn qoder_assistant_stream_line(text: &str) -> String {
    json!({
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [{ "type": "text", "text": text }]
        }
    })
    .to_string()
}

pub fn qoder_init_stream_line(session_id: &str) -> String {
    json!({
        "type": "system",
        "subtype": "init",
        "session_id": session_id,
    })
    .to_string()
}

impl QoderStdoutMapper {
    fn maybe_emit_session_id(&mut self, value: &Value) -> Vec<String> {
        let session_id = value
            .get("session_id")
            .or_else(|| value.get("sessionId"))
            .or_else(|| value.get("sessionID"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let Some(session_id) = session_id else {
            return vec![];
        };
        if self.emitted_session_id.as_deref() == Some(session_id) {
            return vec![];
        }
        self.emitted_session_id = Some(session_id.to_string());
        vec![qoder_session_stream_line(session_id)]
    }

    fn map_event(&mut self, event_type: &str, raw_line: &str, value: &Value) -> Vec<String> {
        let mut out = self.maybe_emit_session_id(value);
        match event_type {
            "error" => {
                let msg = value
                    .get("error")
                    .and_then(|e| {
                        e.as_str().map(|s| s.to_string()).or_else(|| {
                            e.get("message")
                                .and_then(Value::as_str)
                                .map(|s| s.to_string())
                        })
                    })
                    .or_else(|| {
                        value
                            .get("message")
                            .and_then(Value::as_str)
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_else(|| "Qoder CLI 执行出错".to_string());
                if !msg.trim().is_empty() {
                    self.last_error = Some(msg.trim().to_string());
                }
                out.push(raw_line.to_string());
            }
            "qoder_session" => {
                // already handled via maybe_emit / pass-through
                out.push(raw_line.to_string());
            }
            _ => {
                // Claude-compatible event: pass through verbatim for the frontend parser.
                out.push(raw_line.to_string());
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_assistant_passthrough_and_session() {
        let mut mapper = QoderStdoutMapper::default();
        let line = r#"{"type":"assistant","session_id":"abc-123","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#;
        match mapper.map_line(line) {
            QoderStdoutMap::StreamLines(lines) => {
                assert!(lines.iter().any(|l| l.contains("qoder_session")));
                assert!(lines.iter().any(|l| l.contains(r#""type":"assistant""#)));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn plain_text_flagged() {
        let mut mapper = QoderStdoutMapper::default();
        assert_eq!(mapper.map_line("hello"), QoderStdoutMap::PlainText);
    }
}
