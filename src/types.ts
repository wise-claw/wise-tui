import type { MouseEvent as ReactMouseEvent } from "react";

/** Wise 侧栏中保存的工作区（磁盘上的 Git/代码目录）。 */
export interface Repository {
  id: number;
  /** 与 `path` 末段目录名一致（打开的仓库名）。 */
  name: string;
  path: string;
  /** 自定义角色标签预设（前端 / 后端 / 文档），用于任务拆分等流程。Legacy 单值。 */
  repositoryType: "frontend" | "backend" | "document";
  /** 多角色标签（路径 X）。空数组或缺省时通过 `getRoleTags` fallback 到 `[repositoryType]`。 */
  roleTags?: string[];
  /** 侧栏角标圆形背景色（`#rrggbb`）；未设置时按 `repositoryType` 的默认角色色。 */
  iconColor?: string | null;
  /** 侧栏圆形角标内展示的角标标题；未设置时角标内显示角色默认文案（前/后/文）。 */
  iconDisplayName?: string | null;
  /**
   * 配置为仓库「主 Owner」的子代理名称（须与标签展示名中 `…/员工:名称` 的名称段一致，如 executor）。
   * 未设置时侧栏点仓库仍优先人类主会话（无 `员工:` 段的标签）。
   */
  mainOwnerAgentName?: string | null;
  branch?: string;
  createdAt: string;
  updatedAt: string;
  /** Legacy 仓库级 SDD 模式；路径 X 后改由 `Project.sddMode` 承担，仅作回退读取。 */
  sddMode?: SddMode;
}

/** Legacy 仓库级 SDD 模式（仍保留 `auto`/`off` 以兼容旧数据）。新逻辑请使用 `ProjectSddMode`。 */
export type SddMode = "auto" | "wise_trellis" | "project_owned" | "off";

/** Workspace 级 SDD 模式（路径 X 引入）。两值：wise 接管 `.trellis/`，或交给用户自有 SDD 工具。 */
export type ProjectSddMode = "wise_trellis" | "project_owned";

/** 「关联仓库」弹窗确认后、选择目录并创建条目时传入的展示选项。 */
export interface AddRepositoryOptions {
  /** 非空则写入角标标题（圆内展示）；省略或空则角标内仅显示角色默认文案。 */
  iconDisplayName?: string;
  /** 非空则写入持久化角标色；`null` / 省略表示与角色标签默认色一致。 */
  iconColor?: string | null;
  /**
   * 创建前在仓库目录执行一键内置，并据此写入 `sddMode`（单仓与新建工作区一致）。
   * 与显式 `sddMode` 同时传入时以 `bootstrap` 为准。
   */
  bootstrap?: import("./constants/workspaceBootstrapAddons").WorkspaceBootstrapSelection;
  /** 创建后写入仓库 SDD 模式；省略则保持自动模式或由 `bootstrap` 推断。 */
  sddMode?: SddMode;
}

/** 在「关联仓库」弹窗中保存的常用角标 + 角色组合，供下拉直接复选。 */
export interface RepositoryAssociatePreset {
  id: string;
  repositoryType: Repository["repositoryType"];
  iconDisplayName: string;
  iconColor: string | null;
  createdAt: number;
}

export type TaskMode = "chat" | "split";

export interface ProjectItem {
  id: string;
  name: string;
  repositoryIds: number[];
  createdAt: number;
  updatedAt: number;
  /** Workspace 根目录绝对路径；持有 `.trellis/`。空字符串视为尚未配置。 */
  rootPath?: string;
  /** Workspace 级 SDD 模式；新 Workspace 默认 `wise_trellis`。 */
  sddMode?: ProjectSddMode;
  /** 主会话 Agent；为路径 Y 主会话派发预留。 */
  mainAgent?: string | null;
  /** 侧栏圆角标自定义文字。 */
  iconDisplayName?: string | null;
  iconColor?: string | null;
}

export type Workspace = ProjectItem;
export type WorkspaceId = ProjectItem["id"];
export type StandaloneRepo = Repository;
export type StandaloneRepoId = Repository["id"];

