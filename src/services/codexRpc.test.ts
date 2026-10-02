import { beforeEach, describe, expect, mock, test } from "bun:test";

const invoke = mock(async () => undefined);

// 保留 isTauri 导出：同进程运行的其它测试文件（如 tauriEnv → tabsStore 链）会
// 从同一模块导入它，缺了会在模块解析期抛 SyntaxError，污染整轮测试。
mock.module("@tauri-apps/api/core", () => ({ invoke, isTauri: mock(() => true) }));
mock.module("@tauri-apps/api/event", () => ({ listen: mock(async () => () => {}) }));
mock.module("../utils/safeTauriUnlisten", () => ({ safeUnlisten: mock(() => undefined) }));

describe("codexRpc service", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  test("native defaults omit effort and preserve the original user prompt", async () => {
    const { executeCodexRpcCode } = await import("./codex");
    const prompt = "分析这个问题\n附图：@/tmp/example.png";
    for (const effort of [undefined, "default"]) {
      await executeCodexRpcCode("/repo", prompt, undefined, undefined, "tab-1", undefined, effort);
      expect(invoke).toHaveBeenLastCalledWith("execute_codex_rpc", {
        params: {
          projectPath: "/repo", prompt, model: undefined, invocationKey: undefined,
          tabSessionId: "tab-1", codexResumeSessionId: null, readOnly: false,
        },
      });
    }
  });

  test("explicit model and reasoning selections reach Codex unchanged", async () => {
    const { executeCodexRpcCode } = await import("./codex");
    await executeCodexRpcCode("/repo", "继续", "private-model", "inv", "tab-1", "thread-1", " high ");
    expect(invoke).toHaveBeenCalledWith("execute_codex_rpc", {
      params: {
        projectPath: "/repo", prompt: "继续", model: "private-model", effort: "high",
        invocationKey: "inv", tabSessionId: "tab-1", codexResumeSessionId: "thread-1", readOnly: false,
      },
    });
  });

  test("steering resolves the active turn on the backend and propagates rejection", async () => {
    const { steerCodexTurn } = await import("./codexRpc");
    await steerCodexTurn("tab-1", undefined, "补充要求");
    expect(invoke).toHaveBeenCalledWith("steer_codex_rpc_turn", {
      params: { sessionId: "tab-1", turnId: undefined, input: "补充要求" },
    });
    invoke.mockImplementationOnce(async () => { throw new Error("turn completed"); });
    await expect(steerCodexTurn("tab-1", "old-turn", "补充要求")).rejects.toThrow("turn completed");
  });

  test("interruptCodexRpc calls interrupt_codex_rpc with params wrapper", async () => {
    const { interruptCodexRpc } = await import("./codexRpc");

    await interruptCodexRpc("tab-1");

    expect(invoke).toHaveBeenCalledWith("interrupt_codex_rpc", {
      params: { sessionId: "tab-1" },
    });
  });

  test("shutdownCodexRpc calls shutdown_codex_rpc with params wrapper", async () => {
    const { shutdownCodexRpc } = await import("./codexRpc");

    await shutdownCodexRpc("tab-1");

    expect(invoke).toHaveBeenCalledWith("shutdown_codex_rpc", {
      params: { sessionId: "tab-1" },
    });
  });
});
