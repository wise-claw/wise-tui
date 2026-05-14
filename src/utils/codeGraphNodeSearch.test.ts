import { describe, expect, it } from "bun:test";
import { filterGraphNodesForSearch } from "./codeGraphNodeSearch";
import type { GraphNode } from "../types/codeKnowledgeGraph";

const n = (id: string, label: string, path: string): GraphNode => ({
  id,
  kind: "file",
  label,
  path,
  repoId: 1,
});

describe("filterGraphNodesForSearch", () => {
  const nodes: GraphNode[] = [
    n("a", "alpha.ts", "src/a.ts"),
    n("b", "beta.ts", "src/b.ts"),
    n("c", "gamma", "src/api/tool/gen.js"),
  ];

  it("ranks prefix matches above substring", () => {
    const r = filterGraphNodesForSearch(nodes, "be", 10);
    expect(r[0]?.id).toBe("b");
  });

  it("respects maxResults", () => {
    const many = Array.from({ length: 100 }, (_, i) => n(`id${i}`, `file${i}.ts`, `p/${i}`));
    const r = filterGraphNodesForSearch(many, "file", 12);
    expect(r.length).toBe(12);
  });
});
