import { describe, expect, test } from "bun:test";
import {
  shouldApplyExplorerChildLoadResult,
  shouldApplyExplorerLoadResult,
} from "./repositoryExplorerLoad";

describe("shouldApplyExplorerChildLoadResult", () => {
  test("accepts when repository path unchanged", () => {
    expect(
      shouldApplyExplorerChildLoadResult({
        requestRepositoryPath: "/repo",
        currentRepositoryPath: "/repo",
      }),
    ).toBe(true);
  });

  test("rejects when repository path changed", () => {
    expect(
      shouldApplyExplorerChildLoadResult({
        requestRepositoryPath: "/a",
        currentRepositoryPath: "/b",
      }),
    ).toBe(false);
  });
});

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

  test("trims repository paths before compare", () => {
    expect(
      shouldApplyExplorerLoadResult({
        requestGeneration: 1,
        currentGeneration: 1,
        requestRepositoryPath: "/repo ",
        currentRepositoryPath: " /repo",
      }),
    ).toBe(true);
  });
});
