import { describe, expect, test } from "bun:test";
import { shouldDisableComposerCommonPhraseSend } from "./applyComposerCommonPhrase";

describe("shouldDisableComposerCommonPhraseSend", () => {
  test("disables send only when session busy", () => {
    expect(shouldDisableComposerCommonPhraseSend({ action: "send" }, true)).toBe(true);
    expect(shouldDisableComposerCommonPhraseSend({ action: "send" }, false)).toBe(false);
    expect(shouldDisableComposerCommonPhraseSend({ action: "insert" }, true)).toBe(false);
  });
});
