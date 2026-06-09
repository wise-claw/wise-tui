import { describe, expect, test } from "bun:test";
import {
  commitWorkspaceTodoCountsSnapshotForTests,
  getWorkspaceTodoIncompleteCount,
  subscribeWorkspaceTodoCountsForScope,
} from "./workspaceTodoCountsStore";

describe("workspaceTodoCountsStore", () => {
  test("scoped subscription ignores unrelated repository count changes", () => {
    commitWorkspaceTodoCountsSnapshotForTests({ byProjectId: {}, byRepositoryId: {} });
    let repoARevision = 0;
    let repoBRevision = 0;
    const unsubA = subscribeWorkspaceTodoCountsForScope("repository", null, 1, () => {
      repoARevision += 1;
    });
    const unsubB = subscribeWorkspaceTodoCountsForScope("repository", null, 2, () => {
      repoBRevision += 1;
    });

    commitWorkspaceTodoCountsSnapshotForTests({
      byProjectId: {},
      byRepositoryId: { 1: 3 },
    });
    expect(getWorkspaceTodoIncompleteCount("repository", null, 1)).toBe(3);
    expect(repoARevision).toBe(1);
    expect(repoBRevision).toBe(0);

    commitWorkspaceTodoCountsSnapshotForTests({
      byProjectId: {},
      byRepositoryId: { 1: 3, 2: 1 },
    });
    expect(repoARevision).toBe(1);
    expect(repoBRevision).toBe(1);

    unsubA();
    unsubB();
  });
});
