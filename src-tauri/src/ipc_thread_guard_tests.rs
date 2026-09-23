//! Tauri runs sync `#[tauri::command]` bodies inline on the IPC thread, which is the
//! macOS main thread: waiting on a child process or libgit2 there freezes the UI.
//! Such commands must be `async` and hop to `spawn_blocking`.
//!
//! This is a lexical check of command bodies only; helpers called from a sync
//! command are not followed.

use regex::Regex;
use std::path::Path;

const BLOCKING_MARKERS: &[&str] = &[
    ".output()",
    "run_git_command(",
    "open_repo(",
    "Repository::",
    "run_osascript(",
    "blocking_output_with_timeout(",
];

fn sync_command_offenders(file: &Path, src: &str) -> Vec<String> {
    let command = Regex::new(
        r"#\[tauri::command(\([^)]*\))?\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([a-z]+\))?\s+)?(async\s+)?fn\s+(\w+)",
    )
    .unwrap();
    let mut out = Vec::new();
    for caps in command.captures_iter(src) {
        let is_async = caps.get(2).is_some()
            || caps.get(1).is_some_and(|attr| attr.as_str().contains("async"));
        if is_async {
            continue;
        }
        let start = caps.get(0).unwrap().end();
        let end = src[start..].find("\n}\n").map_or(src.len(), |i| start + i);
        let body = &src[start..end];
        if let Some(marker) = BLOCKING_MARKERS.iter().find(|m| body.contains(*m)) {
            out.push(format!("{}::{} uses {marker}", file.display(), &caps[3]));
        }
    }
    out
}

#[test]
fn sync_commands_do_not_wait_on_processes_or_git() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut offenders = Vec::new();
    for entry in walkdir::WalkDir::new(&root).into_iter().flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") || path.ends_with(file!()) {
            continue;
        }
        let src = std::fs::read_to_string(path).unwrap();
        let rel = path.strip_prefix(&root).unwrap();
        offenders.extend(sync_command_offenders(rel, &src));
    }
    assert!(
        offenders.is_empty(),
        "make these commands async + spawn_blocking:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn guard_detects_sync_and_ignores_async_commands() {
    let src = r#"
#[tauri::command]
pub(crate) fn slow(path: String) -> Result<(), String> {
    Command::new("git").output();
}

#[tauri::command]
pub(crate) async fn fine(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || Command::new("git").output()).await
}

#[tauri::command(async)]
fn also_fine() {
    open_repo(&p);
}

#[tauri::command]
fn cheap() -> bool {
    true
}
"#;
    let offenders = sync_command_offenders(Path::new("x.rs"), src);
    assert_eq!(offenders, vec!["x.rs::slow uses .output()".to_string()]);
}
