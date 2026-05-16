//! 保留供后续可选「本地解析」或测试；当前主索引路径已改为 GitNexus CLI + Kuzu 导入。
#![allow(dead_code)]

//! TypeScript / JavaScript / TSX symbol + calls extraction via tree-sitter，对齐 GitNexus
//! `gitnexus/src/core/ingestion/tree-sitter-queries.ts`（definitions + call / new 核心模式）。

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use rusqlite::Connection;
use streaming_iterator::StreamingIterator;
use tree_sitter::{Language, Parser, Query, QueryCursor};

use crate::code_knowledge_graph::indexer;
use crate::code_knowledge_graph::storage as graph_storage;
use crate::code_knowledge_graph::tree_sitter_parser::Parser as GraphParser;

const TS_QUERY_SRC: &str = include_str!("queries/ts_definitions.scm");
const JS_QUERY_SRC: &str = include_str!("queries/js_definitions.scm");
const TS_CALLS_SRC: &str = include_str!("queries/ts_calls.scm");
const JS_CALLS_SRC: &str = include_str!("queries/js_calls.scm");
const TS_JS_LOCAL_NAMES_SRC: &str = include_str!("queries/ts_js_local_names.scm");
const TS_JS_LOCAL_CLASSES_TS_SRC: &str = include_str!("queries/ts_js_local_classes_ts.scm");
const TS_JS_LOCAL_CLASSES_JS_SRC: &str = include_str!("queries/ts_js_local_classes_js.scm");

struct CompiledQueries {
    ts: Query,
    tsx: Query,
    js: Query,
}

fn compiled_queries() -> Result<&'static CompiledQueries, String> {
    static CELL: OnceLock<Result<CompiledQueries, String>> = OnceLock::new();
    CELL.get_or_init(|| {
        let ts_lang: Language = tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into();
        let tsx_lang: Language = tree_sitter_typescript::LANGUAGE_TSX.into();
        let js_lang: Language = tree_sitter_javascript::LANGUAGE.into();
        let ts =
            Query::new(&ts_lang, TS_QUERY_SRC).map_err(|e| format!("TS query compile: {e}"))?;
        let tsx =
            Query::new(&tsx_lang, TS_QUERY_SRC).map_err(|e| format!("TSX query compile: {e}"))?;
        let js =
            Query::new(&js_lang, JS_QUERY_SRC).map_err(|e| format!("JS query compile: {e}"))?;
        Ok(CompiledQueries { ts, tsx, js })
    })
    .as_ref()
    .map_err(|e| e.clone())
}

struct CompiledCallQueries {
    ts: Query,
    tsx: Query,
    js: Query,
}

fn compiled_call_queries() -> Result<&'static CompiledCallQueries, String> {
    static CELL: OnceLock<Result<CompiledCallQueries, String>> = OnceLock::new();
    CELL.get_or_init(|| {
        let ts_lang: Language = tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into();
        let tsx_lang: Language = tree_sitter_typescript::LANGUAGE_TSX.into();
        let js_lang: Language = tree_sitter_javascript::LANGUAGE.into();
        let ts = Query::new(&ts_lang, TS_CALLS_SRC).map_err(|e| format!("TS calls query: {e}"))?;
        let tsx =
            Query::new(&tsx_lang, TS_CALLS_SRC).map_err(|e| format!("TSX calls query: {e}"))?;
        let js = Query::new(&js_lang, JS_CALLS_SRC).map_err(|e| format!("JS calls query: {e}"))?;
        Ok(CompiledCallQueries { ts, tsx, js })
    })
    .as_ref()
    .map_err(|e| e.clone())
}

struct CompiledLocalNamesQueries {
    ts: Query,
    tsx: Query,
    js: Query,
}

