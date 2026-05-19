use crate::code_knowledge_graph::storage as graph_storage;

/// Gateway path prefixes on frontend HTTP calls (e.g. Vite proxy `/svc-aqi` → Spring `context-path`).
pub const DEFAULT_GATEWAY_PREFIXES: &[&str] = &["/svc-aqi", "/svc-external"];

/// Parsed OpenAPI operation.
#[derive(Debug, Clone)]
pub struct ApiOperation {
    pub method: String,
    pub path: String,
    pub operation_id: Option<String>,
    pub summary: Option<String>,
    pub tags: Vec<String>,
}

/// Parse an OpenAPI 3.x YAML/JSON file and extract operations.
pub fn parse_openapi(content: &str) -> Result<Vec<ApiOperation>, String> {
    let value: serde_yaml::Value = serde_yaml::from_str(content).map_err(|e| e.to_string())?;

    // Detect OpenAPI version
    if let Some(version) = value.get("openapi").and_then(|v| v.as_str()) {
        if !version.starts_with("3.") {
            return Err(format!("Unsupported OpenAPI version: {version}"));
        }
    } else {
        return Err("Not an OpenAPI 3.x document".to_string());
    }

    let paths = value
        .get("paths")
        .and_then(|v| v.as_mapping())
        .ok_or_else(|| "Missing 'paths' in OpenAPI document".to_string())?;

    let mut operations = Vec::new();
    let methods = ["get", "put", "post", "delete", "patch", "head", "options"];

    for (path_key, path_item) in paths {
        let path_str = path_key
            .as_str()
            .ok_or_else(|| "Invalid path key".to_string())?;
        let path_map = path_item
            .as_mapping()
            .ok_or_else(|| "Invalid path item".to_string())?;

        for method in &methods {
            if let Some(op_value) = path_map.get(serde_yaml::Value::String(method.to_string())) {
                let op = op_value.as_mapping().unwrap();
                let operation_id = op
                    .get(&serde_yaml::Value::String("operationId".into()))
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let summary = op
                    .get(&serde_yaml::Value::String("summary".into()))
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let tags = op
                    .get(&serde_yaml::Value::String("tags".into()))
                    .and_then(|v| v.as_sequence())
                    .map(|seq| {
                        seq.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();

                operations.push(ApiOperation {
                    method: method.to_string(),
                    path: path_str.to_string(),
                    operation_id,
                    summary,
                    tags,
                });
            }
        }
    }

    Ok(operations)
}

/// Generate a stable ID for an api_operation node.
pub fn make_api_operation_id(repo_id: i64, method: &str, path: &str) -> String {
    let hash = crate::code_knowledge_graph::indexer::compute_hash(&format!("{method}:{path}"));
    format!("{repo_id}:api_operation:{hash}")
}

/// Insert api_operation nodes and backend_serves_api edges into the graph.
/// `handler_node_id` is the file/symbol node that serves this API (e.g., a route handler).
pub fn ingest_openapi(
    conn: &rusqlite::Connection,
    repo_id: i64,
    operations: &[ApiOperation],
    _openapi_path: &str,
) -> Result<(usize, usize), String> {
    let mut nodes_added = 0;
    let edges_added = 0;

    for op in operations {
        let node_id = make_api_operation_id(repo_id, &op.method, &op.path);
        let label = format!("{} {}", op.method.to_uppercase(), op.path);
        let props = serde_json::json!({
            "source": "openapi",
            "operationId": op.operation_id,
            "summary": op.summary,
            "tags": op.tags,
        });

        graph_storage::upsert_node(
            conn,
            &node_id,
            "api_operation",
            None,
            &label,
            _openapi_path,
            repo_id,
            None,
            Some(&serde_json::to_string(&props).unwrap_or_default()),
        )?;
        nodes_added += 1;
    }

    Ok((nodes_added, edges_added))
}

/// Strip `${BASE}`-style segments and map simple `${id}` path params to `{id}` for OpenAPI matching.
fn collapse_ts_template_url(raw: &str) -> String {
    let re = match regex::Regex::new(r"\$\{([^}]+)\}") {
        Ok(r) => r,
        Err(_) => return raw.to_string(),
    };
    let mut out = String::new();
    let mut last = 0usize;
    for cap in re.captures_iter(raw) {
        let whole = cap.get(0).unwrap();
        out.push_str(&raw[last..whole.start()]);
        let inner = cap.get(1).map(|g| g.as_str().trim()).unwrap_or("");
        out.push_str(&ts_interpolation_to_path_fragment(inner));
        last = whole.end();
    }
    out.push_str(&raw[last..]);
    let out = if out.contains("://") {
        out
    } else {
        regex::Regex::new("//+")
            .map(|r| r.replace_all(&out, "/").to_string())
            .unwrap_or(out)
    };
    out
}

/// `${import.meta.env.VITE_*}` / `${BASE}` → empty; `${userId}` → `{userId}`.
fn ts_interpolation_to_path_fragment(inner: &str) -> String {
    if inner.is_empty() {
        return String::new();
    }
    if inner.contains('.') || inner.contains('(') || inner.contains('[') || inner.contains(' ') {
        return String::new();
    }
    let has_alpha = inner.chars().any(|c| c.is_ascii_alphabetic());
    if has_alpha && inner.chars().all(|c| !c.is_ascii_alphabetic() || c.is_ascii_uppercase()) {
        return String::new();
    }
    let lower = inner.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "baseurl" | "base_url" | "apiprefix" | "api_prefix" | "prefix" | "root"
    ) {
        return String::new();
    }
    let ident = regex::Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_]*$").ok();
    if ident.as_ref().is_some_and(|re| re.is_match(inner)) {
        return format!("{{{inner}}}");
    }
    String::new()
}

