use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use regex::Regex;

use crate::code_knowledge_graph::storage as graph_storage;

static VUE_SCRIPT_INNER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?si)<script\b[^>]*>([\s\S]*?)</script>")
        .expect("vue <script> inner regex")
});

static JAVA_IMPORT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*import\s+(?:static\s+)?([\w$.]+)\s*;")
        .expect("java import regex")
});

static JAVA_TYPE_DECL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?m)(?<!\.)(?:(?:public|private|protected|abstract|final|static|sealed|strictfp)\s+)*\b(class|interface|enum|record)\s+([A-Za-z_]\w*)\b",
    )
    .expect("java type decl regex")
});

static JAVA_PACKAGE_DECL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*package\s+([\w.]+)\s*;").expect("java package decl regex")
});

static RUST_MOD_SEMI: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:pub\s+)?mod\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;")
        .expect("rust mod semi regex")
});

static RUST_FN_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)")
        .expect("rust fn line regex")
});

static RUST_STRUCT_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_][\w]*)")
        .expect("rust struct line regex")
});

static RUST_ENUM_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_][\w]*)")
        .expect("rust enum line regex")
});

static RUST_TRAIT_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_][\w]*)")
        .expect("rust trait line regex")
});

static RUST_TYPE_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_][\w]*)\s*=")
        .expect("rust type alias line regex")
});

static RUST_MOD_INLINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?:pub\s+)?mod\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{")
        .expect("rust mod inline regex")
});

/// JSON `"$ref": "..."` and YAML `$ref: "..."` / `'...'`
static REF_DOLLAR_QUOTED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)['"]?\$ref['"]?\s*:\s*["']([^"']+)["']"#).expect("ref $ref quoted regex")
});

/// OpenAPI-style unquoted `$ref: ./file.yaml` (avoids lines already using quotes)
static REF_YAML_UNQUOTED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*\$ref\s*:\s*([^'\s#][^\s#]*)").expect("ref yaml unquoted regex")
});

static PYTHON_FROM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*from\s+([\w.]+)\s+import\s+").expect("python from import")
});

static PYTHON_IMPORT_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*import\s+(.+)$").expect("python import line")
});

static PYTHON_CLASS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*class\s+(\w+)").expect("python class")
});

static PYTHON_DEF: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?:async\s+)?def\s+(\w+)\s*\(").expect("python def")
});

static GO_IMPORT_QUOTED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)import\s+"([^"]+)""#).expect("go import quoted")
});

static GO_FUNC: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(").expect("go func")
});

static CS_TYPE_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:public|internal|private|protected|file|abstract|sealed|static|partial|readonly|unsafe|\s)*\s*(?:ref\s+struct|record\s+struct|record|class|interface|struct|enum)\s+(\w+)\b")
        .expect("csharp type line")
});

static RUBY_REQUIRE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)require(?:_relative)?\s+['"]([^'"]+)['"]"#).expect("ruby require")
});

static RUBY_CLASS_MOD: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(class|module)\s+(\w+)").expect("ruby class module")
});

static PHP_USE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*use\s+([\w\\]+)\s*;").expect("php use")
});

static PHP_CLASS_LIKE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+(\w+)\b")
        .expect("php class like")
});

static PHP_FUNCTION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:static\s+)?function\s+(\w+)\s*\(").expect("php function")
});

static SWIFT_TYPE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:public|private|internal|fileprivate|open|\s)*\s*(?:indirect\s+)?(?:class|struct|enum|protocol|actor)\s+(\w+)\b")
        .expect("swift type")
});

static SWIFT_FUNC: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:public|private|internal|fileprivate|open|\s)*\s*func\s+(\w+)\s*[\(:]")
        .expect("swift func")
});

/// TypeScript / TSX — align with GitNexus `DEFINES` / `HAS_METHOD` / `HAS_PROPERTY` extraction.
static TS_EXPORT_CLASS_OR_INTERFACE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*export\s+(?:default\s+)?(?:abstract\s+)?(class|interface)\s+([A-Za-z_][\w]*)\b")
        .expect("ts export class/interface")
});
static TS_PLAIN_CLASS_OR_INTERFACE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:declare\s+)?(?:abstract\s+)?(class|interface)\s+([A-Za-z_][\w]*)\b")
        .expect("ts plain class/interface")
});
static TS_MEMBER_METHOD_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:@[\w.]+\s+)*(?:public|private|protected|static|async|override|readonly|declare|abstract|\s)*\s*(\w+)\s*\(")
        .expect("ts member method line")
});
static TS_MEMBER_PROPERTY_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:@[\w.]+\s+)*(?:public|private|protected|readonly|static|\s)*\s*(\w+)(\?)?\s*:\s*\S")
        .expect("ts member property line")
});
static TS_INTERFACE_METHOD_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(\w+)\s*\([^)]*\)\s*:")
        .expect("ts interface method line")
});

static DART_IMPORT_EXPORT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*(?:import|export)\s+['"]([^'"]+)['"]"#).expect("dart import export")
});

static DART_CLASS_MIXIN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:abstract\s+)?(?:class|mixin|extension)\s+(\w+)\b").expect("dart class")
});

static CPP_INCLUDE_LOCAL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)#include\s+"([^"]+)""#).expect("cpp local include")
});

/// Aggregator POM `<module>` entries: allow optional XML prefix, multiline / CDATA body (`[^<]` misses those).
static MAVEN_MODULE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)<(?:[\w.-]+:)?module\b[^>]*>(.*?)</(?:[\w.-]+:)?module\s*>").expect("maven module")
});

static XML_COMMENT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<!--.*?-->").expect("xml comment strip"));

static XML_SPRING_IMPORT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)<import\s+[^>]*\bresource\s*=\s*["']([^"']+)["']"#).expect("xml spring import")
});

static SPRING_CONFIG_IMPORT_PROP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)(?:^|\n)\s*spring\.config\.import\s*=\s*([^\n#]+)").expect("spring.config.import")
});

static GRADLE_APPLY_FROM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?m)(?:apply\s*\(\s*from\s*=\s*["']([^'"]+)["']\)|apply\s+from\s*:\s*['"]([^'"]+)['"])"#,
    )
    .expect("gradle apply from")
});

static KOTLIN_DATA_CLASS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:public\s+|internal\s+|private\s+|protected\s+)?data\s+class\s+(\w+)\b")
        .expect("kotlin data class")
});

static KOTLIN_CLASS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:public\s+|internal\s+|private\s+|protected\s+|abstract\s+|sealed\s+)*\s*class\s+(\w+)\b")
        .expect("kotlin class")
});

static KOTLIN_INTERFACE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:public\s+|internal\s+)?interface\s+(\w+)\b").expect("kotlin interface")
});

static KOTLIN_OBJECT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:public\s+|internal\s+|private\s+)?object\s+(\w+)\b").expect("kotlin object")
});

static KOTLIN_ENUM_CLASS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:public\s+|internal\s+)?enum\s+class\s+(\w+)\b").expect("kotlin enum class")
});

static KOTLIN_FUN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*(?:public\s+|internal\s+|private\s+|protected\s+)?(?:suspend\s+)?fun\s+(\w+)\s*[:(]")
        .expect("kotlin fun")
});

pub struct Parser {
    repo_files: HashSet<String>,
    tsconfig_paths: Option<crate::code_knowledge_graph::tsconfig_paths::TsconfigPaths>,
}

