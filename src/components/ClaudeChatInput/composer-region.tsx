import {
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  type MouseEvent,
} from "react";
import { flushSync } from "react-dom";
import { HoverHint } from "../shared/HoverHint";
import "@douyinfe/semi-ui/lib/es/_base/base.css";
import { AIChatInput, ConfigProvider as SemiConfigProvider } from "@douyinfe/semi-ui";
import semiLocaleZhCN from "@douyinfe/semi-ui/lib/es/locale/source/zh_CN";
import "./composer-semi-tokens.css";
import type { Content } from "@douyinfe/semi-ui/lib/es/aiChatInput/interface";
import type { ClaudeSessionConnectionKind } from "../../constants/claudeConnection";
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
  ProjectItem,
  Repository,
  SessionExecutionEngine,
} from "../../types";
import { PromptProvider, clearPromptContextSessionKey, usePrompt } from "./prompt-context";
import type { TriggerInfo } from "./slash-trigger";
import type { ComposerPlainSurface } from "./slash-popover";
import {
  contentsToPlain,
  detectAtSlashTrigger,
  ensureSpaceAfterAtInsert,
  promptToDisplayPlain,
  normalizeComposerEditorPlain,
  singleTextPrompt,
  insertPlainAt,
} from "./composer-plain-utils";
import {
  focusComposerAtPlainOffset,
  getComposerEditorCaretRectAtPlainOffset,
  resolveComposerProseMirrorView,
  type ComposerProseMirrorEditor,
} from "./composer-trigger-anchor";
import { ContextItems } from "./context-items";
import { SlashPopover } from "./slash-popover";
import { composerTokenHighlightExtensions } from "./composerTokenHighlightExtension";
import { syncComposerHighlightMarksOnEditor } from "./composerTokenHighlight";
import { shouldSkipStaleComposerSetContent } from "./composerSetContentGuard";
import { debounce } from "../../utils/debounce";
import { useAtMentionDefaultTarget } from "../../hooks/useAtMentionDefaultTarget";
import { useAtMentionShortcuts } from "../../hooks/useAtMentionShortcuts";
import { resolveComposerCommonPhraseAction } from "../../constants/composerCommonPhrase";
import type { ComposerCommonPhrase } from "../../constants/composerCommonPhrase";
import {
  WISE_UI_EVENT_APPLY_COMPOSER_COMMON_PHRASE,
  type ApplyComposerCommonPhraseDetail,
} from "../../constants/composerCommonPhraseEvents";
import { useComposerCommonPhrases } from "../../hooks/useComposerCommonPhrases";
import { applyComposerCommonPhraseToSurface } from "../../utils/applyComposerCommonPhrase";
import { chordMatchesKeyboardEvent } from "../../utils/atMentionShortcutChord";
import { isWiseAppFocused } from "../../utils/isWiseAppFocused";
import { ComposerCommonPhrasesManageTrigger } from "./ComposerCommonPhrasesManageTrigger";
import { ImageThumbnails } from "./attachment-manager";
import { QuestionDock } from "./dock/question-dock";
import { PermissionDock } from "./dock/permission-dock";
import { FollowupDock } from "./dock/followup-dock";
import { TodoDock } from "./dock/todo-dock";
import { RevertDock } from "./dock/revert-dock";
import { addToHistory, promptLength, navigatePromptHistory, canNavigateHistoryAtCursor } from "./prompt-history";
import { Checkbox, Button, Empty, Input, message, Popover, Select, Spin, Tabs, Tag, TreeSelect } from "antd";
import { ContextCompactProgressRing } from "./ContextCompactProgressRing";
import { useContextBreakdown } from "../../hooks/useContextBreakdown";
import { ComposerVoiceSettingsPanel } from "./ComposerVoiceSettingsPanel";
import { ComposerRuntimeSettingsTrigger } from "./ComposerRuntimeSettingsTrigger";
import { ComposerModelPicker } from "./ComposerModelPicker";
import { useDefaultClaudeConnectionKind } from "../../hooks/useDefaultClaudeConnectionKind";
import { useComposerSpeechPipeline } from "../../hooks/useComposerSpeechPipeline";
import { useComposerSpeechPreferences } from "../../hooks/useComposerSpeechPreferences";
import {
  downloadComposerSherpaModels,
  cancelComposerSherpaDownloadModels,
  getComposerSherpaSpeechCapabilities,
  isComposerSherpaSpeechPlatform,
  listenComposerSherpaModelsStatus,
  type ComposerSherpaSpeechCapabilities,
} from "../../services/composerSherpaSpeech";
import {
  type ComposerSpeechPreferencesV1,
} from "../../constants/composerSpeechPreferences";
import type { ComposerSpeechEngine } from "../../constants/composerSpeech";
import { formatSilenceAutoSendIdleSeconds } from "../../utils/composerSpeechSilenceIdle";
import { readVisiblePollIntervalMs } from "../../utils/adaptivePoll";
import { logClaudeDrop } from "./drop-debug";
import {
  buildClaudeComposerSendPayload,
  normalizeComposerPlainMain,
  stripComposerAttachedImageSuffix,
} from "../../services/claudeComposerPrompt";
import {
  attachDiskPathsToComposerImages,
  extractComposerAttachmentPathsFromText,
  hydrateComposerImagesForRestore,
} from "../../services/readComposerImage";
import { userMessagePlainTextForDisplay } from "../../utils/claudeChatMessageDisplay";
import { buildCursorComposerSendPayload } from "../../services/cursorComposerPrompt";
import {
  contextPercentToneClassName,
  formatContextStatusHint,
  getContextPercentTone,
  getSessionContextMetrics,
} from "../../services/claudeSessionContext";
import { WISE_CLAUDE_USER_SETTINGS_CHANGED } from "../../services/claudeModelProfiles";
import { getCachedModelProfileStore } from "../../stores/modelProfileStoreCache";
import type { ModelProfileEngine } from "../../types/claudeModelProfile";
import { resolveActiveModelProfileComposerBarLabel } from "../../utils/modelProfileDisplay";
import { promptToLogicalPlainString } from "../../utils/serializeClaudePrompt";
import { getWiseRepositoryFileDragPaths, isWiseRepositoryFileDrag } from "../../utils/repositoryFileDrag";
import { formatClaudeModelLabel } from "../../utils/claudeModel";
import { formatCursorModelLabel } from "../../utils/cursorModel";
import { inferPendingQueueTargetFromPrompt } from "../../utils/pendingQueueExecutor";
import { SESSION_EXECUTION_ENGINE_LABELS } from "../../constants/sessionExecutionEngine";
import { parseExecutionEnvironmentDispatch } from "../../utils/executionEnvironmentDispatch";
import { isOmcMonitorDispatchMentionName } from "../../utils/omcMonitorEmployeeSession";
import { captureScreenshot, screenshotResultToImagePart } from "../../services/screenshot";
import {
  noteComposerScreenshotFocus,
  registerGlobalAtMentionShortcutRecipient,
  registerGlobalFocusComposerRecipient,
  registerGlobalScreenshotRecipient,
} from "../../services/globalScreenshotHotkey";
import { wiseMainWindowFocus } from "../../services/wiseMascot";
import { gitCheckoutBranch, gitCreateBranch, gitListBranches, gitStatus } from "../../services/git";
import { recordMissionComposerMessage } from "./missionMentionHook";
import type { ControlRequestStatus } from "../../notifications";
import type { QuestionDockTabSpec } from "../../hooks/useQuestionDockTabs";
import { buildClaudeSessionHoverTitle } from "../../utils/claudeSessionIdTooltip";
import {
  WORKFLOW_UI_EVENT_APPLY_STARTER_PROMPT,
  WORKFLOW_UI_EVENT_APPEND_MONACO_SELECTION_TO_COMPOSER,
  type ApplyMonacoSelectionToComposerDetail,
  type ApplyStarterPromptDetail,
} from "../../constants/workflowUiEvents";
import { extractComposerCodeSelectionRefs } from "./extractComposerCodeSelectionRefs";
import { scheduleInsertComposerCodeSelectionRef } from "./scheduleInsertComposerCodeSelectionRef";
import { expandComposerCodeSelectionRefs } from "../../utils/expandComposerCodeSelectionRefs";
import type { GitBranchEntry } from "../../types";

function composerSpeechEngineHint(engine: ComposerSpeechEngine | null): string {
  if (engine === "sensevoice") return "SenseVoice 本地听写";
  return "Web Speech 听写";
}

function composerSpeechStopHint(engine: ComposerSpeechEngine | null): string {
  if (engine === "web") return "停止语音听写";
  return "点击停止录音并转写";
}

function composerSpeechVoiceCommandsHint(
  prefs: Pick<
    ComposerSpeechPreferencesV1,
    | "voiceCommandsEnabled"
    | "autoSendEndingText"
    | "voiceCommandClearText"
    | "voiceCommandCancelText"
  >,
): string | null {
  if (!prefs.voiceCommandsEnabled) return null;
  const send = prefs.autoSendEndingText || "发送";
  const clear = prefs.voiceCommandClearText || "清除";
  const cancel = prefs.voiceCommandCancelText || "取消";
  return `口播「${send}」发送；「${clear}」清空输入；「${cancel}」结束执行`;
}

