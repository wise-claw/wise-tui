import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { CustomAgentInput } from "../types/detectedAgent";

const invoke = mock(async (_cmd: string, _payload?: unknown) => ({}));

mock.module("@tauri-apps/api/core", () => ({ invoke }));

describe("agentRegistry service", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  test("wraps list, refresh, and get commands", async () => {
    const { getAgent, listAgents, refreshAgents } = await import("./agentRegistry");

    await listAgents();
    await refreshAgents();
    await refreshAgents(true);
    await getAgent("claude");

    expect(invoke).toHaveBeenCalledWith("agent_registry_list");
    expect(invoke).toHaveBeenCalledWith("agent_registry_refresh", { force: false });
    expect(invoke).toHaveBeenCalledWith("agent_registry_refresh", { force: true });
    expect(invoke).toHaveBeenCalledWith("agent_registry_get", { id: "claude" });
  });

  test("wraps install, update, and uninstall builtin commands and publishes registry snapshot", async () => {
    const { installBuiltinAgent, updateBuiltinAgent, uninstallBuiltinAgent } = await import("./agentRegistry");
    const { getAgentRegistrySnapshot } = await import("../stores/agentRegistryStore");
    const agents = [
      {
        id: "codex",
        name: "Codex CLI",
        kind: "codex",
        available: true,
        backend: "codex",
        command: "codex",
        detectedAt: "2026-05-24T00:00:00.000Z",
      },
    ];
    invoke.mockImplementation(async () => agents);

    const result = await installBuiltinAgent("codex");

    expect(invoke).toHaveBeenCalledWith("agent_registry_install_builtin", { kind: "codex" });
    expect(result).toEqual(agents);
    expect(getAgentRegistrySnapshot().agents).toEqual(agents);

    await updateBuiltinAgent("codex");
    expect(invoke).toHaveBeenCalledWith("agent_registry_update_builtin", { kind: "codex" });

    await uninstallBuiltinAgent("cursor");
    expect(invoke).toHaveBeenCalledWith("agent_registry_uninstall_builtin", { kind: "cursor" });
  });

  test("concurrent listAgents calls share one IPC request and later calls issue a new one", async () => {
    const { listAgents } = await import("./agentRegistry");
    let resolveList: (value: unknown) => void = () => {};
    invoke.mockImplementation(
      () => new Promise((resolve) => { resolveList = resolve; }),
    );

    const calls = Array.from({ length: 12 }, () => listAgents());
    expect(invoke).toHaveBeenCalledTimes(1);
    resolveList([]);
    const results = await Promise.all(calls);
    expect(results.every((r) => Array.isArray(r))).toBe(true);

    invoke.mockImplementation(async () => []);
    await listAgents();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  test("a failed listAgents does not wedge later calls", async () => {
    const { listAgents } = await import("./agentRegistry");
    invoke.mockImplementation(async () => {
      throw new Error("ipc down");
    });
    await expect(listAgents()).rejects.toThrow("ipc down");
    invoke.mockImplementation(async () => []);
    await expect(listAgents()).resolves.toEqual([]);
  });

  test("a slow list response does not overwrite a newer refresh snapshot", async () => {
    const { listAgents, refreshAgents } = await import("./agentRegistry");
    const { getAgentRegistrySnapshot } = await import("../stores/agentRegistryStore");
    const stale = [{ id: "stale", name: "Stale", kind: "codex", available: false }];
    const fresh = [{ id: "fresh", name: "Fresh", kind: "codex", available: true }];
    let resolveList: (value: unknown) => void = () => {};
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "agent_registry_list") {
        return new Promise((resolve) => { resolveList = resolve; });
      }
      return fresh;
    });

    const pendingList = listAgents();
    await refreshAgents(true);
    resolveList(stale);
    await pendingList;

    expect(getAgentRegistrySnapshot().agents).toEqual(fresh as never);
  });

  test("wraps custom agent commands with the exact payload shape", async () => {
    const { deleteCustomAgent, saveCustomAgent, testCustomAgent } = await import("./agentRegistry");
    const input: CustomAgentInput = {
      id: "custom:local",
      name: "Local Agent",
      command: "/bin/echo",
      args: ["hello"],
      env: { WISE_TEST: "1" },
    };

    await testCustomAgent(input);
    await saveCustomAgent(input);
    await deleteCustomAgent("custom:local");

    expect(invoke).toHaveBeenCalledWith("agent_registry_test_custom", input);
    expect(invoke).toHaveBeenCalledWith("agent_registry_save_custom", input);
    expect(invoke).toHaveBeenCalledWith("agent_registry_delete_custom", { id: "custom:local" });
  });
});
