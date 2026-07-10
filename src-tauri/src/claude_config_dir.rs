//! 解析「用户级 Claude Code 配置目录」的全局位置。
//!
//! 固定使用官方默认 `~/.claude`。仓库内的 `<project>/.claude/...` 不受影响。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use uuid::Uuid;

use crate::wise_db::WiseDb;
use tauri::Manager;

/// 历史 `app_settings` 键；启动时删除，避免旧版自定义目录残留。
pub(crate) const CLAUDE_USER_CONFIG_DIR_SETTING_KEY: &str = "claude_user_config_dir";

/// 用户配置的 Claude 启动默认 `--settings` JSON（存原始字符串）。
/// 前端常量 `WISE_CLAUDE_DEFAULT_SETTINGS_KEY`（`appSettingsStore.ts`）须与此一致。
pub(crate) const CLAUDE_DEFAULT_SETTINGS_KEY: &str = "wise.claudeDefaultSettings.v1";

/// `--permission-mode` 合法取值（对齐 claude code CLI）。
/// `bypassPermissions` 为 wise 默认（绕过逐项工具提示，自动化更顺），用户可经默认配置改为其它。
pub(crate) const CLAUDE_DEFAULT_PERMISSION_MODE: &str = "bypassPermissions";

/// 从用户默认 settings JSON 提取 `permissionMode`（camelCase，与前端对齐）。
/// 非字符串/空串/非法 JSON 均返回 None（调用方回退默认 `bypassPermissions`）。
pub(crate) fn extract_claude_permission_mode(user_settings: Option<&serde_json::Value>) -> Option<String> {
    let v = user_settings?;
    let mode = v.get("permissionMode")?.as_str()?.trim();
    if mode.is_empty() {
        return None;
    }
    // 只接受 claude code 已知取值，拒绝任意串透传到命令行。
    match mode {
        "default" | "acceptEdits" | "plan" | "bypassPermissions" => Some(mode.to_string()),
        _ => None,
    }
}

/// 读取用户配置的 Claude 启动默认 settings JSON（已解析、已过滤空对象）。
/// 供 `execute_claude_code`/`resume_claude_code`/`spawn_streaming_session` 等持 `AppHandle` 的调用方复用，
/// 避免各自重复「读 DB → trim → parse → 过滤空」四步。DB 读失败或 JSON 非法时返回 None（回退默认）。
pub(crate) fn read_claude_default_settings(app: &tauri::AppHandle) -> Option<serde_json::Value> {
    app.try_state::<crate::wise_db::WiseDb>()
        .and_then(|db| {
            db.get_setting(CLAUDE_DEFAULT_SETTINGS_KEY)
                .ok()
                .flatten()
        })
        .and_then(|s| {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                serde_json::from_str::<serde_json::Value>(&t).ok()
            }
        })
        .filter(|v| v.as_object().map_or(false, |o| !o.is_empty()))
}

/// 全局缓存：写命令更新 / 启动 init 时写入；读命令尽量从这里出。
static USER_CLAUDE_DIR_CACHE: RwLock<Option<PathBuf>> = RwLock::new(None);

/// 官方默认目录：`$HOME/.claude`。无 HOME 时退化到当前目录下的 `.claude`（保持调用侧不 panic）。
pub(crate) fn default_user_claude_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".claude"))
        .unwrap_or_else(|| PathBuf::from(".claude"))
}

/// 当前生效的用户级 Claude 配置目录：缓存 > 默认。
pub(crate) fn user_claude_dir() -> PathBuf {
    if let Ok(g) = USER_CLAUDE_DIR_CACHE.read() {
        if let Some(p) = g.as_ref() {
            return p.clone();
        }
    }
    default_user_claude_dir()
}

