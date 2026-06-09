import { startTransition } from "react";
import { WISE_WORKSPACE_TODOS_CHANGED } from "../constants/workspaceTodosEvents";
import {
  loadProjectWorkspaceTodos,
  loadRepositoryWorkspaceTodos,
} from "../services/workspaceTodosStore";
import type { ProjectItem, Repository } from "../types";

export interface WorkspaceTodoCountsSnapshot {
  byProjectId: Record<string, number>;
  byRepositoryId: Record<number, number>;
}

interface WorkspaceTodosChangedDetail {
  projectId?: string | null;
  repositoryId?: number | null;
  incompleteCount?: number;
}

let snapshot: WorkspaceTodoCountsSnapshot = { byProjectId: {}, byRepositoryId: {} };
const listeners = new Set<() => void>();

let loadGeneration = 0;
let hasLoaded = false;
let refreshDebounce: ReturnType<typeof setTimeout> | null = null;
let pendingScope: WorkspaceTodosChangedDetail | null = null;
let scopeProjects: ProjectItem[] = [];
let scopeFloatingRepositories: Repository[] = [];
let scopeEnabled = true;
let eventListenerAttached = false;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function emitInTransition(): void {
  startTransition(emit);
}

function countIncomplete(items: { completed: boolean }[]): number {
  let n = 0;
  for (const item of items) {
    if (!item.completed) n += 1;
  }
  return n;
}

function stringNumberRecordEqual(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function idNumberRecordEqual(
  left: Record<number, number>,
  right: Record<number, number>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (left[Number(key)] !== right[Number(key)]) return false;
  }
  return true;
}

function applyProjectCount(
  prev: Record<string, number>,
  projectId: string,
  count: number,
): Record<string, number> {
  if (count > 0) {
    if (prev[projectId] === count) return prev;
    return { ...prev, [projectId]: count };
  }
  if (!(projectId in prev)) return prev;
  const next = { ...prev };
  delete next[projectId];
  return next;
}

function applyRepositoryCount(
  prev: Record<number, number>,
  repositoryId: number,
  count: number,
): Record<number, number> {
  if (count > 0) {
    if (prev[repositoryId] === count) return prev;
    return { ...prev, [repositoryId]: count };
  }
  if (!(repositoryId in prev)) return prev;
  const next = { ...prev };
  delete next[repositoryId];
  return next;
}

function commitSnapshot(next: WorkspaceTodoCountsSnapshot): void {
  if (
    stringNumberRecordEqual(snapshot.byProjectId, next.byProjectId) &&
    idNumberRecordEqual(snapshot.byRepositoryId, next.byRepositoryId)
  ) {
    return;
  }
  snapshot = next;
  emitInTransition();
}

function applyChangedDetail(detail: WorkspaceTodosChangedDetail): void {
  const next: WorkspaceTodoCountsSnapshot = {
    byProjectId: { ...snapshot.byProjectId },
    byRepositoryId: { ...snapshot.byRepositoryId },
  };
  let changed = false;

  const projectId = detail.projectId?.trim();
  if (projectId && typeof detail.incompleteCount === "number") {
    const patched = applyProjectCount(next.byProjectId, projectId, detail.incompleteCount);
    if (patched !== next.byProjectId) {
      next.byProjectId = patched;
      changed = true;
    }
  }

  const repositoryId = detail.repositoryId;
  if (
    repositoryId != null &&
    Number.isFinite(repositoryId) &&
    typeof detail.incompleteCount === "number"
  ) {
    const patched = applyRepositoryCount(next.byRepositoryId, repositoryId, detail.incompleteCount);
    if (patched !== next.byRepositoryId) {
      next.byRepositoryId = patched;
      changed = true;
    }
  }

  if (changed) commitSnapshot(next);
}

function collectScopeIds(projects: ProjectItem[], floatingRepositories: Repository[]) {
  const projectIds = projects.map((p) => p.id).filter((id) => id.trim().length > 0);
  const repositoryIds = new Set<number>();
  for (const project of projects) {
    for (const repositoryId of project.repositoryIds) {
      if (Number.isFinite(repositoryId)) repositoryIds.add(repositoryId);
    }
  }
  for (const repo of floatingRepositories) {
    if (Number.isFinite(repo.id)) repositoryIds.add(repo.id);
  }
  return { projectIds, repositoryIds: [...repositoryIds] };
}

async function refreshAll(showLoading: boolean): Promise<void> {
  if (!scopeEnabled) {
    commitSnapshot({ byProjectId: {}, byRepositoryId: {} });
    hasLoaded = false;
    return;
  }

  const { projectIds, repositoryIds } = collectScopeIds(scopeProjects, scopeFloatingRepositories);
  if (projectIds.length === 0 && repositoryIds.length === 0) {
    commitSnapshot({ byProjectId: {}, byRepositoryId: {} });
    hasLoaded = true;
    return;
  }

  const generation = loadGeneration + 1;
  loadGeneration = generation;
  void showLoading;

  try {
    const [projectResults, repositoryResults] = await Promise.all([
      Promise.all(
        projectIds.map(async (projectId) => {
          const payload = await loadProjectWorkspaceTodos(projectId);
          return [projectId, countIncomplete(payload.items)] as const;
        }),
      ),
      Promise.all(
        repositoryIds.map(async (repositoryId) => {
          const payload = await loadRepositoryWorkspaceTodos(repositoryId);
          return [repositoryId, countIncomplete(payload.items)] as const;
        }),
      ),
    ]);
    if (generation !== loadGeneration) return;

    const nextProjects: Record<string, number> = {};
    for (const [projectId, count] of projectResults) {
      if (count > 0) nextProjects[projectId] = count;
    }
    const nextRepos: Record<number, number> = {};
    for (const [repositoryId, count] of repositoryResults) {
      if (count > 0) nextRepos[repositoryId] = count;
    }
    commitSnapshot({ byProjectId: nextProjects, byRepositoryId: nextRepos });
  } catch {
    /* 侧栏角标失败时静默 */
  } finally {
    if (generation === loadGeneration) hasLoaded = true;
  }
}

