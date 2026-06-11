//! Claude Code plugin marketplaces bootstrap and install/uninstall via the `claude` CLI.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::shared::{canonicalize_existing_project_dir, read_json_file};
use super::{claude_path_search_prefixes, find_claude_binary, merge_path_env};

/// LSP 等插件可能拉取较大依赖；超时后终止子进程并提示用户稍后查看「已安装」。
const PLUGIN_CLI_TIMEOUT: Duration = Duration::from_secs(600);

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

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "无法解析用户主目录".to_string())
}

fn run_claude_plugin_cli_in(home: &Path, cwd: &Path, args: &[&str]) -> Result<String, String> {
    let bin = find_claude_binary()?;
    let path_merged = merge_path_env(&claude_path_search_prefixes());
    let mut child = Command::new(&bin)
        .args(args)
        .current_dir(cwd)
        .env("PATH", &path_merged)
        .env("HOME", home.to_string_lossy().to_string())
        .env("CI", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 claude: {}", e))?;

    let start = Instant::now();
    loop {
        match child
            .try_wait()
            .map_err(|e| format!("等待 claude 子进程失败: {e}"))?
        {
            Some(status) => {
                let mut stdout = String::new();
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stdout.take() {
                    let _ = pipe.read_to_string(&mut stdout);
                }
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr);
                }
                let stdout = stdout.trim().to_string();
                let stderr = stderr.trim().to_string();
                if status.success() {
                    return Ok(if stdout.is_empty() { stderr } else { stdout });
                }
                return Err(format!(
                    "claude plugin 失败（退出码 {:?}）\n{stderr}\n{stdout}",
                    status.code()
                ));
            }
            None => {
                if start.elapsed() > PLUGIN_CLI_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "claude plugin 超时（>{PLUGIN_CLI_TIMEOUT:?}）。若网络较慢，可稍后打开「已安装」确认是否已成功，或点击「刷新市场」后重试"
                    ));
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    }
}

fn run_claude_plugin_cli(home: &Path, args: &[&str]) -> Result<String, String> {
    run_claude_plugin_cli_in(home, home, args)
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

fn validate_scope_for_project(scope: &str, project_root: Option<&Path>) -> Result<(), String> {
    if matches!(scope, "project" | "local") && project_root.is_none() {
        return Err("项目级或本地安装需要先选择工作区或仓库".to_string());
    }
    Ok(())
}

fn cwd_for_scope(home: &Path, project_root: Option<&Path>, scope: &str) -> PathBuf {
    match scope {
        "project" | "local" => project_root
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| home.to_path_buf()),
        _ => home.to_path_buf(),
    }
}

fn plugin_entry_key(id: &str, scope: &str) -> (String, String) {
    (id.trim().to_string(), scope.trim().to_string())
}

fn paths_match_claude_project(left: &Path, right: &str) -> bool {
    let right_trim = right.trim();
    if right_trim.is_empty() {
        return false;
    }
    let right_path = PathBuf::from(right_trim);
    let left_canon = fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let right_canon = if right_path.is_absolute() {
        fs::canonicalize(&right_path).unwrap_or(right_path)
    } else {
        right_path
    };
    left_canon == right_canon
}

