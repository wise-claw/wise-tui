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
            id, kind, symbol_kind, label, path, repo_id,
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

pub fn update_index_meta(
    conn: &rusqlite::Connection,
    repo_id: i64,
    index_version: &str,
    status: &str,
    error: Option<&str>,
    total_nodes: usize,
    total_edges: usize,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO graph_index_meta (repo_id, index_version, status, error, total_nodes, total_edges)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(repo_id) DO UPDATE SET
           index_version=excluded.index_version, status=excluded.status,
           error=excluded.error, total_nodes=excluded.total_nodes,
           total_edges=excluded.total_edges, updated_at=datetime('now')",
        params![repo_id, index_version, status, error, total_nodes, total_edges],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_index_status(
    conn: &rusqlite::Connection,
    repo_id: i64,
) -> Result<crate::code_knowledge_graph::types::CodeGraphIndexStatusResponse, String> {
    let row: Option<(String, String, Option<String>, i64, i64)> = conn
        .query_row(
            "SELECT status, index_version, error, total_nodes, total_edges
             FROM graph_index_meta WHERE repo_id = ?1",
            params![repo_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match row {
        Some((status, index_version, error, _total_nodes, _total_edges)) => {
            Ok(crate::code_knowledge_graph::types::CodeGraphIndexStatusResponse {
                status,
                repository_id: repo_id,
                progress: Some(100),
                index_version: Some(index_version),
                error,
            })
        }
        None => Ok(crate::code_knowledge_graph::types::CodeGraphIndexStatusResponse {
            status: "idle".to_string(),
            repository_id: repo_id,
            progress: None,
            index_version: None,
            error: None,
        }),
    }
}