async function refreshScope(detail: WorkspaceTodosChangedDetail): Promise<void> {
  if (!scopeEnabled) return;

  if (typeof detail.incompleteCount === "number") {
    applyChangedDetail(detail);
    return;
  }

  const next: WorkspaceTodoCountsSnapshot = {
    byProjectId: { ...snapshot.byProjectId },
    byRepositoryId: { ...snapshot.byRepositoryId },
  };
  let changed = false;
  const tasks: Promise<void>[] = [];

  const projectId = detail.projectId?.trim();
  if (projectId) {
    tasks.push(
      loadProjectWorkspaceTodos(projectId).then((payload) => {
        const count = countIncomplete(payload.items);
        const patched = applyProjectCount(next.byProjectId, projectId, count);
        if (patched !== next.byProjectId) {
          next.byProjectId = patched;
          changed = true;
        }
      }),
    );
  }

  const repositoryId = detail.repositoryId;
  if (repositoryId != null && Number.isFinite(repositoryId)) {
    tasks.push(
      loadRepositoryWorkspaceTodos(repositoryId).then((payload) => {
        const count = countIncomplete(payload.items);
        const patched = applyRepositoryCount(next.byRepositoryId, repositoryId, count);
        if (patched !== next.byRepositoryId) {
          next.byRepositoryId = patched;
          changed = true;
        }
      }),
    );
  }

  if (tasks.length === 0) {
    await refreshAll(false);
    return;
  }

  try {
    await Promise.all(tasks);
    if (changed) commitSnapshot(next);
  } catch {
    /* 静默 */
  }
}

function scheduleScopeRefresh(detail: WorkspaceTodosChangedDetail): void {
  if (typeof detail.incompleteCount === "number") {
    applyChangedDetail(detail);
    return;
  }
  pendingScope = {
    projectId: detail.projectId ?? pendingScope?.projectId ?? null,
    repositoryId: detail.repositoryId ?? pendingScope?.repositoryId ?? null,
  };
  if (refreshDebounce) clearTimeout(refreshDebounce);
  refreshDebounce = setTimeout(() => {
    refreshDebounce = null;
    const pending = pendingScope;
    pendingScope = null;
    if (pending) void refreshScope(pending);
  }, 240);
}

function ensureEventListener(): void {
  if (eventListenerAttached || typeof window === "undefined") return;
  eventListenerAttached = true;
  window.addEventListener(WISE_WORKSPACE_TODOS_CHANGED, (event) => {
    const detail = (event as CustomEvent<WorkspaceTodosChangedDetail>).detail ?? {};
    scheduleScopeRefresh(detail);
  });
}

export function subscribeWorkspaceTodoCounts(listener: () => void): () => void {
  ensureEventListener();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWorkspaceTodoCountsSnapshot(): WorkspaceTodoCountsSnapshot {
  return snapshot;
}

export function getWorkspaceTodoIncompleteCount(
  scope: "project" | "repository",
  projectId: string | null,
  repositoryId: number | null,
): number {
  if (scope === "project") {
    const id = projectId?.trim();
    return id ? (snapshot.byProjectId[id] ?? 0) : 0;
  }
  if (repositoryId != null && Number.isFinite(repositoryId)) {
    return snapshot.byRepositoryId[repositoryId] ?? 0;
  }
  return 0;
}

export function buildWorkspaceTodoCountsScopeKey(
  projects: ProjectItem[],
  floatingRepositories: Repository[],
): string {
  const projectPart = projects
    .map((project) => `${project.id}:${project.repositoryIds.join(",")}`)
    .join("|");
  const floatingPart = floatingRepositories.map((repo) => String(repo.id)).join("|");
  return `${projectPart}::${floatingPart}`;
}

/** 侧栏挂载时同步工作区/仓库范围；状态落在外部 store，避免角标更新牵动整棵 LeftSidebar。 */
export function syncWorkspaceTodoCountsScope(
  projects: ProjectItem[],
  floatingRepositories: Repository[],
  enabled: boolean,
): () => void {
  ensureEventListener();
  scopeProjects = projects;
  scopeFloatingRepositories = floatingRepositories;
  scopeEnabled = enabled;

  if (!enabled) {
    loadGeneration += 1;
    commitSnapshot({ byProjectId: {}, byRepositoryId: {} });
    hasLoaded = false;
    return () => {
      loadGeneration += 1;
    };
  }

  const generation = loadGeneration;
  void refreshAll(!hasLoaded);
  return () => {
    if (generation === loadGeneration) loadGeneration += 1;
  };
}
