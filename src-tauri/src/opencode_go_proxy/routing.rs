//! OpenCode Go / Zen 上游端点路由（对齐 oc-go-cc）。
//! Responses / Gemini 流式与非流式均由 `stream_alt` / `transform_alt` 转换。

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    OpenCodeGo,
    OpenCodeZen,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointKind {
    /// OpenAI Chat Completions，需 Anthropic ↔ OpenAI 转换
    ChatCompletions,
    /// Anthropic Messages 直通
    AnthropicPassthrough,
    /// OpenAI Responses（Zen GPT 系列）
    Responses,
    /// Google Gemini（Zen）
    Gemini,
}

pub struct ResolvedUpstream {
    pub url: String,
    pub endpoint: EndpointKind,
}

const GO_CHAT: &str = "https://opencode.ai/zen/go/v1/chat/completions";
const GO_ANTHROPIC: &str = "https://opencode.ai/zen/go/v1/messages";
const ZEN_CHAT: &str = "https://opencode.ai/zen/v1/chat/completions";
const ZEN_ANTHROPIC: &str = "https://opencode.ai/zen/v1/messages";
const ZEN_RESPONSES: &str = "https://opencode.ai/zen/v1/responses";
const ZEN_GEMINI_BASE: &str = "https://opencode.ai/zen/v1/models";

pub fn parse_provider(raw: &str) -> Provider {
    match raw.trim().to_ascii_lowercase().as_str() {
        "opencode-zen" | "zen" => Provider::OpenCodeZen,
        _ => Provider::OpenCodeGo,
    }
}

pub fn provider_label(p: Provider) -> &'static str {
    match p {
        Provider::OpenCodeGo => "opencode-go",
        Provider::OpenCodeZen => "opencode-zen",
    }
}

pub fn is_anthropic_native_model(model_id: &str) -> bool {
    match model_id {
        "minimax-m2.5" | "minimax-m2.7" | "qwen3.7-max" => true,
        _ if model_id.starts_with("qwen") => true,
        _ => false,
    }
}

/// OpenCode Go 上游的非 Claude 模型（需请求/响应工具兼容处理）。
pub fn is_third_party_upstream_model(model_id: &str) -> bool {
    if is_anthropic_native_model(model_id) {
        return true;
    }
    let m = model_id.trim().to_ascii_lowercase();
    if m.is_empty() || m.contains("claude") || m.contains("gpt-") || m.starts_with("gemini") {
        return false;
    }
    m.starts_with("kimi")
        || m.starts_with("glm")
        || m.starts_with("deepseek")
        || m.starts_with("doubao")
        || m.starts_with("minimax")
        || m.starts_with("moonshot")
        || m.contains("bailian")
}

fn is_gemini_model(model_id: &str) -> bool {
    matches!(
        model_id,
        "gemini-3.5-flash" | "gemini-3.1-pro" | "gemini-3-flash"
    )
}

fn is_responses_model(model_id: &str) -> bool {
    matches!(
        model_id,
        "gpt-5.5" | "gpt-5.5-pro" | "gpt-5.4" | "gpt-5.4-pro" | "gpt-5.4-mini" | "gpt-5.4-nano"
            | "gpt-5.3-codex" | "gpt-5.3-codex-spark" | "gpt-5.2" | "gpt-5.2-codex"
            | "gpt-5.1" | "gpt-5.1-codex" | "gpt-5.1-codex-max" | "gpt-5.1-codex-mini"
            | "gpt-5" | "gpt-5-codex" | "gpt-5-nano"
    )
}

pub fn classify_endpoint(provider: Provider, model_id: &str) -> EndpointKind {
    if is_anthropic_native_model(model_id) {
        return EndpointKind::AnthropicPassthrough;
    }
    if provider == Provider::OpenCodeZen {
        if is_gemini_model(model_id) {
            return EndpointKind::Gemini;
        }
        if is_responses_model(model_id) {
            return EndpointKind::Responses;
        }
    }
    EndpointKind::ChatCompletions
}

pub fn resolve_upstream(
    provider: Provider,
    model_id: &str,
    custom_upstream: &str,
) -> ResolvedUpstream {
    if !custom_upstream.trim().is_empty() {
        let url = custom_upstream.trim().trim_end_matches('/').to_string();
        let endpoint = if url.contains("/messages") {
            EndpointKind::AnthropicPassthrough
        } else {
            EndpointKind::ChatCompletions
        };
        return ResolvedUpstream { url, endpoint };
    }

    let endpoint = classify_endpoint(provider, model_id);
    let url = match (provider, endpoint) {
        (_, EndpointKind::AnthropicPassthrough) => match provider {
            Provider::OpenCodeZen => ZEN_ANTHROPIC,
            Provider::OpenCodeGo => GO_ANTHROPIC,
        }
        .to_string(),
        (Provider::OpenCodeZen, EndpointKind::Responses) => ZEN_RESPONSES.to_string(),
        (Provider::OpenCodeZen, EndpointKind::Gemini) => {
            format!("{ZEN_GEMINI_BASE}/{model_id}")
        }
        (Provider::OpenCodeZen, EndpointKind::ChatCompletions) => ZEN_CHAT.to_string(),
        (Provider::OpenCodeGo, _) => GO_CHAT.to_string(),
    };

    ResolvedUpstream { url, endpoint }
}

pub fn default_chat_upstream(provider: Provider) -> &'static str {
    match provider {
        Provider::OpenCodeZen => ZEN_CHAT,
        Provider::OpenCodeGo => GO_CHAT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_minimax_to_anthropic_on_go() {
        let r = resolve_upstream(Provider::OpenCodeGo, "minimax-m2.5", "");
        assert_eq!(r.endpoint, EndpointKind::AnthropicPassthrough);
    }

    #[test]
    fn routes_gpt_to_responses_on_zen() {
        let r = resolve_upstream(Provider::OpenCodeZen, "gpt-5.4", "");
        assert_eq!(r.endpoint, EndpointKind::Responses);
    }

    #[test]
    fn routes_kimi_to_chat_on_go() {
        let r = resolve_upstream(Provider::OpenCodeGo, "kimi-k2.6", "");
        assert_eq!(r.endpoint, EndpointKind::ChatCompletions);
    }

    #[test]
    fn detects_third_party_upstream_models() {
        assert!(is_third_party_upstream_model("qwen3.7-plus"));
        assert!(is_third_party_upstream_model("kimi-k2.6"));
        assert!(!is_third_party_upstream_model("gpt-5.4"));
        assert!(!is_third_party_upstream_model("claude-sonnet-4-8"));
    }
}
