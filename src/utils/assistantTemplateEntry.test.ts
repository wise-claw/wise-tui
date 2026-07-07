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
  test("resolveAssistantEntryKind defaults custom templates to dispatch_direct", () => {
    expect(resolveAssistantEntryKind(customAssistant({}))).toBe("dispatch_direct");
  });

  test("resolveAssistantEntryKind reads custom entry kinds", () => {
    expect(resolveAssistantEntryKind(customAssistant({ entryKind: "dispatch_direct" }))).toBe(
      "dispatch_direct",
    );
    expect(resolveAssistantEntryKind(customAssistant({ entryKind: "open_link" }))).toBe("open_link");
    expect(resolveAssistantEntryKind(customAssistant({ entryKind: "run_workflow" }))).toBe(
      "run_workflow",
    );
    expect(resolveAssistantEntryKind(customAssistant({ entryKind: "run_script" }))).toBe(
      "run_script",
    );
  });

  test("resolveAssistantEntryKind rejects legacy conversation kind", () => {
    expect(resolveAssistantEntryKind(customAssistant({ entryKind: "conversation" as never }))).toBe(
      "dispatch_direct",
    );
  });

  test("builtin assistants always resolve to dispatch_direct", () => {
    expect(
      resolveAssistantEntryKind({
        id: "builtin:word-doc",
        source: "builtin",
        entryKind: "open_link",
      } as AssistantEntry),
    ).toBe("dispatch_direct");
  });

  test("extension assistants always resolve to dispatch_direct", () => {
    expect(
      resolveAssistantEntryKind({
        id: "extension:foo",
        source: "extension",
      } as AssistantEntry),
    ).toBe("dispatch_direct");
  });

  test("labels and action text", () => {
    expect(assistantEntryKindLabel("dispatch_direct")).toBe("立即执行");
    expect(assistantEntryKindLabel("run_workflow")).toBe("直接派发执行");
    expect(assistantEntryActionLabel("open_link")).toBe("打开链接");
    expect(assistantEntryActionLabel("run_workflow")).toBe("派发执行");
    expect(assistantEntryActionLabel("dispatch_direct")).toBe("立即执行");
    // 对话助手形态已下线：isAssistantConversationEntry 始终返回 false
    expect(isAssistantConversationEntry(customAssistant({}))).toBe(false);
    expect(isAssistantConversationEntry(customAssistant({ entryKind: "run_workflow" }))).toBe(false);
  });
});