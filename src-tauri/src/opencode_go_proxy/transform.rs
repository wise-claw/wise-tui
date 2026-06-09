//! Anthropic Messages API ↔ OpenAI Chat Completions 格式转换（OpenCode Go 路径）。

use serde_json::{json, Map, Value};

/// 将 Anthropic `/v1/messages` 请求体转为 OpenAI Chat Completions 请求。
pub fn anthropic_to_openai(anthropic: &Value, upstream_model: &str) -> Result<Value, String> {
    let obj = anthropic
        .as_object()
        .ok_or_else(|| "请求体必须是 JSON 对象".to_string())?;

    let mut messages: Vec<Value> = Vec::new();

    if let Some(system) = obj.get("system") {
        if let Some(text) = system_text(system) {
            if !text.is_empty() {
                messages.push(json!({ "role": "system", "content": text }));
            }
        }
    }

    let raw_messages = obj
        .get("messages")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "缺少 messages 字段".to_string())?;

    for msg in raw_messages {
        transform_message(msg, &mut messages)?;
    }

    let stream = obj.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);

    let mut openai = json!({
        "model": upstream_model,
        "messages": messages,
        "stream": stream,
    });

    if stream {
        openai["stream_options"] = json!({ "include_usage": true });
    }

    if let Some(max_tokens) = obj.get("max_tokens").and_then(|v| v.as_u64()) {
        openai["max_tokens"] = json!(max_tokens);
    }
    if let Some(temp) = obj.get("temperature").and_then(|v| v.as_f64()) {
        openai["temperature"] = json!(temp);
    }
    if let Some(top_p) = obj.get("top_p").and_then(|v| v.as_f64()) {
        openai["top_p"] = json!(top_p);
    }

    if let Some(tools) = obj.get("tools").and_then(|v| v.as_array()) {
        if !tools.is_empty() {
            openai["tools"] = json!(transform_tools(tools));
        }
    }

    Ok(openai)
}

/// OpenAI Chat Completions 非流式响应 → Anthropic Message。
pub fn openai_to_anthropic(openai: &Value, original_model: &str) -> Result<Value, String> {
    let choices = openai
        .get("choices")
        .and_then(|v| v.as_array())
        .filter(|a| !a.is_empty())
        .ok_or_else(|| "上游响应缺少 choices".to_string())?;

    let choice = &choices[0];
    let message = choice.get("message").ok_or_else(|| "缺少 message".to_string())?;
    let finish = choice
        .get("finish_reason")
        .and_then(|v| v.as_str())
        .unwrap_or("stop");

    let mut blocks = message_to_content_blocks(message);

    if blocks.is_empty() {
        blocks.push(json!({ "type": "text", "text": "" }));
    }

    let usage = openai
        .get("usage")
        .map(super::usage::openai_usage_to_anthropic)
        .unwrap_or_else(super::usage::zero_usage);

    let id = openai
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("msg_wise_proxy");

    Ok(json!({
        "id": id,
        "type": "message",
        "role": "assistant",
        "model": original_model,
        "content": blocks,
        "stop_reason": map_finish_reason(finish),
        "stop_sequence": null,
        "usage": usage
    }))
}

pub fn anthropic_error(status: u16, message: &str) -> Value {
    let err_type = match status {
        400 => "invalid_request_error",
        401 => "authentication_error",
        403 => "permission_error",
        404 => "not_found_error",
        429 => "rate_limit_error",
        _ if status >= 500 => "api_error",
        _ => "api_error",
    };
    json!({
        "type": "error",
        "error": {
            "type": err_type,
            "message": message,
        }
    })
}

fn map_finish_reason(reason: &str) -> &'static str {
    match reason {
        "length" => "max_tokens",
        "tool_calls" | "tool_use" => "tool_use",
        _ => "end_turn",
    }
}

fn system_text(system: &Value) -> Option<String> {
    if let Some(s) = system.as_str() {
        return Some(s.to_string());
    }
    if let Some(arr) = system.as_array() {
        let mut parts = Vec::new();
        for block in arr {
            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                    parts.push(t);
                }
            }
        }
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    None
}

fn transform_message(msg: &Value, out: &mut Vec<Value>) -> Result<(), String> {
    let role = msg
        .get("role")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "message 缺少 role".to_string())?;
    let content = msg.get("content");

    if role == "user" || role == "assistant" {
        if let Some(text) = content.and_then(|c| c.as_str()) {
            if !text.is_empty() {
                out.push(json!({ "role": role, "content": text }));
            }
            return Ok(());
        }
        if let Some(blocks) = content.and_then(|c| c.as_array()) {
            return transform_role_blocks(role, blocks, out);
        }
    }

    if let Some(text) = content.and_then(|c| c.as_str()) {
        out.push(json!({ "role": role, "content": text }));
    }
    Ok(())
}

