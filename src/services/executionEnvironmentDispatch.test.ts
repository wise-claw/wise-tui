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
});
