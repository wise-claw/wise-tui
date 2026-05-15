use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use sha2::{Digest, Sha256};

use crate::code_knowledge_graph::storage as graph_storage;

pub const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    ".trellis",
    ".claude",
    "target",
    "__pycache__",
];
pub use super::index_extensions::SUPPORTED_EXTENSIONS;

pub struct IndexResult {
    pub total_nodes: usize,
    pub total_edges: usize,
    pub errors: Vec<crate::code_knowledge_graph::types::ParseError>,
    pub files_found: usize,
    pub files_indexed: usize,
    pub files_skipped: usize,
}

/// 全仓索引：调用 **GitNexus CLI** `gitnexus analyze`，再从 `.gitnexus/kuzu` 导入 Wise SQLite。
pub fn index_repository(
    conn: &rusqlite::Connection,
    repo_path: &str,
    repo_id: i64,
    repo_root_label: &str,
    cancel: Option<Arc<AtomicBool>>,
) -> Result<IndexResult, String> {
    crate::code_knowledge_graph::gitnexus_cli_index::index_repository(
        conn,
        Path::new(repo_path),
        repo_id,
        repo_root_label,
        cancel,
    )
}

pub fn compute_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let result = hasher.finalize();
    result[..8].iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn make_file_node_id(repo_id: i64, relative_path: &str) -> String {
    let normalized = relative_path.replace('\\', "/");
    let hash = compute_hash(&normalized);
    format!("{repo_id}:file:{hash}")
}

pub(crate) fn folder_node_id_for_repo_path(repo_id: i64, current_path: &str) -> String {
    let normalized = current_path.replace('\\', "/");
    let folder_hash = compute_hash(&format!("{repo_id}:folder:{normalized}"));
    format!("{repo_id}:folder:{folder_hash}")
}

pub(crate) fn add_folder_hierarchy(
    conn: &rusqlite::Connection,
    repo_id: i64,
    relative_path: &str,
    repo_node_id: &str,
) -> Result<usize, String> {
    let normalized = relative_path.replace('\\', "/");
    let parts: Vec<&str> = normalized.split('/').collect();
    if parts.len() <= 1 {
        return Ok(0);
    }

    let mut folder_count = 0;
    let mut current_path = String::new();
    let mut parent_node_id = repo_node_id.to_string();

    for part in &parts[..parts.len() - 1] {
        if !current_path.is_empty() {
            current_path.push('/');
        }
        current_path.push_str(part);

        let folder_node_id = folder_node_id_for_repo_path(repo_id, &current_path);

        graph_storage::upsert_node(
            conn,
            &folder_node_id,
            "folder",
            None,
            *part,
            &current_path,
            repo_id,
            None,
            None,
        )?;

        graph_storage::upsert_edge(
            conn,
            &format!("{parent_node_id}:contains:{folder_node_id}"),
            &parent_node_id,
            &folder_node_id,
            "contains",
        )?;

        parent_node_id = folder_node_id;
        folder_count += 1;
    }

    let file_node_id = make_file_node_id(repo_id, relative_path);
    graph_storage::upsert_edge(
        conn,
        &format!("{parent_node_id}:contains:{file_node_id}"),
        &parent_node_id,
        &file_node_id,
        "contains",
    )?;

    Ok(folder_count)
}
