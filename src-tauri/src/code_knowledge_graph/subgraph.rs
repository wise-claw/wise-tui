use std::collections::{HashMap, HashSet, VecDeque};
use rusqlite::OptionalExtension;

use crate::code_knowledge_graph::types::{
    CodeGraphSubgraphDirection, CodeGraphSubgraphResponse, GraphEdge, GraphMeta, GraphNode, GraphPosition, GraphRange,
};

pub fn query_subgraph(
    conn: &rusqlite::Connection,
    repo_id: i64,
    focus_node_id: Option<&str>,
    hop: Option<u8>,
    node_type_filter: Option<&[String]>,
    direction: Option<CodeGraphSubgraphDirection>,
) -> Result<CodeGraphSubgraphResponse, String> {
    let dir = direction.unwrap_or(CodeGraphSubgraphDirection::Both);
    // `hop`（1–10）：用户选择的「层数」——1 层仅含焦点；L 层含焦点及 hop 代价 ≤ L−1 的可达节点
    //（`contains` 不增加代价，与既有 Maven 目录语义一致）。
    // 内部 BFS 仅在 `current_hop < hop_cap` 时扩展，故 `hop_cap = layers − 1`（焦点层为 0）。
    let hop_cap: u32 = match hop {
        None => u32::MAX,
        Some(layers) => {
            let layers = (layers as u32).clamp(1, 10);
            layers.saturating_sub(1)
        }
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

    // BFS（FIFO）+ 每节点最小 hop；`contains` 不增加 hop。
    // 旧实现用 `Vec::pop`（LIFO）且 `visited` 挡住更优路径，在混合 `contains` 与依赖边时可能截断错误。
    let mut min_hop: HashMap<String, u32> = HashMap::new();
    let mut collected: HashSet<String> = HashSet::new();
    let mut visited_edges: HashSet<String> = HashSet::new();
    let mut deque: VecDeque<(String, u32)> = VecDeque::new();

    min_hop.insert(focus_id.clone(), 0);
    deque.push_back((focus_id.clone(), 0));

    while let Some((node_id, hop)) = deque.pop_front() {
        if min_hop.get(&node_id).copied() != Some(hop) {
            continue;
        }
        collected.insert(node_id.clone());
        if hop >= hop_cap {
            continue;
        }

        if matches!(dir, CodeGraphSubgraphDirection::Both | CodeGraphSubgraphDirection::Downstream) {
            let edges = conn
                .prepare(
                    "SELECT e.id, e.source_id, e.target_id, e.kind FROM graph_edges e WHERE e.source_id = ?1",
                )
                .map_err(|e| e.to_string())?
                .query_map(rusqlite::params![&node_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect::<Vec<_>>();

            for (edge_id, _source, target, kind) in &edges {
                visited_edges.insert(edge_id.clone());
                let next_hop = hop_after_edge(kind, hop);
                let improve = match min_hop.get(target) {
                    None => true,
                    Some(&old) => next_hop < old,
                };
                if improve {
                    min_hop.insert(target.clone(), next_hop);
                    deque.push_back((target.clone(), next_hop));
                }
            }
        }

        if matches!(dir, CodeGraphSubgraphDirection::Both | CodeGraphSubgraphDirection::Upstream) {
            let edges = conn
                .prepare(
                    "SELECT e.id, e.source_id, e.target_id, e.kind FROM graph_edges e WHERE e.target_id = ?1",
                )
                .map_err(|e| e.to_string())?
                .query_map(rusqlite::params![&node_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect::<Vec<_>>();

            for (edge_id, source, _target, kind) in &edges {
                visited_edges.insert(edge_id.clone());
                let next_hop = hop_after_edge(kind, hop);
                let improve = match min_hop.get(source) {
                    None => true,
                    Some(&old) => next_hop < old,
                };
                if improve {
                    min_hop.insert(source.clone(), next_hop);
                    deque.push_back((source.clone(), next_hop));
                }
            }
        }
    }

    // Fetch full node data
    let nodes = fetch_nodes(conn, &collected)?;

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

#[inline]
fn hop_after_edge(edge_kind: &str, current_hop: u32) -> u32 {
    if edge_kind == "contains" {
        current_hop
    } else {
        current_hop.saturating_add(1)
    }
}

#[cfg(test)]
mod tests {
    use super::{hop_after_edge, query_subgraph};
    use crate::code_knowledge_graph::types::CodeGraphSubgraphDirection;
    use rusqlite::Connection;
    use std::collections::HashSet;

    #[test]
    fn contains_edges_do_not_consume_hop_budget() {
        assert_eq!(hop_after_edge("contains", 2), 2);
        assert_eq!(hop_after_edge("imports", 2), 3);
    }

    #[test]
    fn one_graph_layer_is_focus_only() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE graph_nodes (
              id TEXT PRIMARY KEY, kind TEXT NOT NULL, symbol_kind TEXT, label TEXT NOT NULL,
              path TEXT NOT NULL, repo_id INTEGER NOT NULL,
              range_start_line INTEGER, range_start_col INTEGER, range_end_line INTEGER, range_end_col INTEGER,
              content_hash TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE graph_edges (
              id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL, kind TEXT NOT NULL,
              props TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE graph_index_meta (
              repo_id INTEGER PRIMARY KEY, index_version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle',
              error TEXT, total_nodes INTEGER DEFAULT 0, total_edges INTEGER DEFAULT 0, progress INTEGER DEFAULT 0,
              updated_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO graph_index_meta (repo_id, index_version, status) VALUES (1, 't', 'done');
            INSERT INTO graph_nodes (id, kind, label, path, repo_id) VALUES
              ('1:A', 'symbol', 'A', 'A', 1), ('1:B', 'symbol', 'B', 'B', 1);
            INSERT INTO graph_edges (id, source_id, target_id, kind) VALUES
              ('e1', '1:A', '1:B', 'imports');",
        )
        .unwrap();
        let out = query_subgraph(
            &conn,
            1,
            Some("1:A"),
            Some(1),
            None,
            Some(CodeGraphSubgraphDirection::Downstream),
        )
        .unwrap();
        let ids: std::collections::HashSet<_> = out.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids, HashSet::from(["1:A"]));
    }

    /// 先经 `imports` 到达 D 时 hop=2；经 `contains` 再 `imports` 可达 hop=1。
    /// 旧实现用 visited 挡住更优 hop，会导致 D 的子节点在 hop 预算内不可见。
    #[test]
    fn subgraph_prefers_lower_hop_when_revisiting_node() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE graph_nodes (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              symbol_kind TEXT,
              label TEXT NOT NULL,
              path TEXT NOT NULL,
              repo_id INTEGER NOT NULL,
              range_start_line INTEGER,
              range_start_col INTEGER,
              range_end_line INTEGER,
              range_end_col INTEGER,
              content_hash TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE graph_edges (
              id TEXT PRIMARY KEY,
              source_id TEXT NOT NULL,
              target_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              props TEXT DEFAULT '{}',
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE graph_index_meta (
              repo_id INTEGER PRIMARY KEY,
              index_version TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'idle',
              error TEXT,
              total_nodes INTEGER DEFAULT 0,
              total_edges INTEGER DEFAULT 0,
              progress INTEGER DEFAULT 0,
              updated_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO graph_index_meta (repo_id, index_version, status)
            VALUES (1, 't', 'done');
            INSERT INTO graph_nodes (id, kind, label, path, repo_id) VALUES
              ('1:A', 'symbol', 'A', 'A', 1),
              ('1:B', 'symbol', 'B', 'B', 1),
              ('1:C', 'symbol', 'C', 'C', 1),
              ('1:D', 'symbol', 'D', 'D', 1),
              ('1:E', 'symbol', 'E', 'E', 1);
            INSERT INTO graph_edges (id, source_id, target_id, kind) VALUES
              ('e1', '1:A', '1:B', 'imports'),
              ('e2', '1:A', '1:C', 'contains'),
              ('e3', '1:B', '1:D', 'imports'),
              ('e4', '1:C', '1:D', 'imports'),
              ('e5', '1:D', '1:E', 'imports');",
        )
        .unwrap();

        let out = query_subgraph(
            &conn,
            1,
            Some("1:A"),
            Some(3),
            None,
            Some(CodeGraphSubgraphDirection::Downstream),
        )
        .unwrap();
        let ids: std::collections::HashSet<_> = out.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(
            ids.contains("1:E"),
            "expected cheaper path A-contains-C-imports-D-imports-E within 3 layers (hop_cap=2); got {:?}",
            ids
        );
    }
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
