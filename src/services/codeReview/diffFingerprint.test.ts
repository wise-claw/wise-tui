import { describe, expect, test } from "bun:test";
import { fingerprintCodeReviewDiff } from "./diffFingerprint";

describe("fingerprintCodeReviewDiff", () => {
  test("is stable for identical inputs", () => {
    const a = fingerprintCodeReviewDiff({
      scope: "uncommitted",
      baseRef: null,
      filePaths: ["src/b.ts", "src/a.ts"],
      diffText: "diff --git a/src/a.ts b/src/a.ts\n+hello\n",
    });
    const b = fingerprintCodeReviewDiff({
      scope: "uncommitted",
      baseRef: null,
      filePaths: ["src/a.ts", "src/b.ts"],
      diffText: "diff --git a/src/a.ts b/src/a.ts\n+hello\n",
    });
    expect(a).toBe(b);
    expect(a.startsWith("crfp1:")).toBe(true);
  });

  test("changes when diff text changes", () => {
    const base = {
      scope: "branch",
      baseRef: "main",
      filePaths: ["x.ts"],
    };
    const a = fingerprintCodeReviewDiff({ ...base, diffText: "+a\n" });
    const b = fingerprintCodeReviewDiff({ ...base, diffText: "+b\n" });
    expect(a).not.toBe(b);
  });

  test("normalizes CRLF in diff text", () => {
    const a = fingerprintCodeReviewDiff({
      scope: "uncommitted",
      filePaths: ["f.ts"],
      diffText: "+line\r\n",
    });
    const b = fingerprintCodeReviewDiff({
      scope: "uncommitted",
      filePaths: ["f.ts"],
      diffText: "+line\n",
    });
    expect(a).toBe(b);
  });
});
