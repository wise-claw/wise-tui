import type { GraphNode } from "../types/codeKnowledgeGraph";

const DEFAULT_MAX = 80;

/** 简单相关性：前缀 / 包含 / 路径 / id，单次 O(n) 扫描，适合子图千级节点 */
export function filterGraphNodesForSearch(
  nodes: readonly GraphNode[],
  needleRaw: string,
  maxResults: number = DEFAULT_MAX,
): GraphNode[] {
  const needle = needleRaw.trim().toLowerCase();
  if (needle.length === 0) return [];

  const scored: { node: GraphNode; score: number }[] = [];
  for (const n of nodes) {
    const lab = n.label.toLowerCase();
    const path = n.path.toLowerCase();
    const id = n.id.toLowerCase();
    let score = 0;
    if (lab === needle) score = 1000;
    else if (lab.startsWith(needle)) score = 500;
    else if (lab.includes(needle)) score = 300;
    else if (path.includes(needle)) score = 150;
    else if (id.includes(needle)) score = 50;
    else continue;
    scored.push({ node: n, score });
  }

  scored.sort((a, b) => {
    const d = b.score - a.score;
    if (d !== 0) return d;
    return a.node.label.localeCompare(b.node.label, undefined, { sensitivity: "base" });
  });

  return scored.slice(0, maxResults).map((s) => s.node);
}
