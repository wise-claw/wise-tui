//! Merge `.claude/hooks/` directory configs and scripts into project hook scope.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use super::shared::read_json_file;
use super::{ClaudeHookHandler, ClaudeHookMatcherGroup, ClaudeHookScopeData};

const HOOK_SCRIPT_EXTENSIONS: &[&str] = &["py", "sh", "bash", "zsh", "js", "mjs", "cjs", "ts"];

pub(crate) fn parse_hooks_from_settings_value(
    v: &serde_json::Value,
    id_prefix: &str,
) -> (bool, HashMap<String, Vec<ClaudeHookMatcherGroup>>) {
    let disable_all_hooks = v
        .get("disableAllHooks")
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    let mut event_map: HashMap<String, Vec<ClaudeHookMatcherGroup>> = HashMap::new();
    if let Some(hooks_obj) = v.get("hooks").and_then(|x| x.as_object()) {
        ingest_hooks_object(&mut event_map, hooks_obj, id_prefix);
    }
    (disable_all_hooks, event_map)
}

fn ingest_hooks_object(
    event_map: &mut HashMap<String, Vec<ClaudeHookMatcherGroup>>,
    hooks_obj: &serde_json::Map<String, serde_json::Value>,
    id_prefix: &str,
) {
    for (event_name, groups_val) in hooks_obj {
        let Some(groups_arr) = groups_val.as_array() else {
            continue;
        };
        let mut groups: Vec<ClaudeHookMatcherGroup> = Vec::new();
        for (g_idx, g_val) in groups_arr.iter().enumerate() {
            let Some(g_obj) = g_val.as_object() else {
                continue;
            };
            let matcher = g_obj
                .get("matcher")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            let mut handlers: Vec<ClaudeHookHandler> = Vec::new();
            if let Some(hooks_arr) = g_obj.get("hooks").and_then(|x| x.as_array()) {
                for (h_idx, h_val) in hooks_arr.iter().enumerate() {
                    let Some(h_obj) = h_val.as_object() else {
                        continue;
                    };
                    let ty = h_obj
                        .get("type")
                        .and_then(|x| x.as_str())
                        .unwrap_or("command")
                        .to_string();
                    let headers = h_obj
                        .get("headers")
                        .and_then(|x| x.as_object())
                        .map(|m| {
                            let mut out = HashMap::new();
                            for (k, v) in m {
                                if let Some(s) = v.as_str() {
                                    out.insert(k.clone(), s.to_string());
                                }
                            }
                            out
                        })
                        .filter(|m: &HashMap<String, String>| !m.is_empty());
                    let allowed_env_vars = h_obj
                        .get("allowedEnvVars")
                        .and_then(|x| x.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|x| x.as_str())
                                .map(|s| s.to_string())
                                .collect::<Vec<_>>()
                        })
                        .filter(|a| !a.is_empty());
                    handlers.push(ClaudeHookHandler {
                        id: format!("{id_prefix}{event_name}:{g_idx}:{h_idx}"),
                        r#type: ty,
                        r#if: h_obj
                            .get("if")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string()),
                        timeout: h_obj.get("timeout").and_then(|x| x.as_i64()),
                        status_message: h_obj
                            .get("statusMessage")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string()),
                        shell: h_obj
                            .get("shell")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string()),
                        r#async: h_obj.get("async").and_then(|x| x.as_bool()),
                        async_rewake: h_obj.get("asyncRewake").and_then(|x| x.as_bool()),
                        command: h_obj
                            .get("command")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string()),
                        url: h_obj
                            .get("url")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string()),
                        headers,
                        allowed_env_vars,
                        prompt: h_obj
                            .get("prompt")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string()),
                        model: h_obj
                            .get("model")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string()),
                    });
                }
            }
            groups.push(ClaudeHookMatcherGroup {
                id: format!("{id_prefix}{event_name}:{g_idx}"),
                matcher,
                hooks: handlers,
            });
        }
        if !groups.is_empty() {
            event_map.insert(event_name.to_string(), groups);
        }
    }
}

