use portable_pty::{ChildKiller, CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

use super::{claude_path_search_prefixes, merge_path_env};

/// PTY reader 线程上限：触发 emit 的字节阈值（保留每次 emit 较小，防止单条 IPC payload 巨大）。
const TERMINAL_EMIT_FLUSH_BYTES: usize = 16 * 1024;
/// PTY reader 线程上限：触发 emit 的时间阈值（避免低速输出时延迟过高）。
const TERMINAL_EMIT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
/// pending 文本硬上限：防止前端阻塞时 reader 端无限增长 (~1 MiB 已经远超单帧渲染需要)。
const TERMINAL_PENDING_HARD_CAP: usize = 1024 * 1024;
/// PTY 行/列合法范围：防止 0 或异常大值传入 OS。
const TERMINAL_DIM_MIN: u16 = 1;
const TERMINAL_DIM_MAX: u16 = 1024;
/// 写入端遇到 Interrupted/WouldBlock 时的最大重试次数。
const TERMINAL_WRITE_RETRIES: u32 = 5;

/// Split PTY byte stream on UTF-8 boundaries so xterm never receives torn multibyte
/// sequences (which corrupt alternate-screen TUIs like Claude Code).
fn drain_valid_utf8_chunks(carry: &mut Vec<u8>) -> Vec<String> {
    let mut chunks = Vec::new();
    loop {
        if carry.is_empty() {
            break;
        }
        match std::str::from_utf8(carry.as_slice()) {
            Ok(text) => {
                chunks.push(text.to_string());
                carry.clear();
                break;
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                if valid_up_to > 0 {
                    if let Ok(text) = std::str::from_utf8(&carry[..valid_up_to]) {
                        chunks.push(text.to_string());
                    }
                    carry.drain(0..valid_up_to);
                    continue;
                }
                if let Some(invalid_len) = error.error_len() {
                    let skip = invalid_len.min(carry.len());
                    carry.drain(0..skip);
                    continue;
                }
                break;
            }
        }
    }
    chunks
}

/// PTY shells spawned from the GUI often inherit a weak or missing `TERM` and trigger
/// zsh `PROMPT_SP` (inverted `%` on its own line) when themes — especially p10k instant
/// prompt — write startup output without a trailing newline.
fn apply_embedded_terminal_shell_env(cmd: &mut CommandBuilder) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("WISE_TERMINAL", "1");
    cmd.env("POWERLEVEL9K_INSTANT_PROMPT", "off");
    cmd.env("PROMPT_EOL_MARK", "");
}

struct TerminalSession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

pub(crate) struct TerminalManager {
    pty_system: NativePtySystem,
    sessions: HashMap<String, TerminalSession>,
}

impl TerminalManager {
    pub(crate) fn new() -> Self {
        Self {
            pty_system: NativePtySystem::default(),
            sessions: HashMap::new(),
        }
    }

