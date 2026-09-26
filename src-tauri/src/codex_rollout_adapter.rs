//! 把 Codex 原生 rollout JSONL 映射为 Wise 前端已支持的流式行。
//!
//! `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl` 由 Codex CLI / app-server
//! 自己写入，是「原生 Codex 会话」的权威转录。它的 `event_msg.item_completed`
//! 与 app-server 的 `item/completed` 通知同源，但字段形状不同：
//!
//! - item 类型名是 PascalCase（`AgentMessage` / `CommandExecution` / …）；
//! - `AgentMessage.content[]` 是块数组而不是 `text` 字符串；
//! - `CommandExecution.command` 是 argv 数组，`cwd` 是 `file://` URL；
//! - `FileChange.changes` 是 `path -> change` 映射而不是数组。
//!
//! 这里只做「归一化成 app-server 语义」，随后复用
//! [`codex_rpc_stream_adapter::map_item_completed`] 生成 `assistant` / `tool_use` /
//! `thinking` 行，前端无需为原生会话新增解析分支。

use serde_json::{json, Value};

use crate::codex_rpc_stream_adapter::map_item_completed;
use crate::codex_rpc_types::ThreadItem;

/// rollout 首行 `session_meta` 里我们关心的字段。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct CodexRolloutMeta {
    pub session_id: String,
    pub cwd: String,
    pub timestamp: Option<String>,
    /// `exec`（`codex exec` 一次性运行）/ `cli` / `vscode`。
    pub source: Option<String>,
    pub originator: Option<String>,
}

pub(crate) fn rfc3339_to_ms(ts: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(ts.trim())
        .ok()
        .map(|dt| dt.timestamp_millis())
}

