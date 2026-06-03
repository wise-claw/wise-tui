use crate::project_workspace_paths::{canonicalize_existing_dir, validate_repository_folder_name};
use git2::build::CheckoutBuilder;
use git2::{BranchType, DiffOptions, Oid, Repository, Status, StatusOptions};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// 在后台线程执行 Git 阻塞操作，避免 `git push` / `commit` 等卡住 WebView 主线程。
async fn run_git_blocking<T, F>(label: &'static str, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("{label} 任务异常: {e}"))?
}

#[derive(Serialize, Clone)]
pub(crate) struct GitFileStatus {
    path: String,
    status: String,
    additions: usize,
    deletions: usize,
}

#[derive(Serialize, Clone)]
pub(crate) struct GitStatusResponse {
    staged: Vec<GitFileStatus>,
    unstaged: Vec<GitFileStatus>,
    branch: Option<String>,
    additions: usize,
    deletions: usize,
    ahead: usize,
    behind: usize,
    upstream: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatusSummaryResponse {
    branch: Option<String>,
    additions: usize,
    deletions: usize,
    ahead: usize,
    behind: usize,
    staged_count: usize,
    unstaged_count: usize,
}

#[derive(Serialize, Clone)]
pub(crate) struct GitLogEntry {
    sha: String,
    summary: String,
    author: String,
    timestamp: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitLogResponse {
    total: usize,
    entries: Vec<GitLogEntry>,
    ahead: usize,
    behind: usize,
    upstream: Option<String>,
    has_more: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitBranchEntry {
    name: String,
    is_remote: bool,
    is_current: bool,
    last_commit_timestamp: Option<i64>,
    last_commit_summary: Option<String>,
    author: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitWorktreeEntry {
    path: String,
    head: Option<String>,
    branch: Option<String>,
    is_primary: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitWorktreeAddOmcBatchResult {
    repo_root: String,
    worktree_path: String,
    branch_name: String,
}

fn open_repo(path: &str) -> Result<Repository, String> {
    Repository::open(path).map_err(|e| format!("Failed to open git repo: {}", e))
}

fn git_cli_combined_output(stdout: &[u8], stderr: &[u8]) -> String {
    let out = String::from_utf8_lossy(stdout).trim().to_string();
    let err = String::from_utf8_lossy(stderr).trim().to_string();
    if out.is_empty() {
        err
    } else if err.is_empty() {
        out
    } else {
        format!("{out}\n{err}")
    }
}

/// Git 偶发 exit 0 但输出含 rejected / fatal 等失败信号（钩子、托管平台文案）。
fn git_cli_output_indicates_failure(text: &str) -> bool {
    let lower = text.to_lowercase();
    const MARKERS: &[&str] = &[
        "[rejected]",
        "[remote rejected]",
        "! [rejected]",
        "error: failed to push",
        "error: failed to pull",
        "pre-receive hook declined",
        "remote: error",
        "push declined",
        "gh001",
        "fatal:",
    ];
    MARKERS.iter().any(|marker| lower.contains(marker))
}

fn run_git_command(path: &str, args: &[&str], action: &str) -> Result<(), String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .map_err(|e| format!("{} failed to start: {}", action, e))?;

    let detail = git_cli_combined_output(&output.stdout, &output.stderr);

    if output.status.success() {
        if git_cli_output_indicates_failure(&detail) {
            return Err(if detail.is_empty() {
                format!("{action} failed: remote rejected the update")
            } else {
                format!("{action} failed: {detail}")
            });
        }
        return Ok(());
    }

    if detail.is_empty() {
        Err(format!(
            "{} failed with exit code {}",
            action, output.status
        ))
    } else {
        Err(format!("{} failed: {}", action, detail))
    }
}

fn branch_has_upstream(repo: &Repository) -> bool {
    let Ok(head) = repo.head() else {
        return false;
    };
    if !head.is_branch() {
        return false;
    }
    git2::Branch::wrap(head).upstream().is_ok()
}

/// `refs/remotes/origin/feature/foo` → (`origin`, `feature/foo`)
fn parse_remote_tracking_ref(full_name: &str) -> Option<(String, String)> {
    let rest = full_name.strip_prefix("refs/remotes/")?;
    let (remote, branch) = rest.split_once('/')?;
    if remote.is_empty() || branch.is_empty() {
        return None;
    }
    Some((remote.to_string(), branch.to_string()))
}

fn tracking_remote_and_short_branch(repo: &Repository) -> Option<(String, String)> {
    let head = repo.head().ok()?;
    if !head.is_branch() {
        return None;
    }
    let upstream = git2::Branch::wrap(head).upstream().ok()?;
    let full = upstream.get().name()?;
    parse_remote_tracking_ref(full)
}

/// 本地分支名与 upstream 不一致时，plain `git push` 会失败；推送到已配置的上游分支。
fn build_push_git_args(
    had_upstream: bool,
    local_branch: &str,
    tracking: Option<&(String, String)>,
) -> Vec<String> {
    if !had_upstream {
        return vec![
            "push".to_string(),
            "-u".to_string(),
            "origin".to_string(),
            local_branch.to_string(),
        ];
    }
    match tracking {
        Some((remote, upstream_branch)) if upstream_branch != local_branch => {
            vec![
                "push".to_string(),
                remote.clone(),
                format!("HEAD:{upstream_branch}"),
            ]
        }
        _ => vec!["push".to_string()],
    }
}

fn verify_head_on_remote(
    repo: &Repository,
    remote: &str,
    branch: &str,
    expected: Oid,
) -> Result<(), String> {
    let remote_ref = format!("refs/remotes/{remote}/{branch}");
    let remote_oid = repo.refname_to_id(&remote_ref).map_err(|_| {
        format!("推送后未在远程找到分支 {remote}/{branch}，请检查 remote 配置与权限")
    })?;
    if remote_oid != expected {
        return Err(format!(
            "推送未生效：本地提交 {} 与 {remote}/{branch} ({}) 不一致",
            &expected.to_string()[..7.min(expected.to_string().len())],
            &remote_oid.to_string()[..7.min(remote_oid.to_string().len())]
        ));
    }
    Ok(())
}

fn git_rev_parse_show_toplevel(repo_any_path: &str) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_any_path)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| format!("git rev-parse --show-toplevel failed to start: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "git rev-parse --show-toplevel failed".to_string()
        } else {
            format!("git rev-parse --show-toplevel: {}", stderr)
        });
    }
    let top = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if top.is_empty() {
        return Err("git rev-parse --show-toplevel returned empty".to_string());
    }
    Ok(top)
}