pub(crate) fn build_hook_scope_data_from_path(path: &Path, id_prefix: &str) -> ClaudeHookScopeData {
    let mut disable_all_hooks = false;
    let mut event_map: HashMap<String, Vec<ClaudeHookMatcherGroup>> = HashMap::new();
    if let Some(v) = read_json_file(path) {
        let (disable, parsed) = parse_hooks_from_settings_value(&v, id_prefix);
        disable_all_hooks = disable;
        event_map = parsed;
    }
    ClaudeHookScopeData {
        source_path: path.to_string_lossy().to_string(),
        disable_all_hooks,
        hooks: event_map,
    }
}

pub(crate) fn merge_hook_scope_data(
    base: ClaudeHookScopeData,
    extra: ClaudeHookScopeData,
) -> ClaudeHookScopeData {
    let mut hooks = base.hooks;
    for (event, mut groups) in extra.hooks {
        hooks.entry(event).or_default().append(&mut groups);
    }
    ClaudeHookScopeData {
        source_path: base.source_path,
        disable_all_hooks: base.disable_all_hooks || extra.disable_all_hooks,
        hooks,
    }
}

pub(crate) fn enrich_project_hooks_from_claude_hooks_dir(
    mut scope: ClaudeHookScopeData,
    project_root: &Path,
) -> ClaudeHookScopeData {
    let hooks_dir = project_root.join(".claude").join("hooks");
    if !hooks_dir.is_dir() {
        return scope;
    }

    let hooks_dir_display = hooks_dir.to_string_lossy().to_string();
    if scope.source_path.trim().is_empty() {
        scope.source_path = hooks_dir_display.clone();
    } else if !scope.source_path.contains(&hooks_dir_display) {
        scope.source_path = format!("{}\n{}", scope.source_path, hooks_dir_display);
    }

    let mut merged = scope;
    merged = merge_hook_scope_data(
        merged,
        build_hook_scope_data_from_path(&hooks_dir.join("hooks.json"), "hooks-dir:"),
    );

    let Ok(entries) = fs::read_dir(&hooks_dir) else {
        return append_hook_scripts(&mut merged, &hooks_dir);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name == "hooks.json" {
            continue;
        }
        if name.ends_with(".json") {
            merged = merge_hook_scope_data(
                merged,
                build_hook_scope_data_from_path(&path, &format!("hooks-dir:{name}:")),
            );
        }
    }

    append_hook_scripts(&mut merged, &hooks_dir)
}

fn append_hook_scripts(scope: &mut ClaudeHookScopeData, hooks_dir: &Path) -> ClaudeHookScopeData {
    let registered = registered_hook_signatures(scope);
    let Ok(entries) = fs::read_dir(hooks_dir) else {
        return scope.clone();
    };

    let mut script_entries: Vec<(String, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.ends_with(".json") {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        if !HOOK_SCRIPT_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }
        script_entries.push((name.to_string(), path));
    }
    script_entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (idx, (name, path)) in script_entries.into_iter().enumerate() {
        let rel = format!(".claude/hooks/{name}");
        let command = default_command_for_hook_script(&rel, &path);
        if registered.contains(&normalize_hook_signature(&command))
            || registered.iter().any(|sig| sig.contains(&name))
        {
            continue;
        }
        let event_name = infer_event_from_hook_script_name(&name).to_string();
        let handler = ClaudeHookHandler {
            id: format!("hooks-dir:script:{event_name}:{idx}:0"),
            r#type: "command".to_string(),
            r#if: None,
            timeout: Some(30),
            status_message: None,
            shell: None,
            r#async: None,
            async_rewake: None,
            command: Some(command),
            url: None,
            headers: None,
            allowed_env_vars: None,
            prompt: None,
            model: None,
        };
        let group = ClaudeHookMatcherGroup {
            id: format!("hooks-dir:script:{event_name}:{idx}"),
            matcher: Some(name.clone()),
            hooks: vec![handler],
        };
        scope.hooks.entry(event_name).or_default().push(group);
    }

    scope.clone()
}

