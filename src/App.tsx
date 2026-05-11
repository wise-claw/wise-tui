import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import DOMPurify from "dompurify";
import { CloseOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, ConfigProvider, Drawer, Layout, message, Modal, Spin, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import type {
  ClaudeComposerExecuteBubbleOptions,
  ClaudeSession,
  EmployeeItem,
  EmployeeTaskCountItem,
  MonitorDrawerTarget,
  PendingExecutionTask,
  ProjectItem,
  Repository,
  TaskMode,
  WorkflowGraph,
  WorkflowGraphNode,
  WorkflowGraphNodeType,
  WorkflowRuntimeStepSnapshot,
  WorkflowTaskEventItem,
  WorkflowTaskItem,
  WorkflowTemplateItem,
} from "./types";
import { sortWorkflowRuntimeSnapshotsChronological } from "./utils/sortWorkflowRuntimeSnapshots";
import { repositoryFolderBasename, repositoryTypeChineseLabel } from "./utils/repositoryType";
import { useRepositoryList } from "./hooks/useRepositoryList";
import { useClaudeSessions, type ClaudeTurnCompletePayload } from "./hooks/useClaudeSessions";
import { openInFinder } from "./services/repository";
import { base64ToArrayBuffer, joinRepositoryAbsolutePath } from "./utils/repositoryPreviewBinary";
import { RepositoryImagePreview } from "./components/RepositoryImagePreview";
import { LeftSidebar } from "./components/LeftSidebar";
import { ClaudeSessions } from "./components/ClaudeSessions";
import { McpHub } from "./components/McpHub";
import { SkillsHub } from "./components/SkillsHub";
import { CommandPalette } from "./components/CommandPalette";
import type { PromptsOpenContext } from "./components/PromptsPanel";
import {
  adjustMainWindowLogicalWidthByDelta,
  expandMainWindowByDualPaneCenterDelta,
  measureMainLayoutContentWidthPx,
  readMainWindowInnerSize,
  restoreMainWindowInnerSnapshot,
  setMainWindowLogicalInnerSize,
  shrinkMainWindowByDualPaneDelta,
  shrinkMainWindowToRemoveHorizontalSlack,
  waitLayoutFrames,
} from "./services/mainWindowLayout";
import { reloadAppWindow } from "./services/window";
import { wiseMascotShow } from "./services/wiseMascot";
import { getTaskTemplate, setTaskTemplate } from "./services/projectState";
import { ensureCrepeToolbarTitleHintsInstalled } from "./utils/crepeToolbarTitles";
import { MainLayoutResizeHandle } from "./components/MainLayoutResizeHandle";
import { usePersistedMainLayoutSiderWidths } from "./hooks/usePersistedMainLayoutSiderWidths";

/** 小窗口模式：主窗口 inner 固定逻辑尺寸。 */
const COMPACT_LAYOUT_WINDOW_WIDTH_PX = 700;
const COMPACT_LAYOUT_WINDOW_HEIGHT_PX = 600;
import {
  WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED,
  WORKFLOW_UI_EVENT_INVOCATION_STREAM,
  WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED,
  WORKFLOW_UI_EVENT_OPEN_BACKGROUND_INVOCATION_DRAWER,
  WORKFLOW_UI_EVENT_OPEN_TASK_SPLIT_PANEL,
  type BackgroundInvocationBundleChangedDetail,
  type OpenBackgroundInvocationDrawerDetail,
  type WorkflowInvocationStreamDetail,
  type WorkflowOmcBatchRuntimeDetail,
} from "./constants/workflowUiEvents";
import {
  WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_SUBMITTED,
  WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_UNRESOLVED,
} from "./constants/workflowEvents";
import { listEmployeeTaskCounts, listEmployees, createEmployee, updateEmployee, deleteEmployee, moveEmployeeDisplayOrder } from "./services/employees";
import { deleteWorkflowTemplate, listWorkflowTemplates, saveWorkflowTemplate } from "./services/workflowTemplates";
import { getWorkflowGraph, saveWorkflowGraph, validateWorkflowGraph } from "./services/workflowGraphs";
import { EmployeeConfigModal } from "./components/EmployeeConfigModal";
import { ProgressMonitorDrawer } from "./components/ProgressMonitorDrawer";
import {
  appendTaskEvent,
  createWorkflowTask,
  decideWorkflowTaskStage,
  endWorkflowTask,
  listTaskEvents,
  listTaskPendingEmployees,
  listWorkflowTasks,
  migrateWorkflowSessionTabReferences,
} from "./services/workflowTasks";
import { cancelClaudeInvocation, listClaudeSubagents } from "./services/claude";
import { notificationHub } from "./notifications";
import { useMonitorOverview } from "./hooks/useMonitorOverview";
import { useIntervalSyncedState } from "./hooks/useIntervalSyncedState";
import { useScheduledClaudeTaskRunner } from "./hooks/useScheduledClaudeTaskRunner";
import { MONITOR_SESSIONS_SYNC_INTERVAL_MS } from "./constants/monitorUi";
import { invalidateWorkflowRunCacheForRepository } from "./hooks/useWorkflowRun";
import {
  readProjectRelativeFile,
  readProjectRelativeFileBase64,
  writeProjectRelativeFile,
} from "./services/materializePrdSnapshot";
import { gitShowRevision } from "./services/git";
import { deleteAppSetting, getAppSetting, setAppSetting } from "./services/appSettingsStore";
import { migratePromptContextSessionKey } from "./components/ClaudeChatInput/prompt-context";
import {
  clampConcurrencyLimit,
  claudeConcurrencyScopeKey,
  getConcurrencyLimitForScope,
  loadClaudeConcurrencyLimits,
  saveClaudeConcurrencyLimits,
  type ClaudeConcurrencyLimitsMap,
} from "./services/claudeConcurrencyLimits";
import { getClaudeSpawnSlotCount } from "./services/claudeSpawnSlots";
import {
  countRunningClaudeSessionsInProjectRepository,
  evaluateBeforeSpawnClaudeCode,
  resolveClaudeConcurrencyInvokeContext,
} from "./utils/claudeConcurrencyGate";
import { pickSessionForRepositorySidebarSelect } from "./utils/claudeSessionSelection";
import {
  isOmcBatchHistoryStubSessionId,
  clearPersistedOmcBatchHistory,
  parseOmcBatchHistoryStubAnchorSessionId,
} from "./utils/omcEmployeeBatchHistory";
import {
  extractRepositoryBoundEmployeeName,
  isOmcMonitorEmployeeRecord,
  omcWorkerRepositoryBoundNameMatchers,
  resolveConfiguredOmcEmployee,
} from "./utils/omcMonitorEmployeeSession";
import { isOmcDirectBatchInvocationRunning } from "./utils/omcDirectBatchInvocationDisplay";
import { resetOmcDirectBatchInvocationsStore, setOmcDirectBatchInvocationsStore } from "./stores/omcDirectBatchInvocationsStore";
import {
  cancelOmcDirectBatchInvocationsPersistSchedule,
  clearOmcDirectBatchInvocationsPersisted,
  digestOmcDirectBatchInvocationsList,
  loadOmcDirectBatchInvocationsFromLocalStorageSync,
  loadOmcDirectBatchInvocationsPersisted,
  schedulePersistOmcDirectBatchInvocations,
  sortOmcDirectBatchInvocationsForStore,
  flushPersistOmcDirectBatchInvocations,
} from "./services/omcDirectBatchInvocationsPersistence";
import {
  readInvocationSnapshotBundle,
  reconcileDirectBatchInvocationRowsWithBundles,
} from "./services/backgroundInvocationSnapshot";
import {
  isRepositoryMainSessionTab,
  normalizeRepositoryPathKey as normalizeRepositoryPathForMatch,
  parseRepositoryMainSessionBindings,
  REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY,
  resolveBoundMainSessionId,
} from "./utils/repositoryMainSessionBinding";
import { extractBoundEmployeeNameFromDisplay, loadSessionOwnerHints } from "./utils/sessionOwnerHints";
import { extractLatestAssistantPlainText, mergeAssistantPlainTextPreferLonger } from "./services/claudeSessionState";
import { WISE_DINGTALK_AUTOMATION_V1_EVENT } from "./constants/dingtalkWiseAutomation";
import { isWiseDingTalkAutomationV1Payload, sendDingTalkWiseAutomationReplyMarkdown } from "./services/dingtalkWiseAutomation";
import { resolveRepositoryForDingTalkAutomation } from "./utils/resolveRepositoryForDingTalkAutomation";
import {
  detectDingTalkAutomationQuickCommand,
  formatRepositoriesMarkdownForDingTalk,
} from "./utils/dingTalkAutomationQuickCommands";
import { buildDingTalkAutomationExecutePrompt } from "./utils/dingTalkAutomationInboundPrompt";
import { resolveDingTalkAutomationAssistantBody } from "./services/dingTalkAutomationReplyBody";
import { stripAssistantStreamNoiseForDingTalkExport } from "./utils/dingTalkOutboundAssistantText";
import {
  parseAcceptanceVerdictPayload,
  resolveAcceptanceVerdictWithGate,
  type AcceptanceDecision,
} from "./services/workflow/acceptanceVerdict";
import {
  advanceWorkflowGraph,
  composeDispatchInput,
  createWorkflowRuntimeState,
  resolveWorkflowDispatchNodeType,
  type WorkflowGraphRuntimeState,
} from "./services/workflowGraphRuntime";
import "./App.css";
import type { GitPanelOpenFileOptions } from "./components/GitPanel";
import { GitDiffMonacoPane } from "./components/GitDiffMonacoPane";

interface FileEditorTab {
  relativePath: string;
  content: string;
  originalContent: string;
  loading: boolean;
  /** 存在时以 Monaco diff 展示（左侧基线） */
  diffOriginal?: string;
  /** 来自 Git 变更列表时标记；`staged` 为只读对比 */
  gitDiffSection?: "staged" | "unstaged";
}

const MonacoEditor = lazy(() => import("@monaco-editor/react"));
const RightPanel = lazy(() => import("./components/RightPanel").then((module) => ({ default: module.RightPanel })));
const PrdTaskSplitPanel = lazy(() =>
  import("./components/PrdTaskSplitPanel").then((module) => ({ default: module.PrdTaskSplitPanel })),
);
const PromptsPanel = lazy(() => import("./components/PromptsPanel").then((module) => ({ default: module.PromptsPanel })));
const WorkflowConfigModal = lazy(() =>
  import("./components/WorkflowConfigModal").then((module) => ({ default: module.WorkflowConfigModal })),
);

const DEFAULT_REPOSITORY_SPLIT_TEMPLATE =
  "请先把需求拆分为可执行的子任务清单，再逐步推进。\n仓库：{repoName}\n类型：{repoType}\n地址：{repoPath}\n\n输出格式：\n1) 任务拆分\n2) 执行顺序\n3) 风险与依赖";

const DEFAULT_PROJECT_SPLIT_TEMPLATE =
  "这是一个跨仓库任务，请先进行任务拆分。\n\n项目：{projectName}\n仓库地址列表：\n{repoList}\n\n请输出：\n1) 子任务清单（按仓库归类）\n2) 执行顺序\n3) 每步产物与验证方式";
const LEGACY_APP_SETTING_KEY_REPOSITORY_SPLIT_TEMPLATE = "wise.taskTemplate.repositorySplit";
const LEGACY_APP_SETTING_KEY_PROJECT_SPLIT_TEMPLATE = "wise.taskTemplate.projectSplit";
const WORKFLOW_VERDICT_MODE_STORAGE_KEY = "wise.workflow.verdict.mode";
type WorkflowVerdictMode = "heuristic" | "structured_only" | "structured_plus_extractor";
const DEFAULT_WORKFLOW_VERDICT_MODE: WorkflowVerdictMode = "structured_plus_extractor";
const MONACO_SUPPORTED_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "log",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "py",
  "sh",
  "bash",
  "zsh",
  "json",
  "jsonc",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "xml",
  "svg",
  "sql",
  "css",
  "less",
  "scss",
  "html",
  "vue",
  "rs",
  "go",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "cc",
  "hpp",
  "cs",
  "php",
  "rb",
  "pl",
  "r",
]);

function toUiErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // ignore JSON serialization failures
    }
  }
  return "未知错误";
}
const MONACO_SUPPORTED_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  ".gitignore",
  ".gitattributes",
  ".npmrc",
  ".editorconfig",
  ".env",
  ".env.example",
  "readme",
  "license",
  "changelog",
]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);

function applyTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => variables[key] ?? "");
}

function makePreviewText(text: string, maxLen = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(空)";
  }
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen)}...`;
}

/** 快照中的「派发拼接」输入：保留换行与原文，不截断、不压扁空白 */
function snapshotWorkflowDispatchInput(text: string): string {
  const t = text.trim();
  return t || "(空)";
}

/** 与 dispatchTeamStepToEmployeeSession 内一致：员工会话实际 executeSession 收到的正文 */
function buildTeamWorkerExecutePrompt(dispatchInput: string, agentType: string | undefined): string {
  const normalizedDispatchInput = dispatchInput.trim();
  let autoPrompt = [...(normalizedDispatchInput ? ["", normalizedDispatchInput] : [])]
    .filter((line, index, lines) => {
      if (line.trim().length > 0) return true;
      const prev = lines[index - 1];
      return Boolean(prev && prev.trim().length > 0);
    })
    .join("\n");
  const trimmedAgent = agentType?.trim();
  if (trimmedAgent && !autoPrompt.trimStart().startsWith("/")) {
    autoPrompt = `/${trimmedAgent}\n${autoPrompt}`;
  }
  return autoPrompt;
}

function resolveTeamDispatchTargetEmployee(
  dispatch: { employeeId?: string; employeeName: string },
  employees: EmployeeItem[],
  pendingEmployees: Array<{ employeeId: string; name: string }>,
): EmployeeItem | undefined {
  const targetEmployeeId = dispatch.employeeId?.trim();
  const targetEmployeeName = dispatch.employeeName.trim();
  let targetEmployee = targetEmployeeId
    ? employees.find((item) => item.id === targetEmployeeId)
    : employees.find((item) => item.name.trim() === targetEmployeeName);
  if (!targetEmployee && pendingEmployees.length === 1) {
    targetEmployee = employees.find((item) => item.id === pendingEmployees[0]!.employeeId);
  }
  if (!targetEmployee && targetEmployeeName) {
    const pendingByName = pendingEmployees.find((item) => item.name.trim() === targetEmployeeName);
    if (pendingByName) {
      targetEmployee = employees.find((item) => item.id === pendingByName.employeeId);
    }
  }
  return targetEmployee;
}

/** 阶段执行记录「输入 Claude Code」：与真实下发员工会话的拼接正文一致（含 /agent 前缀） */
function snapshotTeamWorkerExecuteInput(
  dispatch: { employeeId?: string; employeeName: string; input: string },
  employees: EmployeeItem[],
  pendingEmployees: Array<{ employeeId: string; name: string }>,
): string {
  const emp = resolveTeamDispatchTargetEmployee(dispatch, employees, pendingEmployees);
  return snapshotWorkflowDispatchInput(buildTeamWorkerExecutePrompt(dispatch.input, emp?.agentType));
}

/** 派发步骤的会话返回：保留换行，仅过长时截断（避免 makePreviewText 压扁空白与 180 字误导读感） */
function snapshotWorkflowAssistantOutput(text: string, maxLen = 12000): string {
  const t = text.trim();
  if (!t) return "(空)";
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}\n\n…(已截断，共 ${t.length} 字符)`;
}

function orderedExecutableNodes(graph: WorkflowGraph): WorkflowGraphNode[] {
  return graph.nodes
    .filter((node) => node.type === "task" || node.type === "approval")
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
}

function isWorkflowTraceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("wise.workflow.trace") === "1";
  } catch {
    return false;
  }
}

function logWorkflowTrace(step: string, payload: Record<string, unknown>) {
  if (!isWorkflowTraceEnabled()) return;
  console.debug(`[wise-workflow-trace] ${step}`, payload);
}

function hashShortText(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return hashShortText(input);
  }
  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function eventHasCorrelationId(event: WorkflowTaskEventItem, correlationId: string): boolean {
  if (!event.payloadJson) return false;
  try {
    const payload = JSON.parse(event.payloadJson) as { correlationId?: unknown };
    return typeof payload.correlationId === "string" && payload.correlationId === correlationId;
  } catch {
    return false;
  }
}

function getPathName(path: string): string {
  return path.split("/").pop()?.toLowerCase() ?? "";
}

function getPathExt(path: string): string {
  const fileName = getPathName(path);
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return "";
  }
  return fileName.slice(lastDot + 1);
}

function isImageFilePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(getPathExt(path));
}

function mimeTypeForImagePath(path: string): string {
  const ext = getPathExt(path);
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function isPdfFilePath(path: string): boolean {
  return getPathExt(path) === "pdf";
}

function isDocxFilePath(path: string): boolean {
  return getPathExt(path) === "docx";
}

function isLegacyDocFilePath(path: string): boolean {
  return getPathExt(path) === "doc";
}

function isRepositoryBinaryPreviewPath(path: string): boolean {
  return (
    isImageFilePath(path) ||
    isPdfFilePath(path) ||
    isDocxFilePath(path) ||
    isLegacyDocFilePath(path)
  );
}

type RepositoryBinaryPreviewState =
  | { kind: "image"; relativePath: string; src: string }
  | { kind: "pdf"; relativePath: string; blobUrl: string }
  | { kind: "docx"; relativePath: string; html: string }
  | { kind: "doc"; relativePath: string; absolutePath: string };

function isMonacoSupportedFilePath(path: string): boolean {
  const fileName = getPathName(path);
  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return true;
  }
  if (MONACO_SUPPORTED_FILENAMES.has(fileName)) {
    return true;
  }
  const ext = getPathExt(path);
  return ext.length > 0 && MONACO_SUPPORTED_EXTENSIONS.has(ext);
}

function extractRuntimeSnapshotsFromEvents(events: WorkflowTaskEventItem[]): WorkflowRuntimeStepSnapshot[] {
  const snapshots: WorkflowRuntimeStepSnapshot[] = [];
  const updates: Array<{ snapshotId: string; outputPreview: string }> = [];
  const sortedEvents = [...events].sort((a, b) => a.createdAt - b.createdAt);
  for (const event of sortedEvents) {
    if (!event.payloadJson) {
      continue;
    }
    try {
      if (event.eventType === "workflow_runtime_snapshot") {
        const payload = JSON.parse(event.payloadJson) as { snapshot?: WorkflowRuntimeStepSnapshot };
        if (payload.snapshot) {
          snapshots.push(payload.snapshot);
        }
        continue;
      }
      if (event.eventType === "workflow_runtime_snapshot_update") {
        const payload = JSON.parse(event.payloadJson) as { snapshotId?: string; outputPreview?: string };
        if (payload.snapshotId && typeof payload.outputPreview === "string") {
          updates.push({ snapshotId: payload.snapshotId, outputPreview: payload.outputPreview });
        }
      }
    } catch {
      // ignore malformed runtime payload
    }
  }
  if (updates.length > 0) {
    const snapshotById = new Map(snapshots.map((item) => [item.id, item] as const));
    for (const update of updates) {
      const snapshot = snapshotById.get(update.snapshotId);
      if (!snapshot) {
        continue;
      }
      snapshot.outputPreview = update.outputPreview;
    }
  }
  return sortWorkflowRuntimeSnapshotsChronological(snapshots);
}

function lastUserPlainText(session: ClaudeSession | undefined): string {
  if (!session) {
    return "";
  }
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role !== "user") {
      continue;
    }
    const fromParts = (msg.parts ?? [])
      .filter(
        (part): part is { type: "text"; text: string } =>
          part.type === "text" && typeof (part as { text?: string }).text === "string" && (part as { text: string }).text.trim().length > 0,
      )
      .map((part) => part.text.trim())
      .join("\n\n");
    if (fromParts.trim()) {
      return fromParts.trim();
    }
    if (msg.content.trim()) {
      return msg.content.trim();
    }
    return "";
  }
  return "";
}

function lastUserMessageIsTeamAutoDriver(session: ClaudeSession | undefined): boolean {
  const t = lastUserPlainText(session).trimStart();
  if (!t) {
    return false;
  }
  return (
    t.startsWith("# 团队流程自动执行") ||
    t.startsWith("# 团队流程自动流转") ||
    t.startsWith("# 工作流自动执行") ||
    t.startsWith("# 工作流自动流转")
  );
}

function candidateInProgressTasksForSession(
  session: ClaudeSession | undefined,
  tasks: WorkflowTaskItem[],
): WorkflowTaskItem[] {
  if (!session) {
    return [];
  }
  return tasks.filter(
    (t) =>
      t.status === "in_progress" &&
      (t.creator === session.id || (session.claudeSessionId != null && t.creator === session.claudeSessionId)),
  );
}

function extractBoundEmployeeNameFromSessionRepositoryName(repositoryName: string | undefined): string | null {
  return extractRepositoryBoundEmployeeName(repositoryName);
}

// ── App ──

