use portable_pty::{ChildKiller, CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::{Read, Write};
use tauri::Emitter;

use super::{claude_path_search_prefixes, merge_path_env};

struct TerminalSession {
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

        let shell = if cfg!(windows) { "cmd.exe" } else { "zsh" };
        let mut cmd = CommandBuilder::new(shell);
        cmd.cwd(cwd);
        // GUI 进程继承的 PATH 通常不含 Homebrew / nvm / bun 等，与 `create_claude_command` 一致为 PTY shell 补全 PATH。
        let path_merged = merge_path_env(&claude_path_search_prefixes());
        cmd.env("PATH", path_merged);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let killer = child.clone_killer();

        let workspace_clone = workspace_id.clone();
        let terminal_clone = terminal_id.clone();
        let app_clone = app.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_clone.emit(
                            "terminal-output",
                            serde_json::json!({
                                "workspaceId": workspace_clone,
                                "terminalId": terminal_clone,
                                "data": text,
                            }),
                        );
                    }
                    Err(_) => break,
                }
            }
            let _ = app_clone.emit(
                "terminal-exit",
                serde_json::json!({
                    "workspaceId": workspace_clone,
                    "terminalId": terminal_clone,
                    "exitCode": 0,
                }),
            );
        });

        self.sessions
            .insert(key, TerminalSession { writer, killer });

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
        _workspace_id: &str,
        _terminal_id: &str,
        _cols: u16,
        _rows: u16,
    ) -> Result<(), String> {
        // Portable PTY resize is handled at the OS level.
        // The frontend fit addon handles display sizing.
        Ok(())
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
