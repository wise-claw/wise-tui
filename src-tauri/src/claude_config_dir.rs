//! 解析「用户级 Claude Code 配置目录」的全局位置。
//!
//! 固定使用官方默认 `~/.claude`。仓库内的 `<project>/.claude/...` 不受影响。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use uuid::Uuid;

use crate::wise_db::WiseDb;

/// 历史 `app_settings` 键；启动时删除，避免旧版自定义目录残留。
pub(crate) const CLAUDE_USER_CONFIG_DIR_SETTING_KEY: &str = "claude_user_config_dir";

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
        env.insert((*key).to_string(), (*value).to_string());
    }
}

/// 写入用户 `settings.json` 的 `env` 块（与 spawn 侧工具兼容策略一致）。
pub(crate) fn apply_local_proxy_claude_tool_compat_json_env(
    env_obj: &mut serde_json::Map<String, serde_json::Value>,
) {
    for (key, value) in LOCAL_PROXY_CLAUDE_TOOL_COMPAT_ENV {
        env_obj.insert(key.to_string(), serde_json::Value::String(value.to_string()));
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

fn write_claude_spawn_settings_file(env: &HashMap<String, String>) -> Result<String, String> {
    let wise_dir = crate::wise_paths::wise_dir()?;
    let out_dir = wise_dir.join("claude-spawn");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let out_path = out_dir.join(format!("{}.json", Uuid::new_v4()));
    let env_json: serde_json::Map<String, serde_json::Value> = env
        .iter()
        .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
        .collect();
    let payload = serde_json::json!({ "env": env_json });
    let serialized = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    crate::wise_paths::write_file_atomic(&out_path, &serialized)?;
    Ok(out_path.to_string_lossy().to_string())
}

/// 对齐终端 CLI 的 FCC / free-claude-code 认证：`--settings` + 子进程 `env`，并清理 `~/.claude.json` 中冲突项。
pub(crate) fn configure_claude_child_process(
    cmd: &mut tokio::process::Command,
    project_path: &str,
    anthropic_base_url_override: Option<&str>,
    llm_traffic_capture: bool,
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

    if merged.is_empty() {
        return;
    }
    if let Ok(settings_path) = write_claude_spawn_settings_file(&merged) {
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
}
