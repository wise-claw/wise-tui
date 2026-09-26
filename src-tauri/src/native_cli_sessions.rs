//! 原生 CLI 会话索引：让 Codex / DeepSeek Harness 在 Wise 之外的会话进入 Wise。
//!
//! 两类会话都落在各自 CLI 的用户目录里，与 Wise 自己的 `~/.wise/*-runs` 转录彼此独立：
//!
//! - Codex：`~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`（含 app-server 线程）
//! - DeepSeek Harness：`~/.dsh/sessions/<encoded-cwd>/<session-id>/session*.jsonl.zstd`
//!
//! 这里只负责「发现 + 读回 Wise 流式行」；列表合并、引擎绑定和续接判定在前端完成，
//! 与既有 `list_claude_disk_sessions` 路径保持一致。

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::codex_rollout_adapter::{
    map_codex_rollout_line, parse_codex_rollout_meta, parse_codex_rollout_model,
    parse_codex_rollout_user_preview,
};
use crate::dsh_session_adapter::{
    map_dsh_session_line, parse_dsh_session_title, parse_dsh_user_preview,
};

/// 单次列表最多扫多少个 rollout 文件，避免用户目录巨大时拖慢刷新。
const CODEX_MAX_SCANNED_FILES: usize = 4000;
/// 命中足够多的会话后即可停止继续向前扫（列表只需最近若干条）。
const CODEX_SCAN_TARGET_MATCHES: usize = 80;
/// 列表最多返回多少条（前端还有统一条数上限）。
const NATIVE_MAX_RESULTS: usize = 60;
/// 预览扫描最多读多少行（`UserMessage` 通常在前 10 行内）。
const PREVIEW_MAX_LINES: usize = 120;
/// 预览阶段最多解码多少字节（dsh 是 zstd，避免为标题解压整份会话）。
const PREVIEW_MAX_BYTES: usize = 1024 * 1024;
/// 转录回读上限，防止超长会话撑爆 IPC。
const TRANSCRIPT_MAX_BYTES: usize = 64 * 1024 * 1024;
const TRANSCRIPT_MAX_LINES: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NativeEngine {
    Codex,
    DeepSeek,
}

impl NativeEngine {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim() {
            "codex" => Ok(NativeEngine::Codex),
            "deepseek" => Ok(NativeEngine::DeepSeek),
            other => Err(format!("不支持的原生会话引擎: {other}")),
        }
    }

    fn kind(self) -> &'static str {
        match self {
            NativeEngine::Codex => "codex",
            NativeEngine::DeepSeek => "deepseek",
        }
    }
}

/// 一条原生 CLI 会话索引行。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeCliDiskSessionItem {
    /// `codex` / `deepseek`。
    engine: String,
    session_id: String,
    /// 会话最后活跃时间（ms）。Codex 取 rollout 文件 mtime，dsh 取会话文件 mtime。
    updated_at_ms: i64,
    preview: String,
    model_hint: Option<String>,
    /// 会话标题（dsh 有 `session/title`；Codex rollout 无标题）。
    title: Option<String>,
}

fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

fn codex_sessions_root() -> Option<PathBuf> {
    let root = home_dir()?.join(".codex").join("sessions");
    root.is_dir().then_some(root)
}

fn dsh_sessions_root() -> Option<PathBuf> {
    let root = home_dir()?.join(".dsh").join("sessions");
    root.is_dir().then_some(root)
}

fn file_mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|dur| dur.as_millis() as i64)
        .unwrap_or(0)
}

fn normalize_path_key(raw: &str) -> String {
    raw.trim().replace('\\', "/").trim_end_matches('/').to_string()
}

/// `candidate` 是否等于 `project_path` 或位于其下。
fn path_matches_project(candidate: &str, project_path: &str) -> bool {
    let candidate = normalize_path_key(candidate);
    let project = normalize_path_key(project_path);
    if candidate.is_empty() || project.is_empty() {
        return false;
    }
    candidate == project || candidate.starts_with(&(project + "/"))
}

