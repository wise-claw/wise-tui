//! 场景路由、模型链与近似 token 估算。

use std::collections::HashMap;

use serde_json::Value;

use super::routing::Provider;
use super::ModelOverride;

const LONG_CONTEXT_THRESHOLD: usize = 80_000;

pub fn approx_token_count(body: &Value) -> usize {
    super::tokens::count_tokens_for_body(body).max(1)
}

fn value_chars(v: &Value) -> usize {
    if let Some(s) = v.as_str() {
        return s.len();
    }
    v.to_string().len()
}

/// 若配置了 `model_overrides`，优先返回覆盖项。
pub fn lookup_model_override<'a>(
    requested: &str,
    overrides: &'a HashMap<String, ModelOverride>,
) -> Option<&'a ModelOverride> {
    let r = requested.trim();
    if r.is_empty() {
        return None;
    }
    overrides.get(r).or_else(|| {
        overrides
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(r))
            .map(|(_, v)| v)
    })
}

/// 在默认模型之外，按场景与 Claude 模型名推断上游模型（对齐 oc-go-cc 常见路由）。
pub fn resolve_upstream_model(
    requested: &str,
    default_model: &str,
    provider: Provider,
    body: &Value,
    overrides: &HashMap<String, ModelOverride>,
) -> String {
    if let Some(ov) = lookup_model_override(requested, overrides) {
        let id = ov.model_id.trim();
        if !id.is_empty() {
            return id.to_string();
        }
    }

    let r = requested.trim();
    if !r.is_empty() && !r.contains("claude") {
        return r.to_string();
    }

    let tokens = approx_token_count(body);
    if tokens > LONG_CONTEXT_THRESHOLD {
        return match provider {
            Provider::OpenCodeZen => default_model.to_string(),
            Provider::OpenCodeGo => "minimax-m2.5".to_string(),
        };
    }

    let last_user = body
        .get("messages")
        .and_then(|m| m.as_array())
        .and_then(|arr| arr.iter().rev().find(|m| m.get("role") == Some(&Value::from("user"))));

    let user_text = last_user
        .and_then(|m| m.get("content"))
        .map(value_chars)
        .unwrap_or(0);

    let has_tools = body
        .get("tools")
        .and_then(|t| t.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);

    if is_background_request(r, body) {
        return match provider {
            Provider::OpenCodeZen => default_model.to_string(),
            Provider::OpenCodeGo => "qwen3.5-plus".to_string(),
        };
    }

    if r.contains("opus") || r.contains("think") || has_thinking_pattern(body) {
        return match provider {
            Provider::OpenCodeZen => default_model.to_string(),
            Provider::OpenCodeGo => "glm-5".to_string(),
        };
    }

    if r.contains("haiku") || r.contains("fast") || (user_text < 80 && !has_tools) {
        return match provider {
            Provider::OpenCodeZen => default_model.to_string(),
            Provider::OpenCodeGo => "deepseek-v4-flash".to_string(),
        };
    }

    if r.contains("sonnet") || r.is_empty() {
        return default_model.to_string();
    }

    default_model.to_string()
}

/// Codex OpenAI 协议：不做 Claude 场景启发式，仅覆盖表 → 显式 model → 默认模型。
pub fn resolve_codex_upstream_model(
    requested: &str,
    default_model: &str,
    overrides: &HashMap<String, ModelOverride>,
) -> String {
    if let Some(ov) = lookup_model_override(requested, overrides) {
        let id = ov.model_id.trim();
        if !id.is_empty() {
            return id.to_string();
        }
    }
    let r = requested.trim();
    if !r.is_empty() {
        return r.to_string();
    }
    default_model.to_string()
}

fn is_background_request(requested_lower: &str, body: &Value) -> bool {
    if requested_lower.contains("background") || requested_lower.contains("subagent") {
        return true;
    }
    if let Some(meta) = body.get("metadata").and_then(|m| m.as_object()) {
        for key in ["user_id", "session_type", "type"] {
            if let Some(value) = meta.get(key).and_then(|v| v.as_str()) {
                let v = value.to_ascii_lowercase();
                if v.contains("background") || v == "subagent" {
                    return true;
                }
            }
        }
    }
    false
}

