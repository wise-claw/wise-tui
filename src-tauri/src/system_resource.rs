use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemResourceSnapshot {
    system_total_bytes: u64,
    system_used_bytes: u64,
    app_memory_bytes: u64,
    claude_process_count: u64,
    claude_memory_bytes: u64,
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

fn collect_claude_process_memory_bytes() -> (u64, u64) {
    let output = match Command::new("ps")
        .args(["-axo", "rss=,comm=,args="])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return (0, 0),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut count: u64 = 0;
    let mut total_bytes: u64 = 0;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut cols = trimmed.split_whitespace();
        let Some(rss_kb) = cols.next() else {
            continue;
        };
        let Some(comm) = cols.next() else {
            continue;
        };
        let args: String = cols.collect::<Vec<_>>().join(" ").to_lowercase();
        let comm_lower = comm.to_lowercase();
        let is_claude = comm_lower == "claude"
            || comm_lower == "claude-code"
            || args.contains(" claude ")
            || args.contains("/claude ")
            || args.contains("claude-code");
        if !is_claude {
            continue;
        }
        if let Some(bytes) = parse_kb_to_bytes(rss_kb) {
            count = count.saturating_add(1);
            total_bytes = total_bytes.saturating_add(bytes);
        }
    }
    (count, total_bytes)
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
    let (claude_process_count, claude_memory_bytes) = collect_claude_process_memory_bytes();
    SystemResourceSnapshot {
        system_total_bytes,
        system_used_bytes,
        app_memory_bytes,
        claude_process_count,
        claude_memory_bytes,
    }
}
