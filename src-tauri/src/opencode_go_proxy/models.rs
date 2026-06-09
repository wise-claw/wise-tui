//! 从 OpenCode Go / Zen 拉取可用模型列表（对齐 oc-go-cc models）。

use serde_json::Value;

use super::routing::Provider;

const GO_MODELS_URL: &str = "https://opencode.ai/zen/go/v1/models";
const ZEN_MODELS_URL: &str = "https://opencode.ai/zen/v1/models";

pub fn models_list_url(provider: Provider) -> &'static str {
    match provider {
        Provider::OpenCodeZen => ZEN_MODELS_URL,
        Provider::OpenCodeGo => GO_MODELS_URL,
    }
}

pub async fn fetch_model_ids(
    client: &reqwest::Client,
    provider: Provider,
    api_key: &str,
) -> Result<Vec<String>, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("请先配置 OpenCode API Key".into());
    }

    let url = models_list_url(provider);
    let resp = client
        .get(url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {key}"))
        .send()
        .await
        .map_err(|e| format!("拉取模型列表失败: {e}"))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("拉取模型列表失败 ({status}): {body}"));
    }

    parse_model_ids(&body)
}

pub fn parse_model_ids(body: &str) -> Result<Vec<String>, String> {
    let value: Value =
        serde_json::from_str(body).map_err(|e| format!("解析模型列表失败: {e}"))?;
    let Some(data) = value.get("data").and_then(|d| d.as_array()) else {
        return Err("模型列表响应缺少 data 数组".into());
    };

    let mut ids: Vec<String> = data
        .iter()
        .filter_map(|item| item.get("id").and_then(|id| id.as_str()))
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect();

    ids.sort_unstable();
    ids.dedup();
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_openai_style_model_list() {
        let body = r#"{
          "object": "list",
          "data": [
            { "id": "kimi-k2.6", "object": "model" },
            { "id": "glm-5", "object": "model" },
            { "id": "kimi-k2.6", "object": "model" }
          ]
        }"#;
        assert_eq!(
            parse_model_ids(body).expect("parse"),
            vec!["glm-5".to_string(), "kimi-k2.6".to_string()]
        );
    }
}
