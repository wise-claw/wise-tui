//! `.trellis/tasks/<dir>/` 内 markdown 件读写,以及助手对话与
//! Trellis task 目录的原子创建。
//!
//! 安全约束:任何路径都必须落在 `<root>/.trellis/tasks/<dir>/` 子树
//! 内,且只允许 `prd.md / design.md / implement.md` 三种文件名。

use chrono::Local;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::wise_db;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactKind {
    Prd,
    Design,
    Implement,
}

impl ArtifactKind {
    pub fn file_name(self) -> &'static str {
        match self {
            ArtifactKind::Prd => "prd.md",
            ArtifactKind::Design => "design.md",
            ArtifactKind::Implement => "implement.md",
        }
    }
}

/// 校验 `task_dir` 是合法的 `.trellis/tasks/<MM-DD-slug>` 相对路径。
/// 不允许 `..`、绝对路径、`Component::CurDir` 之外的非常规元素。
fn validate_task_dir(task_dir: &str) -> Result<PathBuf, String> {
    let path = Path::new(task_dir);
    if path.is_absolute() {
        return Err("taskDir must be a relative path".into());
    }
    let mut components = Vec::new();
    for c in path.components() {
        match c {
            Component::Normal(p) => components.push(p),
            Component::CurDir => continue,
            _ => return Err("taskDir must not contain `..` or root components".into()),
        }
    }
    if components.len() < 3 {
        return Err("taskDir must look like `.trellis/tasks/<dir>`".into());
    }
    if components[0].to_string_lossy() != ".trellis" {
        return Err("taskDir must start with `.trellis`".into());
    }
    if components[1].to_string_lossy() != "tasks" {
        return Err("taskDir must live under `.trellis/tasks`".into());
    }
    Ok(path.to_path_buf())
}

