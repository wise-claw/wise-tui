import { describe, expect, it } from "bun:test";
import type { ChatMessageListRow } from "./claudeChatMessageListRows";
import {
  buildVirtualMessageListStructureFingerprint,
  estimateVirtualChatRowSize,
  VIRTUAL_ROW_ESTIMATE_CHAT,
  VIRTUAL_ROW_ESTIMATE_TOOL,
} from "./claudeVirtualMessageRowEstimate";

describe("estimateVirtualChatRowSize", () => {
  it("uses larger estimate for tool rows", () => {
    const row: ChatMessageListRow = {
      kind: "message",
      key: "1",
      originalIndex: 0,
      msg: {
        id: 1,
        role: "assistant",
        content: "",
        parts: [{ type: "tool_use", name: "Bash", input: {} }],
      },
      streamingThisBubble: false,
      mergedWithPrevious: false,
      toolUser: false,
    };
    expect(estimateVirtualChatRowSize(row, "chat")).toBeGreaterThan(VIRTUAL_ROW_ESTIMATE_CHAT);
    expect(estimateVirtualChatRowSize(row, "chat")).toBe(VIRTUAL_ROW_ESTIMATE_TOOL);
  });
});

describe("buildVirtualMessageListStructureFingerprint", () => {
  it("changes when row keys change but not when only message body grows", () => {
    const rowsA: ChatMessageListRow[] = [
      {
        kind: "message",
        key: "m1",
        originalIndex: 0,
        msg: { id: 1, role: "user", content: "hi" },
        streamingThisBubble: false,
        mergedWithPrevious: false,
        toolUser: false,
      },
    ];
    const fpA = buildVirtualMessageListStructureFingerprint(rowsA, false);
    const fpB = buildVirtualMessageListStructureFingerprint(
      [{ ...rowsA[0]!, msg: { ...rowsA[0]!.msg, content: "hello world much longer" } }],
      false,
    );
    expect(fpA).toBe(fpB);

    const fpC = buildVirtualMessageListStructureFingerprint(
      [...rowsA, { ...rowsA[0]!, key: "m2", msg: { id: 2, role: "assistant", content: "ok" } }],
      false,
    );
    expect(fpC).not.toBe(fpA);
  });
});
