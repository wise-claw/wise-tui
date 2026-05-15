pub mod types;
pub mod storage;
pub mod index_extensions;
pub mod indexer;
mod index_cancel;
mod gitnexus_cli_index;
pub mod tsconfig_paths;
pub mod tree_sitter_parser;
pub(crate) mod ts_js_tree_extract;
pub(crate) mod java_tree_extract;
pub mod subgraph;
pub mod search;
pub mod openapi_parser;
pub mod synthetic_openapi;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use types::{
    CodeGraphSubgraphRequest, CodeGraphSubgraphResponse,
    CodeGraphNodeSearchRequest, CodeGraphReindexRequest, CodeGraphIndexStatusResponse,
    CancelCodeGraphReindexOutcome,
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

    let mut resp = subgraph::query_subgraph(
        &conn,
        req.repository_id,
        req.focus_node_id.as_deref(),
        req.hop,
        req.node_type_filter.as_ref().map(|f| f.as_slice()),
        req.direction,
    )?;
    if let Ok(labels) = load_repository_graph_labels_map() {
        enrich_repo_node_labels(&mut resp.nodes, &labels);
    }
    Ok(resp)
}

/// Search indexed nodes across one or more repositories (full `graph_nodes` scan per repo, not the visible subgraph).
#[tauri::command]
pub fn search_code_graph_nodes(
    state: tauri::State<WiseDb>,
    req: CodeGraphNodeSearchRequest,
) -> Result<Vec<types::GraphNode>, String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let lim = req.limit.unwrap_or(80).min(200).max(1) as usize;
    search::search_graph_nodes(&conn, &req.repository_ids, &req.query, lim)
}

/// Trigger reindexing of a repository's knowledge graph.
#[tauri::command]
pub fn trigger_code_graph_reindex(
    state: tauri::State<WiseDb>,
    req: CodeGraphReindexRequest,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let repo_id = req.repository_id;
    let repo_path = lookup_repository_path(repo_id)?;
    let repo_label = match lookup_repository_meta(repo_id) {
        Ok((_, _, label)) => label,
        Err(e) => return Err(e),
    };
    let db_path = crate::wise_paths::wise_dir()
        .map(|d| d.join("wise.db"))
        .map_err(|e| format!("无法定位 Wise 数据目录：{}", e))?;

    {
        let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        storage::update_index_meta(&conn, repo_id, "", "indexing", None, 0, 0, Some(1), None)?;
    }

    // 与 DB `indexing` 同步登记；若放在异步任务后半段，早期失败会留下「僵尸 indexing」且「暂停」无效。
    let cancel_flag = index_cancel::begin_session(repo_id);

    tauri::async_runtime::spawn(async move {
        let app = app;
        let cancel_flag = cancel_flag;

        let db_path_for_blocking = db_path.clone();
        let cancel_for_index = std::sync::Arc::clone(&cancel_flag);
        let conn_result = tokio::task::spawn_blocking(move || {
            rusqlite::Connection::open(&db_path_for_blocking)
                .map_err(|e| e.to_string())
                .and_then(|conn| {
                    indexer::index_repository(
                        &conn,
                        &repo_path,
                        repo_id,
                        &repo_label,
                        Some(cancel_for_index),
                    )
                })
        })
        .await
        .unwrap_or_else(|e| Err(format!("索引任务 join 失败: {}", e)));

        index_cancel::end_session(repo_id, &cancel_flag);

        match conn_result {
            Ok(result) => {
                eprintln!("[code-graph] index complete: repo_id={}, nodes={}, edges={}, files_found={}, files_indexed={}, files_skipped={}",
                    repo_id, result.total_nodes, result.total_edges,
                    result.files_found, result.files_indexed, result.files_skipped);
                let _ = app.emit("code-graph-index-complete", serde_json::json!({
                    "repositoryId": repo_id,
                    "totalNodes": result.total_nodes,
                    "totalEdges": result.total_edges,
                    "errors": result.errors,
                    "filesFound": result.files_found,
                    "filesIndexed": result.files_indexed,
                    "filesSkipped": result.files_skipped,
                }));
            }
            Err(e) => {
                eprintln!("[code-graph] index failed: repo_id={}, error={}", repo_id, e);
                // Update DB status so frontend polling sees the error
                if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                    let _ = crate::code_knowledge_graph::storage::update_index_meta(
                        &conn, repo_id, "", "error", Some(&e), 0, 0, None, None,
                    );
                }
                let _ = app.emit("code-graph-index-error", serde_json::json!({
                    "repositoryId": repo_id,
                    "error": e,
                }));
            }
        }
    });

    Ok("Indexing started".to_string())
}

