import {
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
} from "react";
import { flushSync } from "react-dom";
import { AIChatInput, ConfigProvider as SemiConfigProvider } from "@douyinfe/semi-ui";
import semiLocaleZhCN from "@douyinfe/semi-ui/lib/es/locale/source/zh_CN";
import "./composer-semi-tokens.css";
import type { Content } from "@douyinfe/semi-ui/lib/es/aiChatInput/interface";
import type {
  ClaudeComposerExecuteBubbleOptions,
  ClaudeSession,
  ContextItem,
  EmployeeItem,
  ImageAttachmentPart,
  TodoItem,
  QuestionRequest,
  PermissionRequest,
  PendingExecutionTask,
  Prompt,
  Repository,
} from "../../types";
import { PromptProvider, clearPromptContextSessionKey, usePrompt } from "./prompt-context";
import type { TriggerInfo } from "./slash-trigger";
import type { ComposerPlainSurface } from "./slash-popover";
import {
  contentsToPlain,
  ensureSpaceAfterAtInsert,
  promptToDisplayPlain,
  reportAtSlashTriggerFromPlain,
  singleTextPrompt,
  insertPlainAt,
} from "./composer-plain-utils";
import { ContextItems } from "./context-items";
import { SlashPopover } from "./slash-popover";
import { ImageThumbnails } from "./attachment-manager";
import { QuestionDock } from "./dock/question-dock";
import { PermissionDock } from "./dock/permission-dock";
import { FollowupDock } from "./dock/followup-dock";
import { TodoDock } from "./dock/todo-dock";
import { RevertDock } from "./dock/revert-dock";
import { addToHistory, promptLength, navigatePromptHistory, canNavigateHistoryAtCursor } from "./prompt-history";
import { Dropdown, Button, Empty, Input, Popover, Select, Spin, Tabs, Tag, Tooltip, message } from "antd";
import type { MenuProps } from "antd";
import { logClaudeDrop } from "./drop-debug";
import { buildClaudeOutgoingPrompt } from "../../services/claudeComposerPrompt";
import { getClaudeModelPickerOptions } from "../../services/claude";
import { promptToLogicalPlainString } from "../../utils/serializeClaudePrompt";
import { getWiseRepositoryFileDragPaths, isWiseRepositoryFileDrag } from "../../utils/repositoryFileDrag";
import { formatClaudeModelLabel } from "../../utils/claudeModel";
import { inferPendingQueueTargetFromPrompt } from "../../utils/pendingQueueExecutor";
import { isOmcMonitorDispatchMentionName } from "../../utils/omcMonitorEmployeeSession";
import { captureScreenshot, screenshotResultToImagePart } from "../../services/screenshot";
import {
  noteComposerScreenshotFocus,
  registerGlobalFocusComposerRecipient,
  registerGlobalScreenshotRecipient,
} from "../../services/globalScreenshotHotkey";
import { wiseMainWindowFocus } from "../../services/wiseMascot";
import { gitCheckoutBranch, gitCheckoutDetached, gitCreateBranch, gitListBranches, gitStatus } from "../../services/git";
import { recordMissionComposerMessage } from "./missionMentionHook";
import type { ControlRequestStatus } from "../../notifications";
import type { QuestionDockTabSpec } from "../../hooks/useQuestionDockTabs";
import { WORKFLOW_UI_EVENT_APPLY_STARTER_PROMPT } from "../../constants/workflowUiEvents";
import type { GitBranchEntry } from "../../types";

/** 双栏右侧主会话：输入框底栏在截屏按钮旁选择目标仓库 */
export interface DualPaneComposerRepositoryPickerProps {
  repositories: Repository[];
  valueRepositoryId: number;
  onSelectRepositoryId: (repositoryId: number) => void;
}

// ── Inner component (has access to prompt context) ──

interface ComposerInnerProps {
  session: ClaudeSession;
  gitRepositoryPath?: string;
  /** 第三参：刚入队的任务（优先）或任务 id；第四参：兜底分发目标（避免 ref 未刷新时回退主会话） */
  onExecute: (
    sessionId: string,
    prompt: string,
    consumePending?: string | PendingExecutionTask,
    dispatchTarget?: {
      targetType: "main" | "employee" | "team";
      targetEmployeeName?: string;
      targetWorkflowId?: string;
      targetWorkflowName?: string;
    },
    executeOptions?: ClaudeComposerExecuteBubbleOptions,
  ) => void;
  onSessionModelChange: (model: string) => void;
  /** `retractLastUserTurn`：Esc 撤回刚发时从 transcript 去掉本轮 user/assistant 并杀进程 */
  onCancel: (opts?: { retractLastUserTurn?: boolean }) => void;
  todos: TodoItem[];
  questionRequest: QuestionRequest | null;
  /** 同一会话内排在当前题之后的 AskUserQuestion 数量 */
  questionRequestQueueLength?: number;
  questionRequestStatus?: ControlRequestStatus | null;
  questionRequestError?: string | null;
  /** 同仓库多标签待确认题聚合（≥1 时在「待你确认」行以 Tabs 展示） */
  questionDockTabs?: QuestionDockTabSpec[];
  permissionRequest: PermissionRequest | null;
  permissionRequestStatus?: ControlRequestStatus | null;
  permissionRequestError?: string | null;
  followupItems: { id: string; text: string }[];
  revertItems: { id: string; text: string }[];
  respondQuestionAt: (ownerSessionId: string, answers: string[], customAnswer?: string) => void;
  dismissQuestionAt: (ownerSessionId: string) => void;
  onRespondToPermission: (response: "allow_once" | "allow_always" | "deny") => void;
  onClearTodos?: () => void;
  onSendFollowup: (id: string) => void;
  onClearFollowups?: () => void;
  onRestoreRevert: (id: string) => void;
  onClearRevertItems?: () => void;
  /** 发送前写入待执行队列；队列为空且会话空闲时返回新任务行供 onExecute 同 tick 出队，队列非空时仅入队尾由上层按序派发 */
  onEnqueueAsPendingTask?: (payload: {
    promptText: string;
    executorLabel: string;
    targetType: "main" | "employee" | "team";
    targetEmployeeName?: string;
    targetWorkflowId?: string;
    targetWorkflowName?: string;
  }) => PendingExecutionTask;
  employeeMentions?: Array<{ id: string; name: string }>;
  teamMentions?: Array<{ id: string; name: string }>;
  projectRoleTagOptions?: ReadonlyArray<import("../../utils/projectRoleTagOptions").RoleTagOption>;
  hideEmployeesInAtMode?: boolean;
  onTrackSendFlow?: (entry: {
    sessionId: string;
    composerText: string;
    outboundText: string;
    nodes: Array<{ label: string; timestamp: number; detail?: string }>;
  }) => void;
  /** 用于跳过 OMC 绑定员工药丸（含 agentType omc 的自定义名），避免与真人 @ 派发串扰 */
  employeesForDispatchRoute?: readonly EmployeeItem[];
  /** 本次发送前待执行队列已有条数；>0 时空闲发送只入队尾，由 ClaudeChat 按序自动派发 */
  pendingExecutionTaskCount?: number;
  /** 双栏右侧：截屏按钮右侧展示仓库选择 */
  dualPaneRepositoryPicker?: DualPaneComposerRepositoryPickerProps;
  missionContext?: {
    projectId?: string | null;
    rootPath?: string | null;
  };
}

interface LastSentComposerDraft {
  prompt: Prompt;
  images: ImageAttachmentPart[];
  contextItems: ContextItem[];
}

function isNativeFileDrag(e: React.DragEvent): boolean {
  if ([...e.dataTransfer.types].includes("Files")) return true;
  return Boolean(e.dataTransfer.items && [...e.dataTransfer.items].some((it) => it.kind === "file"));
}

function isComposerFileLikeDrag(e: React.DragEvent): boolean {
  return isNativeFileDrag(e) || isWiseRepositoryFileDrag(e);
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "heic", "heif"].includes(ext);
}

/**
 * Semi AIChatInput 底层 Tiptap 的 setContent 会丢掉段落末尾的普通空格，导致 @ 补全后视觉上没有分隔。
 * 若目标纯文本应以空格结尾而编辑器当前文本末尾无空白，则在文档末尾再插入一个空格。
 */
function repairTiptapTrailingSpaceIfNeeded(
  aiChat: InstanceType<typeof AIChatInput> | null,
  plainThatShouldEndWithSpace: string,
): void {
  if (!aiChat || plainThatShouldEndWithSpace.length === 0 || !plainThatShouldEndWithSpace.endsWith(" ")) return;
  const ed = aiChat.getEditor?.() as
    | {
        getText?: (opts?: { blockSeparator?: string }) => string;
        chain?: () => {
          focus?: (pos?: string) => { insertContent?: (v: string) => { run?: () => void } };
        };
      }
    | undefined;
  if (!ed?.getText || !ed.chain) return;
  let docText = "";
  try {
    docText = ed.getText({ blockSeparator: "\n" }) ?? "";
  } catch {
    return;
  }
  if (docText.length > 0 && !/\s$/u.test(docText)) {
    ed.chain()?.focus?.("end")?.insertContent?.(" ")?.run?.();
  }
}

