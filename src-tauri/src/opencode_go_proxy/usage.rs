//! 上游 usage → Anthropic Messages API usage（对齐 oc-go-cc / transform.rs）。

use serde_json::{json, Value};

pub fn zero_usage() -> Value {
    json!({
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    })
}

/// OpenAI Chat Completions `usage` 块。
pub fn openai_usage_to_anthropic(usage: &Value) -> Value {
    let prompt_tokens = usage.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
    let cache_hit = usage
        .get("prompt_cache_hit_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as i64;
    let cache_miss = usage
        .get("prompt_cache_miss_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as i64;
    let completion = usage
        .get("completion_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let input_tokens = (prompt_tokens - cache_hit - cache_miss).max(0);
    json!({
        "input_tokens": input_tokens,
        "output_tokens": completion,
        "cache_creation_input_tokens": cache_miss,
        "cache_read_input_tokens": cache_hit,
    })
}

/// OpenAI Responses API `usage` 块。
pub fn responses_usage_to_anthropic(usage: &Value) -> Value {
    let input_tokens = usage
        .get("input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let output_tokens = usage
        .get("output_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    json!({
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    })
}

/// Gemini `usageMetadata` 块。
pub fn gemini_usage_to_anthropic(meta: &Value) -> Value {
    let input_tokens = meta
        .get("promptTokenCount")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let output_tokens = meta
        .get("candidatesTokenCount")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    json!({
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn openai_cache_tokens_subtracted() {
        let u = openai_usage_to_anthropic(&json!({
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "prompt_cache_hit_tokens": 30,
            "prompt_cache_miss_tokens": 10,
        }));
        assert_eq!(u["input_tokens"], 60);
        assert_eq!(u["cache_read_input_tokens"], 30);
        assert_eq!(u["cache_creation_input_tokens"], 10);
        assert_eq!(u["output_tokens"], 20);
    }
}
