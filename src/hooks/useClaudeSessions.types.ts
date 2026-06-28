import type { MutableRefObject } from "react";
import type {
  ClaudeComposerExecuteBubbleOptions,
  ClaudeSession,
  SessionConversationTaskItem,
  SessionExecutionEngine,
} from "../types";
import type { ClaudeSessionConnectionKind } from "../constants/claudeConnection";
import type { ClaudeSpawnCliExtras } from "../services/claudeSpawnExtras";
import type { CursorSdkAttachment } from "../services/cursorComposerPrompt";

export type PendingTurnFailoverContext = {
  tabSessionId: string;
  turnNonce: number;
  invokeConc:
    | { concurrencyScopeKey: string; concurrencyLimit: number }
    | null
    | undefined;
  repositoryPath: string;
  prompt: string;
  modelArg: string | undefined;
  resumeClaudeSid: string | null;
  forceNewClaudeConversation?: boolean;
  cursorAttachments?: CursorSdkAttachment[];
  codexContextExecutionEngine?: SessionExecutionEngine;
  engine: SessionExecutionEngine;
  autoFailoverEnabled: boolean;
  triedProfileIds: string[];
};

export interface ClaudeTurnCompletePayload {
  sessionId: string;
  success: boolean;
  assistantPreviewRaw: string;
  /** T5: Tool/Structured 主路径可直接携带机器可读 verdict。 */
  structuredVerdict?: unknown;
}

export interface UseClaudeSessionsOptions {
  /** 一轮 Claude 输出结束（成功或失败）时调用；用于团队流程自动推进 */
  onClaudeTurnComplete?: (payload: ClaudeTurnCompletePayload) => void;
  /**
   * 在即将 `executeClaudeCode` / `resumeClaudeCode` 启动子进程前调用（oneshot 下每轮都会起进程）。
   * 由 App 注入：按项目+仓库并发上限拦截。
   */
  beforeSpawnClaudeRef?: MutableRefObject<
    ((session: ClaudeSession) => { ok: true } | { ok: false; message: string }) | null
  >;
  /** `beforeSpawnClaudeRef` 返回 `ok: false` 时展示 */
  onClaudeSpawnBlocked?: (message: string) => void;
  /**
   * 传给 `execute_claude_code` / `resume_claude_code` 的并发槽位（Rust 侧与侧栏上限一致）。
   * 由 App 注入；无法解析仓库归属时可返回 null（不占用后台槽位）。
   */
  claudeConcurrencyInvokeContextRef?: MutableRefObject<
    ((session: ClaudeSession) => { concurrencyScopeKey: string; concurrencyLimit: number } | null) | null
  >;
  /**
   * 主会话 spawn 前解析 CLI 扩展（助手 tools / systemPrompt 等）；省略则仅使用 Claude Code 默认配置。
   */
  claudeSpawnExtrasContextRef?: MutableRefObject<
    ((session: ClaudeSession) => Promise<ClaudeSpawnCliExtras | null>) | null
  >;
  /** 多屏模式下额外窗格绑定的会话 id 列表，用于磁盘 JSONL 拉取与运行态探测 */
  companionSessionIds?: string[];
  /** @deprecated 使用 companionSessionIds；保留向后兼容 */
  companionSessionId?: string | null;
  /** 流式 init 将临时 tab id 合并为真实 `session_id` 时回调（同步双栏右侧绑定） */
  onSessionTabIdMigrated?: (fromTabId: string, toClaudeSessionId: string) => void;
  /** 解析会话应使用的执行引擎（主会话读仓库配置，成员会话读员工配置）。 */
  resolveExecutionEngineRef?: MutableRefObject<
    ((session: ClaudeSession) => SessionExecutionEngine) | null
  >;
  /** 解析 Cursor/Codex 等工作目录（项目级会话回退到 activeRepository）。 */
  resolveExecutionRepositoryPathRef?: MutableRefObject<
    ((session: ClaudeSession) => string) | null
  >;
  /** 多屏窗格 Claude spawn 是否绕过 Wise 内置 Anthropic 代理。 */
  resolveClaudeProxyBypassRef?: MutableRefObject<
    ((session: ClaudeSession) => boolean) | null
  >;
  /**
   * 为 false 时 hook 仅随会话结构变化重渲染（流式正文走 `sessionsLiveRef` + live store）。
   * App 壳层应设为 false，聊天/监控 transcript 子树用 `useClaudeSessionsLiveSnapshot()`。
   */
  subscribeLive?: boolean;
}

export type SessionExecuteOpts = ClaudeComposerExecuteBubbleOptions & {
  /** 仅 `executeTerminalSession` 使用：强制新 Claude 回合。 */
  terminalFreshTurn?: boolean;
};

