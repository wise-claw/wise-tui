import { describe, expect, mock, test } from "bun:test";
import { App as AntApp } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthorPane } from "../../types/viewMode";

/**
 * AuthorPanel composes heavy children (EmployeeConfigModal, WorkflowConfigModal,
 * McpHub, SkillsHub, ClaudeHooksConfigPanel, and settings center panels),
 * each of which transitively pulls in Tauri commands, antd Modals, etc.
 *
 * We mock just those children with lightweight stubs so the test can assert
 * which one is mounted and how props flow. We deliberately do NOT mock antd
 * — that would pollute the global module registry (`mock.module` is per
 * process in bun) and break unrelated tests in the same suite.
 *
 * We render with `react-dom/server` (static markup) instead of
 * `react-test-renderer`. That sidesteps the need for a JSDOM environment,
 * avoids the cyclic-children issue with `JSON.stringify(node.children)`,
 * and lets real antd Button / Empty / Typography render as plain HTML.
 */

mock.module("../EmployeeConfigModal", () => ({
  EmployeeConfigModal: ({
    defaultRepositoryIds,
  }: {
    defaultRepositoryIds?: number[];
  }) => <section data-stub="agents">agents:{(defaultRepositoryIds ?? []).join(",")}</section>,
}));

mock.module("../WorkflowConfigModal", () => ({
  WorkflowConfigModal: ({ initialWorkflowId }: { initialWorkflowId?: string | null }) => (
    <section data-stub="workflows">workflows:{initialWorkflowId ?? ""}</section>
  ),
}));

mock.module("../ClaudeHooksConfigPanel", () => ({
  ClaudeHooksConfigPanel: ({ listSearch }: { listSearch?: string }) => (
    <section data-stub="hooks">Hooks:{listSearch ?? ""}</section>
  ),
}));

mock.module("../PromptMilkdownField", () => ({
  PromptMilkdownField: ({ label, hint }: { label: string; hint?: string }) => (
    <section data-stub="prompt-editor">
      {label}
      {hint ?? ""}
    </section>
  ),
}));

mock.module("../../services/splitPromptLayersStore", () => ({
  loadPlatformSplitPromptLayers: mock(async () => null),
  clearProjectSplitPromptLayers: mock(async () => undefined),
  clearRepositorySplitPromptLayers: mock(async () => undefined),
  loadProjectSplitPromptLayers: mock(async () => null),
  loadRepositorySplitPromptLayers: mock(async () => null),
  saveProjectSplitPromptLayers: mock(async () => undefined),
  saveRepositorySplitPromptLayers: mock(async () => undefined),
}));

mock.module("../../hooks/useTrellisRuntime", () => ({
  useTrellisRuntime: ({ enabled }: { enabled?: boolean } = {}) => ({
    agentGraph: enabled
      ? {
          nodes: [{ id: "agent-a", nodeType: "agent", label: "Agent A", metadata: {} }],
          edges: [{ id: "edge-a", source: "agent-a", target: "task-a", edgeType: "owns", metadata: {} }],
          runs: [],
        }
      : null,
  }),
}));

mock.module("../MissionControl/canvas/AgentOwnershipGraph", () => ({
  AgentOwnershipGraph: () => <section data-stub="ownership-graph">所有权图</section>,
}));

mock.module("../MissionControl/canvas/RuntimeEventFeed", () => ({
  RuntimeEventFeed: () => <section data-stub="runtime-feed">运行事件</section>,
}));

mock.module("../MissionControl/canvas/SpecRevisionTimeline", () => ({
  SpecRevisionTimeline: () => <section data-stub="spec-revisions">修订记录</section>,
}));

mock.module("../MissionControl/canvas/OnboardingChecklist", () => ({
  OnboardingChecklist: () => <section data-stub="onboarding">健康检查</section>,
}));

mock.module("../MissionControl/canvas/WorkspaceSnapshotViewer", () => ({
  WorkspaceSnapshotViewer: () => <section data-stub="snapshots">工作区快照</section>,
}));