export interface EmployeeItem {
  id: string;
  name: string;
  agentType: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  displayOrder: number;
  repositoryIds: number[];
  projectIds: string[];
}

export interface EmployeeTaskCountItem {
  employeeId: string;
  taskCount: number;
}

export type MonitorStatus = "in_progress" | "idle";

export interface EmployeeMonitorItem {
  employeeId: string;
  name: string;
  agentType: string;
  status: MonitorStatus;
  executionSource?: "employee_session" | "workflow";
  latestTaskStatus?: WorkflowTaskItem["status"];
  lastCompletedTaskAt?: number;
  repositoryPath?: string;
  repositoryName?: string;
  previewText: string;
  activeTaskId?: string;
  sessionId?: string;
  updatedAt: number;
}

export interface TeamMonitorItem {
  workflowId: string;
  workflowName: string;
  status: MonitorStatus;
  latestTaskStatus?: WorkflowTaskItem["status"];
  lastCompletedTaskAt?: number;
  repositoryPath?: string;
  repositoryName?: string;
  previewText: string;
  activeTaskId?: string;
  sessionId?: string;
  currentEmployeeId?: string;
  currentEmployeeName?: string;
  currentStageIndex?: number;
  stageCount?: number;
  memberCount?: number;
  memberNames?: string[];
  progressText: string;
  omcProgressText?: string;
  updatedAt: number;
}

export interface RepositoryMemberMonitorSubagentItem {
  invocationKey: string;
  sessionId?: string;
  rootPath?: string;
  repositoryPath?: string;
  taskId?: string;
  taskTitle?: string;
  stage?: string;
  subagentType: string;
  status: "running" | "stale" | "completed" | "failed" | "cancelled" | "reclaimed";
  attempt?: number;
  source?: string;
  currentFile?: string;
  promptExcerpt?: string;
  outputExcerpt?: string;
  toolUseId?: string;
  toolName?: string;
  model?: string;
  startedAt?: number;
  completedAt?: number;
  lastHeartbeatAt?: number;
  lineCount?: number;
  errCount?: number;
  success?: boolean;
  previewText: string;
  updatedAt: number;
}

export interface RepositoryMemberMonitorItem {
  repositoryId: number;
  repositoryName: string;
  repositoryPath: string;
  repositoryType: Repository["repositoryType"];
  status: MonitorStatus;
  previewText: string;
  activeSubagentCount: number;
  subagents: RepositoryMemberMonitorSubagentItem[];
  updatedAt: number;
}

export interface MonitorStats {
  activeEmployees: number;
  employeesInProgress: number;
  employeesIdle: number;
  teamsTotal: number;
  teamsInProgress: number;
  teamsIdle: number;
}

export interface MonitorCompletedTaskItem {
  taskId: string;
  title: string;
  status: WorkflowTaskItem["status"];
  completedAt: number;
  workflowId: string;
  workflowName: string;
  repositoryPath?: string;
  repositoryName?: string;
  creatorSessionId?: string;
}

export type MonitorDrawerTarget =
  | { type: "employee"; employeeId: string }
  | { type: "team"; workflowId: string }
  | { type: "task"; taskId: string };

export interface WorkflowTemplateAssignee {
  id: string;
  employeeId: string;
  requiredCount: number;
  isRequired: boolean;
}

export interface WorkflowTemplateStage {
  id: string;
  name: string;
  stageOrder: number;
  passRule: "ALL_APPROVE" | "ANY_APPROVE";
  rejectRule: "ANY_REJECT_BACK";
  assignees: WorkflowTemplateAssignee[];
}

export interface WorkflowTemplateItem {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  stages: WorkflowTemplateStage[];
}

export type WorkflowGraphNodeType =
  | "start"
  | "task"
  | "approval"
  | "end"
  | "prompt"
  | "knowledge"
  | "code"
  | "branch";

export interface WorkflowVariableDefinition {
  name: string;
  label: string;
  defaultValue?: string;
}

