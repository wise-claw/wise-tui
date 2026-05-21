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
 *   - `cockpit`  → 全屏 MissionControl（替换主区，左栏保留）
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
  | "prompts"
  | "trellis-spec"
  | "claude-config"
  | "extensions"
  | "assistants"
  | "engine-registry"
  | "channels"
  | "automation"
  | "artifacts"
  | "shortcuts"
  | "sandbox";

export const DEFAULT_AUTHOR_PANE: AuthorPane = "workspaces";

export const WORKSPACE_SCOPED_AUTHOR_PANES: ReadonlySet<AuthorPane> = new Set([
  "workspaces",
  "agents",
  "workflows",
  "mcp",
  "skills",
  "claude-plugins",
  "hooks",
  "prompts",
  "trellis-spec",
]);

/**
 * Inspect 工具枚举。
 *
 * P0 阶段仅有 code-graph 与 workflow-studio（即历史代码中的两个叠层）。
 * P5 之后会扩展为：task-detail / monitor-drawer / session-history
 * 等更多透镜（见宪法 §3）。
 */
export type InspectTool = InspectCodeGraph | InspectWorkflowStudio;

export interface InspectCodeGraph {
  kind: "code-graph";
  /** 来自侧栏「图谱操作 → 查看检索」时为 true：图谱面板不在 idle 时自动重建索引；顶栏入口为 false。 */
  suppressIdleAutoReindex: boolean;
  /** 侧栏仓库/Workspace 入口为 true：仅当前仓 UI，不显示「全部仓库」关联入口。 */
  lockToEntryRepository: boolean;
  /** 侧栏 Workspace 入口为 true：默认多仓关联合并视图（候选 ≥ 2 时）。 */
  defaultProjectMultiRepo: boolean;
}

export interface InspectWorkflowStudio {
  kind: "workflow-studio";
}

/** 默认 View（应用启动 / `back()` 回退兜底）。主会话优先，助手从左栏显式进入。 */
export const DEFAULT_VIEW_MODE: ViewMode = { kind: "chat" };
