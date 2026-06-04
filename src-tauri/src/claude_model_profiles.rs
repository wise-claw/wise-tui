//! Claude Code 模型配置档案：存于 `app_settings`，应用时写入用户级 `settings.json`。

use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::claude_config_dir::user_claude_dir;
use crate::codex_config_dir::{
    apply_codex_profile_envelope, codex_profile_envelope_to_json, effective_codex_model_from_disk,
    parse_codex_profile_envelope, read_codex_user_settings_pretty,
    read_effective_codex_model_from_envelope, user_codex_dir,
};
use crate::opencode_config_dir::{
    apply_opencode_profile_to_disk, effective_opencode_model_from_disk,
    opencode_config_json_to_pretty, read_effective_opencode_model,
    read_opencode_user_settings_pretty, user_opencode_config_path, validate_opencode_settings_json,
};
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
    /// 模型供应商官网（可选），列表中可一键跳转。
    #[serde(default)]
    pub official_website_url: String,
    pub model_id: String,
    /// Claude：`settings.json`；Codex：`{ auth, config }` envelope（与 CC Switch 一致）。
    pub settings_json: String,
    /// 运行引擎：`claude` | `codex` | `opencode`。
    #[serde(default = "default_profile_engine")]
    pub engine: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

fn default_profile_engine() -> String {
    "claude".to_string()
}

fn default_auto_failover_enabled() -> bool {
    true
}

fn normalize_profile_engine(raw: &str) -> &str {
    match raw.trim().to_lowercase().as_str() {
        "codex" => "codex",
        "opencode" => "opencode",
        _ => "claude",
    }
}

