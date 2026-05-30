import { describe, expect, test } from "bun:test";
import {
  getRepositoryRunCommandState,
  pruneRepositoryRunCommandRuntime,
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
});
