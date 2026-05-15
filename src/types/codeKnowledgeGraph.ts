export type GraphNodeKind = "repo" | "folder" | "file" | "symbol" | "api_operation" | "schema";
export type GraphEdgeKind =
  | "contains"
  | "defines"
  | "has_method"
  | "has_property"
  | "imports"
  | "calls"
  | "writes"
  | "extends"
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

/** 子图 hop 深度选项（与后端 `hop` 一致：L 表示至多 L 条计代价 outward 边；`contains` 不增代价） */
export type CodeGraphSubgraphHopDepth = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** 工具栏「全部」或具体 hop 上限（与代码图谱 UI 一致） */
export type CodeGraphSubgraphHopScope = "all" | CodeGraphSubgraphHopDepth;

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
  /** 省略或 `undefined`：不限制 hop，展开焦点可达的全部子图；`1`–`10`：子图 hop 上限（焦点 + 至多 L 条计代价 outward 边，`contains` 不增代价） */
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

/** 与后端 `index_cancel::INDEX_CANCELLED_MSG` 一致：用户主动停止 */
export const CODE_GRAPH_INDEX_CANCELLED_MSG = "检索已取消" as const;

/** 与后端 `index_cancel::INDEX_STALE_ORPHAN_MSG` 一致：僵尸 indexing 被「暂停」清除 */
export const CODE_GRAPH_INDEX_STALE_ORPHAN_MSG =
  "索引未在进程中运行（可能已异常退出或应用重启）。请重新点击「开始检索」。" as const;

export interface CancelCodeGraphReindexOutcome {
  signalledRunningTask: boolean;
  clearedStaleIndexingStatus: boolean;
}

export interface CodeGraphIndexStatusResponse {
  status: "idle" | "indexing" | "done" | "error";
  repositoryId: number;
  progress?: number;
  indexVersion?: string;
  error?: string;
  /** 仅 indexing：后端复用 meta 列表示已扫描源文件数 / 预估可索引源文件总数 */
  indexingFilesDone?: number;
  indexingFilesTotal?: number;
  /** 仅 indexing：当前正在读取/解析的仓库内相对路径 */
  indexingCurrentFile?: string;
}
