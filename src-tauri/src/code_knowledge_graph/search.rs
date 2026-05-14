use std::collections::HashSet;

use rusqlite::Connection;

use super::types::{GraphNode, GraphPosition, GraphRange};

fn escape_like_fragment(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '%' => out.push_str("\\%"),
            '_' => out.push_str("\\_"),
            c => out.push(c),
        }
    }
    out
}

fn map_node_row(
    row: &rusqlite::Row<'_>,
) -> Result<GraphNode, rusqlite::Error> {
    let id: String = row.get(0)?;
    let kind: String = row.get(1)?;
    let symbol_kind: Option<String> = row.get(2)?;
    let label: String = row.get(3)?;
    let path: String = row.get(4)?;
    let repo_id: i64 = row.get(5)?;
    let start_line: Option<i64> = row.get(6)?;
    let start_col: Option<i64> = row.get(7)?;
    let end_line: Option<i64> = row.get(8)?;
    let end_col: Option<i64> = row.get(9)?;

    let range = match (start_line, start_col, end_line, end_col) {
        (Some(sl), Some(sc), Some(el), Some(ec)) => Some(GraphRange {
            start: GraphPosition {
                line: sl as usize,
                column: sc as usize,
            },
            end: GraphPosition {
                line: el as usize,
                column: ec as usize,
            },
        }),
        _ => None,
    };

    Ok(GraphNode {
        id,
        kind,
        symbol_kind,
        label,
        path,
        repo_id,
        range,
    })
}

/// Full-index search across `graph_nodes` for one or more repositories (not limited to the current subgraph).
pub fn search_graph_nodes(
    conn: &Connection,
    repository_ids: &[i64],
    query: &str,
    limit: usize,
) -> Result<Vec<GraphNode>, String> {
    if repository_ids.is_empty() {
        return Err("repositoryIds must not be empty".to_string());
    }
    if repository_ids.len() > 20 {
        return Err("repositoryIds must have at most 20 entries".to_string());
    }

    let needle = query.trim();
    if needle.is_empty() {
        return Ok(vec![]);
    }

    let lim = limit.clamp(1, 200);
    let per_repo_cap: i64 = ((lim as i64 + repository_ids.len() as i64 - 1) / repository_ids.len() as i64)
        .clamp(15, 120);

    let pat = format!("%{}%", escape_like_fragment(needle));

    let sql = r#"SELECT id, kind, symbol_kind, label, path, repo_id,
        range_start_line, range_start_col, range_end_line, range_end_col
        FROM graph_nodes
        WHERE repo_id = ?1
        AND (
            LOWER(label) LIKE LOWER(?2) ESCAPE '\' OR
            LOWER(path) LIKE LOWER(?3) ESCAPE '\' OR
            LOWER(id) LIKE LOWER(?4) ESCAPE '\'
        )
        LIMIT ?5"#;

    let mut merged: Vec<GraphNode> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for repo_id in repository_ids {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(
                rusqlite::params![repo_id, &pat, &pat, &pat, per_repo_cap],
                map_node_row,
            )
            .map_err(|e| e.to_string())?;

        for row in rows {
            let node = row.map_err(|e| e.to_string())?;
            if seen.insert(node.id.clone()) {
                merged.push(node);
            }
        }
    }

    let needle_lc = needle.to_lowercase();
    merged.sort_by(|a, b| {
        let sa = score_node(&needle_lc, a);
        let sb = score_node(&needle_lc, b);
        sb.cmp(&sa).then_with(|| {
            a.label
                .to_lowercase()
                .cmp(&b.label.to_lowercase())
        })
    });

    merged.truncate(lim);
    Ok(merged)
}

fn score_node(needle: &str, n: &GraphNode) -> i32 {
    let lab = n.label.to_lowercase();
    let path = n.path.to_lowercase();
    let id = n.id.to_lowercase();
    if lab == needle {
        1000
    } else if lab.starts_with(needle) {
        500
    } else if lab.contains(needle) {
        300
    } else if path.contains(needle) {
        150
    } else if id.contains(needle) {
        50
    } else {
        0
    }
}
