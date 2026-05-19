use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeHostProcess {
    pid: u32,
    memory_bytes: u64,
    session_id: Option<String>,
    project_path: Option<String>,
    /// `resume_arg` | `lsof_jsonl`
    session_source: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemResourceSnapshot {
    system_total_bytes: u64,
    system_used_bytes: u64,
    app_memory_bytes: u64,
    claude_process_count: u64,
    claude_memory_bytes: u64,
    claude_processes: Vec<ClaudeHostProcess>,
}

fn parse_kb_to_bytes(input: &str) -> Option<u64> {
    let v = input.trim().parse::<u64>().ok()?;
    Some(v.saturating_mul(1024))
}

fn parse_ps_rss_kb_for_pid(pid: u32) -> Option<u64> {
    let output = Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    parse_kb_to_bytes(text.trim())
}

fn is_safe_claude_session_id(name: &str) -> bool {
    let len = name.len();
    (32..=48).contains(&len) && name.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn is_claude_process_line(comm: &str, args_lower: &str) -> bool {
    let comm_lower = comm.to_lowercase();
    comm_lower == "claude"
        || comm_lower == "claude-code"
        || args_lower.contains(" claude ")
        || args_lower.contains("/claude ")
        || args_lower.contains("claude-code")
}

/// 从 `claude … -r <session_id>` / `--resume` 解析会话 id。
fn session_id_from_claude_args(args: &str) -> Option<String> {
    let parts: Vec<&str> = args.split_whitespace().collect();
    let mut i = 0;
    while i < parts.len() {
        let flag = parts[i];
        if flag == "-r" || flag == "--resume" {
            if let Some(sid) = parts.get(i + 1) {
                let s = sid.trim();
                if is_safe_claude_session_id(s) {
                    return Some(s.to_string());
                }
            }
            i += 2;
            continue;
        }
        i += 1;
    }
    None
}

/// 将 `~/.claude/projects/` 下编码目录名还原为绝对路径（与 `disk_sessions::encoded_claude_project_dir` 互逆）。
fn decode_claude_project_dir(encoded: &str) -> Option<String> {
    let enc = encoded.strip_prefix('-')?;
    if enc.is_empty() {
        return None;
    }
    #[cfg(windows)]
    {
        let path = enc.replace('-', "\\");
        Some(path)
    }
    #[cfg(not(windows))]
    {
        let path = enc.replace('-', "/");
        Some(format!("/{path}"))
    }
}

/// 从 Claude jsonl 绝对路径解析 `(session_id, project_path)`。
fn session_from_claude_jsonl_path(path: &str) -> Option<(String, String)> {
    let normalized = path.replace('\\', "/");
    let marker = "/.claude/projects/";
    let idx = normalized.find(marker)?;
    let rest = &normalized[idx + marker.len()..];
    let (encoded, filename) = rest.split_once('/')?;
    let session_id = filename.strip_suffix(".jsonl")?;
    if !is_safe_claude_session_id(session_id) {
        return None;
    }
    let project_path = decode_claude_project_dir(encoded)?;
    Some((session_id.to_string(), project_path))
}

#[cfg(unix)]
fn enrich_session_from_lsof(pid: u32) -> Option<(String, String)> {
    let output = Command::new("lsof")
        .args(["-n", "-P", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let trimmed = line.trim();
        if !trimmed.ends_with(".jsonl") {
            continue;
        }
        let path = trimmed.split_whitespace().last()?;
        if let Some(pair) = session_from_claude_jsonl_path(path) {
            return Some(pair);
        }
    }
    None
}

#[cfg(not(unix))]
fn enrich_session_from_lsof(_pid: u32) -> Option<(String, String)> {
    None
}

struct RawClaudePsRow {
    pid: u32,
    memory_bytes: u64,
    args: String,
}

fn collect_raw_claude_ps_rows() -> Vec<RawClaudePsRow> {
    let output = match Command::new("ps")
        .args(["-axo", "pid=,rss=,comm=,args="])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut out = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut cols = trimmed.split_whitespace();
        let Some(pid_s) = cols.next() else {
            continue;
        };
        let Some(rss_kb) = cols.next() else {
            continue;
        };
        let Some(comm) = cols.next() else {
            continue;
        };
        let args = cols.collect::<Vec<_>>().join(" ");
        let args_lower = args.to_lowercase();
        if !is_claude_process_line(comm, &args_lower) {
            continue;
        }
        let Ok(pid) = pid_s.parse::<u32>() else {
            continue;
        };
        let Some(memory_bytes) = parse_kb_to_bytes(rss_kb) else {
            continue;
        };
        out.push(RawClaudePsRow {
            pid,
            memory_bytes,
            args,
        });
    }
    out
}

fn collect_claude_host_processes() -> Vec<ClaudeHostProcess> {
    let rows = collect_raw_claude_ps_rows();
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let mut session_id = session_id_from_claude_args(&row.args);
        let mut project_path = None;
        let mut session_source = session_id.as_ref().map(|_| "resume_arg".to_string());

        if session_id.is_none() {
            if let Some((sid, path)) = enrich_session_from_lsof(row.pid) {
                session_id = Some(sid);
                project_path = Some(path);
                session_source = Some("lsof_jsonl".to_string());
            }
        }

        out.push(ClaudeHostProcess {
            pid: row.pid,
            memory_bytes: row.memory_bytes,
            session_id,
            project_path,
            session_source,
        });
    }
    out
}

#[cfg(target_os = "macos")]
fn collect_system_memory_bytes() -> (u64, u64) {
    let total = Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0);

    let vm_text = Command::new("vm_stat")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .unwrap_or_default();

    let mut page_size: u64 = 4096;
    for line in vm_text.lines() {
        if let Some(start) = line.find("page size of ") {
            let rest = &line[start + "page size of ".len()..];
            if let Some(end) = rest.find(" bytes") {
                if let Ok(parsed) = rest[..end].trim().parse::<u64>() {
                    page_size = parsed;
                }
            }
            break;
        }
    }

    let mut used_pages: u64 = 0;
    for key in [
        "Pages active",
        "Pages inactive",
        "Pages speculative",
        "Pages wired down",
        "Pages occupied by compressor",
    ] {
        if let Some(line) = vm_text.lines().find(|l| l.starts_with(key)) {
            let num = line
                .split(':')
                .nth(1)
                .unwrap_or("")
                .trim()
                .trim_end_matches('.');
            if let Ok(v) = num.replace('.', "").parse::<u64>() {
                used_pages = used_pages.saturating_add(v);
            }
        }
    }

    let used = used_pages.saturating_mul(page_size);
    (total, used.min(total))
}