export interface UseClaudeSessionsReturn {
  sessions: ClaudeSession[];
  sessionsLiveRef: MutableRefObject<ClaudeSession[]>;
  activeSessionId: string | null;
  createSession: (
    repositoryPath: string,
    repositoryName: string,
    opts?: {
      skipActivate?: boolean;
      connectionKind?: ClaudeSessionConnectionKind;
      /** 用户显式「新建会话」：立即切标签，避免 startTransition 延迟导致误以为点击无效 */
      immediateActivate?: boolean;
      /** 初始模型；提供后跳过异步读取全局档案/仓库默认模型，用于多屏保留窗格模型。 */
      initialModel?: string;
      /** 标记为右栏侧会话：不进中栏 tab 列表、不抢 active、不写入主会话绑定表。 */
      isSide?: boolean;
    },
  ) => Promise<string>;
  updateSessionModel: (sessionId: string, model: string) => void;
  /** 切换本标签连接方式；运行中拒绝；会结束长驻子进程以便下一条按新模式拉起。 */
  updateSessionConnectionKind: (
    sessionId: string,
    kind: ClaudeSessionConnectionKind,
  ) => Promise<void>;
  /** 返回 false 表示未启动（例如并发门闸拦截）；其余路径为 true（含已安排重试的暂不可见会话）。 */
  executeSession: (sessionId: string, prompt: string, opts?: ClaudeComposerExecuteBubbleOptions) => boolean;
  executeTerminalSession: (
    sessionId: string,
    outboundPrompt: string,
    opts?: {
      userBubblePrompt?: string;
    },
  ) => boolean;
  /** 监控 Drawer 底部：恢复 worker 标签并 resume 执行（含磁盘 / tabs 回退） */
  resumeSessionFromMonitorDrawer: (input: {
    sessionId: string;
    prompt: string;
    repositoryPath?: string;
    repositoryDisplayName?: string;
    taskLabel?: string;
  }) => Promise<boolean>;
  /** 监控 Drawer 打开前：从 tabs / 磁盘回退解析 worker 并 materialize 到内存 */
  ensureSessionForMonitorDrawer: (input: {
    sessionId: string;
    repositoryPath?: string;
    repositoryDisplayName?: string;
    taskLabel?: string;
  }) => Promise<ClaudeSession | null>;
  appendSystemMessage: (sessionId: string, text: string) => void;
  /** 仅写入用户气泡（不调用 Claude），供批量 OMC 等在标签内展示派发正文 */
  appendUserMessage: (sessionId: string, text: string) => void;
  sendMessage: (prompt: string) => void;
  sendMessageToSession: (sessionId: string, prompt: string, opts?: ClaudeComposerExecuteBubbleOptions) => void;
  closeSession: (sessionId: string) => void;
  /**
   * 物理删除磁盘 jsonl（`~/.claude/projects/<encoded>/<sid>.jsonl`）并清理内存标签。
   *
   * 行为：
   * - 运行中 / 连接中（status === "running" | "connecting"）会拒绝并抛错；
   * - 仅存在于内存的草稿（无 `claudeSessionId`）不会调用后端，但仍会触发 `closeSession`；
   * - 后端 IPC 失败时抛错，标签不会被清掉，便于上层 toast 后用户重试。
   *
   * 调用方必须先做二次确认（jsonl 删除不可恢复）。
   */
  deleteSession: (sessionId: string) => Promise<void>;
  switchSession: (sessionId: string) => void;
  cancelSession: (sessionId: string, opts?: { retractLastUserTurn?: boolean }) => void;
  /** 结束当前对话子代理 / 任务：标记 tool_use、取消 Claude 执行并刷新会话状态 */
  stopSessionConversationTask: (item: SessionConversationTaskItem) => boolean;
  respondToQuestion: (sessionId: string, answers: string[], customAnswer?: string) => void;
  /** 关闭选择题 Dock：已过期/失败则仅收起；仍可操作时等同于跳过（空选提交） */
  dismissQuestion: (sessionId: string) => void;
  respondToPermission: (sessionId: string, response: "allow_once" | "allow_always" | "deny") => void;
  clearTodos: (sessionId: string) => void;
  restoreTodosFromTranscript: (sessionId: string) => void;
  restorePendingPermissionFromTranscript: (sessionId: string) => void;
  toggleTodo: (sessionId: string, todoId: string) => void;
  clearFollowups: (sessionId: string) => void;
  clearRevertItems: (sessionId: string) => void;
  sendFollowup: (sessionId: string, id: string) => void;
  restoreRevert: (sessionId: string, itemId: string) => Promise<void>;
  refreshDiskSessionsForRepository: (repositoryPath: string, repositoryName: string) => Promise<void>;
  /** False until ~/.wise/tabs.json has been read (or missing); gate disk refresh until then. */
  tabsHydrated: boolean;
  /** 从磁盘读取完整 jsonl 覆盖该标签的 messages（`sessionKey` 可为标签 id 或 `claudeSessionId`） */
  reloadFullDiskTranscript: (sessionKey: string) => Promise<void>;
  /** 渐进加载更早 jsonl 尾部（未达上限前不读全文件） */
  loadMoreTranscriptFromDisk: (sessionKey: string) => Promise<void>;
  /** 手动触发 Claude Code `/compact` 压缩会话历史；`prompt` 默认为 `/compact`，可传 `/compact 聚焦说明`。 */
  compactSessionHistory: (sessionId: string, prompt?: string) => Promise<void>;
  /**
   * 结束指定标签对应的本机长驻/逐轮子进程（不关标签、不删绑定）。
   * 用于仓库/项目主会话换绑前释放旧进程，保证同一绑定仅一个长驻子进程。
   */
  releaseSessionHostProcess: (
    sessionId: string,
    opts?: { claudeProcesses?: import("../types").ClaudeHostProcess[] },
  ) => Promise<void>;
}
