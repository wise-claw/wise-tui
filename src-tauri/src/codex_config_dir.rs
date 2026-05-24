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
}

static CODEX_DISK_CACHE: Mutex<Option<CodexDiskCache>> = Mutex::new(None);

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
    if let Ok(mut guard) = CODEX_DISK_CACHE.lock() {
        *guard = Some(CodexDiskCache {
            auth_mtime,
            config_mtime,
            envelope: envelope.clone(),
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

pub fn apply_codex_profile_envelope(envelope: &CodexProfileEnvelope) -> Result<(), String> {
    write_auth_json(&envelope.auth)?;
    write_config_toml(&envelope.config)?;
    invalidate_codex_disk_cache();
    Ok(())
}

pub fn effective_codex_model_from_disk() -> Option<String> {
    read_effective_codex_model_from_envelope(&read_codex_profile_envelope())
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
}
