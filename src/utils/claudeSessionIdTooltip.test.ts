import { describe, expect, it } from "bun:test";
import { buildClaudeSessionHoverTitle } from "./claudeSessionIdTooltip";

describe("buildClaudeSessionHoverTitle", () => {
  it("shows claude session id when bound", () => {
    expect(
      buildClaudeSessionHoverTitle({ id: "wise-tab-1", claudeSessionId: "claude-sid-9" }),
    ).toBe("Claude 会话 ID：claude-sid-9");
  });

  it("falls back to wise tab id when claude id missing", () => {
    expect(buildClaudeSessionHoverTitle({ id: "wise-tab-1", claudeSessionId: null })).toBe(
      "Claude 会话 ID：尚未绑定（Wise 标签：wise-tab-1）",
    );
  });
});