mock.module("../MissionControl/engineering/WorkflowGraphPanel", () => ({
  WorkflowGraphPanel: () => <section data-stub="workflow-graph">工作流图</section>,
}));

mock.module("../../services/appSettingsStore", () => ({
  getAppSetting: mock(async () => null),
  getAppSettingJson: mock(async () => null),
  setAppSetting: mock(async () => undefined),
  setAppSettingJson: mock(async () => undefined),
  deleteAppSetting: mock(async () => undefined),
}));

mock.module("../../services/repositoryScheduledClaudeTasksStore", () => ({
  readRepositoryScheduledClaudeTasks: mock(async () => []),
  writeRepositoryScheduledClaudeTasks: mock(async () => undefined),
  patchRepositoryScheduledClaudeTask: mock(async () => []),
  initialLastScheduledSlotForCron: mock(() => undefined),
}));

mock.module("../RepositoryScheduledTasksModal", () => ({
  RepositoryScheduledTasksModal: ({ repositoryPath }: { repositoryPath: string }) => (
    <section data-stub="scheduled-tasks-modal">Scheduled:{repositoryPath}</section>
  ),
}));

mock.module("../DingTalkEnterpriseBotPopoverBody", () => ({
  DingTalkEnterpriseBotPopoverBody: () => <section data-stub="dingtalk-config">DingTalk</section>,
}));

mock.module("../../services/dingtalkEnterpriseBot", () => ({
  loadDingTalkEnterpriseBotConfig: mock(async () => null),
}));

mock.module("../../services/dingtalkStreamGateway", () => ({
  dingtalkStreamGatewayIsRunning: mock(async () => false),
  dingtalkStreamGatewayStart: mock(async () => undefined),
  dingtalkStreamGatewayStatus: mock(async () => ({ running: false, phase: "stopped" })),
  dingtalkStreamGatewayStop: mock(async () => undefined),
}));

mock.module("../../services/repositoryFiles", () => ({
  searchRepositoryFiles: mock(async () => []),
  listRepositoryExplorerEntries: mock(async () => []),
}));

mock.module("@tauri-apps/plugin-opener", () => ({
  openPath: mock(async () => undefined),
}));

mock.module("@tauri-apps/api/path", () => ({
  homeDir: mock(async () => "/Users/test"),
}));

const claudeConfigInfo = {
  rawValue: null,
  resolvedPath: "/Users/test/.claude",
  defaultResolvedPath: "/Users/test/.claude",
  isDefault: true,
  exists: true,
};

mock.module("../ClaudeConfigDirPanel/useClaudeConfigDir", () => ({
  useClaudeConfigDir: () => ({
    info: claudeConfigInfo,
    loading: false,
    saving: false,
    refresh: mock(async () => undefined),
    save: mock(async () => claudeConfigInfo),
    reset: mock(async () => undefined),
  }),
}));

mock.module("../ClaudeConfigDirPanel/useClaudeConfigDirChoice", () => ({
  useClaudeConfigDirChoice: () => ({
    state: { choice: "default", customDraft: "" },
    setChoice: mock(() => undefined),
    setCustomDraft: mock(() => undefined),
    dirty: false,
    resolveValueToSave: mock(() => null),
    syncToInfo: mock(() => undefined),
  }),
}));

mock.module("../ClaudeConfigDirPanel/useClaudeConnectionModeSetting", () => ({
  useClaudeConnectionModeSetting: () => ({
    kind: "streaming" as const,
    loading: false,
    saving: false,
    refresh: mock(async () => undefined),
    save: mock(async () => undefined),
    labels: {
      streaming: { title: "长驻会话（推荐）", description: "stream-json" },
      oneshot: { title: "逐轮独立进程", description: "-p" },
    },
  }),
}));

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

const { AuthorPanel } = await import("./AuthorPanel");
const { resolveAuthorNavPane, writeAuthorPaneToStorage } = await import("./authorPaneStorage");
const { AuthorPanelNav } = await import("./AuthorPanelNav");