/// dsh 的 cwd 目录名编码：`/Users/me/repo` → `--Users-me-repo--`。
fn encoded_dsh_project_dir(project_path: &str) -> String {
    let normalized = if cfg!(windows) {
        let mut text = project_path.trim().replace('\\', "/");
        if let Some(rest) = text.strip_prefix("//?/") {
            text = rest.to_string();
        }
        text.replace(':', "").trim_start_matches('/').replace('/', "-")
    } else {
        project_path.trim().trim_start_matches('/').replace('/', "-")
    };
    format!("--{normalized}--")
}

/// 原生会话 id 形态校验（同时用于防目录穿越）。Codex 是 UUID，dsh 是 UUID 或 `session-<uuid>`。
fn is_safe_native_session_id(id: &str) -> bool {
    let len = id.len();
    if !(8..=128).contains(&len) {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// 收集 rollout 文件（新 → 旧），只看 `*.jsonl`。
fn collect_codex_rollout_files(root: &Path) -> Vec<(PathBuf, i64)> {
    let mut files: Vec<(PathBuf, i64)> = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if files.len() >= CODEX_MAX_SCANNED_FILES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let is_rollout = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
            .unwrap_or(false);
        if !is_rollout {
            continue;
        }
        let path = path.to_path_buf();
        let mtime = file_mtime_ms(&path);
        files.push((path, mtime));
    }
    files.sort_by(|a, b| b.1.cmp(&a.1));
    files
}

fn read_first_line(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    Some(line)
}

struct CodexHit {
    session_id: String,
    updated_at_ms: i64,
    path: PathBuf,
}

/// Codex：按 cwd 归属缩小到目标仓库，并排除 `codex exec` 一次性运行。
fn collect_codex_hits(project_path: &str) -> Vec<CodexHit> {
    let Some(root) = codex_sessions_root() else {
        return Vec::new();
    };
    let mut hits: HashMap<String, CodexHit> = HashMap::new();
    for (path, mtime) in collect_codex_rollout_files(&root) {
        let Some(first_line) = read_first_line(&path) else {
            continue;
        };
        let Some(meta) = parse_codex_rollout_meta(&first_line) else {
            continue;
        };
        if !path_matches_project(&meta.cwd, project_path) {
            continue;
        }
        // `codex exec` 是自动化/工具型一次性运行，不是可续接的交互会话。
        if meta.source.as_deref() == Some("exec") {
            continue;
        }
        // Wise 自己通过 app-server 跑的 Codex 会话也落在 `~/.codex/sessions`，
        // 但它们已有 `~/.wise/n/<repo>/<tabId>.jsonl` 转录；再收进原生索引会
        // 把 Wise 已裁剪的历史重新灌回侧栏，且与既有转录来源重复。
        if meta
            .originator
            .as_deref()
            .map(|originator| originator.to_ascii_lowercase().starts_with("wise"))
            .unwrap_or(false)
        {
            continue;
        }
        let replace = hits
            .get(&meta.session_id)
            .map(|prev| mtime > prev.updated_at_ms)
            .unwrap_or(true);
        if replace {
            hits.insert(
                meta.session_id.clone(),
                CodexHit {
                    session_id: meta.session_id,
                    updated_at_ms: mtime,
                    path,
                },
            );
        }
        if hits.len() >= CODEX_SCAN_TARGET_MATCHES {
            break;
        }
    }
    let mut out: Vec<CodexHit> = hits.into_values().collect();
    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    out
}

/// 扫 rollout 头部补齐预览与模型提示。
fn scan_codex_head(path: &Path) -> (String, Option<String>) {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return (String::new(), None),
    };
    let reader = BufReader::new(file);
    let mut preview = String::new();
    let mut model: Option<String> = None;
    for (index, line) in reader.lines().enumerate() {
        if index >= PREVIEW_MAX_LINES {
            break;
        }
        let Ok(line) = line else {
            break;
        };
        if model.is_none() {
            model = parse_codex_rollout_model(&line);
        }
        if preview.is_empty() {
            if let Some(text) = parse_codex_rollout_user_preview(&line) {
                preview = text;
            }
        }
        if !preview.is_empty() && model.is_some() {
            break;
        }
    }
    (preview, model)
}

