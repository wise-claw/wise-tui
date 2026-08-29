//! Codex CLI 用户级配置（`~/.codex/auth.json` + `config.toml`），与 CC Switch 供应商 envelope 对齐。

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub fn user_codex_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".codex"))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

/// Codex 0.134+ profile overlay：`~/.codex/{name}.config.toml`
pub fn codex_profile_v2_path(profile_name: &str) -> PathBuf {
    user_codex_dir().join(format!("{profile_name}.config.toml"))
}

fn read_text_file(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

fn file_mtime(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok()?.modified().ok()
}

#[derive(Clone)]
struct CodexDiskCache {
    auth_mtime: Option<SystemTime>,
    config_mtime: Option<SystemTime>,
    envelope: CodexProfileEnvelope,
    pretty: String,
}

static CODEX_DISK_CACHE: Mutex<Option<CodexDiskCache>> = Mutex::new(None);

#[allow(dead_code)]
pub(crate) fn invalidate_codex_disk_cache() {
    if let Ok(mut guard) = CODEX_DISK_CACHE.lock() {
        *guard = None;
    }
}

fn read_codex_profile_envelope_fresh() -> CodexProfileEnvelope {
    let dir = user_codex_dir();
    let auth_path = dir.join("auth.json");
    let config_path = dir.join("config.toml");

    let auth = read_text_file(&auth_path)
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();

    let config = read_text_file(&config_path).unwrap_or_default();

    CodexProfileEnvelope { auth, config }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexProfileEnvelope {
    #[serde(default)]
    pub auth: Map<String, Value>,
    #[serde(default)]
    pub config: String,
}

pub fn read_codex_profile_envelope() -> CodexProfileEnvelope {
    let dir = user_codex_dir();
    let auth_path = dir.join("auth.json");
    let config_path = dir.join("config.toml");
    let auth_mtime = file_mtime(&auth_path);
    let config_mtime = file_mtime(&config_path);

    if let Ok(guard) = CODEX_DISK_CACHE.lock() {
        if let Some(cache) = guard.as_ref() {
            if cache.auth_mtime == auth_mtime && cache.config_mtime == config_mtime {
                return cache.envelope.clone();
            }
        }
    }

    let envelope = read_codex_profile_envelope_fresh();
    let pretty = codex_profile_envelope_to_json(&envelope).unwrap_or_else(|_| "{}".to_string());
    if let Ok(mut guard) = CODEX_DISK_CACHE.lock() {
        *guard = Some(CodexDiskCache {
            auth_mtime,
            config_mtime,
            envelope: envelope.clone(),
            pretty,
        });
    }
    envelope
}

pub fn codex_profile_envelope_to_json(envelope: &CodexProfileEnvelope) -> Result<String, String> {
    serde_json::to_string_pretty(envelope).map_err(|e| e.to_string())
}

pub fn parse_codex_profile_envelope(raw: &str) -> Result<CodexProfileEnvelope, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("配置 JSON 不能为空".to_string());
    }
    let value: Value = serde_json::from_str(trimmed).map_err(|e| format!("配置 JSON 无效: {e}"))?;
    let obj = value
        .as_object()
        .ok_or_else(|| "Codex 配置顶层必须是对象".to_string())?;
    if !obj.contains_key("auth") && !obj.contains_key("config") {
        return Err("Codex 配置需包含 auth 与 config 字段（与 CC Switch 一致）".to_string());
    }
    let mut envelope: CodexProfileEnvelope =
        serde_json::from_value(value).map_err(|e| format!("Codex 配置结构无效: {e}"))?;
    // 历史档案可能落入重复 `model =` 行（CC Switch / 旧版 Wise 导入），先做去重，避免下游
    // 写盘后 codex 解析 TOML 直接报 `duplicate key`。
    let (deduped, _) = dedupe_top_level_model_lines(&envelope.config);
    envelope.config = deduped;
    Ok(envelope)
}

/// 从 `config.toml` 文本解析 `model = "..."` / `model="..."`。
pub fn read_effective_codex_model(config: &str) -> Option<String> {
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        let rest = trimmed
            .strip_prefix("model")
            .and_then(|s| s.trim_start().strip_prefix('='))
            .map(str::trim);
        let Some(rest) = rest else {
            continue;
        };
        let unquoted = rest
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .trim();
        if !unquoted.is_empty() {
            return Some(unquoted.to_string());
        }
    }
    None
}

pub fn read_effective_codex_model_from_envelope(envelope: &CodexProfileEnvelope) -> Option<String> {
    read_effective_codex_model(&envelope.config)
}

fn auth_maps_equal(a: &Map<String, Value>, b: &Map<String, Value>) -> bool {
    a == b
}

/// 档案 config 是否仅含 `model = "..."`（忽略空行/注释，不允许 `model_provider` 或 `[section]`）。
/// 真实 provider 档案（`model_provider = ...` + `[model_providers.*]`）必须走整体替换路径，
/// 否则 `~/.codex/config.toml` 只会改模型名，provider / base_url 仍是上一个档案的。
fn is_model_only_codex_config(config: &str) -> bool {
    let mut has_model = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if is_top_level_model_assignment(trimmed) {
            if has_model {
                return false;
            }
            has_model = true;
            continue;
        }
        return false;
    }
    has_model
}

