import { describe, expect, test } from "bun:test";
import type { AssistantEntry } from "../types/assistant";
import {
  assistantEntryActionLabel,
  assistantEntryKindLabel,
  isAssistantConversationEntry,
  resolveAssistantEntryKind,
} from "./assistantTemplateEntry";

function customAssistant(partial: Partial<AssistantEntry>): AssistantEntry {
  return {
    id: "custom:test",
    source: "custom",
    name: "测试",
    description: "",
    avatarColor: null,
    engineId: "claude",
    model: null,
    systemPrompt: "",
    customId: "test",
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("assistantTemplateEntry", () => {
  test("resolveAssistantEntryKind defaults custom templates to conversation", () => {
    expect(resolveAssistantEntryKind(customAssistant({}))).toBe("conversation");
  });

  test("resolveAssistantEntryKind reads custom entry kinds", () => {
    expect(resolveAssistantEntryKind(customAssistant({ entryKind: "open_link" }))).toBe("open_link");
    expect(resolveAssistantEntryKind(customAssistant({ entryKind: "run_script" }))).toBe("run_script");
  });

  test("builtin assistants always resolve to conversation", () => {
    expect(
      resolveAssistantEntryKind({
        id: "builtin:prd-split",
        source: "builtin",
        entryKind: "open_link",
      } as AssistantEntry),
    ).toBe("conversation");
  });

  test("labels and action text", () => {
    expect(assistantEntryKindLabel("run_workflow")).toBe("执行工作流");
    expect(assistantEntryActionLabel("open_link")).toBe("打开链接");
    expect(assistantEntryActionLabel("conversation")).toBe("打开");
    expect(isAssistantConversationEntry(customAssistant({ entryKind: "run_workflow" }))).toBe(false);
  });
});
