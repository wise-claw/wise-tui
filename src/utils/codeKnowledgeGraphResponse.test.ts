import { describe, expect, test } from "bun:test";
import {
  parseCodeGraphSubgraphResponse,
  parseCodeGraphIndexStatusResponse,
} from "./codeKnowledgeGraphResponse";

const validResponse = {
  nodes: [
    { id: "1:repo:root", kind: "repo", label: "repo", path: "/", repoId: 1 },
    { id: "1:file:abc", kind: "file", label: "index.ts", path: "src/index.ts", repoId: 1 },
    { id: "1:file:abc:symbol:foo", kind: "symbol", symbolKind: "function", label: "foo", path: "src/index.ts", repoId: 1 },
  ],
  edges: [
    { id: "e1", source: "1:repo:root", target: "1:file:abc", kind: "contains" },
    { id: "e2", source: "1:file:abc", target: "1:file:abc:symbol:foo", kind: "contains" },
  ],
  meta: { truncated: false, indexVersion: "v1", totalEdgeHint: 2 },
};

describe("parseCodeGraphSubgraphResponse", () => {
  test("accepts valid response", () => {
    const result = parseCodeGraphSubgraphResponse(validResponse);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    expect(result.meta.truncated).toBe(false);
  });

  test("rejects non-object", () => {
    expect(() => parseCodeGraphSubgraphResponse(null)).toThrow("not an object");
    expect(() => parseCodeGraphSubgraphResponse("string")).toThrow("not an object");
  });

  test("rejects missing nodes array", () => {
    expect(() => parseCodeGraphSubgraphResponse({ edges: [], meta: { truncated: false, indexVersion: "v1" } })).toThrow("nodes must be an array");
  });

  test("rejects missing edges array", () => {
    expect(() => parseCodeGraphSubgraphResponse({ nodes: [], meta: { truncated: false, indexVersion: "v1" } })).toThrow("edges must be an array");
  });

  test("rejects invalid node kind", () => {
    const bad = {
      ...validResponse,
      nodes: [{ id: "x", kind: "invalid_kind", label: "x", path: "x", repoId: 1 }],
    };
    expect(() => parseCodeGraphSubgraphResponse(bad)).toThrow("invalid node");
  });

  test("rejects invalid edge kind", () => {
    const bad = {
      ...validResponse,
      edges: [{ id: "x", source: "a", target: "b", kind: "invalid_kind" }],
    };
    expect(() => parseCodeGraphSubgraphResponse(bad)).toThrow("invalid edge");
  });

  test("rejects missing meta", () => {
    expect(() => parseCodeGraphSubgraphResponse({ nodes: [], edges: [] })).toThrow("invalid meta");
  });

  test("accepts response with errors in meta", () => {
    const withErrors = {
      ...validResponse,
      meta: { truncated: false, indexVersion: "v1", errors: [{ file: "bad.ts", message: "parse failed" }] },
    };
    const result = parseCodeGraphSubgraphResponse(withErrors);
    expect(result.meta.errors).toHaveLength(1);
  });

  test("filters out invalid nodes from result array", () => {
    const mixed = {
      ...validResponse,
      nodes: [
        { id: "1:repo:root", kind: "repo", label: "repo", path: "/", repoId: 1 },
        { garbage: true },
      ],
    };
    expect(() => parseCodeGraphSubgraphResponse(mixed)).toThrow("invalid node");
  });
});

describe("parseCodeGraphIndexStatusResponse", () => {
  test("accepts valid done status", () => {
    const result = parseCodeGraphIndexStatusResponse({
      status: "done",
      repositoryId: 1,
      progress: 100,
      indexVersion: "v1",
    });
    expect(result.status).toBe("done");
    expect(result.repositoryId).toBe(1);
    expect(result.progress).toBe(100);
  });

  test("accepts idle status with optional fields omitted", () => {
    const result = parseCodeGraphIndexStatusResponse({
      status: "idle",
      repositoryId: 1,
    });
    expect(result.status).toBe("idle");
    expect(result.progress).toBeUndefined();
    expect(result.indexVersion).toBeUndefined();
  });

  test("rejects invalid status", () => {
    expect(() => parseCodeGraphIndexStatusResponse({ status: "unknown", repositoryId: 1 })).toThrow("Invalid index status");
  });

  test("rejects non-object", () => {
    expect(() => parseCodeGraphIndexStatusResponse(null)).toThrow("not an object");
  });

  test("rejects missing repositoryId", () => {
    expect(() => parseCodeGraphIndexStatusResponse({ status: "done" })).toThrow("repositoryId must be a number");
  });
});
