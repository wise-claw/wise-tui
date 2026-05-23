//! Claude Code 模型配置档案：存于 `app_settings`，应用时写入用户级 `settings.json`。

use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::claude_config_dir::user_claude_dir;
use crate::wise_db::WiseDb;

const STORE_SETTINGS_KEY: &str = "claude_model_profiles_v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeModelProfile {
    pub id: String,
    /// 供应商/公司（与 CC Switch 供应商名称或预设一致）。
    #[serde(default)]
    pub company: String,
    pub name: String,
    pub model_id: String,
    /// 该档案对应的 Claude Code `settings.json` 片段（完整对象 JSON）。
    pub settings_json: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeModelProfileStore {
    pub(crate) profiles: Vec<ClaudeModelProfile>,
    active_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeModelProfileStoreView {
    pub profiles: Vec<ClaudeModelProfile>,
    pub active_profile_id: Option<String>,
    pub effective_model: Option<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn load_store(db: &WiseDb) -> ClaudeModelProfileStore {
    let Ok(Some(raw)) = db.get_setting(STORE_SETTINGS_KEY) else {
        return ClaudeModelProfileStore::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub(crate) fn save_store(db: &WiseDb, store: &ClaudeModelProfileStore) -> Result<(), String> {
    let raw = serde_json::to_string(store).map_err(|e| e.to_string())?;
    db.set_setting(STORE_SETTINGS_KEY, &raw)
}

fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    if text.trim().is_empty() {
        return Some(serde_json::json!({}));
    }
    serde_json::from_str(&text).ok()
}

/// 与 Claude Code / CC Switch 一致：优先 `env.ANTHROPIC_MODEL`，其次其他 `env.*MODEL*` 与顶层 `model`。
pub(crate) fn read_effective_model(v: &serde_json::Value) -> Option<String> {
    if let Some(env) = v.get("env").and_then(|e| e.as_object()) {
        const PREFERRED_ENV_KEYS: &[&str] = &[
            "ANTHROPIC_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "ANTHROPIC_REASONING_MODEL",
            "ANTHROPIC_SMALL_FAST_MODEL",
        ];
        for key in PREFERRED_ENV_KEYS {
            if let Some(m) = env.get(*key).and_then(|x| x.as_str()) {
                let t = m.trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
        for (key, val) in env {
            if key.contains("MODEL") {
                if let Some(m) = val.as_str() {
                    let t = m.trim();
                    if !t.is_empty() {
                        return Some(t.to_string());
                    }
                }
            }
        }
    }
    v.get("model")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// CC Switch 切换供应商时常见的模型 env 键（切换时统一写入同一 model id）。
const CC_SWITCH_MODEL_ENV_KEYS: &[&str] = &[
    "ANTHROPIC_MODEL",
    "ANTHROPIC_REASONING_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
];

/// 将解析后的 settings 中的模型选择对齐到单一 model id（写入 env 与顶层 `model`）。
fn sync_claude_code_model_selection(root: &mut serde_json::Value, model_id: &str) -> Result<(), String> {
    let mid = model_id.trim();
    if mid.is_empty() {
        return Err("无法解析有效模型 ID".to_string());
    }
    let obj = root
        .as_object_mut()
        .ok_or_else(|| "settings 根节点不是对象".to_string())?;
    let env = obj
        .entry("env")
        .or_insert_with(|| serde_json::json!({}));
    let env_obj = env
        .as_object_mut()
        .ok_or_else(|| "settings.env 不是对象".to_string())?;

    let has_model_env = env_obj
        .keys()
        .any(|k| k.contains("MODEL") || CC_SWITCH_MODEL_ENV_KEYS.contains(&k.as_str()));
    if has_model_env {
        for key in CC_SWITCH_MODEL_ENV_KEYS {
            env_obj.insert(key.to_string(), serde_json::Value::String(mid.to_string()));
        }
    } else {
        env_obj.insert(
            "ANTHROPIC_MODEL".to_string(),
            serde_json::Value::String(mid.to_string()),
        );
    }
    obj.insert(
        "model".to_string(),
        serde_json::Value::String(mid.to_string()),
    );
    push_available_model(root, mid);
    Ok(())
}

fn push_available_model(root: &mut serde_json::Value, model_id: &str) {
    let mid = model_id.trim();
    if mid.is_empty() {
        return;
    }
    let Some(obj) = root.as_object_mut() else {
        return;
    };
    let arr = obj
        .entry("availableModels")
        .or_insert_with(|| serde_json::json!([]));
    let Some(models) = arr.as_array_mut() else {
        *arr = serde_json::json!([mid]);
        return;
    };
    let key = mid.to_lowercase();
    if !models.iter().any(|v| {
        v.as_str()
            .map(|s| s.trim().to_lowercase() == key)
            .unwrap_or(false)
    }) {
        models.push(serde_json::Value::String(mid.to_string()));
    }
}

fn apply_profile_settings_to_value(_root: serde_json::Value, profile: &ClaudeModelProfile) -> Result<serde_json::Value, String> {
    let mut parsed: serde_json::Value =
        serde_json::from_str(profile.settings_json.trim()).map_err(|e| format!("档案 settingsJson 无效: {e}"))?;
    if !parsed.is_object() {
        return Err("档案 settingsJson 顶层必须是对象".to_string());
    }
    let model_id = read_effective_model(&parsed)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            let mid = profile.model_id.trim();
            if mid.is_empty() {
                None
            } else {
                Some(mid.to_string())
            }
        })
        .ok_or_else(|| "档案中未找到模型 ID（请检查 env.ANTHROPIC_MODEL 等）".to_string())?;
    sync_claude_code_model_selection(&mut parsed, &model_id)?;
    Ok(parsed)
}

fn write_user_settings_json(value: &serde_json::Value) -> Result<(), String> {
    let path = user_claude_dir().join("settings.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let out = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    crate::wise_paths::write_file_atomic(&path, &out)
}

fn apply_profile_to_disk(profile: &ClaudeModelProfile) -> Result<(), String> {
    let path = user_claude_dir().join("settings.json");
    let current = read_json_file(&path).unwrap_or_else(|| serde_json::json!({}));
    let merged = apply_profile_settings_to_value(current, profile)?;
    write_user_settings_json(&merged)
}

fn effective_model_from_disk() -> Option<String> {
    let path = user_claude_dir().join("settings.json");
    read_json_file(&path).and_then(|v| read_effective_model(&v))
}

pub(crate) fn store_view(db: &WiseDb) -> ClaudeModelProfileStoreView {
    let store = load_store(db);
    ClaudeModelProfileStoreView {
        profiles: store.profiles.clone(),
        active_profile_id: store.active_profile_id.clone(),
        effective_model: effective_model_from_disk(),
    }
}

#[tauri::command]
pub(crate) fn get_claude_model_profile_store(
    db: tauri::State<'_, WiseDb>,
) -> Result<ClaudeModelProfileStoreView, String> {
    Ok(store_view(&db))
}

#[tauri::command]
pub(crate) fn upsert_claude_model_profile(
    db: tauri::State<'_, WiseDb>,
    profile: ClaudeModelProfile,
) -> Result<ClaudeModelProfileStoreView, String> {
    let name = profile.name.trim();
    let model_id = profile.model_id.trim();
    if name.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if model_id.is_empty() {
        return Err("模型 ID 不能为空".to_string());
    }
    if profile.settings_json.trim().is_empty() {
        return Err("settingsJson 不能为空".to_string());
    }
    let _: serde_json::Value = serde_json::from_str(profile.settings_json.trim())
        .map_err(|e| format!("settingsJson 不是合法 JSON: {e}"))?;

    let mut store = load_store(&db);
    let now = now_ms();
    let id = if profile.id.trim().is_empty() {
        Uuid::new_v4().to_string()
    } else {
        profile.id.trim().to_string()
    };

    if let Some(slot) = store.profiles.iter_mut().find(|p| p.id == id) {
        slot.company = profile.company.trim().to_string();
        slot.name = name.to_string();
        slot.model_id = model_id.to_string();
        slot.settings_json = profile.settings_json;
        slot.updated_at_ms = now;
    } else {
        store.profiles.push(ClaudeModelProfile {
            id: id.clone(),
            company: profile.company.trim().to_string(),
            name: name.to_string(),
            model_id: model_id.to_string(),
            settings_json: profile.settings_json,
            created_at_ms: now,
            updated_at_ms: now,
        });
    }
    save_store(&db, &store)?;
    Ok(store_view(&db))
}

#[tauri::command]
pub(crate) fn delete_claude_model_profile(
    db: tauri::State<'_, WiseDb>,
    profile_id: String,
) -> Result<ClaudeModelProfileStoreView, String> {
    let id = profile_id.trim();
    if id.is_empty() {
        return Err("profileId 不能为空".to_string());
    }
    let mut store = load_store(&db);
    store.profiles.retain(|p| p.id != id);
    if store.active_profile_id.as_deref() == Some(id) {
        store.active_profile_id = None;
    }
    save_store(&db, &store)?;
    Ok(store_view(&db))
}

#[tauri::command]
pub(crate) fn apply_claude_model_profile(
    db: tauri::State<'_, WiseDb>,
    profile_id: String,
) -> Result<ClaudeModelProfileStoreView, String> {
    let id = profile_id.trim();
    let store = load_store(&db);
    let profile = store
        .profiles
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("未找到模型档案: {id}"))?
        .clone();
    apply_profile_to_disk(&profile)?;
    let mut next = store;
    next.active_profile_id = Some(id.to_string());
    if let Some(slot) = next.profiles.iter_mut().find(|p| p.id == id) {
        if let Some(mid) = effective_model_from_disk() {
            slot.model_id = mid;
            slot.updated_at_ms = now_ms();
        }
    }
    save_store(&db, &next)?;
    Ok(store_view(&db))
}

#[tauri::command]
pub(crate) fn get_claude_user_settings_json() -> Result<String, String> {
    let path = user_claude_dir().join("settings.json");
    if !path.is_file() {
        return Ok("{\n}\n".to_string());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if text.trim().is_empty() {
        return Ok("{\n}\n".to_string());
    }
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&v).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn save_claude_user_settings_json(
    db: tauri::State<'_, WiseDb>,
    settings_json: String,
    profile_id: Option<String>,
) -> Result<ClaudeModelProfileStoreView, String> {
    let trimmed = settings_json.trim();
    let v: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("settings.json 不是合法 JSON: {e}"))?;
    if !v.is_object() {
        return Err("settings.json 顶层必须是对象".to_string());
    }
    write_user_settings_json(&v)?;

    if let Some(pid) = profile_id.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        let mut store = load_store(&db);
        if let Some(slot) = store.profiles.iter_mut().find(|p| p.id == pid) {
            slot.settings_json = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
            if let Some(model) = read_effective_model(&v) {
                slot.model_id = model;
            }
            slot.updated_at_ms = now_ms();
            save_store(&db, &store)?;
        }
    }
    Ok(store_view(&db))
}

#[tauri::command]
pub(crate) fn create_claude_model_profile(
    db: tauri::State<'_, WiseDb>,
    company: Option<String>,
    name: String,
    settings_json: String,
) -> Result<ClaudeModelProfileStoreView, String> {
    let vendor = company.unwrap_or_default().trim().to_string();
    let label = name.trim();
    if label.is_empty() {
        return Err("名称不能为空".to_string());
    }
    let trimmed = settings_json.trim();
    if trimmed.is_empty() {
        return Err("配置 JSON 不能为空".to_string());
    }
    let v: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("配置 JSON 无效: {e}"))?;
    if !v.is_object() {
        return Err("配置 JSON 顶层必须是对象".to_string());
    }
    let pretty = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    let mid = read_effective_model(&v)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "custom".to_string());
    let now = now_ms();
    let profile = ClaudeModelProfile {
        id: Uuid::new_v4().to_string(),
        company: vendor,
        name: label.to_string(),
        model_id: mid,
        settings_json: pretty,
        created_at_ms: now,
        updated_at_ms: now,
    };
    let mut store = load_store(&db);
    store.profiles.push(profile);
    save_store(&db, &store)?;
    Ok(store_view(&db))
}

#[tauri::command]
pub(crate) fn create_claude_model_profile_from_current(
    db: tauri::State<'_, WiseDb>,
    company: Option<String>,
    name: String,
    model_id: Option<String>,
) -> Result<ClaudeModelProfileStoreView, String> {
    let vendor = company.unwrap_or_default().trim().to_string();
    let label = name.trim();
    if label.is_empty() {
        return Err("名称不能为空".to_string());
    }
    let path = user_claude_dir().join("settings.json");
    let current = read_json_file(&path).unwrap_or_else(|| serde_json::json!({}));
    let settings_json = serde_json::to_string_pretty(&current).map_err(|e| e.to_string())?;
    let mid = model_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| read_effective_model(&current))
        .unwrap_or_else(|| "sonnet".to_string());
    let now = now_ms();
    let profile = ClaudeModelProfile {
        id: Uuid::new_v4().to_string(),
        company: vendor,
        name: label.to_string(),
        model_id: mid,
        settings_json,
        created_at_ms: now,
        updated_at_ms: now,
    };
    let mut store = load_store(&db);
    store.profiles.push(profile);
    save_store(&db, &store)?;
    Ok(store_view(&db))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_profile_uses_settings_json_model_not_stale_profile_id() {
        let profile = ClaudeModelProfile {
            id: "p1".into(),
            company: "Bailian".into(),
            name: "Test".into(),
            model_id: "stale-wrong-id".into(),
            settings_json: r#"{
              "env": {
                "ANTHROPIC_BASE_URL": "http://127.0.0.1:8082",
                "ANTHROPIC_MODEL": "kimi-k2",
                "ANTHROPIC_DEFAULT_SONNET_MODEL": "old-sonnet"
              }
            }"#
            .into(),
            created_at_ms: 0,
            updated_at_ms: 0,
        };
        let out = apply_profile_settings_to_value(serde_json::json!({}), &profile).expect("merge");
        assert_eq!(out["env"]["ANTHROPIC_MODEL"].as_str(), Some("kimi-k2"));
        assert_eq!(
            out["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"].as_str(),
            Some("kimi-k2")
        );
        assert_eq!(out["model"].as_str(), Some("kimi-k2"));
    }

    #[test]
    fn apply_profile_falls_back_to_profile_model_id_when_env_missing() {
        let profile = ClaudeModelProfile {
            id: "p1".into(),
            company: "".into(),
            name: "Test".into(),
            model_id: "qwen3.6-plus".into(),
            settings_json: r#"{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:8082"}}"#.into(),
            created_at_ms: 0,
            updated_at_ms: 0,
        };
        let out = apply_profile_settings_to_value(serde_json::json!({}), &profile).expect("merge");
        assert_eq!(
            out["env"]["ANTHROPIC_MODEL"].as_str(),
            Some("qwen3.6-plus")
        );
    }
}
