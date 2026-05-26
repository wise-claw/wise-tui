//! Merge extension-library hook snapshots into Claude Code settings files.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::config_file::{read_json_root, write_json_root};
use super::paths::InstallScope;
use crate::claude_config_dir;

pub fn hooks_config_candidates(scope: InstallScope, repo: Option<&Path>) -> Result<Vec<PathBuf>, String> {
    match scope {
        InstallScope::Global => Ok(vec![
            claude_config_dir::user_claude_dir().join("settings.json"),
            claude_config_dir::user_claude_dir().join("settings.local.json"),
        ]),
        InstallScope::Repository => {
            let repo = repo.ok_or_else(|| "缺少仓库路径".to_string())?;
            let canon = fs::canonicalize(repo).map_err(|e| format!("无法解析仓库路径: {e}"))?;
            Ok(vec![
                canon.join(".claude").join("settings.json"),
                canon.join(".claude").join("settings.local.json"),
            ])
        }
    }
}

fn default_hooks_install_path(candidates: &[PathBuf]) -> PathBuf {
    candidates
        .first()
        .cloned()
        .unwrap_or_else(|| {
            claude_config_dir::user_claude_dir().join("settings.json")
        })
}

/// 优先写入收录来源文件；否则写入已有 hooks 的配置；最后写入 scope 默认 settings.json。
pub fn resolve_hooks_install_path(
    scope: InstallScope,
    repo: Option<&Path>,
    source_path_hint: Option<&str>,
) -> Result<PathBuf, String> {
    let candidates = hooks_config_candidates(scope, repo)?;

    if let Some(hint) = source_path_hint.map(str::trim).filter(|s| !s.is_empty()) {
        let hint_path = PathBuf::from(hint);
        let hint_canon = fs::canonicalize(&hint_path).unwrap_or(hint_path);
        for c in &candidates {
            if let Ok(canon) = fs::canonicalize(c) {
                if canon == hint_canon {
                    return Ok(canon);
                }
            }
        }
    }

    for path in &candidates {
        if path.is_file() {
            if let Ok(root) = read_json_root(path) {
                if hooks_object_nonempty(&root) {
                    return Ok(path.clone());
                }
            }
        }
    }

    Ok(default_hooks_install_path(&candidates))
}

pub fn merge_hooks_into_file(path: &Path, incoming_hooks: Value) -> Result<(), String> {
    if !incoming_hooks.is_object() {
        return Err("hooks 须为 JSON 对象".to_string());
    }
    if incoming_hooks.as_object().is_some_and(|m| m.is_empty()) {
        return Err("hooks 配置为空".to_string());
    }

    let mut root = read_json_root(path)?;
    let merged = match root.get("hooks").cloned() {
        Some(existing) if existing.is_object() => merge_hooks_objects(existing, incoming_hooks),
        _ => incoming_hooks,
    };
    if !root.is_object() {
        root = json!({});
    }
    root.as_object_mut()
        .unwrap()
        .insert("hooks".to_string(), merged);
    write_json_root(path, &root)
}

fn hooks_object_nonempty(root: &Value) -> bool {
    root.get("hooks")
        .and_then(|h| h.as_object())
        .is_some_and(|m| !m.is_empty())
}

fn merge_hooks_objects(existing: Value, incoming: Value) -> Value {
    let Value::Object(overlay) = incoming else {
        return incoming;
    };
    let Value::Object(mut base) = existing else {
        return Value::Object(overlay);
    };
    for (event, inc_val) in overlay {
        match base.get_mut(&event) {
            Some(Value::Array(existing_arr)) if inc_val.is_array() => {
                merge_hook_matcher_arrays(existing_arr, inc_val.as_array().unwrap());
            }
            None => {
                base.insert(event, inc_val);
            }
            _ => {
                base.insert(event, inc_val);
            }
        }
    }
    Value::Object(base)
}

