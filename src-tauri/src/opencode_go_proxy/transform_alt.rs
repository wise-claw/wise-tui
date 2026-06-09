//! OpenAI Responses API 与 Google Gemini 格式转换（Zen 路径）。

use serde_json::{json, Value};


pub fn anthropic_to_responses(anthropic: &Value, upstream_model: &str) -> Result<Value, String> {
    let obj = anthropic
        .as_object()
        .ok_or_else(|| "请求体必须是 JSON 对象".to_string())?;

    let mut input: Vec<Value> = Vec::new();

    if let Some(system) = obj.get("system") {
        let text = system_text(system);
        if !text.is_empty() {
            input.push(json!({
                "role": "developer",
                "content": text,
            }));
        }
    }

    let messages = obj
        .get("messages")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "缺少 messages 字段".to_string())?;

    for msg in messages {
        append_responses_message(msg, &mut input)?;
    }

    let stream = obj.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);
    let mut req = json!({
        "model": upstream_model,
        "input": input,
        "stream": stream,
    });

    if let Some(tools) = obj.get("tools").and_then(|v| v.as_array()) {
        if !tools.is_empty() {
            req["tools"] = json!(tools
                .iter()
                .filter_map(|t| {
                    let name = t.get("name")?.as_str()?;
                    let desc = t.get("description").and_then(|v| v.as_str()).unwrap_or("");
                    let schema = t
                        .get("input_schema")
                        .cloned()
                        .unwrap_or(json!({"type":"object","properties":{}}));
                    Some(json!({
                        "type": "function",
                        "name": name,
                        "description": desc,
                        "parameters": schema,
                    }))
                })
                .collect::<Vec<_>>());
        }
    }

    Ok(req)
}

pub fn responses_to_anthropic(responses: &Value, original_model: &str) -> Result<Value, String> {
    let outputs = responses
        .get("output")
        .and_then(|v| v.as_array())
        .filter(|a| !a.is_empty())
        .ok_or_else(|| "上游 Responses 缺少 output".to_string())?;

    let mut blocks: Vec<Value> = Vec::new();
    let mut stop = "end_turn";

    for output in outputs {
        let ty = output.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match ty {
            "message" => {
                if let Some(content) = output.get("content").and_then(|v| v.as_array()) {
                    for c in content {
                        if c.get("type").and_then(|t| t.as_str()) == Some("output_text") {
                            if let Some(text) = c.get("text").and_then(|v| v.as_str()) {
                                if !text.is_empty() {
                                    blocks.push(json!({ "type": "text", "text": text }));
                                }
                            }
                        }
                    }
                }
            }
            "function_call" => {
                stop = "tool_use";
                let id = output
                    .get("call_id")
                    .or_else(|| output.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let name = output.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = output.get("arguments").and_then(|v| v.as_str()).unwrap_or("{}");
                let input: Value = serde_json::from_str(args).unwrap_or(json!({}));
                blocks.push(json!({
                    "type": "tool_use",
                    "id": id,
                    "name": name,
                    "input": input,
                }));
            }
            _ => {}
        }
    }

    if blocks.is_empty() {
        blocks.push(json!({ "type": "text", "text": "" }));
    }

    let usage = responses
        .get("usage")
        .map(super::usage::responses_usage_to_anthropic)
        .unwrap_or_else(super::usage::zero_usage);

    let id = responses
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("resp_wise_proxy");

    Ok(json!({
        "id": id,
        "type": "message",
        "role": "assistant",
        "model": original_model,
        "content": blocks,
        "stop_reason": stop,
        "stop_sequence": null,
        "usage": usage
    }))
}

pub fn anthropic_to_gemini(anthropic: &Value, _upstream_model: &str) -> Result<Value, String> {
    let obj = anthropic
        .as_object()
        .ok_or_else(|| "请求体必须是 JSON 对象".to_string())?;

    let mut contents: Vec<Value> = Vec::new();

    if let Some(system) = obj.get("system") {
        let text = system_text(system);
        if !text.is_empty() {
            contents.push(json!({
                "role": "user",
                "parts": [{ "text": format!("[System Instruction] {text}") }],
            }));
            contents.push(json!({
                "role": "model",
                "parts": [{ "text": "Understood. I will follow these instructions." }],
            }));
        }
    }

    let messages = obj
        .get("messages")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "缺少 messages 字段".to_string())?;

    for msg in messages {
        append_gemini_message(msg, &mut contents)?;
    }

    let stream = obj.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);
    let mut req = json!({
        "contents": contents,
        "stream": stream,
    });

    let mut gen_config = serde_json::Map::new();
    if let Some(max) = obj.get("max_tokens").and_then(|v| v.as_u64()) {
        gen_config.insert("maxOutputTokens".to_string(), json!(max));
    }
    if let Some(temp) = obj.get("temperature").and_then(|v| v.as_f64()) {
        gen_config.insert("temperature".to_string(), json!(temp));
    }
    if !gen_config.is_empty() {
        req["generationConfig"] = Value::Object(gen_config);
    }

    if let Some(tools) = obj.get("tools").and_then(|v| v.as_array()) {
        if !tools.is_empty() {
            let decls: Vec<Value> = tools
                .iter()
                .filter_map(|t| {
                    let name = t.get("name")?.as_str()?;
                    let desc = t.get("description").and_then(|v| v.as_str()).unwrap_or("");
                    let schema = t
                        .get("input_schema")
                        .cloned()
                        .unwrap_or(json!({"type":"object","properties":{}}));
                    Some(json!({
                        "name": name,
                        "description": desc,
                        "parameters": schema,
                    }))
                })
                .collect();
            if !decls.is_empty() {
                req["tools"] = json!([{ "functionDeclarations": decls }]);
            }
        }
    }

    Ok(req)
}