fn list_codex_disk_sessions_blocking(project_path: &str) -> Vec<NativeCliDiskSessionItem> {
    collect_codex_hits(project_path)
        .into_iter()
        .take(NATIVE_MAX_RESULTS)
        .map(|hit| {
            let (preview, model_hint) = scan_codex_head(&hit.path);
            NativeCliDiskSessionItem {
                engine: NativeEngine::Codex.kind().to_string(),
                session_id: hit.session_id,
                updated_at_ms: hit.updated_at_ms,
                preview,
                model_hint,
                title: None,
            }
        })
        .collect()
}

/// zstd 解压到内存；遇到半写入帧时保留已解出的内容。
fn decode_zstd_bytes(path: &Path, max_bytes: usize) -> Vec<u8> {
    let Ok(file) = fs::File::open(path) else {
        return Vec::new();
    };
    let Ok(mut decoder) = zstd::stream::read::Decoder::new(file) else {
        return Vec::new();
    };
    let mut out: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    while out.len() < max_bytes {
        match decoder.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => out.extend_from_slice(&chunk[..n]),
            Err(_) => break,
        }
    }
    out.truncate(max_bytes);
    out
}

fn dsh_session_jsonl_path(session_dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(session_dir).ok()?;
    let mut candidates: Vec<PathBuf> = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with("session") && name.ends_with(".jsonl.zstd") {
            candidates.push(path);
        }
    }
    // 新版 `session.v3.jsonl.zstd` 优先，其余按名称稳定排序。
    candidates.sort_by(|a, b| {
        let rank = |p: &PathBuf| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.contains(".v3.") {
                0
            } else {
                1
            }
        };
        rank(a).cmp(&rank(b)).then_with(|| a.cmp(b))
    });
    candidates.into_iter().next()
}

/// 只用解出的前若干行补齐预览/标题/模型。
fn scan_dsh_head(path: &Path) -> (String, Option<String>, Option<String>) {
    let bytes = decode_zstd_bytes(path, PREVIEW_MAX_BYTES);
    let text = String::from_utf8_lossy(&bytes);
    let mut preview = String::new();
    let mut title: Option<String> = None;
    for (index, line) in text.lines().enumerate() {
        if index >= PREVIEW_MAX_LINES {
            break;
        }
        if title.is_none() {
            title = parse_dsh_session_title(line);
        }
        if preview.is_empty() {
            if let Some(text) = parse_dsh_user_preview(line) {
                preview = text;
            }
        }
        if !preview.is_empty() && title.is_some() {
            break;
        }
    }
    (preview, title, None)
}

fn list_dsh_disk_sessions_blocking(project_path: &str) -> Vec<NativeCliDiskSessionItem> {
    let Some(root) = dsh_sessions_root() else {
        return Vec::new();
    };
    let dir = root.join(encoded_dsh_project_dir(project_path));
    if !dir.is_dir() {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<NativeCliDiskSessionItem> = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        if out.len() >= NATIVE_MAX_RESULTS {
            break;
        }
        let session_dir = entry.path();
        if !session_dir.is_dir() {
            continue;
        }
        let session_id = entry.file_name().to_string_lossy().to_string();
        if !is_safe_native_session_id(&session_id) {
            continue;
        }
        let Some(jsonl) = dsh_session_jsonl_path(&session_dir) else {
            continue;
        };
        let (preview, title, model_hint) = scan_dsh_head(&jsonl);
        out.push(NativeCliDiskSessionItem {
            engine: NativeEngine::DeepSeek.kind().to_string(),
            session_id,
            updated_at_ms: file_mtime_ms(&jsonl),
            preview,
            model_hint,
            title,
        });
    }
    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    out
}

fn list_blocking(
    engine: NativeEngine,
    project_path: String,
) -> Result<Vec<NativeCliDiskSessionItem>, String> {
    let project = project_path.trim();
    if project.is_empty() {
        return Err("projectPath 不能为空".to_string());
    }
    Ok(match engine {
        NativeEngine::Codex => list_codex_disk_sessions_blocking(project),
        NativeEngine::DeepSeek => list_dsh_disk_sessions_blocking(project),
    })
}