fn fnv1a_hash64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 14695981039346656037;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(1099511628211);
    }
    h
}

/// Derives the fixed 10-digit hexadecimal worktree slug from `task_id` + `attempt`.
fn omc_batch_worktree_slug_hex(task_id: &str, attempt: i64) -> String {
    let mut h = fnv1a_hash64(task_id.as_bytes());
    h ^= fnv1a_hash64(&attempt.to_le_bytes());
    h = h.rotate_left(13).wrapping_mul(1099511628211);
    h ^= h >> 33;
    format!("{:010x}", h & 0xffff_ffffff)
}

pub(crate) fn get_git_branch(path: &str) -> Option<String> {
    match Repository::open(path) {
        Ok(repo) => {
            let head = repo.head().ok()?;
            if head.is_branch() {
                head.shorthand().map(|s| s.to_string())
            } else {
                head.target()
                    .map(|oid| format!("({})", &oid.to_string()[..7]))
            }
        }
        Err(_) => None,
    }
}

fn status_char_to_str(status: Status) -> String {
    if status.is_index_new() {
        "A".into()
    } else if status.is_index_modified() {
        "M".into()
    } else if status.is_index_deleted() {
        "D".into()
    } else if status.is_index_renamed() {
        "R".into()
    } else if status.is_index_typechange() {
        "T".into()
    } else if status.is_wt_new() {
        "A".into()
    } else if status.is_wt_modified() {
        "M".into()
    } else if status.is_wt_deleted() {
        "D".into()
    } else if status.is_wt_renamed() {
        "R".into()
    } else if status.is_wt_typechange() {
        "T".into()
    } else {
        "?".into()
    }
}

fn count_commits_between(repo: &Repository, from: git2::Oid, to: git2::Oid) -> usize {
    let mut count = 0;
    if let Ok(mut revwalk) = repo.revwalk() {
        let _ = revwalk.push(to);
        let _ = revwalk.hide(from);
        count = revwalk.count();
    }
    count
}

fn compute_ahead_behind(repo: &Repository) -> Result<(usize, usize, Option<String>), String> {
    let head = repo.head().map_err(|e| e.to_string())?;
    let head_oid = head.target().ok_or("HEAD has no target")?;

    if !head.is_branch() {
        return Ok((0, 0, None));
    }

    let branch = git2::Branch::wrap(head);
    let upstream = match branch.upstream() {
        Ok(u) => u,
        Err(_) => return Ok((0, 0, None)),
    };

    let upstream_ref = upstream
        .get()
        .name()
        .ok_or_else(|| "upstream branch name is not valid UTF-8".to_string())?;

    let upstream_short = upstream_ref
        .strip_prefix("refs/remotes/")
        .unwrap_or(upstream_ref)
        .to_string();

    let upstream_oid = repo
        .refname_to_id(upstream_ref)
        .map_err(|e| e.to_string())?;

    let ahead = count_commits_between(repo, upstream_oid, head_oid);
    let behind = count_commits_between(repo, head_oid, upstream_oid);

    Ok((ahead, behind, Some(upstream_short)))
}

