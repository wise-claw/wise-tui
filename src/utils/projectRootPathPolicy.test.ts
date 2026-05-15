import { describe, expect, test } from "bun:test";
import { isRepositoryPathUnderProjectRoot } from "./projectRootPathPolicy";

describe("isRepositoryPathUnderProjectRoot", () => {
  test("equal paths", () => {
    expect(isRepositoryPathUnderProjectRoot("/work/p", "/work/p")).toBe(true);
  });

  test("child under root", () => {
    expect(isRepositoryPathUnderProjectRoot("/work/p", "/work/p/web")).toBe(true);
  });

  test("sibling not under", () => {
    expect(isRepositoryPathUnderProjectRoot("/work/p", "/work/q")).toBe(false);
  });

  test("backslash normalization on Windows-style strings", () => {
    expect(isRepositoryPathUnderProjectRoot("D:/root", "D:/root/sub")).toBe(true);
  });
});
