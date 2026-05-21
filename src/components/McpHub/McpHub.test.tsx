import { describe, expect, mock, test } from "bun:test";
import { App as AntApp } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { McpHub } from "./McpHub";

mock.module("../../hooks/useClaudeMcpList", () => ({
  useClaudeMcpList: () => ({
    mcpData: {
      user: [
        {
          id: "user-seq",
          name: "sequential-thinking",
          command: "npx sequential-thinking",
          args: [],
          tools: ["think"],
          scope: "user",
          enabled: true,
          sourcePath: "~/.claude.json",
          runtimeStatus: "connected",
        },
      ],
      local: [],
      projectShared: [],
      legacyUserSettings: [],
      legacyProjectSettings: [],
      pluginMcp: [],
    },
    mcpLoading: false,
    mcpRefreshing: false,
    mcpError: null,
    mcpHasData: true,
    mcpCount: 1,
    filteredMcpData: {
      user: [
        {
          id: "user-seq",
          name: "sequential-thinking",
          command: "npx sequential-thinking",
          args: [],
          tools: ["think"],
          scope: "user",
          enabled: true,
          sourcePath: "~/.claude.json",
          runtimeStatus: "connected",
        },
      ],
      local: [],
      projectShared: [],
      legacyUserSettings: [],
      legacyProjectSettings: [],
      pluginMcp: [],
    },
    mcpHasFilteredData: true,
    refreshMcp: mock(async () => undefined),
    handleDelete: mock(() => undefined),
    handleToggleEnabled: mock(async () => undefined),
  }),
}));

mock.module("../../services/cuaDriver", () => ({
  computerUseMcpLikelyRegistered: mock(() => true),
  getCuaDriverStatus: mock(async () => ({
    platformMacos: true,
    installed: true,
    appRunning: false,
    helperRunning: false,
    mcpServerPath: null,
  })),
}));

mock.module("../../services/extensions", () => ({
  getExtensionMcpServers: mock(async () => [
    {
      id: "writer.mcp.search",
      extension: "writer-kit",
      name: "search",
      description: "搜索工具",
      transport: { type: "stdio", command: "node", args: ["server.js"] },
    },
  ]),
}));

mock.module("../ClaudeMcp/ClaudeMcpAddServerModal", () => ({
  ClaudeMcpAddServerModal: () => <section data-stub="add-mcp">添加 MCP</section>,
}));

mock.module("../ComputerUseMcpSection", () => ({
  ComputerUseMcpSection: () => <section data-stub="computer-use">Computer Use</section>,
}));

describe("McpHub", () => {
  test("renders the MCP tool list with management actions", () => {
    const html = renderToStaticMarkup(
      <AntApp>
        <McpHub repositoryPath="/repo/wise" onClose={() => {}} />
      </AntApp>,
    );

    expect(html).toContain("MCP 工具市场");
    expect(html).toContain("刷新");
    expect(html).toContain("添加");
    expect(html).toContain("sequential-thinking");
  });
});