export default function App() {
  const [taskSplitMode, setTaskSplitMode] = useState(false);
  const [promptsMode, setPromptsMode] = useState(false);
  /** 左栏 MCP：在主区+右栏之上叠层展示（与技能目录相同，不盖左栏）。 */
  const [mcpHubMode, setMcpHubMode] = useState(false);
  /** 左栏技能：在主区+右栏之上叠层展示 skills.sh（不盖左栏，非全屏居中 Modal）。 */
  const [skillsHubMode, setSkillsHubMode] = useState(false);
  const [promptsOpenContext, setPromptsOpenContext] = useState<PromptsOpenContext | null>(null);
  const [repositorySplitTemplate, setRepositorySplitTemplate] = useState("");
  const [projectSplitTemplate, setProjectSplitTemplate] = useState("");
  const [dark, _setDark] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  /** 收起右栏并将主窗口设为 700×600；再次点击或从中栏「展开右侧面板」退出并恢复进入前的窗口尺寸。 */
  const [compactLayoutMode, setCompactLayoutMode] = useState(false);
  const compactLayoutSnapshotRef = useRef<{ width: number; height: number } | null>(null);
  const compactLayoutModeRef = useRef(false);
  compactLayoutModeRef.current = compactLayoutMode;
  const effectiveRightCollapsed = useMemo(
    () => compactLayoutMode || rightCollapsed,
    [compactLayoutMode, rightCollapsed],
  );
  const {
    leftWidthPx: mainLayoutLeftWidthPx,
    rightWidthPx: mainLayoutRightWidthPx,
    setLeftWidthPx: setMainLayoutLeftWidthPx,
    setRightWidthPx: setMainLayoutRightWidthPx,
  } = usePersistedMainLayoutSiderWidths({
    leftCollapsed: collapsed,
    rightCollapsed: effectiveRightCollapsed,
  });
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const [dualPaneEnabled, setDualPaneEnabled] = useState(false);
  const [dualPaneSecondarySessionId, setDualPaneSecondarySessionId] = useState<string | null>(null);
  /** null：右侧仓库随侧栏当前仓库；非 null：右侧主会话固定到该仓库 id */
  const [dualPaneSecondaryRepositoryId, setDualPaneSecondaryRepositoryId] = useState<number | null>(null);
  /** 进入双栏前的主窗口 inner 尺寸；若未记录到「中栏增量」则关闭时仍用快照恢复窗口。 */
  const dualWindowInnerSnapshotRef = useRef<{ width: number; height: number } | null>(null);
  /** 进入双栏前主内容区逻辑宽度，用于计算窗口应增加的逻辑像素（与 `window.innerWidth` 同单位）。 */
  const dualPaneCenterLogicalBeforeRef = useRef<number | null>(null);
  /** 开启双栏时加在视口逻辑宽度上的增量（与 `window.innerWidth` 同单位），关闭双栏时减去同一值。 */
  const dualPaneWindowDeltaLogicalRef = useRef<number | null>(null);
  /** 当前「双栏已开启」这一档内是否已做过加宽；切换右侧仓库只改 session id 时不应再次调窗口。 */
  const dualPaneWindowExpandConsumedRef = useRef(false);
  const mainLayoutContentRef = useRef<HTMLElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [employeeConfigOpen, setEmployeeConfigOpen] = useState(false);
  const [employeeConfigDefaultRepositoryIds, setEmployeeConfigDefaultRepositoryIds] = useState<number[]>([]);
  const [employeeAgentTypeOptions, setEmployeeAgentTypeOptions] = useState<string[]>(["executor"]);
  const [workflowConfigOpen, setWorkflowConfigOpen] = useState(false);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [monitorDrawerTarget, setMonitorDrawerTarget] = useState<MonitorDrawerTarget | null>(null);
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [employeeTaskCounts, setEmployeeTaskCounts] = useState<EmployeeTaskCountItem[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateItem[]>([]);
  const [workflowTasks, setWorkflowTasks] = useState<WorkflowTaskItem[]>([]);
  const [workflowTaskEventsByTaskId, setWorkflowTaskEventsByTaskId] = useState<Record<string, WorkflowTaskEventItem[]>>({});
  const [taskPendingEmployeesByTaskId, setTaskPendingEmployeesByTaskId] = useState<Record<string, Array<{ employeeId: string; name: string }>>>({});
  const [workflowRuntimeStateByTaskId, setWorkflowRuntimeStateByTaskId] = useState<Record<string, WorkflowGraphRuntimeState>>({});
  const [workflowRuntimeSnapshotsByTaskId, setWorkflowRuntimeSnapshotsByTaskId] = useState<Record<string, WorkflowRuntimeStepSnapshot[]>>({});
  /** 供团队自动推进异步回调读取最新状态，避免驳回回退后闭包内 task 阶段索引滞后误判「未推进」而提前 return。 */
  const workflowTasksRef = useRef(workflowTasks);
  workflowTasksRef.current = workflowTasks;
  const taskPendingEmployeesByTaskIdRef = useRef(taskPendingEmployeesByTaskId);
  taskPendingEmployeesByTaskIdRef.current = taskPendingEmployeesByTaskId;
  const workflowRuntimeStateByTaskIdRef = useRef(workflowRuntimeStateByTaskId);
  workflowRuntimeStateByTaskIdRef.current = workflowRuntimeStateByTaskId;
  const workflowTaskEventsByTaskIdRef = useRef(workflowTaskEventsByTaskId);
  workflowTaskEventsByTaskIdRef.current = workflowTaskEventsByTaskId;
  const workflowRuntimeSnapshotsByTaskIdRef = useRef(workflowRuntimeSnapshotsByTaskId);
  workflowRuntimeSnapshotsByTaskIdRef.current = workflowRuntimeSnapshotsByTaskId;
  const [workflowGraphsByWorkflowId, setWorkflowGraphsByWorkflowId] = useState<Record<string, WorkflowGraph>>({});
  const [workflowGraphStatusByWorkflowId, setWorkflowGraphStatusByWorkflowId] = useState<Record<string, string>>({});
  const [omcBatchRuntime, setOmcBatchRuntime] = useState<WorkflowOmcBatchRuntimeDetail | null>(null);
  const omcBatchRuntimeRef = useRef<WorkflowOmcBatchRuntimeDetail | null>(null);
  omcBatchRuntimeRef.current = omcBatchRuntime;
  const omcDirectBatchInvocationRef = useRef<Map<string, WorkflowInvocationStreamDetail>>(new Map());
  /** 已收到批量 `active:false`，但直连 invocation 的 `complete` 尚未排空 ref；此期间侧栏 OMC 员工应保持「进行中」 */
  const omcDirectBatchEndPendingRef = useRef(false);
  /** 直连批量 invocation 进度事件极密：debounce；列表经 store 下发，避免 App setState 整树重渲 */
  const omcDirectBatchProgressUiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const omcInvocationRuntimeRef = useRef<Map<string, WorkflowInvocationStreamDetail>>(new Map());
  /** 合并高频 progress，避免并行 OMC 时整树反复 setOmcBatchRuntime 卡死主线程 */
  const omcInvocationRuntimeApplyRafRef = useRef<number | null>(null);
  /** 后台 invocation 摘要条所挂载的锚点会话 + 仓库路径（与 `BackgroundInvocationDock` 一致），供侧栏「执行详情」打开同一抽屉 */
  const omcUiAnchorRef = useRef<{ sessionId: string; repositoryPath: string } | null>(null);
  /** 与侧栏「结束」共用同一份实现，供监控抽屉内结束 OMC 复用。 */
  const handleStopEmployeeMonitorRef = useRef<(employeeId: string) => void>(() => {});
  const [workflowVerdictMode, setWorkflowVerdictMode] = useState<WorkflowVerdictMode>(DEFAULT_WORKFLOW_VERDICT_MODE);
  const [fileEditorTabs, setFileEditorTabs] = useState<FileEditorTab[]>([]);
  const [fileEditorActivePath, setFileEditorActivePath] = useState<string | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const fileEditorTabsRef = useRef<FileEditorTab[]>([]);
  fileEditorTabsRef.current = fileEditorTabs;
  const editorVisible = fileEditorTabs.length > 0;
  /** 右侧文件树：图片 / PDF / Word 等二进制预览（Modal，不占中栏编辑器） */
  const [repositoryBinaryPreview, setRepositoryBinaryPreview] = useState<RepositoryBinaryPreviewState | null>(null);

  const monacoLanguageFromPath = useCallback((path: string | null): string => {
    if (!path) return "plaintext";
    const fileName = path.split("/").pop()?.toLowerCase() ?? "";
    if (fileName === ".env" || fileName.startsWith(".env.")) {
      return "plaintext";
    }
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (["dockerfile", "makefile"].includes(fileName)) {
      return fileName === "dockerfile" ? "dockerfile" : "makefile";
    }
    if (["md", "markdown"].includes(ext)) return "markdown";
    if (["js", "mjs", "cjs", "jsx"].includes(ext)) return "javascript";
    if (["ts", "mts", "cts", "tsx"].includes(ext)) return "typescript";
    if (ext === "py") return "python";
    if (["sh", "bash", "zsh"].includes(ext)) return "shell";
    if (["json", "jsonc"].includes(ext)) return "json";
    if (["yml", "yaml"].includes(ext)) return "yaml";
    if (["toml"].includes(ext)) return "toml";
    if (["ini", "cfg", "conf"].includes(ext)) return "ini";
    if (ext === "xml" || ext === "svg") return "xml";
    if (ext === "sql") return "sql";
    if (["css", "less", "scss"].includes(ext)) return "css";
    if (ext === "html") return "html";
    if (ext === "vue") return "html";
    if (ext === "rs") return "rust";
    if (ext === "go") return "go";
    return "plaintext";
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = (await getAppSetting(WORKFLOW_VERDICT_MODE_STORAGE_KEY))?.trim();
        if (cancelled || !raw) return;
        if (raw === "heuristic" || raw === "structured_only" || raw === "structured_plus_extractor") {
          setWorkflowVerdictMode(raw);
        }
      } catch {
        // ignore setting read errors, keep default mode
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    repositories,
    projects,
    activeProjectId,
    activeRepositoryId,
    loading: repositoryListLoading,
    setActiveRepositoryId,
    setActiveProjectId,
    selectProjectAndRepository,
    handleCreateProject,
    handleUpdateProject,
    handleDeleteProject,
    handleAddRepositoryToProject,
    handleAddRepositoryPathToProject,
    handleDetachRepositoryFromProject,
    handleReorderRepositoriesInProject,
    handleMoveRepositoryToProject,
    pinnedProjectIds,
    togglePinProject,
  } = useRepositoryList();

  const [repositoryMainSessionBindings, setRepositoryMainSessionBindings] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await getAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY);
        if (cancelled) return;
        const fromDisk = parseRepositoryMainSessionBindings(raw);
        setRepositoryMainSessionBindings((current) => ({ ...fromDisk, ...current }));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bindRepositoryMainSession = useCallback((repositoryPath: string, sessionId: string) => {
    const key = normalizeRepositoryPathForMatch(repositoryPath);
    setRepositoryMainSessionBindings((prev) => {
      if (prev[key] === sessionId) return prev;
      const next = { ...prev, [key]: sessionId };
      void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const migrateRepositoryMainSessionBindingTabIds = useCallback((fromTabId: string, toClaudeSessionId: string) => {
    setRepositoryMainSessionBindings((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(prev)) {
        if (v === fromTabId) {
          next[k] = toClaudeSessionId;
          changed = true;
        }
      }
      if (!changed) return prev;
      void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const [claudeConcurrencyLimitsMap, setClaudeConcurrencyLimitsMap] = useState<ClaudeConcurrencyLimitsMap>({});
  /** Rust `spawn_slots_by_scope` 占用数（含无 UI 的批量 OMC）；`null` 表示尚未拉取或非桌面环境 */
  const [rustSpawnSlotOccupied, setRustSpawnSlotOccupied] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadClaudeConcurrencyLimits();
        if (!cancelled) {
          setClaudeConcurrencyLimitsMap(loaded);
        }
      } catch {
        if (!cancelled) {
          setClaudeConcurrencyLimitsMap({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const beforeSpawnClaudeRef = useRef<
    ((session: ClaudeSession) => { ok: true } | { ok: false; message: string }) | null
  >(null);

  const claudeConcurrencyInvokeContextRef = useRef<
    ((session: ClaudeSession) => { concurrencyScopeKey: string; concurrencyLimit: number } | null) | null
  >(null);

  const advanceTeamAfterTurnRef = useRef<(p: ClaudeTurnCompletePayload) => void>(() => {});

  const employeeSessionIdByKeyRef = useRef<Map<string, string>>(new Map());
  /** 同一仓库+员工并发多次「创建员工会话」时复用单次 createSession，避免竞态导致失败或重复标签 */
  const employeeSessionCreateByKeyRef = useRef<Map<string, Promise<string>>>(new Map());
  /** 钉钉自动化 v1：向 `dingTalkUserId` 回发 Markdown；`uxMessageKey` 用于 Ant Design 全局 loading（结束时销毁）；正文仅在 Claude 回合结束后发送一次 */
  const dingTalkAutomationPendingRef = useRef(
    new Map<
      string,
      {
        dingTalkUserId: string;
        uxMessageKey: string;
        /** 入站队列中本条 Claude 任务 id，用于在回合结束/清 pending 时 `resolve` 队列中的 `await` */
        dingTalkInboundJobId?: string;
      }
    >(),
  );
  /** 钉钉入站：等「本条」Claude 回合结束（或清 pending）后再处理下一条 `WISE_DINGTALK_AUTOMATION_V1_EVENT` */
  const dingTalkAutomationInboundJobResolversRef = useRef(new Map<string, () => void>());

  function clearDingTalkAutomationPendingAndResolveInboundJob(tabKey: string) {
    const pending = dingTalkAutomationPendingRef.current.get(tabKey);
    if (!pending) {
      return;
    }
    const jobId = pending.dingTalkInboundJobId;
    dingTalkAutomationPendingRef.current.delete(tabKey);
    if (jobId) {
      const resolve = dingTalkAutomationInboundJobResolversRef.current.get(jobId);
      if (resolve) {
        dingTalkAutomationInboundJobResolversRef.current.delete(jobId);
        resolve();
      }
    }
  }
  /** 在 `sessionsLatestRef` 就绪后每帧赋值：DB 迁移 workflow 会话引用 + 刷新任务列表（见 `handleSessionTabIdMigrated`）。 */
  const postSessionTabMigrationRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});

  const handleSessionTabIdMigrated = useCallback(
    (fromTabId: string, toClaudeSessionId: string) => {
      setDualPaneSecondarySessionId((prev) => (prev === fromTabId ? toClaudeSessionId : prev));
      migrateRepositoryMainSessionBindingTabIds(fromTabId, toClaudeSessionId);
      void migratePromptContextSessionKey(fromTabId, toClaudeSessionId);
      // 员工 worker 标签在首条 stream-json init 后 id 会合并为 Claude session_id；须同步缓存，否则第二次 @ 仍指向已失效的临时 id
      const empMap = employeeSessionIdByKeyRef.current;
      for (const [k, v] of [...empMap.entries()]) {
        if (v === fromTabId) {
          empMap.set(k, toClaudeSessionId);
        }
      }
      const anchor = omcUiAnchorRef.current;
      if (anchor?.sessionId === fromTabId) {
        omcUiAnchorRef.current = { ...anchor, sessionId: toClaudeSessionId };
      }
      const dtPending = dingTalkAutomationPendingRef.current.get(fromTabId);
      if (dtPending) {
        dingTalkAutomationPendingRef.current.delete(fromTabId);
        dingTalkAutomationPendingRef.current.set(toClaudeSessionId, dtPending);
      }
      const invMap = omcInvocationRuntimeRef.current;
      for (const [key, detail] of [...invMap.entries()]) {
        if (detail.sessionId === fromTabId) {
          invMap.set(key, { ...detail, sessionId: toClaudeSessionId });
        }
      }
      postSessionTabMigrationRef.current(fromTabId, toClaudeSessionId);
    },
    [migrateRepositoryMainSessionBindingTabIds],
  );
  const workflowTaskByWorkerSessionRef = useRef<Map<string, string>>(new Map());
  const acceptanceCompletionGuardRef = useRef<Set<string>>(new Set());

  const {
    sessions,
    activeSessionId,
    createSession,
    updateSessionModel,
    executeSession,
    appendSystemMessage,
    appendUserMessage,
    closeSession,
    switchSession,
    cancelSession,
    respondToQuestion,
    dismissQuestion,
    respondToPermission,
    clearTodos,
    clearFollowups,
    clearRevertItems,
    sendFollowup,
    restoreRevert,
    refreshDiskSessionsForRepository,
    tabsHydrated,
    reloadFullDiskTranscript,
  } = useClaudeSessions({
    onClaudeTurnComplete: (p) => {
      advanceTeamAfterTurnRef.current(p);
    },
    beforeSpawnClaudeRef,
    claudeConcurrencyInvokeContextRef,
    onClaudeSpawnBlocked: (blockedMessage) => {
      message.warning(blockedMessage);
    },
    companionSessionId: dualPaneEnabled ? dualPaneSecondarySessionId : null,
    onSessionTabIdMigrated: handleSessionTabIdMigrated,
  });

  const sessionsLatestRef = useRef(sessions);
  sessionsLatestRef.current = sessions;

  const repositoriesLatestRef = useRef(repositories);
  repositoriesLatestRef.current = repositories;

  const projectsLatestRef = useRef(projects);
  projectsLatestRef.current = projects;

  const activeProjectIdLatestRef = useRef(activeProjectId);
  activeProjectIdLatestRef.current = activeProjectId;

  const activeRepositoryIdLatestRef = useRef(activeRepositoryId);
  activeRepositoryIdLatestRef.current = activeRepositoryId;

  const repositoryMainBindingsLatestRef = useRef(repositoryMainSessionBindings);
  repositoryMainBindingsLatestRef.current = repositoryMainSessionBindings;

  const executeSessionRef = useRef(executeSession);
  executeSessionRef.current = executeSession;

  const employeesLatestRef = useRef(employees);
  employeesLatestRef.current = employees;

  const handleComposerExecuteRef = useRef(handleComposerExecute);
  handleComposerExecuteRef.current = handleComposerExecute;

  useScheduledClaudeTaskRunner({
    repositoriesRef: repositoriesLatestRef,
    sessionsRef: sessionsLatestRef,
    bindingsRef: repositoryMainBindingsLatestRef,
    employeesRef: employeesLatestRef,
    executeRef: handleComposerExecuteRef,
  });

  /** 监控侧栏 / Drawer 用：与主会话流式更新解耦，避免 `useMonitorOverview` 等巨型 memo 同频重算卡死主线程 */
  const sessionsSyncedForMonitorUi = useIntervalSyncedState(
    sessions,
    MONITOR_SESSIONS_SYNC_INTERVAL_MS,
    sessions.length,
  );

  const monitorPanelSessionsMerged = sessionsSyncedForMonitorUi;

  useEffect(() => {
    clearPersistedOmcBatchHistory();
  }, []);

  postSessionTabMigrationRef.current = (fromTabId, toClaudeSessionId) => {
    const repoPath =
      sessionsLatestRef.current.find((s) => s.id === toClaudeSessionId)?.repositoryPath?.trim() ?? "";
    void (async () => {
      try {
        await migrateWorkflowSessionTabReferences({ fromTabId, toSessionId: toClaudeSessionId });
      } catch (error) {
        console.error("migrate_workflow_session_tab_references failed:", error);
      }
      if (repoPath) {
        invalidateWorkflowRunCacheForRepository(repoPath);
      }
      try {
        const tasks = await listWorkflowTasks(toClaudeSessionId);
        setWorkflowTasks((prev) => {
          const untouched = prev.filter((t) => t.creator !== toClaudeSessionId && t.creator !== fromTabId);
          return [...untouched, ...tasks];
        });
        const eventEntries = await Promise.all(
          tasks.slice(0, 8).map(async (task) => [task.id, await listTaskEvents(task.id)] as const),
        );
        const pendingEntries = await Promise.all(
          tasks.slice(0, 8).map(async (task) => [task.id, await listTaskPendingEmployees(task.id)] as const),
        );
        setWorkflowTaskEventsByTaskId((prev) => {
          const next = { ...prev };
          for (const [taskId, events] of eventEntries) {
            next[taskId] = events;
          }
          return next;
        });
        setWorkflowRuntimeSnapshotsByTaskId((prev) => {
          const next = { ...prev };
          for (const [taskId, events] of eventEntries) {
            next[taskId] = extractRuntimeSnapshotsFromEvents(events);
          }
          return next;
        });
        setTaskPendingEmployeesByTaskId((prev) => {
          const next = { ...prev };
          for (const [taskId, employees] of pendingEntries) {
            next[taskId] = employees;
          }
          return next;
        });
      } catch (error) {
        console.error("Reload workflow tasks after session tab id migration failed:", error);
      }
    })();
  };

  const handleCloseSession = useCallback(
    (sessionId: string) => {
      const session = sessionsLatestRef.current.find((s) => s.id === sessionId);
      if (session?.repositoryPath) {
        const key = normalizeRepositoryPathForMatch(session.repositoryPath);
        setRepositoryMainSessionBindings((prev) => {
          if (prev[key] !== sessionId) return prev;
          const next = { ...prev };
          delete next[key];
          void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
      }
      closeSession(sessionId);
    },
    [closeSession],
  );
  const activeSessionIdLatestRef = useRef(activeSessionId);
  activeSessionIdLatestRef.current = activeSessionId;

  /** 与 ClaudeSessions 内 handleSwitchToSession 对齐：先同步项目+仓库再切会话，否则 activeSession 会因 path 不一致为空。 */
  const jumpToSessionWithRepository = useCallback(
    (sessionId: string) => {
      const sid = sessionId.trim();
      if (!sid) return;
      if (isOmcBatchHistoryStubSessionId(sid)) {
        const anchor = parseOmcBatchHistoryStubAnchorSessionId(sid);
        if (anchor) {
          void message.info("此为批量 OMC 历史占位标签，正在跳转到发起该批次的主会话。");
          jumpToSessionWithRepository(anchor);
        }
        return;
      }
      const target = sessionsLatestRef.current.find((item) => item.id === sid || item.claudeSessionId === sid);
      const canonicalId = target?.id ?? sid;
      const currentActive = activeSessionIdLatestRef.current?.trim() ?? "";
      if (canonicalId === currentActive) {
        return;
      }
      if (!target?.repositoryPath) {
        switchSession(canonicalId);
        return;
      }
      const wantPath = normalizeRepositoryPathForMatch(target.repositoryPath);
      const repo = repositories.find((item) => normalizeRepositoryPathForMatch(item.path) === wantPath);
      if (repo) {
        const ownerProject = projects.find((p) => p.repositoryIds.includes(repo.id));
        flushSync(() => {
          if (ownerProject) {
            selectProjectAndRepository(ownerProject.id, repo.id);
          } else {
            setActiveRepositoryId(repo.id);
          }
        });
      }
      switchSession(canonicalId);
    },
    [projects, repositories, selectProjectAndRepository, setActiveRepositoryId, switchSession],
  );

  const jumpToSessionWithRepositoryRef = useRef(jumpToSessionWithRepository);
  jumpToSessionWithRepositoryRef.current = jumpToSessionWithRepository;

  const bindRepositoryMainSessionRef = useRef(bindRepositoryMainSession);
  bindRepositoryMainSessionRef.current = bindRepositoryMainSession;

  const createSessionRef = useRef(createSession);
  createSessionRef.current = createSession;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const dingTalkAutomationInboundQueue: unknown[] = [];
    let dingTalkAutomationInboundTail: Promise<void> = Promise.resolve();

    function enqueueDingTalkAutomationInbound(raw: unknown) {
      dingTalkAutomationInboundQueue.push(raw);
      dingTalkAutomationInboundTail = dingTalkAutomationInboundTail.then(async () => {
        if (cancelled) {
          return;
        }
        while (dingTalkAutomationInboundQueue.length > 0) {
          const item = dingTalkAutomationInboundQueue.shift();
          if (item === undefined) {
            break;
          }
          try {
            await handleDingTalkAutomationInbound(item);
          } catch (err) {
            console.error("DingTalk automation inbound queue handler failed:", err);
          }
          if (cancelled) {
            return;
          }
        }
      });
    }

    async function handleDingTalkAutomationInbound(raw: unknown) {
      if (!isWiseDingTalkAutomationV1Payload(raw)) return;
      const { dingTalkUserId, repositoryName, prompt, imageDataUrls } = raw;
      const promptText = (prompt ?? "").trim();
      const hasImages = (imageDataUrls?.length ?? 0) > 0;
      if (!dingTalkUserId.trim() || (!promptText && !hasImages)) return;

      const uxMessageKey =
        typeof globalThis.crypto?.randomUUID === "function"
          ? `wise-dingtalk-ux-${globalThis.crypto.randomUUID()}`
          : `wise-dingtalk-ux-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      void message.open({
        key: uxMessageKey,
        type: "loading",
        content: "正在接收钉钉消息…",
        duration: 0,
      });

      const quick = detectDingTalkAutomationQuickCommand(promptText, repositoryName ?? null);

      if (quick.kind === "list_repositories") {
        message.destroy(uxMessageKey);
        const md = formatRepositoriesMarkdownForDingTalk(
          repositoriesLatestRef.current,
          projectsLatestRef.current,
        );
        try {
          await sendDingTalkWiseAutomationReplyMarkdown(dingTalkUserId.trim(), md, "仓库列表");
          void message.success({ content: "钉钉：已返回仓库列表", duration: 2.5 });
        } catch (err) {
          console.error("DingTalk automation list repos reply failed:", err);
          void message.error(err instanceof Error ? err.message : "回发钉钉失败");
        }
        return;
      }

      if (quick.kind === "switch_repository") {
        if (!quick.repoFilter.trim()) {
          message.destroy(uxMessageKey);
          try {
            await sendDingTalkWiseAutomationReplyMarkdown(
              dingTalkUserId.trim(),
              "切换仓库失败：请写出仓库名，例如：`切换仓库 my-repo`，或在首行写「切换仓库」、次行写仓库名，或在入站 JSON 中填写 `repositoryName`。",
              "Wise",
            );
          } catch (err) {
            console.error("DingTalk automation switch repo hint reply failed:", err);
            void message.error(err instanceof Error ? err.message : "回发钉钉失败");
          }
          void message.warning("切换仓库：未指定目标仓库");
          return;
        }
        const switchResolve = resolveRepositoryForDingTalkAutomation({
          repositories: repositoriesLatestRef.current,
          projects: projectsLatestRef.current,
          activeProjectId: activeProjectIdLatestRef.current,
          activeRepositoryId: activeRepositoryIdLatestRef.current,
          repositoryNameFilter: quick.repoFilter,
          resolveScope: "all_projects",
        });
        if (!switchResolve.repository) {
          message.destroy(uxMessageKey);
          try {
            await sendDingTalkWiseAutomationReplyMarkdown(
              dingTalkUserId.trim(),
              switchResolve.reason ?? `未找到匹配仓库：${quick.repoFilter}`,
              "Wise",
            );
          } catch (err) {
            console.error("DingTalk automation switch repo error reply failed:", err);
            void message.error(err instanceof Error ? err.message : "回发钉钉失败");
          }
          void message.error(switchResolve.reason ?? "钉钉自动化：无法解析目标仓库");
          return;
        }
        const repoSwitch = switchResolve.repository;
        const rpSwitch = repoSwitch.path.trim();
        const sessionsSwitch = sessionsLatestRef.current;
        const bindingsSwitch = repositoryMainBindingsLatestRef.current;
        let targetSwitchId = resolveBoundMainSessionId(rpSwitch, bindingsSwitch, sessionsSwitch);
        if (!targetSwitchId) {
          const pickedSwitch = pickSessionForRepositorySidebarSelect(sessionsSwitch, rpSwitch, loadSessionOwnerHints());
          targetSwitchId = pickedSwitch?.id ?? null;
        }
        if (!targetSwitchId) {
          try {
            void message.open({
              key: uxMessageKey,
              type: "loading",
              content: `正在打开「${repoSwitch.name}」并创建主会话…`,
              duration: 0,
            });
            const idSw = await createSessionRef.current(rpSwitch, repositoryFolderBasename(repoSwitch));
            bindRepositoryMainSessionRef.current(rpSwitch, idSw);
            targetSwitchId = idSw;
          } catch (err) {
            message.destroy(uxMessageKey);
            console.error("DingTalk automation switch createSession failed:", err);
            try {
              await sendDingTalkWiseAutomationReplyMarkdown(
                dingTalkUserId.trim(),
                `创建主会话失败：${err instanceof Error ? err.message : String(err)}`,
                "Wise",
              );
            } catch (e) {
              console.error(e);
            }
            return;
          }
        } else {
          bindRepositoryMainSessionRef.current(rpSwitch, targetSwitchId);
        }
        jumpToSessionWithRepositoryRef.current(targetSwitchId);
        message.destroy(uxMessageKey);
        try {
          await sendDingTalkWiseAutomationReplyMarkdown(
            dingTalkUserId.trim(),
            `消息已处理完成。\n\n已切换至仓库 **${repoSwitch.name}** 并打开主会话。`,
            "Wise",
          );
          void message.success({ content: "钉钉：已切换仓库并打开主会话", duration: 2.5 });
        } catch (err) {
          console.error("DingTalk automation switch done reply failed:", err);
          void message.error(err instanceof Error ? err.message : "回发钉钉失败");
        }
        return;
      }

      if (quick.kind === "new_session") {
        const hasRepoHint = quick.repoFilter.trim().length > 0;
        const newResolve = resolveRepositoryForDingTalkAutomation({
          repositories: repositoriesLatestRef.current,
          projects: projectsLatestRef.current,
          activeProjectId: activeProjectIdLatestRef.current,
          activeRepositoryId: activeRepositoryIdLatestRef.current,
          repositoryNameFilter: hasRepoHint ? quick.repoFilter.trim() : (repositoryName ?? null),
          resolveScope: hasRepoHint ? "all_projects" : "active_project",
        });
        if (!newResolve.repository) {
          message.destroy(uxMessageKey);
          try {
            await sendDingTalkWiseAutomationReplyMarkdown(
              dingTalkUserId.trim(),
              newResolve.reason ??
                "新建会话失败：请指定仓库（如 `新建会话 my-repo`）、首行写命令次行写仓库名，或在 JSON 中填写 `repositoryName`；无仓库名时需侧栏能默认到当前仓库。",
              "Wise",
            );
          } catch (err) {
            console.error("DingTalk automation new session hint reply failed:", err);
            void message.error(err instanceof Error ? err.message : "回发钉钉失败");
          }
          void message.error(newResolve.reason ?? "钉钉自动化：无法解析目标仓库");
          return;
        }
        const repoNew = newResolve.repository;
        const rpNew = repoNew.path.trim();
        try {
          void message.open({
            key: uxMessageKey,
            type: "loading",
            content: `正在为「${repoNew.name}」新建会话…`,
            duration: 0,
          });
          const newId = await createSessionRef.current(rpNew, repositoryFolderBasename(repoNew));
          bindRepositoryMainSessionRef.current(rpNew, newId);
          jumpToSessionWithRepositoryRef.current(newId);
          message.destroy(uxMessageKey);
          await sendDingTalkWiseAutomationReplyMarkdown(
            dingTalkUserId.trim(),
            `消息已处理完成。\n\n已在仓库 **${repoNew.name}** 新建会话并打开。`,
            "Wise",
          );
          void message.success({ content: "钉钉：已新建会话", duration: 2.5 });
        } catch (err) {
          message.destroy(uxMessageKey);
          console.error("DingTalk automation new session failed:", err);
          try {
            await sendDingTalkWiseAutomationReplyMarkdown(
              dingTalkUserId.trim(),
              `新建会话失败：${err instanceof Error ? err.message : String(err)}`,
              "Wise",
            );
          } catch (e) {
            console.error(e);
          }
          void message.error(err instanceof Error ? err.message : "新建会话失败");
        }
        return;
      }

      const { repository, reason } = resolveRepositoryForDingTalkAutomation({
        repositories: repositoriesLatestRef.current,
        projects: projectsLatestRef.current,
        activeProjectId: activeProjectIdLatestRef.current,
        activeRepositoryId: activeRepositoryIdLatestRef.current,
        repositoryNameFilter: repositoryName ?? null,
      });
      if (!repository) {
        message.destroy(uxMessageKey);
        void message.error(reason ?? "钉钉自动化：无法解析目标仓库");
        void sendDingTalkWiseAutomationReplyMarkdown(
          dingTalkUserId,
          reason ?? "无法解析目标仓库：请在侧栏选中仓库或在入站 JSON 中填写 repositoryName。",
        ).catch((err) => {
          console.error("DingTalk automation error reply failed:", err);
        });
        return;
      }

      const rp = repository.path.trim();
      const sessionsNow = sessionsLatestRef.current;
      const bindings = repositoryMainBindingsLatestRef.current;
      let targetId = resolveBoundMainSessionId(rp, bindings, sessionsNow);
      if (!targetId) {
        const picked = pickSessionForRepositorySidebarSelect(sessionsNow, rp, loadSessionOwnerHints());
        targetId = picked?.id ?? null;
      }
      if (!targetId) {
        try {
          void message.open({
            key: uxMessageKey,
            type: "loading",
            content: `正在打开「${repository.name}」并创建主会话…`,
            duration: 0,
          });
          const id = await createSessionRef.current(rp, repositoryFolderBasename(repository));
          bindRepositoryMainSessionRef.current(rp, id);
          targetId = id;
        } catch (err) {
          message.destroy(uxMessageKey);
          console.error("DingTalk automation createSession failed:", err);
          void sendDingTalkWiseAutomationReplyMarkdown(
            dingTalkUserId,
            `创建 Claude 会话失败：${err instanceof Error ? err.message : String(err)}`,
          ).catch((e) => console.error(e));
          return;
        }
      } else {
        bindRepositoryMainSessionRef.current(rp, targetId);
      }

      void message.open({
        key: uxMessageKey,
        type: "loading",
        content: `正在切换到「${repository.name}」主会话…`,
        duration: 0,
      });

      jumpToSessionWithRepositoryRef.current(targetId);
      const inboundJobId =
        typeof globalThis.crypto?.randomUUID === "function"
          ? `dingtalk-inbound-${globalThis.crypto.randomUUID()}`
          : `dingtalk-inbound-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      dingTalkAutomationPendingRef.current.set(targetId, {
        dingTalkUserId: dingTalkUserId.trim(),
        uxMessageKey,
        dingTalkInboundJobId: inboundJobId,
      });

      void message.open({
        key: uxMessageKey,
        type: "loading",
        content: `已在「${repository.name}」主会话执行钉钉指令，处理完成后将回发钉钉…`,
        duration: 0,
      });

      let outgoingPrompt = promptText;
      if (hasImages) {
        try {
          outgoingPrompt = await buildDingTalkAutomationExecutePrompt({
            repositoryPath: rp,
            promptText,
            imageDataUrls,
          });
        } catch (err) {
          clearDingTalkAutomationPendingAndResolveInboundJob(targetId);
          message.destroy(uxMessageKey);
          console.error("DingTalk automation image prompt build failed:", err);
          void sendDingTalkWiseAutomationReplyMarkdown(
            dingTalkUserId,
            `处理钉钉图片失败：${err instanceof Error ? err.message : String(err)}`,
          ).catch((e) => console.error(e));
          return;
        }
      }

      const ok = executeSessionRef.current(targetId, outgoingPrompt);
      if (!ok) {
        clearDingTalkAutomationPendingAndResolveInboundJob(targetId);
        message.destroy(uxMessageKey);
        void message.warning("未能启动 Claude Code（可能被并发策略或本地门闸拦截）");
        void sendDingTalkWiseAutomationReplyMarkdown(
          dingTalkUserId,
          "未能启动 Claude Code（可能被并发策略或本地门闸拦截），请稍后重试。",
        ).catch((err) => {
          console.error("DingTalk automation blocked reply failed:", err);
        });
        return;
      }

      await new Promise<void>((resolve) => {
        dingTalkAutomationInboundJobResolversRef.current.set(inboundJobId, resolve);
      });
    }

    void listen(WISE_DINGTALK_AUTOMATION_V1_EVENT, (ev) => {
      enqueueDingTalkAutomationInbound(ev.payload);
    }).then((u) => {
      if (cancelled) {
        u();
        return;
      }
      unlisten = u;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const handleCancelOmcDirectBatchInvocation = useCallback((invocationKey: string) => {
    const k = invocationKey.trim();
    if (!k) return;
    void cancelClaudeInvocation(k)
      .then((didKill) => {
        if (didKill) return;
        if (omcDirectBatchProgressUiTimeoutRef.current != null) {
          clearTimeout(omcDirectBatchProgressUiTimeoutRef.current);
          omcDirectBatchProgressUiTimeoutRef.current = null;
        }
        const removedFromList = omcDirectBatchInvocationRef.current.delete(k);
        if (removedFromList) {
          const list = sortOmcDirectBatchInvocationsForStore([...omcDirectBatchInvocationRef.current.values()]);
          const digest = digestOmcDirectBatchInvocationsList(list);
          setOmcDirectBatchInvocationsStore(list, digest);
          void flushPersistOmcDirectBatchInvocations(list);
        }
        const directRunning = [...omcDirectBatchInvocationRef.current.values()].filter(isOmcDirectBatchInvocationRunning)
          .length;
        const workflowInv = omcInvocationRuntimeRef.current.size;
        const batchActive = Boolean(omcBatchRuntimeRef.current?.active);
        const omcNameMatchers = omcWorkerRepositoryBoundNameMatchers(employees);
        const omcWorkerTabBusy = sessionsLatestRef.current.some((s) => {
          if (s.status !== "running" && s.status !== "connecting") return false;
          const bound = extractRepositoryBoundEmployeeName(s.repositoryName);
          return bound !== null && omcNameMatchers.has(bound);
        });
        if (directRunning === 0 && workflowInv === 0) {
          if (batchActive) {
            setOmcBatchRuntime(null);
          }
          omcDirectBatchEndPendingRef.current = false;
          if (!omcWorkerTabBusy) {
            void message.warning(
              removedFromList
                ? "未在宿主侧找到该子进程，已从 OMC 员工会话记录中移除本条；当前无其它 OMC 活动，OMC 员工已显示为空闲。"
                : "未在宿主侧找到该子进程（可能已结束或列表为历史记录）；本地索引中无该条，无法从会话记录移除。当前无其它 OMC 活动，侧栏 OMC 状态已重置为空闲。",
            );
          } else {
            void message.warning(
              removedFromList
                ? "未在宿主侧找到该子进程，已从 OMC 员工会话记录中移除本条；直连批量与流式 invocation 已无进行中，但 OMC 员工工作标签会话仍在运行，侧栏可能仍显示进行中。"
                : "未在宿主侧找到该子进程；直连批量与流式 invocation 已无进行中，但 OMC 员工工作标签会话仍在运行。",
            );
          }
        } else {
          void message.warning(
            removedFromList
              ? "未在宿主侧找到该子进程，已从 OMC 员工会话记录中移除本条；其它 OMC 活动仍在进行中。"
              : "未在宿主侧找到该子进程（可能已结束或列表为历史记录）；本地索引中无该条，无法从会话记录移除；其它 OMC 活动仍在进行中。",
          );
        }
      })
      .catch((err) => {
        console.error("cancelClaudeInvocation:", err);
        message.error("结束该 Claude Code 子进程失败");
      });
  }, [employees]);

  const handleOpenOmcBatchInvocationDetail = useCallback(
    (input: { sessionId: string; repositoryPath: string; invocationKey: string }) => {
      const anchorSid = input.sessionId.trim();
      const rp = input.repositoryPath.trim();
      const ik = input.invocationKey.trim();
      if (!rp || !ik) return;

      const sessionsNow = sessionsLatestRef.current;
      let targetId: string | null = resolveBoundMainSessionId(rp, repositoryMainSessionBindings, sessionsNow);
      if (!targetId) {
        const picked = pickSessionForRepositorySidebarSelect(sessionsNow, rp, loadSessionOwnerHints());
        targetId = picked?.id ?? null;
      }
      const pathKey = normalizeRepositoryPathForMatch(rp);
      if (!targetId && anchorSid) {
        const anchorHit = sessionsNow.find((item) => item.id === anchorSid || item.claudeSessionId?.trim() === anchorSid);
        if (anchorHit && isRepositoryMainSessionTab(anchorHit, pathKey)) {
          targetId = anchorHit.id;
        }
      }
      if (!targetId) {
        void message.warning("未找到该仓库的主会话标签，请先在侧栏打开仓库主会话后再查看后台输出。");
        return;
      }

      jumpToSessionWithRepository(targetId);
      queueMicrotask(() => {
        window.dispatchEvent(
          new CustomEvent<OpenBackgroundInvocationDrawerDetail>(WORKFLOW_UI_EVENT_OPEN_BACKGROUND_INVOCATION_DRAWER, {
            detail: {
              sessionId: targetId,
              repositoryPath: rp,
              preferredInvocationKey: ik,
            },
          }),
        );
      });
    },
    [jumpToSessionWithRepository, repositoryMainSessionBindings],
  );

  const ensureEmployeeWorkerTabSessionId = useCallback(
    async (
      repositoryPath: string,
      repositoryName: string,
      employee: EmployeeItem,
    ): Promise<{ sessionId: string; deferExecute: boolean }> => {
      const key = `${repositoryPath}::${employee.id}`;
      const sessionsNow = sessionsLatestRef.current;
      const cachedId = employeeSessionIdByKeyRef.current.get(key);
      if (cachedId) {
        const hit = sessionsNow.find((item) => item.id === cachedId || item.claudeSessionId === cachedId);
        if (hit) {
          if (hit.id !== cachedId) {
            employeeSessionIdByKeyRef.current.set(key, hit.id);
          }
          return { sessionId: hit.id, deferExecute: false };
        }
        const migratedHit = sessionsNow.find(
          (item) =>
            item.repositoryPath === repositoryPath &&
            extractBoundEmployeeNameFromSessionRepositoryName(item.repositoryName) === employee.name.trim(),
        );
        if (migratedHit) {
          employeeSessionIdByKeyRef.current.set(key, migratedHit.id);
          return { sessionId: migratedHit.id, deferExecute: false };
        }
        employeeSessionIdByKeyRef.current.delete(key);
      }
      const inflight = employeeSessionCreateByKeyRef.current.get(key);
      if (inflight) {
        const sessionId = await inflight;
        return { sessionId, deferExecute: true };
      }
      const createPromise = (async (): Promise<string> => {
        const previousActiveSessionId = activeSessionIdLatestRef.current;
        const createdSessionId = await createSession(
          repositoryPath,
          `${repositoryName}/员工:${employee.name}`,
        );
        employeeSessionIdByKeyRef.current.set(key, createdSessionId);
        if (previousActiveSessionId && previousActiveSessionId !== createdSessionId) {
          switchSession(previousActiveSessionId);
        }
        return createdSessionId;
      })();
      employeeSessionCreateByKeyRef.current.set(key, createPromise);
      void createPromise.finally(() => {
        employeeSessionCreateByKeyRef.current.delete(key);
      });
      const sessionId = await createPromise;
      return { sessionId, deferExecute: true };
    },
    [createSession, switchSession],
  );

  /**
   * 直连批量 OMC 点击执行前：关闭当前仓库下所有「OMC员工」Wise 标签并清空员工会话缓存，
   * 再预建一条新的员工工作标签，避免沿用上一批次的会话与 Claude Code 上下文入口。
   */
  const prepareFreshOmcEmployeeWorkerForDirectBatch = useCallback(
    async (input: { repositoryPath: string; repositoryDisplayName: string }) => {
      const rp = input.repositoryPath.trim();
      if (!rp) return;
      const pathKey = normalizeRepositoryPathForMatch(rp);
      const snapshot = sessionsLatestRef.current;
      const omcBoundNames = omcWorkerRepositoryBoundNameMatchers(employees);
      const toClose = snapshot
        .filter((s) => {
          if (normalizeRepositoryPathForMatch(s.repositoryPath ?? "") !== pathKey) return false;
          const bound = extractRepositoryBoundEmployeeName(s.repositoryName);
          return bound !== null && omcBoundNames.has(bound);
        })
        .map((s) => s.id);
      if (toClose.length > 0) {
        flushSync(() => {
          for (const id of toClose) {
            handleCloseSession(id);
          }
        });
      }
      const employee = resolveConfiguredOmcEmployee(employees);
      if (!employee) return;
      const mapKey = `${rp}::${employee.id}`;
      employeeSessionIdByKeyRef.current.delete(mapKey);
      employeeSessionCreateByKeyRef.current.delete(mapKey);
      const disp = input.repositoryDisplayName.trim() || rp;
      await ensureEmployeeWorkerTabSessionId(rp, disp, employee);
    },
    [employees, ensureEmployeeWorkerTabSessionId, handleCloseSession],
  );

  const notifyOmcEmployeeDirectBatchTaskDone = useCallback(
    (input: { repositoryPath: string; repositoryDisplayName: string; employeeMessage: string }) => {
      void (async () => {
        const rp = input.repositoryPath.trim();
        const text = input.employeeMessage.trim();
        if (!rp || !text) return;
        const disp = input.repositoryDisplayName.trim() || rp;
        const employee = resolveConfiguredOmcEmployee(employees);
        let targetSessionId: string | null = null;
        const pathKey = normalizeRepositoryPathForMatch(rp);
        const omcBoundNames = omcWorkerRepositoryBoundNameMatchers(employees);
        if (employee) {
          const { sessionId } = await ensureEmployeeWorkerTabSessionId(rp, disp, employee);
          targetSessionId = sessionId;
        } else {
          for (const s of sessionsLatestRef.current) {
            if (normalizeRepositoryPathForMatch(s.repositoryPath ?? "") !== pathKey) continue;
            const bound = extractRepositoryBoundEmployeeName(s.repositoryName);
            if (bound !== null && omcBoundNames.has(bound)) {
              targetSessionId = s.id;
              break;
            }
          }
        }
        if (!targetSessionId) return;
        appendSystemMessage(targetSessionId, text);
      })();
    },
    [appendSystemMessage, employees, ensureEmployeeWorkerTabSessionId],
  );

  beforeSpawnClaudeRef.current = (session) =>
    evaluateBeforeSpawnClaudeCode({
      spawningSession: session,
      sessions,
      projects,
      repositories,
      limitsMap: claudeConcurrencyLimitsMap,
      preferredProjectId: activeProjectId,
    });

  claudeConcurrencyInvokeContextRef.current = (session) =>
    resolveClaudeConcurrencyInvokeContext({
      session,
      projects,
      repositories,
      limitsMap: claudeConcurrencyLimitsMap,
      preferredProjectId: activeProjectId,
    });

  const handleClaudeConcurrencyLimitChange = useCallback(
    async (projectId: string, repositoryId: number, nextRaw: number) => {
      const next = clampConcurrencyLimit(nextRaw);
      const key = claudeConcurrencyScopeKey(projectId, repositoryId);
      const nextMap: ClaudeConcurrencyLimitsMap = { ...claudeConcurrencyLimitsMap, [key]: next };
      setClaudeConcurrencyLimitsMap(nextMap);
      try {
        await saveClaudeConcurrencyLimits(nextMap);
      } catch (error) {
        console.error("Failed to save Claude concurrency limits:", error);
        message.error("保存并发上限失败");
      }
    },
    [claudeConcurrencyLimitsMap],
  );

  useEffect(() => {
    if (!activeProjectId || activeRepositoryId == null) {
      setRustSpawnSlotOccupied(null);
      return;
    }
    const proj = projects.find((p) => p.id === activeProjectId);
    const repo = repositories.find((r) => r.id === activeRepositoryId);
    if (!proj || !repo) {
      setRustSpawnSlotOccupied(null);
      return;
    }
    const sk = claudeConcurrencyScopeKey(proj.id, repo.id);
    let cancelled = false;
    setRustSpawnSlotOccupied(null);

    const tick = async () => {
      const n = await getClaudeSpawnSlotCount(sk);
      if (cancelled) return;
      if (n !== null) {
        setRustSpawnSlotOccupied(n);
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeProjectId, activeRepositoryId, projects, repositories]);

  const monitorClaudeConcurrency = useMemo(() => {
    if (!activeProjectId || activeRepositoryId == null) {
      return undefined;
    }
    const proj = projects.find((p) => p.id === activeProjectId);
    const repo = repositories.find((r) => r.id === activeRepositoryId);
    if (!proj || !repo) {
      return undefined;
    }
    const limit = getConcurrencyLimitForScope(claudeConcurrencyLimitsMap, proj.id, repo.id);
    const sessionActiveCount = countRunningClaudeSessionsInProjectRepository(
      sessions,
      proj,
      repo,
      projects,
      repositories,
      claudeConcurrencyLimitsMap,
      activeProjectId,
    );
    const activeCount =
      typeof rustSpawnSlotOccupied === "number"
        ? Math.max(sessionActiveCount, rustSpawnSlotOccupied)
        : sessionActiveCount;
    return {
      activeCount,
      limit,
      onLimitChange: (value: number) => void handleClaudeConcurrencyLimitChange(proj.id, repo.id, value),
    };
  }, [
    activeProjectId,
    activeRepositoryId,
    projects,
    repositories,
    claudeConcurrencyLimitsMap,
    sessions,
    handleClaudeConcurrencyLimitChange,
    rustSpawnSlotOccupied,
  ]);

  const { employeeMonitorItems, teamMonitorItems, stats: monitorStats } = useMonitorOverview({
    employees,
    workflowTemplates,
    workflowTasks,
    workflowTaskEventsByTaskId,
    workflowRuntimeSnapshotsByTaskId,
    taskPendingEmployeesByTaskId,
    sessions: sessionsSyncedForMonitorUi,
    workflowGraphsByWorkflowId,
    omcBatchRuntime,
  });
  const mentionEmployees = useMemo(() => {
    const monitoredEmployeeIds = new Set(employeeMonitorItems.map((item) => item.employeeId));
    return employees.filter(
      (item) =>
        item.enabled &&
        monitoredEmployeeIds.has(item.id) &&
        !isOmcMonitorEmployeeRecord(item),
    );
  }, [employeeMonitorItems, employees]);
  const selectableWorkflowEmployeeIds = useMemo(
    () => employeeMonitorItems.map((item) => item.employeeId),
    [employeeMonitorItems],
  );
  const publishedTeamMonitorItems = useMemo(
    () =>
      teamMonitorItems.filter(
        (item) => (workflowGraphStatusByWorkflowId[item.workflowId] ?? "").toLowerCase() === "published",
      ),
    [teamMonitorItems, workflowGraphStatusByWorkflowId],
  );
  const dispatchTeamStepToEmployeeSession = useCallback(
    async (input: {
      task: WorkflowTaskItem;
      dispatch: {
        employeeId?: string;
        employeeName: string;
        nodeType: WorkflowGraphNodeType;
        input: string;
      };
      previousNodeLabel: string;
      decision?: "pass" | "reject";
    }): Promise<boolean> => {
      const { task, dispatch } = input;
      const ownerSession = sessions.find((item) => item.id === task.creator);
      if (!ownerSession) {
        return false;
      }
      const targetEmployeeName = dispatch.employeeName.trim();
      const pendingEmployees = taskPendingEmployeesByTaskId[task.id] ?? [];
      const targetEmployee = resolveTeamDispatchTargetEmployee(dispatch, employees, pendingEmployees);
      if (!targetEmployee) {
        const targetEmployeeId = dispatch.employeeId?.trim();
        const employeeHint = targetEmployeeId ? `${targetEmployeeName}（ID: ${targetEmployeeId}）` : targetEmployeeName;
        const errorText = `团队流程分发失败：未找到员工「${employeeHint}」，请检查团队节点配置。`;
        appendSystemMessage(ownerSession.id, errorText);
        const failedSnapshot: WorkflowRuntimeStepSnapshot = {
          id: `${task.id}-dispatch-error-${Date.now()}`,
          taskId: task.id,
          phase: "dispatch",
          fromNodeId: undefined,
          toNodeId: undefined,
          toNodeName: targetEmployeeName,
          toNodeType: dispatch.nodeType,
          inputPreview: snapshotWorkflowDispatchInput(buildTeamWorkerExecutePrompt(dispatch.input, undefined)),
          outputPreview: errorText,
          createdAt: Date.now(),
        };
        setWorkflowRuntimeSnapshotsByTaskId((prev) => ({
          ...prev,
          [task.id]: [...(prev[task.id] ?? []), failedSnapshot],
        }));
        try {
          const runtimeEvent = await appendTaskEvent({
            taskId: task.id,
            eventType: "workflow_runtime_dispatch_error",
            payloadJson: JSON.stringify({
              action: "dispatch_error",
              employeeId: targetEmployeeId,
              employeeName: targetEmployeeName,
              reason: errorText,
              snapshot: failedSnapshot,
            }),
          });
          setWorkflowTaskEventsByTaskId((prev) => ({
            ...prev,
            [task.id]: [...(prev[task.id] ?? []), runtimeEvent],
          }));
        } catch (runtimeEventError) {
          console.error("Failed to persist workflow runtime dispatch error:", runtimeEventError);
        }
        return false;
      }
      const { sessionId: targetSessionId, deferExecute: executeAfterCreate } = await ensureEmployeeWorkerTabSessionId(
        ownerSession.repositoryPath,
        ownerSession.repositoryName,
        targetEmployee,
      );
      if (!targetSessionId) {
        return false;
      }
      const autoPrompt = buildTeamWorkerExecutePrompt(dispatch.input, targetEmployee.agentType?.trim());
      workflowTaskByWorkerSessionRef.current.set(targetSessionId, task.id);
      const targetSession = sessions.find((item) => item.id === targetSessionId);
      const targetClaudeSessionId = targetSession?.claudeSessionId?.trim();
      if (targetClaudeSessionId) {
        workflowTaskByWorkerSessionRef.current.set(targetClaudeSessionId, task.id);
      }
      if (executeAfterCreate) {
        return await new Promise<boolean>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve(executeSession(targetSessionId, autoPrompt) !== false);
            });
          });
        });
      }
      return executeSession(targetSessionId, autoPrompt) !== false;
    },
    [sessions, employees, ensureEmployeeWorkerTabSessionId, appendSystemMessage, executeSession, taskPendingEmployeesByTaskId],
  );

  useEffect(() => {
    const workflowIds = Array.from(new Set([...workflowTemplates.map((item) => item.id), ...workflowTasks.map((item) => item.workflowId)]));
    const missingIds = workflowIds.filter((workflowId) => !workflowGraphsByWorkflowId[workflowId]);
    if (missingIds.length === 0) {
      return;
    }
    void (async () => {
      const entries = await Promise.all(
        missingIds.map(async (workflowId) => {
          try {
            const item = await getWorkflowGraph({ workflowId });
            return [workflowId, item] as const;
          } catch {
            return [workflowId, null] as const;
          }
        }),
      );
      setWorkflowGraphsByWorkflowId((prev) => {
        const next = { ...prev };
        for (const [workflowId, graphItem] of entries) {
          if (graphItem?.graph) {
            next[workflowId] = graphItem.graph;
          }
        }
        return next;
      });
      setWorkflowGraphStatusByWorkflowId((prev) => {
        const next = { ...prev };
        for (const [workflowId, graphItem] of entries) {
          if (typeof graphItem?.status === "string") {
            next[workflowId] = graphItem.status;
          }
        }
        return next;
      });
    })();
  }, [workflowTemplates, workflowTasks, workflowGraphsByWorkflowId]);

  const repositoriesRefreshKey = useMemo(
    () =>
      repositories
        .map((p) => `${p.id}:${p.path}`)
        .sort()
        .join("|"),
    [repositories],
  );

  useEffect(() => {
    if (!tabsHydrated || !repositoriesRefreshKey) return;
    for (const p of repositories) {
      void refreshDiskSessionsForRepository(p.path, p.name);
    }
  }, [repositories, repositoriesRefreshKey, refreshDiskSessionsForRepository, tabsHydrated]);

  useEffect(() => {
    void (async () => {
      let [repoTpl, projectTpl] = await Promise.all([
        getTaskTemplate("repositorySplit"),
        getTaskTemplate("projectSplit"),
      ]);
      if (!repoTpl) {
        const legacyRepoTpl = (await getAppSetting(LEGACY_APP_SETTING_KEY_REPOSITORY_SPLIT_TEMPLATE))?.trim();
        if (legacyRepoTpl) {
          await setTaskTemplate("repositorySplit", legacyRepoTpl);
          await deleteAppSetting(LEGACY_APP_SETTING_KEY_REPOSITORY_SPLIT_TEMPLATE);
          repoTpl = legacyRepoTpl;
        }
      }
      if (!projectTpl) {
        const legacyProjectTpl = (await getAppSetting(LEGACY_APP_SETTING_KEY_PROJECT_SPLIT_TEMPLATE))?.trim();
        if (legacyProjectTpl) {
          await setTaskTemplate("projectSplit", legacyProjectTpl);
          await deleteAppSetting(LEGACY_APP_SETTING_KEY_PROJECT_SPLIT_TEMPLATE);
          projectTpl = legacyProjectTpl;
        }
      }
      setRepositorySplitTemplate(repoTpl?.trim() || DEFAULT_REPOSITORY_SPLIT_TEMPLATE);
      setProjectSplitTemplate(projectTpl?.trim() || DEFAULT_PROJECT_SPLIT_TEMPLATE);
    })();
  }, []);

  /** 恢复上次直连批量 OMC 的侧栏列表（`localStorage` 同步 + 应用设置异步；刷新后仍可见，直至下次发起新批） */
  useEffect(() => {
    function mergeHydratedInvocation(
      prev: WorkflowInvocationStreamDetail | undefined,
      next: WorkflowInvocationStreamDetail,
    ): WorkflowInvocationStreamDetail {
      function withSubprocessSid(
        chosen: WorkflowInvocationStreamDetail,
        other?: WorkflowInvocationStreamDetail,
      ): WorkflowInvocationStreamDetail {
        const sid = chosen.subprocessSessionId?.trim() || other?.subprocessSessionId?.trim();
        return sid && !chosen.subprocessSessionId?.trim() ? { ...chosen, subprocessSessionId: sid } : chosen;
      }
      if (!prev) return withSubprocessSid(next);
      if (prev.phase === "complete") return withSubprocessSid(prev, next);
      if (next.phase === "complete") return withSubprocessSid(next, prev);
      const lcN = next.lineCount ?? 0;
      const lcP = prev.lineCount ?? 0;
      if (lcN > lcP) return withSubprocessSid(next, prev);
      if (lcN < lcP) return withSubprocessSid(prev, next);
      const erN = next.errCount ?? 0;
      const erP = prev.errCount ?? 0;
      if (erN > erP) return withSubprocessSid(next, prev);
      if (erN < erP) return withSubprocessSid(prev, next);
      const chosen =
        (next.previewLine?.length ?? 0) > (prev.previewLine?.length ?? 0) ? next : prev;
      const other = chosen === next ? prev : next;
      return withSubprocessSid(chosen, other);
    }

    function applyHydratedRows(rows: WorkflowInvocationStreamDetail[]) {
      if (rows.length === 0) return;
      for (const inv of rows) {
        const k = inv.invocationKey;
        const prev = omcDirectBatchInvocationRef.current.get(k);
        const merged = mergeHydratedInvocation(prev, inv);
        omcDirectBatchInvocationRef.current.set(k, merged);
      }
      const list = sortOmcDirectBatchInvocationsForStore([...omcDirectBatchInvocationRef.current.values()]);
      setOmcDirectBatchInvocationsStore(list, digestOmcDirectBatchInvocationsList(list));
    }

    applyHydratedRows(loadOmcDirectBatchInvocationsFromLocalStorageSync());

    let cancelled = false;
    void (async () => {
      const rows = await loadOmcDirectBatchInvocationsPersisted();
      if (cancelled) return;
      const reconciled = await reconcileDirectBatchInvocationRowsWithBundles(rows);
      if (cancelled) return;
      applyHydratedRows(reconciled);
      const list = sortOmcDirectBatchInvocationsForStore([...omcDirectBatchInvocationRef.current.values()]);
      void flushPersistOmcDirectBatchInvocations(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 切后台 / 关闭标签前再落盘，避免仅依赖 Tauri 设置写入失败时丢列表 */
  useEffect(() => {
    function persistDirectBatchRefSnapshot() {
      const list = sortOmcDirectBatchInvocationsForStore([...omcDirectBatchInvocationRef.current.values()]);
      void flushPersistOmcDirectBatchInvocations(list);
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        persistDirectBatchRefSnapshot();
      }
    }
    function onPageHide() {
      persistDirectBatchRefSnapshot();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  useEffect(() => {
    const OMC_TEMPLATE_SET = new Set(["autopilot", "ultraqa", "verify", "team"]);
    const isOmcLikeInvocation = (detail: WorkflowInvocationStreamDetail): boolean => {
      const templateId = detail.templateId?.trim() ?? "";
      if (OMC_TEMPLATE_SET.has(templateId)) return true;
      const taskId = detail.taskId?.trim() ?? "";
      if (taskId.startsWith("task-")) return true;
      return false;
    };
    const directBatchRefHasRunning = (): boolean => {
      for (const inv of omcDirectBatchInvocationRef.current.values()) {
        if (isOmcDirectBatchInvocationRunning(inv)) return true;
      }
      return false;
    };
    const applyInvocationRuntime = () => {
      const list = Array.from(omcInvocationRuntimeRef.current.values());
      if (list.length === 0) {
        if (directBatchRefHasRunning()) {
          return;
        }
        setOmcBatchRuntime(null);
        omcDirectBatchEndPendingRef.current = false;
        return;
      }
      list.sort((a, b) => {
        const ta = typeof a.attempt === "number" ? a.attempt : 0;
        const tb = typeof b.attempt === "number" ? b.attempt : 0;
        return tb - ta;
      });
      const latest = list[0];
      if (!latest) {
        if (directBatchRefHasRunning()) {
          return;
        }
        setOmcBatchRuntime(null);
        omcDirectBatchEndPendingRef.current = false;
        return;
      }
      const anchRaw = typeof latest.sessionId === "string" ? latest.sessionId.trim() : "";
      const anchRp = typeof latest.repositoryPath === "string" ? latest.repositoryPath.trim() : "";
      const anchHit = anchRaw
        ? sessionsLatestRef.current.find((s) => s.id === anchRaw || s.claudeSessionId?.trim() === anchRaw)
        : undefined;
      const anchSid = anchHit?.id ?? anchRaw;
      if (anchSid && anchRp) {
        omcUiAnchorRef.current = { sessionId: anchSid, repositoryPath: anchRp };
      }
      setOmcBatchRuntime({
        active: true,
        sessionId: latest.sessionId,
        runningCount: list.length,
        updatedAt: Date.now(),
      });
    };
    const DIRECT_BATCH_UI_PROGRESS_DEBOUNCE_MS = 720;
    const applyDirectBatchInvocationUi = (persistMode: "debounced" | "immediate") => {
      const list = sortOmcDirectBatchInvocationsForStore([...omcDirectBatchInvocationRef.current.values()]);
      const digest = digestOmcDirectBatchInvocationsList(list);
      setOmcDirectBatchInvocationsStore(list, digest);
      if (persistMode === "immediate") {
        void flushPersistOmcDirectBatchInvocations(list);
      } else {
        schedulePersistOmcDirectBatchInvocations(list);
      }
    };
    const flushDirectBatchInvocationUiNow = () => {
      if (omcDirectBatchProgressUiTimeoutRef.current != null) {
        clearTimeout(omcDirectBatchProgressUiTimeoutRef.current);
        omcDirectBatchProgressUiTimeoutRef.current = null;
      }
      applyDirectBatchInvocationUi("immediate");
    };
    const scheduleDirectBatchInvocationProgressDebounced = () => {
      if (omcDirectBatchProgressUiTimeoutRef.current != null) {
        clearTimeout(omcDirectBatchProgressUiTimeoutRef.current);
      }
      omcDirectBatchProgressUiTimeoutRef.current = setTimeout(() => {
        omcDirectBatchProgressUiTimeoutRef.current = null;
        applyDirectBatchInvocationUi("debounced");
      }, DIRECT_BATCH_UI_PROGRESS_DEBOUNCE_MS);
    };
    const flushInvocationRuntimeApply = () => {
      if (omcInvocationRuntimeApplyRafRef.current != null) {
        cancelAnimationFrame(omcInvocationRuntimeApplyRafRef.current);
        omcInvocationRuntimeApplyRafRef.current = null;
      }
      applyInvocationRuntime();
    };
    const scheduleInvocationRuntimeApply = () => {
      if (omcInvocationRuntimeApplyRafRef.current != null) return;
      omcInvocationRuntimeApplyRafRef.current = requestAnimationFrame(() => {
        omcInvocationRuntimeApplyRafRef.current = null;
        applyInvocationRuntime();
      });
    };
    function handleOmcBatchRuntimeChanged(event: Event) {
      const detail = (event as CustomEvent<WorkflowOmcBatchRuntimeDetail>).detail;
      if (!detail || typeof detail !== "object") return;
      /**
       * 直连批量 `started` 会在同一 macrotask 内、`runDirectOmcBatchJob` 起子进程后立刻写入
       * `omcDirectBatchInvocationRef`。若把清空放进 rAF，会在下一帧抹掉刚写入的列表，侧栏「进行中」永远为空。
       */
      if (detail.active && detail.resetInvocationUi !== false) {
        omcDirectBatchEndPendingRef.current = false;
        omcDirectBatchInvocationRef.current.clear();
        if (omcDirectBatchProgressUiTimeoutRef.current != null) {
          clearTimeout(omcDirectBatchProgressUiTimeoutRef.current);
          omcDirectBatchProgressUiTimeoutRef.current = null;
        }
        resetOmcDirectBatchInvocationsStore();
        void clearOmcDirectBatchInvocationsPersisted();
      }
      /** 下一帧再改 React 状态，避免与同一时刻其它同步事件（如 Tauri 回调）挤爆单帧 */
      requestAnimationFrame(() => {
        if (!detail.active) {
          const workflowInv = omcInvocationRuntimeRef.current.size;
          const snap = Array.from(omcDirectBatchInvocationRef.current.values());
          const directRunning = snap.filter((inv) => isOmcDirectBatchInvocationRunning(inv)).length;
          omcDirectBatchEndPendingRef.current = directRunning > 0;
          if (workflowInv === 0 && directRunning === 0) {
            omcDirectBatchEndPendingRef.current = false;
            setOmcBatchRuntime(null);
          } else if (workflowInv > 0) {
            flushInvocationRuntimeApply();
          } else {
            flushDirectBatchInvocationUiNow();
            const first = snap.find((inv) => isOmcDirectBatchInvocationRunning(inv)) ?? snap[0];
            const prev = omcBatchRuntimeRef.current;
            const sidRaw =
              (typeof first?.sessionId === "string" ? first.sessionId.trim() : "") ||
              (typeof detail.sessionId === "string" ? detail.sessionId.trim() : "") ||
              (typeof prev?.sessionId === "string" ? prev.sessionId.trim() : "");
            setOmcBatchRuntime({
              active: true,
              sessionId: sidRaw || prev?.sessionId,
              runningCount: directRunning,
              updatedAt: Date.now(),
              directBatchTaskTotal: prev?.directBatchTaskTotal,
              directBatchTaskFinished: prev?.directBatchTaskFinished,
              directBatchClaudeCodeSessions: prev?.directBatchClaudeCodeSessions,
            });
          }
          return;
        }
        const batchSidRaw = typeof detail.sessionId === "string" ? detail.sessionId.trim() : "";
        const batchHit = batchSidRaw
          ? sessionsLatestRef.current.find((s) => s.id === batchSidRaw || s.claudeSessionId?.trim() === batchSidRaw)
          : undefined;
        const batchSid = batchHit?.id ?? batchSidRaw;
        const repoFromAnchor = batchHit?.repositoryPath?.trim() ?? "";
        if (batchSid && repoFromAnchor) {
          omcUiAnchorRef.current = { sessionId: batchSid, repositoryPath: repoFromAnchor };
        }
        setOmcBatchRuntime({
          active: true,
          sessionId: detail.sessionId,
          runningCount: detail.runningCount,
          updatedAt: detail.updatedAt ?? Date.now(),
          resetInvocationUi: detail.resetInvocationUi,
          directBatchTaskTotal: detail.directBatchTaskTotal,
          directBatchTaskFinished: detail.directBatchTaskFinished,
          directBatchClaudeCodeSessions: detail.directBatchClaudeCodeSessions,
        });
      });
    }
    function handleInvocationRuntimeChanged(event: Event) {
      const detail = (event as CustomEvent<WorkflowInvocationStreamDetail>).detail;
      if (!detail || typeof detail !== "object") return;
      if (detail.omcInvocationSource === "direct_batch") {
        const lean: WorkflowInvocationStreamDetail = { ...detail };
        if (detail.phase === "complete") {
          const prev = omcDirectBatchInvocationRef.current.get(detail.invocationKey);
          const sid = detail.subprocessSessionId?.trim() || prev?.subprocessSessionId?.trim();
          const merged: WorkflowInvocationStreamDetail = {
            ...lean,
            ...(sid ? { subprocessSessionId: sid } : {}),
          };
          omcDirectBatchInvocationRef.current.set(detail.invocationKey, merged);
          flushDirectBatchInvocationUiNow();
          let runningRemaining = 0;
          for (const inv of omcDirectBatchInvocationRef.current.values()) {
            if (isOmcDirectBatchInvocationRunning(inv)) runningRemaining += 1;
          }
          if (
            omcDirectBatchEndPendingRef.current &&
            runningRemaining === 0 &&
            omcInvocationRuntimeRef.current.size === 0
          ) {
            omcDirectBatchEndPendingRef.current = false;
            setOmcBatchRuntime(null);
          }
        } else {
          const prev = omcDirectBatchInvocationRef.current.get(detail.invocationKey);
          const sid =
            detail.subprocessSessionId?.trim() || prev?.subprocessSessionId?.trim() || undefined;
          const merged: WorkflowInvocationStreamDetail = {
            ...(prev ?? {}),
            ...lean,
            ...(sid ? { subprocessSessionId: sid } : {}),
          };
          omcDirectBatchInvocationRef.current.set(detail.invocationKey, merged);
          if (detail.phase === "started") {
            flushDirectBatchInvocationUiNow();
          } else {
            scheduleDirectBatchInvocationProgressDebounced();
          }
        }
        return;
      }
      if (!isOmcLikeInvocation(detail)) return;
      const invSidRaw = typeof detail.sessionId === "string" ? detail.sessionId.trim() : "";
      const invRp = typeof detail.repositoryPath === "string" ? detail.repositoryPath.trim() : "";
      const invHit = invSidRaw
        ? sessionsLatestRef.current.find((s) => s.id === invSidRaw || s.claudeSessionId?.trim() === invSidRaw)
        : undefined;
      const invSid = invHit?.id ?? invSidRaw;
      if (invSid && invRp) {
        omcUiAnchorRef.current = { sessionId: invSid, repositoryPath: invRp };
      }
      if (detail.phase === "complete") {
        omcInvocationRuntimeRef.current.delete(detail.invocationKey);
        flushInvocationRuntimeApply();
      } else if (detail.phase === "progress") {
        omcInvocationRuntimeRef.current.set(detail.invocationKey, detail);
        scheduleInvocationRuntimeApply();
      } else {
        omcInvocationRuntimeRef.current.set(detail.invocationKey, detail);
        flushInvocationRuntimeApply();
      }
    }
    function handleInvocationBundleExternallyUpdated(event: Event) {
      const detail = (event as CustomEvent<BackgroundInvocationBundleChangedDetail>).detail;
      if (!detail || typeof detail.sessionId !== "string" || typeof detail.repositoryPath !== "string") return;
      const sidRaw = detail.sessionId.trim();
      const rpRaw = detail.repositoryPath.trim();
      if (!sidRaw || !rpRaw) return;
      void (async () => {
        const bundle = await readInvocationSnapshotBundle(sidRaw, rpRaw);
        const pathKey = normalizeRepositoryPathForMatch(rpRaw);
        const canonSid =
          sessionsLatestRef.current.find((s) => s.id === sidRaw || s.claudeSessionId?.trim() === sidRaw)?.id ?? sidRaw;
        let touched = false;
        for (const [ik, inv] of [...omcDirectBatchInvocationRef.current.entries()]) {
          if (inv.omcInvocationSource !== "direct_batch") continue;
          if (inv.phase === "complete") continue;
          if (normalizeRepositoryPathForMatch(inv.repositoryPath ?? "") !== pathKey) continue;
          const invSid = inv.sessionId.trim();
          if (invSid !== canonSid && invSid !== sidRaw) continue;
          const snap = bundle.items[ik];
          const hasPersisted =
            snap?.phase === "done" ||
            (Array.isArray(snap?.stdoutLines) && snap.stdoutLines.length > 0) ||
            (Array.isArray(snap?.stderrLines) && snap.stderrLines.length > 0);
          if (!hasPersisted) continue;
          omcDirectBatchInvocationRef.current.set(ik, {
            ...inv,
            phase: "complete",
            success: typeof snap?.success === "boolean" ? snap.success : inv.success,
            lineCount: snap?.lineCount ?? inv.lineCount,
            errCount: snap?.errCount ?? inv.errCount,
            ...(snap?.previewLine ? { previewLine: snap.previewLine } : {}),
          });
          touched = true;
        }
        if (touched) {
          flushDirectBatchInvocationUiNow();
        }
      })();
    }
    window.addEventListener(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, handleOmcBatchRuntimeChanged as EventListener);
    window.addEventListener(WORKFLOW_UI_EVENT_INVOCATION_STREAM, handleInvocationRuntimeChanged as EventListener);
    window.addEventListener(
      WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED,
      handleInvocationBundleExternallyUpdated as EventListener,
    );
    return () => {
      if (omcInvocationRuntimeApplyRafRef.current != null) {
        cancelAnimationFrame(omcInvocationRuntimeApplyRafRef.current);
        omcInvocationRuntimeApplyRafRef.current = null;
      }
      if (omcDirectBatchProgressUiTimeoutRef.current != null) {
        clearTimeout(omcDirectBatchProgressUiTimeoutRef.current);
        omcDirectBatchProgressUiTimeoutRef.current = null;
      }
      cancelOmcDirectBatchInvocationsPersistSchedule();
      window.removeEventListener(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, handleOmcBatchRuntimeChanged as EventListener);
      window.removeEventListener(WORKFLOW_UI_EVENT_INVOCATION_STREAM, handleInvocationRuntimeChanged as EventListener);
      window.removeEventListener(
        WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED,
        handleInvocationBundleExternallyUpdated as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    ensureCrepeToolbarTitleHintsInstalled();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [employeeList, counts, templates] = await Promise.all([
          listEmployees(),
          listEmployeeTaskCounts(),
          listWorkflowTemplates(),
        ]);
        setEmployees(employeeList);
        setEmployeeTaskCounts(counts);
        setWorkflowTemplates(templates);
      } catch (error) {
        console.error("Failed to load employee/workflow data:", error);
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    void (async () => {
      try {
        const tasks = await listWorkflowTasks(activeSessionId);
        setWorkflowTasks((prev) => {
          const untouched = prev.filter((item) => item.creator !== activeSessionId);
          return [...untouched, ...tasks];
        });
        const eventEntries = await Promise.all(
          tasks.slice(0, 8).map(async (task) => [task.id, await listTaskEvents(task.id)] as const),
        );
        const pendingEntries = await Promise.all(
          tasks.slice(0, 8).map(async (task) => [task.id, await listTaskPendingEmployees(task.id)] as const),
        );
        setWorkflowTaskEventsByTaskId((prev) => {
          const next = { ...prev };
          for (const [taskId, events] of eventEntries) {
            next[taskId] = events;
          }
          return next;
        });
        setWorkflowRuntimeSnapshotsByTaskId((prev) => {
          const next = { ...prev };
          for (const [taskId, events] of eventEntries) {
            next[taskId] = extractRuntimeSnapshotsFromEvents(events);
          }
          return next;
        });
        setTaskPendingEmployeesByTaskId((prev) => {
          const next = { ...prev };
          for (const [taskId, employees] of pendingEntries) {
            next[taskId] = employees;
          }
          return next;
        });
      } catch (error) {
        console.error("Failed to load workflow tasks:", error);
      }
    })();
  }, [activeSessionId]);

  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;

  const activeRepository = repositories.find((p) => p.id === activeRepositoryId);

  const handleAddWorktreeRepositoryToProject = useCallback(
    async (worktreePath: string) => {
      if (!activeProjectId) {
        message.warning("请先在侧栏选择或创建一个项目");
        return;
      }
      const repositoryType = activeRepository?.repositoryType ?? "frontend";
      try {
        const result = await handleAddRepositoryPathToProject(activeProjectId, worktreePath, repositoryType);
        if (result === "already_in_project") {
          message.info("该 worktree 目录已在当前项目中");
        } else {
          message.success("已将 worktree 目录加入当前项目");
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    },
    [activeProjectId, activeRepository, handleAddRepositoryPathToProject],
  );

  const resolveTaskListOmcInvokeConcurrency = useCallback(
    (sess: ClaudeSession) =>
      resolveClaudeConcurrencyInvokeContext({
        session: sess,
        projects,
        repositories,
        limitsMap: claudeConcurrencyLimitsMap,
        preferredProjectId: activeProjectId,
      }),
    [projects, repositories, claudeConcurrencyLimitsMap, activeProjectId],
  );

  const handleRefreshHistorySessions = useCallback(() => {
    if (!activeRepository) {
      return Promise.resolve();
    }
    return refreshDiskSessionsForRepository(activeRepository.path, activeRepository.name);
  }, [activeRepository, refreshDiskSessionsForRepository]);
  const activeFileEditorTab = useMemo(
    () => fileEditorTabs.find((t) => t.relativePath === fileEditorActivePath) ?? null,
    [fileEditorTabs, fileEditorActivePath],
  );
  const editorDirty = Boolean(
    activeFileEditorTab && activeFileEditorTab.content !== activeFileEditorTab.originalContent,
  );

  const handleToggleDualPane = useCallback(async () => {
    if (dualPaneEnabled) {
      setDualPaneEnabled(false);
      setDualPaneSecondarySessionId(null);
      setDualPaneSecondaryRepositoryId(null);
      dualPaneWindowExpandConsumedRef.current = false;
      const deltaLogical = dualPaneWindowDeltaLogicalRef.current;
      dualPaneWindowDeltaLogicalRef.current = null;
      dualPaneCenterLogicalBeforeRef.current = null;
      await waitLayoutFrames(1);
      if (deltaLogical != null && deltaLogical > 0) {
        await shrinkMainWindowByDualPaneDelta(deltaLogical);
      } else {
        await restoreMainWindowInnerSnapshot(dualWindowInnerSnapshotRef.current);
      }
      dualWindowInnerSnapshotRef.current = null;
      await waitLayoutFrames(1);
      await shrinkMainWindowToRemoveHorizontalSlack();
      await shrinkMainWindowToRemoveHorizontalSlack();
      return;
    }
    if (!activeRepository) {
      message.warning("请先选择仓库");
      return;
    }
    try {
      dualPaneWindowDeltaLogicalRef.current = null;
      dualPaneCenterLogicalBeforeRef.current = measureMainLayoutContentWidthPx(mainLayoutContentRef.current, {
        leftCollapsed: collapsed,
        rightCollapsed: effectiveRightCollapsed,
        leftWidthPx: mainLayoutLeftWidthPx,
        rightWidthPx: mainLayoutRightWidthPx,
      });
      setDualPaneSecondaryRepositoryId(null);
      void readMainWindowInnerSize()
        .then((size) => {
          dualWindowInnerSnapshotRef.current = size;
        })
        .catch(() => {
          dualWindowInnerSnapshotRef.current = null;
        });
      const id = await createSession(activeRepository.path, activeRepository.name, { skipActivate: true });
      setDualPaneSecondarySessionId(id);
      setDualPaneEnabled(true);
    } catch (error) {
      console.error("Failed to create dual-pane right session:", error);
      message.error("创建右侧主会话失败");
    }
  }, [
    dualPaneEnabled,
    activeRepository,
    createSession,
    collapsed,
    effectiveRightCollapsed,
    mainLayoutLeftWidthPx,
    mainLayoutRightWidthPx,
  ]);

  const handleToggleDualPaneRef = useRef(handleToggleDualPane);
  handleToggleDualPaneRef.current = handleToggleDualPane;

  const handleNewSecondarySession = useCallback(
    async (repository: Repository) => {
      setActiveRepositoryId(repository.id);
      if (!dualPaneEnabled) {
        dualPaneWindowDeltaLogicalRef.current = null;
        dualPaneCenterLogicalBeforeRef.current = measureMainLayoutContentWidthPx(mainLayoutContentRef.current, {
          leftCollapsed: collapsed,
          rightCollapsed: effectiveRightCollapsed,
          leftWidthPx: mainLayoutLeftWidthPx,
          rightWidthPx: mainLayoutRightWidthPx,
        });
        void readMainWindowInnerSize()
          .then((size) => {
            dualWindowInnerSnapshotRef.current = size;
          })
          .catch(() => {
            dualWindowInnerSnapshotRef.current = null;
          });
      }
      const id = await createSession(repository.path, repositoryFolderBasename(repository), { skipActivate: true });
      setDualPaneSecondarySessionId(id);
      setDualPaneSecondaryRepositoryId(null);
      setDualPaneEnabled(true);
    },
    [
      createSession,
      dualPaneEnabled,
      collapsed,
      effectiveRightCollapsed,
      mainLayoutLeftWidthPx,
      mainLayoutRightWidthPx,
    ],
  );

  const handleDualPaneSecondaryRepositorySelect = useCallback(
    async (repositoryId: number) => {
      const repo = repositories.find((r) => r.id === repositoryId);
      if (!repo?.path?.trim()) {
        message.warning("未找到所选仓库");
        return;
      }
      const ownerHints = loadSessionOwnerHints();
      const sessionsNow = sessionsLatestRef.current;
      const pathKey = normalizeRepositoryPathForMatch(repo.path);
      const leftId = activeSessionIdLatestRef.current?.trim() ?? "";

      const bound = resolveBoundMainSessionId(repo.path, repositoryMainBindingsLatestRef.current, sessionsNow);
      const boundSession = bound ? sessionsNow.find((s) => s.id === bound) : undefined;
      const boundOk = Boolean(boundSession && isRepositoryMainSessionTab(boundSession, pathKey));

      const picked = pickSessionForRepositorySidebarSelect(sessionsNow, repo.path, ownerHints);

      let nextSecondary: string;
      if (boundOk && boundSession && boundSession.id !== leftId) {
        nextSecondary = boundSession.id;
      } else if (picked && picked.id !== leftId) {
        nextSecondary = picked.id;
      } else {
        try {
          nextSecondary = await createSession(repo.path, repositoryFolderBasename(repo), { skipActivate: true });
        } catch (error) {
          console.error("Failed to switch dual-pane secondary repository:", error);
          message.error("切换右侧仓库失败");
          return;
        }
      }

      setDualPaneSecondaryRepositoryId(activeRepository?.id === repositoryId ? null : repositoryId);
      setDualPaneSecondarySessionId(nextSecondary);
    },
    [repositories, activeRepository?.id, createSession],
  );

  useEffect(() => {
    if (!dualPaneSecondarySessionId) return;
    if (!sessions.some((s) => s.id === dualPaneSecondarySessionId)) {
      setDualPaneSecondarySessionId(null);
    }
  }, [sessions, dualPaneSecondarySessionId]);

  useEffect(() => {
    if (!dualPaneEnabled) {
      dualPaneWindowExpandConsumedRef.current = false;
      return;
    }
    if (!dualPaneSecondarySessionId) return;
    if (dualPaneWindowExpandConsumedRef.current) return;

    const centerBefore = dualPaneCenterLogicalBeforeRef.current ?? 0;
    if (centerBefore <= 0) return;

    dualPaneWindowExpandConsumedRef.current = true;
    const aborted = { current: false };
    void (async () => {
      const deltaLogical = await expandMainWindowByDualPaneCenterDelta(centerBefore, {
        shouldAbort: () => aborted.current,
      });
      if (aborted.current) return;
      if (deltaLogical > 0) {
        dualPaneWindowDeltaLogicalRef.current = deltaLogical;
      }
    })();
    return () => {
      aborted.current = true;
    };
  }, [dualPaneEnabled, dualPaneSecondarySessionId]);

  const exitCompactLayoutMode = useCallback(async () => {
    const snap = compactLayoutSnapshotRef.current;
    compactLayoutSnapshotRef.current = null;
    setCompactLayoutMode(false);
    await waitLayoutFrames(2);
    if (!snap) return;
    try {
      await setMainWindowLogicalInnerSize(snap.width, snap.height);
    } catch {
      /* 浏览器 dev / 非 Tauri */
    }
  }, []);

  const handleToggleCompactLayoutMode = useCallback(() => {
    if (compactLayoutModeRef.current) {
      void exitCompactLayoutMode();
      return;
    }
    compactLayoutSnapshotRef.current = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    setCompactLayoutMode(true);
    void (async () => {
      await waitLayoutFrames(2);
      if (!compactLayoutModeRef.current) return;
      if (!compactLayoutSnapshotRef.current) return;
      try {
        await setMainWindowLogicalInnerSize(COMPACT_LAYOUT_WINDOW_WIDTH_PX, COMPACT_LAYOUT_WINDOW_HEIGHT_PX);
      } catch {
        /* 浏览器 dev / 非 Tauri */
      }
    })();
  }, [exitCompactLayoutMode]);

  const handleToggleCompactLayoutModeRef = useRef(handleToggleCompactLayoutMode);
  handleToggleCompactLayoutModeRef.current = handleToggleCompactLayoutMode;

  useEffect(() => {
    let unlistenCompact: (() => void) | undefined;
    let unlistenDual: (() => void) | undefined;
    let cancelled = false;
    void listen("global-toggle-compact-layout", () => {
      handleToggleCompactLayoutModeRef.current();
    })
      .then((fn) => {
        if (!cancelled) unlistenCompact = fn;
        else fn();
      })
      .catch(() => {
        /* 非 Tauri / 事件不可用 */
      });
    void listen("global-toggle-dual-pane", () => {
      void handleToggleDualPaneRef.current();
    })
      .then((fn) => {
        if (!cancelled) unlistenDual = fn;
        else fn();
      })
      .catch(() => {
        /* 非 Tauri / 事件不可用 */
      });
    return () => {
      cancelled = true;
      unlistenCompact?.();
      unlistenDual?.();
    };
  }, []);

  const handleToggleRightPanel = useCallback(() => {
    if (compactLayoutModeRef.current) {
      void exitCompactLayoutMode();
      return;
    }
    const nextCollapsed = !rightCollapsed;
    setRightCollapsed(nextCollapsed);
    void (async () => {
      await waitLayoutFrames(2);
      const dw = nextCollapsed ? -mainLayoutRightWidthPx : mainLayoutRightWidthPx;
      await adjustMainWindowLogicalWidthByDelta(dw);
    })();
  }, [rightCollapsed, exitCompactLayoutMode, mainLayoutRightWidthPx]);

  const openRepositoryBinaryPreview = useCallback(
    async (relativePath: string) => {
      if (!activeRepository?.path) {
        message.warning("请先选择仓库");
        return;
      }
      const repoPath = activeRepository.path;
      const absPath = joinRepositoryAbsolutePath(repoPath, relativePath);

      if (isLegacyDocFilePath(relativePath)) {
        setRepositoryBinaryPreview((prev) => {
          if (prev?.kind === "pdf") {
            URL.revokeObjectURL(prev.blobUrl);
          }
          return { kind: "doc", relativePath, absolutePath: absPath };
        });
        return;
      }

      try {
        if (isImageFilePath(relativePath)) {
          const b64 = await readProjectRelativeFileBase64(repoPath, relativePath);
          const mime = mimeTypeForImagePath(relativePath);
          setRepositoryBinaryPreview((prev) => {
            if (prev?.kind === "pdf") {
              URL.revokeObjectURL(prev.blobUrl);
            }
            return { kind: "image", relativePath, src: `data:${mime};base64,${b64}` };
          });
          return;
        }
        if (isPdfFilePath(relativePath)) {
          const b64 = await readProjectRelativeFileBase64(repoPath, relativePath);
          const buf = base64ToArrayBuffer(b64);
          const blob = new Blob([buf], { type: "application/pdf" });
          const blobUrl = URL.createObjectURL(blob);
          setRepositoryBinaryPreview((prev) => {
            if (prev?.kind === "pdf") {
              URL.revokeObjectURL(prev.blobUrl);
            }
            return { kind: "pdf", relativePath, blobUrl };
          });
          return;
        }
        if (isDocxFilePath(relativePath)) {
          const b64 = await readProjectRelativeFileBase64(repoPath, relativePath);
          const buf = base64ToArrayBuffer(b64);
          const mammoth = await import("mammoth");
          const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
          const html = DOMPurify.sanitize(value, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ["style", "script"],
          });
          setRepositoryBinaryPreview((prev) => {
            if (prev?.kind === "pdf") {
              URL.revokeObjectURL(prev.blobUrl);
            }
            return { kind: "docx", relativePath, html };
          });
        }
      } catch (error) {
        console.error("Repository file preview failed:", error);
        message.error(`预览失败：${toUiErrorMessage(error)}`);
      }
    },
    [activeRepository?.path],
  );

  const removeFileEditorTab = useCallback((relativePath: string) => {
    setFileEditorTabs((prevTabs) => {
      const idx = prevTabs.findIndex((t) => t.relativePath === relativePath);
      const nextTabs = prevTabs.filter((t) => t.relativePath !== relativePath);
      setFileEditorActivePath((cur) => {
        if (cur !== relativePath) {
          return cur;
        }
        if (nextTabs.length === 0) {
          return null;
        }
        return nextTabs[idx]?.relativePath ?? nextTabs[idx - 1]!.relativePath;
      });
      return nextTabs;
    });
  }, []);

  const loadEditorFile = useCallback(
    async (relativePath: string) => {
      if (!activeRepository?.path) {
        message.warning("请先选择仓库");
        return;
      }
      if (!isMonacoSupportedFilePath(relativePath)) {
        message.info("该文件类型暂不支持内置打开");
        return;
      }

      const existing = fileEditorTabsRef.current.find((t) => t.relativePath === relativePath);
      if (existing && !existing.loading && existing.diffOriginal === undefined) {
        setFileEditorActivePath(relativePath);
        return;
      }

      setFileEditorTabs((prev) => {
        const i = prev.findIndex((t) => t.relativePath === relativePath);
        const slot: FileEditorTab = {
          relativePath,
          content: "",
          originalContent: "",
          loading: true,
        };
        if (i >= 0) {
          const next = [...prev];
          next[i] = slot;
          return next;
        }
        return [...prev, slot];
      });
      setFileEditorActivePath(relativePath);

      const repoPath = activeRepository.path;
      try {
        const body = await readProjectRelativeFile(repoPath, relativePath);
        setFileEditorTabs((prev) =>
          prev.map((t) =>
            t.relativePath === relativePath
              ? { relativePath, content: body, originalContent: body, loading: false }
              : t,
          ),
        );
      } catch (error) {
        console.error("Failed to read file:", error);
        message.error(`读取文件失败：${relativePath}`);
        setFileEditorTabs((prev) => {
          const nextTabs = prev.filter((t) => t.relativePath !== relativePath);
          setFileEditorActivePath((cur) => {
            if (cur !== relativePath) {
              return cur;
            }
            return nextTabs.length > 0 ? nextTabs[nextTabs.length - 1]!.relativePath : null;
          });
          return nextTabs;
        });
      }
    },
    [activeRepository?.path],
  );

  const loadGitDiffFile = useCallback(
    async (relativePath: string, section: GitPanelOpenFileOptions["fromGitChanges"]) => {
      if (!activeRepository?.path) {
        message.warning("请先选择仓库");
        return;
      }
      if (!isMonacoSupportedFilePath(relativePath)) {
        message.info("该文件类型暂不支持内置打开");
        return;
      }

      const norm = relativePath.replace(/\\/g, "/");

      setFileEditorTabs((prev) => {
        const i = prev.findIndex((t) => t.relativePath === relativePath);
        const slot: FileEditorTab = {
          relativePath,
          content: "",
          originalContent: "",
          loading: true,
        };
        if (i >= 0) {
          const next = [...prev];
          next[i] = slot;
          return next;
        }
        return [...prev, slot];
      });
      setFileEditorActivePath(relativePath);

      const repoPath = activeRepository.path;
      try {
        let left = "";
        let right = "";
        if (section === "unstaged") {
          left = await gitShowRevision(repoPath, `:${norm}`);
          right = await readProjectRelativeFile(repoPath, relativePath);
        } else {
          left = await gitShowRevision(repoPath, `HEAD:${norm}`);
          right = await gitShowRevision(repoPath, `:${norm}`);
        }
        setFileEditorTabs((prev) =>
          prev.map((t) =>
            t.relativePath === relativePath
              ? {
                  relativePath,
                  content: right,
                  originalContent: right,
                  loading: false,
                  diffOriginal: left,
                  gitDiffSection: section,
                }
              : t,
          ),
        );
      } catch (error) {
        console.error("Failed to load git diff:", error);
        message.error(`无法加载 diff：${relativePath}`);
        setFileEditorTabs((prev) => {
          const nextTabs = prev.filter((t) => t.relativePath !== relativePath);
          setFileEditorActivePath((cur) => {
            if (cur !== relativePath) {
              return cur;
            }
            return nextTabs.length > 0 ? nextTabs[nextTabs.length - 1]!.relativePath : null;
          });
          return nextTabs;
        });
      }
    },
    [activeRepository?.path],
  );

  const handleOpenRepositoryFileFromPanels = useCallback(
    (relativePath: string, opts?: GitPanelOpenFileOptions) => {
      if (isRepositoryBinaryPreviewPath(relativePath)) {
        void openRepositoryBinaryPreview(relativePath);
        return;
      }
      if (opts?.fromGitChanges) {
        void loadGitDiffFile(relativePath, opts.fromGitChanges);
        return;
      }
      void loadEditorFile(relativePath);
    },
    [loadEditorFile, loadGitDiffFile, openRepositoryBinaryPreview],
  );

  const handleCloseFileEditorPanel = useCallback(() => {
    const dirtyCount = fileEditorTabs.filter((t) => t.content !== t.originalContent).length;
    const clearAll = () => {
      setFileEditorTabs([]);
      setFileEditorActivePath(null);
      setEditorSaving(false);
    };
    if (dirtyCount === 0) {
      clearAll();
      return;
    }
    Modal.confirm({
      title: "关闭文件编辑面板？",
      content:
        dirtyCount === 1
          ? "当前有 1 个文件未保存，关闭后将丢失修改。"
          : `有 ${dirtyCount} 个文件未保存，关闭后将丢失修改。`,
      okText: "仍要关闭",
      okType: "danger",
      cancelText: "取消",
      centered: true,
      onOk: clearAll,
    });
  }, [fileEditorTabs]);

  const handleCloseFileEditorTab = useCallback(
    (relativePath: string, e?: MouseEvent) => {
      e?.stopPropagation();
      const tab = fileEditorTabs.find((t) => t.relativePath === relativePath);
      if (!tab) {
        return;
      }
      if (tab.content !== tab.originalContent) {
        Modal.confirm({
          title: "关闭文件标签？",
          content: `「${relativePath}」有未保存修改，关闭后将丢失。`,
          okText: "仍要关闭",
          okType: "danger",
          cancelText: "取消",
          centered: true,
          onOk: () => {
            removeFileEditorTab(relativePath);
          },
        });
        return;
      }
      removeFileEditorTab(relativePath);
    },
    [fileEditorTabs, removeFileEditorTab],
  );

  const handleSaveEditor = useCallback(async () => {
    if (!activeRepository?.path || !fileEditorActivePath) {
      return;
    }
    const tab = fileEditorTabs.find((t) => t.relativePath === fileEditorActivePath);
    if (!tab || tab.loading) {
      return;
    }
    if (tab.gitDiffSection === "staged") {
      message.info("暂存区与上一版本的对比为只读；要修改文件请在工作区编辑并保存。");
      return;
    }
    setEditorSaving(true);
    try {
      await writeProjectRelativeFile(activeRepository.path, fileEditorActivePath, tab.content);
      setFileEditorTabs((prev) =>
        prev.map((t) =>
          t.relativePath === fileEditorActivePath ? { ...t, originalContent: t.content } : t,
        ),
      );
      message.success("文件已保存");
    } catch (error) {
      console.error("Failed to save file:", error);
      message.error(`保存失败：${fileEditorActivePath}`);
    } finally {
      setEditorSaving(false);
    }
  }, [activeRepository?.path, fileEditorActivePath, fileEditorTabs]);

  useEffect(() => {
    if (!activeRepository?.path) {
      setFileEditorTabs([]);
      setFileEditorActivePath(null);
      setEditorSaving(false);
    }
  }, [activeRepository?.path]);

  const handleSidebarRepositorySelect = useCallback(
    (repositoryId: number | null) => {
      if (repositoryId == null) {
        setActiveRepositoryId(null);
        return;
      }
      const repository = repositories.find((item) => item.id === repositoryId);
      if (!repository) {
        return;
      }
      const ownerProject = projects.find((p) => p.repositoryIds.includes(repositoryId));
      if (ownerProject) {
        selectProjectAndRepository(ownerProject.id, repositoryId);
      } else {
        setActiveRepositoryId(repositoryId);
      }
      const boundId = resolveBoundMainSessionId(repository.path, repositoryMainSessionBindings, sessions);
      if (boundId) {
        switchSession(boundId);
        return;
      }
      const latestForRepo = pickSessionForRepositorySidebarSelect(
        sessions,
        repository.path,
        loadSessionOwnerHints(),
      );
      if (latestForRepo) {
        bindRepositoryMainSession(repository.path, latestForRepo.id);
        switchSession(latestForRepo.id);
        return;
      }
      void (async () => {
        const id = await createSession(repository.path, repositoryFolderBasename(repository));
        bindRepositoryMainSession(repository.path, id);
      })();
    },
    [
      bindRepositoryMainSession,
      createSession,
      projects,
      repositories,
      repositoryMainSessionBindings,
      selectProjectAndRepository,
      sessions,
      setActiveRepositoryId,
      switchSession,
    ],
  );

  /** 进入应用：仓库与会话 hydrated 后，打开侧栏排序第一项项目下第一个仓库的主会话（与 `useRepositoryList` 默认项一致）。 */
  const startupFirstProjectRepoSessionAppliedRef = useRef(false);
  useEffect(() => {
    if (repositoryListLoading || !tabsHydrated) return;
    if (startupFirstProjectRepoSessionAppliedRef.current) return;
    const firstProject = projects[0];
    if (!firstProject?.repositoryIds?.length) return;
    const firstRepoId = firstProject.repositoryIds[0];
    if (!repositories.some((r) => r.id === firstRepoId)) return;
    startupFirstProjectRepoSessionAppliedRef.current = true;
    handleSidebarRepositorySelect(firstRepoId);
  }, [
    handleSidebarRepositorySelect,
    projects,
    repositories,
    repositoryListLoading,
    tabsHydrated,
  ]);

  const handleSidebarRepositorySelectLeavingMcpHub = useCallback(
    (repositoryId: number | null) => {
      setMcpHubMode(false);
      setSkillsHubMode(false);
      handleSidebarRepositorySelect(repositoryId);
    },
    [handleSidebarRepositorySelect],
  );

  const handleProjectSelectLeavingMcpHub = useCallback(
    (projectId: string) => {
      setMcpHubMode(false);
      setSkillsHubMode(false);
      setActiveProjectId(projectId);
    },
    [setActiveProjectId],
  );

  const jumpToSessionLeavingMcpHub = useCallback(
    (sessionId: string) => {
      setMcpHubMode(false);
      setSkillsHubMode(false);
      jumpToSessionWithRepository(sessionId);
    },
    [jumpToSessionWithRepository],
  );

  async function openEmployeeConfigWithContext() {
    setEmployeeConfigDefaultRepositoryIds(activeRepositoryId ? [activeRepositoryId] : []);
    try {
      const subagents = await listClaudeSubagents(activeRepository?.path ?? null);
      const sorted = [...subagents].sort((a, b) => {
        if (a.isCollaborationMode !== b.isCollaborationMode) {
          return a.isCollaborationMode ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      const merged = Array.from(new Set(["executor", ...sorted.map((item) => item.name)]));
      setEmployeeAgentTypeOptions(merged);
    } catch (error) {
      console.error("Failed to load claude subagents:", error);
      setEmployeeAgentTypeOptions(["executor"]);
    }
    setEmployeeConfigOpen(true);
  }

  async function handleCreateRepositoryTask(repository: Repository, mode: TaskMode) {
    const ownerProject = projects.find((p) => p.repositoryIds.includes(repository.id));
    if (ownerProject) {
      selectProjectAndRepository(ownerProject.id, repository.id);
    } else {
      setActiveRepositoryId(repository.id);
    }
    if (mode === "chat") {
      const id = await createSession(repository.path, repositoryFolderBasename(repository));
      bindRepositoryMainSession(repository.path, id);
      return;
    }
    if (mode === "split") {
      setSearchOpen(false);
      setPromptsMode(false);
      setTaskSplitMode(true);
      return;
    }
    const sessionId = await createSession(repository.path, repositoryFolderBasename(repository));
    executeSession(
      sessionId,
      applyTemplate(repositorySplitTemplate || DEFAULT_REPOSITORY_SPLIT_TEMPLATE, {
        repoName: repositoryFolderBasename(repository),
        repoType: repositoryTypeChineseLabel(repository.repositoryType),
        repoPath: repository.path,
      }),
    );
  }

  async function handleCreateProjectTask(project: ProjectItem, mode: TaskMode) {
    const byId = new Map(repositories.map((repo) => [repo.id, repo]));
    const repos = project.repositoryIds
      .map((id) => byId.get(id))
      .filter((repo): repo is Repository => Boolean(repo));
    if (repos.length === 0) {
      message.warning("该项目下暂无仓库，请先关联仓库");
      return;
    }
    const primaryRepo = repos[0];
    setActiveProjectId(project.id);
    setActiveRepositoryId(primaryRepo.id);
    if (mode === "chat") {
      const id = await createSession(primaryRepo.path, `${project.name}/${repositoryFolderBasename(primaryRepo)}`);
      bindRepositoryMainSession(primaryRepo.path, id);
      return;
    }
    if (mode === "split") {
      setSearchOpen(false);
      setPromptsMode(false);
      setTaskSplitMode(true);
      return;
    }
    const sessionId = await createSession(primaryRepo.path, `${project.name}/${repositoryFolderBasename(primaryRepo)}`);
    const repoPaths = repos.map((repo) => `- ${repo.path}`).join("\n");
    executeSession(
      sessionId,
      applyTemplate(projectSplitTemplate || DEFAULT_PROJECT_SPLIT_TEMPLATE, {
        projectName: project.name,
        repoName: repositoryFolderBasename(primaryRepo),
        repoPath: primaryRepo.path,
        repoList: repoPaths,
      }),
    );
  }

  function handleOpenInFinder(repository: Repository) {
    openInFinder(repository.path).catch((err) => {
      console.error("Failed to open in finder:", err);
    });
  }

  function handleOpenPromptsForProject(project: ProjectItem) {
    setMcpHubMode(false);
    setSkillsHubMode(false);
    setPromptsOpenContext({ project });
    setActiveProjectId(project.id);
    setSearchOpen(false);
    setTaskSplitMode(false);
    setPromptsMode(true);
  }

  function handleOpenPromptsForRepository(project: ProjectItem, repository: Repository) {
    setMcpHubMode(false);
    setSkillsHubMode(false);
    setPromptsOpenContext({ project, repository });
    setActiveProjectId(project.id);
    setActiveRepositoryId(repository.id);
    setSearchOpen(false);
    setTaskSplitMode(false);
    setPromptsMode(true);
  }

  async function handleComposerExecute(
    sessionId: string,
    prompt: string,
    dispatchTarget?: Pick<PendingExecutionTask, "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName">,
    executeOptions?: ClaudeComposerExecuteBubbleOptions,
  ): Promise<boolean> {
    const runExecute = (targetSid: string, promptText: string) => {
      const sameTab = targetSid === sessionId;
      const replaceAt =
        executeOptions?.replaceUserBubbleAtIndex !== undefined &&
        Number.isFinite(executeOptions.replaceUserBubbleAtIndex) &&
        sameTab
          ? Math.floor(executeOptions.replaceUserBubbleAtIndex)
          : undefined;
      const replaceLast =
        executeOptions?.replaceLastUserBubble === true && sameTab && replaceAt === undefined;
      const replaceFirst =
        executeOptions?.replaceFirstUserBubble === true && sameTab && !replaceLast && replaceAt === undefined;
      return executeSession(
        targetSid,
        promptText,
        replaceAt !== undefined
          ? { replaceUserBubbleAtIndex: replaceAt }
          : replaceLast
            ? { replaceLastUserBubble: true }
            : replaceFirst
              ? { replaceFirstUserBubble: true }
              : undefined,
      );
    };
    notificationHub.setControlDockMirror(sessionId, null);
    /** 实际跑在「员工:」子标签时，把控制 Dock 镜像到主会话（优先仓库绑定 id，否则同仓库第一个非员工标签） */
    const applyEmployeeControlDockMirror = (targetTid: string, dispatchFromTid: string) => {
      const targetSess = sessions.find((item) => item.id === targetTid);
      if (!targetSess) return;
      if (!extractBoundEmployeeNameFromDisplay(targetSess.repositoryName ?? "")) return;
      const pathKey = normalizeRepositoryPathForMatch(targetSess.repositoryPath);
      let viewer: string | null =
        resolveBoundMainSessionId(targetSess.repositoryPath, repositoryMainSessionBindings, sessions) ?? null;
      if (!viewer || viewer === targetTid) {
        const fb = sessions.find((s) => isRepositoryMainSessionTab(s, pathKey) && s.id !== targetTid);
        viewer = fb?.id ?? null;
      }
      if (!viewer || viewer === targetTid) {
        if (dispatchFromTid !== targetTid) viewer = dispatchFromTid;
        else return;
      }
      notificationHub.setControlDockMirror(viewer, targetTid);
    };
    let executePrompt = prompt;
    let targetSessionId = sessionId;
    const session = sessions.find((item) => item.id === sessionId);
    if (session) {
      const mentionedEmployees = employees
        .filter((employee) => !isOmcMonitorEmployeeRecord(employee))
        .map((employee) => ({
          employee,
          mentionIndex: prompt.indexOf(`@${employee.name}`),
        }))
        .filter((entry) => entry.mentionIndex >= 0)
        .sort((left, right) => left.mentionIndex - right.mentionIndex)
        .map((entry) => entry.employee);
      const explicitTargetType = dispatchTarget?.targetType ?? "main";
      const explicitTargetEmployeeName = dispatchTarget?.targetEmployeeName?.trim();
      const explicitTargetWorkflowId = dispatchTarget?.targetWorkflowId?.trim();
      const explicitTargetWorkflowName = dispatchTarget?.targetWorkflowName?.trim();
      if (explicitTargetType === "employee") {
        const targetEmployeeRaw =
          (explicitTargetEmployeeName
            ? employees.find((employee) => employee.name.trim() === explicitTargetEmployeeName)
            : undefined) ?? mentionedEmployees[0];
        const targetEmployee =
          targetEmployeeRaw && !isOmcMonitorEmployeeRecord(targetEmployeeRaw) ? targetEmployeeRaw : undefined;
        let executeAfterCreate = false;
        if (targetEmployee) {
          const agentType = targetEmployee.agentType?.trim();
          const trimmedPrompt = executePrompt.trimStart();
          const hasLeadingSlashCommand = trimmedPrompt.startsWith("/");
          if (agentType && !hasLeadingSlashCommand) {
            executePrompt = `/${agentType}\n${executePrompt}`;
          }
          const { sessionId: resolvedEmployeeSessionId, deferExecute } = await ensureEmployeeWorkerTabSessionId(
            session.repositoryPath,
            session.repositoryName,
            targetEmployee,
          );
          targetSessionId = resolvedEmployeeSessionId;
          executeAfterCreate = deferExecute;
        }
        if (!targetEmployee) {
          // 员工定向任务不应回落到团队流程；匹配失败时降级回主会话直接执行。
          return runExecute(sessionId, executePrompt) !== false;
        }
        appendSystemMessage(
          sessionId,
          [
            "任务分发记录",
            `- 类型：员工独立会话`,
            `- 目标：${targetEmployee.name}`,
            `- 分发会话：${targetSessionId}`,
            `- 时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
          ].join("\n"),
        );
        // 流式写入员工桶；主会话（仓库绑定）Composer 展示 AskUserQuestion / Permission
        applyEmployeeControlDockMirror(targetSessionId, sessionId);
        if (executeAfterCreate) {
          // 双 rAF：等 React 提交新会话后再 execute，避免 sessionsRef 未命中；返回值用于待办出队判断
          return await new Promise<boolean>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve(runExecute(targetSessionId, executePrompt) !== false);
              });
            });
          });
        }
        return runExecute(targetSessionId, executePrompt) !== false;
      }
      const templatesByNameLen = [...workflowTemplates].sort((a, b) => b.name.length - a.name.length);
      const publishedTemplates = workflowTemplates.filter(
        (item) => (workflowGraphStatusByWorkflowId[item.id] ?? "").toLowerCase() === "published",
      );
      const genericTeamMentionMatched = prompt.includes("@团队") || prompt.includes("＠团队");
      const teamDispatchRequested = explicitTargetType === "team" || genericTeamMentionMatched;
      const explicitTeam =
        explicitTargetType === "team"
          ? (explicitTargetWorkflowId
              ? workflowTemplates.find((item) => item.id === explicitTargetWorkflowId)
              : undefined) ??
            (explicitTargetWorkflowName
              ? workflowTemplates.find((item) => item.name.trim() === explicitTargetWorkflowName)
              : undefined) ??
            (genericTeamMentionMatched ? publishedTemplates[0] : undefined)
          : undefined;
      const mentionedTeam =
        explicitTeam ?? templatesByNameLen.find((t) => prompt.includes(`@${t.name}`));
      if (teamDispatchRequested && !mentionedTeam) {
        const warningText = "未找到可用团队流程，请先在「团队」中发布至少一个流程。";
        message.warning(warningText);
        appendSystemMessage(sessionId, warningText);
        return false;
      }
      if (mentionedTeam) {
        try {
          const taskTitle = prompt.split("\n")[0]?.slice(0, 80) || "新任务";
          const task = await createWorkflowTask({
            title: taskTitle,
            content: prompt,
            creator: sessionId,
            workflowId: mentionedTeam?.id,
          });
          setWorkflowTasks((prev) => [task, ...prev]);
          const events = await listTaskEvents(task.id);
          const pendingEmployees = await listTaskPendingEmployees(task.id);
          setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [task.id]: events }));
          setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [task.id]: pendingEmployees }));
          appendSystemMessage(
            sessionId,
            [
              "任务分发记录",
              `- 类型：团队流程`,
              `- 目标：${mentionedTeam.name}`,
              `- 任务ID：${task.id}`,
              `- 时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
            ].join("\n"),
          );
          try {
            logWorkflowTrace("team.dispatch.bootstrap.start", {
              taskId: task.id,
              workflowId: task.workflowId,
              sessionId,
            });
            const graphItem = await getWorkflowGraph({ workflowId: task.workflowId });
            if (graphItem?.graph?.nodes?.length) {
              const runtimeState = createWorkflowRuntimeState(graphItem.graph);
              const firstStep = advanceWorkflowGraph({
                graph: graphItem.graph,
                state: runtimeState,
                startContent: task.content,
              });
              setWorkflowRuntimeStateByTaskId((prev) => ({ ...prev, [task.id]: firstStep.state }));
              if (firstStep.dispatch) {
                logWorkflowTrace("team.dispatch.bootstrap.next", {
                  taskId: task.id,
                  nodeId: firstStep.dispatch.nodeId,
                  nodeType: firstStep.dispatch.nodeType,
                  employeeName: firstStep.dispatch.employeeName,
                });
                const dispatchSnapshot: WorkflowRuntimeStepSnapshot = {
                  id: `${task.id}-dispatch-${Date.now()}`,
                  taskId: task.id,
                  phase: "dispatch",
                  fromNodeId: firstStep.state.lastNodeId,
                  toNodeId: firstStep.dispatch.nodeId,
                  toNodeName: firstStep.dispatch.employeeName,
                  toNodeType: firstStep.dispatch.nodeType,
                  inputPreview: snapshotTeamWorkerExecuteInput(firstStep.dispatch, employees, pendingEmployees),
                  outputPreview: "(待执行)",
                  createdAt: Date.now(),
                };
                setWorkflowRuntimeSnapshotsByTaskId((prev) => ({
                  ...prev,
                  [task.id]: [...(prev[task.id] ?? []), dispatchSnapshot],
                }));
                try {
                  const runtimeEvent = await appendTaskEvent({
                    taskId: task.id,
                    eventType: "workflow_runtime_snapshot",
                    payloadJson: JSON.stringify({
                      action: "runtime_snapshot",
                      snapshot: dispatchSnapshot,
                    }),
                  });
                  setWorkflowTaskEventsByTaskId((prev) => ({
                    ...prev,
                    [task.id]: [...(prev[task.id] ?? []), runtimeEvent],
                  }));
                } catch (runtimeEventError) {
                  console.error("Failed to persist workflow runtime dispatch snapshot:", runtimeEventError);
                }
                await dispatchTeamStepToEmployeeSession({
                  task,
                  dispatch: {
                    employeeId: firstStep.dispatch.employeeId,
                    employeeName: firstStep.dispatch.employeeName,
                    nodeType: firstStep.dispatch.nodeType,
                    input: firstStep.dispatch.input,
                  },
                  previousNodeLabel: "开始",
                });
              } else {
                appendSystemMessage(sessionId, `团队流程「${mentionedTeam.name}」未找到可执行节点。`);
              }
            }
          } catch (runtimeError) {
            console.error("Failed to bootstrap workflow graph runtime:", runtimeError);
          }
        } catch (error) {
          console.error("Failed to create workflow task from mention:", error);
          const errorText = error instanceof Error ? error.message : String(error);
          const warningText = `团队任务创建失败：${errorText || "未知错误"}`;
          message.error(warningText);
          appendSystemMessage(sessionId, warningText);
          return false;
        }
        return true;
      } else if (mentionedEmployees.length > 0) {
        // Guardrail: @员工 仅走单会话执行，不应触发团队 workflow 任务创建。
        // 否则会回退到后端默认工作流，造成“@员工却走团队执行”的回归。
        const targetEmployee = mentionedEmployees[0];
        const agentType = targetEmployee?.agentType?.trim();
        const trimmedPrompt = executePrompt.trimStart();
        const hasLeadingSlashCommand = trimmedPrompt.startsWith("/");
        if (agentType && !hasLeadingSlashCommand) {
          executePrompt = `/${agentType}\n${executePrompt}`;
        }
      }
    }
    applyEmployeeControlDockMirror(targetSessionId, sessionId);
    return runExecute(targetSessionId, executePrompt) !== false;
  }

  function handleSendMessageWithTask(prompt: string) {
    if (!activeSessionId) {
      return;
    }
    void handleComposerExecute(activeSessionId, prompt);
  }

  async function refreshEmployeeData() {
    const [employeeList, counts] = await Promise.all([listEmployees(), listEmployeeTaskCounts()]);
    setEmployees(employeeList);
    setEmployeeTaskCounts(counts);
  }

  const handleClaudeTurnComplete = useCallback(
    async (payload: ClaudeTurnCompletePayload) => {
      const payloadSessionId = payload.sessionId?.trim();
      if (!payloadSessionId) {
        return;
      }
      const session =
        sessions.find((item) => item.id === payloadSessionId) ??
        sessions.find((item) => item.claudeSessionId?.trim() === payloadSessionId);

      const tabKeyForDingTalk = session?.id ?? payloadSessionId;
      const previewStrippedForDingTalk = stripAssistantStreamNoiseForDingTalkExport(
        payload.assistantPreviewRaw ?? "",
      ).trim();
      const resolvedAssistantForDingTalk = resolveDingTalkAutomationAssistantBody(
        session,
        payload.assistantPreviewRaw ?? "",
      ).trim();
      const dingTalkMergedFinal =
        resolvedAssistantForDingTalk || previewStrippedForDingTalk;

      const flushDingTalkAutomationReply = (markdown: string, title?: string) => {
        const pending = dingTalkAutomationPendingRef.current.get(tabKeyForDingTalk);
        if (!pending) return;
        const uid = pending.dingTalkUserId;
        const uxKey = pending.uxMessageKey;
        clearDingTalkAutomationPendingAndResolveInboundJob(tabKeyForDingTalk);
        message.destroy(uxKey);
        void sendDingTalkWiseAutomationReplyMarkdown(uid, markdown, title)
          .then(() => {
            void message.success({ content: "钉钉：处理结果已发回单聊", duration: 2.5 });
          })
          .catch((err) => {
            console.error("DingTalk automation reply failed:", err);
            void message.error(err instanceof Error ? err.message : "回发钉钉失败");
          });
      };

      if (!payload.success) {
        flushDingTalkAutomationReply(dingTalkMergedFinal || "处理未成功");
        return;
      }

      const boundTaskId =
        workflowTaskByWorkerSessionRef.current.get(payloadSessionId) ??
        (session ? workflowTaskByWorkerSessionRef.current.get(session.id) : undefined) ??
        (session?.claudeSessionId?.trim()
          ? workflowTaskByWorkerSessionRef.current.get(session.claudeSessionId.trim())
          : undefined);
      const mergedForWorkflow = mergeAssistantPlainTextPreferLonger(payload.assistantPreviewRaw ?? "", session);
      if (dingTalkAutomationPendingRef.current.get(tabKeyForDingTalk)) {
        flushDingTalkAutomationReply(dingTalkMergedFinal || "（本轮无可见文本输出）");
      }
      const output = mergedForWorkflow.trim();
      if (!output.trim()) {
        return;
      }
      let task: WorkflowTaskItem | undefined;
      const tasksNow = workflowTasksRef.current;
      const runtimeNow = workflowRuntimeStateByTaskIdRef.current;
      const pendingNow = taskPendingEmployeesByTaskIdRef.current;
      if (boundTaskId) {
        task = tasksNow.find((item) => item.id === boundTaskId);
      } else if (session && lastUserMessageIsTeamAutoDriver(session)) {
        const mergedTasks = candidateInProgressTasksForSession(session, tasksNow).filter((t) => runtimeNow[t.id]);
        mergedTasks.sort((a, b) => b.updatedAt - a.updatedAt);
        task = mergedTasks[0];
      }
      if (!task && session) {
        const employeeName = extractBoundEmployeeNameFromSessionRepositoryName(session.repositoryName);
        const employeeId = employeeName ? employees.find((item) => item.name.trim() === employeeName.trim())?.id : undefined;
        if (employeeName || employeeId) {
          const fallbackTasks = tasksNow
            .filter((item) => item.status === "in_progress")
            .filter((item) => {
              const owner =
                sessions.find((s) => s.id === item.creator) ??
                sessions.find((s) => s.claudeSessionId != null && s.claudeSessionId === item.creator);
              return owner?.repositoryPath === session.repositoryPath;
            })
            .filter((item) => runtimeNow[item.id])
            .filter((item) => {
              const pending = pendingNow[item.id] ?? [];
              return pending.some((p) => {
                if (employeeId && p.employeeId === employeeId) return true;
                return employeeName ? p.name.trim() === employeeName.trim() : false;
              });
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);
          task = fallbackTasks[0];
        }
      }
      if (!task) return;
      const runtimeState = runtimeNow[task.id];
      if (!runtimeState) {
        return;
      }
      try {
        const graphItem = await getWorkflowGraph({ workflowId: task.workflowId });
        if (!graphItem?.graph?.nodes?.length) {
          return;
        }

        const currentNode = graphItem.graph.nodes.find((n) => n.id === runtimeState.currentNodeId) as
          | WorkflowGraphNode
          | undefined;
        if (!currentNode || currentNode.type === "start" || currentNode.type === "end") {
          return;
        }

        let acceptanceDecision: AcceptanceDecision | undefined;
        let updatedTaskAfterDecision: WorkflowTaskItem | undefined;
        let pendingEmployeesAfterDecision: Array<{ employeeId: string; name: string }> | undefined;
        const currentNodeAcceptanceEnabled =
          currentNode.type === "approval" && currentNode.data.conditionElsePrompt?.trim() === "acceptance_enabled";

        // 任务节点产出只推进了画布运行时，未同步 DB：current_stage_index 仍停在「执行阶段」，
        // 后续审批节点调用 decide 时 stage_id 对不上审批人，UPDATE 0 行导致永远无法 should_advance。
        // 在离开任务节点前，将当前执行人记为对当前阶段的 approved，与 workflow_stages / task_stage_decisions 对齐。
        if (currentNode.type === "task") {
          const taskEmpId = currentNode.data.employeeId?.trim();
          if (taskEmpId) {
            try {
              const stageIndexBeforeDecide =
                workflowTasksRef.current.find((x) => x.id === task.id)?.currentStageIndex ?? task.currentStageIndex;
              const updatedTask = await decideWorkflowTaskStage({
                taskId: task.id,
                employeeId: taskEmpId,
                decision: "approved",
                reason: "节点执行输出完成",
              });
              updatedTaskAfterDecision = updatedTask;
              setWorkflowTasks((prev) => prev.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
              const events = await listTaskEvents(updatedTask.id);
              const pendingEmployees = await listTaskPendingEmployees(updatedTask.id);
              pendingEmployeesAfterDecision = pendingEmployees;
              setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
              setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
              // 必须用 decide 前的最新 DB 阶段索引；驳回回退后闭包里的 task 仍可能是回退前的索引，会误判为「未推进」并提前 return。
              const stageUnchanged = updatedTask.currentStageIndex === stageIndexBeforeDecide;
              if (stageUnchanged && pendingEmployees.length > 0) {
                logWorkflowTrace("team.task.stage_pending_others", {
                  taskId: task.id,
                  nodeId: currentNode.id,
                  pendingCount: pendingEmployees.length,
                });
                await refreshEmployeeData();
                return;
              }
            } catch (e) {
              console.error("Team auto: decideWorkflowTaskStage (task node) failed:", e);
              return;
            }
          }
        }

        if (currentNode.type === "approval") {
          if (currentNodeAcceptanceEnabled) {
            const outputHash = await sha256Hex(output.trim());
            const correlationId = `${task.id}|${currentNode.id}|${outputHash}`;
            const existingEvents = workflowTaskEventsByTaskIdRef.current[task.id] ?? [];
            if (acceptanceCompletionGuardRef.current.has(correlationId) || existingEvents.some((e: WorkflowTaskEventItem) => eventHasCorrelationId(e, correlationId))) {
              logWorkflowTrace("team.decision.duplicate_completion_skipped", {
                taskId: task.id,
                nodeId: currentNode.id,
                correlationId,
              });
              return;
            }
            acceptanceCompletionGuardRef.current.add(correlationId);
            const structuredParsed = parseAcceptanceVerdictPayload(payload.structuredVerdict);
            const verdictResolution = (() => {
              if (structuredParsed.ok) {
                return {
                  ok: true as const,
                  gate: "schema" as const,
                  decision: structuredParsed.value.workflowAcceptanceVerdict === "approve" ? "pass" as const : "reject" as const,
                  payload: structuredParsed.value,
                };
              }
              if (workflowVerdictMode === "structured_only") {
                return { ok: false as const };
              }
              if (workflowVerdictMode === "heuristic") {
                const inferred = resolveAcceptanceVerdictWithGate(output, {
                  taskId: task.id,
                  graphNodeId: currentNode.id,
                });
                if (!inferred.ok) return inferred;
                return { ...inferred, gate: "inferred" as const };
              }
              return resolveAcceptanceVerdictWithGate(output, {
                taskId: task.id,
                graphNodeId: currentNode.id,
              });
            })();
            const verdictSource =
              structuredParsed.ok ? "complete_payload" : workflowVerdictMode === "structured_only" ? "structured_only" : "output_fallback";
            const unresolvedReason =
              workflowVerdictMode === "structured_only"
                ? payload.structuredVerdict == null
                  ? "structured_missing"
                  : "structured_invalid"
                : "parse_failed";
            if (!verdictResolution.ok) {
              try {
                const unresolvedEvent = await appendTaskEvent({
                  taskId: task.id,
                  eventType: WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_UNRESOLVED,
                  payloadJson: JSON.stringify({
                    schemaVersion: 1,
                    taskId: task.id,
                    graphNodeId: currentNode.id,
                    currentStageIndex: task.currentStageIndex,
                    source: "claude_turn_complete",
                    correlationId,
                    payloadSha256: outputHash,
                    reason: unresolvedReason,
                    verdictSource,
                    verdictMode: workflowVerdictMode,
                    outputChars: output.length,
                    createdAt: Date.now(),
                  }),
                });
                setWorkflowTaskEventsByTaskId((prev) => ({
                  ...prev,
                  [task.id]: [...(prev[task.id] ?? []), unresolvedEvent],
                }));
              } catch (verdictEventError) {
                console.error("Failed to persist acceptance unresolved event:", verdictEventError);
              }
              logWorkflowTrace("team.decision.pending_manual", {
                taskId: task.id,
                nodeId: currentNode.id,
                outputPreview: makePreviewText(output),
              });
              return;
            }
            acceptanceDecision = verdictResolution.decision;
            try {
              const verdictPayloadBase = {
                schemaVersion: 1,
                taskId: task.id,
                graphNodeId: currentNode.id,
                nodeId: currentNode.id,
                currentStageIndex: task.currentStageIndex,
                workflowAcceptanceVerdict: verdictResolution.decision === "pass" ? "approve" : "reject",
                acceptanceGate: verdictResolution.gate,
                verdictSource,
                verdictMode: workflowVerdictMode,
                fromStructuredVerdict: structuredParsed.ok,
                source: "claude_turn_complete",
                correlationId,
                payloadSha256: outputHash,
                outputChars: output.length,
                createdAt: Date.now(),
                ...(verdictResolution.gate === "schema"
                  ? {
                      validatedVerdictPayload: verdictResolution.payload,
                    }
                  : {}),
              };
              const verdictEvent = await appendTaskEvent({
                taskId: task.id,
                eventType: WORKFLOW_EVENT_TYPE_ACCEPTANCE_VERDICT_SUBMITTED,
                payloadJson: JSON.stringify(verdictPayloadBase),
              });
              setWorkflowTaskEventsByTaskId((prev) => ({
                ...prev,
                [task.id]: [...(prev[task.id] ?? []), verdictEvent],
              }));
            } catch (verdictEventError) {
              console.error("Failed to persist acceptance verdict event:", verdictEventError);
            }
            logWorkflowTrace("team.decision.auto", {
              taskId: task.id,
              nodeId: currentNode.id,
              decision: verdictResolution.decision,
              acceptanceGate: verdictResolution.gate,
              verdictSource,
              verdictMode: workflowVerdictMode,
              fromStructuredVerdict: structuredParsed.ok,
            });
          }
          const pendingForDecide = taskPendingEmployeesByTaskIdRef.current[task.id] ?? [];
          const nodeEmpId = currentNode.data.employeeId?.trim();
          const empId =
            nodeEmpId && pendingForDecide.some((p) => p.employeeId === nodeEmpId)
              ? nodeEmpId
              : pendingForDecide.length === 1
                ? pendingForDecide[0]!.employeeId.trim()
                : nodeEmpId ?? pendingForDecide[0]?.employeeId?.trim() ?? "";
          if (currentNodeAcceptanceEnabled && !empId) {
            logWorkflowTrace("team.decision.pending_manual", {
              taskId: task.id,
              nodeId: currentNode.id,
              reason: "approval_node_employee_missing",
            });
            return;
          }
          if (empId) {
            try {
              const nodeDecision = currentNodeAcceptanceEnabled ? acceptanceDecision : "pass";
              const updatedTask = await decideWorkflowTaskStage({
                taskId: task.id,
                employeeId: empId,
                decision: nodeDecision === "pass" ? "approved" : "rejected",
                reason: currentNodeAcceptanceEnabled
                  ? nodeDecision === "pass"
                    ? "自动验收：通过"
                    : "自动验收：驳回"
                  : "自动流转到下一阶段",
              });
              updatedTaskAfterDecision = updatedTask;
              setWorkflowTasks((prev) => prev.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
              const events = await listTaskEvents(updatedTask.id);
              const pendingEmployees = await listTaskPendingEmployees(updatedTask.id);
              pendingEmployeesAfterDecision = pendingEmployees;
              setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
              setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
            } catch (e) {
              console.error("Team auto: decideWorkflowTaskStage failed:", e);
              return;
            }
          }
        }

        if (
          currentNodeAcceptanceEnabled &&
          acceptanceDecision === "reject" &&
          updatedTaskAfterDecision &&
          updatedTaskAfterDecision.status === "in_progress"
        ) {
          const rollbackPending = pendingEmployeesAfterDecision ?? [];
          const stageNodes = orderedExecutableNodes(graphItem.graph);
          const rollbackNode = stageNodes[updatedTaskAfterDecision.currentStageIndex];
          const rollbackEmployeeId = rollbackPending[0]?.employeeId ?? rollbackNode?.data.employeeId;
          const rollbackEmployeeName = rollbackPending[0]?.name ?? rollbackNode?.data.label ?? "回退阶段执行";
          if (rollbackEmployeeId) {
            const rollbackDispatch = {
              employeeId: rollbackEmployeeId,
              employeeName: rollbackEmployeeName,
              nodeType: rollbackNode ? resolveWorkflowDispatchNodeType(rollbackNode) : ("task" as WorkflowGraphNodeType),
              input: rollbackNode
                ? composeDispatchInput(rollbackNode, task.content, graphItem.graph)
                : task.content.trim(),
            };
            setWorkflowRuntimeStateByTaskId((prev) => ({
              ...prev,
              [task.id]: {
                ...runtimeState,
                currentNodeId: rollbackNode?.id ?? runtimeState.currentNodeId,
                lastOutput: output,
                trace: rollbackNode ? [...runtimeState.trace, rollbackNode.id] : runtimeState.trace,
              },
            }));
            let filledDispatchSnapshotIdForReject: string | undefined;
            let rollbackDispatchSnapshotForReject: WorkflowRuntimeStepSnapshot | undefined;
            setWorkflowRuntimeSnapshotsByTaskId((prev) => {
              const nextSnapshots = [...(prev[task.id] ?? [])];
              if (output.trim()) {
                const latestDispatchIndex = [...nextSnapshots]
                  .reverse()
                  .findIndex((item) => item.phase === "dispatch" && item.outputPreview === "(待执行)");
                if (latestDispatchIndex >= 0) {
                  const targetIndex = nextSnapshots.length - 1 - latestDispatchIndex;
                  filledDispatchSnapshotIdForReject = nextSnapshots[targetIndex].id;
                  nextSnapshots[targetIndex] = {
                    ...nextSnapshots[targetIndex],
                    outputPreview: snapshotWorkflowAssistantOutput(output),
                  };
                }
              }
              const rollbackDispatchSnapshot: WorkflowRuntimeStepSnapshot = {
                id: `${task.id}-dispatch-${Date.now()}`,
                taskId: task.id,
                phase: "dispatch",
                fromNodeId: runtimeState.currentNodeId,
                toNodeId: rollbackNode?.id,
                toNodeName: rollbackDispatch.employeeName,
                toNodeType: rollbackDispatch.nodeType,
                inputPreview: snapshotTeamWorkerExecuteInput(rollbackDispatch, employees, rollbackPending),
                outputPreview: "(待执行)",
                createdAt: Date.now(),
              };
              rollbackDispatchSnapshotForReject = rollbackDispatchSnapshot;
              nextSnapshots.push(rollbackDispatchSnapshot);
              return {
                ...prev,
                [task.id]: nextSnapshots,
              };
            });
            if (output.trim() && filledDispatchSnapshotIdForReject) {
              try {
                const updateEvent = await appendTaskEvent({
                  taskId: task.id,
                  eventType: "workflow_runtime_snapshot_update",
                  payloadJson: JSON.stringify({
                    action: "runtime_snapshot_output_update",
                    snapshotId: filledDispatchSnapshotIdForReject,
                    outputPreview: snapshotWorkflowAssistantOutput(output),
                    createdAt: Date.now(),
                  }),
                });
                setWorkflowTaskEventsByTaskId((prev) => ({
                  ...prev,
                  [task.id]: [...(prev[task.id] ?? []), updateEvent],
                }));
              } catch (runtimeUpdateEventError) {
                console.error("Failed to persist workflow runtime snapshot update (reject rollback):", runtimeUpdateEventError);
              }
            }
            if (rollbackDispatchSnapshotForReject) {
              try {
                const rollbackRuntimeEvent = await appendTaskEvent({
                  taskId: task.id,
                  eventType: "workflow_runtime_snapshot",
                  payloadJson: JSON.stringify({
                    action: "runtime_snapshot",
                    snapshot: rollbackDispatchSnapshotForReject,
                  }),
                });
                setWorkflowTaskEventsByTaskId((prev) => ({
                  ...prev,
                  [task.id]: [...(prev[task.id] ?? []), rollbackRuntimeEvent],
                }));
              } catch (runtimeEventError) {
                console.error("Failed to persist workflow runtime rollback dispatch snapshot:", runtimeEventError);
              }
            }
            await dispatchTeamStepToEmployeeSession({
              task: updatedTaskAfterDecision,
              dispatch: rollbackDispatch,
              previousNodeLabel: currentNode.data.label,
              decision: "reject",
            });
            await refreshEmployeeData();
            return;
          }
        }

        const nextStep = advanceWorkflowGraph({
          graph: graphItem.graph,
          state: runtimeState,
          startContent: task.content,
          lastOutput: output,
          acceptanceDecision: currentNode.type === "approval" ? acceptanceDecision : undefined,
        });
        let effectiveDispatch = nextStep.dispatch;
        let effectiveState = nextStep.state;
        let effectiveCompleted = nextStep.completed;
        if (
          currentNodeAcceptanceEnabled &&
          acceptanceDecision === "reject" &&
          updatedTaskAfterDecision &&
          updatedTaskAfterDecision.status === "in_progress"
        ) {
          const stageNodes = orderedExecutableNodes(graphItem.graph);
          const rollbackNode = stageNodes[updatedTaskAfterDecision.currentStageIndex];
          const pendingFallback = pendingEmployeesAfterDecision?.[0];
          const fallbackEmployeeId = pendingFallback?.employeeId ?? rollbackNode?.data.employeeId;
          const fallbackEmployeeName = pendingFallback?.name ?? rollbackNode?.data.label ?? "回退阶段执行";
          if (fallbackEmployeeId) {
            effectiveDispatch = {
              nodeId: rollbackNode?.id ?? `rollback-fallback-${task.id}`,
              nodeType: rollbackNode?.type ?? "task",
              employeeId: fallbackEmployeeId,
              employeeName: fallbackEmployeeName,
              input: rollbackNode
                ? composeDispatchInput(rollbackNode, task.content, graphItem.graph)
                : task.content.trim(),
            };
            effectiveState = {
              ...nextStep.state,
              currentNodeId: rollbackNode?.id ?? nextStep.state.currentNodeId,
            };
            effectiveCompleted = false;
          }
        }
        logWorkflowTrace("team.advance.next", {
          taskId: task.id,
          currentNodeId: runtimeState.currentNodeId,
          nextNodeId: effectiveState.currentNodeId,
          completed: effectiveCompleted,
          hasDispatch: Boolean(effectiveDispatch),
        });

        const decision: "pass" | "reject" | undefined =
          currentNode.type === "approval" && currentNodeAcceptanceEnabled ? acceptanceDecision : undefined;

        const pendingForSnapshotPreview =
          pendingEmployeesAfterDecision ?? taskPendingEmployeesByTaskIdRef.current[task.id] ?? [];

        const decisionSnapshot: WorkflowRuntimeStepSnapshot = {
          id: `${task.id}-decision-${Date.now()}`,
          taskId: task.id,
          phase: "decision",
          fromNodeId: runtimeState.currentNodeId,
          toNodeId: effectiveDispatch?.nodeId ?? effectiveState.currentNodeId,
          toNodeName: effectiveDispatch?.employeeName,
          toNodeType: effectiveDispatch?.nodeType,
          decision,
          inputPreview: effectiveDispatch ? snapshotWorkflowDispatchInput(effectiveDispatch.input) : "(流程已结束)",
          outputPreview: snapshotWorkflowAssistantOutput(output),
          createdAt: Date.now(),
        };

        setWorkflowRuntimeStateByTaskId((prev) => ({ ...prev, [task.id]: effectiveState }));
        let filledDispatchSnapshotIdForPersist: string | undefined;
        let nextDispatchSnapshotForPersist: WorkflowRuntimeStepSnapshot | undefined;
        setWorkflowRuntimeSnapshotsByTaskId((prev) => {
          const nextSnapshots = [...(prev[task.id] ?? [])];
          if (output.trim()) {
            const latestDispatchIndex = [...nextSnapshots]
              .reverse()
              .findIndex((item) => item.phase === "dispatch" && item.outputPreview === "(待执行)");
            if (latestDispatchIndex >= 0) {
              const targetIndex = nextSnapshots.length - 1 - latestDispatchIndex;
              filledDispatchSnapshotIdForPersist = nextSnapshots[targetIndex].id;
              nextSnapshots[targetIndex] = {
                ...nextSnapshots[targetIndex],
                outputPreview: snapshotWorkflowAssistantOutput(output),
              };
            }
          }
          nextSnapshots.push(decisionSnapshot);
          if (effectiveDispatch && !effectiveCompleted) {
            const nextDispatchSnapshot: WorkflowRuntimeStepSnapshot = {
              id: `${task.id}-dispatch-${Date.now()}`,
              taskId: task.id,
              phase: "dispatch",
              fromNodeId: effectiveState.lastNodeId,
              toNodeId: effectiveDispatch.nodeId,
              toNodeName: effectiveDispatch.employeeName,
              toNodeType: effectiveDispatch.nodeType,
              inputPreview: snapshotTeamWorkerExecuteInput(effectiveDispatch, employees, pendingForSnapshotPreview),
              outputPreview: "(待执行)",
              createdAt: Date.now(),
            };
            nextDispatchSnapshotForPersist = nextDispatchSnapshot;
            nextSnapshots.push(nextDispatchSnapshot);
          }
          return { ...prev, [task.id]: nextSnapshots };
        });

        if (output.trim() && filledDispatchSnapshotIdForPersist) {
          try {
            const updateEvent = await appendTaskEvent({
              taskId: task.id,
              eventType: "workflow_runtime_snapshot_update",
              payloadJson: JSON.stringify({
                action: "runtime_snapshot_output_update",
                snapshotId: filledDispatchSnapshotIdForPersist,
                outputPreview: snapshotWorkflowAssistantOutput(output),
                createdAt: Date.now(),
              }),
            });
            setWorkflowTaskEventsByTaskId((prev) => ({
              ...prev,
              [task.id]: [...(prev[task.id] ?? []), updateEvent],
            }));
          } catch (runtimeUpdateEventError) {
            console.error("Failed to persist workflow runtime snapshot update:", runtimeUpdateEventError);
          }
        }
        try {
          const runtimeEvent = await appendTaskEvent({
            taskId: task.id,
            eventType: "workflow_runtime_snapshot",
            payloadJson: JSON.stringify({
              action: "runtime_snapshot",
              snapshot: decisionSnapshot,
            }),
          });
          setWorkflowTaskEventsByTaskId((prev) => ({
            ...prev,
            [task.id]: [...(prev[task.id] ?? []), runtimeEvent],
          }));
        } catch (runtimeEventError) {
          console.error("Failed to persist workflow runtime decision snapshot:", runtimeEventError);
        }

        if (nextDispatchSnapshotForPersist) {
          try {
            const nextDispatchRuntimeEvent = await appendTaskEvent({
              taskId: task.id,
              eventType: "workflow_runtime_snapshot",
              payloadJson: JSON.stringify({
                action: "runtime_snapshot",
                snapshot: nextDispatchSnapshotForPersist,
              }),
            });
            setWorkflowTaskEventsByTaskId((prev) => ({
              ...prev,
              [task.id]: [...(prev[task.id] ?? []), nextDispatchRuntimeEvent],
            }));
          } catch (nextDispatchPersistError) {
            console.error("Failed to persist next workflow runtime dispatch snapshot:", nextDispatchPersistError);
          }
        }

        if (effectiveDispatch && !effectiveCompleted) {
          await dispatchTeamStepToEmployeeSession({
            task: updatedTaskAfterDecision ?? task,
            dispatch: {
              employeeId: effectiveDispatch.employeeId,
              employeeName: effectiveDispatch.employeeName,
              nodeType: effectiveDispatch.nodeType,
              input: effectiveDispatch.input,
            },
            previousNodeLabel: currentNode.data.label,
            decision,
          });
        } else if (effectiveCompleted) {
          try {
            logWorkflowTrace("team.complete.auto", {
              taskId: task.id,
              workflowId: task.workflowId,
            });
            const taskAfterStep = updatedTaskAfterDecision ?? task;
            // 最后一阶段已在 decide_workflow_task_stage 中标记为 completed，图到达结束节点即收尾，不再 end（归档）。
            if (taskAfterStep.status === "completed") {
              const [events, pendingEmployees] = await Promise.all([
                listTaskEvents(taskAfterStep.id),
                listTaskPendingEmployees(taskAfterStep.id),
              ]);
              setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [taskAfterStep.id]: events }));
              setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [taskAfterStep.id]: pendingEmployees }));
            } else {
              const endedTask = await endWorkflowTask({
                taskId: task.id,
                reason: "到达结束节点自动完成",
              });
              setWorkflowTasks((prev) => prev.map((item) => (item.id === endedTask.id ? endedTask : item)));
              const [events, pendingEmployees] = await Promise.all([
                listTaskEvents(endedTask.id),
                listTaskPendingEmployees(endedTask.id),
              ]);
              setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [endedTask.id]: events }));
              setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [endedTask.id]: pendingEmployees }));
            }
          } catch (endError) {
            console.error("Team workflow auto end task failed:", endError);
          }
        }
        await refreshEmployeeData();
      } catch (e) {
        console.error("Team workflow auto advance failed:", e);
      }
    },
    [activeSessionId, sessions, employees, dispatchTeamStepToEmployeeSession],
  );

  advanceTeamAfterTurnRef.current = handleClaudeTurnComplete;

  async function refreshWorkflowTemplates() {
    const templates = await listWorkflowTemplates();
    setWorkflowTemplates(templates);
  }

  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      // Control+`（物理 Backquote）：切换终端面板；仅用 Ctrl、不含 ⌘，与 macOS Control 一致
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.code === "Backquote" || e.key === "`")) {
        e.preventDefault();
        setTerminalCollapsed((c) => !c);
        return;
      }
      if (mod && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
        return;
      }
      if (mod && e.shiftKey && (e.code === "KeyM" || e.key === "M" || e.key === "m")) {
        e.preventDefault();
        void wiseMascotShow().catch(() => {});
        return;
      }
      // Cmd/Ctrl+R：捕获阶段处理，避免焦点在 contentEditable / AntD 内部时冒泡不到 window；
      // 用 code===KeyR 对齐物理 R 键（与系统刷新一致）
      if (mod && (e.code === "KeyR" || e.key === "r" || e.key === "R")) {
        e.preventDefault();
        void reloadAppWindow();
      }
    }
    window.addEventListener("keydown", handleGlobalKey, { capture: true });
    return () => window.removeEventListener("keydown", handleGlobalKey, { capture: true });
  }, []);

  useEffect(() => {
    function handleOpenTaskSplitPanel() {
      setSearchOpen(false);
      setPromptsMode(false);
      setMcpHubMode(false);
      setSkillsHubMode(false);
      setTaskSplitMode(true);
    }
    window.addEventListener(WORKFLOW_UI_EVENT_OPEN_TASK_SPLIT_PANEL, handleOpenTaskSplitPanel as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_OPEN_TASK_SPLIT_PANEL, handleOpenTaskSplitPanel as EventListener);
    };
  }, []);

  handleStopEmployeeMonitorRef.current = (employeeId: string) => {
    const normalizedEmployeeId = employeeId.trim().toLowerCase();
    if (normalizedEmployeeId === "omc-worker" || normalizedEmployeeId.includes("omc")) {
      const omcItem = employeeMonitorItems.find((entry) => entry.employeeId === employeeId);
      const workflowInvocationKeys = Array.from(omcInvocationRuntimeRef.current.keys());
      const directBatchInvocationKeys = Array.from(omcDirectBatchInvocationRef.current.entries())
        .filter(([, inv]) => isOmcDirectBatchInvocationRunning(inv))
        .map(([k]) => k);
      const allInvocationKeys = [...new Set([...workflowInvocationKeys, ...directBatchInvocationKeys])];
      const anchorSessionIdForEvent =
        omcBatchRuntimeRef.current?.sessionId?.trim() ||
        omcItem?.sessionId?.trim() ||
        activeSessionIdLatestRef.current?.trim() ||
        undefined;
      void (async () => {
        try {
          if (allInvocationKeys.length > 0) {
            const cancelResults = await Promise.allSettled(
              allInvocationKeys.map(async (invocationKey) => {
                await cancelClaudeInvocation(invocationKey);
              }),
            );
            const failed = cancelResults.filter((result) => result.status === "rejected");
            if (failed.length > 0) {
              console.error("Failed to cancel OMC invocations:", failed);
              message.warning(`部分子进程未能结束（${failed.length}/${allInvocationKeys.length}），其余已发送取消`);
            }
          } else if (omcItem?.sessionId) {
            cancelSession(omcItem.sessionId);
          } else if (activeSessionId?.trim()) {
            cancelSession(activeSessionId.trim());
          }
        } catch (err) {
          console.error("Failed to stop OMC worker:", err);
        } finally {
          window.dispatchEvent(
            new CustomEvent(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, {
              detail: {
                active: false,
                sessionId: anchorSessionIdForEvent,
                runningCount: 0,
                updatedAt: Date.now(),
                abortedByUser: true,
              },
            }),
          );
        }
      })();
      return;
    }
    const item = employeeMonitorItems.find((entry) => entry.employeeId === employeeId);
    if (item?.sessionId) {
      cancelSession(item.sessionId);
    }
    if (!item?.activeTaskId) return;
    const hasWorkflowTask = workflowTasksRef.current.some((task) => task.id === item.activeTaskId);
    if (!hasWorkflowTask) {
      return;
    }
    const targetTaskId = item.activeTaskId;
    void endWorkflowTask({
      taskId: targetTaskId,
      reason: "在监控面板中手动结束员工任务",
    })
      .then(async (updatedTask) => {
        setWorkflowTasks((prev) => prev.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
        const [events, pendingEmployees] = await Promise.all([
          listTaskEvents(updatedTask.id),
          listTaskPendingEmployees(updatedTask.id),
        ]);
        setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
        setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
      })
      .catch((error) => {
        console.error("Failed to end employee workflow task:", error);
        message.error("结束员工任务失败");
      });
  };

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm,
      }}
    >
      <AntdApp>
        <Layout className="app-main-layout" style={{ minWidth: 0, flex: 1, minHeight: 0, height: "100%" }}>
          <LeftSidebar
            dark={dark}
            collapsed={collapsed}
            siderWidth={mainLayoutLeftWidthPx}
            compactLayoutMode={compactLayoutMode}
            onToggleCompactLayoutMode={handleToggleCompactLayoutMode}
            projects={projects}
            activeProjectId={activeProjectId}
            repositories={repositories}
            activeRepositoryId={activeRepositoryId}
            mcpNavActive={mcpHubMode}
            onOpenMcpHub={() => {
              setPromptsMode(false);
              setSkillsHubMode(false);
              setMcpHubMode(true);
            }}
            skillsNavActive={skillsHubMode}
            onOpenSkillsHub={() => {
              setPromptsMode(false);
              setMcpHubMode(false);
              setSkillsHubMode(true);
            }}
            onProjectSelect={handleProjectSelectLeavingMcpHub}
            onCreateProject={handleCreateProject}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
            pinnedProjectIds={pinnedProjectIds}
            onTogglePinProject={togglePinProject}
            onAddRepositoryToProject={handleAddRepositoryToProject}
            onDetachRepositoryFromProject={handleDetachRepositoryFromProject}
            onReorderRepositoriesInProject={handleReorderRepositoriesInProject}
            onMoveRepositoryToProject={handleMoveRepositoryToProject}
            onRepositorySelect={handleSidebarRepositorySelectLeavingMcpHub}
            onOpenInFinder={handleOpenInFinder}
            onCreateProjectTask={handleCreateProjectTask}
            onCreateRepositoryTask={handleCreateRepositoryTask}
            onOpenPromptsProject={handleOpenPromptsForProject}
            onOpenPromptsRepository={handleOpenPromptsForRepository}
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={jumpToSessionLeavingMcpHub}
            employees={employees}
            employeeTaskCounts={employeeTaskCounts}
            onMoveEmployee={async (employeeId, direction) => {
              await moveEmployeeDisplayOrder({ employeeId, direction });
              await refreshEmployeeData();
            }}
            onCancelSessionFromMonitor={cancelSession}
            onOpenTaskDetailFromMonitor={(taskId) => {
              setMonitorDrawerTarget({ type: "task", taskId });
            }}
            onReloadFullDiskTranscript={reloadFullDiskTranscript}
            activeRepositoryPath={activeRepository?.path}
            activeRepositoryName={activeRepository?.name}
            onOpenActiveRepositoryFile={handleOpenRepositoryFileFromPanels}
          />

          {!promptsMode && !collapsed ? (
            <MainLayoutResizeHandle
              variant="left"
              startWidthPx={mainLayoutLeftWidthPx}
              onWidthChange={setMainLayoutLeftWidthPx}
            />
          ) : null}

          {promptsMode ? (
            <div className="app-full-width-main">
              <Suspense
                fallback={
                  <div className="app-file-editor-loading">
                    <Spin size="small" />
                  </div>
                }
              >
                <PromptsPanel
                  onClose={() => {
                    setPromptsOpenContext(null);
                    setPromptsMode(false);
                  }}
                  projects={projects}
                  repositories={repositories}
                  activeProjectId={activeProjectId}
                  activeRepositoryId={activeRepositoryId}
                  openContext={promptsOpenContext}
                  repositoryListLoading={repositoryListLoading}
                />
              </Suspense>
            </div>
          ) : (
            <>
              <div className="app-main-chat-with-right-pane">
              <Layout.Content ref={mainLayoutContentRef} className="app-main-layout-content">
                <ClaudeSessions
                sessions={sessions}
                activeSessionId={activeSessionId}
                onReloadFullDiskTranscript={reloadFullDiskTranscript}
                omcBatchPipelineActive={Boolean(omcBatchRuntime?.active)}
                onAddWorktreeRepositoryToProject={handleAddWorktreeRepositoryToProject}
                activeRepository={activeRepository}
                repositories={repositories}
                activeRepositoryId={activeRepositoryId}
                onSelectRepository={setActiveRepositoryId}
                onUpdateSessionModel={updateSessionModel}
                onExecuteSession={handleComposerExecute}
                onSendMessage={handleSendMessageWithTask}
                onCancelSession={cancelSession}
                onCloseSession={handleCloseSession}
                onSwitchSession={jumpToSessionWithRepository}
                onNewSession={(repository) => void handleCreateRepositoryTask(repository, "chat")}
                repositoryMainBindings={repositoryMainSessionBindings}
                onAppendSystemMessage={appendSystemMessage}
                onAppendUserMessage={appendUserMessage}
                onNotifyOmcEmployeeDirectBatchTaskDone={notifyOmcEmployeeDirectBatchTaskDone}
                onPrepareFreshOmcEmployeeWorkerForDirectBatch={prepareFreshOmcEmployeeWorkerForDirectBatch}
                onRefreshHistorySessions={handleRefreshHistorySessions}
                onRespondToQuestion={respondToQuestion}
                onDismissQuestion={dismissQuestion}
                onRespondToPermission={respondToPermission}
                onClearTodos={clearTodos}
                onClearFollowups={clearFollowups}
                onClearRevertItems={clearRevertItems}
                onSendFollowup={sendFollowup}
                onRestoreRevert={restoreRevert}
                dualPaneEnabled={dualPaneEnabled}
                onToggleDualPane={handleToggleDualPane}
                secondarySessionId={dualPaneSecondarySessionId}
                dualPaneSecondaryRepositoryId={dualPaneSecondaryRepositoryId}
                onDualPaneSecondaryRepositorySelect={handleDualPaneSecondaryRepositorySelect}
                onNewSecondarySession={handleNewSecondarySession}
                onToggleSidebar={() => setCollapsed((c) => !c)}
                onToggleRightPanel={handleToggleRightPanel}
                onToggleTerminal={() => setTerminalCollapsed((c) => !c)}
                onSearch={() => setSearchOpen(true)}
                collapsed={collapsed}
                rightCollapsed={effectiveRightCollapsed}
                terminalCollapsed={terminalCollapsed}
                onOpenWorkflowConfig={() => setWorkflowConfigOpen(true)}
                employees={employees}
                mentionEmployees={mentionEmployees}
                workflowTasks={workflowTasks}
                taskPendingEmployeesByTaskId={taskPendingEmployeesByTaskId}
                workflowTemplates={workflowTemplates}
                workflowGraphsByWorkflowId={workflowGraphsByWorkflowId}
                workflowGraphStatusByWorkflowId={workflowGraphStatusByWorkflowId}
                hideMessages={editorVisible}
                hideSessionTools={editorVisible}
                onOpenTaskDetail={(taskId) => {
                  setMonitorDrawerTarget({ type: "task", taskId });
                }}
                taskListConcurrentCapacity={
                  monitorClaudeConcurrency
                    ? Math.max(0, monitorClaudeConcurrency.limit - monitorClaudeConcurrency.activeCount)
                    : undefined
                }
                resolveTaskListOmcInvokeConcurrency={resolveTaskListOmcInvokeConcurrency}
                panelBelowMessages={
                  editorVisible ? (
                    <div className="app-file-editor-panel">
                      <div className="app-file-editor-header">
                        <div className="app-file-editor-tab-bar">
                          <div className="app-file-editor-tabs-scroll" role="tablist" aria-label="已打开文件">
                            {fileEditorTabs.map((tab) => {
                              const isActive = tab.relativePath === fileEditorActivePath;
                              const tabDirty = tab.content !== tab.originalContent;
                              const label = tab.relativePath.split(/[/\\]/).pop() ?? tab.relativePath;
                              return (
                                <div
                                  key={tab.relativePath}
                                  role="tab"
                                  aria-selected={isActive}
                                  tabIndex={0}
                                  className={`app-file-editor-tab${isActive ? " app-file-editor-tab--active" : ""}`}
                                  title={tab.relativePath}
                                  onClick={() => setFileEditorActivePath(tab.relativePath)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      setFileEditorActivePath(tab.relativePath);
                                    }
                                  }}
                                >
                                  <span
                                    className={`app-file-editor-tab-label${tabDirty ? " app-file-editor-tab-label--dirty" : ""}`}
                                  >
                                    {label}
                                  </span>
                                  <button
                                    type="button"
                                    className="app-file-editor-tab-close"
                                    aria-label={`关闭 ${label}`}
                                    onClick={(e) => handleCloseFileEditorTab(tab.relativePath, e)}
                                  >
                                    <CloseOutlined />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                          <div className="app-file-editor-tab-bar-actions">
                            {editorDirty && (
                              <span className="app-file-editor-dirty app-file-editor-dirty--tab-bar">未保存</span>
                            )}
                            <Button
                              type="primary"
                              size="small"
                              onClick={() => {
                                void handleSaveEditor();
                              }}
                              loading={editorSaving}
                              disabled={
                                !activeFileEditorTab?.relativePath ||
                                activeFileEditorTab.loading ||
                                activeFileEditorTab.gitDiffSection === "staged" ||
                                !editorDirty
                              }
                            >
                              保存
                            </Button>
                            <Button type="text" size="small" onClick={handleCloseFileEditorPanel}>
                              全部关闭
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div className="app-file-editor-body">
                        {!activeFileEditorTab || activeFileEditorTab.loading ? (
                          <div className="app-file-editor-loading">
                            <Spin size="small" />
                          </div>
                        ) : (
                          <div className="app-file-editor-monaco-wrap">
                            {activeFileEditorTab.diffOriginal !== undefined ? (
                              <GitDiffMonacoPane
                                relativePath={activeFileEditorTab.relativePath}
                                original={activeFileEditorTab.diffOriginal}
                                modified={activeFileEditorTab.content}
                                language={monacoLanguageFromPath(activeFileEditorTab.relativePath)}
                                readOnly={activeFileEditorTab.gitDiffSection === "staged"}
                                dark={dark}
                                onModifiedChange={(next) => {
                                  const path = fileEditorActivePath;
                                  if (!path) {
                                    return;
                                  }
                                  setFileEditorTabs((prev) =>
                                    prev.map((t) => (t.relativePath === path ? { ...t, content: next } : t)),
                                  );
                                }}
                              />
                            ) : (
                              <Suspense
                                fallback={
                                  <div className="app-file-editor-loading">
                                    <Spin size="small" />
                                  </div>
                                }
                              >
                                <MonacoEditor
                                  key={`${activeFileEditorTab.relativePath}:${monacoLanguageFromPath(activeFileEditorTab.relativePath)}`}
                                  className="app-file-editor-monaco"
                                  height="100%"
                                  path={activeFileEditorTab.relativePath}
                                  defaultLanguage={monacoLanguageFromPath(activeFileEditorTab.relativePath)}
                                  language={monacoLanguageFromPath(activeFileEditorTab.relativePath)}
                                  value={activeFileEditorTab.content}
                                  onChange={(value) => {
                                    const path = fileEditorActivePath;
                                    if (!path) {
                                      return;
                                    }
                                    const next = value ?? "";
                                    setFileEditorTabs((prev) =>
                                      prev.map((t) => (t.relativePath === path ? { ...t, content: next } : t)),
                                    );
                                  }}
                                  theme={dark ? "vs-dark" : "vs"}
                                  options={{
                                    minimap: { enabled: false },
                                    stickyScroll: { enabled: false },
                                    fontSize: 13,
                                    lineNumbers: "on",
                                    automaticLayout: true,
                                    wordWrap: "on",
                                    tabSize: 2,
                                    scrollBeyondLastLine: false,
                                    dragAndDrop: false,
                                  }}
                                />
                              </Suspense>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    ) : null
                }
                onDecideWorkflowTask={async (input) => {
                  const updatedTask = await decideWorkflowTaskStage(input);
                  setWorkflowTasks((prev) => prev.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
                  const events = await listTaskEvents(updatedTask.id);
                  const pendingEmployees = await listTaskPendingEmployees(updatedTask.id);
                  setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
                  setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
                  const runtimeState = workflowRuntimeStateByTaskId[updatedTask.id];
                  if (runtimeState) {
                    try {
                      const graphItem = await getWorkflowGraph({ workflowId: updatedTask.workflowId });
                      if (graphItem?.graph?.nodes?.length) {
                        const currentNode = graphItem.graph.nodes.find((n) => n.id === runtimeState.currentNodeId);
                        const manualAcceptanceEnabled =
                          currentNode?.type === "approval" && currentNode.data.conditionElsePrompt?.trim() === "acceptance_enabled";
                        if (input.decision === "rejected" && manualAcceptanceEnabled && updatedTask.status === "in_progress") {
                          const stageNodes = orderedExecutableNodes(graphItem.graph);
                          const rollbackNode = stageNodes[updatedTask.currentStageIndex];
                          const rollbackEmployeeId = pendingEmployees[0]?.employeeId ?? rollbackNode?.data.employeeId;
                          const rollbackEmployeeName = pendingEmployees[0]?.name ?? rollbackNode?.data.label ?? "回退阶段执行";
                          if (rollbackEmployeeId) {
                            setWorkflowRuntimeStateByTaskId((prev) => ({
                              ...prev,
                              [updatedTask.id]: {
                                ...runtimeState,
                                currentNodeId: rollbackNode?.id ?? runtimeState.currentNodeId,
                                trace: rollbackNode ? [...runtimeState.trace, rollbackNode.id] : runtimeState.trace,
                              },
                            }));
                            await dispatchTeamStepToEmployeeSession({
                              task: updatedTask,
                              dispatch: {
                                employeeId: rollbackEmployeeId,
                                employeeName: rollbackEmployeeName,
                                nodeType: rollbackNode
                                  ? resolveWorkflowDispatchNodeType(rollbackNode)
                                  : ("task" as WorkflowGraphNodeType),
                                input: rollbackNode
                                  ? composeDispatchInput(rollbackNode, updatedTask.content, graphItem.graph)
                                  : updatedTask.content.trim(),
                              },
                              previousNodeLabel: "人工验收节点",
                              decision: "reject",
                            });
                            await refreshEmployeeData();
                            return;
                          }
                        }
                        const taskSession = sessions.find((item) => item.id === updatedTask.creator);
                        const latestAssistantOutput = extractLatestAssistantPlainText(taskSession);
                        const decision = input.decision === "approved" ? "pass" : "reject";
                        const nextStep = advanceWorkflowGraph({
                          graph: graphItem.graph,
                          state: runtimeState,
                          startContent: updatedTask.content,
                          lastOutput: latestAssistantOutput,
                          acceptanceDecision: decision,
                        });
                        let effectiveDispatch = nextStep.dispatch;
                        let effectiveState = nextStep.state;
                        let effectiveCompleted = nextStep.completed;
                        logWorkflowTrace("team.advance.manual_decision", {
                          taskId: updatedTask.id,
                          decision,
                          nextNodeId: effectiveState.currentNodeId,
                          completed: effectiveCompleted,
                        });
                        const decisionSnapshot: WorkflowRuntimeStepSnapshot = {
                          id: `${updatedTask.id}-decision-${Date.now()}`,
                          taskId: updatedTask.id,
                          phase: "decision",
                          fromNodeId: runtimeState.currentNodeId,
                          toNodeId: effectiveDispatch?.nodeId ?? effectiveState.currentNodeId,
                          toNodeName: effectiveDispatch?.employeeName,
                          toNodeType: effectiveDispatch?.nodeType,
                          decision,
                          inputPreview: effectiveDispatch ? snapshotWorkflowDispatchInput(effectiveDispatch.input) : "(流程已结束)",
                          outputPreview: snapshotWorkflowAssistantOutput(latestAssistantOutput),
                          createdAt: Date.now(),
                        };
                        setWorkflowRuntimeStateByTaskId((prev) => ({ ...prev, [updatedTask.id]: effectiveState }));
                        let filledDispatchSnapshotIdManual: string | undefined;
                        let nextDispatchSnapshotManual: WorkflowRuntimeStepSnapshot | undefined;
                        setWorkflowRuntimeSnapshotsByTaskId((prev) => {
                          const nextSnapshots = [...(prev[updatedTask.id] ?? [])];
                          if (latestAssistantOutput.trim()) {
                            const latestDispatchIndex = [...nextSnapshots]
                              .reverse()
                              .findIndex((item) => item.phase === "dispatch" && item.outputPreview === "(待执行)");
                            if (latestDispatchIndex >= 0) {
                              const targetIndex = nextSnapshots.length - 1 - latestDispatchIndex;
                              filledDispatchSnapshotIdManual = nextSnapshots[targetIndex].id;
                              nextSnapshots[targetIndex] = {
                                ...nextSnapshots[targetIndex],
                                outputPreview: snapshotWorkflowAssistantOutput(latestAssistantOutput),
                              };
                            }
                          }
                          nextSnapshots.push(decisionSnapshot);
                          if (effectiveDispatch && !effectiveCompleted) {
                            const nextDispatchSnapshot: WorkflowRuntimeStepSnapshot = {
                              id: `${updatedTask.id}-dispatch-${Date.now()}`,
                              taskId: updatedTask.id,
                              phase: "dispatch",
                              fromNodeId: effectiveState.lastNodeId,
                              toNodeId: effectiveDispatch.nodeId,
                              toNodeName: effectiveDispatch.employeeName,
                              toNodeType: effectiveDispatch.nodeType,
                              inputPreview: snapshotTeamWorkerExecuteInput(
                                effectiveDispatch,
                                employees,
                                pendingEmployees,
                              ),
                              outputPreview: "(待执行)",
                              createdAt: Date.now(),
                            };
                            nextDispatchSnapshotManual = nextDispatchSnapshot;
                            nextSnapshots.push(nextDispatchSnapshot);
                          }
                          return {
                            ...prev,
                            [updatedTask.id]: nextSnapshots,
                          };
                        });
                        if (latestAssistantOutput.trim() && filledDispatchSnapshotIdManual) {
                          try {
                            const updateEvent = await appendTaskEvent({
                              taskId: updatedTask.id,
                              eventType: "workflow_runtime_snapshot_update",
                              payloadJson: JSON.stringify({
                                action: "runtime_snapshot_output_update",
                                snapshotId: filledDispatchSnapshotIdManual,
                                outputPreview: snapshotWorkflowAssistantOutput(latestAssistantOutput),
                                createdAt: Date.now(),
                              }),
                            });
                            setWorkflowTaskEventsByTaskId((prev) => ({
                              ...prev,
                              [updatedTask.id]: [...(prev[updatedTask.id] ?? []), updateEvent],
                            }));
                          } catch (runtimeUpdateEventError) {
                            console.error("Failed to persist workflow runtime snapshot update:", runtimeUpdateEventError);
                          }
                        }
                        try {
                          const runtimeEvent = await appendTaskEvent({
                            taskId: updatedTask.id,
                            eventType: "workflow_runtime_snapshot",
                            payloadJson: JSON.stringify({
                              action: "runtime_snapshot",
                              snapshot: decisionSnapshot,
                            }),
                          });
                          setWorkflowTaskEventsByTaskId((prev) => ({
                            ...prev,
                            [updatedTask.id]: [...(prev[updatedTask.id] ?? []), runtimeEvent],
                          }));
                        } catch (runtimeEventError) {
                          console.error("Failed to persist workflow runtime decision snapshot:", runtimeEventError);
                        }
                        if (nextDispatchSnapshotManual) {
                          try {
                            const nextDispatchRuntimeEvent = await appendTaskEvent({
                              taskId: updatedTask.id,
                              eventType: "workflow_runtime_snapshot",
                              payloadJson: JSON.stringify({
                                action: "runtime_snapshot",
                                snapshot: nextDispatchSnapshotManual,
                              }),
                            });
                            setWorkflowTaskEventsByTaskId((prev) => ({
                              ...prev,
                              [updatedTask.id]: [...(prev[updatedTask.id] ?? []), nextDispatchRuntimeEvent],
                            }));
                          } catch (nextDispatchPersistError) {
                            console.error("Failed to persist next workflow runtime dispatch snapshot:", nextDispatchPersistError);
                          }
                        }
                        if (effectiveDispatch && !effectiveCompleted) {
                          await dispatchTeamStepToEmployeeSession({
                            task: updatedTask,
                            dispatch: {
                              employeeId: effectiveDispatch.employeeId,
                              employeeName: effectiveDispatch.employeeName,
                              nodeType: effectiveDispatch.nodeType,
                              input: effectiveDispatch.input,
                            },
                            previousNodeLabel: "人工验收节点",
                            decision,
                          });
                        } else if (effectiveCompleted) {
                          try {
                            logWorkflowTrace("team.complete.manual_decision", {
                              taskId: updatedTask.id,
                              workflowId: updatedTask.workflowId,
                            });
                            if (updatedTask.status === "completed") {
                              const [endedEvents, endedPendingEmployees] = await Promise.all([
                                listTaskEvents(updatedTask.id),
                                listTaskPendingEmployees(updatedTask.id),
                              ]);
                              setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: endedEvents }));
                              setTaskPendingEmployeesByTaskId((prev) => ({
                                ...prev,
                                [updatedTask.id]: endedPendingEmployees,
                              }));
                            } else {
                              const endedTask = await endWorkflowTask({
                                taskId: updatedTask.id,
                                reason: "到达结束节点自动完成",
                              });
                              setWorkflowTasks((prev) => prev.map((item) => (item.id === endedTask.id ? endedTask : item)));
                              const [endedEvents, endedPendingEmployees] = await Promise.all([
                                listTaskEvents(endedTask.id),
                                listTaskPendingEmployees(endedTask.id),
                              ]);
                              setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [endedTask.id]: endedEvents }));
                              setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [endedTask.id]: endedPendingEmployees }));
                            }
                          } catch (endError) {
                            console.error("Failed to auto complete workflow task at end node:", endError);
                          }
                        }
                      }
                    } catch (runtimeError) {
                      console.error("Failed to advance workflow graph runtime:", runtimeError);
                    }
                  }
                  await refreshEmployeeData();
                }}
              />
              </Layout.Content>

              {!effectiveRightCollapsed ? (
                <MainLayoutResizeHandle
                  variant="right"
                  startWidthPx={mainLayoutRightWidthPx}
                  onWidthChange={setMainLayoutRightWidthPx}
                />
              ) : null}

              <Suspense fallback={null}>
                <RightPanel
                  dark={dark}
                  collapsed={effectiveRightCollapsed}
                  siderWidth={mainLayoutRightWidthPx}
                  repositoryPath={activeRepository?.path}
                  repositoryName={activeRepository?.name}
                  onOpenFile={handleOpenRepositoryFileFromPanels}
                  monitorStats={monitorStats}
                  monitorPanelSessions={monitorPanelSessionsMerged}
                  monitorTranscriptSourceSessions={sessions}
                  employeeMonitorItems={employeeMonitorItems}
                  teamMonitorItems={publishedTeamMonitorItems}
                  monitorActiveTarget={monitorDrawerTarget}
                  onOpenTeamMonitorDetail={(workflowId) => {
                    setMonitorDrawerTarget({ type: "team", workflowId });
                  }}
                  onOpenEmployeeConfig={() => {
                    void openEmployeeConfigWithContext();
                  }}
                  onOpenWorkflowConfig={() => setWorkflowConfigOpen(true)}
                  onStopEmployeeMonitor={(employeeId) => handleStopEmployeeMonitorRef.current(employeeId)}
                  onStopTeamMonitor={(workflowId) => {
                    const item = teamMonitorItems.find((entry) => entry.workflowId === workflowId);
                    if (!item?.activeTaskId) return;
                    const targetTaskId = item.activeTaskId;
                    const task = workflowTasks.find((entry) => entry.id === targetTaskId);
                    if (task?.creator) {
                      cancelSession(task.creator);
                    }
                    void endWorkflowTask({
                      taskId: targetTaskId,
                      reason: "在监控面板中手动结束团队任务",
                    })
                      .then(async (updatedTask) => {
                        setWorkflowTasks((prev) =>
                          prev.map((entry) => (entry.id === updatedTask.id ? updatedTask : entry)),
                        );
                        const [events, pendingEmployees] = await Promise.all([
                          listTaskEvents(updatedTask.id),
                          listTaskPendingEmployees(updatedTask.id),
                        ]);
                        setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
                        setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
                      })
                      .catch((error) => {
                        console.error("Failed to end team workflow task:", error);
                        message.error("结束团队任务失败");
                      });
                  }}
                  monitorClaudeConcurrency={monitorClaudeConcurrency}
                  onCancelSessionFromMonitor={cancelSession}
                  onOpenTaskDetailFromMonitor={(taskId) => {
                    setMonitorDrawerTarget({ type: "task", taskId });
                  }}
                  onOpenOmcBatchInvocationDetail={handleOpenOmcBatchInvocationDetail}
                  onCancelOmcDirectBatchInvocation={handleCancelOmcDirectBatchInvocation}
                  onReloadFullDiskTranscript={reloadFullDiskTranscript}
                />
              </Suspense>

              <CommandPalette
                open={searchOpen}
                onClose={() => setSearchOpen(false)}
                repositoryPath={activeRepository?.path}
              />
              {mcpHubMode ? (
                <div className="app-mcp-hub-overlay" role="region" aria-label="MCP 管理">
                  <McpHub repositoryPath={activeRepository?.path ?? null} onClose={() => setMcpHubMode(false)} />
                </div>
              ) : null}
              {skillsHubMode ? (
                <div className="app-skills-hub-overlay" role="region" aria-label="skills.sh 技能目录">
                  <SkillsHub repositoryPath={activeRepository?.path ?? null} onClose={() => setSkillsHubMode(false)} />
                </div>
              ) : null}
              </div>
            </>
          )}
          <Drawer
            open={taskSplitMode}
            onClose={() => setTaskSplitMode(false)}
            title={null}
            closable={false}
            placement="right"
            width="100vw"
            styles={{
              body: {
                height: "100vh",
                overflow: "hidden",
                padding: 0,
                display: "flex",
                flexDirection: "column",
              },
            }}
            destroyOnHidden={false}
            rootClassName="app-task-split-fullscreen-drawer"
          >
            <Suspense
              fallback={
                <div className="app-file-editor-loading">
                  <Spin size="small" />
                </div>
              }
            >
              <PrdTaskSplitPanel
                onClose={() => setTaskSplitMode(false)}
                projects={projects}
                repositories={repositories}
                activeProjectId={activeProjectId}
                activeRepositoryId={activeRepositoryId}
              />
            </Suspense>
          </Drawer>
        </Layout>

        <Modal
          open={repositoryBinaryPreview !== null}
          title={repositoryBinaryPreview?.relativePath ?? "文件预览"}
          onCancel={() => {
            setRepositoryBinaryPreview((prev) => {
              if (prev?.kind === "pdf") {
                URL.revokeObjectURL(prev.blobUrl);
              }
              return null;
            });
          }}
          footer={null}
          centered
          width="min(1100px, 96vw)"
          destroyOnHidden
          zIndex={3100}
          rootClassName="app-repository-file-preview-modal"
          styles={{
            body: {
              padding: "12px 16px 20px",
              maxHeight: "calc(100vh - 100px)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            },
          }}
        >
          {repositoryBinaryPreview ? (
            <div
              className={
                "app-repository-file-preview-body" +
                (repositoryBinaryPreview.kind === "docx"
                  ? " app-repository-file-preview-body--docx"
                  : "") +
                (repositoryBinaryPreview.kind === "image" ? " app-repository-file-preview-body--image" : "")
              }
            >
              {repositoryBinaryPreview.kind === "image" ? (
                <RepositoryImagePreview
                  src={repositoryBinaryPreview.src}
                  alt={repositoryBinaryPreview.relativePath}
                />
              ) : null}
              {repositoryBinaryPreview.kind === "pdf" ? (
                <iframe
                  key={repositoryBinaryPreview.blobUrl}
                  title={repositoryBinaryPreview.relativePath}
                  src={repositoryBinaryPreview.blobUrl}
                  className="app-repository-file-preview-pdf"
                />
              ) : null}
              {repositoryBinaryPreview.kind === "docx" ? (
                <div
                  className="app-repository-docx-preview"
                  dangerouslySetInnerHTML={{ __html: repositoryBinaryPreview.html }}
                />
              ) : null}
              {repositoryBinaryPreview.kind === "doc" ? (
                <div className="app-repository-doc-legacy-preview">
                  <p className="app-repository-doc-legacy-preview-text">
                    旧版 Word（.doc）为二进制格式，无法在应用内渲染。请使用本机已安装的 Word、Pages 或 WPS 等打开查看。
                  </p>
                  <Button
                    type="primary"
                    onClick={() => {
                      void openInFinder(repositoryBinaryPreview.absolutePath).catch((err) => {
                        console.error(err);
                        message.error(`打开失败：${toUiErrorMessage(err)}`);
                      });
                    }}
                  >
                    用默认应用打开
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </Modal>

        <ProgressMonitorDrawer
          open={monitorDrawerTarget != null}
          target={monitorDrawerTarget}
          onClose={() => setMonitorDrawerTarget(null)}
          employeeItems={employeeMonitorItems}
          teamItems={teamMonitorItems}
          workflowTasks={workflowTasks}
          workflowTaskEventsByTaskId={workflowTaskEventsByTaskId}
          workflowRuntimeSnapshotsByTaskId={workflowRuntimeSnapshotsByTaskId}
          taskPendingEmployeesByTaskId={taskPendingEmployeesByTaskId}
          sessions={monitorPanelSessionsMerged}
          transcriptSourceSessions={sessions}
          employees={employees}
          workflowTemplates={workflowTemplates}
          onOpenOmcBatchInvocationDetail={(input) => {
            handleOpenOmcBatchInvocationDetail(input);
            setMonitorDrawerTarget(null);
          }}
          onCancelOmcDirectBatchInvocation={handleCancelOmcDirectBatchInvocation}
          onJumpToSession={(sessionId) => {
            jumpToSessionWithRepository(sessionId);
            setMonitorDrawerTarget(null);
          }}
          onReloadFullDiskTranscript={reloadFullDiskTranscript}
        />

        {employeeConfigOpen ? (
          <EmployeeConfigModal
            open={employeeConfigOpen}
            loading={employeeLoading}
            employees={employees}
            workflowTemplates={workflowTemplates}
            workflowGraphsByWorkflowId={workflowGraphsByWorkflowId}
            repositories={repositories}
            agentTypeOptions={employeeAgentTypeOptions}
            defaultRepositoryIds={employeeConfigDefaultRepositoryIds}
            onClose={() => setEmployeeConfigOpen(false)}
            onCreate={async (input) => {
              setEmployeeLoading(true);
              try {
                await createEmployee(input);
                await refreshEmployeeData();
              } finally {
                setEmployeeLoading(false);
              }
            }}
            onUpdate={async (input) => {
              setEmployeeLoading(true);
              try {
                await updateEmployee(input);
                await refreshEmployeeData();
              } finally {
                setEmployeeLoading(false);
              }
            }}
            onDelete={async (employeeId) => {
              setEmployeeLoading(true);
              try {
                await deleteEmployee(employeeId);
                await refreshEmployeeData();
              } finally {
                setEmployeeLoading(false);
              }
            }}
          />
        ) : null}
        {workflowConfigOpen ? (
          <Suspense fallback={null}>
            <WorkflowConfigModal
              open={workflowConfigOpen}
              loading={workflowLoading}
              employees={employees}
              repositoryPath={activeRepository?.path ?? null}
              templates={workflowTemplates}
              selectableEmployeeIds={selectableWorkflowEmployeeIds}
              onClose={() => setWorkflowConfigOpen(false)}
              onSaveTemplate={async (input) => {
                setWorkflowLoading(true);
                try {
                  const savedTemplate = await saveWorkflowTemplate(input);
                  await refreshWorkflowTemplates();
                  return savedTemplate;
                } finally {
                  setWorkflowLoading(false);
                }
              }}
              onLoadGraphItem={async (workflowId) => {
                return getWorkflowGraph({ workflowId });
              }}
              onSaveGraph={async (input) => {
                const savedGraph = await saveWorkflowGraph({
                  workflowId: input.workflowId,
                  graph: input.graph,
                  status: input.status,
                });
                setWorkflowGraphsByWorkflowId((prev) => ({
                  ...prev,
                  [input.workflowId]: savedGraph.graph,
                }));
                setWorkflowGraphStatusByWorkflowId((prev) => ({
                  ...prev,
                  [input.workflowId]: savedGraph.status,
                }));
              }}
              onValidateGraph={async (graph) => {
                return validateWorkflowGraph({ graph });
              }}
              onDeleteTemplate={async (workflowId) => {
                setWorkflowLoading(true);
                try {
                  await deleteWorkflowTemplate(workflowId);
                  await refreshWorkflowTemplates();
                  message.success("团队已删除");
                } catch (error) {
                  const messageText = toUiErrorMessage(error);
                  message.error(`删除团队失败：${messageText}`);
                } finally {
                  setWorkflowLoading(false);
                }
              }}
            />
          </Suspense>
        ) : null}
      </AntdApp>
    </ConfigProvider>
  );
}