pub fn gemini_to_anthropic(gemini: &Value, original_model: &str) -> Result<Value, String> {
    let candidates = gemini
        .get("candidates")
        .and_then(|v| v.as_array())
        .filter(|a| !a.is_empty())
        .ok_or_else(|| "上游 Gemini 缺少 candidates".to_string())?;

    let candidate = &candidates[0];
    let mut blocks: Vec<Value> = Vec::new();
    let mut stop = "end_turn";

    if let Some(parts) = candidate
        .get("content")
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
    {
        for part in parts {
            if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                if !text.is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
            }
            if let Some(fc) = part.get("functionCall") {
                stop = "tool_use";
                let name = fc.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let input = fc.get("args").cloned().unwrap_or(json!({}));
                blocks.push(json!({
                    "type": "tool_use",
                    "id": format!("toolu_{}", uuid_simple()),
                    "name": name,
                    "input": input,
                }));
            }
        }
    }

    if blocks.is_empty() {
        blocks.push(json!({ "type": "text", "text": "" }));
    }

    if stop == "end_turn" {
        stop = match candidate.get("finishReason").and_then(|v| v.as_str()) {
            Some("MAX_TOKENS") => "max_tokens",
            _ => "end_turn",
        };
    }

    let usage = gemini
        .get("usageMetadata")
        .map(super::usage::gemini_usage_to_anthropic)
        .unwrap_or_else(super::usage::zero_usage);

    Ok(json!({
        "id": format!("gemini_{}", uuid_simple()),
        "type": "message",
        "role": "assistant",
        "model": original_model,
        "content": blocks,
        "stop_reason": stop,
        "stop_sequence": null,
        "usage": usage
    }))
}

fn uuid_simple() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

