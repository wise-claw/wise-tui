import type { ClaudeHostProcess, ClaudeSession, ClaudeSessionInfo, ProjectItem, Repository } from "../types";
import { hostProcessPathsCorrelate } from "./claudeHostRunningSessionIds";
import {
  isProjectRootSessionDisplayName,
  normalizeRepositoryPathKey,
} from "./repositoryMainSessionBinding";
import { resolveProjectMainSessionAnchor } from "./projectSessionAnchor";

export function collectProjectScopePathKeys(
  project: ProjectItem,
  repositories: Repository[],
): Set<string> {
  const keys = new Set<string>();
  const anchor = resolveProjectMainSessionAnchor(project, repositories);
  if (anchor.path.trim()) {
    keys.add(normalizeRepositoryPathKey(anchor.path));
  }
  for (const repoId of project.repositoryIds) {
    const repo = repositories.find((item) => item.id === repoId);
    if (repo?.path.trim()) {
      keys.add(normalizeRepositoryPathKey(repo.path));
    }
  }
  return keys;
}

export function collectRepositoryScopePathKeys(repositoryPath: string): Set<string> {
  const key = normalizeRepositoryPathKey(repositoryPath);
  return key ? new Set([key]) : new Set();
}

export function isPathInWorkspaceScope(pathKey: string, scopePathKeys: ReadonlySet<string>): boolean {
  if (!pathKey || scopePathKeys.size === 0) {
    return false;
  }
  for (const scopeKey of scopePathKeys) {
    if (hostProcessPathsCorrelate(scopeKey, pathKey)) {
      return true;
    }
  }
  return false;
}

export function isSessionInWorkspaceScope(
  session: Pick<ClaudeSession, "repositoryPath" | "repositoryName">,
  scopePathKeys: ReadonlySet<string>,
): boolean {
  const sessionPathKey = normalizeRepositoryPathKey(session.repositoryPath);
  if (!sessionPathKey || sessionPathKey === "—") {
    return false;
  }
  if (isPathInWorkspaceScope(sessionPathKey, scopePathKeys)) {
    return true;
  }
  if (!isProjectRootSessionDisplayName(session.repositoryName ?? "")) {
    return false;
  }
  for (const scopeKey of scopePathKeys) {
    if (sessionPathKey.length < scopeKey.length && scopeKey.startsWith(`${sessionPathKey}/`)) {
      return true;
    }
  }
  return false;
}

export function isHostProcessInWorkspaceScope(
  proc: Pick<ClaudeHostProcess, "projectPath">,
  scopePathKeys: ReadonlySet<string>,
): boolean {
  const procPathKey = proc.projectPath?.trim()
    ? normalizeRepositoryPathKey(proc.projectPath)
    : "";
  if (!procPathKey) {
    return false;
  }
  return isPathInWorkspaceScope(procPathKey, scopePathKeys);
}

export function isRegistryInfoInWorkspaceScope(
  info: Pick<ClaudeSessionInfo, "project_path">,
  scopePathKeys: ReadonlySet<string>,
): boolean {
  const pathKey = info.project_path.trim()
    ? normalizeRepositoryPathKey(info.project_path)
    : "";
  if (!pathKey) {
    return false;
  }
  return isPathInWorkspaceScope(pathKey, scopePathKeys);
}