/** 双栏右侧主会话：输入框底栏在截屏按钮旁选择目标仓库 */
export interface DualPaneComposerRepositoryPickerProps {
  repositories: Repository[];
  projects?: ProjectItem[];
  valueKey: string;
  onSelectRepositoryId: (repositoryId: number) => void;
  onSelectProjectId?: (projectId: string) => void;
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
  onSessionConnectionKindChange?: (kind: ClaudeSessionConnectionKind) => void;
  sessionExecutionEngine?: SessionExecutionEngine;
  codexAvailable?: boolean;
  cursorAvailable?: boolean;
  onSessionExecutionEngineChange?: (engine: SessionExecutionEngine) => void;
  onOpenExecutionEnvironment?: () => void;
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
  onToggleTodo?: (todoId: string) => void;
  onSendFollowup: (id: string) => void;
  onClearFollowups?: () => void;
  onRestoreRevert: (id: string) => void;
  onClearRevertItems?: () => void;
  /** 发送前写入待执行队列；队列为空且会话空闲时返回新任务行供 onExecute 同 tick 出队，队列非空时仅入队尾由上层按序派发 */
  onDispatchExecutionEnvironment?: (input: {
    prompt: string;
    userBubblePrompt?: string;
  }) => void | Promise<void>;
  onEnqueueAsPendingTask?: (payload: {
    promptText: string;
    executorLabel: string;
    targetType: "main" | "employee" | "team";
    targetEmployeeName?: string;
    targetWorkflowId?: string;
    targetWorkflowName?: string;
    executeBubbleOptions?: ClaudeComposerExecuteBubbleOptions;
  }) => PendingExecutionTask;
  employeeMentions?: Array<{ id: string; name: string }>;
  teamMentions?: Array<{ id: string; name: string }>;
  projectRoleTagOptions?: ReadonlyArray<import("../../utils/projectRoleTagOptions").RoleTagOption>;
  projectRepositoryMentionOptions?: ReadonlyArray<
    import("../../utils/projectRoleTagOptions").RepositoryMentionOption
  >;
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

function resolveAtSlashTriggerAnchorRect(
  aiChat: InstanceType<typeof AIChatInput> | null,
  shell: HTMLDivElement | null,
  plain: string,
  cursor: number,
): DOMRect | null {
  const detected = detectAtSlashTrigger(plain, cursor);
  if (!detected) return null;
  const rawEd = aiChat?.getEditor?.();
  const view = resolveComposerProseMirrorView(rawEd);
  if (
    view &&
    rawEd &&
    typeof rawEd === "object" &&
    "state" in rawEd &&
    (rawEd as ComposerProseMirrorEditor).state?.doc
  ) {
    const caret = getComposerEditorCaretRectAtPlainOffset(
      { state: (rawEd as ComposerProseMirrorEditor).state, view },
      detected.triggerStart,
    );
    if (caret) return caret;
  }
  return shell?.getBoundingClientRect() ?? null;
}

function dedupeComposerImages(images: ImageAttachmentPart[]): ImageAttachmentPart[] {
  const seen = new Set<string>();
  const out: ImageAttachmentPart[] = [];
  for (const img of images) {
    const key = img.id.trim() || img.dataUrl || img.diskPath?.trim() || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(img);
  }
  return out;
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

function isProseMirrorFocused(shell: HTMLElement | null): boolean {
  if (!shell) return false;
  const pm = shell.querySelector(".ProseMirror");
  if (!pm) return false;
  const ae = document.activeElement;
  return ae === pm || (ae instanceof Node && pm.contains(ae));
}

/** 焦点误落在底栏按钮或消息滚动区时，把空格还回编辑器。 */
function refocusComposerAndInsertSpace(aiChat: InstanceType<typeof AIChatInput> | null): void {
  const ed = aiChat?.getEditor?.() as
    | {
        chain?: () => {
          focus: (pos?: string) => { insertContent: (v: string) => { run: () => void } };
        };
      }
    | undefined;
  if (ed?.chain) {
    try {
      ed.chain().focus("end").insertContent(" ").run();
      return;
    } catch {
      /* fall through */
    }
  }
  aiChat?.focusEditor?.("end");
}

const SAFE_AI_CHAT_SET_CONTENT_MAX_FRAMES = 48;
const COMPOSER_PROMPT_SYNC_DEBOUNCE_MS = 100;

const SEMI_COMPOSER_TOKEN_HIGHLIGHT_EXTENSIONS = composerTokenHighlightExtensions;

type ScheduleSafeAiChatSetContentOptions = {
  isEditorFocused?: () => boolean;
};

function readSemiEditorPlain(
  ed: { getText?: (opts?: { blockSeparator?: string }) => string } | null | undefined,
): string {
  if (!ed?.getText) return "";
  try {
    return normalizeComposerEditorPlain(ed.getText({ blockSeparator: "\n" }) ?? "");
  } catch {
    return "";
  }
}

/**
 * Semi `AIChatInput` 的 ref `setContent` 在 Tiptap 未挂载时会抛错：`adapter.setContent` 直接访问 `this.editor.commands`，
 * 未对 `this.editor` 做空判断（与 `focusEditor` 不同）。在 editor 就绪前用 rAF 重试，避免首帧 / 嵌入条切换时崩溃。
 */
function scheduleSafeAiChatSetContent(
  resolveAiChat: () => InstanceType<typeof AIChatInput> | null,
  content: string,
  onAfterSet?: () => void,
  options?: ScheduleSafeAiChatSetContentOptions,
): void {
  const attempt = (): boolean => {
    const ai = resolveAiChat();
    const ed = ai?.getEditor?.();
    if (!ai || !ed) return false;
    const editorPlain = readSemiEditorPlain(ed);
    if (
      shouldSkipStaleComposerSetContent(
        editorPlain,
        content,
        options?.isEditorFocused?.() ?? false,
      )
    ) {
      syncComposerHighlightMarksOnEditor(ed);
      onAfterSet?.();
      return true;
    }
    try {
      ai.setContent(content);
    } catch {
      return false;
    }
    syncComposerHighlightMarksOnEditor(ed);
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
  onSessionConnectionKindChange,
  sessionExecutionEngine = "claude",
  codexAvailable = true,
  cursorAvailable = true,
  onSessionExecutionEngineChange,
  onOpenExecutionEnvironment,
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
  onClearTodos,
  onToggleTodo,
  onSendFollowup,
  onClearFollowups,
  onRestoreRevert,
  onClearRevertItems,
  onDispatchExecutionEnvironment,
  onEnqueueAsPendingTask,
  employeeMentions = [],
  teamMentions = [],
  projectRoleTagOptions = [],
  projectRepositoryMentionOptions = [],
  hideEmployeesInAtMode = false,
  onTrackSendFlow,
  employeesForDispatchRoute,
  pendingExecutionTaskCount = 0,
  dualPaneRepositoryPicker,
  missionContext,
}: ComposerInnerProps) {
  const { breakdown, loading: contextBreakdownLoading, ensureBreakdown } =
    useContextBreakdown(session);
  /** 含题卡/待办/底栏等整块输入 chrome，用于 Esc 命中判定（仅 shellRef 会漏掉模型选择、停止等） */
  const composerEscapeRootRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const aiChatRef = useRef<InstanceType<typeof AIChatInput> | null>(null);
  /** Semi Tiptap 在首帧 commit 时会 emit onContentChange；延迟挂载 AIChatInput 避免「未挂载就 setState」。 */
  const semiEditorReadyRef = useRef(false);
  const [semiEditorReady, setSemiEditorReady] = useState(false);
  useEffect(() => {
    semiEditorReadyRef.current = true;
    setSemiEditorReady(true);
    return () => {
      semiEditorReadyRef.current = false;
      setSemiEditorReady(false);
    };
  }, []);
  const plainSurfaceRef = useRef<ComposerPlainSurface | null>(null);
  const lastEditorPlainRef = useRef("");
  const ignoreNextContentSyncRef = useRef(false);
  const skipContentSyncRemainingRef = useRef(0);
  const composerSendInFlightRef = useRef(false);
  const cursorRef = useRef(0);
  const dragOverLoggedRef = useRef(false);
  const { target: atMentionDefaultTarget, save: saveAtMentionDefaultTarget } =
    useAtMentionDefaultTarget();
  const { bindings: atMentionShortcutBindings } = useAtMentionShortcuts();
  const {
    phrases: composerCommonPhrases,
    bindings: composerCommonPhraseBindings,
    loading: composerCommonPhrasesLoading,
    saving: composerCommonPhrasesSaving,
    persist: persistComposerCommonPhrases,
  } = useComposerCommonPhrases();
  const [trigger, setTrigger] = useState<TriggerInfo>({ mode: null, query: "", rect: null });
  const [images, setImages] = useState<ImageAttachmentPart[]>([]);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const [dragOverNativeFiles, setDragOverNativeFiles] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isCursorEngine = sessionExecutionEngine === "cursor";
  const [model, setModel] = useState(() => session.model?.trim() || "sonnet");
  const [profileStoreRevision, setProfileStoreRevision] = useState(0);
  const profileEngineForPicker: ModelProfileEngine | null = isCursorEngine
    ? null
    : sessionExecutionEngine === "codex"
      ? "codex"
      : "claude";
  const defaultConnectionKind = useDefaultClaudeConnectionKind();
  const [activeBranch, setActiveBranch] = useState<string>("-");
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchCreateName, setBranchCreateName] = useState("");
  const [branchCreateFromRef, setBranchCreateFromRef] = useState<string | undefined>(undefined);
  const [branchCreateNoTrack, setBranchCreateNoTrack] = useState(true);
  const branchCreateDraftRef = useRef({
    name: "",
    fromRef: undefined as string | undefined,
    noTrack: true,
  });
  branchCreateDraftRef.current = {
    name: branchCreateName,
    fromRef: branchCreateFromRef,
    noTrack: branchCreateNoTrack,
  };
  const [branchListLoading, setBranchListLoading] = useState(false);
  const [branchActionLoading, setBranchActionLoading] = useState(false);
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const lastSentDraftRef = useRef<LastSentComposerDraft | null>(null);
  /** 发送成功后、输入区为空时按 Esc 可恢复的草稿（与占位符「Esc 撤销」一致；开始新输入后自动失效） */
  const postSendEscUndoRef = useRef<LastSentComposerDraft | null>(null);
  /** 上键浏览历史前暂存的当前草稿（下键回到 index -1 时恢复） */
  const promptHistorySavedRef = useRef<{ prompt: Prompt; images: ImageAttachmentPart[] } | null>(null);

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

  const { prompt, contextItems, set, reset, contextAdd, draftBucketKey } = usePrompt();

  const displayPlain = useMemo(() => promptToDisplayPlain(prompt), [prompt]);
  const contextItemsRef = useRef(contextItems);
  contextItemsRef.current = contextItems;
  const canSendComposerRef = useRef(false);
  const [canSendComposer, setCanSendComposer] = useState(false);
  const debouncedPromptSyncRef = useRef(
    debounce((plain: string, cursorPos: number) => {
      set(singleTextPrompt(plain), cursorPos);
    }, COMPOSER_PROMPT_SYNC_DEBOUNCE_MS),
  );

  useEffect(() => {
    debouncedPromptSyncRef.current.cancel();
    debouncedPromptSyncRef.current = debounce((plain: string, cursorPos: number) => {
      set(singleTextPrompt(plain), cursorPos);
    }, COMPOSER_PROMPT_SYNC_DEBOUNCE_MS);
    return () => {
      debouncedPromptSyncRef.current.flush();
    };
  }, [set]);

  const syncCanSendComposer = useCallback((plain: string) => {
    const codeSelectionRefs = extractComposerCodeSelectionRefs(aiChatRef.current?.getEditor?.());
    const active =
      plain.trim().length > 0 ||
      imagesRef.current.length > 0 ||
      contextItemsRef.current.length > 0 ||
      codeSelectionRefs.length > 0;
    if (active === canSendComposerRef.current) return;
    canSendComposerRef.current = active;
    setCanSendComposer(active);
  }, []);

  const scheduleComposerSetContent = useCallback(
    (plain: string, onAfterSet?: () => void) => {
      const normalized = normalizeComposerEditorPlain(plain);
      scheduleSafeAiChatSetContent(
        () => aiChatRef.current,
        normalized,
        () => {
          const actual = readSemiEditorPlain(aiChatRef.current?.getEditor?.());
          if (actual) lastEditorPlainRef.current = actual;
          onAfterSet?.();
        },
        { isEditorFocused: () => isProseMirrorFocused(shellRef.current) },
      );
    },
    [],
  );

  plainSurfaceRef.current = {
    anchorEl: () => shellRef.current,
    resolveTriggerAnchorRect: () => {
      const plain = plainSurfaceRef.current?.getPlain() ?? promptToDisplayPlain(prompt);
      const cursor = plainSurfaceRef.current?.getCursor() ?? cursorRef.current;
      return resolveAtSlashTriggerAnchorRect(aiChatRef.current, shellRef.current, plain, cursor);
    },
    getPlain: () => {
      const live = lastEditorPlainRef.current;
      if (live) return live;
      const fromEditor = readSemiEditorPlain(aiChatRef.current?.getEditor?.());
      if (fromEditor) return fromEditor;
      return promptToDisplayPlain(prompt);
    },
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
      const normalized = normalizeComposerEditorPlain(plain);
      ignoreNextContentSyncRef.current = true;
      cursorRef.current = c;
      lastEditorPlainRef.current = normalized;
      debouncedPromptSyncRef.current.cancel();
      set(singleTextPrompt(normalized), c);
      scheduleComposerSetContent(normalized, () => {
        repairTiptapTrailingSpaceIfNeeded(aiChatRef.current, normalized);
        const actual = readSemiEditorPlain(aiChatRef.current?.getEditor?.());
        if (actual) lastEditorPlainRef.current = actual;
        focusComposerAtPlainOffset(aiChatRef.current, c);
      });
    },
    focus: () => {
      const ed = aiChatRef.current?.getEditor?.() as
        | { state?: { selection: { from: number }; doc: { textBetween: (a: number, b: number, s?: string) => string } } }
        | undefined;
      if (ed?.state?.doc) {
        try {
          const from = ed.state.selection.from;
          const plainCursor = ed.state.doc.textBetween(0, from, "\n").length;
          focusComposerAtPlainOffset(aiChatRef.current, plainCursor);
          return;
        } catch {
          /* fall through */
        }
      }
      focusComposerAtPlainOffset(aiChatRef.current, cursorRef.current);
    },
  };