#[tauri::command]
pub(crate) fn git_status(path: String) -> Result<GitStatusResponse, String> {
    let repo = open_repo(&path)?;
    let branch = get_git_branch(&path);

    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    opts.include_ignored(false);
    opts.recurse_untracked_dirs(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get status: {}", e))?;

    let file_count = statuses
        .iter()
        .filter(|entry| !entry.path().unwrap_or("").is_empty())
        .count();
    let skip_per_file_stats = file_count > GIT_STATUS_PER_FILE_STATS_LIMIT;

    let mut staged: Vec<GitFileStatus> = Vec::new();
    let mut unstaged: Vec<GitFileStatus> = Vec::new();

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    let (staged_line_stats, unstaged_line_stats) = if skip_per_file_stats {
        (HashMap::new(), HashMap::new())
    } else {
        (
            collect_staged_line_stats(&repo, head_tree.as_ref()),
            collect_unstaged_line_stats(&repo),
        )
    };

    for entry in statuses.iter() {
        let status = entry.status();
        let file_path = entry.path().unwrap_or("").to_string();
        if file_path.is_empty() {
            continue;
        }
        let status_str = status_char_to_str(status);

        let is_index = status.is_index_new()
            || status.is_index_modified()
            || status.is_index_deleted()
            || status.is_index_renamed()
            || status.is_index_typechange();
        let is_wt = status.is_wt_new()
            || status.is_wt_modified()
            || status.is_wt_deleted()
            || status.is_wt_renamed()
            || status.is_wt_typechange();

        let file_status = GitFileStatus {
            path: file_path.clone(),
            status: status_str,
            additions: 0,
            deletions: 0,
        };

        if is_index {
            let (adds, dels) = staged_line_stats.get(&file_path).copied().unwrap_or((0, 0));
            let file_status = GitFileStatus {
                additions: adds,
                deletions: dels,
                ..file_status
            };
            if is_wt {
                let (wt_adds, wt_dels) = unstaged_line_stats
                    .get(&file_path)
                    .copied()
                    .unwrap_or((0, 0));
                unstaged.push(GitFileStatus {
                    additions: wt_adds,
                    deletions: wt_dels,
                    ..file_status.clone()
                });
            }
            staged.push(file_status);
        } else {
            let (adds, dels) = unstaged_line_stats
                .get(&file_path)
                .copied()
                .unwrap_or_else(|| {
                    if !skip_per_file_stats && status.is_wt_new() {
                        count_file_lines_for_untracked(&path, &file_path)
                    } else {
                        (0, 0)
                    }
                });
            unstaged.push(GitFileStatus {
                additions: adds,
                deletions: dels,
                ..file_status
            });
        }
    }

    let (total_additions, total_deletions) = if skip_per_file_stats {
        collect_aggregate_line_totals(&repo, &path, head_tree.as_ref())
    } else {
        (
            staged.iter().map(|f| f.additions).sum::<usize>()
                + unstaged.iter().map(|f| f.additions).sum::<usize>(),
            staged.iter().map(|f| f.deletions).sum::<usize>()
                + unstaged.iter().map(|f| f.deletions).sum::<usize>(),
        )
    };

    let (ahead, behind, upstream) = compute_ahead_behind(&repo).unwrap_or((0, 0, None));

    Ok(GitStatusResponse {
        staged,
        unstaged,
        branch,
        additions: total_additions,
        deletions: total_deletions,
        ahead,
        behind,
        upstream,
    })
}

#[tauri::command]
pub(crate) fn git_status_summary(path: String) -> Result<GitStatusSummaryResponse, String> {
    let repo = open_repo(&path)?;
    let branch = get_git_branch(&path);

    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    opts.include_ignored(false);
    opts.recurse_untracked_dirs(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get status: {}", e))?;

    let mut staged_count = 0usize;
    let mut unstaged_count = 0usize;

    for entry in statuses.iter() {
        let status = entry.status();
        if entry.path().unwrap_or("").is_empty() {
            continue;
        }

        let is_index = status.is_index_new()
            || status.is_index_modified()
            || status.is_index_deleted()
            || status.is_index_renamed()
            || status.is_index_typechange();
        let is_wt = status.is_wt_new()
            || status.is_wt_modified()
            || status.is_wt_deleted()
            || status.is_wt_renamed()
            || status.is_wt_typechange();

        if is_index {
            staged_count += 1;
        }
        if is_wt {
            unstaged_count += 1;
        }
    }

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let (additions, deletions) = collect_aggregate_line_totals(&repo, &path, head_tree.as_ref());
    let (ahead, behind, _upstream) = compute_ahead_behind(&repo).unwrap_or((0, 0, None));

    Ok(GitStatusSummaryResponse {
        branch,
        additions,
        deletions,
        ahead,
        behind,
        staged_count,
        unstaged_count,
    })
}

fn collect_staged_line_stats(
    repo: &Repository,
    head_tree: Option<&git2::Tree<'_>>,
) -> HashMap<String, (usize, usize)> {
    let Some(tree) = head_tree else {
        return HashMap::new();
    };
    let Ok(diff) = repo.diff_tree_to_index(Some(tree), None, None) else {
        return HashMap::new();
    };
    collect_line_stats_from_diff(&diff)
}

fn collect_unstaged_line_stats(repo: &Repository) -> HashMap<String, (usize, usize)> {
    let mut opts = DiffOptions::new();
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);
    let Ok(diff) = repo.diff_index_to_workdir(None, Some(&mut opts)) else {
        return HashMap::new();
    };
    collect_line_stats_from_diff(&diff)
}

/// 变更文件过多时跳过逐文件行统计（避免对数十万行做 HashMap 插入）。
const GIT_STATUS_PER_FILE_STATS_LIMIT: usize = 400;

fn diff_stats_totals(diff: &git2::Diff<'_>) -> (usize, usize) {
    diff.stats()
        .map(|stats| (stats.insertions(), stats.deletions()))
        .unwrap_or((0, 0))
}

/// 纯未跟踪文件（工作区新增、尚未 `git add`）的行数。
/// libgit2 `diff_index_to_workdir` 的 `stats()` 不会计入这类文件，需与 `git_status` 逐文件逻辑对齐。
const GIT_STATUS_UNTRACKED_LINE_COUNT_LIMIT: usize = 80;

fn collect_pure_untracked_line_totals(repo: &Repository, repo_path: &str) -> (usize, usize) {
    let mut adds = 0usize;
    let mut dels = 0usize;
    let mut counted = 0usize;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    opts.include_ignored(false);
    opts.recurse_untracked_dirs(true);
    let Ok(statuses) = repo.statuses(Some(&mut opts)) else {
        return (0, 0);
    };
    for entry in statuses.iter() {
        if counted >= GIT_STATUS_UNTRACKED_LINE_COUNT_LIMIT {
            break;
        }
        let status = entry.status();
        let file_path = entry.path().unwrap_or("");
        if file_path.is_empty() {
            continue;
        }
        if status.is_wt_new() && !status.is_index_new() {
            counted += 1;
            let (a, d) = count_file_lines_for_untracked(repo_path, file_path);
            adds += a;
            dels += d;
        }
    }
    (adds, dels)
}

fn collect_aggregate_line_totals(
    repo: &Repository,
    repo_path: &str,
    head_tree: Option<&git2::Tree<'_>>,
) -> (usize, usize) {
    let mut adds = 0usize;
    let mut dels = 0usize;
    if let Some(tree) = head_tree {
        if let Ok(diff) = repo.diff_tree_to_index(Some(tree), None, None) {
            let (a, d) = diff_stats_totals(&diff);
            adds += a;
            dels += d;
        }
    }
    let mut opts = DiffOptions::new();
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);
    if let Ok(diff) = repo.diff_index_to_workdir(None, Some(&mut opts)) {
        let (a, d) = diff_stats_totals(&diff);
        adds += a;
        dels += d;
    }
    let (ut_adds, ut_dels) = collect_pure_untracked_line_totals(repo, repo_path);
    adds += ut_adds;
    dels += ut_dels;
    (adds, dels)
}

