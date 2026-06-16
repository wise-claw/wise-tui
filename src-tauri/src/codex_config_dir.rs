//! Codex CLI 用户级配置（`~/.codex/auth.json` + `config.toml`），与 CC Switch 供应商 envelope 对齐。

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub fn user_codex_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".codex"))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

/// Codex 0.134+ profile overlay：`~/.codex/{name}.config.toml`
pub fn codex_profile_v2_path(profile_name: &str) -> PathBuf {
    user_codex_dir().join(format!("{profile_name}.config.toml"))
}

fn read_text_file(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

fn file_mtime(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok()?.modified().ok()
}

#[derive(Clone)]
struct CodexDiskCache {
    auth_mtime: Option<SystemTime>,
    config_mtime: Option<SystemTime>,
    envelope: CodexProfileEnvelope,
    pretty: String,
}

static CODEX_DISK_CACHE: Mutex<Option<CodexDiskCache>> = Mutex::new(None);

#[allow(dead_code)]
pub(crate) fn invalidate_codex_disk_cache() {
    if let Ok(mut guard) = CODEX_DISK_CACHE.lock() {
        *guard = None;
    }
}

fn read_codex_profile_envelope_fresh() -> CodexProfileEnvelope {
    let dir = user_codex_dir();
    let auth_path = dir.join("auth.json");
    let config_path = dir.join("config.toml");

    let auth = read_text_file(&auth_path)
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();

    let config = read_text_file(&config_path).unwrap_or_default();

    CodexProfileEnvelope { auth, config }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexProfileEnvelope {
    #[serde(default)]
    pub auth: Map<String, Value>,
    #[serde(default)]
    pub config: String,
}

pub fn read_codex_profile_envelope() -> CodexProfileEnvelope {
    let dir = user_codex_dir();
    let auth_path = dir.join("auth.json");
    let config_path = dir.join("config.toml");
    let auth_mtime = file_mtime(&auth_path);
    let config_mtime = file_mtime(&config_path);

    if let Ok(guard) = CODEX_DISK_CACHE.lock() {
        if let Some(cache) = guard.as_ref() {
            if cache.auth_mtime == auth_mtime && cache.config_mtime == config_mtime {
                return cache.envelope.clone();
            }
        }
    }

    let envelope = read_codex_profile_envelope_fresh();
    let pretty = codex_profile_envelope_to_json(&envelope).unwrap_or_else(|_| "{}".to_string());
    if let Ok(mut guard) = CODEX_DISK_CACHE.lock() {
        *guard = Some(CodexDiskCache {
            auth_mtime,
            config_mtime,
            envelope: envelope.clone(),
            pretty,
        });
    }
    envelope
}

pub fn codex_profile_envelope_to_json(envelope: &CodexProfileEnvelope) -> Result<String, String> {
    serde_json::to_string_pretty(envelope).map_err(|e| e.to_string())
}

pub fn parse_codex_profile_envelope(raw: &str) -> Result<CodexProfileEnvelope, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("配置 JSON 不能为空".to_string());
    }
    let value: Value = serde_json::from_str(trimmed).map_err(|e| format!("配置 JSON 无效: {e}"))?;
    let obj = value
        .as_object()
        .ok_or_else(|| "Codex 配置顶层必须是对象".to_string())?;
    if !obj.contains_key("auth") && !obj.contains_key("config") {
        return Err("Codex 配置需包含 auth 与 config 字段（与 CC Switch 一致）".to_string());
    }
    serde_json::from_value(value).map_err(|e| format!("Codex 配置结构无效: {e}"))
}

/// 从 `config.toml` 文本解析 `model = "..."` / `model="..."`。
pub fn read_effective_codex_model(config: &str) -> Option<String> {
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        let rest = trimmed
            .strip_prefix("model")
            .and_then(|s| s.trim_start().strip_prefix('='))
            .map(str::trim);
        let Some(rest) = rest else {
            continue;
        };
        let unquoted = rest
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .trim();
        if !unquoted.is_empty() {
            return Some(unquoted.to_string());
        }
    }
    None
}

pub fn read_effective_codex_model_from_envelope(envelope: &CodexProfileEnvelope) -> Option<String> {
    read_effective_codex_model(&envelope.config)
}

