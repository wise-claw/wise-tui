import type { GraphEdge, GraphEdgeKind, GraphNode } from "../types/codeKnowledgeGraph";

/**
 * 邻接列表每一行展示「邻接点」与关系标签。
 * - `out`：边为 选中 → 邻接点
 * - `in`：边为 邻接点 → 选中
 */
const EDGE_NEIGHBOR_LABELS: Record<GraphEdgeKind, { out: string; in: string }> = {
  contains: { out: "包含", in: "包含于" },
  defines: { out: "定义", in: "定义于" },
  has_method: { out: "声明方法", in: "方法所属" },
  has_property: { out: "声明属性", in: "属性所属" },
  imports: { out: "导入", in: "导入方" },
  calls: { out: "调用", in: "调用方" },
  writes: { out: "写入", in: "写入方" },
  extends: { out: "继承", in: "父类型" },
  implements: { out: "实现", in: "接口方" },
  frontend_invokes_api: { out: "调用 API", in: "API 调用方" },
  backend_serves_api: { out: "提供 API", in: "API 提供方" },
  cross_repo: { out: "跨仓关联", in: "跨仓关联" },
};

export interface CodeGraphNeighborEntry {
  node: GraphNode;
  /** 与选中点之间的边关系（已去重、排序） */
  relations: string[];
}

const DEFAULT_MAX_VISIBLE = 100;

/**
 * 基于当前子图边列表，枚举与 `selectedId` 直接相邻的节点及关系文案。
 * 仅包含 `nodes` 中存在的邻接点（与子图节点集合一致）。
 */
export function computeSelectedNodeNeighbors(
  nodes: GraphNode[],
  edges: GraphEdge[],
  selectedId: string,
  options?: { maxVisible?: number },
): { visible: CodeGraphNeighborEntry[]; totalNeighborCount: number } {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const neighborRel = new Map<string, Set<string>>();

  for (const e of edges) {
    if (e.source === e.target) continue;

    let neighborId: string | null = null;
    let direction: "out" | "in" | null = null;
    if (e.source === selectedId) {
      neighborId = e.target;
      direction = "out";
    } else if (e.target === selectedId) {
      neighborId = e.source;
      direction = "in";
    }
    if (neighborId == null || direction == null) continue;

    const labels = EDGE_NEIGHBOR_LABELS[e.kind as GraphEdgeKind];
    const text =
      labels != null ? labels[direction] : `${String(e.kind)}（${direction === "out" ? "出边" : "入边"}）`;

    let set = neighborRel.get(neighborId);
    if (set == null) {
      set = new Set<string>();
      neighborRel.set(neighborId, set);
    }
    set.add(text);
  }

  const entries: CodeGraphNeighborEntry[] = [];
  for (const [nid, relSet] of neighborRel) {
    const node = nodeMap.get(nid);
    if (node == null) continue;
    entries.push({
      node,
      relations: [...relSet].sort((a, b) => a.localeCompare(b, "zh-Hans")),
    });
  }

  entries.sort(
    (a, b) =>
      a.node.label.localeCompare(b.node.label, "zh-Hans") || a.node.id.localeCompare(b.node.id, "utf-8"),
  );

  const maxVisible = options?.maxVisible ?? DEFAULT_MAX_VISIBLE;
  const total = entries.length;
  return {
    visible: entries.slice(0, maxVisible),
    totalNeighborCount: total,
  };
}
