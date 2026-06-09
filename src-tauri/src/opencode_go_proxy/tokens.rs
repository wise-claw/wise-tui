//! Anthropic cl100k_base token 计数（对齐 oc-go-cc / tiktoken）。

use serde_json::Value;

pub fn count_tokens_for_body(body: &Value) -> usize {
    let mut parts: Vec<String> = Vec::new();
    if let Some(system) = body.get("system") {
        collect_value_text(system, &mut parts);
    }
    if let Some(messages) = body.get("messages").and_then(|m| m.as_array()) {
        for msg in messages {
            if let Some(content) = msg.get("content") {
                collect_value_text(content, &mut parts);
            }
        }
    }
    if let Some(tools) = body.get("tools") {
        collect_value_text(tools, &mut parts);
    }
    count_tokens_text(&parts.join("\n"))
}

fn collect_value_text(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(s) => out.push(s.clone()),
        Value::Array(arr) => {
            for item in arr {
                collect_value_text(item, out);
            }
        }
        Value::Object(obj) => {
            if let Some(t) = obj.get("text").and_then(|v| v.as_str()) {
                out.push(t.to_string());
            }
            if let Some(input) = obj.get("input") {
                collect_value_text(input, out);
            }
            if let Some(content) = obj.get("content") {
                collect_value_text(content, out);
            }
        }
        _ => out.push(value.to_string()),
    }
}

pub fn count_tokens_text(text: &str) -> usize {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    match tiktoken_rs::cl100k_base() {
        Ok(bpe) => bpe.encode_with_special_tokens(trimmed).len(),
        Err(_) => (trimmed.len() / 4).max(1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn counts_user_message_tokens() {
        let body = json!({
            "messages": [{ "role": "user", "content": "hello world" }]
        });
        let n = count_tokens_for_body(&body);
        assert!(n > 0);
        assert!(n < 20);
    }

    #[test]
    fn empty_body_is_zero() {
        assert_eq!(count_tokens_for_body(&json!({})), 0);
    }
}