fn merge_hook_matcher_arrays(existing: &mut Vec<Value>, incoming: &[Value]) {
    for inc in incoming {
        let Some(inc_obj) = inc.as_object() else {
            existing.push(inc.clone());
            continue;
        };
        let inc_matcher = matcher_key(inc_obj.get("matcher"));
        if let Some(pos) = existing.iter().position(|e| {
            e.as_object()
                .map(|o| matcher_key(o.get("matcher")) == inc_matcher)
                .unwrap_or(false)
        }) {
            merge_hook_matcher_entry(&mut existing[pos], inc);
        } else {
            existing.push(inc.clone());
        }
    }
}

fn merge_hook_matcher_entry(existing: &mut Value, incoming: &Value) {
    let Some(in_obj) = incoming.as_object() else {
        *existing = incoming.clone();
        return;
    };
    let Some(ex_obj) = existing.as_object_mut() else {
        *existing = incoming.clone();
        return;
    };
    if let Some(m) = in_obj.get("matcher") {
        ex_obj.insert("matcher".to_string(), m.clone());
    }
    match (ex_obj.get_mut("hooks"), in_obj.get("hooks")) {
        (Some(Value::Array(ex_cmds)), Some(Value::Array(in_cmds))) => {
            append_unique_hook_commands(ex_cmds, in_cmds);
        }
        (_, Some(inc_cmds)) => {
            ex_obj.insert("hooks".to_string(), inc_cmds.clone());
        }
        _ => {}
    }
}

fn append_unique_hook_commands(existing: &mut Vec<Value>, incoming: &[Value]) {
    for cmd in incoming {
        if !existing.iter().any(|e| hook_command_eq(e, cmd)) {
            existing.push(cmd.clone());
        }
    }
}

fn hook_command_eq(a: &Value, b: &Value) -> bool {
    serde_json::to_string(a).ok() == serde_json::to_string(b).ok()
}

fn matcher_key(matcher: Option<&Value>) -> String {
    matcher
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn merge_preserves_other_root_keys_and_hook_events() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("settings.json");
        fs::write(
            &path,
            r#"{
              "mcpServers": {"x": {"type": "stdio", "command": "x"}},
              "hooks": {
                "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "lint"}]}]
              }
            }"#,
        )
        .expect("write");

        let incoming = json!({
            "PostToolUse": [{
                "matcher": "Edit",
                "hooks": [{"type": "command", "command": "fmt"}]
            }],
            "PreToolUse": [{
                "matcher": "Bash",
                "hooks": [{"type": "command", "command": "extra"}]
            }]
        });
        merge_hooks_into_file(&path, incoming).expect("merge");

        let v: Value = serde_json::from_str(&fs::read_to_string(&path).expect("read")).expect("json");
        assert!(v.get("mcpServers").is_some());
        let hooks = v.get("hooks").and_then(|h| h.as_object()).expect("hooks");
        assert!(hooks.contains_key("PreToolUse"));
        assert!(hooks.contains_key("PostToolUse"));
        let pre = hooks
            .get("PreToolUse")
            .and_then(|x| x.as_array())
            .and_then(|a| a.first())
            .expect("pre");
        let cmds = pre.get("hooks").and_then(|x| x.as_array()).expect("cmds");
        assert_eq!(cmds.len(), 2);
    }

    #[test]
    fn resolve_prefers_source_path_hint() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let claude = tmp.path().join(".claude");
        fs::create_dir_all(&claude).expect("dir");
        let local = claude.join("settings.local.json");
        let mut f = fs::File::create(&local).expect("create");
        write!(f, r#"{{"hooks":{{"Stop":[]}}}}"#).expect("write");
        let settings = claude.join("settings.json");
        fs::write(&settings, r#"{"hooks":{"PreToolUse":[]}}"#).expect("write");

        let path = resolve_hooks_install_path(
            InstallScope::Repository,
            Some(tmp.path()),
            Some(local.to_str().unwrap()),
        )
        .expect("resolve");
        assert_eq!(
            fs::canonicalize(&path).expect("canon"),
            fs::canonicalize(&local).expect("canon")
        );
    }

    #[test]
    fn global_default_is_user_settings_json() {
        let path = resolve_hooks_install_path(InstallScope::Global, None, None).expect("resolve");
        assert_eq!(
            path,
            claude_config_dir::user_claude_dir().join("settings.json")
        );
    }
}
