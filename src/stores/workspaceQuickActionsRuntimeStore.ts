import { message } from "antd";
import type {
  WorkspaceQuickActionItem,
  WorkspaceQuickActionScope,
} from "../types/workspaceQuickActions";
import {
  loadProjectWorkspaceQuickActions,
  loadRepositoryWorkspaceQuickActions,
  saveProjectWorkspaceQuickActions,
  saveRepositoryWorkspaceQuickActions,
} from "../services/workspaceQuickActionsStore";

type Listener = () => void;
type ScopeKey = string;

interface ScopeEntry {
  items: WorkspaceQuickActionItem[];
  loaded: boolean;
  loading: boolean;
  consumers: number;
}

const entries = new Map<ScopeKey, ScopeEntry>();
const loadPromises = new Map<ScopeKey, Promise<WorkspaceQuickActionItem[]>>();
const loadGenerations = new Map<ScopeKey, number>();
const persistGenerations = new Map<ScopeKey, number>();
const persistTimers = new Map<ScopeKey, ReturnType<typeof setTimeout>>();
const pendingPersist = new Map<
  ScopeKey,
  { scope: WorkspaceQuickActionScope; scopeId: string; items: WorkspaceQuickActionItem[] }
>();
const listeners = new Set<Listener>();
let generation = 0;

const PERSIST_DEBOUNCE_MS = 400;

function persistErrorText(error: unknown): string {
  return error instanceof Error ? error.message : "快捷操作保存失败";
}

function scopeKey(scope: WorkspaceQuickActionScope, scopeId: string): ScopeKey {
  return `${scope}:${scopeId}`;
}

function normalizeScopeId(scope: WorkspaceQuickActionScope, rawId: string | number | null | undefined): string | null {
  if (scope === "project") {
    const id = typeof rawId === "string" ? rawId.trim() : "";
    return id || null;
  }
  if (typeof rawId !== "number" || !Number.isFinite(rawId)) return null;
  return String(rawId);
}