impl Parser {
    /// 无索引上下文（仅启发式路径）；保留供测试或将来复用。
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self {
            repo_files: HashSet::new(),
            tsconfig_paths: None,
        }
    }

    /// Index-time parser: TS/JS imports use the indexed file set + optional `tsconfig` paths (GitNexus parity).
    pub fn with_index_context(
        repo_files: HashSet<String>,
        tsconfig_paths: Option<crate::code_knowledge_graph::tsconfig_paths::TsconfigPaths>,
    ) -> Self {
        Self {
            repo_files,
            tsconfig_paths,
        }
    }

    /// GitNexus-style edges: `File --defines--> symbol`; optional `Type --has_method/has_property--> member`.
    pub(crate) fn commit_code_symbol(
        &self,
        conn: &rusqlite::Connection,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        label: &str,
        raw_kind: &str,
        symbol_id: &str,
        line_idx: usize,
        enclosing_type_symbol_id: Option<&str>,
        member_edge_kind: Option<&str>,
    ) -> Result<(), String> {
        let sk = gitnexus_style_symbol_kind(raw_kind);
        let range = Some(crate::code_knowledge_graph::types::GraphRange {
            start: crate::code_knowledge_graph::types::GraphPosition {
                line: line_idx,
                column: 0,
            },
            end: crate::code_knowledge_graph::types::GraphPosition {
                line: line_idx + 1,
                column: 0,
            },
        });
        graph_storage::upsert_node(
            conn,
            symbol_id,
            "symbol",
            Some(sk.as_str()),
            label,
            relative_path,
            repo_id,
            range,
            None,
        )?;
        graph_storage::upsert_edge(
            conn,
            &format!("{file_node_id}:defines:{symbol_id}"),
            file_node_id,
            symbol_id,
            "defines",
        )?;
        if let (Some(enc), Some(rel)) = (enclosing_type_symbol_id, member_edge_kind) {
            graph_storage::upsert_edge(
                conn,
                &format!("{enc}:{rel}:{symbol_id}"),
                enc,
                symbol_id,
                rel,
            )?;
        }
        Ok(())
    }

    pub fn parse_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let ext = relative_path
            .rsplit_once('.')
            .map(|(_, e)| e)
            .unwrap_or("");
        let norm_path = relative_path.replace('\\', "/");

        if ext.eq_ignore_ascii_case("vue") {
            self.parse_vue_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("java") {
            self.parse_java_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("kt") || ext.eq_ignore_ascii_case("kts") {
            if norm_path.ends_with(".gradle.kts") {
                self.parse_gradle_file(content, file_node_id, repo_id, relative_path, conn)
            } else {
                self.parse_kotlin_file(content, file_node_id, repo_id, relative_path, conn)
            }
        } else if ext.eq_ignore_ascii_case("rs") {
            self.parse_rust_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("yaml")
            || ext.eq_ignore_ascii_case("yml")
            || ext.eq_ignore_ascii_case("json")
        {
            self.parse_json_yaml_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("py") {
            self.parse_python_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("go") {
            self.parse_go_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("cs") {
            self.parse_csharp_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("rb")
            || ext.eq_ignore_ascii_case("rake")
            || ext.eq_ignore_ascii_case("gemspec")
        {
            self.parse_ruby_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("php")
            || ext.eq_ignore_ascii_case("phtml")
            || ext.eq_ignore_ascii_case("php3")
            || ext.eq_ignore_ascii_case("php4")
            || ext.eq_ignore_ascii_case("php5")
            || ext.eq_ignore_ascii_case("php8")
        {
            self.parse_php_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("swift") {
            self.parse_swift_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("dart") {
            self.parse_dart_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("c")
            || ext.eq_ignore_ascii_case("cc")
            || ext.eq_ignore_ascii_case("cpp")
            || ext.eq_ignore_ascii_case("cxx")
            || ext.eq_ignore_ascii_case("h")
            || ext.eq_ignore_ascii_case("hh")
            || ext.eq_ignore_ascii_case("hpp")
            || ext.eq_ignore_ascii_case("hxx")
        {
            self.parse_cpp_family_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("properties") {
            self.parse_properties_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("xml") {
            self.parse_xml_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("gradle") {
            self.parse_gradle_file(content, file_node_id, repo_id, relative_path, conn)
        } else if ext.eq_ignore_ascii_case("cbl")
            || ext.eq_ignore_ascii_case("cob")
            || ext.eq_ignore_ascii_case("cpy")
            || ext.eq_ignore_ascii_case("cobol")
        {
            Ok((0, 0))
        } else if ext.eq_ignore_ascii_case("ts")
            || ext.eq_ignore_ascii_case("tsx")
            || ext.eq_ignore_ascii_case("js")
            || ext.eq_ignore_ascii_case("jsx")
            || ext.eq_ignore_ascii_case("mjs")
            || ext.eq_ignore_ascii_case("cjs")
            || ext.eq_ignore_ascii_case("mts")
            || ext.eq_ignore_ascii_case("cts")
        {
            self.parse_ts_js_file(content, file_node_id, repo_id, relative_path, conn)
        } else {
            Ok((0, 0))
        }
    }

    fn parse_ts_js_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let import_count =
            self.extract_imports(conn, content, file_node_id, repo_id, relative_path)?;
        let import_bindings = self.collect_ts_js_import_bindings(content, relative_path);
        let ext = relative_path
            .rsplit_once('.')
            .map(|(_, e)| e.to_ascii_lowercase())
            .unwrap_or_default();
        let symbol_count = match crate::code_knowledge_graph::ts_js_tree_extract::extract_ts_js_symbols_tree_sitter(
            self,
            conn,
            content,
            file_node_id,
            repo_id,
            relative_path,
            ext.as_str(),
        ) {
            Ok(Some(n)) => n,
            Ok(None) => self.extract_symbols_regex(conn, content, file_node_id, repo_id, relative_path, 0)?,
            Err(e) => return Err(e),
        };
        let call_edges = crate::code_knowledge_graph::ts_js_tree_extract::extract_ts_js_calls_tree_sitter(
            conn,
            content,
            file_node_id,
            repo_id,
            relative_path,
            ext.as_str(),
            &import_bindings,
        )?;
        Ok((symbol_count, symbol_count + import_count + call_edges))
    }

    fn parse_vue_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let mut symbol_count = 0usize;
        let mut import_count = 0usize;
        let mut call_count = 0usize;

        for cap in VUE_SCRIPT_INNER.captures_iter(content) {
            let Some(inner_m) = cap.get(1) else {
                continue;
            };
            let inner = inner_m.as_str();
            if inner.trim().is_empty() {
                continue;
            }
            let line_offset = byte_offset_to_line_number(content, inner_m.start());
            import_count +=
                self.extract_imports(conn, inner, file_node_id, repo_id, relative_path)?;
            let import_bindings = self.collect_ts_js_import_bindings(inner, relative_path);
            let inner_syms = match crate::code_knowledge_graph::ts_js_tree_extract::extract_ts_js_symbols_tree_sitter(
                self,
                conn,
                inner,
                file_node_id,
                repo_id,
                relative_path,
                "ts",
            ) {
                Ok(Some(n)) => n,
                Ok(None) => self.extract_symbols_regex(
                    conn,
                    inner,
                    file_node_id,
                    repo_id,
                    relative_path,
                    line_offset,
                )?,
                Err(e) => return Err(e),
            };
            symbol_count += inner_syms;
            call_count += crate::code_knowledge_graph::ts_js_tree_extract::extract_ts_js_calls_tree_sitter(
                conn,
                inner,
                file_node_id,
                repo_id,
                relative_path,
                "ts",
                &import_bindings,
            )?;
        }

        Ok((symbol_count, symbol_count + import_count + call_count))
    }

    fn parse_java_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let package = java_package_declaration(content);
        let mut import_dedup = HashSet::new();
        let mut import_simple_map = HashMap::new();
        let mut import_count =
            crate::code_knowledge_graph::java_tree_extract::extract_java_imports_tree_sitter(
                self,
                conn,
                content,
                file_node_id,
                repo_id,
                &mut import_dedup,
                &mut import_simple_map,
            )?;
        import_count += self.extract_java_imports(
            conn,
            content,
            file_node_id,
            repo_id,
            relative_path,
            &mut import_dedup,
            true,
            true,
            &mut import_simple_map,
        )?;
        let symbol_count = match crate::code_knowledge_graph::java_tree_extract::extract_java_symbols_tree_sitter(
            self,
            conn,
            content,
            file_node_id,
            repo_id,
            relative_path,
        ) {
            Ok(Some(n)) => n,
            Ok(None) => self.extract_java_symbols(conn, content, file_node_id, repo_id, relative_path)?,
            Err(e) => return Err(e),
        };
        crate::code_knowledge_graph::java_tree_extract::prime_java_lang_imports(&mut import_simple_map);
        let hx = crate::code_knowledge_graph::java_tree_extract::extract_java_calls_and_heritage(
            conn,
            content,
            file_node_id,
            repo_id,
            relative_path,
            package.as_deref(),
            &import_simple_map,
        )?;
        Ok((symbol_count, symbol_count + import_count + hx))
    }

    fn parse_rust_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let import_count =
            self.extract_rust_imports(conn, content, file_node_id, repo_id, relative_path)?;
        let symbol_count =
            self.extract_rust_symbols(conn, content, file_node_id, repo_id, relative_path)?;
        Ok((symbol_count, symbol_count + import_count))
    }

    fn parse_json_yaml_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let import_count =
            self.extract_json_yaml_refs(conn, content, file_node_id, repo_id, relative_path)?;
        Ok((0, import_count))
    }

    fn upsert_line_symbol(
        &self,
        conn: &rusqlite::Connection,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        line_idx: usize,
        name: &str,
        kind: &str,
    ) -> Result<(), String> {
        let symbol_id = format!("{file_node_id}:symbol:{name}");
        self.commit_code_symbol(
            conn,
            file_node_id,
            repo_id,
            relative_path,
            name,
            kind,
            &symbol_id,
            line_idx,
            None,
            None,
        )
    }

    fn parse_kotlin_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let mut import_dedup = HashSet::new();
        let mut import_simple_map = HashMap::new();
        let import_count = self.extract_java_imports(
            conn,
            content,
            file_node_id,
            repo_id,
            relative_path,
            &mut import_dedup,
            false,
            false,
            &mut import_simple_map,
        )?;
        let symbol_count =
            self.extract_kotlin_symbols(conn, content, file_node_id, repo_id, relative_path)?;
        Ok((symbol_count, symbol_count + import_count))
    }

    fn extract_kotlin_symbols(
        &self,
        conn: &rusqlite::Connection,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
    ) -> Result<usize, String> {
        let mut count = 0;
        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            let sym = KOTLIN_DATA_CLASS
                .captures(trimmed)
                .and_then(|c| c.get(1).map(|m| (m.as_str().to_string(), "class".to_string())))
                .or_else(|| {
                    KOTLIN_ENUM_CLASS.captures(trimmed).and_then(|c| {
                        c.get(1).map(|m| (m.as_str().to_string(), "enum".to_string()))
                    })
                })
                .or_else(|| {
                    KOTLIN_OBJECT.captures(trimmed).and_then(|c| {
                        c.get(1).map(|m| (m.as_str().to_string(), "object".to_string()))
                    })
                })
                .or_else(|| {
                    KOTLIN_FUN.captures(trimmed).and_then(|c| {
                        c.get(1)
                            .map(|m| (m.as_str().to_string(), "function".to_string()))
                    })
                })
                .or_else(|| {
                    KOTLIN_INTERFACE.captures(trimmed).and_then(|c| {
                        c.get(1)
                            .map(|m| (m.as_str().to_string(), "interface".to_string()))
                    })
                })
                .or_else(|| {
                    KOTLIN_CLASS.captures(trimmed).and_then(|c| {
                        c.get(1).map(|m| (m.as_str().to_string(), "class".to_string()))
                    })
                });
            let Some((name, kind)) = sym else {
                continue;
            };
            self.upsert_line_symbol(
                conn,
                file_node_id,
                repo_id,
                relative_path,
                line_idx,
                &name,
                &kind,
            )?;
            count += 1;
        }
        Ok(count)
    }

    fn parse_python_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let import_count =
            self.extract_python_imports(conn, content, file_node_id, repo_id, relative_path)?;
        let symbol_count =
            self.extract_python_symbols(conn, content, file_node_id, repo_id, relative_path)?;
        Ok((symbol_count, symbol_count + import_count))
    }

    fn extract_python_imports(
        &self,
        conn: &rusqlite::Connection,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        _relative_path: &str,
    ) -> Result<usize, String> {
        let mut count = 0;
        for cap in PYTHON_FROM.captures_iter(content) {
            let m = cap.get(1).map(|x| x.as_str()).unwrap_or("");
            if m.starts_with('.') {
                continue;
            }
            let resolved = format!("{}.py", m.replace('.', "/"));
            count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
        }
        for cap in PYTHON_IMPORT_LINE.captures_iter(content) {
            let tail = cap.get(1).map(|x| x.as_str()).unwrap_or("").trim();
            if tail.starts_with('(') {
                continue;
            }
            for part in tail.split(',') {
                let p = part.trim().split_whitespace().next().unwrap_or("");
                if p.is_empty() || p == "(" || p.starts_with('.') {
                    continue;
                }
                let resolved = format!("{}.py", p.replace('.', "/"));
                count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
            }
        }
        Ok(count)
    }

    fn extract_python_symbols(
        &self,
        conn: &rusqlite::Connection,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
    ) -> Result<usize, String> {
        let mut count = 0;
        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') {
                continue;
            }
            let sym = PYTHON_CLASS
                .captures(trimmed)
                .and_then(|c| c.get(1).map(|m| (m.as_str().to_string(), "class".to_string())))
                .or_else(|| {
                    PYTHON_DEF
                        .captures(trimmed)
                        .and_then(|c| c.get(1).map(|m| (m.as_str().to_string(), "function".to_string())))
                });
            let Some((name, kind)) = sym else {
                continue;
            };
            self.upsert_line_symbol(
                conn,
                file_node_id,
                repo_id,
                relative_path,
                line_idx,
                &name,
                &kind,
            )?;
            count += 1;
        }
        Ok(count)
    }

    fn parse_go_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let mut import_count = 0usize;
        let file_dir = relative_path.rsplit('/').nth(1).unwrap_or("");
        for cap in GO_IMPORT_QUOTED.captures_iter(content) {
            let p = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            if !p.starts_with('.') {
                continue;
            }
            let resolved = resolve_import_path(file_dir, p, relative_path);
            import_count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
        }
        let mut sym = 0usize;
        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            let Some(c) = GO_FUNC.captures(trimmed) else {
                continue;
            };
            let Some(name) = c.get(1).map(|m| m.as_str()) else {
                continue;
            };
            self.upsert_line_symbol(
                conn,
                file_node_id,
                repo_id,
                relative_path,
                line_idx,
                name,
                "function",
            )?;
            sym += 1;
        }
        Ok((sym, sym + import_count))
    }

    fn parse_csharp_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let mut count = 0usize;
        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            let Some(c) = CS_TYPE_LINE.captures(trimmed) else {
                continue;
            };
            let Some(name) = c.get(1).map(|m| m.as_str()) else {
                continue;
            };
            self.upsert_line_symbol(
                conn,
                file_node_id,
                repo_id,
                relative_path,
                line_idx,
                name,
                "class",
            )?;
            count += 1;
        }
        Ok((count, count))
    }

    fn parse_ruby_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let mut import_count = 0usize;
        let file_dir = relative_path.rsplit('/').nth(1).unwrap_or("");
        for cap in RUBY_REQUIRE.captures_iter(content) {
            let p = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            if p.starts_with('/') || p.contains(':') {
                continue;
            }
            let resolved = resolve_import_path(file_dir, p, relative_path);
            import_count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
        }
        let mut sym = 0usize;
        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') {
                continue;
            }
            let Some(c) = RUBY_CLASS_MOD.captures(trimmed) else {
                continue;
            };
            let kind = c.get(1).map(|m| m.as_str()).unwrap_or("class");
            let Some(name) = c.get(2).map(|m| m.as_str()) else {
                continue;
            };
            self.upsert_line_symbol(
                conn,
                file_node_id,
                repo_id,
                relative_path,
                line_idx,
                name,
                kind,
            )?;
            sym += 1;
        }
        Ok((sym, sym + import_count))
    }

    fn parse_php_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let mut import_count = 0usize;
        for cap in PHP_USE.captures_iter(content) {
            let q = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let Some(resolved) = php_qualified_to_path(q) else {
                continue;
            };
            import_count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
        }
        let mut sym = 0usize;
        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            let sym_info = PHP_CLASS_LIKE
                .captures(trimmed)
                .and_then(|c| c.get(1).map(|m| (m.as_str().to_string(), "class".to_string())))
                .or_else(|| {
                    PHP_FUNCTION.captures(trimmed).and_then(|c| {
                        c.get(1)
                            .map(|m| (m.as_str().to_string(), "function".to_string()))
                    })
                });
            let Some((name, kind)) = sym_info else {
                continue;
            };
            self.upsert_line_symbol(
                conn,
                file_node_id,
                repo_id,
                relative_path,
                line_idx,
                &name,
                &kind,
            )?;
            sym += 1;
        }
        Ok((sym, sym + import_count))
    }

    fn parse_swift_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let mut sym = 0usize;
        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            let sym_info = SWIFT_TYPE
                .captures(trimmed)
                .and_then(|c| c.get(1).map(|m| (m.as_str().to_string(), "class".to_string())))
                .or_else(|| {
                    SWIFT_FUNC.captures(trimmed).and_then(|c| {
                        c.get(1)
                            .map(|m| (m.as_str().to_string(), "function".to_string()))
                    })
                });
            let Some((name, kind)) = sym_info else {
                continue;
            };
            self.upsert_line_symbol(
                conn,
                file_node_id,
                repo_id,
                relative_path,
                line_idx,
                &name,
                &kind,
            )?;
            sym += 1;
        }
        Ok((sym, sym))
    }

    fn parse_dart_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let mut import_count = 0usize;
        let file_dir = relative_path.rsplit('/').nth(1).unwrap_or("");
        for cap in DART_IMPORT_EXPORT.captures_iter(content) {
            let p = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            if p.starts_with("dart:") || p.starts_with("package:") {
                continue;
            }
            if !p.starts_with('.') && !p.contains('/') {
                continue;
            }
            let resolved = resolve_import_path(file_dir, p, relative_path);
            import_count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
        }
        let mut sym = 0usize;
        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            let Some(c) = DART_CLASS_MIXIN.captures(trimmed) else {
                continue;
            };
            let Some(name) = c.get(1).map(|m| m.as_str()) else {
                continue;
            };
            self.upsert_line_symbol(
                conn,
                file_node_id,
                repo_id,
                relative_path,
                line_idx,
                name,
                "class",
            )?;
            sym += 1;
        }
        Ok((sym, sym + import_count))
    }

    fn parse_cpp_family_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let mut import_count = 0usize;
        let file_dir = relative_path.rsplit('/').nth(1).unwrap_or("");
        for cap in CPP_INCLUDE_LOCAL.captures_iter(content) {
            let p = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let resolved = resolve_import_path(file_dir, p, relative_path);
            import_count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
        }
        Ok((0, import_count))
    }

    fn parse_properties_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let mut count = 0usize;
        let mut seen = HashSet::<String>::new();
        for cap in SPRING_CONFIG_IMPORT_PROP.captures_iter(content) {
            let raw_line = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            for part in raw_line.split(',') {
                let tok = part.trim();
                if tok.is_empty() {
                    continue;
                }
                let Some(target) = spring_resolve_config_import_token(relative_path, tok) else {
                    continue;
                };
                if !seen.insert(target.clone()) {
                    continue;
                }
                count += self.add_import_edge(conn, file_node_id, repo_id, &target)?;
            }
        }
        Ok((0, count))
    }

    fn parse_xml_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let mut count = 0usize;
        let parent = file_parent_dir(relative_path);
        for modname in collect_maven_module_rel_paths(content) {
            let sub = path_join(&parent, &modname);
            let target = path_join(&sub, "pom.xml");
            count += self.add_import_edge(conn, file_node_id, repo_id, &target)?;
        }
        for cap in XML_SPRING_IMPORT.captures_iter(content) {
            let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let Some(resolved) = spring_resolve_config_import_token(relative_path, raw) else {
                continue;
            };
            count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
        }
        Ok((0, count))
    }

    fn parse_gradle_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let mut count = 0usize;
        let file_dir = relative_path.rsplit('/').nth(1).unwrap_or("");
        let parent = file_parent_dir(relative_path);
        for cap in GRADLE_APPLY_FROM.captures_iter(content) {
            let raw = cap
                .get(1)
                .or_else(|| cap.get(2))
                .map(|m| m.as_str())
                .unwrap_or("")
                .trim();
            if raw.is_empty() {
                continue;
            }
            let resolved = if raw.starts_with('.') {
                resolve_import_path(file_dir, raw, relative_path)
            } else {
                path_join(&parent, raw.trim_start_matches('/'))
            };
            count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
        }
        Ok((0, count))
    }

    fn extract_rust_imports(
        &self,
        conn: &rusqlite::Connection,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
    ) -> Result<usize, String> {
        let mut count = 0;

        for cap in RUST_MOD_SEMI.captures_iter(content) {
            let Some(name) = cap.get(1).map(|m| m.as_str()) else {
                continue;
            };
            let resolved = rust_mod_child_rs_path(relative_path, name);
            count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
        }

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            let Some(after_use) = rust_after_use_keyword(trimmed) else {
                continue;
            };
            let head = rust_use_head_path(after_use);
            let head = rust_strip_use_alias(head);
            if head.contains("::*") {
                continue;
            }
            if let Some((root, mut segs)) = parse_rust_use_prefix_path(head) {
                rust_trim_use_path_type_suffix(&mut segs);
                if segs.is_empty() {
                    continue;
                }
                let resolved_opt = match root {
                    RustUseRoot::Crate => rust_crate_src_dir(relative_path)
                        .and_then(|src| rust_chunks_to_rs_path_under(&src, &segs)),
                    RustUseRoot::Super => rust_super_module_base(relative_path)
                        .and_then(|parent| rust_chunks_to_rs_path_under(&parent, &segs)),
                };
                let Some(resolved) = resolved_opt else {
                    continue;
                };
                count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
            }
        }

        Ok(count)
    }

    fn extract_rust_symbols(
        &self,
        conn: &rusqlite::Connection,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
    ) -> Result<usize, String> {
        let mut count = 0;

        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }

            let sym = RUST_FN_LINE
                .captures(trimmed)
                .and_then(|c| c.get(1).map(|m| (m.as_str().to_string(), "function".to_string())))
                .or_else(|| {
                    RUST_STRUCT_LINE.captures(trimmed).and_then(|c| {
                        c.get(1)
                            .map(|m| (m.as_str().to_string(), "struct".to_string()))
                    })
                })
                .or_else(|| {
                    RUST_ENUM_LINE.captures(trimmed).and_then(|c| {
                        c.get(1).map(|m| (m.as_str().to_string(), "enum".to_string()))
                    })
                })
                .or_else(|| {
                    RUST_TRAIT_LINE.captures(trimmed).and_then(|c| {
                        c.get(1).map(|m| (m.as_str().to_string(), "trait".to_string()))
                    })
                })
                .or_else(|| {
                    RUST_TYPE_LINE.captures(trimmed).and_then(|c| {
                        c.get(1).map(|m| (m.as_str().to_string(), "type".to_string()))
                    })
                })
                .or_else(|| {
                    RUST_MOD_INLINE.captures(trimmed).and_then(|c| {
                        c.get(1).map(|m| (m.as_str().to_string(), "mod".to_string()))
                    })
                });

            let Some((name, kind)) = sym else {
                continue;
            };

            let symbol_id = format!("{file_node_id}:symbol:{name}");
            self.commit_code_symbol(
                conn,
                file_node_id,
                repo_id,
                relative_path,
                &name,
                &kind,
                &symbol_id,
                line_idx,
                None,
                None,
            )?;
            count += 1;
        }

        Ok(count)
    }

    fn extract_json_yaml_refs(
        &self,
        conn: &rusqlite::Connection,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
    ) -> Result<usize, String> {
        let mut count = 0;
        let file_dir = relative_path.rsplit('/').nth(1).unwrap_or("");

        let mut seen = std::collections::HashSet::<String>::new();

        for cap in REF_DOLLAR_QUOTED.captures_iter(content) {
            let Some(raw) = cap.get(1).map(|m| m.as_str()) else {
                continue;
            };
            let path = ref_strip_fragment(raw);
            if !ref_is_file_like(path) {
                continue;
            }
            if !seen.insert(path.to_string()) {
                continue;
            }
            let resolved = resolve_import_path(file_dir, path, relative_path);
            count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
        }

        for cap in REF_YAML_UNQUOTED.captures_iter(content) {
            let Some(raw) = cap.get(1).map(|m| m.as_str()) else {
                continue;
            };
            let path = ref_strip_fragment(raw);
            if !ref_is_file_like(path) {
                continue;
            }
            if !seen.insert(path.to_string()) {
                continue;
            }
            let resolved = resolve_import_path(file_dir, path, relative_path);
            count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
        }

        Ok(count)
    }

    pub(crate) fn add_import_edge(
        &self,
        conn: &rusqlite::Connection,
        file_node_id: &str,
        repo_id: i64,
        resolved: &str,
    ) -> Result<usize, String> {
        let import_id = format!("{file_node_id}:imports:{resolved}");
        let target_id = super::indexer::make_file_node_id(repo_id, resolved);
        graph_storage::upsert_edge(conn, &import_id, file_node_id, &target_id, "imports")?;
        Ok(1)
    }

    fn extract_java_imports(
        &self,
        conn: &rusqlite::Connection,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        _relative_path: &str,
        dedup: &mut HashSet<String>,
        use_dedup: bool,
        populate_import_simple_map: bool,
        import_simple_map: &mut HashMap<String, String>,
    ) -> Result<usize, String> {
        let mut count = 0;

        for cap in JAVA_IMPORT.captures_iter(content) {
            let Some(q) = cap.get(1).map(|m| m.as_str()) else {
                continue;
            };
            if q.ends_with(".*") || q.ends_with('.') {
                continue;
            }
            let Some(resolved) = java_qualified_to_relative_path(q) else {
                continue;
            };
            if is_bare_java_module(q) {
                continue;
            }
            if populate_import_simple_map {
                crate::code_knowledge_graph::java_tree_extract::record_java_import_simple_name(
                    q,
                    &resolved,
                    import_simple_map,
                );
            }
            if use_dedup && !dedup.insert(resolved.clone()) {
                continue;
            }
            count += self.add_import_edge(conn, file_node_id, repo_id, &resolved)?;
        }

        Ok(count)
    }

    fn extract_java_symbols(
        &self,
        conn: &rusqlite::Connection,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
    ) -> Result<usize, String> {
        let mut count = 0;

        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }

            let Some(caps) = JAVA_TYPE_DECL.captures(line) else {
                continue;
            };
            let Some(kind_m) = caps.get(1) else {
                continue;
            };
            let Some(name_m) = caps.get(2) else {
                continue;
            };
            let kind = kind_m.as_str().to_string();
            let name = name_m.as_str().to_string();

            let symbol_id = format!("{file_node_id}:symbol:{name}");
            self.commit_code_symbol(
                conn,
                file_node_id,
                repo_id,
                relative_path,
                &name,
                &kind,
                &symbol_id,
                line_idx,
                None,
                None,
            )?;
            count += 1;
        }

        Ok(count)
    }

    fn extract_symbols_regex(
        &self,
        conn: &rusqlite::Connection,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        line_offset: usize,
    ) -> Result<usize, String> {
        let mut count = 0usize;
        let mut balance: i32 = 0;
        let mut stack: Vec<(String, i32, bool)> = Vec::new();
        let mut pending_type: Option<(String, String)> = None;

        for (line_idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            let global_line = line_idx + line_offset;
            let work = strip_js_line_comment(line);
            let bal_start = balance;

            let head = TS_EXPORT_CLASS_OR_INTERFACE
                .captures(trimmed)
                .and_then(|c| Some((c.get(1)?.as_str().to_string(), c.get(2)?.as_str().to_string())))
                .or_else(|| {
                    TS_PLAIN_CLASS_OR_INTERFACE.captures(trimmed).and_then(|c| {
                        Some((c.get(1)?.as_str().to_string(), c.get(2)?.as_str().to_string()))
                    })
                });

            if head.is_none() {
                if let Some((k, n)) = pending_type.take() {
                    if work.contains('{') {
                        let delta = naive_brace_delta(work);
                        balance += delta;
                        stack.push((n.clone(), balance, k == "interface"));
                        pop_scope_stack(&mut stack, balance);
                        continue;
                    }
                    pending_type = Some((k, n));
                }
            } else {
                pending_type = None;
            }

            if let Some((k, n)) = head {
                let type_symbol_id = format!("{file_node_id}:symbol:{n}");
                self.commit_code_symbol(
                    conn,
                    file_node_id,
                    repo_id,
                    relative_path,
                    &n,
                    &k,
                    &type_symbol_id,
                    global_line,
                    None,
                    None,
                )?;
                count += 1;
                if work.contains('{') {
                    let delta = naive_brace_delta(work);
                    balance += delta;
                    stack.push((n.clone(), balance, k == "interface"));
                } else {
                    pending_type = Some((k, n));
                }
                pop_scope_stack(&mut stack, balance);
                continue;
            }

            if let Some((type_name, entry_bal, is_iface)) = stack.last() {
                if bal_start >= *entry_bal {
                    let enc_id = format!("{file_node_id}:symbol:{type_name}");
                    let mut member_hit = false;
                    if *is_iface {
                        if let Some(c) = TS_INTERFACE_METHOD_LINE.captures(trimmed) {
                            if let Some(m) = c.get(1) {
                                let mname = m.as_str();
                                if !ts_reserved_method_name(mname) {
                                    let mid = format!("{file_node_id}:symbol:{type_name}::{mname}");
                                    self.commit_code_symbol(
                                        conn,
                                        file_node_id,
                                        repo_id,
                                        relative_path,
                                        mname,
                                        "method",
                                        &mid,
                                        global_line,
                                        Some(enc_id.as_str()),
                                        Some("has_method"),
                                    )?;
                                    count += 1;
                                    member_hit = true;
                                }
                            }
                        }
                    }
                    if !member_hit {
                        if let Some(c) = TS_MEMBER_METHOD_LINE.captures(trimmed) {
                            if let Some(m) = c.get(1) {
                                let mname = m.as_str();
                                if !ts_reserved_method_name(mname) {
                                    let mid = format!("{file_node_id}:symbol:{type_name}::{mname}");
                                    self.commit_code_symbol(
                                        conn,
                                        file_node_id,
                                        repo_id,
                                        relative_path,
                                        mname,
                                        "method",
                                        &mid,
                                        global_line,
                                        Some(enc_id.as_str()),
                                        Some("has_method"),
                                    )?;
                                    count += 1;
                                    member_hit = true;
                                }
                            }
                        }
                    }
                    if !member_hit {
                        if let Some(c) = TS_MEMBER_PROPERTY_LINE.captures(trimmed) {
                            if let Some(p) = c.get(1) {
                                let pname = p.as_str();
                                if !ts_reserved_method_name(pname) {
                                    let pid = format!("{file_node_id}:symbol:{type_name}::{pname}");
                                    self.commit_code_symbol(
                                        conn,
                                        file_node_id,
                                        repo_id,
                                        relative_path,
                                        pname,
                                        "property",
                                        &pid,
                                        global_line,
                                        Some(enc_id.as_str()),
                                        Some("has_property"),
                                    )?;
                                    count += 1;
                                }
                            }
                        }
                    }
                }
            }

            let mut symbol_info = None;
            if stack.is_empty() && pending_type.is_none() {
                if trimmed.starts_with("export function ")
                    || trimmed.starts_with("export async function ")
                {
                    symbol_info = extract_symbol_name_after_keyword(trimmed, "function");
                } else if trimmed.starts_with("function ") {
                    symbol_info = extract_symbol_name_after_keyword(trimmed, "function");
                } else if (trimmed.starts_with("export const ") || trimmed.starts_with("export let "))
                    && (trimmed.contains(" = (") || trimmed.contains(" = function"))
                {
                    symbol_info = extract_const_name(trimmed);
                }
            }

            if let Some((name, kind)) = symbol_info {
                let symbol_id = format!("{file_node_id}:symbol:{name}");
                self.commit_code_symbol(
                    conn,
                    file_node_id,
                    repo_id,
                    relative_path,
                    &name,
                    &kind,
                    &symbol_id,
                    global_line,
                    None,
                    None,
                )?;
                count += 1;
            }

            let delta = naive_brace_delta(work);
            balance += delta;
            pop_scope_stack(&mut stack, balance);
        }

        Ok(count)
    }

    fn extract_imports(
        &self,
        conn: &rusqlite::Connection,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
    ) -> Result<usize, String> {
        let mut count = 0;
        let file_dir = relative_path.rsplit('/').nth(1).unwrap_or("");

        for line in content.lines() {
            let trimmed = line.trim();

            if !trimmed.starts_with("import ") && !trimmed.starts_with("export ") {
                continue;
            }

            let mut import_path = None;

            if let Some(from_pos) = trimmed.find("from ") {
                let after_from = &trimmed[from_pos + 5..];
                if let Some(p) = extract_first_quoted_string(after_from) {
                    import_path = Some(p);
                }
            }

            if import_path.is_none() {
                if let Some(p) = extract_first_quoted_string(trimmed) {
                    if !p.contains(' ') && !p.starts_with("type") && !p.starts_with("interface") {
                        import_path = Some(p);
                    }
                }
            }

            if let Some(import_path) = import_path {
                let Some(resolved) = resolve_ts_js_import_to_repo_relative(
                    file_dir,
                    &import_path,
                    relative_path,
                    self.tsconfig_paths.as_ref(),
                    &self.repo_files,
                ) else {
                    continue;
                };
                let import_id = format!("{file_node_id}:imports:{resolved}");
                let target_id = super::indexer::make_file_node_id(repo_id, &resolved);

                graph_storage::upsert_edge(
                    conn,
                    &import_id,
                    file_node_id,
                    &target_id,
                    "imports",
                )?;
                count += 1;
            }
        }

        Ok(count)
    }

    /// 单行 / 简单 `import` / `export … from` 绑定名 → 已解析的仓库相对路径（供 TS/JS `calls` 对齐 GitNexus）。
    pub(crate) fn collect_ts_js_import_bindings(
        &self,
        content: &str,
        relative_path: &str,
    ) -> HashMap<String, String> {
        let mut map = HashMap::new();
        let file_dir = file_parent_dir(relative_path);
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with("//") {
                continue;
            }
            if trimmed.starts_with("import type ") || trimmed.starts_with("export type ") {
                continue;
            }

            let mut import_path = None;
            if let Some(from_pos) = trimmed.find("from ") {
                let after_from = &trimmed[from_pos + 5..];
                if let Some(p) = extract_first_quoted_string(after_from) {
                    import_path = Some(p);
                }
            }
            if import_path.is_none() {
                if let Some(p) = extract_first_quoted_string(trimmed) {
                    if !p.contains(' ') && !p.starts_with("type") && !p.starts_with("interface") {
                        import_path = Some(p);
                    }
                }
            }
            let Some(import_path) = import_path else {
                continue;
            };
            let Some(resolved) = resolve_ts_js_import_to_repo_relative(
                &file_dir,
                &import_path,
                relative_path,
                self.tsconfig_paths.as_ref(),
                &self.repo_files,
            ) else {
                continue;
            };

            if let Some(c) = TS_IMPORT_STAR_AS.captures(trimmed) {
                if let Some(m) = c.get(1) {
                    map.insert(m.as_str().to_string(), resolved.clone());
                }
                continue;
            }
            if let Some(c) = TS_IMPORT_DEFAULT_AND_NAMED.captures(trimmed) {
                if let Some(m) = c.get(1) {
                    map.insert(m.as_str().to_string(), resolved.clone());
                }
                if let Some(inner) = c.get(2).map(|x| x.as_str()) {
                    for name in parse_ts_js_named_import_spec_list(inner) {
                        map.insert(name, resolved.clone());
                    }
                }
                continue;
            }
            if let Some(c) = TS_IMPORT_BRACE_ONLY.captures(trimmed) {
                if let Some(inner) = c.get(1).map(|x| x.as_str()) {
                    for name in parse_ts_js_named_import_spec_list(inner) {
                        map.insert(name, resolved.clone());
                    }
                }
                continue;
            }
            if let Some(c) = TS_IMPORT_DEFAULT_FROM.captures(trimmed) {
                if let Some(m) = c.get(1) {
                    map.insert(m.as_str().to_string(), resolved.clone());
                }
                continue;
            }
            if let Some(c) = TS_EXPORT_BRACE_FROM.captures(trimmed) {
                if let Some(inner) = c.get(1).map(|x| x.as_str()) {
                    for name in parse_ts_js_named_import_spec_list(inner) {
                        map.insert(name, resolved.clone());
                    }
                }
            }
        }
        map
    }
}