/// Parse TypeScript/JavaScript source for HTTP client calls (fetch, axios, ofetch).
/// Returns (method, url_template, line) tuples.
pub fn extract_http_calls(content: &str) -> Vec<(String, String, usize)> {
    let mut calls = Vec::new();

    // Pattern: fetch('URL' or "URL", { method: 'GET' })
    if let Ok(re) = regex::Regex::new(
        r#"fetch\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*\{[^}]*method\s*:\s*['"](\w+)['"])?\s*\)"#,
    ) {
        let caps: Vec<_> = re.captures_iter(content).collect();
        for cap in caps {
            let url = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            let method = cap
                .get(2)
                .map(|m| m.as_str().to_uppercase())
                .unwrap_or_else(|| "GET".to_string());
            let line = content[..cap.get(0).unwrap().start()].matches('\n').count() + 1;
            calls.push((method, url, line));
        }
    }

    // Pattern: fetch(`URL`) — template literal (same collapse rules as axios).
    if let Ok(re) = regex::Regex::new(r#"fetch\s*\(\s*`([^`]+)`"#) {
        let caps: Vec<_> = re.captures_iter(content).collect();
        for cap in caps {
            let raw_url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let url = collapse_ts_template_url(raw_url);
            if url.is_empty() {
                continue;
            }
            let method = "GET".to_string();
            let line = content[..cap.get(0).unwrap().start()].matches('\n').count() + 1;
            calls.push((method, url, line));
        }
    }

    // Pattern: axios.get/post/put/delete('URL')
    if let Ok(re) =
        regex::Regex::new(r#"axios\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]"#)
    {
        let caps: Vec<_> = re.captures_iter(content).collect();
        for cap in caps {
            let method_raw = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_uppercase();
            let url = cap.get(2).map(|m| m.as_str()).unwrap_or("").to_string();
            let line = content[..cap.get(0).unwrap().start()].matches('\n').count() + 1;
            calls.push((method_raw, url, line));
        }
    }

    // Pattern: axios.get/post/put/delete(`URL`) — template literal + `${BASE}/path`
    if let Ok(re) = regex::Regex::new(r#"axios\.(get|post|put|patch|delete)\s*\(\s*`([^`]+)`"#) {
        let caps: Vec<_> = re.captures_iter(content).collect();
        for cap in caps {
            let method_raw = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_uppercase();
            let raw_url = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            let url = collapse_ts_template_url(raw_url);
            if url.is_empty() {
                continue;
            }
            let line = content[..cap.get(0).unwrap().start()].matches('\n').count() + 1;
            calls.push((method_raw, url, line));
        }
    }

    calls
}

#[cfg(test)]
mod extract_http_tests {
    use super::extract_http_calls;
    use super::collapse_ts_template_url;

    #[test]
    fn axios_get_template_with_base_constant() {
        let src = r#"export function getReportByDate(reportDate, reportType) {
  return axios.get(`${BASE}/api/daily-report`, { params: { reportDate, reportType } })
}"#;
        let calls = extract_http_calls(src);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "GET");
        assert_eq!(calls[0].1, "/api/daily-report");
    }

    #[test]
    fn axios_get_template_path_param() {
        let src = r#"axios.get(`${API}/users/${userId}/posts`)"#;
        let calls = extract_http_calls(src);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].1, "/users/{userId}/posts");
    }

    #[test]
    fn collapse_strips_import_meta_env() {
        let u = collapse_ts_template_url(r"${import.meta.env.VITE_APP_BASE_API}/api/foo");
        assert_eq!(u, "/api/foo");
    }

    #[test]
    fn strip_svc_aqi_gateway_prefix() {
        use super::strip_gateway_prefix;
        assert_eq!(
            strip_gateway_prefix("/svc-aqi/api/wind-rose/stations", &["/svc-aqi"]),
            "/api/wind-rose/stations"
        );
    }

    #[test]
    fn match_http_call_through_gateway_prefix() {
        use super::match_http_to_api;
        let ops = vec![(
            "op1".into(),
            "GET".into(),
            "api/wind-rose/stations".into(),
        )];
        let matched = match_http_to_api("GET", "/svc-aqi/api/wind-rose/stations", &ops);
        assert_eq!(matched, vec!["op1"]);
    }
}

