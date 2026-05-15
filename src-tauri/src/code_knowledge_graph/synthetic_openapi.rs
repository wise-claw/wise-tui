use std::collections::HashSet;

use crate::code_knowledge_graph::storage as graph_storage;
use crate::code_knowledge_graph::indexer;
use crate::code_knowledge_graph::openapi_parser;

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
        if !entry.path().is_file() { continue; }
        let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("");
        if !indexer::SUPPORTED_EXTENSIONS.contains(&ext) { continue; }

        let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
        let relative = entry.path()
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
                    method, path, file_path: relative.clone(), line, handler_name: None,
                });
            }
        }

        // Next.js: export async function GET/POST (app router)
        if let Ok(re) = regex::Regex::new(r#"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\("#) {
            for cap in re.captures_iter(&content) {
                let method = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_uppercase();
                // Derive path from file path (app/api/users/route.ts -> /api/users)
                let path = derive_nextjs_path(&relative);
                let line = content[..cap.get(0).unwrap().start()].matches('\n').count() + 1;
                routes.push(ExtractedRoute {
                    method: method.clone(), path, file_path: relative.clone(), line,
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
                    method, path, file_path: relative.clone(), line, handler_name: None,
                });
            }
        }

        // Spring MVC: @RequestMapping on class + @GetMapping / @PostMapping on methods (.java)
        if ext == "java" {
            routes.extend(extract_spring_java_routes(&content, &relative));
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
                        let m = method.trim().trim_matches(|c| c == '\'' || c == '"').to_uppercase();
                        if !m.is_empty() {
                            routes.push(ExtractedRoute {
                                method: m, path: path.clone(), file_path: relative.clone(), line,
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
        // Same shape as OpenAPI-ingested nodes so HTTP bridge `split_api_operation_label` matches.
        let label = format!("{} {}", route.method, route.path);
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
        graph_storage::upsert_edge(conn, &edge_id, &file_node_id, &node_id, "backend_serves_api")?;
        edges_added += 1;
    }

    Ok((nodes_added, edges_added))
}

/// Join class-level + method-level Spring paths into one HTTP path (leading `/`).
fn join_spring_http_paths(class_prefix: &str, method_suffix: &str) -> String {
    let p = class_prefix.trim().trim_end_matches('/');
    let s = method_suffix.trim().trim_start_matches('/');
    match (p.is_empty(), s.is_empty()) {
        (true, true) => "/".to_string(),
        (true, false) => {
            if s.starts_with('/') {
                s.to_string()
            } else {
                format!("/{s}")
            }
        }
        (false, true) => {
            if p.starts_with('/') {
                p.to_string()
            } else {
                format!("/{p}")
            }
        }
        (false, false) => {
            if p.starts_with('/') {
                format!("{p}/{s}")
            } else {
                format!("/{p}/{s}")
            }
        }
    }
}

/// Text inside the first `(...)` after `@FooMapping` on a single line (best-effort).
fn spring_mapping_paren_inner(line: &str) -> Option<&str> {
    let open = line.find('(')?;
    let mut depth = 0i32;
    for (i, ch) in line[open..].char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    let inner = &line[open + 1..open + i];
                    return Some(inner);
                }
            }
            _ => {}
        }
    }
    None
}

fn first_quoted_path_in_spring_args(inner: &str) -> String {
    let inner = inner.trim();
    if inner.is_empty() {
        return String::new();
    }
    if let Ok(re) = regex::Regex::new(
        r#"(?:value|path)\s*=\s*['"]([^'"]*)['"]|['"]([^'"]+)['"]"#,
    ) {
        if let Some(cap) = re.captures(inner) {
            return cap
                .get(1)
                .or_else(|| cap.get(2))
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
        }
    }
    String::new()
}