fn parse_ts_js_named_import_spec_list(inner: &str) -> Vec<String> {
    let mut out = Vec::new();
    for part in inner.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if part.starts_with("type ") {
            continue;
        }
        let local = if let Some(i) = part.rfind(" as ") {
            part[i + 4..].trim()
        } else {
            part
        };
        let local = local.trim();
        if local.is_empty() || local == "type" {
            continue;
        }
        out.push(local.to_string());
    }
    out
}

static TS_IMPORT_STAR_AS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*import\s+\*\s+as\s+([\w$]+)\s+from\s+").expect("ts import * as")
});
static TS_IMPORT_DEFAULT_AND_NAMED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*import\s+([\w$]+)\s*,\s*\{([^}]*)\}\s+from\s+").expect("ts import default+named")
});
static TS_IMPORT_BRACE_ONLY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*import\s*\{([^}]*)\}\s+from\s+").expect("ts import brace"));
static TS_IMPORT_DEFAULT_FROM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*import\s+(?!type)([\w$]+)\s+from\s+").expect("ts import default from")
});
static TS_EXPORT_BRACE_FROM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*export\s*\{([^}]*)\}\s+from\s+").expect("ts export brace from")
});

fn gitnexus_style_symbol_kind(raw: &str) -> String {
    match raw {
        "function" => "Function".to_string(),
        "class" => "Class".to_string(),
        "interface" => "Interface".to_string(),
        "struct" => "Struct".to_string(),
        "enum" => "Enum".to_string(),
        "trait" => "Trait".to_string(),
        "type" => "TypeAlias".to_string(),
        "mod" => "Module".to_string(),
        "method" => "Method".to_string(),
        "property" => "Property".to_string(),
        "const" => "Constant".to_string(),
        "variable" => "Variable".to_string(),
        "annotation" => "Annotation".to_string(),
        "constructor" => "Constructor".to_string(),
        "record" => "Class".to_string(),
        "object" => "Class".to_string(),
        "module" => "Module".to_string(),
        _ => {
            let mut ch = raw.chars();
            match ch.next() {
                None => raw.to_string(),
                Some(f) => f.to_uppercase().chain(ch).collect(),
            }
        }
    }
}