fn collect_line_stats_from_diff(diff: &git2::Diff<'_>) -> HashMap<String, (usize, usize)> {
    let mut map: HashMap<String, (usize, usize)> = HashMap::new();
    let _ = diff.foreach(
        &mut |_delta, _| true,
        None,
        None,
        Some(&mut |delta, _hunk, line| {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            if path.is_empty() {
                return true;
            }
            let entry = map.entry(path).or_insert((0, 0));
            match line.origin() {
                '+' => entry.0 += 1,
                '-' => entry.1 += 1,
                _ => {}
            }
            true
        }),
    );
    map
}

fn count_file_lines_for_untracked(repo_path: &str, rel_path: &str) -> (usize, usize) {
    let full_path = Path::new(repo_path).join(rel_path);
    let Ok(content) = fs::read_to_string(full_path) else {
        return (0, 0);
    };
    (content.lines().count(), 0)
}

/// 将相对路径转为 libgit2 pathspec：目录用 `dir/**` 一次匹配子树，单文件用精确路径。
fn normalize_stage_pathspec(repo_path: &str, rel_path: &str) -> String {
    let rel = rel_path.trim();
    if rel.is_empty() || rel == "." {
        return ".".to_string();
    }
    let rel = rel.trim_end_matches('/');
    let full = Path::new(repo_path).join(rel);
    if full.is_dir() {
        return format!("{rel}/**");
    }
    rel.to_string()
}

#[tauri::command]
pub(crate) fn git_stage(path: String, file_path: String) -> Result<(), String> {
    let spec = normalize_stage_pathspec(&path, &file_path);
    git_stage_paths_inner(&path, &[spec.as_str()])
}

/// 按多个 pathspec 一次性暂存（目录项会展开为 `dir/**`），单次 IPC。
#[tauri::command]
pub(crate) fn git_stage_paths(path: String, file_paths: Vec<String>) -> Result<(), String> {
    if file_paths.is_empty() {
        return Ok(());
    }
    let mut specs: Vec<String> = file_paths
        .iter()
        .map(|p| normalize_stage_pathspec(&path, p))
        .collect();
    specs.sort();
    specs.dedup();
    let refs: Vec<&str> = specs.iter().map(|s| s.as_str()).collect();
    git_stage_paths_inner(&path, &refs)
}

/// 一次性暂存工作区全部变更（等价于仓库根目录 `git add .`），避免逐文件 IPC。
#[tauri::command]
pub(crate) async fn git_stage_all(path: String) -> Result<(), String> {
    run_git_blocking("git_stage_all", move || git_stage_all_blocking(path)).await
}

fn git_stage_all_blocking(path: String) -> Result<(), String> {
    git_stage_paths_inner(&path, &["."])
}

