import { startTransition } from "react";
import { WISE_WORKSPACE_TODOS_CHANGED } from "../constants/workspaceTodosEvents";
import { loadGlobalWorkspaceTodos } from "../services/workspaceTodosStore";

interface WorkspaceTodosChangedDetail {
  incompleteCount?: number;
  reloadItems?: boolean;
}

let incompleteCount = 0;
const listeners = new Set<() => void>();

let loadGeneration = 0;
let hasLoaded = false;
let refreshDebounce: ReturnType<typeof setTimeout> | null = null;
let pendingReload = false;
let eventListenerAttached = false;

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function commitCount(next: number): void {
  if (next < 0) next = 0;
  if (next === incompleteCount) return;
  incompleteCount = next;
  startTransition(() => {
    notifyListeners();
  });
}

function countIncomplete(items: { completed: boolean }[]): number {
  let n = 0;
  for (const item of items) {
    if (!item.completed) n += 1;
  }
  return n;
}

async function refreshCount(): Promise<void> {
  const generation = loadGeneration + 1;
  loadGeneration = generation;
  try {
    const payload = await loadGlobalWorkspaceTodos();
    if (generation !== loadGeneration) return;
    commitCount(countIncomplete(payload.items));
  } catch {
    /* 侧栏角标失败时静默 */
  } finally {
    if (generation === loadGeneration) hasLoaded = true;
  }
}

function scheduleRefresh(detail: WorkspaceTodosChangedDetail): void {
  if (typeof detail.incompleteCount === "number") {
    commitCount(detail.incompleteCount);
    return;
  }
  pendingReload = true;
  if (refreshDebounce) clearTimeout(refreshDebounce);
  refreshDebounce = setTimeout(() => {
    refreshDebounce = null;
    if (pendingReload) {
      pendingReload = false;
      void refreshCount();
    }
  }, 240);
}

function ensureEventListener(): void {
  if (eventListenerAttached || typeof window === "undefined") return;
  eventListenerAttached = true;
  window.addEventListener(WISE_WORKSPACE_TODOS_CHANGED, (event) => {
    const detail = (event as CustomEvent<WorkspaceTodosChangedDetail>).detail ?? {};
    scheduleRefresh(detail);
  });
}

export function subscribeWorkspaceTodoCounts(listener: () => void): () => void {
  ensureEventListener();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWorkspaceTodoCountsSnapshot(): number {
  return incompleteCount;
}

/** @internal test helper */
export function commitWorkspaceTodoCountsSnapshotForTests(next: number): void {
  commitCount(next);
}

/** 侧栏挂载时加载全局待办未完成数；状态落在外部 store，避免角标更新牵动整棵 LeftSidebar。 */
export function syncWorkspaceTodoCountsScope(enabled: boolean): () => void {
  ensureEventListener();
  if (!enabled) {
    loadGeneration += 1;
    commitCount(0);
    hasLoaded = false;
    return () => {
      loadGeneration += 1;
    };
  }
  const generation = loadGeneration;
  if (!hasLoaded) void refreshCount();
  return () => {
    if (generation === loadGeneration) loadGeneration += 1;
  };
}