/// `~/.claude.json` 的兼容映射：与目录共享 parent，命名沿用「目录名 + `.json`」。
///
/// - 用户保持默认（`~/.claude`）→ 返回 `~/.claude.json`（与历史完全一致）。
/// - 自定义目录（如 `~/.codefuse/engine/cc`）→ 返回 `~/.codefuse/engine/cc.json`。
/// - 目录无父级或无文件名 → 兜底为 `<dir>.json`，避免吞掉读写。
pub(crate) fn user_claude_root_json() -> PathBuf {
    let dir = user_claude_dir();
    let name = match dir.file_name().and_then(|s| s.to_str()) {
        Some(n) if !n.is_empty() => format!("{}.json", n),
        _ => return dir.with_extension("json"),
    };
    match dir.parent() {
        Some(parent) => parent.join(name),
        None => PathBuf::from(name),
    }
}

fn update_cache(path: Option<PathBuf>) {
    if let Ok(mut g) = USER_CLAUDE_DIR_CACHE.write() {
        *g = path;
    }
}

#[cfg(test)]
pub(crate) fn set_user_claude_dir_for_tests(path: Option<PathBuf>) {
    update_cache(path);
}

/// 测试专用：序列化所有访问 `USER_CLAUDE_DIR_CACHE` 的测试，避免不同 mod 的测试并行运行时
/// 互相覆盖缓存导致随机失败。任何调用 `update_cache` / `set_user_claude_dir_for_tests`
/// 的测试都应在持有这把锁的前提下进行。
#[cfg(test)]
pub(crate) fn user_claude_dir_test_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    match LOCK.lock() {
        Ok(g) => g,
        Err(poison) => poison.into_inner(),
    }
}

/// 启动时调用：清除历史自定义目录设置，始终回退官方 `~/.claude`。
pub(crate) fn init_from_db(db: &WiseDb) {
    let _ = db.delete_setting(CLAUDE_USER_CONFIG_DIR_SETTING_KEY);
    update_cache(None);
}

/// 从 Claude `settings.json` / `~/.claude.json` 的 `env` 块读取键值（忽略空值）。
pub(crate) fn read_claude_json_env_block(path: &Path) -> HashMap<String, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return HashMap::new(),
    };
    let v: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return HashMap::new(),
    };
    let Some(env) = v.get("env").and_then(|e| e.as_object()) else {
        return HashMap::new();
    };
    let mut out = HashMap::new();
    for (k, val) in env {
        let Some(s) = val.as_str().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        out.insert(k.clone(), s.to_string());
    }
    out
}

/// 是否为本机 free-claude-code / FCC 类代理地址。
pub(crate) fn is_local_fcc_proxy_base_url(url: &str) -> bool {
    let t = url.trim().to_ascii_lowercase();
    t.starts_with("http://127.0.0.1:")
        || t.starts_with("http://localhost:")
        || t.starts_with("http://[::1]:")
}

/// OpenCode / FCC 本地代理要求 Claude 侧使用 Claude 模型名，由代理路由到上游。
const LOCAL_PROXY_CLAUDE_MODEL_ENV: &[(&str, &str)] = &[
    ("ANTHROPIC_MODEL", "claude-sonnet-4-8"),
    ("ANTHROPIC_REASONING_MODEL", "claude-sonnet-4-8"),
    ("ANTHROPIC_SMALL_FAST_MODEL", "claude-haiku-4-8"),
    ("ANTHROPIC_DEFAULT_HAIKU_MODEL", "claude-haiku-4-8"),
    ("ANTHROPIC_DEFAULT_OPUS_MODEL", "claude-opus-4-8"),
    ("ANTHROPIC_DEFAULT_SONNET_MODEL", "claude-sonnet-4-8"),
    ("CLAUDE_CODE_SUBAGENT_MODEL", "claude-sonnet-4-8"),
];

/// 将 CC Switch 等写入的第三方模型 ID 对齐为 Claude 模型名，避免本地代理收到无法路由的请求。
pub(crate) fn normalize_claude_models_for_local_proxy(env: &mut HashMap<String, String>) {
    for (key, value) in LOCAL_PROXY_CLAUDE_MODEL_ENV {
        env.insert((*key).to_string(), (*value).to_string());
    }
}