function renderAuthorPanel(props: Parameters<typeof AuthorPanel>[0]): string {
  return renderToStaticMarkup(
    <AntApp>
      <AuthorPanelNav
        pane={props.pane}
        onPaneChange={props.onPaneChange}
        onBack={props.onBack}
      />
      <AuthorPanel {...props} />
    </AntApp>,
  );
}

const workspace = {
  id: "w1",
  name: "Wise",
  repositoryIds: [1],
  createdAt: 0,
  updatedAt: 0,
  rootPath: "/repo",
  sddMode: "wise_trellis" as const,
};

const repo = {
  id: 2,
  name: "standalone",
  path: "/repo/standalone",
  repositoryType: "frontend" as const,
  createdAt: "",
  updatedAt: "",
};

function buildProps(
  overrides: Partial<Parameters<typeof AuthorPanel>[0]> = {},
): {
  props: Parameters<typeof AuthorPanel>[0];
  onPaneChange: ReturnType<typeof mock<(p: AuthorPane) => void>>;
  onBack: ReturnType<typeof mock<() => void>>;
} {
  const onPaneChange = mock((_: AuthorPane) => {});
  const onBack = mock(() => {});
  const props: Parameters<typeof AuthorPanel>[0] = {
    pane: "agents",
    onPaneChange,
    onBack,
    workspacesTabProps: {
      workspaces: [workspace],
      repositories: [repo],
      standaloneRepos: [repo],
      activeWorkspaceId: "w1",
      activeRepositoryId: null,
      onCreateWorkspace: mock(() => {}),
      onAddStandaloneRepo: mock(() => {}),
      onSelectWorkspace: mock(() => {}),
      onSelectStandaloneRepo: mock(() => {}),
    },
    employeeConfigProps: {
      open: true,
      loading: false,
      employees: [],
      workflowTemplates: [],
      workflowGraphsByWorkflowId: {},
      repositories: [repo],
      projects: [workspace],
      agentTypeOptions: ["executor"],
      defaultRepositoryIds: [2],
      onClose: mock(() => {}),
      onCreate: mock(async () => {}),
      onUpdate: mock(async () => {}),
      onDelete: mock(async () => {}),
    },
    workflowConfigProps: {
      open: true,
      loading: false,
      employees: [],
      repositoryPath: "/repo",
      templates: [],
      projects: [workspace],
      workflowProjectIds: {},
      selectableEmployeeIds: [],
      onClose: mock(() => {}),
      onSaveTemplate: mock(async () => ({
        id: "wf",
        name: "wf",
        isDefault: false,
        stages: [],
        createdAt: 0,
        updatedAt: 0,
      })),
      onLoadGraphItem: mock(async () => null),
      onSaveGraph: mock(async () => {}),
      onValidateGraph: mock(async () => ({ ok: true, errors: [] })),
      onDeleteTemplate: mock(async () => {}),
      initialWorkflowId: "wf",
    },
    mcpHubProps: { repositoryPath: "/repo" },
    skillsHubProps: { repositoryPath: "/repo" },
    repositoryPath: "/repo",
    automationPanelProps: {
      repositories: [repo],
      activeRepositoryId: repo.id,
      employees: [],
      workflowTemplates: [],
      workflowGraphsByWorkflowId: {},
    },
    artifactsPanelProps: {
      repositories: [repo],
      activeRepositoryId: repo.id,
      onOpenRepositoryFile: mock(() => {}),
    },
    ...overrides,
  };
  return { props, onPaneChange, onBack };
}