fn auth_maps_equal(a: &Map<String, Value>, b: &Map<String, Value>) -> bool {
    a == b
}

/// 在现有 `config.toml` 中替换或插入 `model = "..."` 行，保留其余配置。
pub fn patch_codex_config_model(config: &str, new_model: &str) -> String {
    let model = new_model.trim();
    let mut replaced = false;
    let mut lines: Vec<String> = config.lines().map(str::to_string).collect();
    for line in lines.iter_mut() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with("model") && trimmed.contains('=') {
            *line = format!("model = \"{model}\"");
            replaced = true;
            break;
        }
    }
    if !replaced {
        lines.insert(0, format!("model = \"{model}\""));
    }
    let mut out = lines.join("\n");
    if config.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// 仅按 envelope 中存在的 key 覆盖 current.auth；其他键（用户自定）保留。
fn merge_auth_maps(current: &Map<String, Value>, overlay: &Map<String, Value>) -> Map<String, Value> {
    let mut out = current.clone();
    for (k, v) in overlay {
        out.insert(k.clone(), v.clone());
    }
    out
}

fn apply_codex_profile_envelope_inner(envelope: &CodexProfileEnvelope) -> Result<(), String> {
    let current = read_codex_profile_envelope();
    // 首次安装（当前 config.toml 为空）：直接写入 envelope，没有用户数据可冲。
    if current.config.trim().is_empty() {
        write_auth_json(&envelope.auth)?;
        write_config_toml(&envelope.config)?;
        return warm_codex_disk_cache(envelope);
    }

    // 非首次：保守地只 patch model 行（保留其他用户配置）+ 合并 auth.json（保留自定 key）。
    let mut next_config = current.config.clone();
    if let Some(new_model) = read_effective_codex_model(&envelope.config) {
        let patched = patch_codex_config_model(&current.config, &new_model);
        if patched != current.config {
            write_config_toml(&patched)?;
            next_config = patched;
        }
    }
    let merged_auth = merge_auth_maps(&current.auth, &envelope.auth);
    if !auth_maps_equal(&current.auth, &merged_auth) {
        write_auth_json(&merged_auth)?;
    }
    let merged = CodexProfileEnvelope {
        auth: merged_auth,
        config: next_config,
    };
    warm_codex_disk_cache(&merged)
}

pub fn apply_codex_profile_envelope(envelope: &CodexProfileEnvelope) -> Result<(), String> {
    apply_codex_profile_envelope_inner(envelope)
}

