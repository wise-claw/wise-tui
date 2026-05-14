//! TypeScript `compilerOptions.paths` + `baseUrl` loading, aligned with GitNexus
//! `gitnexus/src/core/ingestion/language-config.ts` (`loadTsconfigPaths`).

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

/// Parsed tsconfig path mapping for TS/JS import resolution.
#[derive(Debug, Clone)]
pub struct TsconfigPaths {
    /// Normalized base URL segment (no leading `./`, no trailing `/`); `"."` means repo root.
    pub base_url: String,
    /// `(alias_prefix, target_prefix)` sorted by `alias_prefix` length descending (longest match first).
    pub aliases: Vec<(String, String)>,
}

static LINE_COMMENT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"//[^\n]*").expect("tsconfig line comment regex"));
static BLOCK_COMMENT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"/\*[\s\S]*?\*/").expect("tsconfig block comment regex"));

fn strip_jsonc_comments(raw: &str) -> String {
    // Match GitNexus `language-config.ts`: line comments first, then block comments.
    let s = LINE_COMMENT.replace_all(raw, "").to_string();
    BLOCK_COMMENT.replace_all(&s, "").to_string()
}

fn pattern_to_prefix(pattern: &str) -> String {
    if let Some(p) = pattern.strip_suffix("/*") {
        p.to_string()
    } else {
        pattern.to_string()
    }
}

fn target_to_prefix(target: &str) -> String {
    let t = if let Some(p) = target.strip_suffix("/*") {
        p
    } else {
        target
    };
    t.trim_start_matches("./").to_string()
}

/// Load the first `tsconfig*.json` under `repo_root` that defines `compilerOptions.paths`.
pub fn load_tsconfig_paths(repo_root: &Path) -> Option<TsconfigPaths> {
    for filename in ["tsconfig.json", "tsconfig.app.json", "tsconfig.base.json"] {
        let p = repo_root.join(filename);
        let raw = std::fs::read_to_string(&p).ok()?;
        let stripped = strip_jsonc_comments(&raw);
        let tsconfig: Value = serde_json::from_str(&stripped).ok()?;
        let paths = tsconfig.get("compilerOptions")?.get("paths")?;
        let paths_obj = paths.as_object()?;
        if paths_obj.is_empty() {
            continue;
        }

        let base_url = tsconfig
            .get("compilerOptions")
            .and_then(|c| c.get("baseUrl"))
            .and_then(|v| v.as_str())
            .unwrap_or(".")
            .trim()
            .trim_start_matches("./")
            .trim_end_matches('/')
            .to_string();
        let base_url = if base_url.is_empty() { ".".into() } else { base_url };

        let mut aliases: Vec<(String, String)> = Vec::new();
        for (pattern, targets_val) in paths_obj {
            let targets = targets_val.as_array()?;
            let first = targets.first()?.as_str()?;
            let alias_prefix = pattern_to_prefix(pattern);
            let target_prefix = target_to_prefix(first);
            if alias_prefix.is_empty() {
                continue;
            }
            aliases.push((alias_prefix, target_prefix));
        }

        if aliases.is_empty() {
            continue;
        }

        aliases.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        return Some(TsconfigPaths { base_url, aliases });
    }
    None
}

/// Rewrite a non-relative import using tsconfig paths (GitNexus `resolveImportPath` TS branch).
pub fn rewrite_tsconfig_import(ts: &TsconfigPaths, import_path: &str) -> Option<String> {
    let import_path = import_path.trim();
    if import_path.starts_with('.') {
        return None;
    }
    for (alias_prefix, target_prefix) in &ts.aliases {
        if import_path.starts_with(alias_prefix) {
            let remainder = &import_path[alias_prefix.len()..];
            let rewritten = if ts.base_url == "." {
                format!("{target_prefix}{remainder}")
            } else {
                format!("{}/{target_prefix}{remainder}", ts.base_url)
            };
            return Some(rewritten.replace('\\', "/"));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrite_matches_gitnexus_style_join() {
        let ts = TsconfigPaths {
            base_url: ".".into(),
            aliases: vec![("@/".into(), "src/".into())],
        };
        assert_eq!(
            rewrite_tsconfig_import(&ts, "@/utils/theme").as_deref(),
            Some("src/utils/theme")
        );
    }
}
