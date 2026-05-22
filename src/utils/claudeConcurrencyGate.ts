import type { ClaudeSession, ProjectItem, Repository } from "../types";
import {
  claudeConcurrencyScopeKey,
  getConcurrencyLimitForScope,
  type ClaudeConcurrencyLimitsMap,
} from "../services/claudeConcurrencyLimits";
import { repositoryFolderBasename } from "./repositoryType";

/** 与路径解析、spawn 槽位一致：统一分隔符与尾部斜杠，减少「路径写法不同导致并发不计入」的问题。 */
function normalizeRepositoryPath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function findRepositoryBySessionPath(repositories: Repository[], sessionPath: string): Repository | undefined {
  const n = normalizeRepositoryPath(sessionPath);
  return repositories.find((r) => normalizeRepositoryPath(r.path) === n);
}

function resolveProjectForSession(
  session: ClaudeSession,
  projects: ProjectItem[],
  repository: Repository,
  preferredProjectId: string | null,
): ProjectItem | null {
  const containing = projects.filter((p) => p.repositoryIds.includes(repository.id));
  if (containing.length === 0) {
    return null;
  }
  for (const p of containing) {
    const prefix = `${p.name}/`;
    if (session.repositoryName.startsWith(prefix)) {
      return p;
    }
  }
  if (session.repositoryName === repositoryFolderBasename(repository)) {
    const preferred = preferredProjectId ? containing.find((p) => p.id === preferredProjectId) : undefined;
    return preferred ?? containing[0] ?? null;
  }
  const employeeMarker = "/员工:";
  const idx = session.repositoryName.indexOf(employeeMarker);
  if (idx > 0) {
    const ownerPrefix = session.repositoryName.slice(0, idx);
    const slash = ownerPrefix.lastIndexOf("/");
    if (slash > 0) {
      const maybeProject = ownerPrefix.slice(0, slash);
      const byName = containing.find((p) => p.name === maybeProject);
      if (byName) {
        return byName;
      }
    }
  }
  return containing[0] ?? null;
}

export function resolveClaudeConcurrencyInvokeContext(params: {
  session: ClaudeSession;
  projects: ProjectItem[];
  repositories: Repository[];
  limitsMap: ClaudeConcurrencyLimitsMap;
  preferredProjectId: string | null;
}): { concurrencyScopeKey: string; concurrencyLimit: number } | null {
  const repository = findRepositoryBySessionPath(params.repositories, params.session.repositoryPath);
  if (!repository) {
    return null;
  }
  const project = resolveProjectForSession(
    params.session,
    params.projects,
    repository,
    params.preferredProjectId,
  );
  if (!project) {
    return null;
  }
  const limit = getConcurrencyLimitForScope(params.limitsMap, project.id, repository.id);
  return {
    concurrencyScopeKey: claudeConcurrencyScopeKey(project.id, repository.id),
    concurrencyLimit: limit,
  };
}

/** 与 `resolveClaudeConcurrencyInvokeContext` 一致：无法解析归属时返回 null（与后台不占槽一致）。 */
export function getClaudeSessionConcurrencyScopeKey(params: {
  session: ClaudeSession;
  projects: ProjectItem[];
  repositories: Repository[];
  limitsMap: ClaudeConcurrencyLimitsMap;
  preferredProjectId: string | null;
}): string | null {
  return resolveClaudeConcurrencyInvokeContext(params)?.concurrencyScopeKey ?? null;
}

/** 解析会话所属项目与仓库（与并发槽位归属一致）。 */
export function resolveSessionProjectRepository(params: {
  session: ClaudeSession;
  projects: ProjectItem[];
  repositories: Repository[];
  preferredProjectId: string | null;
}): { project: ProjectItem; repository: Repository } | null {
  const repository = findRepositoryBySessionPath(params.repositories, params.session.repositoryPath);
  if (!repository) {
    return null;
  }
  const project = resolveProjectForSession(
    params.session,
    params.projects,
    repository,
    params.preferredProjectId,
  );
  if (!project) {
    return null;
  }
  return { project, repository };
}

export function countRunningClaudeSessionsInProjectRepository(
  sessions: ClaudeSession[],
  project: ProjectItem,
  repository: Repository,
  projects: ProjectItem[],
  repositories: Repository[],
  limitsMap: ClaudeConcurrencyLimitsMap,
  preferredProjectId: string | null,
): number {
  const targetKey = claudeConcurrencyScopeKey(project.id, repository.id);
  return sessions.filter((s) => {
    if (s.status !== "running" && s.status !== "connecting") {
      return false;
    }
    return (
      getClaudeSessionConcurrencyScopeKey({
        session: s,
        projects,
        repositories,
        limitsMap,
        preferredProjectId,
      }) === targetKey
    );
  }).length;
}

/**
 * 在即将 `executeClaudeCode` / `resumeClaudeCode` 启动子进程前调用（oneshot 下每轮均起新进程）。
 */
export function evaluateBeforeSpawnClaudeCode(params: {
  spawningSession: ClaudeSession;
  sessions: ClaudeSession[];
  projects: ProjectItem[];
  repositories: Repository[];
  limitsMap: ClaudeConcurrencyLimitsMap;
  preferredProjectId: string | null;
}): { ok: true } | { ok: false; message: string } {
  const { spawningSession, sessions, projects, repositories, limitsMap, preferredProjectId } = params;
  const repository = findRepositoryBySessionPath(repositories, spawningSession.repositoryPath);
  if (!repository) {
    return { ok: true };
  }
  const project = resolveProjectForSession(spawningSession, projects, repository, preferredProjectId);
  if (!project) {
    return { ok: true };
  }
  const spawningCtx = resolveClaudeConcurrencyInvokeContext({
    session: spawningSession,
    projects,
    repositories,
    limitsMap,
    preferredProjectId,
  });
  if (!spawningCtx) {
    return { ok: true };
  }
  const limit = getConcurrencyLimitForScope(limitsMap, project.id, repository.id);
  const others = sessions.filter((s) => {
    if (s.id === spawningSession.id) {
      return false;
    }
    if (s.status !== "running" && s.status !== "connecting") {
      return false;
    }
    const k = getClaudeSessionConcurrencyScopeKey({
      session: s,
      projects,
      repositories,
      limitsMap,
      preferredProjectId,
    });
    return k === spawningCtx.concurrencyScopeKey;
  }).length;
  if (others >= limit) {
    return {
      ok: false,
      message: `「${project.name} / ${repositoryFolderBasename(repository)}」Claude Code 并发已达上限（${limit}），请先结束其它会话或双击侧栏「并发」调大上限。`,
    };
  }
  return { ok: true };
}
