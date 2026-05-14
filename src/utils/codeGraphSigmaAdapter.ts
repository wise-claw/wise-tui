import Graph from "graphology";
import type { CodeGraphSubgraphResponse, GraphEdgeKind, GraphNode, GraphNodeKind } from "../types/codeKnowledgeGraph";

/** Sigma node attrs — aligned with GitNexus `SigmaNodeAttributes` + Wise domain fields */
export interface CodeGraphSigmaNodeAttrs {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  nodeKind: GraphNodeKind;
  path: string;
  hidden?: boolean;
  zIndex?: number;
  highlighted?: boolean;
  mass?: number;
}

export interface CodeGraphSigmaEdgeAttrs {
  size: number;
  color: string;
  relationType: string;
  type?: string;
  curvature?: number;
  hidden?: boolean;
  zIndex?: number;
}

const NODE_COLORS: Record<GraphNodeKind, string> = {
  repo: "#1890ff",
  folder: "#52c41a",
  file: "#faad14",
  symbol: "#eb2f96",
  api_operation: "#722ed1",
  schema: "#13c2c2",
};

const NODE_SIZES: Record<GraphNodeKind, number> = {
  repo: 14,
  folder: 10,
  file: 6,
  symbol: 4,
  api_operation: 5,
  schema: 5,
};

const EDGE_STYLES: Record<GraphEdgeKind, { color: string; sizeMultiplier: number }> = {
  contains: { color: "#2d5a3d", sizeMultiplier: 0.4 },
  imports: { color: "#1d4ed8", sizeMultiplier: 0.6 },
  calls: { color: "#7c3aed", sizeMultiplier: 0.8 },
  implements: { color: "#be185d", sizeMultiplier: 0.9 },
  frontend_invokes_api: { color: "#722ed1", sizeMultiplier: 0.7 },
  backend_serves_api: { color: "#13c2c2", sizeMultiplier: 0.7 },
  cross_repo: { color: "#8b5cf6", sizeMultiplier: 0.75 },
};

const DEFAULT_NODE_COLOR = "#9ca3af";
const DEFAULT_EDGE_COLOR = "#4a4a5a";

const getScaledNodeSize = (baseSize: number, nodeCount: number): number => {
  if (nodeCount > 50000) return Math.max(1, baseSize * 0.4);
  if (nodeCount > 20000) return Math.max(1.5, baseSize * 0.5);
  if (nodeCount > 5000) return Math.max(2, baseSize * 0.65);
  if (nodeCount > 1000) return Math.max(2.5, baseSize * 0.8);
  return baseSize;
};

const getNodeMass = (kind: GraphNodeKind, nodeCount: number): number => {
  const m = nodeCount > 5000 ? 2 : nodeCount > 1000 ? 1.5 : 1;
  switch (kind) {
    case "repo":
      return 50 * m;
    case "folder":
      return 15 * m;
    case "file":
      return 3 * m;
    case "symbol":
      return 2 * m;
    case "api_operation":
      return 2 * m;
    case "schema":
      return 3 * m;
    default:
      return 1;
  }
};

/**
 * Converts Wise code subgraph JSON into a graphology graph for Sigma,
 * using the same hierarchical seeding strategy as GitNexus `knowledgeGraphToGraphology`.
 */
export function codeSubgraphToGraphology(d: CodeGraphSubgraphResponse): Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs> {
  const graph = new Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs>();
  const nodeCount = d.nodes.length;
  const nodeMap = new Map(d.nodes.map((n) => [n.id, n]));

  const parentToChildren = new Map<string, string[]>();
  const childToParent = new Map<string, string>();

  for (const e of d.edges) {
    if (e.kind !== "contains") continue;
    if (!parentToChildren.has(e.source)) parentToChildren.set(e.source, []);
    parentToChildren.get(e.source)!.push(e.target);
    childToParent.set(e.target, e.source);
  }

  const structuralKinds = new Set<GraphNodeKind>(["repo", "folder"]);
  const structuralNodes = d.nodes.filter((n) => structuralKinds.has(n.kind));

  const structuralSpread = Math.sqrt(nodeCount) * 40;
  const childJitter = Math.sqrt(nodeCount) * 3;
  const nodePositions = new Map<string, { x: number; y: number }>();

  const labelText = (n: GraphNode) => (n.label.length > 48 ? `${n.label.slice(0, 48)}…` : n.label);

  structuralNodes.forEach((node, index) => {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const angle = index * goldenAngle;
    const radius = structuralSpread * Math.sqrt((index + 1) / Math.max(structuralNodes.length, 1));
    const jitter = structuralSpread * 0.15;
    const x = radius * Math.cos(angle) + (Math.random() - 0.5) * jitter;
    const y = radius * Math.sin(angle) + (Math.random() - 0.5) * jitter;
    nodePositions.set(node.id, { x, y });

    const baseSize = NODE_SIZES[node.kind] ?? 8;
    const scaledSize = getScaledNodeSize(baseSize, nodeCount);

    graph.addNode(node.id, {
      x,
      y,
      size: scaledSize,
      color: NODE_COLORS[node.kind] ?? DEFAULT_NODE_COLOR,
      label: labelText(node),
      nodeKind: node.kind,
      path: node.path,
      hidden: false,
      mass: getNodeMass(node.kind, nodeCount),
    });
  });

  const addNodeWithPosition = (nodeId: string) => {
    if (graph.hasNode(nodeId)) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;

    let x: number;
    let y: number;
    const parentId = childToParent.get(nodeId);
    const parentPos = parentId ? nodePositions.get(parentId) : null;

    if (parentPos) {
      x = parentPos.x + (Math.random() - 0.5) * childJitter;
      y = parentPos.y + (Math.random() - 0.5) * childJitter;
    } else {
      x = (Math.random() - 0.5) * structuralSpread * 0.5;
      y = (Math.random() - 0.5) * structuralSpread * 0.5;
    }

    nodePositions.set(nodeId, { x, y });

    const baseSize = NODE_SIZES[node.kind] ?? 8;
    const scaledSize = getScaledNodeSize(baseSize, nodeCount);

    graph.addNode(nodeId, {
      x,
      y,
      size: scaledSize,
      color: NODE_COLORS[node.kind] ?? DEFAULT_NODE_COLOR,
      label: labelText(node),
      nodeKind: node.kind,
      path: node.path,
      hidden: false,
      mass: getNodeMass(node.kind, nodeCount),
    });
  };

  const queue: string[] = [...structuralNodes.map((n) => n.id)];
  const visited = new Set<string>(queue);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = parentToChildren.get(currentId) || [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        addNodeWithPosition(childId);
        queue.push(childId);
      }
    }
  }

  d.nodes.forEach((node) => {
    if (!graph.hasNode(node.id)) addNodeWithPosition(node.id);
  });

  const nodeLookup = new Set(d.nodes.map((n) => n.id));
  const edgeBaseSize = nodeCount > 20000 ? 0.4 : nodeCount > 5000 ? 0.6 : 1.0;

  for (const rel of d.edges) {
    if (!nodeLookup.has(rel.source) || !nodeLookup.has(rel.target)) continue;
    if (graph.hasEdge(rel.source, rel.target)) continue;
    const style = EDGE_STYLES[rel.kind] ?? { color: DEFAULT_EDGE_COLOR, sizeMultiplier: 0.5 };
    const curvature = 0.12 + Math.random() * 0.08;
    graph.addEdge(rel.source, rel.target, {
      size: edgeBaseSize * style.sizeMultiplier,
      color: style.color,
      relationType: rel.kind,
      type: "curved",
      curvature,
    });
  }

  return graph;
}
