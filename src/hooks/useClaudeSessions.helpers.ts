import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { MutableRefObject } from "react";
import type { ClaudeDiskSessionItem, ClaudeHostProcess, ClaudeSession } from "../types";
import type { ClaudeSessionConnectionKind } from "../constants/claudeConnection";
import { sessionUsesStreamingConnection } from "../constants/claudeConnection";
import { MAX_REPO_DISK_INDEX_SESSIONS } from "../constants/claudeMessageListWindow";
import { getClaudeConfigModel } from "../services/claude";
import { setAppSetting } from "../services/appSettingsStore";
import { isTerminalWorkerWiseTab } from "../services/terminalDispatch";
import { preservesWorkerWiseTabId } from "../utils/sessionExecuteResolve";
import { isExecutionEnvironmentWorkerRepositoryName } from "../utils/executionEnvironmentDispatch";
import { latestTurnHasVisibleAssistantContent } from "./useClaudeSessions.transcript";
import { createClaudeStreamRuntime } from "../services/claudeStreamRuntime";
import { getSessionUpdatedAt } from "../components/ClaudeSessions/sessionGrouping";
import { isClaudeSessionRunningByHostProcesses } from "../utils/claudeHostRunningSessionIds";
import { normalizeRepositoryPathKey, repositoryPathsMatch } from "../utils/repositoryMainSessionBinding";
import { safeUnlisten } from "../utils/safeTauriUnlisten";

export type ClaudeStreamRuntimeHandlers = ReturnType<typeof createClaudeStreamRuntime>;

export function isClaudeConversationMissingError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (!text) return false;
  return /no conversation found with session id/i.test(text);
}

export function hydrateStreamingProcessRegistryFromHost(
  sessions: ClaudeSession[],
  claudeProcesses: ReadonlyArray<Pick<ClaudeHostProcess, "sessionId" | "pid" | "projectPath">>,
  streamingProcessByTab: Map<string, { claudeSessionId: string | null }>,
  defaultConnectionKind: ClaudeSessionConnectionKind,
): void {
  for (const session of sessions) {
    if (!sessionUsesStreamingConnection(session, defaultConnectionKind)) continue;
    if (!isClaudeSessionRunningByHostProcesses(session, claudeProcesses)) continue;
    const sid =
      session.claudeSessionId?.trim() ??
      streamingProcessByTab.get(session.id)?.claudeSessionId ??
      null;
    streamingProcessByTab.set(session.id, { claudeSessionId: sid });
  }
}

/** @internal Exported for unit tests. */
export function collectClaudeSessionSidecarIds(
  closedId: string,
  sessionIdMap: ReadonlyMap<string, string>,
  claudeSessionId?: string | null,
): Set<string> {
  const ids = new Set<string>([closedId]);
  const mapped = sessionIdMap.get(closedId);
  if (mapped) ids.add(mapped);
  for (const [temp, real] of sessionIdMap.entries()) {
    if (real === closedId || temp === closedId) {
      ids.add(temp);
      ids.add(real);
    }
  }
  const sid = claudeSessionId?.trim();
  if (sid) ids.add(sid);
  return ids;
}

interface ClaudeSessionStreamSidecarRefs {
  sessionIdMap: Map<string, string>;
  expectedTurnNonceByTabId: Map<string, number>;
  assistantStreamTextByTab: Map<string, string>;
  lastStreamLineBySession: Map<string, { line: string; at: number }>;
  lastStreamTextBySession: Map<string, { text: string; at: number }>;
  registryBootstrapDeadlineByClaudeSid: Map<string, number>;
}

