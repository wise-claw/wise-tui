import { describe, expect, test } from "bun:test";
import type { ClaudeMessage, ToolUsePart } from "../types";
import {
  hasRequirementTurnNonCompletionSignal,
  requirementTurnHasWorkEvidence,
  requirementTurnResultProcessed,
} from "./requirementTurnResult";

function msg(partial: Partial<ClaudeMessage> & Pick<ClaudeMessage, "id" | "role">): ClaudeMessage {
  return {
    id: partial.id,
    role: partial.role,
    content: partial.content ?? "",
    timestamp: partial.timestamp ?? Date.now(),
    parts: partial.parts,
  };
}

function editPart(id = "t1"): ToolUsePart {
  return {
    id,
    type: "tool_use",
    name: "Edit",
    status: "completed",
    input: { file_path: "/repo/a.ts", old_string: "a", new_string: "b" },
    output: "",
  };
}

function bashPart(id = "t2"): ToolUsePart {
  return {
    id,
    type: "tool_use",
    name: "Bash",
    status: "completed",
    input: { command: "npm test" },
    output: "ok",
  };
}

function readPart(id = "t3"): ToolUsePart {
  return {
    id,
    type: "tool_use",
    name: "Read",
    status: "completed",
    input: { file_path: "/repo/a.ts" },
    output: "code",
  };
}

function textOnlyAssistant(content: string, id = 10): ClaudeMessage {
  return msg({ id, role: "assistant", content, parts: [{ type: "text", text: content }] });
}

describe("hasRequirementTurnNonCompletionSignal", () => {
  test("detects Chinese completion denial phrases", () => {
    for (const text of [
      "抱歉，我无法完成这个需求",
      "由于缺少权限，未能实现该功能",
      "这个问题目前暂时无法处理",
      "剩余部分尚未实现，请补充信息",
      "请提供更多细节后我再继续",
      "超出我的能力范围",
    ]) {
      expect(hasRequirementTurnNonCompletionSignal(text)).toBe(true);
    }
  });

  test("detects English completion denial phrases", () => {
    for (const text of [
      "I couldn't complete the task.",
      "unable to implement this requirement",
      "The agent failed to finish the work.",
      "This approach is not feasible.",
    ]) {
      expect(hasRequirementTurnNonCompletionSignal(text)).toBe(true);
    }
  });

  test("does not flag ordinary completion summaries", () => {
    for (const text of [
      "已完成需求，改动见上方 diff",
      "实现完成，所有测试通过",
      "已修复之前遇到的问题，并补充了用例",
      "需求已处理完毕，可以进入验证",
    ]) {
      expect(hasRequirementTurnNonCompletionSignal(text)).toBe(false);
    }
  });
});

describe("requirementTurnHasWorkEvidence", () => {
  test("completed edit counts as work", () => {
    expect(
      requirementTurnHasWorkEvidence([
        msg({ id: 1, role: "user", content: "请实现" }),
        msg({ id: 2, role: "assistant", parts: [editPart()] }),
      ]),
    ).toBe(true);
  });

  test("completed command counts as work", () => {
    expect(
      requirementTurnHasWorkEvidence([
        msg({ id: 1, role: "user", content: "请实现" }),
        msg({ id: 2, role: "assistant", parts: [bashPart()] }),
      ]),
    ).toBe(true);
  });

  test("explore/read tools alone are not work evidence", () => {
    expect(
      requirementTurnHasWorkEvidence([
        msg({ id: 1, role: "user", content: "请实现" }),
        msg({ id: 2, role: "assistant", parts: [readPart()] }),
      ]),
    ).toBe(false);
  });

  test("errored tool calls are not work evidence", () => {
    expect(
      requirementTurnHasWorkEvidence([
        msg({ id: 1, role: "user", content: "请实现" }),
        msg({
          id: 2,
          role: "assistant",
          parts: [{ ...editPart("e1"), status: "error", error: "denied" }],
        }),
      ]),
    ).toBe(false);
  });

  test("empty or text-only turn is not work evidence", () => {
    expect(requirementTurnHasWorkEvidence([])).toBe(false);
    expect(requirementTurnHasWorkEvidence([textOnlyAssistant("已完成")])).toBe(false);
  });

  test("only counts the last turn after a renderable user message", () => {
    expect(
      requirementTurnHasWorkEvidence([
        msg({ id: 1, role: "user", content: "请实现 A" }),
        msg({ id: 2, role: "assistant", parts: [editPart("t1")] }),
        msg({ id: 3, role: "user", content: "补充一点" }),
        textOnlyAssistant("明白了"),
      ]),
    ).toBe(false);
  });
});

describe("requirementTurnResultProcessed", () => {
  test("edit work and clean summary -> processed", () => {
    expect(
      requirementTurnResultProcessed({
        messages: [
          msg({ id: 1, role: "user", content: "请实现需求" }),
          msg({ id: 2, role: "assistant", parts: [editPart()] }),
          textOnlyAssistant("已完成，请验证"),
        ],
        previewRaw: "已完成，请验证",
      }),
    ).toBe(true);
  });

  test("denial in final reply overrides work evidence", () => {
    expect(
      requirementTurnResultProcessed({
        messages: [
          msg({ id: 1, role: "user", content: "请实现需求" }),
          msg({ id: 2, role: "assistant", parts: [editPart()] }),
          textOnlyAssistant("很抱歉，我无法完成这个需求"),
        ],
        previewRaw: "很抱歉，我无法完成这个需求",
      }),
    ).toBe(false);
  });

  test("text-only reply without any action is not processed", () => {
    expect(
      requirementTurnResultProcessed({
        messages: [msg({ id: 1, role: "user", content: "请实现需求" }), textOnlyAssistant("好的，开始实现")],
        previewRaw: "好的，开始实现",
      }),
    ).toBe(false);
  });

  test("empty inputs are not processed", () => {
    expect(requirementTurnResultProcessed({ messages: [], previewRaw: "" })).toBe(false);
  });
});
