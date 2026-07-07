import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AssistantEntry } from "../types/assistant";
import type { ClaudeSession, Repository } from "../types";

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
    systemPrompt: "system",
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

function repoBinding(repositoryPath: string): {
  repositories: Repository[];
  sessions: ClaudeSession[];
  repositoryMainBindings: Record<string, string>;
} {
  return {
    repositories: [
      {
        id: "repo:a",
        path: repositoryPath,
        name: "A",
        repositoryType: "git",
      } as unknown as Repository,
    ],
    sessions: [
      {
        id: "session:main",
        repositoryPath,
        title: "main",
      } as unknown as ClaudeSession,
    ],
    repositoryMainBindings: { [repositoryPath]: "session:main" },
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
  test("dispatch_direct invokes executeSession immediately with built prompt", async () => {
    const executeSession = mock(async () => true);
    const { message, calls } = messageStub();
    const binding = repoBinding("/repo/a");
    await activateAssistantTemplate({
      assistant: customAssistant({ entryKind: "dispatch_direct" }),
      repositoryPath: "/repo/a",
      workflowTemplates: [],
      ...binding,
      executeSession,
      message,
    });
    expect(executeSession).toHaveBeenCalledTimes(1);
    const [sessionId, prompt] = executeSession.mock.calls[0] ?? [];
    expect(sessionId).toBe("session:main");
    expect(prompt).toBe("outbound prompt");
    expect(calls[0]?.type).toBe("success");
  });

  test("dispatch_direct requires repository", async () => {
    const executeSession = mock(async () => true);
    const { message, calls } = messageStub();
    await activateAssistantTemplate({
      assistant: customAssistant({ entryKind: "dispatch_direct" }),
      repositoryPath: null,
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession,
      message,
    });
    expect(calls[0]?.type).toBe("warning");
    expect(executeSession).not.toHaveBeenCalled();
  });

  test("dispatch_direct needs main session binding", async () => {
    const executeSession = mock(async () => true);
    const { message, calls } = messageStub();
    await activateAssistantTemplate({
      assistant: customAssistant({ entryKind: "dispatch_direct" }),
      repositoryPath: "/repo/a",
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession,
      message,
    });
    expect(calls[0]?.type).toBe("warning");
    expect(executeSession).not.toHaveBeenCalled();
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
      message,
    });
    expect(runShellCommandMock).toHaveBeenCalledWith("/repo/a", "echo hi");
  });
});