mod frame;

use portable_pty::{ChildKiller, CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

use alacritty_terminal::event::{Event as AlacrittyEvent, EventListener, WindowSize};
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::term::{Config as TermConfig, Term};
use alacritty_terminal::vte::ansi::{self, Rgb};

use super::{claude_path_search_prefixes, merge_path_env};
use frame::{serialize_frame, TerminalFrameDto};

/// PTY reader 线程上限：触发 emit 的字节阈值（保留每次 emit 较小，防止单条 IPC payload 巨大）。
const TERMINAL_EMIT_FLUSH_BYTES: usize = 16 * 1024;
/// 空闲 flush 间隔：阻塞 read 本身不会“过一会儿再醒”，必须用超时等待才能在交互提示符后及时刷出画面。
const TERMINAL_EMIT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
/// pending 文本硬上限：防止前端阻塞时 reader 端无限增长 (~1 MiB 已经远超单帧渲染需要)。
const TERMINAL_PENDING_HARD_CAP: usize = 1024 * 1024;
/// 会话输出环形缓冲上限（借鉴 OpenCode Pty buffer，用于 attach 重放）。
const TERMINAL_BUFFER_MAX: usize = 1024 * 1024;
/// 缓冲裁剪块大小。
const TERMINAL_BUFFER_TRIM_CHUNK: usize = 64 * 1024;
/// PTY 行/列合法范围：防止 0 或异常大值传入 OS。
const TERMINAL_DIM_MIN: u16 = 1;
const TERMINAL_DIM_MAX: u16 = 1024;
/// 写入端遇到 Interrupted/WouldBlock 时的最大重试次数。
const TERMINAL_WRITE_RETRIES: u32 = 5;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalSessionInfo {
    pub workspace_id: String,
    pub terminal_id: String,
    pub title: String,
    pub source: String,
    pub status: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub cursor: usize,
    /// 后台任务子进程 pid；交互终端（openTerminalSession）始终为 0。
    /// 助手模板「执行脚本」走 PTY 后即可通过此字段向运行面板展示 pid，
    /// 退出事件触发后仍可保留供排障追溯。
    #[serde(default)]
    pub pid: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalAttachResponse {
    pub cursor: usize,
    /// 原始字节文本重放（运行面板 / URL 检测等仍依赖纯文本）。
    pub replay: String,
    /// alacritty_terminal 可视网格快照，供内置终端 Canvas 渲染。
    pub frame: TerminalFrameDto,
}

/// 是否应立刻把 pending/dirty 刷到前端。
///
/// `reader_idle` 表示当前没有更多可读字节（recv 超时 / 即将回到阻塞 wait）。
/// 旧逻辑只在下一次 `read()` 成功时检查时间窗，交互 shell 打印完提示符后会一直卡住，
/// 直到用户再按键产生输出——M2 上更容易踩中这个时序。
fn should_flush_terminal_output(
    pending_len: usize,
    dirty: bool,
    last_flush_elapsed: Duration,
    reader_idle: bool,
) -> bool {
    if pending_len == 0 && !dirty {
        return false;
    }
    if pending_len >= TERMINAL_EMIT_FLUSH_BYTES || pending_len >= TERMINAL_PENDING_HARD_CAP {
        return true;
    }
    if reader_idle {
        return true;
    }
    last_flush_elapsed >= TERMINAL_EMIT_FLUSH_INTERVAL
}

enum PtyReaderEvent {
    Bytes(Vec<u8>),
    Error(String),
    Eof,
}

/// Split PTY byte stream on UTF-8 boundaries so text consumers never receive torn
/// multibyte sequences.
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
    cmd.env("TERM_PROGRAM", "Wise");
    cmd.env("WISE_TERMINAL", "1");
    cmd.env("POWERLEVEL9K_INSTANT_PROMPT", "off");
    cmd.env("PROMPT_EOL_MARK", "");
}

fn normalize_terminal_source(source: Option<String>) -> String {
    match source.as_deref() {
        Some("agent") => "agent".to_string(),
        Some("background-script") => "background-script".to_string(),
        _ => "user".to_string(),
    }
}

fn session_key(workspace_id: &str, terminal_id: &str) -> String {
    format!("{}:{}", workspace_id, terminal_id)
}

fn replay_output(
    output_buffer: &str,
    buffer_start_cursor: usize,
    stream_cursor: usize,
    client_cursor: usize,
) -> (usize, String) {
    if client_cursor >= stream_cursor {
        return (stream_cursor, String::new());
    }
    let offset = if client_cursor < buffer_start_cursor {
        0
    } else {
        client_cursor - buffer_start_cursor
    };
    let replay = if offset >= output_buffer.len() {
        String::new()
    } else {
        output_buffer[offset..].to_string()
    };
    (stream_cursor, replay)
}

fn default_indexed_rgb(index: usize) -> Rgb {
    match index {
        0 => Rgb { r: 0, g: 0, b: 0 },
        1 => Rgb { r: 205, g: 49, b: 49 },
        2 => Rgb { r: 13, g: 188, b: 121 },
        3 => Rgb { r: 229, g: 229, b: 16 },
        4 => Rgb { r: 36, g: 114, b: 200 },
        5 => Rgb { r: 188, g: 63, b: 188 },
        6 => Rgb { r: 17, g: 168, b: 205 },
        7 => Rgb { r: 229, g: 229, b: 229 },
        8 => Rgb { r: 102, g: 102, b: 102 },
        9 => Rgb { r: 241, g: 76, b: 76 },
        10 => Rgb { r: 35, g: 209, b: 139 },
        11 => Rgb { r: 245, g: 245, b: 67 },
        12 => Rgb { r: 59, g: 142, b: 234 },
        13 => Rgb { r: 214, g: 112, b: 214 },
        14 => Rgb { r: 41, g: 184, b: 219 },
        15 => Rgb { r: 255, g: 255, b: 255 },
        256 | 267 => Rgb { r: 0xd4, g: 0xd4, b: 0xd4 }, // foreground
        257 | 268 => Rgb { r: 0x1e, g: 0x1e, b: 0x1e }, // background
        258 => Rgb { r: 0xae, g: 0xaf, b: 0xad },       // cursor
        _ => Rgb { r: 0xd4, g: 0xd4, b: 0xd4 },
    }
}

#[derive(Clone)]
struct EventProxy {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    cols: Arc<Mutex<u16>>,
    rows: Arc<Mutex<u16>>,
}

impl EventListener for EventProxy {
    fn send_event(&self, event: AlacrittyEvent) {
        match event {
            AlacrittyEvent::PtyWrite(data) => {
                if let Ok(mut writer) = self.writer.lock() {
                    let _ = writer.write_all(data.as_bytes());
                    let _ = writer.flush();
                }
            }
            AlacrittyEvent::ColorRequest(index, format) => {
                let rgb = default_indexed_rgb(index);
                let seq = format(rgb);
                if let Ok(mut writer) = self.writer.lock() {
                    let _ = writer.write_all(seq.as_bytes());
                    let _ = writer.flush();
                }
            }
            AlacrittyEvent::TextAreaSizeRequest(format) => {
                let cols = self.cols.lock().map(|g| *g).unwrap_or(80);
                let rows = self.rows.lock().map(|g| *g).unwrap_or(24);
                let seq = format(WindowSize {
                    num_lines: rows,
                    num_cols: cols,
                    cell_width: 1,
                    cell_height: 1,
                });
                if let Ok(mut writer) = self.writer.lock() {
                    let _ = writer.write_all(seq.as_bytes());
                    let _ = writer.flush();
                }
            }
            AlacrittyEvent::ClipboardLoad(_, format) => {
                let seq = format("");
                if let Ok(mut writer) = self.writer.lock() {
                    let _ = writer.write_all(seq.as_bytes());
                    let _ = writer.flush();
                }
            }
            _ => {}
        }
    }
}

struct EmulatorState {
    term: Term<EventProxy>,
    parser: ansi::Processor,
}

impl EmulatorState {
    fn new(cols: u16, rows: u16, proxy: EventProxy) -> Self {
        let size = TermSize::new(cols as usize, rows as usize);
        let config = TermConfig {
            scrolling_history: 10_000,
            ..TermConfig::default()
        };
        let term = Term::new(config, &size, proxy);
        Self {
            term,
            parser: ansi::Processor::new(),
        }
    }

    fn advance(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        self.parser.advance(&mut self.term, bytes);
    }

    fn resize(&mut self, cols: u16, rows: u16) {
        self.term
            .resize(TermSize::new(cols as usize, rows as usize));
    }

    fn frame(&self) -> TerminalFrameDto {
        serialize_frame(&self.term)
    }
}

struct TerminalSession {
    info: TerminalSessionInfo,
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    output_buffer: String,
    buffer_start_cursor: usize,
    emulator: Arc<Mutex<EmulatorState>>,
    size_cols: Arc<Mutex<u16>>,
    size_rows: Arc<Mutex<u16>>,
}

impl TerminalSession {
    fn append_output(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        self.info.cursor += text.len();
        self.output_buffer.push_str(text);
        while self.output_buffer.len() > TERMINAL_BUFFER_MAX {
            let trim = (self.output_buffer.len() - TERMINAL_BUFFER_MAX)
                .min(TERMINAL_BUFFER_TRIM_CHUNK)
                .max(1);
            self.output_buffer.drain(0..trim);
            self.buffer_start_cursor += trim;
        }
    }

    fn attach_from(&self, client_cursor: usize) -> TerminalAttachResponse {
        let (cursor, replay) = replay_output(
            &self.output_buffer,
            self.buffer_start_cursor,
            self.info.cursor,
            client_cursor,
        );
        let frame = self
            .emulator
            .lock()
            .map(|emu| emu.frame())
            .unwrap_or_else(|_| TerminalFrameDto {
                cols: self.info.cols,
                rows: self.info.rows,
                cursor: frame::TerminalCursorDto {
                    col: 0,
                    row: 0,
                    visible: true,
                },
                lines: vec![],
            });
        TerminalAttachResponse {
            cursor,
            replay,
            frame,
        }
    }
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

    fn append_output_for_key(&mut self, key: &str, text: &str) {
        if let Some(session) = self.sessions.get_mut(key) {
            session.append_output(text);
        }
    }

    /// 把 reader 线程逻辑（utf-8 切分、VT 解析、flush、emit、wait、清理会话）抽出来，
    /// 让 `open`（交互终端）和 `open_background_script`（后台脚本）共用一份实现。
    fn spawn_pty_reader_thread(
        reader: Box<dyn Read + Send>,
        mut child: Box<dyn portable_pty::Child + Send + Sync>,
        workspace_id: String,
        terminal_id: String,
        session_key: String,
        app: tauri::AppHandle,
        emulator: Arc<Mutex<EmulatorState>>,
    ) {
        std::thread::spawn(move || {
            // 阻塞 read 与超时 flush 拆成两段：读线程只管灌字节，处理线程用
            // recv_timeout 在 shell 安静后仍能把最后一帧刷出去。
            let (tx, rx) = mpsc::sync_channel::<PtyReaderEvent>(64);
            std::thread::spawn(move || {
                let mut reader = reader;
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            let _ = tx.send(PtyReaderEvent::Eof);
                            break;
                        }
                        Ok(n) => {
                            if tx.send(PtyReaderEvent::Bytes(buf[..n].to_vec())).is_err() {
                                break;
                            }
                        }
                        Err(err) => match err.kind() {
                            ErrorKind::Interrupted => continue,
                            ErrorKind::WouldBlock => {
                                std::thread::sleep(Duration::from_millis(1));
                                continue;
                            }
                            _ => {
                                let _ = tx.send(PtyReaderEvent::Error(err.to_string()));
                                break;
                            }
                        },
                    }
                }
            });

            let mut carry = Vec::new();
            let mut pending = String::new();
            let mut last_flush = Instant::now();
            let mut dirty = false;
            let mut exit_reason: Option<String> = None;

            let emit_frame = |emulator: &Arc<Mutex<EmulatorState>>| {
                let frame = match emulator.lock() {
                    Ok(emu) => emu.frame(),
                    Err(_) => return,
                };
                let _ = app.emit(
                    "terminal-frame",
                    serde_json::json!({
                        "workspaceId": workspace_id,
                        "terminalId": terminal_id,
                        "frame": frame,
                    }),
                );
            };

            let flush_pending = |pending: &mut String,
                                 last_flush: &mut Instant,
                                 dirty: &mut bool,
                                 emulator: &Arc<Mutex<EmulatorState>>| {
                if pending.is_empty() && !*dirty {
                    return;
                }
                if !pending.is_empty() {
                    let chunk = pending.as_str();
                    if let Some(manager) = app.try_state::<Mutex<TerminalManager>>() {
                        if let Ok(mut guard) = manager.lock() {
                            guard.append_output_for_key(&session_key, chunk);
                        }
                    }
                    let _ = app.emit(
                        "terminal-output",
                        serde_json::json!({
                            "workspaceId": workspace_id,
                            "terminalId": terminal_id,
                            "data": chunk,
                        }),
                    );
                    pending.clear();
                }
                if *dirty {
                    emit_frame(emulator);
                    *dirty = false;
                }
                *last_flush = Instant::now();
            };

            loop {
                match rx.recv_timeout(TERMINAL_EMIT_FLUSH_INTERVAL) {
                    Ok(PtyReaderEvent::Bytes(bytes)) => {
                        if let Ok(mut emu) = emulator.lock() {
                            emu.advance(&bytes);
                        }
                        dirty = true;
                        carry.extend_from_slice(&bytes);
                        for text in drain_valid_utf8_chunks(&mut carry) {
                            pending.push_str(&text);
                        }
                        if should_flush_terminal_output(
                            pending.len(),
                            dirty,
                            last_flush.elapsed(),
                            false,
                        ) {
                            flush_pending(&mut pending, &mut last_flush, &mut dirty, &emulator);
                        }
                    }
                    Ok(PtyReaderEvent::Error(message)) => {
                        exit_reason = Some(message);
                        break;
                    }
                    Ok(PtyReaderEvent::Eof) => break,
                    Err(RecvTimeoutError::Timeout) => {
                        if should_flush_terminal_output(
                            pending.len(),
                            dirty,
                            last_flush.elapsed(),
                            true,
                        ) {
                            flush_pending(&mut pending, &mut last_flush, &mut dirty, &emulator);
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
            if !carry.is_empty() {
                pending.push_str(&String::from_utf8_lossy(&carry));
            }
            flush_pending(&mut pending, &mut last_flush, &mut dirty, &emulator);

            let exit_code = child
                .wait()
                .ok()
                .map(|status| status.exit_code())
                .unwrap_or(0);

            let _ = app.emit(
                "terminal-exit",
                serde_json::json!({
                    "workspaceId": workspace_id,
                    "terminalId": terminal_id,
                    "exitCode": exit_code,
                    "reason": exit_reason,
                }),
            );

            if let Some(manager) = app.try_state::<Mutex<TerminalManager>>() {
                if let Ok(mut guard) = manager.lock() {
                    if let Some(mut session) = guard.sessions.remove(&session_key) {
                        session.info.status = "exited".to_string();
                        let _ = session.killer.kill();
                    }
                }
            }
        });
    }

    fn create_emulator(
        cols: u16,
        rows: u16,
        writer: Arc<Mutex<Box<dyn Write + Send>>>,
    ) -> (Arc<Mutex<EmulatorState>>, Arc<Mutex<u16>>, Arc<Mutex<u16>>) {
        let size_cols = Arc::new(Mutex::new(cols));
        let size_rows = Arc::new(Mutex::new(rows));
        let proxy = EventProxy {
            writer,
            cols: size_cols.clone(),
            rows: size_rows.clone(),
        };
        let emulator = Arc::new(Mutex::new(EmulatorState::new(cols, rows, proxy)));
        (emulator, size_cols, size_rows)
    }

    fn open(
        &mut self,
        workspace_id: String,
        terminal_id: String,
        cols: u16,
        rows: u16,
        cwd: String,
        title: Option<String>,
        source: Option<String>,
        app: &tauri::AppHandle,
    ) -> Result<(), String> {
        let key = session_key(&workspace_id, &terminal_id);
        if self.sessions.contains_key(&key) {
            return Ok(());
        }

        let safe_cols = cols.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX);
        let safe_rows = rows.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX);
        let source = normalize_terminal_source(source);
        let title = title
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                if source == "agent" {
                    "Agent 终端".to_string()
                } else {
                    "终端".to_string()
                }
            });

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
        cmd.cwd(&cwd);
        let path_merged = merge_path_env(&claude_path_search_prefixes());
        cmd.env("PATH", path_merged);
        // 显式同步 COLUMNS/LINES，避免部分 shell/theme 在 TIOCGWINSZ 就绪前用默认 80 折行导致画面乱。
        cmd.env("COLUMNS", safe_cols.to_string());
        cmd.env("LINES", safe_rows.to_string());

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let master = pair.master;
        let reader = master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let writer = Arc::new(Mutex::new(
            master
                .take_writer()
                .map_err(|e| format!("Failed to get PTY writer: {}", e))?,
        ));

        let killer = child.clone_killer();
        let (emulator, size_cols, size_rows) =
            Self::create_emulator(safe_cols, safe_rows, writer.clone());

        let workspace_clone = workspace_id.clone();
        let terminal_clone = terminal_id.clone();
        let session_key_clone = key.clone();
        let app_clone = app.clone();
        let emulator_clone = emulator.clone();

        Self::spawn_pty_reader_thread(
            reader,
            child,
            workspace_clone,
            terminal_clone,
            session_key_clone,
            app_clone,
            emulator_clone,
        );

        let info = TerminalSessionInfo {
            workspace_id: workspace_id.clone(),
            terminal_id: terminal_id.clone(),
            title: title.clone(),
            source: source.clone(),
            status: "running".to_string(),
            cwd: cwd.clone(),
            cols: safe_cols,
            rows: safe_rows,
            cursor: 0,
            pid: 0,
        };

        let _ = app.emit(
            "terminal-created",
            serde_json::json!({
                "workspaceId": workspace_id,
                "terminalId": terminal_id,
                "title": title,
                "source": source,
                "cwd": cwd,
                "cols": safe_cols,
                "rows": safe_rows,
                "cursor": 0,
                "pid": 0u32,
            }),
        );

        self.sessions.insert(
            key,
            TerminalSession {
                info,
                master,
                writer,
                killer,
                output_buffer: String::new(),
                buffer_start_cursor: 0,
                emulator,
                size_cols,
                size_rows,
            },
        );

        Ok(())
    }

    /// 在 cwd 下用 `zsh -c <command>` 通过 PTY 启动一次性后台脚本。
    fn open_background_script(
        &mut self,
        workspace_id: String,
        terminal_id: String,
        cwd: String,
        command: String,
        title: Option<String>,
        app: &tauri::AppHandle,
    ) -> Result<TerminalSessionInfo, String> {
        let trimmed_cwd = cwd.trim();
        if trimmed_cwd.is_empty() {
            return Err("仓库路径为空".to_string());
        }
        if !std::path::Path::new(trimmed_cwd).is_dir() {
            return Err(format!("仓库路径不存在或不是目录：{trimmed_cwd}"));
        }

        let key = session_key(&workspace_id, &terminal_id);
        if self.sessions.contains_key(&key) {
            return Err(format!("Terminal session already exists: {}", key));
        }

        let safe_cols: u16 = 80;
        let safe_rows: u16 = 24;
        let title = title
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "后台脚本".to_string());
        let source = "background-script".to_string();

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
            return Err("后台脚本当前仅支持 macOS/Linux".to_string());
        } else {
            let mut zsh = CommandBuilder::new("zsh");
            zsh.arg("-c");
            zsh.arg(&command);
            apply_embedded_terminal_shell_env(&mut zsh);
            zsh
        };
        cmd.cwd(trimmed_cwd);
        let path_merged = merge_path_env(&claude_path_search_prefixes());
        cmd.env("PATH", path_merged);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn background script: {}", e))?;
        let pid = child.process_id().unwrap_or(0);

        let master = pair.master;
        let reader = master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let killer = child.clone_killer();
        // 后台脚本不接管 stdin：writer 用 sink，前端不会调用 terminal_write。
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(Box::new(std::io::sink())));
        let (emulator, size_cols, size_rows) =
            Self::create_emulator(safe_cols, safe_rows, writer.clone());

        let info = TerminalSessionInfo {
            workspace_id: workspace_id.clone(),
            terminal_id: terminal_id.clone(),
            title: title.clone(),
            source: source.clone(),
            status: "running".to_string(),
            cwd: trimmed_cwd.to_string(),
            cols: safe_cols,
            rows: safe_rows,
            cursor: 0,
            pid,
        };

        let _ = app.emit(
            "terminal-created",
            serde_json::json!({
                "workspaceId": workspace_id,
                "terminalId": terminal_id,
                "title": title,
                "source": source,
                "cwd": trimmed_cwd,
                "cols": safe_cols,
                "rows": safe_rows,
                "cursor": 0,
                "pid": pid,
            }),
        );

        let workspace_clone = workspace_id.clone();
        let terminal_clone = terminal_id.clone();
        let session_key_clone = key.clone();
        let app_clone = app.clone();
        let emulator_clone = emulator.clone();
        Self::spawn_pty_reader_thread(
            reader,
            child,
            workspace_clone,
            terminal_clone,
            session_key_clone,
            app_clone,
            emulator_clone,
        );

        self.sessions.insert(
            key.clone(),
            TerminalSession {
                info,
                master,
                writer,
                killer,
                output_buffer: String::new(),
                buffer_start_cursor: 0,
                emulator,
                size_cols,
                size_rows,
            },
        );

        let info = self
            .sessions
            .get(&key)
            .map(|s| s.info.clone())
            .unwrap_or_else(|| TerminalSessionInfo {
                workspace_id,
                terminal_id,
                title,
                source,
                status: "running".to_string(),
                cwd: trimmed_cwd.to_string(),
                cols: safe_cols,
                rows: safe_rows,
                cursor: 0,
                pid,
            });
        Ok(info)
    }

    fn attach(
        &self,
        workspace_id: &str,
        terminal_id: &str,
        cursor: usize,
    ) -> Result<TerminalAttachResponse, String> {
        let key = session_key(workspace_id, terminal_id);
        let session = self
            .sessions
            .get(&key)
            .ok_or_else(|| format!("Terminal session not found: {}", key))?;
        Ok(session.attach_from(cursor))
    }

    fn list(&self, workspace_id: &str) -> Vec<TerminalSessionInfo> {
        self.sessions
            .values()
            .filter(|session| session.info.workspace_id == workspace_id)
            .map(|session| session.info.clone())
            .collect()
    }

    fn get(&self, workspace_id: &str, terminal_id: &str) -> Option<TerminalSessionInfo> {
        let key = session_key(workspace_id, terminal_id);
        self.sessions.get(&key).map(|session| session.info.clone())
    }

    fn update_title(
        &mut self,
        workspace_id: &str,
        terminal_id: &str,
        title: String,
    ) -> Result<(), String> {
        let key = session_key(workspace_id, terminal_id);
        let session = self
            .sessions
            .get_mut(&key)
            .ok_or_else(|| format!("Terminal session not found: {}", key))?;
        session.info.title = title;
        Ok(())
    }

    fn write(&mut self, workspace_id: &str, terminal_id: &str, data: &str) -> Result<(), String> {
        let key = session_key(workspace_id, terminal_id);
        let session = self
            .sessions
            .get_mut(&key)
            .ok_or_else(|| format!("Terminal session not found: {}", key))?;
        if session.info.status == "exited" {
            return Err(format!("Terminal session exited: {}", key));
        }
        if session.info.source == "background-script" {
            return Err(format!(
                "Terminal session {} 是后台脚本，不能写入 stdin",
                key
            ));
        }
        let bytes = data.as_bytes();
        let mut attempt: u32 = 0;
        let mut writer = session
            .writer
            .lock()
            .map_err(|e| format!("Failed to lock PTY writer: {}", e))?;
        loop {
            match writer.write_all(bytes) {
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
        writer
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
        let key = session_key(workspace_id, terminal_id);
        let session = self
            .sessions
            .get_mut(&key)
            .ok_or_else(|| format!("Terminal session not found: {}", key))?;
        if session.info.status == "exited" {
            return Err(format!("Terminal session exited: {}", key));
        }
        let safe_cols = cols.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX);
        let safe_rows = rows.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX);
        session.info.cols = safe_cols;
        session.info.rows = safe_rows;
        if let Ok(mut cols_guard) = session.size_cols.lock() {
            *cols_guard = safe_cols;
        }
        if let Ok(mut rows_guard) = session.size_rows.lock() {
            *rows_guard = safe_rows;
        }
        if let Ok(mut emu) = session.emulator.lock() {
            emu.resize(safe_cols, safe_rows);
        }
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
        let key = session_key(workspace_id, terminal_id);
        let mut session = self
            .sessions
            .remove(&key)
            .ok_or_else(|| format!("Terminal session not found: {}", key))?;
        session.info.status = "exited".to_string();
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
    title: Option<String>,
    source: Option<String>,
) -> Result<(), String> {
    manager.lock().map_err(|e| e.to_string())?.open(
        workspace_id,
        terminal_id,
        cols,
        rows,
        cwd,
        title,
        source,
        &app,
    )
}