fn system_text(system: &Value) -> String {
    if let Some(s) = system.as_str() {
        return s.to_string();
    }
    if let Some(arr) = system.as_array() {
        return arr
            .iter()
            .filter_map(|b| {
                if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                    b.get("text").and_then(|v| v.as_str())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}

fn append_responses_message(msg: &Value, input: &mut Vec<Value>) -> Result<(), String> {
    let role = msg
        .get("role")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "message 缺少 role".to_string())?;

    if let Some(text) = msg.get("content").and_then(|c| c.as_str()) {
        if !text.is_empty() {
            input.push(json!({ "role": role, "content": text }));
        }
        return Ok(());
    }

    let Some(blocks) = msg.get("content").and_then(|c| c.as_array()) else {
        return Ok(());
    };

    let mut text_parts: Vec<String> = Vec::new();
    for block in blocks {
        let ty = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match ty {
            "text" => {
                if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                    text_parts.push(t.to_string());
                }
            }
            "tool_result" => {
                let content = tool_result_text(block);
                input.push(json!({
                    "role": "tool",
                    "content": content,
                }));
            }
            "tool_use" if role == "assistant" => {
                if !text_parts.is_empty() {
                    input.push(json!({
                        "role": "assistant",
                        "content": text_parts.join(""),
                    }));
                    text_parts.clear();
                }
                let args = block.get("input").cloned().unwrap_or(json!({}));
                input.push(json!({
                    "type": "function_call",
                    "call_id": block.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                    "name": block.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                    "arguments": serde_json::to_string(&args).unwrap_or_else(|_| "{}".to_string()),
                }));
            }
            _ => {}
        }
    }

    if !text_parts.is_empty() {
        input.push(json!({
            "role": role,
            "content": text_parts.join(""),
        }));
    }
    Ok(())
}

fn append_gemini_message(msg: &Value, contents: &mut Vec<Value>) -> Result<(), String> {
    let role = msg
        .get("role")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "message 缺少 role".to_string())?;

    if let Some(text) = msg.get("content").and_then(|c| c.as_str()) {
        if !text.is_empty() {
            let gemini_role = if role == "assistant" { "model" } else { "user" };
            contents.push(json!({
                "role": gemini_role,
                "parts": [{ "text": text }],
            }));
        }
        return Ok(());
    }

    let Some(blocks) = msg.get("content").and_then(|c| c.as_array()) else {
        return Ok(());
    };

    let mut text_parts: Vec<String> = Vec::new();
    for block in blocks {
        let ty = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match ty {
            "text" => {
                if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                    text_parts.push(t.to_string());
                }
            }
            "tool_result" => {
                let tool_id = block.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or("");
                let content = tool_result_text(block);
                contents.push(json!({
                    "role": "user",
                    "parts": [{ "text": format!("[Tool Result for {tool_id}] {content}") }],
                }));
            }
            _ => {}
        }
    }

    if !text_parts.is_empty() {
        let gemini_role = if role == "assistant" { "model" } else { "user" };
        contents.push(json!({
            "role": gemini_role,
            "parts": [{ "text": text_parts.join("") }],
        }));
    }
    Ok(())
}

fn tool_result_text(block: &Value) -> String {
    if let Some(s) = block.get("content").and_then(|v| v.as_str()) {
        return s.to_string();
    }
    if let Some(arr) = block.get("content").and_then(|v| v.as_array()) {
        return arr
            .iter()
            .filter_map(|i| i.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responses_roundtrip_text() {
        let req = json!({
            "model": "claude-sonnet-4",
            "messages": [{ "role": "user", "content": "hi" }],
        });
        let upstream = anthropic_to_responses(&req, "gpt-5.4").unwrap();
        assert_eq!(upstream["model"], "gpt-5.4");

        let resp = json!({
            "id": "resp_1",
            "output": [{
                "type": "message",
                "content": [{ "type": "output_text", "text": "hello" }]
            }],
            "usage": { "input_tokens": 3, "output_tokens": 2 }
        });
        let out = responses_to_anthropic(&resp, "claude-sonnet-4").unwrap();
        assert_eq!(out["content"][0]["text"], "hello");
    }
}
