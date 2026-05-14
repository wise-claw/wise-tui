export type GraphNodeKind = "repo" | "folder" | "file" | "symbol" | "api_operation" | "schema";
export type GraphEdgeKind = "contains" | "imports" | "calls" | "implements" | "frontend_invokes_api" | "backend_serves_api" | "cross_repo";

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

export interface CodeGraphSubgraphRequest {
  repositoryId: number;
  focusNodeId?: string;
  /** 省略或 `undefined`：不限制跳数，展开焦点可达的全部子图；`1`–`3`：限制 BFS 深度 */
  hop?: 1 | 2 | 3;
  nodeTypeFilter?: string[];
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