fn git_stage_paths_inner(path: &str, pathspecs: &[&str]) -> Result<(), String> {
    let repo = open_repo(path)?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_all(pathspecs, git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn git_unstage(path: String, file_path: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let target = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.into_object());
    repo.reset_default(target.as_ref(), [&file_path])
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn git_unstage_all(path: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let head = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.into_object())
        .ok_or_else(|| "No commits in repository, nothing to unstage".to_string())?;
    repo.reset(&head, git2::ResetType::Mixed, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn git_commit(path: String, message: String) -> Result<String, String> {
    run_git_blocking("git_commit", move || git_commit_blocking(path, message)).await
}

fn git_commit_blocking(path: String, message: String) -> Result<String, String> {
    let repo = open_repo(&path)?;
    let sig = repo
        .signature()
        .or_else(|_| git2::Signature::now("Wise User", "wise@local"))
        .map_err(|e| e.to_string())?;

    let tree_id = repo
        .index()
        .map_err(|e| e.to_string())?
        .write_tree()
        .map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    let head = repo.head().map_err(|e| e.to_string())?;
    let parent = head.peel_to_commit().map_err(|e| e.to_string())?;

    let commit_oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &[&parent])
        .map_err(|e| e.to_string())?;

    Ok(commit_oid.to_string())
}

#[tauri::command]
pub(crate) async fn git_push(path: String) -> Result<(), String> {
    run_git_blocking("git_push", move || git_push_blocking(path)).await
}

fn git_push_blocking(path: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let head = repo.head().map_err(|e| e.to_string())?;
    if !head.is_branch() {
        return Err("无法在 detached HEAD 状态下推送，请先切换到分支".to_string());
    }
    let branch_name = head
        .shorthand()
        .ok_or_else(|| "无法解析当前分支名".to_string())?
        .to_string();
    let head_oid = head.target().ok_or_else(|| "HEAD 无有效提交".to_string())?;

    let had_upstream = branch_has_upstream(&repo);
    let (verify_remote, verify_branch) = tracking_remote_and_short_branch(&repo).unwrap_or_else(|| {
        ("origin".to_string(), branch_name.clone())
    });

    let tracking = tracking_remote_and_short_branch(&repo);
    let push_args = build_push_git_args(had_upstream, &branch_name, tracking.as_ref());
    let push_arg_refs: Vec<&str> = push_args.iter().map(String::as_str).collect();
    run_git_command(&path, &push_arg_refs, "Push")?;

    let _ = run_git_command(
        &path,
        &["fetch", verify_remote.as_str(), verify_branch.as_str()],
        "Fetch",
    );

    let repo = open_repo(&path)?;
    verify_head_on_remote(&repo, &verify_remote, &verify_branch, head_oid)
}

#[tauri::command]
pub(crate) async fn git_pull(path: String) -> Result<(), String> {
    run_git_blocking("git_pull", move || git_pull_blocking(path)).await
}

fn git_pull_blocking(path: String) -> Result<(), String> {
    open_repo(&path)?;
    run_git_command(&path, &["pull", "--no-rebase"], "Pull")
}

#[tauri::command]
pub(crate) fn git_fetch(path: String) -> Result<(), String> {
    open_repo(&path)?;
    run_git_command(&path, &["fetch", "--all", "--prune"], "Fetch")
}

#[tauri::command]
pub(crate) fn git_discard(path: String, file_path: String) -> Result<(), String> {
    open_repo(&path)?;
    let restore = Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["restore", "--worktree", "--", &file_path])
        .output()
        .map_err(|e| format!("Discard failed to start: {}", e))?;
    if !restore.status.success() {
        let stderr = String::from_utf8_lossy(&restore.stderr);
        let s = stderr.to_lowercase();
        if !s.contains("did not match any file")
            && !s.contains("did not match any files")
            && !stderr.contains("未匹配")
        {
            return Err(format!("Discard failed: {}", stderr.trim()));
        }
    }
    run_git_command(
        &path,
        &["clean", "-fd", "--", &file_path],
        "Discard (clean)",
    )
}

#[tauri::command]
pub(crate) fn git_discard_all(path: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let mut checkout_opts = CheckoutBuilder::new();
    checkout_opts.force();
    repo.checkout_index(None, Some(&mut checkout_opts))
        .map_err(|e| format!("Failed to discard changes: {}", e))?;
    let mut remove_opts = git2::build::CheckoutBuilder::new();
    remove_opts.remove_untracked(true);
    repo.checkout_head(Some(&mut remove_opts))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn git_show_revision(
    repository_path: String,
    revision_path: String,
) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&repository_path)
        .arg("show")
        .arg(&revision_path)
        .output()
        .map_err(|e| format!("git show failed to start: {}", e))?;

    if output.status.success() {
        return String::from_utf8(output.stdout).map_err(|e| e.to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let lower = stderr.to_lowercase();
    let missing = lower.contains("does not exist")
        || lower.contains("exists on disk, but not in")
        || (lower.contains("pathspec") && lower.contains("did not match"))
        || lower.contains("bad revision")
        || (lower.contains("fatal:")
            && (lower.contains("not a valid object name") || lower.contains("invalid object")));
    if missing {
        return Ok(String::new());
    }
    Err(format!("git show {}: {}", revision_path, stderr.trim()))
}

#[tauri::command]
pub(crate) fn git_log(path: String, limit: usize, skip: usize) -> Result<GitLogResponse, String> {
    let repo = open_repo(&path)?;
    let (ahead, behind, upstream) = compute_ahead_behind(&repo).unwrap_or((0, 0, None));

    let limit = limit.clamp(1, 100);
    let skip = skip.min(usize::MAX / 2);

    let head = repo.head().map_err(|e| e.to_string())?;
    let head_oid = head.target().ok_or("HEAD has no target")?;
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push(head_oid).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    let mut skipped = 0usize;
    let mut has_more = false;
    for oid in revwalk {
        let oid = oid.map_err(|e| e.to_string())?;
        if skipped < skip {
            skipped += 1;
            continue;
        }
        if entries.len() >= limit {
            has_more = true;
            break;
        }
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        entries.push(GitLogEntry {
            sha: oid.to_string(),
            summary: commit.summary().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("Unknown").to_string(),
            timestamp: commit.time().seconds(),
        });
    }

    Ok(GitLogResponse {
        total: entries.len(),
        entries,
        ahead,
        behind,
        upstream,
        has_more,
    })
}

#[tauri::command]
pub(crate) fn git_init(path: String) -> Result<String, String> {
    let repo = Repository::init(&path).map_err(|e| e.to_string())?;
    let sig = repo
        .signature()
        .or_else(|_| git2::Signature::now("Wise User", "wise@local"))
        .map_err(|e| e.to_string())?;
    let empty_tree_id = repo
        .treebuilder(None)
        .map_err(|e| e.to_string())?
        .write()
        .map_err(|e| e.to_string())?;
    let empty_tree = repo.find_tree(empty_tree_id).map_err(|e| e.to_string())?;
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, "Initial commit", &empty_tree, &[])
        .map_err(|e| e.to_string())?;
    Ok(oid.to_string())
}

#[tauri::command]
pub(crate) fn git_remote_url(path: String) -> Result<Option<String>, String> {
    let repo = open_repo(&path)?;
    let result = match repo.find_remote("origin") {
        Ok(remote) => remote.url().map(|s| s.to_string()),
        Err(_) => None,
    };
    Ok(result)
}

#[tauri::command]
pub(crate) fn git_list_branches(path: String) -> Result<Vec<GitBranchEntry>, String> {
    let repo = open_repo(&path)?;
    let mut out: Vec<GitBranchEntry> = Vec::new();

    for branch_type in [BranchType::Local, BranchType::Remote] {
        let iter = repo
            .branches(Some(branch_type))
            .map_err(|e| e.to_string())?;
        for item in iter {
            let (branch, _) = item.map_err(|e| e.to_string())?;
            let Some(name_raw) = branch.name().map_err(|e| e.to_string())? else {
                continue;
            };
            let name = name_raw.trim().to_string();
            if name.is_empty() || name == "HEAD" {
                continue;
            }
            let oid = branch.get().target();
            let (last_commit_timestamp, last_commit_summary, author) = if let Some(target_oid) = oid
            {
                match repo.find_commit(target_oid) {
                    Ok(commit) => (
                        Some(commit.time().seconds()),
                        commit.summary().map(|s| s.to_string()),
                        commit.author().name().map(|s| s.to_string()),
                    ),
                    Err(_) => (None, None, None),
                }
            } else {
                (None, None, None)
            };
            out.push(GitBranchEntry {
                name,
                is_remote: branch_type == BranchType::Remote,
                is_current: branch.is_head(),
                last_commit_timestamp,
                last_commit_summary,
                author,
            });
        }
    }

    out.sort_by(|a, b| {
        let ta = a.last_commit_timestamp.unwrap_or(0);
        let tb = b.last_commit_timestamp.unwrap_or(0);
        tb.cmp(&ta)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(out)
}

#[tauri::command]
pub(crate) fn git_checkout_branch(path: String, branch_name: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let name = branch_name.trim();
    if name.is_empty() {
        return Err("Branch name is empty".to_string());
    }
    if repo.find_branch(name, BranchType::Local).is_ok() {
        return run_git_command(&path, &["checkout", name], "Checkout");
    }
    if repo.find_branch(name, BranchType::Remote).is_ok() {
        return run_git_command(&path, &["checkout", "--track", name], "Checkout");
    }
    Err(format!("Branch not found: {}", name))
}

#[tauri::command]
pub(crate) fn git_create_branch(
    path: String,
    branch_name: String,
    from_ref: Option<String>,
    checkout: Option<bool>,
    no_track: Option<bool>,
) -> Result<(), String> {
    open_repo(&path)?;
    let name = branch_name.trim();
    if name.is_empty() {
        return Err("Branch name is empty".to_string());
    }
    if name.contains(' ') {
        return Err("Branch name cannot contain spaces".to_string());
    }
    let from = from_ref
        .as_ref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty());
    let should_checkout = checkout.unwrap_or(true);
    let should_no_track = no_track.unwrap_or(true);

    if should_checkout {
        let mut args: Vec<&str> = vec!["checkout", "-b", name];
        if should_no_track {
            args.push("--no-track");
        }
        if let Some(from_name) = from {
            args.push(from_name);
        }
        run_git_command(&path, &args, "Create branch")
    } else {
        let mut args: Vec<&str> = vec!["branch"];
        if should_no_track {
            args.push("--no-track");
        }
        args.push(name);
        if let Some(from_name) = from {
            args.push(from_name);
        }
        run_git_command(&path, &args, "Create branch")
    }
}

fn parse_git_worktree_porcelain(
    stdout: &str,
    repo_path: &str,
) -> Result<Vec<GitWorktreeEntry>, String> {
    let repo_canon = fs::canonicalize(Path::new(repo_path))
        .map_err(|e| format!("Invalid repository path: {}", e))?;
    let mut entries: Vec<GitWorktreeEntry> = Vec::new();
    let mut wt_path: Option<String> = None;
    let mut wt_head: Option<String> = None;
    let mut wt_branch: Option<String> = None;

    let mut flush_block =
        |path: &mut Option<String>, head: &mut Option<String>, branch: &mut Option<String>| {
            if let Some(p) = path.take() {
                let is_primary = fs::canonicalize(Path::new(&p))
                    .map(|c| c == repo_canon)
                    .unwrap_or(false);
                entries.push(GitWorktreeEntry {
                    path: p,
                    head: head.take(),
                    branch: branch.take(),
                    is_primary,
                });
            } else {
                head.take();
                branch.take();
            }
        };

    for line in stdout.lines() {
        if line.is_empty() {
            flush_block(&mut wt_path, &mut wt_head, &mut wt_branch);
            continue;
        }
        if let Some(rest) = line.strip_prefix("worktree ") {
            flush_block(&mut wt_path, &mut wt_head, &mut wt_branch);
            wt_path = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("HEAD ") {
            wt_head = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("branch ") {
            wt_branch = Some(rest.trim().to_string());
        }
    }
    flush_block(&mut wt_path, &mut wt_head, &mut wt_branch);
    Ok(entries)
}

fn worktree_request_matches_entry(request: &str, entry_path: &str) -> bool {
    let request = request.trim();
    let entry_path = entry_path.trim();
    if request.is_empty() || entry_path.is_empty() {
        return false;
    }
    if request == entry_path {
        return true;
    }
    let rq = request.replace('\\', "/");
    let eq = entry_path.replace('\\', "/");
    if rq == eq {
        return true;
    }
    matches!(
        (
            fs::canonicalize(Path::new(request)),
            fs::canonicalize(Path::new(entry_path)),
        ),
        (Ok(a), Ok(b)) if a == b
    )
}

fn remove_worktree_directory_if_leftover(
    worktree_disk_path: &str,
    repo_path: &str,
) -> Result<(), String> {
    let wt = Path::new(worktree_disk_path);
    if !wt.exists() {
        return Ok(());
    }
    let repo_canon =
        fs::canonicalize(Path::new(repo_path)).map_err(|e| format!("仓库路径无效: {}", e))?;
    let wt_canon = fs::canonicalize(wt).map_err(|e| format!("无法访问 worktree 目录: {}", e))?;
    if wt_canon == repo_canon {
        return Err("安全限制：不可删除主仓库目录".to_string());
    }
    fs::remove_dir_all(&wt_canon).map_err(|e| format!("删除 worktree 目录失败: {}", e))
}

#[tauri::command]
pub(crate) fn git_worktree_list(path: String) -> Result<Vec<GitWorktreeEntry>, String> {
    open_repo(&path)?;
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| format!("git worktree list failed to start: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            "git worktree list failed".to_string()
        } else {
            format!("git worktree list failed: {}", detail)
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_git_worktree_porcelain(&stdout, &path)
}

#[tauri::command]
pub(crate) fn git_worktree_remove(path: String, worktree_path: String) -> Result<(), String> {
    open_repo(&path)?;
    let list = git_worktree_list(path.clone())?;
    let target = worktree_path.trim();
    if target.is_empty() {
        return Err("Worktree path is empty".to_string());
    }
    let matched = list
        .iter()
        .find(|e| !e.is_primary && worktree_request_matches_entry(target, &e.path));
    let Some(entry) = matched else {
        return Err("未找到可移除的 worktree，或该路径为主工作区".to_string());
    };

    let worktree_disk_path = entry.path.clone();

    let remove_res = run_git_command(
        &path,
        &["worktree", "remove", "--force", worktree_disk_path.as_str()],
        "Remove worktree",
    );
    if remove_res.is_ok() {
        remove_worktree_directory_if_leftover(&worktree_disk_path, &path)?;
        return Ok(());
    }
    let remove_err = remove_res.unwrap_err();

    let _ = run_git_command(&path, &["worktree", "prune"], "Worktree prune");
    let after = git_worktree_list(path.clone())?;
    let still_there = after
        .iter()
        .any(|e| !e.is_primary && worktree_request_matches_entry(target, &e.path));
    if !still_there {
        remove_worktree_directory_if_leftover(&worktree_disk_path, &path)?;
        return Ok(());
    }

    Err(remove_err)
}

#[tauri::command]
pub(crate) fn git_worktree_add_omc_batch(
    repo_path: String,
    task_id: String,
    attempt: i64,
) -> Result<GitWorktreeAddOmcBatchResult, String> {
    open_repo(&repo_path)?;
    let top = git_rev_parse_show_toplevel(&repo_path)?;
    let top_path = Path::new(&top);
    let parent = top_path.parent().ok_or_else(|| {
        "仓库根目录无上级路径，无法在其旁创建 wise-worktrees（与 omcAdapter 约定一致）".to_string()
    })?;
    let slug = omc_batch_worktree_slug_hex(&task_id, attempt);
    let branch_name = format!("wise/o/{}", slug);
    let dir_name = slug;
    let wt_parent = parent.join("wise-worktrees");
    fs::create_dir_all(&wt_parent).map_err(|e| format!("创建 wise-worktrees 父目录失败: {}", e))?;
    let wt_path = wt_parent.join(&dir_name);

    let top_canon = fs::canonicalize(top_path).map_err(|e| format!("无效仓库根: {}", e))?;
    if wt_path.starts_with(&top_canon) {
        return Err("内部错误：计算的 worktree 路径落在主仓库目录内，已中止".to_string());
    }

    if wt_path.exists() {
        let wt_arg = wt_path.to_string_lossy().to_string();
        let _ = git_worktree_remove(top.clone(), wt_arg.clone());
        if wt_path.exists() {
            remove_worktree_directory_if_leftover(&wt_arg, &top)?;
        }
        let _ = run_git_command(&top, &["worktree", "prune"], "Worktree prune");
    }

    let wt_str = wt_path.to_string_lossy().to_string();
    run_git_command(
        &top,
        &[
            "worktree",
            "add",
            wt_str.as_str(),
            "-b",
            branch_name.as_str(),
            "HEAD",
        ],
        "git worktree add (OMC batch)",
    )?;

    let abs = fs::canonicalize(&wt_path).map_err(|e| format!("无法解析 worktree 路径: {}", e))?;
    let abs_str = abs.to_string_lossy().to_string();
    Ok(GitWorktreeAddOmcBatchResult {
        repo_root: top,
        worktree_path: abs_str,
        branch_name,
    })
}

fn derive_folder_name_from_git_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return "repository".to_string();
    }
    let without_git = trimmed
        .strip_suffix(".git")
        .or_else(|| trimmed.strip_suffix(".GIT"))
        .unwrap_or(trimmed);
    let last = without_git
        .rsplit(&['/', ':'][..])
        .find(|s| !s.is_empty())
        .unwrap_or("repository");
    if last.is_empty() {
        "repository".to_string()
    } else {
        last.to_string()
    }
}

/// 在父目录下创建空文件夹，供后续 `git_init` 使用。
#[tauri::command]
pub(crate) fn prepare_empty_repository_dir(
    parent_path: String,
    folder_name: String,
) -> Result<String, String> {
    let parent = canonicalize_existing_dir(&parent_path)?;
    let folder = validate_repository_folder_name(&folder_name)?;
    let dest: PathBuf = parent.join(&folder);
    if dest.exists() {
        return Err(format!("目标目录已存在: {}", dest.display()));
    }
    fs::create_dir_all(&dest).map_err(|e| format!("创建目录失败: {e}"))?;
    let canon = dest
        .canonicalize()
        .map_err(|e| format!("无法解析新建目录: {e}"))?;
    Ok(canon.to_string_lossy().to_string())
}

fn git_clone_repository_blocking(
    parent_path: String,
    url: String,
    folder_name: Option<String>,
) -> Result<String, String> {
    let parent = canonicalize_existing_dir(&parent_path)?;
    let url_trim = url.trim();
    if url_trim.is_empty() {
        return Err("Git 地址不能为空".to_string());
    }
    let folder = match folder_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(name) => validate_repository_folder_name(name)?,
        None => validate_repository_folder_name(&derive_folder_name_from_git_url(url_trim))?,
    };
    let dest = parent.join(&folder);
    if dest.exists() {
        return Err(format!("目标目录已存在: {}", dest.display()));
    }
    let output = Command::new("git")
        .current_dir(&parent)
        .args(["clone", url_trim, folder.as_str()])
        .output()
        .map_err(|e| format!("git clone 启动失败: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            format!("git clone 失败 (exit {})", output.status)
        } else {
            format!("git clone 失败: {detail}")
        });
    }
    canonicalize_existing_dir(&dest.to_string_lossy())
        .map(|p| p.to_string_lossy().to_string())
}

/// 在父目录下执行 `git clone`，返回克隆后的仓库绝对路径（阻塞任务在后台线程执行）。
#[tauri::command]
pub async fn git_clone_repository(
    parent_path: String,
    url: String,
    folder_name: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || git_clone_repository_blocking(parent_path, url, folder_name))
        .await
        .map_err(|e| format!("git clone 任务异常: {e}"))?
}