/// 写入用户 `settings.json` 的 `env` 块（与 spawn 侧模型名策略一致）。
pub(crate) fn apply_local_proxy_claude_model_env(
    env_obj: &mut serde_json::Map<String, serde_json::Value>,
) {
    for (key, value) in LOCAL_PROXY_CLAUDE_MODEL_ENV {
        env_obj.insert(key.to_string(), serde_json::Value::String(value.to_string()));
    }
}

/// Claude Code 2.1+ 默认 ToolSearch 会发 `tool_reference`；Qwen 等上游 Anthropic 兼容层不支持，导致工具调用 400。
/// 扩展思考 + 交错 thinking 在 Qwen 上易触发 stop_reason=tool_use 却无 tool_use 块，导致 CLI 解析失败。
const LOCAL_PROXY_CLAUDE_TOOL_COMPAT_ENV: &[(&str, &str)] = &[
    ("ENABLE_TOOL_SEARCH", "false"),
    ("ENABLE_EXPERIMENTAL_MCP_CLI", "false"),
    ("CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING", "0"),
    ("CLAUDE_CODE_DISABLE_THINKING", "1"),
    ("DISABLE_INTERLEAVED_THINKING", "1"),
    ("MAX_THINKING_TOKENS", "0"),
    ("CLAUDE_CODE_EFFORT_LEVEL", "medium"),
];

pub(crate) fn apply_local_proxy_claude_tool_compat_env(env: &mut HashMap<String, String>) {
    for (key, value) in LOCAL_PROXY_CLAUDE_TOOL_COMPAT_ENV {
        if *key == "CLAUDE_CODE_EFFORT_LEVEL" {
            // 用户/会话已显式设置 effort（如 ultracode / xhigh）时不降级为 medium。
            env.entry((*key).to_string())
                .or_insert_with(|| (*value).to_string());
        } else {
            env.insert((*key).to_string(), (*value).to_string());
        }
    }
}

/// 写入用户 `settings.json` 的 `env` 块（与 spawn 侧工具兼容策略一致）。
pub(crate) fn apply_local_proxy_claude_tool_compat_json_env(
    env_obj: &mut serde_json::Map<String, serde_json::Value>,
) {
    for (key, value) in LOCAL_PROXY_CLAUDE_TOOL_COMPAT_ENV {
        if *key == "CLAUDE_CODE_EFFORT_LEVEL" {
            env_obj
                .entry(key.to_string())
                .or_insert_with(|| serde_json::Value::String(value.to_string()));
        } else {
            env_obj.insert(key.to_string(), serde_json::Value::String(value.to_string()));
        }
    }
}

/// 仅合并用户 + 项目 `settings.json`（**不**读 `~/.claude.json` 的 `env`，避免百炼 key 污染 spawn）。
pub(crate) fn merged_claude_spawn_env(project_path: Option<&str>) -> HashMap<String, String> {
    let mut out = read_claude_json_env_block(&user_claude_dir().join("settings.json"));
    if let Some(pp) = project_path.map(str::trim).filter(|s| !s.is_empty()) {
        out.extend(read_claude_json_env_block(
            &PathBuf::from(pp).join(".claude").join("settings.json"),
        ));
    }
    out
}

/// 用户 `settings.json` 已配置 FCC 时，从 `~/.claude.json` 移除会干扰认证的 `env` 项（Claude 运行时仍会读该文件）。
pub(crate) fn sanitize_claude_root_json_for_fcc_proxy() -> Result<bool, String> {
    let user_settings = user_claude_dir().join("settings.json");
    let user_env = read_claude_json_env_block(&user_settings);
    let has_auth = user_env
        .get("ANTHROPIC_AUTH_TOKEN")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let fcc_base = user_env
        .get("ANTHROPIC_BASE_URL")
        .map(|s| is_local_fcc_proxy_base_url(s))
        .unwrap_or(false);
    if !has_auth || !fcc_base {
        return Ok(false);
    }

    let path = user_claude_root_json();
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut root: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析 {} 失败: {e}", path.display()))?;
    let Some(env) = root.get_mut("env").and_then(|e| e.as_object_mut()) else {
        return Ok(false);
    };

    let mut changed = false;
    if env.remove("ANTHROPIC_API_KEY").is_some() {
        changed = true;
    }
    if let Some(url) = env.get("ANTHROPIC_BASE_URL").and_then(|v| v.as_str()) {
        if !is_local_fcc_proxy_base_url(url) {
            env.remove("ANTHROPIC_BASE_URL");
            changed = true;
        }
    }
    if !changed {
        return Ok(false);
    }

    let serialized = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    crate::wise_paths::write_file_atomic(&path, &serialized)?;
    Ok(true)
}