/// 后台脚本入口：用 PTY 跑一次性 `zsh -c <command>`，返回包含 pid 的 session info。
#[tauri::command]
pub(crate) fn terminal_open_background_script(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    app: tauri::AppHandle,
    workspace_id: String,
    terminal_id: String,
    cwd: String,
    command: String,
    title: Option<String>,
) -> Result<TerminalSessionInfo, String> {
    manager
        .lock()
        .map_err(|e| e.to_string())?
        .open_background_script(workspace_id, terminal_id, cwd, command, title, &app)
}

#[tauri::command]
pub(crate) fn terminal_attach(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    workspace_id: String,
    terminal_id: String,
    cursor: usize,
) -> Result<TerminalAttachResponse, String> {
    manager
        .lock()
        .map_err(|e| e.to_string())?
        .attach(&workspace_id, &terminal_id, cursor)
}

#[tauri::command]
pub(crate) fn terminal_list(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    workspace_id: String,
) -> Result<Vec<TerminalSessionInfo>, String> {
    Ok(manager
        .lock()
        .map_err(|e| e.to_string())?
        .list(&workspace_id))
}

#[tauri::command]
pub(crate) fn terminal_get(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    workspace_id: String,
    terminal_id: String,
) -> Result<Option<TerminalSessionInfo>, String> {
    Ok(manager
        .lock()
        .map_err(|e| e.to_string())?
        .get(&workspace_id, &terminal_id))
}

