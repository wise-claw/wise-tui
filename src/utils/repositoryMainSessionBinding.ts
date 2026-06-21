import type { ClaudeSession, Repository } from "../types";
import { extractBoundEmployeeNameFromDisplay } from "./sessionOwnerHints";

export const REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY = "wise.repositoryMainSessionBindings.v1";

/** 项目主会话绑定 key，与成员仓 filesystem path 隔离。 */
export const PROJECT_MAIN_SESSION_BINDING_PREFIX = "wise://workspace/";

export function projectMainSessionBindingKey(projectId: string): string {
  return `${PROJECT_MAIN_SESSION_BINDING_PREFIX}${projectId.trim()}`;
}

export function isProjectMainSessionBindingKey(key: string): boolean {
  return normalizeRepositoryPathKey(key).startsWith(PROJECT_MAIN_SESSION_BINDING_PREFIX);
}

export function normalizeRepositoryPathKey(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

/** 比较仓库路径是否指向同一目录（忽略尾部斜杠与 Windows 分隔符）。 */
export function repositoryPathsMatch(a: string, b: string): boolean {
  const left = normalizeRepositoryPathKey(a);
  const right = normalizeRepositoryPathKey(b);
  return left.length > 0 && left === right;
}

export function isProjectRootSessionDisplayName(repositoryName: string): boolean {
  return repositoryName.trim().startsWith("Project: ");
}

function isNestedRepositoryPath(repositoryPathKey: string, sessionPathKey: string): boolean {
  return repositoryPathKey.length > sessionPathKey.length && repositoryPathKey.startsWith(`${sessionPathKey}/`);
}

function isProjectRootedSessionForRepository(
  session: ClaudeSession,
  repositoryPathKey: string,
): boolean {
  const sessionPathKey = normalizeRepositoryPathKey(session.repositoryPath);
  if (!sessionPathKey || !isProjectRootSessionDisplayName(session.repositoryName ?? "")) {
    return false;
  }
  return isNestedRepositoryPath(repositoryPathKey, sessionPathKey);
}

/** 历史会话 / 磁盘扫描：成员仓视图下也包含挂在工作区根目录的项目级会话。 */
export function sessionMatchesRepositoryScope(session: ClaudeSession, repositoryPath: string): boolean {
  const scopeKey = normalizeRepositoryPathKey(repositoryPath);
  if (!scopeKey) return false;
  if (repositoryPathsMatch(session.repositoryPath ?? "", repositoryPath)) return true;
  return isProjectRootedSessionForRepository(session, scopeKey);
}

export function parseRepositoryMainSessionBindings(raw: string | null | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) {
        out[normalizeRepositoryPathKey(k)] = v.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 可作为「仓库主会话」绑定目标：
 * - 未配置主 Owner 智能体：路径一致且无 `员工:` 子会话展示名；
 * - 已配置：路径一致且 `员工:` 后姓名与配置一致。
 */
export function isRepositoryMainSessionTab(
  session: ClaudeSession,
  repositoryPathKey: string,
  mainOwnerAgentName?: string | null,
): boolean {
  const sessionPathKey = normalizeRepositoryPathKey(session.repositoryPath);
  if (sessionPathKey !== repositoryPathKey) {
    return isProjectRootedSessionForRepository(session, repositoryPathKey);
  }
  const configured = mainOwnerAgentName?.trim();
  const employeeName = extractBoundEmployeeNameFromDisplay(session.repositoryName ?? "");
  if (configured) {
    return employeeName === configured;
  }
  return !employeeName;
}

export function resolveMainOwnerAgentNameForRepositoryPath(
  repositories: Repository[],
  repositoryPath: string,
): string | null {
  const key = normalizeRepositoryPathKey(repositoryPath);
  const hit = repositories.find((r) => normalizeRepositoryPathKey(r.path) === key);
  const v = hit?.mainOwnerAgentName?.trim();
  return v && v.length > 0 ? v : null;
}

/** 绑定值可能是 Wise 标签 `id`，也可能是迁移后的 Claude `claudeSessionId`。 */
export function resolveSessionFromBindingValue(
  bound: string,
  sessions: readonly ClaudeSession[],
): ClaudeSession | null {
  const v = bound.trim();
  if (!v) {
    return null;
  }
  return (
    sessions.find((x) => x.id === v) ?? sessions.find((x) => x.claudeSessionId?.trim() === v) ?? null
  );
}

export function resolveBoundMainSessionId(
  repositoryPath: string,
  bindings: Record<string, string> | null | undefined,
  sessions: readonly ClaudeSession[],
  mainOwnerAgentName?: string | null,
): string | null {
  const key = normalizeRepositoryPathKey(repositoryPath);
  const bound = bindings?.[key]?.trim();
  if (!bound) return null;
  const s = resolveSessionFromBindingValue(bound, sessions);
  if (!s) return null;
  if (isProjectMainSessionBindingKey(key)) {
    if (extractBoundEmployeeNameFromDisplay(s.repositoryName ?? "")) {
      return null;
    }
    return s.id;
  }
  if (isRepositoryMainSessionTab(s, key, mainOwnerAgentName)) {
    return s.id;
  }
  return null;
}

/** 该 Wise 标签是否已是当前仓库（或项目）主会话绑定目标 */
export function isSessionBoundAsRepositoryMain(
  session: ClaudeSession,
  bindings: Record<string, string>,
  sessions: readonly ClaudeSession[],
  repositories: Repository[],
): boolean {
  const path = session.repositoryPath?.trim();
  if (!path) {
    return false;
  }
  const mainOwner = resolveMainOwnerAgentNameForRepositoryPath(repositories, path);
  return resolveBoundMainSessionId(path, bindings, sessions, mainOwner) === session.id;
}

/** 仅凭 Claude 会话 ID 反查已注册仓库（Wise 标签或主会话绑定表）。 */
export function resolveRepositoryByClaudeSessionId(params: {
  claudeSessionId: string;
  repositories: Repository[];
  bindings: Record<string, string>;
  sessions: readonly ClaudeSession[];
}): Repository | null {
  const sid = params.claudeSessionId.trim();
  if (!sid) {
    return null;
  }

  const directSession = params.sessions.find((item) => item.claudeSessionId?.trim() === sid);
  if (directSession) {
    return resolveRepositoryForSession({
      session: directSession,
      repositories: params.repositories,
      bindings: params.bindings,
      sessions: params.sessions,
    });
  }

  for (const [pathKey, bound] of Object.entries(params.bindings)) {
    if (isProjectMainSessionBindingKey(pathKey)) {
      continue;
    }
    const repoPathKey = normalizeRepositoryPathKey(pathKey);
    const boundSession = resolveSessionFromBindingValue(bound, params.sessions);
    const matches =
      bound.trim() === sid || boundSession?.claudeSessionId?.trim() === sid;
    if (!matches) {
      continue;
    }
    const repo = params.repositories.find(
      (item) => normalizeRepositoryPathKey(item.path) === repoPathKey,
    );
    if (repo) {
      return repo;
    }
  }
  return null;
}

/**
 * 仓库主会话绑定先看仓库自身 key；若没有，则回退到「项目根主会话」：
 * 绑定表里若某个 session 的路径是该仓库的父目录且展示名为 `Project: ...`，
 * 则视为该仓库可回切的主会话。
 */
export function resolveRepositoryMainSessionId(
  repositoryPath: string,
  bindings: Record<string, string>,
  sessions: readonly ClaudeSession[],
  mainOwnerAgentName?: string | null,
): string | null {
  const direct = resolveBoundMainSessionId(repositoryPath, bindings, sessions, mainOwnerAgentName);
  if (direct) {
    return direct;
  }
  const key = normalizeRepositoryPathKey(repositoryPath);
  const seen = new Set<string>();
  let bestId: string | null = null;
  let bestDepth = -1;
  for (const rawId of Object.values(bindings)) {
    const sessionId = rawId.trim();
    if (!sessionId || seen.has(sessionId)) {
      continue;
    }
    seen.add(sessionId);
    const session = sessions.find((item) => item.id === sessionId);
    if (!session || !isProjectRootedSessionForRepository(session, key)) {
      continue;
    }
    const depth = normalizeRepositoryPathKey(session.repositoryPath).length;
    if (depth > bestDepth) {
      bestDepth = depth;
      bestId = session.id;
    }
  }
  return bestId;
}

/**
 * 会话若不是直接挂在某个仓库路径下，则回退到「哪些仓库把它当主会话」的逆向查询。
 * 项目根主会话会命中其成员仓库；若同时命中多个仓库，优先当前已选中的那个。
 */
export function resolveRepositoryForSession(params: {
  session: ClaudeSession;
  repositories: Repository[];
  bindings: Record<string, string>;
  sessions: readonly ClaudeSession[];
  preferredRepositoryId?: number | null;
}): Repository | null {
  const { session, repositories, bindings, sessions, preferredRepositoryId } = params;
  const directKey = normalizeRepositoryPathKey(session.repositoryPath);
  const direct = repositories.find((repo) => normalizeRepositoryPathKey(repo.path) === directKey);
  if (direct) {
    return direct;
  }

  const matched = repositories.filter((repo) => {
    const mainOwnerAgentName = resolveMainOwnerAgentNameForRepositoryPath(repositories, repo.path);
    return resolveRepositoryMainSessionId(repo.path, bindings, sessions, mainOwnerAgentName) === session.id;
  });
  if (matched.length === 0) {
    return null;
  }
  if (preferredRepositoryId != null) {
    const preferred = matched.find((repo) => repo.id === preferredRepositoryId);
    if (preferred) {
      return preferred;
    }
  }
  matched.sort(
    (a, b) => normalizeRepositoryPathKey(b.path).length - normalizeRepositoryPathKey(a.path).length,
  );
  return matched[0] ?? null;
}

export function sessionMatchesRepository(params: {
  session: ClaudeSession;
  repository: Repository;
  bindings: Record<string, string>;
  sessions: readonly ClaudeSession[];
}): boolean {
  const { session, repository, bindings, sessions } = params;
  const resolved = resolveRepositoryForSession({
    session,
    repositories: [repository],
    bindings,
    sessions,
    preferredRepositoryId: repository.id,
  });
  return resolved?.id === repository.id;
}
