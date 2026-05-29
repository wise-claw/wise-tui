use super::shared::read_json_file;
use super::{claude_path_search_prefixes, find_claude_binary, merge_path_env};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeMcpItem {
    id: String,
    name: String,
    command: String,
    status: String,
    enabled: bool,
    tools: Vec<String>,
    scope: String,
    source_path: String,
    claude_json_project_key: Option<String>,
    /// 例如 `oh-my-claudecode@omc`（仅 `scope == plugin` 时有值）。
    #[serde(skip_serializing_if = "Option::is_none")]
    plugin_ref: Option<String>,
    /// From `claude mcp list` health check when available: `connected` | `failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    runtime_status: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeMcpStatusResponse {
    user: Vec<ClaudeMcpItem>,
    local: Vec<ClaudeMcpItem>,
    project_shared: Vec<ClaudeMcpItem>,
    legacy_user_settings: Vec<ClaudeMcpItem>,
    legacy_project_settings: Vec<ClaudeMcpItem>,
    /// 插件 MCP：Wise 不从 `~/.claude/plugins/**` 枚举；保留字段以兼容前端分组（恒为空）。
    plugin_mcp: Vec<ClaudeMcpItem>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeMcpRuntimeHealthEntry {
    name: String,
    status: String,
}

fn parse_mcp_tools(cfg: &serde_json::Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let candidates = [
        cfg.get("tools"),
        cfg.get("allowed_tools"),
        cfg.get("allowedTools"),
    ];
    for arr in candidates.into_iter().flatten() {
        let Some(items) = arr.as_array() else {
            continue;
        };
        for item in items {
            let name = if let Some(s) = item.as_str() {
                s.trim().to_string()
            } else if let Some(obj) = item.as_object() {
                obj.get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default()
            } else {
                String::new()
            };
            if !name.is_empty() && seen.insert(name.clone()) {
                out.push(name);
            }
        }
    }
    out
}

/// 环境变量名：首字符须为 ASCII 字母或 `_`，避免把 URL 里的 `%20` 等当成 `%VAR%`。
fn claude_mcp_valid_env_var_name(name: &str) -> bool {
    let mut it = name.bytes();
    let Some(first) = it.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == b'_') {
        return false;
    }
    it.all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// 展开 `$VAR`、`${VAR}` 与 Windows 风格 `%VAR%`（未设置则为空串）。用于 MCP 路径与 `command`/`args` 展示。
fn expand_env_vars_in_str(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;
    while i < input.len() {
        let c = input[i..].chars().next().unwrap();
        let clen = c.len_utf8();
        if c == '%' {
            if let Some(rest) = input.get(i + 1..) {
                if let Some(rel_end) = rest.find('%') {
                    let name = &rest[..rel_end];
                    if claude_mcp_valid_env_var_name(name) {
                        out.push_str(&std::env::var(name).unwrap_or_default());
                        i += 1 + rel_end + 1;
                        continue;
                    }
                }
            }
        }
        if c == '$' && i + 1 < input.len() {
            let b = input.as_bytes();
            if b[i + 1] == b'{' {
                if let Some(close) = input[i + 2..].find('}') {
                    let name = &input[i + 2..i + 2 + close];
                    if claude_mcp_valid_env_var_name(name) {
                        out.push_str(&std::env::var(name).unwrap_or_default());
                        i += 2 + close + 1;
                        continue;
                    }
                }
            } else if b[i + 1].is_ascii_alphabetic() || b[i + 1] == b'_' {
                let mut j = i + 1;
                while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
                    j += 1;
                }
                if j > i + 1 {
                    let name = &input[i + 1..j];
                    if claude_mcp_valid_env_var_name(name) {
                        out.push_str(&std::env::var(name).unwrap_or_default());
                        i = j;
                        continue;
                    }
                }
            }
        }
        out.push(c);
        i += clen;
    }
    out
}

