//! 把 DeepSeek Harness（`dsh`）原生会话事件流映射为 Wise 流式行。
//!
//! 原生会话落盘在 `~/.dsh/sessions/<encoded-cwd>/<session-id>/session.v3.jsonl.zstd`，
//! 解压后是逐行追加的事件日志：
//!
//! - `session`：会话头（id / cwd / createdAt）
//! - `session/title`：会话标题
//! - `user/message`：`data.source.kind == "user"` 才是真实用户输入（其余是插件注入的上下文）
//! - `assistant/message`：一个 step 的完整助手消息，`content[]` 里混有
//!   `reasoning` / `text` / `tool-call` 块
//! - `tool/result`：工具产出，用 `toolCallId` 关联 `tool-call`
//! - `assistant/chunk` / `text-chunks` / `reasoning-chunks` / `tool-call-chunks`：流式增量，
//!   已被 `assistant/message` 覆盖，这里全部跳过，避免重复渲染。

use serde_json::{json, Value};

/// `session` 行里的会话头字段。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct DshSessionHeader {
    pub session_id: String,
    pub cwd: String,
    pub created_at_ms: Option<i64>,
}

pub(crate) fn parse_dsh_session_header(raw_line: &str) -> Option<DshSessionHeader> {
    let line = raw_line.trim();
    if !line.starts_with('{') || !line.contains("\"session\"") {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("session") {
        return None;
    }
    let session_id = value
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    Some(DshSessionHeader {
        session_id,
        cwd: value
            .get("cwd")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
            .to_string(),
        created_at_ms: value.get("createdAt").and_then(Value::as_i64),
    })
}

/// `session/title` 里的标题（列表页优先用用户提示词，仅作兜底）。
pub(crate) fn parse_dsh_session_title(raw_line: &str) -> Option<String> {
    let line = raw_line.trim();
    if !line.starts_with('{') || !line.contains("session/title") {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("session/title") {
        return None;
    }
    value
        .get("data")
        .and_then(|d| d.get("title"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// 第一条真实用户输入（列表页预览）。
pub(crate) fn parse_dsh_user_preview(raw_line: &str) -> Option<String> {
    let value = parse_dsh_user_message(raw_line)?;
    value
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
}

fn parse_dsh_user_message(raw_line: &str) -> Option<String> {
    let line = raw_line.trim();
    if !line.starts_with('{') || !line.contains("user/message") {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("user/message") {
        return None;
    }
    let data = value.get("data")?;
    if data
        .get("source")
        .and_then(|s| s.get("kind"))
        .and_then(Value::as_str)
        != Some("user")
    {
        return None;
    }
    let text = content_text(data.get("content")?)?;
    (!text.trim().is_empty()).then_some(text)
}

pub(crate) fn map_dsh_session_line(raw_line: &str) -> Vec<String> {
    let line = raw_line.trim();
    if !line.starts_with('{') {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    let ts_ms = value.get("time").and_then(Value::as_i64);
    match value.get("type").and_then(Value::as_str) {
        Some("session") => parse_dsh_session_header(line)
            .map(|header| vec![dsh_session_bind_line(&header.session_id)])
            .unwrap_or_default(),
        Some("user/message") => parse_dsh_user_message(line)
            .map(|text| vec![user_turn_line(&text, ts_ms)])
            .unwrap_or_default(),
        Some("assistant/message") => map_assistant_message(value.get("data"), ts_ms),
        Some("tool/result") => map_tool_result(value.get("data"), ts_ms),
        Some("assistant/chunk")
        | Some("text-chunks")
        | Some("reasoning-chunks")
        | Some("tool-call-chunks") => Vec::new(),
        _ => Vec::new(),
    }
}

fn map_assistant_message(data: Option<&Value>, ts_ms: Option<i64>) -> Vec<String> {
    let Some(content) = data
        .and_then(|d| d.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    let message_id = data
        .and_then(|d| d.get("message"))
        .and_then(|m| m.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut lines = Vec::new();
    for (index, block) in content.iter().enumerate() {
        let Some(kind) = block.get("type").and_then(Value::as_str) else {
            continue;
        };
        let block_id = block
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                if message_id.is_empty() {
                    format!("dsh-{index}")
                } else {
                    format!("{message_id}-{index}")
                }
            });
        match kind {
            "text" => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    if !text.trim().is_empty() {
                        lines.push(assistant_content_line(
                            vec![json!({ "type": "text", "text": text, "stream_id": block_id })],
                            ts_ms,
                        ));
                    }
                }
            }
            "reasoning" => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    if !text.trim().is_empty() {
                        lines.push(assistant_content_line(
                            vec![json!({ "type": "thinking", "thinking": text, "stream_id": block_id })],
                            ts_ms,
                        ));
                    }
                }
            }
            "tool-call" => {
                let call_id = block
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&block_id)
                    .to_string();
                let name = block
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("tool");
                lines.push(assistant_content_line(
                    vec![json!({
                        "type": "tool_use",
                        "id": call_id,
                        "name": name,
                        "input": parse_tool_arguments(block.get("arguments")),
                        "status": "completed",
                    })],
                    ts_ms,
                ));
            }
            // 结果走独立的 `tool/result` 事件。
            _ => {}
        }
    }
    lines
}

fn map_tool_result(data: Option<&Value>, ts_ms: Option<i64>) -> Vec<String> {
    let Some(blocks) = data
        .and_then(|d| d.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    for block in blocks {
        if block.get("type").and_then(Value::as_str) != Some("tool-result") {
            continue;
        }
        let Some(call_id) = block
            .get("toolCallId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let output = block
            .get("content")
            .and_then(content_text)
            .unwrap_or_default();
        let is_error = block.get("isError").and_then(Value::as_bool).unwrap_or(false);
        lines.push(tool_result_line(call_id, &output, is_error, ts_ms));
    }
    lines
}

/// dsh 的 `arguments` 是 JSON 字符串；解析失败时保留原文，避免丢信息。
fn parse_tool_arguments(raw: Option<&Value>) -> Value {
    match raw {
        Some(Value::String(text)) => serde_json::from_str::<Value>(text.trim())
            .ok()
            .filter(|v| v.is_object())
            .unwrap_or_else(|| json!({ "raw": text })),
        Some(value) if value.is_object() => value.clone(),
        Some(value) => json!({ "raw": value }),
        None => json!({}),
    }
}

/// `content[]` 既可能是块数组（`{type,text}`），也可能是字符串数组。
fn content_text(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    let blocks = content.as_array()?;
    let parts: Vec<&str> = blocks
        .iter()
        .filter_map(|block| {
            block
                .get("text")
                .and_then(Value::as_str)
                .or_else(|| block.as_str())
        })
        .collect();
    (!parts.is_empty()).then(|| parts.join("\n"))
}

fn dsh_session_bind_line(session_id: &str) -> String {
    json!({ "type": "deepseek_session", "sessionId": session_id }).to_string()
}

fn user_turn_line(text: &str, ts_ms: Option<i64>) -> String {
    let mut line = json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{ "type": "text", "text": text }],
        },
    });
    if let Some(ts) = ts_ms {
        line["timestamp"] = json!(ts);
    }
    line.to_string()
}

