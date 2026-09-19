import type { ClaudeMessage, ClaudeSession, TextPart } from "../types";
import {
  CLAUDE_REASONING_EFFORT_LABELS,
  isClaudeReasoningEffort,
} from "../constants/claudeReasoningEffort";
import {
  CODEX_REASONING_EFFORT_LABELS,
  isCodexReasoningEffort,
} from "../constants/codexReasoningEffort";
import {
  SESSION_EXECUTION_ENGINE_LABELS,
  isSessionExecutionEngine,
  type SessionExecutionEngine,
} from "../constants/sessionExecutionEngine";
import { formatClaudeModelLabel } from "./claudeModel";
import { isAssistantDisplayNoiseText } from "./claudeChatMessageDisplay";
import { isCodeReviewPromptHistorySession } from "./codeReviewPromptSession";
import { isConventionalCommitPromptHistorySession } from "./conventionalCommitMessage";
import { getSessionUpdatedAt } from "../components/ClaudeSessions/sessionGrouping";
import { formatWorkspaceSidebarRelativeTime } from "./repositoryWorkspaceTree";
import { repositoryPathsMatch } from "./repositoryMainSessionBinding";
import { isSessionFeedbackLoopHistorySession } from "./sessionFeedbackLoopDispatch";
import { resolveSessionListPreviewSource } from "./sessionListPreview";
import { stripRedundantRepoBracketPrefix } from "./sessionRepositoryDisplay";

export const WISE_HUD_STATE_EVENT = "wise-hud-state";
export const WISE_HUD_SUBMIT_EVENT = "wise-hud-submit";
export const WISE_HUD_CANCEL_EVENT = "wise-hud-cancel";
export const WISE_HUD_REQUEST_STATE_EVENT = "wise-hud-request-state";
export const WISE_HUD_ACTIVE_EVENT = "wise-hud-active-changed";
export const WISE_HUD_SELECT_REPOSITORY_EVENT = "wise-hud-select-repository";
export const WISE_HUD_SELECT_SESSION_EVENT = "wise-hud-select-session";
export const WISE_HUD_NEW_SESSION_EVENT = "wise-hud-new-session";
export const WISE_HUD_SET_ENGINE_EVENT = "wise-hud-set-engine";
export const WISE_HUD_SET_MODEL_EVENT = "wise-hud-set-model";
export const WISE_HUD_SESSION_COMPLETE_EVENT = "wise-hud-session-complete";
export const WISE_HUD_SET_DETAILS_OPEN_EVENT = "wise-hud-set-details-open";
export const WISE_HUD_ACTIVATE_ASSISTANT_EVENT = "wise-hud-activate-assistant";
export const WISE_HUD_TOGGLE_REPOSITORY_RUN_EVENT = "wise-hud-toggle-repository-run";
/** HUD 选择一个本地目录后，请主窗口将其登记为单仓。 */
export const WISE_HUD_ADD_REPOSITORY_EVENT = "wise-hud-add-repository";
/** 主窗口完成 HUD 仓库登记后回传结果给 HUD。 */
export const WISE_HUD_ADD_REPOSITORY_RESULT_EVENT = "wise-hud-add-repository-result";

export const HUD_ASSISTANT_PREVIEW_MAX_LEN = 280;

/** HUD 详情标签：运行中会话全部保留，其余按当前仓库历史补齐。 */
export const HUD_SESSION_TAB_LIMIT = 24;

export const HUD_RUN_STATUSES = ["idle", "running", "completed"] as const;

export type WiseHudRunStatus = (typeof HUD_RUN_STATUSES)[number];
export type WiseHudRepositoryRunStatus = "idle" | "running" | "stopping";

const HUD_SESSION_STATUSES = [
  "idle",
  "connecting",
  "running",
  "completed",
  "cancelled",
  "error",
] as const satisfies ReadonlyArray<ClaudeSession["status"]>;

export interface WiseHudRepositoryOption {
  id: number;
  name: string;
  path: string;
  openAppId?: string | null;
}

