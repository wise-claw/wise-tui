import { describe, expect, test } from "bun:test";
import {
  deriveFolderNameFromGitUrl,
  isValidRepositoryFolderName,
  validateRepositoryAcquireParams,
} from "./repositoryAcquire";

describe("deriveFolderNameFromGitUrl", () => {
  test("https url", () => {
    expect(deriveFolderNameFromGitUrl("https://github.com/org/wise.git")).toBe("wise");
  });

  test("ssh url", () => {
    expect(deriveFolderNameFromGitUrl("git@github.com:org/wise.git")).toBe("wise");
  });
});

describe("isValidRepositoryFolderName", () => {
  test("rejects path separators", () => {
    expect(isValidRepositoryFolderName("a/b")).toBe(false);
    expect(isValidRepositoryFolderName("ok-name")).toBe(true);
  });
});

describe("validateRepositoryAcquireParams", () => {
  test("create_empty requires parent and folder", () => {
    expect(
      validateRepositoryAcquireParams({ mode: "create_empty", parentPath: "/tmp", folderName: "app" }),
    ).toBeNull();
    expect(validateRepositoryAcquireParams({ mode: "create_empty", parentPath: "/tmp" })).toMatch(
      /文件夹/,
    );
  });

  test("git_clone requires url", () => {
    expect(
      validateRepositoryAcquireParams({
        mode: "git_clone",
        parentPath: "/tmp",
        gitUrl: "https://x/y.git",
      }),
    ).toBeNull();
    expect(
      validateRepositoryAcquireParams({ mode: "git_clone", parentPath: "/tmp", gitUrl: "" }),
    ).toMatch(/Git/);
  });
});
