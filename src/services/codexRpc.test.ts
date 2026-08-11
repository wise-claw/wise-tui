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