fn strip_js_line_comment(line: &str) -> &str {
    line.split("//").next().unwrap_or(line).trim_end()
}

fn naive_brace_delta(line: &str) -> i32 {
    let s = strip_js_line_comment(line);
    let opens = s.chars().filter(|&c| c == '{').count() as i32;
    let closes = s.chars().filter(|&c| c == '}').count() as i32;
    opens - closes
}

fn ts_reserved_method_name(name: &str) -> bool {
    matches!(
        name,
        "if" | "for" | "while" | "switch" | "catch" | "function" | "return" | "with" | "new"
            | "case" | "typeof" | "throw" | "try" | "else" | "import" | "export" | "do" | "super"
    )
}

fn pop_scope_stack(stack: &mut Vec<(String, i32, bool)>, balance: i32) {
    while let Some((_, entry_bal, _)) = stack.last() {
        if balance < *entry_bal {
            stack.pop();
        } else {
            break;
        }
    }
}

enum RustUseRoot {
    Crate,
    Super,
}

fn path_join(dir: &str, rel: &str) -> String {
    if dir.is_empty() {
        rel.to_string()
    } else {
        format!("{dir}/{rel}")
    }
}

fn file_parent_dir(relative_path: &str) -> String {
    relative_path
        .replace('\\', "/")
        .rsplit_once('/')
        .map(|(a, _)| a.to_string())
        .unwrap_or_default()
}

