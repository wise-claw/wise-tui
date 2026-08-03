import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { resetExecutionEnvironmentDispatchStore } from "../stores/executionEnvironmentDispatchStore";
import { dispatchExecutionEnvironmentFromMainSession } from "./executionEnvironmentDispatch";

function stubSession(id: string, overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id,
    claudeSessionId: null,
    repositoryPath: "/repo",
    repositoryName: "demo",
    model: "sonnet",
    status: "idle",
    messages: [],
    createdAt: Date.now(),
    pendingPrompt: "",
    ...overrides,
  };
}

describe("dispatchExecutionEnvironmentFromMainSession", () => {
  beforeEach(() => {
    resetExecutionEnvironmentDispatchStore();
  });

  test("@引擎直接新建普通会话，不注册派发行、不写 /执行环境: worker 名", async () => {
    const loadInstructionResolveContext = mock(async () => ({
      omcInstalled: false,
      pluginCacheSkills: [],
      projectSkills: [],
    }));
    const createdNames: string[] = [];
    const createdOpts: Array<
      | {
          connectionKind?: "oneshot" | "streaming";
          initialExecutionEngine?: string;
        }
      | undefined
    > = [];
    const executed: string[] = [];
    const activated: string[] = [];
    const sessions = [stubSession("main")];

    const ok = await dispatchExecutionEnvironmentFromMainSession(
      {
        getSessions: () => sessions,
        loadInstructionResolveContext,
        createSession: async (_path, name, opts) => {
          createdNames.push(name);
          createdOpts.push(opts);
          const id = `sess-${createdNames.length}`;
          sessions.push(
            stubSession(id, {
              repositoryName: name,
              executionEngine: opts?.initialExecutionEngine,
              connectionKind: opts?.connectionKind,
            }),
          );
          return id;
        },
        executeSession: (sessionId) => {
          executed.push(sessionId);
          return true;
        },
        appendSystemMessage: () => {},
        activateWorkerSession: (sessionId) => {
          activated.push(sessionId);
        },
      },
      {
        mainSessionId: "main",
        prompt: "@Claude Code 起2个会话修登录",
      },
    );

    expect(ok).toBe(true);
    expect(loadInstructionResolveContext).not.toHaveBeenCalled();
    expect(createdNames).toEqual(["demo · 1", "demo · 2"]);
    expect(createdNames.every((name) => !name.includes("/执行环境:"))).toBe(true);
    expect(createdOpts.every((opts) => opts?.connectionKind === "streaming")).toBe(true);
    expect(createdOpts.every((opts) => opts?.initialExecutionEngine === "claude")).toBe(true);
    expect(executed).toHaveLength(2);
    expect(activated).toEqual(["sess-1"]);
  });

  test("非 Claude 引擎仍用 oneshot，并写入标签引擎", async () => {
    const createdOpts: Array<
      | {
          connectionKind?: "oneshot" | "streaming";
          initialExecutionEngine?: string;
        }
      | undefined
    > = [];
    const sessions = [stubSession("main")];

    const ok = await dispatchExecutionEnvironmentFromMainSession(
      {
        getSessions: () => sessions,
        codexAvailable: true,
        createSession: async (_path, name, opts) => {
          createdOpts.push(opts);
          const id = `sess-${createdOpts.length}`;
          sessions.push(
            stubSession(id, {
              repositoryName: name,
              executionEngine: opts?.initialExecutionEngine,
            }),
          );
          return id;
        },
        executeSession: () => true,
        appendSystemMessage: () => {},
      },
      {
        mainSessionId: "main",
        prompt: "@Codex CLI 修登录",
      },
    );

    expect(ok).toBe(true);
    expect(createdOpts).toHaveLength(1);
    expect(createdOpts[0]?.connectionKind).toBe("oneshot");
    expect(createdOpts[0]?.initialExecutionEngine).toBe("codex");
  });

  test("有默认指令时才加载 resolve context", async () => {
    const loadInstructionResolveContext = mock(async () => ({
      omcInstalled: false,
      pluginCacheSkills: [],
      projectSkills: [],
    }));
    const sessions = [stubSession("main")];

    await dispatchExecutionEnvironmentFromMainSession(
      {
        getSessions: () => sessions,
        loadInstructionResolveContext,
        createSession: async () => {
          const id = "sess-1";
          sessions.push(stubSession(id));
          return id;
        },
        executeSession: () => true,
        appendSystemMessage: () => {},
      },
      {
        mainSessionId: "main",
        prompt: "@Claude Code 修登录",
        defaultInstructionApplied: "/autopilot",
      },
    );

    expect(loadInstructionResolveContext).toHaveBeenCalledTimes(1);
  });

  test("executeSession 全部失败时返回 false 并清理空壳会话", async () => {
    const sessions = [stubSession("main")];
    const closed: string[] = [];
    const warning = mock(() => {});
    const messageMod = await import("antd");
    const originalWarning = messageMod.message.warning;
    messageMod.message.warning = warning as typeof messageMod.message.warning;

    try {
      const ok = await dispatchExecutionEnvironmentFromMainSession(
        {
          getSessions: () => sessions,
          createSession: async (_path, name) => {
            const id = "sess-fail";
            sessions.push(stubSession(id, { repositoryName: name, executionEngine: "claude" }));
            return id;
          },
          executeSession: () => false,
          appendSystemMessage: () => {},
          closeSession: (sessionId) => {
            closed.push(sessionId);
          },
        },
        {
          mainSessionId: "main",
          prompt: "@Claude Code 修登录",
        },
      );
      expect(ok).toBe(false);
      expect(warning).toHaveBeenCalled();
      // 全部被并发门闸挡下时清理已创建空壳，避免侧栏留 idle 幽灵 tab
      expect(closed).toEqual(["sess-fail"]);
    } finally {
      messageMod.message.warning = originalWarning;
    }
  });

  test("createSession 部分失败时清理已创建并整体返回 false", async () => {
    const sessions = [stubSession("main")];
    const closed: string[] = [];
    const warning = mock(() => {});
    const error = mock(() => {});
    const messageMod = await import("antd");
    const originalWarning = messageMod.message.warning;
    const originalError = messageMod.message.error;
    messageMod.message.warning = warning as typeof messageMod.message.warning;
    messageMod.message.error = error as typeof messageMod.message.error;
    let createCount = 0;

    try {
      const ok = await dispatchExecutionEnvironmentFromMainSession(
        {
          getSessions: () => sessions,
          createSession: async () => {
            createCount += 1;
            if (createCount === 2) throw new Error("create failed");
            const id = `sess-${createCount}`;
            sessions.push(stubSession(id, { repositoryName: "demo", executionEngine: "claude" }));
            return id;
          },
          executeSession: () => true,
          appendSystemMessage: () => {},
          closeSession: (sessionId) => {
            closed.push(sessionId);
          },
        },
        {
          mainSessionId: "main",
          prompt: "@Claude Code 起2个会话修登录",
        },
      );
      expect(ok).toBe(false);
      expect(error).toHaveBeenCalled();
      // 第二个创建失败：清理第一个已成功创建的空壳，避免泄漏
      expect(closed).toEqual(["sess-1"]);
    } finally {
      messageMod.message.warning = originalWarning;
      messageMod.message.error = originalError;
    }
  });

  test("executeSession 部分失败时只清理失败的空壳，成功者保留", async () => {
    const sessions = [stubSession("main")];
    const closed: string[] = [];
    const activated: string[] = [];
    const warning = mock(() => {});
    const messageMod = await import("antd");
    const originalWarning = messageMod.message.warning;
    messageMod.message.warning = warning as typeof messageMod.message.warning;
    let execCount = 0;

    try {
      const ok = await dispatchExecutionEnvironmentFromMainSession(
        {
          getSessions: () => sessions,
          createSession: async (_path, name) => {
            const id = `sess-${sessions.length}`;
            sessions.push(stubSession(id, { repositoryName: name, executionEngine: "claude" }));
            return id;
          },
          executeSession: () => {
            execCount += 1;
            return execCount === 2 ? false : true;
          },
          appendSystemMessage: () => {},
          activateWorkerSession: (sessionId) => {
            activated.push(sessionId);
          },
          closeSession: (sessionId) => {
            closed.push(sessionId);
          },
        },
        {
          mainSessionId: "main",
          prompt: "@Claude Code 起2个会话修登录",
        },
      );
      expect(ok).toBe(true);
      expect(warning).toHaveBeenCalled();
      // 仅第二路被并发挡下：清理 sess-2 空壳，sess-1 保留并激活
      expect(closed).toEqual(["sess-2"]);
      expect(activated).toEqual(["sess-1"]);
    } finally {
      messageMod.message.warning = originalWarning;
    }
  });
});
