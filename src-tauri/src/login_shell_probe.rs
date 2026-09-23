//! Bounded login-shell lookup for GUI launches with an incomplete PATH.
//! Nonblocking capture also handles startup banners and inherited stdout in jobs.

use std::io::{self, Read};
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

fn shell_stdout(shell: &str, args: &[&str], budget: Duration) -> Option<String> {
    let (mut reader, writer) = UnixStream::pair().ok()?;
    reader.set_nonblocking(true).ok()?;
    let stdout: OwnedFd = writer.into();
    let mut child = Command::new(shell)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .ok()?;
    let deadline = Instant::now() + budget;
    let mut bytes = Vec::new();
    let mut buf = [0_u8; 4096];
    let result = loop {
        // Cap both retained output and work per poll: a noisy shell must not
        // deadlock on a full pipe or starve the deadline check.
        let mut read_error = false;
        for _ in 0..16 {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    bytes.extend_from_slice(&buf[..n]);
                    if bytes.len() > 64 * 1024 {
                        bytes.drain(..bytes.len() - 64 * 1024);
                    }
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => break,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => {
                    read_error = true;
                    break;
                }
            }
        }
        if read_error {
            break None;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                // The shell may exit between our read and try_wait. Drain the
                // remaining available bytes without waiting for a descendant's EOF.
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            bytes.extend_from_slice(&buf[..n]);
                            if bytes.len() > 64 * 1024 {
                                bytes.drain(..bytes.len() - 64 * 1024);
                            }
                        }
                    }
                    if Instant::now() >= deadline {
                        break;
                    }
                }
                break status
                    .success()
                    .then(|| String::from_utf8_lossy(&bytes).into_owned());
            }
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            _ => break None,
        }
    };
    // This shell exists only for lookup. Reclaim startup jobs in its private
    // process group as well, including children that inherited stdout.
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.wait();
    result
}

pub(crate) fn executable_path(stdout: &str) -> Option<String> {
    use std::os::unix::fs::PermissionsExt;
    stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| {
            let path = Path::new(line);
            path.is_absolute()
                && path
                    .metadata()
                    .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
                    .unwrap_or(false)
        })
        .map(str::to_owned)
}

/// `lookup` is a fixed built-in command (e.g. `command -v codex`), never user input.
pub(crate) fn find_in_login_shell(lookup: &str) -> Option<String> {
    for (shell, args) in [
        ("/bin/zsh", vec!["-l", "-c", lookup]),
        ("/bin/bash", vec!["-lc", lookup]),
    ] {
        if let Some(path) = shell_stdout(shell, &args, Duration::from_secs(2))
            .as_deref()
            .and_then(executable_path)
        {
            return Some(path);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banner_and_inherited_stdout_do_not_block_discovery() {
        let start = Instant::now();
        let stdout = shell_stdout(
            "/bin/sh",
            &["-c", "sleep 30 & printf 'welcome\\n/bin/sh\\n'"],
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(executable_path(&stdout), Some("/bin/sh".into()));
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn hung_or_noisy_shell_is_bounded() {
        for script in [
            "echo $$; sleep 30",
            "echo $$; while :; do echo banner; done",
        ] {
            let start = Instant::now();
            assert!(shell_stdout("/bin/sh", &["-c", script], Duration::from_millis(100)).is_none());
            assert!(start.elapsed() < Duration::from_secs(2));
        }
    }

    #[test]
    fn large_startup_banner_keeps_final_path_without_pipe_deadlock() {
        let stdout = shell_stdout("/bin/sh", &["-c", "i=0; while [ $i -lt 20000 ]; do echo banner; i=$((i+1)); done; printf '/bin/sh\\n'"], Duration::from_secs(3)).unwrap();
        assert!(stdout.len() <= 64 * 1024);
        assert_eq!(executable_path(&stdout), Some("/bin/sh".into()));
    }

    #[test]
    fn missing_shell_failure_and_invalid_paths_allow_fallback() {
        assert!(shell_stdout("/nonexistent/wise-shell", &[], Duration::from_millis(100)).is_none());
        assert!(shell_stdout("/bin/sh", &["-c", "exit 1"], Duration::from_millis(100)).is_none());
        assert!(executable_path("welcome\nrelative/bin\n/tmp\n").is_none());
        let file = tempfile::NamedTempFile::new().unwrap();
        assert!(executable_path(file.path().to_str().unwrap()).is_none());
    }
}
