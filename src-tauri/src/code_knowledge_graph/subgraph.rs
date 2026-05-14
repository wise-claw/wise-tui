use std::collections::HashSet;
use rusqlite::OptionalExtension;

use crate::code_knowledge_graph::types::{CodeGraphSubgraphResponse, GraphEdge, GraphMeta, GraphNode, GraphPosition, GraphRange};

pub fn query_subgraph(
    conn: &rusqlite::Connection,
    repo_id: i64,
    focus_node_id: Option<&str>,
    hop: Option<u8>,
    node_type_filter: Option<&[String]>,
) -> Result<CodeGraphSubgraphResponse, String> {
    // `None` = 不限制深度，展开从焦点可达的全部子图（仍受 MAX_NODES 截断）
    let hop_cap: u32 = match hop {
        None => u32::MAX,
        Some(0) => 1,
        Some(h) => (h as u32).clamp(1, 3),
    };

    let total_edge_hint: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM graph_edges e
             JOIN graph_nodes n ON e.source_id = n.id
             WHERE n.repo_id = ?1",
            rusqlite::params![repo_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let focus_id = match focus_node_id {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => format!("{repo_id}:repo:root"),
    };

    // BFS to collect subgraph
    let mut visited_nodes: HashSet<String> = HashSet::new();
    let mut visited_edges: HashSet<String> = HashSet::new();
    let mut queue: Vec<(String, u32)> = vec![(focus_id.clone(), 0)];

    while let Some((node_id, current_hop)) = queue.pop() {
        if current_hop >= hop_cap {
            visited_nodes.insert(node_id);
            continue;
        }

        if visited_nodes.contains(&node_id) && current_hop > 0 {
            continue;
        }
        visited_nodes.insert(node_id.clone());

        // Collect outgoing edges
        let edges = conn
            .prepare(
                "SELECT e.id, e.source_id, e.target_id FROM graph_edges e WHERE e.source_id = ?1",
            )
            .map_err(|e| e.to_string())?
            .query_map(rusqlite::params![&node_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();

        for (edge_id, _source, target) in &edges {
            visited_edges.insert(edge_id.clone());
            if !visited_nodes.contains(target) {
                queue.push((target.clone(), current_hop.saturating_add(1)));
            }
        }

        // Collect incoming edges
        let edges = conn
            .prepare(
                "SELECT e.id, e.source_id, e.target_id FROM graph_edges e WHERE e.target_id = ?1",
            )
            .map_err(|e| e.to_string())?
            .query_map(rusqlite::params![&node_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();

        for (edge_id, source, _target) in &edges {
            visited_edges.insert(edge_id.clone());
            if !visited_nodes.contains(source) {
                queue.push((source.clone(), current_hop.saturating_add(1)));
            }
        }
    }

    // Fetch full node data
    let nodes = fetch_nodes(conn, &visited_nodes)?;

    // Fetch full edge data
    let edges = fetch_edges_data(conn, &visited_edges)?;

    // Apply type filter if specified
    let (filtered_nodes, filtered_edges) = match node_type_filter {
        Some(filter) if !filter.is_empty() => {
            let allowed: HashSet<&str> = filter.iter().map(|s| s.as_str()).collect();

            let kept_ids: HashSet<String> = nodes
                .iter()
                .filter(|n| allowed.contains(n.kind.as_str()))
                .map(|n| n.id.clone())
                .collect();

            let filtered_nodes: Vec<GraphNode> = nodes
                .into_iter()
                .filter(|n| kept_ids.contains(&n.id))
                .collect();

            let filtered_edges: Vec<GraphEdge> = edges
                .into_iter()
                .filter(|e| kept_ids.contains(&e.source) && kept_ids.contains(&e.target))
                .collect();

            (filtered_nodes, filtered_edges)
        }
        _ => (nodes, edges),
    };

    const MAX_NODES: usize = 5000;
    let truncated = filtered_nodes.len() > MAX_NODES;
    let final_nodes = if truncated {
        filtered_nodes.into_iter().take(MAX_NODES).collect()
    } else {
        filtered_nodes
    };

    Ok(CodeGraphSubgraphResponse {
        nodes: final_nodes,
        edges: filtered_edges,
        meta: GraphMeta {
            truncated,
            total_edge_hint: Some(total_edge_hint as usize),
            index_version: get_index_version(conn, repo_id)?,
            errors: None,
        },
    })
}

fn fetch_nodes(conn: &rusqlite::Connection, ids: &HashSet<String>) -> Result<Vec<GraphNode>, String> {
    let mut nodes = Vec::new();
    for id in ids {
        let row: Option<(String, String, Option<String>, String, String, i64, Option<i64>, Option<i64>, Option<i64>, Option<i64>)> = conn
            .query_row(
                "SELECT id, kind, symbol_kind, label, path, repo_id,
                 range_start_line, range_start_col, range_end_line, range_end_col
                 FROM graph_nodes WHERE id = ?1",
                rusqlite::params![id],
                |row| {
                    Ok((
                        row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                        row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?,
                        row.get(8)?, row.get(9)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some((id, kind, symbol_kind, label, path, repo_id,
                      start_line, start_col, end_line, end_col)) = row {
            let range = match (start_line, start_col, end_line, end_col) {
                (Some(sl), Some(sc), Some(el), Some(ec)) => Some(GraphRange {
                    start: GraphPosition { line: sl as usize, column: sc as usize },
                    end: GraphPosition { line: el as usize, column: ec as usize },
                }),
                _ => None,
            };

            nodes.push(GraphNode {
                id, kind, symbol_kind, label, path, repo_id, range,
            });
        }
    }
    Ok(nodes)
}

fn fetch_edges_data(conn: &rusqlite::Connection, ids: &HashSet<String>) -> Result<Vec<GraphEdge>, String> {
    let mut edges = Vec::new();
    for id in ids {
        let row: Option<(String, String, String, String, Option<String>)> = conn
            .query_row(
                "SELECT id, source_id, target_id, kind, props FROM graph_edges WHERE id = ?1",
                rusqlite::params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some((id, source, target, kind, props)) = row {
            edges.push(GraphEdge {
                id, source, target, kind,
                props: props.and_then(|s| serde_json::from_str(&s).ok()),
            });
        }
    }
    Ok(edges)
}

fn get_index_version(conn: &rusqlite::Connection, repo_id: i64) -> Result<String, String> {
    let version: Option<String> = conn
        .query_row(
            "SELECT index_version FROM graph_index_meta WHERE repo_id = ?1",
            rusqlite::params![repo_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(version.unwrap_or_else(|| "none".to_string()))
}