fn entry_project_path(row: &serde_json::Value) -> Option<String> {
    row.get("projectPath")
        .or_else(|| row.get("project_path"))
        .or_else(|| row.get("projectRoot"))
        .or_else(|| row.get("project_root"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn parse_plugin_list_json(raw: &str) -> Result<Vec<ClaudePluginInstalledEntry>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("解析已安装插件列表失败: {e}"))?;
    let rows = if let Some(arr) = value.as_array() {
        arr.clone()
    } else if let Some(arr) = value.get("installed").and_then(|v| v.as_array()) {
        arr.clone()
    } else {
        return Err("解析已安装插件列表失败: 未知 JSON 结构".to_string());
    };
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

fn list_via_cli(home: &Path, cwd: &Path) -> Result<Vec<ClaudePluginInstalledEntry>, String> {
    let raw = run_claude_plugin_cli_in(home, cwd, &["plugin", "list", "--json"])?;
    parse_plugin_list_json(&raw)
}

fn read_installed_plugins_registry(
    project_root: Option<&Path>,
) -> Result<Vec<ClaudePluginInstalledEntry>, String> {
    let path = crate::claude_config_dir::user_claude_dir()
        .join("plugins")
        .join("installed_plugins.json");
    let Some(value) = read_json_file(&path) else {
        return Ok(Vec::new());
    };
    let plugins = value
        .get("plugins")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "installed_plugins.json 缺少 plugins 字段".to_string())?;
    let mut out = Vec::new();
    for (id, entries) in plugins {
        let id = id.trim();
        if id.is_empty() {
            continue;
        }
        let Some(arr) = entries.as_array() else {
            continue;
        };
        for entry in arr {
            let scope = entry
                .get("scope")
                .and_then(|v| v.as_str())
                .unwrap_or("user")
                .trim()
                .to_string();
            if scope == "project" || scope == "local" {
                if let Some(proj_path) = entry_project_path(entry) {
                    if let Some(root) = project_root {
                        if !paths_match_claude_project(root, &proj_path) {
                            continue;
                        }
                    }
                } else if project_root.is_none() {
                    // 无仓库上下文时仍展示项目/本地登记，便于全局视图发现
                }
            }
            out.push(ClaudePluginInstalledEntry {
                id: id.to_string(),
                version: entry
                    .get("version")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                scope,
                enabled: true,
            });
        }
    }
    Ok(out)
}

fn merge_installed_entries(
    registry_rows: Vec<ClaudePluginInstalledEntry>,
    cli_rows: Vec<ClaudePluginInstalledEntry>,
) -> Vec<ClaudePluginInstalledEntry> {
    let mut enabled_map: HashMap<(String, String), bool> = HashMap::new();
    for row in &cli_rows {
        enabled_map.insert(plugin_entry_key(&row.id, &row.scope), row.enabled);
    }

    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut out: Vec<ClaudePluginInstalledEntry> = Vec::new();

    for row in registry_rows {
        let key = plugin_entry_key(&row.id, &row.scope);
        if !seen.insert(key.clone()) {
            continue;
        }
        let enabled = enabled_map.get(&key).copied().unwrap_or(row.enabled);
        out.push(ClaudePluginInstalledEntry {
            id: row.id,
            version: row.version,
            scope: row.scope,
            enabled,
        });
    }

    for row in &cli_rows {
        let key = plugin_entry_key(&row.id, &row.scope);
        if seen.insert(key) {
            out.push(row.clone());
        }
    }

    out.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then_with(|| a.id.cmp(&b.id))
    });
    out
}

fn list_installed_sync(repository_path: Option<&str>) -> Result<Vec<ClaudePluginInstalledEntry>, String> {
    let home = home_dir()?;
    let project_root = canonicalize_existing_project_dir(repository_path);

    let registry_rows = read_installed_plugins_registry(project_root.as_deref())?;

    let mut cli_rows = list_via_cli(&home, &home).unwrap_or_default();
    if let Some(proj) = project_root.as_ref() {
        if let Ok(rows) = list_via_cli(&home, proj) {
            cli_rows.extend(rows);
        }
    }

    Ok(merge_installed_entries(registry_rows, cli_rows))
}

fn ensure_marketplaces_sync(home: &Path) -> ClaudePluginMarketBootstrapResult {
    let mut log = String::new();
    let mut ok = true;
    for source in BOOTSTRAP_MARKETPLACES {
        match run_claude_plugin_cli(home, &["plugin", "marketplace", "add", source]) {
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
pub async fn claude_plugin_list_installed(
    repository_path: Option<String>,
) -> Result<Vec<ClaudePluginInstalledEntry>, String> {
    spawn_blocking_result("读取已安装插件失败", move || {
        list_installed_sync(repository_path.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn claude_plugin_install(
    install_ref: String,
    scope: String,
    repository_path: Option<String>,
) -> Result<String, String> {
    validate_install_ref(&install_ref)?;
    let scope_value = validate_scope(&scope)?;
    let home = home_dir()?;
    let project_root = canonicalize_existing_project_dir(repository_path.as_deref());
    validate_scope_for_project(&scope_value, project_root.as_deref())?;
    let cwd = cwd_for_scope(&home, project_root.as_deref(), &scope_value);
    let install_ref_value = install_ref.trim().to_string();
    spawn_blocking_result("安装插件任务失败", move || {
        run_claude_plugin_cli_in(
            &home,
            &cwd,
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
pub async fn claude_plugin_uninstall(
    install_ref: String,
    scope: String,
    repository_path: Option<String>,
) -> Result<String, String> {
    validate_install_ref(&install_ref)?;
    let scope_value = validate_scope(&scope)?;
    let home = home_dir()?;
    let project_root = canonicalize_existing_project_dir(repository_path.as_deref());
    validate_scope_for_project(&scope_value, project_root.as_deref())?;
    let cwd = cwd_for_scope(&home, project_root.as_deref(), &scope_value);
    let install_ref_value = install_ref.trim().to_string();
    spawn_blocking_result("卸载插件任务失败", move || {
        run_claude_plugin_cli_in(
            &home,
            &cwd,
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
