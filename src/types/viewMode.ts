/**
 * 顶层 View 模式（按宪法 §3）
 *
 * discriminated union，表达用户当前处于哪个全屏视图 / 叠层。
 *
 * P0 阶段渲染规则：
 *   - `chat`     → ClaudeSessions（默认主屏）
 *   - `cockpit`  → AssistantHub / MCP / 技能 / 自动化 Hub（替换主区，左栏保留）
 *   - `author`   → 三种 pane 渲染规则不同（详见下方）
 *   - `inspect`  → 叠层（在底层 view 之上，左栏保留；MCP / 技能快捷入口）
 *
 * `author` 统一渲染为全屏 AuthorPanel，内部 Tab 承载 Workspace /
 * Agents / Workflows / MCP / Skills / Hooks / 应用级设置等。
 */
/** Cockpit 叠层内的 Hub 子页（左栏快捷入口与助手 Hub 打开方式一致）。 */
export type CockpitHubPane = "assistant" | "mcp" | "skills" | "automation";

export const DEFAULT_COCKPIT_HUB_PANE: CockpitHubPane = "assistant";

export type ViewMode =
  | { kind: "chat" }
  | { kind: "cockpit"; hubPane?: CockpitHubPane }
  | { kind: "author"; pane: AuthorPane }
  | { kind: "inspect"; tool: InspectTool };

export function resolveCockpitHubPane(
  view: Extract<ViewMode, { kind: "cockpit" }>,
): CockpitHubPane {
  return view.hubPane ?? DEFAULT_COCKPIT_HUB_PANE;
}

export type AuthorPane =
  | "workspaces"
  | "agents"
  | "workflows"
  | "mcp"
  | "skills"
  | "claude-plugins"
  | "hooks"
  | "extensions"
  | "my-extensions"
  | "assistants"
  | "engine-registry"
  | "channels"
  | "automation"
  | "artifacts"
  | "shortcuts"
  | "sandbox"
  | "defaults"
  | "data-cleanup"
  | "auto-approve";

export const DEFAULT_AUTHOR_PANE: AuthorPane = "agents";

export const WORKSPACE_SCOPED_AUTHOR_PANES: ReadonlySet<AuthorPane> = new Set([
  "agents",
  "workflows",
  "mcp",
  "skills",
  "claude-plugins",
  "my-extensions",
  "hooks",
]);

/** Inspect 工具枚举：侧栏 MCP / 技能快捷叠层。 */
export type InspectTool = InspectMcpHub | InspectSkillsHub;

/** 侧栏 MCP 快捷入口：叠在主会话区之上，左栏保留。 */
export interface InspectMcpHub {
  kind: "mcp-hub";
}

/** 侧栏技能快捷入口：叠在主会话区之上，左栏保留。 */
export interface InspectSkillsHub {
  kind: "skills-hub";
}

/** 默认 View（应用启动 / `back()` 回退兜底）。主会话优先，助手从左栏显式进入。 */
export const DEFAULT_VIEW_MODE: ViewMode = { kind: "chat" };
