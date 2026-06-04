//! Merge extension-library MCP snapshots into Claude Code config files.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use super::config_file::{deep_merge_json, read_json_root, write_json_root};
use super::paths::InstallScope;
use crate::claude_config_dir;

/// 解析 MCP 安装应写入的配置文件路径（优先更新已存在同名 server 的文件）。
#[allow(dead_code)] // exercised by unit tests in this module
pub fn resolve_mcp_install_path(scope: InstallScope, repo: Option<&Path>) -> Result<PathBuf, String> {
    let candidates = mcp_config_candidates(scope, repo)?;
    Ok(select_mcp_install_path(&candidates))
}

/// 将 MCP server 条目合并进目标 JSON 配置文件（保留其它顶层字段，深度合并同名 server）。
pub fn merge_mcp_server_into_file(
    path: &Path,
    server_name: &str,
    entry: Value,
) -> Result<(), String> {
    let name = server_name.trim();
    if name.is_empty() {
        return Err("MCP 服务器名称不能为空".to_string());
    }
    if !entry.is_object() {
        return Err("MCP 条目须为 JSON 对象".to_string());
    }

    let mut root = read_json_root(path)?;
    merge_server_into_root(&mut root, name, entry)?;
    write_json_root(path, &root)
}

pub fn mcp_config_candidates(
    scope: InstallScope,
    repo: Option<&Path>,
) -> Result<Vec<PathBuf>, String> {
    match scope {
        InstallScope::Global => Ok(vec![
            claude_config_dir::user_claude_root_json(),
            claude_config_dir::user_claude_dir().join("settings.json"),
        ]),
        InstallScope::Repository => {
            let repo = repo.ok_or_else(|| "缺少仓库路径".to_string())?;
            let canon = fs::canonicalize(repo).map_err(|e| format!("无法解析仓库路径: {e}"))?;
            Ok(vec![
                canon.join(".mcp.json"),
                canon.join(".claude").join("settings.json"),
            ])
        }
    }
}

fn select_mcp_install_path(candidates: &[PathBuf]) -> PathBuf {
    candidates
        .first()
        .cloned()
        .unwrap_or_else(|| claude_config_dir::user_claude_root_json())
}

/// 若已有配置文件包含同名 server，写入该文件；否则写入 scope 的默认目标。
pub fn resolve_mcp_install_path_for_server(
    scope: InstallScope,
    repo: Option<&Path>,
    server_name: &str,
) -> Result<PathBuf, String> {
    let candidates = mcp_config_candidates(scope, repo)?;
    let name = server_name.trim();
    for path in &candidates {
        if path.is_file() {
            if let Ok(root) = read_json_root(path) {
                if mcp_servers_map(&root).is_some_and(|m| m.contains_key(name)) {
                    return Ok(path.clone());
                }
            }
        }
    }
    Ok(select_mcp_install_path(&candidates))
}

fn mcp_servers_map(v: &Value) -> Option<&Map<String, Value>> {
    v.get("mcpServers")
        .and_then(|x| x.as_object())
        .or_else(|| v.get("mcp_servers").and_then(|x| x.as_object()))
}

fn mcp_servers_map_mut(v: &mut Value) -> Result<&mut Map<String, Value>, String> {
    if !v.is_object() {
        *v = json!({});
    }
    let obj = v.as_object_mut().unwrap();

    if let Some(snake) = obj.remove("mcp_servers") {
        let camel = obj
            .entry("mcpServers")
            .or_insert_with(|| json!({}));
        if let (Some(c), Some(s)) = (camel.as_object_mut(), snake.as_object()) {
            for (k, v) in s {
                c.entry(k.clone())
                    .or_insert_with(|| v.clone());
            }
        } else if !camel.is_object() {
            *camel = snake;
        }
    }

    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| json!({}));
    servers
        .as_object_mut()
        .ok_or_else(|| "mcpServers 须为对象".to_string())
}

fn merge_server_into_root(root: &mut Value, name: &str, entry: Value) -> Result<(), String> {
    let servers = mcp_servers_map_mut(root)?;
    let merged = match servers.remove(name) {
        Some(existing) => deep_merge_json(existing, entry),
        None => entry,
    };
    servers.insert(name.to_string(), merged);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn merge_preserves_other_root_keys() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("settings.json");
        fs::write(
            &path,
            r#"{"hooks":{"PreToolUse":[]},"mcpServers":{"old":{"type":"stdio","command":"x"}}}"#,
        )
        .expect("write");

        merge_mcp_server_into_file(
            &path,
            "old",
            json!({"type": "stdio", "command": "y", "env": {"A": "1"}}),
        )
        .expect("merge");

        let v: Value = serde_json::from_str(&fs::read_to_string(&path).expect("read")).expect("json");
        assert!(v.get("hooks").is_some());
        let old = v
            .get("mcpServers")
            .and_then(|x| x.get("old"))
            .expect("old server");
        assert_eq!(old.get("command").and_then(|x| x.as_str()), Some("y"));
        assert_eq!(
            old.get("env")
                .and_then(|x| x.get("A"))
                .and_then(|x| x.as_str()),
            Some("1")
        );
    }

    #[test]
    fn reads_mcp_servers_snake_case_and_writes_camel_case() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("mcp.json");
        fs::write(&path, r#"{"mcp_servers":{"srv":{"type":"http","url":"http://a"}}}"#)
            .expect("write");

        merge_mcp_server_into_file(&path, "srv", json!({"url": "http://b"})).expect("merge");

        let v: Value = serde_json::from_str(&fs::read_to_string(&path).expect("read")).expect("json");
        assert!(v.get("mcp_servers").is_none());
        let srv = v
            .get("mcpServers")
            .and_then(|x| x.get("srv"))
            .expect("srv");
        assert_eq!(srv.get("url").and_then(|x| x.as_str()), Some("http://b"));
        assert_eq!(srv.get("type").and_then(|x| x.as_str()), Some("http"));
    }

    #[test]
    fn resolve_install_path_prefers_existing_server_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let repo = tmp.path();
        let legacy = repo.join(".claude");
        fs::create_dir_all(&legacy).expect("dir");
        let settings = legacy.join("settings.json");
        let mut f = fs::File::create(&settings).expect("create");
        write!(
            f,
            r#"{{"mcpServers":{{"my-srv":{{"type":"stdio","command":"c"}}}}}}"#
        )
        .expect("write");

        let path = resolve_mcp_install_path_for_server(
            InstallScope::Repository,
            Some(repo),
            "my-srv",
        )
        .expect("resolve");
        assert_eq!(
            fs::canonicalize(&path).expect("canon"),
            fs::canonicalize(&settings).expect("canon")
        );
    }

    #[test]
    fn repo_default_target_is_dot_mcp_json() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let repo = fs::canonicalize(tmp.path()).expect("canon repo");
        let path = resolve_mcp_install_path(InstallScope::Repository, Some(&repo)).expect("resolve");
        assert_eq!(path.file_name().and_then(|s| s.to_str()), Some(".mcp.json"));
        assert_eq!(
            path.parent().map(fs::canonicalize).transpose().expect("parent"),
            Some(repo)
        );
    }

    #[test]
    fn global_default_target_is_user_claude_json() {
        let path = resolve_mcp_install_path(InstallScope::Global, None).expect("resolve");
        assert_eq!(path, claude_config_dir::user_claude_root_json());
    }
}
