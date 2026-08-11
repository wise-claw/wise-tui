//! Codex 运行态模型列表：`codex debug models` 目录 + `~/.codex/config.toml` 中配置的模型。

use serde::Serialize;

use crate::codex_binary::{apply_codex_child_env, codex_merged_path_env, find_codex_binary};
use crate::codex_config_dir::read_codex_profile_envelope;

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

/// 列出 Codex 可选模型：运行态目录 + 本机配置的模型。
/// 任意环节失败都返回空列表（前端选择器容错，与 opencode/qoder 一致）。
#[tauri::command]
pub async fn codex_list_models() -> Result<Vec<CodexModelListItem>, String> {
    let mut out: Vec<CodexModelListItem> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();

    let codex_path = find_codex_binary().ok();
    if let Some(path) = codex_path {
        let mut cmd = tokio::process::Command::new(&path);
        cmd.arg("debug").arg("models");
        let path_env = codex_merged_path_env();
        apply_codex_child_env(&mut cmd, &path_env);
        if let Ok(output) = cmd.output().await {
            if output.status.success() {
                if let Ok(stdout) = String::from_utf8(output.stdout) {
                    for item in parse_codex_models_catalog(&stdout) {
                        if seen.insert(item.id.clone()) {
                            out.push(item);
                        }
                    }
                }
            }
        }
    }

    let envelope = read_codex_profile_envelope();
    for item in collect_codex_configured_models(&envelope.config) {
        if seen.insert(item.id.clone()) {
            out.push(item);
        }
    }
    Ok(out)
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
}