/// 解析 rollout 行（任意行）中的 `session_meta`；非 session_meta 返回 `None`。
pub(crate) fn parse_codex_rollout_meta(raw_line: &str) -> Option<CodexRolloutMeta> {
    let line = raw_line.trim();
    if line.is_empty() || !line.contains("session_meta") {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    let payload = value.get("payload")?;
    let session_id = payload
        .get("session_id")
        .or_else(|| payload.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    let cwd = payload
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    Some(CodexRolloutMeta {
        session_id,
        cwd,
        timestamp: payload
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_string),
        source: payload.get("source").and_then(Value::as_str).map(str::to_string),
        originator: payload
            .get("originator")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// 从 `turn_context` 行取模型名（列表页 modelHint 用）。
pub(crate) fn parse_codex_rollout_model(raw_line: &str) -> Option<String> {
    let line = raw_line.trim();
    if !line.contains("turn_context") {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("turn_context") {
        return None;
    }
    value
        .get("payload")
        .and_then(|p| p.get("model"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// `item_completed` 里的 `UserMessage` 正文（真实用户输入；注入上下文不会走这里）。
pub(crate) fn parse_codex_rollout_user_preview(raw_line: &str) -> Option<String> {
    let line = raw_line.trim();
    if !line.contains("UserMessage") {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;
    let payload = value.get("payload")?;
    if payload.get("type").and_then(Value::as_str) != Some("item_completed") {
        return None;
    }
    let item = payload.get("item")?;
    if item.get("type").and_then(Value::as_str) != Some("UserMessage") {
        return None;
    }
    let text = item_text_from_content(item)?;
    let compact = text.lines().find(|l| !l.trim().is_empty())?.trim().to_string();
    Some(compact)
}

/// 单行 rollout → 0..n 条 Wise 流式行（已带该行时间戳）。
pub(crate) fn map_codex_rollout_line(raw_line: &str) -> Vec<String> {
    let line = raw_line.trim();
    if line.is_empty() || !line.starts_with('{') {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    let ts_ms = value
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(rfc3339_to_ms);

    if value.get("type").and_then(Value::as_str) == Some("session_meta") {
        return parse_codex_rollout_meta(line)
            .map(|meta| vec![codex_session_bind_line(&meta.session_id)])
            .unwrap_or_default();
    }

    if value.get("type").and_then(Value::as_str) != Some("event_msg") {
        return Vec::new();
    }
    let Some(payload) = value.get("payload") else {
        return Vec::new();
    };
    let lines = match payload.get("type").and_then(Value::as_str) {
        // `map_item_completed` 会给助手 / 工具行盖上「当前时间」；
        // rollout 是历史日志，必须用该行自己的时间戳覆盖，否则 hydrate 后全部变成「刚刚」。
        Some("item_completed") => match payload.get("item") {
            Some(item) => map_rollout_item(item)
                .into_iter()
                .map(|line| with_timestamp(line, ts_ms))
                .collect(),
            None => Vec::new(),
        },
        // 旧版 Codex 直接把文本放在 event_msg 上；有 item_completed 时不会触发。
        Some("user_message") => payload_text(payload)
            .map(|text| vec![user_turn_line(&text, ts_ms)])
            .unwrap_or_default(),
        Some("agent_message") => payload_text(payload)
            .map(|text| vec![assistant_line("agentMessage", "text", &text, ts_ms)])
            .unwrap_or_default(),
        Some("agent_reasoning") => payload_text(payload)
            .map(|text| vec![assistant_line("reasoning", "text", &text, ts_ms)])
            .unwrap_or_default(),
        Some("error") => payload_text(payload)
            .map(|text| vec![assistant_line("error", "text", &text, ts_ms)])
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    lines
}

fn map_rollout_item(item: &Value) -> Vec<String> {
    let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
    let id = item.get("id").and_then(Value::as_str).unwrap_or("");
    let (rpc_type, raw) = match item_type {
        "UserMessage" => {
            return item_text_from_content(item)
                .map(|text| vec![user_turn_line(&text, None)])
                .unwrap_or_default()
        }
        // 图片像素由 CLI 自己消费，列表与消息区都不展示。
        "ImageView" => return Vec::new(),
        "AgentMessage" => (
            "agentMessage",
            json!({ "text": item_text_from_content(item).unwrap_or_default() }),
        ),
        "Reasoning" => (
            "reasoning",
            json!({
                "content": item.get("raw_content").cloned().unwrap_or(Value::Null),
                "summary": item.get("summary_text").cloned().unwrap_or(Value::Null),
            }),
        ),
        "Plan" => ("plan", json!({ "text": plan_text(item) })),
        "CommandExecution" => ("commandExecution", normalize_command_execution(item)),
        "FileChange" => ("fileChange", normalize_file_change(item)),
        "McpToolCall" => ("mcpToolCall", item.clone()),
        "WebSearch" => ("webSearch", item.clone()),
        "DynamicToolCall" => ("dynamicToolCall", item.clone()),
        "CollabAgentToolCall" => ("collabAgentToolCall", item.clone()),
        "Error" | "StreamError" => (
            "error",
            json!({ "text": item_text_from_content(item).unwrap_or_default() }),
        ),
        _ => return Vec::new(),
    };
    if id.is_empty() {
        return Vec::new();
    }
    map_item_completed(&ThreadItem {
        id: id.to_string(),
        item_type: rpc_type.to_string(),
        raw,
    })
}

/// 迭代 item 的 `content[]` 文本块（rollout 里块类型是 `Text` / `input_text`）。
fn item_text_from_content(item: &Value) -> Option<String> {
    if let Some(text) = item.get("text").and_then(Value::as_str) {
        if !text.trim().is_empty() {
            return Some(text.to_string());
        }
    }
    if let Some(text) = item.get("message").and_then(Value::as_str) {
        if !text.trim().is_empty() {
            return Some(text.to_string());
        }
    }
    let content = item.get("content")?;
    if let Some(text) = content.as_str() {
        return (!text.trim().is_empty()).then(|| text.to_string());
    }
    let blocks = content.as_array()?;
    let parts: Vec<&str> = blocks
        .iter()
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn payload_text(payload: &Value) -> Option<String> {
    payload
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| payload.get("text").and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn plan_text(item: &Value) -> String {
    if let Some(steps) = item.get("plan").and_then(Value::as_array) {
        let rendered: Vec<String> = steps
            .iter()
            .filter_map(|step| {
                let text = step
                    .get("step")
                    .and_then(Value::as_str)
                    .or_else(|| step.get("text").and_then(Value::as_str))?;
                let status = step.get("status").and_then(Value::as_str).unwrap_or("");
                Some(if status.is_empty() {
                    text.to_string()
                } else {
                    format!("[{status}] {text}")
                })
            })
            .collect();
        if !rendered.is_empty() {
            return rendered.join("\n");
        }
    }
    item_text_from_content(item).unwrap_or_default()
}

fn normalize_command_execution(item: &Value) -> Value {
    let command = command_argv_text(item.get("command"));
    let cwd = strip_file_url(
        item.get("cwd")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or(""),
    );
    let status = item
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("completed");
    let output = item
        .get("aggregated_output")
        .and_then(Value::as_str)
        .or_else(|| item.get("stdout").and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    // 失败详情常只在 stderr；Claude 的 Bash 卡片把 output 与 error 分开渲染。
    let stderr = item
        .get("stderr")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    json!({
        "command": command,
        "cwd": cwd,
        "status": status,
        "output": output,
        "stderr": stderr,
        "exitCode": item.get("exit_code").cloned().unwrap_or(Value::Null),
    })
}

/// `["/bin/zsh","-lc","<script>"]` → `<script>`；普通 argv → 空格拼接。
fn command_argv_text(raw: Option<&Value>) -> String {
    let Some(raw) = raw else {
        return String::new();
    };
    if let Some(text) = raw.as_str() {
        return text.to_string();
    }
    let Some(argv) = raw.as_array() else {
        return String::new();
    };
    let parts: Vec<&str> = argv.iter().filter_map(Value::as_str).collect();
    if parts.len() >= 3 && (parts[1] == "-lc" || parts[1] == "-c") {
        return parts[2..].join(" ");
    }
    parts.join(" ")
}

fn strip_file_url(raw: &str) -> String {
    let trimmed = raw.trim();
    let without_scheme = trimmed
        .strip_prefix("file://")
        .or_else(|| trimmed.strip_prefix("file:"))
        .unwrap_or(trimmed);
    if without_scheme == trimmed {
        return trimmed.to_string();
    }
    percent_decode(without_scheme)
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| raw.to_string())
}

/// rollout 的 `changes` 是 `path -> {type, unified_diff|content}`；
/// app-server 的 `changes` 是数组，前端 `apply_patch` 卡片只认数组形态。
fn normalize_file_change(item: &Value) -> Value {
    let mut changes: Vec<Value> = Vec::new();
    match item.get("changes") {
        Some(Value::Object(map)) => {
            for (path, change) in map {
                let kind = change.get("type").and_then(Value::as_str).unwrap_or("update");
                let patch = change
                    .get("unified_diff")
                    .and_then(Value::as_str)
                    .or_else(|| change.get("diff").and_then(Value::as_str))
                    .or_else(|| change.get("content").and_then(Value::as_str))
                    .unwrap_or("");
                changes.push(json!({
                    "path": path,
                    "kind": { "type": kind },
                    "diff": patch,
                    "move_path": change.get("move_path").cloned().unwrap_or(Value::Null),
                }));
            }
        }
        Some(Value::Array(list)) => changes = list.clone(),
        _ => {}
    }
    json!({
        "status": item.get("status").cloned().unwrap_or(json!("completed")),
        "changes": changes,
    })
}

fn codex_session_bind_line(session_id: &str) -> String {
    json!({ "type": "codex_session", "sessionId": session_id }).to_string()
}

/// 与 `cursor_disk::build_cursor_user_turn_line` 同形，但保留历史时间戳。
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

/// 借助 RPC 适配器渲染单个 item（并补上 rollout 行的时间戳）。
fn assistant_line(rpc_type: &str, field: &str, text: &str, ts_ms: Option<i64>) -> String {
    let lines = map_item_completed(&ThreadItem {
        id: format!("rollout-{rpc_type}"),
        item_type: rpc_type.to_string(),
        raw: json!({ field: text }),
    });
    with_timestamp(lines.into_iter().next().unwrap_or_default(), ts_ms)
}

fn with_timestamp(line: String, ts_ms: Option<i64>) -> String {
    let Some(ts) = ts_ms else {
        return line;
    };
    if line.is_empty() {
        return line;
    }
    let Ok(mut value) = serde_json::from_str::<Value>(&line) else {
        return line;
    };
    if let Some(obj) = value.as_object_mut() {
        obj.insert("timestamp".to_string(), json!(ts));
    }
    value.to_string()
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
    fn parses_session_meta_and_binds_session() {
        let line = r#"{"timestamp":"2026-09-25T23:41:23.511Z","ordinal":0,"type":"session_meta","payload":{"session_id":"01a0daf1-ee64-7910-9a93-feea5e003c94","id":"01a0daf1-ee64-7910-9a93-feea5e003c94","timestamp":"2026-09-25T23:41:23.501Z","cwd":"/Users/sjl/Documents/github/wise-tui","originator":"wise-tui","source":"vscode"}}"#;
        let meta = parse_codex_rollout_meta(line).expect("meta");
        assert_eq!(meta.session_id, "01a0daf1-ee64-7910-9a93-feea5e003c94");
        assert_eq!(meta.cwd, "/Users/sjl/Documents/github/wise-tui");
        assert_eq!(meta.source.as_deref(), Some("vscode"));
        let out = lines_of(map_codex_rollout_line(line));
        assert_eq!(out[0]["type"], "codex_session");
        assert_eq!(out[0]["sessionId"], "01a0daf1-ee64-7910-9a93-feea5e003c94");
    }

    #[test]
    fn maps_user_message_item_to_user_turn() {
        let line = r#"{"timestamp":"2026-09-25T23:41:23.520Z","ordinal":6,"type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage","id":"01a0daf1-eec0","content":[{"type":"text","text":"可以设置会话的展示语言吗","text_elements":[]}]}}}"#;
        assert_eq!(
            parse_codex_rollout_user_preview(line).as_deref(),
            Some("可以设置会话的展示语言吗")
        );
        let out = lines_of(map_codex_rollout_line(line));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["type"], "user");
        assert_eq!(out[0]["message"]["content"][0]["text"], "可以设置会话的展示语言吗");
        // 历史时间戳必须保留，否则 hydrate 后所有消息都变成「刚刚」。
        assert!(out[0]["timestamp"].as_i64().unwrap() > 1_700_000_000_000);
    }

    #[test]
    fn ignores_injected_developer_message_response_items() {
        let line = r#"{"timestamp":"2026-09-25T23:41:23.511Z","ordinal":2,"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"You are a coding agent"}]}}"#;
        assert!(map_codex_rollout_line(line).is_empty());
        assert!(parse_codex_rollout_user_preview(line).is_none());
    }

    #[test]
    fn maps_agent_message_content_blocks() {
        let line = r#"{"timestamp":"2026-09-25T23:41:30.000Z","ordinal":7,"type":"event_msg","payload":{"type":"item_completed","item":{"type":"AgentMessage","id":"item-2","content":[{"type":"Text","text":"你好，我来帮你。"}],"phase":"final_answer"}}}"#;
        let out = lines_of(map_codex_rollout_line(line));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["type"], "assistant");
        assert_eq!(out[0]["message"]["content"][0]["type"], "text");
        assert_eq!(out[0]["message"]["content"][0]["text"], "你好，我来帮你。");
    }

    #[test]
    fn maps_reasoning_raw_content() {
        let line = r#"{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"Reasoning","id":"rs_1","summary_text":[],"raw_content":["先看目录结构"]}}}"#;
        let out = lines_of(map_codex_rollout_line(line));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["message"]["content"][0]["type"], "thinking");
        assert_eq!(out[0]["message"]["content"][0]["thinking"], "先看目录结构");
    }

    #[test]
    fn normalizes_command_execution_argv_and_file_url_cwd() {
        let line = r#"{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"CommandExecution","id":"call_1","command":["/bin/zsh","-lc","ls -la"],"cwd":"file:///Users/sjl/Documents/github/wise-tui","status":"completed","aggregated_output":"total 0\n","exit_code":0}}}"#;
        let out = lines_of(map_codex_rollout_line(line));
        assert_eq!(out.len(), 1);
        let block = &out[0]["message"]["content"][0];
        assert_eq!(block["type"], "tool_use");
        assert_eq!(block["name"], "Bash");
        assert_eq!(block["input"]["command"], "ls -la");
        assert_eq!(block["input"]["cwd"], "/Users/sjl/Documents/github/wise-tui");
        assert_eq!(block["output"], "total 0");
    }

    #[test]
    fn normalizes_file_change_map_into_patch_cards() {
        let line = r#"{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"FileChange","id":"exec-1","status":"completed","changes":{"/repo/a.ts":{"type":"update","unified_diff":"@@ -1,1 +1,1 @@\n-old\n+new","move_path":null},"/repo/b.ts":{"type":"add","content":"export const b = 1;\n"}}}}}"#;
        let out = lines_of(map_codex_rollout_line(line));
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["message"]["content"][0]["name"], "apply_patch");
        assert_eq!(out[0]["message"]["content"][0]["input"]["file_path"], "/repo/a.ts");
        assert_eq!(out[0]["message"]["content"][0]["input"]["patch"], "@@ -1,1 +1,1 @@\n-old\n+new");
        assert_eq!(out[0]["message"]["content"][0]["input"]["kind"]["type"], "update");
        assert_eq!(out[1]["message"]["content"][0]["input"]["kind"]["type"], "add");
    }

    #[test]
    fn skips_image_view_and_token_events() {
        let image = r#"{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"ImageView","id":"call_0","path":"file:///tmp/a.png"}}}"#;
        assert!(map_codex_rollout_line(image).is_empty());
        let tokens = r#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1}}}}"#;
        assert!(map_codex_rollout_line(tokens).is_empty());
    }

    #[test]
    fn reads_turn_context_model_hint() {
        let line = r#"{"type":"turn_context","payload":{"turn_id":"t1","cwd":"/repo","model":"gpt-6-astra"}}"#;
        assert_eq!(parse_codex_rollout_model(line).as_deref(), Some("gpt-6-astra"));
    }
}