/// `public class` / `class` head for class-level `@RequestMapping`.
fn spring_java_class_mapping_prefix(content: &str) -> String {
    let idx = content
        .find("public class")
        .or_else(|| content.find("\nclass "))
        .unwrap_or(content.len());
    let head = &content[..idx];
    let mut last = String::new();
    if let Ok(re_vp) = regex::Regex::new(
        r#"@RequestMapping\s*\(\s*(?:value|path)\s*=\s*['"]([^'"]+)['"]"#,
    ) {
        for cap in re_vp.captures_iter(head) {
            last = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        }
    }
    if last.is_empty() {
        if let Ok(re_s) = regex::Regex::new(r#"@RequestMapping\s*\(\s*['"]([^'"]+)['"]"#) {
            for cap in re_s.captures_iter(head) {
                last = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            }
        }
    }
    last
}

/// One line: `@GetMapping("/x")`, `@GetMapping()`, `@RequestMapping(..., RequestMethod.GET)`.
fn spring_java_parse_mapping_line(line: &str) -> Option<(String, String)> {
    let t = line.trim();
    const MAPPINGS: &[(&str, &str)] = &[
        ("@GetMapping", "GET"),
        ("@PostMapping", "POST"),
        ("@PutMapping", "PUT"),
        ("@PatchMapping", "PATCH"),
        ("@DeleteMapping", "DELETE"),
    ];
    for (pfx, method) in MAPPINGS {
        if let Some(rest) = t.strip_prefix(pfx) {
            let r = rest.trim_start();
            if r.starts_with('(') {
                let inner = spring_mapping_paren_inner(t)?;
                return Some((method.to_string(), first_quoted_path_in_spring_args(inner)));
            }
            return Some((method.to_string(), String::new()));
        }
    }
    if let Ok(re) = regex::Regex::new(
        r#"^@RequestMapping\s*\(\s*(?:value|path)\s*=\s*['"]([^'"]+)['"]"#,
    ) {
        if let Some(cap) = re.captures(t) {
            let path = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            if t.contains("RequestMethod.GET") {
                return Some(("GET".to_string(), path));
            }
            if t.contains("RequestMethod.POST") {
                return Some(("POST".to_string(), path));
            }
            if t.contains("RequestMethod.PUT") {
                return Some(("PUT".to_string(), path));
            }
            if t.contains("RequestMethod.PATCH") {
                return Some(("PATCH".to_string(), path));
            }
            if t.contains("RequestMethod.DELETE") {
                return Some(("DELETE".to_string(), path));
            }
        }
    }
    None
}

fn map_spring_mapping_verb(verb: &str) -> Option<&'static str> {
    match verb {
        "Get" => Some("GET"),
        "Post" => Some("POST"),
        "Put" => Some("PUT"),
        "Patch" => Some("PATCH"),
        "Delete" => Some("DELETE"),
        _ => None,
    }
}

/// Line-oriented parser misses annotations split across lines, e.g. `@GetMapping(` + newline + `"/api/daily-report"`.
fn spring_java_multiline_mapping_routes(content: &str) -> Vec<(String, String, usize)> {
    let mut out = Vec::new();

    let request_mapping_get_patterns = [
        r#"(?s)@RequestMapping\s*\(\s*(?:value|path)\s*=\s*['"]([^'"]+)['"][\s\S]*?RequestMethod\s*\.\s*GET"#,
        r#"(?s)@RequestMapping\s*\([\s\S]*?RequestMethod\s*\.\s*GET[\s\S]*?(?:value|path)\s*=\s*['"]([^'"]+)['"]"#,
    ];
    for pat in request_mapping_get_patterns {
        if let Ok(re) = regex::Regex::new(pat) {
            for cap in re.captures_iter(content) {
                if let Some(p) = cap.get(1) {
                    let path = p.as_str().to_string();
                    if path.is_empty() {
                        continue;
                    }
                    let mstart = cap.get(0).unwrap().start();
                    let line = content[..mstart].matches('\n').count() + 1;
                    out.push(("GET".to_string(), path, line));
                }
            }
        }
    }

    if let Ok(re) = regex::Regex::new(
        r#"(?s)@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value|path)\s*=\s*['"]([^'"]*)['"]"#,
    ) {
        for cap in re.captures_iter(content) {
            let verb = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let Some(http) = map_spring_mapping_verb(verb) else {
                continue;
            };
            let path = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            if path.is_empty() {
                continue;
            }
            let mstart = cap.get(0).unwrap().start();
            let line = content[..mstart].matches('\n').count() + 1;
            out.push((http.to_string(), path.to_string(), line));
        }
    }

    if let Ok(re) = regex::Regex::new(
        r#"(?s)@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*['"]([^'"]+)['"]"#,
    ) {
        for cap in re.captures_iter(content) {
            let verb = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let Some(http) = map_spring_mapping_verb(verb) else {
                continue;
            };
            let path = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            if path.is_empty() {
                continue;
            }
            let mstart = cap.get(0).unwrap().start();
            let line = content[..mstart].matches('\n').count() + 1;
            out.push((http.to_string(), path.to_string(), line));
        }
    }

    out
}

