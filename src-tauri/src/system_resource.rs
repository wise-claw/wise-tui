use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::Mutex as TokioMutex;

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

/// Per-PID lsof enrichment cache (session_id + project_path). Avoids spawning lsof every poll tick.
const LSOF_CACHE_TTL: Duration = Duration::from_secs(45);
/// 多窗口的轮询通常会在同一秒抵达；短缓存可合并昂贵的 ps/vm_stat/lsof 扫描。
const SNAPSHOT_CACHE_TTL: Duration = Duration::from_secs(2);

struct LsofCacheEntry {
    at: Instant,
    value: Option<(String, String)>,
}

static LSOF_CACHE: Mutex<Option<HashMap<u32, LsofCacheEntry>>> = Mutex::new(None);

struct CachedSystemResourceSnapshot {
    at: Instant,
    value: SystemResourceSnapshot,
}

/// 锁在刷新期间保持占用，使并发调用等待并复用同一份结果，而不是重复派生系统命令。
static SNAPSHOT_CACHE: TokioMutex<Option<CachedSystemResourceSnapshot>> =
    TokioMutex::const_new(None);

fn parse_kb_to_bytes(input: &str) -> Option<u64> {
    let v = input.trim().parse::<u64>().ok()?;
    Some(v.saturating_mul(1024))
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
fn enrich_sessions_from_lsof(pids: &[u32]) -> HashMap<u32, (String, String)> {
    if pids.is_empty() {
        return HashMap::new();
    }
    let pid_list = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let Ok(output) = Command::new("lsof")
        // Field mode only emits PID/name records; avoids formatting and buffering the full table.
        .args(["-n", "-P", "-Fpn", "-p", &pid_list])
        .output()
    else {
        return HashMap::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    parse_lsof_session_rows(&text, pids)
}

#[cfg(unix)]
fn parse_lsof_session_rows(text: &str, pids: &[u32]) -> HashMap<u32, (String, String)> {
    let expected = pids.iter().copied().collect::<HashSet<_>>();
    let mut found = HashMap::new();
    let mut current_pid = None;
    for line in text.lines() {
        if let Some(raw_pid) = line.strip_prefix('p') {
            current_pid = raw_pid
                .trim()
                .parse::<u32>()
                .ok()
                .filter(|pid| expected.contains(pid));
            continue;
        }
        let Some(path) = line.strip_prefix('n') else {
            continue;
        };
        let Some(pid) = current_pid else {
            continue;
        };
        if found.contains_key(&pid) || !path.trim().ends_with(".jsonl") {
            continue;
        }
        if let Some(pair) = session_from_claude_jsonl_path(path.trim()) {
            found.insert(pid, pair);
        }
    }
    found
}

#[cfg(not(unix))]
fn enrich_sessions_from_lsof(_pids: &[u32]) -> HashMap<u32, (String, String)> {
    HashMap::new()
}

/// Cached batch lsof enrichment. A snapshot pays for at most one lsof process even when several
/// Claude hosts lack a resume argument; fresh positive and negative cache entries are both reused.
fn enrich_sessions_from_lsof_cached(pids: &[u32]) -> HashMap<u32, Option<(String, String)>> {
    let now = Instant::now();
    let mut values = HashMap::new();
    let mut missing = Vec::new();
    if let Ok(guard) = LSOF_CACHE.lock() {
        if let Some(cache) = guard.as_ref() {
            for &pid in pids {
                if let Some(entry) = cache.get(&pid) {
                    if now.duration_since(entry.at) < LSOF_CACHE_TTL {
                        values.insert(pid, entry.value.clone());
                        continue;
                    }
                }
                missing.push(pid);
            }
        } else {
            missing.extend_from_slice(pids);
        }
    } else {
        missing.extend_from_slice(pids);
    }
    missing.sort_unstable();
    missing.dedup();

    let discovered = enrich_sessions_from_lsof(&missing);
    for &pid in &missing {
        values.insert(pid, discovered.get(&pid).cloned());
    }
    if let Ok(mut guard) = LSOF_CACHE.lock() {
        let cache = guard.get_or_insert_with(HashMap::new);
        for pid in missing {
            let value = discovered.get(&pid).cloned();
            cache.insert(pid, LsofCacheEntry { at: now, value });
        }
        // Bound growth: drop entries older than 2× TTL.
        cache.retain(|_, entry| now.duration_since(entry.at) < LSOF_CACHE_TTL * 2);
    }
    values
}

/// Read cached lsof enrichment without spawning a new process.
fn peek_lsof_cache(pid: u32) -> Option<(String, String)> {
    let now = Instant::now();
    let Ok(guard) = LSOF_CACHE.lock() else {
        return None;
    };
    let cache = guard.as_ref()?;
    let entry = cache.get(&pid)?;
    if now.duration_since(entry.at) >= LSOF_CACHE_TTL {
        return None;
    }
    entry.value.clone()
}

struct RawClaudePsRow {
    pid: u32,
    memory_bytes: u64,
    resume_session_id: Option<String>,
}

fn parse_process_snapshot(text: &str, app_pid: u32) -> (u64, Vec<RawClaudePsRow>) {
    let mut app_memory_bytes = 0;
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
        let Ok(pid) = pid_s.parse::<u32>() else {
            continue;
        };
        let Some(memory_bytes) = parse_kb_to_bytes(rss_kb) else {
            continue;
        };
        if pid == app_pid {
            app_memory_bytes = memory_bytes;
        }

        let args = cols.collect::<Vec<_>>().join(" ");
        let args_lower = args.to_lowercase();
        if !is_claude_process_line(comm, &args_lower) {
            continue;
        }
        out.push(RawClaudePsRow {
            pid,
            memory_bytes,
            resume_session_id: session_id_from_claude_args(&args),
        });
    }
    (app_memory_bytes, out)
}

/// 一次 ps 同时取得 Wise 自身 RSS 与 Claude 进程，避免每轮重复派生 ps。
fn collect_process_snapshot() -> (u64, Vec<RawClaudePsRow>) {
    let output = match Command::new("ps")
        .args(["-axo", "pid=,rss=,comm=,args="])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return (0, Vec::new()),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    parse_process_snapshot(&text, std::process::id())
}

fn collect_claude_host_processes(rows: Vec<RawClaudePsRow>) -> Vec<ClaudeHostProcess> {
    let unresolved_pids = rows
        .iter()
        .filter(|row| row.resume_session_id.is_none())
        .map(|row| row.pid)
        .collect::<Vec<_>>();
    let lsof_values = enrich_sessions_from_lsof_cached(&unresolved_pids);
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let mut session_id = row.resume_session_id;
        let mut project_path = None;
        let mut session_source = session_id.as_ref().map(|_| "resume_arg".to_string());

        if session_id.is_none() {
            if let Some((lsof_sid, path)) = lsof_values.get(&row.pid).cloned().flatten() {
                session_id = Some(lsof_sid);
                session_source = Some("lsof_jsonl".to_string());
                project_path = Some(path);
            }
        } else if let Some((_, path)) = peek_lsof_cache(row.pid) {
            // Already have session from args — reuse cache for project path, never spawn.
            project_path = Some(path);
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
    static SYSTEM_TOTAL_BYTES: OnceLock<u64> = OnceLock::new();
    let total = *SYSTEM_TOTAL_BYTES.get_or_init(|| {
        Command::new("sysctl")
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
            .unwrap_or(0)
    });

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

/// 终止本机扫描到的 Claude 子进程（无 Wise 注册表 / session 绑定时用 PID）。
#[tauri::command]
pub fn kill_claude_host_process(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("无效 PID".to_string());
    }
    #[cfg(unix)]
    {
        use std::process::Command;
        let status = Command::new("kill")
            .arg(pid.to_string())
            .status()
            .map_err(|e| format!("kill 失败: {}", e))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "kill 未能结束进程 {}（退出码 {:?}）",
                pid,
                status.code()
            ))
        }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        Err("当前平台不支持按 PID 终止进程".to_string())
    }
}

