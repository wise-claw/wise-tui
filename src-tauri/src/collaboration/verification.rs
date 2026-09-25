//! 受控验证运行：由 Wise 在目标仓库执行任务计划声明的验证命令并记录退出码、HEAD commit、
//! 工作区是否干净与输出尾部。这是唯一被交付校验采信的测试证据；Agent 自述的“测试通过”不算。
//!
//! 进程与网络 IO 均在命令层的阻塞线程 / async 中执行，不持有数据库锁。

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::error::{codes, CResult, CollabError};
use super::events::append_event;
use super::model::{self, TaskRow};
use super::util::{new_id, now_ms, truncate_chars};

pub const DEFAULT_TIMEOUT_MS: u64 = 10 * 60 * 1000;
const OUTPUT_TAIL_CHARS: usize = 8_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationRun {
    pub id: String,
    pub requirement_id: String,
    pub task_id: String,
    pub attempt_id: Option<String>,
    pub repository_id: Option<i64>,
    pub kind: String,
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i64>,
    pub passed: bool,
    pub head_commit: Option<String>,
    pub dirty: bool,
    pub output_tail: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

fn map_run(r: &rusqlite::Row<'_>) -> rusqlite::Result<VerificationRun> {
    Ok(VerificationRun {
        id: r.get(0)?,
        requirement_id: r.get(1)?,
        task_id: r.get(2)?,
        attempt_id: r.get(3)?,
        repository_id: r.get(4)?,
        kind: r.get(5)?,
        command: r.get(6)?,
        cwd: r.get(7)?,
        exit_code: r.get(8)?,
        passed: r.get::<_, i64>(9)? != 0,
        head_commit: r.get(10)?,
        dirty: r.get::<_, i64>(11)? != 0,
        output_tail: r.get(12)?,
        started_at: r.get(13)?,
        finished_at: r.get(14)?,
    })
}

const RUN_COLS: &str = "id, requirement_id, task_id, attempt_id, repository_id, kind, command, cwd, exit_code, passed,
    head_commit, dirty, output_tail, started_at, finished_at";

pub fn load_run(conn: &Connection, id: &str) -> CResult<VerificationRun> {
    conn.query_row(&format!("SELECT {RUN_COLS} FROM collab_verification_runs WHERE id = ?1"), params![id], map_run)
        .optional()?
        .ok_or_else(|| CollabError::not_found("验证运行", id))
}

pub fn list_runs(conn: &Connection, requirement_id: &str) -> CResult<Vec<VerificationRun>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {RUN_COLS} FROM collab_verification_runs WHERE requirement_id = ?1 ORDER BY started_at DESC, rowid DESC LIMIT 200"
    ))?;
    let rows = stmt.query_map(params![requirement_id], map_run)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn list_runs_for_task(conn: &Connection, task_id: &str) -> CResult<Vec<VerificationRun>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {RUN_COLS} FROM collab_verification_runs WHERE task_id = ?1 ORDER BY started_at DESC, rowid DESC"
    ))?;
    let rows = stmt.query_map(params![task_id], map_run)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Commands declared by the plan for this task (`spec.verification.commands`).
pub fn declared_commands(task: &TaskRow) -> Vec<String> {
    let v = task.spec.get("verification");
    let list = v
        .and_then(|v| v.get("commands"))
        .and_then(Value::as_array)
        .or_else(|| v.and_then(Value::as_array));
    list.map(|items| {
        items
            .iter()
            .filter_map(|c| c.as_str().or_else(|| c.get("command").and_then(Value::as_str)))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    })
    .unwrap_or_default()
}

/// Everything the blocking runner needs, captured under the DB lock.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedRun {
    pub requirement_id: String,
    pub task_id: String,
    pub attempt_id: Option<String>,
    pub repository_id: Option<i64>,
    pub command: String,
    pub cwd: String,
    pub timeout_ms: u64,
}