fn tool_result_line(call_id: &str, output: &str, is_error: bool, ts_ms: Option<i64>) -> String {
    let mut line = json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": call_id,
                "content": output,
                "is_error": is_error,
            }],
        },
    });
    if let Some(ts) = ts_ms {
        line["timestamp"] = json!(ts);
    }
    line.to_string()
}

fn assistant_content_line(blocks: Vec<Value>, ts_ms: Option<i64>) -> String {
    let mut line = json!({
        "type": "assistant",
        "message": { "role": "assistant", "content": blocks },
    });
    if let Some(ts) = ts_ms {
        line["timestamp"] = json!(ts);
    }
    line.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines_of(result: Vec<String>) -> Vec<Value> {
        result
            .into_iter()
            .map(|line| serde_json::from_str::<Value>(&line).expect("json line"))
            .collect()
    }

    #[test]
    fn parses_header_and_binds_session() {
        let line = r#"{"type":"session","version":3,"id":"e069a77f-3d6c-4c7e-8c26-6cae5b4ecdf6","createdAt":1789296239341,"cwd":"/Users/sjl/Documents/github/wise-tui","isSeeded":false,"delegationDepth":0}"#;
        let header = parse_dsh_session_header(line).expect("header");
        assert_eq!(header.session_id, "e069a77f-3d6c-4c7e-8c26-6cae5b4ecdf6");
        assert_eq!(header.cwd, "/Users/sjl/Documents/github/wise-tui");
        assert_eq!(header.created_at_ms, Some(1789296239341));
        let out = lines_of(map_dsh_session_line(line));
        assert_eq!(out[0]["type"], "deepseek_session");
        assert_eq!(out[0]["sessionId"], "e069a77f-3d6c-4c7e-8c26-6cae5b4ecdf6");
    }

    #[test]
    fn keeps_only_real_user_messages() {
        let real = r#"{"type":"user/message","seq":8,"time":1789296239404,"data":{"content":[{"type":"text","text":"你好"}],"source":{"kind":"user"},"role":"user","id":"u1"},"surfaceOp":"append"}"#;
        let injected = r#"{"type":"user/message","seq":9,"time":1789296239404,"data":{"content":[{"type":"text","text":"<system-reminder>AGENTS.md</system-reminder>"}],"source":{"kind":"plugin","plugin":"@deepseek-ai/dsh-system-prompt"},"role":"user","id":"u2"}}"#;
        assert_eq!(parse_dsh_user_preview(real).as_deref(), Some("你好"));
        assert!(parse_dsh_user_preview(injected).is_none());
        let out = lines_of(map_dsh_session_line(real));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["type"], "user");
        assert_eq!(out[0]["message"]["content"][0]["text"], "你好");
        assert!(map_dsh_session_line(injected).is_empty());
    }

    #[test]
    fn maps_assistant_message_blocks() {
        let line = r#"{"type":"assistant/message","seq":15,"time":1789296241487,"data":{"turn":1,"step":1,"message":{"role":"assistant","id":"m1","content":[{"type":"reasoning","text":"用户只是打招呼"},{"type":"text","text":"你好！有什么可以帮你的吗？"},{"type":"tool-call","id":"call_00_1","name":"bash","arguments":"{\"command\":\"ls -la\"}"}]}}}"#;
        let out = lines_of(map_dsh_session_line(line));
        assert_eq!(out.len(), 3);
        assert_eq!(out[0]["message"]["content"][0]["type"], "thinking");
        assert_eq!(out[0]["message"]["content"][0]["thinking"], "用户只是打招呼");
        assert_eq!(out[1]["message"]["content"][0]["type"], "text");
        assert_eq!(out[2]["message"]["content"][0]["type"], "tool_use");
        assert_eq!(out[2]["message"]["content"][0]["name"], "bash");
        assert_eq!(out[2]["message"]["content"][0]["input"]["command"], "ls -la");
        assert_eq!(out[2]["timestamp"], 1789296241487i64);
    }

    #[test]
    fn maps_tool_result_to_claude_tool_result_line() {
        let line = r#"{"type":"tool/result","seq":16,"time":1789296242000,"data":{"turn":1,"step":1,"message":{"source":{"kind":"tool","callId":"call_00_1"},"content":[{"type":"tool-result","toolCallId":"call_00_1","content":[{"type":"text","text":"total 0"}],"isError":false}]}}}"#;
        let out = lines_of(map_dsh_session_line(line));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["type"], "user");
        let block = &out[0]["message"]["content"][0];
        assert_eq!(block["type"], "tool_result");
        assert_eq!(block["tool_use_id"], "call_00_1");
        assert_eq!(block["content"], "total 0");
    }

    #[test]
    fn skips_streaming_chunks_and_system_events() {
        for line in [
            r#"{"type":"assistant/chunk","seq":12,"time":1,"data":{"chunk":"你"}}"#,
            r#"{"type":"text-chunks","seq":13,"time":1,"data":{"texts":["你"]}}"#,
            r#"{"type":"reasoning-chunks","seq":13,"time":1,"data":{"texts":["嗯"]}}"#,
            r#"{"type":"system/message","seq":7,"time":1,"data":{"message":{"role":"system","content":[]}}}"#,
            r#"{"type":"turn/end","seq":17,"time":1,"data":{"turn":1}}"#,
        ] {
            assert!(map_dsh_session_line(line).is_empty(), "{line}");
        }
    }

    #[test]
    fn reads_title_row() {
        let line = r#"{"type":"session/title","seq":14,"time":1,"data":{"title":"你好","messageSeqs":[8],"source":{"kind":"fallback"}}}"#;
        assert_eq!(parse_dsh_session_title(line).as_deref(), Some("你好"));
    }
}