fn has_thinking_pattern(body: &Value) -> bool {
    let Some(messages) = body.get("messages").and_then(|m| m.as_array()) else {
        return false;
    };
    for msg in messages {
        if let Some(blocks) = msg.get("content").and_then(|c| c.as_array()) {
            for block in blocks {
                if block.get("type").and_then(|t| t.as_str()) == Some("thinking") {
                    return true;
                }
            }
        }
    }
    false
}

pub fn build_model_chain(primary: &str, fallbacks: &[String]) -> Vec<String> {
    let mut chain = vec![primary.trim().to_string()];
    for m in fallbacks {
        let t = m.trim();
        if t.is_empty() {
            continue;
        }
        if !chain.iter().any(|x| x == t) {
            chain.push(t.to_string());
        }
    }
    chain
}

pub fn should_retry_upstream(status: u16) -> bool {
    status == 429 || status >= 500
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_unique_fallback_chain() {
        let chain = build_model_chain("kimi-k2.6", &["qwen3.6-plus".into(), "kimi-k2.6".into()]);
        assert_eq!(chain, vec!["kimi-k2.6", "qwen3.6-plus"]);
    }

    #[test]
    fn override_takes_precedence() {
        let body = json!({ "messages": [{ "role": "user", "content": "x" }] });
        let mut overrides = HashMap::new();
        overrides.insert(
            "claude-sonnet-4-8".into(),
            ModelOverride {
                provider: Some("opencode-zen".into()),
                model_id: "claude-sonnet-4-8".into(),
            },
        );
        assert_eq!(
            resolve_upstream_model(
                "claude-sonnet-4-8",
                "kimi-k2.6",
                Provider::OpenCodeGo,
                &body,
                &overrides,
            ),
            "claude-sonnet-4-8"
        );
    }

    #[test]
    fn routes_opus_to_glm_on_go() {
        let body = json!({ "messages": [{ "role": "user", "content": "x" }] });
        assert_eq!(
            resolve_upstream_model(
                "claude-opus-4",
                "kimi-k2.6",
                Provider::OpenCodeGo,
                &body,
                &HashMap::new(),
            ),
            "glm-5"
        );
    }

    #[test]
    fn codex_resolve_uses_explicit_model_without_claude_heuristics() {
        let body = json!({
            "messages": [{ "role": "user", "content": "x" }],
            "metadata": { "user_id": "background" }
        });
        assert_eq!(
            resolve_codex_upstream_model("claude-sonnet-4-8", "kimi-k2.6", &HashMap::new()),
            "claude-sonnet-4-8"
        );
        assert_eq!(
            resolve_upstream_model(
                "claude-sonnet-4-8",
                "kimi-k2.6",
                Provider::OpenCodeGo,
                &body,
                &HashMap::new(),
            ),
            "qwen3.5-plus"
        );
    }

    #[test]
    fn codex_resolve_empty_to_default() {
        assert_eq!(
            resolve_codex_upstream_model("", "kimi-k2.6", &HashMap::new()),
            "kimi-k2.6"
        );
    }

    #[test]
    fn routes_background_to_qwen_on_go() {
        let body = json!({
            "messages": [{ "role": "user", "content": "x" }],
            "metadata": { "user_id": "background" }
        });
        assert_eq!(
            resolve_upstream_model(
                "claude-sonnet-4.5",
                "kimi-k2.6",
                Provider::OpenCodeGo,
                &body,
                &HashMap::new(),
            ),
            "qwen3.5-plus"
        );
    }

    #[test]
    fn routes_haiku_to_flash_on_go() {
        let body = json!({ "messages": [{ "role": "user", "content": "x" }] });
        assert_eq!(
            resolve_upstream_model(
                "claude-haiku-4.5",
                "kimi-k2.6",
                Provider::OpenCodeGo,
                &body,
                &HashMap::new(),
            ),
            "deepseek-v4-flash"
        );
    }
}
