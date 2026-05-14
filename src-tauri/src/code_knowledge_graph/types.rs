use serde::{Deserialize, Serialize};

/// 子图 BFS 沿边的方向：双向（默认）、仅沿入边（上卷）、仅沿出边（下钻）。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CodeGraphSubgraphDirection {
    #[default]
    Both,
    Upstream,
    Downstream,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraphSubgraphRequest {
    pub repository_id: i64,
    #[serde(default)]
    pub focus_node_id: Option<String>,
    #[serde(default)]
    pub hop: Option<u8>,
    #[serde(default)]
    pub node_type_filter: Option<Vec<String>>,
    #[serde(default)]
    pub direction: Option<CodeGraphSubgraphDirection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraphSubgraphResponse {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub meta: GraphMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol_kind: Option<String>,
    pub label: String,
    pub path: String,
    #[serde(rename = "repoId")]
    pub repo_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<GraphRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRange {
    pub start: GraphPosition,
    pub end: GraphPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPosition {
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub props: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphMeta {
    pub truncated: bool,
    pub total_edge_hint: Option<usize>,
    pub index_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<ParseError>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseError {
    pub file: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraphReindexRequest {
    pub repository_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraphIndexStatusResponse {
    pub status: String,
    pub repository_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
