use std::path::Path;

use super::synthetic_openapi;

pub fn repo_has_frontend_api_dir(repo_path: &str) -> bool {
    Path::new(repo_path).join("src/api").is_dir()
}

pub fn classify_frontend_backend_repo_ids(
    repo_ids: &[i64],
    lookup_meta: &dyn Fn(i64) -> Result<(String, Option<String>, String), String>,
) -> Result<(Vec<i64>, Vec<i64>), String> {
    let mut frontends = Vec::new();
    let mut backends = Vec::new();
    let mut untyped = Vec::new();

    for &id in repo_ids {
        let (path, kind, _) = lookup_meta(id)?;
        match kind.as_deref() {
            Some("frontend") => frontends.push(id),
            Some("backend") => backends.push(id),
            _ => untyped.push((id, path)),
        }
    }

    for (id, path) in untyped {
        if repo_has_frontend_api_dir(&path) {
            frontends.push(id);
        } else {
            backends.push(id);
        }
    }

    frontends.sort_unstable();
    frontends.dedup();
    backends.sort_unstable();
    backends.dedup();

    Ok((frontends, backends))
}

pub fn build_api_associations_conn(
    conn: &rusqlite::Connection,
    repo_ids: &[i64],
    lookup_path: &dyn Fn(i64) -> Result<String, String>,
    lookup_meta: &dyn Fn(i64) -> Result<(String, Option<String>, String), String>,
) -> Result<serde_json::Value, String> {
    if repo_ids.len() < 2 {
        return Ok(serde_json::json!({
            "skipped": true,
            "reason": "少于 2 个仓库"
        }));
    }

    let (frontends, backends) = classify_frontend_backend_repo_ids(repo_ids, lookup_meta)?;
    if frontends.is_empty() || backends.is_empty() {
        return Ok(serde_json::json!({
            "skipped": true,
            "reason": "未识别到 frontend/backend 仓库对（请设置 repositoryType 或确保存在 src/api）",
            "frontends": frontends,
            "backends": backends,
        }));
    }

    let mut synthetic_routes_total = 0usize;
    let mut synthetic_nodes = 0usize;
    let mut bridge_edges = 0usize;
    let mut bridge_pairs = Vec::new();

    for &backend_id in &backends {
        let repo_path = lookup_path(backend_id)?;
        let routes = synthetic_openapi::extract_routes_from_repo(&repo_path, backend_id)?;
        synthetic_routes_total += routes.len();
        let (nodes, _edges) = synthetic_openapi::ingest_synthetic_routes(conn, backend_id, &routes)?;
        synthetic_nodes += nodes;
    }

    for &frontend_id in &frontends {
        for &backend_id in &backends {
            let bridge = super::bridge_code_graph_http_scoped_conn(
                conn,
                frontend_id,
                backend_id,
                Some("src/api"),
            )?;
            let edges = bridge
                .get("edges")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;
            bridge_edges += edges;
            bridge_pairs.push(serde_json::json!({
                "frontendRepoId": frontend_id,
                "backendRepoId": backend_id,
                "edges": edges,
                "apiOperationsCount": bridge.get("apiOperationsCount"),
                "reason": bridge.get("reason"),
            }));
        }
    }

    Ok(serde_json::json!({
        "frontends": frontends,
        "backends": backends,
        "syntheticRoutesFound": synthetic_routes_total,
        "syntheticApiOperations": synthetic_nodes,
        "bridgeEdges": bridge_edges,
        "pairs": bridge_pairs,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::code_knowledge_graph::storage;

    #[test]
    fn detects_src_api_as_frontend_hint() {
        let root = env!("CARGO_MANIFEST_DIR");
        // workspace crate root always exists; src/api may not — just ensure fn compiles
        let _ = repo_has_frontend_api_dir(root);
    }

    #[test]
    fn upsert_edge_if_nodes_exist_skips_missing_endpoints() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE graph_nodes (
                id TEXT PRIMARY KEY, kind TEXT, symbol_kind TEXT, label TEXT, path TEXT,
                repo_id INTEGER, range_start_line INTEGER, range_start_col INTEGER,
                range_end_line INTEGER, range_end_col INTEGER, content_hash TEXT,
                created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE graph_edges (
                id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES graph_nodes(id),
                target_id TEXT NOT NULL REFERENCES graph_nodes(id), kind TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );",
        )
        .unwrap();
        storage::upsert_node(
            &conn,
            "target",
            "api_operation",
            None,
            "GET /api/x",
            "Controller.java",
            1,
            None,
            None,
        )
        .unwrap();
        let inserted = storage::upsert_edge_if_nodes_exist(
            &conn,
            "missing-file:serves:target",
            "missing-file",
            "target",
            "backend_serves_api",
        )
        .unwrap();
        assert!(!inserted);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM graph_edges", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    #[ignore = "requires local ~/.wise/repositories.json and indexed repos"]
    fn build_api_associations_against_wise_home() {
        use crate::wise_paths::wise_repositories_json;
        use std::fs;

        let db = dirs::home_dir()
            .expect("home")
            .join(".wise/wise.db");
        if !db.exists() {
            return;
        }
        let repos_path = wise_repositories_json().expect("repos json path");
        let repos: Vec<serde_json::Value> =
            serde_json::from_str(&fs::read_to_string(&repos_path).unwrap()).unwrap();
        let lookup_meta = |id: i64| -> Result<(String, Option<String>, String), String> {
            for repo in &repos {
                if repo.get("id").and_then(|v| v.as_i64()) == Some(id) {
                    let p = repo
                        .get("path")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "missing path".to_string())?
                        .to_string();
                    let t = repo
                        .get("repositoryType")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let name = repo
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("repo")
                        .to_string();
                    return Ok((p, t, name));
                }
            }
            Err(format!("repo {id} not found"))
        };
        let lookup_path = |id: i64| lookup_meta(id).map(|(p, _, _)| p);

        let conn = rusqlite::Connection::open(&db).unwrap();
        let ids = vec![1778156178238_i64, 1778679702252_i64];
        let result = build_api_associations_conn(&conn, &ids, &lookup_path, &lookup_meta)
            .expect("association should not FK-fail");
        eprintln!("{result}");
        let edges = result
            .get("bridgeEdges")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        assert!(edges > 0, "expected frontend_invokes_api edges");
    }
}