/** @internal Exported for unit tests. */
export function purgeClaudeSessionStreamSidecarRefs(
  sessionId: string,
  refs: ClaudeSessionStreamSidecarRefs,
  streamingTargetIdRef: MutableRefObject<string | null>,
  claudeSessionId?: string | null,
): Set<string> {
  const sidecarIds = collectClaudeSessionSidecarIds(sessionId, refs.sessionIdMap, claudeSessionId);
  for (const id of sidecarIds) {
    refs.expectedTurnNonceByTabId.delete(id);
    refs.assistantStreamTextByTab.delete(id);
    refs.lastStreamLineBySession.delete(id);
    refs.lastStreamTextBySession.delete(id);
    refs.registryBootstrapDeadlineByClaudeSid.delete(id);
  }
  for (const [temp, real] of [...refs.sessionIdMap.entries()]) {
    if (sidecarIds.has(temp) || sidecarIds.has(real)) {
      refs.sessionIdMap.delete(temp);
    }
  }
  const refT = streamingTargetIdRef.current;
  if (refT !== null && sidecarIds.has(refT)) {
    streamingTargetIdRef.current = null;
  }
  return sidecarIds;
}

/** oneshot invocation 在 `type:result` complete 后子进程仍可能继续写 stdout，须保持监听至下一轮发送。 */
export function shouldKeepClaudeInvocationStreamAfterTurnComplete(input: {
  tabId: string;
  sessions: readonly ClaudeSession[];
  streamingProcessByTab: ReadonlyMap<string, unknown>;
  claudeInvocationInflight: ReadonlyMap<string, { tabId: string }>;
  defaultConnectionKind: ClaudeSessionConnectionKind;
}): boolean {
  const session = input.sessions.find((s) => s.id === input.tabId);
  if (
    input.streamingProcessByTab.has(input.tabId) &&
    session &&
    sessionUsesStreamingConnection(session, input.defaultConnectionKind)
  ) {
    return true;
  }
  return [...input.claudeInvocationInflight.values()].some((meta) => meta.tabId === input.tabId);
}

export async function attachClaudeInvocationStream(
  inv: string,
  stableTabId: string,
  rt: ClaudeStreamRuntimeHandlers,
  turnNonce: number,
  onCleaned?: () => void,
  resolveTurnNonce?: (stableTabId: string, boundNonce: number) => number,
  shouldKeepListeningAfterTurnComplete?: (stableTabId: string) => boolean,
): Promise<() => void> {
  let cleaned = false;
  let unlisteners: UnlistenFn[] = [];
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const unlisten of unlisteners) {
      safeUnlisten(unlisten);
    }
    unlisteners = [];
    onCleaned?.();
  };
  const attach = (event: string, handler: (payload: unknown) => void) =>
    listen(event, (e) => handler(e.payload));
  const pending = await Promise.all([
    attach(`claude-output:invocation:${inv}`, (payload) => {
      rt.handleOutputForSendTab(stableTabId, payload);
    }),
    attach(`claude-error:invocation:${inv}`, (payload) => {
      rt.handleErrorForSendTab(stableTabId, payload);
    }),
    attach(`claude-complete:invocation:${inv}`, (payload) => {
      const nonce = resolveTurnNonce?.(stableTabId, turnNonce) ?? turnNonce;
      const applied = rt.handleCompleteForSendTab(stableTabId, payload, nonce);
      if (applied && !shouldKeepListeningAfterTurnComplete?.(stableTabId)) {
        cleanup();
      }
    }),
    attach(`claude-output:${stableTabId}`, (payload) => {
      rt.handleOutputForSendTab(stableTabId, payload);
    }),
    attach(`claude-error:${stableTabId}`, (payload) => {
      rt.handleErrorForSendTab(stableTabId, payload);
    }),
    attach(`claude-complete:${stableTabId}`, (payload) => {
      const nonce = resolveTurnNonce?.(stableTabId, turnNonce) ?? turnNonce;
      const applied = rt.handleCompleteForSendTab(stableTabId, payload, nonce);
      if (applied && !shouldKeepListeningAfterTurnComplete?.(stableTabId)) {
        cleanup();
      }
    }),
  ]);
  if (cleaned) {
    for (const unlisten of pending) {
      safeUnlisten(unlisten);
    }
  } else {
    unlisteners = pending;
  }
  return cleanup;
}