fn transform_role_blocks(role: &str, blocks: &[Value], out: &mut Vec<Value>) -> Result<(), String> {
    if role == "user" {
        let mut tool_results: Vec<Value> = Vec::new();
        let mut other: Vec<Value> = Vec::new();
        for block in blocks {
            let ty = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if ty == "tool_result" {
                tool_results.push(block.clone());
            } else {
                other.push(block.clone());
            }
        }
        if !other.is_empty() {
            out.push(json!({
                "role": "user",
                "content": blocks_to_openai_content(&other),
            }));
        }
        for tr in tool_results {
            let tool_id = tr
                .get("tool_use_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let content = tool_result_text(&tr);
            out.push(json!({
                "role": "tool",
                "tool_call_id": tool_id,
                "content": content,
            }));
        }
        return Ok(());
    }

    if role == "assistant" {
        let mut text_parts: Vec<String> = Vec::new();
        let mut tool_calls: Vec<Value> = Vec::new();
        let mut reasoning: Option<String> = None;

        for block in blocks {
            let ty = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match ty {
                "text" => {
                    if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                        text_parts.push(t.to_string());
                    }
                }
                "thinking" => {
                    if let Some(t) = block.get("thinking").and_then(|v| v.as_str()) {
                        reasoning = Some(t.to_string());
                    }
                }
                "tool_use" => {
                    let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let input = block.get("input").cloned().unwrap_or(json!({}));
                    let args = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
                    tool_calls.push(json!({
                        "id": id,
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": args,
                        }
                    }));
                }
                _ => {}
            }
        }

        let mut msg = Map::new();
        msg.insert("role".to_string(), json!("assistant"));
        if !text_parts.is_empty() {
            msg.insert("content".to_string(), json!(text_parts.join("")));
        } else if tool_calls.is_empty() {
            msg.insert("content".to_string(), json!(null));
        }
        if let Some(r) = reasoning {
            msg.insert("reasoning_content".to_string(), json!(r));
        }
        if !tool_calls.is_empty() {
            msg.insert("tool_calls".to_string(), json!(tool_calls));
        }
        out.push(Value::Object(msg));
        return Ok(());
    }

    out.push(json!({
        "role": role,
        "content": blocks_to_openai_content(blocks),
    }));
    Ok(())
}

fn blocks_to_openai_content(blocks: &[Value]) -> Value {
    let mut parts: Vec<Value> = Vec::new();
    for block in blocks {
        let ty = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match ty {
            "text" => {
                if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                    parts.push(json!({ "type": "text", "text": t }));
                }
            }
            "image" => {
                if let Some(source) = block.get("source") {
                    parts.push(json!({ "type": "image_url", "image_url": anthropic_image_to_openai(source) }));
                }
            }
            _ => {
                if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                    parts.push(json!({ "type": "text", "text": t }));
                }
            }
        }
    }
    if parts.len() == 1 {
        if let Some(text) = parts[0].get("text").and_then(|v| v.as_str()) {
            return json!(text);
        }
    }
    if parts.is_empty() {
        return json!("");
    }
    json!(parts)
}

fn anthropic_image_to_openai(source: &Value) -> Value {
    let ty = source.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if ty == "base64" {
        let media = source.get("media_type").and_then(|v| v.as_str()).unwrap_or("image/png");
        let data = source.get("data").and_then(|v| v.as_str()).unwrap_or("");
        return json!({ "url": format!("data:{media};base64,{data}") });
    }
    if ty == "url" {
        if let Some(url) = source.get("url").and_then(|v| v.as_str()) {
            return json!({ "url": url });
        }
    }
    json!({ "url": "" })
}

fn tool_result_text(block: &Value) -> String {
    if let Some(s) = block.get("content").and_then(|v| v.as_str()) {
        return s.to_string();
    }
    if let Some(arr) = block.get("content").and_then(|v| v.as_array()) {
        let mut parts = Vec::new();
        for item in arr {
            if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                parts.push(t);
            }
        }
        return parts.join("\n");
    }
    String::new()
}

fn transform_tools(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .filter_map(|t| {
            let name = t.get("name").and_then(|v| v.as_str())?;
            let desc = t
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let schema = t
                .get("input_schema")
                .cloned()
                .unwrap_or(json!({ "type": "object", "properties": {} }));
            Some(json!({
                "type": "function",
                "function": {
                    "name": name,
                    "description": desc,
                    "parameters": schema,
                }
            }))
        })
        .collect()
}

fn message_to_content_blocks(message: &Value) -> Vec<Value> {
    let mut blocks = Vec::new();

    if let Some(reasoning) = message.get("reasoning_content").and_then(|v| v.as_str()) {
        if !reasoning.is_empty() {
            blocks.push(json!({
                "type": "thinking",
                "thinking": reasoning,
            }));
        }
    }

    if let Some(tool_calls) = message.get("tool_calls").and_then(|v| v.as_array()) {
        for tc in tool_calls {
            let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let func = tc.get("function");
            let name = func.and_then(|f| f.get("name")).and_then(|v| v.as_str()).unwrap_or("");
            let args = func
                .and_then(|f| f.get("arguments"))
                .and_then(|v| v.as_str())
                .unwrap_or("{}");
            let input: Value = serde_json::from_str(args).unwrap_or(json!({}));
            blocks.push(json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input,
            }));
        }
    }

    if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
        if !text.is_empty() {
            blocks.push(json!({ "type": "text", "text": text }));
        }
    } else if let Some(arr) = message.get("content").and_then(|v| v.as_array()) {
        for part in arr {
            if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = part.get("text").and_then(|v| v.as_str()) {
                    blocks.push(json!({ "type": "text", "text": t }));
                }
            }
        }
    }

    blocks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_simple_to_openai() {
        let req = json!({
            "model": "claude-sonnet-4",
            "max_tokens": 1024,
            "messages": [{ "role": "user", "content": "hi" }],
        });
        let out = anthropic_to_openai(&req, "kimi-k2.6").unwrap();
        assert_eq!(out["model"], "kimi-k2.6");
        assert_eq!(out["messages"][0]["content"], "hi");
    }

    #[test]
    fn openai_response_to_anthropic() {
        let resp = json!({
            "id": "chatcmpl-1",
            "choices": [{
                "message": { "role": "assistant", "content": "hello" },
                "finish_reason": "stop"
            }],
            "usage": { "prompt_tokens": 10, "completion_tokens": 5 }
        });
        let out = openai_to_anthropic(&resp, "claude-sonnet-4").unwrap();
        assert_eq!(out["stop_reason"], "end_turn");
        assert_eq!(out["content"][0]["text"], "hello");
    }

}
