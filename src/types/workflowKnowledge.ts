export type WorkflowKnowledgeSearchMode = "keyword" | "hybrid" | "path_focus";

export type WorkflowKnowledgeOutputMode = "summary" | "structured" | "verbatim";

export type WorkflowKnowledgeNodeKindFilter = "file" | "folder" | "symbol" | "api_operation" | "schema";

/** 知识检索子图扩展方向（上卷 / 下钻 / 双向）。 */
export type WorkflowKnowledgeSubgraphDirection = "both" | "upstream" | "downstream";

export interface WorkflowKnowledgeRetrievalConfig {
  /** 主检索语句，支持 {{var}} */
  query: string;
  searchMode: WorkflowKnowledgeSearchMode;
  nodeKinds: WorkflowKnowledgeNodeKindFilter[];
  /** 期望返回的图谱节点数量上限（1–200） */
  topK: number;
  /** 命中种子节点后的子图扩展 hop；0 表示不扩展 */
  subgraphHop: number;
  subgraphDirection: WorkflowKnowledgeSubgraphDirection;
  /** 路径前缀过滤，如 src/services */
  pathPrefix?: string;
  outputMode: WorkflowKnowledgeOutputMode;
  /** 要求引用文件路径与符号位置 */
  requireCitation: boolean;
  /** 下游可引用的输出变量名 */
  outputVariable?: string;
  /** 补充检索语句（OR 语义） */
  supplementQueries: string[];
}

export const DEFAULT_WORKFLOW_KNOWLEDGE_CONFIG: WorkflowKnowledgeRetrievalConfig = {
  query: "",
  searchMode: "hybrid",
  nodeKinds: ["file", "symbol", "api_operation"],
  topK: 20,
  subgraphHop: 2,
  subgraphDirection: "both",
  outputMode: "structured",
  requireCitation: true,
  supplementQueries: [],
};
