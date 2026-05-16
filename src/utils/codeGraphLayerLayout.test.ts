import Graph from "graphology";
import { describe, expect, it } from "bun:test";
import { assignLayeredLayoutFromRoot, applyHopNeighborhoodMask, computeLayerDepthsFromRoot, hopAfterEdge } from "./codeGraphLayerLayout";
import type { CodeGraphSigmaNodeAttrs } from "./codeGraphSigmaAdapter";

function mkNode(id: string): CodeGraphSigmaNodeAttrs {
  return {
    x: 0,
    y: 0,
    size: 4,
    color: "#fff",
    label: id,
    nodeKind: "symbol",
    path: id,
  };
}

describe("codeGraphLayerLayout", () => {
  it("hopAfterEdge matches contains rule", () => {
    expect(hopAfterEdge("contains", 2)).toBe(2);
    expect(hopAfterEdge("imports", 2)).toBe(3);
  });

  it("computes depths along imports from root", () => {
    const g = new Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs>();
    g.addNode("A", mkNode("A"));
    g.addNode("B", mkNode("B"));
    g.addEdge("A", "B", { size: 1, color: "#000", relationType: "imports" });
    const d = computeLayerDepthsFromRoot(g, "A");
    expect(d?.get("A")).toBe(0);
    expect(d?.get("B")).toBe(1);
  });

  it("applyHopNeighborhoodMask hides nodes beyond hop limit", () => {
    const g = new Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs>();
    g.addNode("A", mkNode("A"));
    g.addNode("B", mkNode("B"));
    g.addNode("C", mkNode("C"));
    g.addEdge("A", "B", { size: 1, color: "#000", relationType: "imports" });
    g.addEdge("B", "C", { size: 1, color: "#000", relationType: "imports" });
    applyHopNeighborhoodMask(g, "A", 1);
    expect(g.getNodeAttribute("A", "hidden")).toBe(false);
    expect(g.getNodeAttribute("B", "hidden")).toBe(false);
    expect(g.getNodeAttribute("C", "hidden")).toBe(true);
  });

  it("assignLayeredLayoutFromRoot writes coordinates", () => {
    const g = new Graph<CodeGraphSigmaNodeAttrs, CodeGraphSigmaEdgeAttrs>();
    g.addNode("A", mkNode("A"));
    g.addNode("B", mkNode("B"));
    g.addEdge("A", "B", { size: 1, color: "#000", relationType: "imports" });
    expect(assignLayeredLayoutFromRoot(g, "A")).toBe(true);
    expect(typeof g.getNodeAttribute("A", "x")).toBe("number");
    expect(typeof g.getNodeAttribute("B", "y")).toBe("number");
  });
});
