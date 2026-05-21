//! Claude Code plugin marketplaces bootstrap and install/uninstall via the `claude` CLI.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

use super::{claude_path_search_prefixes, find_claude_binary, merge_path_env};

const BOOTSTRAP_MARKETPLACES: &[&str] = &[
    "anthropics/claude-code",
    "obra/superpowers-marketplace",
    "anthropics/claude-plugins-official",
    "anthropics/claude-plugins-community",
    "Yeachan-Heo/oh-my-claudecode",
    "jnuyens/gsd-plugin",
    "mindfold-ai/Trellis",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudePluginInstalledEntry {
    pub id: String,
    pub version: Option<String>,
    pub scope: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudePluginMarketBootstrapResult {
    pub ok: bool,
    pub log: String,
}

fn home_dir() -> Result<std::path::PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "无法解析用户主目录".to_string())
}

fn run_claude_plugin_cli(home: &Path, args: &[&str]) -> Result<String, String> {
    let bin = find_claude_binary()?;
    let path_merged = merge_path_env(&claude_path_search_prefixes());
    let out = Command::new(&bin)
        .args(args)
        .current_dir(home)
        .env("PATH", &path_merged)
        .env("HOME", home.to_string_lossy().to_string())
        .env("CI", "1")
        .output()
        .map_err(|e| format!("无法启动 claude: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if out.status.success() {
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        Err(format!(
            "claude plugin 失败（退出码 {:?}）\n{}\n{}",
            out.status.code(),
            stderr,
            stdout
        ))
    }
}

fn validate_install_ref(install_ref: &str) -> Result<(), String> {
    let s = install_ref.trim();
    if s.is_empty() {
        return Err("插件标识为空".to_string());
    }
    let Some((plugin, market)) = s.split_once('@') else {
        return Err("插件标识格式应为 plugin@marketplace".to_string());
    };
    if plugin.is_empty() || market.is_empty() {
        return Err("插件标识格式无效".to_string());
    }
    let ok_seg = |seg: &str| {
        !seg.is_empty()
            && seg
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    };
    if !plugin.split('/').all(ok_seg) || !market.split('/').all(ok_seg) {
        return Err("插件标识含非法字符".to_string());
    }
    Ok(())
}

fn validate_scope(scope: &str) -> Result<String, String> {
    match scope.trim().to_lowercase().as_str() {
        "user" => Ok("user".to_string()),
        "project" => Ok("project".to_string()),
        "local" => Ok("local".to_string()),
        _ => Err("安装范围无效：应为 user、project 或 local".to_string()),
    }
}

fn ensure_marketplaces_sync(home: &Path) -> ClaudePluginMarketBootstrapResult {
    let mut log = String::new();
    let mut ok = true;
    for source in BOOTSTRAP_MARKETPLACES {
        match run_claude_plugin_cli(
            home,
            &["plugin", "marketplace", "add", source],
        ) {
            Ok(msg) => {
                log.push_str(&format!("✓ {source}: {msg}\n"));
            }
            Err(e) => {
                if e.contains("already") || e.contains("Already") || e.contains("已在") {
                    log.push_str(&format!("· {source}: 已存在\n"));
                } else {
                    ok = false;
                    log.push_str(&format!("✗ {source}: {e}\n"));
                }
            }
        }
    }
    if let Err(e) = run_claude_plugin_cli(home, &["plugin", "marketplace", "update"]) {
        log.push_str(&format!("市场更新警告: {e}\n"));
    } else {
        log.push_str("已刷新插件市场缓存\n");
    }
    ClaudePluginMarketBootstrapResult { ok, log }
}

fn list_installed_sync(home: &Path) -> Result<Vec<ClaudePluginInstalledEntry>, String> {
    let raw = run_claude_plugin_cli(home, &["plugin", "list", "--json"])?;
    let rows: Vec<serde_json::Value> =
        serde_json::from_str(&raw).map_err(|e| format!("解析已安装插件列表失败: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let id = row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if id.is_empty() {
            continue;
        }
        out.push(ClaudePluginInstalledEntry {
            id,
            version: row
                .get("version")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            scope: row
                .get("scope")
                .and_then(|v| v.as_str())
                .unwrap_or("user")
                .to_string(),
            enabled: row.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
        });
    }
    Ok(out)
}

async fn spawn_blocking_result<T, F>(task_label: &str, f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(inner) => inner,
        Err(e) => Err(format!("{task_label}: {e}")),
    }
}

async fn spawn_blocking_value<T, F>(task_label: &str, f: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(value) => Ok(value),
        Err(e) => Err(format!("{task_label}: {e}")),
    }
}

#[tauri::command]
pub async fn claude_plugin_market_bootstrap() -> Result<ClaudePluginMarketBootstrapResult, String> {
    let home = home_dir()?;
    spawn_blocking_value("插件市场初始化任务失败", move || ensure_marketplaces_sync(&home)).await
}

#[tauri::command]
pub async fn claude_plugin_list_installed() -> Result<Vec<ClaudePluginInstalledEntry>, String> {
    let home = home_dir()?;
    spawn_blocking_result("读取已安装插件失败", move || list_installed_sync(&home)).await
}

#[tauri::command]
pub async fn claude_plugin_install(install_ref: String, scope: String) -> Result<String, String> {
    validate_install_ref(&install_ref)?;
    let scope_value = validate_scope(&scope)?;
    let home = home_dir()?;
    let install_ref_value = install_ref.trim().to_string();
    spawn_blocking_result("安装插件任务失败", move || {
        let _ = ensure_marketplaces_sync(&home);
        run_claude_plugin_cli(
            &home,
            &[
                "plugin",
                "install",
                install_ref_value.as_str(),
                "--scope",
                scope_value.as_str(),
            ],
        )
    })
    .await
}

#[tauri::command]
pub async fn claude_plugin_uninstall(install_ref: String, scope: String) -> Result<String, String> {
    validate_install_ref(&install_ref)?;
    let scope_value = validate_scope(&scope)?;
    let home = home_dir()?;
    let install_ref_value = install_ref.trim().to_string();
    spawn_blocking_result("卸载插件任务失败", move || {
        run_claude_plugin_cli(
            &home,
            &[
                "plugin",
                "uninstall",
                install_ref_value.as_str(),
                "--scope",
                scope_value.as_str(),
                "-y",
            ],
        )
    })
    .await
}
