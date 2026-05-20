import { describe, expect, test } from "bun:test";
import type { Repository } from "../types";
import { resolveSidebarSelectionTarget } from "./sidebarSelectionTarget";

function repo(input: Partial<Repository> & Pick<Repository, "id" | "path">): Repository {
  return {
    id: input.id,
    name: input.name ?? `repo-${input.id}`,
    path: input.path,
    repositoryType: input.repositoryType ?? "frontend",
    createdAt: "0",
    updatedAt: "0",
    mainOwnerAgentName: input.mainOwnerAgentName,
    sddMode: input.sddMode,
  };
}

describe("resolveSidebarSelectionTarget", () => {
  test("always opens per-repo session at repository.path", () => {
    const r = repo({ id: 2, path: "/work/p/b", name: "backend" });
    const result = resolveSidebarSelectionTarget({ repository: r });
    expect(result).toEqual({
      path: "/work/p/b",
      displayName: "b",
    });
  });
});
