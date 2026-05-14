pub mod types;
pub mod storage;
pub mod indexer;
pub mod tree_sitter_parser;
pub mod subgraph;
pub mod openapi_parser;
pub mod synthetic_openapi;

use types::{
    CodeGraphSubgraphRequest, CodeGraphSubgraphResponse,
    CodeGraphReindexRequest, CodeGraphIndexStatusResponse,
};
use crate::wise_db::WiseDb;
use tauri::Emitter;

/// Query a subgraph from a repository's knowledge graph.
#[tauri::command]
pub fn get_code_graph_subgraph(
    state: tauri::State<WiseDb>,
    req: CodeGraphSubgraphRequest,
) -> Result<CodeGraphSubgraphResponse, String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;

    subgraph::query_subgraph(
        &conn,
        req.repository_id,
        req.focus_node_id.as_deref(),
        req.hop.unwrap_or(1),
        req.node_type_filter.as_ref().map(|f| f.as_slice()),
    )
}

/// Trigger reindexing of a repository's knowledge graph.
#[tauri::command]
pub fn trigger_code_graph_reindex(
    _state: tauri::State<WiseDb>,
    req: CodeGraphReindexRequest,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let repo_path = lookup_repository_path(req.repository_id)?;
    let repo_id = req.repository_id;

    tauri::async_runtime::spawn(async move {
        let repo_path = repo_path;
        let app = app;

        let db_path = match crate::wise_paths::wise_dir() {
            Ok(d) => d.join("wise.db"),
            Err(e) => {
                let _ = app.emit("code-graph-index-error", serde_json::json!({
                    "repositoryId": repo_id,
                    "error": format!("Cannot find db path: {}", e),
                }));
                return;
            }
        };

        let conn_result = rusqlite::Connection::open(&db_path)
            .map_err(|e| e.to_string())
            .and_then(|conn| indexer::index_repository(&conn, &repo_path, repo_id));

        match conn_result {
            Ok(result) => {
                let _ = app.emit("code-graph-index-complete", serde_json::json!({
                    "repositoryId": repo_id,
                    "totalNodes": result.total_nodes,
                    "totalEdges": result.total_edges,
                    "errors": result.errors,
                }));
            }
            Err(e) => {
                let _ = app.emit("code-graph-index-error", serde_json::json!({
                    "repositoryId": repo_id,
                    "error": e,
                }));
            }
        }
    });

    Ok("Indexing started".to_string())
}

fn lookup_repository_path(repo_id: i64) -> Result<String, String> {
    use crate::wise_paths::wise_repositories_json;
    use std::fs;

    let path = wise_repositories_json().map_err(|e| e.to_string())?;
    if !path.exists() {
        return Err(format!("Repositories file not found at {:?}", path));
    }

    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let repos: Vec<serde_json::Value> = serde_json::from_str(&contents).map_err(|e| e.to_string())?;

    for repo in &repos {
        if repo.get("id").and_then(|v| v.as_i64()) == Some(repo_id) {
            return repo
                .get("path")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Repository path field missing".to_string());
        }
    }

    Err(format!("Repository {} not found", repo_id))
}

/// Get the current indexing status for a repository.
#[tauri::command]
pub fn get_code_graph_index_status(
    state: tauri::State<WiseDb>,
    repository_id: i64,
) -> Result<CodeGraphIndexStatusResponse, String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    storage::get_index_status(&conn, repository_id)
}

