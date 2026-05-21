import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("../../services/agentRegistry", () => ({
  deleteCustomAgent: mock(async () => undefined),
  listAgents: mock(async () => []),
  refreshAgents: mock(async () => []),
  saveCustomAgent: mock(async () => ({
    id: "custom:test",
    name: "Test Agent",
    kind: "custom",
    available: true,
    backend: "custom",
    command: "test-agent",
    args: [],
    env: {},
    detectedAt: "2026-05-17T00:00:00.000Z",
  })),
  testCustomAgent: mock(async () => ({ ok: true, resolvedPath: "/usr/local/bin/test-agent" })),
}));

describe("AgentRegistrySection", () => {
  test("renders the agent registry list", async () => {
    const { AgentRegistrySection } = await import("./AgentRegistrySection");
    const html = renderToStaticMarkup(<AgentRegistrySection />);

    expect(html).toContain("新增预留入口");
    expect(html).toContain("重新探测");
    expect(html).toContain("暂未探测到 Claude Code 运行入口");
  });
});