fn profile_engine(profile: &ClaudeModelProfile) -> &str {
    normalize_profile_engine(&profile.engine)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeModelProfileStore {
    pub(crate) profiles: Vec<ClaudeModelProfile>,
    active_profile_id: Option<String>,
    #[serde(default)]
    active_codex_profile_id: Option<String>,
    #[serde(default)]
    active_opencode_profile_id: Option<String>,
    /// 限流 / API 错误时自动切换到同引擎下一档案。
    #[serde(default = "default_auto_failover_enabled")]
    auto_failover_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeModelProfileStoreView {
    pub profiles: Vec<ClaudeModelProfile>,
    pub active_profile_id: Option<String>,
    pub active_codex_profile_id: Option<String>,
    pub active_opencode_profile_id: Option<String>,
    #[serde(default = "default_auto_failover_enabled")]
    pub auto_failover_enabled: bool,
    pub effective_model: Option<String>,
    pub effective_codex_model: Option<String>,
    pub effective_opencode_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfileEffectiveModels {
    pub effective_model: Option<String>,
    pub effective_codex_model: Option<String>,
    pub effective_opencode_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfileFailoverResult {
    pub store: ClaudeModelProfileStoreView,
    pub applied_profile_id: String,
    pub profile_name: String,
    pub model_id: String,
    pub engine: String,
}

fn effective_models_from_disk() -> ModelProfileEffectiveModels {
    let mtimes = model_profile_disk_mtimes();
    if let Ok(guard) = EFFECTIVE_MODELS_SNAPSHOT.lock() {
        if let Some(snapshot) = guard.as_ref() {
            if snapshot.mtimes.matches(&mtimes) {
                return snapshot.models.clone();
            }
        }
    }
    let models = ModelProfileEffectiveModels {
        effective_model: effective_model_from_disk(),
        effective_codex_model: effective_codex_model_from_disk(),
        effective_opencode_model: effective_opencode_model_from_disk(),
    };
    if let Ok(mut guard) = EFFECTIVE_MODELS_SNAPSHOT.lock() {
        *guard = Some(EffectiveModelsSnapshot {
            mtimes,
            models: models.clone(),
        });
    }
    models
}

#[derive(Clone, Copy)]
struct ModelProfileDiskMtimes {
    claude_settings: Option<SystemTime>,
    codex_auth: Option<SystemTime>,
    codex_config: Option<SystemTime>,
    opencode_config: Option<SystemTime>,
}

impl ModelProfileDiskMtimes {
    fn matches(self, other: &Self) -> bool {
        self.claude_settings == other.claude_settings
            && self.codex_auth == other.codex_auth
            && self.codex_config == other.codex_config
            && self.opencode_config == other.opencode_config
    }
}

#[derive(Clone)]
struct EffectiveModelsSnapshot {
    mtimes: ModelProfileDiskMtimes,
    models: ModelProfileEffectiveModels,
}

static EFFECTIVE_MODELS_SNAPSHOT: Mutex<Option<EffectiveModelsSnapshot>> = Mutex::new(None);

fn model_profile_disk_mtimes() -> ModelProfileDiskMtimes {
    let codex_dir = user_codex_dir();
    ModelProfileDiskMtimes {
        claude_settings: file_mtime(&user_claude_dir().join("settings.json")),
        codex_auth: file_mtime(&codex_dir.join("auth.json")),
        codex_config: file_mtime(&codex_dir.join("config.toml")),
        opencode_config: file_mtime(&user_opencode_config_path()),
    }
}

#[derive(Clone)]
struct ProfileStoreCache {
    raw: String,
    store: ClaudeModelProfileStore,
}

static PROFILE_STORE_CACHE: Mutex<Option<ProfileStoreCache>> = Mutex::new(None);

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

const PROFILE_LABEL_MAX_LEN: usize = 80;

/// 公司/名称展示标签：允许数字、点、横线等；禁止路径分隔符与控制字符。
fn validate_profile_label(value: &str, field: &str, required: bool) -> Result<(), String> {
    let trimmed = value.trim();
    if required && trimmed.is_empty() {
        return Err(format!("{field}不能为空"));
    }
    if trimmed.is_empty() {
        return Ok(());
    }
    if trimmed.chars().count() > PROFILE_LABEL_MAX_LEN {
        return Err(format!("{field}不能超过 {PROFILE_LABEL_MAX_LEN} 个字符"));
    }
    if trimmed.chars().any(|c| {
        c.is_control() || matches!(c, '/' | '\\' | '<' | '>' | '|')
    }) {
        return Err(format!("{field}不能包含 / \\ < > | 或不可见控制字符"));
    }
    Ok(())
}

fn validate_official_website_url(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    if trimmed.chars().count() > 512 {
        return Err("官网地址不能超过 512 个字符".to_string());
    }
    let lower = trimmed.to_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("官网地址需以 http:// 或 https:// 开头".to_string());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("官网地址不能包含不可见控制字符".to_string());
    }
    Ok(())
}

pub(crate) fn load_store(db: &WiseDb) -> ClaudeModelProfileStore {
    let raw = db
        .get_setting(STORE_SETTINGS_KEY)
        .ok()
        .flatten()
        .unwrap_or_default();
    if let Ok(guard) = PROFILE_STORE_CACHE.lock() {
        if let Some(cache) = guard.as_ref() {
            if cache.raw == raw {
                return cache.store.clone();
            }
        }
    }
    let store: ClaudeModelProfileStore = if raw.is_empty() {
        ClaudeModelProfileStore::default()
    } else {
        serde_json::from_str(&raw).unwrap_or_default()
    };
    if let Ok(mut guard) = PROFILE_STORE_CACHE.lock() {
        *guard = Some(ProfileStoreCache {
            raw,
            store: store.clone(),
        });
    }
    store
}

pub(crate) fn save_store(db: &WiseDb, store: &ClaudeModelProfileStore) -> Result<(), String> {
    let raw = serde_json::to_string(store).map_err(|e| e.to_string())?;
    db.set_setting(STORE_SETTINGS_KEY, &raw)?;
    if let Ok(mut guard) = PROFILE_STORE_CACHE.lock() {
        *guard = Some(ProfileStoreCache {
            raw,
            store: store.clone(),
        });
    }
    Ok(())
}

fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    if text.trim().is_empty() {
        return Some(serde_json::json!({}));
    }
    serde_json::from_str(&text).ok()
}

fn file_mtime(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok()?.modified().ok()
}

#[derive(Clone)]
struct ClaudeEffectiveModelCache {
    mtime: Option<SystemTime>,
    model: Option<String>,
}

static CLAUDE_EFFECTIVE_MODEL_CACHE: Mutex<Option<ClaudeEffectiveModelCache>> = Mutex::new(None);

#[derive(Clone)]
struct ClaudeSettingsPrettyCache {
    mtime: Option<SystemTime>,
    pretty: String,
}

static CLAUDE_SETTINGS_PRETTY_CACHE: Mutex<Option<ClaudeSettingsPrettyCache>> = Mutex::new(None);

#[allow(dead_code)]
fn invalidate_claude_effective_model_cache() {
    if let Ok(mut guard) = CLAUDE_EFFECTIVE_MODEL_CACHE.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = CLAUDE_SETTINGS_PRETTY_CACHE.lock() {
        *guard = None;
    }
}

fn read_claude_user_settings_pretty() -> Result<String, String> {
    let path = user_claude_dir().join("settings.json");
    if !path.is_file() {
        return Ok("{\n}\n".to_string());
    }
    let mtime = file_mtime(&path);
    if let Ok(guard) = CLAUDE_SETTINGS_PRETTY_CACHE.lock() {
        if let Some(cache) = guard.as_ref() {
            if cache.mtime == mtime {
                return Ok(cache.pretty.clone());
            }
        }
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if text.trim().is_empty() {
        return Ok("{\n}\n".to_string());
    }
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let pretty = format!(
        "{}\n",
        serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?
    );
    if let Ok(mut guard) = CLAUDE_SETTINGS_PRETTY_CACHE.lock() {
        *guard = Some(ClaudeSettingsPrettyCache { mtime, pretty: pretty.clone() });
    }
    Ok(pretty)
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

fn warm_claude_settings_disk_cache(value: &serde_json::Value, path: &Path) {
    let mtime = file_mtime(path);
    let model = read_effective_model(value);
    let pretty = match serde_json::to_string_pretty(value) {
        Ok(text) => format!("{text}\n"),
        Err(_) => "{\n}\n".to_string(),
    };
    if let Ok(mut guard) = CLAUDE_EFFECTIVE_MODEL_CACHE.lock() {
        *guard = Some(ClaudeEffectiveModelCache { mtime, model });
    }
    if let Ok(mut guard) = CLAUDE_SETTINGS_PRETTY_CACHE.lock() {
        *guard = Some(ClaudeSettingsPrettyCache { mtime, pretty });
    }
}

fn write_user_settings_json(value: &serde_json::Value) -> Result<(), String> {
    let path = user_claude_dir().join("settings.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let out = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    crate::wise_paths::write_file_atomic(&path, &out)?;
    warm_claude_settings_disk_cache(value, &path);
    Ok(())
}

fn resolve_profile_model_id(profile: &ClaudeModelProfile) -> Result<String, String> {
    if profile_engine(profile) == "codex" {
        let envelope = parse_codex_profile_envelope(&profile.settings_json)?;
        return read_effective_codex_model_from_envelope(&envelope)
            .filter(|s| !s.is_empty())
            .or_else(|| {
                let mid = profile.model_id.trim();
                if mid.is_empty() {
                    None
                } else {
                    Some(mid.to_string())
                }
            })
            .ok_or_else(|| "Codex 档案中未找到 model（请检查 config TOML）".to_string());
    }

    if profile_engine(profile) == "opencode" {
        let parsed = validate_opencode_settings_json(&profile.settings_json)?;
        return read_effective_opencode_model(&parsed)
            .filter(|s| !s.is_empty())
            .or_else(|| {
                let mid = profile.model_id.trim();
                if mid.is_empty() {
                    None
                } else {
                    Some(mid.to_string())
                }
            })
            .ok_or_else(|| "OpenCode 档案中未找到 model（格式 provider/model）".to_string());
    }

    let parsed: serde_json::Value =
        serde_json::from_str(profile.settings_json.trim()).map_err(|e| format!("档案 settingsJson 无效: {e}"))?;
    read_effective_model(&parsed)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            let mid = profile.model_id.trim();
            if mid.is_empty() {
                None
            } else {
                Some(mid.to_string())
            }
        })
        .ok_or_else(|| "档案中未找到模型 ID（请检查 env.ANTHROPIC_MODEL 等）".to_string())
}

/// 在 spawn `codex exec` 前将 Wise 当前激活的 Codex 档案写入 `~/.codex`（auth + config）。
pub(crate) fn ensure_active_codex_profile_applied(db: &WiseDb) -> Result<(), String> {
    let store = load_store(db);
    let active_id = match store.active_codex_profile_id.as_deref() {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => return Ok(()),
    };
    let profile = store
        .profiles
        .iter()
        .find(|p| p.id == active_id)
        .ok_or_else(|| format!("未找到 Codex 模型档案: {active_id}"))?;
    if profile_engine(profile) != "codex" {
        return Ok(());
    }
    apply_profile_to_disk(profile)
}

fn apply_profile_to_disk(profile: &ClaudeModelProfile) -> Result<(), String> {
    if profile_engine(profile) == "codex" {
        let envelope = parse_codex_profile_envelope(&profile.settings_json)?;
        return apply_codex_profile_envelope(&envelope);
    }

    if profile_engine(profile) == "opencode" {
        let profile_val = validate_opencode_settings_json(&profile.settings_json)?;
        let model_id = read_effective_opencode_model(&profile_val)
            .filter(|s| !s.is_empty())
            .or_else(|| {
                let mid = profile.model_id.trim();
                if mid.is_empty() {
                    None
                } else {
                    Some(mid.to_string())
                }
            })
            .ok_or_else(|| "OpenCode 档案中未找到 model（格式 provider/model）".to_string())?;
        return apply_opencode_profile_to_disk(&profile_val, &model_id);
    }

    let path = user_claude_dir().join("settings.json");
    let current = read_json_file(&path).unwrap_or_else(|| serde_json::json!({}));
    let merged = apply_profile_settings_to_value(current, profile)?;
    write_user_settings_json(&merged)
}

fn effective_model_from_disk() -> Option<String> {
    let path = user_claude_dir().join("settings.json");
    let mtime = file_mtime(&path);
    if let Ok(guard) = CLAUDE_EFFECTIVE_MODEL_CACHE.lock() {
        if let Some(cache) = guard.as_ref() {
            if cache.mtime == mtime {
                return cache.model.clone();
            }
        }
    }
    let model = read_json_file(&path).and_then(|v| read_effective_model(&v));
    if let Ok(mut guard) = CLAUDE_EFFECTIVE_MODEL_CACHE.lock() {
        *guard = Some(ClaudeEffectiveModelCache { mtime, model: model.clone() });
    }
    model
}

fn seed_effective_models_snapshot(models: &ModelProfileEffectiveModels) {
    let mtimes = model_profile_disk_mtimes();
    if let Ok(mut guard) = EFFECTIVE_MODELS_SNAPSHOT.lock() {
        *guard = Some(EffectiveModelsSnapshot {
            mtimes,
            models: models.clone(),
        });
    }
}

fn build_store_view(
    store: &ClaudeModelProfileStore,
    effective: ModelProfileEffectiveModels,
) -> ClaudeModelProfileStoreView {
    ClaudeModelProfileStoreView {
        profiles: store.profiles.clone(),
        active_profile_id: store.active_profile_id.clone(),
        active_codex_profile_id: store.active_codex_profile_id.clone(),
        active_opencode_profile_id: store.active_opencode_profile_id.clone(),
        auto_failover_enabled: store.auto_failover_enabled,
        effective_model: effective.effective_model,
        effective_codex_model: effective.effective_codex_model,
        effective_opencode_model: effective.effective_opencode_model,
    }
}

fn store_view_after_disk_write(store: &ClaudeModelProfileStore) -> ClaudeModelProfileStoreView {
    let effective = effective_models_from_disk();
    seed_effective_models_snapshot(&effective);
    build_store_view(store, effective)
}

pub(crate) fn store_view_from_store(store: &ClaudeModelProfileStore) -> ClaudeModelProfileStoreView {
    build_store_view(store, effective_models_from_disk())
}

pub(crate) fn store_view(db: &WiseDb) -> ClaudeModelProfileStoreView {
    store_view_from_store(&load_store(db))
}

#[tauri::command]
pub(crate) fn get_model_profile_effective_models() -> ModelProfileEffectiveModels {
    effective_models_from_disk()
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
    validate_profile_label(&profile.company, "公司", false)?;
    let name = profile.name.trim();
    validate_profile_label(name, "名称", true)?;
    validate_official_website_url(&profile.official_website_url)?;
    let model_id = profile.model_id.trim();
    if model_id.is_empty() {
        return Err("模型 ID 不能为空".to_string());
    }
    if profile.settings_json.trim().is_empty() {
        return Err("settingsJson 不能为空".to_string());
    }
    if profile_engine(&profile) == "codex" {
        parse_codex_profile_envelope(&profile.settings_json)?;
    } else if profile_engine(&profile) == "opencode" {
        validate_opencode_settings_json(&profile.settings_json)?;
    } else {
        let _: serde_json::Value = serde_json::from_str(profile.settings_json.trim())
            .map_err(|e| format!("settingsJson 不是合法 JSON: {e}"))?;
    }

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
        slot.official_website_url = profile.official_website_url.trim().to_string();
        slot.model_id = model_id.to_string();
        slot.settings_json = profile.settings_json;
        slot.engine = profile.engine.trim().to_string();
        slot.updated_at_ms = now;
    } else {
        store.profiles.push(ClaudeModelProfile {
            id: id.clone(),
            company: profile.company.trim().to_string(),
            name: name.to_string(),
            official_website_url: profile.official_website_url.trim().to_string(),
            model_id: model_id.to_string(),
            settings_json: profile.settings_json,
            engine: if profile.engine.trim().is_empty() {
                default_profile_engine()
            } else {
                profile.engine.trim().to_string()
            },
            created_at_ms: now,
            updated_at_ms: now,
        });
    }

    let saved = store
        .profiles
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "档案保存后未找到".to_string())?
        .clone();
    apply_profile_to_disk(&saved)?;

    if profile_engine(&saved) == "codex" {
        store.active_codex_profile_id = Some(id.clone());
    } else if profile_engine(&saved) == "opencode" {
        store.active_opencode_profile_id = Some(id.clone());
    } else {
        store.active_profile_id = Some(id.clone());
    }
    if let Some(slot) = store.profiles.iter_mut().find(|p| p.id == id) {
        if let Ok(mid) = resolve_profile_model_id(slot) {
            slot.model_id = mid;
            slot.updated_at_ms = now_ms();
        }
    }

    save_store(&db, &store)?;
    Ok(store_view_after_disk_write(&store))
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
    if store.active_codex_profile_id.as_deref() == Some(id) {
        store.active_codex_profile_id = None;
    }
    if store.active_opencode_profile_id.as_deref() == Some(id) {
        store.active_opencode_profile_id = None;
    }
    save_store(&db, &store)?;
    Ok(store_view_from_store(&store))
}

fn active_profile_id_for_engine<'a>(
    store: &'a ClaudeModelProfileStore,
    engine: &str,
) -> Option<&'a String> {
    match normalize_profile_engine(engine) {
        "codex" => store.active_codex_profile_id.as_ref(),
        "opencode" => store.active_opencode_profile_id.as_ref(),
        _ => store.active_profile_id.as_ref(),
    }
}

