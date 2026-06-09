//! Codex OpenAI Responses ↔ Chat Completions 转换（参考 ocgo）。

use serde_json::{json, Value};

pub fn openai_error(status: u16, message: &str) -> Value {
    let err_type = match status {
        400 => "invalid_request_error",
        401 => "invalid_api_key",
        403 => "insufficient_quota",
        404 => "not_found",
        429 => "rate_limit_exceeded",
        _ if status >= 500 => "server_error",
        _ => "api_error",
    };
    json!({
        "error": {
            "message": message,
            "type": err_type,
            "code": null,
        }
    })
}

/// Codex `/v1/responses` 请求体 → OpenAI Chat Completions 请求体。
pub fn responses_to_chat(body: &Value, upstream_model: &str) -> Result<Value, String> {
    let obj = body
        .as_object()
        .ok_or_else(|| "请求体必须是 JSON 对象".to_string())?;

    let stream = obj.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);
    let mut messages: Vec<Value> = Vec::new();

    if let Some(instructions) = obj.get("instructions").and_then(|v| v.as_str()) {
        if !instructions.is_empty() {
            messages.push(json!({ "role": "system", "content": instructions }));
        }
    }

    if let Some(input) = obj.get("input") {
        messages.extend(responses_input_to_messages(input));
    }

    messages = sanitize_tool_messages(messages);

    let mut chat = json!({
        "model": upstream_model,
        "messages": messages,
        "stream": stream,
    });

    if stream {
        chat["stream_options"] = json!({ "include_usage": true });
    }

    for key in ["max_tokens", "temperature", "top_p"] {
        if let Some(v) = obj.get(key) {
            chat[key] = v.clone();
        }
    }

    if let Some(tools) = obj.get("tools").and_then(|v| v.as_array()) {
        let openai_tools: Vec<Value> = tools
            .iter()
            .filter_map(|t| {
                let name = t.get("name").and_then(|v| v.as_str())?;
                let ty = t.get("type").and_then(|v| v.as_str()).unwrap_or("function");
                if ty != "function" && !ty.is_empty() {
                    return None;
                }
                Some(json!({
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": t.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                        "parameters": t.get("parameters").cloned().unwrap_or(json!({"type":"object","properties":{}})),
                    }
                }))
            })
            .collect();
        if !openai_tools.is_empty() {
            chat["tools"] = json!(openai_tools);
        }
    }

    Ok(chat)
}

fn responses_input_to_messages(input: &Value) -> Vec<Value> {
    if let Some(s) = input.as_str() {
        if s.is_empty() {
            return Vec::new();
        }
        return vec![json!({ "role": "user", "content": s })];
    }

    let Some(items) = input.as_array() else {
        return vec![json!({ "role": "user", "content": input.to_string() })];
    };

    let mut out: Vec<Value> = Vec::new();
    let mut pending_calls: Vec<Value> = Vec::new();

    for item in items {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let ty = obj
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("message");
        let mut role = obj
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("user")
            .to_string();
        if role == "developer" {
            role = "system".to_string();
        }

        match ty {
            "message" | "" => {
                out.push(json!({
                    "role": role,
                    "content": responses_content_value(obj.get("content")),
                }));
            }
            "function_call" => {
                let id = obj
                    .get("call_id")
                    .or_else(|| obj.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = obj
                    .get("arguments")
                    .map(|v| {
                        if let Some(s) = v.as_str() {
                            s.to_string()
                        } else {
                            v.to_string()
                        }
                    })
                    .unwrap_or_else(|| "{}".to_string());
                pending_calls.push(json!({
                    "id": id,
                    "type": "function",
                    "function": { "name": name, "arguments": args }
                }));
            }
            "function_call_output" => {
                if !pending_calls.is_empty() {
                    out.push(json!({
                        "role": "assistant",
                        "content": null,
                        "tool_calls": pending_calls,
                    }));
                    pending_calls = Vec::new();
                }
                let call_id = obj.get("call_id").and_then(|v| v.as_str()).unwrap_or("");
                out.push(json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": responses_content_text(obj.get("output")),
                }));
            }
            _ => {}
        }
    }

    if !pending_calls.is_empty() {
        out.push(json!({
            "role": "assistant",
            "content": null,
            "tool_calls": pending_calls,
        }));
    }

    out
}

fn responses_content_value(content: Option<&Value>) -> Value {
    match content {
        None => json!(""),
        Some(Value::String(s)) => json!(s),
        Some(Value::Array(arr)) => {
            let mut parts = Vec::new();
            for c in arr {
                if let Some(text) = c
                    .get("text")
                    .or_else(|| c.get("output_text"))
                    .and_then(|v| v.as_str())
                {
                    if !text.is_empty() {
                        parts.push(text);
                    }
                }
            }
            json!(parts.join("\n"))
        }
        Some(other) => other.clone(),
    }
}

