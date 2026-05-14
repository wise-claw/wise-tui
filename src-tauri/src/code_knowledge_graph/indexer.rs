use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::code_knowledge_graph::storage as graph_storage;
use crate::code_knowledge_graph::tree_sitter_parser;

pub const IGNORED_DIRS: &[&str] = &[".git", "node_modules", "dist", "build", ".trellis", ".claude", "target", "__pycache__"];
pub const SUPPORTED_EXTENSIONS: &[&str] = &[".ts", ".tsx", ".js", ".jsx"];

pub struct IndexResult {
    pub total_nodes: usize,
    pub total_edges: usize,
    pub errors: Vec<crate::code_knowledge_graph::types::ParseError>,
}

pub fn index_repository(
    conn: &rusqlite::Connection,
    repo_path: &str,
    repo_id: i64,
) -> Result<IndexResult, String> {
    // Clear existing graph data for this repo
    graph_storage::delete_edges_for_repo(conn, repo_id)?;

    let repo_node_id = format!("{repo_id}:repo:root");
    graph_storage::upsert_node(
        conn,
        &repo_node_id,
        "repo",
        None,
        "repo",
        "/",
        repo_id,
        None,
        None,
    )?;

    let mut total_nodes = 1;
    let mut total_edges = 0;
    let mut errors = Vec::new();

    let mut ts_parser = tree_sitter_parser::Parser::new();

    for entry in WalkDir::new(repo_path)
        .into_iter()
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|s| !IGNORED_DIRS.contains(&s))
                .unwrap_or(false)
        })
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if !SUPPORTED_EXTENSIONS.contains(&ext) {
            continue;
        }

        let relative = path
            .strip_prefix(repo_path)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        // Compute content hash for incremental indexing
        let content = std::fs::read_to_string(path).unwrap_or_default();
        let content_hash = compute_hash(&content);
        let file_node_id = make_file_node_id(repo_id, &relative);

        // Skip if content unchanged
        if let Some(existing_hash) = graph_storage::get_node_content_hash(conn, &file_node_id)? {
            if existing_hash == content_hash {
                continue;
            }
        }

        // Add folder nodes and contains edges for path segments
        let folder_count = add_folder_hierarchy(conn, repo_id, &relative, &repo_node_id)?;
        total_nodes += folder_count;
        total_edges += folder_count;

        // Parse file and extract symbols
        match ts_parser.parse_file(&content, &file_node_id, repo_id, &relative, conn) {
            Ok((nodes, edges)) => {
                total_nodes += nodes;
                total_edges += edges;
            }
            Err(msg) => {
                errors.push(crate::code_knowledge_graph::types::ParseError {
                    file: relative,
                    message: msg,
                });
            }
        }
    }

    let index_version = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
    graph_storage::update_index_meta(
        conn,
        repo_id,
        &index_version,
        "done",
        None,
        total_nodes,
        total_edges,
    )?;

    Ok(IndexResult {
        total_nodes,
        total_edges,
        errors,
    })
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

fn add_folder_hierarchy(
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

        let folder_hash = compute_hash(&format!("{repo_id}:folder:{current_path}"));
        let folder_node_id = format!("{repo_id}:folder:{folder_hash}");

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

    // Add file -> parent folder contains edge
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
