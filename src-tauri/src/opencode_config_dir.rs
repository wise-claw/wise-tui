//! OpenCode 用户级配置（`~/.config/opencode/opencode.json`）。

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde_json::{Map, Value, json};

pub fn user_opencode_config_path() -> PathBuf {
    dirs::config_dir()
        .map(|d| d.join("opencode").join("opencode.json"))
        .unwrap_or_else(|| PathBuf::from(".config/opencode/opencode.json"))
}

fn file_mtime(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok()?.modified().ok()
}

#[derive(Clone)]
struct OpencodeDiskState {
    mtime: Option<SystemTime>,
    config: Value,
    pretty: String,
    effective_model: Option<String>,
}

static OPENCODE_DISK_STATE: Mutex<Option<OpencodeDiskState>> = Mutex::new(None);

#[allow(dead_code)]
pub(crate) fn invalidate_opencode_disk_cache() {
    if let Ok(mut guard) = OPENCODE_DISK_STATE.lock() {
        *guard = None;
    }
}

fn read_opencode_config_fresh() -> OpencodeDiskState {
    let path = user_opencode_config_path();
    let mtime = file_mtime(&path);
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let config = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&text).unwrap_or_else(|_| json!({}))
    };
    let effective_model = read_effective_opencode_model(&config);
    let pretty = serde_json::to_string_pretty(&config).unwrap_or_else(|_| "{}".to_string());
    OpencodeDiskState {
        mtime,
        config,
        pretty,
        effective_model,
    }
}

fn load_opencode_disk_state(force_refresh: bool) -> OpencodeDiskState {
    let path = user_opencode_config_path();
    let mtime = file_mtime(&path);
    if !force_refresh {
        if let Ok(guard) = OPENCODE_DISK_STATE.lock() {
            if let Some(state) = guard.as_ref() {
                if state.mtime == mtime {
                    return state.clone();
                }
            }
        }
    }
    let state = read_opencode_config_fresh();
    if let Ok(mut guard) = OPENCODE_DISK_STATE.lock() {
        *guard = Some(state.clone());
    }
    state
}

pub fn read_opencode_config_json() -> Value {
    load_opencode_disk_state(false).config
}

pub fn read_effective_opencode_model(value: &Value) -> Option<String> {
    value
        .get("model")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub fn effective_opencode_model_from_disk() -> Option<String> {
    load_opencode_disk_state(false).effective_model
}

pub fn validate_opencode_settings_json(raw: &str) -> Result<Value, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("配置 JSON 不能为空".to_string());
    }
    let value: Value =
        serde_json::from_str(trimmed).map_err(|e| format!("OpenCode 配置 JSON 无效: {e}"))?;
    if !value.is_object() {
        return Err("OpenCode 配置顶层必须是对象".to_string());
    }
    Ok(value)
}

fn merge_provider_maps(current: &mut Map<String, Value>, profile: &Map<String, Value>) {
    for (key, value) in profile {
        current.insert(key.clone(), value.clone());
    }
}

/// 将档案中的 provider / model 等写入当前全局配置，保留 mcp、plugin 等未覆盖字段。
pub fn merge_opencode_profile_into_current(current: Value, profile: &Value) -> Value {
    let mut out = if current.is_object() {
        current
    } else {
        json!({})
    };
    let Some(out_obj) = out.as_object_mut() else {
        return profile.clone();
    };
    let Some(prof_obj) = profile.as_object() else {
        return out;
    };

    if let Some(provider) = prof_obj.get("provider").and_then(|v| v.as_object()) {
        let entry = out_obj
            .entry("provider")
            .or_insert_with(|| json!({}));
        if let Some(entry_obj) = entry.as_object_mut() {
            merge_provider_maps(entry_obj, provider);
        } else {
            out_obj.insert("provider".to_string(), json!(provider));
        }
    }

    for key in ["model", "small_model", "disabled_providers", "enabled_providers"] {
        if let Some(value) = prof_obj.get(key) {
            out_obj.insert(key.to_string(), value.clone());
        }
    }

    out
}

pub fn sync_opencode_model_selection(root: &mut Value, model_id: &str) -> Result<(), String> {
    let mid = model_id.trim();
    if mid.is_empty() {
        return Err("无法解析有效 OpenCode 模型 ID（provider/model）".to_string());
    }
    let obj = root
        .as_object_mut()
        .ok_or_else(|| "OpenCode 配置根节点不是对象".to_string())?;
    obj.insert("model".to_string(), Value::String(mid.to_string()));
    Ok(())
}

pub fn apply_opencode_profile_settings(current: Value, profile: &Value, model_id: &str) -> Result<Value, String> {
    let mut merged = merge_opencode_profile_into_current(current, profile);
    if read_effective_opencode_model(&merged).is_none() {
        sync_opencode_model_selection(&mut merged, model_id)?;
    }
    Ok(merged)
}