export interface WiseHudComposerSession {
  id: string;
  repositoryPath: string;
  repositoryName: string;
  model: string;
  status: ClaudeSession["status"];
  connectionKind?: ClaudeSession["connectionKind"];
  executionEngine?: SessionExecutionEngine;
  claudeReasoningEffort?: string;
  codexReasoningEffort?: string;
}

export interface WiseHudSessionTab {
  id: string;
  title: string;
  repositoryName: string;
  status: ClaudeSession["status"];
  updatedAt: number;
  /** 主窗口按侧栏规则格式化，避免 HUD 端拿不到有效时间戳时显示 "—"。 */
  timeLabel: string;
}

export interface WiseHudSessionSnapshot {
  sessionId: string | null;
  sessionTitle: string;
  modelLabel: string;
  busy: boolean;
  canSend: boolean;
  canCancel: boolean;
  statusText: string;
  lastAssistantText: string;
  engine: SessionExecutionEngine;
  repositories: WiseHudRepositoryOption[];
  activeRepositoryId: number | null;
  composerSession: WiseHudComposerSession | null;
  sessionTabs: WiseHudSessionTab[];
  runningCount: number;
  runStatus: WiseHudRunStatus;
  repositoryRunStatus: WiseHudRepositoryRunStatus;
  messages: ClaudeMessage[];
}

export interface WiseHudSubmitPayload {
  text: string;
  sessionId?: string;
}

const HUD_FORWARD_EVENTS = [
  WISE_HUD_SUBMIT_EVENT,
  WISE_HUD_CANCEL_EVENT,
  WISE_HUD_REQUEST_STATE_EVENT,
  WISE_HUD_SELECT_REPOSITORY_EVENT,
  WISE_HUD_SELECT_SESSION_EVENT,
  WISE_HUD_NEW_SESSION_EVENT,
  WISE_HUD_SET_ENGINE_EVENT,
  WISE_HUD_SET_MODEL_EVENT,
  WISE_HUD_SET_DETAILS_OPEN_EVENT,
  WISE_HUD_ACTIVATE_ASSISTANT_EVENT,
  WISE_HUD_TOGGLE_REPOSITORY_RUN_EVENT,
  WISE_HUD_ADD_REPOSITORY_EVENT,
] as const;

export type WiseHudForwardEvent = (typeof HUD_FORWARD_EVENTS)[number];

export function isWiseHudForwardEvent(event: string): event is WiseHudForwardEvent {
  return (HUD_FORWARD_EVENTS as readonly string[]).includes(event);
}

export interface WiseHudSelectRepositoryPayload {
  repositoryId: number;
}

export interface WiseHudSelectSessionPayload {
  sessionId: string;
}

export interface WiseHudSetEnginePayload {
  engine: SessionExecutionEngine;
  sessionId?: string;
}

export interface WiseHudSetModelPayload {
  model: string;
  sessionId?: string;
}

export interface WiseHudSetDetailsOpenPayload {
  open: boolean;
}

export interface WiseHudActivateAssistantPayload {
  assistantId: string;
}

export interface WiseHudToggleRepositoryRunPayload {
  repositoryId: number;
}

export interface WiseHudAddRepositoryPayload {
  folderPath: string;
}

export interface WiseHudAddRepositoryResultPayload extends WiseHudAddRepositoryPayload {
  ok: boolean;
  error?: string;
}

export interface BuildWiseHudSessionSnapshotExtras {
  repositories?: ReadonlyArray<{ id: number; name: string; path: string; openAppId?: string | null }>;
  activeRepositoryId?: number | null;
  runningCount?: number;
  runStatus?: WiseHudRunStatus;
  repositoryRunStatus?: WiseHudRepositoryRunStatus;
  includeMessages?: boolean;
  sessions?: readonly ClaudeSession[];
}

const EMPTY_SNAPSHOT: WiseHudSessionSnapshot = {
  sessionId: null,
  sessionTitle: "",
  modelLabel: "Wise",
  busy: false,
  canSend: false,
  canCancel: false,
  statusText: "暂无会话，点展开回到主窗口",
  lastAssistantText: "",
  engine: "claude",
  repositories: [],
  activeRepositoryId: null,
  composerSession: null,
  sessionTabs: [],
  runningCount: 0,
  runStatus: "idle",
  repositoryRunStatus: "idle",
  messages: [],
};