#[tauri::command]
pub(crate) fn terminal_update_title(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    workspace_id: String,
    terminal_id: String,
    title: String,
) -> Result<(), String> {
    manager
        .lock()
        .map_err(|e| e.to_string())?
        .update_title(&workspace_id, &terminal_id, title)
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
    use super::*;
    use std::io::{Read, Write};

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
        let mut carry = b"\xc0a".to_vec();
        let chunks = drain_valid_utf8_chunks(&mut carry);
        assert_eq!(chunks, vec!["a".to_string()]);
        assert!(carry.is_empty());
    }

    #[test]
    fn flush_on_reader_idle_even_inside_time_window() {
        // 旧 bug：小段输出落在 16ms 内后阻塞 read，画面卡住直到下一次按键。
        assert!(should_flush_terminal_output(
            32,
            true,
            Duration::from_millis(1),
            true,
        ));
    }

    #[test]
    fn flush_batches_while_reader_busy_inside_time_window() {
        assert!(!should_flush_terminal_output(
            32,
            true,
            Duration::from_millis(1),
            false,
        ));
        assert!(should_flush_terminal_output(
            TERMINAL_EMIT_FLUSH_BYTES,
            true,
            Duration::from_millis(1),
            false,
        ));
        assert!(should_flush_terminal_output(
            32,
            true,
            TERMINAL_EMIT_FLUSH_INTERVAL,
            false,
        ));
    }

    #[test]
    fn flush_skips_when_nothing_pending() {
        assert!(!should_flush_terminal_output(
            0,
            false,
            TERMINAL_EMIT_FLUSH_INTERVAL,
            true,
        ));
    }

    #[test]
    fn terminal_dim_bounds_are_sane() {
        assert!(TERMINAL_DIM_MIN >= 1);
        assert!(TERMINAL_DIM_MAX >= 80);
        assert!(TERMINAL_DIM_MAX <= 4096);
        assert_eq!(80u16.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX), 80);
        assert_eq!(0u16.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX), TERMINAL_DIM_MIN);
        assert_eq!(
            u16::MAX.clamp(TERMINAL_DIM_MIN, TERMINAL_DIM_MAX),
            TERMINAL_DIM_MAX
        );
    }

    #[test]
    fn replay_from_returns_suffix_after_client_cursor() {
        let (cursor, replay) = replay_output("abcdef", 0, 6, 2);
        assert_eq!(cursor, 6);
        assert_eq!(replay, "cdef");
    }

    #[test]
    fn replay_from_honors_buffer_start_cursor() {
        let (_cursor, replay) = replay_output("cdef", 2, 6, 1);
        assert_eq!(replay, "cdef");
    }

    #[test]
    fn append_output_trims_buffer_when_exceeding_cap() {
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(Box::new(std::io::sink())));
        let (emulator, size_cols, size_rows) =
            TerminalManager::create_emulator(80, 24, writer.clone());
        let mut session = TerminalSession {
            info: TerminalSessionInfo {
                workspace_id: "0".to_string(),
                terminal_id: "t1".to_string(),
                title: "终端".to_string(),
                source: "user".to_string(),
                status: "running".to_string(),
                cwd: "/tmp".to_string(),
                cols: 80,
                rows: 24,
                cursor: 0,
                pid: 0,
            },
            master: panic_master_placeholder(),
            writer,
            killer: panic_killer_placeholder(),
            output_buffer: String::new(),
            buffer_start_cursor: 0,
            emulator,
            size_cols,
            size_rows,
        };
        let chunk = "a".repeat(TERMINAL_BUFFER_TRIM_CHUNK);
        for _ in 0..20 {
            session.append_output(&chunk);
        }
        assert!(session.output_buffer.len() <= TERMINAL_BUFFER_MAX);
        assert!(session.buffer_start_cursor > 0);
        assert_eq!(session.info.cursor, chunk.len() * 20);
    }

    fn panic_master_placeholder() -> Box<dyn portable_pty::MasterPty + Send> {
        struct Unreachable;
        impl portable_pty::MasterPty for Unreachable {
            fn resize(&self, _size: portable_pty::PtySize) -> anyhow::Result<()> {
                Ok(())
            }
            fn get_size(&self) -> anyhow::Result<portable_pty::PtySize> {
                Ok(portable_pty::PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                })
            }
            fn take_writer(&self) -> anyhow::Result<Box<dyn Write + Send>> {
                Err(anyhow::anyhow!("test"))
            }
            fn try_clone_reader(&self) -> anyhow::Result<Box<dyn Read + Send>> {
                Err(anyhow::anyhow!("test"))
            }
            fn process_group_leader(&self) -> Option<i32> {
                None
            }
            fn as_raw_fd(&self) -> Option<i32> {
                None
            }
            fn tty_name(&self) -> Option<std::path::PathBuf> {
                None
            }
        }
        Box::new(Unreachable)
    }

    fn panic_killer_placeholder() -> Box<dyn ChildKiller + Send + Sync> {
        #[derive(Debug)]
        struct Unreachable;
        impl ChildKiller for Unreachable {
            fn kill(&mut self) -> std::io::Result<()> {
                Ok(())
            }
            fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
                Box::new(Unreachable)
            }
        }
        Box::new(Unreachable)
    }
}