fn write_auth_json(auth: &Map<String, Value>) -> Result<(), String> {
    let path = user_codex_dir().join("auth.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let out = serde_json::to_string_pretty(&Value::Object(auth.clone())).map_err(|e| e.to_string())?;
    crate::wise_paths::write_file_atomic(&path, &out)
}

fn write_config_toml(config: &str) -> Result<(), String> {
    let path = user_codex_dir().join("config.toml");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    crate::wise_paths::write_file_atomic(&path, config)
}

fn warm_codex_disk_cache(envelope: &CodexProfileEnvelope) -> Result<(), String> {
    let dir = user_codex_dir();
    let auth_mtime = file_mtime(&dir.join("auth.json"));
    let config_mtime = file_mtime(&dir.join("config.toml"));
    let pretty = codex_profile_envelope_to_json(envelope)?;
    if let Ok(mut guard) = CODEX_DISK_CACHE.lock() {
        *guard = Some(CodexDiskCache {
            auth_mtime,
            config_mtime,
            envelope: envelope.clone(),
            pretty,
        });
    }
    Ok(())
}

pub fn effective_codex_model_from_disk() -> Option<String> {
    read_effective_codex_model_from_envelope(&read_codex_profile_envelope())
}

pub fn read_codex_user_settings_pretty() -> String {
    let dir = user_codex_dir();
    let auth_path = dir.join("auth.json");
    let config_path = dir.join("config.toml");
    let auth_mtime = file_mtime(&auth_path);
    let config_mtime = file_mtime(&config_path);
    if let Ok(guard) = CODEX_DISK_CACHE.lock() {
        if let Some(cache) = guard.as_ref() {
            if cache.auth_mtime == auth_mtime && cache.config_mtime == config_mtime {
                if cache.pretty.ends_with('\n') {
                    return cache.pretty.clone();
                }
                return format!("{}\n", cache.pretty);
            }
        }
    }
    let _ = read_codex_profile_envelope();
    if let Ok(guard) = CODEX_DISK_CACHE.lock() {
        if let Some(cache) = guard.as_ref() {
            if cache.pretty.ends_with('\n') {
                return cache.pretty.clone();
            }
            return format!("{}\n", cache.pretty);
        }
    }
    "{}\n".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_model_from_config_toml() {
        let config = r#"
model = "gpt-5.4"
model_reasoning_effort = "medium"
"#;
        assert_eq!(
            read_effective_codex_model(config).as_deref(),
            Some("gpt-5.4")
        );
    }

    #[test]
    fn parses_envelope_model() {
        let envelope = CodexProfileEnvelope {
            auth: Map::new(),
            config: "model=\"qwen3.5-plus\"\n".to_string(),
        };
        assert_eq!(
            read_effective_codex_model_from_envelope(&envelope).as_deref(),
            Some("qwen3.5-plus")
        );
    }

    #[test]
    fn patch_codex_config_model_replaces_existing_line() {
        let config = "model = \"old\"\nmodel_reasoning_effort = \"medium\"\n";
        let patched = patch_codex_config_model(config, "gpt-5.4");
        assert!(patched.contains("model = \"gpt-5.4\""));
        assert!(patched.contains("model_reasoning_effort"));
        assert!(!patched.contains("old"));
    }

    #[test]
    fn merge_auth_maps_preserves_user_keys() {
        let current: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "old-key",
            "MY_TOKEN": "keep-me",
            "OPENAI_ORG_ID": "org-1"
        }))
        .expect("parse current");
        let overlay: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "new-key"
        }))
        .expect("parse overlay");
        let merged = merge_auth_maps(&current, &overlay);
        // overlay 提供的 key 被覆盖
        assert_eq!(merged["OPENAI_API_KEY"].as_str(), Some("new-key"));
        // current 自定的 key 必须保留
        assert_eq!(merged["MY_TOKEN"].as_str(), Some("keep-me"));
        assert_eq!(merged["OPENAI_ORG_ID"].as_str(), Some("org-1"));
    }

    #[test]
    fn patch_codex_config_model_preserves_unknown_sections() {
        // 用户的 config.toml 含非 model 行（自定义 section / 注释），patch 必须只动 model 行。
        let current = r#"# user comment
model = "gpt-5"

[custom_section]
foo = "bar"
nested = { a = 1 }
"#;
        let patched = patch_codex_config_model(current, "gpt-5.4");
        assert!(patched.contains("model = \"gpt-5.4\""));
        assert!(!patched.contains("model = \"gpt-5\""));
        // 自定义 section / 注释必须原样保留
        assert!(patched.contains("# user comment"));
        assert!(patched.contains("[custom_section]"));
        assert!(patched.contains("foo = \"bar\""));
        assert!(patched.contains("nested = { a = 1 }"));
    }

    #[test]
    fn apply_envelope_preserves_user_config_and_extra_auth_keys() {
        // 模拟当前 config.toml / auth.json 含用户内容；验证 patch + merge 路径不丢用户数据。
        let envelope = CodexProfileEnvelope {
            auth: serde_json::from_value(serde_json::json!({
                "OPENAI_API_KEY": "new"
            }))
            .expect("envelope auth"),
            config: r#"model = "gpt-5.4""#.to_string(),
        };
        let current_config = r#"# user section
model = "gpt-5"
[custom]
foo = "bar"
"#;
        let current_auth: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "old",
            "MY_TOKEN": "secret"
        }))
        .expect("current auth");

        // 等价于 `apply_codex_profile_envelope_inner` 非首次路径上的两次合并操作。
        let patched = patch_codex_config_model(current_config, "gpt-5.4");
        assert!(patched.contains("[custom]"));
        assert!(patched.contains("foo = \"bar\""));
        assert!(patched.contains("model = \"gpt-5.4\""));

        let merged_auth = merge_auth_maps(&current_auth, &envelope.auth);
        assert_eq!(merged_auth["OPENAI_API_KEY"].as_str(), Some("new"));
        assert_eq!(merged_auth["MY_TOKEN"].as_str(), Some("secret"));
    }
}