export async function attachClaudeSessionStreamForTurn(
  claudeSessionId: string,
  stableTabId: string,
  rt: ClaudeStreamRuntimeHandlers,
  turnNonce: number,
  onCleaned?: () => void,
  resolveTurnNonce?: (stableTabId: string, boundNonce: number) => number,
  shouldKeepListeningAfterTurnComplete?: (stableTabId: string) => boolean,
): Promise<() => void> {
  const sid = claudeSessionId.trim();
  if (!sid) {
    return () => {};
  }
  let cleaned = false;
  let uo: UnlistenFn = () => {};
  let ue: UnlistenFn = () => {};
  let uc: UnlistenFn = () => {};
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    safeUnlisten(uo);
    safeUnlisten(ue);
    safeUnlisten(uc);
    onCleaned?.();
  };
  const [uo0, ue0, uc0] = await Promise.all([
    listen(`claude-output:${sid}`, (e) => {
      rt.handleOutputForSendTab(stableTabId, e.payload);
    }),
    listen(`claude-error:${sid}`, (e) => {
      rt.handleErrorForSendTab(stableTabId, e.payload);
    }),
    listen(`claude-complete:${sid}`, (e) => {
      const nonce = resolveTurnNonce?.(stableTabId, turnNonce) ?? turnNonce;
      const applied = rt.handleCompleteForSendTab(stableTabId, e.payload, nonce);
      if (applied && !shouldKeepListeningAfterTurnComplete?.(stableTabId)) {
        cleanup();
      }
    }),
  ]);
  if (cleaned) {
    safeUnlisten(uo0);
    safeUnlisten(ue0);
    safeUnlisten(uc0);
  } else {
    uo = uo0;
    ue = ue0;
    uc = uc0;
  }
  return cleanup;
}

export function generateId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function trellisContextIdForTab(tabSessionId: string): string {
  return `wise_${tabSessionId}`;
}

export const TRELLIS_CONTEXT_BINDING_STORAGE_KEY = "wise.claudeTrellisContextBindings.v1";
export const WORKFLOW_BINDING_STORAGE_KEY = "wise.workflow.sessionRunBindings.v1";
export const CONTROL_REQUEST_EXPIRE_MS = 60 * 60 * 1000;
export const CLAUDE_REGISTRY_BOOTSTRAP_WARMUP_MS = 60_000;
export const CLAUDE_STREAM_RUNTIME_READY_WAIT_MS = 12_000;
export const CLAUDE_STREAM_RUNTIME_READY_POLL_MS = 40;
export const CLAUDE_STREAM_STALL_MS = 45_000;
export const CODEX_STREAM_STALL_MS = 120_000;
export const CURSOR_STREAM_STALL_MS = 120_000;
export const CLAUDE_STREAM_STALL_HOOK_EXTEND_MS = 75_000;

export function sessionHasVisibleStreamProgress(session: ClaudeSession): boolean {
  if (session.status === "running" || session.status === "connecting") {
    return latestTurnHasVisibleAssistantContent(session.messages);
  }
  return session.messages.some((m) => {
    if (m.role === "assistant") {
      return m.content.trim().length > 0 || (m.parts?.length ?? 0) > 0;
    }
    if (m.role === "system" && m.content.trim().length > 0) {
      if (m.content.trim() === "Cursor SDK 执行中…") return false;
      return true;
    }
    return false;
  });
}

export function sessionHasHookSystemActivity(session: ClaudeSession): boolean {
  return session.messages.some(
    (m) => m.role === "system" && /Hook|hook|启动中/.test(m.content),
  );
}

export function persistWorkflowBindings(map: Map<string, string>): void {
  const payload = Object.fromEntries(Array.from(map.entries()));
  void setAppSetting(WORKFLOW_BINDING_STORAGE_KEY, JSON.stringify(payload));
}

export function persistTrellisContextBindings(map: Map<string, string>): void {
  const payload = Object.fromEntries(Array.from(map.entries()));
  void setAppSetting(TRELLIS_CONTEXT_BINDING_STORAGE_KEY, JSON.stringify(payload));
}

export function markClaudeRegistryBootstrapWarmup(
  mapRef: MutableRefObject<Map<string, number>>,
  claudeSessionId: string | null | undefined,
) {
  const sid = claudeSessionId?.trim();
  if (!sid) return;
  mapRef.current.set(sid, Date.now() + CLAUDE_REGISTRY_BOOTSTRAP_WARMUP_MS);
}

