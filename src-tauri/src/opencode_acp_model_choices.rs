//! Extract the advertised model catalog from an ACP `session/new` result.
//!
//! DeepSeek Harness publishes the live provider/model catalog as ACP session
//! configuration options; OpenCode uses a `models.availableModels` extension.

use serde_json::{json, Value};

/// Normalize model choices into `{ id, displayName, description? }` items.
pub(crate) fn extract_model_choices(result: &Value) -> Vec<Value> {
    config_option_model_choices(result)
        .or_else(|| opencode_model_choices(result))
        .unwrap_or_default()
}

fn config_option_model_choices(result: &Value) -> Option<Vec<Value>> {
    let options = config_options_array(result)?;
    for option in options {
        let id = option.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let category = option.get("category").and_then(|v| v.as_str()).unwrap_or("");
        if id != "model" && category != "model" {
            continue;
        }
        let Some(choices) = option.get("options").and_then(|v| v.as_array()) else {
            continue;
        };
        let out = map_choices(choices, "value", "name");
        if !out.is_empty() {
            return Some(out);
        }
    }
    None
}

/// `session/new` 的完整结果是 `{ "configOptions": [...] }`；`OpencodeAcpSession::config_options`
/// 里保存的则是 `configOptions` 数组本身。两种形态都要接受，否则 DeepSeek Harness 的
/// 模型目录永远解析为空（Composer 下拉里没有可选模型）。
fn config_options_array(result: &Value) -> Option<&Vec<Value>> {
    if let Some(options) = result.as_array() {
        return Some(options);
    }
    result.get("configOptions")?.as_array()
}

fn opencode_model_choices(result: &Value) -> Option<Vec<Value>> {
    let choices = result
        .get("models")
        .and_then(|m| m.get("availableModels"))
        .and_then(|v| v.as_array())?;
    let out = map_choices(choices, "modelId", "name");
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Flatten ACP select options: DeepSeek Harness nests provider groups one level
/// deep (`{ group, name, options: [...] }`), OpenCode lists leaves directly.
fn map_choices(choices: &[Value], id_key: &str, name_key: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for choice in choices {
        if let Some(children) = choice.get("options").and_then(|v| v.as_array()) {
            let provider = choice
                .get("group")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty());
            for mut child in map_choices(children, id_key, name_key) {
                if let (Some(provider), Some(obj)) = (provider, child.as_object_mut()) {
                    obj.entry("providerId")
                        .or_insert_with(|| Value::String(provider.to_string()));
                }
                out.push(child);
            }
            continue;
        }
        let id = choice
            .get(id_key)
            .or_else(|| choice.get("id"))
            .or_else(|| choice.get("value"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let Some(id) = id else { continue };
        let display_name = choice
            .get(name_key)
            .or_else(|| choice.get("displayName"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(id);
        let mut item = json!({ "id": id, "displayName": display_name });
        if let Some(description) = choice.get("description").and_then(|v| v.as_str()) {
            let trimmed = description.trim();
            if !trimmed.is_empty() {
                item["description"] = Value::String(trimmed.to_string());
            }
        }
        out.push(item);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Payload captured from a real `dsh --profile acp` `session/new` response.
    #[test]
    fn reads_deepseek_grouped_model_choices() {
        let result = json!({
            "sessionId": "d1e3c862-b3f8-47df-9160-7c0e8d6a9360",
            "configOptions": [
                {
                    "id": "model",
                    "name": "Model",
                    "category": "model",
                    "type": "select",
                    "currentValue": "[\"deepseek-official\",\"deepseek-v4-flash\"]",
                    "options": [
                        {
                            "group": "deepseek-official",
                            "name": "DeepSeek",
                            "options": [
                                { "value": "[\"deepseek-official\",\"deepseek-v4-flash\"]", "name": "DeepSeek-V4-Flash", "description": "Fast" },
                                { "value": "[\"deepseek-official\",\"deepseek-v4-pro\"]", "name": "DeepSeek-V4-Pro" }
                            ]
                        }
                    ]
                },
                { "id": "reasoning_effort", "category": "thought_level", "options": [] }
            ]
        });
        let choices = extract_model_choices(&result);
        assert_eq!(choices.len(), 2);
        assert_eq!(choices[0]["id"], "[\"deepseek-official\",\"deepseek-v4-flash\"]");
        assert_eq!(choices[0]["displayName"], "DeepSeek-V4-Flash");
        assert_eq!(choices[0]["description"], "Fast");
        assert_eq!(choices[0]["providerId"], "deepseek-official");
        assert_eq!(choices[1]["displayName"], "DeepSeek-V4-Pro");
    }

    /// `OpencodeAcpSession::config_options` 直接保存 `configOptions` 数组（真实 session/new 结果的一部分）。
    #[test]
    fn reads_model_choices_from_bare_config_options_array() {
        let config_options = json!([
            {
                "id": "model",
                "name": "Model",
                "category": "model",
                "type": "select",
                "currentValue": "[\"deepseek-official\",\"deepseek-v4-flash\"]",
                "options": [
                    {
                        "group": "deepseek-official",
                        "name": "DeepSeek",
                        "options": [
                            { "value": "[\"deepseek-official\",\"deepseek-v4-flash\"]", "name": "DeepSeek-V4-Flash", "description": "Fast" },
                            { "value": "[\"deepseek-official\",\"deepseek-v4-pro\"]", "name": "DeepSeek-V4-Pro" }
                        ]
                    }
                ]
            },
            { "id": "reasoning_effort", "category": "thought_level", "options": [] }
        ]);
        let choices = extract_model_choices(&config_options);
        assert_eq!(choices.len(), 2);
        assert_eq!(choices[0]["id"], "[\"deepseek-official\",\"deepseek-v4-flash\"]");
        assert_eq!(choices[0]["displayName"], "DeepSeek-V4-Flash");
        assert_eq!(choices[0]["providerId"], "deepseek-official");
        assert_eq!(choices[1]["displayName"], "DeepSeek-V4-Pro");
    }

    #[test]
    fn reads_flat_config_option_model_choices() {
        let result = json!({
            "configOptions": [
                {
                    "id": "model",
                    "category": "model",
                    "options": [
                        { "value": "provider/model-a", "name": "Model A" }
                    ]
                }
            ]
        });
        let choices = extract_model_choices(&result);
        assert_eq!(choices.len(), 1);
        assert_eq!(choices[0]["id"], "provider/model-a");
    }

    #[test]
    fn reads_opencode_extension_shape() {
        let result = json!({
            "models": { "availableModels": [ { "modelId": "anthropic/claude", "name": "Claude" } ] }
        });
        let choices = extract_model_choices(&result);
        assert_eq!(choices.len(), 1);
        assert_eq!(choices[0]["id"], "anthropic/claude");
    }

    #[test]
    fn empty_when_no_catalog() {
        assert!(extract_model_choices(&json!({ "sessionId": "s" })).is_empty());
    }
}
