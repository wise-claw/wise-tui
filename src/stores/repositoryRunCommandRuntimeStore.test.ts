import { describe, expect, test } from "bun:test";
import {
  getRepositoryRunCommandState,
  notifyRepositoryRunCommandRuntimeForTests,
  pruneRepositoryRunCommandRuntime,
  subscribeRepositoryRunCommandRuntimeForRepository,
} from "./repositoryRunCommandRuntimeStore";

describe("repositoryRunCommandRuntimeStore", () => {
  test("pruneRepositoryRunCommandRuntime drops idle state for removed repositories", () => {
    const repoId = 99_001;
    const state = getRepositoryRunCommandState(repoId);
    expect(state.status).toBe("idle");

    pruneRepositoryRunCommandRuntime(new Set([repoId]));
    expect(getRepositoryRunCommandState(repoId).status).toBe("idle");

    pruneRepositoryRunCommandRuntime(new Set());
    const after = getRepositoryRunCommandState(repoId);
    expect(after.status).toBe("idle");
  });

  test("per-repository subscription ignores updates for other repositories", () => {
    let repoARevision = 0;
    let repoBRevision = 0;
    const unsubA = subscribeRepositoryRunCommandRuntimeForRepository(1, () => {
      repoARevision += 1;
    });
    const unsubB = subscribeRepositoryRunCommandRuntimeForRepository(2, () => {
      repoBRevision += 1;
    });

    notifyRepositoryRunCommandRuntimeForTests(1);
    expect(repoARevision).toBe(1);
    expect(repoBRevision).toBe(0);

    notifyRepositoryRunCommandRuntimeForTests(2);
    expect(repoARevision).toBe(1);
    expect(repoBRevision).toBe(1);

    unsubA();
    unsubB();
  });
});