fn resolve_artifact_path(
    repo_root: &Path,
    task_dir: &str,
    kind: ArtifactKind,
) -> Result<PathBuf, String> {
    let rel = validate_task_dir(task_dir)?;
    Ok(repo_root.join(rel).join(kind.file_name()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadArtifactArgs {
    pub repo_root: String,
    pub task_dir: String,
    pub kind: ArtifactKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactPayload {
    pub task_dir: String,
    pub kind: ArtifactKind,
    pub markdown: String,
    pub exists: bool,
}

#[tauri::command]
pub fn read_task_artifact(args: ReadArtifactArgs) -> Result<ArtifactPayload, String> {
    let repo_root = PathBuf::from(&args.repo_root);
    if !repo_root.is_absolute() {
        return Err("repoRoot must be absolute".into());
    }
    let path = resolve_artifact_path(&repo_root, &args.task_dir, args.kind)?;
    let exists = path.is_file();
    let markdown = if exists {
        fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    Ok(ArtifactPayload {
        task_dir: args.task_dir,
        kind: args.kind,
        markdown,
        exists,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteArtifactArgs {
    pub repo_root: String,
    pub task_dir: String,
    pub kind: ArtifactKind,
    pub markdown: String,
}

#[tauri::command]
pub fn write_task_artifact(args: WriteArtifactArgs) -> Result<ArtifactPayload, String> {
    let repo_root = PathBuf::from(&args.repo_root);
    if !repo_root.is_absolute() {
        return Err("repoRoot must be absolute".into());
    }
    let path = resolve_artifact_path(&repo_root, &args.task_dir, args.kind)?;
    if let Some(parent) = path.parent() {
        if !parent.is_dir() {
            return Err(format!(
                "task directory missing: {} (call mission_create_with_task first)",
                parent.display()
            ));
        }
    }
    fs::write(&path, &args.markdown).map_err(|e| e.to_string())?;
    Ok(ArtifactPayload {
        task_dir: args.task_dir,
        kind: args.kind,
        markdown: args.markdown,
        exists: true,
    })
}

// ── Atomic task directory + mission_runs creation ───────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionCreateWithTaskArgs {
    pub assistant_id: String,
    pub repo_root: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub repository_id: Option<i64>,
    pub title: String,
    pub slug: Option<String>,
    /// Optional initial PRD body to write into `prd.md`. Empty → use a
    /// minimal seeded template.
    #[serde(default)]
    pub seed_prd_markdown: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionCreateWithTaskResult {
    pub mission_id: String,
    pub task_dir: String,
    pub assistant_id: String,
    pub created_at: i64,
}

#[tauri::command]
pub fn mission_create_with_task(
    db: tauri::State<'_, wise_db::WiseDb>,
    args: MissionCreateWithTaskArgs,
) -> Result<MissionCreateWithTaskResult, String> {
    let repo_root = PathBuf::from(&args.repo_root);
    if !repo_root.is_absolute() {
        return Err("repoRoot must be absolute".into());
    }
    if !repo_root.is_dir() {
        return Err(format!("repoRoot does not exist: {}", repo_root.display()));
    }
    let title = args.title.trim();
    if title.is_empty() {
        return Err("title must not be empty".into());
    }
    let slug = args
        .slug
        .as_deref()
        .map(slugify)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| slugify(title));
    if slug.is_empty() {
        return Err("could not derive a slug from title".into());
    }
    let date_prefix = Local::now().format("%m-%d").to_string();
    let task_basename = format!("{date_prefix}-{slug}");
    let rel_dir = format!(".trellis/tasks/{task_basename}");
    let task_abs_dir = repo_root.join(&rel_dir);
    if task_abs_dir.exists() {
        return Err(format!(
            "task directory already exists: {}",
            task_abs_dir.display()
        ));
    }
    fs::create_dir_all(&task_abs_dir).map_err(|e| e.to_string())?;

    // Seed prd.md
    let prd_body = args
        .seed_prd_markdown
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| seed_prd_template(title));
    fs::write(task_abs_dir.join("prd.md"), &prd_body).map_err(|e| e.to_string())?;

    // Seed task.json (minimal schema compatible with task.py readers).
    let today = Local::now().format("%Y-%m-%d").to_string();
    let task_json = serde_json::json!({
        "id": slug,
        "name": slug,
        "title": title,
        "description": "",
        "status": "planning",
        "dev_type": null,
        "scope": null,
        "package": null,
        "priority": null,
        "creator": "wise",
        "assignee": "wise",
        "createdAt": today,
        "completedAt": null,
        "branch": null,
        "base_branch": "main",
        "worktree_path": null,
        "commit": null,
        "pr_url": null,
        "subtasks": [],
        "children": [],
        "parent": null,
        "relatedFiles": [],
        "notes": "",
        "meta": {
            "createdBy": "assistant",
            "assistantId": args.assistant_id.clone(),
        },
    });
    fs::write(
        task_abs_dir.join("task.json"),
        serde_json::to_string_pretty(&task_json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    // Seed empty implement.jsonl / check.jsonl placeholders so sub-agent
    // pipelines that look for these files do not error.
    let placeholder = "{\"_example\": \"Filled by assistant when needed\"}\n";
    fs::write(task_abs_dir.join("implement.jsonl"), placeholder)
        .map_err(|e| e.to_string())?;
    fs::write(task_abs_dir.join("check.jsonl"), placeholder)
        .map_err(|e| e.to_string())?;

    // Insert mission_runs row in the same transaction.
    let mission_id = format!("mission_{}", uuid::Uuid::new_v4().simple());
    let now = wise_db::unix_now_ms();
    {
        let g = db
            .0
            .lock()
            .map_err(|e| format!("db lock poisoned: {e}"))?;
        g.execute(
            "INSERT INTO mission_runs (
               mission_id, project_id, project_name, root_path, prd_hash, title, stage, status,
               snapshot_json, created_at, updated_at, assistant_id, task_dir
             ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, 'planning', 'active', '{}', ?6, ?6, ?7, ?8)",
            params![
                mission_id,
                args.project_id,
                args.project_name,
                args.repo_root,
                title,
                now,
                args.assistant_id,
                rel_dir,
            ],
        )
        .map_err(|e| {
            // Best effort: roll back the directory if the insert fails. This
            // is not a true 2PC but the failure surface is small here.
            let _ = fs::remove_dir_all(&task_abs_dir);
            e.to_string()
        })?;
    }

    Ok(MissionCreateWithTaskResult {
        mission_id,
        task_dir: rel_dir,
        assistant_id: args.assistant_id,
        created_at: now,
    })
}

fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_dash = false;
    for ch in input.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if matches!(c, ' ' | '-' | '_' | '/' | '.') {
            if !prev_dash && !out.is_empty() {
                out.push('-');
                prev_dash = true;
            }
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

fn seed_prd_template(title: &str) -> String {
    format!(
        "# {title}\n\n## Goal\n\nTBD.\n\n## Requirements\n\n- TBD\n\n## Acceptance Criteria\n\n- [ ] TBD\n",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_task_dir_accepts_canonical_path() {
        assert!(validate_task_dir(".trellis/tasks/05-18-foo").is_ok());
    }

    #[test]
    fn validate_task_dir_rejects_traversal() {
        assert!(validate_task_dir("../etc/passwd").is_err());
        assert!(validate_task_dir(".trellis/tasks/../secret").is_err());
    }

    #[test]
    fn validate_task_dir_rejects_absolute() {
        assert!(validate_task_dir("/etc/passwd").is_err());
    }

    #[test]
    fn validate_task_dir_rejects_other_subtree() {
        assert!(validate_task_dir(".trellis/spec/secret").is_err());
    }

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Hello, World!"), "hello-world");
        assert_eq!(slugify("已经存在 PRD 拆分"), "prd");
        assert_eq!(slugify("foo-bar  baz"), "foo-bar-baz");
    }
}
