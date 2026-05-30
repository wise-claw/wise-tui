import { describe, expect, it } from "bun:test";
import { hasGitWorkspaceChanges } from "./gitWorkspaceSync";
import type { GitStatusResponse } from "../types";

function makeStatus(partial: Partial<GitStatusResponse> = {}): GitStatusResponse {
  return {
    staged: [],
    unstaged: [],
    branch: "master",
    additions: 0,
    deletions: 0,
    ahead: 0,
    behind: 0,
    upstream: null,
    ...partial,
  };
}

describe("hasGitWorkspaceChanges", () => {
  it("detects staged or unstaged files", () => {
    expect(hasGitWorkspaceChanges(makeStatus())).toBe(false);
    expect(
      hasGitWorkspaceChanges(
        makeStatus({ unstaged: [{ path: "a.ts", status: "M", additions: 1, deletions: 0 }] }),
      ),
    ).toBe(true);
  });
});