fn strip_xml_comments(s: &str) -> String {
    XML_COMMENT.replace_all(s, "").to_string()
}

fn normalize_maven_module_inner(inner: &str) -> String {
    let t = inner.trim();
    if let Some(rest) = t.strip_prefix("<![CDATA[") {
        if let Some(end) = rest.find("]]>") {
            return rest[..end]
                .trim()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
        }
    }
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Relative submodule directory paths from `<modules>` (aggregator POM), deduplicated in document order.
fn collect_maven_module_rel_paths(content: &str) -> Vec<String> {
    let clean = strip_xml_comments(content);
    let mut out = Vec::new();
    let mut seen = HashSet::<String>::new();
    for cap in MAVEN_MODULE.captures_iter(&clean) {
        let inner = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let p = normalize_maven_module_inner(inner);
        if p.is_empty() {
            continue;
        }
        if seen.insert(p.clone()) {
            out.push(p);
        }
    }
    out
}

fn maven_resources_prefix(relative_path: &str) -> Option<String> {
    let p = relative_path.replace('\\', "/");
    if let Some(i) = p.find("/src/main/resources/") {
        Some(p[..i + "/src/main/resources".len()].to_string())
    } else if let Some(i) = p.find("/src/test/resources/") {
        Some(p[..i + "/src/test/resources".len()].to_string())
    } else {
        None
    }
}

fn spring_strip_resource_value(s: &str) -> String {
    let mut t = s.trim().to_string();
    const PFX: &[&str] = &["optional:", "file:", "classpath*:", "classpath:"];
    for _ in 0..4 {
        let lower = t.to_ascii_lowercase();
        let mut matched = false;
        for p in PFX {
            if lower.starts_with(p) {
                t = t[p.len()..].trim().to_string();
                matched = true;
                break;
            }
        }
        if !matched {
            break;
        }
    }
    t.trim_matches(|c| c == '"' || c == '\'').trim().to_string()
}

fn spring_resolve_config_import_token(relative_path: &str, raw_tok: &str) -> Option<String> {
    let l = raw_tok.trim().to_ascii_lowercase();
    let parent = file_parent_dir(relative_path);
    let file_dir = relative_path.rsplit('/').nth(1).unwrap_or("");
    if l.contains("classpath:") || l.contains("classpath*:") {
        let stripped = spring_strip_resource_value(raw_tok);
        let rest = stripped.trim_start_matches('/');
        if let Some(prefix) = maven_resources_prefix(relative_path) {
            return Some(path_join(&prefix, rest));
        }
        return Some(path_join(&parent, rest));
    }
    if l.contains("://") && !l.starts_with("file:") {
        return None;
    }
    let path_part = spring_strip_resource_value(raw_tok);
    if path_part.is_empty() {
        return None;
    }
    if path_part.starts_with("./") || path_part.starts_with("../") || path_part.starts_with('.') {
        return Some(resolve_import_path(file_dir, &path_part, relative_path));
    }
    if path_part.contains('/') && !path_part.contains(':') {
        return Some(path_join(&parent, path_part.trim_start_matches('/')));
    }
    None
}

fn php_qualified_to_path(q: &str) -> Option<String> {
    let parts: Vec<&str> = q.split('\\').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }
    let mut segs = parts;
    if let Some(last) = segs.last() {
        if last.chars().next().map(|c| c.is_lowercase()).unwrap_or(false) {
            segs.pop();
        }
    }
    if segs.is_empty() {
        return None;
    }
    Some(format!("{}.php", segs.join("/")))
}