/// Resolves which declared command to run; undeclared commands are refused (AC: 证据不可伪造).
pub fn prepare_run(
    conn: &Connection,
    task_id: &str,
    attempt_id: Option<&str>,
    requested: Option<&str>,
    repos: &super::RepoDirectory,
    allow_user_command: bool,
) -> CResult<PreparedRun> {
    let task = model::load_task(conn, task_id)?;
    let declared = declared_commands(&task);
    let command = match requested.map(str::trim).filter(|s| !s.is_empty()) {
        Some(c) if declared.iter().any(|d| d == c) => c.to_string(),
        Some(c) if allow_user_command => c.to_string(),
        Some(c) => {
            return Err(CollabError::new(
                codes::FORBIDDEN,
                format!("验证命令「{c}」不在任务计划声明的验证命令中；可用：{}", declared.join(" / ")),
            ))
        }
        None => declared.first().cloned().ok_or_else(|| {
            CollabError::new(codes::INVALID_STATE, "任务计划未声明验证命令（spec.verification.commands）")
                .suggest("revise_plan")
        })?,
    };
    let repo = task
        .repository_id
        .and_then(|id| repos.get(&id))
        .ok_or_else(|| CollabError::new(codes::AMBIGUOUS_TARGET, "任务目标仓库不可用"))?;
    let cwd = task
        .workspace_binding
        .get("path")
        .and_then(Value::as_str)
        .filter(|p| !p.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| repo.path.clone());
    let timeout_ms = task
        .spec
        .get("verification")
        .and_then(|v| v.get("timeoutMs"))
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(5_000, 60 * 60 * 1000);
    Ok(PreparedRun {
        requirement_id: task.requirement_id.clone(),
        task_id: task.id.clone(),
        attempt_id: attempt_id.map(str::to_string),
        repository_id: task.repository_id,
        command,
        cwd,
        timeout_ms,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutcome {
    pub exit_code: Option<i64>,
    pub output_tail: String,
    pub head_commit: Option<String>,
    pub dirty: bool,
    pub timed_out: bool,
    pub started_at: i64,
    pub finished_at: i64,
}

fn git_output(cwd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).current_dir(cwd).stdin(Stdio::null()).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn git_head(cwd: &str) -> Option<String> {
    git_output(cwd, &["rev-parse", "HEAD"]).filter(|s| !s.is_empty())
}

pub fn git_dirty(cwd: &str) -> bool {
    git_output(cwd, &["status", "--porcelain", "--untracked-files=no"]).is_some_and(|s| !s.is_empty())
}

/// Blocking: run the command through the login shell with a hard timeout.
pub fn execute_blocking(run: &PreparedRun) -> Result<RunOutcome, String> {
    if !Path::new(&run.cwd).is_dir() {
        return Err(format!("验证目录不存在：{}", run.cwd));
    }
    let started_at = now_ms();
    let head_before = git_head(&run.cwd);
    let shell = std::env::var("SHELL").ok().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .arg("-lc")
        .arg(&run.command)
        .current_dir(&run.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CI", "1")
        .spawn()
        .map_err(|e| format!("无法启动验证命令：{e}"))?;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let out_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(s) = stdout.as_mut() {
            let _ = s.read_to_end(&mut buf);
        }
        buf
    });
    let err_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(s) = stderr.as_mut() {
            let _ = s.read_to_end(&mut buf);
        }
        buf
    });
    let deadline = Instant::now() + Duration::from_millis(run.timeout_ms);
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    let _ = child.kill();
                    break child.wait().ok();
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => break None,
        }
    };
    let out = out_thread.join().unwrap_or_default();
    let err = err_thread.join().unwrap_or_default();
    let mut text = String::from_utf8_lossy(&out).into_owned();
    if !err.is_empty() {
        text.push_str("\n--- stderr ---\n");
        text.push_str(&String::from_utf8_lossy(&err));
    }
    if timed_out {
        text.push_str(&format!("\n[Wise] 验证超时（{} ms）已终止", run.timeout_ms));
    }
    let chars: Vec<char> = text.chars().collect();
    let tail: String = if chars.len() > OUTPUT_TAIL_CHARS {
        chars[chars.len() - OUTPUT_TAIL_CHARS..].iter().collect()
    } else {
        text
    };
    let head_after = git_head(&run.cwd);
    let dirty = git_dirty(&run.cwd);
    Ok(RunOutcome {
        exit_code: if timed_out { None } else { status.and_then(|s| s.code()).map(i64::from) },
        output_tail: tail,
        // A command that moves HEAD invalidates the fingerprint; record the post-run HEAD only if stable.
        head_commit: if head_before == head_after { head_after } else { None },
        dirty,
        timed_out,
        started_at,
        finished_at: now_ms(),
    })
}