fn compiled_local_names_queries() -> Result<&'static CompiledLocalNamesQueries, String> {
    static CELL: OnceLock<Result<CompiledLocalNamesQueries, String>> = OnceLock::new();
    CELL.get_or_init(|| {
        let ts_lang: Language = tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into();
        let tsx_lang: Language = tree_sitter_typescript::LANGUAGE_TSX.into();
        let js_lang: Language = tree_sitter_javascript::LANGUAGE.into();
        let ts = Query::new(&ts_lang, TS_JS_LOCAL_NAMES_SRC)
            .map_err(|e| format!("local names TS: {e}"))?;
        let tsx = Query::new(&tsx_lang, TS_JS_LOCAL_NAMES_SRC)
            .map_err(|e| format!("local names TSX: {e}"))?;
        let js = Query::new(&js_lang, TS_JS_LOCAL_NAMES_SRC)
            .map_err(|e| format!("local names JS: {e}"))?;
        Ok(CompiledLocalNamesQueries { ts, tsx, js })
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn language_and_local_names_query_for_ext(
    ext_lower: &str,
) -> Result<(Language, &'static Query), String> {
    let q = compiled_local_names_queries()?;
    Ok(match ext_lower {
        "tsx" | "jsx" => (tree_sitter_typescript::LANGUAGE_TSX.into(), &q.tsx),
        "ts" | "mts" | "cts" => (tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(), &q.ts),
        "js" | "mjs" | "cjs" => (tree_sitter_javascript::LANGUAGE.into(), &q.js),
        _ => return Err(format!("ts_js local names: unsupported ext {ext_lower}")),
    })
}

fn collect_ts_js_local_declared_names(
    root: tree_sitter::Node<'_>,
    source: &[u8],
    ext_lower: &str,
) -> HashSet<String> {
    let Ok((_, query)) = language_and_local_names_query_for_ext(ext_lower) else {
        return HashSet::new();
    };
    let cap_names = query.capture_names();
    let mut out = HashSet::<String>::new();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(query, root, source);
    while let Some(m) = StreamingIterator::next(&mut matches) {
        for c in m.captures {
            let cap = cap_names.get(c.index as usize).copied().unwrap_or("");
            if cap != "local.fn" {
                continue;
            }
            if let Ok(txt) = c.node.utf8_text(source) {
                if !txt.is_empty() {
                    out.insert(txt.to_string());
                }
            }
        }
    }
    out
}

struct CompiledLocalClassQueries {
    ts: Query,
    tsx: Query,
    js: Query,
}

fn compiled_local_class_queries() -> Result<&'static CompiledLocalClassQueries, String> {
    static CELL: OnceLock<Result<CompiledLocalClassQueries, String>> = OnceLock::new();
    CELL.get_or_init(|| {
        let ts_lang: Language = tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into();
        let tsx_lang: Language = tree_sitter_typescript::LANGUAGE_TSX.into();
        let js_lang: Language = tree_sitter_javascript::LANGUAGE.into();
        let ts = Query::new(&ts_lang, TS_JS_LOCAL_CLASSES_TS_SRC)
            .map_err(|e| format!("local class TS: {e}"))?;
        let tsx = Query::new(&tsx_lang, TS_JS_LOCAL_CLASSES_TS_SRC)
            .map_err(|e| format!("local class TSX: {e}"))?;
        let js = Query::new(&js_lang, TS_JS_LOCAL_CLASSES_JS_SRC)
            .map_err(|e| format!("local class JS: {e}"))?;
        Ok(CompiledLocalClassQueries { ts, tsx, js })
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn language_and_local_class_query_for_ext(
    ext_lower: &str,
) -> Result<(Language, &'static Query), String> {
    let q = compiled_local_class_queries()?;
    Ok(match ext_lower {
        "tsx" | "jsx" => (tree_sitter_typescript::LANGUAGE_TSX.into(), &q.tsx),
        "ts" | "mts" | "cts" => (tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(), &q.ts),
        "js" | "mjs" | "cjs" => (tree_sitter_javascript::LANGUAGE.into(), &q.js),
        _ => return Err(format!("local class query: unsupported ext {ext_lower}")),
    })
}

fn collect_ts_js_local_class_names(
    root: tree_sitter::Node<'_>,
    source: &[u8],
    ext_lower: &str,
) -> HashSet<String> {
    let Ok((_, query)) = language_and_local_class_query_for_ext(ext_lower) else {
        return HashSet::new();
    };
    let cap_names = query.capture_names();
    let mut out = HashSet::<String>::new();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(query, root, source);
    while let Some(m) = StreamingIterator::next(&mut matches) {
        for c in m.captures {
            let cap = cap_names.get(c.index as usize).copied().unwrap_or("");
            if cap != "local.class" {
                continue;
            }
            if let Ok(txt) = c.node.utf8_text(source) {
                if !txt.is_empty() {
                    out.insert(txt.to_string());
                }
            }
        }
    }
    out
}

fn peel_parenthesized_expression(mut n: tree_sitter::Node<'_>) -> tree_sitter::Node<'_> {
    while n.kind() == "parenthesized_expression" {
        let Some(inner) = n.named_child(0) else {
            break;
        };
        n = inner;
    }
    n
}

fn expression_to_extends_import_lookup_key(
    expr: tree_sitter::Node<'_>,
    source: &[u8],
) -> Option<String> {
    let n = peel_parenthesized_expression(expr);
    match n.kind() {
        "identifier" | "type_identifier" => n.utf8_text(source).ok().map(|s| s.to_string()),
        "nested_type_identifier" => n
            .utf8_text(source)
            .ok()
            .and_then(|t| t.rsplit('.').next().map(|s| s.to_string())),
        "member_expression" => {
            let prop = n.child_by_field_name("property")?;
            prop.utf8_text(source).ok().map(|s| s.to_string())
        }
        _ => None,
    }
}

fn ts_extends_clause_first_base_key(ext: tree_sitter::Node<'_>, source: &[u8]) -> Option<String> {
    if ext.kind() != "extends_clause" {
        return None;
    }
    if let Some(val) = ext.child_by_field_name("value") {
        return expression_to_extends_import_lookup_key(val, source);
    }
    for i in 0..ext.named_child_count() {
        let ch = ext.named_child(i)?;
        if ch.kind() == "_extends_clause_single" {
            let val = ch.child_by_field_name("value")?;
            return expression_to_extends_import_lookup_key(val, source);
        }
    }
    None
}

fn class_heritage_extends_base_key(
    heritage: tree_sitter::Node<'_>,
    source: &[u8],
) -> Option<String> {
    for i in 0..heritage.named_child_count() {
        let ch = heritage.named_child(i)?;
        if ch.kind() == "extends_clause" {
            return ts_extends_clause_first_base_key(ch, source);
        }
    }
    if heritage.named_child_count() == 1 {
        let ch = heritage.named_child(0)?;
        if ch.kind() != "implements_clause" {
            return expression_to_extends_import_lookup_key(ch, source);
        }
    }
    None
}

fn class_declaration_heritage(class_node: tree_sitter::Node<'_>) -> Option<tree_sitter::Node<'_>> {
    for i in 0..class_node.named_child_count() {
        let ch = class_node.named_child(i)?;
        if ch.kind() == "class_heritage" {
            return Some(ch);
        }
    }
    None
}

fn enclosing_class_extends_import_lookup_key(
    anchor: tree_sitter::Node<'_>,
    source: &[u8],
) -> Option<String> {
    let mut cur = anchor;
    loop {
        let p = cur.parent()?;
        if matches!(p.kind(), "class_declaration" | "abstract_class_declaration") {
            let heritage = class_declaration_heritage(p)?;
            return class_heritage_extends_base_key(heritage, source);
        }
        cur = p;
    }
}

fn resolve_extends_base_repo_path(
    base_key: &str,
    import_bindings: &HashMap<String, String>,
    relative_path: &str,
    local_classes: &HashSet<String>,
) -> Option<String> {
    import_bindings.get(base_key).cloned().or_else(|| {
        local_classes
            .contains(base_key)
            .then(|| relative_path.to_string())
    })
}

fn language_and_query_for_ext(ext_lower: &str) -> Result<(Language, &'static Query), String> {
    let q = compiled_queries()?;
    Ok(match ext_lower {
        "tsx" | "jsx" => (tree_sitter_typescript::LANGUAGE_TSX.into(), &q.tsx),
        "ts" | "mts" | "cts" => (tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(), &q.ts),
        "js" | "mjs" | "cjs" => (tree_sitter_javascript::LANGUAGE.into(), &q.js),
        _ => return Err(format!("ts_js_tree_extract: unsupported ext {ext_lower}")),
    })
}

fn language_and_call_query_for_ext(ext_lower: &str) -> Result<(Language, &'static Query), String> {
    let q = compiled_call_queries()?;
    Ok(match ext_lower {
        "tsx" | "jsx" => (tree_sitter_typescript::LANGUAGE_TSX.into(), &q.tsx),
        "ts" | "mts" | "cts" => (tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(), &q.ts),
        "js" | "mjs" | "cjs" => (tree_sitter_javascript::LANGUAGE.into(), &q.js),
        _ => return Err(format!("ts_js_tree_extract: unsupported ext {ext_lower}")),
    })
}

fn definition_kind_from_capture(cap: &str) -> Option<&str> {
    cap.strip_prefix("definition.")
}

fn enclosing_type_for_method(anchor: tree_sitter::Node<'_>, source: &[u8]) -> Option<String> {
    let mut cur = anchor.parent();
    while let Some(p) = cur {
        if matches!(
            p.kind(),
            "class_declaration" | "abstract_class_declaration" | "interface_declaration"
        ) {
            let name_n = p.child_by_field_name("name")?;
            let txt = name_n.utf8_text(source).ok()?;
            return Some(txt.to_string());
        }
        cur = p.parent();
    }
    None
}

fn method_definition_label<'a>(p: tree_sitter::Node<'a>, source: &'a [u8]) -> Option<&'a str> {
    let name_n = p.child_by_field_name("name")?;
    name_n.utf8_text(source).ok()
}

/// 外层函数 / 方法 / 箭头（简单 `const x = () =>`）→ `{file}:symbol:...`，供 `calls` 源。
fn enclosing_ts_js_call_source_symbol_id(
    file_node_id: &str,
    anchor: tree_sitter::Node<'_>,
    source: &[u8],
) -> Option<String> {
    let mut cur = anchor.parent();
    while let Some(p) = cur {
        match p.kind() {
            "method_definition" | "abstract_method_signature" => {
                let label = method_definition_label(p, source)?;
                if let Some(cls) = enclosing_type_for_method(p, source) {
                    return Some(format!("{file_node_id}:symbol:{cls}::{label}"));
                }
                return Some(format!("{file_node_id}:symbol:{label}"));
            }
            "function_declaration" => {
                let name_n = p.child_by_field_name("name")?;
                let label = name_n.utf8_text(source).ok()?;
                return Some(format!("{file_node_id}:symbol:{label}"));
            }
            "arrow_function" => {
                if let Some(gp) = p.parent() {
                    if gp.kind() == "variable_declarator" {
                        if let Some(pat) = gp.child_by_field_name("name") {
                            if pat.kind() == "identifier" {
                                let label = pat.utf8_text(source).ok()?;
                                return Some(format!("{file_node_id}:symbol:{label}"));
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        cur = p.parent();
    }
    None
}

fn try_add_ts_js_call_edge(
    conn: &Connection,
    repo_id: i64,
    source_id: &str,
    target_repo_path: &str,
    tag: &str,
    dedup: &mut HashSet<String>,
    missing_target_ids: &mut HashSet<String>,
) -> Result<usize, String> {
    if !graph_storage::graph_node_exists(conn, source_id)? {
        return Ok(0);
    }
    let tid = indexer::make_file_node_id(repo_id, target_repo_path);
    if missing_target_ids.contains(&tid) {
        return Ok(0);
    }
    if !graph_storage::graph_node_exists(conn, &tid)? {
        missing_target_ids.insert(tid);
        return Ok(0);
    }
    let eid = format!("{source_id}:calls:{tid}:{tag}");
    if !dedup.insert(eid.clone()) {
        return Ok(0);
    }
    graph_storage::upsert_edge(conn, &eid, source_id, &tid, "calls")?;
    Ok(1)
}

/// GitNexus 对齐：`call_expression` / `new_expression` / `await` / `this` 成员；
/// 含一层 `parenthesized_expression` 包裹的 callee（如 `(foo)()`、`(this.m)()`）；
/// `super.m` 通过外层 `class` 的 `extends` 解析基类名 → `import_bindings` 或同文件 `local.class`；
/// 自由调用 `foo()` 额外匹配本文件 `local.fn`（含 export / const 箭头 / 具名 function_expression 等）。
pub(crate) fn extract_ts_js_calls_tree_sitter(
    conn: &Connection,
    content: &str,
    file_node_id: &str,
    repo_id: i64,
    relative_path: &str,
    ext_lower: &str,
    import_bindings: &HashMap<String, String>,
) -> Result<usize, String> {
    let (language, query) = match language_and_call_query_for_ext(ext_lower) {
        Ok(x) => x,
        Err(_) => return Ok(0),
    };
    let mut parser = Parser::new();
    if parser.set_language(&language).is_err() {
        return Ok(0);
    }
    let Some(tree) = parser.parse(content, None) else {
        return Ok(0);
    };
    let root = tree.root_node();
    let source = content.as_bytes();
    let local_names = collect_ts_js_local_declared_names(root, source, ext_lower);
    let local_classes = collect_ts_js_local_class_names(root, source, ext_lower);
    let names = query.capture_names();
    let mut cursor = QueryCursor::new();
    let mut dedup = HashSet::<String>::new();
    let mut missing_target_ids = HashSet::<String>::new();
    let mut total = 0usize;

    let mut matches = cursor.matches(query, root, source);
    while let Some(m) = StreamingIterator::next(&mut matches) {
        let mut root_n: Option<tree_sitter::Node<'_>> = None;
        let mut call_name: Option<tree_sitter::Node<'_>> = None;
        let mut recv: Option<tree_sitter::Node<'_>> = None;
        for c in m.captures {
            let cap = names.get(c.index as usize).copied().unwrap_or("");
            match cap {
                "call.root" => root_n = Some(c.node),
                "call.name" => call_name = Some(c.node),
                "call.recv" => recv = Some(c.node),
                _ => {}
            }
        }
        let Some(anchor) = root_n else {
            continue;
        };
        let src = enclosing_ts_js_call_source_symbol_id(file_node_id, anchor, source)
            .unwrap_or_else(|| file_node_id.to_string());

        if let Some(rn) = recv {
            match rn.kind() {
                "this" => {
                    let Some(_nn) = call_name else {
                        continue;
                    };
                    let tag = format!("this:{}:{}", anchor.start_byte(), anchor.end_byte());
                    total += try_add_ts_js_call_edge(
                        conn,
                        repo_id,
                        &src,
                        relative_path,
                        &tag,
                        &mut dedup,
                        &mut missing_target_ids,
                    )?;
                }
                "super" => {
                    let Some(base_key) = enclosing_class_extends_import_lookup_key(anchor, source)
                    else {
                        continue;
                    };
                    let Some(path) = resolve_extends_base_repo_path(
                        &base_key,
                        import_bindings,
                        relative_path,
                        &local_classes,
                    ) else {
                        continue;
                    };
                    let tag = format!("super:{}:{}", anchor.start_byte(), anchor.end_byte());
                    total += try_add_ts_js_call_edge(
                        conn,
                        repo_id,
                        &src,
                        &path,
                        &tag,
                        &mut dedup,
                        &mut missing_target_ids,
                    )?;
                }
                "identifier" => {
                    let Ok(recv_txt) = rn.utf8_text(source) else {
                        continue;
                    };
                    let Some(path) = import_bindings.get(recv_txt) else {
                        continue;
                    };
                    let tag = format!("mem:{}:{}", anchor.start_byte(), anchor.end_byte());
                    total += try_add_ts_js_call_edge(
                        conn,
                        repo_id,
                        &src,
                        path,
                        &tag,
                        &mut dedup,
                        &mut missing_target_ids,
                    )?;
                }
                _ => {}
            }
            continue;
        }

        if let Some(nn) = call_name {
            let Ok(name) = nn.utf8_text(source) else {
                continue;
            };
            let path = import_bindings
                .get(name)
                .map(String::as_str)
                .or_else(|| local_names.contains(name).then_some(relative_path));
            let Some(path) = path else {
                continue;
            };
            let tag = format!("fn:{}:{}", anchor.start_byte(), anchor.end_byte());
            total += try_add_ts_js_call_edge(
                conn,
                repo_id,
                &src,
                path,
                &tag,
                &mut dedup,
                &mut missing_target_ids,
            )?;
        }
    }

    Ok(total)
}

/// `Ok(None)` = parse failed or root has errors — caller should fall back to regex.
/// `Ok(Some(n))` = tree-sitter path used (`n` may be 0).
pub(crate) fn extract_ts_js_symbols_tree_sitter(
    graph: &GraphParser,
    conn: &Connection,
    content: &str,
    file_node_id: &str,
    repo_id: i64,
    relative_path: &str,
    ext_lower: &str,
) -> Result<Option<usize>, String> {
    let (language, query) = match language_and_query_for_ext(ext_lower) {
        Ok(x) => x,
        Err(_) => return Ok(None),
    };
    let mut parser = Parser::new();
    if parser.set_language(&language).is_err() {
        return Ok(None);
    }
    let Some(tree) = parser.parse(content, None) else {
        return Ok(None);
    };
    let root = tree.root_node();
    if root.has_error() {
        return Ok(None);
    }
    let source = content.as_bytes();
    let capture_names = query.capture_names();
    let mut cursor = QueryCursor::new();
    let mut seen: HashSet<(usize, usize, String)> = HashSet::new();
    let mut count = 0usize;

    let mut matches = cursor.matches(query, root, source);
    while let Some(m) = StreamingIterator::next(&mut matches) {
        let mut def_kind: Option<&str> = None;
        let mut name_node: Option<tree_sitter::Node<'_>> = None;
        let mut def_anchor: Option<tree_sitter::Node<'_>> = None;

        for c in m.captures {
            let cap = capture_names.get(c.index as usize).copied().unwrap_or("");
            if cap == "name" {
                name_node = Some(c.node);
            } else if let Some(k) = definition_kind_from_capture(cap) {
                def_kind = Some(k);
                def_anchor = Some(c.node);
            }
        }

        let (Some(kind), Some(name_n), Some(anchor)) = (def_kind, name_node, def_anchor) else {
            continue;
        };
        let Ok(label) = name_n.utf8_text(source) else {
            continue;
        };
        if label.is_empty() {
            continue;
        }
        let line_idx = name_n.start_position().row;
        let key = (anchor.start_byte(), anchor.end_byte(), kind.to_string());
        if !seen.insert(key) {
            continue;
        }

        let (enclosing_id, member_edge) = if matches!(kind, "method" | "property") {
            match enclosing_type_for_method(anchor, source) {
                Some(type_name) => {
                    let enc = format!("{file_node_id}:symbol:{type_name}");
                    let edge = if kind == "method" {
                        Some("has_method")
                    } else {
                        Some("has_property")
                    };
                    (Some(enc), edge)
                }
                None => (None, None),
            }
        } else {
            (None, None)
        };

        let symbol_id = match &enclosing_id {
            Some(enc) if member_edge.is_some() => format!("{}::{}", enc, label),
            _ => format!("{file_node_id}:symbol:{label}"),
        };

        graph.commit_code_symbol(
            conn,
            file_node_id,
            repo_id,
            relative_path,
            label,
            kind,
            &symbol_id,
            line_idx,
            enclosing_id.as_deref(),
            member_edge,
        )?;
        count += 1;
    }

    Ok(Some(count))
}

#[cfg(test)]
mod tests {
    use tree_sitter::Query;

    #[test]
    fn gitnexus_aligned_scm_queries_compile() {
        let ts_lang: tree_sitter::Language = tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into();
        Query::new(&ts_lang, include_str!("queries/ts_definitions.scm")).expect("TS query valid");
        let tsx_lang: tree_sitter::Language = tree_sitter_typescript::LANGUAGE_TSX.into();
        Query::new(&tsx_lang, include_str!("queries/ts_definitions.scm")).expect("TSX query valid");
        let js_lang: tree_sitter::Language = tree_sitter_javascript::LANGUAGE.into();
        Query::new(&js_lang, include_str!("queries/js_definitions.scm")).expect("JS query valid");
    }

    #[test]
    fn gitnexus_aligned_ts_js_calls_scm_compile() {
        let ts_lang: tree_sitter::Language = tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into();
        Query::new(&ts_lang, super::TS_CALLS_SRC).expect("TS calls query valid");
        let tsx_lang: tree_sitter::Language = tree_sitter_typescript::LANGUAGE_TSX.into();
        Query::new(&tsx_lang, super::TS_CALLS_SRC).expect("TSX calls query valid");
        let js_lang: tree_sitter::Language = tree_sitter_javascript::LANGUAGE.into();
        Query::new(&js_lang, super::JS_CALLS_SRC).expect("JS calls query valid");
    }

    #[test]
    fn gitnexus_aligned_ts_js_local_classes_scm_compile() {
        let ts_lang: tree_sitter::Language = tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into();
        Query::new(&ts_lang, super::TS_JS_LOCAL_CLASSES_TS_SRC).expect("local classes TS");
        let tsx_lang: tree_sitter::Language = tree_sitter_typescript::LANGUAGE_TSX.into();
        Query::new(&tsx_lang, super::TS_JS_LOCAL_CLASSES_TS_SRC).expect("local classes TSX");
        let js_lang: tree_sitter::Language = tree_sitter_javascript::LANGUAGE.into();
        Query::new(&js_lang, super::TS_JS_LOCAL_CLASSES_JS_SRC).expect("local classes JS");
    }

    #[test]
    fn ts_super_extends_base_key_from_class_heritage() {
        let src = r"class Base {}
class Child extends Base {
  m() { super.x(); }
}";
        let lang: tree_sitter::Language = tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into();
        let mut p = tree_sitter::Parser::new();
        p.set_language(&lang).unwrap();
        let tree = p.parse(src, None).unwrap();
        let root = tree.root_node();
        let source = src.as_bytes();
        let mut super_node: Option<tree_sitter::Node<'_>> = None;
        let mut stack = vec![root];
        while let Some(n) = stack.pop() {
            if n.kind() == "super" {
                super_node = Some(n);
                break;
            }
            let mut c = n.walk();
            if c.goto_first_child() {
                loop {
                    stack.push(c.node());
                    if !c.goto_next_sibling() {
                        break;
                    }
                }
            }
        }
        let sup = super_node.expect("super");
        let call = sup.parent().expect("member_expression");
        let call_expr = call.parent().expect("call_expression");
        let key = super::enclosing_class_extends_import_lookup_key(call_expr, source);
        assert_eq!(key.as_deref(), Some("Base"));
    }

    #[test]
    fn gitnexus_aligned_ts_js_local_names_scm_compile() {
        let ts_lang: tree_sitter::Language = tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into();
        Query::new(&ts_lang, super::TS_JS_LOCAL_NAMES_SRC).expect("local names TS");
        let tsx_lang: tree_sitter::Language = tree_sitter_typescript::LANGUAGE_TSX.into();
        Query::new(&tsx_lang, super::TS_JS_LOCAL_NAMES_SRC).expect("local names TSX");
        let js_lang: tree_sitter::Language = tree_sitter_javascript::LANGUAGE.into();
        Query::new(&js_lang, super::TS_JS_LOCAL_NAMES_SRC).expect("local names JS");
    }
}
