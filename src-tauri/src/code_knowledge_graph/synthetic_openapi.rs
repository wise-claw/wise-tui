use std::collections::HashSet;

use crate::code_knowledge_graph::indexer;
use crate::code_knowledge_graph::openapi_parser;
use crate::code_knowledge_graph::storage as graph_storage;

/// Extract route definitions from backend code patterns.
/// Supports Express, Fastify, Koa, and similar frameworks.
pub struct ExtractedRoute {
    pub method: String,
    pub path: String,
    pub file_path: String,
    pub line: usize,
    pub handler_name: Option<String>,
}

/// Scan a repository for backend route patterns.
pub fn extract_routes_from_repo(
    repo_path: &str,
    _repo_id: i64,
) -> Result<Vec<ExtractedRoute>, String> {
    let mut routes = Vec::new();

    for entry in walkdir::WalkDir::new(repo_path)
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
        let ext = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if !indexer::SUPPORTED_EXTENSIONS.contains(&ext) {
            continue;
        }

        let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
        let relative = entry
            .path()
            .strip_prefix(repo_path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .to_string();

        // Express: app.get('/path'), router.post('/path')
        if let Ok(re) = regex::Regex::new(
            r#"(?:app|router|server)\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*['"]([^'"]+)['"]"#,
        ) {
            for cap in re.captures_iter(&content) {
                let method = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_uppercase();
                let path = cap.get(2).map(|m| m.as_str()).unwrap_or("").to_string();
                let line = content[..cap.get(0).unwrap().start()].matches('\n').count() + 1;
                routes.push(ExtractedRoute {
                    method,
                    path,
                    file_path: relative.clone(),
                    line,
                    handler_name: None,
                });
            }
        }

        // Next.js: export async function GET/POST (app router)
        if let Ok(re) = regex::Regex::new(
            r#"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\("#,
        ) {
            for cap in re.captures_iter(&content) {
                let method = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_uppercase();
                // Derive path from file path (app/api/users/route.ts -> /api/users)
                let path = derive_nextjs_path(&relative);
                let line = content[..cap.get(0).unwrap().start()].matches('\n').count() + 1;
                routes.push(ExtractedRoute {
                    method: method.clone(),
                    path,
                    file_path: relative.clone(),
                    line,
                    handler_name: Some(method),
                });
            }
        }

        // Fastify: fastify.get('/path', ...)
        if let Ok(re) = regex::Regex::new(
            r#"fastify\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*['"]([^'"]+)['"]"#,
        ) {
            for cap in re.captures_iter(&content) {
                let method = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_uppercase();
                let path = cap.get(2).map(|m| m.as_str()).unwrap_or("").to_string();
                let line = content[..cap.get(0).unwrap().start()].matches('\n').count() + 1;
                routes.push(ExtractedRoute {
                    method,
                    path,
                    file_path: relative.clone(),
                    line,
                    handler_name: None,
                });
            }
        }

        // Python: @app.route('/path', methods=['GET']) or @router.get('/path')
        if ext == "py" {
            if let Ok(re) = regex::Regex::new(
                r#"@(?:app|router)\.route\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*methods\s*=\s*\[([^\]]*)\])?"#,
            ) {
                for cap in re.captures_iter(&content) {
                    let path = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                    let methods_str = cap.get(2).map(|m| m.as_str()).unwrap_or("GET");
                    let line = content[..cap.get(0).unwrap().start()].matches('\n').count() + 1;
                    for method in methods_str.split(',') {
                        let m = method
                            .trim()
                            .trim_matches(|c| c == '\'' || c == '"')
                            .to_uppercase();
                        if !m.is_empty() {
                            routes.push(ExtractedRoute {
                                method: m,
                                path: path.clone(),
                                file_path: relative.clone(),
                                line,
                                handler_name: None,
                            });
                        }
                    }
                }
            }
        }
    }

    // Deduplicate
    let mut seen = HashSet::new();
    routes.retain(|r| {
        let key = format!("{}:{}:{}", r.method, r.path, r.file_path);
        seen.insert(key)
    });

    Ok(routes)
}

/// Derive a Next.js App Router path from a route.ts file path.
fn derive_nextjs_path(relative: &str) -> String {
    let normalized = relative.replace('\\', "/");
    // app/api/users/[id]/route.ts -> /api/users/{id}
    let path = normalized
        .strip_prefix("app/")
        .unwrap_or(&normalized)
        .strip_suffix("/route.ts")
        .or_else(|| normalized.strip_suffix("/route.tsx"))
        .or_else(|| normalized.strip_suffix("/route.js"))
        .or_else(|| normalized.strip_suffix("/route.jsx"))
        .unwrap_or(&normalized);

    // Replace [param] with {param}
    let re = regex::Regex::new(r"\[(\w+)\]").unwrap();
    let path = re.replace_all(path, "{$1}");

    format!("/{path}")
}

/// Create api_operation nodes from extracted routes and generate backend_serves_api edges.
pub fn ingest_synthetic_routes(
    conn: &rusqlite::Connection,
    repo_id: i64,
    routes: &[ExtractedRoute],
) -> Result<(usize, usize), String> {
    let mut nodes_added = 0;
    let mut edges_added = 0;

    for route in routes {
        let node_id = openapi_parser::make_api_operation_id(repo_id, &route.method, &route.path);
        let label = format!("{} {} (synthetic)", route.method, route.path);
        let props = serde_json::json!({
            "source": "synthetic",
            "file": route.file_path,
            "line": route.line,
            "handlerName": route.handler_name,
        });

        graph_storage::upsert_node(
            conn,
            &node_id,
            "api_operation",
            None,
            &label,
            &route.file_path,
            repo_id,
            None,
            Some(&serde_json::to_string(&props).unwrap_or_default()),
        )?;
        nodes_added += 1;

        // Create backend_serves_api edge from the file to the api_operation
        let file_node_id = indexer::make_file_node_id(repo_id, &route.file_path);
        let edge_id = format!("{file_node_id}:serves:{node_id}");
        graph_storage::upsert_edge(
            conn,
            &edge_id,
            &file_node_id,
            &node_id,
            "backend_serves_api",
        )?;
        edges_added += 1;
    }

    Ok((nodes_added, edges_added))
}