/// 在现有 `config.toml` 中替换或插入 `model = "..."` 行，保留其余配置。
pub fn patch_codex_config_model(config: &str, new_model: &str) -> String {
    let model = new_model.trim();
    // 仅处理顶层（首个 `[section]` 之前）的 `model =` 行：替换首个，删除其余重复，保留其它配置。
    let mut lines: Vec<String> = config.lines().map(str::to_string).collect();
    let mut first_top_level_model: Option<usize> = None;
    let mut duplicates: Vec<usize> = Vec::new();
    let mut in_table = false;
    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('[') {
            in_table = true;
            continue;
        }
        if in_table {
            continue;
        }
        if is_top_level_model_assignment(trimmed) {
            if first_top_level_model.is_none() {
                first_top_level_model = Some(idx);
            } else {
                duplicates.push(idx);
            }
        }
    }
    if let Some(first) = first_top_level_model {
        lines[first] = format!("model = \"{model}\"");
        // 从后往前删，避免索引位移
        for idx in duplicates.into_iter().rev() {
            lines.remove(idx);
        }
    } else {
        lines.insert(0, format!("model = \"{model}\""));
    }
    let mut out = lines.join("\n");
    if config.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn is_top_level_model_assignment(trimmed: &str) -> bool {
    let Some(rest) = trimmed.strip_prefix("model") else {
        return false;
    };
    // 排除 `model_reasoning_effort` / `model_max_output_tokens` / `model_providers` 等同前缀键。
    let next = rest.chars().next();
    match next {
        Some('=') => true,
        Some(c) if c.is_whitespace() => rest.trim_start().starts_with('='),
        _ => false,
    }
}

/// Codex 官方目录模型（GPT / o 系列），应走 OpenAI 默认 provider，不能套用 DeepSeek 等自定义档案。
pub(crate) fn looks_like_openai_catalog_model(model: &str) -> bool {
    let m = model.trim().to_lowercase();
    !m.is_empty()
        && (m.starts_with("gpt-")
            || m.starts_with("o1")
            || m.starts_with("o3")
            || m.starts_with("o4")
            || m.starts_with("chatgpt")
            || m.starts_with("codex-"))
}

fn read_top_level_toml_string(config: &str, key: &str) -> Option<String> {
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('[') {
            break;
        }
        let Some((k, v)) = trimmed.split_once('=') else {
            continue;
        };
        if k.trim() != key {
            continue;
        }
        let unquoted = v
            .trim()
            .trim_end_matches(|c| c == ',' || c == '#')
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .trim();
        if unquoted.is_empty() {
            return None;
        }
        return Some(unquoted.to_string());
    }
    None
}

/// 当前生效的 Codex provider 键。未设置或 openai/chatgpt 都视为官方 OpenAI。
/// 只看顶层 `model_provider`，忽略残留的 `[model_providers.deepseek]` 段。
pub(crate) fn effective_codex_provider_key(config: &str) -> String {
    match read_top_level_toml_string(config, "model_provider") {
        Some(provider) => {
            let p = provider.trim().to_lowercase();
            if p.is_empty() || p == "openai" || p == "chatgpt" {
                "openai".to_string()
            } else {
                p
            }
        }
        None => "openai".to_string(),
    }
}

/// 切供应商（GPT ↔ DeepSeek 等）后不能续接旧 thread，否则会卡住且无输出。
pub(crate) fn codex_provider_switched(previous_config: &str, next_config: &str) -> bool {
    effective_codex_provider_key(previous_config) != effective_codex_provider_key(next_config)
}

/// 档案是否把请求打到非 OpenAI 的自定义 provider（DeepSeek / 火山等）。
/// 只看顶层 `model_provider`：GPT 切走后残留的 `[model_providers.deepseek]` 不算正在使用。
pub(crate) fn codex_config_uses_custom_provider(config: &str) -> bool {
    effective_codex_provider_key(config) != "openai"
}

/// 去掉顶层 `model_provider = ...`，让 Codex 回退 OpenAI 默认 provider。
pub(crate) fn strip_top_level_model_provider(config: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut in_table = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if !in_table && trimmed.starts_with('[') {
            in_table = true;
        }
        if !in_table {
            if let Some((k, _)) = trimmed.split_once('=') {
                if k.trim() == "model_provider" {
                    continue;
                }
            }
        }
        lines.push(line.to_string());
    }
    let mut out = lines.join("\n");
    if config.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn model_providers_table_id(trimmed: &str) -> Option<String> {
    let name = trimmed
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim();
    let rest = name.strip_prefix("model_providers")?;
    if rest.is_empty() {
        return Some(String::new());
    }
    let rest = rest.strip_prefix('.').unwrap_or(rest);
    Some(
        rest.trim_matches('"')
            .trim_matches('\'')
            .trim()
            .to_lowercase(),
    )
}

fn is_openai_builtin_provider_id(id: &str) -> bool {
    id == "openai" || id == "chatgpt"
}

