use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const SETTINGS_NAMESPACE: &str = "llm-deepseek";
const API_KEY_REF: &str = "DEEPSEEK_API_KEY";
const DEFAULT_BASE_URL: &str = "https://api.deepseek.com";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeepseekHarnessModelConfig {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeepseekHarnessConfig {
    pub api_key_configured: bool,
    pub base_url: String,
    pub models: Vec<DeepseekHarnessModelConfig>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveDeepseekHarnessConfig {
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub clear_api_key: bool,
    pub base_url: String,
    pub models: Vec<DeepseekHarnessModelConfig>,
}

fn yaml_key(key: &str) -> Value {
    Value::String(key.to_string())
}

fn empty_mapping() -> Value {
    Value::Mapping(Mapping::new())
}

fn dsh_home() -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var("DSH_HOME") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    dirs::home_dir()
        .map(|home| home.join(".dsh"))
        .ok_or_else(|| "无法定位用户主目录，不能读取 DeepSeek Harness 配置".to_string())
}

fn read_yaml_mapping(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(empty_mapping());
    }
    let body =
        fs::read_to_string(path).map_err(|err| format!("读取 {} 失败：{err}", path.display()))?;
    if body.trim().is_empty() {
        return Ok(empty_mapping());
    }
    let parsed: Value = serde_yaml::from_str(&body)
        .map_err(|err| format!("解析 {} 失败：{err}", path.display()))?;
    if parsed.is_mapping() {
        Ok(parsed)
    } else {
        Err(format!("{} 必须是 YAML 对象", path.display()))
    }
}