#[cfg(test)]
mod git_push_tests {
    use super::*;

    #[test]
    fn git_cli_output_indicates_failure_detects_rejected() {
        assert!(git_cli_output_indicates_failure(
            "To github.com:org/repo.git\n ! [rejected] main -> main (fetch first)\n"
        ));
        assert!(!git_cli_output_indicates_failure(
            "Everything up-to-date\n"
        ));
    }

    #[test]
    fn parse_remote_tracking_ref_supports_slashed_branch() {
        assert_eq!(
            parse_remote_tracking_ref("refs/remotes/origin/feature/foo"),
            Some(("origin".to_string(), "feature/foo".to_string()))
        );
    }

    #[test]
    fn build_push_git_args_uses_head_refspec_when_upstream_name_differs() {
        let tracking = (
            "origin".to_string(),
            "sprint_gd-h5_S090011666170_20260520".to_string(),
        );
        assert_eq!(
            build_push_git_args(true, "main", Some(&tracking)),
            vec![
                "push".to_string(),
                "origin".to_string(),
                "HEAD:sprint_gd-h5_S090011666170_20260520".to_string(),
            ]
        );
    }

    #[test]
    fn build_push_git_args_plain_push_when_names_match() {
        let tracking = ("origin".to_string(), "main".to_string());
        assert_eq!(
            build_push_git_args(true, "main", Some(&tracking)),
            vec!["push".to_string()]
        );
    }