fn default_command_for_hook_script(rel: &str, path: &Path) -> String {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("py") => format!("python3 {rel}"),
        Some("js" | "mjs" | "cjs") => format!("node {rel}"),
        Some("ts") => format!("npx tsx {rel}"),
        _ => format!("bash {rel}"),
    }
}

fn infer_event_from_hook_script_name(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.contains("session-start") || lower.contains("session_start") {
        return "SessionStart";
    }
    if lower.contains("workflow-state") || lower.contains("workflow_state") {
        return "UserPromptSubmit";
    }
    if lower.contains("subagent") {
        return "PreToolUse";
    }
    "HookScripts"
}

fn normalize_hook_signature(command: &str) -> String {
    command
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn registered_hook_signatures(scope: &ClaudeHookScopeData) -> HashSet<String> {
    let mut out = HashSet::new();
    for groups in scope.hooks.values() {
        for group in groups {
            for handler in &group.hooks {
                if let Some(command) = handler.command.as_deref() {
                    out.insert(normalize_hook_signature(command));
                }
            }
        }
    }
    out
}

/// 解析 Claude Code 插件包根中的 hooks 声明：优先 `hooks/hooks.json`，回退 `.claude-plugin/plugin.json`
/// 顶层 `hooks` / `hooksJsonPath` 字段。展开 `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`。
pub(crate) fn build_hook_scope_data_from_plugin_root(
    plugin_root: &Path,
    install_ref: &str,
) -> Option<ClaudeHookScopeData> {
    let id_prefix = format!("plugin:{install_ref}:");
    let data_dir = super::mcp::claude_plugin_data_dir_from_ref(install_ref);
    let data_dir_str = data_dir.to_string_lossy().to_string();

    // 1) plugin_root/hooks/hooks.json
    let direct = plugin_root.join("hooks").join("hooks.json");
    if direct.is_file() {
        if let Some(mut v) = read_json_file(&direct) {
            super::mcp::expand_plugin_vars_in_json_value(&mut v, plugin_root, &data_dir_str);
            let (disable_all_hooks, hooks) = parse_hooks_from_settings_value(&v, &id_prefix);
            return Some(ClaudeHookScopeData {
                source_path: direct.to_string_lossy().to_string(),
                disable_all_hooks,
                hooks,
            });
        }
    }

    // 2) plugin.json 顶层 hooks / hooksJsonPath
    let manifest = plugin_root.join(".claude-plugin").join("plugin.json");
    if let Some(mv) = read_json_file(&manifest) {
        if let Some(rel) = mv
            .get("hooksJsonPath")
            .or_else(|| mv.get("hooks_json_path"))
            .and_then(|x| x.as_str())
        {
            let rel = rel.trim().trim_start_matches("./");
            let path = plugin_root.join(rel);
            if path.is_file() {
                if let Some(mut v) = read_json_file(&path) {
                    super::mcp::expand_plugin_vars_in_json_value(
                        &mut v,
                        plugin_root,
                        &data_dir_str,
                    );
                    let (disable_all_hooks, hooks) =
                        parse_hooks_from_settings_value(&v, &id_prefix);
                    return Some(ClaudeHookScopeData {
                        source_path: path.to_string_lossy().to_string(),
                        disable_all_hooks,
                        hooks,
                    });
                }
            }
        }
        if let Some(_inline) = mv.get("hooks").and_then(|x| x.as_object()) {
            let mut v = serde_json::json!({ "hooks": mv.get("hooks").cloned().unwrap_or_default() });
            super::mcp::expand_plugin_vars_in_json_value(&mut v, plugin_root, &data_dir_str);
            let (disable_all_hooks, hooks) = parse_hooks_from_settings_value(&v, &id_prefix);
            if !hooks.is_empty() {
                return Some(ClaudeHookScopeData {
                    source_path: manifest.to_string_lossy().to_string(),
                    disable_all_hooks,
                    hooks,
                });
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn discovers_hook_scripts_under_claude_hooks_dir() {
        let dir = tempdir().expect("tempdir");
        let hooks_dir = dir.path().join(".claude").join("hooks");
        fs::create_dir_all(&hooks_dir).expect("mkdir");
        fs::write(hooks_dir.join("session-start.py"), "#!/usr/bin/env python3\n").expect("write");
        fs::write(
            hooks_dir.join("inject-workflow-state.py"),
            "#!/usr/bin/env python3\n",
        )
        .expect("write");

        let base = build_hook_scope_data_from_path(
            &dir.path().join(".claude").join("settings.json"),
            "",
        );
        let enriched = enrich_project_hooks_from_claude_hooks_dir(base, dir.path());

        assert!(enriched.source_path.contains(".claude/hooks"));
        assert!(enriched.hooks.contains_key("SessionStart"));
        assert!(enriched.hooks.contains_key("UserPromptSubmit"));
        let session = &enriched.hooks["SessionStart"];
        assert_eq!(session.len(), 1);
        assert_eq!(
            session[0].hooks[0].command.as_deref(),
            Some("python3 .claude/hooks/session-start.py")
        );
    }

    #[test]
    fn merges_hooks_json_from_claude_hooks_dir() {
        let dir = tempdir().expect("tempdir");
        let hooks_dir = dir.path().join(".claude").join("hooks");
        fs::create_dir_all(&hooks_dir).expect("mkdir");
        fs::write(
            hooks_dir.join("hooks.json"),
            r#"{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "echo from-hooks-json" }
        ]
      }
    ]
  }
}"#,
        )
        .expect("write");

        let base = build_hook_scope_data_from_path(
            &dir.path().join(".claude").join("settings.json"),
            "",
        );
        let enriched = enrich_project_hooks_from_claude_hooks_dir(base, dir.path());
        let pre = enriched.hooks.get("PreToolUse").expect("PreToolUse");
        assert!(
            pre.iter()
                .flat_map(|g| g.hooks.iter())
                .any(|h| h.command.as_deref() == Some("echo from-hooks-json"))
        );
    }

    #[test]
    fn discovers_plugin_hooks_with_claude_plugin_root_expansion() {
        let dir = tempdir().expect("tempdir");
        let plugin_root = dir.path().join("plugins").join("foo").join("1.0.0");
        let hooks_dir = plugin_root.join("hooks");
        fs::create_dir_all(&hooks_dir).expect("mkdir hooks");
        let hooks_json = r#"{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/x.py" }
        ]
      }
    ]
  }
}"#;
        fs::write(hooks_dir.join("hooks.json"), hooks_json).expect("write hooks.json");

        let scope = build_hook_scope_data_from_plugin_root(&plugin_root, "foo@bar")
            .expect("scope data should be built");
        let groups = scope
            .hooks
            .get("UserPromptSubmit")
            .expect("UserPromptSubmit group");
        let cmd = groups
            .iter()
            .flat_map(|g| g.hooks.iter())
            .find_map(|h| h.command.clone())
            .expect("command");
        assert!(
            cmd.contains(&plugin_root.to_string_lossy().to_string()),
            "expected ${{CLAUDE_PLUGIN_ROOT}} to be expanded to plugin_root, got {cmd}"
        );
        assert!(
            !cmd.contains("${CLAUDE_PLUGIN_ROOT}"),
            "placeholder should be gone, got {cmd}"
        );
        assert!(scope.source_path.ends_with("hooks.json"));
    }

    #[test]
    fn missing_plugin_hooks_returns_none() {
        let dir = tempdir().expect("tempdir");
        let plugin_root = dir.path().join("nope").join("0.0.0");
        fs::create_dir_all(&plugin_root).expect("mkdir");
        assert!(build_hook_scope_data_from_plugin_root(&plugin_root, "nope@x").is_none());
    }
}