fn pick_next_failover_profile(
    store: &ClaudeModelProfileStore,
    engine: &str,
    exclude_profile_ids: &[String],
) -> Option<ClaudeModelProfile> {
    let engine_norm = normalize_profile_engine(engine);
    let exclude: std::collections::HashSet<&str> = exclude_profile_ids
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    let ordered: Vec<&ClaudeModelProfile> = store
        .profiles
        .iter()
        .filter(|p| profile_engine(p) == engine_norm)
        .collect();
    if ordered.is_empty() {
        return None;
    }
    let active_idx = active_profile_id_for_engine(store, engine_norm)
        .and_then(|active_id| ordered.iter().position(|p| p.id == *active_id))
        .unwrap_or(0);
    for offset in 1..=ordered.len() {
        let idx = (active_idx + offset) % ordered.len();
        let candidate = ordered[idx];
        if !exclude.contains(candidate.id.as_str()) {
            return Some(candidate.clone());
        }
    }
    None
}

fn reorder_profiles_for_engine(
    store: &mut ClaudeModelProfileStore,
    engine: &str,
    ordered_profile_ids: &[String],
) -> Result<(), String> {
    let engine_norm = normalize_profile_engine(engine);
    let engine_profiles: Vec<ClaudeModelProfile> = store
        .profiles
        .iter()
        .filter(|p| profile_engine(p) == engine_norm)
        .cloned()
        .collect();
    if engine_profiles.is_empty() {
        return Err("当前引擎没有可排序的模型档案".to_string());
    }
    let expected_ids: std::collections::HashSet<&str> =
        engine_profiles.iter().map(|p| p.id.as_str()).collect();
    let mut seen = std::collections::HashSet::new();
    let mut reordered = Vec::with_capacity(engine_profiles.len());
    for raw_id in ordered_profile_ids {
        let id = raw_id.trim();
        if id.is_empty() {
            continue;
        }
        if !expected_ids.contains(id) {
            return Err(format!("排序列表包含不属于 {engine_norm} 的档案: {id}"));
        }
        if !seen.insert(id) {
            return Err(format!("排序列表包含重复档案: {id}"));
        }
        let profile = engine_profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| format!("未找到模型档案: {id}"))?;
        reordered.push(profile);
    }
    if reordered.len() != engine_profiles.len() {
        return Err("排序列表必须包含当前引擎的全部模型档案".to_string());
    }
    let mut reorder_iter = reordered.into_iter();
    store.profiles = store
        .profiles
        .iter()
        .map(|profile| {
            if profile_engine(profile) == engine_norm {
                reorder_iter
                    .next()
                    .unwrap_or_else(|| profile.clone())
            } else {
                profile.clone()
            }
        })
        .collect();
    Ok(())
}

