import { beforeEach, describe, expect, mock, test } from "bun:test";

const invokeMock = mock<(cmd: string, args?: unknown) => Promise<unknown>>(async () => undefined);
mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  transformCallback: () => 0,
  Channel: class {},
  PluginListener: class {},
  addPluginListener: async () => ({ id: 0 }),
  convertFileSrc: (s: string) => s,
}));

import {
  deleteMcpServer,
  getMcpSupportedTransports,
  listMcpServers,
  saveMcpServer,
  testMcpConnectionById,
  testMcpConnectionDraft,
  type McpServerInput,
} from "./mcp";

beforeEach(() => {
  invokeMock.mockReset();
});

const sampleInput: McpServerInput = {
  name: "claude-mcp",
  transport: { type: "stdio", command: "claude-mcp", args: ["--port", "0"] },
  enabled: true,
  source: "user",
};

describe("mcp service", () => {
  test("listMcpServers calls mcp_list_servers", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await listMcpServers();
    expect(invokeMock).toHaveBeenCalledWith("mcp_list_servers");
  });

  test("saveMcpServer wraps server in arg", async () => {
    invokeMock.mockResolvedValueOnce({});
    await saveMcpServer(sampleInput);
    expect(invokeMock).toHaveBeenCalledWith("mcp_save_server", {
      arg: { server: sampleInput },
    });
  });

  test("deleteMcpServer wraps id arg", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await deleteMcpServer("abc");
    expect(invokeMock).toHaveBeenCalledWith("mcp_delete_server", {
      arg: { id: "abc" },
    });
  });

  test("testMcpConnectionById sends id-only test arg", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true });
    await testMcpConnectionById("xyz");
    expect(invokeMock).toHaveBeenCalledWith("mcp_test_connection", {
      arg: { id: "xyz" },
    });
  });

  test("testMcpConnectionDraft sends draft-only test arg", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true });
    await testMcpConnectionDraft(sampleInput);
    expect(invokeMock).toHaveBeenCalledWith("mcp_test_connection", {
      arg: { draft: sampleInput },
    });
  });

  test("getMcpSupportedTransports wraps engineId", async () => {
    invokeMock.mockResolvedValueOnce(["stdio"]);
    await getMcpSupportedTransports("claude");
    expect(invokeMock).toHaveBeenCalledWith("mcp_supported_transports", {
      arg: { engineId: "claude" },
    });
  });
});
