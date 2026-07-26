import { describe, expect, test } from "bun:test";
import {
  isBlockingCodeReviewRecommendation,
  normalizeCodeReviewSettings,
} from "./codeReviewSettings";

describe("normalizeCodeReviewSettings", () => {
  test("defaults on invalid input", () => {
    expect(normalizeCodeReviewSettings(null).prePushMode).toBe("off");
    expect(normalizeCodeReviewSettings({}).defaultScope).toBe("uncommitted");
    expect(normalizeCodeReviewSettings({}).reuseIdenticalDiff).toBe(true);
    expect(normalizeCodeReviewSettings({}).autoReviewAfterCommit).toBe(false);
    expect(normalizeCodeReviewSettings({}).staleFindingsPolicy).toBe("dim");
    expect(normalizeCodeReviewSettings({ staleFindingsPolicy: "nope" }).staleFindingsPolicy).toBe(
      "dim",
    );
  });

  test("keeps valid fields", () => {
    const next = normalizeCodeReviewSettings({
      prePushMode: "block",
      defaultScope: "branch",
      reuseIdenticalDiff: false,
      autoReviewAfterCommit: true,
      staleFindingsPolicy: "clear",
    });
    expect(next.prePushMode).toBe("block");
    expect(next.defaultScope).toBe("branch");
    expect(next.reuseIdenticalDiff).toBe(false);
    expect(next.autoReviewAfterCommit).toBe(true);
    expect(next.staleFindingsPolicy).toBe("clear");
  });
});

describe("isBlockingCodeReviewRecommendation", () => {
  test("blocks REQUEST_CHANGES with HIGH confidence finding", () => {
    expect(
      isBlockingCodeReviewRecommendation("REQUEST_CHANGES", [
        { severity: "HIGH", confidence: "HIGH" },
      ]),
    ).toBe(true);
  });

  test("does not block LOW-only findings", () => {
    expect(
      isBlockingCodeReviewRecommendation("COMMENT", [
        { severity: "LOW", confidence: "HIGH" },
      ]),
    ).toBe(false);
  });
});
