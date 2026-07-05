import { message } from "antd";
import type { ComposerCommonPhrase } from "../constants/composerCommonPhrase";
import {
  loadComposerCommonPhrasesFromStore,
  saveComposerCommonPhrasesToStore,
  WISE_COMPOSER_COMMON_PHRASES_CHANGED,
} from "../services/wiseDefaultConfigStore";
import {
  loadComposerCommonPhrasesForRepo,
  saveComposerCommonPhrasesForRepo,
  WISE_COMPOSER_COMMON_PHRASES_BY_REPO_CHANGED,
} from "../services/composerCommonPhrasesByRepo";
import {
  isReservedComposerChord,
  normalizeChord,
} from "../utils/atMentionShortcutChord";

type Listener = () => void;

/**
 * 常用语外部 store，按 scope 分桶：
 * - `global`：全局兜底常用语（`wise.defaultConfig.v1.composerCommonPhrases`）。
 * - `repo:<id>`：仓库级覆盖（`wise.composer.commonPhrasesByRepo.v1`）。
 *
 * 作用域语义由 `useComposerCommonPhrases` 编排（仓库优先 + 全局兜底）；本 store 只负责
 * 单个 scope 的加载/持久化/订阅。同 scopeKey 返回同一 API 引用（缓存），保证
 * `useSyncExternalStore` 的 subscribe/getSnapshot 引用稳定。
 */
interface ScopeState {
  phrases: ComposerCommonPhrase[];
  loading: boolean;
  saving: boolean;
  loaded: boolean;
  generation: number;
  loadPromise: Promise<void> | null;
  listeners: Set<Listener>;
}

function createScopeState(): ScopeState {
  return {
    phrases: [],
    loading: false,
    saving: false,
    loaded: false,
    generation: 0,
    loadPromise: null,
    listeners: new Set(),
  };
}

const scopes = new Map<string, ScopeState>();
const apiCache = new Map<string, ComposerCommonPhrasesStoreApi>();

function getScopeState(scopeKey: string): ScopeState {
  let state = scopes.get(scopeKey);
  if (!state) {
    state = createScopeState();
    scopes.set(scopeKey, state);
  }
  return state;
}

function bump(state: ScopeState): void {
  state.generation += 1;
  for (const listener of state.listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function setPhrases(state: ScopeState, next: ComposerCommonPhrase[]): void {
  state.phrases = next;
  state.loaded = true;
  bump(state);
}

async function loadScope(state: ScopeState, scope: ComposerCommonPhrasesScope): Promise<void> {
  if (state.loaded) return;
  if (state.loadPromise) {
    await state.loadPromise;
    return;
  }
  state.loading = true;
  bump(state);
  state.loadPromise = (async () => {
    try {
      const phrases = scope.repositoryId
        ? await loadComposerCommonPhrasesForRepo(scope.repositoryId)
        : await loadComposerCommonPhrasesFromStore();
      state.phrases = phrases;
      state.loaded = true;
    } finally {
      state.loading = false;
      state.loadPromise = null;
      bump(state);
    }
  })();
  await state.loadPromise;
}

export type ComposerCommonPhrasesScope = { repositoryId?: number | null };

function scopeKeyOf(scope: ComposerCommonPhrasesScope): string {
  const id = scope.repositoryId;
  return typeof id === "number" && id > 0 ? `repo:${id}` : "global";
}

export interface ComposerCommonPhrasesStoreApi {
  scopeKey: string;
  repositoryId: number | null;
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => number;
  getPhrases: () => readonly ComposerCommonPhrase[];
  getLoading: () => boolean;
  getSaving: () => boolean;
  ensureLoaded: () => Promise<void>;
  persist: (next: ComposerCommonPhrase[]) => Promise<ComposerCommonPhrase[]>;
}

export function getComposerCommonPhrasesStore(
  scope: ComposerCommonPhrasesScope,
): ComposerCommonPhrasesStoreApi {
  const scopeKey = scopeKeyOf(scope);
  const cached = apiCache.get(scopeKey);
  if (cached) return cached;

  const repositoryId = typeof scope.repositoryId === "number" && scope.repositoryId > 0
    ? scope.repositoryId
    : null;
  const state = getScopeState(scopeKey);

  const subscribe = (listener: Listener): (() => void) => {
    state.listeners.add(listener);
    void loadScope(state, { repositoryId });
    return () => {
      state.listeners.delete(listener);
    };
  };
  const getSnapshot = (): number => state.generation;
  const getPhrases = (): readonly ComposerCommonPhrase[] => state.phrases;
  const getLoading = (): boolean => state.loading;
  const getSaving = (): boolean => state.saving;
  const ensureLoaded = async (): Promise<void> => {
    await loadScope(state, { repositoryId });
  };
  const persist = async (next: ComposerCommonPhrase[]): Promise<ComposerCommonPhrase[]> => {
    for (const phrase of next) {
      const chord = phrase.chord ? normalizeChord(phrase.chord) : "";
      if (chord && isReservedComposerChord(chord)) {
        message.warning(`「${phrase.title}」快捷键与附加文件（⌘I）冲突，请修改`);
        throw new Error("reserved-chord");
      }
    }
    state.saving = true;
    bump(state);
    try {
      const saved = repositoryId
        ? await saveComposerCommonPhrasesForRepo(repositoryId, next)
        : await saveComposerCommonPhrasesToStore(next);
      setPhrases(state, saved);
      return saved;
    } catch (err) {
      if (err instanceof Error && err.message === "reserved-chord") {
        throw err;
      }
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      state.saving = false;
      bump(state);
    }
  };

  const api: ComposerCommonPhrasesStoreApi = {
    scopeKey,
    repositoryId,
    subscribe,
    getSnapshot,
    getPhrases,
    getLoading,
    getSaving,
    ensureLoaded,
    persist,
  };
  apiCache.set(scopeKey, api);
  return api;
}

export async function persistComposerCommonPhrasesStore(
  next: ComposerCommonPhrase[],
): Promise<ComposerCommonPhrase[]> {
  return getComposerCommonPhrasesStore({}).persist(next);
}

/** 全局 scope store（向后兼容既有 `useComposerCommonPhrases()` 无参调用与外部引用）。 */
export const composerCommonPhrasesStore: ComposerCommonPhrasesStoreApi = getComposerCommonPhrasesStore(
  {},
);

/** @internal 测试辅助：清空所有 scope 缓存。 */
export function resetComposerCommonPhrasesStoreForTests(): void {
  scopes.clear();
  apiCache.clear();
}

// 跨标签页/窗口同步：全局变更刷新 global scope；per-仓库变更刷新对应 repo scope。
if (typeof window !== "undefined") {
  window.addEventListener(WISE_COMPOSER_COMMON_PHRASES_CHANGED, (event) => {
    const detail = (event as CustomEvent<{ composerCommonPhrases?: ComposerCommonPhrase[] }>)
      .detail;
    if (!detail?.composerCommonPhrases) return;
    setPhrases(getScopeState("global"), detail.composerCommonPhrases);
  });
  window.addEventListener(WISE_COMPOSER_COMMON_PHRASES_BY_REPO_CHANGED, (event) => {
    const detail = (event as CustomEvent<{ map?: Record<number, ComposerCommonPhrase[]> }>)
      .detail;
    if (!detail?.map) return;
    for (const [repoId, phrases] of Object.entries(detail.map)) {
      const id = Number(repoId);
      if (!Number.isFinite(id) || id <= 0) continue;
      setPhrases(getScopeState(`repo:${id}`), phrases);
    }
  });
}
