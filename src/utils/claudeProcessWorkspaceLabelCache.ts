import type { ClaudeHostProcess, ClaudeSession, ProjectItem, Repository } from "../types";
import { normalizeRepositoryPathKey } from "./repositoryMainSessionBinding";
import {
  GENERIC_CLAUDE_PROCESS_SCOPE_TITLE,
  resolveClaudeProcessWorkspaceLabels,
  type ClaudeProcessWorkspaceLabels,
} from "./resolveClaudeProcessWorkspaceLabels";

export { GENERIC_CLAUDE_PROCESS_SCOPE_TITLE };

export const CLAUDE_PROCESS_WORKSPACE_LABEL_CACHE_KEY =
  "wise.claudeProcessWorkspaceLabelCache.v1";

/** 内存中最多保留的进程标签缓存条目（按 updatedAt 保留最新） */
export const CLAUDE_PROCESS_LABEL_CACHE_MAX_ENTRIES = 96;

const PLACEHOLDER_PATH_KEYS = new Set(["—", "-", ""]);

export interface ClaudeProcessLabelCacheEntry {
  scopeTitle: string;
  scopeSubtitle: string | null;
  projectName: string | null;
  repositoryName: string | null;
  repositoryPathKey: string | null;
  updatedAt: number;
}

export interface ClaudeProcessWorkspaceLabelCacheState {
  byKey: Map<string, ClaudeProcessLabelCacheEntry>;
}

export interface ClaudeProcessLabelCacheLookupKeys {
  pid?: number | null;
  claudeSessionId?: string | null;
  projectPathKey?: string | null;
}

export function createClaudeProcessWorkspaceLabelCache(
  stored?: Record<string, ClaudeProcessLabelCacheEntry>,
): ClaudeProcessWorkspaceLabelCacheState {
  const byKey = new Map<string, ClaudeProcessLabelCacheEntry>();
  if (stored) {
    for (const [key, entry] of Object.entries(stored)) {
      const title = entry?.scopeTitle?.trim();
      if (!key.trim() || !title || !isResolvedClaudeProcessScopeTitle(title)) {
        continue;
      }
      byKey.set(key.trim(), {
        scopeTitle: title,
        scopeSubtitle: entry.scopeSubtitle ?? null,
        projectName: entry.projectName ?? null,
        repositoryName: entry.repositoryName ?? null,
        repositoryPathKey: entry.repositoryPathKey?.trim() || null,
        updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
      });
    }
  }
  return { byKey };
}

export function isResolvedClaudeProcessScopeTitle(scopeTitle: string): boolean {
  return scopeTitle.trim() !== GENERIC_CLAUDE_PROCESS_SCOPE_TITLE;
}

export function cacheKeyForPid(pid: number): string {
  return `pid:${pid}`;
}

export function cacheKeyForClaudeSessionId(claudeSessionId: string): string {
  return `sid:${claudeSessionId.trim()}`;
}

export function cacheKeyForProjectPath(projectPathKey: string): string {
  return `path:${normalizeRepositoryPathKey(projectPathKey)}`;
}

function isPlaceholderPathKey(pathKey: string): boolean {
  return PLACEHOLDER_PATH_KEYS.has(pathKey);
}

export function lookupClaudeProcessLabelCache(
  state: ClaudeProcessWorkspaceLabelCacheState,
  keys: ClaudeProcessLabelCacheLookupKeys,
): ClaudeProcessLabelCacheEntry | null {
  const order: string[] = [];
  const sid = keys.claudeSessionId?.trim();
  if (sid) {
    order.push(cacheKeyForClaudeSessionId(sid));
  }
  if (keys.pid != null && Number.isFinite(keys.pid) && keys.pid > 0) {
    order.push(cacheKeyForPid(keys.pid));
  }
  const pathKey = keys.projectPathKey?.trim()
    ? normalizeRepositoryPathKey(keys.projectPathKey)
    : "";
  if (pathKey && !isPlaceholderPathKey(pathKey)) {
    order.push(cacheKeyForProjectPath(pathKey));
  }
  for (const key of order) {
    const hit = state.byKey.get(key);
    if (hit) {
      return hit;
    }
  }
  return null;
}

export function labelsFromCacheEntry(
  entry: ClaudeProcessLabelCacheEntry,
): ClaudeProcessWorkspaceLabels {
  return {
    projectName: entry.projectName,
    repositoryName: entry.repositoryName,
    scopeTitle: entry.scopeTitle,
    scopeSubtitle: entry.scopeSubtitle,
  };
}