fn parse_mcp_command(cfg: &serde_json::Value) -> String {
    let raw = if let Some(ty) = cfg.get("type").and_then(|v| v.as_str()) {
        if ty.eq_ignore_ascii_case("http") || ty.eq_ignore_ascii_case("sse") {
            if let Some(url) = cfg.get("url").and_then(|v| v.as_str()) {
                format!("{} {}", ty, url.trim())
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    } else {
        String::new()
    };
    if !raw.is_empty() {
        return expand_env_vars_in_str(&raw);
    }
    if let Some(cmd) = cfg.get("command").and_then(|v| v.as_str()) {
        let mut text = cmd.trim().to_string();
        if let Some(args) = cfg.get("args").and_then(|v| v.as_array()) {
            let suffix = args
                .iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            if !suffix.is_empty() {
                text.push(' ');
                text.push_str(&suffix);
            }
        }
        return expand_env_vars_in_str(&text);
    }
    if let Some(url) = cfg.get("url").and_then(|v| v.as_str()) {
        return expand_env_vars_in_str(url.trim());
    }
    if let Some(endpoint) = cfg.get("endpoint").and_then(|v| v.as_str()) {
        return expand_env_vars_in_str(endpoint.trim());
    }
    if let Some(transport) = cfg.get("transport").and_then(|v| v.as_str()) {
        return expand_env_vars_in_str(transport.trim());
    }
    "未配置命令".to_string()
}

fn paths_match_claude_project(project_path: &str, json_key: &str) -> bool {
    let a = project_path.trim();
    let b = json_key.trim();
    if a == b {
        return true;
    }
    let ca = fs::canonicalize(Path::new(a)).ok();
    let cb = fs::canonicalize(Path::new(b)).ok();
    match (ca, cb) {
        (Some(ref x), Some(ref y)) if x == y => true,
        (Some(ref x), None) => x.to_string_lossy() == b,
        (None, Some(ref y)) => y.to_string_lossy() == a,
        _ => false,
    }
}

fn build_mcp_items_from_map(
    map: &serde_json::Map<String, serde_json::Value>,
    scope: &str,
    source_path: &str,
    claude_json_project_key: Option<&str>,
) -> Vec<ClaudeMcpItem> {
    let mut out: Vec<ClaudeMcpItem> = Vec::new();
    for (name, cfg) in map {
        let enabled = cfg.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true)
            && !cfg
                .get("disabled")
                .and_then(|x| x.as_bool())
                .unwrap_or(false);
        let status = if enabled {
            "connected".to_string()
        } else {
            "disconnected".to_string()
        };
        let command = parse_mcp_command(cfg);
        let tools = parse_mcp_tools(cfg);
        out.push(ClaudeMcpItem {
            id: format!("{}::{}", scope, name),
            name: name.to_string(),
            command,
            status,
            enabled,
            tools,
            scope: scope.to_string(),
            source_path: source_path.to_string(),
            claude_json_project_key: claude_json_project_key.map(|s| s.to_string()),
            plugin_ref: None,
            runtime_status: None,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

fn build_mcp_items_from_settings_mcp_block(
    v: &serde_json::Value,
    scope: &str,
    source_path: &str,
    claude_json_project_key: Option<&str>,
) -> Vec<ClaudeMcpItem> {
    let Some(map) = v
        .get("mcpServers")
        .and_then(|x| x.as_object())
        .or_else(|| v.get("mcp_servers").and_then(|x| x.as_object()))
    else {
        return Vec::new();
    };
    build_mcp_items_from_map(map, scope, source_path, claude_json_project_key)
}

fn claude_plugin_data_dir_from_ref(plugin_ref: &str) -> PathBuf {
    let id: String = plugin_ref
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '_' | '-' => c,
            _ => '-',
        })
        .collect();
    crate::claude_config_dir::user_claude_dir()
        .join("plugins")
        .join("data")
        .join(id)
}

fn resolve_plugin_relative_path(plugin_root: &Path, rel: &str) -> PathBuf {
    let t = expand_env_vars_in_str(rel.trim());
    let t = t.strip_prefix("./").unwrap_or(t.as_str());
    plugin_root.join(t)
}

fn expand_plugin_vars_in_json_value(v: &mut serde_json::Value, root: &Path, data_dir: &str) {
    match v {
        serde_json::Value::String(s) => {
            let new_s = s
                .replace("${CLAUDE_PLUGIN_ROOT}", &root.to_string_lossy())
                .replace("${CLAUDE_PLUGIN_DATA}", data_dir);
            *s = expand_env_vars_in_str(&new_s);
        }
        serde_json::Value::Array(a) => {
            for x in a.iter_mut() {
                expand_plugin_vars_in_json_value(x, root, data_dir);
            }
        }
        serde_json::Value::Object(o) => {
            for (_, x) in o.iter_mut() {
                expand_plugin_vars_in_json_value(x, root, data_dir);
            }
        }
        _ => {}
    }
}

/// 将 `plugin.json` 的 `mcpServers` 字段（字符串路径 / 数组 / 内联对象）解析为若干 `(来源文件路径, 服务器表)`。
fn collect_mcp_maps_from_plugin_mcp_spec(
    plugin_root: &Path,
    spec: &serde_json::Value,
    hint_source: &str,
    out: &mut Vec<(String, serde_json::Map<String, serde_json::Value>)>,
) {
    match spec {
        serde_json::Value::String(rel) => {
            let path = resolve_plugin_relative_path(plugin_root, rel);
            if let Some(v) = read_json_file(&path) {
                let sp = path.to_string_lossy().to_string();
                if let Some(map) = v
                    .get("mcpServers")
                    .or_else(|| v.get("mcp_servers"))
                    .and_then(|x| x.as_object())
                {
                    out.push((sp, map.clone()));
                } else if let Some(map) = v.as_object() {
                    if !map.is_empty() && map.values().all(|vv| vv.as_object().is_some()) {
                        out.push((sp, map.clone()));
                    }
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                collect_mcp_maps_from_plugin_mcp_spec(plugin_root, item, hint_source, out);
            }
        }
        serde_json::Value::Object(obj) => {
            if let Some(ms) = obj
                .get("mcpServers")
                .or_else(|| obj.get("mcp_servers"))
                .and_then(|x| x.as_object())
            {
                out.push((hint_source.to_string(), ms.clone()));
                return;
            }
            if !obj.is_empty() && obj.values().all(|vv| vv.as_object().is_some()) {
                out.push((hint_source.to_string(), obj.clone()));
            }
        }
        _ => {}
    }
}

/// 将已解析的 MCP 服务器表写入 `out`（展开 `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`）。
fn append_mcp_declaration_maps(
    plugin_ref: &str,
    plugin_root: &Path,
    maps: Vec<(String, serde_json::Map<String, serde_json::Value>)>,
    out: &mut Vec<ClaudeMcpItem>,
) {
    let data_dir = claude_plugin_data_dir_from_ref(plugin_ref);
    let data_dir_str = data_dir.to_string_lossy().to_string();
    for (src_path, map) in maps {
        for (name, cfg_orig) in map.iter() {
            let mut cfg = cfg_orig.clone();
            expand_plugin_vars_in_json_value(&mut cfg, plugin_root, &data_dir_str);
            let enabled = cfg.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true)
                && !cfg
                    .get("disabled")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(false);
            let status = if enabled {
                "connected".to_string()
            } else {
                "disconnected".to_string()
            };
            let command = parse_mcp_command(&cfg);
            let tools = parse_mcp_tools(&cfg);
            out.push(ClaudeMcpItem {
                id: format!("plugin::{}::{}", plugin_ref, name),
                name: name.to_string(),
                command,
                status,
                enabled,
                tools,
                scope: "plugin".to_string(),
                source_path: src_path.clone(),
                claude_json_project_key: None,
                plugin_ref: Some(plugin_ref.to_string()),
                runtime_status: None,
            });
        }
    }
}

/// 从单个插件根目录（cache 安装副本等）解析 MCP 条目并追加到 `out`。
fn push_mcp_declarations_from_plugin_dir(
    plugin_ref: &str,
    plugin_root: &Path,
    out: &mut Vec<ClaudeMcpItem>,
) {
    let manifest_path = plugin_root.join(".claude-plugin").join("plugin.json");

    let mut maps: Vec<(String, serde_json::Map<String, serde_json::Value>)> = Vec::new();
    if let Some(manifest_v) = read_json_file(&manifest_path) {
        if let Some(spec) = manifest_v
            .get("mcpServers")
            .or_else(|| manifest_v.get("mcp_servers"))
            .filter(|s| !s.is_null())
        {
            let hint = manifest_path.to_string_lossy().to_string();
            collect_mcp_maps_from_plugin_mcp_spec(plugin_root, spec, &hint, &mut maps);
        }
    }
    if maps.is_empty() {
        let root_mcp = plugin_root.join(".mcp.json");
        if let Some(v) = read_json_file(&root_mcp) {
            if let Some(map) = v
                .get("mcpServers")
                .or_else(|| v.get("mcp_servers"))
                .and_then(|x| x.as_object())
            {
                maps.push((root_mcp.to_string_lossy().to_string(), map.clone()));
            }
        }
    }

    append_mcp_declaration_maps(plugin_ref, plugin_root, maps, out);
}

/// 解析 `installed_plugins.json` 中的 `installPath` / `install_path`（支持 `~`、相对路径、`$HOME/`、环境变量）。
fn resolve_claude_plugin_install_path(home: &Path, raw: &str) -> Option<PathBuf> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    let t = expand_env_vars_in_str(t);
    let t = t.as_str();
    let mut pb = if let Some(rest) = t.strip_prefix("~/") {
        home.join(rest)
    } else if t == "~" {
        home.to_path_buf()
    } else if let Some(rest) = t.strip_prefix("$HOME/") {
        home.join(rest)
    } else {
        PathBuf::from(t)
    };
    if pb.as_path().is_relative() {
        pb = home.join(pb);
    }
    let pb = fs::canonicalize(&pb).unwrap_or(pb);
    if pb.is_dir() && !is_under_plugins_marketplaces(&pb) {
        Some(pb)
    } else {
        None
    }
}

fn dedupe_plugin_mcp_items(items: Vec<ClaudeMcpItem>) -> Vec<ClaudeMcpItem> {
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut out: Vec<ClaudeMcpItem> = Vec::new();
    for it in items {
        let key = (it.name.clone(), it.command.clone());
        if seen.insert(key) {
            out.push(it);
        }
    }
    out
}

fn claude_plugins_cache_dir() -> PathBuf {
    crate::claude_config_dir::user_claude_dir()
        .join("plugins")
        .join("cache")
}

fn claude_plugins_marketplaces_dir() -> PathBuf {
    crate::claude_config_dir::user_claude_dir()
        .join("plugins")
        .join("marketplaces")
}

/// Claude Code 市场清单目录（`plugins/marketplaces/**`）仅作市场浏览，不参与 MCP / 技能 / 子代理探测。
pub(crate) fn is_under_plugins_marketplaces(path: &Path) -> bool {
    let marketplaces = claude_plugins_marketplaces_dir();
    let Ok(mp) = fs::canonicalize(&marketplaces) else {
        return path.starts_with(&marketplaces);
    };
    let Ok(p) = fs::canonicalize(path) else {
        return path.starts_with(&marketplaces);
    };
    p.starts_with(&mp)
}

fn dir_has_skill_md_subdirs(skills_dir: &Path) -> bool {
    let Ok(rd) = fs::read_dir(skills_dir) else {
        return false;
    };
    rd.flatten()
        .any(|e| e.path().is_dir() && e.path().join("SKILL.md").is_file())
}

fn dir_has_agent_markdown(agents_dir: &Path) -> bool {
    let Ok(rd) = fs::read_dir(agents_dir) else {
        return false;
    };
    rd.flatten().any(|e| {
        e.path().is_file()
            && e.path()
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
    })
}

/// 判定目录是否为 Claude Code 插件包根（用于扫描 `plugins/cache/**`，与 installed_plugins 是否登记无关）。
fn is_claude_plugin_package_root(dir: &Path) -> bool {
    if dir.join(".claude-plugin").join("plugin.json").is_file() || dir.join(".mcp.json").is_file() {
        return true;
    }
    let agents = dir.join("agents");
    if agents.is_dir() && dir_has_agent_markdown(&agents) {
        return true;
    }
    let skills = dir.join("skills");
    skills.is_dir() && dir_has_skill_md_subdirs(&skills)
}

fn walkdir_skip_plugin_noise(e: &walkdir::DirEntry) -> bool {
    let name = e.file_name().to_string_lossy();
    if e.depth() > 0
        && (name == "node_modules"
            || name == ".git"
            || name == "target"
            || name == ".venv"
            || name == "dist")
    {
        return false;
    }
    true
}

/// 在 `root_canon` 目录树内枚举所有「插件包根」（含 `.claude-plugin/plugin.json`、根 `.mcp.json`、skills/agents 等）。
fn discover_plugin_package_roots_in_tree(root_canon: &Path) -> Vec<PathBuf> {
    if !root_canon.is_dir() {
        return Vec::new();
    }
    let mut out: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let walker = WalkDir::new(root_canon)
        .follow_links(false)
        .into_iter()
        .filter_entry(walkdir_skip_plugin_noise);
    for ent in walker.filter_map(|e| e.ok()) {
        if !ent.file_type().is_dir() {
            continue;
        }
        let path = ent.path();
        if !is_claude_plugin_package_root(path) {
            continue;
        }
        let canon = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let key = canon.to_string_lossy().to_string();
        if !seen.insert(key) {
            continue;
        }
        out.push(canon);
    }
    out.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
    out
}

/// 插件目录是否在 manifest 或根 `.mcp.json` 中声明了 MCP（用于跳过无 MCP 的纯技能包，减少无效解析）。
fn plugin_package_root_declares_mcp(plugin_root: &Path) -> bool {
    let manifest = plugin_root.join(".claude-plugin").join("plugin.json");
    if let Some(v) = read_json_file(&manifest) {
        let spec = v.get("mcpServers").or_else(|| v.get("mcp_servers"));
        if spec.is_some_and(|s| !s.is_null()) {
            return true;
        }
    }
    plugin_root.join(".mcp.json").is_file()
}

fn discover_plugin_roots_under_claude_cache_inner(require_mcp_declaration: bool) -> Vec<(String, PathBuf)> {
    let cache = claude_plugins_cache_dir();
    if !cache.is_dir() {
        return Vec::new();
    }
    let cache_canon = match fs::canonicalize(&cache) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<(String, PathBuf)> = Vec::new();
    for canon in discover_plugin_package_roots_in_tree(&cache_canon) {
        if is_under_plugins_marketplaces(&canon) {
            continue;
        }
        if require_mcp_declaration && !plugin_package_root_declares_mcp(&canon) {
            continue;
        }
        let rel = match canon.strip_prefix(&cache_canon) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => canon.to_string_lossy().replace('\\', "/"),
        };
        let rel = rel.trim_matches('/').to_string();
        out.push((rel, canon));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// 枚举 `plugins/cache/**` 下声明了 MCP 的插件包根（不扫描 `plugins/marketplaces/**`）。
pub(crate) fn discover_plugin_roots_under_claude_cache() -> Vec<(String, PathBuf)> {
    discover_plugin_roots_under_claude_cache_inner(true)
}

/// 枚举 `plugins/cache/**` 下全部插件包根，供技能 / 子代理列表使用（不扫描 `plugins/marketplaces/**`）。
pub(crate) fn discover_plugin_roots_under_claude_cache_for_skills_and_agents() -> Vec<(String, PathBuf)> {
    discover_plugin_roots_under_claude_cache_inner(false)
}

/// `~/.claude/settings.json` 顶层 `"<plugin-slug>@<marketplace-id>": true`：解析市场真实根目录后读取 `plugins/<slug>/.claude-plugin/plugin.json` 等的 `mcpServers`。
/// 市场根目录优先来自同文件 `extraKnownMarketplaces.<id>`：`source` 为 `directory` 时的嵌套 `path`，或仅顶层 `path`（如 digital-engine-plugin-marketplace）；否则回退到 `plugins/<id>` 或 `plugins/cache/**`（见 `resolve_plugin_marketplace_root_dir`，不读 `plugins/marketplaces`）。
fn marketplace_plugin_toggle_value_enabled(val: &serde_json::Value) -> bool {
    match val {
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::String(s) => {
            let t = s.trim();
            t.eq_ignore_ascii_case("true")
                || t == "1"
                || t.eq_ignore_ascii_case("yes")
                || t.eq_ignore_ascii_case("on")
        }
        serde_json::Value::Number(n) => n.as_i64() == Some(1) || n.as_f64() == Some(1.0),
        serde_json::Value::Object(o) => {
            let disabled = o.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
            // 与 Claude / 插件市场常见写法对齐：仅有 `{}` 或版本字段时也视为已启用
            let enabled = o.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            enabled && !disabled
        }
        _ => false,
    }
}

/// 解析 `plugin@marketplace` 键（折叠 `@` 右侧空白），返回 (plugin_slug, marketplace_id)。
fn parse_settings_plugin_marketplace_toggle_key(key: &str) -> Option<(String, String)> {
    let key = key.trim();
    if !key.contains('@') {
        return None;
    }
    let (a, b) = key.split_once('@')?;
    let slug = a.trim().to_string();
    let mkt = b.split_whitespace().collect::<String>();
    let mkt = mkt.trim().to_string();
    if slug.is_empty() || mkt.is_empty() {
        return None;
    }
    Some((slug, mkt))
}

fn source_kind_is_directory(kind: &str) -> bool {
    let k = kind.trim();
    k.eq_ignore_ascii_case("directory")
        || k.eq_ignore_ascii_case("dir")
        || k.eq_ignore_ascii_case("local")
}

/// 从 `extraKnownMarketplaces` 单条 entry 提取「directory 类」本地根路径（兼容多种字段布局）。
fn extract_extra_marketplace_directory_raw_path(
    entry: &serde_json::Map<String, serde_json::Value>,
) -> Option<String> {
    // 形态 A：`{ "source": { "source": "directory", "path": "..." }, "autoUpdate": true }`
    if let Some(src_v) = entry.get("source") {
        match src_v {
            serde_json::Value::Object(src) => {
                let ty = src
                    .get("source")
                    .or_else(|| src.get("type"))
                    .or_else(|| src.get("kind"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .trim();
                if source_kind_is_directory(ty) {
                    let raw = [
                        "path",
                        "directory",
                        "root",
                        "localPath",
                        "installPath",
                        "install_path",
                    ]
                    .iter()
                    .find_map(|k| {
                        src.get(*k)
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                    });
                    if let Some(s) = raw {
                        return Some(s.to_string());
                    }
                }
            }
            serde_json::Value::String(s_src) => {
                if source_kind_is_directory(s_src.as_str()) {
                    let raw = [
                        "path",
                        "directory",
                        "root",
                        "localPath",
                        "installPath",
                        "install_path",
                    ]
                    .iter()
                    .find_map(|k| {
                        entry
                            .get(*k)
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                    });
                    if let Some(s) = raw {
                        return Some(s.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    // 形态 B：顶层 `type` / `kind` + `path`
    let top_ty = entry
        .get("type")
        .or_else(|| entry.get("kind"))
        .or_else(|| entry.get("source"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if source_kind_is_directory(top_ty) {
        let raw = [
            "path",
            "directory",
            "root",
            "localPath",
            "installPath",
            "install_path",
        ]
        .iter()
        .find_map(|k| {
            entry
                .get(*k)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
        });
        if let Some(s) = raw {
            return Some(s.to_string());
        }
    }
    // 形态 C：`extraKnownMarketplaces.<id>` 仅顶层 `path` / `root` 等（无 `source` / `type` 包裹），
    // 与 digital-engine-plugin-marketplace 等本地市场一致；排除 http(s) 以免把远程 URL 当目录。
    if let Some(s) = [
        "path",
        "directory",
        "root",
        "localPath",
        "installPath",
        "install_path",
    ]
    .iter()
    .find_map(|k| {
        entry
            .get(*k)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|t| !t.is_empty())
    }) {
        let lower = s.to_lowercase();
        if !lower.starts_with("http://") && !lower.starts_with("https://") {
            return Some(s.to_string());
        }
    }
    None
}

/// 展开配置中的路径字符串（不要求目录已存在）；存在且为目录时再 canonicalize。
/// 支持 `~`、`$HOME/` 前缀，以及任意位置的 `$VAR` / `${VAR}` / `%VAR%`（当前进程环境）。
fn expand_claude_config_path_string(home: &Path, raw: &str) -> PathBuf {
    let t = raw.trim();
    let t = t.strip_prefix("file://").unwrap_or(t);
    if t.is_empty() {
        return PathBuf::new();
    }
    let t = expand_env_vars_in_str(t);
    let t = t.as_str();
    let mut pb = if let Some(rest) = t.strip_prefix("~/") {
        home.join(rest)
    } else if t == "~" {
        home.to_path_buf()
    } else if let Some(rest) = t.strip_prefix("$HOME/") {
        home.join(rest)
    } else {
        PathBuf::from(t)
    };
    if pb.as_path().is_relative() {
        pb = home.join(pb);
    }
    pb
}

/// 从已解析的 `settings.json` 根对象读取 `extraKnownMarketplaces`：收集 directory 类本地根（键为 marketplace id）。
fn extra_known_marketplace_directory_roots_from_settings_value(
    home: &Path,
    settings_root: &serde_json::Value,
) -> HashMap<String, PathBuf> {
    let Some(root) = settings_root.as_object() else {
        return HashMap::new();
    };
    let Some(ekm) = root
        .get("extraKnownMarketplaces")
        .and_then(|x| x.as_object())
    else {
        return HashMap::new();
    };
    let mut out: HashMap<String, PathBuf> = HashMap::new();
    for (marketplace_key, entry_v) in ekm {
        let raw_path = if let Some(entry) = entry_v.as_object() {
            extract_extra_marketplace_directory_raw_path(entry)
        } else if let Some(s) = entry_v.as_str() {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                let lower = t.to_lowercase();
                if lower.starts_with("http://") || lower.starts_with("https://") {
                    None
                } else {
                    Some(t.to_string())
                }
            }
        } else {
            None
        };
        let Some(raw_path) = raw_path else {
            continue;
        };
        let expanded = expand_claude_config_path_string(home, &raw_path);
        if expanded.as_os_str().is_empty() {
            continue;
        }
        // 与 installPath 一致：存在且为目录才采纳（避免误配空路径）
        if expanded.is_dir() {
            let pb = fs::canonicalize(&expanded).unwrap_or(expanded);
            if !is_under_plugins_marketplaces(&pb) {
                out.insert(marketplace_key.clone(), pb);
            }
        }
    }
    out
}

/// 定位「插件市场」根目录：`plugins/<id>`，再在 `plugins/cache/**` 内按目录名匹配（不扫描 `plugins/marketplaces/**`）。
fn resolve_plugin_marketplace_root_dir(marketplace_id: &str) -> Option<PathBuf> {
    let id_lower = marketplace_id.to_lowercase();
    let user_claude = crate::claude_config_dir::user_claude_dir();
    let flat = user_claude.join("plugins").join(marketplace_id);
    if flat.is_dir() {
        return fs::canonicalize(&flat).ok().or(Some(flat));
    }
    let cache = claude_plugins_cache_dir();
    if let Ok(cache_canon) = fs::canonicalize(&cache) {
        if cache_canon.is_dir() {
            let walker = WalkDir::new(&cache_canon)
                .follow_links(false)
                .max_depth(16)
                .into_iter()
                .filter_entry(walkdir_skip_plugin_noise);
            for ent in walker.filter_map(|e| e.ok()) {
                if !ent.file_type().is_dir() || ent.depth() == 0 {
                    continue;
                }
                if ent.file_name().to_string_lossy().to_lowercase() == id_lower {
                    let p = ent.path().to_path_buf();
                    return fs::canonicalize(&p).ok().or(Some(p));
                }
            }
        }
    }
    None
}

/// 在 `parent` 的一级子目录中按不区分大小写匹配目录名（用于 `plugins/dima-plugin` 与磁盘实际大小写不一致）。
fn find_immediate_child_dir_case_insensitive(parent: &Path, name_wanted: &str) -> Option<PathBuf> {
    let w = name_wanted.trim().to_lowercase();
    if w.is_empty() {
        return None;
    }
    let rd = fs::read_dir(parent).ok()?;
    for ent in rd.flatten() {
        if !ent.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        if ent.file_name().to_string_lossy().to_lowercase() == w {
            return Some(ent.path());
        }
    }
    None
}

fn plugin_dir_root_if_valid(candidate: &Path) -> Option<PathBuf> {
    if !candidate.is_dir() {
        return None;
    }
    if candidate
        .join(".claude-plugin")
        .join("plugin.json")
        .is_file()
        || candidate.join(".mcp.json").is_file()
        || is_claude_plugin_package_root(candidate)
    {
        return fs::canonicalize(candidate)
            .ok()
            .or_else(|| Some(candidate.to_path_buf()));
    }
    None
}

fn resolve_marketplace_plugin_root_from_slugs(
    marketplace_id: &str,
    plugin_slug: &str,
    extra_marketplace_roots: &HashMap<String, PathBuf>,
) -> Option<PathBuf> {
    let mdir = extra_marketplace_roots
        .get(marketplace_id)
        .cloned()
        .or_else(|| {
            let id_lower = marketplace_id.to_lowercase();
            extra_marketplace_roots
                .iter()
                .find(|(k, _)| k.to_lowercase() == id_lower)
                .map(|(_, v)| v.clone())
        })
        .filter(|p| p.is_dir())
        .map(|p| fs::canonicalize(&p).unwrap_or(p))
        .or_else(|| resolve_plugin_marketplace_root_dir(marketplace_id))?;
    if is_under_plugins_marketplaces(&mdir) {
        return None;
    }
    let direct = [
        mdir.join("plugins").join(plugin_slug),
        mdir.join(plugin_slug),
    ];
    for c in &direct {
        if let Some(p) = plugin_dir_root_if_valid(c) {
            return Some(p);
        }
    }
    let plugins_dir = mdir.join("plugins");
    if plugins_dir.is_dir() {
        if let Some(p) = find_immediate_child_dir_case_insensitive(&plugins_dir, plugin_slug) {
            if let Some(ok) = plugin_dir_root_if_valid(&p) {
                return Some(ok);
            }
        }
    }
    if let Some(p) = find_immediate_child_dir_case_insensitive(&mdir, plugin_slug) {
        if let Some(ok) = plugin_dir_root_if_valid(&p) {
            return Some(ok);
        }
    }
    for root in discover_plugin_package_roots_in_tree(&mdir) {
        if root
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.eq_ignore_ascii_case(plugin_slug))
        {
            return Some(root);
        }
    }
    None
}

/// 单条 `plugin-slug@marketplace-id` 开关：解析磁盘上的插件根并写入 `out`（与根级、`enabledPlugins` 内写法共用）。
fn push_mcp_from_settings_plugin_marketplace_toggle_if_enabled(
    _home: &Path,
    toggle_key: &str,
    val: &serde_json::Value,
    extra_marketplace_roots: &HashMap<String, PathBuf>,
    seen_roots: &mut HashSet<String>,
    out: &mut Vec<ClaudeMcpItem>,
) {
    let Some((ref plugin_slug, ref marketplace_id)) =
        parse_settings_plugin_marketplace_toggle_key(toggle_key)
    else {
        return;
    };
    if !marketplace_plugin_toggle_value_enabled(val) {
        return;
    }
    let Some(plugin_root) = resolve_marketplace_plugin_root_from_slugs(
        marketplace_id.as_str(),
        plugin_slug.as_str(),
        extra_marketplace_roots,
    ) else {
        return;
    };
    let canon_key = plugin_root.to_string_lossy().to_string();
    if !seen_roots.insert(canon_key) {
        return;
    }
    let plugin_ref = format!("settingsToggle:{toggle_key}");
    push_mcp_declarations_from_plugin_dir(&plugin_ref, &plugin_root, out);
}

/// 从用户级 settings.json（默认 `~/.claude/settings.json`，自定义目录时同步切换）读取 `plugin@marketplace` 启用项并解析对应插件包内的 MCP（与 `installed_plugins.json` / 目录扫描互补）。
/// Claude Code 常把开关写在根级，或写在 `enabledPlugins` 对象内，两者都扫描。
fn collect_mcp_from_claude_settings_marketplace_plugin_toggles(
    home: &Path,
    seen_roots: &mut HashSet<String>,
    out: &mut Vec<ClaudeMcpItem>,
) {
    let path = crate::claude_config_dir::user_claude_dir().join("settings.json");
    let Some(file_v) = read_json_file(&path) else {
        return;
    };
    let extra_marketplace_roots =
        extra_known_marketplace_directory_roots_from_settings_value(home, &file_v);
    let Some(obj) = file_v.as_object() else {
        return;
    };
    for (key, val) in obj {
        let ks = key.as_str();
        if matches!(
            ks,
            "mcpServers"
                | "mcp_servers"
                | "env"
                | "permissions"
                | "hooks"
                | "attribution"
                | "model"
        ) {
            continue;
        }
        if ks == "enabledPlugins" {
            if let Some(ep) = val.as_object() {
                for (toggle_key, ev) in ep {
                    push_mcp_from_settings_plugin_marketplace_toggle_if_enabled(
                        home,
                        toggle_key.as_str(),
                        ev,
                        &extra_marketplace_roots,
                        seen_roots,
                        out,
                    );
                }
            }
            continue;
        }
        push_mcp_from_settings_plugin_marketplace_toggle_if_enabled(
            home,
            ks,
            val,
            &extra_marketplace_roots,
            seen_roots,
            out,
        );
    }
}

/// Wise 不从 `~/.claude/plugins/**`（含 cache、marketplaces、installed_plugins.json）读取插件 MCP。
fn collect_installed_plugin_mcp_items(_home: &Path) -> Vec<ClaudeMcpItem> {
    Vec::new()
}

/// Parses combined stdout/stderr of `claude mcp list` (e.g. `name: cmd - ✓ Connected`).
fn parse_claude_mcp_list_health_output(text: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.contains("Checking MCP") {
            continue;
        }
        let Some((left, right)) = line.rsplit_once(" - ") else {
            continue;
        };
        let right = right.trim();
        let rl = right.to_lowercase();
        let status = if right.contains('✓') || rl.contains("connected") {
            "connected".to_string()
        } else if right.contains('✗') || rl.contains("fail") {
            "failed".to_string()
        } else {
            continue;
        };
        let Some((name, _rest)) = left.split_once(':') else {
            continue;
        };
        let name = name.trim();
        if !name.is_empty() {
            map.insert(name.to_string(), status);
        }
    }
    map
}

/// Runs `claude mcp list` in project root (or home) to obtain per-server health from Claude CLI.
fn run_claude_mcp_list_health(project_path: Option<&str>) -> HashMap<String, String> {
    let Ok(bin) = find_claude_binary() else {
        return HashMap::new();
    };
    let Some(home) = dirs::home_dir() else {
        return HashMap::new();
    };
    let cwd = project_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|p| {
            let pb = PathBuf::from(p);
            if pb.is_dir() {
                fs::canonicalize(pb).ok()
            } else {
                None
            }
        })
        .unwrap_or_else(|| home.clone());

    let path_merged = merge_path_env(&claude_path_search_prefixes());
    let Ok(out) = Command::new(&bin)
        .args(["mcp", "list"])
        .current_dir(&cwd)
        .env("PATH", path_merged)
        .env("HOME", home.to_string_lossy().to_string())
        .output()
    else {
        return HashMap::new();
    };

    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    parse_claude_mcp_list_health_output(&text)
}

fn validate_mcp_server_name(name: &str) -> Result<(), String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if n.len() > 128 {
        return Err("名称过长（最多 128 字符）".to_string());
    }
    let ok = n
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.');
    if !ok {
        return Err("名称仅允许 ASCII 字母、数字、._-".to_string());
    }
    Ok(())
}

fn mcp_cli_cwd(scope: &str, project_path: Option<&str>, home: &Path) -> Result<PathBuf, String> {
    match scope {
        "user" => Ok(home.to_path_buf()),
        "local" | "project" => {
            let p = project_path
                .ok_or_else(|| "需要 projectPath".to_string())?
                .trim();
            if p.is_empty() {
                return Err("projectPath 为空".to_string());
            }
            let root = PathBuf::from(p);
            if !root.is_dir() {
                return Err("项目目录不存在".to_string());
            }
            fs::canonicalize(&root).map_err(|e| format!("无法解析项目路径: {}", e))
        }
        _ => Err(format!("无效的 MCP scope: {}", scope)),
    }
}

fn allowed_mcp_source_paths(
    _home: &Path,
    project_path: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let hj = crate::claude_config_dir::user_claude_root_json();
    if hj.exists() {
        paths.push(fs::canonicalize(&hj).map_err(|e| e.to_string())?);
    }
    let us = crate::claude_config_dir::user_claude_dir().join("settings.json");
    if us.exists() {
        paths.push(fs::canonicalize(&us).map_err(|e| e.to_string())?);
    }
    if let Some(pp) = project_path.map(str::trim).filter(|s| !s.is_empty()) {
        let root = PathBuf::from(pp);
        let canon = fs::canonicalize(&root).map_err(|e| format!("项目路径无效: {}", e))?;
        let mcpj = canon.join(".mcp.json");
        if mcpj.exists() {
            paths.push(fs::canonicalize(&mcpj).map_err(|e| e.to_string())?);
        }
        let ps = canon.join(".claude").join("settings.json");
        if ps.exists() {
            paths.push(fs::canonicalize(&ps).map_err(|e| e.to_string())?);
        }
    }
    Ok(paths)
}

fn assert_allowed_mcp_source(
    path: &Path,
    home: &Path,
    project_path: Option<&str>,
) -> Result<PathBuf, String> {
    let canon = fs::canonicalize(path).map_err(|e| format!("无法访问配置文件: {}", e))?;
    let allowed = allowed_mcp_source_paths(home, project_path)?;
    if allowed.iter().any(|p| p == &canon) {
        Ok(canon)
    } else {
        Err("不允许修改该配置文件路径".to_string())
    }
}

fn run_claude_mcp_cli(args: &[String], cwd: &Path) -> Result<(), String> {
    let bin = find_claude_binary()?;
    let path_merged = merge_path_env(&claude_path_search_prefixes());
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let out = Command::new(&bin)
        .args(args)
        .current_dir(cwd)
        .env("PATH", &path_merged)
        .env("HOME", home.to_string_lossy().to_string())
        .output()
        .map_err(|e| format!("无法启动 claude: {}", e))?;
    if out.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Err(format!(
            "claude mcp 失败（退出码 {:?}）\n{}\n{}",
            out.status.code(),
            stderr,
            stdout
        ))
    }
}

fn remove_mcp_server_key_from_file(path: &Path, server_name: &str) -> Result<(), String> {
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let removed = if let Some(obj) = v.get_mut("mcpServers").and_then(|x| x.as_object_mut()) {
        obj.remove(server_name).is_some()
    } else if let Some(obj) = v.get_mut("mcp_servers").and_then(|x| x.as_object_mut()) {
        obj.remove(server_name).is_some()
    } else {
        false
    };
    if !removed {
        return Err(format!("未在文件中找到 MCP: {}", server_name));
    }
    let out = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    fs::write(path, out).map_err(|e| e.to_string())?;
    Ok(())
}

fn patch_mcp_entry_disabled_in_file(
    path: &Path,
    scope: &str,
    server_name: &str,
    enabled: bool,
    claude_json_project_key: Option<&str>,
) -> Result<(), String> {
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let entry = match scope {
        "user" => v
            .get_mut("mcpServers")
            .and_then(|x| x.as_object_mut())
            .and_then(|m| m.get_mut(server_name)),
        "local" => {
            let key =
                claude_json_project_key.ok_or_else(|| "缺少 claudeJsonProjectKey".to_string())?;
            v.get_mut("projects")
                .and_then(|x| x.as_object_mut())
                .and_then(|m| m.get_mut(key))
                .and_then(|proj| proj.get_mut("mcpServers"))
                .and_then(|x| x.as_object_mut())
                .and_then(|m| m.get_mut(server_name))
        }
        "project" | "legacy_user_settings" | "legacy_project_settings" => {
            if let Some(m) = v.get_mut("mcpServers").and_then(|x| x.as_object_mut()) {
                m.get_mut(server_name)
            } else {
                v.get_mut("mcp_servers")
                    .and_then(|x| x.as_object_mut())
                    .and_then(|m| m.get_mut(server_name))
            }
        }
        "plugin" => {
            return Err("插件内置 MCP 由 Claude Code 插件管理，不能在此开关".to_string());
        }
        _ => return Err(format!("无法写入该 scope: {}", scope)),
    };
    let Some(entry) = entry else {
        return Err(format!("未找到 MCP: {}", server_name));
    };
    let obj = entry
        .as_object_mut()
        .ok_or_else(|| "MCP 条目不是 JSON 对象".to_string())?;
    if enabled {
        obj.remove("disabled");
        obj.insert("enabled".to_string(), serde_json::Value::Bool(true));
    } else {
        obj.insert("disabled".to_string(), serde_json::Value::Bool(true));
    }
    let out = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    fs::write(path, out).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_claude_mcp_status_collect(
    project_path: Option<String>,
) -> Result<ClaudeMcpStatusResponse, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let claude_json_path = crate::claude_config_dir::user_claude_root_json();
    let claude_json_str = claude_json_path.to_string_lossy().to_string();

    let mut user = Vec::new();
    let mut local = Vec::new();

    if let Some(v) = read_json_file(&claude_json_path) {
        if let Some(map) = v.get("mcpServers").and_then(|x| x.as_object()) {
            user = build_mcp_items_from_map(map, "user", &claude_json_str, None);
        }

        if let (Some(pp), Some(projects)) = (
            project_path
                .as_ref()
                .map(|s| s.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty()),
            v.get("projects").and_then(|x| x.as_object()),
        ) {
            for (key, proj_val) in projects {
                if paths_match_claude_project(pp, key) {
                    if let Some(map) = proj_val.get("mcpServers").and_then(|x| x.as_object()) {
                        local = build_mcp_items_from_map(
                            map,
                            "local",
                            &claude_json_str,
                            Some(key.as_str()),
                        );
                    }
                    break;
                }
            }
        }
    }

    let mut project_shared = Vec::new();
    if let Some(pp) = project_path
        .as_ref()
        .map(|s| s.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let mcp_json = PathBuf::from(pp).join(".mcp.json");
        if let Some(v) = read_json_file(&mcp_json) {
            let sp = mcp_json.to_string_lossy().to_string();
            project_shared = build_mcp_items_from_settings_mcp_block(&v, "project", &sp, None);
        }
    }

    let user_settings_path = crate::claude_config_dir::user_claude_dir().join("settings.json");
    let legacy_user_settings = read_json_file(&user_settings_path)
        .map(|v| {
            build_mcp_items_from_settings_mcp_block(
                &v,
                "legacy_user_settings",
                &user_settings_path.to_string_lossy(),
                None,
            )
        })
        .unwrap_or_default();

    let mut legacy_project_settings = Vec::new();
    if let Some(pp) = project_path
        .as_ref()
        .map(|s| s.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let p = PathBuf::from(pp).join(".claude").join("settings.json");
        if let Some(v) = read_json_file(&p) {
            legacy_project_settings = build_mcp_items_from_settings_mcp_block(
                &v,
                "legacy_project_settings",
                &p.to_string_lossy(),
                None,
            );
        }
    }

    let plugin_mcp = collect_installed_plugin_mcp_items(&home);

    Ok(ClaudeMcpStatusResponse {
        user,
        local,
        project_shared,
        legacy_user_settings,
        legacy_project_settings,
        plugin_mcp,
    })
}

/// Reads MCP JSON configs on a blocking thread (does not run `claude mcp list`).
#[tauri::command]
pub(crate) async fn get_claude_mcp_status(
    project_path: Option<String>,
) -> Result<ClaudeMcpStatusResponse, String> {
    tokio::task::spawn_blocking(move || get_claude_mcp_status_collect(project_path))
        .await
        .map_err(|e| format!("get_claude_mcp_status: {}", e))?
}

/// Runs `claude mcp list` on a blocking thread; frontend merges by server name.
#[tauri::command]
pub(crate) async fn get_claude_mcp_runtime_health(
    project_path: Option<String>,
) -> Result<Vec<ClaudeMcpRuntimeHealthEntry>, String> {
    tokio::task::spawn_blocking(move || {
        let map = run_claude_mcp_list_health(project_path.as_deref());
        let mut v: Vec<ClaudeMcpRuntimeHealthEntry> = map
            .into_iter()
            .map(|(name, status)| ClaudeMcpRuntimeHealthEntry { name, status })
            .collect();
        v.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        v
    })
    .await
    .map_err(|e| format!("get_claude_mcp_runtime_health: {}", e))
}

#[tauri::command]
pub(crate) fn remove_claude_mcp_server(
    project_path: Option<String>,
    name: String,
    scope: String,
    source_path: String,
    _claude_json_project_key: Option<String>,
) -> Result<(), String> {
    validate_mcp_server_name(&name)?;
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let scope = scope.trim().to_string();
    match scope.as_str() {
        "legacy_user_settings" | "legacy_project_settings" => {
            let path = PathBuf::from(source_path.trim());
            assert_allowed_mcp_source(&path, &home, project_path.as_deref())?;
            remove_mcp_server_key_from_file(&path, name.trim())?;
        }
        "user" | "local" | "project" => {
            let cwd = mcp_cli_cwd(&scope, project_path.as_deref(), &home)?;
            let args = vec![
                "mcp".into(),
                "remove".into(),
                name.trim().to_string(),
                "-s".into(),
                scope.clone(),
            ];
            run_claude_mcp_cli(&args, &cwd)?;
        }
        "plugin" => {
            return Err("插件内置 MCP 由 Claude Code 插件管理，不能在此删除".to_string());
        }
        _ => return Err(format!("未知的 MCP 范围: {}", scope)),
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn add_claude_mcp_server(
    scope: String,
    transport: String,
    name: String,
    url: Option<String>,
    command: Option<String>,
    command_args: Option<Vec<String>>,
    headers: Option<Vec<String>>,
    env_pairs: Option<Vec<String>>,
    project_path: Option<String>,
) -> Result<(), String> {
    validate_mcp_server_name(&name)?;
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let scope = scope.trim();
    if !matches!(scope, "user" | "local" | "project") {
        return Err("scope 必须是 user、local 或 project".to_string());
    }
    if matches!(scope, "local" | "project")
        && project_path
            .as_ref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(true)
    {
        return Err("local / project 范围需要有效的 projectPath".to_string());
    }
    let transport = transport.trim().to_lowercase();
    if !matches!(transport.as_str(), "http" | "sse" | "stdio") {
        return Err("transport 必须是 http、sse 或 stdio".to_string());
    }

    let cwd = mcp_cli_cwd(scope, project_path.as_deref(), &home)?;

    let mut args: Vec<String> = vec![
        "mcp".into(),
        "add".into(),
        "-t".into(),
        transport.clone(),
        "-s".into(),
        scope.to_string(),
    ];

    if let Some(envs) = &env_pairs {
        for e in envs {
            let e = e.trim();
            if !e.is_empty() {
                args.push("-e".into());
                args.push(e.to_string());
            }
        }
    }
    if let Some(hdrs) = &headers {
        for h in hdrs {
            let h = h.trim();
            if !h.is_empty() {
                args.push("-H".into());
                args.push(h.to_string());
            }
        }
    }

    args.push(name.trim().to_string());

    match transport.as_str() {
        "http" | "sse" => {
            let url = url
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "HTTP/SSE 需要填写 url".to_string())?;
            args.push(url);
        }
        "stdio" => {
            let cmd = command
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "stdio 需要填写 command（可执行文件）".to_string())?;
            args.push("--".into());
            args.push(cmd);
            if let Some(parts) = &command_args {
                for p in parts {
                    if !p.trim().is_empty() {
                        args.push(p.trim().to_string());
                    }
                }
            }
        }
        _ => {}
    }

    run_claude_mcp_cli(&args, &cwd)
}

fn set_claude_mcp_server_enabled_impl(
    project_path: Option<String>,
    server_name: String,
    scope: String,
    source_path: String,
    claude_json_project_key: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    validate_mcp_server_name(&server_name)?;
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let scope = scope.trim().to_string();
    if scope == "plugin" {
        return Err("插件内置 MCP 由 Claude Code 插件管理，不能在此开关".to_string());
    }
    let path = PathBuf::from(source_path.trim());
    assert_allowed_mcp_source(&path, &home, project_path.as_deref())?;
    patch_mcp_entry_disabled_in_file(
        &path,
        &scope,
        server_name.trim(),
        enabled,
        claude_json_project_key.as_deref(),
    )
}

/// Patches MCP enabled flag on a blocking thread so file I/O does not block the async runtime.
#[tauri::command]
pub(crate) async fn set_claude_mcp_server_enabled(
    project_path: Option<String>,
    server_name: String,
    scope: String,
    source_path: String,
    claude_json_project_key: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        set_claude_mcp_server_enabled_impl(
            project_path,
            server_name,
            scope,
            source_path,
            claude_json_project_key,
            enabled,
        )
    })
    .await
    .map_err(|e| format!("set_claude_mcp_server_enabled: {}", e))?
}

fn server_key_matches_mcp_item(key: &str, item: &ClaudeMcpItem) -> bool {
    let key = key.trim();
    if key.is_empty() {
        return false;
    }
    if key == item.id || key == item.name {
        return true;
    }
    key.ends_with(&format!("::{}", item.name))
}

fn merge_mcp_servers_from_json_value(
    out: &mut serde_json::Map<String, serde_json::Value>,
    v: &serde_json::Value,
) {
    let Some(map) = v
        .get("mcpServers")
        .and_then(|x| x.as_object())
        .or_else(|| v.get("mcp_servers").and_then(|x| x.as_object()))
    else {
        if let Some(map) = v.as_object() {
            if !map.is_empty() && map.values().all(|vv| vv.as_object().is_some()) {
                for (name, cfg) in map {
                    out.insert(name.clone(), cfg.clone());
                }
            }
        }
        return;
    };
    for (name, cfg) in map {
        out.insert(name.clone(), cfg.clone());
    }
}

fn plugin_root_from_mcp_source_path(source_path: &str) -> Option<PathBuf> {
    let mut cur = PathBuf::from(source_path.trim());
    if cur.is_file() {
        cur = cur.parent()?.to_path_buf();
    }
    loop {
        if cur.join(".claude-plugin").join("plugin.json").is_file() {
            return Some(cur);
        }
        if !cur.pop() {
            break;
        }
    }
    None
}

fn resolve_mcp_server_config_from_item(item: &ClaudeMcpItem) -> Option<serde_json::Value> {
    let source = Path::new(item.source_path.trim());
    let v = read_json_file(source)?;
    let mut cfg = if item.scope == "local" {
        let key = item.claude_json_project_key.as_deref()?;
        v.get("projects")?
            .get(key)?
            .get("mcpServers")
            .or_else(|| v.get("projects")?.get(key)?.get("mcp_servers"))?
            .as_object()?
            .get(&item.name)
            .cloned()?
    } else {
        let map = v
            .get("mcpServers")
            .and_then(|x| x.as_object())
            .or_else(|| v.get("mcp_servers").and_then(|x| x.as_object()))
            .or_else(|| v.as_object().filter(|map| {
                !map.is_empty() && map.values().all(|vv| vv.as_object().is_some())
            }))?;
        map.get(&item.name).cloned()?
    };
    if item.scope == "plugin" {
        if let (Some(plugin_ref), Some(plugin_root)) = (
            item.plugin_ref.as_deref(),
            plugin_root_from_mcp_source_path(&item.source_path),
        ) {
            let data_dir = claude_plugin_data_dir_from_ref(plugin_ref);
            let data_dir_str = data_dir.to_string_lossy().to_string();
            expand_plugin_vars_in_json_value(&mut cfg, &plugin_root, &data_dir_str);
        }
    }
    Some(cfg)
}

fn materialize_claude_spawn_mcp_config_impl(
    project_path: Option<String>,
    server_keys: Vec<String>,
    extra_config_paths: Vec<String>,
) -> Result<Option<String>, String> {
    let keys: HashSet<String> = server_keys
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if keys.is_empty() && extra_config_paths.is_empty() {
        return Ok(None);
    }

    let status = get_claude_mcp_status_collect(project_path)?;
    let mut servers = serde_json::Map::<String, serde_json::Value>::new();

    let all_items: Vec<&ClaudeMcpItem> = [
        &status.user,
        &status.local,
        &status.project_shared,
        &status.legacy_user_settings,
        &status.legacy_project_settings,
        &status.plugin_mcp,
    ]
    .into_iter()
    .flat_map(|v| v.iter())
    .collect();

    if !keys.is_empty() {
        for item in all_items {
            if !keys.iter().any(|k| server_key_matches_mcp_item(k, item)) {
                continue;
            }
            if let Some(cfg) = resolve_mcp_server_config_from_item(item) {
                servers.insert(item.name.clone(), cfg);
            }
        }
    }

    for raw_path in extra_config_paths {
        let path = raw_path.trim();
        if path.is_empty() {
            continue;
        }
        if let Some(v) = read_json_file(Path::new(path)) {
            merge_mcp_servers_from_json_value(&mut servers, &v);
        }
    }

    if servers.is_empty() {
        return Ok(None);
    }

    let wise_dir = crate::wise_paths::wise_dir()?;
    let out_dir = wise_dir.join("spawn-mcp");
    let file_name = format!("{}.json", uuid::Uuid::new_v4());
    let out_path = out_dir.join(file_name);
    let payload = serde_json::json!({ "mcpServers": servers });
    let serialized = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    crate::wise_paths::write_file_atomic(&out_path, &serialized)?;
    Ok(Some(out_path.to_string_lossy().to_string()))
}

/// 按助手 MCP bundle 的 id / sourcePath 合并真实 server 配置，写入 `~/.wise/spawn-mcp/*.json` 供 `--mcp-config` 使用。
#[tauri::command]
pub(crate) async fn materialize_claude_spawn_mcp_config(
    project_path: Option<String>,
    server_keys: Vec<String>,
    extra_config_paths: Vec<String>,
) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        materialize_claude_spawn_mcp_config_impl(project_path, server_keys, extra_config_paths)
    })
    .await
    .map_err(|e| format!("materialize_claude_spawn_mcp_config: {}", e))?
}
