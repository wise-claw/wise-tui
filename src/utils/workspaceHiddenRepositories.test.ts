import { describe, expect, test } from "bun:test";
import type { Repository } from "../types";
import {
  filterVisibleWorkspaceRepositories,
  normalizeHiddenRepositoryIds,
  parseHiddenRepositoryIdsFromSetting,
  toggleHiddenRepositoryId,
} from "./workspaceHiddenRepositories";

function makeRepo(id: number, name: string): Repository {
  return {
    id,
    name,
    path: `/work/${name}`,
    repositoryType: "local",
    createdAt: "0",
    updatedAt: "0",
  } as Repository;
}

describe("parseHiddenRepositoryIdsFromSetting", () => {
  test("parses positive integer ids", () => {
    expect(parseHiddenRepositoryIdsFromSetting("[3,1,2]")).toEqual([3, 1, 2]);
  });

  test("returns empty for invalid payload", () => {
    expect(parseHiddenRepositoryIdsFromSetting("nope")).toEqual([]);
    expect(parseHiddenRepositoryIdsFromSetting(null)).toEqual([]);
  });
});

describe("normalizeHiddenRepositoryIds", () => {
  test("prunes missing ids and duplicates", () => {
    expect(normalizeHiddenRepositoryIds([9, 2, 2, 1], [1, 2, 3])).toEqual([2, 1]);
  });
});

describe("toggleHiddenRepositoryId", () => {
  test("hides and unhides without duplicating", () => {
    expect(toggleHiddenRepositoryId([], 2, true)).toEqual([2]);
    expect(toggleHiddenRepositoryId([2, 3], 2, true)).toEqual([2, 3]);
    expect(toggleHiddenRepositoryId([2, 3], 2, false)).toEqual([3]);
  });

  test("ignores invalid ids", () => {
    expect(toggleHiddenRepositoryId([1], 0, true)).toEqual([1]);
    expect(toggleHiddenRepositoryId([1], Number.NaN, true)).toEqual([1]);
  });
});

describe("filterVisibleWorkspaceRepositories", () => {
  test("keeps all when nothing is hidden", () => {
    const repos = [makeRepo(1, "a"), makeRepo(2, "b")];
    expect(filterVisibleWorkspaceRepositories(repos, []).map((r) => r.id)).toEqual([1, 2]);
  });

  test("drops hidden ids", () => {
    const repos = [makeRepo(1, "a"), makeRepo(2, "b"), makeRepo(3, "c")];
    expect(filterVisibleWorkspaceRepositories(repos, [2]).map((r) => r.id)).toEqual([1, 3]);
  });
});
