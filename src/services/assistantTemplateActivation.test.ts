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

  test("run_script failure surfaces summary via message and full output via modal", async () => {
    // 模拟 bun test 失败的真实场景：stderr 含测试结果、stdout 为空、退出码 1
    const longStderr = [
      "$ bun test scripts/cursor-sdk-bridge.stderr.test.ts",
      "(pass) isCursorSdkNoiseStderr > filters Connect RPC HTTP/2 stream close noise",
      "(pass) isCursorSdkNoiseStderr > filters connect-error.js so",
      "(fail) isCursorSdkNoiseStderr > keeps meaningful panic stack visible",
      " (stdin <stdin>:1:9)",
      "expect(received).toBe(expected)",
      "",
      " 0 pass",
      " 1 fail",
      " 2 expect() calls",
      "Ran 2 tests across 1 file. [0.5ms]",
    ].join("\n");
    runShellCommandMock.mockResolvedValueOnce({
      stdout: "",
      stderr: longStderr,
      exit_code: 1,
    });
    const { message, modal, calls, modalCalls } = messageStub();
    await activateAssistantTemplate({
      assistant: customAssistant({
        entryKind: "run_script",
        entryScript: "bun test scripts/cursor-sdk-bridge.stderr.test.ts",
      }),
      repositoryPath: "/repo/a",
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession: mock(async () => true),
      message,
      modal,
    });
    // message.error 顶部摘要只显示一行（截断到 160 字符）+ 退出码
    const errCall = calls.find((c) => c.type === "error");
    expect(errCall?.text.startsWith("脚本退出码 1：")).toBe(true);
    expect(errCall?.text.length ?? 0).toBeLessThanOrEqual(200);
    // Modal.error 被弹，title 含退出码，content 含完整 stderr
    expect(modalCalls).toHaveLength(1);
    expect(modalCalls[0]?.title).toContain("退出码 1");
    expect(modalCalls[0]?.content).toContain("(fail) isCursorSdkNoiseStderr");
    expect(modalCalls[0]?.content).toContain("Ran 2 tests across 1 file.");
  });

  test("run_script failure falls back to message-only when modal is not provided", async () => {
    runShellCommandMock.mockResolvedValueOnce({
      stdout: "out-stdout\nmore",
      stderr: "out-stderr",
      exit_code: 2,
    });
    const stub = messageStub();
    await activateAssistantTemplate({
      assistant: customAssistant({
        entryKind: "run_script",
        entryScript: "false",
      }),
      repositoryPath: "/repo/a",
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession: mock(async () => true),
      message: stub.message,
      // 不传 modal：旧调用方降级行为仍保留
    });
    // 没有 modal 调用
    expect(stub.modalCalls).toHaveLength(0);
    // message.error 顶部摘要仍然存在
    const errCall = stub.calls.find((c) => c.type === "error");
    expect(errCall?.text.startsWith("脚本退出码 2：")).toBe(true);
  });

  test("run_script failure with empty output only shows exit code in message", async () => {
    runShellCommandMock.mockResolvedValueOnce({
      stdout: "",
      stderr: "",
      exit_code: 1,
    });
    const stub = messageStub();
    await activateAssistantTemplate({
      assistant: customAssistant({
        entryKind: "run_script",
        entryScript: "true",
      }),
      repositoryPath: "/repo/a",
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession: mock(async () => true),
      message: stub.message,
      modal: stub.modal,
    });
    const errCall = stub.calls.find((c) => c.type === "error");
    expect(errCall?.text).toBe("脚本退出码 1");
    expect(stub.modalCalls).toHaveLength(1);
    expect(stub.modalCalls[0]?.content).toContain("(脚本无 stdout / stderr 输出)");
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

  test("run_script failure falls back to notification when modal is empty object (no <App> Provider)", async () => {
    // 复现：上游注入的 modal 没有方法（antd `App.useApp()` 在没有 `<App>` Provider 时
    // 会返回 `{message:{}, notification:{}, modal:{}}`，看似有效但 `.error` undefined）。
    // service 必须能优雅降级到 notification，否则会抛 "is not a function" 阻断脚本执行。
    runShellCommandMock.mockResolvedValueOnce({
      stdout: "",
      stderr: "(fail) isCursorSdkNoiseStderr\nRan 2 tests across 1 file.",
      exit_code: 1,
    });
    // 显式不传 modal，但传 notification：模拟实际生产环境 antd App context 缺失的场景。
    const stub = messageStub({ modal: false });
    await activateAssistantTemplate({
      assistant: customAssistant({
        entryKind: "run_script",
        entryScript: "bun test scripts/cursor-sdk-bridge.stderr.test.ts",
      }),
      repositoryPath: "/repo/a",
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession: mock(async () => true),
      message: stub.message,
      notification: stub.notification,
    });
    // 没传 modal：原有 modalCalls 仍然为空
    expect(stub.modalCalls).toHaveLength(0);
    // message.error 顶部仍给摘要
    const errCall = stub.calls.find((c) => c.type === "error");
    expect(errCall?.text.startsWith("脚本退出码 1：")).toBe(true);
    // 完整 stdout+stderr 通过 notification 通道呈给用户
    expect(stub.notificationCalls).toHaveLength(1);
    expect(stub.notificationCalls[0]?.message).toContain("退出码 1");
    expect(stub.notificationCalls[0]?.description).toContain("(fail) isCursorSdkNoiseStderr");
    expect(stub.notificationCalls[0]?.description).toContain("Ran 2 tests across 1 file.");
  });

  test("run_script failure falls back to message-only truncation when modal & notification both missing", async () => {
    // 兜底兜底：modal 是空对象且 notification 也没传，service 不能抛错，必须降级到
    // message.error 并把内容截断到 ~1 KB，让用户至少能看到诊断线索。
    const longStdout = "x".repeat(2048);
    runShellCommandMock.mockResolvedValueOnce({
      stdout: longStdout,
      stderr: "",
      exit_code: 3,
    });
    const stub = messageStub({ modal: false, notification: false });
    await activateAssistantTemplate({
      assistant: customAssistant({
        entryKind: "run_script",
        entryScript: "echo long",
      }),
      repositoryPath: "/repo/a",
      workflowTemplates: [],
      repositories: [],
      sessions: [],
      repositoryMainBindings: {},
      executeSession: mock(async () => true),
      message: stub.message,
      // modal/notification 都不传
    });
    expect(stub.modalCalls).toHaveLength(0);
    expect(stub.notificationCalls).toHaveLength(0);
    const errCalls = stub.calls.filter((c) => c.type === "error");
    expect(errCalls.length).toBeGreaterThanOrEqual(1);
    // 第二条是带内容截断的兜底消息，包含省略标记
    const truncated = errCalls.find((c) => c.text.includes("已省略"));
    expect(truncated).toBeDefined();
    expect(truncated?.text).toContain("脚本退出码 3");
  });
});