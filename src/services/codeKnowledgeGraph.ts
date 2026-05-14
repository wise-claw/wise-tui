import { invoke } from "@tauri-apps/api/core";
import type {
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

export async function getCodeGraphIndexStatus(
  repositoryId: number,
): Promise<CodeGraphIndexStatusResponse> {
  return invoke<CodeGraphIndexStatusResponse>("get_code_graph_index_status", { repositoryId });
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
    /** 不传或 `undefined`：不限制跳数；`1`–`10`：限制 BFS 深度 */
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