fn rust_child_module_base(relative_path: &str) -> String {
    let path = relative_path.replace('\\', "/");
    let (dir, file) = match path.rsplit_once('/') {
        Some((d, f)) => (d, f),
        None => ("", path.as_str()),
    };
    if file == "lib.rs" || file == "main.rs" {
        dir.to_string()
    } else if file == "mod.rs" {
        dir.to_string()
    } else {
        let stem = file.strip_suffix(".rs").unwrap_or(file);
        if dir.is_empty() {
            stem.to_string()
        } else {
            path_join(dir, stem)
        }
    }
}

fn rust_super_module_base(relative_path: &str) -> Option<String> {
    let b = rust_child_module_base(relative_path);
    b.rsplit_once('/')
        .map(|(p, _)| p.to_string())
        .filter(|s| !s.is_empty())
}

fn rust_crate_src_dir(relative_path: &str) -> Option<String> {
    let p = relative_path.replace('\\', "/");
    if let Some(pos) = p.find("/src/") {
        Some(path_join(&p[..pos], "src"))
    } else if p.starts_with("src/") {
        Some("src".to_string())
    } else {
        None
    }
}

fn rust_mod_child_rs_path(relative_path: &str, mod_name: &str) -> String {
    let base = rust_child_module_base(relative_path);
    path_join(&base, &format!("{mod_name}.rs"))
}

fn rust_after_use_keyword(line: &str) -> Option<&str> {
    let t = line.trim();
    t.find("use ").map(|pos| t[pos + 4..].trim_start())
}

fn rust_use_head_path(s: &str) -> &str {
    let s = s.trim();
    let end = s.find('{').unwrap_or(s.len());
    s[..end].split(';').next().unwrap_or(s).trim()
}

fn rust_strip_use_alias(s: &str) -> &str {
    s.split(" as ").next().unwrap_or(s).trim()
}

fn parse_rust_use_prefix_path(s: &str) -> Option<(RustUseRoot, Vec<&str>)> {
    let s = s.trim();
    if let Some(rest) = s.strip_prefix("crate::") {
        Some((RustUseRoot::Crate, rust_path_segments(rest)))
    } else if let Some(rest) = s.strip_prefix("super::") {
        Some((RustUseRoot::Super, rust_path_segments(rest)))
    } else {
        None
    }
}

fn rust_path_segments(s: &str) -> Vec<&str> {
    s.split("::")
        .map(str::trim)
        .filter(|p| {
            !p.is_empty()
                && *p != "self"
                && *p != "crate"
                && *p != "*"
        })
        .collect()
}

fn rust_trim_use_path_type_suffix(segments: &mut Vec<&str>) {
    if segments.len() >= 2 {
        if let Some(last) = segments.last() {
            if last
                .chars()
                .next()
                .map(|c| c.is_uppercase())
                .unwrap_or(false)
            {
                segments.pop();
            }
        }
    }
}

fn rust_chunks_to_rs_path_under(dir_base: &str, chunks: &[&str]) -> Option<String> {
    if chunks.is_empty() {
        return None;
    }
    Some(path_join(dir_base, &format!("{}.rs", chunks.join("/"))))
}

fn ref_strip_fragment(s: &str) -> &str {
    s.split('#').next().unwrap_or(s).trim()
}