pub fn write_opencode_config_json(value: &Value) -> Result<(), String> {
    if !value.is_object() {
        return Err("OpenCode 配置顶层必须是对象".to_string());
    }
    let path = user_opencode_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let out = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    crate::wise_paths::write_file_atomic(&path, &format!("{out}\n"))?;
    warm_opencode_disk_cache(value, &path);
    Ok(())
}

fn warm_opencode_disk_cache(value: &Value, path: &Path) {
    let mtime = file_mtime(path);
    let effective_model = read_effective_opencode_model(value);
    let pretty = serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".to_string());
    if let Ok(mut guard) = OPENCODE_DISK_STATE.lock() {
        *guard = Some(OpencodeDiskState {
            mtime,
            config: value.clone(),
            pretty,
            effective_model,
        });
    }
}

/// 合并并写入 OpenCode 全局配置（复用内存缓存中的 current，避免重复读盘）。
pub fn apply_opencode_profile_to_disk(profile: &Value, model_id: &str) -> Result<(), String> {
    let current = read_opencode_config_json();
    let merged = apply_opencode_profile_settings(current, profile, model_id)?;
    write_opencode_config_json(&merged)
}

/// 将 OpenCode 全局 `model` 与代理/档案选择对齐；已一致时跳过写盘。
pub fn mirror_opencode_global_model(model_id: &str) -> Result<bool, String> {
    let mid = model_id.trim();
    if mid.is_empty() {
        return Ok(false);
    }
    let existing = effective_opencode_model_from_disk().unwrap_or_default();
    if existing == mid {
        return Ok(false);
    }
    let mut current = read_opencode_config_json();
    sync_opencode_model_selection(&mut current, mid)?;
    write_opencode_config_json(&current)?;
    Ok(true)
}

pub fn opencode_config_json_to_pretty(value: &Value) -> Result<String, String> {
    serde_json::to_string_pretty(value).map_err(|e| e.to_string())
}

pub fn read_opencode_user_settings_pretty() -> String {
    let state = load_opencode_disk_state(false);
    if state.pretty.ends_with('\n') {
        state.pretty
    } else {
        format!("{}\n", state.pretty)
    }
}

/// 从 `opencode.json` 提取可选模型（顶层 `model` + `provider.*.models`）。
pub fn list_opencode_models_from_config() -> Vec<(String, String)> {
    let config = read_opencode_config_json();
    let mut out: Vec<(String, String)> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();

    let mut push = |id: String, display: String| {
        let trimmed = id.trim().to_string();
        if trimmed.is_empty() || !seen.insert(trimmed.clone()) {
            return;
        }
        let label = {
            let d = display.trim();
            if d.is_empty() {
                trimmed.clone()
            } else {
                d.to_string()
            }
        };
        out.push((trimmed, label));
    };

    if let Some(model) = read_effective_opencode_model(&config) {
        push(model.clone(), model);
    }

    if let Some(provider) = config.get("provider").and_then(Value::as_object) {
        for (provider_id, entry) in provider {
            let Some(models) = entry.get("models").and_then(Value::as_object) else {
                continue;
            };
            for (model_name, meta) in models {
                let id = format!("{provider_id}/{model_name}");
                let display = meta
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or(model_name)
                    .to_string();
                push(id, display);
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_model_field() {
        let config = json!({ "model": "minimax/MiniMax-M2.7-highspeed" });
        assert_eq!(
            read_effective_opencode_model(&config).as_deref(),
            Some("minimax/MiniMax-M2.7-highspeed")
        );
    }

    #[test]
    fn merge_preserves_mcp_and_overrides_provider() {
        let current = json!({
            "mcp": { "codegraph": { "enabled": true } },
            "plugin": ["oh-my-openagent@latest"],
            "provider": { "old": { "name": "Old" } },
            "model": "anthropic/claude-sonnet-4-5"
        });
        let profile = json!({
            "provider": {
                "minimax": {
                    "name": "MiniMax",
                    "models": { "MiniMax-M2.7-highspeed": { "name": "MiniMax-M2.7-highspeed" } }
                }
            },
            "model": "minimax/MiniMax-M2.7-highspeed"
        });
        let merged = merge_opencode_profile_into_current(current, &profile);
        assert!(merged.get("mcp").is_some());
        assert_eq!(merged["plugin"][0].as_str(), Some("oh-my-openagent@latest"));
        assert!(merged["provider"]["minimax"].is_object());
        assert_eq!(
            merged["model"].as_str(),
            Some("minimax/MiniMax-M2.7-highspeed")
        );
    }

    #[test]
    fn apply_profile_settings_sets_model_from_profile_json() {
        let profile = json!({ "model": "minimax/MiniMax-M2.7-highspeed" });
        let merged = apply_opencode_profile_settings(json!({}), &profile, "fallback/model").unwrap();
        assert_eq!(
            merged["model"].as_str(),
            Some("minimax/MiniMax-M2.7-highspeed")
        );
    }
}