describe("AuthorPanel", () => {
  test("renders configuration center tab labels", () => {
    const { props } = buildProps();
    const html = renderAuthorPanel(props);
    for (const label of [
      "智能体角色",
      "工作流",
      "MCP 工具",
      "技能市场",
      "触发器规则",
      "引擎环境",
      "扩展市场",
      "助手模板",
      "执行环境",
      "定时自动化",
      "远程入口",
      "默认配置",
      "快捷键",
      "Claude 沙箱",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("工作区");
    expect(html).not.toContain("产物检查台");
    expect(html).not.toContain("委派协议");
  });

  test("pane change and back callbacks remain shell-owned", () => {
    const { props, onPaneChange, onBack } = buildProps();
    props.onPaneChange("agents");
    props.onBack();
    expect(onPaneChange).toHaveBeenCalledWith("agents");
    expect(onBack).toHaveBeenCalled();
  });

  test("persists the last Author pane through the settings store", async () => {
    const { setAppSetting } = await import("../../services/appSettingsStore");
    writeAuthorPaneToStorage("skills");
    expect(setAppSetting).toHaveBeenCalledWith("wise.author.lastPane", "skills");
  });

  test("persists workbench panes through the settings store", async () => {
    const { setAppSetting } = await import("../../services/appSettingsStore");
    writeAuthorPaneToStorage("agents");
    expect(setAppSetting).toHaveBeenCalledWith("wise.author.lastPane", "agents");
    writeAuthorPaneToStorage("workflows");
    expect(setAppSetting).toHaveBeenCalledWith("wise.author.lastPane", "workflows");
  });

  test("keeps direct-entry workspaces pane routable", () => {
    expect(resolveAuthorNavPane("workspaces")).toBe("workspaces");
  });

  test("workspaces pane renders the workspace list", () => {
    const { props } = buildProps({ pane: "workspaces" });
    const html = renderAuthorPanel(props);
    expect(html).toContain("Wise");
  });

  test("agents pane mounts EmployeeConfigModal and forwards defaultRepositoryIds", () => {
    const { props } = buildProps({ pane: "agents" });
    const html = renderAuthorPanel(props);
    expect(html).toContain('data-stub="agents"');
    expect(html).toContain("agents:2");
  });

  test("workflows pane mounts WorkflowConfigModal with the initial workflow id", () => {
    const { props } = buildProps({ pane: "workflows" });
    const html = renderAuthorPanel(props);
    expect(html).toContain('data-stub="workflows"');
    expect(html).toContain("workflows:wf");
  });

  test("hooks pane mounts ClaudeHooksConfigPanel", () => {
    const { props } = buildProps({ pane: "hooks" });
    const html = renderAuthorPanel(props);
    expect(html).toContain("新增触发器");
    expect(html).toContain('data-stub="hooks"');
  });

  test("mcp pane mounts McpHub", () => {
    const { props } = buildProps({ pane: "mcp" });
    const html = renderAuthorPanel(props);
    expect(html).toContain("MCP");
  });

  test("skills pane mounts SkillsHub", () => {
    const { props } = buildProps({ pane: "skills" });
    const html = renderAuthorPanel(props);
    expect(html).toContain("技能");
  });

  test("claude-plugins pane mounts ClaudePluginMarketHub", () => {
    const { props } = buildProps({ pane: "claude-plugins" });
    const html = renderAuthorPanel(props);
    expect(html).toContain("Claude Code 插件");
    expect(html).toContain("精选市场");
  });

  test("defaults pane renders global session and layout defaults", () => {
    const { props } = buildProps({ pane: "defaults" });
    const html = renderAuthorPanel(props);
    expect(html).toContain("会话处理方式");
    expect(html).toContain("右侧面板");
    expect(html).toContain("长驻会话");
    expect(html).toContain("逐轮处理");
    expect(html).toContain("说明");
    expect(html).toContain("设置写入 SQLite app_settings");
  });

  test("application setting panes mount inside configuration center", () => {
    for (const pane of [
      "defaults",
      "claude-config",
      "assistants",
      "engine-registry",
      "shortcuts",
      "sandbox",
      "extensions",
      "automation",
      "channels",
    ] as const) {
      const { props } = buildProps({ pane });
      renderAuthorPanel(props);
    }

    const channelsHtml = renderAuthorPanel(buildProps({ pane: "channels" }).props);
    expect(channelsHtml).toContain("远程入口");
    expect(channelsHtml).toContain('data-stub="dingtalk-config"');

    const automationHtml = renderAuthorPanel(buildProps({ pane: "automation" }).props);
    expect(automationHtml).toContain('data-stub="scheduled-tasks-modal"');
  });
});