#[cfg(not(target_os = "macos"))]
fn collect_system_memory_bytes() -> (u64, u64) {
    (0, 0)
}

#[tauri::command]
pub fn get_system_resource_snapshot() -> SystemResourceSnapshot {
    let (system_total_bytes, system_used_bytes) = collect_system_memory_bytes();
    let app_memory_bytes = parse_ps_rss_kb_for_pid(std::process::id()).unwrap_or(0);
    let claude_processes = collect_claude_host_processes();
    let claude_process_count = claude_processes.len() as u64;
    let claude_memory_bytes = claude_processes
        .iter()
        .fold(0u64, |sum, p| sum.saturating_add(p.memory_bytes));
    SystemResourceSnapshot {
        system_total_bytes,
        system_used_bytes,
        app_memory_bytes,
        claude_process_count,
        claude_memory_bytes,
        claude_processes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_id_from_resume_flag() {
        let sid = "a".repeat(36);
        let args = format!("claude -p hi -r {sid} --output-format stream-json");
        assert_eq!(session_id_from_claude_args(&args).as_deref(), Some(sid.as_str()));
    }

    #[test]
    fn decode_project_dir_roundtrip_style() {
        let encoded = "-Users-sjl-Documents-github-wise";
        assert_eq!(
            decode_claude_project_dir(encoded).as_deref(),
            Some("/Users/sjl/Documents/github/wise")
        );
    }

    #[test]
    fn session_from_jsonl_path() {
        let path = "/Users/sjl/.claude/projects/-Users-sjl-Documents-github-wise/abcdabcdabcdabcdabcdabcdabcdabcd.jsonl";
        let sid = "abcdabcdabcdabcdabcdabcdabcdabcd";
        let (parsed_sid, project) = session_from_claude_jsonl_path(path).expect("parse");
        assert_eq!(parsed_sid, sid);
        assert_eq!(project, "/Users/sjl/Documents/github/wise");
    }

    #[test]
    fn rejects_invalid_session_filename() {
        let path = "/Users/sjl/.claude/projects/-Users-sjl-Documents-github-wise/short.jsonl";
        assert!(session_from_claude_jsonl_path(path).is_none());
    }
}
