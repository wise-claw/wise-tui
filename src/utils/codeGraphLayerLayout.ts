import Graph from "graphology";
import type { CodeGraphSigmaEdgeAttrs, CodeGraphSigmaNodeAttrs } from "./codeGraphSigmaAdapter";

/** 与 Rust `subgraph::hop_after_edge` 一致：`contains` 不增加 hop 计数 */
export function hopAfterEdge(edgeKind: string, currentHop: number): number {
  return edgeKind === "contains" ? currentHop : currentHop + 1;
}

const INF = 0x3f3f3f3f;

/**
 * 在「双向」语义下从根做 Bellman-Ford 式松弛（与后端子图 hop 代价一致），
 * 得到每个节点相对根的 hop 距离（非 `contains` 边 +1）。
 */
export function computeLayerDepthsFromRoot(
  graph: Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs>,
  rootId: string,
): Map<string, number> | null {
  if (!graph.hasNode(rootId)) return null;

  const dist = new Map<string, number>();
  for (const id of graph.nodes()) dist.set(id, INF);
  dist.set(rootId, 0);

  const n = graph.order;
  for (let iter = 0; iter < Math.max(1, n); iter++) {
    let changed = false;
    graph.forEachEdge((_edge, attrs, source, target) => {
      const kind = (attrs as CodeGraphSigmaEdgeAttrs).relationType ?? "imports";
      const relax = (u: string, v: string) => {
        const du = dist.get(u)!;
        if (du >= INF) return;
        const nd = hopAfterEdge(kind, du);
        if (nd < dist.get(v)!) {
          dist.set(v, nd);
          changed = true;
        }
      };
      relax(source, target);
      relax(target, source);
    });
    if (!changed) break;
  }

  return dist;
}

const ROW_STEP = 92;
const COL_MIN = 108;

/**
 * 将根放在顶部，按 hop 距离自上而下铺开（同距离水平居中），与工具栏 hop 上限对应。
 */
export function assignLayeredLayoutFromRoot(
  graph: Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs>,
  rootId: string,
): boolean {
  const dist = computeLayerDepthsFromRoot(graph, rootId);
  if (!dist) return false;

  const byDepth = new Map<number, string[]>();
  let maxDepth = 0;
  for (const node of graph.nodes()) {
    const d = dist.get(node)!;
    if (d >= INF) continue;
    maxDepth = Math.max(maxDepth, d);
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(node);
  }

  for (const [, ids] of byDepth) {
    ids.sort((a, b) => {
      const la = graph.getNodeAttribute(a, "label") ?? a;
      const lb = graph.getNodeAttribute(b, "label") ?? b;
      return la.localeCompare(lb, undefined, { sensitivity: "base" });
    });
  }

  const placed = new Set<string>();

  for (let depth = 0; depth <= maxDepth; depth++) {
    const row = byDepth.get(depth);
    if (!row?.length) continue;
    const spread = Math.max(COL_MIN, Math.min(220, 420 / Math.sqrt(row.length)));
    const n = row.length;
    for (let i = 0; i < n; i++) {
      const id = row[i]!;
      placed.add(id);
      const x = (i - (n - 1) / 2) * spread;
      const y = depth * ROW_STEP;
      graph.setNodeAttribute(id, "x", x);
      graph.setNodeAttribute(id, "y", y);
      const base = graph.getNodeAttribute(id, "size") ?? 6;
      graph.setNodeAttribute(id, "size", id === rootId ? base * 1.35 : base);
    }
  }

  const fringe: string[] = [];
  for (const id of graph.nodes()) {
    if (placed.has(id)) continue;
    if (dist.get(id)! < INF) continue;
    fringe.push(id);
  }
  if (fringe.length) {
    fringe.sort((a, b) =>
      (graph.getNodeAttribute(a, "label") ?? a).localeCompare(
        graph.getNodeAttribute(b, "label") ?? b,
        undefined,
        { sensitivity: "base" },
      ),
    );
    const y = (maxDepth + 2) * ROW_STEP;
    const spread = Math.max(COL_MIN, Math.min(200, 400 / Math.sqrt(fringe.length)));
    const n = fringe.length;
    for (let i = 0; i < n; i++) {
      const id = fringe[i]!;
      const x = (i - (n - 1) / 2) * spread;
      graph.setNodeAttribute(id, "x", x);
      graph.setNodeAttribute(id, "y", y);
    }
  }

  return true;
}

/**
 * 以 `centerId` 为心、在「双向」语义下按 hop 代价（与 `computeLayerDepthsFromRoot` 一致）裁剪：
 * `hopLimit === "all"` 或未选中心时显示全部；否则隐藏 `dist > hopLimit` 的节点及两端任一端被隐藏的边。
 */
export function applyHopNeighborhoodMask(
  graph: Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs>,
  centerId: string | null,
  hopLimit: number | "all",
): void {
  for (const node of graph.nodes()) {
    graph.setNodeAttribute(node, "hidden", false);
  }
  graph.forEachEdge((edge) => {
    graph.setEdgeAttribute(edge, "hidden", false);
  });

  if (hopLimit === "all" || !centerId || !graph.hasNode(centerId)) {
    return;
  }

  const dist = computeLayerDepthsFromRoot(graph, centerId);
  if (!dist) return;

  const L = hopLimit;
  for (const node of graph.nodes()) {
    const d = dist.get(node)!;
    const hide = d >= INF || d > L;
    graph.setNodeAttribute(node, "hidden", hide);
  }

  graph.forEachEdge((edge, _attrs, s, t) => {
    const hs = graph.getNodeAttribute(s, "hidden");
    const ht = graph.getNodeAttribute(t, "hidden");
    graph.setEdgeAttribute(edge, "hidden", Boolean(hs || ht));
  });
}