/// Split persisted `api_operation` node `label` into HTTP method and path.
/// OpenAPI uses `GET /path`; legacy synthetic used `GET /path (synthetic)`.
pub fn split_api_operation_label(label: &str) -> Option<(String, String)> {
    let trimmed = label.trim();
    let without_suffix = trimmed
        .strip_suffix(" (synthetic)")
        .unwrap_or(trimmed)
        .trim();
    let (method, path) = without_suffix.split_once(char::is_whitespace)?;
    let method = method.trim().to_uppercase();
    let path = path.trim();
    if method.is_empty() || path.is_empty() {
        return None;
    }
    Some((method, path.to_string()))
}

#[cfg(test)]
mod label_tests {
    use super::split_api_operation_label;

    #[test]
    fn split_label_legacy_synthetic_suffix() {
        assert_eq!(
            split_api_operation_label("GET /api/foo (synthetic)"),
            Some(("GET".into(), "/api/foo".into()))
        );
    }

    #[test]
    fn split_label_openapi_shape() {
        assert_eq!(
            split_api_operation_label("GET /api/foo"),
            Some(("GET".into(), "/api/foo".into()))
        );
    }
}

/// Normalize a path template for matching.
/// Converts `:id` → `{id}`, strips leading/trailing slashes.
pub fn normalize_path(path: &str) -> String {
    let mut p = path.trim_matches('/').to_string();
    // Replace Express-style params (:id) with OpenAPI style ({id})
    let re = regex::Regex::new(r":(\w+)").unwrap();
    p = re.replace_all(&p, "{$1}").to_string();
    p
}

/// Strip reverse-proxy / gateway prefixes from frontend HTTP paths before matching backend routes.
/// Example: `/svc-aqi/api/wind-rose/stations` → `/api/wind-rose/stations`.
pub fn strip_gateway_prefix(path: &str, prefixes: &[&str]) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let with_slash = if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    };
    let mut ordered: Vec<&str> = prefixes.to_vec();
    ordered.sort_by_key(|p| std::cmp::Reverse(p.len()));
    for prefix in ordered {
        if with_slash == prefix {
            return "/".to_string();
        }
        if let Some(rest) = with_slash.strip_prefix(prefix) {
            let stripped = rest.trim_start_matches('/');
            return if stripped.is_empty() {
                "/".to_string()
            } else {
                format!("/{stripped}")
            };
        }
    }
    with_slash
}

/// Match a frontend HTTP call URL against a set of backend API operation templates.
/// Returns the best matching operation ID(s).
pub fn match_http_to_api(
    method: &str,
    call_url: &str,
    operations: &[(
        String, /* operation_id */
        String, /* method */
        String, /* normalized_path */
    )],
) -> Vec<String> {
    let stripped = strip_gateway_prefix(call_url, DEFAULT_GATEWAY_PREFIXES);
    let call_normalized = normalize_path(&stripped);
    let mut matches = Vec::new();

    for (op_id, op_method, op_path) in operations {
        if op_method.to_uppercase() != method.to_uppercase() {
            continue;
        }

        // Try exact match first
        if call_normalized == *op_path {
            matches.push(op_id.clone());
            continue;
        }

        // Try template matching: convert both to regex-like pattern
        if template_matches(&call_normalized, op_path) {
            matches.push(op_id.clone());
        }
    }

    matches
}

/// Check if a call URL matches an API path template.
/// E.g., call `/api/users/123` matches template `/api/users/{id}`.
pub fn template_matches(call: &str, template: &str) -> bool {
    let call_parts: Vec<&str> = call.split('/').collect();
    let tmpl_parts: Vec<&str> = template.split('/').collect();

    if call_parts.len() != tmpl_parts.len() {
        return false;
    }

    for (c, t) in call_parts.iter().zip(tmpl_parts.iter()) {
        if t.starts_with('{') && t.ends_with('}') {
            continue; // placeholder matches anything
        }
        if c != t {
            return false;
        }
    }

    true
}

/// Create frontend_invokes_api edges from HTTP calls to API operations.
pub fn create_invoke_edges(
    conn: &rusqlite::Connection,
    _repo_id: i64,
    // (file_node_id, method, url, line)
    http_calls: &[(String, String, String, usize)],
    // (operation_id, method, normalized_path)
    api_operations: &[(String, String, String)],
) -> Result<usize, String> {
    let mut edges = 0;
    for (file_id, method, url, _line) in http_calls {
        let matched = match_http_to_api(method, url, api_operations);
        for op_id in &matched {
            let edge_id = format!("{file_id}:invokes:{op_id}");
            if graph_storage::upsert_edge_if_nodes_exist(
                conn,
                &edge_id,
                file_id,
                op_id,
                "frontend_invokes_api",
            )? {
                edges += 1;
            }
        }
    }
    Ok(edges)
}