/// 停止当前仓库正在进行的代码图谱检索（终止 GitNexus 子进程并尽快结束后台任务）。
/// 若 DB 仍为 `indexing` 但进程内已无会话（僵尸状态），则写入错误元数据并返回 `clearedStaleIndexingStatus`。
#[tauri::command]
pub fn cancel_code_graph_reindex(
    state: tauri::State<WiseDb>,
    repository_id: i64,
    app: tauri::AppHandle,
) -> Result<CancelCodeGraphReindexOutcome, String> {
    let signalled = index_cancel::request_cancel(repository_id);
    if signalled {
        return Ok(CancelCodeGraphReindexOutcome {
            signalled_running_task: true,
            cleared_stale_indexing_status: false,
        });
    }

    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let st = storage::get_index_status(&conn, repository_id)?;
    if st.status == "indexing" {
        let msg = index_cancel::INDEX_STALE_ORPHAN_MSG.to_string();
        storage::update_index_meta(
            &conn,
            repository_id,
            "",
            "error",
            Some(&msg),
            0,
            0,
            None,
            None,
        )?;
        drop(conn);
        let _ = app.emit("code-graph-index-error", serde_json::json!({
            "repositoryId": repository_id,
            "error": msg,
        }));
        return Ok(CancelCodeGraphReindexOutcome {
            signalled_running_task: false,
            cleared_stale_indexing_status: true,
        });
    }

    Ok(CancelCodeGraphReindexOutcome {
        signalled_running_task: false,
        cleared_stale_indexing_status: false,
    })
}

fn compute_repository_graph_label(repo_path: &str, name: Option<&str>) -> String {
    name.map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            Path::new(repo_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("repository")
                .to_string()
        })
}

fn load_repository_graph_labels_map() -> Result<HashMap<i64, String>, String> {
    use crate::wise_paths::wise_repositories_json;
    use std::fs;

    let path = wise_repositories_json().map_err(|e| e.to_string())?;
    if !path.exists() {
        return Err(format!("Repositories file not found at {:?}", path));
    }

    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let repos: Vec<serde_json::Value> = serde_json::from_str(&contents).map_err(|e| e.to_string())?;

    let mut m = HashMap::new();
    for repo in &repos {
        let Some(id) = repo.get("id").and_then(|v| v.as_i64()) else {
            continue;
        };
        let Some(p) = repo.get("path").and_then(|v| v.as_str()) else {
            continue;
        };
        let name = repo.get("name").and_then(|v| v.as_str());
        m.insert(id, compute_repository_graph_label(p, name));
    }
    Ok(m)
}

fn enrich_repo_node_labels(nodes: &mut [types::GraphNode], labels: &HashMap<i64, String>) {
    for n in nodes.iter_mut() {
        if n.kind != "repo" {
            continue;
        }
        if let Some(lbl) = labels.get(&n.repo_id) {
            n.label = lbl.clone();
        }
    }
}

fn lookup_repository_meta(repo_id: i64) -> Result<(String, Option<String>, String), String> {
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
            let p = repo
                .get("path")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Repository path field missing".to_string())?;
            let t = repo
                .get("repositoryType")
                .and_then(|v| v.as_str())
                .or_else(|| repo.get("repository_type").and_then(|v| v.as_str()))
                .map(|s| s.to_string());
            let graph_label =
                compute_repository_graph_label(&p, repo.get("name").and_then(|v| v.as_str()));
            return Ok((p, t, graph_label));
        }
    }

    Err(format!("Repository {} not found", repo_id))
}

fn lookup_repository_path(repo_id: i64) -> Result<String, String> {
    lookup_repository_meta(repo_id).map(|(p, _, _)| p)
}