#[tauri::command]
pub(crate) fn set_claude_model_profile_auto_failover(
    db: tauri::State<'_, WiseDb>,
    enabled: bool,
) -> Result<ClaudeModelProfileStoreView, String> {
    let mut store = load_store(&db);
    store.auto_failover_enabled = enabled;
    save_store(&db, &store)?;
    Ok(store_view_from_store(&store))
}

#[tauri::command]
pub(crate) fn reorder_claude_model_profiles(
    db: tauri::State<'_, WiseDb>,
    engine: String,
    ordered_profile_ids: Vec<String>,
) -> Result<ClaudeModelProfileStoreView, String> {
    let mut store = load_store(&db);
    reorder_profiles_for_engine(&mut store, &engine, &ordered_profile_ids)?;
    save_store(&db, &store)?;
    Ok(store_view_from_store(&store))
}

#[tauri::command]
pub(crate) fn failover_to_next_model_profile(
    db: tauri::State<'_, WiseDb>,
    engine: String,
    exclude_profile_ids: Option<Vec<String>>,
) -> Result<ModelProfileFailoverResult, String> {
    let engine_norm = normalize_profile_engine(&engine);
    let exclude = exclude_profile_ids.unwrap_or_default();
    let store = load_store(&db);
    if !store.auto_failover_enabled {
        return Err("自动切换已关闭".to_string());
    }
    let mut exclude_all = exclude;
    if let Some(active_id) = active_profile_id_for_engine(&store, engine_norm) {
        if !exclude_all.iter().any(|id| id == active_id) {
            exclude_all.push(active_id.clone());
        }
    }
    let profile = pick_next_failover_profile(&store, engine_norm, &exclude_all)
        .ok_or_else(|| "没有可切换的备用模型档案".to_string())?;
    apply_profile_to_disk(&profile)?;
    let mut next = store;
    if profile_engine(&profile) == "codex" {
        next.active_codex_profile_id = Some(profile.id.clone());
    } else if profile_engine(&profile) == "opencode" {
        next.active_opencode_profile_id = Some(profile.id.clone());
    } else {
        next.active_profile_id = Some(profile.id.clone());
    }
    if let Some(slot) = next.profiles.iter_mut().find(|p| p.id == profile.id) {
        if let Ok(mid) = resolve_profile_model_id(slot) {
            slot.model_id = mid.clone();
            slot.updated_at_ms = now_ms();
        }
    }
    save_store(&db, &next)?;
    let store_view = store_view_after_disk_write(&next);
    let trimmed_model_id = profile.model_id.trim();
    let model_id = if !trimmed_model_id.is_empty() {
        trimmed_model_id.to_string()
    } else {
        store_view
            .effective_model
            .clone()
            .or(store_view.effective_codex_model.clone())
            .or(store_view.effective_opencode_model.clone())
            .unwrap_or_default()
    };
    Ok(ModelProfileFailoverResult {
        store: store_view,
        applied_profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        model_id,
        engine: profile_engine(&profile).to_string(),
    })
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
    if profile_engine(&profile) == "codex" {
        next.active_codex_profile_id = Some(id.to_string());
    } else if profile_engine(&profile) == "opencode" {
        next.active_opencode_profile_id = Some(id.to_string());
    } else {
        next.active_profile_id = Some(id.to_string());
    }
    if let Some(slot) = next.profiles.iter_mut().find(|p| p.id == id) {
        if let Ok(mid) = resolve_profile_model_id(slot) {
            slot.model_id = mid;
            slot.updated_at_ms = now_ms();
        }
    }
    save_store(&db, &next)?;
    Ok(store_view_after_disk_write(&next))
}

