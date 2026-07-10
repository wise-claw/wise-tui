import { useMemo, useSyncExternalStore } from "react";
import type { SearchHistoryEntry, SearchHistoryMode } from "../services/searchHistoryByRepo";
import {
  addSearchHistoryForRepo,
  clearSearchHistoryForRepo,
  loadSearchHistoryForRepo,
  removeSearchHistoryForRepo,
  WISE_SEARCH_HISTORY_BY_REPO_CHANGED,
} from "../services/searchHistoryByRepo";

type Listener = () => void;

/**
 * 搜索历史外部 store，按仓库分桶：`repo:<id>` 缓存该仓库的 filename/content 两栏历史。
 * 同 scopeKey 返回同一 API 引用（`apiCache`），保证 `useSyncExternalStore` 的
 * subscribe/getSnapshot 引用稳定。跨窗口变更经 `WISE_SEARCH_HISTORY_BY_REPO_CHANGED`
 * 事件刷新已加载的 scope。
 */
interface RepoScopeState {
  filename: SearchHistoryEntry[];
  content: SearchHistoryEntry[];
  loading: boolean;
  loaded: boolean;
  generation: number;
  loadPromise: Promise<void> | null;
  listeners: Set<Listener>;
}

function createScopeState(): RepoScopeState {
  return {
    filename: [],
    content: [],
    loading: false,
    loaded: false,
    generation: 0,
    loadPromise: null,
    listeners: new Set(),
  };
}

const scopes = new Map<string, RepoScopeState>();
const apiCache = new Map<string, SearchHistoryStoreApi>();

function scopeKeyOf(repositoryId: number | null): string {
  return typeof repositoryId === "number" && repositoryId > 0 ? `repo:${repositoryId}` : "none";
}

function getScopeState(repositoryId: number | null): RepoScopeState {
  const key = scopeKeyOf(repositoryId);
  let state = scopes.get(key);
  if (!state) {
    state = createScopeState();
    scopes.set(key, state);
  }
  return state;
}

function bump(state: RepoScopeState): void {
  state.generation += 1;
  for (const listener of state.listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function setEntries(
  state: RepoScopeState,
  mode: SearchHistoryMode,
  next: SearchHistoryEntry[],
): void {
  state[mode] = next;
  state.loaded = true;
  bump(state);
}

async function loadScope(state: RepoScopeState, repositoryId: number): Promise<void> {
  if (state.loaded) return;
  if (state.loadPromise) {
    await state.loadPromise;
    return;
  }
  state.loading = true;
  bump(state);
  state.loadPromise = (async () => {
    try {
      const [filename, content] = await Promise.all([
        loadSearchHistoryForRepo(repositoryId, "filename"),
        loadSearchHistoryForRepo(repositoryId, "content"),
      ]);
      state.filename = filename;
      state.content = content;
      state.loaded = true;
    } finally {
      state.loading = false;
      state.loadPromise = null;
      bump(state);
    }
  })();
  await state.loadPromise;
}

export interface SearchHistoryStoreApi {
  repositoryId: number | null;
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => number;
  getEntries: (mode: SearchHistoryMode) => readonly SearchHistoryEntry[];
  getLoading: () => boolean;
  ensureLoaded: () => Promise<void>;
  add: (mode: SearchHistoryMode, path: string, line?: number | null) => Promise<void>;
  remove: (mode: SearchHistoryMode, path: string) => Promise<void>;
  clear: (mode: SearchHistoryMode) => Promise<void>;
}

export function getSearchHistoryStore(repositoryId: number | null): SearchHistoryStoreApi {
  const id = typeof repositoryId === "number" && repositoryId > 0 ? repositoryId : null;
  const scopeKey = scopeKeyOf(id);
  const cached = apiCache.get(scopeKey);
  if (cached) return cached;

  const state = getScopeState(id);

  const subscribe = (listener: Listener): (() => void) => {
    state.listeners.add(listener);
    if (id) void loadScope(state, id);
    return () => {
      state.listeners.delete(listener);
    };
  };
  const getSnapshot = (): number => state.generation;
  const getEntries = (mode: SearchHistoryMode): readonly SearchHistoryEntry[] => state[mode];
  const getLoading = (): boolean => state.loading;
  const ensureLoaded = async (): Promise<void> => {
    if (id) await loadScope(state, id);
  };
  const add = async (
    mode: SearchHistoryMode,
    path: string,
    line?: number | null,
  ): Promise<void> => {
    if (!id) return;
    const next = await addSearchHistoryForRepo(id, mode, path, line);
    setEntries(state, mode, next);
  };
  const remove = async (mode: SearchHistoryMode, path: string): Promise<void> => {
    if (!id) return;
    const next = await removeSearchHistoryForRepo(id, mode, path);
    setEntries(state, mode, next);
  };
  const clear = async (mode: SearchHistoryMode): Promise<void> => {
    if (!id) return;
    await clearSearchHistoryForRepo(id, mode);
    setEntries(state, mode, []);
  };

  const api: SearchHistoryStoreApi = {
    repositoryId: id,
    subscribe,
    getSnapshot,
    getEntries,
    getLoading,
    ensureLoaded,
    add,
    remove,
    clear,
  };
  apiCache.set(scopeKey, api);
  return api;
}

/**
 * 订阅某仓库某 mode 的搜索历史。mode 切换（文件名↔内容）时复用同一 store，
 * 返回值随之切换；store 订阅仍按 generation 触发重渲染。
 */
export function useSearchHistory(
  repositoryId: number | null,
  mode: SearchHistoryMode,
): readonly SearchHistoryEntry[] {
  const store = useMemo(() => getSearchHistoryStore(repositoryId), [repositoryId]);
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return store.getEntries(mode);
}

/** @internal 测试辅助：清空所有 scope 缓存与 API 缓存。 */
export function resetSearchHistoryStoreForTests(): void {
  scopes.clear();
  apiCache.clear();
}

// 跨标签页/窗口同步：per-仓库变更刷新对应 repo scope（仅刷新已加载的，避免无谓 hydrate）。
if (typeof window !== "undefined") {
  window.addEventListener(WISE_SEARCH_HISTORY_BY_REPO_CHANGED, (event) => {
    const detail = (event as CustomEvent<{
      map?: Record<number, { filename: SearchHistoryEntry[]; content: SearchHistoryEntry[] }>;
    }>).detail;
    if (!detail?.map) return;
    for (const [repoId, repoHistory] of Object.entries(detail.map)) {
      const id = Number(repoId);
      if (!Number.isFinite(id) || id <= 0) continue;
      const state = getScopeState(id);
      if (!state.loaded) continue;
      state.filename = repoHistory.filename ?? [];
      state.content = repoHistory.content ?? [];
      bump(state);
    }
  });
}
