use crate::code_knowledge_graph::storage as graph_storage;

pub struct Parser;

impl Parser {
    pub fn new() -> Self {
        Parser
    }

    pub fn parse_file(
        &mut self,
        content: &str,
        file_node_id: &str,
        repo_id: i64,
        relative_path: &str,
        conn: &rusqlite::Connection,
    ) -> Result<(usize, usize), String> {
        let label = relative_path
            .split('/')
            .last()
            .unwrap_or(relative_path)
            .to_string();

        // Add file node
        let line_count = content.lines().count();
        let range = Some(crate::code_knowledge_graph::types::GraphRange {
            start: crate::code_knowledge_graph::types::GraphPosition {
                line: 0,
                column: 0,
            },
            end: crate::code_knowledge_graph::types::GraphPosition {
                line: line_count,
                column: 0,
            },
        });

        graph_storage::upsert_node(
            conn,
            file_node_id,
            "file",
            None,
            &label,
            relative_path,
            repo_id,
            range,
            None,
        )?;

        // Extract imports via regex-based parsing
        let import_count = self.extract_imports(conn, content, file_node_id, repo_id, relative_path)?;

        // Extract basic symbols (function/class declarations) via regex
        let symbol_count = self.extract_symbols_regex(conn, content, file_node_id, repo_id, relative_path)?;

        Ok((1 + symbol_count, symbol_count + import_count))
    }

    fn extract_symbols_regex(
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

            // export function foo( / export const foo = / function foo(
            // export class Foo / class Foo {
            // export interface Foo / interface Foo {
            // const foo = () => / const foo = function(

            let mut symbol_info = None;

            // Function declarations
            if trimmed.starts_with("export function ")
                || trimmed.starts_with("export async function ")
            {
                symbol_info = extract_symbol_name_after_keyword(trimmed, "function");
            } else if trimmed.starts_with("function ") {
                symbol_info = extract_symbol_name_after_keyword(trimmed, "function");
            } else if (trimmed.starts_with("export const ") || trimmed.starts_with("export let "))
                && (trimmed.contains(" = (") || trimmed.contains(" = function"))
            {
                // export const foo = (...) =>  or  export const foo = function(
                symbol_info = extract_const_name(trimmed);
            } else if trimmed.starts_with("export class ") || trimmed.starts_with("class ") {
                symbol_info = extract_symbol_name_after_keyword(trimmed, "class");
            } else if trimmed.starts_with("export interface ") || trimmed.starts_with("interface ") {
                symbol_info = extract_symbol_name_after_keyword(trimmed, "interface");
            }

            if let Some((name, kind)) = symbol_info {
                let symbol_id = format!("{file_node_id}:symbol:{name}");
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
                    &symbol_id,
                    "symbol",
                    Some(&kind),
                    &name,
                    relative_path,
                    repo_id,
                    range,
                    None,
                )?;

                // file contains symbol edge
                graph_storage::upsert_edge(
                    conn,
                    &format!("{file_node_id}:contains:{symbol_id}"),
                    file_node_id,
                    &symbol_id,
                    "contains",
                )?;

                count += 1;
            }
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

            // Match: ... from '...'  or  ... from "..."
            if let Some(from_pos) = trimmed.find("from ") {
                let after_from = &trimmed[from_pos + 5..];
                if let Some(p) = extract_first_quoted_string(after_from) {
                    import_path = Some(p);
                }
            }

            // Side-effect import: import 'path'
            if import_path.is_none() {
                if let Some(p) = extract_first_quoted_string(trimmed) {
                    if !p.contains(' ') && !p.starts_with("type") && !p.starts_with("interface") {
                        import_path = Some(p);
                    }
                }
            }

            if let Some(import_path) = import_path {
                if is_bare_module(&import_path) {
                    continue;
                }

                let resolved = resolve_import_path(file_dir, &import_path);
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
}

fn extract_symbol_name_after_keyword(line: &str, keyword: &str) -> Option<(String, String)> {
    // e.g. "export function foo(" → "foo", "function"
    // e.g. "export class Foo {" → "Foo", "class"
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
    // e.g. "export const foo = (" → "foo"
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

fn resolve_import_path(current_dir: &str, import_path: &str) -> String {
    if import_path.starts_with('.') {
        let mut parts: Vec<&str> = if !current_dir.is_empty() {
            current_dir.split('/').collect()
        } else {
            vec![]
        };

        for component in import_path.split('/') {
            match component {
                ".." => { parts.pop(); }
                "." => {}
                name => parts.push(name),
            }
        }

        let mut resolved = parts.join("/");
        if !resolved.ends_with(".ts")
            && !resolved.ends_with(".tsx")
            && !resolved.ends_with(".js")
            && !resolved.ends_with(".jsx")
            && !resolved.ends_with("/index.ts")
            && !resolved.ends_with("/index.tsx")
        {
            resolved = format!("{resolved}.ts");
        }
        resolved
    } else {
        import_path.to_string()
    }
}
