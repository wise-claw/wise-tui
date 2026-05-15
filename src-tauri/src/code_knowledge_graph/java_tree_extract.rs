//! Java symbol + import + calls + heritage extraction via tree-sitter-java, aligned with GitNexus
//! `gitnexus/src/core/ingestion/tree-sitter-queries.ts` (`JAVA_QUERIES`).

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use rusqlite::Connection;
use streaming_iterator::StreamingIterator;
use tree_sitter::{Language, Parser, Query, QueryCursor};

use crate::code_knowledge_graph::indexer;
use crate::code_knowledge_graph::storage as graph_storage;
use crate::code_knowledge_graph::tree_sitter_parser::{
    is_bare_java_module, java_qualified_to_relative_path, Parser as GraphParser,
};

const JAVA_DEF_QUERY_SRC: &str = include_str!("queries/java_definitions.scm");
const JAVA_IMPORT_QUERY_SRC: &str = include_str!("queries/java_imports.scm");
const JAVA_CALLS_QUERY_SRC: &str = include_str!("queries/java_calls.scm");
const JAVA_HERITAGE_QUERY_SRC: &str = include_str!("queries/java_heritage.scm");
const JAVA_ASSIGN_QUERY_SRC: &str = include_str!("queries/java_assignments.scm");

fn compiled_java_def_query() -> Result<&'static Query, String> {
    static CELL: OnceLock<Result<Query, String>> = OnceLock::new();
    CELL.get_or_init(|| {
        let lang: Language = tree_sitter_java::LANGUAGE.into();
        Query::new(&lang, JAVA_DEF_QUERY_SRC).map_err(|e| format!("Java def query compile: {e}"))
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn compiled_java_import_query() -> Result<&'static Query, String> {
    static CELL: OnceLock<Result<Query, String>> = OnceLock::new();
    CELL.get_or_init(|| {
        let lang: Language = tree_sitter_java::LANGUAGE.into();
        Query::new(&lang, JAVA_IMPORT_QUERY_SRC).map_err(|e| format!("Java import query compile: {e}"))
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn compiled_java_calls_query() -> Result<&'static Query, String> {
    static CELL: OnceLock<Result<Query, String>> = OnceLock::new();
    CELL.get_or_init(|| {
        let lang: Language = tree_sitter_java::LANGUAGE.into();
        Query::new(&lang, JAVA_CALLS_QUERY_SRC).map_err(|e| format!("Java calls query compile: {e}"))
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn compiled_java_heritage_query() -> Result<&'static Query, String> {
    static CELL: OnceLock<Result<Query, String>> = OnceLock::new();
    CELL.get_or_init(|| {
        let lang: Language = tree_sitter_java::LANGUAGE.into();
        Query::new(&lang, JAVA_HERITAGE_QUERY_SRC).map_err(|e| format!("Java heritage query compile: {e}"))
    })
    .as_ref()
    .map_err(|e| e.clone())
}

fn compiled_java_assignment_query() -> Result<&'static Query, String> {
    static CELL: OnceLock<Result<Query, String>> = OnceLock::new();
    CELL.get_or_init(|| {
        let lang: Language = tree_sitter_java::LANGUAGE.into();
        Query::new(&lang, JAVA_ASSIGN_QUERY_SRC).map_err(|e| format!("Java assignment query compile: {e}"))
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

/// 最近外层方法 / 构造器符号 id（用于 `calls` 源）；若无则 `None`。
fn enclosing_java_method_or_ctor_symbol_id(
    file_node_id: &str,
    anchor: tree_sitter::Node<'_>,
    source: &[u8],
) -> Option<String> {
    let mut cur = anchor.parent();
    while let Some(p) = cur {
        if p.kind() == "method_declaration" {
            let name_n = p.child_by_field_name("name")?;
            let name = name_n.utf8_text(source).ok()?;
            let type_id = enclosing_java_type_symbol_id(file_node_id, p, source)?;
            return Some(format!("{type_id}::{name}"));
        }
        if matches!(p.kind(), "constructor_declaration" | "compact_constructor_declaration") {
            let type_id = enclosing_java_type_symbol_id(file_node_id, p, source)?;
            return Some(format!("{}::<init>@{}", type_id, p.start_byte()));
        }
        cur = p.parent();
    }
    None
}

fn java_import_declaration_has_asterisk(decl: tree_sitter::Node<'_>) -> bool {
    let mut c = decl.walk();
    if c.goto_first_child() {
        loop {
            if c.node().kind() == "asterisk" {
                return true;
            }
            if !c.goto_next_sibling() {
                break;
            }
        }
    }
    false
}

/// `import java.util.Map` / `import static java.util.Collections.emptyList` → dotted FQCN prefix。
fn java_fqcn_from_import_declaration(decl: tree_sitter::Node<'_>, source: &[u8]) -> Option<String> {
    if java_import_declaration_has_asterisk(decl) {
        return None;
    }
    let mut scoped: Option<tree_sitter::Node<'_>> = None;
    let mut ident: Option<tree_sitter::Node<'_>> = None;
    let mut c = decl.walk();
    if c.goto_first_child() {
        loop {
            let n = c.node();
            match n.kind() {
                "scoped_identifier" => scoped = Some(n),
                "identifier" => ident = Some(n),
                _ => {}
            }
            if !c.goto_next_sibling() {
                break;
            }
        }
    }
    let node = scoped.or(ident)?;
    let s = node.utf8_text(source).ok()?.trim();
    if s.is_empty() {
        return None;
    }
    Some(s.to_string())
}

pub(crate) fn record_java_import_simple_name(
    fqcn: &str,
    resolved_path: &str,
    import_simple_map: &mut HashMap<String, String>,
) {
    if let Some(simple) = fqcn.rsplit('.').next() {
        if !simple.is_empty() && simple != "*" {
            import_simple_map.insert(simple.to_string(), resolved_path.to_string());
        }
    }
}

/// Tree-sitter `import_declaration` → `imports` 边；`import_simple_map` 供 calls/heritage 解析简单类名。
pub(crate) fn extract_java_imports_tree_sitter(
    graph: &GraphParser,
    conn: &Connection,
    content: &str,
    file_node_id: &str,
    repo_id: i64,
    dedup: &mut HashSet<String>,
    import_simple_map: &mut HashMap<String, String>,
) -> Result<usize, String> {
    let query = compiled_java_import_query()?;
    let language: Language = tree_sitter_java::LANGUAGE.into();
    let mut parser = Parser::new();
    if parser.set_language(&language).is_err() {
        return Ok(0);
    }
    let Some(tree) = parser.parse(content, None) else {
        return Ok(0);
    };
    let root = tree.root_node();
    let source = content.as_bytes();
    let capture_names = query.capture_names();
    let mut cursor = QueryCursor::new();
    let mut count = 0usize;

    let mut matches = cursor.matches(query, root, source);
    while let Some(m) = StreamingIterator::next(&mut matches) {
        let mut decl: Option<tree_sitter::Node<'_>> = None;
        for c in m.captures {
            let cap = capture_names.get(c.index as usize).copied().unwrap_or("");
            if cap == "java_import" {
                decl = Some(c.node);
            }
        }
        let Some(decl_node) = decl else {
            continue;
        };
        let Some(q) = java_fqcn_from_import_declaration(decl_node, source) else {
            continue;
        };
        if q.ends_with(".*") || q.ends_with('.') {
            continue;
        }
        let Some(resolved) = java_qualified_to_relative_path(&q) else {
            continue;
        };
        if is_bare_java_module(&q) {
            continue;
        }
        record_java_import_simple_name(&q, &resolved, import_simple_map);
        if !dedup.insert(resolved.clone()) {
            continue;
        }
        count += graph.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
    }

    Ok(count)
}

/// `Ok(None)` = 解析器未加载；`Ok(Some(n))` = 已跑 tree-sitter（`n` 可为 0）。
pub(crate) fn extract_java_symbols_tree_sitter(
    graph: &GraphParser,
    conn: &Connection,
    content: &str,
    file_node_id: &str,
    repo_id: i64,
    relative_path: &str,
) -> Result<Option<usize>, String> {
    let query = compiled_java_def_query()?;
    let language: Language = tree_sitter_java::LANGUAGE.into();
    let mut parser = Parser::new();
    if parser.set_language(&language).is_err() {
        return Ok(None);
    }
    let Some(tree) = parser.parse(content, None) else {
        return Ok(None);
    };
    let root = tree.root_node();
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

fn java_type_node_approx_fqcn(node: tree_sitter::Node<'_>, source: &[u8]) -> Option<String> {
    match node.kind() {
        "type_identifier" | "void_type" | "integral_type" | "floating_point_type" | "boolean_type" => {
            node.utf8_text(source).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
        }
        "scoped_type_identifier" => node
            .utf8_text(source)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        "generic_type" => {
            let mut c = node.walk();
            if c.goto_first_child() {
                return java_type_node_approx_fqcn(c.node(), source);
            }
            None
        }
        "array_type" => node
            .child_by_field_name("element")
            .and_then(|e| java_type_node_approx_fqcn(e, source)),
        _ => None,
    }
}

fn resolve_java_type_ref_to_repo_path(
    raw: &str,
    package: Option<&str>,
    imports: &HashMap<String, String>,
) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let base = raw.split('<').next().unwrap_or(raw).trim();
    if base.is_empty() {
        return None;
    }
    if base.contains('.') {
        return java_qualified_to_relative_path(base);
    }
    if let Some(p) = imports.get(base) {
        return Some(p.clone());
    }
    let pkg = package?;
    let fq = if pkg.is_empty() {
        base.to_string()
    } else {
        format!("{pkg}.{base}")
    };
    java_qualified_to_relative_path(&fq)
}

/// `src/.../java/com/example/Foo.java` → `com.example`；非 Maven 布局则 `None`。
fn java_infer_package_from_relative_java_path(rel: &str) -> Option<String> {
    let rel = rel.replace('\\', "/");
    let tail = rel
        .rsplit_once("/java/")
        .map(|(_, a)| a)
        .or_else(|| rel.strip_prefix("java/"))
        .unwrap_or("");
    if tail.is_empty() {
        return None;
    }
    let p = tail.strip_suffix(".java")?;
    let (dir, _) = p.rsplit_once('/')?;
    if dir.is_empty() {
        return Some(String::new());
    }
    Some(dir.replace('/', "."))
}

/// 与显式 import 不冲突：`or_insert` 仅补 JDK 常见简单名 → `java/lang/*.java`。
pub(crate) fn prime_java_lang_imports(map: &mut HashMap<String, String>) {
    const PAIRS: &[(&str, &str)] = &[
        ("String", "java/lang/String.java"),
        ("Object", "java/lang/Object.java"),
        ("Integer", "java/lang/Integer.java"),
        ("Long", "java/lang/Long.java"),
        ("Boolean", "java/lang/Boolean.java"),
        ("Double", "java/lang/Double.java"),
        ("Float", "java/lang/Float.java"),
        ("Byte", "java/lang/Byte.java"),
        ("Short", "java/lang/Short.java"),
        ("Character", "java/lang/Character.java"),
        ("Void", "java/lang/Void.java"),
        ("Class", "java/lang/Class.java"),
        ("Throwable", "java/lang/Throwable.java"),
        ("Exception", "java/lang/Exception.java"),
        ("RuntimeException", "java/lang/RuntimeException.java"),
        ("Iterable", "java/lang/Iterable.java"),
        ("CharSequence", "java/lang/CharSequence.java"),
        ("Comparable", "java/lang/Comparable.java"),
        ("Cloneable", "java/lang/Cloneable.java"),
    ];
    for (k, v) in PAIRS {
        map.entry((*k).to_string()).or_insert_with(|| (*v).to_string());
    }
}

/// 从 `anchor` 沿父链找到外层 `class_declaration`，解析 `extends`（`superclass`）类型 → 仓库 `.java` 路径。
fn enclosing_java_class_superclass_repo_path(
    anchor: tree_sitter::Node<'_>,
    package: Option<&str>,
    imports: &HashMap<String, String>,
    source: &[u8],
) -> Option<String> {
    let mut cur = anchor;
    loop {
        let p = cur.parent()?;
        if p.kind() == "class_declaration" {
            let sc = p.child_by_field_name("superclass")?;
            let ty = sc.named_child(0)?;
            let fq = java_type_node_approx_fqcn(ty, source)?;
            return resolve_java_type_ref_to_repo_path(&fq, package, imports);
        }
        cur = p;
    }
}

/// 解析 `this` / 简单名 / 类型表达式 → 仓库内 `.java` 相对路径（`this` → 当前文件）。
fn resolve_java_expression_as_repo_relative_path(
    expr: tree_sitter::Node<'_>,
    relative_path: &str,
    package: Option<&str>,
    imports: &HashMap<String, String>,
    source: &[u8],
) -> Option<String> {
    match expr.kind() {
        "this" => Some(relative_path.to_string()),
        // `super` 在 method_invocation / method_reference / field_access 处由外层 class 的 superclass 解析
        "super" => None,
        "identifier" => {
            let id = expr.utf8_text(source).ok()?;
            resolve_java_type_ref_to_repo_path(id, package, imports)
        }
        _ => {
            let fq = java_type_node_approx_fqcn(expr, source)?;
            resolve_java_type_ref_to_repo_path(&fq, package, imports)
        }
    }
}

fn try_add_java_graph_edge(
    conn: &Connection,
    repo_id: i64,
    source_id: &str,
    target_repo_path: &str,
    kind: &str,
    site_tag: &str,
    dedup: &mut HashSet<String>,
) -> Result<usize, String> {
    if !graph_storage::graph_node_exists(conn, source_id)? {
        return Ok(0);
    }
    let target_id = indexer::make_file_node_id(repo_id, target_repo_path);
    if !graph_storage::graph_node_exists(conn, &target_id)? {
        return Ok(0);
    }
    let edge_id = format!("{source_id}:{kind}:{target_id}:{site_tag}");
    if !dedup.insert(edge_id.clone()) {
        return Ok(0);
    }
    graph_storage::upsert_edge(conn, &edge_id, source_id, &target_id, kind)?;
    Ok(1)
}

/// GitNexus `JAVA_QUERIES`：heritage、calls、`assignment` 字段写、`java.lang` 简单名（经 `prime_java_lang_imports`）。
pub(crate) fn extract_java_calls_and_heritage(
    conn: &Connection,
    content: &str,
    file_node_id: &str,
    repo_id: i64,
    relative_path: &str,
    package: Option<&str>,
    import_simple_map: &HashMap<String, String>,
) -> Result<usize, String> {
    let language: Language = tree_sitter_java::LANGUAGE.into();
    let mut parser = Parser::new();
    if parser.set_language(&language).is_err() {
        return Ok(0);
    }
    let Some(tree) = parser.parse(content, None) else {
        return Ok(0);
    };
    let root = tree.root_node();
    let source = content.as_bytes();
    let effective_pkg = package
        .map(str::to_string)
        .or_else(|| java_infer_package_from_relative_java_path(relative_path));
    let pkg = effective_pkg.as_deref();
    let mut dedup = HashSet::<String>::new();
    let mut total = 0usize;
    let call_source = |anchor: tree_sitter::Node<'_>| {
        enclosing_java_method_or_ctor_symbol_id(file_node_id, anchor, source)
            .unwrap_or_else(|| file_node_id.to_string())
    };

    // --- heritage ---
    let hq = compiled_java_heritage_query()?;
    let hnames = hq.capture_names();
    let mut hcursor = QueryCursor::new();
    let mut hmatches = hcursor.matches(hq, root, source);
    while let Some(m) = StreamingIterator::next(&mut hmatches) {
        let mut class_name: Option<&str> = None;
        let mut extends_ty: Option<tree_sitter::Node<'_>> = None;
        let mut impl_ty: Option<tree_sitter::Node<'_>> = None;
        for c in m.captures {
            let cap = hnames.get(c.index as usize).copied().unwrap_or("");
            match cap {
                "heritage.class" => {
                    class_name = c.node.utf8_text(source).ok();
                }
                "heritage.extends" => extends_ty = Some(c.node),
                "heritage.implements" => impl_ty = Some(c.node),
                _ => {}
            }
        }
        let Some(cname) = class_name.filter(|s| !s.is_empty()) else {
            continue;
        };
        let source_symbol = format!("{file_node_id}:symbol:{cname}");
        if let Some(tn) = extends_ty {
            if let Some(fq) = java_type_node_approx_fqcn(tn, source) {
                if let Some(path) = resolve_java_type_ref_to_repo_path(&fq, pkg, import_simple_map) {
                    let tag = format!("ext:{}:{}", tn.start_byte(), tn.end_byte());
                    total += try_add_java_graph_edge(
                        conn,
                        repo_id,
                        &source_symbol,
                        &path,
                        "extends",
                        &tag,
                        &mut dedup,
                    )?;
                }
            }
        }
        if let Some(tn) = impl_ty {
            if let Some(fq) = java_type_node_approx_fqcn(tn, source) {
                if let Some(path) = resolve_java_type_ref_to_repo_path(&fq, pkg, import_simple_map) {
                    let tag = format!("impl:{}:{}", tn.start_byte(), tn.end_byte());
                    total += try_add_java_graph_edge(
                        conn,
                        repo_id,
                        &source_symbol,
                        &path,
                        "implements",
                        &tag,
                        &mut dedup,
                    )?;
                }
            }
        }
    }

    // --- calls ---
    let cq = compiled_java_calls_query()?;
    let cnames = cq.capture_names();
    let mut ccursor = QueryCursor::new();
    let mut cmatches = ccursor.matches(cq, root, source);
    while let Some(m) = StreamingIterator::next(&mut cmatches) {
        let mut root_n: Option<tree_sitter::Node<'_>> = None;
        let mut call_name: Option<tree_sitter::Node<'_>> = None;
        let mut new_unqual: Option<tree_sitter::Node<'_>> = None;
        let mut mref_root: Option<tree_sitter::Node<'_>> = None;
        for c in m.captures {
            let cap = cnames.get(c.index as usize).copied().unwrap_or("");
            match cap {
                "call.root" => root_n = Some(c.node),
                "call.name" => call_name = Some(c.node),
                "call.unqual" => new_unqual = Some(c.node),
                "call.mref_root" => mref_root = Some(c.node),
                _ => {}
            }
        }

        if let Some(unq) = new_unqual {
            if unq.kind() != "_unqualified_object_creation_expression" {
                continue;
            }
            let Some(nt) = unq.child_by_field_name("type") else {
                continue;
            };
            let anchor = root_n.unwrap_or(unq);
            if let Some(fq) = java_type_node_approx_fqcn(nt, source) {
                if let Some(path) = resolve_java_type_ref_to_repo_path(&fq, pkg, import_simple_map) {
                    let src = call_source(anchor);
                    let tag = format!("new:{}:{}", anchor.start_byte(), anchor.end_byte());
                    total += try_add_java_graph_edge(conn, repo_id, &src, &path, "calls", &tag, &mut dedup)?;
                }
            }
            continue;
        }

        if let Some(mr) = mref_root {
            let src = call_source(mr);
            if let Some(recv) = mr.child(0) {
                let path_opt = if recv.kind() == "super" {
                    enclosing_java_class_superclass_repo_path(mr, pkg, import_simple_map, source)
                } else {
                    resolve_java_expression_as_repo_relative_path(
                        recv,
                        relative_path,
                        pkg,
                        import_simple_map,
                        source,
                    )
                };
                if let Some(path) = path_opt {
                    let tag = format!("mref:{}:{}", mr.start_byte(), mr.end_byte());
                    total += try_add_java_graph_edge(conn, repo_id, &src, &path, "calls", &tag, &mut dedup)?;
                }
            }
            continue;
        }

        if let (Some(mi), Some(_name_n)) = (root_n, call_name) {
            if mi.kind() != "method_invocation" {
                continue;
            }
            let anchor = mi;
            let Some(obj) = mi.child_by_field_name("object") else {
                continue;
            };
            let path_opt = if obj.kind() == "super" {
                enclosing_java_class_superclass_repo_path(anchor, pkg, import_simple_map, source)
            } else {
                resolve_java_expression_as_repo_relative_path(
                    obj,
                    relative_path,
                    pkg,
                    import_simple_map,
                    source,
                )
            };
            let Some(path) = path_opt else {
                continue;
            };
            let src = call_source(anchor);
            let tag = format!(
                "mi:{}:{}:{}",
                anchor.start_byte(),
                anchor.end_byte(),
                relative_path.replace('/', "_")
            );
            total += try_add_java_graph_edge(conn, repo_id, &src, &path, "calls", &tag, &mut dedup)?;
        }
    }

    // --- field writes (GitNexus assignment + field_access) ---
    let aq = compiled_java_assignment_query()?;
    let anames = aq.capture_names();
    let mut acursor = QueryCursor::new();
    let mut amatches = acursor.matches(aq, root, source);
    while let Some(m) = StreamingIterator::next(&mut amatches) {
        let mut asn_root: Option<tree_sitter::Node<'_>> = None;
        let mut recv: Option<tree_sitter::Node<'_>> = None;
        let mut prop: Option<tree_sitter::Node<'_>> = None;
        for c in m.captures {
            let cap = anames.get(c.index as usize).copied().unwrap_or("");
            match cap {
                "assignment.root" => asn_root = Some(c.node),
                "assignment.receiver" => recv = Some(c.node),
                "assignment.property" => prop = Some(c.node),
                _ => {}
            }
        }
        let (Some(anchor), Some(rv), Some(pn)) = (asn_root, recv, prop) else {
            continue;
        };
        let Ok(prop_name) = pn.utf8_text(source) else {
            continue;
        };
        let Some(path) = (if rv.kind() == "super" {
            enclosing_java_class_superclass_repo_path(anchor, pkg, import_simple_map, source)
        } else {
            resolve_java_expression_as_repo_relative_path(rv, relative_path, pkg, import_simple_map, source)
        }) else {
            continue;
        };
        let src = call_source(anchor);
        let tag = format!("w:{}:{}:{}", prop_name, anchor.start_byte(), anchor.end_byte());
        total += try_add_java_graph_edge(conn, repo_id, &src, &path, "writes", &tag, &mut dedup)?;
    }

    Ok(total)
}

#[cfg(test)]
mod tests {
    use tree_sitter::Query;

    #[test]
    fn gitnexus_aligned_java_def_scm_compiles() {
        let lang: tree_sitter::Language = tree_sitter_java::LANGUAGE.into();
        Query::new(&lang, super::JAVA_DEF_QUERY_SRC).expect("Java def query valid");
    }

    #[test]
    fn gitnexus_aligned_java_import_scm_compiles() {
        let lang: tree_sitter::Language = tree_sitter_java::LANGUAGE.into();
        Query::new(&lang, super::JAVA_IMPORT_QUERY_SRC).expect("Java import query valid");
    }

    #[test]
    fn gitnexus_aligned_java_calls_scm_compiles() {
        let lang: tree_sitter::Language = tree_sitter_java::LANGUAGE.into();
        Query::new(&lang, super::JAVA_CALLS_QUERY_SRC).expect("Java calls query valid");
    }

    #[test]
    fn gitnexus_aligned_java_heritage_scm_compiles() {
        let lang: tree_sitter::Language = tree_sitter_java::LANGUAGE.into();
        Query::new(&lang, super::JAVA_HERITAGE_QUERY_SRC).expect("Java heritage query valid");
    }

    #[test]
    fn gitnexus_aligned_java_assign_scm_compiles() {
        let lang: tree_sitter::Language = tree_sitter_java::LANGUAGE.into();
        Query::new(&lang, super::JAVA_ASSIGN_QUERY_SRC).expect("Java assignment query valid");
    }

    #[test]
    fn java_super_superclass_resolves_via_simple_extends() {
        use std::collections::HashMap;
        let src = "class Child extends Base { void m() { super.hashCode(); } }";
        let lang: tree_sitter::Language = tree_sitter_java::LANGUAGE.into();
        let mut p = tree_sitter::Parser::new();
        p.set_language(&lang).unwrap();
        let tree = p.parse(src, None).unwrap();
        let root = tree.root_node();
        let source = src.as_bytes();
        let mut mi_node: Option<tree_sitter::Node<'_>> = None;
        let mut stack = vec![root];
        while let Some(n) = stack.pop() {
            if n.kind() == "method_invocation" {
                if let Some(obj) = n.child_by_field_name("object") {
                    if obj.kind() == "super" {
                        mi_node = Some(n);
                        break;
                    }
                }
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
        let mi = mi_node.expect("method_invocation on super");
        let mut imports = HashMap::new();
        imports.insert("Base".to_string(), "pkg/Base.java".to_string());
        let path = super::enclosing_java_class_superclass_repo_path(mi, None, &imports, source);
        assert_eq!(path.as_deref(), Some("pkg/Base.java"));
    }
}