const ANTHROPIC_ENV_SCRUB_KEYS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
];

fn scrub_inherited_anthropic_env(cmd: &mut tokio::process::Command) {
    for key in ANTHROPIC_ENV_SCRUB_KEYS {
        cmd.env_remove(key);
    }
}

/// Wise 子进程应使用的 `env`；存在 `ANTHROPIC_AUTH_TOKEN` 时剔除百炼 `ANTHROPIC_API_KEY`（FCC 要求）。
///
/// `llm_traffic_capture` 为 true 时表示 `anthropic_base_url_override` 指向 Wise LLM 流量监听代理：
/// 仅改写 `ANTHROPIC_BASE_URL`，保留 Claude 原有 API Key / Auth Token 供代理透传到上游。
pub(crate) fn build_claude_spawn_env(
    project_path: Option<&str>,
    anthropic_base_url_override: Option<&str>,
    llm_traffic_capture: bool,
) -> HashMap<String, String> {
    let mut merged = merged_claude_spawn_env(project_path);
    if let Some(url) = anthropic_base_url_override.map(str::trim).filter(|s| !s.is_empty()) {
        merged.insert("ANTHROPIC_BASE_URL".to_string(), url.to_string());
        // Wise 内置本地代理（OpenCode / FCC）：与 oc-go-cc 一致使用占位 token。
        // LLM 流量监听代理是透明转发，不能替换认证信息。
        if is_local_fcc_proxy_base_url(url) && !llm_traffic_capture {
            merged.insert("ANTHROPIC_AUTH_TOKEN".to_string(), "unused".to_string());
            merged.remove("ANTHROPIC_API_KEY");
            normalize_claude_models_for_local_proxy(&mut merged);
            apply_local_proxy_claude_tool_compat_env(&mut merged);
        }
    }
    if merged
        .get("ANTHROPIC_AUTH_TOKEN")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
    {
        merged.remove("ANTHROPIC_API_KEY");
    }
    if !llm_traffic_capture
        && merged
            .get("ANTHROPIC_BASE_URL")
            .map(|s| is_local_fcc_proxy_base_url(s))
            .unwrap_or(false)
    {
        merged
            .entry("CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY".to_string())
            .or_insert_with(|| "1".to_string());
        merged
            .entry("CLAUDE_CODE_AUTO_COMPACT_WINDOW".to_string())
            .or_insert_with(|| "190000".to_string());
        apply_local_proxy_claude_tool_compat_env(&mut merged);
    }
    merged
}

fn write_claude_spawn_settings_file(
    env: &HashMap<String, String>,
    user_settings: Option<&serde_json::Value>,
) -> Result<String, String> {
    let wise_dir = crate::wise_paths::wise_dir()?;
    let out_dir = wise_dir.join("claude-spawn");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let out_path = out_dir.join(format!("{}.json", Uuid::new_v4()));
    let payload = build_claude_spawn_settings_payload(env, user_settings);
    let serialized = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    crate::wise_paths::write_file_atomic(&out_path, &serialized)?;
    Ok(out_path.to_string_lossy().to_string())
}

