//! Codex 运行态模型列表：`codex debug models` 目录 + 本机配置的模型
//! （`~/.codex/config.toml` 与各 Codex 模型档案的 config 信封）。

use serde::Serialize;
use crate::cli_probe::{output_with_timeout, ModelProbeCache};
use std::time::Duration;

use crate::claude_model_profiles::{load_store, ClaudeModelProfile};
use crate::codex_binary::{apply_codex_child_env, codex_merged_path_env, find_codex_binary};
use crate::codex_config_dir::{parse_codex_profile_envelope, read_codex_profile_envelope};
use crate::wise_db::WiseDb;

/// 返回给前端的模型选项。`provider` 为 `model_provider.<id>` 或档案供应商名（可空）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModelListItem {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
}

/// 解析 `codex debug models` 的 JSON 目录：`{"models":[{slug,display_name,visibility,...}]}`。
/// 过滤 `visibility == "hide"` 的隐藏模型，保留目录顺序（目录已按优先级排序）。
fn parse_codex_models_catalog(stdout: &str) -> Vec<CodexModelListItem> {
    let value: serde_json::Value = match serde_json::from_str(stdout) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(models) = value.get("models").and_then(|m| m.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for item in models {
        let Some(id) = item.get("slug").and_then(|s| s.as_str()).map(str::trim) else {
            continue;
        };
        if id.is_empty() || !seen.insert(id.to_string()) {
            continue;
        }
        if item
            .get("visibility")
            .and_then(|v| v.as_str())
            .map(|v| v == "hide")
            .unwrap_or(false)
        {
            continue;
        }
        let display_name = item
            .get("display_name")
            .and_then(|d| d.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(id)
            .to_string();
        out.push(CodexModelListItem {
            id: id.to_string(),
            display_name,
            provider: None,
        });
    }
    out
}

/// 从 `~/.codex/config.toml` 文本提取配置的模型：
/// - 顶层 `model = "..."`（附带 `model_provider = "..."` 作为 provider）
/// - `[model_providers.<id>]` 内的 `model = "..."` 与 `models = [...]`（含多行数组）
fn collect_codex_configured_models(config: &str) -> Vec<CodexModelListItem> {
    let mut out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let mut section_provider: Option<String> = None;
    let mut top_provider: Option<String> = None;
    let mut lines = config.lines().peekable();

    let push = |out: &mut Vec<CodexModelListItem>, seen: &mut std::collections::BTreeSet<String>, id: String, provider: Option<String>| {
        let id = id.trim();
        if id.is_empty() || !seen.insert(id.to_string()) {
            return;
        }
        out.push(CodexModelListItem {
            id: id.to_string(),
            display_name: id.to_string(),
            provider: provider.filter(|p| !p.is_empty()),
        });
    };

    while let Some(raw) = lines.next() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            // `[model_providers.<id>]`；其它表（features/projects/...）不参与。
            let rest = line.trim_start_matches('[').trim_end_matches(']').trim();
            if let Some(id) = rest.strip_prefix("model_providers.").map(str::trim) {
                section_provider = Some(id.to_string());
            } else {
                section_provider = None;
            }
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if section_provider.is_none() {
            if key == "model_provider" {
                top_provider = strip_toml_value(value).map(str::to_string);
                continue;
            }
            if key == "model" {
                if let Some(model) = strip_toml_value(value) {
                    push(&mut out, &mut seen, model.to_string(), top_provider.clone());
                }
                continue;
            }
            continue;
        }
        if key == "model" {
            if let Some(model) = strip_toml_value(value) {
                push(
                    &mut out,
                    &mut seen,
                    model.to_string(),
                    section_provider.clone(),
                );
            }
            continue;
        }
        if key == "models" {
            let provider = section_provider.clone();
            for item in parse_toml_string_array(value, &mut lines) {
                push(&mut out, &mut seen, item, provider.clone());
            }
        }
    }
    out
}

/// 去掉 TOML 字符串值的引号（不做转义展开，模型名基本不含转义）。
fn strip_toml_value(value: &str) -> Option<&str> {
    let v = value.trim().trim_end_matches(|c| c == ',' || c == '#').trim();
    if v.is_empty() {
        return None;
    }
    let v = v.trim_matches('"').trim_matches('\'').trim();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

/// 解析 TOML 字符串数组；支持单行 `["a","b"]` 与多行 `[\n "a",\n "b",\n]`。
fn parse_toml_string_array(
    first_value: &str,
    lines: &mut std::iter::Peekable<std::str::Lines<'_>>,
) -> Vec<String> {
    let mut buf = first_value.trim().to_string();
    if !buf.trim_end().ends_with(']') {
        while let Some(next) = lines.next() {
            buf.push('\n');
            buf.push_str(next);
            if next.trim().ends_with(']') {
                break;
            }
        }
    }
    let inner = buf
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']');
    if inner.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for part in inner.split(',') {
        if let Some(v) = strip_toml_value(part) {
            out.push(v.to_string());
        }
    }
    out
}

/// 按 id 去重后追加一个模型选项（`provider` 为空则不落字段）。
fn push_codex_model(
    out: &mut Vec<CodexModelListItem>,
    seen: &mut std::collections::BTreeSet<String>,
    id: &str,
    provider: Option<&str>,
) {
    let id = id.trim();
    if id.is_empty() || !seen.insert(id.to_string()) {
        return;
    }
    out.push(CodexModelListItem {
        id: id.to_string(),
        display_name: id.to_string(),
        provider: provider
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    });
}

/// 本地 Codex 模型档案里声明的模型（DeepSeek / 火山等自定义 provider）。
///
/// `~/.codex/config.toml` 会被「上一次执行的模型 / 档案」整段改写：跑过一次目录 GPT 模型后，
/// 自定义 provider 段会被剥离，本机 DeepSeek 模型就从 config.toml 消失了。
/// Composer 选择器必须仍能选到它，所以在档案清单里补齐（供应商名可用时取档案 company）。
fn collect_codex_profile_models(profiles: &[ClaudeModelProfile]) -> Vec<CodexModelListItem> {
    let mut out: Vec<CodexModelListItem> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for profile in profiles {
        if !profile.engine.trim().eq_ignore_ascii_case("codex") {
            continue;
        }
        let company = profile.company.as_str();
        if let Ok(envelope) = parse_codex_profile_envelope(&profile.settings_json) {
            for item in collect_codex_configured_models(&envelope.config) {
                push_codex_model(
                    &mut out,
                    &mut seen,
                    &item.id,
                    Some(item.provider.as_deref().unwrap_or(company)),
                );
            }
        }
        push_codex_model(&mut out, &mut seen, &profile.model_id, Some(company));
    }
    out
}

/// 列出 Codex 可选模型：运行态目录 + 本机配置的模型（config.toml + 各 Codex 档案）。
/// 任意环节失败都返回空列表（前端选择器容错，与 opencode/qoder 一致）。
#[tauri::command]
pub async fn codex_list_models(
    db: tauri::State<'_, WiseDb>,
) -> Result<Vec<CodexModelListItem>, String> {
    let mut out: Vec<CodexModelListItem> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();

    for item in codex_model_catalog().await {
        if seen.insert(item.id.clone()) {
            out.push(item);
        }
    }

    let envelope = read_codex_profile_envelope();
    for item in collect_codex_configured_models(&envelope.config) {
        push_codex_model(&mut out, &mut seen, &item.id, item.provider.as_deref());
    }
    // 本地档案声明的模型：不依赖 `~/.codex/config.toml` 当前指向哪个 provider，
    // 也不必等前端档案缓存就绪，选择器随时可选（新建会话前后一致）。
    for item in collect_codex_profile_models(&load_store(&db).profiles) {
        push_codex_model(&mut out, &mut seen, &item.id, item.provider.as_deref());
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// 模型白名单护栏：Codex 执行时只透传「配置已声明」或「运行态目录已知」的模型。
// 未知模型（如 Claude 侧 MiniMax-M3 泄漏到 codex）不下发，回退 config.toml 默认
// 模型，避免 provider（如火山方舟 deepseek）以 invalid_request_error 拒绝。
// ---------------------------------------------------------------------------

// Picker and execution guard share the same catalog, including failure cooldown.
static CODEX_MODEL_CATALOG_CACHE: ModelProbeCache<CodexModelListItem> = ModelProbeCache::new();

async fn codex_model_catalog() -> Vec<CodexModelListItem> {
    CODEX_MODEL_CATALOG_CACHE.get_or_load(|| async {
        // Binary discovery can run a login shell; keep it off Tokio's worker.
        let Ok(Ok((path, path_env))) = tokio::task::spawn_blocking(|| {
            find_codex_binary().map(|path| (path, codex_merged_path_env()))
        }).await else {
            return Vec::new();
        };
        let mut cmd = tokio::process::Command::new(path);
        cmd.args(["debug", "models"]);
        apply_codex_child_env(&mut cmd, &path_env);
        match output_with_timeout(&mut cmd, Duration::from_secs(4)).await {
            Ok(Ok(output)) if output.status.success() => {
                parse_codex_models_catalog(&String::from_utf8_lossy(&output.stdout))
            }
            _ => Vec::new(),
        }
    }).await
}

/// config.toml 是否已声明该模型（顶层 `model` / `[model_providers.*]` 的 `model`、`models`）。
fn codex_model_configured_in(config: &str, model: &str) -> bool {
    collect_codex_configured_models(config).iter().any(|m| m.id == model)
}

/// 模型是否可安全下发给 codex：
/// 1. config.toml 已声明；
/// 2. 或运行态 `codex debug models` 目录命中。
/// 目录查询失败/无输出时放行，保持现状行为，避免误杀自定义 provider 模型。
pub(crate) async fn codex_model_is_known(model: &str) -> bool {
    let model = model.trim();
    if model.is_empty() {
        return true;
    }
    let envelope = read_codex_profile_envelope();
    if codex_model_configured_in(&envelope.config, model) {
        return true;
    }
    let catalog = codex_model_catalog().await;
    // Preserve fail-open behavior for custom providers when discovery is unavailable.
    catalog.is_empty() || catalog.iter().any(|item| item.id == model)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_models_catalog() {
        let body = r#"{"models":[
          {"slug":"gpt-5.4","display_name":"GPT-5.4","visibility":"list"},
          {"slug":"codex-auto-review","display_name":"Codex Auto Review","visibility":"hide"},
          {"slug":"gpt-5.2","display_name":"GPT-5.2","visibility":"list"},
          {"slug":"gpt-5.2","display_name":"GPT-5.2 Dup","visibility":"list"}
        ]}"#;
        let items = parse_codex_models_catalog(body);
        assert_eq!(
            items.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["gpt-5.4", "gpt-5.2"]
        );
        assert_eq!(items[0].display_name, "GPT-5.4");
        assert_eq!(items[1].display_name, "GPT-5.2");
    }

    #[test]
    fn catalog_failure_yields_empty() {
        assert!(parse_codex_models_catalog("not json").is_empty());
        assert!(parse_codex_models_catalog(r#"{"data":[]}"#).is_empty());
    }

    #[test]
    fn collects_configured_models_from_config() {
        let config = r#"
model_provider = "volc-ark-coding"
model = "deepseek-v4-flash"

[model_providers.volc-ark-coding]
name = "Volc Ark Coding Plan"
api_key = "sk-xxx"

[model_providers.openai]
name = "OpenAI"
models = [
  "gpt-5.4",
  "gpt-5.4-mini",
]
model = "gpt-5.4"

[features]
shell_snapshot = true
"#;
        let items = collect_codex_configured_models(config);
        let ids: Vec<(&str, Option<&str>)> = items
            .iter()
            .map(|i| (i.id.as_str(), i.provider.as_deref()))
            .collect();
        assert_eq!(
            ids,
            vec![
                ("deepseek-v4-flash", Some("volc-ark-coding")),
                ("gpt-5.4", Some("openai")),
                ("gpt-5.4-mini", Some("openai")),
            ]
        );
    }

    #[test]
    fn configured_models_dedupe_and_skip_quoted_forms() {
        let config = r#"
model = 'qwen3.5'
[model_providers.a]
model = "qwen3.5"
models = ["qwen3.5", "qwen3.5-max", ""]
"#;
        let items = collect_codex_configured_models(config);
        assert_eq!(
            items.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["qwen3.5", "qwen3.5-max"]
        );
    }

    #[test]
    fn guard_accepts_config_declared_models_only() {
        let config = r#"
model_provider = "volc-ark-coding"
model = "deepseek-v4-flash"

[model_providers.volc-ark-coding]
models = ["deepseek-v4-pro", "deepseek-v4-flash"]
"#;
        assert!(codex_model_configured_in(config, "deepseek-v4-flash"));
        assert!(codex_model_configured_in(config, "deepseek-v4-pro"));
        // Claude 侧模型不在 codex 配置/目录中，应被护栏拦下。
        assert!(!codex_model_configured_in(config, "MiniMax-M3"));
        assert!(!codex_model_configured_in(config, "sonnet"));
    }

    fn codex_profile(
        id: &str,
        engine: &str,
        company: &str,
        model_id: &str,
        config: &str,
    ) -> ClaudeModelProfile {
        ClaudeModelProfile {
            id: id.to_string(),
            company: company.to_string(),
            name: id.to_string(),
            official_website_url: String::new(),
            model_id: model_id.to_string(),
            settings_json: serde_json::json!({ "auth": {}, "config": config }).to_string(),
            engine: engine.to_string(),
            created_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn profile_models_survive_a_rewritten_config_toml() {
        // config.toml 已被目录 GPT 模型改写（自定义 provider 段被剥离）时，
        // 本地 DeepSeek 模型仍须出现在选择器里。
        let profiles = vec![
            codex_profile(
                "deepseek-flash",
                "codex",
                "deepseek",
                "deepseek-flash",
                "model = \"deepseek-flash\"\n\
                 model_provider = \"deepseek\"\n\n\
                 [model_providers.deepseek]\n\
                 base_url = \"https://api.deepseek.com/\"\n\
                 models = [\"deepseek-flash\", \"deepseek-v4-pro\"]\n",
            ),
            codex_profile("claude-only", "claude", "火山", "MiniMax-M3", "{}"),
        ];
        let items = collect_codex_profile_models(&profiles);
        assert_eq!(
            items
                .iter()
                .map(|item| (item.id.as_str(), item.provider.as_deref()))
                .collect::<Vec<_>>(),
            vec![
                ("deepseek-flash", Some("deepseek")),
                ("deepseek-v4-pro", Some("deepseek")),
            ]
        );
    }

    #[test]
    fn profile_without_config_still_contributes_its_model_id() {
        let profiles = vec![codex_profile("custom", "codex", "openAI", "custom", "")];
        let items = collect_codex_profile_models(&profiles);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "custom");
        assert_eq!(items[0].provider.as_deref(), Some("openAI"));
    }
}