export function isHudSessionBusyStatus(status: string): boolean {
  return status === "running" || status === "connecting";
}

export function countHudRunningSessions(
  sessions: ReadonlyArray<{ status: string }>,
): number {
  let count = 0;
  for (const item of sessions) {
    if (isHudSessionBusyStatus(item.status)) count += 1;
  }
  return count;
}

export function resolveHudRunStatus(
  runningCount: number,
  hadRunning: boolean,
): WiseHudRunStatus {
  if (runningCount > 0) return "running";
  if (hadRunning) return "completed";
  return "idle";
}

export function formatHudEffortLabel(
  engine: SessionExecutionEngine,
  session: Pick<ClaudeSession, "claudeReasoningEffort" | "codexReasoningEffort">,
): string {
  if (engine === "codex" || engine === "codex-rpc") {
    const raw = session.codexReasoningEffort?.trim() ?? "";
    if (isCodexReasoningEffort(raw)) return CODEX_REASONING_EFFORT_LABELS[raw];
    return "";
  }
  if (engine === "claude") {
    const raw = session.claudeReasoningEffort?.trim() ?? "";
    if (isClaudeReasoningEffort(raw)) return CLAUDE_REASONING_EFFORT_LABELS[raw];
    return "";
  }
  return "";
}

export function formatHudModelLabel(
  session: Pick<ClaudeSession, "model" | "claudeReasoningEffort" | "codexReasoningEffort">,
  engine: SessionExecutionEngine,
): string {
  const model = formatClaudeModelLabel(session.model ?? "");
  const effort = formatHudEffortLabel(engine, session);
  if (model && effort) return `${model} · ${effort}`;
  if (model) return model;
  return SESSION_EXECUTION_ENGINE_LABELS[engine]?.short ?? "Wise";
}

function hudSessionRecency(session: ClaudeSession): number {
  return getSessionUpdatedAt(session);
}

