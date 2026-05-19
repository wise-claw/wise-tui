//! Extension loader — discovers manifests on disk and resolves `$file:` indirection.

use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::manifest::ExtensionManifest;

const MANIFEST_FILE: &str = "wise-extension.json";
const MAX_FILE_INDIRECTION_DEPTH: u8 = 2;

#[derive(Debug, Clone)]
pub struct LoadedExtension {
    pub dir: PathBuf,
    pub manifest_path: PathBuf,
    pub manifest: ExtensionManifest,
}

#[derive(Debug)]
pub enum LoadError {
    Io(String),
    Parse(String),
    Validation(String),
}

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoadError::Io(m) => write!(f, "io: {m}"),
            LoadError::Parse(m) => write!(f, "parse: {m}"),
            LoadError::Validation(m) => write!(f, "validation: {m}"),
        }
    }
}

impl std::error::Error for LoadError {}

#[derive(Debug, Default)]
pub struct LoadOutcome {
    pub loaded: Vec<LoadedExtension>,
    /// Failures keyed by extension dir.
    pub errors: HashMap<PathBuf, String>,
}

/// Resolve scan dirs: env override (PATH-separated) takes priority, then
/// `~/.wise/extensions/`. Caller may pass extra dirs (used by tests).
pub fn default_scan_dirs(extra: &[PathBuf]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Ok(raw) = env::var("WISE_EXTENSIONS_PATH") {
        for p in env::split_paths(&raw) {
            out.push(p);
        }
    }
    if let Some(home) = dirs::home_dir() {
        out.push(home.join(".wise").join("extensions"));
    }
    for p in extra {
        out.push(p.clone());
    }
    // Dedupe while preserving order.
    let mut seen = std::collections::HashSet::new();
    out.retain(|p| seen.insert(p.clone()));
    out
}

/// Scan all configured directories. Dedupe by manifest name (first source
/// wins). Errors per dir are recorded but do not abort the whole scan.
pub fn scan_all(extra: &[PathBuf]) -> LoadOutcome {
    let dirs = default_scan_dirs(extra);
    let mut outcome = LoadOutcome::default();
    let mut seen_names = std::collections::HashSet::new();

    for dir in dirs {
        if !dir.exists() {
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let ext_dir = entry.path();
            if !ext_dir.is_dir() {
                continue;
            }
            match load_one(&ext_dir) {
                Ok(loaded) => {
                    if seen_names.insert(loaded.manifest.name.clone()) {
                        outcome.loaded.push(loaded);
                    }
                }
                Err(LoadError::Io(_)) => {
                    // Missing manifest file in a non-extension subdir is silent.
                }
                Err(e) => {
                    outcome.errors.insert(ext_dir, e.to_string());
                }
            }
        }
    }
    outcome
}

pub fn load_one(ext_dir: &Path) -> Result<LoadedExtension, LoadError> {
    let manifest_path = ext_dir.join(MANIFEST_FILE);
    if !manifest_path.exists() {
        return Err(LoadError::Io(format!(
            "{} not found",
            manifest_path.display()
        )));
    }
    let raw = fs::read_to_string(&manifest_path).map_err(|e| LoadError::Io(e.to_string()))?;
    let stripped = strip_line_comments(&raw);
    let mut value: Value =
        serde_json::from_str(&stripped).map_err(|e| LoadError::Parse(e.to_string()))?;
    resolve_file_refs(&mut value, ext_dir, 0).map_err(LoadError::Parse)?;
    let manifest: ExtensionManifest =
        serde_json::from_value(value).map_err(|e| LoadError::Parse(e.to_string()))?;
    manifest
        .validate(ext_dir)
        .map_err(|e| LoadError::Validation(e.to_string()))?;
    Ok(LoadedExtension {
        dir: ext_dir.to_path_buf(),
        manifest_path,
        manifest,
    })
}