function bump(): void {
  generation += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function getOrCreateEntry(key: ScopeKey): ScopeEntry {
  const existing = entries.get(key);
  if (existing) return existing;
  const created: ScopeEntry = {
    items: [],
    loaded: false,
    loading: false,
    consumers: 0,
  };
  entries.set(key, created);
  return created;
}

async function loadScopeItems(scope: WorkspaceQuickActionScope, scopeId: string): Promise<WorkspaceQuickActionItem[]> {
  const key = scopeKey(scope, scopeId);
  const entry = getOrCreateEntry(key);
  if (entry.loaded) return entry.items;

  const inFlight = loadPromises.get(key);
  if (inFlight) return inFlight;

  const loadGeneration = (loadGenerations.get(key) ?? 0) + 1;
  loadGenerations.set(key, loadGeneration);

  entry.loading = true;
  bump();

  const promise = (async () => {
    try {
      const payload =
        scope === "project"
          ? await loadProjectWorkspaceQuickActions(scopeId)
          : await loadRepositoryWorkspaceQuickActions(Number(scopeId));
      if (loadGenerations.get(key) !== loadGeneration) {
        return entry.items;
      }
      if (entries.get(key) !== entry) {
        return entry.items;
      }
      entry.items = payload.items;
      entry.loaded = true;
      return entry.items;
    } catch (error) {
      if (loadGenerations.get(key) === loadGeneration && entries.get(key) === entry) {
        message.error(persistErrorText(error));
        entry.items = [];
        entry.loaded = true;
      }
      return entry.items;
    } finally {
      if (loadGenerations.get(key) === loadGeneration && entries.get(key) === entry) {
        entry.loading = false;
      }
      loadPromises.delete(key);
      bump();
    }
  })();

  loadPromises.set(key, promise);
  return promise;
}

export function subscribeWorkspaceQuickActionsRuntime(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getWorkspaceQuickActionsRuntimeSnapshot(): number {
  return generation;
}

export function retainWorkspaceQuickActionsScope(
  scope: WorkspaceQuickActionScope,
  rawScopeId: string | number | null | undefined,
): void {
  const scopeId = normalizeScopeId(scope, rawScopeId);
  if (!scopeId) return;
  const key = scopeKey(scope, scopeId);
  const entry = getOrCreateEntry(key);
  entry.consumers += 1;
  if (!entry.loaded && !entry.loading) {
    void loadScopeItems(scope, scopeId);
  }
}

export function releaseWorkspaceQuickActionsScope(
  scope: WorkspaceQuickActionScope,
  rawScopeId: string | number | null | undefined,
): void {
  const scopeId = normalizeScopeId(scope, rawScopeId);
  if (!scopeId) return;
  const key = scopeKey(scope, scopeId);
  const entry = entries.get(key);
  if (!entry) return;
  entry.consumers = Math.max(0, entry.consumers - 1);
  if (entry.consumers > 0) return;
  void flushWorkspaceQuickActionsPersist(scope, scopeId);
  loadGenerations.set(key, (loadGenerations.get(key) ?? 0) + 1);
  entries.delete(key);
  loadPromises.delete(key);
}

export function getWorkspaceQuickActionsScopeItems(
  scope: WorkspaceQuickActionScope,
  rawScopeId: string | number | null | undefined,
): WorkspaceQuickActionItem[] {
  const scopeId = normalizeScopeId(scope, rawScopeId);
  if (!scopeId) return [];
  return entries.get(scopeKey(scope, scopeId))?.items ?? [];
}

export function isWorkspaceQuickActionsScopeLoading(
  scope: WorkspaceQuickActionScope,
  rawScopeId: string | number | null | undefined,
): boolean {
  const scopeId = normalizeScopeId(scope, rawScopeId);
  if (!scopeId) return false;
  const entry = entries.get(scopeKey(scope, scopeId));
  return Boolean(entry?.loading && !entry.loaded);
}

export function setWorkspaceQuickActionsScopeItems(
  scope: WorkspaceQuickActionScope,
  rawScopeId: string | number | null | undefined,
  items: WorkspaceQuickActionItem[],
): void {
  const scopeId = normalizeScopeId(scope, rawScopeId);
  if (!scopeId) return;
  const key = scopeKey(scope, scopeId);
  const entry = getOrCreateEntry(key);
  loadGenerations.set(key, (loadGenerations.get(key) ?? 0) + 1);
  entry.items = items;
  entry.loaded = true;
  entry.loading = false;
  bump();
}

export async function persistWorkspaceQuickActionsScopeItems(
  scope: WorkspaceQuickActionScope,
  rawScopeId: string | number | null | undefined,
  items: WorkspaceQuickActionItem[],
): Promise<boolean> {
  const scopeId = normalizeScopeId(scope, rawScopeId);
  if (!scopeId) return false;
  const key = scopeKey(scope, scopeId);
  const persistGeneration = (persistGenerations.get(key) ?? 0) + 1;
  persistGenerations.set(key, persistGeneration);
  setWorkspaceQuickActionsScopeItems(scope, scopeId, items);
  try {
    if (scope === "project") {
      await saveProjectWorkspaceQuickActions(scopeId, items);
    } else {
      await saveRepositoryWorkspaceQuickActions(Number(scopeId), items);
    }
    if (persistGenerations.get(key) !== persistGeneration) {
      return false;
    }
    return true;
  } catch (error) {
    if (persistGenerations.get(key) === persistGeneration) {
      message.error(persistErrorText(error));
    }
    return false;
  }
}

export function scheduleWorkspaceQuickActionsPersist(
  scope: WorkspaceQuickActionScope,
  scopeId: string,
  items: WorkspaceQuickActionItem[],
): void {
  const key = scopeKey(scope, scopeId);
  setWorkspaceQuickActionsScopeItems(scope, scopeId, items);
  pendingPersist.set(key, { scope, scopeId, items });

  const existingTimer = persistTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);

  persistTimers.set(
    key,
    setTimeout(() => {
      persistTimers.delete(key);
      const pending = pendingPersist.get(key);
      if (!pending) return;
      pendingPersist.delete(key);
      void persistWorkspaceQuickActionsScopeItems(pending.scope, pending.scopeId, pending.items);
    }, PERSIST_DEBOUNCE_MS),
  );
}

export function flushWorkspaceQuickActionsPersist(
  scope: WorkspaceQuickActionScope,
  scopeId: string,
  items?: WorkspaceQuickActionItem[],
): Promise<boolean> {
  const key = scopeKey(scope, scopeId);
  const existingTimer = persistTimers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
    persistTimers.delete(key);
  }
  const pending = pendingPersist.get(key);
  pendingPersist.delete(key);
  const payload = items ?? pending?.items;
  if (!payload) return Promise.resolve(true);
  if (items) {
    setWorkspaceQuickActionsScopeItems(scope, scopeId, items);
  }
  return persistWorkspaceQuickActionsScopeItems(scope, scopeId, payload);
}
