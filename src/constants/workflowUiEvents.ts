export const WORKFLOW_UI_EVENT_FOCUS_TASK_TOOL = "wise:focus-task-tool";

export const WORKFLOW_UI_EVENT_APPLY_STARTER_PROMPT = "wise:apply-starter-prompt";
export const WORKFLOW_UI_EVENT_OPEN_TASK_SPLIT_PANEL = "wise:open-task-split-panel";
export const WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED = "wise:split-todo-count-updated";

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