fn ref_is_file_like(s: &str) -> bool {
    let t = s.trim();
    if t.is_empty() || t.starts_with('#') {
        return false;
    }
    if t.contains("://") {
        return false;
    }
    t.starts_with("./")
        || t.starts_with("../")
        || t.starts_with('.')
        || t.contains('/')
        || t.ends_with(".yaml")
        || t.ends_with(".yml")
        || t.ends_with(".json")
        || t.ends_with(".rs")
        || t.ends_with(".xml")
        || t.ends_with(".properties")
        || t.ends_with(".gradle")
        || t.ends_with(".py")
        || t.ends_with(".php")
        || t.ends_with(".kt")
        || t.ends_with(".kts")
        || t.ends_with(".cs")
        || t.ends_with(".go")
        || t.ends_with(".swift")
        || t.ends_with(".dart")
}

fn byte_offset_to_line_number(content: &str, byte_idx: usize) -> usize {
    let end = byte_idx.min(content.len());
    content[..end].chars().filter(|&c| c == '\n').count()
}

/// `package com.example.foo;` → `Some("com.example.foo")`
pub(crate) fn java_package_declaration(content: &str) -> Option<String> {
    JAVA_PACKAGE_DECL
        .captures(content)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

/// Maps `com.foo.Bar` or `com.foo.Bar.Inner` to a repo-relative `com/foo/Bar.java` path.
pub(crate) fn java_qualified_to_relative_path(qualified: &str) -> Option<String> {
    if qualified.is_empty() || qualified.contains('*') {
        return None;
    }
    let mut parts: Vec<&str> = qualified.split('.').collect();
    if parts.is_empty() {
        return None;
    }

    if let Some(last) = parts.last() {
        if last
            .chars()
            .next()
            .map(|c| c.is_lowercase())
            .unwrap_or(false)
        {
            parts.pop();
        }
    }

    while parts.len() >= 2 {
        let last = parts[parts.len() - 1];
        let prev = parts[parts.len() - 2];
        let last_uc = last
            .chars()
            .next()
            .map(|c| c.is_uppercase())
            .unwrap_or(false);
        let prev_uc = prev
            .chars()
            .next()
            .map(|c| c.is_uppercase())
            .unwrap_or(false);
        if last_uc && prev_uc {
            parts.pop();
        } else {
            break;
        }
    }

    if parts.is_empty() {
        return None;
    }
    Some(format!("{}.java", parts.join("/")))
}

/// Skip JDK and other unqualified single-segment imports (none exist as file paths).
pub(crate) fn is_bare_java_module(qualified: &str) -> bool {
    !qualified.contains('.')
}

fn extract_symbol_name_after_keyword(line: &str, keyword: &str) -> Option<(String, String)> {
    let after_keyword = line.split(keyword).nth(1)?;
    let trimmed = after_keyword.trim_start();
    let name: String = trimmed
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if name.is_empty() || name.chars().next()?.is_numeric() {
        return None;
    }
    let kind = keyword.to_string();
    Some((name, kind))
}

fn extract_const_name(line: &str) -> Option<(String, String)> {
    let after_const = line.split("const ").nth(1)?;
    let after_const = after_const.split("let ").last()?;
    let name: String = after_const
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if name.is_empty() {
        return None;
    }
    Some((name, "function".to_string()))
}

fn extract_first_quoted_string(s: &str) -> Option<String> {
    let start_pos = s.find(|c: char| c == '\'' || c == '"')?;
    let quote_char = s.chars().nth(start_pos)?;

    let rest = &s[start_pos + 1..];
    let end_pos = rest.find(quote_char)?;

    Some(rest[..end_pos].to_string())
}

fn is_bare_module(path: &str) -> bool {
    !path.starts_with('.') && !path.starts_with('/')
}

fn importer_default_extension(relative_path: &str) -> &'static str {
    let norm = relative_path.replace('\\', "/");
    if norm.ends_with(".gradle.kts") {
        return "gradle";
    }
    let ext = relative_path
        .rsplit_once('.')
        .map(|(_, e)| e)
        .unwrap_or("");
    if ext.eq_ignore_ascii_case("vue") {
        "vue"
    } else if ext.eq_ignore_ascii_case("java") {
        "java"
    } else if ext.eq_ignore_ascii_case("yaml") || ext.eq_ignore_ascii_case("yml") {
        "yaml"
    } else if ext.eq_ignore_ascii_case("json") {
        "json"
    } else if ext.eq_ignore_ascii_case("rs") {
        "rs"
    } else if ext.eq_ignore_ascii_case("py") {
        "py"
    } else if ext.eq_ignore_ascii_case("go") {
        "go"
    } else if ext.eq_ignore_ascii_case("cs") {
        "cs"
    } else if ext.eq_ignore_ascii_case("kt") || ext.eq_ignore_ascii_case("kts") {
        "kt"
    } else if ext.eq_ignore_ascii_case("swift") {
        "swift"
    } else if ext.eq_ignore_ascii_case("dart") {
        "dart"
    } else if ext.eq_ignore_ascii_case("php")
        || ext.eq_ignore_ascii_case("phtml")
        || ext.eq_ignore_ascii_case("php3")
        || ext.eq_ignore_ascii_case("php4")
        || ext.eq_ignore_ascii_case("php5")
        || ext.eq_ignore_ascii_case("php8")
    {
        "php"
    } else if ext.eq_ignore_ascii_case("properties") {
        "properties"
    } else if ext.eq_ignore_ascii_case("xml") {
        "xml"
    } else if ext.eq_ignore_ascii_case("gradle") {
        "gradle"
    } else if ext.eq_ignore_ascii_case("c")
        || ext.eq_ignore_ascii_case("h")
        || ext.eq_ignore_ascii_case("cc")
        || ext.eq_ignore_ascii_case("cpp")
        || ext.eq_ignore_ascii_case("cxx")
        || ext.eq_ignore_ascii_case("hh")
        || ext.eq_ignore_ascii_case("hpp")
        || ext.eq_ignore_ascii_case("hxx")
    {
        "h"
    } else if ext.eq_ignore_ascii_case("js") || ext.eq_ignore_ascii_case("jsx") {
        "js"
    } else {
        "ts"
    }
}

fn has_known_module_suffix(path: &str) -> bool {
    path.ends_with(".ts")
        || path.ends_with(".tsx")
        || path.ends_with(".js")
        || path.ends_with(".jsx")
        || path.ends_with(".mjs")
        || path.ends_with(".cjs")
        || path.ends_with(".mts")
        || path.ends_with(".cts")
        || path.ends_with(".vue")
        || path.ends_with(".java")
        || path.ends_with(".rs")
        || path.ends_with(".yaml")
        || path.ends_with(".yml")
        || path.ends_with(".json")
        || path.ends_with(".py")
        || path.ends_with(".go")
        || path.ends_with(".cs")
        || path.ends_with(".kt")
        || path.ends_with(".kts")
        || path.ends_with(".swift")
        || path.ends_with(".dart")
        || path.ends_with(".php")
        || path.ends_with(".phtml")
        || path.ends_with(".xml")
        || path.ends_with(".properties")
        || path.ends_with(".gradle")
        || path.ends_with(".c")
        || path.ends_with(".h")
        || path.ends_with(".cc")
        || path.ends_with(".cpp")
        || path.ends_with(".cxx")
        || path.ends_with(".hh")
        || path.ends_with(".hpp")
        || path.ends_with(".hxx")
        || path.ends_with("/index.ts")
        || path.ends_with("/index.tsx")
        || path.ends_with("/index.js")
        || path.ends_with("/index.jsx")
        || path.ends_with("/index.mjs")
        || path.ends_with("/index.cjs")
        || path.ends_with("/index.vue")
        || path.ends_with("/index.yaml")
        || path.ends_with("/index.yml")
        || path.ends_with("/index.json")
        || path.ends_with("/index.py")
        || path.ends_with("/index.go")
        || path.ends_with("/index.cs")
        || path.ends_with("/index.kt")
        || path.ends_with("/index.php")
        || path.ends_with("/index.xml")
}

fn resolve_import_path(current_dir: &str, import_path: &str, relative_path: &str) -> String {
    if import_path.starts_with('.') {
        let mut parts: Vec<&str> = if !current_dir.is_empty() {
            current_dir.split('/').collect()
        } else {
            vec![]
        };

        for component in import_path.split('/') {
            match component {
                ".." => {
                    parts.pop();
                }
                "." => {}
                name => parts.push(name),
            }
        }

        let mut resolved = parts.join("/");
        if !has_known_module_suffix(&resolved) {
            let ext = importer_default_extension(relative_path);
            resolved = format!("{resolved}.{ext}");
        }
        resolved
    } else {
        import_path.to_string()
    }
}

/// GitNexus `import-resolvers/utils.ts` — extension probe order for TS/JS (+ Vue / index barrels).
const TS_JS_REPO_RESOLVE_EXTENSIONS: &[&str] = &[
    "",
    ".tsx",
    ".ts",
    ".mts",
    ".cts",
    ".jsx",
    ".js",
    ".mjs",
    ".cjs",
    ".vue",
    "/index.tsx",
    "/index.ts",
    "/index.jsx",
    "/index.js",
];