    fn open(
        &mut self,
        workspace_id: String,
        terminal_id: String,
        cols: u16,
        rows: u16,
        cwd: String,
        app: &tauri::AppHandle,
    ) -> Result<(), String> {
        let key = format!("{}:{}", workspace_id, terminal_id);
        if self.sessions.contains_key(&key) {
            return Err(format!("Terminal session already exists: {}", key));
        }

        // clamp 维度，避免前端早期布局给出 0/异常值导致 openpty 失败或 shell 启动后立即被信号终止。
        let safe_cols = cols.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX);
        let safe_rows = rows.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX);

        let pair = self
            .pty_system
            .openpty(PtySize {
                rows: safe_rows,
                cols: safe_cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = if cfg!(windows) {
            CommandBuilder::new("cmd.exe")
        } else {
            let mut zsh = CommandBuilder::new("zsh");
            zsh.arg("-il");
            apply_embedded_terminal_shell_env(&mut zsh);
            zsh
        };
        cmd.cwd(cwd);
        // GUI 进程继承的 PATH 通常不含 Homebrew / nvm / bun 等，与 `create_claude_command` 一致为 PTY shell 补全 PATH。
        let path_merged = merge_path_env(&claude_path_search_prefixes());
        cmd.env("PATH", path_merged);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let master = pair.master;
        let mut reader = master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let writer = master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let killer = child.clone_killer();

        let workspace_clone = workspace_id.clone();
        let terminal_clone = terminal_id.clone();
        let session_key = key.clone();
        let app_clone = app.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            // carry：尚未拼成完整 UTF-8 的尾巴；pending：已经拼好但还没 emit 的合批文本。
            let mut carry = Vec::new();
            let mut pending = String::new();
            let mut last_flush = Instant::now();
            // reader 退出时的原因——成功 EOF 时为 None；fatal IO 错误时填上错误描述，前端用以区分崩溃。
            let mut exit_reason: Option<String> = None;

            // 把 pending 一次性 emit 出去（仅当非空才 emit，避免空消息浪费 IPC）。
            let flush_pending = |pending: &mut String, last_flush: &mut Instant| {
                if pending.is_empty() {
                    return;
                }
                let _ = app_clone.emit(
                    "terminal-output",
                    serde_json::json!({
                        "workspaceId": workspace_clone,
                        "terminalId": terminal_clone,
                        "data": pending.as_str(),
                    }),
                );
                pending.clear();
                *last_flush = Instant::now();
            };

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        carry.extend_from_slice(&buf[..n]);
                        for text in drain_valid_utf8_chunks(&mut carry) {
                            pending.push_str(&text);
                        }
                        // 大块或长间隔时才 emit；高速流式输出会自然堆到 16 KiB 触发，节流明显。
                        if pending.len() >= TERMINAL_EMIT_FLUSH_BYTES
                            || last_flush.elapsed() >= TERMINAL_EMIT_FLUSH_INTERVAL
                            || pending.len() >= TERMINAL_PENDING_HARD_CAP
                        {
                            flush_pending(&mut pending, &mut last_flush);
                        }
                    }
                    Err(err) => {
                        // EINTR / 临时不可用都不应当让 PTY reader 意外终止；只在真正的 IO 错误时退出。
                        match err.kind() {
                            ErrorKind::Interrupted | ErrorKind::WouldBlock => continue,
                            _ => {
                                exit_reason = Some(err.to_string());
                                break;
                            }
                        }
                    }
                }
            }
            // 退出前把 carry 里残留的不完整字节按 lossy 转成文本拼到 pending 末尾再 emit。
            if !carry.is_empty() {
                pending.push_str(&String::from_utf8_lossy(&carry));
            }
            flush_pending(&mut pending, &mut last_flush);

            let _ = app_clone.emit(
                "terminal-exit",
                serde_json::json!({
                    "workspaceId": workspace_clone,
                    "terminalId": terminal_clone,
                    "exitCode": 0,
                    "reason": exit_reason,
                }),
            );

            // PTY 已经 EOF/Err，主动从 manager 移除会话，释放 PtyMaster/writer/killer 持有的内核 fd 与缓冲；
            // 否则若前端没卸载/没显式 close，旧 session 会一直留在 HashMap 里慢性泄漏。
            if let Some(manager) = app_clone.try_state::<Mutex<TerminalManager>>() {
                if let Ok(mut guard) = manager.lock() {
                    if let Some(mut session) = guard.sessions.remove(&session_key) {
                        // EOF 后再 kill 一次是幂等的，确保子进程被回收（防止 reader 看到 EOF 但 child 已 detach 残留）。
                        let _ = session.killer.kill();
                    }
                }
            }
        });

        self.sessions
            .insert(key, TerminalSession { master, writer, killer });

        Ok(())
    }

    fn write(&mut self, workspace_id: &str, terminal_id: &str, data: &str) -> Result<(), String> {
        let key = format!("{}:{}", workspace_id, terminal_id);
        let session = self
            .sessions
            .get_mut(&key)
            .ok_or_else(|| format!("Terminal session not found: {}", key))?;
        let bytes = data.as_bytes();
        // 写入端遇到 EINTR/WouldBlock 时重试若干次，避免输入丢失或被前端报为致命错误。
        let mut attempt: u32 = 0;
        loop {
            match session.writer.write_all(bytes) {
                Ok(()) => break,
                Err(err) => {
                    let kind = err.kind();
                    if (kind == ErrorKind::Interrupted || kind == ErrorKind::WouldBlock)
                        && attempt < TERMINAL_WRITE_RETRIES
                    {
                        attempt += 1;
                        std::thread::sleep(Duration::from_millis(2u64.pow(attempt)));
                        continue;
                    }
                    return Err(format!("Failed to write to PTY: {}", err));
                }
            }
        }
        // flush 失败通常意味着对端 (slave) 已经关闭，向上抛错让前端清理状态。
        session
            .writer
            .flush()
            .map_err(|e| format!("Failed to flush PTY: {}", e))
    }

    fn resize(
        &mut self,
        workspace_id: &str,
        terminal_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let key = format!("{}:{}", workspace_id, terminal_id);
        let session = self
            .sessions
            .get(&key)
            .ok_or_else(|| format!("Terminal session not found: {}", key))?;
        // clamp 到合理区间，前端 ResizeObserver 在容器折叠瞬间可能给出 0/异常巨大值。
        let safe_cols = cols.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX);
        let safe_rows = rows.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX);
        session
            .master
            .resize(PtySize {
                rows: safe_rows,
                cols: safe_cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {}", e))
    }

    fn close(&mut self, workspace_id: &str, terminal_id: &str) -> Result<(), String> {
        let key = format!("{}:{}", workspace_id, terminal_id);
        let mut session = self
            .sessions
            .remove(&key)
            .ok_or_else(|| format!("Terminal session not found: {}", key))?;
        let _ = session.killer.kill();
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn terminal_open(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    app: tauri::AppHandle,
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
    cwd: String,
) -> Result<(), String> {
    manager.lock().map_err(|e| e.to_string())?.open(
        workspace_id,
        terminal_id,
        cols,
        rows,
        cwd,
        &app,
    )
}

#[tauri::command]
pub(crate) fn terminal_write(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    workspace_id: String,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    manager
        .lock()
        .map_err(|e| e.to_string())?
        .write(&workspace_id, &terminal_id, &data)
}

#[tauri::command]
pub(crate) fn terminal_resize(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager
        .lock()
        .map_err(|e| e.to_string())?
        .resize(&workspace_id, &terminal_id, cols, rows)
}

#[tauri::command]
pub(crate) fn terminal_close(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    workspace_id: String,
    terminal_id: String,
) -> Result<(), String> {
    manager
        .lock()
        .map_err(|e| e.to_string())?
        .close(&workspace_id, &terminal_id)
}

#[cfg(test)]
mod tests {
    use super::{drain_valid_utf8_chunks, TERMINAL_DIM_MAX, TERMINAL_DIM_MIN};

    #[test]
    fn drain_valid_utf8_chunks_waits_for_complete_multibyte() {
        let mut carry = vec![0xE4, 0xB8];
        assert!(drain_valid_utf8_chunks(&mut carry).is_empty());
        assert_eq!(carry, vec![0xE4, 0xB8]);

        carry.push(0xAD);
        let chunks = drain_valid_utf8_chunks(&mut carry);
        assert_eq!(chunks, vec!["中".to_string()]);
        assert!(carry.is_empty());
    }

    #[test]
    fn drain_valid_utf8_chunks_emits_ascii_prefix_before_partial_tail() {
        let mut carry = b"abc\xe4\xb8".to_vec();
        let chunks = drain_valid_utf8_chunks(&mut carry);
        assert_eq!(chunks, vec!["abc".to_string()]);
        assert_eq!(carry, vec![0xE4, 0xB8]);
    }

    #[test]
    fn drain_valid_utf8_chunks_skips_invalid_lead_byte() {
        // 完整不可恢复的非法字节（独立的 0xC0），按 error_len 跳过，避免 reader 死循环。
        let mut carry = b"\xc0a".to_vec();
        let chunks = drain_valid_utf8_chunks(&mut carry);
        assert_eq!(chunks, vec!["a".to_string()]);
        assert!(carry.is_empty());
    }

    #[test]
    fn terminal_dim_bounds_are_sane() {
        assert!(TERMINAL_DIM_MIN >= 1);
        assert!(TERMINAL_DIM_MAX >= 80);
        assert!(TERMINAL_DIM_MAX <= 4096);
        // clamp 行为：常见 80x24 不被改动，0 与超大值都被收束。
        assert_eq!(80u16.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX), 80);
        assert_eq!(0u16.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX), TERMINAL_DIM_MIN);
        assert_eq!(
            u16::MAX.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX),
            TERMINAL_DIM_MAX
        );
    }
}
