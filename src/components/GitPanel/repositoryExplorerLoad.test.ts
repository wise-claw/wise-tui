import { describe, expect, test } from "bun:test";
import { shouldApplyExplorerLoadResult } from "./repositoryExplorerLoad";

describe("shouldApplyExplorerLoadResult", () => {
  test("rejects cancelled or generation mismatch", () => {
    expect(
      shouldApplyExplorerLoadResult({
        requestGeneration: 1,
        currentGeneration: 2,
        requestRepositoryPath: "/a",
        currentRepositoryPath: "/a",
      }),
    ).toBe(false);
    expect(
      shouldApplyExplorerLoadResult({
        requestGeneration: 1,
        currentGeneration: 1,
        requestRepositoryPath: "/a",
        currentRepositoryPath: "/a",
        cancelled: true,
      }),
    ).toBe(false);
  });

  test("rejects repository path change", () => {
    expect(
      shouldApplyExplorerLoadResult({
        requestGeneration: 3,
        currentGeneration: 3,
        requestRepositoryPath: "/old",
        currentRepositoryPath: "/new",
      }),
    ).toBe(false);
  });

  test("accepts matching generation and path", () => {
    expect(
      shouldApplyExplorerLoadResult({
        requestGeneration: 2,
        currentGeneration: 2,
        requestRepositoryPath: "/repo",
        currentRepositoryPath: "/repo",
      }),
    ).toBe(true);
  });
});