/// 构造 claude `--settings` 文件 payload：以用户默认 settings 顶层对象为 base
/// （全量拷入 `ultracode`/`permissions`/`hooks` 等键），再把 FCC 认证 env 叠加进
/// `env` 子对象——认证 env 同名键优先（认证是会话能否跑起来的硬依赖）。
/// 抽成纯函数便于单测，不碰文件系统。
fn build_claude_spawn_settings_payload(
    env: &HashMap<String, String>,
    user_settings: Option<&serde_json::Value>,
) -> serde_json::Value {
    let mut payload: serde_json::Map<String, serde_json::Value> = user_settings
        .and_then(|v| v.as_object().map(|m| m.clone()))
        .unwrap_or_default();
    enrich_ultracode_effort_in_spawn_settings(&mut payload);
    if !env.is_empty() {
        // 用户若把 `env` 设成非对象（不合理但需防御），用 FCC env 覆盖。
        if !payload
            .get("env")
            .map_or(false, |v| v.is_object())
        {
            payload.insert(
                "env".to_string(),
                serde_json::Value::Object(serde_json::Map::new()),
            );
        }
        if let Some(env_map) = payload.get_mut("env").and_then(|v| v.as_object_mut()) {
            for (k, v) in env.iter() {
                env_map.insert(k.clone(), serde_json::Value::String(v.clone()));
            }
        }
    }
    serde_json::Value::Object(payload)
}

/// `ultracode: true` 时补齐 effort 档位，对齐 Claude Code `/effort ultracode`。
fn enrich_ultracode_effort_in_spawn_settings(payload: &mut serde_json::Map<String, serde_json::Value>) {
    let ultracode = payload
        .get("ultracode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !ultracode {
        return;
    }
    payload
        .entry("effortLevel".to_string())
        .or_insert_with(|| serde_json::Value::String("ultracode".to_string()));
    if !payload
        .get("env")
        .map_or(false, |v| v.is_object())
    {
        payload.insert(
            "env".to_string(),
            serde_json::Value::Object(serde_json::Map::new()),
        );
    }
    if let Some(env_map) = payload.get_mut("env").and_then(|v| v.as_object_mut()) {
        env_map
            .entry("CLAUDE_CODE_EFFORT_LEVEL".to_string())
            .or_insert_with(|| serde_json::Value::String("ultracode".to_string()));
    }
}

/// 对齐终端 CLI 的 FCC / free-claude-code 认证：`--settings` + 子进程 `env`，并清理 `~/.claude.json` 中冲突项。
pub(crate) fn configure_claude_child_process(
    cmd: &mut tokio::process::Command,
    project_path: &str,
    anthropic_base_url_override: Option<&str>,
    llm_traffic_capture: bool,
    user_settings: Option<&serde_json::Value>,
) {
    let _ = sanitize_claude_root_json_for_fcc_proxy();

    let merged = build_claude_spawn_env(
        Some(project_path),
        anthropic_base_url_override,
        llm_traffic_capture,
    );
    let strip_api_key = merged
        .get("ANTHROPIC_AUTH_TOKEN")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    scrub_inherited_anthropic_env(cmd);

    for (k, v) in &merged {
        cmd.env(k, v);
    }
    if strip_api_key {
        cmd.env_remove("ANTHROPIC_API_KEY");
    }

    // 既无 FCC 认证 env 也无用户默认 settings 时，才不注入 --settings。
    // 否则无认证场景下用户配置的 settings（如 {"ultracode": true}）会丢失。
    let has_user = user_settings
        .map(|v| v.as_object().map_or(false, |o| !o.is_empty()))
        .unwrap_or(false);
    if merged.is_empty() && !has_user {
        return;
    }
    if let Ok(settings_path) = write_claude_spawn_settings_file(&merged, user_settings) {
        cmd.arg("--settings").arg(settings_path);
    }
}

/// 手动修复：从 `~/.claude.json` 移除与 FCC `settings.json` 冲突的认证项（供设置页或排障调用）。
#[tauri::command]
pub(crate) fn sanitize_claude_credentials_for_fcc() -> Result<bool, String> {
    sanitize_claude_root_json_for_fcc_proxy()
}