fn get_system_resource_snapshot_blocking() -> SystemResourceSnapshot {
    let (system_total_bytes, system_used_bytes) = collect_system_memory_bytes();
    let (app_memory_bytes, raw_claude_processes) = collect_process_snapshot();
    let claude_processes = collect_claude_host_processes(raw_claude_processes);
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

#[tauri::command]
pub async fn get_system_resource_snapshot() -> SystemResourceSnapshot {
    let mut cache = SNAPSHOT_CACHE.lock().await;
    let now = Instant::now();
    if let Some(cached) = cache.as_ref() {
        if now.duration_since(cached.at) < SNAPSHOT_CACHE_TTL {
            return cached.value.clone();
        }
    }

    match tokio::task::spawn_blocking(get_system_resource_snapshot_blocking).await {
        Ok(snapshot) => {
            *cache = Some(CachedSystemResourceSnapshot {
                at: Instant::now(),
                value: snapshot.clone(),
            });
            snapshot
        }
        Err(_) => cache
            .as_ref()
            .map(|cached| cached.value.clone())
            .unwrap_or_else(|| SystemResourceSnapshot {
                system_total_bytes: 0,
                system_used_bytes: 0,
                app_memory_bytes: 0,
                claude_process_count: 0,
                claude_memory_bytes: 0,
                claude_processes: Vec::new(),
            }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_id_from_resume_flag() {
        let sid = "a".repeat(36);
        let args = format!("claude -p hi -r {sid} --output-format stream-json");
        assert_eq!(
            session_id_from_claude_args(&args).as_deref(),
            Some(sid.as_str())
        );
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

    #[test]
    fn process_snapshot_reuses_one_ps_result_for_app_and_claude() {
        let app_pid = 42;
        let text = concat!(
            "  42  1024 wise /Applications/Wise.app/Contents/MacOS/wise\n",
            "  77  2048 claude claude -p hi --resume abcdabcd-abcd-abcd-abcd-abcdabcdabcd\n",
            "  88   512 node node server.js\n",
            "broken row\n",
        );
        let (app_memory, rows) = parse_process_snapshot(text, app_pid);
        assert_eq!(app_memory, 1024 * 1024);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pid, 77);
        assert_eq!(rows[0].memory_bytes, 2048 * 1024);
        assert_eq!(
            rows[0].resume_session_id.as_deref(),
            Some("abcdabcd-abcd-abcd-abcd-abcdabcdabcd")
        );
    }

    #[cfg(unix)]
    #[test]
    fn parses_batched_lsof_rows_by_pid() {
        let text = concat!(
            "p77\n",
            "n/Users/me/.claude/projects/-tmp-repo/abcdabcdabcdabcdabcdabcdabcdabcd.jsonl\n",
            "p88\n",
            "n/tmp/unrelated.txt\n",
            "p99\n",
            "n/Users/me/.claude/projects/-tmp-other/dcbadcbadcbadcbadcbadcbadcba.jsonl\n",
        );
        let rows = parse_lsof_session_rows(text, &[77, 88]);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows.get(&77).map(|pair| pair.0.as_str()), Some("abcdabcdabcdabcdabcdabcdabcdabcd"));
        assert!(!rows.contains_key(&99));
    }
}
