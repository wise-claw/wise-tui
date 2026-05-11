import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from "react";
import type { Prompt, ContextItem } from "../../types";
import { DEFAULT_PROMPT, isPromptEqual, promptLength } from "./prompt-history";
import { deleteAppSetting, getAppSetting, setAppSetting } from "../../services/appSettingsStore";

// ── Store ──

interface PromptStore {
  prompt: Prompt;
  cursor: number;
  contextItems: ContextItem[];
}

interface PromptActions {
  set: (prompt: Prompt, cursorPos?: number) => void;
  reset: () => void;
  setCursor: (pos: number) => void;
  contextAdd: (item: ContextItem) => void;
  contextRemove: (key: string) => void;
  contextReplaceComments: (items: ContextItem[]) => void;
}

// ── App settings persistence ──

const STORAGE_PREFIX = "wise.prompt.context.v1:";
const LEGACY_APP_SETTING_PREFIX_PROMPT_CONTEXT = "claude-prompt-";

function emptyStore(): PromptStore {
  return { prompt: [...DEFAULT_PROMPT], cursor: 0, contextItems: [] };
}

function normalizeStore(store: PromptStore): PromptStore {
  const maxCursor = promptLength(store.prompt);
  return {
    ...store,
    cursor: Math.max(0, Math.min(store.cursor ?? maxCursor, maxCursor)),
  };
}

function saveStore(sessionId: string, store: PromptStore) {
  void setAppSetting(STORAGE_PREFIX + sessionId, JSON.stringify(normalizeStore(store)));
}

export async function clearPromptContextSessionKey(sessionId: string): Promise<void> {
  const sid = sessionId.trim();
  if (!sid) {
    return;
  }
  await deleteAppSetting(STORAGE_PREFIX + sid);
}

/** 会话临时 id 合并为真实 Claude session_id 时迁移草稿，避免误读历史草稿导致发送后回填。 */
export async function migratePromptContextSessionKey(fromSessionId: string, toSessionId: string): Promise<void> {
  const fromId = fromSessionId.trim();
  const toId = toSessionId.trim();
  if (!fromId || !toId || fromId === toId) {
    return;
  }
  const fromKey = STORAGE_PREFIX + fromId;
  const toKey = STORAGE_PREFIX + toId;
  const raw = await getAppSetting(fromKey);
  if (raw) {
    await setAppSetting(toKey, raw);
    await deleteAppSetting(fromKey);
  }
}

// ── Context ──

interface PromptContextValue extends PromptStore, PromptActions {
  sessionId: string;
  /** 与 `sessionId` 可能不同：用于独立草稿桶（如 sticky 内嵌输入） */
  draftBucketKey: string;
  dirty: boolean;
}

const PromptContext = createContext<PromptContextValue | null>(null);

export function usePrompt(): PromptContextValue {
  const ctx = useContext(PromptContext);
  if (!ctx) throw new Error("usePrompt must be used within PromptProvider");
  return ctx;
}

interface PromptProviderProps {
  children: ReactNode;
  sessionId: string;
  /**
   * 草稿持久化键（`STORAGE_PREFIX` 后缀）。省略时与 `sessionId` 相同。
   * 用于同一会话下第二套输入（如 sticky 内嵌）避免与主 Composer 争草稿。
   */
  draftBucketKey?: string;
}

export function PromptProvider({ children, sessionId, draftBucketKey: draftBucketKeyProp }: PromptProviderProps) {
  const bucketKey = (draftBucketKeyProp?.trim() || sessionId).trim();
  const [store, setStoreRaw] = useState<PromptStore>(() => emptyStore());
  /** 发送 reset 等本地变更后递增，避免异步 hydration 读盘较慢时在 reset 之后仍用旧草稿覆盖 store。 */
  const mutationEpochRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const epochAtHydrationStart = mutationEpochRef.current;
    void (async () => {
      const currentKey = STORAGE_PREFIX + bucketKey;
      let raw = await getAppSetting(currentKey);
      if (!raw && bucketKey === sessionId) {
        const legacyKey = LEGACY_APP_SETTING_PREFIX_PROMPT_CONTEXT + sessionId;
        raw = await getAppSetting(legacyKey);
        if (raw) {
          await setAppSetting(currentKey, raw);
          await deleteAppSetting(legacyKey);
        }
      }
      if (cancelled || !raw) return;
      if (mutationEpochRef.current !== epochAtHydrationStart) {
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        setStoreRaw((current) => {
          if (mutationEpochRef.current !== epochAtHydrationStart) {
            return current;
          }
          if (!isPromptEqual(current.prompt, DEFAULT_PROMPT) || (current.contextItems?.length ?? 0) > 0) {
            return current;
          }
          return normalizeStore({
            prompt: parsed.prompt ?? DEFAULT_PROMPT,
            cursor: parsed.cursor ?? 0,
            contextItems: parsed.contextItems ?? [],
          });
        });
      } catch {
        // ignore parse failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bucketKey, sessionId]);

  const setStore = useCallback((updater: (prev: PromptStore) => PromptStore) => {
    setStoreRaw((prev) => {
      const next = updater(prev);
      saveStore(bucketKey, next);
      return next;
    });
  }, [bucketKey]);

  const set = useCallback((prompt: Prompt, cursorPos?: number) => {
    setStore((prev) => ({
      ...prev,
      prompt,
      cursor: cursorPos !== undefined ? cursorPos : promptLength(prompt),
    }));
  }, [setStore]);

  const reset = useCallback(() => {
    mutationEpochRef.current += 1;
    setStore((prev) => ({
      ...prev,
      prompt: [...DEFAULT_PROMPT],
      cursor: 0,
      contextItems: [],
    }));
  }, [setStore]);

  const setCursor = useCallback((pos: number) => {
    setStore((prev) => ({ ...prev, cursor: pos }));
  }, [setStore]);

  const contextAdd = useCallback((item: ContextItem) => {
    setStore((prev) => {
      if (prev.contextItems.some((x) => x.key === item.key)) return prev;
      return { ...prev, contextItems: [...prev.contextItems, item] };
    });
  }, [setStore]);

  const contextRemove = useCallback((key: string) => {
    setStore((prev) => ({
      ...prev,
      contextItems: prev.contextItems.filter((x) => x.key !== key),
    }));
  }, [setStore]);

  const contextReplaceComments = useCallback((items: ContextItem[]) => {
    setStore((prev) => {
      const nonComments = prev.contextItems.filter(
        (item) => !(item.type === "file" && item.comment?.trim()),
      );
      return { ...prev, contextItems: [...nonComments, ...items] };
    });
  }, [setStore]);

  const dirty = useMemo(
    () => !isPromptEqual(store.prompt, DEFAULT_PROMPT),
    [store.prompt],
  );

  const value = useMemo<PromptContextValue>(
    () => ({
      sessionId,
      draftBucketKey: bucketKey,
      prompt: store.prompt,
      cursor: store.cursor,
      contextItems: store.contextItems,
      dirty,
      set,
      reset,
      setCursor,
      contextAdd,
      contextRemove,
      contextReplaceComments,
    }),
    [
      sessionId,
      bucketKey,
      store,
      dirty,
      set,
      reset,
      setCursor,
      contextAdd,
      contextRemove,
      contextReplaceComments,
    ],
  );

  return <PromptContext.Provider value={value}>{children}</PromptContext.Provider>;
}