#[tauri::command]
pub(crate) fn get_opencode_user_settings_json() -> Result<String, String> {
    Ok(read_opencode_user_settings_pretty())
}

#[tauri::command]
pub(crate) fn get_codex_user_settings_json() -> Result<String, String> {
    Ok(read_codex_user_settings_pretty())
}

#[tauri::command]
pub(crate) fn get_claude_user_settings_json() -> Result<String, String> {
    read_claude_user_settings_pretty()
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
            return Ok(store_view_after_disk_write(&store));
        }
    }
    Ok(store_view_after_disk_write(&load_store(&db)))
}

#[tauri::command]
pub(crate) fn create_claude_model_profile(
    db: tauri::State<'_, WiseDb>,
    company: Option<String>,
    name: String,
    settings_json: String,
    engine: Option<String>,
    official_website_url: Option<String>,
) -> Result<ClaudeModelProfileStoreView, String> {
    let vendor = company.unwrap_or_default().trim().to_string();
    validate_profile_label(&vendor, "公司", false)?;
    let label = name.trim();
    validate_profile_label(label, "名称", true)?;
    let website = official_website_url.unwrap_or_default();
    validate_official_website_url(&website)?;
    let trimmed = settings_json.trim();
    if trimmed.is_empty() {
        return Err("配置 JSON 不能为空".to_string());
    }
    let engine_key = normalize_profile_engine(engine.as_deref().unwrap_or("claude")).to_string();
    let (pretty, mid) = if engine_key == "codex" {
        let envelope = parse_codex_profile_envelope(trimmed)?;
        let pretty = codex_profile_envelope_to_json(&envelope)?;
        let mid = read_effective_codex_model_from_envelope(&envelope)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "custom".to_string());
        (pretty, mid)
    } else if engine_key == "opencode" {
        let v = validate_opencode_settings_json(trimmed)?;
        let pretty = opencode_config_json_to_pretty(&v)?;
        let mid = read_effective_opencode_model(&v)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "custom".to_string());
        (pretty, mid)
    } else {
        let v: serde_json::Value =
            serde_json::from_str(trimmed).map_err(|e| format!("配置 JSON 无效: {e}"))?;
        if !v.is_object() {
            return Err("配置 JSON 顶层必须是对象".to_string());
        }
        let pretty = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
        let mid = read_effective_model(&v)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "custom".to_string());
        (pretty, mid)
    };
    let now = now_ms();
    let profile = ClaudeModelProfile {
        id: Uuid::new_v4().to_string(),
        company: vendor,
        name: label.to_string(),
        official_website_url: website.trim().to_string(),
        model_id: mid,
        settings_json: pretty,
        engine: engine_key,
        created_at_ms: now,
        updated_at_ms: now,
    };
    let mut store = load_store(&db);
    store.profiles.push(profile);
    save_store(&db, &store)?;
    Ok(store_view_from_store(&store))
}

