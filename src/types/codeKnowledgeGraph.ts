export type GraphNodeKind = "repo" | "folder" | "file" | "symbol" | "api_operation" | "schema";
export type GraphEdgeKind =
  | "contains"
  | "defines"
  | "has_method"
  | "has_property"
  | "imports"
  | "calls"
  | "implements"
  | "frontend_invokes_api"
  | "backend_serves_api"
  | "cross_repo";

export interface GraphPosition {
  line: number;
  column: number;
}

export interface GraphRange {
  start: GraphPosition;
  end: GraphPosition;
}

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  symbolKind?: string;
  label: string;
  path: string;
  repoId: number;
  range?: GraphRange;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  props?: Record<string, unknown>;
}

export interface ParseError {
  file: string;
  message: string;
}

export interface GraphMeta {
  truncated: boolean;
  totalEdgeHint?: number;
  indexVersion: string;
  errors?: ParseError[];
}

/** 子图 BFS 深度上限（与后端 `subgraph::query_subgraph` 一致，1–10） */
export type CodeGraphSubgraphHopDepth = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** 与后端 `CodeGraphSubgraphDirection` 一致：双向、仅入边（上卷）、仅出边（下钻） */
export type CodeGraphSubgraphDirection = "both" | "upstream" | "downstream";

/** 全库节点搜索（SQLite `graph_nodes`，非当前子图内存过滤） */
export interface CodeGraphNodeSearchRequest {
  repositoryIds: number[];
  query: string;
  /** 默认 80，最大 200 */
  limit?: number;
}

export interface CodeGraphSubgraphRequest {
  repositoryId: number;
  focusNodeId?: string;
  /** 省略或 `undefined`：不限制跳数，展开焦点可达的全部子图；`1`–`10`：限制 BFS 深度 */
  hop?: CodeGraphSubgraphHopDepth;
  nodeTypeFilter?: string[];
  /** 省略：双向 BFS；`upstream` / `downstream` 仅沿入边或出边扩展 */
  direction?: CodeGraphSubgraphDirection;
}

export interface CodeGraphSubgraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: GraphMeta;
}

export interface CodeGraphReindexRequest {
  repositoryId: number;
}

export interface CodeGraphIndexStatusResponse {
  status: "idle" | "indexing" | "done" | "error";
  repositoryId: number;
  progress?: number;
  indexVersion?: string;
  error?: string;
}
