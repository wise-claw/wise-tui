//! Code Review product surface — collect reviewable git diffs and persist runs under `~/.wise/code-reviews/`.

use crate::wise_paths::{wise_dir, write_file_atomic};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_DIFF_CHARS: usize = 180_000;
const MAX_FILE_PATHS: usize = 200;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeReviewCollectArgs {
    pub repository_path: String,
    /// `uncommitted` | `branch`
    pub scope: String,
    /// Optional base ref for branch scope (e.g. `main`). Empty → auto-detect.
    pub base_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeReviewDiffPayload {
    pub repository_path: String,
    pub scope: String,
    pub base_ref: Option<String>,
    pub head_ref: Option<String>,
    pub branch: Option<String>,
    pub file_paths: Vec<String>,
    pub diff_text: String,
    pub truncated: bool,
    pub empty: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeReviewFinding {
    pub severity: String,
    pub confidence: String,
    pub path: String,
    pub line: Option<u32>,
    pub title: String,
    pub detail: String,
    pub fix: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeReviewRun {
    pub id: String,
    pub repository_path: String,
    pub scope: String,
    pub base_ref: Option<String>,
    pub branch: Option<String>,
    pub created_at_ms: u64,
    pub recommendation: String,
    pub summary: String,
    pub findings: Vec<CodeReviewFinding>,
    pub open_questions: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_fingerprint: Option<String>,
    /// Files included in the reviewed diff (optional; older runs may omit).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub file_paths: Vec<String>,
    /// Per-file patch hashes for true incremental re-reviews.
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub file_fingerprints: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeReviewSaveRunArgs {
    pub run: CodeReviewRun,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeReviewListRunsArgs {
    pub repository_path: String,
    pub limit: Option<usize>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn run_git_stdout(repo: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|e| format!("git {:?} failed to start: {e}", args))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("git {:?} failed", args)
        } else {
            format!("git {:?} failed: {err}", args)
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn try_git_stdout(repo: &str, args: &[&str]) -> Option<String> {
    run_git_stdout(repo, args).ok()
}

fn resolve_repo_path(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("repositoryPath is required".to_string());
    }
    let path = Path::new(trimmed);
    if !path.is_dir() {
        return Err(format!("not a directory: {trimmed}"));
    }
    // Ensure it is a git work tree.
    let _ = run_git_stdout(trimmed, &["rev-parse", "--is-inside-work-tree"])?;
    Ok(trimmed.to_string())
}

fn current_branch(repo: &str) -> Option<String> {
    try_git_stdout(repo, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD")
}

fn ref_exists(repo: &str, reference: &str) -> bool {
    try_git_stdout(repo, &["rev-parse", "--verify", "--quiet", reference]).is_some()
}

fn detect_base_ref(repo: &str, preferred: Option<&str>) -> Option<String> {
    if let Some(p) = preferred.map(str::trim).filter(|s| !s.is_empty()) {
        if ref_exists(repo, p) {
            return Some(p.to_string());
        }
    }
    for candidate in [
        "main",
        "master",
        "origin/main",
        "origin/master",
        "develop",
        "origin/develop",
    ] {
        if ref_exists(repo, candidate) {
            return Some(candidate.to_string());
        }
    }
    None
}

fn truncate_chars(text: &str, max: usize) -> (String, bool) {
    if text.chars().count() <= max {
        return (text.to_string(), false);
    }
    let truncated: String = text.chars().take(max).collect();
    (format!("{truncated}\n\n…[diff truncated for review context]"), true)
}

fn parse_name_only(stdout: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in stdout.lines() {
        let path = line.trim();
        if path.is_empty() {
            continue;
        }
        out.push(path.replace('\\', "/"));
        if out.len() >= MAX_FILE_PATHS {
            break;
        }
    }
    out
}

fn collect_uncommitted(repo: &str) -> Result<CodeReviewDiffPayload, String> {
    let branch = current_branch(repo);
    let tracked = try_git_stdout(repo, &["diff", "--name-only", "HEAD"]).unwrap_or_default();
    let untracked = try_git_stdout(
        repo,
        &["ls-files", "--others", "--exclude-standard"],
    )
    .unwrap_or_default();

    let mut file_paths = parse_name_only(&tracked);
    for path in parse_name_only(&untracked) {
        if !file_paths.iter().any(|p| p == &path) {
            file_paths.push(path);
            if file_paths.len() >= MAX_FILE_PATHS {
                break;
            }
        }
    }

    let mut diff_parts: Vec<String> = Vec::new();
    if let Some(diff) = try_git_stdout(repo, &["diff", "HEAD", "--"]) {
        if !diff.trim().is_empty() {
            diff_parts.push(diff);
        }
    }
    // Untracked files: include path markers only (content may be huge / binary).
    let untracked_paths = parse_name_only(&untracked);
    if !untracked_paths.is_empty() {
        let mut block = String::from("Untracked files:\n");
        for path in &untracked_paths {
            block.push_str(&format!("+ {path}\n"));
        }
        diff_parts.push(block);
    }

    let joined = diff_parts.join("\n");
    let (diff_text, truncated) = truncate_chars(&joined, MAX_DIFF_CHARS);
    let empty = file_paths.is_empty() && diff_text.trim().is_empty();

    Ok(CodeReviewDiffPayload {
        repository_path: repo.to_string(),
        scope: "uncommitted".to_string(),
        base_ref: Some("HEAD".to_string()),
        head_ref: Some("WORKTREE".to_string()),
        branch,
        file_paths,
        diff_text,
        truncated,
        empty,
    })
}

fn collect_branch(repo: &str, preferred_base: Option<&str>) -> Result<CodeReviewDiffPayload, String> {
    let branch = current_branch(repo);
    let base = detect_base_ref(repo, preferred_base)
        .ok_or_else(|| "无法自动检测 base 分支（main/master）".to_string())?;

    let merge_base = run_git_stdout(repo, &["merge-base", &base, "HEAD"])?
        .trim()
        .to_string();
    if merge_base.is_empty() {
        return Err(format!("merge-base empty for {base}...HEAD"));
    }

    // Working tree vs merge-base: committed branch changes + dirty worktree.
    let name_only = try_git_stdout(repo, &["diff", "--name-only", &merge_base]).unwrap_or_default();
    let mut file_paths = parse_name_only(&name_only);
    let untracked = try_git_stdout(
        repo,
        &["ls-files", "--others", "--exclude-standard"],
    )
    .unwrap_or_default();
    for path in parse_name_only(&untracked) {
        if !file_paths.iter().any(|p| p == &path) {
            file_paths.push(path);
            if file_paths.len() >= MAX_FILE_PATHS {
                break;
            }
        }
    }

    let mut diff_parts: Vec<String> = Vec::new();
    if let Some(diff) = try_git_stdout(repo, &["diff", &merge_base, "--"]) {
        if !diff.trim().is_empty() {
            diff_parts.push(diff);
        }
    }
    let untracked_paths = parse_name_only(&untracked);
    if !untracked_paths.is_empty() {
        let mut block = String::from("Untracked files:\n");
        for path in &untracked_paths {
            block.push_str(&format!("+ {path}\n"));
        }
        diff_parts.push(block);
    }

    let joined = diff_parts.join("\n");
    let (diff_text, truncated) = truncate_chars(&joined, MAX_DIFF_CHARS);
    let empty = file_paths.is_empty() && diff_text.trim().is_empty();

    Ok(CodeReviewDiffPayload {
        repository_path: repo.to_string(),
        scope: "branch".to_string(),
        base_ref: Some(base),
        head_ref: Some(merge_base),
        branch,
        file_paths,
        diff_text,
        truncated,
        empty,
    })
}

fn reviews_dir_for_repo(repo: &str) -> Result<PathBuf, String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    repo.hash(&mut hasher);
    let key = format!("{:016x}", hasher.finish());
    let dir = wise_dir()?.join("code-reviews").join(key);
    fs::create_dir_all(&dir).map_err(|e| format!("create code-reviews dir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub(crate) async fn code_review_collect_diff(
    args: CodeReviewCollectArgs,
) -> Result<CodeReviewDiffPayload, String> {
    let repo = resolve_repo_path(&args.repository_path)?;
    let scope = args.scope.trim().to_lowercase();
    tokio::task::spawn_blocking(move || match scope.as_str() {
        "uncommitted" => collect_uncommitted(&repo),
        "branch" => collect_branch(&repo, args.base_ref.as_deref()),
        other => Err(format!("unsupported scope: {other}")),
    })
    .await
    .map_err(|e| format!("code_review_collect_diff task: {e}"))?
}

#[tauri::command]
pub(crate) fn code_review_save_run(args: CodeReviewSaveRunArgs) -> Result<CodeReviewRun, String> {
    let mut run = args.run;
    if run.id.trim().is_empty() {
        run.id = format!("cr-{}", now_ms());
    }
    if run.created_at_ms == 0 {
        run.created_at_ms = now_ms();
    }
    let repo = resolve_repo_path(&run.repository_path)?;
    run.repository_path = repo.clone();
    let dir = reviews_dir_for_repo(&repo)?;
    let path = dir.join(format!("{}.json", run.id));
    let json = serde_json::to_string_pretty(&run).map_err(|e| e.to_string())?;
    write_file_atomic(&path, &json)?;
    Ok(run)
}

#[tauri::command]
pub(crate) fn code_review_list_runs(
    args: CodeReviewListRunsArgs,
) -> Result<Vec<CodeReviewRun>, String> {
    let repo = resolve_repo_path(&args.repository_path)?;
    let dir = reviews_dir_for_repo(&repo)?;
    let limit = args.limit.unwrap_or(20).clamp(1, 100);
    let mut entries: Vec<(u64, PathBuf)> = Vec::new();
    if let Ok(read) = fs::read_dir(&dir) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let modified = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            entries.push((modified, path));
        }
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    let mut runs = Vec::new();
    for (_, path) in entries.into_iter().take(limit) {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        match serde_json::from_str::<CodeReviewRun>(&raw) {
            Ok(run) => runs.push(run),
            Err(_) => continue,
        }
    }
    Ok(runs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_chars_marks_overflow() {
        let (text, truncated) = truncate_chars("abcdef", 3);
        assert!(truncated);
        assert!(text.contains("truncated"));
    }

    #[test]
    fn parse_name_only_normalizes_slashes() {
        let paths = parse_name_only("a\\b.ts\n\nc/d.ts\n");
        assert_eq!(paths, vec!["a/b.ts".to_string(), "c/d.ts".to_string()]);
    }
}
