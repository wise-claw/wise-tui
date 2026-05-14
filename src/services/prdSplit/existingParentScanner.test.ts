import { describe, expect, test } from "bun:test";
import { indexParentsByClusterId, type ScannedParentTask } from "./existingParentScanner";

const sample = (overrides: Partial<ScannedParentTask> = {}): ScannedParentTask => ({
  parentTaskName: "05-13-fe-foo",
  parentTaskPath: "/abs/.trellis/tasks/05-13-fe-foo",
  clusterId: "cluster-frontend-1",
  primaryRepositoryId: 7,
  requirementsIndexJson: JSON.stringify({
    schemaVersion: 2,
    version: "abc",
    requirements: [{ id: "req-functional-1", content: "x", bodyHash: "0123456789abcdef" }],
  }),
  ...overrides,
});

describe("indexParentsByClusterId", () => {
  test("indexes a single parent task", () => {
    const m = indexParentsByClusterId([sample()]);
    expect(m.has("cluster-frontend-1")).toBe(true);
    expect(m.get("cluster-frontend-1")?.parentTaskName).toBe("05-13-fe-foo");
    expect(m.get("cluster-frontend-1")?.requirementsIndex?.requirements).toHaveLength(1);
  });

  test("keeps the latest parent name when clusterId repeats", () => {
    const m = indexParentsByClusterId([
      sample({ parentTaskName: "05-11-fe-foo" }),
      sample({ parentTaskName: "05-13-fe-foo" }),
      sample({ parentTaskName: "05-12-fe-foo" }),
    ]);
    expect(m.get("cluster-frontend-1")?.parentTaskName).toBe("05-13-fe-foo");
  });

  test("tolerates missing requirements-index json", () => {
    const m = indexParentsByClusterId([sample({ requirementsIndexJson: null })]);
    expect(m.get("cluster-frontend-1")?.requirementsIndex).toBeNull();
  });

  test("tolerates corrupted requirements-index json", () => {
    const m = indexParentsByClusterId([sample({ requirementsIndexJson: "not json" })]);
    expect(m.get("cluster-frontend-1")?.requirementsIndex).toBeNull();
  });
});