/** 单条阶段成果：名称与要求（Markdown）均可编辑；派发时一并写入强约束文案 */
export interface WorkflowStageOutcomeCriterion {
  name: string;
  requirement: string;
}

export interface WorkflowGraphNodeData extends Record<string, unknown> {
  label: string;
  focused?: boolean;
  showAddButton?: boolean;
  onAddNodeClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  employeeId?: string;
  employeePrompt?: string;
  conditionIfPrompt?: string;
  conditionElsePrompt?: string;
  /** 本阶段多条成果标准；非空时随派发输入作为强约束，并要求结构化 JSON 报告 */
  stageSuccessCriteria?: WorkflowStageOutcomeCriterion[];
  /**
   * 引用本团队中多份成果标准；每项为 `源节点id#成果索引`（索引为规范化后的 stageSuccessCriteria 下标）。
   * 若有值，派发时在阶段任务正文之前注入「阶段任务依据」说明与所选成果标准原文。
   */
  stageTaskBasisRefs?: string[];
  /**
   * @deprecated 由 `stageTaskBasisRefs` 替代；读取时若仅有此项则视为单选。
   */
  stageTaskBasisRef?: string;
  /** 提示词模板节点正文 */
  promptTemplate?: string;
  promptMessages?: import("./workflowPrompt").WorkflowPromptMessage[];
  promptInjectionMode?: import("./workflowPrompt").WorkflowPromptInjectionMode;
  promptRequireAcknowledgement?: boolean;
  /** 知识检索节点查询语句，支持 {{var}}（与 knowledgeQuery 同步） */
  knowledgeQuery?: string;
  knowledgeSearchMode?: import("./workflowKnowledge").WorkflowKnowledgeSearchMode;
  knowledgeNodeKinds?: import("./workflowKnowledge").WorkflowKnowledgeNodeKindFilter[];
  knowledgeTopK?: number;
  knowledgeSubgraphHop?: number;
  knowledgeSubgraphDirection?: import("./codeKnowledgeGraph").CodeGraphSubgraphDirection;
  knowledgePathPrefix?: string;
  knowledgeOutputMode?: import("./workflowKnowledge").WorkflowKnowledgeOutputMode;
  knowledgeRequireCitation?: boolean;
  knowledgeOutputVariable?: string;
  knowledgeSupplementQueries?: string[];
  /** 代码/脚本节点内容（兼容字段，与 codeSource 同步） */
  codeScript?: string;
  codeMode?: import("./workflowCode").WorkflowCodeExecutionMode;
  codeLanguage?: import("./workflowCode").WorkflowCodeLanguage;
  codeSource?: string;
  codeInputBindings?: import("./workflowCode").WorkflowCodeInputBinding[];
  codeOutputVariables?: import("./workflowCode").WorkflowCodeOutputVariable[];
  codeRequireStructuredOutput?: boolean;
  codeWorkingDirectory?: string;
  codeTimeoutSeconds?: number;
  /** 条件分支节点可选说明 */
  branchCriteria?: string;
  /** 条件分支配置 */
  branchConditions?: import("./workflowBranch").WorkflowBranchCondition[];
  /** 开始节点工作流变量定义 */
  workflowVariables?: WorkflowVariableDefinition[];
  materialKey?: string;
}

export interface WorkflowGraphNode {
  id: string;
  type: WorkflowGraphNodeType;
  position: { x: number; y: number };
  data: WorkflowGraphNodeData;
}