/// Import an OpenAPI file and generate api_operation nodes.
#[tauri::command]
pub fn import_code_graph_openapi(
    state: tauri::State<WiseDb>,
    repository_id: i64,
    openapi_path: String,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let content = std::fs::read_to_string(&openapi_path)
        .map_err(|e| format!("Cannot read OpenAPI file: {}", e))?;

    let operations = openapi_parser::parse_openapi(&content)?;
    let (nodes, _edges) = openapi_parser::ingest_openapi(&conn, repository_id, &operations, &openapi_path)?;

    // Also create backend_serves_api edges: match file-based route handlers to api_operations
    // Collect all api_operation IDs with their method+path for matching
    let api_ops: Vec<(String, String, String)> = operations
        .iter()
        .map(|op| {
            let id = openapi_parser::make_api_operation_id(repository_id, &op.method, &op.path);
            (id, op.method.clone(), openapi_parser::normalize_path(&op.path))
        })
        .collect();

    // Scan the repo for route handlers (basic Express/Fastify pattern matching)
    let repo_path = lookup_repository_path(repository_id)?;
    let mut backend_edges = 0;
    for entry in walkdir::WalkDir::new(&repo_path)
        .into_iter()
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|s| !indexer::IGNORED_DIRS.contains(&s))
                .unwrap_or(false)
        })
        .flatten()
    {
        if !entry.path().is_file() { continue; }
        let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("");
        if !indexer::SUPPORTED_EXTENSIONS.contains(&ext) { continue; }

        let file_content = std::fs::read_to_string(entry.path()).unwrap_or_default();
        let relative = entry.path().strip_prefix(&repo_path).unwrap_or(entry.path()).to_string_lossy().to_string();
        let file_node_id = indexer::make_file_node_id(repository_id, &relative);

        // Extract route patterns: app.get('/path'), router.post('/path'), etc.
        if let Ok(re) = regex::Regex::new(r#"\w+\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]"#) {
            for cap in re.captures_iter(&file_content) {
                let method = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_uppercase();
                let path = cap.get(2).map(|m| m.as_str()).unwrap_or("").to_string();
                let normalized = openapi_parser::normalize_path(&path);

                for (op_id, op_method, op_path) in &api_ops {
                    if op_method == &method && (op_path == &normalized || openapi_parser::template_matches(&normalized, op_path)) {
                        let edge_id = format!("{file_node_id}:serves:{op_id}");
                        let _ = storage::upsert_edge(&conn, &edge_id, &file_node_id, op_id, "backend_serves_api");
                        backend_edges += 1;
                        break;
                    }
                }
            }
        }
    }

    Ok(serde_json::json!({
        "apiOperations": nodes,
        "backendEdges": backend_edges,
    }))
}

/// Scan a frontend repository for HTTP calls and create frontend_invokes_api edges
/// to api_operation nodes in the specified backend repository.
#[tauri::command]
pub fn bridge_code_graph_http(
    state: tauri::State<WiseDb>,
    frontend_repo_id: i64,
    backend_repo_id: i64,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;

    // Collect all api_operation nodes from the backend repo
    let api_ops = conn
        .prepare(
            "SELECT id, label FROM graph_nodes WHERE repo_id = ?1 AND kind = 'api_operation'",
        )
        .map_err(|e| e.to_string())?
        .query_map(rusqlite::params![backend_repo_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect::<Vec<_>>();

    // Parse label "GET /api/users" into (id, method, normalized_path)
    let api_operations: Vec<(String, String, String)> = api_ops
        .iter()
        .filter_map(|(id, label)| {
            let parts: Vec<&str> = label.splitn(2, ' ').collect();
            if parts.len() == 2 {
                Some((id.clone(), parts[0].to_string(), openapi_parser::normalize_path(parts[1])))
            } else {
                None
            }
        })
        .collect();

    if api_operations.is_empty() {
        return Ok(serde_json::json!({
            "edges": 0,
            "reason": "No api_operation nodes found in backend repo",
        }));
    }

    // Scan frontend repo for HTTP calls
    let frontend_path = lookup_repository_path(frontend_repo_id)?;
    let mut total_edges = 0;

    for entry in walkdir::WalkDir::new(&frontend_path)
        .into_iter()
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|s| !indexer::IGNORED_DIRS.contains(&s))
                .unwrap_or(false)
        })
        .flatten()
    {
        if !entry.path().is_file() { continue; }
        let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("");
        if !indexer::SUPPORTED_EXTENSIONS.contains(&ext) { continue; }

        let file_content = std::fs::read_to_string(entry.path()).unwrap_or_default();
        let calls = openapi_parser::extract_http_calls(&file_content);
        if calls.is_empty() { continue; }

        let relative = entry.path().strip_prefix(&frontend_path).unwrap_or(entry.path()).to_string_lossy().to_string();
        let file_node_id = indexer::make_file_node_id(frontend_repo_id, &relative);

        let http_calls: Vec<_> = calls
            .into_iter()
            .map(|(method, url, line)| (file_node_id.clone(), method, url, line))
            .collect();

        let edges = openapi_parser::create_invoke_edges(
            &conn, frontend_repo_id, &http_calls, &api_operations,
        )?;
        total_edges += edges;
    }

    Ok(serde_json::json!({
        "edges": total_edges,
        "apiOperationsCount": api_operations.len(),
    }))
}