fn join_relative_ts_import_parts(file_dir: &str, import_path: &str) -> String {
    let mut parts: Vec<&str> = if !file_dir.is_empty() {
        file_dir.split('/').collect()
    } else {
        vec![]
    };
    for component in import_path.split('/') {
        match component {
            ".." => {
                parts.pop();
            }
            "." => {}
            name => parts.push(name),
        }
    }
    parts.join("/")
}

fn normalize_posix_path(path: &str) -> String {
    let norm = path.replace('\\', "/");
    let mut stack: Vec<&str> = Vec::new();
    for part in norm.split('/').filter(|s| !s.is_empty() && *s != ".") {
        if part == ".." {
            stack.pop();
        } else {
            stack.push(part);
        }
    }
    stack.join("/")
}

fn strip_js_family_extension_stem(path: &str) -> Option<String> {
    path.strip_suffix(".jsx")
        .or_else(|| path.strip_suffix(".js"))
        .or_else(|| path.strip_suffix(".mjs"))
        .or_else(|| path.strip_suffix(".cjs"))
        .map(|s| s.to_string())
}

fn try_resolve_ts_js_in_repo(base: &str, repo_files: &HashSet<String>) -> Option<String> {
    if repo_files.is_empty() {
        return None;
    }
    let norm = normalize_posix_path(base);
    for ext in TS_JS_REPO_RESOLVE_EXTENSIONS {
        let candidate = format!("{norm}{ext}");
        if repo_files.contains(&candidate) {
            return Some(candidate);
        }
    }
    if let Some(stripped) = strip_js_family_extension_stem(&norm) {
        for ext in TS_JS_REPO_RESOLVE_EXTENSIONS {
            let candidate = format!("{stripped}{ext}");
            if repo_files.contains(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

/// TS/JS/Vue `<script>` 模块路径 → 仓库相对路径；与 GitNexus `loadTsconfigPaths` + `resolveImportPath` 行为对齐。
fn resolve_ts_js_import_to_repo_relative(
    file_dir: &str,
    import_path: &str,
    current_file: &str,
    tsconfig_paths: Option<&crate::code_knowledge_graph::tsconfig_paths::TsconfigPaths>,
    repo_files: &HashSet<String>,
) -> Option<String> {
    let p = import_path.trim();
    if p.is_empty() {
        return None;
    }

    if p.starts_with("./") || p.starts_with("../") {
        let joined = join_relative_ts_import_parts(file_dir, p);
        let norm = normalize_posix_path(&joined);
        if let Some(hit) = try_resolve_ts_js_in_repo(&norm, repo_files) {
            return Some(hit);
        }
        let legacy = resolve_import_path(file_dir, p, current_file);
        let norm_legacy = normalize_posix_path(&legacy);
        if let Some(hit) = try_resolve_ts_js_in_repo(&norm_legacy, repo_files) {
            return Some(hit);
        }
        return Some(legacy);
    }

    if let Some(ts) = tsconfig_paths {
        if let Some(rewritten) =
            crate::code_knowledge_graph::tsconfig_paths::rewrite_tsconfig_import(ts, p)
        {
            let norm = normalize_posix_path(&rewritten);
            if let Some(hit) = try_resolve_ts_js_in_repo(&norm, repo_files) {
                return Some(hit);
            }
            let mut guess = norm.clone();
            if !has_known_module_suffix(&guess) {
                let ext = importer_default_extension(current_file);
                guess = format!("{guess}.{ext}");
            }
            let guess_norm = normalize_posix_path(&guess);
            if let Some(hit) = try_resolve_ts_js_in_repo(&guess_norm, repo_files) {
                return Some(hit);
            }
            return Some(guess);
        }
    }

    if let Some(tail) = p.strip_prefix("@/").or_else(|| p.strip_prefix("~/")) {
        let tail = tail.trim_start_matches('/');
        if tail.is_empty() {
            return None;
        }
        let stem = normalize_posix_path(&format!("src/{tail}"));
        if let Some(hit) = try_resolve_ts_js_in_repo(&stem, repo_files) {
            return Some(hit);
        }
        let mut guess = stem.clone();
        if !has_known_module_suffix(&guess) {
            let ext = importer_default_extension(current_file);
            guess = format!("{guess}.{ext}");
        }
        if let Some(hit) = try_resolve_ts_js_in_repo(&normalize_posix_path(&guess), repo_files) {
            return Some(hit);
        }
        return Some(guess);
    }

    if is_bare_module(p) {
        return None;
    }
    Some(resolve_import_path(file_dir, p, current_file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn java_qualified_to_path_simple() {
        assert_eq!(
            java_qualified_to_relative_path("java.util.List"),
            Some("java/util/List.java".into())
        );
    }

    #[test]
    fn java_qualified_static_method_trailing_segment() {
        assert_eq!(
            java_qualified_to_relative_path("java.util.Collections.emptyList"),
            Some("java/util/Collections.java".into())
        );
    }

    #[test]
    fn java_qualified_inner_class_segments() {
        assert_eq!(
            java_qualified_to_relative_path("java.util.Map.Entry"),
            Some("java/util/Map.java".into())
        );
    }

    #[test]
    fn java_wildcard_import_none() {
        assert_eq!(java_qualified_to_relative_path("java.util.*"), None);
    }

    #[test]
    fn byte_offset_line_counts_leading_newlines_only() {
        let s = "a\nb\nc";
        assert_eq!(byte_offset_to_line_number(s, 0), 0);
        assert_eq!(byte_offset_to_line_number(s, 2), 1);
        assert_eq!(byte_offset_to_line_number(s, 4), 2);
    }

    #[test]
    fn php_qualified_to_path_controller() {
        assert_eq!(
            php_qualified_to_path(r"App\Http\Controllers\FooController"),
            Some("App/Http/Controllers/FooController.php".into())
        );
    }

    #[test]
    fn maven_pom_modules_multiline_cdata_and_prefix() {
        let pom = r#"<?xml version="1.0"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modules>
    <module>
      api
    </module>
    <module><![CDATA[  billing-svc  ]]></module>
    <m:module xmlns:m="http://maven.apache.org/POM/4.0.0">legacy</m:module>
  </modules>
</project>"#;
        let mods = collect_maven_module_rel_paths(pom);
        assert_eq!(mods, vec!["api", "billing-svc", "legacy"]);
    }

    #[test]
    fn maven_pom_modules_ignores_modules_in_xml_comments() {
        let pom = r#"<project>
  <!-- <module>ghost</module> -->
  <modules>
    <module>real</module>
  </modules>
</project>"#;
        let mods = collect_maven_module_rel_paths(pom);
        assert_eq!(mods, vec!["real"]);
    }

    #[test]
    fn maven_pom_modules_multiline_plain_text() {
        let pom = r#"<modules>
    <module>
      billing-svc
    </module>
  </modules>"#;
        let mods = collect_maven_module_rel_paths(pom);
        assert_eq!(mods, vec!["billing-svc"]);
    }
    #[test]
    fn spring_classpath_resolves_under_maven_resources() {
        let p = spring_resolve_config_import_token(
            "svc/src/main/resources/application.properties",
            "classpath:config/extra.yml",
        );
        assert_eq!(
            p.as_deref(),
            Some("svc/src/main/resources/config/extra.yml")
        );
    }

    #[test]
    fn ts_js_import_bare_npm_none() {
        assert_eq!(
            resolve_ts_js_import_to_repo_relative(
                "components",
                "vue",
                "src/components/X.vue",
                None,
                &HashSet::new()
            ),
            None
        );
        assert_eq!(
            resolve_ts_js_import_to_repo_relative(
                "components",
                "photoswipe/lightbox",
                "src/components/X.vue",
                None,
                &HashSet::new()
            ),
            None
        );
    }

    #[test]
    fn ts_js_import_at_alias_to_src() {
        assert_eq!(
            resolve_ts_js_import_to_repo_relative(
                "components",
                "@/utils/foo",
                "src/components/X.vue",
                None,
                &HashSet::new()
            )
            .as_deref(),
            Some("src/utils/foo.vue")
        );
        assert_eq!(
            resolve_ts_js_import_to_repo_relative(
                "components",
                "~/api/bar",
                "src/components/X.ts",
                None,
                &HashSet::new()
            )
            .as_deref(),
            Some("src/api/bar.ts")
        );
    }

    #[test]
    fn ts_js_import_relative_resolves() {
        assert_eq!(
            resolve_ts_js_import_to_repo_relative(
                "components/foo",
                "../bar/baz",
                "src/components/foo/X.vue",
                None,
                &HashSet::new()
            )
            .as_deref(),
            Some("components/bar/baz.vue")
        );
    }

    #[test]
    fn ts_js_import_tsconfig_hits_existing_file() {
        let ts = crate::code_knowledge_graph::tsconfig_paths::TsconfigPaths {
            base_url: ".".into(),
            aliases: vec![("@/".into(), "src/".into())],
        };
        let mut files = HashSet::new();
        files.insert("src/utils/theme.ts".to_string());
        let r = resolve_ts_js_import_to_repo_relative(
            "src",
            "@/utils/theme",
            "src/App.vue",
            Some(&ts),
            &files,
        );
        assert_eq!(r.as_deref(), Some("src/utils/theme.ts"));
    }
}