fn extract_spring_java_routes(content: &str, relative: &str) -> Vec<ExtractedRoute> {
    let mut routes = Vec::new();
    if !content.contains("@RestController") && !content.contains("@Controller") {
        return routes;
    }
    let base = spring_java_class_mapping_prefix(content);
    let mut seen = std::collections::HashSet::<(String, String)>::new();

    let mut push = |method: String, sub_path: String, line: usize| {
        let full_path = join_spring_http_paths(&base, &sub_path);
        if full_path == "/" && sub_path.is_empty() && base.is_empty() {
            return;
        }
        let key = (method.clone(), full_path.clone());
        if !seen.insert(key) {
            return;
        }
        routes.push(ExtractedRoute {
            method,
            path: full_path,
            file_path: relative.to_string(),
            line,
            handler_name: None,
        });
    };

    for (line_no, line) in content.lines().enumerate() {
        let Some((method, sub_path)) = spring_java_parse_mapping_line(line) else {
            continue;
        };
        push(method, sub_path, line_no + 1);
    }

    for (method, sub_path, line) in spring_java_multiline_mapping_routes(content) {
        push(method, sub_path, line);
    }

    routes
}

#[cfg(test)]
mod spring_java_tests {
    use super::extract_spring_java_routes;

    #[test]
    fn class_request_mapping_plus_get_mapping() {
        let src = r#"
@RestController
@RequestMapping("/api")
public class AqiDailyReportController {
  @GetMapping("/daily-report")
  public Object x() { return null; }
}
"#;
        let r = extract_spring_java_routes(src, "Aqi.java");
        assert!(r.iter().any(|x| x.method == "GET" && x.path == "/api/daily-report"));
    }

    #[test]
    fn get_mapping_on_class_path_only() {
        let src = r#"
@RestController
@RequestMapping("/api/daily-report")
public class C {
  @GetMapping
  public Object x() { return null; }
}
"#;
        let r = extract_spring_java_routes(src, "C.java");
        assert!(r.iter().any(|x| x.method == "GET" && x.path == "/api/daily-report"));
    }

    #[test]
    fn multiline_get_mapping_daily_report() {
        let src = r#"
@RestController
public class AqiDailyReportController {
  @GetMapping(
    "/api/daily-report"
  )
  public Map<String, Object> getReportByDateAndType() { return null; }
}
"#;
        let r = extract_spring_java_routes(src, "AqiDailyReportController.java");
        assert!(r.iter().any(|x| x.method == "GET" && x.path == "/api/daily-report"));
    }

    #[test]
    fn request_mapping_get_method() {
        let src = r#"
@RestController
@RequestMapping("/api")
public class C {
  @RequestMapping(value = "/daily-report", method = RequestMethod.GET)
  public Object x() { return null; }
}
"#;
        let r = extract_spring_java_routes(src, "C.java");
        assert!(r.iter().any(|x| x.method == "GET" && x.path == "/api/daily-report"));
    }
}