    #[test]
    fn build_push_git_args_sets_upstream_when_missing() {
        assert_eq!(
            build_push_git_args(false, "feature/foo", None),
            vec![
                "push".to_string(),
                "-u".to_string(),
                "origin".to_string(),
                "feature/foo".to_string(),
            ]
        );
    }
}

#[cfg(test)]
mod git_status_line_totals_tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::fs;
    use std::process::Command;
    use tempfile::tempdir;

    fn write_and_commit(repo: &Repository, rel_path: &str, content: &str) {
        let workdir = repo.workdir().expect("workdir");
        let full = workdir.join(rel_path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).expect("mkdir");
        }
        fs::write(&full, content).expect("write");
        let mut index = repo.index().expect("index");
        index
            .add_path(Path::new(rel_path))
            .expect("index add");
        index.write().expect("index write");
        let tree_id = index.write_tree().expect("tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let sig = Signature::now("wise", "wise@test").expect("sig");
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        if let Some(parent) = parent {
            repo.commit(
                Some("HEAD"),
                &sig,
                &sig,
                "commit",
                &tree,
                &[&parent],
            )
            .expect("commit");
        } else {
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                .expect("initial commit");
        }
    }

    #[test]
    fn git_status_summary_includes_pure_untracked_line_counts() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().to_string_lossy().to_string();
        let repo = Repository::init(dir.path()).expect("init");
        write_and_commit(&repo, "tracked.txt", "line1\nline2\n");
        drop(repo);

        let tracked_path = dir.path().join("tracked.txt");
        fs::write(&tracked_path, "line1\nline2\nline3-staged\n").expect("write tracked");
        Command::new("git")
            .args(["add", "tracked.txt"])
            .current_dir(dir.path())
            .output()
            .expect("git add");

        fs::write(dir.path().join("new.txt"), "a\nb\nc\n").expect("write untracked");

        let status = git_status(path.clone()).expect("git_status");
        let summary = git_status_summary(path).expect("git_status_summary");

        assert_eq!(
            summary.additions, status.additions,
            "summary should match full status additions (incl. untracked)"
        );
        assert_eq!(
            summary.deletions, status.deletions,
            "summary should match full status deletions"
        );
        assert!(
            status.additions >= 4,
            "expected staged + untracked additions, got {}",
            status.additions
        );
        let untracked = status
            .unstaged
            .iter()
            .find(|f| f.path == "new.txt")
            .expect("untracked file in unstaged list");
        assert_eq!(untracked.additions, 3, "new.txt line count");
    }
}

#[cfg(test)]
mod repository_acquire_tests {
    use super::*;

    #[test]
    fn derive_folder_name_from_urls() {
        assert_eq!(
            derive_folder_name_from_git_url("https://github.com/org/wise.git"),
            "wise"
        );
        assert_eq!(
            derive_folder_name_from_git_url("git@github.com:org/wise.git"),
            "wise"
        );
    }
}
