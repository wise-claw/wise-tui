import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AssistantEntry } from "../types/assistant";
import type { ClaudeSession, Repository } from "../types";

const openExternalUrlMock = mock(async () => undefined);
const runShellCommandMock = mock(async () => ({ stdout: "", stderr: "", exit_code: 0 }));
const openBackgroundScriptMock = mock(async (workspaceId: string, terminalId: string) => ({
  workspaceId,
  terminalId,
  title: "执行脚本·测试",
  source: "background-script" as const,
  status: "running" as const,
  cwd: "/repo/a",
  cols: 80,
  rows: 24,
  cursor: 0,
  pid: 4242,
}));
const buildClaudeOutgoingPromptMock = mock(async () => "outbound prompt");

mock.module("./openExternal", () => ({
  openExternalUrl: openExternalUrlMock,
  isSafeExternalHref: (href: string) => /^https?:\/\//i.test(href.trim()),
}));

mock.module("./terminal", () => ({
  runShellCommand: runShellCommandMock,
  openBackgroundScript: openBackgroundScriptMock,
}));

mock.module("./claudeComposerPrompt", () => ({
  buildClaudeOutgoingPrompt: buildClaudeOutgoingPromptMock,
}));

import { activateAssistantTemplate } from "./assistantTemplateActivation";
import { getExecutionEnvironmentDispatchesSnapshotForAnchor } from "../stores/executionEnvironmentDispatchStore";

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