/// 找出某个 Codex 会话的全部 rollout 文件（续写会产生多个文件），按时间升序。
fn codex_rollout_files_for_session(session_id: &str) -> Vec<PathBuf> {
    let Some(root) = codex_sessions_root() else {
        return Vec::new();
    };
    let mut found: Vec<(String, i64, PathBuf)> = Vec::new();
    for entry in walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if found.len() >= 8 {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !(name.starts_with("rollout-") && name.ends_with(".jsonl")) {
            continue;
        }
        if !name.contains(session_id) {
            continue;
        }
        let path = path.to_path_buf();
        let mtime = file_mtime_ms(&path);
        // 二次校验：文件名带 id 但 session_meta 可能指向别的会话（fork/续写后缀）。
        let Some(first_line) = read_first_line(&path) else {
            continue;
        };
        let Some(meta) = parse_codex_rollout_meta(&first_line) else {
            continue;
        };
        if meta.session_id != session_id {
            continue;
        }
        found.push((meta.timestamp.unwrap_or_default(), mtime, path));
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    found.into_iter().map(|(_, _, path)| path).collect()
}

fn read_codex_transcript(session_id: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for path in codex_rollout_files_for_session(session_id) {
        let Ok(file) = fs::File::open(&path) else {
            continue;
        };
        for line in BufReader::new(file).lines() {
            let Ok(line) = line else { break };
            if out.len() >= TRANSCRIPT_MAX_LINES {
                return out;
            }
            for mapped in map_codex_rollout_line(&line) {
                out.push(mapped);
            }
        }
    }
    out
}

fn read_dsh_transcript(project_path: &str, session_id: &str) -> Vec<String> {
    if !is_safe_native_session_id(session_id) {
        return Vec::new();
    }
    let Some(root) = dsh_sessions_root() else {
        return Vec::new();
    };
    let dir = root
        .join(encoded_dsh_project_dir(project_path))
        .join(session_id);
    let Some(jsonl) = dsh_session_jsonl_path(&dir) else {
        // 编码目录可能因符号链接差异不匹配：在 sessions 根下按会话目录名兜底查找。
        let Ok(entries) = fs::read_dir(&root) else {
            return Vec::new();
        };
        let mut fallback: Option<PathBuf> = None;
        for entry in entries.filter_map(Result::ok) {
            let candidate = entry.path().join(session_id);
            if candidate.is_dir() {
                if let Some(jsonl) = dsh_session_jsonl_path(&candidate) {
                    fallback = Some(jsonl);
                    break;
                }
            }
        }
        let Some(jsonl) = fallback else {
            return Vec::new();
        };
        return map_dsh_lines(decode_zstd_bytes(&jsonl, TRANSCRIPT_MAX_BYTES));
    };
    map_dsh_lines(decode_zstd_bytes(&jsonl, TRANSCRIPT_MAX_BYTES))
}

fn map_dsh_lines(bytes: Vec<u8>) -> Vec<String> {
    let text = String::from_utf8_lossy(&bytes);
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        if out.len() >= TRANSCRIPT_MAX_LINES {
            break;
        }
        for mapped in map_dsh_session_line(line) {
            out.push(mapped);
        }
    }
    out
}

fn tail_lines(mut lines: Vec<String>, tail: Option<usize>) -> Vec<String> {
    match tail {
        Some(tail) if tail > 0 && lines.len() > tail => lines.split_off(lines.len() - tail),
        _ => lines,
    }
}

#[tauri::command]
pub(crate) async fn list_native_cli_disk_sessions(
    engine: String,
    project_path: String,
) -> Result<Vec<NativeCliDiskSessionItem>, String> {
    let engine = NativeEngine::parse(&engine)?;
    tokio::task::spawn_blocking(move || list_blocking(engine, project_path))
        .await
        .map_err(|e| format!("list_native_cli_disk_sessions 任务异常: {e}"))?
}

