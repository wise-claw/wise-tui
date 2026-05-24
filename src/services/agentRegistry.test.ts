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

  test("wraps install builtin command", async () => {
    const { installBuiltinAgent } = await import("./agentRegistry");

    await installBuiltinAgent("codex");

    expect(invoke).toHaveBeenCalledWith("agent_registry_install_builtin", { kind: "codex" });
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
