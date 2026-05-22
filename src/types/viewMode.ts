/**
 * 顶层 View 模式（按宪法 §3）
 *
 * 这是一个 discriminated union，表达"用户当前处于哪个全屏视图 / 叠层"。
 * 取代 AppImpl 中曾经的 6 个互斥布尔（`promptsMode` / `mcpHubMode` /
 * `skillsHubMode` / `missionControlMode` / `codeKnowledgeGraphMode` /
 * `ccWfStudioMode`）。
 *
 * P0 阶段：仅替换状态结构，不改任何视觉行为。各 kind 的渲染规则与
 * 重构前完全一致：
 *   - `chat`     → ClaudeSessions + RightPanel（默认主屏）
 *   - `cockpit`  → AssistantHub / 需求助手工作台（替换主区，左栏保留）
 *   - `author`   → 三种 pane 渲染规则不同（详见下方）
 *   - `inspect`  → 叠层（在底层 view 之上，左栏保留）
 *
 * `author` 统一渲染为全屏 AuthorPanel，内部 Tab 承载 Workspace /
 * Agents / Workflows / MCP / Skills / Hooks / Prompts / Trellis Spec /
 * 应用级设置。
 */
export type ViewMode =
  | { kind: "chat" }
  | { kind: "cockpit"; missionId?: string }
  | { kind: "author"; pane: AuthorPane }
  | { kind: "inspect"; tool: InspectTool };

export type AuthorPane =
  | "workspaces"
  | "agents"
  | "workflows"
  | "mcp"
  | "skills"
  | "claude-plugins"
  | "hooks"
  | "claude-config"
  | "extensions"
  | "assistants"
  | "engine-registry"
  | "channels"
  | "automation"
  | "artifacts"
  | "shortcuts"
  | "sandbox"
  | "defaults";

export const DEFAULT_AUTHOR_PANE: AuthorPane = "agents";

export const WORKSPACE_SCOPED_AUTHOR_PANES: ReadonlySet<AuthorPane> = new Set([
  "agents",
  "workflows",
  "mcp",
  "skills",
  "claude-plugins",
  "hooks",
]);

/**
 * Inspect 工具枚举。
 *
 * Stage 5(D5 / E7)新增 Trellis 运行透镜:`runtime-events` / `workflow-graph` /
 * `spec-timeline`。规范编辑由 Author 工作区的 `ProjectTrellisCenter` 承担。
 */
export type InspectTool =
  | InspectCodeGraph
  | InspectWorkflowStudio
  | InspectRuntimeEvents
  | InspectWorkflowGraph
  | InspectSpecTimeline;

export interface InspectCodeGraph {
  kind: "code-graph";
  /** 来自侧栏「图谱操作 → 查看检索」时为 true：图谱面板不在 idle 时自动重建索引;顶栏入口为 false。 */
  suppressIdleAutoReindex: boolean;
  /** 侧栏仓库/Workspace 入口为 true：仅当前仓 UI,不显示「全部仓库」关联入口。 */
  lockToEntryRepository: boolean;
  /** 侧栏 Workspace 入口为 true：默认多仓关联合并视图(候选 ≥ 2 时)。 */
  defaultProjectMultiRepo: boolean;
}

export interface InspectWorkflowStudio {
  kind: "workflow-studio";
}

/** Trellis 运行证据透镜:onboarding / agent ownership / runtime events feed。 */
export interface InspectRuntimeEvents {
  kind: "runtime-events";
  rootPath: string;
  projectId: string | null;
}

/** Trellis 工作流图透镜:展示 workflow.md 编译后的阶段图与平台分支。 */
export interface InspectWorkflowGraph {
  kind: "workflow-graph";
  rootPath: string;
  projectId: string | null;
}

/** Trellis spec revision / workspace snapshot 时间轴透镜。 */
export interface InspectSpecTimeline {
  kind: "spec-timeline";
  rootPath: string;
}

/** 默认 View（应用启动 / `back()` 回退兜底）。主会话优先，助手从左栏显式进入。 */
export const DEFAULT_VIEW_MODE: ViewMode = { kind: "chat" };