#[tauri::command]
pub(crate) async fn load_native_cli_session_transcript(
    engine: String,
    project_path: String,
    session_id: String,
    tail: Option<usize>,
) -> Result<Vec<String>, String> {
    let engine = NativeEngine::parse(&engine)?;
    let session_id = session_id.trim().to_string();
    if !is_safe_native_session_id(&session_id) {
        return Err("sessionId 含非法字符".to_string());
    }
    let project = project_path.trim().to_string();
    if project.is_empty() {
        return Err("projectPath 不能为空".to_string());
    }
    tokio::task::spawn_blocking(move || {
        let lines = match engine {
            NativeEngine::Codex => read_codex_transcript(&session_id),
            NativeEngine::DeepSeek => read_dsh_transcript(&project, &session_id),
        };
        tail_lines(lines, tail)
    })
    .await
    .map_err(|e| format!("load_native_cli_session_transcript 任务异常: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dsh_dir_encoding_matches_harness_layout() {
        assert_eq!(
            encoded_dsh_project_dir("/Users/sjl/Documents/github/wise-tui"),
            "--Users-sjl-Documents-github-wise-tui--"
        );
        assert_eq!(encoded_dsh_project_dir("/Users/sjl"), "--Users-sjl--");
        assert_eq!(encoded_dsh_project_dir("/tmp/dsh-probe2"), "--tmp-dsh-probe2--");
    }

    #[test]
    fn project_path_matching_is_prefix_safe() {
        assert!(path_matches_project("/repo", "/repo"));
        assert!(path_matches_project("/repo/packages/app", "/repo"));
        assert!(!path_matches_project("/repo-2", "/repo"));
        assert!(!path_matches_project("", "/repo"));
        assert!(!path_matches_project("/repo", ""));
    }

    #[test]
    fn native_session_id_guard_blocks_traversal() {
        assert!(is_safe_native_session_id("01a0daf1-ee64-7910-9a93-feea5e003c94"));
        assert!(is_safe_native_session_id("session-f2056067-976e-46fe-8f3b-36a05e883967"));
        assert!(!is_safe_native_session_id("../../etc/passwd"));
        assert!(!is_safe_native_session_id("short"));
        assert!(!is_safe_native_session_id("has/slash-12345678"));
    }

    #[test]
    fn parses_codex_engine_argument() {
        assert_eq!(NativeEngine::parse("codex").unwrap(), NativeEngine::Codex);
        assert_eq!(
            NativeEngine::parse(" deepseek ").unwrap(),
            NativeEngine::DeepSeek
        );
        assert!(NativeEngine::parse("claude").is_err());
    }

    #[test]
    fn zstd_roundtrip_keeps_jsonl_lines() {
        let dir = std::env::temp_dir().join(format!("wise-native-dsh-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("session.v3.jsonl.zstd");
        let payload = "{\"type\":\"session\",\"id\":\"abc\"}\n{\"type\":\"user/message\"}\n";
        {
            let file = fs::File::create(&path).expect("create");
            let mut encoder = zstd::stream::write::Encoder::new(file, 3).expect("encoder");
            use std::io::Write;
            encoder.write_all(payload.as_bytes()).expect("write");
            encoder.finish().expect("finish");
        }
        let decoded = String::from_utf8(decode_zstd_bytes(&path, 64 * 1024)).expect("utf8");
        assert!(decoded.contains("\"type\":\"session\""));
        assert_eq!(decoded.lines().count(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_lines_keeps_only_tail() {
        let lines = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        assert_eq!(tail_lines(lines.clone(), Some(2)), vec!["b", "c"]);
        assert_eq!(tail_lines(lines.clone(), None), lines);
    }

    #[test]
    fn codex_head_scan_reports_preview_and_model() {
        let dir = std::env::temp_dir().join(format!("wise-native-codex-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("rollout-2026-09-26T07-41-23-019fb8a4-4a38-77c0-a390-cfd7f1b9edfc.jsonl");
        let body = [
            r#"{"timestamp":"2026-09-26T07:41:23.511Z","ordinal":0,"type":"session_meta","payload":{"session_id":"019fb8a4-4a38-77c0-a390-cfd7f1b9edfc","cwd":"/repo","source":"vscode"}}"#,
            r#"{"timestamp":"2026-09-26T07:41:24.000Z","ordinal":4,"type":"turn_context","payload":{"model":"gpt-6-astra"}}"#,
            r#"{"timestamp":"2026-09-26T07:41:25.000Z","ordinal":6,"type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage","id":"item-1","content":[{"type":"text","text":"帮我修一下构建"}]}}}"#,
        ]
        .join("\n");
        fs::write(&path, body).expect("write");
        let (preview, model) = scan_codex_head(&path);
        assert_eq!(preview, "帮我修一下构建");
        assert_eq!(model.as_deref(), Some("gpt-6-astra"));
        let _ = fs::remove_dir_all(&dir);
    }
}