/// 在仓库根及常见子目录查找 OpenAPI / Swagger 描述文件。
fn find_openapi_spec(repo_root: &Path) -> Option<PathBuf> {
    const ROOT_NAMES: &[&str] = &[
        "openapi.yaml",
        "openapi.yml",
        "openapi.json",
        "swagger.yaml",
        "swagger.yml",
        "swagger.json",
    ];
    for name in ROOT_NAMES {
        let p = repo_root.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    for sub in ["docs", "doc", "api"] {
        for name in ["openapi.yaml", "openapi.yml", "openapi.json"] {
            let p = repo_root.join(sub).join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

fn import_openapi_at_path(
    conn: &rusqlite::Connection,
    repository_id: i64,
    openapi_path: &str,
) -> Result<serde_json::Value, String> {
    let content = std::fs::read_to_string(openapi_path)
        .map_err(|e| format!("Cannot read OpenAPI file: {}", e))?;

    let operations = openapi_parser::parse_openapi(&content)?;
    let (nodes, _edges) =
        openapi_parser::ingest_openapi(conn, repository_id, &operations, openapi_path)?;

    let api_ops: Vec<(String, String, String)> = operations
        .iter()
        .map(|op| {
            let id = openapi_parser::make_api_operation_id(repository_id, &op.method, &op.path);
            (id, op.method.clone(), openapi_parser::normalize_path(&op.path))
        })
        .collect();

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
        if !entry.path().is_file() {
            continue;
        }
        let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("");
        if !indexer::SUPPORTED_EXTENSIONS.contains(&ext) {
            continue;
        }

        let file_content = std::fs::read_to_string(entry.path()).unwrap_or_default();
        let relative = entry
            .path()
            .strip_prefix(&repo_path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .to_string();
        let file_node_id = indexer::make_file_node_id(repository_id, &relative);

        if let Ok(re) = regex::Regex::new(r#"\w+\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]"#) {
            for cap in re.captures_iter(&file_content) {
                let method = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_uppercase();
                let path = cap.get(2).map(|m| m.as_str()).unwrap_or("").to_string();
                let normalized = openapi_parser::normalize_path(&path);

                for (op_id, op_method, op_path) in &api_ops {
                    if op_method == &method
                        && (op_path == &normalized
                            || openapi_parser::template_matches(&normalized, op_path))
                    {
                        let edge_id = format!("{file_node_id}:serves:{op_id}");
                        let _ = storage::upsert_edge(conn, &edge_id, &file_node_id, op_id, "backend_serves_api");
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

fn bridge_code_graph_http_conn(
    conn: &rusqlite::Connection,
    frontend_repo_id: i64,
    backend_repo_id: i64,
) -> Result<serde_json::Value, String> {
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
        if !entry.path().is_file() {
            continue;
        }
        let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("");
        if !indexer::SUPPORTED_EXTENSIONS.contains(&ext) {
            continue;
        }

        let file_content = std::fs::read_to_string(entry.path()).unwrap_or_default();
        let calls = openapi_parser::extract_http_calls(&file_content);
        if calls.is_empty() {
            continue;
        }

        let relative = entry
            .path()
            .strip_prefix(&frontend_path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .to_string();
        let file_node_id = indexer::make_file_node_id(frontend_repo_id, &relative);

        let http_calls: Vec<_> = calls
            .into_iter()
            .map(|(method, url, line)| (file_node_id.clone(), method, url, line))
            .collect();

        let edges = openapi_parser::create_invoke_edges(conn, frontend_repo_id, &http_calls, &api_operations)?;
        total_edges += edges;
    }

    Ok(serde_json::json!({
        "edges": total_edges,
        "apiOperationsCount": api_operations.len(),
    }))
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

/// 清空某仓库的代码图谱持久化数据（节点、边、索引元数据）。用于排除旧索引/异常中断残留；清空后需重新检索。
#[tauri::command]
pub fn clear_code_graph_index(
    state: tauri::State<WiseDb>,
    repository_id: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    storage::clear_repository_graph_index(&conn, repository_id)
}

/// Import an OpenAPI file and generate api_operation nodes.
#[tauri::command]
pub fn import_code_graph_openapi(
    state: tauri::State<WiseDb>,
    repository_id: i64,
    openapi_path: String,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    import_openapi_at_path(&conn, repository_id, &openapi_path)
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
    bridge_code_graph_http_conn(&conn, frontend_repo_id, backend_repo_id)
}

/// 多仓关联构建：依次为所选仓库重建代码图谱索引；非前端仓库尝试自动发现 OpenAPI 并导入（否则对非「文档」仓尝试合成路由）；最后对 `repositoryType` 为前端×后端的配对执行 HTTP 桥接。
#[tauri::command]
pub fn trigger_code_graph_association_build(
    _state: tauri::State<WiseDb>,
    repository_ids: Vec<i64>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    if repository_ids.is_empty() {
        return Err("repositoryIds must not be empty".to_string());
    }
    if repository_ids.len() > 20 {
        return Err("repositoryIds must have at most 20 entries".to_string());
    }
    let ids_spawn: Vec<i64> = {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for id in repository_ids {
            if seen.insert(id) {
                out.push(id);
            }
        }
        out
    };

    tauri::async_runtime::spawn(async move {
        let db_path = match crate::wise_paths::wise_dir() {
            Ok(d) => d.join("wise.db"),
            Err(e) => {
                let _ = app.emit("code-graph-association-build-error", serde_json::json!({
                    "repositoryIds": ids_spawn,
                    "error": format!("Cannot find db path: {}", e),
                }));
                return;
            }
        };

        let conn = match rusqlite::Connection::open(&db_path) {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit("code-graph-association-build-error", serde_json::json!({
                    "repositoryIds": ids_spawn,
                    "error": e.to_string(),
                }));
                return;
            }
        };

        for &repo_id in &ids_spawn {
            let (repo_path, _, repo_label) = match lookup_repository_meta(repo_id) {
                Ok(x) => x,
                Err(e) => {
                    let _ = app.emit("code-graph-association-build-error", serde_json::json!({
                        "repositoryIds": ids_spawn,
                        "error": e,
                    }));
                    return;
                }
            };
            let db_path_cl = db_path.clone();
            let index_res = tokio::task::spawn_blocking(move || {
                let c = rusqlite::Connection::open(&db_path_cl).map_err(|e| e.to_string())?;
                match indexer::index_repository(&c, &repo_path, repo_id, &repo_label, None) {
                    Ok(r) => Ok(r),
                    Err(e) => {
                        let _ = storage::update_index_meta(
                            &c, repo_id, "", "error", Some(&e), 0, 0, None, None,
                        );
                        Err(e)
                    }
                }
            })
            .await
            .unwrap_or_else(|e| Err(format!("索引任务 join 失败: {}", e)));

            match index_res {
                Ok(r) => {
                    eprintln!(
                        "[code-graph] association index: repo_id={}, nodes={}, edges={}",
                        repo_id, r.total_nodes, r.total_edges
                    );
                    let _ = app.emit("code-graph-index-complete", serde_json::json!({
                        "repositoryId": repo_id,
                        "totalNodes": r.total_nodes,
                        "totalEdges": r.total_edges,
                        "errors": r.errors,
                        "filesFound": r.files_found,
                        "filesIndexed": r.files_indexed,
                        "filesSkipped": r.files_skipped,
                    }));
                }
                Err(e) => {
                    eprintln!("[code-graph] association index failed: repo_id={}, error={}", repo_id, e);
                    let _ = app.emit("code-graph-index-error", serde_json::json!({
                        "repositoryId": repo_id,
                        "error": e,
                    }));
                    let _ = app.emit("code-graph-association-build-error", serde_json::json!({
                        "repositoryIds": ids_spawn,
                        "error": format!("索引仓库 {} 失败: {}", repo_id, e),
                    }));
                    return;
                }
            }
        }

        for &repo_id in &ids_spawn {
            let (repo_path, ref_kind, _) = match lookup_repository_meta(repo_id) {
                Ok(x) => x,
                Err(_) => continue,
            };
            if ref_kind.as_deref() == Some("frontend") {
                continue;
            }
            let root = Path::new(&repo_path);
            if let Some(spec) = find_openapi_spec(root) {
                let spec_str = spec.to_string_lossy();
                if let Err(e) = import_openapi_at_path(&conn, repo_id, &spec_str) {
                    eprintln!(
                        "[code-graph] association OpenAPI import failed: repo_id={}, error={}",
                        repo_id, e
                    );
                    let _ = app.emit("code-graph-association-build-error", serde_json::json!({
                        "repositoryIds": ids_spawn,
                        "error": format!("OpenAPI 导入失败 (仓库 {}): {}", repo_id, e),
                    }));
                    return;
                }
            } else if ref_kind.as_deref() != Some("document") {
                let routes = match synthetic_openapi::extract_routes_from_repo(&repo_path, repo_id) {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = app.emit("code-graph-association-build-error", serde_json::json!({
                            "repositoryIds": ids_spawn,
                            "error": format!("合成路由扫描失败 (仓库 {}): {}", repo_id, e),
                        }));
                        return;
                    }
                };
                if let Err(e) = synthetic_openapi::ingest_synthetic_routes(&conn, repo_id, &routes) {
                    let _ = app.emit("code-graph-association-build-error", serde_json::json!({
                        "repositoryIds": ids_spawn,
                        "error": format!("合成路由写入失败 (仓库 {}): {}", repo_id, e),
                    }));
                    return;
                }
            }
        }

        let mut fronts = Vec::new();
        let mut backs = Vec::new();
        for &repo_id in &ids_spawn {
            let (_, ref_kind, _) = match lookup_repository_meta(repo_id) {
                Ok(x) => x,
                Err(_) => continue,
            };
            match ref_kind.as_deref() {
                Some("frontend") => fronts.push(repo_id),
                Some("backend") => backs.push(repo_id),
                _ => {}
            }
        }
        for &f in &fronts {
            for &b in &backs {
                if f == b {
                    continue;
                }
                if let Err(e) = bridge_code_graph_http_conn(&conn, f, b) {
                    eprintln!("[code-graph] association bridge {} -> {} failed: {}", f, b, e);
                }
            }
        }

        let _ = app.emit("code-graph-association-build-complete", serde_json::json!({
            "repositoryIds": ids_spawn,
        }));
    });

    Ok("Association build started".to_string())
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

/// 多仓合并子图时，全局 `focus_node_id` 仅适用于「节点 ID 首段 `repo_id`」与该次查询的仓库一致的子图。
/// 否则对该仓传入 `None`，使 `query_subgraph` 从 `{repo_id}:repo:root` 展开，避免把其它仓的焦点误用于本仓
/// （否则 BFS 起点不在本仓图中，该仓子图几乎为空，表现为「前端仓没有解析出来」）。
fn focus_node_id_for_merged_repo_query<'a>(repo_id: i64, focus_node_id: Option<&'a str>) -> Option<&'a str> {
    let id = focus_node_id.filter(|s| !s.is_empty())?;
    let leading_repo = id
        .split_once(':')
        .and_then(|(prefix, _)| prefix.parse::<i64>().ok())?;
    if leading_repo == repo_id {
        Some(id)
    } else {
        None
    }
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
    let hop_opt = hop;

    // Collect nodes and edges from each repo, merging them
    let mut all_nodes: Vec<types::GraphNode> = Vec::new();
    let mut all_edges: Vec<types::GraphEdge> = Vec::new();
    let mut all_node_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut max_total_edges = 0;

    for repo_id in &repository_ids {
        let focus_for_repo = focus_node_id_for_merged_repo_query(*repo_id, focus_node_id.as_deref());
        let result = subgraph::query_subgraph(
            &conn,
            *repo_id,
            focus_for_repo,
            hop_opt,
            None,
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

    let labels = load_repository_graph_labels_map().unwrap_or_default();

    const MAX_NODES: usize = 5000;
    let truncated = all_nodes.len() > MAX_NODES;
    let mut final_nodes: Vec<types::GraphNode> = if truncated {
        all_nodes.into_iter().take(MAX_NODES).collect()
    } else {
        all_nodes
    };
    enrich_repo_node_labels(&mut final_nodes, &labels);

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

#[cfg(test)]
mod merged_subgraph_focus_tests {
    use super::focus_node_id_for_merged_repo_query;

    #[test]
    fn focus_only_applies_to_matching_repo_prefix() {
        assert_eq!(
            focus_node_id_for_merged_repo_query(5, Some("7:file:deadbeef")),
            None
        );
        assert_eq!(
            focus_node_id_for_merged_repo_query(5, Some("5:file:deadbeef")),
            Some("5:file:deadbeef")
        );
        assert_eq!(
            focus_node_id_for_merged_repo_query(56, Some("5:file:deadbeef")),
            None
        );
        assert_eq!(
            focus_node_id_for_merged_repo_query(56, Some("56:repo:root")),
            Some("56:repo:root")
        );
    }

    #[test]
    fn empty_or_malformed_focus_falls_back_to_root_via_none() {
        assert_eq!(focus_node_id_for_merged_repo_query(5, None), None);
        assert_eq!(focus_node_id_for_merged_repo_query(5, Some("")), None);
        assert_eq!(focus_node_id_for_merged_repo_query(5, Some("nocolon")), None);
    }
}