/// Strip `// …` line comments from a JSON-with-comments file. Naive: skips
/// `//` only when it appears outside any string. Block comments not supported.
fn strip_line_comments(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_string = false;
    let mut escape = false;
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            if escape {
                escape = false;
            } else if c == '\\' {
                escape = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        if c == '"' {
            in_string = true;
            out.push(c);
            continue;
        }
        if c == '/' && chars.peek() == Some(&'/') {
            // Skip until newline.
            for nc in chars.by_ref() {
                if nc == '\n' {
                    out.push('\n');
                    break;
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// Recursively replace string values of the form `$file:relative/path` with
/// the parsed JSON value at `<ext_dir>/relative/path`. Bounded to
/// `MAX_FILE_INDIRECTION_DEPTH` to prevent cycles.
fn resolve_file_refs(value: &mut Value, ext_dir: &Path, depth: u8) -> Result<(), String> {
    if depth >= MAX_FILE_INDIRECTION_DEPTH {
        // Don't recurse further; leave any remaining `$file:` strings as-is.
        return Ok(());
    }
    match value {
        Value::String(s) => {
            if let Some(rel) = s.strip_prefix("$file:") {
                let rel = rel.trim();
                let path = ext_dir.join(rel);
                let canonical_ext = ext_dir
                    .canonicalize()
                    .map_err(|e| format!("ext_dir canonicalize: {e}"))?;
                let canonical_path = path
                    .canonicalize()
                    .map_err(|e| format!("$file '{rel}' missing: {e}"))?;
                if !canonical_path.starts_with(&canonical_ext) {
                    return Err(format!("$file '{rel}' resolves outside extension dir"));
                }
                let raw = fs::read_to_string(&canonical_path)
                    .map_err(|e| format!("$file '{rel}' read: {e}"))?;
                let stripped = strip_line_comments(&raw);
                let mut sub: Value = serde_json::from_str(&stripped)
                    .map_err(|e| format!("$file '{rel}' parse: {e}"))?;
                resolve_file_refs(&mut sub, ext_dir, depth + 1)?;
                *value = sub;
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                resolve_file_refs(v, ext_dir, depth)?;
            }
        }
        Value::Object(map) => {
            for (_, v) in map.iter_mut() {
                resolve_file_refs(v, ext_dir, depth)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn write_minimal_manifest(ext_dir: &Path, name: &str) {
        write(&ext_dir.join("skill.md"), "# hello");
        let manifest = format!(
            r#"{{
  "name": "{name}",
  "version": "0.1.0",
  "apiVersion": "1",
  "engines": {{ "wise": "*" }},
  "description": "demo",
  "contributes": {{
    "skills": [{{ "name": "hi", "description": "hi", "file": "skill.md" }}]
  }}
}}"#
        );
        write(&ext_dir.join("wise-extension.json"), &manifest);
    }

    #[test]
    fn strip_line_comments_preserves_strings() {
        let input = r#"{ "url": "https://x", "x": 1 // tail
}"#;
        let out = strip_line_comments(input);
        assert!(out.contains("https://x"));
        assert!(!out.contains("// tail"));
    }

    #[test]
    fn dedupes_across_two_dirs_first_wins() {
        let outer = tempdir().unwrap();
        let dir_a = outer.path().join("a");
        let dir_b = outer.path().join("b");
        let ext_a = dir_a.join("hello-world");
        let ext_b = dir_b.join("hello-world");
        fs::create_dir_all(&ext_a).unwrap();
        fs::create_dir_all(&ext_b).unwrap();
        write_minimal_manifest(&ext_a, "hello-world");
        write_minimal_manifest(&ext_b, "hello-world");

        std::env::set_var(
            "WISE_EXTENSIONS_PATH",
            std::env::join_paths([&dir_a, &dir_b]).unwrap(),
        );
        let outcome = scan_all(&[]);
        std::env::remove_var("WISE_EXTENSIONS_PATH");
        let names: Vec<_> = outcome.loaded.iter().map(|l| l.manifest.name.clone()).collect();
        let count = names.iter().filter(|n| n.as_str() == "hello-world").count();
        assert_eq!(count, 1);
    }

    #[test]
    fn file_indirection_resolves() {
        let dir = tempdir().unwrap();
        let ext_dir = dir.path().join("ext");
        fs::create_dir_all(&ext_dir).unwrap();
        write(&ext_dir.join("skill.md"), "# hi");
        write(
            &ext_dir.join("contributes/skills.json"),
            r#"[{ "name": "hi", "description": "hi", "file": "skill.md" }]"#,
        );
        let manifest = r#"{
  "name": "indirect-demo",
  "version": "0.1.0",
  "apiVersion": "1",
  "engines": { "wise": "*" },
  "description": "demo",
  "contributes": { "skills": "$file:contributes/skills.json" }
}"#;
        write(&ext_dir.join("wise-extension.json"), manifest);
        let loaded = load_one(&ext_dir).expect("manifest must load");
        assert_eq!(loaded.manifest.contributes.skills.len(), 1);
        assert_eq!(loaded.manifest.contributes.skills[0].name, "hi");
    }

    #[test]
    fn missing_scan_dir_is_silent() {
        std::env::set_var("WISE_EXTENSIONS_PATH", "/no/such/path/wise-test-xyz");
        let outcome = scan_all(&[]);
        std::env::remove_var("WISE_EXTENSIONS_PATH");
        assert!(outcome.errors.is_empty());
    }

    #[test]
    fn missing_manifest_in_subdir_is_silent() {
        let outer = tempdir().unwrap();
        let scan = outer.path().join("scan");
        fs::create_dir_all(scan.join("not-an-extension")).unwrap();
        let outcome = scan_all(&[scan]);
        assert!(outcome.errors.is_empty());
        assert!(outcome.loaded.is_empty());
    }
}