export interface WorkflowGraphEdgeData extends Record<string, unknown> {
  label?: string;
  focused?: boolean;
  labelPosition?: "nearSource" | "center" | "nearTarget";
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: WorkflowGraphEdgeData;
  label?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowTaskItem {
  id: string;
  title: string;
  content: string;
  creator: string;
  workflowId: string;
  currentStageIndex: number;
  status: "in_progress" | "completed" | "rejected" | "archived";
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowTaskEventItem {
  id: string;
  taskId: string;
  eventType: string;
  payloadJson: string;
  createdAt: number;
}

export interface AcceptanceVerdictSourceStatsItem {
  verdictSource: string;
  count: number;
}

export interface WorkflowRuntimeStepSnapshot {
  id: string;
  taskId: string;
  phase: "dispatch" | "decision";
  fromNodeId?: string;
  toNodeId?: string;
  toNodeName?: string;
  toNodeType?: WorkflowGraphNodeType;
  /** Wise 会话 id，派发目标员工会话；决策步为产出该决策输出的会话 */
  executorSessionId?: string;
  decision?: "pass" | "reject";
  inputPreview: string;
  outputPreview: string;
  createdAt: number;
}

export interface TaskPendingEmployeeItem {
  employeeId: string;
  name: string;
}

export interface OpenAppTarget {
  id: string;
  label: string;
  kind: "app" | "command" | "finder";
  appName?: string;
  command?: string;
  args: string[];
}

export interface GitFileStatus {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface GitStatusResponse {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  branch: string | null;
  additions: number;
  deletions: number;
  ahead: number;
  behind: number;
  upstream: string | null;
}

export interface GitLogEntry {
  sha: string;
  summary: string;
  author: string;
  timestamp: number;
}

export interface GitLogResponse {
  total: number;
  entries: GitLogEntry[];
  ahead: number;
  behind: number;
  upstream: string | null;
}

export interface GitBranchEntry {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  lastCommitTimestamp: number | null;
  lastCommitSummary: string | null;
  author: string | null;
}

/** `git worktree list --porcelain` 中的一条；`isPrimary` 为主 checkout，不可在此移除。 */
export interface GitWorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  isPrimary: boolean;
}

/** `git_worktree_add_omc_batch`：在仓库上一级 `wise-worktrees/` 下创建独立 worktree 并检出新分支。 */
export interface GitWorktreeAddOmcBatchResult {
  repoRoot: string;
  worktreePath: string;
  branchName: string;
}

export type GitPanelMode = "diff" | "log";

// ── Prompt / Composer Types ──

interface PromptPartBase {
  text: string;
  start: number;
  end: number;
}

export interface PromptTextPart extends PromptPartBase {
  type: "text";
}

export interface PromptFilePart extends PromptPartBase {
  type: "file";
  path: string;
  selection?: FileSelection;
}

export interface PromptAgentPart extends PromptPartBase {
  type: "agent";
  name: string;
}

export interface PromptTeamPart extends PromptPartBase {
  type: "team";
  name: string;
  workflowId: string;
}

export type ContentPart = PromptTextPart | PromptFilePart | PromptAgentPart | PromptTeamPart;
export type Prompt = ContentPart[];

export const DEFAULT_PROMPT: Prompt = [{ type: "text", text: "", start: 0, end: 0 }];

export interface FileSelection {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

export interface ImageAttachmentPart {
  type: "image";
  id: string;
  filename: string;
  mime: string;
  dataUrl: string;
}

export type ContextItem = {
  type: "file";
  path: string;
  selection?: FileSelection;
  comment?: string;
  commentID?: string;
  commentOrigin?: "review" | "file";
  preview?: string;
  key: string;
};

export type FollowupDraft = {
  sessionID: string;
  prompt: Prompt;
  context: ContextItem[];
  model: string;
};

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface QuestionRequest {
  id: string;
  question: string;
  options: { value: string; label: string }[];
  multiSelect?: boolean;
}

export interface PermissionRequest {
  id: string;
  tool: string;
  description: string;
  filePatterns?: string[];
}

// ── Claude Code Types ──

/** 按仓库持久化的「定时 Claude Code」任务（会话特性面板）。 */
export interface RepositoryScheduledClaudeTask {
  id: string;
  /** 列表展示用短标题 */
  title: string;
  /** Cron：`分 时 日 月 周`（5 段），与 `cron-parser` 一致。 */
  cronExpression: string;
  /** Milkdown 编辑区对应的 Markdown 正文，定时触发时经 `buildClaudeOutgoingPrompt` 发往 CLI */
  contentMarkdown: string;
  /** 为 null 或空字符串时在仓库绑定主会话执行；否则按员工名分发到员工子标签。与 `workflowId` 互斥。 */
  employeeId: string | null;
  /** 非空时按团队工作流分发；与 `employeeId` 互斥。 */
  workflowId?: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  /**
   * 已对齐的触发槽位：用于 `next(lastSlot) <= now` 去重；
   * 新建时写入 `prev(now)`，避免创建当下误触上一轮。
   */
  lastScheduledSlotAt?: number;
  lastExecutedAt?: number;
  lastExecuteOk?: boolean;
  lastExecuteMessage?: string;
}

/** 会话输入区「待执行队列」单条（持久化在数据库 app_settings，按 sessionId + 仓库路径分桶） */
/** Composer 发起执行时，对会话内已有用户气泡的改写方式（仅主路径同 tab 会应用）。 */
export interface ClaudeComposerExecuteBubbleOptions {
  replaceFirstUserBubble?: boolean;
  replaceLastUserBubble?: boolean;
  /** 按 `messages` 下标改写对应用户气泡（须为可展示的非纯 tool 用户消息）。 */
  replaceUserBubbleAtIndex?: number;
}

export interface PendingExecutionTask {
  id: string;
  /** 将发给 Claude 的完整提示（与直接发送时 buildClaudeOutgoingPrompt 结果一致） */
  promptText: string;
  /** 展示用：@员工 / 团队名 / 当前模型等 */
  executorLabel: string;
  /** 执行目标：主会话 / 指定员工 / 指定团队 */
  targetType?: "main" | "employee" | "team";
  /** 员工目标（按员工名匹配） */
  targetEmployeeName?: string;
  /** 团队目标（workflow id） */
  targetWorkflowId?: string;
  /** 团队目标名称（仅展示/兜底） */
  targetWorkflowName?: string;
  createdAt: number;
}

export interface ClaudeSession {
  id: string;
  claudeSessionId: string | null;
  /** 本会话绑定的仓库根路径（磁盘绝对路径）。 */
  repositoryPath: string;
  repositoryName: string;
  model: string;
  status: "idle" | "connecting" | "running" | "completed" | "cancelled" | "error";
  messages: ClaudeMessage[];
  createdAt: number;
  pendingPrompt: string; // buffered input after session ID detected
  /** First user-line preview from ~/.claude/projects JSONL before messages are loaded */
  diskPreview?: string;
  /**
   * 为 true 时 `messages` 可能仅为磁盘 jsonl 尾部子集（懒加载）；全量对齐或用户点击「加载完整历史」后为 false。
   * 不落盘，仅运行时。
   */
  diskTranscriptPartial?: boolean;
  /**
   * 会话连接方式：
   * - `"streaming"` 长驻进程 + `--input-format stream-json`（全局默认，见默认配置）
   * - `"oneshot"` 逐轮 `claude -p`
   */
  connectionKind?: "streaming" | "oneshot";
}

/** One session row from `list_claude_disk_sessions` (Claude Code on-disk index). */
export interface ClaudeDiskSessionItem {
  sessionId: string;
  updatedAtMs: number;
  preview: string;
  modelHint: string | null;
}

export interface ClaudeMessage {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  parts: MessagePart[];
  timestamp: number;
}

export type MessagePart = TextPart | ToolUsePart | ReasoningPart;

export interface TextPart {
  type: "text";
  text: string;
}

export interface ToolUsePart {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  status: "pending" | "running" | "completed" | "error";
}

export interface ReasoningPart {
  type: "reasoning";
  text: string;
}

export interface ClaudeSessionInfo {
  session_id: string;
  project_path: string;
  model: string;
  status: string;
  started_at: string;
}

export interface ClaudeHostProcess {
  pid: number;
  memoryBytes: number;
  sessionId: string | null;
  projectPath: string | null;
  /** `resume_arg` | `lsof_jsonl` */
  sessionSource: string | null;
}

export interface SystemResourceSnapshot {
  systemTotalBytes: number;
  systemUsedBytes: number;
  appMemoryBytes: number;
  claudeProcessCount: number;
  claudeMemoryBytes: number;
  claudeProcesses: ClaudeHostProcess[];
}

export type ClaudeConnectionMode = "persistent" | "oneshot" | "streaming";

/** Aligns with Claude Code: user / local / project + legacy settings.json. */
export type ClaudeMcpScope =
  | "user"
  | "local"
  | "project"
  | "legacy_user_settings"
  | "legacy_project_settings"
  /** 来自已安装 Claude Code 插件目录内的 MCP 声明（只读）。 */
  | "plugin";

export interface ClaudeMcpItem {
  id: string;
  name: string;
  command: string;
  status: "connected" | "disconnected" | "error";
  enabled: boolean;
  tools: string[];
  scope: ClaudeMcpScope;
  sourcePath: string;
  claudeJsonProjectKey: string | null;
  /** 例如 `oh-my-claudecode@omc`（仅插件 MCP）。 */
  pluginRef?: string | null;
  /** 由 `getClaudeMcpRuntimeHealth` 异步合并。 */
  runtimeStatus?: "connected" | "failed";
}

export interface ClaudeMcpRuntimeHealthEntry {
  name: string;
  status: "connected" | "failed";
}

export interface ClaudeMcpStatusResponse {
  user: ClaudeMcpItem[];
  local: ClaudeMcpItem[];
  projectShared: ClaudeMcpItem[];
  legacyUserSettings: ClaudeMcpItem[];
  legacyProjectSettings: ClaudeMcpItem[];
  pluginMcp: ClaudeMcpItem[];
}

export interface ClaudeMcpAddPayload {
  scope: "user" | "local" | "project";
  transport: "http" | "sse" | "stdio";
  name: string;
  repositoryPath?: string | null;
  url?: string | null;
  command?: string | null;
  args?: string[] | null;
  headers?: string[] | null;
  envPairs?: string[] | null;
}

export type ClaudeHookSourceScope = "user" | "project" | "local";

export type ClaudeHookHandlerType = "command" | "http" | "prompt" | "agent";

export interface ClaudeHookHandler {
  id: string;
  type: ClaudeHookHandlerType;
  if?: string | null;
  timeout?: number | null;
  statusMessage?: string | null;
  shell?: "bash" | "powershell" | null;
  async?: boolean | null;
  asyncRewake?: boolean | null;
  command?: string | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  allowedEnvVars?: string[] | null;
  prompt?: string | null;
  model?: string | null;
}

export interface ClaudeHookMatcherGroup {
  id: string;
  matcher?: string | null;
  hooks: ClaudeHookHandler[];
}

export interface ClaudeHookScopeData {
  sourcePath: string;
  disableAllHooks: boolean;
  hooks: Record<string, ClaudeHookMatcherGroup[]>;
}

export interface ClaudeHooksStatusResponse {
  user: ClaudeHookScopeData;
  project: ClaudeHookScopeData;
  local: ClaudeHookScopeData;
  omc: ClaudeHookScopeData;
}

export interface ClaudeHookUpsertPayload {
  scope: ClaudeHookSourceScope;
  repositoryPath?: string | null;
  eventName: string;
  matcher?: string | null;
  handler: Omit<ClaudeHookHandler, "id">;
  targetGroupId?: string | null;
  targetHandlerId?: string | null;
}

/** One skill folder under `{project}/.claude/skills/{name}/`，或来自 `~/.claude/plugins/cache` 下插件包。 */
export interface ClaudeProjectSkill {
  name: string;
  hasSkillMd: boolean;
  /** 来自 `SKILL.md` YAML frontmatter 的 `description`（无则回退为正文首段预览）；列表由后端枚举时解析。 */
  description: string | null;
  /** Recursive count of regular files under the skill directory. */
  fileCount?: number;
  /** 非空表示来自 ~/.claude/plugins/cache 下某插件包（相对 cache 的路径），只读展示 */
  pluginCacheRelPath?: string | null;
  /** 插件包根目录绝对路径，用于在编辑器中打开 skills 子目录 */
  pluginCacheRoot?: string | null;
  /** 三级来源标记：builtin（plugins/cache 下的插件 skill）、custom（用户自定义）、extension（wise 扩展贡献）。 */
  source?: "builtin" | "custom" | "extension";
  /** 该 skill 条目是否是符号链接（用于 wise 内的 import-symlink 识别）。 */
  isSymlink?: boolean;
}

/** One node under a skill directory (relative path uses `/`). */
export interface ClaudeProjectSkillFileEntry {
  path: string;
  isDir: boolean;
  sizeBytes: number | null;
}

export type ClaudeSubagentScope = "project" | "user" | "plugin";

export interface ClaudeSubagentItem {
  id: string;
  scope: ClaudeSubagentScope;
  sourcePath: string;
  name: string;
  description: string;
  model: string | null;
  tools: string[];
  disallowedTools: string[];
  permissionMode: string | null;
  memory: string | null;
  isCollaborationMode: boolean;
  isActive: boolean;
  overriddenById: string | null;
  updatedAtMs: number | null;
}

export interface ClaudeSubagentDetail {
  id: string;
  scope: ClaudeSubagentScope;
  sourcePath: string;
  name: string;
  description: string;
  model: string | null;
  tools: string[];
  disallowedTools: string[];
  permissionMode: string | null;
  memory: string | null;
  frontmatter: string;
  prompt: string;
  rawContent: string;
}

/** Persisted to ~/.wise/tabs.json — full tab strip order and session payloads. */
export interface PersistedTabsState {
  version: 1;
  activeSessionId: string | null;
  sessions: ClaudeSession[];
}

// ── PRD to Task Types ──

export type PrdSourceType = "plain_text" | "markdown" | "url";

export interface PrdInputMeta {
  sourceType: PrdSourceType;
  rawText: string;
  rawUrl: string | null;
}

export interface ParsedPrdSections {
  background: string[];
  goals: string[];
  scenarios: string[];
  functional: string[];
  nonFunctional: string[];
  acceptance: string[];
}

export interface PrdDocument extends ParsedPrdSections {
  title: string;
  sourceType: PrdSourceType;
  sourceRef: string | null;
}

export type TaskSize = "S" | "M" | "L";
export type TaskRole = "frontend" | "backend" | "document";
export type ApiMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/** 任务可执行性：无缺口且已确认时为可执行；有缺口或拆分方案级问题为不可执行（可手动覆盖）。 */
export type TaskExecutionStatus = "executable" | "not_executable";
export type TaskFlowStatus = "todo" | "in_progress" | "blocked" | "pending_review" | "done" | "cancelled";

export interface TaskApiSpec {
  endpoint: string;
  method: ApiMethod;
  requestSchema: string;
  responseSchema: string;
  errorCodes: string[];
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  role: TaskRole;
  /** 任务级锚点冗余字段；与 SplitResult.taskAnchorDescriptors 按 taskId 同步。 */
  taskAnchors?: TaskAnchorDescriptor;
  apiSpec?: TaskApiSpec;
  size: TaskSize;
  estimateDays: number;
  dependencies: string[];
  /** 依赖分析依据：key 为 dependency task id，value 说明为什么必须等待该任务。 */
  dependencyRationale?: Record<string, string>;
  sourceRefs: string[];
  sourceRequirementIds: string[];
  subtasks: string[];
  dod: string[];
  /** 可执行性快照；非手动模式下与当前缺口联动，在「确认调整」时刷新。 */
  executionStatus?: TaskExecutionStatus;
  /** 为 true 时以 `executionStatus` 为准，不随缺口列表自动变化。 */
  executionStatusManual?: boolean;
  /** 任务流转状态（主流程）。 */
  flowStatus?: TaskFlowStatus;
  /** 「可执行任务」中选择的默认员工名（随拆分结果落库）。 */
  splitListEmployeeName?: string;
  /** 「可执行任务」中选择的默认团队工作流 id（随拆分结果落库）。 */
  splitListWorkflowId?: string;
  /** 若该任务由「生成可执行任务」创建，则记录其来源拆分任务 id。 */
  splitSourceTaskId?: string;
  /** Trellis 任务分类：lightweight 仅需 prd；complex 需 design + implement。缺省视为 lightweight。 */
  classification?: "lightweight" | "complex";
  /** 当 classification = complex 时，splitter 产出的 design.md 内容。 */
  designMarkdown?: string;
  /** 当 classification = complex 时，splitter 产出的 implement.md 内容。 */
  implementMarkdown?: string;
}

/** Claude / 快照 `split-mapping.json` 中的任务与需求 id 映射（需求 id 须来自 requirements-index）。 */
export interface PrdTaskRequirementLink {
  taskId: string;
  requirementIds: string[];
  rationale?: string;
}

export interface PrdSplitMappingPayload {
  version: 1;
  taskRequirementLinks: PrdTaskRequirementLink[];
  idRemap?: { from: string; to: string }[];
}

/** 已合并进 `SplitResult` 并持久化的映射元数据。 */
export interface PrdStoredClaudeSplitMapping extends PrdSplitMappingPayload {
  capturedAtMs: number;
  runId?: string;
}

/** Claude 返回的任务锚点结构化描述（按任务 id 建索引）。 */
export interface TaskAnchorDescriptor {
  from: number;
  to: number;
  /** 保留模型原始偏移（通常是 Markdown 偏移），用于与重算后的 from/to 对照。 */
  mdFrom?: number;
  mdTo?: number;
  textHash: string;
  contextBefore: string;
  contextAfter: string;
}

/** Milkdown 锚点位置缓存（基于 ProseMirror 文档绝对位置）。 */
export interface TaskAnchorPosition {
  from: number;
  to: number;
}

export interface SplitResult {
  source: PrdDocument;
  context: TaskSplitContext | null;
  /** PRD / Claude 产出的拆分任务（不含「生成可执行任务」行）。 */
  splitTasks: TaskItem[];
  /**
   * 由「生成可执行任务」产生的行；`splitSourceTaskId` 指向 `splitTasks` 中的 id。
   * 与拆分任务分表持久化（SQLite `prd_executable_tasks`），同一拆分任务可对应多条。
   */
  executableTasks: TaskItem[];
  criticalPath: string[];
  parallelGroups: string[][];
  unmetPreconditions: string[];
  /** 最近一次从 Claude 快照合并的需求↔任务映射（供审计与后续同步服务器）。 */
  claudeSplitMapping?: PrdStoredClaudeSplitMapping;
  /** Claude 返回的任务锚点结构化描述：taskId -> {from,to,textHash,contextBefore,contextAfter}。 */
  taskAnchorDescriptors?: Record<string, TaskAnchorDescriptor>;
  /** Milkdown 锚点持久化：taskId -> 选区文本（用于编辑后重新定位）。 */
  taskAnchorTexts?: Record<string, string>;
  /** Milkdown 锚点位置缓存：taskId -> { from, to }（编辑时优先通过 transaction mapping 跟随）。 */
  taskAnchorPositions?: Record<string, TaskAnchorPosition>;
}

export interface TaskSplitContext {
  mode: "project" | "repository" | "manual";
  projectId?: string | null;
  projectName?: string | null;
  repositoryId?: number | null;
  repositoryName?: string | null;
  repositoryPath?: string | null;
  repositoryType?: "frontend" | "backend" | "document" | null;
  splitPolicyId?: "feature_domain_first" | "user_journey_first" | "tech_layer_first" | null;
  splitPolicyFeatures?: Record<string, number | string | boolean> | null;
  splitPolicyRationale?: string[] | null;
}

export type TaskRefinePatch = {
  taskId: string;
  title?: string;
  role?: TaskRole;
  apiSpec?: TaskApiSpec;
  size?: TaskSize;
  estimateDays?: number;
  dependencies?: string[];
  dod?: string[];
  subtasks?: string[];
};

export interface TaskSplitSnapshot {
  version: number;
  label: string;
  createdAt: number;
  result: SplitResult;
}