export function buildHudSessionTabs(sessions: readonly ClaudeSession[]): WiseHudSessionTab[] {
  return sessions.map((session) => {
    const source = resolveSessionListPreviewSource(session);
    const title = stripRedundantRepoBracketPrefix(source, session.repositoryName ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const updatedAt = hudSessionRecency(session);
    return {
      id: session.id,
      title: title || "新会话",
      repositoryName: session.repositoryName?.trim() || "",
      status: session.status,
      updatedAt,
      timeLabel: formatWorkspaceSidebarRelativeTime(updatedAt),
    };
  });
}

function resolveHudTabRepositoryPath(
  session: ClaudeSession | null | undefined,
  extras: BuildWiseHudSessionSnapshotExtras,
): string {
  const fromSession = session?.repositoryPath?.trim() ?? "";
  if (fromSession) return fromSession;
  const activeId = extras.activeRepositoryId;
  if (activeId == null) return "";
  return extras.repositories?.find((item) => item.id === activeId)?.path?.trim() ?? "";
}

function isHudUtilityHistorySession(session: ClaudeSession): boolean {
  return (
    isConventionalCommitPromptHistorySession(session) ||
    isCodeReviewPromptHistorySession(session) ||
    isSessionFeedbackLoopHistorySession(session)
  );
}

function listHudRepositoryHistorySessions(
  sessions: readonly ClaudeSession[],
  repositoryPath: string,
): ClaudeSession[] {
  return sessions
    .filter(
      (item) =>
        repositoryPathsMatch(item.repositoryPath, repositoryPath) &&
        !isHudUtilityHistorySession(item),
    )
    .sort((a, b) => {
      const byTime = hudSessionRecency(b) - hudSessionRecency(a);
      if (byTime !== 0) return byTime;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * HUD 详情可切换会话：当前会话、任意运行中会话，以及当前仓库的历史会话。
 * 运行中会话不受条数上限裁掉，避免进行中的任务从标签栏消失。
 */
export function collectHudSessionTabSessions(
  sessions: readonly ClaudeSession[],
  current: ClaudeSession | null | undefined,
  extras: BuildWiseHudSessionSnapshotExtras = {},
  limit = HUD_SESSION_TAB_LIMIT,
): ClaudeSession[] {
  const seen = new Set<string>();
  const out: ClaudeSession[] = [];
  const push = (item: ClaudeSession | null | undefined): boolean => {
    const id = item?.id?.trim();
    if (!item || !id || seen.has(id)) return false;
    seen.add(id);
    out.push(item);
    return true;
  };

  push(current ?? null);

  for (const item of sessions) {
    if (isHudSessionBusyStatus(item.status)) push(item);
  }

  const repoPath = resolveHudTabRepositoryPath(current, extras);
  if (!repoPath) return out;

  const room = Math.max(0, limit - out.length);
  if (room === 0) return out;

  let added = 0;
  for (const item of listHudRepositoryHistorySessions(sessions, repoPath)) {
    if (added >= room) break;
    if (push(item)) added += 1;
  }
  return out;
}

const HUD_THINKING_PREVIEW_PREFIX = "[思考过程]";

/** HUD 预览 / 完成通知只用助手正文，不带思考过程。 */
function assistantReplyTextForHudPreview(msg: ClaudeMessage): string {
  const parts = msg.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    return parts
      .filter((part): part is TextPart => part.type === "text")
      .map((part) => part.text.trim())
      .filter(
        (chunk) =>
          chunk.length > 0 &&
          !isAssistantDisplayNoiseText(chunk) &&
          !chunk.startsWith(HUD_THINKING_PREVIEW_PREFIX),
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  const content = (msg.content ?? "").replace(/\s+/g, " ").trim();
  if (!content || isAssistantDisplayNoiseText(content)) return "";
  if (content.startsWith(HUD_THINKING_PREVIEW_PREFIX)) return "";
  return content;
}

export function resolveHudAssistantPreview(
  messages: readonly ClaudeMessage[] | undefined,
  maxLen = HUD_ASSISTANT_PREVIEW_MAX_LEN,
): string {
  if (!messages?.length) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]!;
    if (msg.role !== "assistant") continue;
    const text = assistantReplyTextForHudPreview(msg);
    if (!text) continue;
    if (text.length <= maxLen) return text;
    return `${text.slice(0, Math.max(1, maxLen - 1))}…`;
  }
  return "";
}

function mapHudRepositories(
  repositories: BuildWiseHudSessionSnapshotExtras["repositories"],
): WiseHudRepositoryOption[] {
  if (!repositories?.length) return [];
  return repositories.map((item) => ({
    id: item.id,
    name: item.name,
    path: item.path,
    openAppId: item.openAppId ?? null,
  }));
}

function buildHudComposerSession(
  session: ClaudeSession,
  engine: SessionExecutionEngine,
): WiseHudComposerSession {
  return {
    id: session.id,
    repositoryPath: session.repositoryPath ?? "",
    repositoryName: session.repositoryName ?? "",
    model: session.model ?? "",
    status: session.status,
    connectionKind: session.connectionKind,
    executionEngine: session.executionEngine ?? engine,
    claudeReasoningEffort: session.claudeReasoningEffort,
    codexReasoningEffort: session.codexReasoningEffort,
  };
}

export function buildWiseHudSessionSnapshot(
  session: ClaudeSession | null | undefined,
  engine: SessionExecutionEngine = "claude",
  extras: BuildWiseHudSessionSnapshotExtras = {},
): WiseHudSessionSnapshot {
  const repositories = mapHudRepositories(extras.repositories);
  const activeRepositoryId =
    extras.activeRepositoryId === undefined ? null : extras.activeRepositoryId;
  const runningCount = Math.max(0, Math.floor(extras.runningCount ?? 0));
  const runStatus = extras.runStatus ?? (runningCount > 0 ? "running" : "idle");
  const repositoryRunStatus = extras.repositoryRunStatus ?? "idle";
  const messages = extras.includeMessages && session ? [...session.messages] : [];
  const sessionTabs = buildHudSessionTabs(
    collectHudSessionTabSessions(extras.sessions ?? (session ? [session] : []), session, extras),
  );
  if (!session) {
    return {
      ...EMPTY_SNAPSHOT,
      repositories,
      activeRepositoryId,
      runningCount,
      runStatus,
      repositoryRunStatus,
      messages,
      sessionTabs,
    };
  }
  const busy = session.status === "running" || session.status === "connecting";
  const title =
    session.threadName?.trim() ||
    session.repositoryName?.trim() ||
    "";
  let statusText = title;
  if (session.status === "connecting") statusText = "正在连接…";
  else if (session.status === "running") statusText = "正在回复…";
  else if (session.status === "error") statusText = "本轮出错，可继续发送";
  return {
    sessionId: session.id,
    sessionTitle: title,
    modelLabel: formatHudModelLabel(session, engine),
    busy,
    canSend: Boolean(session.id),
    canCancel: busy,
    statusText,
    lastAssistantText: resolveHudAssistantPreview(session.messages),
    engine,
    repositories,
    activeRepositoryId,
    composerSession: buildHudComposerSession(session, engine),
    sessionTabs,
    runningCount,
    runStatus,
    repositoryRunStatus,
    messages,
  };
}

export function hudComposerSessionToClaudeSession(
  snapshot: WiseHudSessionSnapshot,
): ClaudeSession | null {
  const item = snapshot.composerSession;
  if (!item) return null;
  return {
    id: item.id,
    claudeSessionId: null,
    repositoryPath: item.repositoryPath,
    repositoryName: item.repositoryName,
    model: item.model,
    status: item.status,
    messages: snapshot.messages ?? [],
    createdAt: 0,
    pendingPrompt: "",
    connectionKind: item.connectionKind,
    executionEngine: item.executionEngine ?? snapshot.engine,
    claudeReasoningEffort: item.claudeReasoningEffort,
    codexReasoningEffort: item.codexReasoningEffort,
  };
}

function asSubmitObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

export function parseWiseHudSubmitPayload(raw: unknown): WiseHudSubmitPayload | null {
  const obj = asSubmitObject(raw);
  if (!obj) return null;
  const text = obj.text;
  if (typeof text !== "string") return null;
  const trimmed = text.replace(/\u200B/g, "").trim();
  if (!trimmed) return null;
  const sessionRaw = obj.sessionId;
  const sessionId =
    typeof sessionRaw === "string" && sessionRaw.trim() ? sessionRaw.trim() : undefined;
  return sessionId ? { text: trimmed, sessionId } : { text: trimmed };
}

/** HUD 提交带的 sessionId 若仍在主窗会话列表中则用之，否则回退当前激活会话。 */
export function resolveHudSubmitSessionId(
  payloadSessionId: string | undefined,
  activeSessionId: string | null,
  sessionIds: ReadonlyArray<string>,
): string | null {
  const hinted = payloadSessionId?.trim() || "";
  if (hinted && sessionIds.includes(hinted)) return hinted;
  const active = activeSessionId?.trim() || "";
  return active || null;
}

function parseHudSessionStatus(raw: unknown): ClaudeSession["status"] | null {
  if (typeof raw !== "string") return null;
  return (HUD_SESSION_STATUSES as readonly string[]).includes(raw)
    ? (raw as ClaudeSession["status"])
    : null;
}

function parseHudRepositories(raw: unknown): WiseHudRepositoryOption[] {
  if (!Array.isArray(raw)) return [];
  const out: WiseHudRepositoryOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as { id?: unknown; name?: unknown; path?: unknown; openAppId?: unknown };
    if (typeof value.id !== "number" || !Number.isFinite(value.id)) continue;
    if (typeof value.name !== "string" || typeof value.path !== "string") continue;
    out.push({
      id: value.id,
      name: value.name,
      path: value.path,
      openAppId: typeof value.openAppId === "string" ? value.openAppId : null,
    });
  }
  return out;
}

function parseHudUpdatedAt(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return 0;
}

function parseHudTimeLabel(raw: unknown, updatedAt: number): string {
  if (typeof raw === "string" && raw.trim() && raw.trim() !== "—") return raw.trim();
  return formatWorkspaceSidebarRelativeTime(updatedAt);
}

function parseHudSessionTabs(raw: unknown): WiseHudSessionTab[] {
  if (!Array.isArray(raw)) return [];
  const out: WiseHudSessionTab[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as {
      id?: unknown;
      title?: unknown;
      repositoryName?: unknown;
      status?: unknown;
      updatedAt?: unknown;
      timeLabel?: unknown;
    };
    const status = parseHudSessionStatus(value.status);
    if (typeof value.id !== "string" || !value.id.trim() || typeof value.title !== "string" || !status) continue;
    const updatedAt = parseHudUpdatedAt(value.updatedAt);
    out.push({
      id: value.id.trim(),
      title: value.title.trim() || "新会话",
      repositoryName: typeof value.repositoryName === "string" ? value.repositoryName : "",
      status,
      updatedAt,
      timeLabel: parseHudTimeLabel(value.timeLabel, updatedAt),
    });
  }
  return out;
}

function parseHudRunStatus(raw: unknown): WiseHudRunStatus {
  return raw === "running" || raw === "completed" || raw === "idle" ? raw : "idle";
}

function parseHudRepositoryRunStatus(raw: unknown): WiseHudRepositoryRunStatus {
  return raw === "running" || raw === "stopping" ? raw : "idle";
}

function parseHudRunningCount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

function parseHudMessages(raw: unknown): ClaudeMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ClaudeMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Partial<ClaudeMessage>;
    if (typeof value.id !== "number" || !Number.isFinite(value.id)) continue;
    if (value.role !== "user" && value.role !== "assistant" && value.role !== "system") continue;
    if (typeof value.content !== "string" || typeof value.timestamp !== "number") continue;
    out.push({
      id: value.id,
      role: value.role,
      content: value.content,
      parts: Array.isArray(value.parts) ? value.parts : [],
      timestamp: value.timestamp,
      defaultInstructionApplied:
        typeof value.defaultInstructionApplied === "string" ? value.defaultInstructionApplied : undefined,
    });
  }
  return out;
}