/// 返回用户级 Claude `settings.json` 路径（`~/.claude/settings.json`）；若文件不存在则创建空对象。
#[tauri::command]
pub(crate) fn get_claude_user_settings_json_path() -> Result<String, String> {
    let dir = user_claude_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("settings.json");
    if !path.exists() {
        fs::write(&path, "{}\n").map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_spawn_settings_payload_merges_user_settings_with_fcc_env_priority() {
        // 用户默认 settings 作为 base，FCC 认证 env 叠加进 env 子对象且同名键优先。
        let mut user_env = serde_json::Map::new();
        user_env.insert(
            "ANTHROPIC_AUTH_TOKEN".to_string(),
            serde_json::Value::String("user-token".to_string()),
        );
        user_env.insert("FOO".to_string(), serde_json::Value::String("bar".to_string()));
        let mut user_obj = serde_json::Map::new();
        user_obj.insert("ultracode".to_string(), serde_json::Value::Bool(true));
        user_obj.insert("env".to_string(), serde_json::Value::Object(user_env));
        let user = serde_json::Value::Object(user_obj);

        let env = HashMap::from([("ANTHROPIC_AUTH_TOKEN".to_string(), "fcc-token".to_string())]);
        let payload = build_claude_spawn_settings_payload(&env, Some(&user));
        let obj = payload.as_object().expect("payload should be object");
        assert_eq!(obj.get("ultracode"), Some(&serde_json::Value::Bool(true)));
        let env_obj = obj
            .get("env")
            .and_then(|v| v.as_object())
            .expect("env should be object");
        // FCC 认证 env 覆盖用户同名键。
        assert_eq!(
            env_obj.get("ANTHROPIC_AUTH_TOKEN"),
            Some(&serde_json::Value::String("fcc-token".to_string()))
        );
        // 用户独有 env 键保留。
        assert_eq!(
            env_obj.get("FOO"),
            Some(&serde_json::Value::String("bar".to_string()))
        );
        assert_eq!(
            obj.get("effortLevel"),
            Some(&serde_json::Value::String("ultracode".to_string()))
        );
    }

    #[test]
    fn build_spawn_settings_payload_enriches_ultracode_effort_when_missing() {
        let user = serde_json::json!({ "ultracode": true });
        let payload = build_claude_spawn_settings_payload(&HashMap::new(), Some(&user));
        let obj = payload.as_object().expect("payload should be object");
        assert_eq!(
            obj.get("effortLevel"),
            Some(&serde_json::Value::String("ultracode".to_string()))
        );
        let env_obj = obj
            .get("env")
            .and_then(|v| v.as_object())
            .expect("env should be object");
        assert_eq!(
            env_obj.get("CLAUDE_CODE_EFFORT_LEVEL"),
            Some(&serde_json::Value::String("ultracode".to_string()))
        );
    }

    #[test]
    fn local_proxy_tool_compat_does_not_downgrade_existing_effort_env() {
        let mut env = HashMap::from([(
            "CLAUDE_CODE_EFFORT_LEVEL".to_string(),
            "ultracode".to_string(),
        )]);
        apply_local_proxy_claude_tool_compat_env(&mut env);
        assert_eq!(
            env.get("CLAUDE_CODE_EFFORT_LEVEL").map(String::as_str),
            Some("ultracode")
        );
    }

    #[test]
    fn build_spawn_settings_payload_user_only_omits_empty_env() {
        // 仅用户 settings、无 FCC env 时，不应产生空 env 键。
        let user = serde_json::json!({ "ultracode": true });
        let env = HashMap::<String, String>::new();
        let payload = build_claude_spawn_settings_payload(&env, Some(&user));
        let obj = payload.as_object().expect("payload should be object");
        assert_eq!(obj.get("ultracode"), Some(&serde_json::Value::Bool(true)));
        assert!(
            obj.get("env").is_none(),
            "empty env should not produce an env key"
        );
    }

    #[test]
    fn build_spawn_settings_payload_env_only_matches_legacy() {
        // 无用户 settings 时，行为与旧版一致：只含 env。
        let env = HashMap::from([(
            "ANTHROPIC_BASE_URL".to_string(),
            "http://localhost:8082".to_string(),
        )]);
        let payload = build_claude_spawn_settings_payload(&env, None);
        let obj = payload.as_object().expect("payload should be object");
        assert_eq!(obj.len(), 1);
        let env_obj = obj
            .get("env")
            .and_then(|v| v.as_object())
            .expect("env should be object");
        assert_eq!(
            env_obj.get("ANTHROPIC_BASE_URL"),
            Some(&serde_json::Value::String("http://localhost:8082".to_string()))
        );
    }

    #[test]
    fn build_spawn_settings_payload_overwrites_non_object_user_env() {
        // 用户把 env 设成非对象（不合理但需防御）：FCC env 覆盖为对象。
        let user = serde_json::json!({ "env": "not-an-object" });
        let env = HashMap::from([("ANTHROPIC_AUTH_TOKEN".to_string(), "fcc-token".to_string())]);
        let payload = build_claude_spawn_settings_payload(&env, Some(&user));
        let env_obj = payload
            .get("env")
            .and_then(|v| v.as_object())
            .expect("env should be object");
        assert_eq!(
            env_obj.get("ANTHROPIC_AUTH_TOKEN"),
            Some(&serde_json::Value::String("fcc-token".to_string()))
        );
    }

    #[test]
    fn build_spawn_settings_payload_empty_when_nothing() {
        let env = HashMap::<String, String>::new();
        let payload = build_claude_spawn_settings_payload(&env, None);
        assert!(payload.as_object().map_or(false, |o| o.is_empty()));
    }

    #[test]
    fn sanitize_root_json_removes_conflicting_env_for_fcc() {
        let _guard = user_claude_dir_test_lock();
        let dir = tempfile::tempdir().unwrap();
        update_cache(Some(dir.path().join("wise-claude-sanitize")));
        let wise_claude = user_claude_dir();
        std::fs::create_dir_all(&wise_claude).unwrap();
        std::fs::write(
            wise_claude.join("settings.json"),
            r#"{"env":{"ANTHROPIC_AUTH_TOKEN":"fcc-token","ANTHROPIC_BASE_URL":"http://localhost:8082"}}"#,
        )
        .unwrap();
        std::fs::write(
            user_claude_root_json(),
            r#"{"env":{"ANTHROPIC_API_KEY":"sk-bailian","ANTHROPIC_BASE_URL":"https://dashscope.example.com"}}"#,
        )
        .unwrap();

        assert!(sanitize_claude_root_json_for_fcc_proxy().unwrap());
        let env = read_claude_json_env_block(&user_claude_root_json());
        assert!(!env.contains_key("ANTHROPIC_API_KEY"));
        assert!(!env.contains_key("ANTHROPIC_BASE_URL"));
        update_cache(None);
    }

    #[test]
    fn normalize_claude_models_replaces_third_party_model_ids() {
        let mut env = HashMap::from([
            (
                "ANTHROPIC_MODEL".to_string(),
                "doubao-seed-2.0-code".to_string(),
            ),
            (
                "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
                "doubao-seed-2.0-code".to_string(),
            ),
        ]);
        normalize_claude_models_for_local_proxy(&mut env);
        assert_eq!(env.get("ANTHROPIC_MODEL").map(String::as_str), Some("claude-sonnet-4-8"));
        assert_eq!(
            env.get("ANTHROPIC_DEFAULT_SONNET_MODEL").map(String::as_str),
            Some("claude-sonnet-4-8")
        );
    }

    #[test]
    fn build_spawn_env_strips_api_key_when_auth_token_present() {
        let _guard = user_claude_dir_test_lock();
        let dir = tempfile::tempdir().unwrap();
        update_cache(Some(dir.path().join("wise-claude-test2")));
        let wise_claude = user_claude_dir();
        std::fs::create_dir_all(&wise_claude).unwrap();
        std::fs::write(
            wise_claude.join("settings.json"),
            r#"{"env":{"ANTHROPIC_AUTH_TOKEN":"fcc-token","ANTHROPIC_BASE_URL":"http://localhost:8082"}}"#,
        )
        .unwrap();
        std::fs::write(
            user_claude_root_json(),
            r#"{"env":{"ANTHROPIC_API_KEY":"sk-bailian"}}"#,
        )
        .unwrap();

        let built = build_claude_spawn_env(None, None, false);
        assert_eq!(
            built.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("fcc-token")
        );
        assert!(!built.contains_key("ANTHROPIC_API_KEY"));
        update_cache(None);
    }

    #[test]
    fn build_spawn_env_llm_traffic_capture_preserves_api_key() {
        let _guard = user_claude_dir_test_lock();
        let dir = tempfile::tempdir().unwrap();
        update_cache(Some(dir.path().join("wise-claude-llm-proxy")));
        let wise_claude = user_claude_dir();
        std::fs::create_dir_all(&wise_claude).unwrap();
        std::fs::write(
            wise_claude.join("settings.json"),
            r#"{"env":{"ANTHROPIC_API_KEY":"sk-real-key","ANTHROPIC_BASE_URL":"https://api.anthropic.com"}}"#,
        )
        .unwrap();

        let built = build_claude_spawn_env(
            None,
            Some("http://127.0.0.1:54321"),
            true,
        );
        assert_eq!(
            built.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("http://127.0.0.1:54321")
        );
        assert_eq!(
            built.get("ANTHROPIC_API_KEY").map(String::as_str),
            Some("sk-real-key")
        );
        assert!(!built.contains_key("ANTHROPIC_AUTH_TOKEN"));
        assert!(!built.contains_key("CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"));
        update_cache(None);
    }

    #[test]
    fn build_spawn_env_local_auth_proxy_uses_placeholder_token() {
        let built = build_claude_spawn_env(
            None,
            Some("http://127.0.0.1:8082"),
            false,
        );
        assert_eq!(
            built.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("unused")
        );
        assert!(!built.contains_key("ANTHROPIC_API_KEY"));
        assert_eq!(
            built.get("ENABLE_TOOL_SEARCH").map(String::as_str),
            Some("false")
        );
        assert_eq!(
            built
                .get("CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING")
                .map(String::as_str),
            Some("0")
        );
    }

    #[test]
    fn root_json_follows_directory_name() {
        let _guard = user_claude_dir_test_lock();
        if dirs::home_dir().is_none() {
            return;
        }
        update_cache(None);
        let json_default = user_claude_root_json();
        assert!(json_default.ends_with(".claude.json"));

        let alt = dirs::home_dir()
            .unwrap()
            .join(".codefuse")
            .join("engine")
            .join("cc");
        update_cache(Some(alt.clone()));
        let json_alt = user_claude_root_json();
        assert_eq!(json_alt, alt.parent().unwrap().join("cc.json"));

        update_cache(None);
    }

    #[test]
    fn extract_permission_mode_known_values() {
        for mode in ["default", "acceptEdits", "plan", "bypassPermissions"] {
            let settings = serde_json::json!({ "permissionMode": mode });
            assert_eq!(
                extract_claude_permission_mode(Some(&settings)).as_deref(),
                Some(mode)
            );
        }
    }

    #[test]
    fn extract_permission_mode_trims_whitespace() {
        let settings = serde_json::json!({ "permissionMode": "  plan  " });
        assert_eq!(
            extract_claude_permission_mode(Some(&settings)).as_deref(),
            Some("plan")
        );
    }

    #[test]
    fn extract_permission_mode_rejects_unknown_string() {
        // 任意串不透传到命令行，避免注入风险。
        let settings = serde_json::json!({ "permissionMode": "yolo" });
        assert_eq!(extract_claude_permission_mode(Some(&settings)), None);
    }

    #[test]
    fn extract_permission_mode_none_or_missing() {
        assert_eq!(extract_claude_permission_mode(None), None);
        let settings = serde_json::json!({ "ultracode": true });
        assert_eq!(extract_claude_permission_mode(Some(&settings)), None);
        let empty = serde_json::json!({ "permissionMode": "  " });
        assert_eq!(extract_claude_permission_mode(Some(&empty)), None);
        let non_str = serde_json::json!({ "permissionMode": 123 });
        assert_eq!(extract_claude_permission_mode(Some(&non_str)), None);
    }
}
