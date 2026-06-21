import { describe, expect, test } from "bun:test";
import { isGitMergeConflictError } from "../../services/gitCommitPullPush";

describe("isGitMergeConflictError", () => {
  test("识别 git merge/rebase 冲突输出", () => {
    expect(isGitMergeConflictError("Pull failed: Auto-merging src/a.ts\nCONFLICT (content): Merge conflict in src/a.ts")).toBe(true);
    expect(isGitMergeConflictError("Pull failed: Automatic merge failed; fix conflicts and then commit the result.")).toBe(true);
    expect(isGitMergeConflictError("error: could not apply ... Automatic cherry-pick failed")).toBe(true);
  });

  test("大小写不敏感", () => {
    expect(isGitMergeConflictError("pull failed: CONFLICT (content): Merge conflict in x")).toBe(true);
    expect(isGitMergeConflictError("FIX CONFLICTS and commit")).toBe(true);
  });

  test("pre-commit / lint / 远程拒绝等非冲突失败不误判", () => {
    expect(isGitMergeConflictError("Commit failed: husky - pre-commit hook failed (lint)")).toBe(false);
    expect(isGitMergeConflictError("Push failed: ! [rejected] main -> main (fetch first)")).toBe(false);
    expect(isGitMergeConflictError("Push failed: error: failed to push some refs")).toBe(false);
    expect(isGitMergeConflictError("Commit failed: typecheck error in src/b.ts")).toBe(false);
    expect(isGitMergeConflictError("")).toBe(false);
  });
});
