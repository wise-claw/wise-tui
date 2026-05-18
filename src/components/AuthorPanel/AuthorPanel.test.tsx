import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthorPane } from "../../types/viewMode";

/**
 * AuthorPanel composes 7 heavy children (EmployeeConfigModal, WorkflowConfigModal,
 * McpHub, SkillsHub, PromptsPanel, ProjectTrellisCenter, ClaudeHooksConfigPanel),
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

mock.module("../McpHub", () => ({
  McpHub: () => <section data-stub="mcp">MCP Hub</section>,
}));

mock.module("../SkillsHub", () => ({
  SkillsHub: () => <section data-stub="skills">Skills Hub</section>,
}));

mock.module("../PromptsPanel", () => ({
  PromptsPanel: () => <section data-stub="prompts">Prompts Panel</section>,
}));

mock.module("../ProjectTrellisCenter", () => ({
  ProjectTrellisCenter: ({ project }: { project?: { name?: string } | null }) => (
    <section data-stub="trellis">Trellis:{project?.name ?? ""}</section>
  ),
}));

mock.module("../ClaudeHooksConfigPanel", () => ({
  ClaudeHooksConfigPanel: ({ listSearch }: { listSearch?: string }) => (
    <section data-stub="hooks">Hooks:{listSearch ?? ""}</section>
  ),
}));

mock.module("../../services/appSettingsStore", () => ({
  getAppSetting: mock(async () => null),
  setAppSetting: mock(async () => undefined),
}));

const { AuthorPanel, writeAuthorPaneToStorage } = await import("./AuthorPanel");

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
    pane: "workspaces",
    onPaneChange,
    onBack,
    workspacesTabProps: {
      workspaces: [workspace],
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
    promptsPanelProps: {
      onClose: mock(() => {}),
      projects: [workspace],
      repositories: [repo],
      activeProjectId: "w1",
      activeRepositoryId: 1,
      openContext: null,
      repositoryListLoading: false,
    },
    trellisSpecProps: {
      open: true,
      project: workspace,
    },
    repositoryPath: "/repo",
    ...overrides,
  };
  return { props, onPaneChange, onBack };
}

describe("AuthorPanel", () => {
  test("renders eight tab labels", () => {
    const { props } = buildProps();
    const html = renderToStaticMarkup(<AuthorPanel {...props} />);
    for (const label of ["Workspaces", "Agents", "Workflows", "MCP", "Skills", "Hooks", "Prompts", "Trellis Spec"]) {
      expect(html).toContain(label);
    }
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

  test("agents pane mounts EmployeeConfigModal and forwards defaultRepositoryIds", () => {
    const { props } = buildProps({ pane: "agents" });
    const html = renderToStaticMarkup(<AuthorPanel {...props} />);
    expect(html).toContain('data-stub="agents"');
    expect(html).toContain("agents:2");
  });

  test("trellis-spec pane mounts ProjectTrellisCenter with the workspace", () => {
    const { props } = buildProps({ pane: "trellis-spec" });
    const html = renderToStaticMarkup(<AuthorPanel {...props} />);
    expect(html).toContain('data-stub="trellis"');
    expect(html).toContain("Trellis:Wise");
  });

  test("workflows pane mounts WorkflowConfigModal with the initial workflow id", () => {
    const { props } = buildProps({ pane: "workflows" });
    const html = renderToStaticMarkup(<AuthorPanel {...props} />);
    expect(html).toContain('data-stub="workflows"');
    expect(html).toContain("workflows:wf");
  });

  test("hooks pane mounts ClaudeHooksConfigPanel", () => {
    const { props } = buildProps({ pane: "hooks" });
    const html = renderToStaticMarkup(<AuthorPanel {...props} />);
    expect(html).toContain('data-stub="hooks"');
  });

  test("mcp pane mounts McpHub", () => {
    const { props } = buildProps({ pane: "mcp" });
    const html = renderToStaticMarkup(<AuthorPanel {...props} />);
    expect(html).toContain('data-stub="mcp"');
  });

  test("skills pane mounts SkillsHub", () => {
    const { props } = buildProps({ pane: "skills" });
    const html = renderToStaticMarkup(<AuthorPanel {...props} />);
    expect(html).toContain('data-stub="skills"');
  });

  test("prompts pane mounts PromptsPanel", () => {
    const { props } = buildProps({ pane: "prompts" });
    const html = renderToStaticMarkup(<AuthorPanel {...props} />);
    expect(html).toContain('data-stub="prompts"');
  });
});