export function entryFromWorkspaceLabels(
  labels: ClaudeProcessWorkspaceLabels,
  repositoryPathKey: string | null,
): ClaudeProcessLabelCacheEntry {
  return {
    scopeTitle: labels.scopeTitle,
    scopeSubtitle: labels.scopeSubtitle,
    projectName: labels.projectName,
    repositoryName: labels.repositoryName,
    repositoryPathKey,
    updatedAt: Date.now(),
  };
}

const MAX_CACHE_ENTRIES = CLAUDE_PROCESS_LABEL_CACHE_MAX_ENTRIES;

function trimClaudeProcessLabelCache(state: ClaudeProcessWorkspaceLabelCacheState): void {
  if (state.byKey.size <= MAX_CACHE_ENTRIES) {
    return;
  }
  const ranked = [...state.byKey.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const keep = new Set(ranked.slice(0, MAX_CACHE_ENTRIES).map(([key]) => key));
  for (const key of state.byKey.keys()) {
    if (!keep.has(key)) {
      state.byKey.delete(key);
    }
  }
}

/** @internal test helper — 返回是否删除了条目 */
export function pruneClaudeProcessLabelCache(
  state: ClaudeProcessWorkspaceLabelCacheState,
  maxEntries: number = CLAUDE_PROCESS_LABEL_CACHE_MAX_ENTRIES,
): boolean {
  if (state.byKey.size <= maxEntries) return false;
  const ranked = [...state.byKey.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const keep = new Set(ranked.slice(0, maxEntries).map(([key]) => key));
  let changed = false;
  for (const key of [...state.byKey.keys()]) {
    if (keep.has(key)) continue;
    state.byKey.delete(key);
    changed = true;
  }
  return changed;
}

export function rememberClaudeProcessLabelCache(
  state: ClaudeProcessWorkspaceLabelCacheState,
  keys: ClaudeProcessLabelCacheLookupKeys,
  entry: ClaudeProcessLabelCacheEntry,
): void {
  if (!isResolvedClaudeProcessScopeTitle(entry.scopeTitle)) {
    return;
  }
  const keySet = new Set<string>();
  const sid = keys.claudeSessionId?.trim();
  if (sid) {
    keySet.add(cacheKeyForClaudeSessionId(sid));
  }
  if (keys.pid != null && Number.isFinite(keys.pid) && keys.pid > 0) {
    keySet.add(cacheKeyForPid(keys.pid));
  }
  const pathKey = keys.projectPathKey?.trim()
    ? normalizeRepositoryPathKey(keys.projectPathKey)
    : entry.repositoryPathKey?.trim()
      ? normalizeRepositoryPathKey(entry.repositoryPathKey)
      : "";
  if (pathKey && !isPlaceholderPathKey(pathKey)) {
    keySet.add(cacheKeyForProjectPath(pathKey));
  }
  if (keySet.size === 0) {
    return;
  }
  const stamped: ClaudeProcessLabelCacheEntry = {
    ...entry,
    repositoryPathKey: pathKey && !isPlaceholderPathKey(pathKey) ? pathKey : entry.repositoryPathKey,
    updatedAt: Date.now(),
  };
  for (const key of keySet) {
    state.byKey.set(key, stamped);
  }
  trimClaudeProcessLabelCache(state);
}

export function serializeClaudeProcessLabelCache(
  state: ClaudeProcessWorkspaceLabelCacheState,
): Record<string, ClaudeProcessLabelCacheEntry> {
  const out: Record<string, ClaudeProcessLabelCacheEntry> = {};
  for (const [key, entry] of state.byKey) {
    out[key] = entry;
  }
  return out;
}

export function parseClaudeProcessLabelCachePayload(
  raw: unknown,
): Record<string, ClaudeProcessLabelCacheEntry> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, ClaudeProcessLabelCacheEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim() || value === null || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const row = value as Record<string, unknown>;
    const scopeTitle = typeof row.scopeTitle === "string" ? row.scopeTitle.trim() : "";
    if (!scopeTitle || !isResolvedClaudeProcessScopeTitle(scopeTitle)) {
      continue;
    }
    out[key.trim()] = {
      scopeTitle,
      scopeSubtitle: typeof row.scopeSubtitle === "string" ? row.scopeSubtitle : null,
      projectName: typeof row.projectName === "string" ? row.projectName : null,
      repositoryName: typeof row.repositoryName === "string" ? row.repositoryName : null,
      repositoryPathKey:
        typeof row.repositoryPathKey === "string" ? row.repositoryPathKey.trim() || null : null,
      updatedAt: typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : 0,
    };
  }
  return out;
}

