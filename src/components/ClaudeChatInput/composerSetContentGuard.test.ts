import { describe, expect, test } from "bun:test";
import { shouldSkipStaleComposerSetContent } from "./composerSetContentGuard";

describe("shouldSkipStaleComposerSetContent", () => {
  test("allows programmatic set when editor still has partial @ query", () => {
    expect(
      shouldSkipStaleComposerSetContent("@Claude", "@Claude Code ", true),
    ).toBe(false);
  });

  test("skips stale set when user typed after @ completion", () => {
    expect(
      shouldSkipStaleComposerSetContent("@Claude Code 你好", "@Claude Code ", true),
    ).toBe(true);
  });

  test("does not skip external sync while editor is blurred", () => {
    expect(
      shouldSkipStaleComposerSetContent("@Claude Code 你好", "@Claude Code ", false),
    ).toBe(false);
  });

  test("treats zero-width chars as equivalent when deciding stale setContent", () => {
    expect(
      shouldSkipStaleComposerSetContent(
        "@Claude Code\uFEFF你好",
        "@Claude Code ",
        true,
      ),
    ).toBe(true);
  });
});