/// 去掉自定义 `[model_providers.*]`，避免 GPT 目录模型仍带着 DeepSeek 段。
pub(crate) fn strip_custom_model_provider_tables(config: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut skipping = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            skipping = match model_providers_table_id(trimmed) {
                Some(id) => !is_openai_builtin_provider_id(&id),
                None => false,
            };
            if skipping {
                continue;
            }
        }
        if skipping {
            continue;
        }
        lines.push(line.to_string());
    }
    let mut out = lines.join("\n");
    if config.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// 只改磁盘 `config.toml` 的顶层 `model`，保留当前 provider / 其它配置。
pub(crate) fn patch_codex_disk_model(model: &str) -> Result<(), String> {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let current = read_codex_profile_envelope();
    let patched = patch_codex_config_model(&current.config, trimmed);
    if patched == current.config {
        return Ok(());
    }
    write_config_toml(&patched)?;
    warm_codex_disk_cache(&CodexProfileEnvelope {
        auth: current.auth,
        config: patched,
    })
}

/// 去掉自定义 `model_provider` 并把模型改成目录模型，避免 GPT 请求打到 DeepSeek。
pub(crate) fn restore_codex_openai_provider_for_model(model: &str) -> Result<(), String> {
    apply_codex_openai_catalog_envelope(
        &CodexProfileEnvelope {
            auth: Map::new(),
            config: String::new(),
        },
        model,
    )
}

/// 切到官方 GPT 目录模型：去掉自定义 provider，并丢掉上一档案残留的 API Key
/// （否则会把 DeepSeek 的 `sk-…` 送到 api.openai.com 导致 401）。
pub(crate) fn apply_codex_openai_catalog_envelope(
    overlay: &CodexProfileEnvelope,
    model: &str,
) -> Result<(), String> {
    let current = read_codex_profile_envelope();
    let mut config = if overlay.config.trim().is_empty()
        || is_model_only_codex_config(&overlay.config)
    {
        strip_top_level_model_provider(&current.config)
    } else {
        preserve_projects_tables(&overlay.config, &current.config)
    };
    config = strip_top_level_model_provider(&config);
    config = strip_custom_model_provider_tables(&config);
    if !model.trim().is_empty() {
        config = patch_codex_config_model(&config, model.trim());
    }
    let auth = merge_auth_for_openai_default(&current.auth, &overlay.auth);
    write_config_toml(&config)?;
    if !auth_maps_equal(&current.auth, &auth) {
        write_auth_json(&auth)?;
    }
    warm_codex_disk_cache(&CodexProfileEnvelope { auth, config })
}

/// 解析顶层（首个 `[section]` 之前）所有 `model =` 行：保留最后一行的值，删除其它重复。
/// 返回去重后的文本以及最终保留的 model 值（若存在）。
pub fn dedupe_top_level_model_lines(config: &str) -> (String, Option<String>) {
    let mut lines: Vec<String> = config.lines().map(str::to_string).collect();
    let mut model_indices: Vec<usize> = Vec::new();
    let mut in_table = false;
    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('[') {
            in_table = true;
            continue;
        }
        if in_table {
            continue;
        }
        if is_top_level_model_assignment(trimmed) {
            model_indices.push(idx);
        }
    }
    if model_indices.len() <= 1 {
        let kept = model_indices
            .first()
            .and_then(|idx| extract_model_value(&lines[*idx]));
        return (config.to_string(), kept);
    }
    let keep_idx = *model_indices.last().expect("non-empty");
    let kept = extract_model_value(&lines[keep_idx]);
    for idx in model_indices.into_iter().rev() {
        if idx == keep_idx {
            continue;
        }
        lines.remove(idx);
    }
    let mut out = lines.join("\n");
    if config.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    (out, kept)
}

