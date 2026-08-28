import type { ClaudeMessage, ClaudeSession } from "../types";
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
import {
  chatMessagePlainTextForCopy,
  hasRenderableChatMessageBody,
} from "./claudeChatMessageDisplay";

export const WISE_HUD_STATE_EVENT = "wise-hud-state";
export const WISE_HUD_SUBMIT_EVENT = "wise-hud-submit";
export const WISE_HUD_CANCEL_EVENT = "wise-hud-cancel";
export const WISE_HUD_REQUEST_STATE_EVENT = "wise-hud-request-state";
export const WISE_HUD_ACTIVE_EVENT = "wise-hud-active-changed";
export const WISE_HUD_SELECT_REPOSITORY_EVENT = "wise-hud-select-repository";
export const WISE_HUD_NEW_SESSION_EVENT = "wise-hud-new-session";
export const WISE_HUD_SET_ENGINE_EVENT = "wise-hud-set-engine";
export const WISE_HUD_SET_MODEL_EVENT = "wise-hud-set-model";
export const WISE_HUD_SESSION_COMPLETE_EVENT = "wise-hud-session-complete";
export const WISE_HUD_SET_DETAILS_OPEN_EVENT = "wise-hud-set-details-open";

export const HUD_ASSISTANT_PREVIEW_MAX_LEN = 280;

export const HUD_RUN_STATUSES = ["idle", "running", "completed"] as const;

export type WiseHudRunStatus = (typeof HUD_RUN_STATUSES)[number];

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
  runningCount: number;
  runStatus: WiseHudRunStatus;
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
  WISE_HUD_NEW_SESSION_EVENT,
  WISE_HUD_SET_ENGINE_EVENT,
  WISE_HUD_SET_MODEL_EVENT,
  WISE_HUD_SET_DETAILS_OPEN_EVENT,
] as const;

export type WiseHudForwardEvent = (typeof HUD_FORWARD_EVENTS)[number];

export function isWiseHudForwardEvent(event: string): event is WiseHudForwardEvent {
  return (HUD_FORWARD_EVENTS as readonly string[]).includes(event);
}

export interface WiseHudSelectRepositoryPayload {
  repositoryId: number;
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

export interface BuildWiseHudSessionSnapshotExtras {
  repositories?: ReadonlyArray<{ id: number; name: string; path: string }>;
  activeRepositoryId?: number | null;
  runningCount?: number;
  runStatus?: WiseHudRunStatus;
  includeMessages?: boolean;
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
  runningCount: 0,
  runStatus: "idle",
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

export function resolveHudAssistantPreview(
  messages: readonly ClaudeMessage[] | undefined,
  maxLen = HUD_ASSISTANT_PREVIEW_MAX_LEN,
): string {
  if (!messages?.length) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]!;
    if (msg.role !== "assistant") continue;
    if (!hasRenderableChatMessageBody(msg)) continue;
    const text = chatMessagePlainTextForCopy(msg).replace(/\s+/g, " ").trim();
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
  const messages = extras.includeMessages && session ? [...session.messages] : [];
  if (!session) {
    return {
      ...EMPTY_SNAPSHOT,
      repositories,
      activeRepositoryId,
      runningCount,
      runStatus,
      messages,
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
    runningCount,
    runStatus,
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
    const value = item as { id?: unknown; name?: unknown; path?: unknown };
    if (typeof value.id !== "number" || !Number.isFinite(value.id)) continue;
    if (typeof value.name !== "string" || typeof value.path !== "string") continue;
    out.push({ id: value.id, name: value.name, path: value.path });
  }
  return out;
}

function parseHudRunStatus(raw: unknown): WiseHudRunStatus {
  return raw === "running" || raw === "completed" || raw === "idle" ? raw : "idle";
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
    runningCount: parseHudRunningCount(value.runningCount),
    runStatus: parseHudRunStatus(value.runStatus),
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