function messageStub(opts: { modal?: boolean; notification?: boolean } = {}) {
  const calls: { type: string; text: string }[] = [];
  const modalCalls: { kind: "error"; title: string; content: string }[] = [];
  const notificationCalls: { kind: "error"; message: string; description: string }[] = [];
  return {
    calls,
    modalCalls,
    notificationCalls,
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
    // 最小 modal stub：从 content 中抽文本（兼容 React <pre> 元素），
    // 仅用于断言 Modal.error 是否被弹以及 title/content 是否正确。
    modal: opts.modal === false
      ? undefined
      : {
      error: ({ title, content }: { title: string; content: unknown }) => {
        let text = "";
        if (typeof content === "string") {
          text = content;
        } else if (content && typeof content === "object" && "props" in (content as Record<string, unknown>)) {
          const children = (content as { props: { children: unknown } }).props.children;
          text = String(children ?? "");
        } else {
          text = String(content ?? "");
        }
        modalCalls.push({ kind: "error", title, content: text });
      },
      warning: () => undefined,
      info: () => undefined,
      success: () => undefined,
      confirm: () => undefined,
    },
    notification: opts.notification === false
      ? undefined
      : {
        success: () => undefined,
        warning: () => undefined,
        info: () => undefined,
        error: ({ message: msg, description }: { message: string; description?: string }) => {
          notificationCalls.push({ kind: "error", message: msg, description: description ?? "" });
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
  openBackgroundScriptMock.mockReset();
  buildClaudeOutgoingPromptMock.mockReset();
  openExternalUrlMock.mockResolvedValue(undefined);
  runShellCommandMock.mockResolvedValue({ stdout: "ok", stderr: "", exit_code: 0 });
  openBackgroundScriptMock.mockImplementation(
    async (workspaceId: string, terminalId: string) => ({
      workspaceId,
      terminalId,
      title: "执行脚本·测试",
      source: "background-script",
      status: "running",
      cwd: workspaceId,
      cols: 80,
      rows: 24,
      cursor: 0,
      pid: 4242,
    }),
  );
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
    // 当前成功路径上不弹 success 提示，仅 warning 路径有反馈；这里断言没有 error/warning。
    expect(calls.some((c) => c.type === "error" || c.type === "warning")).toBe(false);
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
    expect(openBackgroundScriptMock).not.toHaveBeenCalled();
    expect(runShellCommandMock).not.toHaveBeenCalled();
  });

  test("spawns script in background via PTY (fire-and-forget)", async () => {
    const { message, calls } = messageStub();
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
    // 走 PTY 后台脚本路径（openBackgroundScript），不再调用 fire-and-forget 的 spawn_shell_command。
    expect(openBackgroundScriptMock).toHaveBeenCalledTimes(1);
    const [cwd, terminalId, , command, title] = openBackgroundScriptMock.mock.calls[0] ?? [];
    expect(cwd).toBe("/repo/a");
    expect(typeof terminalId).toBe("string");
    expect((terminalId as string).startsWith("assistant-script:custom:test:")).toBe(true);
    expect(command).toBe("echo hi");
    // title 形如 "执行脚本·测试"；不强制具体后缀，只要非空且非纯空白
    expect(typeof title).toBe("string");
    expect((title as string).trim().length).toBeGreaterThan(0);
    expect(runShellCommandMock).not.toHaveBeenCalled();
    // 成功提示带上 pid + terminalId 前缀
    const success = calls.find((c) => c.type === "success");
    expect(success?.text).toContain("脚本已后台启动");
    expect(success?.text).toContain("pid 4242");
    expect(success?.text).toContain("assistant-script:custom:test:".slice(0, 20));
    expect(calls.some((c) => c.type === "error" || c.type === "warning")).toBe(false);
  });

  test("run_script PTY spawn failure surfaces error via message (no modal)", async () => {
    // 复现：后端 PTY 启动失败（路径无效、PTY 不可用等）
    openBackgroundScriptMock.mockRejectedValueOnce(
      new Error("仓库路径不存在或不是目录：/repo/missing"),
    );
    const stub = messageStub();
    await activateAssistantTemplate({
      assistant: customAssistant({
        entryKind: "run_script",
        entryScript: "bun test src/utils/cursorAgentId.test.ts",
      }),
      repositoryPath: "/repo/missing",
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession: mock(async () => true),
      message: stub.message,
      modal: stub.modal,
    });
    // PTY 启动失败只在 message.error 给提示，不再弹 modal/notification
    const errCall = stub.calls.find((c) => c.type === "error");
    expect(errCall?.text).toContain("仓库路径不存在或不是目录");
    expect(stub.modalCalls).toHaveLength(0);
  });

  test("run_workflow without workflowId works without main session binding", async () => {
    const directExecuteSession = mock(() => true);
    const createSession = mock(async () => "session:worker-no-binding");
    const { message, calls } = messageStub();
    // 无仓库绑定、无 sessions：原本 dispatch_direct/run_workflow 有 workflowId 会报错，
    // 但 run_workflow 无 workflowId 不应要求主会话绑定。
    await activateAssistantTemplate({
      assistant: customAssistant({ entryKind: "run_workflow", entryWorkflowId: undefined }),
      repositoryPath: "/repo/a",
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession: mock(async () => true),
      directExecuteSession,
      createSession,
      message,
    });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(directExecuteSession).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.type === "success" && c.text.includes("已派发执行"))).toBe(true);
    // 不应出现"未找到仓库绑定主会话"警告
    expect(calls.some((c) => c.type === "warning" && c.text.includes("未找到仓库绑定主会话"))).toBe(false);
  });

  test("run_workflow without workflowId creates worker session and dispatches", async () => {
    const executeSession = mock(async () => true);
    const directExecuteSession = mock(() => true);
    const createSession = mock(async () => "session:worker-1");
    const { message, calls } = messageStub();
    const binding = repoBinding("/repo/a");
    await activateAssistantTemplate({
      assistant: customAssistant({ entryKind: "run_workflow", entryWorkflowId: undefined }),
      repositoryPath: "/repo/a",
      workflowTemplates: [],
      ...binding,
      executeSession,
      directExecuteSession,
      createSession,
      message,
    });
    // 创建了独立 worker 会话，不占用主会话
    expect(createSession).toHaveBeenCalledTimes(1);
    const createArgs = createSession.mock.calls[0];
    expect(createArgs?.[0]).toBe("/repo/a");
    expect(createArgs?.[1]).toContain("执行环境:测试");
    expect(createArgs?.[2]).toEqual({ skipActivate: true, connectionKind: "oneshot" });
    // 通过 directExecuteSession 在 worker 会话中执行，不经过团队/终端路由
    expect(directExecuteSession).toHaveBeenCalledTimes(1);
    const args = directExecuteSession.mock.calls[0];
    expect(args?.[0]).toBe("session:worker-1");
    expect(args?.[1]).toBe("outbound prompt");
    // executeSession（handleComposerExecute）未被调用 —— 团队路由不介入 worker 派发
    expect(executeSession).toHaveBeenCalledTimes(0);
    expect(calls.some((c) => c.type === "success" && c.text.includes("已派发执行"))).toBe(true);
    // 派发记录已注册到运行面板数据源（锚点为 workerTabId，无 preferredSessionId 时自锚）
    const dispatchRecords = getExecutionEnvironmentDispatchesSnapshotForAnchor("session:worker-1");
    const hasWorkerItem = dispatchRecords.some((batch) =>
      batch.items.some((item) => item.workerSessionId === "session:worker-1"),
    );
    expect(hasWorkerItem).toBe(true);
  });

  test("run_workflow with workflowId enqueues via team target", async () => {
    const executeSession = mock(async () => true);
    const { message, calls } = messageStub();
    const binding = repoBinding("/repo/a");
    await activateAssistantTemplate({
      assistant: customAssistant({
        entryKind: "run_workflow",
        entryWorkflowId: "wf-1",
      }),
      repositoryPath: "/repo/a",
      workflowTemplates: [
        {
          id: "wf-1",
          name: "团队工作流",
          description: "",
        } as never,
      ],
      ...binding,
      executeSession,
      message,
    });
    expect(executeSession).toHaveBeenCalledTimes(1);
    const args = executeSession.mock.calls[0];
    expect(args?.[0]).toBe("session:main");
    expect(args?.[1]).toBe("outbound prompt");
    expect(args?.[2]).toEqual({
      targetType: "team",
      targetWorkflowId: "wf-1",
      targetWorkflowName: "团队工作流",
    });
    expect(calls.some((c) => c.type === "success" && c.text.includes("团队工作流"))).toBe(true);
  });

  test("run_script empty script content surfaces error and skips spawn", async () => {
    // entryScript 为空时直接报错，不发起后台 PTY 启动。
    const stub = messageStub();
    await activateAssistantTemplate({
      assistant: customAssistant({ entryKind: "run_script", entryScript: "" }),
      repositoryPath: "/repo/a",
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession: mock(async () => true),
      message: stub.message,
    });
    expect(stub.calls.some((c) => c.type === "error" && c.text.includes("脚本内容为空"))).toBe(true);
    expect(openBackgroundScriptMock).not.toHaveBeenCalled();
    expect(runShellCommandMock).not.toHaveBeenCalled();
  });

  test("run_script background PTY 还顺手注册了 dispatch item，存进 executionEnvironmentDispatchStore", async () => {
    const { message, calls } = messageStub();
    const binding = repoBinding("/repo/a");
    await activateAssistantTemplate({
      assistant: customAssistant({
        id: "custom:bg",
        entryKind: "run_script",
        entryScript: "echo hi",
        name: "后台助手",
      }),
      repositoryPath: "/repo/a",
      workflowTemplates: [],
      ...binding,
      executeSession: mock(async () => true),
      message,
    });
    const records = getExecutionEnvironmentDispatchesSnapshotForAnchor("session:main");
    const items = records.flatMap((row) => row.items);
    const item = items.find((it) => (it.terminalId ?? "").startsWith("assistant-script:custom:bg:"));
    expect(item).toBeDefined();
    expect(item?.workspaceId).toBe("/repo/a");
    expect(item?.cwd).toBe("/repo/a");
    expect(item?.pid).toBe(4242);
    expect((item?.batchId ?? "").startsWith("bg-script:custom:bg:")).toBe(true);
    expect((item?.label ?? "").includes("执行脚本·")).toBe(true);
    expect(calls.some((c) => c.type === "success" && c.text.includes("pid 4242"))).toBe(true);
  });
});