#[tauri::command]
pub(crate) fn create_claude_model_profile_from_current(
    db: tauri::State<'_, WiseDb>,
    company: Option<String>,
    name: String,
    model_id: Option<String>,
) -> Result<ClaudeModelProfileStoreView, String> {
    let vendor = company.unwrap_or_default().trim().to_string();
    validate_profile_label(&vendor, "公司", false)?;
    let label = name.trim();
    validate_profile_label(label, "名称", true)?;
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
        official_website_url: String::new(),
        model_id: mid,
        settings_json,
        engine: default_profile_engine(),
        created_at_ms: now,
        updated_at_ms: now,
    };
    let mut store = load_store(&db);
    store.profiles.push(profile);
    save_store(&db, &store)?;
    Ok(store_view_from_store(&store))
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
            official_website_url: String::new(),
            model_id: "stale-wrong-id".into(),
            settings_json: r#"{
              "env": {
                "ANTHROPIC_BASE_URL": "http://127.0.0.1:8082",
                "ANTHROPIC_MODEL": "kimi-k2",
                "ANTHROPIC_DEFAULT_SONNET_MODEL": "old-sonnet"
              }
            }"#
            .into(),
            engine: default_profile_engine(),
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
    fn reorder_profiles_for_engine_updates_same_engine_order_only() {
        let mut store = ClaudeModelProfileStore {
            profiles: vec![
                ClaudeModelProfile {
                    id: "c1".into(),
                    company: "A".into(),
                    name: "C1".into(),
                    official_website_url: String::new(),
                    model_id: "m1".into(),
                    settings_json: r#"{}"#.into(),
                    engine: default_profile_engine(),
                    created_at_ms: 0,
                    updated_at_ms: 0,
                },
                ClaudeModelProfile {
                    id: "x1".into(),
                    company: "X".into(),
                    name: "Codex".into(),
                    official_website_url: String::new(),
                    model_id: "cx".into(),
                    settings_json: r#"{}"#.into(),
                    engine: "codex".into(),
                    created_at_ms: 0,
                    updated_at_ms: 0,
                },
                ClaudeModelProfile {
                    id: "c2".into(),
                    company: "B".into(),
                    name: "C2".into(),
                    official_website_url: String::new(),
                    model_id: "m2".into(),
                    settings_json: r#"{}"#.into(),
                    engine: default_profile_engine(),
                    created_at_ms: 0,
                    updated_at_ms: 0,
                },
            ],
            active_profile_id: Some("c1".into()),
            active_codex_profile_id: None,
            active_opencode_profile_id: None,
            auto_failover_enabled: true,
        };
        reorder_profiles_for_engine(&mut store, "claude", &["c2".into(), "c1".into()])
            .expect("reorder");
        let ids: Vec<_> = store.profiles.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["c2", "x1", "c1"]);
    }

    #[test]
    fn pick_next_failover_profile_skips_excluded_and_rotates() {
        let store = ClaudeModelProfileStore {
            profiles: vec![
                ClaudeModelProfile {
                    id: "p1".into(),
                    company: "A".into(),
                    name: "Profile A".into(),
                    official_website_url: String::new(),
                    model_id: "model-a".into(),
                    settings_json: r#"{}"#.into(),
                    engine: default_profile_engine(),
                    created_at_ms: 0,
                    updated_at_ms: 0,
                },
                ClaudeModelProfile {
                    id: "p2".into(),
                    company: "B".into(),
                    name: "Profile B".into(),
                    official_website_url: String::new(),
                    model_id: "model-b".into(),
                    settings_json: r#"{}"#.into(),
                    engine: default_profile_engine(),
                    created_at_ms: 0,
                    updated_at_ms: 0,
                },
                ClaudeModelProfile {
                    id: "p3".into(),
                    company: "C".into(),
                    name: "Profile C".into(),
                    official_website_url: String::new(),
                    model_id: "model-c".into(),
                    settings_json: r#"{}"#.into(),
                    engine: "codex".into(),
                    created_at_ms: 0,
                    updated_at_ms: 0,
                },
            ],
            active_profile_id: Some("p1".into()),
            active_codex_profile_id: None,
            active_opencode_profile_id: None,
            auto_failover_enabled: true,
        };
        let next = pick_next_failover_profile(&store, "claude", &["p1".into()])
            .expect("p2");
        assert_eq!(next.id, "p2");
        assert!(
            pick_next_failover_profile(&store, "claude", &["p1".into(), "p2".into()]).is_none()
        );
        assert!(pick_next_failover_profile(&store, "codex", &["p3".into()]).is_none());
    }

    #[test]
    fn apply_profile_falls_back_to_profile_model_id_when_env_missing() {
        let profile = ClaudeModelProfile {
            id: "p1".into(),
            company: "".into(),
            name: "Test".into(),
            official_website_url: String::new(),
            model_id: "qwen3.6-plus".into(),
            settings_json: r#"{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:8082"}}"#.into(),
            engine: default_profile_engine(),
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
