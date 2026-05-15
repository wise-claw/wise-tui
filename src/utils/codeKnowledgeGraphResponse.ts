import type {
  CodeGraphSubgraphResponse,
  CodeGraphIndexStatusResponse,
  GraphNode,
  GraphEdge,
  GraphMeta,
} from "../types/codeKnowledgeGraph";

const VALID_NODE_KINDS = new Set(["repo", "folder", "file", "symbol", "api_operation", "schema"]);
const VALID_EDGE_KINDS = new Set([
  "contains",
  "defines",
  "has_method",
  "has_property",
  "imports",
  "calls",
  "writes",
  "extends",
  "implements",
  "frontend_invokes_api",
  "backend_serves_api",
  "cross_repo",
]);
const VALID_INDEX_STATUSES = new Set(["idle", "indexing", "done", "error"]);

function isValidGraphNode(node: unknown): node is GraphNode {
  if (typeof node !== "object" || node === null) return false;
  const n = node as Record<string, unknown>;
  return (
    typeof n.id === "string"
    && typeof n.kind === "string"
    && VALID_NODE_KINDS.has(n.kind)
    && typeof n.label === "string"
    && typeof n.path === "string"
    && typeof n.repoId === "number"
  );
}

function isValidGraphEdge(edge: unknown): edge is GraphEdge {
  if (typeof edge !== "object" || edge === null) return false;
  const e = edge as Record<string, unknown>;
  return (
    typeof e.id === "string"
    && typeof e.source === "string"
    && typeof e.target === "string"
    && typeof e.kind === "string"
    && VALID_EDGE_KINDS.has(e.kind)
  );
}

function isValidGraphMeta(meta: unknown): meta is GraphMeta {
  if (typeof meta !== "object" || meta === null) return false;
  const m = meta as Record<string, unknown>;
  return (
    typeof m.truncated === "boolean"
    && typeof m.indexVersion === "string"
    && (m.totalEdgeHint === undefined || typeof m.totalEdgeHint === "number")
    && (m.errors === undefined || Array.isArray(m.errors))
  );
}

export function parseCodeGraphNodeSearchResponse(raw: unknown): GraphNode[] {
  if (!Array.isArray(raw)) {
    throw new TypeError("Invalid node search response: expected array");
  }
  const nodes: GraphNode[] = [];
  for (const n of raw) {
    if (!isValidGraphNode(n)) {
      throw new TypeError(`Invalid node search response: invalid node: ${JSON.stringify(n)}`);
    }
    nodes.push(n);
  }
  return nodes;
}

export function parseCodeGraphSubgraphResponse(
  raw: unknown,
): CodeGraphSubgraphResponse {
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError("Invalid subgraph response: not an object");
  }
  const resp = raw as Record<string, unknown>;

  if (!Array.isArray(resp.nodes)) {
    throw new TypeError("Invalid subgraph response: nodes must be an array");
  }
  if (!Array.isArray(resp.edges)) {
    throw new TypeError("Invalid subgraph response: edges must be an array");
  }

  const nodes: GraphNode[] = [];
  for (const n of resp.nodes) {
    if (!isValidGraphNode(n)) {
      throw new TypeError(`Invalid subgraph response: invalid node: ${JSON.stringify(n)}`);
    }
    nodes.push(n);
  }

  const edges: GraphEdge[] = [];
  for (const e of resp.edges) {
    if (!isValidGraphEdge(e)) {
      throw new TypeError(`Invalid subgraph response: invalid edge: ${JSON.stringify(e)}`);
    }
    edges.push(e);
  }

  if (!isValidGraphMeta(resp.meta)) {
    throw new TypeError("Invalid subgraph response: invalid meta");
  }

  return { nodes, edges, meta: resp.meta };
}

export function parseCodeGraphIndexStatusResponse(
  raw: unknown,
): CodeGraphIndexStatusResponse {
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError("Invalid index status response: not an object");
  }
  const resp = raw as Record<string, unknown>;

  if (typeof resp.status !== "string" || !VALID_INDEX_STATUSES.has(resp.status)) {
    throw new TypeError(`Invalid index status: ${resp.status}`);
  }
  if (typeof resp.repositoryId !== "number") {
    throw new TypeError("Invalid index status response: repositoryId must be a number");
  }

  return {
    status: resp.status as CodeGraphIndexStatusResponse["status"],
    repositoryId: resp.repositoryId,
    progress: typeof resp.progress === "number" ? resp.progress : undefined,
    indexVersion: typeof resp.indexVersion === "string" ? resp.indexVersion : undefined,
    error: typeof resp.error === "string" ? resp.error : undefined,
  };
}
