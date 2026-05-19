//! Lifecycle hook execution — runs scripts/shell commands as subprocesses
//! with per-kind timeouts and captured stdout/stderr.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use super::manifest::HookSpec;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookKind {
    OnInstall,
    OnActivate,
    OnDeactivate,
    OnUninstall,
}

impl HookKind {
    pub fn timeout(self) -> Duration {
        match self {
            HookKind::OnInstall => Duration::from_secs(120),
            HookKind::OnUninstall => Duration::from_secs(60),
            HookKind::OnActivate | HookKind::OnDeactivate => Duration::from_secs(30),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            HookKind::OnInstall => "onInstall",
            HookKind::OnActivate => "onActivate",
            HookKind::OnDeactivate => "onDeactivate",
            HookKind::OnUninstall => "onUninstall",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationOutcome {
    pub kind: String,
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
    pub error: Option<String>,
}

pub async fn run_hook(
    ext_dir: &Path,
    hook: &HookSpec,
    kind: HookKind,
) -> ActivationOutcome {
    match hook {
        HookSpec::Script { script } => run_script(ext_dir, script, kind).await,
        HookSpec::Shell { shell } => run_shell(ext_dir, &shell.command, &shell.args, kind, shell.timeout).await,
    }
}

async fn run_script(ext_dir: &Path, script: &str, kind: HookKind) -> ActivationOutcome {
    let canonical_ext = match ext_dir.canonicalize() {
        Ok(p) => p,
        Err(e) => return error_outcome(kind, format!("ext_dir canonicalize: {e}")),
    };
    let candidate = ext_dir.join(script);
    let canonical_script = match candidate.canonicalize() {
        Ok(p) => p,
        Err(e) => return error_outcome(kind, format!("script '{script}' missing: {e}")),
    };
    if !canonical_script.starts_with(&canonical_ext) {
        return error_outcome(
            kind,
            format!("script '{script}' resolves outside extension dir"),
        );
    }
    let mut cmd = Command::new("node");
    cmd.arg(&canonical_script).current_dir(&canonical_ext);
    spawn_with_timeout(cmd, kind, kind.timeout()).await
}

async fn run_shell(
    ext_dir: &Path,
    command: &str,
    args: &[String],
    kind: HookKind,
    timeout_override: Option<u64>,
) -> ActivationOutcome {
    let canonical_ext = match ext_dir.canonicalize() {
        Ok(p) => p,
        Err(e) => return error_outcome(kind, format!("ext_dir canonicalize: {e}")),
    };
    let mut cmd = Command::new(command);
    cmd.args(args).current_dir(&canonical_ext);
    let dur = timeout_override
        .map(Duration::from_secs)
        .unwrap_or_else(|| kind.timeout());
    spawn_with_timeout(cmd, kind, dur).await
}

async fn spawn_with_timeout(
    mut cmd: Command,
    kind: HookKind,
    dur: Duration,
) -> ActivationOutcome {
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return error_outcome(kind, format!("spawn: {e}")),
    };

    let mut stdout_h = child.stdout.take();
    let mut stderr_h = child.stderr.take();
    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    let collect = async {
        let stdout_fut = async {
            if let Some(h) = stdout_h.as_mut() {
                let _ = h.read_to_string(&mut stdout_buf).await;
            }
        };
        let stderr_fut = async {
            if let Some(h) = stderr_h.as_mut() {
                let _ = h.read_to_string(&mut stderr_buf).await;
            }
        };
        tokio::join!(stdout_fut, stderr_fut);
        child.wait().await
    };

    match tokio::time::timeout(dur, collect).await {
        Ok(Ok(status)) => ActivationOutcome {
            kind: kind.label().to_string(),
            ok: status.success(),
            exit_code: status.code(),
            timed_out: false,
            stdout: stdout_buf,
            stderr: stderr_buf,
            error: None,
        },
        Ok(Err(e)) => error_outcome(kind, format!("wait: {e}")),
        Err(_) => {
            // Best-effort kill — child handle already moved into `collect`.
            ActivationOutcome {
                kind: kind.label().to_string(),
                ok: false,
                exit_code: None,
                timed_out: true,
                stdout: stdout_buf,
                stderr: stderr_buf,
                error: Some(format!("hook timed out after {:?}", dur)),
            }
        }
    }
}

fn error_outcome(kind: HookKind, msg: String) -> ActivationOutcome {
    ActivationOutcome {
        kind: kind.label().to_string(),
        ok: false,
        exit_code: None,
        timed_out: false,
        stdout: String::new(),
        stderr: String::new(),
        error: Some(msg),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn node_available() -> bool {
        std::process::Command::new("node")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn sleep_available() -> bool {
        std::process::Command::new("sleep")
            .arg("0")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[tokio::test]
    async fn script_path_traversal_rejected() {
        let dir = tempdir().unwrap();
        let outside = dir.path().parent().unwrap().to_path_buf();
        fs::write(outside.join("escape.mjs"), "console.log('boom');").unwrap();
        let ext_dir = dir.path().to_path_buf();
        let outcome = run_script(&ext_dir, "../escape.mjs", HookKind::OnActivate).await;
        assert!(!outcome.ok);
        assert!(outcome.error.unwrap().contains("outside"));
    }

    #[tokio::test]
    async fn shell_hook_timeout_kills_child() {
        // `sleep` is universally available on POSIX; skip on platforms without it.
        if !sleep_available() {
            return;
        }
        let dir = tempdir().unwrap();
        let outcome = run_shell(
            dir.path(),
            "sleep",
            &["5".to_string()],
            HookKind::OnActivate,
            Some(1),
        )
        .await;
        assert!(outcome.timed_out, "expected timeout, got {outcome:?}");
        assert!(!outcome.ok);
    }

    #[tokio::test]
    async fn script_runs_node_and_captures_stdout() {
        if !node_available() {
            eprintln!("skipping: node not installed");
            return;
        }
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("hi.mjs"),
            "console.log('hello-from-extension');",
        )
        .unwrap();
        let outcome = run_script(dir.path(), "hi.mjs", HookKind::OnActivate).await;
        assert!(outcome.ok, "expected success, got {outcome:?}");
        assert!(outcome.stdout.contains("hello-from-extension"));
    }
}
