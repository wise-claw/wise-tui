use portable_pty::{ChildKiller, CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

use super::{claude_path_search_prefixes, merge_path_env};

/// PTY reader 线程上限：触发 emit 的字节阈值（保留每次 emit 较小，防止单条 IPC payload 巨大）。
const TERMINAL_EMIT_FLUSH_BYTES: usize = 16 * 1024;
/// PTY reader 线程上限：触发 emit 的时间阈值（避免低速输出时延迟过高）。
const TERMINAL_EMIT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);

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

        let pair = self
            .pty_system
            .openpty(PtySize {
                rows,
                cols,
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
                        {
                            flush_pending(&mut pending, &mut last_flush);
                        }
                    }
                    Err(_) => break,
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
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
        session.writer.flush().map_err(|e| e.to_string())
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
        session
            .master
            .resize(PtySize {
                rows,
                cols,
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
    use super::drain_valid_utf8_chunks;

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
}