fn optional_trimmed(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn optional_positive_u64(value: Option<&Value>) -> Option<u64> {
    value.and_then(Value::as_u64).filter(|value| *value > 0)
}

fn builtin_models() -> Vec<DeepseekHarnessModelConfig> {
    [
        ("deepseek-flash", "DeepSeek-V41-Flash"),
        ("deepseek-v4-flash", "DeepSeek-V4-Flash"),
        ("deepseek-v4-pro", "DeepSeek-V4-Pro"),
        (
            "deepseek-v4-flash-vision-exp",
            "DeepSeek-V4-Flash-Vision-Exp",
        ),
    ]
    .into_iter()
    .map(|(id, name)| DeepseekHarnessModelConfig {
        id: id.to_string(),
        name: Some(name.to_string()),
        description: None,
        context_window: None,
        max_tokens: None,
    })
    .collect()
}

fn models_from_settings(settings: &Value) -> Vec<DeepseekHarnessModelConfig> {
    let Some(namespace) = settings
        .as_mapping()
        .and_then(|root| root.get(yaml_key(SETTINGS_NAMESPACE)))
        .and_then(Value::as_mapping)
    else {
        return builtin_models();
    };
    let Some(models) = namespace
        .get(yaml_key("models"))
        .and_then(Value::as_sequence)
    else {
        return builtin_models();
    };
    let configured: Vec<_> = models
        .iter()
        .filter_map(|value| {
            let item = value.as_mapping()?;
            let id = optional_trimmed(item.get(yaml_key("id")))?;
            Some(DeepseekHarnessModelConfig {
                id,
                name: optional_trimmed(item.get(yaml_key("name"))),
                description: optional_trimmed(item.get(yaml_key("description"))),
                context_window: optional_positive_u64(item.get(yaml_key("contextWindow"))),
                max_tokens: optional_positive_u64(item.get(yaml_key("maxTokens"))),
            })
        })
        .collect();
    if configured.is_empty() {
        builtin_models()
    } else {
        configured
    }
}

fn base_url_from_settings(settings: &Value) -> String {
    settings
        .as_mapping()
        .and_then(|root| root.get(yaml_key(SETTINGS_NAMESPACE)))
        .and_then(Value::as_mapping)
        .and_then(|namespace| optional_trimmed(namespace.get(yaml_key("baseURL"))))
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
}

fn api_key_configured(credentials: &Value) -> bool {
    credentials
        .as_mapping()
        .and_then(|root| root.get(yaml_key("refs")))
        .and_then(Value::as_mapping)
        .and_then(|refs| optional_trimmed(refs.get(yaml_key(API_KEY_REF))))
        .is_some()
}

fn validate_input(input: &mut SaveDeepseekHarnessConfig) -> Result<(), String> {
    input.base_url = input.base_url.trim().to_string();
    if input.base_url.is_empty() {
        input.base_url = DEFAULT_BASE_URL.to_string();
    }
    if !(input.base_url.starts_with("https://") || input.base_url.starts_with("http://")) {
        return Err("接口地址必须以 http:// 或 https:// 开头".to_string());
    }
    if input.models.is_empty() {
        return Err("至少保留一个 DeepSeek 模型".to_string());
    }
    let mut ids = HashSet::new();
    for model in &mut input.models {
        model.id = model.id.trim().to_string();
        if model.id.is_empty() {
            return Err("模型 ID 不能为空".to_string());
        }
        if !ids.insert(model.id.clone()) {
            return Err(format!("模型 ID 重复：{}", model.id));
        }
        model.name = model
            .name
            .take()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        model.description = model
            .description
            .take()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if model.context_window == Some(0) || model.max_tokens == Some(0) {
            return Err(format!("模型 {} 的上下文与输出上限必须大于 0", model.id));
        }
    }
    if let Some(key) = input.api_key.as_mut() {
        *key = key.trim().to_string();
        if key.is_empty() {
            input.api_key = None;
        }
    }
    Ok(())
}

fn update_settings(settings: &mut Value, input: &SaveDeepseekHarnessConfig) -> Result<(), String> {
    let root = settings
        .as_mapping_mut()
        .ok_or_else(|| "DeepSeek Harness settings.yaml 必须是 YAML 对象".to_string())?;
    let namespace = root
        .entry(yaml_key(SETTINGS_NAMESPACE))
        .or_insert_with(empty_mapping)
        .as_mapping_mut()
        .ok_or_else(|| format!("settings.yaml 中 {SETTINGS_NAMESPACE} 必须是对象"))?;
    let existing_models = namespace
        .get(yaml_key("models"))
        .and_then(Value::as_sequence)
        .cloned()
        .unwrap_or_default();
    namespace.insert(yaml_key("apiKeyEnv"), yaml_key(API_KEY_REF));
    namespace.insert(yaml_key("baseURL"), yaml_key(&input.base_url));
    let models = input
        .models
        .iter()
        .map(|model| {
            // 只改 Wise 暴露的字段；保留 DSH 或用户手工配置的 modalities 等高级能力。
            let mut item = existing_models
                .iter()
                .filter_map(Value::as_mapping)
                .find(|candidate| {
                    optional_trimmed(candidate.get(yaml_key("id"))).as_deref()
                        == Some(model.id.as_str())
                })
                .cloned()
                .unwrap_or_default();
            item.insert(yaml_key("id"), yaml_key(&model.id));
            if let Some(value) = &model.name {
                item.insert(yaml_key("name"), yaml_key(value));
            } else {
                item.remove(yaml_key("name"));
            }
            if let Some(value) = &model.description {
                item.insert(yaml_key("description"), yaml_key(value));
            } else {
                item.remove(yaml_key("description"));
            }
            if let Some(value) = model.context_window {
                item.insert(yaml_key("contextWindow"), Value::Number(value.into()));
            } else {
                item.remove(yaml_key("contextWindow"));
            }
            if let Some(value) = model.max_tokens {
                item.insert(yaml_key("maxTokens"), Value::Number(value.into()));
            } else {
                item.remove(yaml_key("maxTokens"));
            }
            Value::Mapping(item)
        })
        .collect();
    namespace.insert(yaml_key("models"), Value::Sequence(models));
    Ok(())
}

fn update_credentials(
    credentials: &mut Value,
    input: &SaveDeepseekHarnessConfig,
) -> Result<(), String> {
    let root = credentials
        .as_mapping_mut()
        .ok_or_else(|| "DeepSeek Harness .credentials.yaml 必须是 YAML 对象".to_string())?;
    root.entry(yaml_key("version"))
        .or_insert_with(|| Value::Number(1.into()));
    let refs = root
        .entry(yaml_key("refs"))
        .or_insert_with(empty_mapping)
        .as_mapping_mut()
        .ok_or_else(|| ".credentials.yaml 中 refs 必须是对象".to_string())?;
    if input.clear_api_key {
        refs.remove(yaml_key(API_KEY_REF));
    } else if let Some(key) = &input.api_key {
        refs.insert(yaml_key(API_KEY_REF), yaml_key(key));
    }
    Ok(())
}

fn serialize_yaml(value: &Value) -> Result<String, String> {
    serde_yaml::to_string(value).map_err(|err| format!("序列化 YAML 失败：{err}"))
}

#[tauri::command]
pub(crate) fn get_deepseek_harness_config() -> Result<DeepseekHarnessConfig, String> {
    let home = dsh_home()?;
    let settings = read_yaml_mapping(&home.join("settings.yaml"))?;
    let credentials = read_yaml_mapping(&home.join(".credentials.yaml"))?;
    Ok(DeepseekHarnessConfig {
        api_key_configured: api_key_configured(&credentials),
        base_url: base_url_from_settings(&settings),
        models: models_from_settings(&settings),
    })
}

#[tauri::command]
pub(crate) fn save_deepseek_harness_config(
    mut input: SaveDeepseekHarnessConfig,
) -> Result<DeepseekHarnessConfig, String> {
    validate_input(&mut input)?;
    let home = dsh_home()?;
    let settings_path = home.join("settings.yaml");
    let credentials_path = home.join(".credentials.yaml");
    let mut settings = read_yaml_mapping(&settings_path)?;
    let mut credentials = read_yaml_mapping(&credentials_path)?;
    update_settings(&mut settings, &input)?;
    update_credentials(&mut credentials, &input)?;
    crate::wise_paths::write_file_atomic(&settings_path, &serialize_yaml(&settings)?)?;
    crate::wise_paths::write_file_atomic(&credentials_path, &serialize_yaml(&credentials)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&settings_path, fs::Permissions::from_mode(0o600))
            .map_err(|err| format!("设置配置文件权限失败：{err}"))?;
        fs::set_permissions(&credentials_path, fs::Permissions::from_mode(0o600))
            .map_err(|err| format!("设置凭据文件权限失败：{err}"))?;
    }
    Ok(DeepseekHarnessConfig {
        api_key_configured: api_key_configured(&credentials),
        base_url: input.base_url,
        models: input.models,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_preserves_unrelated_settings_and_credentials() {
        let mut settings: Value = serde_yaml::from_str(
            "onboarding:\n  complete: true\nllm-deepseek:\n  models:\n    - id: custom-chat\n      modalities:\n        input: [text, image]\n",
        )
        .unwrap();
        let mut credentials: Value = serde_yaml::from_str(
            "version: 1\nrefs:\n  OTHER_KEY: keep-me\nrecords:\n  sample:\n    token: preserved\n",
        )
        .unwrap();
        let input = SaveDeepseekHarnessConfig {
            api_key: Some("sk-test".to_string()),
            clear_api_key: false,
            base_url: "https://example.test/v1".to_string(),
            models: vec![DeepseekHarnessModelConfig {
                id: "custom-chat".to_string(),
                name: Some("Custom Chat".to_string()),
                description: None,
                context_window: Some(128_000),
                max_tokens: Some(8_192),
            }],
        };
        update_settings(&mut settings, &input).unwrap();
        update_credentials(&mut credentials, &input).unwrap();

        assert_eq!(settings["onboarding"]["complete"].as_bool(), Some(true));
        assert_eq!(
            settings[SETTINGS_NAMESPACE]["baseURL"].as_str(),
            Some("https://example.test/v1")
        );
        assert_eq!(
            settings[SETTINGS_NAMESPACE]["models"][0]["id"].as_str(),
            Some("custom-chat")
        );
        assert_eq!(
            settings[SETTINGS_NAMESPACE]["models"][0]["modalities"]["input"][1].as_str(),
            Some("image")
        );
        assert_eq!(credentials["refs"]["OTHER_KEY"].as_str(), Some("keep-me"));
        assert_eq!(credentials["refs"][API_KEY_REF].as_str(), Some("sk-test"));
        assert_eq!(
            credentials["records"]["sample"]["token"].as_str(),
            Some("preserved")
        );
    }

    #[test]
    fn clear_api_key_does_not_remove_other_refs() {
        let mut credentials: Value = serde_yaml::from_str(
            "version: 1\nrefs:\n  DEEPSEEK_API_KEY: secret\n  OTHER_KEY: keep-me\n",
        )
        .unwrap();
        let input = SaveDeepseekHarnessConfig {
            api_key: None,
            clear_api_key: true,
            base_url: DEFAULT_BASE_URL.to_string(),
            models: builtin_models(),
        };
        update_credentials(&mut credentials, &input).unwrap();
        assert!(credentials["refs"].get(API_KEY_REF).is_none());
        assert_eq!(credentials["refs"]["OTHER_KEY"].as_str(), Some("keep-me"));
    }

    #[test]
    fn missing_model_override_returns_builtin_catalog() {
        let settings: Value = serde_yaml::from_str("onboarding: {}\n").unwrap();
        let models = models_from_settings(&settings);
        assert_eq!(models.len(), 4);
        assert_eq!(models[0].id, "deepseek-flash");
    }
}
