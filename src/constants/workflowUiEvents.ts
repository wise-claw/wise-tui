export const WORKFLOW_UI_EVENT_FOCUS_TASK_TOOL = "wise:focus-task-tool";

/** 仓库定时任务列表变更或叠层关闭后，请求侧栏刷新角标汇总 */
export const WISE_UI_EVENT_SCHEDULED_TASKS_CHANGED = "wise:scheduled-tasks-changed";

export const WORKFLOW_UI_EVENT_APPLY_STARTER_PROMPT = "wise:apply-starter-prompt";

export interface ApplyStarterPromptDetail {
  sessionId: string;
  /** 完整纯文本（兼容旧调用方；与 `composerMain` 相同时可只传此项） */
  prompt: string;
  /** 填入编辑器的正文；有附图时应为去掉 `附图：@` 尾缀后的文本 */
  composerMain?: string;
  /** `~/.wise/composer-images/` 下已落盘绝对路径，与消息气泡 `附图：@` 一致 */
  attachmentPaths?: string[];
}

/** 将文本（及可选附图路径）写入指定会话 composer 并聚焦输入框（由 `ComposerRegion` 监听）。 */
export function applyStarterPromptToComposer(detail: ApplyStarterPromptDetail): void {
  const sessionId = detail.sessionId.trim();
  const prompt = detail.prompt ?? "";
  const composerMain = detail.composerMain?.trim() ?? prompt.trim();
  const attachmentPaths = detail.attachmentPaths ?? [];
  if (!sessionId || (!composerMain && attachmentPaths.length === 0 && !prompt.trim())) return;
  window.dispatchEvent(
    new CustomEvent<ApplyStarterPromptDetail>(WORKFLOW_UI_EVENT_APPLY_STARTER_PROMPT, {
      detail: {
        sessionId,
        prompt,
        composerMain: composerMain || prompt.trim(),
        attachmentPaths,
      },
    }),
  );
}

/** CC Workflow Studio AI 编辑一键启动：在 Wise 当前仓库的 Claude 会话中执行 slash skill */
export const WORKFLOW_UI_EVENT_CC_WF_STUDIO_LAUNCH_AI_EDITING = "wise:cc-wf-studio-launch-ai-editing";

export interface CcWfStudioLaunchAiEditingDetail {
  repositoryPath: string;
  provider: string;
}

/** CC Workflow Studio MCP 后台会话结束（显式 Stop 或切换仓库） */
export const WORKFLOW_UI_EVENT_CC_WF_STUDIO_MCP_SESSION_ENDED = "wise:cc-wf-studio-mcp-session-ended";

/** MCP apply_workflow 需要用户确认时，请求宿主展开 Workflow Studio 叠层（后台宿主不可见会导致确认框被立即拒绝） */
export const WORKFLOW_UI_EVENT_CC_WF_STUDIO_SHOW_OVERLAY = "wise:cc-wf-studio-show-overlay";

export interface CcWfStudioShowOverlayDetail {
  repositoryPath: string;
}

/** CC Workflow Studio「运行」：已在仓库写入 Slash Command，请求向当前仓库的 Claude Code 会话发送 `/<workflow>` */
export const WORKFLOW_UI_EVENT_CC_WF_STUDIO_RUN_IN_CLAUDE_SESSION = "wise:cc-wf-studio-run-in-claude-session";

export interface CcWfStudioRunInClaudeSessionDetail {
  repositoryPath: string;
  /** 例如 `/my-workflow`，与 `.claude/commands/` 下文件名一致 */
  slashCommand: string;
}

/** 会话内运行 CC Workflow Studio 工作流时，请求宿主展开叠层并切到可展示执行动画的画布视图 */
export const WORKFLOW_UI_EVENT_CC_WF_STUDIO_ENTER_EXECUTION_WATCH =
  "wise:cc-wf-studio-enter-execution-watch";

export interface CcWfStudioEnterExecutionWatchDetail {
  repositoryPath: string;
}
export const WORKFLOW_UI_EVENT_OPEN_TASK_SPLIT_PANEL = "wise:open-task-split-panel";
/**
 * D13 / E4：助手宿主统一入口。
 * 替代旧的 `wise:open-prd-split-wizard` / `wise:open-mission-control`。
 * detail 可携带 `assistantId`（缺省时由 cockpit 决定默认助手），以及
 * 可选的 `projectId` / `repositoryId` 作为运行上下文。
 */
export const WORKFLOW_UI_EVENT_OPEN_ASSISTANT = "wise:open-assistant";
export const WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED = "wise:split-todo-count-updated";
export const WORKFLOW_UI_EVENT_OPEN_WORKFLOW_CONFIG = "wise:open-workflow-config";
export const WORKFLOW_UI_EVENT_WORKFLOW_GRAPH_CHANGED = "wise:workflow-graph-changed";
export const WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE = "wise:open-repository-file";
export const WORKFLOW_UI_EVENT_RUN_ASSISTANT_BRIEF = "wise:run-assistant-brief";

/** 需求助手入口粒度：工作区可跨仓下发，仓库仅本仓。 */
export type RequirementAssistantScope = "workspace" | "repository";

export interface OpenAssistantDetail {
  assistantId?: string | null;
  projectId?: string | null;
  repositoryId?: number | null;
  requirementScope?: RequirementAssistantScope | null;
}

