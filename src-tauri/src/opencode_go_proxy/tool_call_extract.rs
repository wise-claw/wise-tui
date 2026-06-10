//! 从 Qwen 等模型误写入 text/thinking 的正文中提取工具调用（Anthropic tool_use 形态）。

use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedToolCall {
    pub name: String,
    pub input: Value,
}

/// 尝试从单段文本中提取首个可解析的工具调用。
pub fn extract_first_tool_call_from_text(text: &str) -> Option<ExtractedToolCall> {
    extract_tool_calls_from_text(text).into_iter().next()
}

/// 按常见 Qwen / XML 模板从文本中提取工具调用（顺序保留）。
pub fn extract_tool_calls_from_text(text: &str) -> Vec<ExtractedToolCall> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    if let Some(tc) = extract_tool_call_json_tags(trimmed) {
        out.extend(tc);
    }
    if out.is_empty() {
        if let Some(tc) = extract_function_xml_tags(trimmed) {
            out.push(tc);
        }
    }
    if out.is_empty() {
        if let Some(tc) = extract_invoke_xml_tags(trimmed) {
            out.push(tc);
        }
    }
    out
}

fn extract_tool_call_json_tags(text: &str) -> Option<Vec<ExtractedToolCall>> {
    let lower = text.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut search_from = 0;
    while let Some(start) = lower[search_from..].find("<tool_call>") {
        let abs_start = search_from + start + "<tool_call>".len();
        let Some(end_rel) = lower[abs_start..].find("</tool_call>") else {
            break;
        };
        let payload = text[abs_start..abs_start + end_rel].trim();
        if let Some(parsed) = parse_tool_payload_json(payload) {
            out.push(parsed);
        }
        search_from = abs_start + end_rel + "</tool_call>".len();
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn extract_function_xml_tags(text: &str) -> Option<ExtractedToolCall> {
    // <function=Bash> {...} </function> 或 <function=Bash>...</function>
    let lower = text.to_ascii_lowercase();
    let start = lower.find("<function=")?;
    let after_eq = start + "<function=".len();
    let close_name = lower[after_eq..].find('>')? + after_eq;
    let name = text[after_eq..close_name].trim();
    if name.is_empty() {
        return None;
    }
    let body_start = close_name + 1;
    let end_tag = lower[body_start..].find("</function>")? + body_start;
    let body = text[body_start..end_tag].trim();
    let input = parse_tool_body_as_json(body);
    Some(ExtractedToolCall {
        name: name.to_string(),
        input,
    })
}

fn extract_invoke_xml_tags(text: &str) -> Option<ExtractedToolCall> {
    let lower = text.to_ascii_lowercase();
    let start = lower.find("<invoke")?;
    let after = start + "<invoke".len();
    let close = lower[after..].find('>')? + after;
    let header = &text[start..=close];
    let name = extract_xml_attr(header, "name")?;
    let body_start = close + 1;
    let end_tag = lower[body_start..]
        .find("</invoke>")
        .map(|i| body_start + i)
        .unwrap_or(text.len());
    let body = text[body_start..end_tag].trim();
    let input = parse_tool_body_as_json(body);
    Some(ExtractedToolCall {
        name,
        input,
    })
}

fn extract_xml_attr(tag: &str, key: &str) -> Option<String> {
    let pattern = format!("{key}=");
    let lower = tag.to_ascii_lowercase();
    let idx = lower.find(&pattern)?;
    let rest = &tag[idx + pattern.len()..];
    if rest.starts_with('"') {
        let end = rest[1..].find('"')? + 1;
        return Some(rest[1..end].to_string());
    }
    if rest.starts_with('\'') {
        let end = rest[1..].find('\'')? + 1;
        return Some(rest[1..end].to_string());
    }
    None
}

fn parse_tool_payload_json(payload: &str) -> Option<ExtractedToolCall> {
    let v: Value = serde_json::from_str(payload).ok()?;
    let obj = v.as_object()?;
    let name = obj
        .get("name")
        .or_else(|| obj.get("function"))
        .and_then(|n| n.as_str())
        .filter(|s| !s.is_empty())?
        .to_string();
    let input = obj
        .get("arguments")
        .or_else(|| obj.get("input"))
        .or_else(|| obj.get("parameters"))
        .cloned()
        .unwrap_or(json!({}));
    let input = if input.is_object() {
        input
    } else if let Some(s) = input.as_str() {
        serde_json::from_str(s).unwrap_or(json!({}))
    } else {
        json!({})
    };
    Some(ExtractedToolCall { name, input })
}

fn parse_tool_body_as_json(body: &str) -> Value {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return json!({});
    }
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        return if v.is_object() { v } else { json!({}) };
    }
    json!({})
}

pub fn new_tool_use_id() -> String {
    format!("toolu_{}", uuid::Uuid::new_v4().simple())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_tool_call_json_tag() {
        let text = r#"plan<tool_call>{"name":"Bash","arguments":{"command":"ls"}}</tool_call>"#;
        let calls = extract_tool_calls_from_text(text);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "Bash");
        assert_eq!(calls[0].input["command"], "ls");
    }

    #[test]
    fn extracts_function_xml_tag() {
        let text = r#"<function=Read>{"file_path":"a.txt"}</function>"#;
        let call = extract_first_tool_call_from_text(text).unwrap();
        assert_eq!(call.name, "Read");
        assert_eq!(call.input["file_path"], "a.txt");
    }

    #[test]
    fn extracts_invoke_xml_tag() {
        let text = r#"<invoke name="Grep">{"pattern":"foo"}</invoke>"#;
        let call = extract_first_tool_call_from_text(text).unwrap();
        assert_eq!(call.name, "Grep");
        assert_eq!(call.input["pattern"], "foo");
    }
}