function parseHudComposerSession(raw: unknown): WiseHudComposerSession | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<WiseHudComposerSession>;
  if (typeof value.id !== "string" || !value.id) return null;
  const status = parseHudSessionStatus(value.status) ?? "idle";
  return {
    id: value.id,
    repositoryPath: typeof value.repositoryPath === "string" ? value.repositoryPath : "",
    repositoryName: typeof value.repositoryName === "string" ? value.repositoryName : "",
    model: typeof value.model === "string" ? value.model : "",
    status,
    connectionKind:
      value.connectionKind === "oneshot"
        ? "oneshot"
        : value.connectionKind === "streaming"
          ? "streaming"
          : undefined,
    executionEngine:
      typeof value.executionEngine === "string" && isSessionExecutionEngine(value.executionEngine)
        ? value.executionEngine
        : undefined,
    claudeReasoningEffort:
      typeof value.claudeReasoningEffort === "string" ? value.claudeReasoningEffort : undefined,
    codexReasoningEffort:
      typeof value.codexReasoningEffort === "string" ? value.codexReasoningEffort : undefined,
  };
}

export function parseWiseHudSessionSnapshot(raw: unknown): WiseHudSessionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<WiseHudSessionSnapshot>;
  if (value.sessionId !== null && typeof value.sessionId !== "string") return null;
  if (typeof value.modelLabel !== "string") return null;
  const engine: SessionExecutionEngine =
    typeof value.engine === "string" && isSessionExecutionEngine(value.engine)
      ? value.engine
      : "claude";
  const activeRepositoryId =
    typeof value.activeRepositoryId === "number" && Number.isFinite(value.activeRepositoryId)
      ? value.activeRepositoryId
      : null;
  return {
    sessionId: value.sessionId ?? null,
    sessionTitle: typeof value.sessionTitle === "string" ? value.sessionTitle : "",
    modelLabel: value.modelLabel,
    busy: value.busy === true,
    canSend: value.canSend === true,
    canCancel: value.canCancel === true,
    statusText: typeof value.statusText === "string" ? value.statusText : "",
    lastAssistantText:
      typeof value.lastAssistantText === "string" ? value.lastAssistantText : "",
    engine,
    repositories: parseHudRepositories(value.repositories),
    activeRepositoryId,
    composerSession: parseHudComposerSession(value.composerSession),
    sessionTabs: parseHudSessionTabs(value.sessionTabs),
    runningCount: parseHudRunningCount(value.runningCount),
    runStatus: parseHudRunStatus(value.runStatus),
    repositoryRunStatus: parseHudRepositoryRunStatus(value.repositoryRunStatus),
    messages: parseHudMessages(value.messages),
  };
}