export function enrichSessionWithHostProcessPath(
  session: ClaudeSession,
  proc: ClaudeHostProcess | undefined,
): ClaudeSession {
  const procPath = proc?.projectPath?.trim() ?? "";
  const sessionPath = session.repositoryPath?.trim() ?? "";
  const procPathKey = procPath ? normalizeRepositoryPathKey(procPath) : "";
  const sessionPathKey = sessionPath ? normalizeRepositoryPathKey(sessionPath) : "";
  if (procPathKey && !isPlaceholderPathKey(procPathKey)) {
    if (sessionPathKey === procPathKey) {
      return session;
    }
    const parts = procPath.replace(/\\/g, "/").split("/").filter(Boolean);
    const repoName = parts[parts.length - 1] ?? procPath;
    return {
      ...session,
      repositoryPath: procPath,
      repositoryName:
        session.repositoryName?.trim() && !isPlaceholderPathKey(normalizeRepositoryPathKey(session.repositoryName))
          ? session.repositoryName
          : repoName,
    };
  }
  return session;
}

export function syncClaudeProcessLabelCacheFromRuntime(
  state: ClaudeProcessWorkspaceLabelCacheState,
  params: {
    projects: ReadonlyArray<ProjectItem>;
    repositories: Repository[];
    bindings: Record<string, string>;
    sessions: readonly ClaudeSession[];
    claudeProcesses: ReadonlyArray<ClaudeHostProcess>;
  },
): boolean {
  let dirty = false;
  const ctx = {
    projects: params.projects,
    repositories: params.repositories,
    bindings: params.bindings,
    sessions: params.sessions,
  };

  const rememberLabels = (
    keys: ClaudeProcessLabelCacheLookupKeys,
    labels: ClaudeProcessWorkspaceLabels,
    repositoryPathKey: string | null,
  ) => {
    if (!isResolvedClaudeProcessScopeTitle(labels.scopeTitle)) {
      return;
    }
    rememberClaudeProcessLabelCache(
      state,
      keys,
      entryFromWorkspaceLabels(labels, repositoryPathKey),
    );
    dirty = true;
  };

  for (const session of params.sessions) {
    const sid = session.claudeSessionId?.trim() ?? "";
    if (!sid && session.status !== "running" && session.status !== "connecting") {
      continue;
    }
    const labels = resolveClaudeProcessWorkspaceLabels({
      session,
      ...ctx,
      claudeSessionId: sid || null,
    });
    const pathKey = normalizeRepositoryPathKey(session.repositoryPath);
    rememberLabels(
      {
        claudeSessionId: sid || null,
        projectPathKey: isPlaceholderPathKey(pathKey) ? null : pathKey,
      },
      labels,
      isPlaceholderPathKey(pathKey) ? null : pathKey,
    );
  }

  for (const proc of params.claudeProcesses) {
    if (!Number.isFinite(proc.pid) || proc.pid <= 0) {
      continue;
    }
    const sid = proc.sessionId?.trim() ?? "";
    const procPath = proc.projectPath?.trim() ?? "";
    const pathKey = procPath ? normalizeRepositoryPathKey(procPath) : "";
    const hostLike: ClaudeSession = {
      id: `__wise_host_claude__:${proc.pid}`,
      claudeSessionId: sid || null,
      repositoryPath: procPath || "—",
      repositoryName: procPath ? procPath.split("/").filter(Boolean).pop() ?? procPath : "—",
      model: "—",
      status: "running",
      messages: [],
      createdAt: Date.now(),
      pendingPrompt: "",
    };
    const sessionForLabels = enrichSessionWithHostProcessPath(hostLike, proc);
    const labels = resolveClaudeProcessWorkspaceLabels({
      session: sessionForLabels,
      ...ctx,
      claudeSessionId: sid || null,
    });
    rememberLabels(
      {
        pid: proc.pid,
        claudeSessionId: sid || null,
        projectPathKey: pathKey && !isPlaceholderPathKey(pathKey) ? pathKey : null,
      },
      labels,
      pathKey && !isPlaceholderPathKey(pathKey) ? pathKey : null,
    );
  }

  trimClaudeProcessLabelCache(state);

  return dirty;
}
