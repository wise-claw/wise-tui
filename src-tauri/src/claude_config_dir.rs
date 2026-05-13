//! 解析「用户级 Claude Code 配置目录」的全局位置。
//!
//! 默认沿用官方 `~/.claude`。用户可在「应用设置」中改为 `~/.codefuse/engine/cc`
//! 等同源工具的目录，或自定义任意绝对/`~`-展开路径。值保存在 `app_settings` 表，
//! 启动时从数据库回填全局缓存，写入命令同时刷新缓存，使后续 IPC 立即生效。
//!
//! 仅影响「用户级」路径（`~/.claude/...`、`~/.claude.json`），不改变
//! 仓库内的 `<project>/.claude/...`（项目级配置始终保持官方布局）。

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use crate::wise_db::WiseDb;

/// `app_settings` 中保存原始字符串（保留 `~` 展开前形态，便于回显与跨用户携带）。
pub(crate) const CLAUDE_USER_CONFIG_DIR_SETTING_KEY: &str = "claude_user_config_dir";

/// 全局缓存：写命令更新 / 启动 init 时写入；读命令尽量从这里出。
static USER_CLAUDE_DIR_CACHE: RwLock<Option<PathBuf>> = RwLock::new(None);

/// `~` / `~/foo` 展开到 `$HOME`；非 `~` 路径原样返回 `PathBuf`。
pub(crate) fn expand_tilde(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed == "~" {
        return dirs::home_dir();
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        let home = dirs::home_dir()?;
        return Some(home.join(rest));
    }
    Some(PathBuf::from(trimmed))
}

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

/// 启动时调用：从 SQLite 回填缓存。读不到 / 解析失败 → 缓存留空，后续走默认。
pub(crate) fn init_from_db(db: &WiseDb) {
    let raw = match db.get_setting(CLAUDE_USER_CONFIG_DIR_SETTING_KEY) {
        Ok(v) => v,
        Err(_) => None,
    };
    let resolved = raw.as_deref().and_then(expand_tilde);
    update_cache(resolved);
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeUserConfigDirInfo {
    /// 原始字符串（含 `~` 前缀），用户未设置时为 `None`。
    raw_value: Option<String>,
    /// 解析后绝对路径。
    resolved_path: String,
    /// 当前是否使用默认 `~/.claude`。
    is_default: bool,
    /// 默认解析后的路径（展示给用户做对比）。
    default_resolved_path: String,
    /// 解析后路径是否存在（用于 UI 警告）。
    exists: bool,
}

fn build_info(raw_value: Option<String>) -> ClaudeUserConfigDirInfo {
    let resolved = user_claude_dir();
    let default_path = default_user_claude_dir();
    let is_default = resolved == default_path;
    let exists = resolved.is_dir();
    ClaudeUserConfigDirInfo {
        raw_value,
        resolved_path: resolved.to_string_lossy().to_string(),
        is_default,
        default_resolved_path: default_path.to_string_lossy().to_string(),
        exists,
    }
}

fn validate_user_dir_candidate(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".to_string());
    }
    let resolved = expand_tilde(trimmed).ok_or_else(|| "无法解析该路径".to_string())?;
    if !resolved.is_absolute() {
        return Err("请使用绝对路径或以 ~ 开头的路径".to_string());
    }
    // 允许目录暂不存在（用户可能先配置后初始化），仅在存在时检查其确为目录。
    if Path::new(&resolved).exists() && !resolved.is_dir() {
        return Err("该路径已存在但不是目录".to_string());
    }
    Ok(resolved)
}

#[tauri::command]
pub(crate) fn get_claude_user_config_dir(
    db: tauri::State<'_, WiseDb>,
) -> Result<ClaudeUserConfigDirInfo, String> {
    let raw_value = db.get_setting(CLAUDE_USER_CONFIG_DIR_SETTING_KEY)?;
    Ok(build_info(raw_value))
}

#[tauri::command]
pub(crate) fn set_claude_user_config_dir(
    db: tauri::State<'_, WiseDb>,
    value: Option<String>,
) -> Result<ClaudeUserConfigDirInfo, String> {
    let trimmed = value
        .as_deref()
        .map(str::trim)
        .map(str::to_string)
        .filter(|s| !s.is_empty());

    match trimmed {
        Some(raw) => {
            let resolved = validate_user_dir_candidate(&raw)?;
            db.set_setting(CLAUDE_USER_CONFIG_DIR_SETTING_KEY, &raw)?;
            update_cache(Some(resolved));
            Ok(build_info(Some(raw)))
        }
        None => {
            db.delete_setting(CLAUDE_USER_CONFIG_DIR_SETTING_KEY)?;
            update_cache(None);
            Ok(build_info(None))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_tilde_handles_basic_cases() {
        assert!(expand_tilde("").is_none());
        assert!(expand_tilde("   ").is_none());
        let plain = expand_tilde("/tmp/foo").unwrap();
        assert_eq!(plain, PathBuf::from("/tmp/foo"));
        if let Some(home) = dirs::home_dir() {
            assert_eq!(expand_tilde("~").unwrap(), home);
            assert_eq!(expand_tilde("~/.codefuse/engine/cc").unwrap(), home.join(".codefuse/engine/cc"));
        }
    }

    #[test]
    fn root_json_follows_directory_name() {
        if dirs::home_dir().is_none() {
            return;
        }
        update_cache(None);
        let json_default = user_claude_root_json();
        assert!(json_default.ends_with(".claude.json"));

        let alt = dirs::home_dir().unwrap().join(".codefuse").join("engine").join("cc");
        update_cache(Some(alt.clone()));
        let json_alt = user_claude_root_json();
        assert_eq!(json_alt, alt.parent().unwrap().join("cc.json"));

        update_cache(None);
    }
}