export function parseWiseHudSelectRepositoryPayload(
  raw: unknown,
): WiseHudSelectRepositoryPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const repositoryId = (raw as { repositoryId?: unknown }).repositoryId;
  if (typeof repositoryId !== "number" || !Number.isFinite(repositoryId)) return null;
  return { repositoryId };
}

export function parseWiseHudSelectSessionPayload(raw: unknown): WiseHudSelectSessionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const sessionId = (raw as { sessionId?: unknown }).sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) return null;
  return { sessionId: sessionId.trim() };
}

function parseOptionalSessionId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

export function parseWiseHudSetEnginePayload(raw: unknown): WiseHudSetEnginePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const engineRaw = (raw as { engine?: unknown }).engine;
  if (typeof engineRaw !== "string" || !isSessionExecutionEngine(engineRaw)) return null;
  const sessionId = parseOptionalSessionId((raw as { sessionId?: unknown }).sessionId);
  return sessionId ? { engine: engineRaw, sessionId } : { engine: engineRaw };
}

export function parseWiseHudSetModelPayload(raw: unknown): WiseHudSetModelPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const modelRaw = (raw as { model?: unknown }).model;
  if (typeof modelRaw !== "string") return null;
  const model = modelRaw.trim();
  if (!model) return null;
  const sessionId = parseOptionalSessionId((raw as { sessionId?: unknown }).sessionId);
  return sessionId ? { model, sessionId } : { model };
}