/// Extract routes from a backend repository and generate synthetic api_operation nodes.
/// Used when no OpenAPI spec exists.
#[tauri::command]
pub fn extract_code_graph_synthetic_routes(
    state: tauri::State<WiseDb>,
    repository_id: i64,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let repo_path = lookup_repository_path(repository_id)?;

    let routes = synthetic_openapi::extract_routes_from_repo(&repo_path, repository_id)?;
    let (nodes, edges) = synthetic_openapi::ingest_synthetic_routes(&conn, repository_id, &routes)?;

    Ok(serde_json::json!({
        "apiOperations": nodes,
        "backendEdges": edges,
        "routesFound": routes.len(),
    }))
}

/// Query a subgraph across multiple repositories in a project.
/// Returns the union of subgraphs from each repository.
#[tauri::command]
pub fn get_code_graph_multi_subgraph(
    state: tauri::State<WiseDb>,
    repository_ids: Vec<i64>,
    focus_node_id: Option<String>,
    hop: Option<u8>,
    include_cross_repo_edges: Option<bool>,
) -> Result<types::CodeGraphSubgraphResponse, String> {
    if repository_ids.is_empty() {
        return Err("repositoryIds must not be empty".to_string());
    }
    if repository_ids.len() > 20 {
        return Err("repositoryIds must have at most 20 entries".to_string());
    }

    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let hop = hop.unwrap_or(1).min(3);

    // Collect nodes and edges from each repo, merging them
    let mut all_nodes: Vec<types::GraphNode> = Vec::new();
    let mut all_edges: Vec<types::GraphEdge> = Vec::new();
    let mut all_node_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut max_total_edges = 0;

    for repo_id in &repository_ids {
        let result = subgraph::query_subgraph(
            &conn,
            *repo_id,
            focus_node_id.as_deref(),
            hop,
            None,
        )?;
        max_total_edges += result.meta.total_edge_hint.unwrap_or(0);

        for n in result.nodes {
            if all_node_ids.insert(n.id.clone()) {
                all_nodes.push(n);
            }
        }
        for e in result.edges {
            all_edges.push(e);
        }
    }

    // If cross-repo edges are requested, also fetch edges between repos
    if include_cross_repo_edges.unwrap_or(false) {
        for repo_id in &repository_ids {
            for other_id in &repository_ids {
                if repo_id == other_id { continue; }
                if let Ok(mut stmt) = conn.prepare(
                    "SELECT e.id, e.source_id, e.target_id, e.kind, e.props
                     FROM graph_edges e
                     JOIN graph_nodes s ON e.source_id = s.id
                     JOIN graph_nodes t ON e.target_id = t.id
                     WHERE s.repo_id = ?1 AND t.repo_id = ?2",
                ) {
                    if let Ok(rows) = stmt.query_map(
                        rusqlite::params![repo_id, other_id],
                        |row| {
                            Ok(types::GraphEdge {
                                id: row.get(0)?,
                                source: row.get(1)?,
                                target: row.get(2)?,
                                kind: row.get(3)?,
                                props: row.get::<_, Option<String>>(4)?.and_then(|s| serde_json::from_str(&s).ok()),
                            })
                        },
                    ) {
                        for row in rows.filter_map(|r| r.ok()) {
                            all_edges.push(row);
                        }
                    }
                }
            }
        }
    }

    const MAX_NODES: usize = 5000;
    let truncated = all_nodes.len() > MAX_NODES;
    let final_nodes: Vec<types::GraphNode> = if truncated {
        all_nodes.into_iter().take(MAX_NODES).collect()
    } else {
        all_nodes
    };

    Ok(types::CodeGraphSubgraphResponse {
        nodes: final_nodes,
        edges: all_edges,
        meta: types::GraphMeta {
            truncated,
            total_edge_hint: Some(max_total_edges),
            index_version: "multi".to_string(),
            errors: None,
        },
    })
}