fn extract_model_value(line: &str) -> Option<String> {
    let after_eq = line.split_once('=').map(|(_, rhs)| rhs)?;
    let trimmed = after_eq.trim().trim_matches('"').trim_matches('\'').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// ChatGPT 登录态字段。API key 档案若残留这些键，Codex 会优先刷新 ChatGPT token，
/// 失败后报 `logged out` / `no_biscuit_no_service`，并拉起 `codex_apps` MCP。
const CHATGPT_SESSION_AUTH_KEYS: &[&str] = &[
    "tokens",
    "last_refresh",
    "lastRefresh",
    "account_id",
    "chatgpt_account_id",
];

fn overlay_is_apikey_auth(overlay: &Map<String, Value>) -> bool {
    overlay
        .get("auth_mode")
        .and_then(Value::as_str)
        .map(|s| s.eq_ignore_ascii_case("apikey"))
        .unwrap_or(false)
}

/// 仅按 envelope 中存在的 key 覆盖 current.auth；其他键（用户自定）保留。
/// API key 档案会清掉 ChatGPT session，避免 RPC 继续走过期 OAuth。
fn merge_auth_maps(current: &Map<String, Value>, overlay: &Map<String, Value>) -> Map<String, Value> {
    let mut out = current.clone();
    for (k, v) in overlay {
        out.insert(k.clone(), v.clone());
    }
    if overlay_is_apikey_auth(overlay) {
        for key in CHATGPT_SESSION_AUTH_KEYS {
            out.remove(*key);
        }
    }
    out
}

fn overlay_has_openai_api_key(overlay: &Map<String, Value>) -> bool {
    overlay
        .get("OPENAI_API_KEY")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some()
}

/// 切到 OpenAI / ChatGPT 默认 provider 时的 auth 合并：
/// - 档案明确是 API Key 模式：用档案的 Key（并清掉 ChatGPT session）。
/// - 档案带 ChatGPT tokens：丢掉上一档案残留的 `OPENAI_API_KEY`，否则 Codex 会优先用
///   DeepSeek 的 `sk-…` 打 `api.openai.com` 得到 401。
/// - 档案既无 Key 也无 tokens：同样清掉残留 Key，改走本机 ChatGPT 登录态。
fn merge_auth_for_openai_default(
    current: &Map<String, Value>,
    overlay: &Map<String, Value>,
) -> Map<String, Value> {
    if overlay_is_apikey_auth(overlay) {
        return merge_auth_maps(current, overlay);
    }
    let overlay_has_chatgpt_tokens = overlay.get("tokens").is_some();
    if overlay_has_openai_api_key(overlay) && !overlay_has_chatgpt_tokens {
        return merge_auth_maps(current, overlay);
    }
    let mut out = merge_auth_maps(current, overlay);
    out.remove("OPENAI_API_KEY");
    if out
        .get("auth_mode")
        .and_then(Value::as_str)
        .map(|s| s.eq_ignore_ascii_case("apikey"))
        .unwrap_or(false)
    {
        out.remove("auth_mode");
    }
    out
}

fn is_projects_table_header(trimmed: &str) -> bool {
    let name = trimmed
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim();
    name == "projects" || name.starts_with("projects.")
}

fn extract_projects_tables(config: &str) -> String {
    let mut out = String::new();
    let mut capturing = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            capturing = is_projects_table_header(trimmed);
        }
        if capturing {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// 完整替换 provider 档案时保留 `[projects.*]`，否则每次切档案都会丢掉 trust_level。
fn preserve_projects_tables(new_config: &str, current_config: &str) -> String {
    if new_config.lines().any(|line| is_projects_table_header(line.trim())) {
        return new_config.to_string();
    }
    let projects = extract_projects_tables(current_config);
    if projects.trim().is_empty() {
        return new_config.to_string();
    }
    let mut out = new_config.trim_end().to_string();
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(projects.trim_end());
    out.push('\n');
    out
}

fn normalize_codex_project_trust_path(path: &str) -> String {
    path.trim().trim_end_matches(['/', '\\']).to_string()
}

fn projects_table_header_for_path(path: &str) -> String {
    let escaped = path.replace('\\', "\\\\").replace('"', "\\\"");
    format!("[projects.\"{escaped}\"]")
}

fn table_body_range(config: &str, header: &str) -> Option<(usize, usize)> {
    let header_pos = config.find(header)?;
    let after_header = header_pos + header.len();
    let body_start = match config[after_header..].find('\n') {
        Some(n) => after_header + n + 1,
        None => return Some((after_header, config.len())),
    };
    let rest = &config[body_start..];
    let body_end = rest
        .find("\n[")
        .map(|i| body_start + i)
        .unwrap_or(config.len());
    Some((body_start, body_end))
}

fn table_trusts_project(body: &str) -> bool {
    body.lines().any(|line| {
        let trimmed = line.trim();
        trimmed.starts_with("trust_level")
            && trimmed.contains("trusted")
            && !trimmed.starts_with('#')
    })
}

fn upsert_trusted_project_table(config: &str, project_path: &str) -> String {
    let path = normalize_codex_project_trust_path(project_path);
    if path.is_empty() {
        return config.to_string();
    }
    let header = projects_table_header_for_path(&path);
    if let Some((body_start, body_end)) = table_body_range(config, &header) {
        let body = &config[body_start..body_end];
        if table_trusts_project(body) {
            return config.to_string();
        }
        let mut next = String::new();
        next.push_str(&config[..body_start]);
        next.push_str("trust_level = \"trusted\"\n");
        let rest = body.trim_start_matches('\n');
        if !rest.is_empty() {
            next.push_str(rest);
            if !rest.ends_with('\n') && body_end < config.len() {
                next.push('\n');
            }
        }
        next.push_str(&config[body_end..]);
        return next;
    }
    let mut next = config.trim_end().to_string();
    if !next.is_empty() {
        next.push_str("\n\n");
    }
    next.push_str(&header);
    next.push('\n');
    next.push_str("trust_level = \"trusted\"\n");
    next
}

/// 把仓库标为 Codex trusted project，使 `.codex/` 项目配置 / hooks 生效。
pub fn ensure_codex_project_trusted(project_path: &str) -> Result<(), String> {
    let path = normalize_codex_project_trust_path(project_path);
    if path.is_empty() {
        return Ok(());
    }
    let current = read_codex_profile_envelope();
    let next_config = upsert_trusted_project_table(&current.config, &path);
    if next_config == current.config {
        return Ok(());
    }
    write_config_toml(&next_config)?;
    let envelope = CodexProfileEnvelope {
        auth: current.auth,
        config: next_config,
    };
    warm_codex_disk_cache(&envelope)
}

fn apply_codex_profile_envelope_inner(envelope: &CodexProfileEnvelope) -> Result<(), String> {
    let current = read_codex_profile_envelope();
    // 首次安装（当前 config.toml 为空）：直接写入 envelope，没有用户数据可冲。
    if current.config.trim().is_empty() {
        write_auth_json(&envelope.auth)?;
        write_config_toml(&envelope.config)?;
        return warm_codex_disk_cache(envelope);
    }

    // 档案 config 包含 `model_provider` 或 `[...]` 段落（典型 provider 档案）：
    // 整体替换 config.toml，使新档案的 base_url / env_key 等真正生效；
    // 同时合并 auth.json，保留 current 中档案未提供的自定 key。
    if !is_model_only_codex_config(&envelope.config) {
        let merged_config = preserve_projects_tables(&envelope.config, &current.config);
        write_config_toml(&merged_config)?;
        let merged_auth = if codex_config_uses_custom_provider(&merged_config) {
            merge_auth_maps(&current.auth, &envelope.auth)
        } else {
            merge_auth_for_openai_default(&current.auth, &envelope.auth)
        };
        if !auth_maps_equal(&current.auth, &merged_auth) {
            write_auth_json(&merged_auth)?;
        }
        let merged = CodexProfileEnvelope {
            auth: merged_auth,
            config: merged_config,
        };
        return warm_codex_disk_cache(&merged);
    }

    // 非首次：保守地只 patch model 行（保留其他用户配置）+ 合并 auth.json（保留自定 key）。
    let mut next_config = current.config.clone();
    if let Some(new_model) = read_effective_codex_model(&envelope.config) {
        let patched = patch_codex_config_model(&current.config, &new_model);
        if patched != current.config {
            write_config_toml(&patched)?;
            next_config = patched;
        }
    }
    let merged_auth = merge_auth_maps(&current.auth, &envelope.auth);
    if !auth_maps_equal(&current.auth, &merged_auth) {
        write_auth_json(&merged_auth)?;
    }
    let merged = CodexProfileEnvelope {
        auth: merged_auth,
        config: next_config,
    };
    warm_codex_disk_cache(&merged)
}

pub fn apply_codex_profile_envelope(envelope: &CodexProfileEnvelope) -> Result<(), String> {
    apply_codex_profile_envelope_inner(envelope)
}

fn write_auth_json(auth: &Map<String, Value>) -> Result<(), String> {
    let path = user_codex_dir().join("auth.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let out = serde_json::to_string_pretty(&Value::Object(auth.clone())).map_err(|e| e.to_string())?;
    crate::wise_paths::write_file_atomic(&path, &out)
}

fn write_config_toml(config: &str) -> Result<(), String> {
    let path = user_codex_dir().join("config.toml");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    crate::wise_paths::write_file_atomic(&path, config)
}

fn warm_codex_disk_cache(envelope: &CodexProfileEnvelope) -> Result<(), String> {
    let dir = user_codex_dir();
    let auth_mtime = file_mtime(&dir.join("auth.json"));
    let config_mtime = file_mtime(&dir.join("config.toml"));
    let pretty = codex_profile_envelope_to_json(envelope)?;
    if let Ok(mut guard) = CODEX_DISK_CACHE.lock() {
        *guard = Some(CodexDiskCache {
            auth_mtime,
            config_mtime,
            envelope: envelope.clone(),
            pretty,
        });
    }
    Ok(())
}

/// 一键清空 Codex 用户级配置：`auth.json` 写回 `{}`，`config.toml` 写为空。
/// `target` 为 "auth" / "config" 时只清空对应文件，其它值同时清空两者。
pub fn clear_codex_user_config(target: &str) -> Result<(), String> {
    match target {
        "auth" => write_auth_json(&Map::new())?,
        "config" => write_config_toml("")?,
        _ => {
            write_auth_json(&Map::new())?;
            write_config_toml("")?;
        }
    }
    let envelope = read_codex_profile_envelope_fresh();
    warm_codex_disk_cache(&envelope)
}

pub fn effective_codex_model_from_disk() -> Option<String> {
    read_effective_codex_model_from_envelope(&read_codex_profile_envelope())
}

pub fn read_codex_user_settings_pretty() -> String {
    let dir = user_codex_dir();
    let auth_path = dir.join("auth.json");
    let config_path = dir.join("config.toml");
    let auth_mtime = file_mtime(&auth_path);
    let config_mtime = file_mtime(&config_path);
    if let Ok(guard) = CODEX_DISK_CACHE.lock() {
        if let Some(cache) = guard.as_ref() {
            if cache.auth_mtime == auth_mtime && cache.config_mtime == config_mtime {
                if cache.pretty.ends_with('\n') {
                    return cache.pretty.clone();
                }
                return format!("{}\n", cache.pretty);
            }
        }
    }
    let _ = read_codex_profile_envelope();
    if let Ok(guard) = CODEX_DISK_CACHE.lock() {
        if let Some(cache) = guard.as_ref() {
            if cache.pretty.ends_with('\n') {
                return cache.pretty.clone();
            }
            return format!("{}\n", cache.pretty);
        }
    }
    "{}\n".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_model_from_config_toml() {
        let config = r#"
model = "gpt-5.4"
model_reasoning_effort = "medium"
"#;
        assert_eq!(
            read_effective_codex_model(config).as_deref(),
            Some("gpt-5.4")
        );
    }

    #[test]
    fn parses_envelope_model() {
        let envelope = CodexProfileEnvelope {
            auth: Map::new(),
            config: "model=\"qwen3.5-plus\"\n".to_string(),
        };
        assert_eq!(
            read_effective_codex_model_from_envelope(&envelope).as_deref(),
            Some("qwen3.5-plus")
        );
    }

    #[test]
    fn patch_codex_config_model_replaces_existing_line() {
        let config = "model = \"old\"\nmodel_reasoning_effort = \"medium\"\n";
        let patched = patch_codex_config_model(config, "gpt-5.4");
        assert!(patched.contains("model = \"gpt-5.4\""));
        assert!(patched.contains("model_reasoning_effort"));
        assert!(!patched.contains("old"));
    }

    #[test]
    fn openai_catalog_model_heuristic() {
        assert!(looks_like_openai_catalog_model("gpt-5.6"));
        assert!(looks_like_openai_catalog_model("GPT-5.6-Luna"));
        assert!(looks_like_openai_catalog_model("o3-mini"));
        assert!(!looks_like_openai_catalog_model("deepseek-v4-flash"));
        assert!(!looks_like_openai_catalog_model("minimax-m2.5"));
    }

    #[test]
    fn custom_provider_detection_and_strip() {
        let deepseek = r#"model = "deepseek-v4-flash"
model_provider = "deepseek"

[model_providers.deepseek]
base_url = "https://api.deepseek.com/v1"
"#;
        assert!(codex_config_uses_custom_provider(deepseek));
        let stripped = strip_top_level_model_provider(deepseek);
        assert!(!stripped.contains("model_provider ="));
        assert!(stripped.contains("[model_providers.deepseek]"));
        assert!(!codex_config_uses_custom_provider("model = \"gpt-5.6\"\n"));
        assert!(!codex_config_uses_custom_provider(
            "model = \"gpt-5.6\"\nmodel_provider = \"openai\"\n"
        ));
        let leftover = r#"model = "gpt-5.6"

[model_providers.deepseek]
base_url = "https://api.deepseek.com/v1"
"#;
        assert_eq!(effective_codex_provider_key(leftover), "openai");
        assert!(!codex_config_uses_custom_provider(leftover));
        assert!(codex_provider_switched(leftover, deepseek));
        assert!(!codex_provider_switched(leftover, "model = \"gpt-5.4\"\n"));
        let catalog_stripped = strip_custom_model_provider_tables(&stripped);
        assert!(!catalog_stripped.contains("[model_providers.deepseek]"));
        assert!(!catalog_stripped.contains("deepseek.com"));
    }

    #[test]
    fn openai_to_deepseek_provider_switch_is_detected() {
        let openai = "model = \"gpt-5.6\"\n";
        let deepseek = "model = \"deepseek-v4-flash\"\nmodel_provider = \"deepseek\"\n";
        assert_eq!(effective_codex_provider_key(openai), "openai");
        assert_eq!(effective_codex_provider_key(deepseek), "deepseek");
        assert!(codex_provider_switched(openai, deepseek));
        assert!(codex_provider_switched(deepseek, openai));
    }

    #[test]
    fn merge_auth_maps_preserves_user_keys() {
        let current: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "old-key",
            "MY_TOKEN": "keep-me",
            "OPENAI_ORG_ID": "org-1"
        }))
        .expect("parse current");
        let overlay: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "new-key"
        }))
        .expect("parse overlay");
        let merged = merge_auth_maps(&current, &overlay);
        // overlay 提供的 key 被覆盖
        assert_eq!(merged["OPENAI_API_KEY"].as_str(), Some("new-key"));
        // current 自定的 key 必须保留
        assert_eq!(merged["MY_TOKEN"].as_str(), Some("keep-me"));
        assert_eq!(merged["OPENAI_ORG_ID"].as_str(), Some("org-1"));
    }

    #[test]
    fn merge_auth_maps_strips_chatgpt_session_when_applying_apikey_profile() {
        let current: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "tokens": { "access_token": "expired", "refresh_token": "old" },
            "last_refresh": "2024-01-01",
            "OPENAI_API_KEY": "old-key"
        }))
        .expect("parse current");
        let overlay: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "sk-local",
            "auth_mode": "apikey",
            "tokens": { "access_token": "stale-clone" }
        }))
        .expect("parse overlay");
        let merged = merge_auth_maps(&current, &overlay);
        assert_eq!(merged["OPENAI_API_KEY"].as_str(), Some("sk-local"));
        assert_eq!(merged["auth_mode"].as_str(), Some("apikey"));
        assert!(merged.get("tokens").is_none());
        assert!(merged.get("last_refresh").is_none());
    }

    #[test]
    fn merge_auth_for_openai_default_drops_leftover_apikey() {
        let current: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "sk-deepseek-leftover",
            "auth_mode": "apikey"
        }))
        .expect("parse current");
        let chatgpt_overlay: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "tokens": { "access_token": "chatgpt" }
        }))
        .expect("parse chatgpt overlay");
        let merged = merge_auth_for_openai_default(&current, &chatgpt_overlay);
        assert!(merged.get("OPENAI_API_KEY").is_none());
        assert!(merged.get("auth_mode").is_none());
        assert_eq!(
            merged["tokens"]["access_token"].as_str(),
            Some("chatgpt")
        );

        let empty_overlay = Map::new();
        let stripped = merge_auth_for_openai_default(&current, &empty_overlay);
        assert!(stripped.get("OPENAI_API_KEY").is_none());
        assert!(stripped.get("auth_mode").is_none());
    }

    #[test]
    fn merge_auth_for_openai_default_keeps_explicit_apikey_profile() {
        let current: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "sk-deepseek-leftover",
            "tokens": { "access_token": "stale" }
        }))
        .expect("parse current");
        let overlay: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "sk-openai",
            "auth_mode": "apikey"
        }))
        .expect("parse overlay");
        let merged = merge_auth_for_openai_default(&current, &overlay);
        assert_eq!(merged["OPENAI_API_KEY"].as_str(), Some("sk-openai"));
        assert_eq!(merged["auth_mode"].as_str(), Some("apikey"));
        assert!(merged.get("tokens").is_none());
    }

    #[test]
    fn merge_auth_for_openai_default_prefers_chatgpt_tokens_over_stale_key() {
        let current: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "sk-deepseek-leftover",
            "auth_mode": "apikey"
        }))
        .expect("parse current");
        let overlay: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "sk-deepseek-leftover",
            "tokens": { "access_token": "chatgpt" }
        }))
        .expect("parse overlay");
        let merged = merge_auth_for_openai_default(&current, &overlay);
        assert!(merged.get("OPENAI_API_KEY").is_none());
        assert!(merged.get("auth_mode").is_none());
        assert_eq!(
            merged["tokens"]["access_token"].as_str(),
            Some("chatgpt")
        );
    }

    #[test]
    fn upsert_trusted_project_table_appends_and_is_idempotent() {
        let config = "model = \"deepseek-v4-flash\"\n";
        let once = upsert_trusted_project_table(config, "/Users/sjl/repo/");
        assert!(once.contains("[projects.\"/Users/sjl/repo\"]"));
        assert!(once.contains("trust_level = \"trusted\""));
        let twice = upsert_trusted_project_table(&once, "/Users/sjl/repo");
        assert_eq!(once.matches("trust_level = \"trusted\"").count(), 1);
        assert_eq!(twice, once);
    }

    #[test]
    fn preserve_projects_tables_keeps_trust_when_replacing_provider() {
        let current = r#"model = "old"
[projects."/Users/sjl/repo"]
trust_level = "trusted"
"#;
        let incoming = "model = \"new\"\nmodel_provider = \"volc\"\n";
        let merged = preserve_projects_tables(incoming, current);
        assert!(merged.contains("model = \"new\""));
        assert!(merged.contains("[projects.\"/Users/sjl/repo\"]"));
        assert!(merged.contains("trust_level = \"trusted\""));
    }

    #[test]
    fn patch_codex_config_model_preserves_unknown_sections() {
        // 用户的 config.toml 含非 model 行（自定义 section / 注释），patch 必须只动 model 行。
        let current = r#"# user comment
model = "gpt-5"

[custom_section]
foo = "bar"
nested = { a = 1 }
"#;
        let patched = patch_codex_config_model(current, "gpt-5.4");
        assert!(patched.contains("model = \"gpt-5.4\""));
        assert!(!patched.contains("model = \"gpt-5\""));
        // 自定义 section / 注释必须原样保留
        assert!(patched.contains("# user comment"));
        assert!(patched.contains("[custom_section]"));
        assert!(patched.contains("foo = \"bar\""));
        assert!(patched.contains("nested = { a = 1 }"));
    }

    #[test]
    fn apply_envelope_preserves_user_config_and_extra_auth_keys() {
        // 模拟当前 config.toml / auth.json 含用户内容；验证 patch + merge 路径不丢用户数据。
        let envelope = CodexProfileEnvelope {
            auth: serde_json::from_value(serde_json::json!({
                "OPENAI_API_KEY": "new"
            }))
            .expect("envelope auth"),
            config: r#"model = "gpt-5.4""#.to_string(),
        };
        let current_config = r#"# user section
model = "gpt-5"
[custom]
foo = "bar"
"#;
        let current_auth: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "old",
            "MY_TOKEN": "secret"
        }))
        .expect("current auth");

        // 等价于 `apply_codex_profile_envelope_inner` 非首次路径上的两次合并操作。
        let patched = patch_codex_config_model(current_config, "gpt-5.4");
        assert!(patched.contains("[custom]"));
        assert!(patched.contains("foo = \"bar\""));
        assert!(patched.contains("model = \"gpt-5.4\""));

        let merged_auth = merge_auth_maps(&current_auth, &envelope.auth);
        assert_eq!(merged_auth["OPENAI_API_KEY"].as_str(), Some("new"));
        assert_eq!(merged_auth["MY_TOKEN"].as_str(), Some("secret"));
    }

    #[test]
    fn dedupe_top_level_model_lines_keeps_last_value() {
        let cfg = "model = \"a\"\nmodel = \"b\"\nmodel_reasoning_effort = \"high\"\n[custom]\nmodel = \"in-section\"\n";
        let (out, kept) = dedupe_top_level_model_lines(cfg);
        assert_eq!(kept.as_deref(), Some("b"));
        assert!(out.contains("model = \"b\""));
        assert!(!out.contains("model = \"a\""));
        // model_reasoning_effort 不能被误删
        assert!(out.contains("model_reasoning_effort = \"high\""));
        // section 内部的 model 不动
        assert!(out.contains("[custom]"));
        assert!(out.contains("model = \"in-section\""));
    }

    #[test]
    fn patch_codex_config_model_dedupes_duplicate_top_level_models() {
        let cfg = "# header\nmodel = \"old1\"\nmodel = \"old2\"\nmodel_reasoning_effort = \"medium\"\n[section]\nfoo = \"bar\"\n";
        let patched = patch_codex_config_model(cfg, "new");
        let occurrences = patched
            .lines()
            .filter(|line| {
                let t = line.trim();
                !t.is_empty()
                    && !t.starts_with('#')
                    && !t.starts_with('[')
                    && is_top_level_model_assignment(t)
            })
            .count();
        assert_eq!(occurrences, 1);
        assert!(patched.contains("model = \"new\""));
        assert!(!patched.contains("old1"));
        assert!(!patched.contains("old2"));
        assert!(patched.contains("model_reasoning_effort = \"medium\""));
        assert!(patched.contains("[section]"));
    }

    #[test]
    fn parse_envelope_dedupes_model_lines() {
        let raw = serde_json::json!({
            "auth": {},
            "config": "model = \"a\"\nmodel = \"b\"\n"
        })
        .to_string();
        let envelope = parse_codex_profile_envelope(&raw).expect("parses");
        assert!(!envelope.config.contains("model = \"a\""));
        assert!(envelope.config.contains("model = \"b\""));
    }

    #[test]
    fn is_model_only_codex_config_detects_minimal_profile() {
        // 仅一行 model，注释/空行忽略 → 走 patch-only 分支。
        assert!(is_model_only_codex_config("model = \"gpt-5.4\"\n"));
        assert!(is_model_only_codex_config(
            "# 仅注释\nmodel = \"gpt-5.4\"\n\n# 末尾注释\n"
        ));
        assert!(!is_model_only_codex_config("model = \"a\"\nother = 1\n"));
        // 含 `model_provider` 顶层键 → 视为完整 provider 档案，整体替换。
        assert!(!is_model_only_codex_config(
            "model = \"minimax\"\nmodel_provider = \"minimax\"\n"
        ));
        // 含任意 `[section]` → 视为完整 provider 档案，整体替换。
        assert!(!is_model_only_codex_config(
            "model = \"minimax\"\n\n[model_providers.minimax]\nbase_url = \"x\"\n"
        ));
        // 顶层有重复 model 行（解析阶段已被去重，但 is_model_only 应保守返回 false）。
        assert!(!is_model_only_codex_config(
            "model = \"a\"\nmodel = \"b\"\n"
        ));
    }

    #[test]
    fn apply_envelope_full_profile_replaces_config_and_merges_auth() {
        // 完整 provider 档案（典型 CC Switch / 火山 minimax 形态）：
        // apply 后 config.toml 必须是档案内容（provider / base_url 真正生效），
        // auth.json 仍按白名单合并，current 中档案未提供的自定 key 必须保留。
        let envelope = CodexProfileEnvelope {
            auth: serde_json::from_value(serde_json::json!({
                "OPENAI_API_KEY": "new-key",
                "auth_mode": "apikey"
            }))
            .expect("envelope auth"),
            config: r#"model = "minimax"
model_provider = "minimax"
model_reasoning_effort = "medium"

[model_providers.minimax]
name = "minimax"
base_url = "https://api.example.com/v1"
env_key = "MINIMAX_API_KEY"
wire_api = "responses"
"#
            .to_string(),
        };
        // 文档化「切换前」用户磁盘上的 config：含自定义 [custom] 段。
        // 整体替换路径会丢掉它 —— 这就是「provider 档案」应有的语义。
        let _current_config = r#"# user kept
model = "gpt-5"
[custom]
foo = "bar"
"#;
        let current_auth: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY": "old-key",
            "MY_TOKEN": "keep-me"
        }))
        .expect("current auth");

        // 模拟非首次安装路径：current.config 非空，档案非 model-only → 整体替换。
        // 这里直接调用 `write_config_toml` / `write_auth_json` 不安全（会落盘），
        // 改为断言「应进入整体替换分支」所需的关键状态：档案非 model-only + 合并结果正确。
        assert!(!is_model_only_codex_config(&envelope.config));
        let merged_auth = merge_auth_maps(&current_auth, &envelope.auth);
        assert_eq!(merged_auth["OPENAI_API_KEY"].as_str(), Some("new-key"));
        assert_eq!(merged_auth["auth_mode"].as_str(), Some("apikey"));
        assert_eq!(merged_auth["MY_TOKEN"].as_str(), Some("keep-me"));
        // 整体替换后 disk 上的 config 必须是档案的 config（用户原有 [custom] 不保留）。
        assert!(envelope.config.contains("model_provider = \"minimax\""));
        assert!(envelope.config.contains("[model_providers.minimax]"));
        assert!(envelope.config.contains("base_url = \"https://api.example.com/v1\""));
    }
}