export function parseWiseHudSetDetailsOpenPayload(raw: unknown): WiseHudSetDetailsOpenPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const open = (raw as { open?: unknown }).open;
  return typeof open === "boolean" ? { open } : null;
}

export function parseWiseHudActivateAssistantPayload(
  raw: unknown,
): WiseHudActivateAssistantPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const assistantIdRaw = (raw as { assistantId?: unknown }).assistantId;
  if (typeof assistantIdRaw !== "string") return null;
  const assistantId = assistantIdRaw.trim();
  return assistantId ? { assistantId } : null;
}

export function parseWiseHudToggleRepositoryRunPayload(
  raw: unknown,
): WiseHudToggleRepositoryRunPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const repositoryId = Number((raw as { repositoryId?: unknown }).repositoryId);
  if (!Number.isInteger(repositoryId) || repositoryId <= 0) return null;
  return { repositoryId };
}

/** HUD 只允许把明确选择的非空目录路径交给主窗口登记。 */
export function parseWiseHudAddRepositoryPayload(
  raw: unknown,
): WiseHudAddRepositoryPayload | null {
  const obj = asSubmitObject(raw);
  const folderPath = obj?.folderPath;
  if (typeof folderPath !== "string") return null;
  const trimmed = folderPath.trim();
  return trimmed ? { folderPath: trimmed } : null;
}

export function parseWiseHudAddRepositoryResultPayload(
  raw: unknown,
): WiseHudAddRepositoryResultPayload | null {
  const obj = asSubmitObject(raw);
  const request = parseWiseHudAddRepositoryPayload(obj);
  if (!request || typeof obj?.ok !== "boolean") return null;
  const error = typeof obj.error === "string" && obj.error.trim() ? obj.error.trim() : undefined;
  return obj.ok ? { ...request, ok: true } : { ...request, ok: false, error };
}

export function parseWiseHudActiveChanged(raw: unknown): boolean | null {
  if (!raw || typeof raw !== "object") return null;
  const active = (raw as { active?: unknown }).active;
  return typeof active === "boolean" ? active : null;
}

export function appendHudAttachmentMentions(draft: string, paths: readonly string[]): string {
  const mentions = paths
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => (path.startsWith("@") ? path : `@${path}`));
  if (mentions.length === 0) return draft;
  const base = draft.replace(/\s+$/u, "");
  if (!base) return `${mentions.join(" ")} `;
  return `${base} ${mentions.join(" ")} `;
}
