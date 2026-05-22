import type { ClaudeSession, ProjectItem, Repository } from "../types";
import { repositoryFolderBasename } from "./repositoryType";
import {
  isProjectRootSessionDisplayName,
  normalizeRepositoryPathKey,
  resolveRepositoryByClaudeSessionId,
  resolveRepositoryForSession,
} from "./repositoryMainSessionBinding";

const PLACEHOLDER_PATH_KEYS = new Set(["—", "-", ""]);

function isPlaceholderRepositoryPath(pathKey: string): boolean {
  return PLACEHOLDER_PATH_KEYS.has(pathKey);
}

export interface ClaudeProcessWorkspaceLabels {
  projectName: string | null;
  repositoryName: string | null;
  /** 侧栏卡片主标题：工作区名、或「工作区 · 仓库」、或路径末段 */
  scopeTitle: string;
  scopeSubtitle: string | null;
}

function basenameFromPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function findProjectForRepository(
  projects: ReadonlyArray<Pick<ProjectItem, "id" | "name" | "repositoryIds">>,
  repositoryId: number,
): Pick<ProjectItem, "id" | "name"> | null {
  return projects.find((project) => project.repositoryIds.includes(repositoryId)) ?? null;
}

function findProjectByRootPath(
  projects: ReadonlyArray<Pick<ProjectItem, "id" | "name" | "rootPath">>,
  sessionPathKey: string,
): Pick<ProjectItem, "id" | "name"> | null {
  let best: Pick<ProjectItem, "id" | "name"> | null = null;
  let bestDepth = -1;
  for (const project of projects) {
    const rootKey = normalizeRepositoryPathKey(project.rootPath ?? "");
    if (!rootKey || !sessionPathKey.startsWith(rootKey)) {
      continue;
    }
    if (rootKey.length > bestDepth) {
      bestDepth = rootKey.length;
      best = project;
    }
  }
  return best;
}

function enrichSessionForWorkspaceLabels(
  session: ClaudeSession,
  params: {
    projects: ReadonlyArray<ProjectItem>;
    repositories: Repository[];
    bindings: Record<string, string>;
    sessions: ClaudeSession[];
    claudeSessionId?: string | null;
  },
): ClaudeSession {
  const pathKey = normalizeRepositoryPathKey(session.repositoryPath);
  if (!isPlaceholderRepositoryPath(pathKey)) {
    return session;
  }
  const sid = params.claudeSessionId?.trim() || session.claudeSessionId?.trim() || "";
  if (!sid) {
    return session;
  }
  const wiseTab = params.sessions.find((item) => item.claudeSessionId?.trim() === sid);
  if (wiseTab && !isPlaceholderRepositoryPath(normalizeRepositoryPathKey(wiseTab.repositoryPath))) {
    return wiseTab;
  }
  const repo = resolveRepositoryByClaudeSessionId({
    claudeSessionId: sid,
    repositories: params.repositories,
    bindings: params.bindings,
    sessions: params.sessions,
  });
  if (repo) {
    return {
      ...session,
      repositoryPath: repo.path,
      repositoryName: repo.name,
    };
  }
  return session;
}

/** 为 Claude 进程弹层卡片解析工作区 / 仓库展示名。 */
export function resolveClaudeProcessWorkspaceLabels(params: {
  session: ClaudeSession;
  projects: ReadonlyArray<ProjectItem>;
  repositories: Repository[];
  bindings: Record<string, string>;
  sessions: ClaudeSession[];
  /** 系统扫描行可传入已解析的 Claude 会话 ID，用于反查 Wise 绑定。 */
  claudeSessionId?: string | null;
}): ClaudeProcessWorkspaceLabels {
  const { projects, repositories, bindings, sessions, claudeSessionId } = params;
  const session = enrichSessionForWorkspaceLabels(params.session, {
    projects,
    repositories,
    bindings,
    sessions,
    claudeSessionId,
  });
  const pathKey = normalizeRepositoryPathKey(session.repositoryPath);

  if (isProjectRootSessionDisplayName(session.repositoryName ?? "")) {
    const project =
      findProjectByRootPath(projects, pathKey) ??
      projects.find((item) => {
        const display = session.repositoryName?.replace(/^Project:\s*/i, "").trim();
        return display.length > 0 && item.name.trim() === display;
      }) ??
      null;
    const name = project?.name?.trim() || basenameFromPath(pathKey) || "工作区";
    return {
      projectName: name,
      repositoryName: null,
      scopeTitle: name,
      scopeSubtitle: "工作区主会话",
    };
  }

  const repository = resolveRepositoryForSession({
    session,
    repositories,
    bindings,
    sessions,
    preferredRepositoryId: null,
  });
  if (repository) {
    const project = findProjectForRepository(projects, repository.id);
    const repoLabel = repositoryFolderBasename(repository) || repository.name?.trim() || "仓库";
    const projectName = project?.name?.trim() ?? null;
    return {
      projectName,
      repositoryName: repoLabel,
      scopeTitle: projectName ? `${projectName} · ${repoLabel}` : repoLabel,
      scopeSubtitle: projectName ? "工作区仓库" : "单仓",
    };
  }

  const rawLabel = basenameFromPath(pathKey) || session.repositoryName?.trim() || "";
  const pathLabel =
    rawLabel && !isPlaceholderRepositoryPath(normalizeRepositoryPathKey(rawLabel))
      ? rawLabel
      : "本机 Claude 进程";
  return {
    projectName: null,
    repositoryName: null,
    scopeTitle: pathLabel,
    scopeSubtitle: claudeSessionId?.trim() ? "未绑定工作区 / 仓库" : null,
  };
}
