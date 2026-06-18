use super::{claude_path_search_prefixes, find_claude_binary, merge_path_env};
use std::time::Duration;

/// 单次 Claude Code bare 调用，供语音润色、工作流字段优化等轻量场景。
#[tauri::command]
pub(crate) async fn run_claude_quick(
    project_path: String,
    prompt: String,
    timeout_ms: Option<u64>,
    model: Option<String>,
) -> Result<String, String> {
    let timeout_ms = timeout_ms.filter(|&t| t > 0);
    let claude_path = find_claude_binary()?;
    let mut cmd = tokio::process::Command::new(&claude_path);
    cmd.current_dir(&project_path);
    cmd.arg("--bare");
    cmd.arg("-p").arg(&prompt);
    cmd.arg("--output-format").arg("text");
    cmd.arg("--permission-mode").arg("bypassPermissions");
    if let Some(m) = model.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        cmd.arg("--model").arg(m);
    }
    cmd.env(
        "HOME",
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    );
    cmd.env("PATH", merge_path_env(&claude_path_search_prefixes()));
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("启动 Claude 失败: {e}"))?;
    let mut stdout_reader = child.stdout.take().ok_or("无法获取 stdout")?;
    let mut stderr_reader = child.stderr.take().ok_or("无法获取 stderr")?;

    let stdout_handle = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = tokio::io::AsyncReadExt::read_to_end(&mut stdout_reader, &mut buf).await;
        buf
    });
    let stderr_handle = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = tokio::io::AsyncReadExt::read_to_end(&mut stderr_reader, &mut buf).await;
        buf
    });

    let (status_result, timed_out) = if let Some(ms) = timeout_ms {
        let wait = tokio::time::timeout(
            Duration::from_millis(ms.max(5_000)),
            child.wait(),
        )
        .await;
        match wait {
            Ok(s) => (s.ok(), false),
            Err(_) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                (None, true)
            }
        }
    } else {
        (child.wait().await.ok(), false)
    };

    if timed_out {
        return Err("Claude 调用超时".to_string());
    }

    let stdout_bytes = stdout_handle
        .await
        .map_err(|e| format!("读取 stdout 失败: {e}"))?;
    let stderr_bytes = stderr_handle
        .await
        .map_err(|e| format!("读取 stderr 失败: {e}"))?;
    let stdout_text = String::from_utf8_lossy(&stdout_bytes).to_string();
    let stderr_text = String::from_utf8_lossy(&stderr_bytes).to_string();

    let exit_ok = status_result.map(|s| s.success()).unwrap_or(false);
    if !exit_ok {
        return Err(format!("Claude 退出异常。stderr: {}", stderr_text));
    }

    Ok(stdout_text.trim().to_string())
}
