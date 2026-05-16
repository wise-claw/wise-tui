use crate::code_knowledge_graph::types::GraphRange;
use rusqlite::params;
use rusqlite::OptionalExtension;

pub fn upsert_node(
    conn: &rusqlite::Connection,
    id: &str,
    kind: &str,
    symbol_kind: Option<&str>,
    label: &str,
    path: &str,
    repo_id: i64,
    range: Option<GraphRange>,
    content_hash: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO graph_nodes (id, kind, symbol_kind, label, path, repo_id,
         range_start_line, range_start_col, range_end_line, range_end_col, content_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
           kind=excluded.kind, symbol_kind=excluded.symbol_kind, label=excluded.label,
           path=excluded.path, repo_id=excluded.repo_id,
           range_start_line=excluded.range_start_line, range_start_col=excluded.range_start_col,
           range_end_line=excluded.range_end_line, range_end_col=excluded.range_end_col,
           content_hash=excluded.content_hash, updated_at=datetime('now')",
        params![
            id,
            kind,
            symbol_kind,
            label,
            path,
            repo_id,
            range.as_ref().map(|r| r.start.line as i64),
            range.as_ref().map(|r| r.start.column as i64),
            range.as_ref().map(|r| r.end.line as i64),
            range.as_ref().map(|r| r.end.column as i64),
            content_hash,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(dead_code)]
pub fn graph_node_exists(conn: &rusqlite::Connection, id: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM graph_nodes WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

pub fn upsert_edge(
    conn: &rusqlite::Connection,
    id: &str,
    source_id: &str,
    target_id: &str,
    kind: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO graph_edges (id, source_id, target_id, kind)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, source_id, target_id, kind],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(dead_code)]
pub fn get_node_content_hash(
    conn: &rusqlite::Connection,
    node_id: &str,
) -> Result<Option<String>, String> {
    let hash: Option<String> = conn
        .query_row(
            "SELECT content_hash FROM graph_nodes WHERE id = ?1",
            params![node_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(hash)
}

pub fn delete_edges_for_repo(conn: &rusqlite::Connection, repo_id: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM graph_edges WHERE source_id IN (SELECT id FROM graph_nodes WHERE repo_id = ?1)
         OR target_id IN (SELECT id FROM graph_nodes WHERE repo_id = ?1)",
        params![repo_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM graph_nodes WHERE repo_id = ?1",
        params![repo_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除该仓在 `graph_nodes` / `graph_edges` 中的全部数据，并移除 `graph_index_meta` 行（下次 `get_index_status` 为 idle）。
pub fn clear_repository_graph_index(
    conn: &rusqlite::Connection,
    repo_id: i64,
) -> Result<(), String> {
    delete_edges_for_repo(conn, repo_id)?;
    conn.execute(
        "DELETE FROM graph_index_meta WHERE repo_id = ?1",
        params![repo_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_index_meta(
    conn: &rusqlite::Connection,
    repo_id: i64,
    index_version: &str,
    status: &str,
    error: Option<&str>,
    total_nodes: usize,
    total_edges: usize,
    progress: Option<u8>,
    indexing_current_file: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO graph_index_meta (repo_id, index_version, status, error, total_nodes, total_edges, progress, indexing_current_file)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(repo_id) DO UPDATE SET
           index_version=excluded.index_version, status=excluded.status,
           error=excluded.error, total_nodes=excluded.total_nodes,
           total_edges=excluded.total_edges, progress=COALESCE(excluded.progress, graph_index_meta.progress),
           indexing_current_file=excluded.indexing_current_file, updated_at=datetime('now')",
        params![
            repo_id,
            index_version,
            status,
            error,
            total_nodes,
            total_edges,
            progress,
            indexing_current_file,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 仅更新当前正在处理的源文件路径（每个文件一次），与 `update_index_meta` 的步长写库配合，保证 UI 轮询总能看到最新文件。
#[allow(dead_code)]
pub fn touch_indexing_current_file(
    conn: &rusqlite::Connection,
    repo_id: i64,
    relative_path: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE graph_index_meta SET indexing_current_file = ?2, updated_at = datetime('now')
         WHERE repo_id = ?1 AND status = 'indexing'",
        params![repo_id, relative_path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_index_status(
    conn: &rusqlite::Connection,
    repo_id: i64,
) -> Result<crate::code_knowledge_graph::types::CodeGraphIndexStatusResponse, String> {
    let row: Option<(
        String,
        String,
        Option<String>,
        i64,
        i64,
        i64,
        Option<String>,
    )> = conn
        .query_row(
            "SELECT status, index_version, error, total_nodes, total_edges, progress,
                    indexing_current_file
             FROM graph_index_meta WHERE repo_id = ?1",
            params![repo_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match row {
        Some((
            status,
            index_version,
            error,
            total_nodes,
            total_edges,
            progress,
            indexing_current_file,
        )) => {
            // 索引中：`total_nodes`/`total_edges` 列复用为已扫描源文件数 / 预估总数；触发瞬间两者为 0 时不返回，避免 UI 显示「0/0」。
            let (ifd, ift) = if status == "indexing" && total_edges > 0 {
                (Some(total_nodes), Some(total_edges))
            } else {
                (None, None)
            };
            let icf = if status == "indexing" {
                indexing_current_file.filter(|s| !s.is_empty())
            } else {
                None
            };
            Ok(
                crate::code_knowledge_graph::types::CodeGraphIndexStatusResponse {
                    status,
                    repository_id: repo_id,
                    progress: Some(progress as u8),
                    index_version: Some(index_version),
                    error,
                    indexing_files_done: ifd,
                    indexing_files_total: ift,
                    indexing_current_file: icf,
                },
            )
        }
        None => Ok(
            crate::code_knowledge_graph::types::CodeGraphIndexStatusResponse {
                status: "idle".to_string(),
                repository_id: repo_id,
                progress: None,
                index_version: None,
                error: None,
                indexing_files_done: None,
                indexing_files_total: None,
                indexing_current_file: None,
            },
        ),
    }
}
