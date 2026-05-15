import { describe, expect, it } from "bun:test";
import { computeSelectedNodeNeighbors } from "./codeGraphSelectedNeighbors";
import type { GraphEdge, GraphNode } from "../types/codeKnowledgeGraph";

describe("computeSelectedNodeNeighbors", () => {
  const nodes: GraphNode[] = [
    { id: "a", kind: "symbol", label: "fnA", path: "a.ts", repoId: 1 },
    { id: "b", kind: "symbol", label: "fnB", path: "b.ts", repoId: 1 },
    { id: "c", kind: "file", label: "c.ts", path: "c.ts", repoId: 1 },
  ];

  it("collects outgoing and incoming relation labels", () => {
    const edges: GraphEdge[] = [
      { id: "e1", source: "a", target: "b", kind: "calls" },
      { id: "e2", source: "c", target: "a", kind: "defines" },
    ];
    const { visible, totalNeighborCount } = computeSelectedNodeNeighbors(nodes, edges, "a");
    expect(totalNeighborCount).toBe(2);
    const byId = Object.fromEntries(visible.map((x) => [x.node.id, x.relations]));
    expect(byId.b).toEqual(["调用"]);
    expect(byId.c).toEqual(["定义于"]);
  });

  it("dedupes same neighbor + kind direction", () => {
    const edges: GraphEdge[] = [
      { id: "e1", source: "a", target: "b", kind: "calls" },
      { id: "e2", source: "a", target: "b", kind: "calls" },
    ];
    const { visible, totalNeighborCount } = computeSelectedNodeNeighbors(nodes, edges, "a");
    expect(totalNeighborCount).toBe(1);
    expect(visible[0]?.relations).toEqual(["调用"]);
  });

  it("respects maxVisible", () => {
    const many: GraphNode[] = [
      { id: "center", kind: "symbol", label: "c", path: "x.ts", repoId: 1 },
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `n${i}`,
        kind: "symbol" as const,
        label: `z${i}`,
        path: `${i}.ts`,
        repoId: 1,
      })),
    ];
    const edges: GraphEdge[] = many.slice(1).map((n, i) => ({
      id: `e${i}`,
      source: "center",
      target: n.id,
      kind: "calls" as const,
    }));
    const { visible, totalNeighborCount } = computeSelectedNodeNeighbors(many, edges, "center", {
      maxVisible: 2,
    });
    expect(totalNeighborCount).toBe(5);
    expect(visible).toHaveLength(2);
  });

  it("ignores neighbors not present in nodes array", () => {
    const edges: GraphEdge[] = [{ id: "e1", source: "a", target: "missing", kind: "calls" }];
    const { visible, totalNeighborCount } = computeSelectedNodeNeighbors(nodes, edges, "a");
    expect(totalNeighborCount).toBe(0);
    expect(visible).toHaveLength(0);
  });
});
