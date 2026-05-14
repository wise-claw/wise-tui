//! TypeScript / JavaScript / TSX symbol extraction via tree-sitter, aligned with GitNexus
//! `gitnexus/src/core/ingestion/tree-sitter-queries.ts` (definition patterns in `queries/*.scm`).

use std::collections::HashSet;
use std::sync::OnceLock;

use rusqlite::Connection;
use streaming_iterator::StreamingIterator;
use tree_sitter::{Language, Parser, Query, QueryCursor};

use crate::code_knowledge_graph::tree_sitter_parser::Parser as GraphParser;

const TS_QUERY_SRC: &str = include_str!("queries/ts_definitions.scm");
const JS_QUERY_SRC: &str = include_str!("queries/js_definitions.scm");

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
        let ts = Query::new(&ts_lang, TS_QUERY_SRC).map_err(|e| format!("TS query compile: {e}"))?;
        let tsx = Query::new(&tsx_lang, TS_QUERY_SRC).map_err(|e| format!("TSX query compile: {e}"))?;
        let js = Query::new(&js_lang, JS_QUERY_SRC).map_err(|e| format!("JS query compile: {e}"))?;
        Ok(CompiledQueries { ts, tsx, js })
    })
    .as_ref()
    .map_err(|e| e.clone())
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
}