  useEffect(() => {
    lastEditorPlainRef.current = "";
  }, [session.id, draftBucketKey]);

  /** 会话输入区：Tab 仅用于 @ / 补全，不触发浏览器默认焦点切换（底栏按钮等） */
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const active = document.activeElement;
      if (!active || !shell.contains(active)) return;
      const editor = shell.querySelector(".ProseMirror");
      if (!editor || (active !== editor && !editor.contains(active))) return;
      e.preventDefault();
    };
    shell.addEventListener("keydown", onKeyDown, { capture: true });
    return () => shell.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [session.id]);

  /**
   * 空格在「可滚动容器 / 底栏按钮」上会触发滚动或点击发送，表现为输入框失焦。
   * 捕获阶段把空格收回 ProseMirror（仅本会话 composer 可见时）。
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.isComposing || e.repeat) return;
      const shell = shellRef.current;
      const composerRoot = composerEscapeRootRef.current;
      if (!shell || !composerRoot?.isConnected) return;
      if (isProseMirrorFocused(shell)) return;

      const ae = document.activeElement;
      if (!(ae instanceof Element)) return;
      const chat = composerRoot.closest(".app-claude-chat");
      if (!chat?.contains(ae)) return;

      const inComposerChrome = ae.closest("[data-wise-composer-root]") != null;
      const onMessagesViewport = ae.closest(".app-claude-messages") != null;
      const onChatShellOnly =
        ae.classList.contains("app-claude-chat") && !ae.closest("[data-wise-composer-root]");

      if (!inComposerChrome && !onMessagesViewport && !onChatShellOnly) return;

      e.preventDefault();
      e.stopPropagation();
      refocusComposerAndInsertSpace(aiChatRef.current);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [session.id]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const flushPromptSync = () => {
      debouncedPromptSyncRef.current.flush();
    };
    shell.addEventListener("focusout", flushPromptSync);
    return () => shell.removeEventListener("focusout", flushPromptSync);
  }, [session.id]);

  useEffect(() => {
    if (!semiEditorReady) return;
    // 聚焦时编辑器为唯一来源，禁止 React plain 回写 setContent
    if (isProseMirrorFocused(shellRef.current)) return;
    if (lastEditorPlainRef.current === displayPlain) return;
    lastEditorPlainRef.current = displayPlain;
    ignoreNextContentSyncRef.current = true;
    skipContentSyncRemainingRef.current = 3;
    scheduleComposerSetContent(displayPlain, () => {
      repairTiptapTrailingSpaceIfNeeded(aiChatRef.current, displayPlain);
    });
  }, [displayPlain, semiEditorReady, scheduleComposerSetContent]);

  const applySemiContentChange = useCallback((contents: Content[]) => {
    if (!semiEditorReadyRef.current) return;
    const ed = aiChatRef.current?.getEditor?.();
    let plain = normalizeComposerEditorPlain(contentsToPlain(contents));
    if (ed) {
      try {
        plain = readSemiEditorPlain(ed) || plain;
      } catch {
        /* keep contentsToPlain */
      }
    }
    if (skipContentSyncRemainingRef.current > 0) {
      if (plain !== lastEditorPlainRef.current) {
        skipContentSyncRemainingRef.current = 0;
      } else {
        skipContentSyncRemainingRef.current -= 1;
        return;
      }
    }
    if (ignoreNextContentSyncRef.current) {
      ignoreNextContentSyncRef.current = false;
      return;
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
    syncCanSendComposer(plain);
    debouncedPromptSyncRef.current(plain, c);
    const detected = detectAtSlashTrigger(plain, c);
    setTrigger((prev) => {
      if (!detected) {
        if (prev.mode === null && prev.query === "") return prev;
        return { mode: null, query: "", rect: null };
      }
      if (prev.mode === detected.mode && prev.query === detected.query) return prev;
      return {
        mode: detected.mode,
        query: detected.query,
        rect: resolveAtSlashTriggerAnchorRect(aiChatRef.current, shellRef.current, plain, c),
      };
    });
    if (plain.endsWith(" ")) {
      queueMicrotask(() => {
        repairTiptapTrailingSpaceIfNeeded(aiChatRef.current, plain);
      });
    }
  }, [syncCanSendComposer]);

  useEffect(() => {
    const onSettingsChanged = () => {
      setProfileStoreRevision((n) => n + 1);
    };
    window.addEventListener(WISE_CLAUDE_USER_SETTINGS_CHANGED, onSettingsChanged);
    return () => window.removeEventListener(WISE_CLAUDE_USER_SETTINGS_CHANGED, onSettingsChanged);
  }, []);

  const modelDisplayLabel = useMemo(() => {
    if (profileEngineForPicker) {
      const fromActive = resolveActiveModelProfileComposerBarLabel(
        profileEngineForPicker,
        getCachedModelProfileStore(),
      );
      if (fromActive) return fromActive;
    }
    return isCursorEngine ? formatCursorModelLabel(model) : formatClaudeModelLabel(model);
  }, [isCursorEngine, model, profileEngineForPicker, profileStoreRevision]);

  const handleComposerModelChange = useCallback(
    (nextModel: string) => {
      const trimmed = nextModel.trim();
      if (!trimmed) return;
      setModel((prev) => (prev === trimmed ? prev : trimmed));
      onSessionModelChange(trimmed);
    },
    [onSessionModelChange],
  );

  /** 主会话占用中：后续发送应入队，避免 Semi「生成中」拦截或重复 spawn */
  const isSessionBusy = session.status === "running" || session.status === "connecting";
  const isSessionBusyRef = useRef(isSessionBusy);
  isSessionBusyRef.current = isSessionBusy;
  const onCancelRef = useRef(_onCancel);
  onCancelRef.current = _onCancel;
  const handleSendRef = useRef<(plain?: string) => void | Promise<void>>(() => undefined);

  const { prefs: speechPrefs, update: updateSpeechPrefs } = useComposerSpeechPreferences();
  const speechPolishProjectPath =
    gitRepositoryPath?.trim() || session.repositoryPath?.trim() || "";

  const clearComposerInputForSpeech = useCallback(() => {
    debouncedPromptSyncRef.current.cancel();
    lastEditorPlainRef.current = "";
    cursorRef.current = 0;
    ignoreNextContentSyncRef.current = true;
    canSendComposerRef.current = false;
    setCanSendComposer(false);
    setTrigger({ mode: null, query: "", rect: null });
    postSendEscUndoRef.current = null;
    flushSync(() => {
      reset();
      setImages([]);
    });
    scheduleComposerSetContent("");
    void clearPromptContextSessionKey(draftBucketKey);
  }, [draftBucketKey, reset, scheduleComposerSetContent, setImages]);

  const {
    speechDictation,
    speechPolishing,
    speechKeepAliveDuringBusy,
    finalizeTranscriptBaselineAfterSend,
    rollbackTranscriptBaselineOnSendFailure,
    onComposerInputClearedForSend,
    resetStreamAnchor,
    clearSpeechIdleAutoSendTimer,
  } = useComposerSpeechPipeline({
    sessionId: session.id,
    isSessionBusy,
    speechPrefs,
    speechPolishProjectPath,
    surfaceRef: plainSurfaceRef,
    clearComposerInput: clearComposerInputForSpeech,
    onAutoSend: (plain) => {
      void handleSendRef.current(plain);
    },
    onCancelSession: () => onCancelRef.current(),
  });

  const [sherpaSpeechCaps, setSherpaSpeechCaps] = useState<ComposerSherpaSpeechCapabilities | null>(
    null,
  );
  const [sherpaModelsDownloading, setSherpaModelsDownloading] = useState(false);
  const [sherpaDownloadProgress, setSherpaDownloadProgress] = useState<number | null>(null);
  const [sherpaDownloadError, setSherpaDownloadError] = useState<string | null>(null);
  const sherpaAutoDownloadAttemptedRef = useRef(false);
  const sherpaDownloadBlockedRef = useRef(false);

  useEffect(() => {
    if (!isComposerSherpaSpeechPlatform()) return;
    void getComposerSherpaSpeechCapabilities().then(setSherpaSpeechCaps);
    let unlisten: (() => void) | undefined;
    void listenComposerSherpaModelsStatus((payload) => {
      if (payload.phase === "downloading") {
        setSherpaModelsDownloading(true);
        setSherpaDownloadError(null);
        if (typeof payload.progressPercent === "number") {
          setSherpaDownloadProgress(payload.progressPercent);
        }
        return;
      }
      setSherpaModelsDownloading(false);
      setSherpaDownloadProgress(null);
      if (payload.phase === "ready") {
        setSherpaDownloadError(null);
        sherpaDownloadBlockedRef.current = false;
        message.success({ content: payload.message || "SenseVoice 模型已就绪", key: "composer-sherpa-download" });
        void getComposerSherpaSpeechCapabilities({ forceRefresh: true }).then(setSherpaSpeechCaps);
        return;
      }
      if (payload.phase === "cancelled") {
        setSherpaDownloadError(null);
        sherpaDownloadBlockedRef.current = true;
        return;
      }
      if (payload.phase === "error") {
        sherpaDownloadBlockedRef.current = true;
        setSherpaDownloadError(payload.message || "SenseVoice 模型下载失败");
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);
  const [speechMenuOpen, setSpeechMenuOpen] = useState(false);
  const [draftAutoSendEndingText, setDraftAutoSendEndingText] = useState(
    speechPrefs.autoSendEndingText,
  );
  const [draftVoiceCommandClearText, setDraftVoiceCommandClearText] = useState(
    speechPrefs.voiceCommandClearText,
  );
  const [draftVoiceCommandCancelText, setDraftVoiceCommandCancelText] = useState(
    speechPrefs.voiceCommandCancelText,
  );
  const [draftSilenceIdleSeconds, setDraftSilenceIdleSeconds] = useState(
    speechPrefs.silenceAutoSendIdleMs / 1000,
  );
  const silenceIdleSecondsLabel = formatSilenceAutoSendIdleSeconds(
    speechPrefs.silenceAutoSendIdleMs,
  );

  useEffect(() => {
    if (speechMenuOpen) {
      setDraftAutoSendEndingText(speechPrefs.autoSendEndingText);
      setDraftVoiceCommandClearText(speechPrefs.voiceCommandClearText);
      setDraftVoiceCommandCancelText(speechPrefs.voiceCommandCancelText);
      setDraftSilenceIdleSeconds(speechPrefs.silenceAutoSendIdleMs / 1000);
    }
  }, [
    speechMenuOpen,
    speechPrefs.autoSendEndingText,
    speechPrefs.voiceCommandCancelText,
    speechPrefs.voiceCommandClearText,
    speechPrefs.silenceAutoSendIdleMs,
  ]);

  const handleDownloadSherpaModels = useCallback(() => {
    sherpaDownloadBlockedRef.current = false;
    sherpaAutoDownloadAttemptedRef.current = true;
    setSherpaDownloadError(null);
    setSherpaModelsDownloading(true);
    setSherpaDownloadProgress(0);
    void downloadComposerSherpaModels().catch((e) => {
      setSherpaModelsDownloading(false);
      setSherpaDownloadProgress(null);
      sherpaDownloadBlockedRef.current = true;
      setSherpaDownloadError(e instanceof Error ? e.message : String(e));
    });
  }, []);

  const handleCancelSherpaDownload = useCallback(() => {
    void cancelComposerSherpaDownloadModels();
  }, []);

  useEffect(() => {
    if (!isComposerSherpaSpeechPlatform()) return;
    if (speechPrefs.speechEngineMode !== "sensevoice") return;
    if (sherpaSpeechCaps?.modelsInstalled) return;
    if (sherpaModelsDownloading || sherpaSpeechCaps?.downloading) return;
    if (sherpaAutoDownloadAttemptedRef.current) return;
    if (sherpaDownloadBlockedRef.current) return;
    sherpaAutoDownloadAttemptedRef.current = true;
    handleDownloadSherpaModels();
  }, [
    handleDownloadSherpaModels,
    sherpaModelsDownloading,
    sherpaSpeechCaps?.downloading,
    sherpaSpeechCaps?.modelsInstalled,
    speechPrefs.speechEngineMode,
  ]);

  const voiceSettingsPanel = useMemo(
    () => (
      <ComposerVoiceSettingsPanel
        speechPrefs={speechPrefs}
        updateSpeechPrefs={updateSpeechPrefs}
        draftSilenceIdleSeconds={draftSilenceIdleSeconds}
        setDraftSilenceIdleSeconds={setDraftSilenceIdleSeconds}
        draftAutoSendEndingText={draftAutoSendEndingText}
        setDraftAutoSendEndingText={setDraftAutoSendEndingText}
        draftVoiceCommandClearText={draftVoiceCommandClearText}
        setDraftVoiceCommandClearText={setDraftVoiceCommandClearText}
        draftVoiceCommandCancelText={draftVoiceCommandCancelText}
        setDraftVoiceCommandCancelText={setDraftVoiceCommandCancelText}
        activeEngine={speechDictation.engine}
        sherpaSpeechCaps={sherpaSpeechCaps}
        sherpaModelsDownloading={sherpaModelsDownloading}
        sherpaDownloadProgress={sherpaDownloadProgress}
        sherpaDownloadError={sherpaDownloadError}
        onDownloadSherpaModels={handleDownloadSherpaModels}
        onCancelSherpaDownload={handleCancelSherpaDownload}
      />
    ),
    [
      draftAutoSendEndingText,
      draftSilenceIdleSeconds,
      draftVoiceCommandCancelText,
      draftVoiceCommandClearText,
      handleCancelSherpaDownload,
      handleDownloadSherpaModels,
      sherpaDownloadError,
      sherpaDownloadProgress,
      sherpaModelsDownloading,
      sherpaSpeechCaps,
      speechDictation.engine,
      speechPrefs,
      updateSpeechPrefs,
    ],
  );

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
    } catch {
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
      } catch {
      } finally {
        setBranchActionLoading(false);
      }
    },
    [gitRepositoryPath, loadBranches],
  );
  const handleCreateBranch = useCallback(async () => {
    const draft = branchCreateDraftRef.current;
    const name = draft.name.trim();
    if (!name) {
      return;
    }
    if (!gitRepositoryPath) {
      return;
    }
    setBranchActionLoading(true);
    try {
      await gitCreateBranch(
        gitRepositoryPath,
        name,
        draft.fromRef ?? null,
        true,
        draft.noTrack,
      );
      setBranchCreateName("");
      setActiveBranch(name);
      await loadBranches();
    } catch {
    } finally {
      setBranchActionLoading(false);
    }
  }, [gitRepositoryPath, loadBranches]);
  const stopBranchPopoverPointerToComposer = useCallback((event: MouseEvent) => {
    event.stopPropagation();
  }, []);
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
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void loadActiveBranch();
    }, readVisiblePollIntervalMs(30_000, 120_000));
    return () => window.clearInterval(timer);
  }, [loadActiveBranch]);
  useEffect(() => {
    if (!branchPopoverOpen) return;
    void loadBranches();
  }, [branchPopoverOpen, loadBranches]);
  const bottomStatus = useMemo(() => {
    const sessionDuration = formatSessionDuration(session.createdAt);
    const metrics = getSessionContextMetrics(session);
    const outgoing = prompt.trim();
    const ctxHint = formatContextStatusHint(metrics, outgoing || undefined);
    const statusText = mapSessionStatus(session.status);
    const ctxSegment = ctxHint
      ? `ctx:${metrics.ctxPercent}% (~${metrics.estimatedTokens.toLocaleString("zh-CN")} tokens, ${ctxHint})`
      : `ctx:${metrics.ctxPercent}% (~${metrics.estimatedTokens.toLocaleString("zh-CN")} tokens)`;
    const fullLine = `session:${sessionDuration} | ${ctxSegment} | status:${statusText}`;
    return {
      sessionDuration,
      ctxSegment,
      ctxPercent: metrics.ctxPercent,
      ctxToneClass: contextPercentToneClassName(getContextPercentTone(metrics.ctxPercent)),
      statusText,
      fullLine,
    };
  }, [prompt, session]);
  const hasComposerPayload = canSendComposer;

  useEffect(() => {
    syncCanSendComposer(lastEditorPlainRef.current || displayPlain);
  }, [displayPlain, images.length, contextItems.length, syncCanSendComposer]);

  const sessionRef = useRef(session);
  sessionRef.current = session;

  /** 将正文、附图缩略图同步回 React 与 Semi 编辑器（上键历史 / Esc 撤回共用）。 */
  const restoreComposerSurface = useCallback(
    (
      entryPrompt: Prompt,
      entryImages: ImageAttachmentPart[],
      opts?: {
        contextItems?: ContextItem[];
        rollbackSpeechBaseline?: boolean;
        fallbackPathsFromText?: string[];
      },
    ) => {
      void (async () => {
        const hydrated = await hydrateComposerImagesForRestore(
          entryImages.map((img) => ({ ...img })),
          opts?.fallbackPathsFromText,
        );
        if (opts?.rollbackSpeechBaseline) {
          rollbackTranscriptBaselineOnSendFailure();
        }
        const display = promptToDisplayPlain(entryPrompt);
        ignoreNextContentSyncRef.current = true;
        skipContentSyncRemainingRef.current = 3;
        lastEditorPlainRef.current = display;
        cursorRef.current = promptLength(entryPrompt);
        resetStreamAnchor();
        flushSync(() => {
          set(entryPrompt, promptLength(entryPrompt));
          setImages(dedupeComposerImages(hydrated));
        });
        if (opts?.contextItems?.length) {
          for (const item of opts.contextItems) {
            contextAdd(item);
          }
        }
        queueMicrotask(() => {
          scheduleComposerSetContent(display, () => {
            repairTiptapTrailingSpaceIfNeeded(aiChatRef.current, display);
            aiChatRef.current?.focusEditor?.("end");
            composerEscapeRootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          });
        });
      })();
    },
    [set, setImages, contextAdd, rollbackTranscriptBaselineOnSendFailure, resetStreamAnchor, scheduleComposerSetContent],
  );

  useEffect(() => {
    function handleApplyStarterPrompt(event: Event) {
      const custom = event as CustomEvent<ApplyStarterPromptDetail>;
      const targetSessionId = custom.detail?.sessionId?.trim();
      if (!targetSessionId || targetSessionId !== session.id) return;
      const attachmentPaths = custom.detail?.attachmentPaths ?? [];
      const rawMain = (custom.detail?.composerMain ?? custom.detail?.prompt ?? "").trim();
      const composerMain =
        attachmentPaths.length > 0
          ? normalizeComposerPlainMain(
              stripComposerAttachedImageSuffix(rawMain),
              true,
            )
          : rawMain;
      if (!composerMain && attachmentPaths.length === 0) return;
      if (custom.detail?.insertMode === "append" && attachmentPaths.length === 0) {
        const currentPlain = plainSurfaceRef.current?.getPlain().trim() ?? "";
        const nextPlain = currentPlain ? `${currentPlain}\n\n${composerMain}` : composerMain;
        plainSurfaceRef.current?.setPlainAndCursor(nextPlain, nextPlain.length);
        composerEscapeRootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      const entryPrompt = singleTextPrompt(composerMain);
      if (attachmentPaths.length > 0) {
        restoreComposerSurface(entryPrompt, [], { fallbackPathsFromText: attachmentPaths });
      } else {
        ignoreNextContentSyncRef.current = true;
        lastEditorPlainRef.current = composerMain;
        cursorRef.current = composerMain.length;
        set(entryPrompt, composerMain.length);
        scheduleComposerSetContent(composerMain, () => {
          repairTiptapTrailingSpaceIfNeeded(aiChatRef.current, composerMain);
          aiChatRef.current?.focusEditor?.("end");
          composerEscapeRootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      }
    }
    window.addEventListener(WORKFLOW_UI_EVENT_APPLY_STARTER_PROMPT, handleApplyStarterPrompt as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_APPLY_STARTER_PROMPT, handleApplyStarterPrompt as EventListener);
    };
  }, [session.id, set, restoreComposerSurface, scheduleComposerSetContent]);

  useEffect(() => {
    function handleAppendMonacoSelection(event: Event) {
      const custom = event as CustomEvent<ApplyMonacoSelectionToComposerDetail>;
      const targetSessionId = custom.detail?.sessionId?.trim();
      if (!targetSessionId || targetSessionId !== session.id) return;
      const relativePath = custom.detail?.relativePath?.trim() ?? "";
      const selectedText = custom.detail?.selectedText ?? "";
      if (!relativePath || !selectedText.trim()) return;

      const attrs = {
        path: relativePath,
        selectedText,
        language: custom.detail?.language?.trim() ?? "",
        startLine: custom.detail?.startLine ?? 1,
        endLine: custom.detail?.endLine ?? custom.detail?.startLine ?? 1,
        startChar: custom.detail?.startChar ?? 1,
        endChar: custom.detail?.endChar ?? 1,
      };
      scheduleInsertComposerCodeSelectionRef(aiChatRef.current, attrs, (result) => {
        if (result === "unavailable") {
          message.warning("输入区未就绪，请稍后再试");
          return;
        }
        if (result === "duplicate") {
          message.info("该代码选区已在输入框中");
          return;
        }
        syncCanSendComposer(lastEditorPlainRef.current || promptToDisplayPlain(prompt));
        queueMicrotask(() => {
          aiChatRef.current?.focusEditor?.("end");
          composerEscapeRootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      });
    }
    window.addEventListener(
      WORKFLOW_UI_EVENT_APPEND_MONACO_SELECTION_TO_COMPOSER,
      handleAppendMonacoSelection as EventListener,
    );
    return () => {
      window.removeEventListener(
        WORKFLOW_UI_EVENT_APPEND_MONACO_SELECTION_TO_COMPOSER,
        handleAppendMonacoSelection as EventListener,
      );
    };
  }, [prompt, session.id, syncCanSendComposer]);

  const lastUserMessageAttachmentPaths = useCallback((): string[] => {
    const messages = sessionRef.current.messages;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i]!;
      if (msg.role !== "user") continue;
      return extractComposerAttachmentPathsFromText(userMessagePlainTextForDisplay(msg));
    }
    return [];
  }, []);

  const restoreComposerDraft = useCallback(
    (draft: LastSentComposerDraft) => {
      restoreComposerSurface(draft.prompt, draft.images, {
        contextItems: draft.contextItems,
        rollbackSpeechBaseline: true,
        fallbackPathsFromText: lastUserMessageAttachmentPaths(),
      });
    },
    [restoreComposerSurface, lastUserMessageAttachmentPaths],
  );

  const historyIndexRef = useRef(historyIndex);
  historyIndexRef.current = historyIndex;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  const tryPromptHistoryNavigationRef = useRef<(direction: "up" | "down") => boolean>(() => false);
  tryPromptHistoryNavigationRef.current = (direction: "up" | "down"): boolean => {
    if (triggerRef.current.mode) return false;
    const surface = plainSurfaceRef.current;
    const plain = (surface?.getPlain() ?? promptToLogicalPlainString(promptRef.current)).replace(
      /\u200B/g,
      "",
    );
    const cur = surface?.getCursor() ?? cursorRef.current;
    if (!canNavigateHistoryAtCursor(cur, plain)) return false;
    if (direction === "down" && historyIndexRef.current === -1) return false;

    const attachmentFallback = lastUserMessageAttachmentPaths();

    if (direction === "up" && historyIndexRef.current === -1) {
      const snap = postSendEscUndoRef.current;
      if (snap) {
        restoreComposerSurface(snap.prompt, snap.images, {
          contextItems: snap.contextItems,
          fallbackPathsFromText: attachmentFallback,
        });
        return true;
      }
    }

    const result = navigatePromptHistory(
      direction,
      promptRef.current,
      historyIndexRef.current,
      "normal",
      imagesRef.current,
    );
    if (direction === "up") {
      if (result.savedCurrent) {
        promptHistorySavedRef.current = {
          prompt: result.savedCurrent.prompt,
          images: (result.savedCurrent.images ?? []).map((img) => ({ ...img })),
        };
      }
    } else if (result.index === -1 && promptHistorySavedRef.current) {
      const saved = promptHistorySavedRef.current;
      promptHistorySavedRef.current = null;
      restoreComposerSurface(saved.prompt, saved.images, {
        fallbackPathsFromText: attachmentFallback,
      });
      setHistoryIndex(-1);
      return true;
    }
    restoreComposerSurface(result.prompt, result.images, {
      fallbackPathsFromText: attachmentFallback,
    });
    setHistoryIndex(result.index);
    return true;
  };

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
    if (!hasComposerPayloadRef.current) {
      const snap = postSendEscUndoRef.current;
      if (snap) {
        postSendEscUndoRef.current = null;
        restoreComposerDraft(snap);
        if (isSessionBusyRef.current) {
          onCancelRef.current({ retractLastUserTurn: true });
        }
        setHistoryIndex(-1);
        return true;
      }
      if (tryPromptHistoryNavigationRef.current("up")) {
        return true;
      }
    }
    if (tryComposerTiptapUndo(aiChatRef.current)) {
      setHistoryIndex(-1);
      return true;
    }
    return false;
  };

  useEffect(() => {
    postSendEscUndoRef.current = null;
    promptHistorySavedRef.current = null;
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

  /** 编辑器聚焦时优先拦截 ↑/↓，避免 Tiptap 抢走历史恢复（输入区为空时生效）。 */
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey) return;
      if (e.key === "ArrowUp" && tryPromptHistoryNavigationRef.current("up")) {
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === "ArrowDown" && tryPromptHistoryNavigationRef.current("down")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    shell.addEventListener("keydown", onKeyDown, { capture: true });
    return () => shell.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [session.id]);

  const handleSend = useCallback(
    async (plainFromEditor?: string) => {
      if (composerSendInFlightRef.current) return;
      composerSendInFlightRef.current = true;
      try {
      clearSpeechIdleAutoSendTimer();
      debouncedPromptSyncRef.current.flush();
      const effectivePlain =
        plainFromEditor !== undefined
          ? plainFromEditor
          : lastEditorPlainRef.current || promptToDisplayPlain(prompt);
      const codeSelectionRefs = extractComposerCodeSelectionRefs(aiChatRef.current?.getEditor?.());
      const expandedPlain = expandComposerCodeSelectionRefs(effectivePlain, codeSelectionRefs);
      const promptSnap: Prompt = singleTextPrompt(expandedPlain);
      const logicalSnap = normalizeComposerPlainMain(
        promptToLogicalPlainString(promptSnap),
        images.length > 0,
      );
      const contextSnap = contextItems.map((c) => ({ ...c }));
      const imagesSnap = dedupeComposerImages(images.map((img) => ({ ...img })));
      const hasSnapPayload =
        logicalSnap.trim().length > 0 ||
        imagesSnap.length > 0 ||
        contextSnap.length > 0 ||
        codeSelectionRefs.length > 0;
      if (!hasSnapPayload) return;

      const historyPrompt =
        imagesSnap.length > 0 ? singleTextPrompt(logicalSnap) : promptSnap;
      const rollbackDraft: LastSentComposerDraft = {
        prompt: historyPrompt.map((part) => ({ ...part })),
        images: imagesSnap.map((img) => ({ ...img })),
        contextItems: contextSnap.map((c) => ({ ...c })),
      };

      /** 先清空输入区，再 await 构建 outbound（图片落盘等），避免主线程长时间被占导致「点了没反应」 */
      const clearComposerSurfaceSync = (sentPlain?: string) => {
        onComposerInputClearedForSend(sentPlain);
        debouncedPromptSyncRef.current.cancel();
        canSendComposerRef.current = false;
        setCanSendComposer(false);
        setTrigger({ mode: null, query: "", rect: null });
        ignoreNextContentSyncRef.current = true;
        lastEditorPlainRef.current = "";
        cursorRef.current = 0;
        flushSync(() => {
          reset();
          setImages([]);
        });
        scheduleComposerSetContent("");
        queueMicrotask(() => aiChatRef.current?.focusEditor?.("end"));
        void clearPromptContextSessionKey(draftBucketKey);
      };

      if (isSessionBusy) {
        if (!onEnqueueAsPendingTask) {
          return;
        }
        const sendFlowNodes: Array<{ label: string; timestamp: number; detail?: string }> = [];
        sendFlowNodes.push({
          label: "执行中入队",
          timestamp: Date.now(),
          detail: "会话占用中，本则消息仅加入待执行队列。",
        });
        clearComposerSurfaceSync(logicalSnap.trim());
        let outbound: string;
        let userBubblePrompt: string;
        try {
          const payload = await buildClaudeComposerSendPayload({
            prompt: promptSnap,
            contextItems: contextSnap,
            images: imagesSnap,
            repositoryPath: session.repositoryPath,
            userBubbleMain: logicalSnap,
          });
          outbound = payload.outbound;
          userBubblePrompt = payload.userBubblePrompt;
          rollbackDraft.images = attachDiskPathsToComposerImages(
            imagesSnap,
            payload.imageDiskPaths,
          ).map((img) => ({ ...img }));
        } catch {
          restoreComposerDraft(rollbackDraft);
          return;
        }
        sendFlowNodes.push({
          label: "构建发送消息",
          timestamp: Date.now(),
          detail: outbound.trim() || "(空)",
        });
        if (!outbound.trim()) {
          restoreComposerDraft(rollbackDraft);
          return;
        }

        const execPlanBusy = parseExecutionEnvironmentDispatch(logicalSnap);
        if (execPlanBusy && onDispatchExecutionEnvironment) {
          onTrackSendFlow?.({
            sessionId: session.id,
            composerText: logicalSnap.trim(),
            outboundText: execPlanBusy.cleanedPrompt,
            nodes: [
              ...sendFlowNodes,
              {
                label: "执行环境派发",
                timestamp: Date.now(),
                detail: `${SESSION_EXECUTION_ENGINE_LABELS[execPlanBusy.executionEngine].short} · 并发 ${execPlanBusy.sessionCount} 路`,
              },
            ],
          });
          recordMissionMessage(logicalSnap);
          postSendEscUndoRef.current = rollbackDraft;
          finalizeTranscriptBaselineAfterSend();
          void onDispatchExecutionEnvironment({
            prompt: logicalSnap,
            userBubblePrompt,
          });
          return;
        }

        addToHistory(historyPrompt, "normal", undefined, rollbackDraft.images);
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

        // 主会话占用时：终端/团队仍立即派发，各自独立执行体不入主会话 FIFO。
        if (target.targetType === "employee" || target.targetType === "team") {
          sendFlowNodes.push({
            label: "主会话占用中立即派发",
            timestamp: Date.now(),
            detail:
              target.targetType === "employee"
                ? `员工独立会话: ${target.targetEmployeeName?.trim() || target.executorLabel}`
                : `团队流程: ${target.targetWorkflowName?.trim() || target.executorLabel}`,
          });
          onTrackSendFlow?.({
            sessionId: session.id,
            composerText: logicalSnap.trim(),
            outboundText: dispatchPromptText,
            nodes: sendFlowNodes,
          });
          recordMissionMessage(logicalSnap);
          postSendEscUndoRef.current = rollbackDraft;
          finalizeTranscriptBaselineAfterSend();
          onExecute(
            session.id,
            dispatchPromptText,
            undefined,
            {
              targetType: target.targetType,
              targetEmployeeName: target.targetEmployeeName,
              targetWorkflowId: target.targetWorkflowId,
              targetWorkflowName: target.targetWorkflowName,
            },
            { userBubblePrompt },
          );
          return;
        }

        const consumePending = onEnqueueAsPendingTask({
          promptText: dispatchPromptText,
          executeBubbleOptions: { userBubblePrompt },
          ...target,
        });
        sendFlowNodes.push({
          label: "加入待执行队列",
          timestamp: Date.now(),
          detail: consumePending
            ? `任务ID: ${typeof consumePending === "string" ? consumePending : consumePending.id}`
            : "未返回任务ID",
        });
        sendFlowNodes.push({
          label: "分发执行目标",
          timestamp: Date.now(),
          detail: "主会话",
        });
        onTrackSendFlow?.({
          sessionId: session.id,
          composerText: logicalSnap.trim(),
          outboundText: dispatchPromptText,
          nodes: sendFlowNodes,
        });
        recordMissionMessage(logicalSnap);
        postSendEscUndoRef.current = rollbackDraft;
        finalizeTranscriptBaselineAfterSend();
        return;
      }

      const sendFlowNodes: Array<{ label: string; timestamp: number; detail?: string }> = [];
      sendFlowNodes.push({
        label: "点击确认发送",
        timestamp: Date.now(),
        detail: "用户点击发送按钮或按下 Enter 触发发送。",
      });
      clearComposerSurfaceSync(logicalSnap.trim());

      let outbound: string;
      let userBubblePrompt: string | undefined;
      let cursorSendPayload: Awaited<ReturnType<typeof buildCursorComposerSendPayload>> | null = null;
      try {
        if (isCursorEngine && imagesSnap.length > 0) {
          cursorSendPayload = await buildCursorComposerSendPayload({
            prompt: promptSnap,
            contextItems: contextSnap,
            images: imagesSnap,
            repositoryPath: session.repositoryPath,
          });
          outbound = cursorSendPayload.outbound;
          const paths = extractComposerAttachmentPathsFromText(outbound);
          rollbackDraft.images = attachDiskPathsToComposerImages(
            imagesSnap,
            imagesSnap.map((_, i) => paths[i] ?? null),
          ).map((img) => ({ ...img }));
        } else {
          const payload = await buildClaudeComposerSendPayload({
            prompt: promptSnap,
            contextItems: contextSnap,
            images: imagesSnap,
            repositoryPath: session.repositoryPath,
            userBubbleMain: logicalSnap,
          });
          outbound = payload.outbound;
          userBubblePrompt = payload.userBubblePrompt;
          rollbackDraft.images = attachDiskPathsToComposerImages(
            imagesSnap,
            payload.imageDiskPaths,
          ).map((img) => ({ ...img }));
        }
        lastSentDraftRef.current = rollbackDraft;
      } catch {
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
        const draft = lastSentDraftRef.current;
        lastSentDraftRef.current = null;
        if (draft) restoreComposerDraft(draft);
        return;
      }

      const execPlanIdle = parseExecutionEnvironmentDispatch(logicalSnap);
      if (execPlanIdle && onDispatchExecutionEnvironment) {
        sendFlowNodes.push({
          label: "执行环境派发",
          timestamp: Date.now(),
          detail: `${SESSION_EXECUTION_ENGINE_LABELS[execPlanIdle.executionEngine].short} · 并发 ${execPlanIdle.sessionCount} 路`,
        });
        onTrackSendFlow?.({
          sessionId: session.id,
          composerText: logicalSnap.trim(),
          outboundText: execPlanIdle.cleanedPrompt,
          nodes: sendFlowNodes,
        });
        recordMissionMessage(logicalSnap);
        lastSentDraftRef.current = null;
        postSendEscUndoRef.current = rollbackDraft;
        finalizeTranscriptBaselineAfterSend();
        void onDispatchExecutionEnvironment({
          prompt: logicalSnap,
          userBubblePrompt,
        });
        return;
      }

      addToHistory(historyPrompt, "normal", undefined, rollbackDraft.images);
      setHistoryIndex(-1);

      let consumePending: string | PendingExecutionTask | undefined;
      let dispatchPromptText = outbound;
      let dispatchTargetForExecute: {
        targetType: "main" | "employee" | "team";
        targetEmployeeName?: string;
        targetWorkflowId?: string;
        targetWorkflowName?: string;
      } = { targetType: "main" };
      const inferredTargetEarly = inferPendingQueueTargetFromPrompt(
        promptSnap,
        modelDisplayLabel,
        employeesForDispatchRoute,
      );
      const fallbackTargetEarly = resolveTextMentionTarget(
        logicalSnap,
        employeeMentions,
        teamMentions,
      );
      const resolvedDispatchTarget =
        inferredTargetEarly.targetType === "main" && fallbackTargetEarly
          ? {
              ...inferredTargetEarly,
              ...fallbackTargetEarly,
            }
          : inferredTargetEarly;
      dispatchTargetForExecute = {
        targetType: resolvedDispatchTarget.targetType,
        targetEmployeeName: resolvedDispatchTarget.targetEmployeeName,
        targetWorkflowId: resolvedDispatchTarget.targetWorkflowId,
        targetWorkflowName: resolvedDispatchTarget.targetWorkflowName,
      };
      dispatchPromptText =
        stripDispatchMentions(
          outbound,
          resolvedDispatchTarget.targetType,
          employeeMentions,
          teamMentions,
        ) || outbound;

      let executeOptions: ClaudeComposerExecuteBubbleOptions | undefined;
      if (cursorSendPayload?.cursorAttachments.length) {
        executeOptions = { cursorAttachments: cursorSendPayload.cursorAttachments };
      } else if (userBubblePrompt) {
        executeOptions = { userBubblePrompt };
      }

      // @终端 / @团队 立即派发，不与其他执行体共用 FIFO（避免主会话排队阻塞终端/工作流）。
      const bypassPendingQueueForIndependentExecutor =
        resolvedDispatchTarget.targetType === "employee" ||
        resolvedDispatchTarget.targetType === "team";

      if (onEnqueueAsPendingTask && !bypassPendingQueueForIndependentExecutor) {
        const target = resolvedDispatchTarget;
        consumePending = onEnqueueAsPendingTask({
          promptText: dispatchPromptText,
          executeBubbleOptions: executeOptions,
          ...target,
        });
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
          finalizeTranscriptBaselineAfterSend();
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
      finalizeTranscriptBaselineAfterSend();
      onExecute(session.id, dispatchPromptText, consumePending, dispatchTargetForExecute, executeOptions);
      } finally {
        composerSendInFlightRef.current = false;
      }
    },
    [
      isSessionBusy,
      prompt,
      contextItems,
      images,
      session,
      setImages,
      onDispatchExecutionEnvironment,
      onEnqueueAsPendingTask,
      pendingExecutionTaskCount,
      isCursorEngine,
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
      clearSpeechIdleAutoSendTimer,
      onComposerInputClearedForSend,
      finalizeTranscriptBaselineAfterSend,
    ],
  );

  handleSendRef.current = handleSend;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.shiftKey) return;
      if (e.key === "ArrowUp" && tryPromptHistoryNavigationRef.current("up")) {
        e.preventDefault();
      } else if (e.key === "ArrowDown" && tryPromptHistoryNavigationRef.current("down")) {
        e.preventDefault();
      }
    },
    [],
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

  const composerCommonPhraseBindingsRef = useRef(composerCommonPhraseBindings);
  composerCommonPhraseBindingsRef.current = composerCommonPhraseBindings;
  const atMentionShortcutBindingsRef = useRef(atMentionShortcutBindings);
  atMentionShortcutBindingsRef.current = atMentionShortcutBindings;

  /** 可配置的 @ 提及插入 / 常用语发送快捷键（输入框聚焦时）。 */
  useEffect(() => {
    function onComposerShortcutKey(e: KeyboardEvent) {
      if (!isWiseAppFocused()) return;
      if (triggerRef.current.mode) return;
      const shell = shellRef.current;
      if (!shell || !isProseMirrorFocused(shell)) return;

      const phraseBindings = composerCommonPhraseBindingsRef.current;
      for (const binding of phraseBindings) {
        if (!chordMatchesKeyboardEvent(binding.chord, e)) continue;
        e.preventDefault();
        e.stopPropagation();
        if (binding.action === "insert") {
          const surface = plainSurfaceRef.current;
          if (surface) {
            applyComposerCommonPhraseToSurface(surface, binding);
          }
        } else {
          void handleSendRef.current(binding.text);
        }
        return;
      }

      const atBindings = atMentionShortcutBindingsRef.current;
      for (const binding of atBindings) {
        if (!chordMatchesKeyboardEvent(binding.chord, e)) continue;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    window.addEventListener("keydown", onComposerShortcutKey, { capture: true });
    return () => window.removeEventListener("keydown", onComposerShortcutKey, { capture: true });
  }, [session.id]);

  const applyComposerCommonPhrase = useCallback((phrase: ComposerCommonPhrase) => {
    if (resolveComposerCommonPhraseAction(phrase) === "insert") {
      const surface = plainSurfaceRef.current;
      if (!surface) return;
      applyComposerCommonPhraseToSurface(surface, phrase);
      return;
    }
    void handleSendRef.current(phrase.text);
  }, []);

  useEffect(() => {
    function handleApplyCommonPhrase(event: Event) {
      const custom = event as CustomEvent<ApplyComposerCommonPhraseDetail>;
      const targetSessionId = custom.detail?.sessionId?.trim();
      if (!targetSessionId || targetSessionId !== session.id) return;
      const phrase = custom.detail?.phrase;
      if (!phrase?.text) return;
      applyComposerCommonPhrase(phrase);
    }
    window.addEventListener(
      WISE_UI_EVENT_APPLY_COMPOSER_COMMON_PHRASE,
      handleApplyCommonPhrase as EventListener,
    );
    return () => {
      window.removeEventListener(
        WISE_UI_EVENT_APPLY_COMPOSER_COMMON_PHRASE,
        handleApplyCommonPhrase as EventListener,
      );
    };
  }, [applyComposerCommonPhrase, session.id]);

  useEffect(() => {
    return registerGlobalAtMentionShortcutRecipient(session.id, (targetKey) => {
      const binding = atMentionShortcutBindingsRef.current.find((b) => b.targetKey === targetKey);
      if (!binding) return;
      const surface = plainSurfaceRef.current;
      if (!surface) return;
      let next = insertPlainAt(surface.getPlain(), surface.getCursor(), binding.insertionText);
      next = ensureSpaceAfterAtInsert(next.plain, next.cursor);
      surface.setPlainAndCursor(next.plain, next.cursor);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          surface.focus();
        });
      });
    });
  }, [session.id]);

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

  /** 与附件、截屏同一行，位于模型选择左侧（勿 useMemo：Popover portal + Semi focusEditor 会导致首击失效） */
  const renderBranchPickerInFooterToolbar = () => (
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
          }
        }}
        overlayClassName="app-claude-branch-popover"
        content={
          <div
            className="app-claude-branch-popover__content"
            onMouseDown={stopBranchPopoverPointerToComposer}
            onClick={stopBranchPopoverPointerToComposer}
          >
            <div className="app-claude-branch-popover__controls">
              <Input
                size="small"
                placeholder="搜索分支..."
                className="app-claude-branch-popover__search-input"
                value={branchQuery}
                onChange={(event) => setBranchQuery(event.target.value)}
              />
              <div className="app-claude-branch-popover__section-title">创建分支</div>
              <div className="app-claude-branch-popover__create-inline-row">
                <Input
                  size="small"
                  placeholder="新分支名"
                  className="app-claude-branch-popover__branch-name-input"
                  value={branchCreateName}
                  onChange={(event) => setBranchCreateName(event.target.value)}
                  onPressEnter={() => void handleCreateBranch()}
                  disabled={branchActionLoading}
                />
                <Select
                  size="small"
                  allowClear
                  placeholder="基线(可选)"
                  className="app-claude-branch-popover__from-select"
                  value={branchCreateFromRef}
                  onChange={(value) => setBranchCreateFromRef(value)}
                  options={branches.map((item) => ({ value: item.name, label: item.name }))}
                  disabled={branchActionLoading || branchListLoading}
                  showSearch
                  optionFilterProp="label"
                  popupMatchSelectWidth={false}
                  popupClassName="app-claude-branch-popover__select-dropdown"
                />
                <Button
                  size="small"
                  type="primary"
                  htmlType="button"
                  className="app-claude-branch-popover__action-btn"
                  onMouseDown={stopBranchPopoverPointerToComposer}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleCreateBranch();
                  }}
                  loading={branchActionLoading}
                >
                  新建
                </Button>
              </div>
              <Checkbox
                className="app-claude-branch-popover__no-track-option"
                checked={branchCreateNoTrack}
                onChange={(event) => setBranchCreateNoTrack(event.target.checked)}
                disabled={branchActionLoading}
              >
                不设置上游跟踪（--no-track）
              </Checkbox>
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
  );

  /** 与 Semi 底栏同一行：左侧附件 / 截屏 / 分支 */
  const renderSemiComposerConfigureArea = useCallback(() => {
    return (
      <div
        className="app-claude-semi-footer-toolbar-left"
        /* Semi AIChatInput 根节点 onClick 会对「非富文本区」调用 focusEditor()，会抢走 Select/Dropdown 的焦点；阻止冒泡到底栏外层的 Semi 容器 */
        onMouseDown={(e) => e.stopPropagation()}
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
        {speechDictation.supported ? (
          <Popover
            content={voiceSettingsPanel}
            trigger="contextMenu"
            placement="topLeft"
            open={speechMenuOpen}
            onOpenChange={setSpeechMenuOpen}
            arrow={false}
            overlayClassName="app-composer-voice-panel-popover"
          >
            <span className="app-claude-composer-voice-trigger-wrap">
            <HoverHint
              title={
                speechDictation.transcribing
                  ? speechDictation.engine === "sensevoice"
                    ? "正在 SenseVoice 转写…"
                    : "正在本地转写…"
                  : speechPolishing
                    ? "正在整理转写…"
                    : speechDictation.listening
                    ? speechPrefs.sendMode === "silenceAutoSend"
                      ? `停顿 ${silenceIdleSecondsLabel} 秒无新语音将自动发送；录音持续至点击停止${
                          composerSpeechVoiceCommandsHint(speechPrefs)
                            ? `；${composerSpeechVoiceCommandsHint(speechPrefs)}`
                            : ""
                        }`
                      : speechPrefs.sendMode === "endingWordAutoSend"
                        ? `口播「${speechPrefs.autoSendEndingText}」将自动发送；录音持续至点击停止${
                            composerSpeechVoiceCommandsHint(speechPrefs)
                              ? `；${composerSpeechVoiceCommandsHint(speechPrefs)}`
                              : ""
                          }`
                        : composerSpeechVoiceCommandsHint(speechPrefs)
                          ? `${composerSpeechStopHint(speechDictation.engine)}；${composerSpeechVoiceCommandsHint(speechPrefs)}`
                          : composerSpeechStopHint(speechDictation.engine)
                    : speechPrefs.sendMode === "silenceAutoSend"
                      ? `点击开始听写，停顿 ${silenceIdleSecondsLabel} 秒自动发送；需点击停止结束录音${
                          composerSpeechVoiceCommandsHint(speechPrefs)
                            ? `；${composerSpeechVoiceCommandsHint(speechPrefs)}`
                            : ""
                        }`
                      : speechPrefs.sendMode === "endingWordAutoSend"
                        ? `点击开始听写，口播「${speechPrefs.autoSendEndingText}」自动发送；需点击停止结束录音${
                            composerSpeechVoiceCommandsHint(speechPrefs)
                              ? `；${composerSpeechVoiceCommandsHint(speechPrefs)}`
                              : ""
                          }`
                        : composerSpeechVoiceCommandsHint(speechPrefs)
                          ? `${composerSpeechEngineHint(speechDictation.engine)}；${composerSpeechVoiceCommandsHint(speechPrefs)}；右键配置`
                          : `${composerSpeechEngineHint(speechDictation.engine)}（手动发送）；右键配置`
              }
              placement="top"
            >
              <Button
                type="text"
                size="small"
                className={
                  speechDictation.listening
                    ? "app-claude-composer-voice-btn app-claude-composer-voice-btn--active"
                    : "app-claude-composer-voice-btn"
                }
                disabled={
                  (isSessionBusy && !speechKeepAliveDuringBusy) ||
                  speechDictation.transcribing ||
                  speechPolishing
                }
                loading={speechDictation.transcribing || speechPolishing}
                aria-pressed={speechDictation.listening}
                aria-label={
                  speechDictation.transcribing
                    ? "正在转写"
                    : speechPolishing
                      ? "正在整理转写"
                      : speechDictation.listening
                      ? composerSpeechStopHint(speechDictation.engine)
                      : `开始${composerSpeechEngineHint(speechDictation.engine)}`
                }
                onClick={() => speechDictation.toggle()}
                style={{
                  color: speechDictation.listening
                    ? "var(--ant-color-error)"
                    : "var(--ant-color-text-secondary)",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                  <line x1="8" y1="22" x2="16" y2="22" />
                </svg>
              </Button>
            </HoverHint>
            </span>
          </Popover>
        ) : null}
        {dualPaneRepositoryPicker ? (
          <TreeSelect
            size="small"
            variant="borderless"
            className="app-claude-dual-pane-repo-picker"
            popupClassName="app-claude-dual-pane-repo-picker-dropdown"
            popupMatchSelectWidth={false}
            showSearch
            treeNodeFilterProp="title"
            title="右侧执行会话目标（工作区 / 仓库）"
            aria-label="选择工作区或仓库"
            value={dualPaneRepositoryPicker.valueKey}
            treeData={(() => {
              const repositories = dualPaneRepositoryPicker.repositories ?? [];
              const projects = dualPaneRepositoryPicker.projects ?? [];
              if (!projects.length) {
                return repositories.map((repo) => ({
                  title: repo.name || repo.path,
                  value: `repo:${repo.id}`,
                }));
              }
              const repoById = new Map(repositories.map((repo) => [repo.id, repo] as const));
              const assignedRepoIds = new Set<number>();
              const tree: Array<{
                title: string;
                value: string;
                selectable?: boolean;
                children?: Array<{ title: string; value: string }>;
              }> = [];
              for (const project of projects) {
                const children: Array<{ title: string; value: string }> = [];
                for (const repoId of project.repositoryIds ?? []) {
                  const repo = repoById.get(repoId);
                  if (!repo) continue;
                  children.push({ title: repo.name || repo.path, value: `repo:${repo.id}` });
                  assignedRepoIds.add(repo.id);
                }
                tree.push({
                  title: project.name || "未命名工作区",
                  value: `project:${project.id}`,
                  selectable: true,
                  children,
                });
              }
              const standalone = repositories
                .filter((repo) => !assignedRepoIds.has(repo.id))
                .map((repo) => ({ title: repo.name || repo.path, value: `repo:${repo.id}` }));
              if (standalone.length > 0) {
                tree.push({
                  title: "独立仓库",
                  value: "__standalone__",
                  selectable: false,
                  children: standalone,
                });
              }
              return tree;
            })()}
            onChange={(value) => {
              const raw = String(value ?? "");
              if (raw.startsWith("repo:")) {
                dualPaneRepositoryPicker.onSelectRepositoryId(Number(raw.slice(5)));
                return;
              }
              if (raw.startsWith("project:")) {
                dualPaneRepositoryPicker.onSelectProjectId?.(raw.slice(8));
              }
            }}
            placeholder="工作区 / 仓库"
          />
        ) : null}
        {renderBranchPickerInFooterToolbar()}
        <ContextCompactProgressRing
          className="app-claude-semi-footer-compact-context"
          data-ui-anchor="session-context-ring-btn"
          percent={bottomStatus.ctxPercent}
          toneClassName={bottomStatus.ctxToneClass}
          ctxStatusLine={bottomStatus.ctxSegment}
          breakdown={breakdown}
          breakdownLoading={contextBreakdownLoading}
          onBreakdownOpen={() => void ensureBreakdown()}
        />
      </div>
    );
  }, [
    bottomStatus.ctxPercent,
    bottomStatus.ctxSegment,
    bottomStatus.ctxToneClass,
    activeBranch,
    branchActionLoading,
    branchCreateFromRef,
    branchCreateName,
    branchCreateNoTrack,
    branchListLoading,
    branchPopoverOpen,
    branchQuery,
    branches,
    filteredBranches,
    handleCheckoutBranch,
    handleCreateBranch,
    localBranches,
    remoteBranches,
    stopBranchPopoverPointerToComposer,
    breakdown,
    contextBreakdownLoading,
    dualPaneRepositoryPicker,
    ensureBreakdown,
    handleFileAttach,
    handleScreenshot,
    isSessionBusy,
    speechDictation.engine,
    speechDictation.listening,
    speechDictation.supported,
    speechDictation.toggle,
    speechDictation.transcribing,
    speechKeepAliveDuringBusy,
    speechMenuOpen,
    speechPolishing,
    speechPrefs.autoSendEndingText,
    speechPrefs.sendMode,
    voiceSettingsPanel,
  ]);

  /** 与 Semi 底栏同一行：结束（占用中）+ 模型选择 + 发送（Semi 在 generating 时会拦截发送，故用独立结束 + generating=false） */
  const renderSemiComposerActionArea = useCallback(
    ({ menuItem, className }: { menuItem: React.ReactNode[]; className: string }) => (
      <div
        className={`${className} app-claude-semi-footer-toolbar-right`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {isSessionBusy ? (
          <HoverHint title="结束当前运行" placement="top">
            <Button
              type="text"
              size="small"
              className="app-claude-semi-footer-stop-btn"
              aria-label="结束当前运行"
              onClick={() => _onCancel()}
            >
              结束
            </Button>
          </HoverHint>
        ) : null}
        <ComposerCommonPhrasesManageTrigger
          phrases={composerCommonPhrases}
          loading={composerCommonPhrasesLoading}
          saving={composerCommonPhrasesSaving}
          onPersist={persistComposerCommonPhrases}
        />
        <ComposerRuntimeSettingsTrigger
          engine={sessionExecutionEngine}
          codexAvailable={codexAvailable}
          cursorAvailable={cursorAvailable}
          disabled={isSessionBusy}
          onEngineChange={onSessionExecutionEngineChange}
          onOpenExecutionEnvironment={onOpenExecutionEnvironment}
          connectionKind={session.connectionKind}
          defaultConnectionKind={defaultConnectionKind}
          onConnectionKindChange={onSessionConnectionKindChange}
        />
        <ComposerModelPicker
          session={session}
          sessionExecutionEngine={sessionExecutionEngine}
          model={model}
          onModelChange={handleComposerModelChange}
          disabled={isSessionBusy}
        />
        {menuItem}
      </div>
    ),
    [
      isSessionBusy,
      _onCancel,
      session.connectionKind,
      defaultConnectionKind,
      onSessionConnectionKindChange,
      sessionExecutionEngine,
      codexAvailable,
      cursorAvailable,
      onSessionExecutionEngineChange,
      onOpenExecutionEnvironment,
      handleComposerModelChange,
      session,
      sessionExecutionEngine,
      model,
      composerCommonPhrases,
      composerCommonPhrasesLoading,
      composerCommonPhrasesSaving,
      persistComposerCommonPhrases,
    ],
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

  const handleTodoToggle = useCallback(
    (id: string) => {
      onToggleTodo?.(id);
    },
    [onToggleTodo],
  );

  const showQuestionChrome = Boolean(useAggregatedQuestionDock || questionRequest);
  const showPermissionChrome = Boolean(permissionRequest);

  return (
    <div
      ref={composerEscapeRootRef}
      className={`app-claude-composer${showQuestionChrome ? " app-claude-composer--pending-question" : ""}${showPermissionChrome ? " app-claude-composer--pending-permission" : ""}`}
      data-wise-composer-root=""
      data-session-id={session.id}
      onFocusCapture={() => noteComposerScreenshotFocus(session.id)}
      onPointerDownCapture={() => noteComposerScreenshotFocus(session.id)}
      onKeyDown={handleKeyDown}
    >
      {/* Docks above editor：同仓库多路 AskUserQuestion 时 Tabs 嵌在题卡顶栏（原「待你确认」行） */}
      {useAggregatedQuestionDock && activeQuestionDockTab ? (
        <div style={{ padding: "0 6px" }}>
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
                    items={dockTabs.map((tab) => {
                      const claudeTitle = buildClaudeSessionHoverTitle({
                        id: tab.ownerSessionId,
                        claudeSessionId: tab.claudeSessionId,
                      });
                      const timePart = tab.tabSubtitle ? `\n出题时间：${tab.tabSubtitle}` : "";
                      return {
                      key: tab.tabKey,
                      label: (
                        <span
                          className="app-claude-question-tab-label"
                          title={`${tab.tabTitle}\n${claudeTitle}${timePart}`}
                        >
                          <span className="app-claude-question-tab-title">{tab.tabTitle}</span>
                        </span>
                      ),
                    };
                    })}
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
        <div style={{ padding: "0 6px" }}>
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
        <div style={{ padding: "0 6px" }}>
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
          <TodoDock items={todos} onToggle={handleTodoToggle} onClose={onClearTodos} />

          {/* Revert dock */}
          <RevertDock items={revertItems} onRestore={onRestoreRevert} onClose={onClearRevertItems} />

          {/* Image thumbnails */}
          <ImageThumbnails images={images} onRemove={removeImage} onReplace={replaceImage} />

          {/* Context items (file chips) */}
          <ContextItems items={contextItems} />

          {/* Semi AIChatInput（替换原 contentEditable app-claude-editor） */}
          <SemiConfigProvider locale={semiLocaleZhCN}>
            <div ref={shellRef} className="app-claude-semi-chat-input-wrap" style={{ width: "100%" }}>
              <SlashPopover
                surfaceRef={plainSurfaceRef}
                trigger={trigger}
                onDismiss={() => setTrigger({ mode: null, query: "", rect: null })}
                onSelect={() => {}}
                repositoryPath={session.repositoryPath}
                employeeOptions={employeeMentions}
                teamOptions={teamMentions}
                projectRoleTagOptions={projectRoleTagOptions}
                projectRepositoryMentionOptions={projectRepositoryMentionOptions}
                hideEmployeesInAtMode={hideEmployeesInAtMode}
                codexAvailable={codexAvailable}
                cursorAvailable={cursorAvailable}
                atMentionDefaultTarget={atMentionDefaultTarget}
                onAtMentionDefaultTargetChange={(next) => void saveAtMentionDefaultTarget(next)}
              />
              {semiEditorReady ? (
                <AIChatInput
                  ref={aiChatRef}
                  extensions={SEMI_COMPOSER_TOKEN_HIGHLIGHT_EXTENSIONS}
                  placeholder="@ 终端/工作流/文件，/ 命令，Enter 发送，Shift+Enter 换行，↑/Esc 恢复上条"
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
                  canSend={canSendComposer}
                  onMessageSend={(msg) => {
                    const plain = contentsToPlain((msg.inputContents ?? []) as Content[]);
                    void handleSendRef.current(plain);
                  }}
                  onContentChange={applySemiContentChange}
                  style={{ width: "100%" }}
                />
              ) : (
                <div
                  className="app-claude-semi-chat-input-mount-placeholder"
                  aria-busy="true"
                  aria-label="输入区初始化"
                />
              )}
            </div>
          </SemiConfigProvider>
        </div>

        {/* Bottom bar：会话元信息（分支已移至输入框底栏截屏按钮后） */}
        <div className="app-claude-input-bottom-bar">
          <span className="app-claude-input-bottom-statusline" title={bottomStatus.fullLine}>
            session:{bottomStatus.sessionDuration} |{" "}
            <span className={bottomStatus.ctxToneClass}>{bottomStatus.ctxSegment}</span> | status:
            {bottomStatus.statusText}
          </span>
        </div>
      </div>

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
  onSessionConnectionKindChange?: (kind: ClaudeSessionConnectionKind) => void;
  sessionExecutionEngine?: SessionExecutionEngine;
  codexAvailable?: boolean;
  cursorAvailable?: boolean;
  onSessionExecutionEngineChange?: (engine: SessionExecutionEngine) => void;
  onOpenExecutionEnvironment?: () => void;
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
  onToggleTodo?: (todoId: string) => void;
  onSendFollowup: (id: string) => void;
  onClearFollowups?: () => void;
  onRestoreRevert: (id: string) => void;
  onClearRevertItems?: () => void;
  /** 发送前写入待执行队列；队列为空且会话空闲时返回新任务行供 onExecute 同 tick 出队，队列非空时仅入队尾由上层按序派发 */
  onDispatchExecutionEnvironment?: (input: {
    prompt: string;
    userBubblePrompt?: string;
  }) => void | Promise<void>;
  onEnqueueAsPendingTask?: (payload: {
    promptText: string;
    executorLabel: string;
    targetType: "main" | "employee" | "team";
    targetEmployeeName?: string;
    targetWorkflowId?: string;
    targetWorkflowName?: string;
    executeBubbleOptions?: ClaudeComposerExecuteBubbleOptions;
  }) => PendingExecutionTask;
  employeeMentions?: Array<{ id: string; name: string }>;
  teamMentions?: Array<{ id: string; name: string }>;
  projectRoleTagOptions?: ReadonlyArray<import("../../utils/projectRoleTagOptions").RoleTagOption>;
  projectRepositoryMentionOptions?: ReadonlyArray<
    import("../../utils/projectRoleTagOptions").RepositoryMentionOption
  >;
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
  const mentionIndex = (value: string): number => {
    const name = value.trim();
    if (!name) return -1;
    const matches: number[] = [];
    for (const prefix of ["@", "＠"]) {
      let from = 0;
      while (from < normalized.length) {
        const idx = normalized.indexOf(`${prefix}${name}`, from);
        if (idx < 0) break;
        const tail = normalized[idx + prefix.length + name.length] ?? "";
        if (!tail || !/[\p{L}\p{N}_-]/u.test(tail)) {
          matches.push(idx);
        }
        from = idx + prefix.length + name.length;
      }
    }
    if (matches.length === 0) return -1;
    return Math.min(...matches);
  };
  let employeeMatch: { name: string; index: number } | undefined;
  for (const item of employees) {
    const name = item.name.trim();
    if (!name) continue;
    if (isOmcMonitorDispatchMentionName(name)) continue;
    const idx = mentionIndex(name);
    if (idx < 0) continue;
    if (
      !employeeMatch ||
      idx < employeeMatch.index ||
      (idx === employeeMatch.index && name.length > employeeMatch.name.length)
    ) {
      employeeMatch = { name, index: idx };
    }
  }
  let teamMatch: { id: string; name: string; index: number } | undefined;
  for (const item of teams) {
    const name = item.name.trim();
    if (!name) continue;
    const idx = mentionIndex(name);
    if (idx < 0) continue;
    if (
      !teamMatch ||
      idx < teamMatch.index ||
      (idx === teamMatch.index && name.length > teamMatch.name.length)
    ) {
      teamMatch = { id: item.id, name, index: idx };
    }
  }
  const genericTeamMentionIndex = Math.max(normalized.indexOf("@团队"), normalized.indexOf("＠团队"));
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