export function pruneClaudeRegistryBootstrapWarmup(
  mapRef: MutableRefObject<Map<string, number>>,
  runningIds: ReadonlySet<string>,
) {
  const m = mapRef.current;
  const now = Date.now();
  for (const [k, until] of m) {
    if (until <= now || runningIds.has(k)) {
      m.delete(k);
    }
  }
}

export function resolveTabIdForClaudeStream(
  sessions: ClaudeSession[],
  lineSid: string | null,
  refTid: string | null,
  sessionIdMap?: Map<string, string>,
): string | null {
  if (lineSid) {
    const bySid = sessions.find((s) => s.claudeSessionId === lineSid || s.id === lineSid);
    if (bySid) return bySid.id;
    if (sessionIdMap) {
      for (const s of sessions) {
        if (sessionIdMap.get(s.id) === lineSid) return s.id;
      }
    }
  }
  if (refTid) {
    const byRef = sessions.find((s) => s.id === refTid || s.claudeSessionId === refTid);
    if (byRef) return byRef.id;
    if (sessionIdMap) {
      const mapped = sessionIdMap.get(refTid);
      if (mapped) {
        const byMapped = sessions.find((s) => s.id === mapped || s.claudeSessionId === mapped);
        if (byMapped) return byMapped.id;
      }
      for (const s of sessions) {
        if (sessionIdMap.get(s.id) === refTid) return s.id;
      }
    }
    return refTid;
  }
  return null;
}

export function resolveTabIdFromCompletePayload(
  payload: unknown,
  sessions: ClaudeSession[],
  refTid: string | null,
  sessionIdMap?: Map<string, string>,
): string | null {
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    const raw = o.sessionId ?? o.session_id;
    const sid = typeof raw === "string" ? raw.trim() : "";
    if (sid && sid !== "unknown") {
      const match = sessions.find((s) => s.claudeSessionId === sid || s.id === sid);
      if (match) return match.id;
      if (sessionIdMap) {
        for (const s of sessions) {
          if (sessionIdMap.get(s.id) === sid) return s.id;
        }
      }
      return sid;
    }
  }
  if (typeof payload === "boolean") {
    return refTid ? resolveTabIdForClaudeStream(sessions, null, refTid, sessionIdMap) : null;
  }
  return refTid ? resolveTabIdForClaudeStream(sessions, null, refTid, sessionIdMap) : null;
}

function sessionMatchesDiskId(s: ClaudeSession, diskSessionId: string): boolean {
  return s.claudeSessionId === diskSessionId || s.id === diskSessionId;
}

function shouldPreserveRepositoryDisplayName(previous: string): boolean {
  if (isExecutionEnvironmentWorkerRepositoryName(previous)) return true;
  const marker = "员工:";
  const idx = previous.lastIndexOf(marker);
  if (idx < 0) {
    return false;
  }
  return previous.slice(idx + marker.length).trim().length > 0;
}

export async function modelsForRepositoryPaths(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  await Promise.all(
    unique.map(async (p) => {
      try {
        const m = await getClaudeConfigModel(p);
        if (m?.trim()) map.set(p, m.trim());
      } catch {
        /* ignore */
      }
    }),
  );
  return map;
}

export function pruneGhostRepositorySessions(
  sessions: ClaudeSession[],
  repositoryPath: string,
  disk: ClaudeDiskSessionItem[],
): ClaudeSession[] {
  if (disk.length === 0) {
    return sessions;
  }
  const diskIds = new Set(disk.map((d) => d.sessionId));
  return sessions.filter((s) => {
    if (!repositoryPathsMatch(s.repositoryPath, repositoryPath)) return true;
    if (isTerminalWorkerWiseTab(s)) return true;
    if (s.status === "running" || s.status === "connecting") return true;
    const claudeId = s.claudeSessionId?.trim();
    if (!claudeId) return true;
    if (diskIds.has(claudeId) || diskIds.has(s.id)) return true;
    if (s.messages.length > 0) return true;
    return false;
  });
}

