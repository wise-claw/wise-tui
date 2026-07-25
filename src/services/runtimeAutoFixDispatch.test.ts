import { describe, expect, mock, test } from "bun:test";

mock.module("antd", () => ({
  message: {
    success: mock(() => undefined),
    warning: mock(() => undefined),
    error: mock(() => undefined),
    info: mock(() => undefined),
  },
}));

import { dispatchRuntimeAutoFix, consumeCompletedPageMonitorReloads, resetPendingPageMonitorReloadsForTests } from "./runtimeAutoFixDispatch";
import type { ClaudeSession } from "../types";

function session(partial: Partial<ClaudeSession> & Pick<ClaudeSession, "id">): ClaudeSession {
  return {
    id: partial.id,
    repositoryPath: partial.repositoryPath ?? "/repo",
    repositoryName: partial.repositoryName ?? "demo",
    status: partial.status ?? "idle",
    messages: partial.messages ?? [],
    claudeSessionId: partial.claudeSessionId ?? null,
    model: partial.model ?? "default",
    connectionKind: partial.connectionKind ?? "streaming",
    ...partial,
  } as ClaudeSession;
}

describe("dispatchRuntimeAutoFix", () => {
  test("creates oneshot worker without switching and executes prompt", async () => {
    const createSession = mock(async () => "worker-1");
    const executeSession = mock(() => true);
    const ok = await dispatchRuntimeAutoFix(
      {
        getSessions: () => [session({ id: "main-1", repositoryName: "demo" })],
        createSession,
        executeSession,
      },
      {
        anchorSessionId: "main-1",
        prompt: "请修复页面错误",
        source: "page-monitor",
        pageMonitorSessionId: "42",
      },
    );
    expect(ok).toBe(true);
    expect(createSession).toHaveBeenCalledTimes(1);
    const createArgs = createSession.mock.calls[0] as unknown as [
      string,
      string,
      { skipActivate?: boolean; connectionKind?: string },
    ];
    expect(createArgs[0]).toBe("/repo");
    expect(createArgs[1]).toContain("/执行环境:页面监控·自动修复");
    expect(createArgs[2]?.skipActivate).toBe(true);
    expect(createArgs[2]?.connectionKind).toBe("oneshot");
    expect(executeSession).toHaveBeenCalledWith("worker-1", "请修复页面错误");
  });

  test("registers pending reload for page-monitor and consumes on idle", async () => {
    resetPendingPageMonitorReloadsForTests();
    await dispatchRuntimeAutoFix(
      {
        getSessions: () => [session({ id: "main-1" })],
        createSession: async () => "worker-reload",
        executeSession: () => true,
      },
      {
        anchorSessionId: "main-1",
        prompt: "fix",
        source: "page-monitor",
        pageMonitorSessionId: "99",
      },
    );
    expect(
      consumeCompletedPageMonitorReloads([
        session({ id: "worker-reload", status: "idle" }),
      ]),
    ).toEqual([]);
    expect(
      consumeCompletedPageMonitorReloads([
        session({ id: "worker-reload", status: "running" }),
      ]),
    ).toEqual([]);
    expect(
      consumeCompletedPageMonitorReloads([
        session({ id: "worker-reload", status: "idle" }),
      ]),
    ).toEqual(["99"]);
    expect(
      consumeCompletedPageMonitorReloads([
        session({ id: "worker-reload", status: "idle" }),
      ]),
    ).toEqual([]);
  });

  test("returns false when executeSession refuses", async () => {
    const ok = await dispatchRuntimeAutoFix(
      {
        getSessions: () => [session({ id: "main-1" })],
        createSession: async () => "worker-2",
        executeSession: () => false,
      },
      {
        anchorSessionId: "main-1",
        prompt: "fix me",
        source: "run-command",
      },
    );
    expect(ok).toBe(false);
  });
});
