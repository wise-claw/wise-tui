import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AssistantEntry } from "../types/assistant";

const openExternalUrlMock = mock(async () => undefined);
const runShellCommandMock = mock(async () => ({ stdout: "", stderr: "", exit_code: 0 }));
const buildClaudeOutgoingPromptMock = mock(async () => "outbound prompt");

mock.module("./openExternal", () => ({
  openExternalUrl: openExternalUrlMock,
  isSafeExternalHref: (href: string) => /^https?:\/\//i.test(href.trim()),
}));

mock.module("./terminal", () => ({
  runShellCommand: runShellCommandMock,
}));

mock.module("./claudeComposerPrompt", () => ({
  buildClaudeOutgoingPrompt: buildClaudeOutgoingPromptMock,
}));

import { activateAssistantTemplate } from "./assistantTemplateActivation";

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

function messageStub() {
  const calls: { type: string; text: string }[] = [];
  return {
    calls,
    message: {
      success: (text: string) => {
        calls.push({ type: "success", text });
      },
      warning: (text: string) => {
        calls.push({ type: "warning", text });
      },
      error: (text: string) => {
        calls.push({ type: "error", text });
      },
    },
  };
}

beforeEach(() => {
  openExternalUrlMock.mockReset();
  runShellCommandMock.mockReset();
  buildClaudeOutgoingPromptMock.mockReset();
  openExternalUrlMock.mockResolvedValue(undefined);
  runShellCommandMock.mockResolvedValue({ stdout: "ok", stderr: "", exit_code: 0 });
  buildClaudeOutgoingPromptMock.mockResolvedValue("outbound prompt");
});

describe("activateAssistantTemplate", () => {
  test("opens conversation via openConversation", async () => {
    const openConversation = mock(() => undefined);
    const { message } = messageStub();
    await activateAssistantTemplate({
      assistant: customAssistant({}),
      repositoryPath: null,
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession: mock(async () => true),
      openConversation,
      message,
    });
    expect(openConversation).toHaveBeenCalledWith("custom:test");
  });

  test("opens external link for open_link templates", async () => {
    const { message } = messageStub();
    await activateAssistantTemplate({
      assistant: customAssistant({ entryKind: "open_link", entryUrl: "https://example.com" }),
      repositoryPath: null,
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession: mock(async () => true),
      openConversation: mock(() => undefined),
      message,
    });
    expect(openExternalUrlMock).toHaveBeenCalledWith("https://example.com");
  });

  test("requires repository for script templates", async () => {
    const { message, calls } = messageStub();
    await activateAssistantTemplate({
      assistant: customAssistant({ entryKind: "run_script", entryScript: "echo hi" }),
      repositoryPath: null,
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession: mock(async () => true),
      openConversation: mock(() => undefined),
      message,
    });
    expect(calls[0]?.type).toBe("warning");
    expect(runShellCommandMock).not.toHaveBeenCalled();
  });

  test("runs script in repository cwd", async () => {
    const { message } = messageStub();
    await activateAssistantTemplate({
      assistant: customAssistant({ entryKind: "run_script", entryScript: "echo hi" }),
      repositoryPath: "/repo/a",
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession: mock(async () => true),
      openConversation: mock(() => undefined),
      message,
    });
    expect(runShellCommandMock).toHaveBeenCalledWith("/repo/a", "echo hi");
  });
});