export function pruneRepoDiskIndexSessions(
  sessions: ClaudeSession[],
  repositoryPath: string,
  maxDiskIndexSessions: number = MAX_REPO_DISK_INDEX_SESSIONS,
): ClaudeSession[] {
  const canonicalPath = normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim();
  const indexed: ClaudeSession[] = [];
  const rest: ClaudeSession[] = [];
  for (const session of sessions) {
    if (!repositoryPathsMatch(session.repositoryPath, canonicalPath)) {
      rest.push(session);
      continue;
    }
    const cid = session.claudeSessionId?.trim();
    const isWiseBoundTab = Boolean(cid && session.id !== cid);
    const isDiskIndexOnly =
      !isWiseBoundTab &&
      session.messages.length === 0 &&
      session.status !== "running" &&
      session.status !== "connecting" &&
      Boolean(cid || session.diskPreview?.trim());
    if (isDiskIndexOnly) {
      indexed.push(session);
    } else {
      rest.push(session);
    }
  }
  if (indexed.length <= maxDiskIndexSessions) return sessions;
  indexed.sort((a, b) => getSessionUpdatedAt(b) - getSessionUpdatedAt(a));
  const keptIndexed = indexed.slice(0, maxDiskIndexSessions);
  const keptIds = new Set(keptIndexed.map((s) => s.id));
  const droppedIds = new Set(indexed.filter((s) => !keptIds.has(s.id)).map((s) => s.id));
  if (droppedIds.size === 0) return sessions;
  return sessions.filter((s) => !droppedIds.has(s.id));
}

export function mergeRepositoryDiskSessions(
  prev: ClaudeSession[],
  repositoryPath: string,
  repositoryName: string,
  disk: ClaudeDiskSessionItem[],
  configFallbackModel: string,
): ClaudeSession[] {
  const canonicalPath = normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim();
  const pruned = pruneGhostRepositorySessions(prev, canonicalPath, disk);
  const copy = pruned.map((s) => ({ ...s }));

  for (let i = 0; i < copy.length; i++) {
    if (!repositoryPathsMatch(copy[i].repositoryPath, canonicalPath)) continue;
    const s = copy[i];
    const item = disk.find((d) => sessionMatchesDiskId(s, d.sessionId));
    if (item) {
      const preserveWiseTabId = isTerminalWorkerWiseTab(s) || preservesWorkerWiseTabId(s);
      copy[i] = {
        ...s,
        id: preserveWiseTabId ? s.id : item.sessionId,
        claudeSessionId: item.sessionId,
        repositoryPath: canonicalPath,
        repositoryName: shouldPreserveRepositoryDisplayName(s.repositoryName) ? s.repositoryName : repositoryName,
        model: item.modelHint ?? s.model,
        diskPreview: item.preview || s.diskPreview,
        createdAt: Math.min(s.createdAt, item.updatedAtMs),
      };
    } else {
      copy[i] = { ...s, repositoryPath: canonicalPath };
    }
  }

  const toAdd = disk
    .filter(
      (d) => !copy.some((s) => repositoryPathsMatch(s.repositoryPath, canonicalPath) && sessionMatchesDiskId(s, d.sessionId)),
    )
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, MAX_REPO_DISK_INDEX_SESSIONS);
  if (toAdd.length === 0) {
    return pruneRepoDiskIndexSessions(copy, canonicalPath);
  }

  const newRows: ClaudeSession[] = toAdd.map((item) => ({
    id: item.sessionId,
    claudeSessionId: item.sessionId,
    repositoryPath: canonicalPath,
    repositoryName,
    model: item.modelHint ?? configFallbackModel,
    status: "completed" as const,
    messages: [],
    createdAt: item.updatedAtMs,
    pendingPrompt: "",
    diskPreview: item.preview,
  }));

  let lastIdx = -1;
  for (let i = 0; i < copy.length; i++) {
    if (repositoryPathsMatch(copy[i].repositoryPath, canonicalPath)) lastIdx = i;
  }
  if (lastIdx === -1) {
    return pruneRepoDiskIndexSessions([...copy, ...newRows], canonicalPath);
  }
  return pruneRepoDiskIndexSessions(
    [...copy.slice(0, lastIdx + 1), ...newRows, ...copy.slice(lastIdx + 1)],
    canonicalPath,
  );
}
