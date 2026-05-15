import { invoke } from "@tauri-apps/api/core";
import type {
  CancelCodeGraphReindexOutcome,
  CodeGraphNodeSearchRequest,
  CodeGraphSubgraphHopDepth,
  CodeGraphSubgraphRequest,
  CodeGraphSubgraphResponse,
  CodeGraphReindexRequest,
  CodeGraphIndexStatusResponse,
  GraphNode,
} from "../types/codeKnowledgeGraph";

export async function getCodeGraphSubgraph(
  req: CodeGraphSubgraphRequest,
): Promise<CodeGraphSubgraphResponse> {
  return invoke<CodeGraphSubgraphResponse>("get_code_graph_subgraph", { req });
}

export async function searchCodeGraphNodes(req: CodeGraphNodeSearchRequest): Promise<GraphNode[]> {
  return invoke<GraphNode[]>("search_code_graph_nodes", { req });
}

export async function triggerCodeGraphReindex(
  req: CodeGraphReindexRequest,
): Promise<string> {
  return invoke<string>("trigger_code_graph_reindex", { req });
}

/** 停止当前仓库正在进行的代码图谱检索；若仅有僵尸 `indexing` 状态也会清除并返回 `clearedStaleIndexingStatus`。 */
export async function cancelCodeGraphReindex(
  repositoryId: number,
): Promise<CancelCodeGraphReindexOutcome> {
  return invoke<CancelCodeGraphReindexOutcome>("cancel_code_graph_reindex", { repositoryId });
}

/** 多仓：仅 OpenAPI / 合成路由 + 前后端 HTTP 桥接（不重建 GitNexus 索引）；完成后发 `code-graph-openapi-bridge-complete` */
export async function triggerCodeGraphOpenapiBridge(repositoryIds: number[]): Promise<string> {
  return invoke<string>("trigger_code_graph_openapi_bridge", { repositoryIds });
}

/** 多仓：依次索引、OpenAPI/合成路由、HTTP 桥接（后台任务，完成后发 `code-graph-association-build-complete`） */
export async function triggerCodeGraphAssociationBuild(repositoryIds: number[]): Promise<string> {
  return invoke<string>("trigger_code_graph_association_build", { repositoryIds });
}

export async function getCodeGraphIndexStatus(
  repositoryId: number,
): Promise<CodeGraphIndexStatusResponse> {
  return invoke<CodeGraphIndexStatusResponse>("get_code_graph_index_status", { repositoryId });
}

/** 删除该仓图谱节点、边与 `graph_index_meta`（不含磁盘上的仓库源码）。 */
export async function clearCodeGraphIndex(repositoryId: number): Promise<void> {
  return invoke<void>("clear_code_graph_index", { repositoryId });
}

export async function importCodeGraphOpenapi(
  repositoryId: number,
  openapiPath: string,
): Promise<{ apiOperations: number; backendEdges: number }> {
  return invoke("import_code_graph_openapi", { repositoryId, openapiPath });
}

export async function bridgeCodeGraphHttp(
  frontendRepoId: number,
  backendRepoId: number,
): Promise<{ edges: number; apiOperationsCount: number; reason?: string }> {
  return invoke("bridge_code_graph_http", { frontendRepoId, backendRepoId });
}

export async function extractCodeGraphSyntheticRoutes(
  repositoryId: number,
): Promise<{ apiOperations: number; backendEdges: number; routesFound: number }> {
  return invoke("extract_code_graph_synthetic_routes", { repositoryId });
}

export async function getCodeGraphMultiSubgraph(
  repositoryIds: number[],
  options?: {
    focusNodeId?: string;
/** 不传或 `undefined`：不限制层数；`1`–`10`：子图「层数」（1 层仅焦点，L 层含 outward 代价 ≤ L−1 的节点，`contains` 不增代价） */
    hop?: CodeGraphSubgraphHopDepth;
    includeCrossRepoEdges?: boolean;
  },
): Promise<CodeGraphSubgraphResponse> {
  return invoke("get_code_graph_multi_subgraph", {
    repositoryIds,
    focusNodeId: options?.focusNodeId,
    hop: options?.hop,
    includeCrossRepoEdges: options?.includeCrossRepoEdges,
  });
}
