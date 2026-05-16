//! 通过 **GitNexus CLI**：`gitnexus analyze` 建立索引后，用 **`gitnexus cypher`** 查询 Kuzu 图谱
//! 并写入 `wise.db`（解析 CLI 输出的 JSON 里的 `markdown` 表格：优先 **stderr**，兼容部分版本将 JSON 写到 **stdout**，避免在 Tauri 二进制中静态链接 Kuzu/cxx）。
//!
//! 环境变量 `GITNEXUS_BIN` 可覆盖默认可执行名 `gitnexus`（需在 `PATH` 中）。

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use rusqlite::params;
use rusqlite::Connection as SqliteConnection;
use serde::Deserialize;

use super::index_cancel;
use crate::code_knowledge_graph::indexer::{self, IndexResult};
use crate::code_knowledge_graph::storage as graph_storage;
use crate::code_knowledge_graph::types::{GraphPosition, GraphRange, ParseError};

pub(crate) fn gitnexus_executable() -> PathBuf {
    std::env::var_os("GITNEXUS_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("gitnexus"))
}

fn normalize_repo_rel_path(raw: &str) -> String {
    let s = raw.trim().replace('\\', "/");
    let s = s.strip_prefix("./").unwrap_or(&s).to_string();
    s.trim_start_matches('/').to_string()
}

#[derive(Debug, Deserialize)]
struct GitnexusCypherCliOutput {
    markdown: Option<String>,
    #[allow(dead_code)]
    row_count: Option<u64>,
    error: Option<String>,
}

fn env_timeout_secs(var: &str, default_secs: u64) -> Duration {
    std::env::var(var)
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&n| n > 0)
        .map(Duration::from_secs)
        .unwrap_or_else(|| Duration::from_secs(default_secs))
}

/// 避免 `Command::output()` 在 GitNexus 挂起时无限阻塞；超时或取消后 kill 子进程。
pub(crate) fn command_output_with_timeout(
    mut cmd: Command,
    timeout: Duration,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<std::process::Output, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("无法启动进程：{e}"))?;

    let mut stdout = child.stdout.take().ok_or("internal: stdout piped")?;
    let mut stderr = child.stderr.take().ok_or("internal: stderr piped")?;

    let stdout_handle = thread::spawn(move || {
        let mut v = Vec::new();
        let _ = stdout.read_to_end(&mut v);
        v
    });
    let stderr_handle = thread::spawn(move || {
        let mut v = Vec::new();
        let _ = stderr.read_to_end(&mut v);
        v
    });

    let start = Instant::now();
    let status = loop {
        if index_cancel::is_cancelled(cancel) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_handle.join();
            let _ = stderr_handle.join();
            return Err(index_cancel::INDEX_CANCELLED_MSG.to_string());
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_handle.join();
            let _ = stderr_handle.join();
            return Err(format!(
                "子进程超时（>{timeout:?}）。可设置环境变量调大：GITNEXUS_ANALYZE_TIMEOUT_SEC / GITNEXUS_CYPHER_TIMEOUT_SEC"
            ));
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                return Err(format!("等待子进程结束失败：{e}"));
            }
        }
    };

    let stdout_bytes = stdout_handle.join().unwrap_or_default();
    let stderr_bytes = stderr_handle.join().unwrap_or_default();

    Ok(std::process::Output {
        status,
        stdout: stdout_bytes,
        stderr: stderr_bytes,
    })
}