pub fn record_run(conn: &Connection, run: &PreparedRun, outcome: &RunOutcome) -> CResult<VerificationRun> {
    let id = new_id("vr");
    let passed = outcome.exit_code == Some(0) && !outcome.timed_out;
    conn.execute(
        &format!(
            "INSERT INTO collab_verification_runs ({RUN_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, 'command', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"
        ),
        params![
            id,
            run.requirement_id,
            run.task_id,
            run.attempt_id,
            run.repository_id,
            run.command,
            run.cwd,
            outcome.exit_code,
            passed as i64,
            outcome.head_commit,
            outcome.dirty as i64,
            outcome.output_tail,
            outcome.started_at,
            outcome.finished_at
        ],
    )?;
    append_event(
        conn,
        &run.requirement_id,
        "verification.recorded",
        json!({ "runId": id, "taskId": run.task_id, "passed": passed, "headCommit": outcome.head_commit, "dirty": outcome.dirty }),
        Some(&run.task_id),
        run.attempt_id.as_deref(),
    )?;
    load_run(conn, &id)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthOutcome {
    pub url: String,
    pub ok: bool,
    pub status: Option<u16>,
    pub reported_commit: Option<String>,
    pub error: Option<String>,
    pub checked_at: i64,
}

/// Health endpoints may report `{ "commit": "<sha>" }` (or `gitCommit`/`version.commit`).
pub fn commit_from_health_body(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    for path in [&["commit"][..], &["gitCommit"], &["commitSha"], &["version", "commit"], &["build", "commit"]] {
        let mut cur = &v;
        let mut found = true;
        for key in path {
            match cur.get(*key) {
                Some(next) => cur = next,
                None => {
                    found = false;
                    break;
                }
            }
        }
        if found {
            if let Some(s) = cur.as_str().map(str::trim).filter(|s| !s.is_empty()) {
                return Some(s.to_string());
            }
        }
    }
    None
}

pub fn is_http_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let rest = lower.strip_prefix("http://").or_else(|| lower.strip_prefix("https://"));
    let Some(rest) = rest else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.rsplit_once('@').map(|(_, h)| h).unwrap_or(host);
    let host = if host.starts_with('[') { host.split(']').next().unwrap_or("").trim_start_matches('[') } else { host.split(':').next().unwrap_or("") };
    !host.is_empty()
}

pub async fn http_health(url: &str, timeout: Duration) -> HealthOutcome {
    let checked_at = now_ms();
    if !is_http_url(url) {
        return HealthOutcome { url: url.into(), error: Some("健康检查地址必须是 http(s) URL".into()), checked_at, ..Default::default() };
    }
    let client = match reqwest::Client::builder().timeout(timeout).build() {
        Ok(c) => c,
        Err(e) => return HealthOutcome { url: url.into(), error: Some(e.to_string()), checked_at, ..Default::default() },
    };
    match client.get(url).send().await {
        Err(e) => HealthOutcome { url: url.into(), error: Some(e.to_string()), checked_at, ..Default::default() },
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            HealthOutcome {
                url: url.into(),
                ok: status.is_success(),
                status: Some(status.as_u16()),
                reported_commit: commit_from_health_body(&truncate_chars(&body, 64 * 1024)),
                error: (!status.is_success()).then(|| format!("HTTP {}", status.as_u16())),
                checked_at,
            }
        }
    }
}

pub fn record_health(conn: &Connection, requirement_id: &str, task_id: &str, outcome: &HealthOutcome) -> CResult<VerificationRun> {
    let id = new_id("vr");
    conn.execute(
        &format!(
            "INSERT INTO collab_verification_runs ({RUN_COLS}) VALUES (?1, ?2, ?3, NULL, NULL, 'health', ?4, '', ?5, ?6, ?7, 0, ?8, ?9, ?9)"
        ),
        params![
            id,
            requirement_id,
            task_id,
            format!("GET {}", outcome.url),
            outcome.status.map(i64::from),
            outcome.ok as i64,
            outcome.reported_commit,
            json!(outcome).to_string(),
            outcome.checked_at
        ],
    )?;
    load_run(conn, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_body_commit_is_extracted_from_common_shapes() {
        assert_eq!(commit_from_health_body(r#"{"commit":"abc"}"#).as_deref(), Some("abc"));
        assert_eq!(commit_from_health_body(r#"{"version":{"commit":"def"}}"#).as_deref(), Some("def"));
        assert_eq!(commit_from_health_body("ok"), None);
    }

    #[test]
    fn health_url_must_be_http() {
        assert!(is_http_url("http://127.0.0.1:8080/health"));
        assert!(is_http_url("https://api.example.com/health"));
        assert!(!is_http_url("file:///etc/passwd"));
    }

    #[test]
    fn execute_blocking_records_exit_code_and_output() {
        let dir = std::env::temp_dir().join(format!("wise-collab-vr-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let run = PreparedRun {
            requirement_id: "r".into(),
            task_id: "t".into(),
            attempt_id: None,
            repository_id: None,
            command: "echo hello && exit 3".into(),
            cwd: dir.to_string_lossy().into_owned(),
            timeout_ms: 20_000,
        };
        let out = execute_blocking(&run).unwrap();
        assert_eq!(out.exit_code, Some(3));
        assert!(out.output_tail.contains("hello"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
