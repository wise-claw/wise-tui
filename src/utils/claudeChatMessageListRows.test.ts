import { describe, expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import {
  buildChatMessageListRows,
  shouldShowListEndThinkingHint,
} from "./claudeChatMessageListRows";

function msg(partial: Partial<ClaudeMessage> & Pick<ClaudeMessage, "id" | "role">): ClaudeMessage {
  return {
    id: partial.id,
    role: partial.role,
    content: partial.content ?? "",
    timestamp: partial.timestamp ?? Date.now(),
    parts: partial.parts,
  };
}

describe("shouldShowListEndThinkingHint", () => {
  test("shows when running and last message is user", () => {
    expect(
      shouldShowListEndThinkingHint([msg({ id: 1, role: "user", content: "hi" })], "running"),
    ).toBe(true);
  });

  test("hides when idle", () => {
    expect(
      shouldShowListEndThinkingHint([msg({ id: 1, role: "user", content: "hi" })], "idle"),
    ).toBe(false);
  });
});

describe("buildChatMessageListRows", () => {
  test("skips empty assistant noise and appends thinking hint", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "hello" }),
      msg({ id: 2, role: "assistant", content: "no response requested." }),
      msg({ id: 3, role: "assistant", content: "world" }),
    ];
    const rows = buildChatMessageListRows(messages, {
      sessionStatus: "running",
      showListEndThinkingHint: true,
    });
    expect(rows.map((r) => r.kind)).toEqual(["message", "message", "thinking-hint"]);
    expect(rows[0]!.kind === "message" && rows[0]!.msg.id).toBe(1);
    expect(rows[1]!.kind === "message" && rows[1]!.streamingThisBubble).toBe(true);
  });

  test("merges consecutive same-sender rows", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "a" }),
      msg({ id: 2, role: "user", content: "b" }),
    ];
    const rows = buildChatMessageListRows(messages, {
      sessionStatus: "idle",
      showListEndThinkingHint: false,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.kind === "message" && rows[0]!.mergedWithPrevious).toBe(false);
    expect(rows[1]!.kind === "message" && rows[1]!.mergedWithPrevious).toBe(true);
  });
});