fn split_md_row(line: &str) -> Vec<String> {
    line.split('|')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 解析 `gitnexus cypher` 返回的 GitNexus `formatCypherAsMarkdown` 表格（跳过头行与分隔行）。
fn parse_markdown_table_data(markdown: &str) -> Vec<Vec<String>> {
    let lines: Vec<&str> = markdown.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() < 2 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for line in lines.iter().skip(2) {
        let cells = split_md_row(line);
        if cells.is_empty() {
            continue;
        }
        out.push(cells);
    }
    out
}

fn run_gitnexus_cypher(
    repo_root: &Path,
    repo_name: &str,
    query: &str,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<GitnexusCypherCliOutput, String> {
    let exe = gitnexus_executable();
    let timeout = env_timeout_secs("GITNEXUS_CYPHER_TIMEOUT_SEC", 180);
    let mut cmd = Command::new(&exe);
    cmd.current_dir(repo_root).args(["cypher", query, "-r", repo_name]);
    let output =
        command_output_with_timeout(cmd, timeout, cancel).map_err(|e| format!("无法执行 gitnexus cypher：{e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let combined = if stderr.is_empty() {
            stdout.clone()
        } else if stdout.is_empty() {
            stderr.clone()
        } else {
            format!("{stderr}\n{stdout}")
        };
        return Err(format!(
            "gitnexus cypher 失败（exit {:?}）：{}",
            output.status.code(),
            combined
        ));
    }

    let parsed: GitnexusCypherCliOutput = match serde_json::from_str::<GitnexusCypherCliOutput>(&stderr) {
        Ok(p) => p,
        Err(e_stderr) => match serde_json::from_str::<GitnexusCypherCliOutput>(&stdout) {
            Ok(p) => p,
            Err(e_stdout) => {
                if stderr.is_empty() && stdout.is_empty() {
                    return Err(
                        "解析 gitnexus cypher 输出 JSON 失败：成功退出但 stdout/stderr 均为空，无法读取结果。"
                            .to_string(),
                    );
                }
                let prev = |s: &str, n: usize| -> String {
                    let t: String = s.chars().take(n).collect();
                    if s.chars().count() > n {
                        format!("{t}…")
                    } else {
                        t
                    }
                };
                return Err(format!(
                    "解析 gitnexus cypher 输出 JSON 失败：stderr: {e_stderr}；stdout: {e_stdout}\n\
                     stderr(len={}, preview): {}\n\
                     stdout(len={}, preview): {}",
                    stderr.len(),
                    prev(&stderr, 400),
                    stdout.len(),
                    prev(&stdout, 400),
                ));
            }
        },
    };
    if let Some(err) = parsed.error.clone() {
        return Err(format!("gitnexus cypher 返回错误：{err}"));
    }
    Ok(parsed)
}

fn cypher_batched_rows(
    repo_root: &Path,
    repo_name: &str,
    query_base: &str,
    batch: u64,
    errors: &mut Vec<ParseError>,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<Vec<Vec<String>>, String> {
    /// 防止 SKIP 未生效或引擎异常时无限追加同批数据导致「假卡死」。
    const MAX_BATCHES: u32 = 100_000;

    let mut all: Vec<Vec<String>> = Vec::new();
    let mut skip: u64 = 0;
    let mut prev_batch_first: Option<String> = None;
    let mut batch_idx: u32 = 0;

    loop {
        if index_cancel::is_cancelled(cancel) {
            return Err(index_cancel::INDEX_CANCELLED_MSG.to_string());
        }
        if batch_idx >= MAX_BATCHES {
            return Err(format!(
                "gitnexus cypher 分批拉取超过上限 {MAX_BATCHES} 批（batch={batch}）。可能是 SKIP 未生效或结果集异常，请检查 GitNexus / Kuzu 版本。"
            ));
        }
        batch_idx += 1;

        let q = format!("{query_base} SKIP {skip} LIMIT {batch}");
        let resp = match run_gitnexus_cypher(repo_root, repo_name, &q, cancel) {
            Ok(r) => r,
            Err(e) => {
                errors.push(ParseError {
                    file: "gitnexus cypher".into(),
                    message: e,
                });
                break;
            }
        };
        let md = resp.markdown.unwrap_or_default();
        let rows = parse_markdown_table_data(&md);
        if rows.is_empty() {
            break;
        }
        let this_first = rows
            .first()
            .map(|r| r.first().cloned().unwrap_or_default())
            .unwrap_or_default();
        if let Some(ref prev) = prev_batch_first {
            if prev == &this_first && rows.len() as u64 == batch {
                return Err(format!(
                    "gitnexus cypher 分批疑似停滞：SKIP {skip} 后本批首行与上一批相同且仍为满批，SKIP 可能未生效。"
                ));
            }
        }
        prev_batch_first = Some(this_first);

        let n = rows.len();
        all.extend(rows);
        skip += batch;
        if (n as u64) < batch {
            break;
        }
    }
    Ok(all)
}

fn symbol_table_cypher(label: &str) -> String {
    if label == "Template" {
        "MATCH (n:`Template`) RETURN n.id, n.name, n.filePath, n.startLine, n.endLine".to_string()
    } else {
        format!("MATCH (n:{label}) RETURN n.id, n.name, n.filePath, n.startLine, n.endLine")
    }
}

/// 与 `gitnexus` npm 包 `schema.js` 中 `NODE_TABLES` 对齐的代码类节点（不含 File / Folder / Community / Process）。
const GITNEXUS_SYMBOL_TABLES: &[&str] = &[
    "Function",
    "Class",
    "Interface",
    "Method",
    "CodeElement",
    "Struct",
    "Enum",
    "Macro",
    "Typedef",
    "Union",
    "Namespace",
    "Trait",
    "Impl",
    "TypeAlias",
    "Const",
    "Static",
    "Property",
    "Record",
    "Delegate",
    "Annotation",
    "Constructor",
    "Template",
    "Module",
];

fn map_gitnexus_relation_type(rel: &str, target_gn_id: &str) -> Option<&'static str> {
    match rel {
        "CONTAINS" => Some("contains"),
        "DEFINES" => Some("defines"),
        "IMPORTS" => Some("imports"),
        "CALLS" => Some("calls"),
        "EXTENDS" => Some("extends"),
        "IMPLEMENTS" => Some("implements"),
        "MEMBER_OF" => {
            let head = target_gn_id.split(':').next().unwrap_or("");
            if head == "Property" {
                Some("has_property")
            } else {
                Some("has_method")
            }
        }
        "STEP_IN_PROCESS" => None,
        _ => None,
    }
}

fn wise_symbol_id(repo_id: i64, gn_symbol_id: &str) -> String {
    let h = indexer::compute_hash(&format!("{repo_id}\0gn_sym\0{gn_symbol_id}"));
    format!("{repo_id}:gn:{h}")
}

fn run_gitnexus_analyze(repo_root: &Path, cancel: Option<&Arc<AtomicBool>>) -> Result<(), String> {
    let exe = gitnexus_executable();
    let timeout = env_timeout_secs("GITNEXUS_ANALYZE_TIMEOUT_SEC", 7200);
    let mut cmd = Command::new(&exe);
    cmd.current_dir(repo_root).args(["analyze", ".", "--force"]);
    let output = command_output_with_timeout(cmd, timeout, cancel).map_err(|e| {
        format!(
            "无法启动或执行 GitNexus CLI {:?}：{}。请安装 GitNexus：终端执行 `npm install -g gitnexus`（勿在包名后加 `@` 版本号），并保证在 PATH 中；或设置 GITNEXUS_BIN。也可在仓库内使用 `npx gitnexus …`（同样不要写 `@版本`）。",
            exe, e
        )
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "gitnexus analyze 失败（exit {:?}）。\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout.trim(),
            stderr.trim()
        ));
    }
    Ok(())
}

/// 在仓库根执行 `gitnexus analyze . --force`，使该仓可被 `gitnexus list` 解析（多仓仓库组 `group add` 前置）。
pub fn run_gitnexus_analyze_repo_root(repo_root: &Path) -> Result<(), String> {
    run_gitnexus_analyze(repo_root, None)
}

/// 传给 `gitnexus cypher -r`：使用 **canonical 绝对路径**（GitNexus `resolveRepoFromCache` 支持按路径精确匹配），
/// 比仅用目录名更稳，避免多仓 / 显示名与文件夹名不一致时选错仓或解析失败。
fn gitnexus_cypher_repo_arg(repo_path: &Path) -> String {
    repo_path.to_string_lossy().to_string()
}

/// 使用 GitNexus CLI（analyze + cypher）导入图谱，不在 Wise 二进制中链接 Kuzu。
pub fn index_repository(
    conn: &SqliteConnection,
    repo_path: &Path,
    repo_id: i64,
    repo_root_label: &str,
    cancel: Option<Arc<AtomicBool>>,
) -> Result<IndexResult, String> {
    let repo_path = repo_path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve repository path '{}': {}", repo_path.display(), e))?;
    if !repo_path.is_dir() {
        return Err(format!(
            "Repository path '{}' is not a directory",
            repo_path.display()
        ));
    }
    if !repo_path.join(".git").is_dir() {
        return Err(
            "当前仓库路径不是 Git 根目录。GitNexus 需要 Git 仓库；请在 Wise 中打开含 .git 的目录。"
                .to_string(),
        );
    }

    if index_cancel::is_cancelled(cancel.as_ref()) {
        return Err(index_cancel::INDEX_CANCELLED_MSG.to_string());
    }

    let gn_repo_arg = gitnexus_cypher_repo_arg(&repo_path);
    let repo_path_str = repo_path.to_string_lossy().to_string();
    eprintln!(
        "[code-graph] indexing via GitNexus CLI: repo_id={}, path={}, gitnexus_cypher_-r={}",
        repo_id, repo_path_str, gn_repo_arg
    );

    graph_storage::delete_edges_for_repo(conn, repo_id)?;

    let repo_root_label_in = repo_root_label.trim();
    let repo_root_label = if repo_root_label_in.is_empty() {
        repo_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("repository")
    } else {
        repo_root_label_in
    };

    let repo_node_id = format!("{repo_id}:repo:root");
    graph_storage::upsert_node(
        conn,
        &repo_node_id,
        "repo",
        None,
        repo_root_label,
        "/",
        repo_id,
        None,
        None,
    )?;

    let _ = graph_storage::update_index_meta(
        conn,
        repo_id,
        "",
        "indexing",
        None,
        0,
        0,
        Some(2),
        Some("gitnexus analyze"),
    )?;

    if index_cancel::is_cancelled(cancel.as_ref()) {
        return Err(index_cancel::INDEX_CANCELLED_MSG.to_string());
    }

    run_gitnexus_analyze(&repo_path, cancel.as_ref())?;

    if index_cancel::is_cancelled(cancel.as_ref()) {
        return Err(index_cancel::INDEX_CANCELLED_MSG.to_string());
    }

    let _ = graph_storage::update_index_meta(
        conn,
        repo_id,
        "",
        "indexing",
        None,
        0,
        0,
        Some(10),
        Some("导入 GitNexus 图谱 (cypher)"),
    )?;

    let mut gn_to_wise: HashMap<String, String> = HashMap::new();
    let mut errors: Vec<ParseError> = Vec::new();

    const BATCH: u64 = 4000;

    // --- File count (progress) ---
    let file_total: usize = {
        let q = "MATCH (f:File) RETURN count(*) AS c";
        let r = run_gitnexus_cypher(&repo_path, &gn_repo_arg, q, cancel.as_ref())?;
        let md = r.markdown.unwrap_or_default();
        let rows = parse_markdown_table_data(&md);
        rows.first()
            .and_then(|c| c.first())
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0)
    };

    // --- Files ---
    let mut files_done: usize = 0;
    {
        let q_base = "MATCH (f:File) RETURN f.id, f.name, f.filePath ORDER BY f.filePath";
        let rows = cypher_batched_rows(
            &repo_path,
            &gn_repo_arg,
            q_base,
            BATCH,
            &mut errors,
            cancel.as_ref(),
        )?;
        for cells in rows {
            if index_cancel::is_cancelled(cancel.as_ref()) {
                return Err(index_cancel::INDEX_CANCELLED_MSG.to_string());
            }
            if cells.len() < 3 {
                continue;
            }
            let gn_id = cells[0].clone();
            let name = cells.get(1).cloned().unwrap_or_default();
            let fp = cells[2].clone();
            let rel = normalize_repo_rel_path(&fp);
            let file_node_id = indexer::make_file_node_id(repo_id, &rel);
            gn_to_wise.insert(gn_id.clone(), file_node_id.clone());

            let abs = repo_path.join(&rel);
            let content = std::fs::read_to_string(&abs).unwrap_or_default();
            let content_hash = indexer::compute_hash(&content);
            let line_count = content.lines().count();
            let range = Some(GraphRange {
                start: GraphPosition { line: 0, column: 0 },
                end: GraphPosition {
                    line: line_count,
                    column: 0,
                },
            });

            graph_storage::upsert_node(
                conn,
                &file_node_id,
                "file",
                None,
                if name.is_empty() {
                    rel.split('/').last().unwrap_or(&rel)
                } else {
                    name.as_str()
                },
                &rel,
                repo_id,
                range,
                Some(&content_hash),
            )?;

            let _fc = indexer::add_folder_hierarchy(conn, repo_id, &rel, &repo_node_id)?;

            files_done += 1;
            if file_total > 0 {
                let pct = (files_done * 30 / file_total.max(1)).min(30) as u8 + 10;
                let _ = graph_storage::update_index_meta(
                    conn,
                    repo_id,
                    "",
                    "indexing",
                    None,
                    files_done,
                    file_total,
                    Some(pct),
                    Some(rel.as_str()),
                );
            }
        }
    }

    // --- Folders ---
    {
        let q_base = "MATCH (d:Folder) RETURN d.id, d.name, d.filePath ORDER BY d.filePath";
        let rows = cypher_batched_rows(
            &repo_path,
            &gn_repo_arg,
            q_base,
            BATCH,
            &mut errors,
            cancel.as_ref(),
        )?;
        for cells in rows {
            if index_cancel::is_cancelled(cancel.as_ref()) {
                return Err(index_cancel::INDEX_CANCELLED_MSG.to_string());
            }
            if cells.len() < 3 {
                continue;
            }
            let gn_id = cells[0].clone();
            let name = cells.get(1).cloned().unwrap_or_default();
            let fp = cells[2].clone();
            let rel = normalize_repo_rel_path(&fp);
            let folder_wise = indexer::folder_node_id_for_repo_path(repo_id, &rel);
            gn_to_wise.insert(gn_id, folder_wise.clone());
            let label = if name.is_empty() {
                rel.split('/').last().unwrap_or(&rel).to_string()
            } else {
                name
            };
            graph_storage::upsert_node(
                conn,
                &folder_wise,
                "folder",
                None,
                &label,
                &rel,
                repo_id,
                None,
                None,
            )?;
        }
    }

    // --- Symbols ---
    for label in GITNEXUS_SYMBOL_TABLES {
        let q_base = format!(
            "{} ORDER BY n.filePath, n.id",
            symbol_table_cypher(label)
        );
        let rows = match cypher_batched_rows(
            &repo_path,
            &gn_repo_arg,
            &q_base,
            BATCH,
            &mut errors,
            cancel.as_ref(),
        ) {
            Ok(r) => r,
            Err(e) if e == index_cancel::INDEX_CANCELLED_MSG => return Err(e),
            Err(e) => {
                errors.push(ParseError {
                    file: format!("cypher::{label}"),
                    message: e,
                });
                continue;
            }
        };
        for cells in rows {
            if index_cancel::is_cancelled(cancel.as_ref()) {
                return Err(index_cancel::INDEX_CANCELLED_MSG.to_string());
            }
            if cells.len() < 5 {
                continue;
            }
            let gn_id = cells[0].clone();
            let name = cells.get(1).cloned().unwrap_or_default();
            let fp = cells[2].clone();
            let rel = normalize_repo_rel_path(&fp);
            let start: usize = cells[3].parse().unwrap_or(0);
            let end: usize = cells[4].parse().unwrap_or(start);
            let sym_wise = wise_symbol_id(repo_id, &gn_id);
            gn_to_wise.insert(gn_id.clone(), sym_wise.clone());
            let range = Some(GraphRange {
                start: GraphPosition {
                    line: start,
                    column: 0,
                },
                end: GraphPosition { line: end, column: 0 },
            });
            let label_text = if name.is_empty() {
                gn_id.clone()
            } else {
                name
            };
            graph_storage::upsert_node(
                conn,
                &sym_wise,
                "symbol",
                Some(*label),
                &label_text,
                &rel,
                repo_id,
                range,
                None,
            )?;
        }
    }

    let _ = graph_storage::update_index_meta(
        conn,
        repo_id,
        "",
        "indexing",
        None,
        files_done,
        file_total.max(1),
        Some(55),
        Some("导入关系边 (CodeRelation)"),
    )?;

    // --- CodeRelation edges ---
    {
        let q_base =
            "MATCH (a)-[r:CodeRelation]->(b) RETURN a.id, b.id, r.type ORDER BY a.id, b.id, r.type";
        let rows = cypher_batched_rows(
            &repo_path,
            &gn_repo_arg,
            q_base,
            BATCH,
            &mut errors,
            cancel.as_ref(),
        )?;
        for cells in rows {
            if index_cancel::is_cancelled(cancel.as_ref()) {
                return Err(index_cancel::INDEX_CANCELLED_MSG.to_string());
            }
            if cells.len() < 3 {
                continue;
            }
            let sa = cells[0].clone();
            let sb = cells[1].clone();
            let rel_type = cells.get(2).cloned().unwrap_or_default();
            let Some(kind) = map_gitnexus_relation_type(&rel_type, &sb) else {
                continue;
            };
            let Some(wa) = gn_to_wise.get(&sa) else {
                continue;
            };
            let Some(wb) = gn_to_wise.get(&sb) else {
                continue;
            };
            let eid = match kind {
                "contains" => format!("{wa}:contains:{wb}"),
                "defines" => format!("{wa}:defines:{wb}"),
                "imports" => format!("{wa}:imports:{wb}"),
                "extends" => format!("{wa}:extends:{wb}"),
                "implements" => format!("{wa}:implements:{wb}"),
                "has_method" | "has_property" => format!("{wa}:{kind}:{wb}"),
                "calls" => format!(
                    "{}:calls:{}",
                    wa,
                    indexer::compute_hash(&format!("{wb}\0{rel_type}"))
                ),
                _ => format!(
                    "{}:gn:{}",
                    repo_id,
                    indexer::compute_hash(&format!("{wa}\0{wb}\0{kind}\0{rel_type}"))
                ),
            };
            graph_storage::upsert_edge(conn, &eid, wa, wb, kind)?;
        }
    }

    let index_version = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
    let total_nodes: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM graph_nodes WHERE repo_id = ?1",
            params![repo_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())? as usize;
    let total_edges: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM graph_edges e
             INNER JOIN graph_nodes s ON e.source_id = s.id
             INNER JOIN graph_nodes t ON e.target_id = t.id
             WHERE s.repo_id = ?1 AND t.repo_id = ?1",
            params![repo_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())? as usize;

    if index_cancel::is_cancelled(cancel.as_ref()) {
        return Err(index_cancel::INDEX_CANCELLED_MSG.to_string());
    }

    graph_storage::update_index_meta(
        conn,
        repo_id,
        &index_version,
        "done",
        None,
        total_nodes,
        total_edges,
        Some(100),
        None,
    )?;

    Ok(IndexResult {
        total_nodes,
        total_edges,
        errors,
        files_found: file_total,
        files_indexed: files_done,
        files_skipped: 0,
    })
}
