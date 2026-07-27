import { describe, expect, test } from "bun:test";
import type { Repository } from "../types";
import {
  normalizeWorkspaceRepositoryOrder,
  parseWorkspaceRepositoryOrderFromSetting,
  sortRepositoriesByWorkspaceOrder,
} from "./workspaceRepositoryOrder";

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

describe("parseWorkspaceRepositoryOrderFromSetting", () => {
  test("parses positive integer ids", () => {
    expect(parseWorkspaceRepositoryOrderFromSetting("[3,1,2]")).toEqual([3, 1, 2]);
  });

  test("returns empty for invalid payload", () => {
    expect(parseWorkspaceRepositoryOrderFromSetting("nope")).toEqual([]);
    expect(parseWorkspaceRepositoryOrderFromSetting(null)).toEqual([]);
  });
});

describe("sortRepositoriesByWorkspaceOrder", () => {
  test("falls back to basename when order empty", () => {
    const repos = [makeRepo(1, "zeta"), makeRepo(2, "alpha")];
    expect(sortRepositoriesByWorkspaceOrder(repos, []).map((r) => r.id)).toEqual([2, 1]);
  });

  test("respects custom order and appends missing by name", () => {
    const repos = [makeRepo(1, "zeta"), makeRepo(2, "alpha"), makeRepo(3, "mid")];
    expect(sortRepositoriesByWorkspaceOrder(repos, [3, 1]).map((r) => r.id)).toEqual([3, 1, 2]);
  });
});

describe("normalizeWorkspaceRepositoryOrder", () => {
  test("prunes missing and appends new ids", () => {
    expect(normalizeWorkspaceRepositoryOrder([9, 2, 1], [1, 2, 3])).toEqual([2, 1, 3]);
  });
});