fn responses_content_text(output: Option<&Value>) -> String {
    match output {
        None => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|c| {
                c.get("text")
                    .or_else(|| c.get("output_text"))
                    .and_then(|v| v.as_str())
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Some(other) => other.to_string(),
    }
}

const UNAVAILABLE_TOOL_RESULT: &str = "Tool result unavailable.";

fn sanitize_tool_messages(messages: Vec<Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut i = 0;
    while i < messages.len() {
        let msg = &messages[i];
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
        if role == "tool" {
            i += 1;
            continue;
        }
        out.push(msg.clone());
        if role != "assistant" {
            i += 1;
            continue;
        }
        let tool_calls = msg
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .filter(|a| !a.is_empty());
        let Some(calls) = tool_calls else {
            i += 1;
            continue;
        };

        let expected: Vec<String> = calls
            .iter()
            .filter_map(|c| c.get("id").and_then(|v| v.as_str()).map(str::to_string))
            .collect();
        let mut seen = std::collections::HashSet::new();
        let mut j = i + 1;
        while j < messages.len() {
            let tool_role = messages[j].get("role").and_then(|v| v.as_str()).unwrap_or("");
            if tool_role != "tool" {
                break;
            }
            let call_id = messages[j]
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if expected.iter().any(|id| id == call_id) && seen.insert(call_id.to_string()) {
                out.push(messages[j].clone());
            }
            j += 1;
        }
        for id in expected {
            if !seen.contains(&id) {
                out.push(json!({
                    "role": "tool",
                    "tool_call_id": id,
                    "content": UNAVAILABLE_TOOL_RESULT,
                }));
            }
        }
        i = j;
    }
    out
}

/// OpenAI Chat Completions 非流式响应 → Codex Responses 响应体。
pub fn chat_response_to_responses(chat: &Value, model: &str) -> Value {
    let choices = chat.get("choices").and_then(|v| v.as_array());
    let mut text = String::new();
    let mut output: Vec<Value> = Vec::new();

    if let Some(choice) = choices.and_then(|c| c.first()) {
        let message = choice.get("message").unwrap_or(&Value::Null);
        text = message
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if let Some(tool_calls) = message.get("tool_calls").and_then(|v| v.as_array()) {
            for tc in tool_calls {
                let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let func = tc.get("function").unwrap_or(&Value::Null);
                let name = func.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = func
                    .get("arguments")
                    .and_then(|v| v.as_str())
                    .unwrap_or("{}");
                output.push(json!({
                    "id": id,
                    "type": "function_call",
                    "call_id": id,
                    "name": name,
                    "arguments": args,
                }));
            }
        }
    }

    if output.is_empty() {
        output.push(json!({
            "id": "msg_wise_proxy",
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": text }],
        }));
    }

    let usage = chat_usage_from_openai(chat.get("usage").unwrap_or(&Value::Null));

    json!({
        "id": chat.get("id").and_then(|v| v.as_str()).unwrap_or("resp_wise_proxy"),
        "object": "response",
        "model": model,
        "status": "completed",
        "output": output,
        "usage": usage,
    })
}

/// OpenAI Chat `usage` → Codex Responses `usage`。
pub fn chat_usage_from_openai(usage: &Value) -> Value {
    if usage.is_null() {
        return json!({
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
        });
    }
    let input = usage
        .get("prompt_tokens")
        .or_else(|| usage.get("input_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let output = usage
        .get("completion_tokens")
        .or_else(|| usage.get("output_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    json!({
        "input_tokens": input,
        "output_tokens": output,
        "total_tokens": input + output,
    })
}

pub fn patch_model_in_body(body: &Value, model: &str) -> Value {
    let mut patched = body.clone();
    if let Some(obj) = patched.as_object_mut() {
        obj.insert("model".to_string(), json!(model));
    }
    patched
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responses_string_input_to_chat() {
        let req = json!({
            "model": "kimi-k2.6",
            "input": "hello",
            "stream": false,
        });
        let chat = responses_to_chat(&req, "kimi-k2.6").unwrap();
        assert_eq!(chat["messages"][0]["content"], "hello");
    }

    #[test]
    fn chat_response_maps_to_responses() {
        let chat = json!({
            "id": "chatcmpl-1",
            "choices": [{
                "message": { "role": "assistant", "content": "hi" },
                "finish_reason": "stop"
            }],
            "usage": { "prompt_tokens": 3, "completion_tokens": 1 }
        });
        let resp = chat_response_to_responses(&chat, "kimi-k2.6");
        assert_eq!(resp["output"][0]["content"][0]["text"], "hi");
    }
}