const SAFE_AI_CHAT_SET_CONTENT_MAX_FRAMES = 48;

/**
 * Semi `AIChatInput` 的 ref `setContent` 在 Tiptap 未挂载时会抛错：`adapter.setContent` 直接访问 `this.editor.commands`，
 * 未对 `this.editor` 做空判断（与 `focusEditor` 不同）。在 editor 就绪前用 rAF 重试，避免首帧 / 嵌入条切换时崩溃。
 */
function scheduleSafeAiChatSetContent(
  resolveAiChat: () => InstanceType<typeof AIChatInput> | null,
  content: string,
  onAfterSet?: () => void,
): void {
  const attempt = (): boolean => {
    const ai = resolveAiChat();
    const ed = ai?.getEditor?.();
    if (!ai || !ed) return false;
    try {
      ai.setContent(content);
    } catch {
      return false;
    }
    onAfterSet?.();
    return true;
  };
  if (attempt()) return;
  let frames = 0;
  const tick = (): void => {
    if (attempt()) return;
    frames += 1;
    if (frames >= SAFE_AI_CHAT_SET_CONTENT_MAX_FRAMES) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Esc 目标：事件 target 或当前焦点在根内即视为「在输入区」——避免焦点落在 Semi 内部节点时 contains 漏判。 */
function isEscapeTargetInsideComposerRoot(root: HTMLElement | null, eventTarget: EventTarget | null): boolean {
  if (!root) return false;
  if (eventTarget instanceof Node && root.contains(eventTarget)) return true;
  const ae = document.activeElement;
  if (ae instanceof Node && root.contains(ae)) return true;
  return false;
}

/** Semi AIChatInput 底层 Tiptap 含 UndoRedo；成功时与 Ctrl+Z 共用同一撤销栈。 */
function tryComposerTiptapUndo(aiChat: InstanceType<typeof AIChatInput> | null): boolean {
  const ed = aiChat?.getEditor?.() as
    | {
        can?: () => { undo: () => boolean };
        chain?: () => { focus: () => { undo: () => { run: () => void } } };
      }
    | undefined
    | null;
  if (!ed?.can || !ed.chain) return false;
  try {
    if (ed.can().undo() !== true) return false;
    ed.chain().focus().undo().run();
    return true;
  } catch {
    /* Tiptap 未就绪或扩展未加载 */
  }
  return false;
}

function mapSessionStatus(status: ClaudeSession["status"]): string {
  if (status === "running") return "运行中";
  if (status === "connecting") return "连接中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  if (status === "error") return "异常";
  return "空闲";
}

function formatSessionDuration(createdAt: number): string {
  const diff = Math.max(0, Date.now() - createdAt);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function estimateSessionTokens(session: ClaudeSession): number {
  let textChars = 0;
  for (const message of session.messages) {
    textChars += message.content.length;
    for (const part of message.parts) {
      if (part.type === "text" || part.type === "reasoning") {
        textChars += part.text.length;
      } else if (part.type === "tool_use") {
        textChars += part.name.length;
        textChars += JSON.stringify(part.input ?? {}).length;
        textChars += (part.output ?? "").length;
        textChars += (part.error ?? "").length;
      }
    }
  }
  return Math.max(0, Math.round(textChars / 4));
}

function estimateContextPercent(estimatedTokens: number): number {
  const MAX_CONTEXT_TOKENS = 200_000;
  return Math.min(100, Math.round((estimatedTokens / MAX_CONTEXT_TOKENS) * 100));
}

function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return "";
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - timestamp);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN");
}

function ComposerInner({
  session,
  gitRepositoryPath,
  onExecute,
  onSessionModelChange,
  onCancel: _onCancel,
  todos,
  questionRequest,
  questionRequestQueueLength = 0,
  questionRequestStatus,
  questionRequestError,
  questionDockTabs = [],
  permissionRequest,
  permissionRequestStatus,
  permissionRequestError,
  followupItems,
  revertItems,
  respondQuestionAt,
  dismissQuestionAt,
  onRespondToPermission,
  onClearTodos: _onClearTodos,
  onSendFollowup,
  onClearFollowups,
  onRestoreRevert,
  onClearRevertItems,
  onEnqueueAsPendingTask,
  employeeMentions = [],
  teamMentions = [],
  projectRoleTagOptions = [],
  hideEmployeesInAtMode = false,
  onTrackSendFlow,
  employeesForDispatchRoute,
  pendingExecutionTaskCount = 0,
  dualPaneRepositoryPicker,
  missionContext,
}: ComposerInnerProps) {
  /** 含题卡/待办/底栏等整块输入 chrome，用于 Esc 命中判定（仅 shellRef 会漏掉模型选择、停止等） */
  const composerEscapeRootRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const aiChatRef = useRef<InstanceType<typeof AIChatInput> | null>(null);
  const plainSurfaceRef = useRef<ComposerPlainSurface | null>(null);
  const lastEditorPlainRef = useRef("");
  const ignoreNextContentSyncRef = useRef(false);
  const cursorRef = useRef(0);
  const dragOverLoggedRef = useRef(false);
  const [trigger, setTrigger] = useState<TriggerInfo>({ mode: null, query: "", rect: null });
  const [images, setImages] = useState<ImageAttachmentPart[]>([]);
  const [dragOverNativeFiles, setDragOverNativeFiles] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [claudePicker, setClaudePicker] = useState<{
    defaultModel: string | null;
    availableModels: string[];
  } | null>(null);
  const [model, setModel] = useState(() => session.model?.trim() || "sonnet");
  const [activeBranch, setActiveBranch] = useState<string>("-");
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false);
  const [branchActionTab, setBranchActionTab] = useState<"create" | "detached">("create");
  const [branchQuery, setBranchQuery] = useState("");
  const [branchCreateName, setBranchCreateName] = useState("");
  const [branchCreateFromRef, setBranchCreateFromRef] = useState<string | undefined>(undefined);
  const [detachedTargetRef, setDetachedTargetRef] = useState("");
  const [branchListLoading, setBranchListLoading] = useState(false);
  const [branchActionLoading, setBranchActionLoading] = useState(false);
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const lastSentDraftRef = useRef<LastSentComposerDraft | null>(null);
  /** 发送成功后、输入区为空时按 Esc 可恢复的草稿（与占位符「Esc 撤销」一致；开始新输入后自动失效） */
  const postSendEscUndoRef = useRef<LastSentComposerDraft | null>(null);

  const dockTabs = questionDockTabs ?? [];
  const useAggregatedQuestionDock = dockTabs.length >= 1;
  const [activeQuestionTabKey, setActiveQuestionTabKey] = useState("");
  const dockTabsSig = dockTabs.map((t) => t.tabKey).join("|");
  useEffect(() => {
    if (dockTabs.length === 0) {
      setActiveQuestionTabKey("");
      return;
    }
    setActiveQuestionTabKey((k) => (k && dockTabs.some((t) => t.tabKey === k) ? k : dockTabs[0]!.tabKey));
  }, [dockTabsSig, dockTabs.length]);

  const activeQuestionDockTab = useMemo(
    () => dockTabs.find((t) => t.tabKey === activeQuestionTabKey) ?? dockTabs[0] ?? null,
    [dockTabs, activeQuestionTabKey],
  );

  const { prompt, cursor, contextItems, set, reset, contextAdd, draftBucketKey } = usePrompt();

  const displayPlain = useMemo(() => promptToDisplayPlain(prompt), [prompt]);

  plainSurfaceRef.current = {
    anchorEl: () => shellRef.current,
    getPlain: () => promptToDisplayPlain(prompt),
    getCursor: () => {
      const ed = aiChatRef.current?.getEditor?.();
      if (ed) {
        try {
          const from = ed.state.selection.from;
          return ed.state.doc.textBetween(0, from, "\n").length;
        } catch {
          return cursorRef.current;
        }
      }
      return cursorRef.current;
    },
    setPlainAndCursor: (plain: string, c: number) => {
      ignoreNextContentSyncRef.current = true;
      lastEditorPlainRef.current = plain;
      cursorRef.current = c;
      set(singleTextPrompt(plain), c);
      scheduleSafeAiChatSetContent(() => aiChatRef.current, plain, () => {
        repairTiptapTrailingSpaceIfNeeded(aiChatRef.current, plain);
        aiChatRef.current?.focusEditor?.("end");
      });
    },
    focus: () => {
      aiChatRef.current?.focusEditor?.("end");
    },
  };

  useEffect(() => {
    lastEditorPlainRef.current = "";
  }, [session.id, draftBucketKey]);

  useLayoutEffect(() => {
    if (lastEditorPlainRef.current === displayPlain) return;
    lastEditorPlainRef.current = displayPlain;
    ignoreNextContentSyncRef.current = true;
    scheduleSafeAiChatSetContent(() => aiChatRef.current, displayPlain, () => {
      repairTiptapTrailingSpaceIfNeeded(aiChatRef.current, displayPlain);
    });
  }, [displayPlain]);

  useEffect(() => {
    function handleApplyStarterPrompt(event: Event) {
      const custom = event as CustomEvent<{ sessionId?: string; prompt?: string }>;
      const targetSessionId = custom.detail?.sessionId?.trim();
      const starterPrompt = custom.detail?.prompt?.trim();
      if (!targetSessionId || targetSessionId !== session.id || !starterPrompt) return;
      set([{ type: "text", text: starterPrompt, start: 0, end: starterPrompt.length }], starterPrompt.length);
      queueMicrotask(() => aiChatRef.current?.focusEditor?.("end"));
    }
    window.addEventListener(WORKFLOW_UI_EVENT_APPLY_STARTER_PROMPT, handleApplyStarterPrompt as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_APPLY_STARTER_PROMPT, handleApplyStarterPrompt as EventListener);
    };
  }, [session.id, set]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const opts = await getClaudeModelPickerOptions(session.repositoryPath);
      if (cancelled) return;
      setClaudePicker(opts);
    })();
    return () => {
      cancelled = true;
    };
  }, [session.repositoryPath]);

  const claudeSettingsModel = claudePicker?.defaultModel?.trim() || null;
  const pickerAllowlist = claudePicker?.availableModels;

  useEffect(() => {
    const fromSession = session.model?.trim();
    const fromCfg = claudeSettingsModel;
    setModel(fromSession || fromCfg || "sonnet");
  }, [session.id, session.model, claudeSettingsModel]);

  const modelOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    const push = (value: string) => {
      const v = value.trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      opts.push({ value: v, label: formatClaudeModelLabel(v) });
    };
    if (pickerAllowlist && pickerAllowlist.length > 0) {
      for (const id of pickerAllowlist) push(id);
    } else {
      if (claudeSettingsModel) push(claudeSettingsModel);
      if (session.model?.trim()) push(session.model.trim());
      if (model.trim()) push(model.trim());
      for (const p of ["opus", "sonnet", "haiku"]) push(p);
    }
    if (claudeSettingsModel) push(claudeSettingsModel);
    if (session.model?.trim()) push(session.model.trim());
    if (model.trim()) push(model.trim());
    if (opts.length === 0) push("sonnet");
    return opts;
  }, [pickerAllowlist, claudeSettingsModel, session.model, model]);

  const modelDisplayLabel = useMemo(
    () => modelOptions.find((o) => o.value === model)?.label ?? model,
    [modelOptions, model],
  );

  const modelMenuItems: MenuProps["items"] = useMemo(
    () =>
      modelOptions.map((o) => ({
        key: o.value,
        label: o.label,
      })),
    [modelOptions],
  );

  /** 主会话占用中：后续发送应入队，避免 Semi「生成中」拦截或重复 spawn */
  const isSessionBusy = session.status === "running" || session.status === "connecting";
  const isSessionBusyRef = useRef(isSessionBusy);
  isSessionBusyRef.current = isSessionBusy;
  const onCancelRef = useRef(_onCancel);
  onCancelRef.current = _onCancel;
  const loadActiveBranch = useCallback(async () => {
    if (!gitRepositoryPath) {
      setActiveBranch("-");
      return;
    }
    try {
      const status = await gitStatus(gitRepositoryPath);
      setActiveBranch(status.branch?.trim() || "(detached)");
    } catch {
      setActiveBranch("-");
    }
  }, [gitRepositoryPath]);
  const loadBranches = useCallback(async () => {
    if (!gitRepositoryPath) {
      setBranches([]);
      setActiveBranch("-");
      return;
    }
    setBranchListLoading(true);
    try {
      const list = await gitListBranches(gitRepositoryPath);
      setBranches(list);
      const current = list.find((item) => item.isCurrent && !item.isRemote);
      if (current?.name) {
        setActiveBranch(current.name);
      } else {
        await loadActiveBranch();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      message.error(`读取分支失败: ${msg}`);
    } finally {
      setBranchListLoading(false);
    }
  }, [gitRepositoryPath, loadActiveBranch]);
  const handleCheckoutBranch = useCallback(
    async (name: string) => {
      if (!name.trim() || !gitRepositoryPath) return;
      setBranchActionLoading(true);
      try {
        await gitCheckoutBranch(gitRepositoryPath, name.trim());
        setActiveBranch(name.trim());
        await loadBranches();
        message.success(`已切换到分支: ${name.trim()}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        message.error(`切换分支失败: ${msg}`);
      } finally {
        setBranchActionLoading(false);
      }
    },
    [gitRepositoryPath, loadBranches],
  );
  const handleCreateBranch = useCallback(async () => {
    const name = branchCreateName.trim();
    if (!name) {
      message.warning("请输入新分支名称");
      return;
    }
    if (!gitRepositoryPath) {
      message.warning("当前会话未绑定 Git 仓库，无法创建分支");
      return;
    }
    setBranchActionLoading(true);
    try {
      await gitCreateBranch(gitRepositoryPath, name, branchCreateFromRef ?? null, true);
      setBranchCreateName("");
      setDetachedTargetRef("");
      setActiveBranch(name);
      await loadBranches();
      message.success(`已创建并切换到分支: ${name}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      message.error(`创建分支失败: ${msg}`);
    } finally {
      setBranchActionLoading(false);
    }
  }, [branchCreateName, branchCreateFromRef, gitRepositoryPath, loadBranches]);
  const handleCheckoutDetached = useCallback(async () => {
    const target = detachedTargetRef.trim();
    if (!target) {
      message.warning("请输入目标分支/标签/提交");
      return;
    }
    if (!gitRepositoryPath) {
      message.warning("当前会话未绑定 Git 仓库，无法切换 detached 引用");
      return;
    }
    setBranchActionLoading(true);
    try {
      await gitCheckoutDetached(gitRepositoryPath, target);
      setActiveBranch("(detached)");
      await loadBranches();
      message.success(`已 detached checkout: ${target}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      message.error(`Detached checkout 失败: ${msg}`);
      } finally {
        setBranchActionLoading(false);
      }
  }, [detachedTargetRef, gitRepositoryPath, loadBranches]);
  const filteredBranches = useMemo(() => {
    const keyword = branchQuery.trim().toLowerCase();
    if (!keyword) return branches;
    return branches.filter((item) => item.name.toLowerCase().includes(keyword));
  }, [branches, branchQuery]);
  const localBranches = useMemo(
    () => filteredBranches.filter((item) => !item.isRemote),
    [filteredBranches],
  );
  const remoteBranches = useMemo(
    () => filteredBranches.filter((item) => item.isRemote),
    [filteredBranches],
  );
  useEffect(() => {
    void loadActiveBranch();
    const timer = window.setInterval(() => {
      void loadActiveBranch();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadActiveBranch]);
  useEffect(() => {
    if (!branchPopoverOpen) return;
    void loadBranches();
  }, [branchPopoverOpen, loadBranches]);
  const bottomStatusLine = useMemo(() => {
    const modelLabel = session.model?.trim() || "Claude";
    const sessionDuration = formatSessionDuration(session.createdAt);
    const estimatedTokens = estimateSessionTokens(session);
    const ctxPercent = estimateContextPercent(estimatedTokens);
    const statusText = mapSessionStatus(session.status);
    return `[${modelLabel}] | session:${sessionDuration} | ctx:${ctxPercent}% (~${estimatedTokens.toLocaleString("zh-CN")} tokens) | status:${statusText}`;
  }, [session]);
  const logicalPlain = useMemo(
    () => promptToLogicalPlainString(prompt).replace(/\u200B/g, ""),
    [prompt],
  );
  const hasComposerPayload = useMemo(
    () => logicalPlain.trim().length > 0 || images.length > 0 || contextItems.length > 0,
    [logicalPlain, images.length, contextItems.length],
  );

  const restoreComposerDraft = useCallback((draft: LastSentComposerDraft) => {
    const display = promptToDisplayPlain(draft.prompt);
    ignoreNextContentSyncRef.current = true;
    lastEditorPlainRef.current = display;
    cursorRef.current = promptLength(draft.prompt);
    flushSync(() => {
      set(draft.prompt, promptLength(draft.prompt));
      setImages(draft.images.map((img) => ({ ...img })));
    });
    for (const item of draft.contextItems) {
      contextAdd(item);
    }
    queueMicrotask(() => {
      scheduleSafeAiChatSetContent(() => aiChatRef.current, display, () => {
        repairTiptapTrailingSpaceIfNeeded(aiChatRef.current, display);
        aiChatRef.current?.focusEditor?.("end");
      });
    });
  }, [set, setImages, contextAdd]);

  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;
  const hasComposerPayloadRef = useRef(hasComposerPayload);
  hasComposerPayloadRef.current = hasComposerPayload;
  const recordMissionMessage = useCallback(
    (text: string) => {
      void recordMissionComposerMessage({
        sessionId: session.id,
        projectId: missionContext?.projectId ?? null,
        rootPath: missionContext?.rootPath ?? session.repositoryPath,
        text,
      }).catch((error) => console.debug("recordMissionComposerMessage failed:", error));
    },
    [missionContext?.projectId, missionContext?.rootPath, session.id, session.repositoryPath],
  );

  const tryComposerEscapeRef = useRef<(target: EventTarget | null) => boolean>(() => false);
  tryComposerEscapeRef.current = (target: EventTarget | null) => {
    if (!isEscapeTargetInsideComposerRoot(composerEscapeRootRef.current, target)) return false;
    if (triggerRef.current.mode) return false;
    /** 必须先于 Tiptap undo：清空编辑器会产生可撤销步骤，若先 undo 只会还原正文、不会还原 React 侧缩略图 */
    const snap = postSendEscUndoRef.current;
    if (snap && !hasComposerPayloadRef.current) {
      postSendEscUndoRef.current = null;
      restoreComposerDraft(snap);
      if (isSessionBusyRef.current) {
        onCancelRef.current({ retractLastUserTurn: true });
      }
      setHistoryIndex(-1);
      return true;
    }
    if (tryComposerTiptapUndo(aiChatRef.current)) {
      setHistoryIndex(-1);
      return true;
    }
    return false;
  };

  useEffect(() => {
    postSendEscUndoRef.current = null;
  }, [session.id, draftBucketKey]);

  useEffect(() => {
    if (!postSendEscUndoRef.current) return;
    if (hasComposerPayload) {
      postSendEscUndoRef.current = null;
    }
  }, [hasComposerPayload]);

  /**
   * window + useLayoutEffect：早于 ClaudeChat 的 useEffect 注册，捕获阶段优先于同 target 上后注册的监听；
   * stopImmediatePropagation 避免「仅停止」与「撤回草稿」双触发。
   */
  useLayoutEffect(() => {
    function onWindowEscapeCapture(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (!tryComposerEscapeRef.current(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    window.addEventListener("keydown", onWindowEscapeCapture, { capture: true });
    return () => window.removeEventListener("keydown", onWindowEscapeCapture, { capture: true });
  }, []);

  const handleSend = useCallback(
    async (plainFromEditor?: string) => {
      const promptSnap: Prompt =
        plainFromEditor !== undefined ? singleTextPrompt(plainFromEditor) : prompt.map((part) => ({ ...part }));
      const logicalSnap = promptToLogicalPlainString(promptSnap).replace(/\u200B/g, "");
      const contextSnap = contextItems.map((c) => ({ ...c }));
      const imagesSnap = images.map((img) => ({ ...img }));
      const hasSnapPayload =
        logicalSnap.trim().length > 0 || imagesSnap.length > 0 || contextSnap.length > 0;
      if (!hasSnapPayload) return;

      const rollbackDraft: LastSentComposerDraft = {
        prompt: promptSnap.map((part) => ({ ...part })),
        images: imagesSnap.map((img) => ({ ...img })),
        contextItems: contextSnap.map((c) => ({ ...c })),
      };

      /** 先清空输入区，再 await 构建 outbound（图片落盘等），避免主线程长时间被占导致「点了没反应」 */
      const clearComposerSurfaceSync = () => {
        setTrigger({ mode: null, query: "", rect: null });
        ignoreNextContentSyncRef.current = true;
        lastEditorPlainRef.current = "";
        cursorRef.current = 0;
        flushSync(() => {
          reset();
          setImages([]);
        });
        scheduleSafeAiChatSetContent(() => aiChatRef.current, "");
        queueMicrotask(() => aiChatRef.current?.focusEditor?.("end"));
        void clearPromptContextSessionKey(draftBucketKey);
      };

      if (isSessionBusy) {
        if (!onEnqueueAsPendingTask) {
          message.warning("当前正在执行，无法加入待办队列。");
          return;
        }
        const sendFlowNodes: Array<{ label: string; timestamp: number; detail?: string }> = [];
        sendFlowNodes.push({
          label: "执行中入队",
          timestamp: Date.now(),
          detail: "会话占用中，本则消息仅加入待执行队列。",
        });
        clearComposerSurfaceSync();
        let outbound: string;
        try {
          outbound = await buildClaudeOutgoingPrompt({
            prompt: promptSnap,
            contextItems: contextSnap,
            images: imagesSnap,
            repositoryPath: session.repositoryPath,
          });
        } catch (e) {
          message.error(`发送准备失败: ${e instanceof Error ? e.message : String(e)}`);
          restoreComposerDraft(rollbackDraft);
          return;
        }
        sendFlowNodes.push({
          label: "构建发送消息",
          timestamp: Date.now(),
          detail: outbound.trim() || "(空)",
        });
        if (!outbound.trim()) {
          message.warning("未能构建有效发送内容。");
          restoreComposerDraft(rollbackDraft);
          return;
        }

        addToHistory(promptSnap, "normal");
        setHistoryIndex(-1);

        const inferredTarget = inferPendingQueueTargetFromPrompt(
          promptSnap,
          modelDisplayLabel,
          employeesForDispatchRoute,
        );
        const fallbackTarget = resolveTextMentionTarget(logicalSnap, employeeMentions, teamMentions);
        const target =
          inferredTarget.targetType === "main" && fallbackTarget
            ? {
                ...inferredTarget,
                ...fallbackTarget,
              }
            : inferredTarget;
        const dispatchPromptText =
          stripDispatchMentions(outbound, target.targetType, employeeMentions, teamMentions) || outbound;
        const consumePending = onEnqueueAsPendingTask({ promptText: dispatchPromptText, ...target });
        sendFlowNodes.push({
          label: "加入待执行队列",
          timestamp: Date.now(),
          detail: consumePending
            ? `任务ID: ${typeof consumePending === "string" ? consumePending : consumePending.id}`
            : "未返回任务ID",
        });
        const dispatchTargetDetail =
          target.targetType === "employee"
            ? `员工独立会话: ${target.targetEmployeeName?.trim() || target.executorLabel}`
            : target.targetType === "team"
              ? `团队流程: ${target.targetWorkflowName?.trim() || target.executorLabel}`
              : "主会话";
        sendFlowNodes.push({
          label: "分发执行目标",
          timestamp: Date.now(),
          detail: dispatchTargetDetail,
        });
        onTrackSendFlow?.({
          sessionId: session.id,
          composerText: logicalSnap.trim(),
          outboundText: dispatchPromptText,
          nodes: sendFlowNodes,
        });
        recordMissionMessage(logicalSnap);
        postSendEscUndoRef.current = rollbackDraft;
        return;
      }

      const sendFlowNodes: Array<{ label: string; timestamp: number; detail?: string }> = [];
      sendFlowNodes.push({
        label: "点击确认发送",
        timestamp: Date.now(),
        detail: "用户点击发送按钮或按下 Enter 触发发送。",
      });
      lastSentDraftRef.current = rollbackDraft;
      clearComposerSurfaceSync();

      let outbound: string;
      try {
        outbound = await buildClaudeOutgoingPrompt({
          prompt: promptSnap,
          contextItems: contextSnap,
          images: imagesSnap,
          repositoryPath: session.repositoryPath,
        });
      } catch (e) {
        message.error(`发送准备失败: ${e instanceof Error ? e.message : String(e)}`);
        const draft = lastSentDraftRef.current;
        lastSentDraftRef.current = null;
        if (draft) restoreComposerDraft(draft);
        return;
      }
      sendFlowNodes.push({
        label: "构建发送消息",
        timestamp: Date.now(),
        detail: outbound.trim() || "(空)",
      });
      if (!outbound.trim()) {
        message.warning("未能构建有效发送内容。");
        const draft = lastSentDraftRef.current;
        lastSentDraftRef.current = null;
        if (draft) restoreComposerDraft(draft);
        return;
      }

      addToHistory(promptSnap, "normal");
      setHistoryIndex(-1);

      let consumePending: string | PendingExecutionTask | undefined;
      let dispatchPromptText = outbound;
      let dispatchTargetForExecute: {
        targetType: "main" | "employee" | "team";
        targetEmployeeName?: string;
        targetWorkflowId?: string;
        targetWorkflowName?: string;
      } = { targetType: "main" };
      if (onEnqueueAsPendingTask) {
        const inferredTarget = inferPendingQueueTargetFromPrompt(
          promptSnap,
          modelDisplayLabel,
          employeesForDispatchRoute,
        );
        const fallbackTarget = resolveTextMentionTarget(logicalSnap, employeeMentions, teamMentions);
        const target =
          inferredTarget.targetType === "main" && fallbackTarget
            ? {
                ...inferredTarget,
                ...fallbackTarget,
              }
            : inferredTarget;
        dispatchTargetForExecute = {
          targetType: target.targetType,
          targetEmployeeName: target.targetEmployeeName,
          targetWorkflowId: target.targetWorkflowId,
          targetWorkflowName: target.targetWorkflowName,
        };
        dispatchPromptText =
          stripDispatchMentions(outbound, target.targetType, employeeMentions, teamMentions) || outbound;
        consumePending = onEnqueueAsPendingTask({ promptText: dispatchPromptText, ...target });
        sendFlowNodes.push({
          label: "加入待执行队列",
          timestamp: Date.now(),
          detail: consumePending
            ? `任务ID: ${typeof consumePending === "string" ? consumePending : consumePending.id}`
            : "未返回任务ID",
        });
        const dispatchTargetDetail =
          target.targetType === "employee"
            ? `员工独立会话: ${target.targetEmployeeName?.trim() || target.executorLabel}`
            : target.targetType === "team"
              ? `团队流程: ${target.targetWorkflowName?.trim() || target.executorLabel}`
              : "主会话";
        sendFlowNodes.push({
          label: "分发执行目标",
          timestamp: Date.now(),
          detail: dispatchTargetDetail,
        });
        if (pendingExecutionTaskCount > 0) {
          sendFlowNodes.push({
            label: "按序排队",
            timestamp: Date.now(),
            detail: "队列中仍有未派发任务，本消息已加入队尾，将在可派发窗口依次执行。",
          });
          onTrackSendFlow?.({
            sessionId: session.id,
            composerText: logicalSnap.trim(),
            outboundText: dispatchPromptText,
            nodes: sendFlowNodes,
          });
          recordMissionMessage(logicalSnap);
          lastSentDraftRef.current = null;
          postSendEscUndoRef.current = rollbackDraft;
          return;
        }
      }
      sendFlowNodes.push({
        label: "提交会话执行",
        timestamp: Date.now(),
        detail: `会话ID: ${session.id}`,
      });
      onTrackSendFlow?.({
        sessionId: session.id,
        composerText: logicalSnap.trim(),
        outboundText: dispatchPromptText,
        nodes: sendFlowNodes,
      });
      recordMissionMessage(logicalSnap);
      lastSentDraftRef.current = null;
      postSendEscUndoRef.current = rollbackDraft;
      onExecute(session.id, dispatchPromptText, consumePending, dispatchTargetForExecute);
    },
    [
      isSessionBusy,
      prompt,
      contextItems,
      images,
      session,
      setImages,
      onEnqueueAsPendingTask,
      pendingExecutionTaskCount,
      modelDisplayLabel,
      onTrackSendFlow,
      onExecute,
      reset,
      set,
      restoreComposerDraft,
      contextAdd,
      setTrigger,
      employeeMentions,
      teamMentions,
      employeesForDispatchRoute,
      draftBucketKey,
      recordMissionMessage,
    ],
  );

  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (trigger.mode) return;
      if (e.key === "ArrowUp" && !e.shiftKey) {
        if (canNavigateHistoryAtCursor(cursor, logicalPlain)) {
          e.preventDefault();
          const result = navigatePromptHistory("up", prompt, historyIndex, "normal");
          set(result.prompt, promptLength(result.prompt));
          setHistoryIndex(result.index);
        }
      } else if (e.key === "ArrowDown" && !e.shiftKey && historyIndex !== -1) {
        if (canNavigateHistoryAtCursor(cursor, logicalPlain)) {
          e.preventDefault();
          const result = navigatePromptHistory("down", prompt, historyIndex, "normal");
          set(result.prompt, promptLength(result.prompt));
          setHistoryIndex(result.index);
        }
      }
    },
    [trigger.mode, logicalPlain, cursor, historyIndex, prompt, set, setHistoryIndex],
  );

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const replaceImage = useCallback((id: string, next: ImageAttachmentPart) => {
    setImages((prev) => prev.map((img) => (img.id === id ? next : img)));
  }, []);

  const addImageFilesFromList = useCallback((fileList: FileList | File[]) => {
    for (const file of Array.from(fileList)) {
      if (!isImageFile(file)) continue;
      const reader = new FileReader();
      reader.onerror = () => {
        console.error("[composer] FileReader.readAsDataURL failed:", file.name, reader.error);
      };
      reader.onload = () => {
        setImages((prev) => [
          ...prev,
          {
            type: "image" as const,
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            filename: file.name,
            mime: file.type || "application/octet-stream",
            dataUrl: reader.result as string,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  /** 从系统/Finder 拖入的文件：图片进缩略图，其它文件插入 @ 药丸（与附件按钮一致） */
  const handleNativeFilesDropped = useCallback(
    (files: File[]) => {
      const surface = plainSurfaceRef.current;
      if (!surface) {
        logClaudeDrop("handleNativeFilesDropped.skip", { reason: "surface_null", fileCount: files.length });
        return;
      }
      logClaudeDrop("handleNativeFilesDropped.start", {
        fileCount: files.length,
        files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
      });
      for (const file of files) {
        if (isImageFile(file)) {
          logClaudeDrop("handleNativeFilesDropped.branch", { name: file.name, branch: "image_thumbnail" });
          addImageFilesFromList([file]);
        } else {
          logClaudeDrop("handleNativeFilesDropped.branch", { name: file.name, branch: "mention_insert" });
          surface.focus();
          let plain = surface.getPlain();
          let cur = surface.getCursor();
          let r = insertPlainAt(plain, cur, `@${file.name}`);
          r = ensureSpaceAfterAtInsert(r.plain, r.cursor);
          surface.setPlainAndCursor(r.plain, r.cursor);
        }
      }
    },
    [addImageFilesFromList],
  );

  /** 右栏「开发文件」树拖入：插入 `@仓库相对路径`（与系统文件拖入非图片行为一致）。 */
  const handleRepositoryPathsDropped = useCallback((paths: string[]) => {
    const surface = plainSurfaceRef.current;
    if (!surface || paths.length === 0) {
      return;
    }
    surface.focus();
    let plain = surface.getPlain();
    let cur = surface.getCursor();
    for (const rel of paths) {
      const t = rel.trim();
      if (!t) continue;
      let r = insertPlainAt(plain, cur, `@${t}`);
      r = ensureSpaceAfterAtInsert(r.plain, r.cursor);
      plain = r.plain;
      cur = r.cursor;
    }
    surface.setPlainAndCursor(plain, cur);
  }, []);

  const handleInputAreaDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!isComposerFileLikeDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOverNativeFiles(true);
      if (!dragOverLoggedRef.current) {
        dragOverLoggedRef.current = true;
        logClaudeDrop("inputArea.dragOver.first", {
          isSessionBusy: session.status === "running" || session.status === "connecting",
          dropEffect: e.dataTransfer.dropEffect,
          types: [...e.dataTransfer.types],
          itemSummary: e.dataTransfer.items
            ? [...e.dataTransfer.items].map((it) => ({ kind: it.kind, type: it.type }))
            : [],
        });
      }
    },
    [session.status],
  );

  const handleInputAreaDragLeave = useCallback((e: React.DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !e.currentTarget.contains(next)) {
      setDragOverNativeFiles(false);
      dragOverLoggedRef.current = false;
      logClaudeDrop("inputArea.dragLeave", {
        relatedIsNull: next === null,
        relatedNodeName: next && "nodeName" in next ? (next as Node).nodeName : undefined,
      });
    }
  }, []);

  /** 捕获阶段处理：先于 Tiptap/可编辑区收到 drop，避免浏览器按 `text/plain` 插入路径导致重复。 */
  const handleInputAreaDropCapture = useCallback(
    (e: React.DragEvent) => {
      if (!isWiseRepositoryFileDrag(e)) return;
      dragOverLoggedRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      setDragOverNativeFiles(false);
      const paths = getWiseRepositoryFileDragPaths(e);
      logClaudeDrop("inputArea.dropCapture.repo_paths", { paths });
      if (paths.length > 0) {
        handleRepositoryPathsDropped(paths);
      }
    },
    [handleRepositoryPathsDropped],
  );

  const handleInputAreaDrop = useCallback(
    (e: React.DragEvent) => {
      dragOverLoggedRef.current = false;
      logClaudeDrop("inputArea.drop.received", {
        targetTag: (e.target as HTMLElement | null)?.tagName,
        currentClass: (e.currentTarget as HTMLElement).className?.slice?.(0, 80),
      });
      if (!isNativeFileDrag(e)) {
        logClaudeDrop("inputArea.drop.skip", {
          reason: "not_native_file_drag",
          types: [...e.dataTransfer.types],
        });
        return;
      }
      e.preventDefault();
      setDragOverNativeFiles(false);
      const dtFiles = e.dataTransfer.files;
      if (!dtFiles?.length) {
        logClaudeDrop("inputArea.drop.skip", {
          reason: "dataTransfer.files_empty",
          types: [...e.dataTransfer.types],
          items: e.dataTransfer.items
            ? [...e.dataTransfer.items].map((it) => ({ kind: it.kind, type: it.type }))
            : [],
        });
        return;
      }
      const files = Array.from(dtFiles);
      logClaudeDrop("inputArea.drop.dispatch", { count: files.length, names: files.map((f) => f.name) });
      handleNativeFilesDropped(files);
    },
    [handleNativeFilesDropped],
  );

  const handleInputAreaPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        addImageFilesFromList(imageFiles);
      }
    },
    [addImageFilesFromList],
  );

  const handleFileAttach = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "*/*";
    input.onchange = () => {
      if (!input.files) return;
      Array.from(input.files).forEach((file) => {
        if (isImageFile(file)) {
          addImageFilesFromList([file]);
        } else {
          const s = plainSurfaceRef.current;
          if (s) {
            const plain = s.getPlain();
            const cur = s.getCursor();
            let r = insertPlainAt(plain, cur, `@${file.name}`);
            r = ensureSpaceAfterAtInsert(r.plain, r.cursor);
            s.setPlainAndCursor(r.plain, r.cursor);
          }
        }
      });
    };
    input.click();
  }, [addImageFilesFromList]);

  const handleFileAttachRef = useRef(handleFileAttach);
  useEffect(() => {
    handleFileAttachRef.current = handleFileAttach;
  }, [handleFileAttach]);

  /** ⌘I / Ctrl+I：与附件按钮相同，打开系统文件选择（图片进缩略图，其它插入 @） */
  useEffect(() => {
    function onGlobalKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.shiftKey || e.altKey) return;
      if (!(e.code === "KeyI" || e.key === "i" || e.key === "I")) return;
      e.preventDefault();
      handleFileAttachRef.current();
    }
    window.addEventListener("keydown", onGlobalKey, { capture: true });
    return () => window.removeEventListener("keydown", onGlobalKey, { capture: true });
  }, []);

  const handleScreenshot = useCallback(async () => {
    const result = await captureScreenshot();
    if (!result) return;
    const part = screenshotResultToImagePart(result);
    setImages((prev) => [...prev, part]);
    // screencapture 结束后系统焦点在别处：先置顶主窗，再在下一帧聚焦输入框（WKWebView 上更稳）
    try {
      await wiseMainWindowFocus();
    } catch {
      /* 浏览器 dev / 非 Tauri */
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        aiChatRef.current?.focusEditor?.("end");
      });
    });
  }, []);

  /** 与附件、截屏同一行，位于模型选择左侧 */
  const branchPickerInFooterToolbar = useMemo(
    () => (
      <Popover
        trigger="click"
        placement="topLeft"
        open={branchPopoverOpen}
        onOpenChange={(open) => {
          setBranchPopoverOpen(open);
          if (!open) {
            setBranchQuery("");
            setBranchCreateName("");
            setBranchCreateFromRef(undefined);
            setDetachedTargetRef("");
            setBranchActionTab("create");
          }
        }}
        overlayClassName="app-claude-branch-popover"
        content={
          <div className="app-claude-branch-popover__content">
            <div className="app-claude-branch-popover__controls">
              <Input
                size="small"
                placeholder="搜索分支..."
                className="app-claude-branch-popover__search-input"
                value={branchQuery}
                onChange={(event) => setBranchQuery(event.target.value)}
              />
              <Tabs
                size="small"
                tabBarGutter={10}
                activeKey={branchActionTab}
                onChange={(key) => setBranchActionTab(key === "detached" ? "detached" : "create")}
                className="app-claude-branch-popover__action-tabs"
                items={[
                  {
                    key: "create",
                    label: "创建分支",
                    children: (
                      <div className="app-claude-branch-popover__tab-pane">
                        <div className="app-claude-branch-popover__group-desc">输入新分支名称，可选指定基线分支</div>
                        <div className="app-claude-branch-popover__create-name-row">
                          <Input
                            size="small"
                            placeholder="新分支名"
                            className="app-claude-branch-popover__branch-name-input"
                            value={branchCreateName}
                            onChange={(event) => setBranchCreateName(event.target.value)}
                            onPressEnter={() => void handleCreateBranch()}
                            disabled={branchActionLoading}
                          />
                        </div>
                        <div className="app-claude-branch-popover__create-row">
                          <Select
                            size="small"
                            allowClear
                            placeholder="from..."
                            className="app-claude-branch-popover__from-select"
                            value={branchCreateFromRef}
                            onChange={(value) => setBranchCreateFromRef(value)}
                            options={branches.map((item) => ({ value: item.name, label: item.name }))}
                            disabled={branchActionLoading || branchListLoading}
                            showSearch
                            optionFilterProp="label"
                          />
                          <Button
                            size="small"
                            type="primary"
                            className="app-claude-branch-popover__action-btn"
                            onClick={() => void handleCreateBranch()}
                            loading={branchActionLoading}
                          >
                            新建
                          </Button>
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: "detached",
                    label: "分离检出",
                    children: (
                      <div className="app-claude-branch-popover__tab-pane">
                        <div className="app-claude-branch-popover__group-desc">切到分支/标签/提交，但不切换到本地分支</div>
                        <div className="app-claude-branch-popover__create-row">
                          <Select
                            size="small"
                            showSearch
                            placeholder="checkout detached... (branch/tag/commit)"
                            className="app-claude-branch-popover__detached-select"
                            value={detachedTargetRef || undefined}
                            onChange={(value) => setDetachedTargetRef(value ?? "")}
                            onSearch={(value) => setDetachedTargetRef(value)}
                            options={branches.map((item) => ({
                              value: item.name,
                              label: item.name,
                            }))}
                            disabled={branchActionLoading || branchListLoading}
                            optionFilterProp="label"
                          />
                          <Button
                            size="small"
                            className="app-claude-branch-popover__action-btn"
                            onClick={() => void handleCheckoutDetached()}
                            loading={branchActionLoading}
                          >
                            分离检出
                          </Button>
                        </div>
                      </div>
                    ),
                  },
                ]}
              />
            </div>
            <div className="app-claude-branch-popover__list">
              {branchListLoading ? (
                <div className="app-claude-branch-popover__loading">
                  <Spin size="small" />
                </div>
              ) : filteredBranches.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配分支" />
              ) : (
                <>
                  {localBranches.length > 0 && (
                    <>
                      <div className="app-claude-branch-popover__section-title">本地分支</div>
                      {localBranches.map((item) => (
                        <button
                          key={`local-${item.name}`}
                          type="button"
                          className={`app-claude-branch-popover__item ${item.isCurrent ? "app-claude-branch-popover__item--active" : ""}`}
                          onClick={() => void handleCheckoutBranch(item.name)}
                          disabled={branchActionLoading}
                        >
                          <span className="app-claude-branch-popover__item-name">{item.name}</span>
                          <span className="app-claude-branch-popover__item-meta">
                            {item.author ? `${item.author} · ` : ""}
                            {formatRelativeTime(item.lastCommitTimestamp)}
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                  {remoteBranches.length > 0 && (
                    <>
                      <div className="app-claude-branch-popover__section-title">远程分支</div>
                      {remoteBranches.map((item) => (
                        <button
                          key={`remote-${item.name}`}
                          type="button"
                          className={`app-claude-branch-popover__item ${item.isCurrent ? "app-claude-branch-popover__item--active" : ""}`}
                          onClick={() => void handleCheckoutBranch(item.name)}
                          disabled={branchActionLoading}
                        >
                          <span className="app-claude-branch-popover__item-name">{item.name}</span>
                          <span className="app-claude-branch-popover__item-meta">
                            {item.author ? `${item.author} · ` : ""}
                            {formatRelativeTime(item.lastCommitTimestamp)}
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        }
      >
        <Button
          type="text"
          size="small"
          className="app-claude-branch-trigger app-claude-semi-footer-branch-trigger"
          style={{ color: "var(--ant-color-text-tertiary)", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="3" x2="6" y2="19" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span className="app-claude-semi-footer-branch-name">{activeBranch}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Button>
      </Popover>
    ),
    [
      activeBranch,
      branchActionLoading,
      branchActionTab,
      branchCreateFromRef,
      branchCreateName,
      branchListLoading,
      branchPopoverOpen,
      branchQuery,
      branches,
      detachedTargetRef,
      filteredBranches,
      handleCheckoutBranch,
      handleCheckoutDetached,
      handleCreateBranch,
      localBranches,
      remoteBranches,
    ],
  );

  /** 与 Semi 底栏同一行：左侧附件 / 截屏 / 分支 */
  const renderSemiComposerConfigureArea = useCallback(() => {
    return (
      <div
        className="app-claude-semi-footer-toolbar-left"
        /* Semi AIChatInput 根节点 onClick 会对「非富文本区」调用 focusEditor()，会抢走 Select/Dropdown 的焦点；阻止冒泡到底栏外层的 Semi 容器 */
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          type="text"
          size="small"
          onClick={handleFileAttach}
          title="上传图片或文件（⌘I / Ctrl+I）"
          style={{ color: "var(--ant-color-text-secondary)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </Button>
        <Button
          type="text"
          size="small"
          onClick={handleScreenshot}
          style={{ color: "var(--ant-color-text-secondary)" }}
          title="截屏"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <circle cx="12" cy="10" r="3" />
            <path d="M7 21h10" />
            <path d="M12 17v4" />
          </svg>
        </Button>
        {dualPaneRepositoryPicker ? (
          <Select
            size="small"
            variant="borderless"
            className="app-claude-dual-pane-repo-picker"
            classNames={{ popup: { root: "app-claude-dual-pane-repo-picker-dropdown" } }}
            popupMatchSelectWidth={false}
            showSearch
            optionFilterProp="label"
            title="右侧主会话目标仓库"
            aria-label="选择仓库"
            value={dualPaneRepositoryPicker.valueRepositoryId}
            options={dualPaneRepositoryPicker.repositories.map((r) => ({
              value: r.id,
              label: r.name,
            }))}
            onChange={(v) => dualPaneRepositoryPicker.onSelectRepositoryId(Number(v))}
            placeholder="仓库"
          />
        ) : null}
        {branchPickerInFooterToolbar}
      </div>
    );
  }, [branchPickerInFooterToolbar, dualPaneRepositoryPicker, handleFileAttach, handleScreenshot]);

  /** 与 Semi 底栏同一行：停止（占用中）+ 模型选择 + 发送（Semi 在 generating 时会拦截发送，故用独立停止 + generating=false） */
  const renderSemiComposerActionArea = useCallback(
    ({ menuItem, className }: { menuItem: React.ReactNode[]; className: string }) => (
      <div
        className={`${className} app-claude-semi-footer-toolbar-right`}
        onClick={(e) => e.stopPropagation()}
      >
        {isSessionBusy ? (
          <Tooltip title="终止当前 Claude Code 运行" placement="top">
            <Button type="text" size="small" className="app-claude-semi-footer-stop-btn" onClick={() => _onCancel()}>
              停止
            </Button>
          </Tooltip>
        ) : null}
        <Dropdown
          menu={{
            items: modelMenuItems,
            selectable: true,
            selectedKeys: [model],
            onClick: ({ key }) => {
              setModel(key);
              onSessionModelChange(key);
            },
          }}
          trigger={["click"]}
          placement="topRight"
        >
          <button
            type="button"
            className="app-claude-model-picker"
            aria-haspopup="menu"
            aria-label="选择模型"
          >
            <span className="app-claude-model-picker__label">{modelDisplayLabel}</span>
            <svg
              className="app-claude-model-picker__chevron"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </Dropdown>
        {menuItem}
      </div>
    ),
    [isSessionBusy, _onCancel, model, modelDisplayLabel, modelMenuItems, onSessionModelChange, setModel],
  );

  /** F3 仅注册一次全局监听；双栏时避免两次 screencapture 争用导致松手后无图 */
  useEffect(() => {
    return registerGlobalScreenshotRecipient(session.id, (part) => {
      setImages((prev) => [...prev, part]);
      void wiseMainWindowFocus().catch(() => {});
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          aiChatRef.current?.focusEditor?.("end");
        });
      });
    });
  }, [session.id]);

  /** ⌥Z（Option+Z）：Rust 侧已置顶主窗；此处仅聚焦本会话输入框 */
  useEffect(() => {
    return registerGlobalFocusComposerRecipient(session.id, () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          aiChatRef.current?.focusEditor?.("end");
        });
      });
    });
  }, [session.id]);

  const handleTodoToggle = useCallback((id: string) => {
    // Update todo status — in a real app this would sync with backend
    const el = document.querySelector(`[data-todo-id="${id}"]`);
    el?.dispatchEvent(new CustomEvent("todo-toggle", { detail: { id } }));
  }, []);

  const showQuestionChrome = Boolean(useAggregatedQuestionDock || questionRequest);

  return (
    <div
      ref={composerEscapeRootRef}
      className={`app-claude-composer${showQuestionChrome ? " app-claude-composer--pending-question" : ""}`}
      data-wise-composer-root=""
      data-session-id={session.id}
      onFocusCapture={() => noteComposerScreenshotFocus(session.id)}
      onPointerDownCapture={() => noteComposerScreenshotFocus(session.id)}
      onKeyDown={handleKeyDown}
    >
      {/* Docks above editor：同仓库多路 AskUserQuestion 时 Tabs 嵌在题卡顶栏（原「待你确认」行） */}
      {useAggregatedQuestionDock && activeQuestionDockTab ? (
        <div style={{ padding: "0 16px" }}>
          <QuestionDock
            key={`${activeQuestionDockTab.ownerSessionId}:${activeQuestionDockTab.question.id}`}
            request={activeQuestionDockTab.question}
            questionQueueLength={activeQuestionDockTab.queueLength}
            requestStatus={activeQuestionDockTab.status}
            requestError={activeQuestionDockTab.error}
            headerTopSlot={
              <>
                <div className="app-claude-dock--question__header-tabs-inner">
                  <Tabs
                    size="small"
                    tabBarGutter={8}
                    activeKey={activeQuestionTabKey}
                    onChange={setActiveQuestionTabKey}
                    items={dockTabs.map((tab) => ({
                      key: tab.tabKey,
                      label: (
                        <span
                          className="app-claude-question-tab-label"
                          title={tab.tabSubtitle ? `${tab.tabTitle}\n出题时间：${tab.tabSubtitle}` : tab.tabTitle}
                        >
                          <span className="app-claude-question-tab-title">{tab.tabTitle}</span>
                        </span>
                      ),
                    }))}
                  />
                </div>
                {activeQuestionDockTab.queueLength > 0 ? (
                  <Tag color="processing" className="app-claude-dock--question__queue-tag">
                    排队 {activeQuestionDockTab.queueLength}
                  </Tag>
                ) : null}
              </>
            }
            onSubmit={(answers, customAnswer) =>
              respondQuestionAt(activeQuestionDockTab.ownerSessionId, answers, customAnswer)
            }
            onDismiss={() => dismissQuestionAt(activeQuestionDockTab.ownerSessionId)}
          />
        </div>
      ) : questionRequest ? (
        <div style={{ padding: "0 16px" }}>
          <QuestionDock
            key={questionRequest.id}
            request={questionRequest}
            questionQueueLength={questionRequestQueueLength}
            requestStatus={questionRequestStatus}
            requestError={questionRequestError}
            onSubmit={(answers, customAnswer) => respondQuestionAt(session.id, answers, customAnswer)}
            onDismiss={() => dismissQuestionAt(session.id)}
          />
        </div>
      ) : null}
      {permissionRequest ? (
        <div style={{ padding: "0 16px" }}>
          <PermissionDock
            request={permissionRequest}
            requestStatus={permissionRequestStatus}
            requestError={permissionRequestError}
            onDecide={onRespondToPermission}
          />
        </div>
      ) : null}

      {/* Input area：整区（含底栏）支持从外部拖入文件 */}
      <div
        className="app-claude-input-area"
        onDragOver={handleInputAreaDragOver}
        onDragLeave={handleInputAreaDragLeave}
        onDropCapture={handleInputAreaDropCapture}
        onDrop={handleInputAreaDrop}
        onPaste={handleInputAreaPaste}
      >
        <div
          className={`app-claude-input-container${dragOverNativeFiles ? " app-claude-input-container--drop-target" : ""}`}
        >
          {/* Followup suggestions */}
          {followupItems.length > 0 && !isSessionBusy && (
            <FollowupDock
              items={followupItems}
              onSend={onSendFollowup}
              onEdit={() => {}}
              onClose={onClearFollowups}
            />
          )}

          {/* Todo dock */}
          <TodoDock items={todos} onToggle={handleTodoToggle} />

          {/* Revert dock */}
          <RevertDock items={revertItems} onRestore={onRestoreRevert} onClose={onClearRevertItems} />

          {/* Image thumbnails */}
          <ImageThumbnails images={images} onRemove={removeImage} onReplace={replaceImage} />

          {/* Context items (file chips) */}
          <ContextItems items={contextItems} />

          {/* Semi AIChatInput（替换原 contentEditable app-claude-editor） */}
          <SemiConfigProvider locale={semiLocaleZhCN}>
            <div ref={shellRef} className="app-claude-semi-chat-input-wrap" style={{ width: "100%" }}>
              <AIChatInput
                ref={aiChatRef}
                placeholder="@ 员工/团队/文件，/ 命令，Enter 发送，Shift+Enter 换行，Esc 撤销"
                keepSkillAfterSend={false}
                showUploadButton={false}
                showUploadFile={false}
                showReference={false}
                showTemplateButton={false}
                renderConfigureArea={renderSemiComposerConfigureArea}
                renderActionArea={renderSemiComposerActionArea}
                clearContentOnGenerating={false}
                generating={false}
                onStopGenerate={() => _onCancel()}
                canSend={hasComposerPayload}
                onMessageSend={(msg) => {
                  const plain = contentsToPlain((msg.inputContents ?? []) as Content[]);
                  void handleSendRef.current(plain);
                }}
                onContentChange={(contents: Content[]) => {
                  if (ignoreNextContentSyncRef.current) {
                    ignoreNextContentSyncRef.current = false;
                    return;
                  }
                  const ed = aiChatRef.current?.getEditor?.();
                  // 以 ProseMirror 文本为准，避免 Semi onContentChange 的 JSON 在段落/换行上与 DOM 不一致导致多行被压扁
                  let plain = contentsToPlain(contents);
                  if (ed) {
                    try {
                      plain = ed.getText?.({ blockSeparator: "\n" }) ?? plain;
                    } catch {
                      /* keep contentsToPlain */
                    }
                  }
                  let c = plain.length;
                  if (ed) {
                    try {
                      c = ed.state.doc.textBetween(0, ed.state.selection.from, "\n").length;
                    } catch {
                      c = plain.length;
                    }
                  }
                  cursorRef.current = c;
                  lastEditorPlainRef.current = plain;
                  set(singleTextPrompt(plain), c);
                  reportAtSlashTriggerFromPlain(plain, c, setTrigger, shellRef.current?.getBoundingClientRect() ?? null);
                }}
                style={{ width: "100%" }}
              />
            </div>
          </SemiConfigProvider>
        </div>

        {/* Bottom bar：会话元信息（分支已移至输入框底栏截屏按钮后） */}
        <div className="app-claude-input-bottom-bar">
          <span className="app-claude-input-bottom-statusline" title={bottomStatusLine}>
            {bottomStatusLine}
          </span>
        </div>
      </div>

      {/* Slash/At Popover */}
      <SlashPopover
        surfaceRef={plainSurfaceRef}
        trigger={trigger}
        onDismiss={() => setTrigger({ mode: null, query: "", rect: null })}
        onSelect={() => {}}
        repositoryPath={session.repositoryPath}
        employeeOptions={employeeMentions}
        teamOptions={teamMentions}
        projectRoleTagOptions={projectRoleTagOptions}
        hideEmployeesInAtMode={hideEmployeesInAtMode}
      />
    </div>
  );
}

// ── Outer component (provides context) ──

export interface ComposerRegionProps {
  session: ClaudeSession;
  gitRepositoryPath?: string;
  /** 第三参：刚入队的任务（优先）或任务 id；第四参：兜底分发目标（避免 ref 未刷新时回退主会话） */
  onExecute: (
    sessionId: string,
    prompt: string,
    consumePending?: string | PendingExecutionTask,
    dispatchTarget?: {
      targetType: "main" | "employee" | "team";
      targetEmployeeName?: string;
      targetWorkflowId?: string;
      targetWorkflowName?: string;
    },
    executeOptions?: ClaudeComposerExecuteBubbleOptions,
  ) => void;
  onSessionModelChange: (model: string) => void;
  /** `retractLastUserTurn`：Esc 撤回刚发时从 transcript 去掉本轮 user/assistant 并杀进程 */
  onCancel: (opts?: { retractLastUserTurn?: boolean }) => void;
  todos: TodoItem[];
  questionRequest: QuestionRequest | null;
  /** 同一会话内排在当前题之后的 AskUserQuestion 数量 */
  questionRequestQueueLength?: number;
  questionRequestStatus?: ControlRequestStatus | null;
  questionRequestError?: string | null;
  /** 同仓库多标签待确认题聚合（≥1 时在「待你确认」行以 Tabs 展示） */
  questionDockTabs?: QuestionDockTabSpec[];
  permissionRequest: PermissionRequest | null;
  permissionRequestStatus?: ControlRequestStatus | null;
  permissionRequestError?: string | null;
  followupItems: { id: string; text: string }[];
  revertItems: { id: string; text: string }[];
  respondQuestionAt: (ownerSessionId: string, answers: string[], customAnswer?: string) => void;
  dismissQuestionAt: (ownerSessionId: string) => void;
  onRespondToPermission: (response: "allow_once" | "allow_always" | "deny") => void;
  onClearTodos?: () => void;
  onSendFollowup: (id: string) => void;
  onClearFollowups?: () => void;
  onRestoreRevert: (id: string) => void;
  onClearRevertItems?: () => void;
  /** 发送前写入待执行队列；队列为空且会话空闲时返回新任务行供 onExecute 同 tick 出队，队列非空时仅入队尾由上层按序派发 */
  onEnqueueAsPendingTask?: (payload: {
    promptText: string;
    executorLabel: string;
    targetType: "main" | "employee" | "team";
    targetEmployeeName?: string;
    targetWorkflowId?: string;
    targetWorkflowName?: string;
  }) => PendingExecutionTask;
  employeeMentions?: Array<{ id: string; name: string }>;
  teamMentions?: Array<{ id: string; name: string }>;
  projectRoleTagOptions?: ReadonlyArray<import("../../utils/projectRoleTagOptions").RoleTagOption>;
  hideEmployeesInAtMode?: boolean;
  onTrackSendFlow?: (entry: {
    sessionId: string;
    composerText: string;
    outboundText: string;
    nodes: Array<{ label: string; timestamp: number; detail?: string }>;
  }) => void;
  employeesForDispatchRoute?: readonly EmployeeItem[];
  /** 本次发送前待执行队列已有条数；>0 时空闲发送只入队尾，由 ClaudeChat 按序自动派发 */
  pendingExecutionTaskCount?: number;
  /** 草稿持久化桶（与主输入区分）；见 `PromptProvider` */
  draftBucketKey?: string;
  dualPaneRepositoryPicker?: DualPaneComposerRepositoryPickerProps;
  missionContext?: {
    projectId?: string | null;
    rootPath?: string | null;
  };
}

export function ComposerRegion({ session, draftBucketKey, ...rest }: ComposerRegionProps) {
  return (
    <PromptProvider sessionId={session.id} draftBucketKey={draftBucketKey}>
      <ComposerInner session={session} {...rest} />
    </PromptProvider>
  );
}

function resolveTextMentionTarget(
  text: string,
  employees: Array<{ id: string; name: string }>,
  teams: Array<{ id: string; name: string }>,
):
  | {
      executorLabel: string;
      targetType: "employee" | "team";
      targetEmployeeName?: string;
      targetWorkflowId?: string;
      targetWorkflowName?: string;
    }
  | undefined {
  const normalized = text.trim();
  if (!normalized) return undefined;
  let employeeMatch: { name: string; index: number } | undefined;
  for (const item of employees) {
    const name = item.name.trim();
    if (!name) continue;
    if (isOmcMonitorDispatchMentionName(name)) continue;
    const idx = normalized.indexOf(`@${name}`);
    if (idx < 0) continue;
    if (!employeeMatch || idx < employeeMatch.index) {
      employeeMatch = { name, index: idx };
    }
  }
  let teamMatch: { id: string; name: string; index: number } | undefined;
  for (const item of teams) {
    const name = item.name.trim();
    if (!name) continue;
    const idx = normalized.indexOf(`@${name}`);
    if (idx < 0) continue;
    if (!teamMatch || idx < teamMatch.index) {
      teamMatch = { id: item.id, name, index: idx };
    }
  }
  const genericTeamMentionIndex = normalized.indexOf("@团队");
  if (employeeMatch && (!teamMatch || employeeMatch.index <= teamMatch.index)) {
    return {
      executorLabel: `@${employeeMatch.name}`,
      targetType: "employee",
      targetEmployeeName: employeeMatch.name,
    };
  }
  if (teamMatch) {
    return {
      executorLabel: `团队:${teamMatch.name}`,
      targetType: "team",
      targetWorkflowId: teamMatch.id,
      targetWorkflowName: teamMatch.name,
    };
  }
  if (genericTeamMentionIndex >= 0 && teams.length > 0) {
    const fallbackTeam = teams[0];
    return {
      executorLabel: `团队:${fallbackTeam.name.trim()}`,
      targetType: "team",
      targetWorkflowId: fallbackTeam.id,
      targetWorkflowName: fallbackTeam.name.trim(),
    };
  }
  return undefined;
}

function stripDispatchMentions(
  text: string,
  targetType: "main" | "employee" | "team",
  employees: Array<{ id: string; name: string }>,
  teams: Array<{ id: string; name: string }>,
): string {
  if (targetType === "main") return text;
  let next = text;
  if (targetType === "team") {
    next = next.replace(/@团队/g, "");
  }
  const mentionNames = [
    ...employees.map((item) => item.name.trim()),
    ...teams.map((item) => item.name.trim()),
  ].filter(Boolean);
  for (const name of mentionNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`@${escaped}`, "g"), "");
  }
  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
