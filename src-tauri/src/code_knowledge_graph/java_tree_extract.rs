//! Java symbol extraction via tree-sitter-java, aligned with GitNexus
//! `gitnexus/src/core/ingestion/tree-sitter-queries.ts` (`JAVA_QUERIES` definition captures).

use std::collections::HashSet;
use std::sync::OnceLock;

use rusqlite::Connection;
use streaming_iterator::StreamingIterator;
use tree_sitter::{Language, Parser, Query, QueryCursor};

use crate::code_knowledge_graph::tree_sitter_parser::Parser as GraphParser;

const JAVA_QUERY_SRC: &str = include_str!("queries/java_definitions.scm");

fn compiled_java_query() -> Result<&'static Query, String> {
    static CELL: OnceLock<Result<Query, String>> = OnceLock::new();
    CELL.get_or_init(|| {
        let lang: Language = tree_sitter_java::LANGUAGE.into();
        Query::new(&lang, JAVA_QUERY_SRC).map_err(|e| format!("Java query compile: {e}"))
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn definition_kind_from_capture(cap: &str) -> Option<&str> {
    cap.strip_prefix("definition.")
}

fn enclosing_java_type_symbol_id(
    file_node_id: &str,
    anchor: tree_sitter::Node<'_>,
    source: &[u8],
) -> Option<String> {
    let mut cur = anchor.parent();
    while let Some(p) = cur {
        if matches!(
            p.kind(),
            "class_declaration"
                | "interface_declaration"
                | "enum_declaration"
                | "record_declaration"
                | "annotation_type_declaration"
        ) {
            let name_n = p.child_by_field_name("name")?;
            let name = name_n.utf8_text(source).ok()?;
            if name.is_empty() {
                return None;
            }
            return Some(format!("{file_node_id}:symbol:{name}"));
        }
        cur = p.parent();
    }
    None
}

/// `Ok(None)` = parse failed or root has errors — caller should fall back to regex.
/// `Ok(Some(n))` = tree-sitter path used (`n` may be 0).
pub(crate) fn extract_java_symbols_tree_sitter(
    graph: &GraphParser,
    conn: &Connection,
    content: &str,
    file_node_id: &str,
    repo_id: i64,
    relative_path: &str,
) -> Result<Option<usize>, String> {
    let query = compiled_java_query()?;
    let language: Language = tree_sitter_java::LANGUAGE.into();
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

        let (enclosing_id, member_edge): (Option<String>, Option<&'static str>) = match kind {
            "method" | "property" => match enclosing_java_type_symbol_id(file_node_id, anchor, source) {
                Some(enc) => {
                    let edge = if kind == "method" { "has_method" } else { "has_property" };
                    (Some(enc), Some(edge))
                }
                None => (None, None),
            },
            "constructor" => match enclosing_java_type_symbol_id(file_node_id, anchor, source) {
                Some(enc) => (Some(enc), Some("has_method")),
                None => (None, None),
            },
            _ => (None, None),
        };

        let symbol_id = if kind == "constructor" {
            match &enclosing_id {
                Some(enc) => format!("{}::<init>@{}", enc, anchor.start_byte()),
                None => format!("{file_node_id}:symbol::<init>@{}", anchor.start_byte()),
            }
        } else {
            match &enclosing_id {
                Some(enc) if member_edge.is_some() => format!("{enc}::{label}"),
                _ => format!("{file_node_id}:symbol:{label}"),
            }
        };

        let commit_label = if kind == "constructor" { "<init>" } else { label };

        graph.commit_code_symbol(
            conn,
            file_node_id,
            repo_id,
            relative_path,
            commit_label,
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
    fn gitnexus_aligned_java_scm_compiles() {
        let lang: tree_sitter::Language = tree_sitter_java::LANGUAGE.into();
        Query::new(&lang, super::JAVA_QUERY_SRC).expect("Java query valid");
    }
}
