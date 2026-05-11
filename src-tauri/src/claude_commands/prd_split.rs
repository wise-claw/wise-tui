use super::{claude_path_search_prefixes, find_claude_binary, merge_path_env, trim_model_cli_arg};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::AsyncReadExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrdSplitClaudeRunResult {
    run_id: String,
    status: String,
    exit_code: i32,
    duration_ms: u64,
    stdout_path: String,
    stderr_path: String,
    raw_result_path: String,
    notes_path: Option<String>,
}

fn parse_run_id_from_dir(run_dir: &Path) -> String {
    run_dir
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown-run".to_string())
}

fn normalize_split_run_dir(run_dir: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(run_dir);
    if !p.is_absolute() {
        return Err("run_dir 必须是绝对路径".to_string());
    }
    fs::create_dir_all(&p).map_err(|e| format!("创建 run_dir 失败: {e}"))?;
    let canon = p
        .canonicalize()
        .map_err(|e| format!("解析 run_dir 失败: {e}"))?;
    let base = crate::wise_dir()
        .map_err(|e| format!("解析 ~/.wise 失败: {e}"))?
        .join("prd-runs");
    fs::create_dir_all(&base).map_err(|e| format!("创建 ~/.wise/prd-runs 失败: {e}"))?;
    let base_canon = base
        .canonicalize()
        .map_err(|e| format!("解析 ~/.wise/prd-runs 失败: {e}"))?;
    if !canon.starts_with(&base_canon) {
        return Err("run_dir 仅允许位于 ~/.wise/prd-runs 下".to_string());
    }
    Ok(canon)
}

/// 兼容模型把 JSON 包在 ```json 代码围栏里的场景，提取可解析对象正文。
fn extract_split_json_candidate(stdout_text: &str) -> Option<String> {
    let trimmed = stdout_text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('{') {
        return Some(trimmed.to_string());
    }
    let mut lines = trimmed.lines();
    let first = lines.next()?.trim_start();
    if !first.starts_with("```") {
        return None;
    }
    let mut body = String::new();
    for line in lines {
        if line.trim_start().starts_with("```") {
            break;
        }
        if !body.is_empty() {
            body.push('\n');
        }
        body.push_str(line);
    }
    let candidate = body.trim();
    if candidate.starts_with('{') {
        return Some(candidate.to_string());
    }
    None
}

#[tauri::command]
pub(crate) async fn run_prd_split_claude(
    project_path: String,
    run_dir: String,
    prompt: String,
    model: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<PrdSplitClaudeRunResult, String> {
    let run_dir = normalize_split_run_dir(&run_dir)?;
    let run_id = parse_run_id_from_dir(&run_dir);
    let timeout_ms = timeout_ms.unwrap_or(120_000).max(1_000);

    let stdout_path = run_dir.join("claude.stdout.log");
    let stderr_path = run_dir.join("claude.stderr.log");
    let raw_result_path = run_dir.join("split-result.raw.json");
    let notes_path = run_dir.join("split-result.notes.md");

    let claude_path = find_claude_binary()?;
    let mut cmd = tokio::process::Command::new(&claude_path);
    cmd.current_dir(project_path);
    cmd.arg("-p").arg(prompt);
    cmd.arg("--permission-mode").arg("bypassPermissions");
    if let Some(m) = model.as_deref().and_then(trim_model_cli_arg) {
        cmd.arg("--model").arg(m);
    }
    cmd.env(
        "HOME",
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    );
    cmd.env("PATH", merge_path_env(&claude_path_search_prefixes()));
    // 与 `create_claude_command` 的 `--bare` 分支一致：不消费 stdin 时必须显式 null，否则继承 GUI 进程的管道会触发
    // 「no stdin data received in 3s」类 stderr 告警。
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let started = std::time::Instant::now();
    let mut child = cmd.spawn().map_err(|e| format!("启动 Claude 失败: {e}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法获取 Claude stdout".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法获取 Claude stderr".to_string())?;

    let stdout_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf).await;
        buf
    });
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf).await;
        buf
    });

    let wait_result = tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()).await;
    let timed_out = wait_result.is_err();
    if timed_out {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    let stdout_bytes = stdout_task
        .await
        .map_err(|e| format!("读取 stdout 失败: {e}"))?;
    let stderr_bytes = stderr_task
        .await
        .map_err(|e| format!("读取 stderr 失败: {e}"))?;
    let stdout_text = String::from_utf8_lossy(&stdout_bytes).to_string();
    let stderr_text = String::from_utf8_lossy(&stderr_bytes).to_string();

    fs::write(&stdout_path, &stdout_text).map_err(|e| format!("写入 stdout 日志失败: {e}"))?;
    fs::write(&stderr_path, &stderr_text).map_err(|e| format!("写入 stderr 日志失败: {e}"))?;

    let json_candidate = extract_split_json_candidate(&stdout_text);
    let raw_for_persist = json_candidate.as_deref().unwrap_or(stdout_text.as_str());
    fs::write(&raw_result_path, raw_for_persist).map_err(|e| format!("写入 raw 结果失败: {e}"))?;

    let elapsed = started.elapsed().as_millis() as u64;
    let (status, exit_code, notes): (&str, i32, String) = if timed_out {
        (
            "failed",
            10,
            format!(
                "# split run failed\n\n- reason: timeout\n- timeoutMs: {timeout_ms}\n- runId: {run_id}\n"
            ),
        )
    } else {
        let cli_status_ok = wait_result
            .ok()
            .and_then(|r| r.ok())
            .map(|s| s.success())
            .unwrap_or(false);
        if !cli_status_ok {
            (
                "failed",
                10,
                "# split run failed\n\n- reason: claude process exited non-zero\n".to_string(),
            )
        } else if json_candidate.is_none() {
            (
                "failed",
                10,
                "# split run failed\n\n- reason: stdout does not contain a JSON object payload\n"
                    .to_string(),
            )
        } else {
            let first = json_candidate.as_deref().unwrap_or_default();
            match serde_json::from_str::<serde_json::Value>(first) {
                Ok(v) if v.is_object() => (
                    "succeeded",
                    0,
                    "# split run succeeded\n\n- reason: valid JSON object output\n".to_string(),
                ),
                Ok(_) => (
                    "failed",
                    20,
                    "# split run failed\n\n- reason: output is JSON but not an object\n"
                        .to_string(),
                ),
                Err(_) => (
                    "failed",
                    10,
                    "# split run failed\n\n- reason: output is not valid JSON\n".to_string(),
                ),
            }
        }
    };

    fs::write(&notes_path, notes).map_err(|e| format!("写入 notes 失败: {e}"))?;

    Ok(PrdSplitClaudeRunResult {
        run_id,
        status: status.to_string(),
        exit_code,
        duration_ms: elapsed,
        stdout_path: stdout_path.to_string_lossy().to_string(),
        stderr_path: stderr_path.to_string_lossy().to_string(),
        raw_result_path: raw_result_path.to_string_lossy().to_string(),
        notes_path: Some(notes_path.to_string_lossy().to_string()),
    })
}