export interface SplitTodoCountUpdatedDetail {
  source?: "wise" | "trellis";
  openTaskDrawer?: boolean;
  projectId?: string | null;
  parentTaskName?: string | null;
  childTaskNames?: string[];
  focusParentTaskName?: string | null;
  focusChildTaskNames?: string[];
}

export interface OpenWorkflowConfigDetail {
  workflowId?: string;
  projectId?: string;
}

export interface WorkflowGraphChangedDetail {
  workflowId: string;
  status?: string;
  projectId?: string;
}

export interface OpenRepositoryFileDetail {
  repositoryId?: number | null;
  repositoryPath?: string | null;
  relativePath: string;
  line?: number | null;
}

export interface RunAssistantBriefDetail {
  assistantId: string;
  assistantName: string;
  prompt: string;
  projectId?: string | null;
}

export const WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED = "wise:omc-batch-runtime-changed";

/** OMC 批量等在宿主侧新增/变更 worktree 后广播，供会话快捷面板等按仓库刷新 worktree 列表。 */
export const WORKFLOW_UI_EVENT_REPO_WORKTREES_MAY_HAVE_CHANGED = "wise:repo-worktrees-may-have-changed";

export interface RepoWorktreesMayHaveChangedDetail {
  repositoryPath: string;
}

export interface WorkflowOmcBatchRuntimeDetail {
  active: boolean;
  sessionId?: string;
  runningCount?: number;
  updatedAt: number;
  /** 侧栏 OMC 员工「结束」触发：用于主会话将本批摘要按失败/终止计，而非自然跑完 */
  abortedByUser?: boolean;
  /**
   * 直连批量进度心跳：为 false 时仅更新计数，不清空 `omcDirectBatchInvocationRef`（避免每任务触发一次全量 reset）。
   * 省略或 true 时保持原行为（批开始时清空）。
   */
  resetInvocationUi?: boolean;
  /** 直连批量：任务总数 */
  directBatchTaskTotal?: number;
  /** 直连批量：已结束任务数（成功+失败累计） */
  directBatchTaskFinished?: number;
  /** 直连批量：当前配置的 Claude Code oneshot 并发路数（与 Rust 侧子进程槽一致） */
  directBatchClaudeCodeSessions?: number;
}

/** 通知入库成功后，请求当前主窗口内「对应该会话」展开底部消息通知面板（见 `wiseNotificationIngest` 可选参数） */
export const SESSION_NOTIFICATION_UI_EVENT_OPEN_PANEL = "wise:open-session-notification-panel";

/** 后台 oneshot + invocation 执行：用于右下角摘要条（不经过主消息列表） */
export const WORKFLOW_UI_EVENT_INVOCATION_STREAM = "wise:invocation-stream";

export interface WorkflowInvocationStreamDetail {
  phase: "started" | "progress" | "complete";
  invocationKey: string;
  sessionId: string;
  repositoryPath: string;
  /** 编排 OMC 与「可执行任务」直连批量 OMC 分流侧栏展示 */
  omcInvocationSource?: "workflow" | "direct_batch";
  taskId?: string;
  /** 可执行任务标题等，供侧栏直连批量列表展示（避免仅显示 task- 前缀 id） */
  taskTitle?: string;
  templateId?: string;
  /** 团队编排 / 后台任务第几轮执行（重试时递增） */
  attempt?: number;
  ownerKind?: "repository";
  ownerRepositoryId?: number;
  ownerRepositoryName?: string;
  ownerRepositoryPath?: string;
  repositoryType?: "frontend" | "backend" | "document";
  stage?: string;
  subagentType?: string;
  lineCount?: number;
  errCount?: number;
  /** 最近一行 stdout 截断预览 */
  previewLine?: string;
  success?: boolean;
  /** 子进程 stdin 侧完整提示词（`executeClaudeCode` 的 prompt）；在 started/complete 上携带，供后台执行详情展示 */
  dispatchPrompt?: string;
  /**
   * 直连批量子进程 stream-json 中的 Claude Code `session_id`（与上方锚点 `sessionId` 即 Wise 标签 id 不同）。
   * 在首行 `system/init`（或带 `session_id` 的流式行）解析到后由 `executeClaudeCodeAndWait` 派发，避免详情抽屉晚于子进程启动订阅事件时拿不到 id。
   */
  subprocessSessionId?: string;
}

/** 请求与 `BackgroundInvocationDock` 绑定的锚点会话打开「后台执行详情」抽屉（与点击「点击查看完整输出」一致） */
export const WORKFLOW_UI_EVENT_OPEN_BACKGROUND_INVOCATION_DRAWER = "wise:open-background-invocation-drawer";

/** `mergeInvocationSnapshotIntoBundle` 写入新快照后广播，便于当前停留的锚点会话标签热更新列表（如直连批量 OMC 不落流式事件） */
export const WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED = "wise:background-invocation-bundle-changed";

export interface BackgroundInvocationBundleChangedDetail {
  sessionId: string;
  repositoryPath: string;
}

export interface OpenBackgroundInvocationDrawerDetail {
  sessionId: string;
  repositoryPath: string;
  /** 打开后默认选中的后台 invocation */
  preferredInvocationKey?: string;
}
