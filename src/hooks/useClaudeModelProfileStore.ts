import { useCallback, useEffect, useRef, useState } from "react";
import {
  getClaudeModelProfileStore,
  getModelProfileEffectiveModels,
  WISE_CLAUDE_USER_SETTINGS_CHANGED,
  type ClaudeUserSettingsChangedDetail,
} from "../services/claudeModelProfiles";
import type {
  ClaudeModelProfileStoreView,
  ModelProfileEffectiveModels,
} from "../types/claudeModelProfile";
import { extractEffectiveModelsFromStore } from "../types/claudeModelProfile";
import { seedModelProfileStoreCache } from "../stores/modelProfileStoreCache";

const SETTINGS_REFRESH_DEBOUNCE_MS = 150;
const LOADING_INDICATOR_DELAY_MS = 200;

function useDebouncedSettingsRefresh(
  refresh: () => void,
  applyStoreSnapshot: (snapshot: ClaudeModelProfileStoreView) => void,
  enabled: boolean,
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const applySnapshotRef = useRef(applyStoreSnapshot);
  applySnapshotRef.current = applyStoreSnapshot;
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<ClaudeUserSettingsChangedDetail>).detail;
      if (detail?.storeSnapshot) {
        if (timerRef.current != null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        applySnapshotRef.current(detail.storeSnapshot);
        return;
      }
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        refreshRef.current();
      }, SETTINGS_REFRESH_DEBOUNCE_MS);
    };
    window.addEventListener(WISE_CLAUDE_USER_SETTINGS_CHANGED, onChanged);
    return () => {
      window.removeEventListener(WISE_CLAUDE_USER_SETTINGS_CHANGED, onChanged);
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled]);
}

/** 模型切换弹层：单监听、按开闭状态选择轻/完整 IPC，并同步角标生效模型。 */
export function useModelProfileSwitcher(popoverOpen: boolean) {
  const [effectiveModels, setEffectiveModels] = useState<ModelProfileEffectiveModels | null>(null);
  const [store, setStoreInternal] = useState<ClaudeModelProfileStoreView | null>(null);
  const [loading, setLoading] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const loadingDelayRef = useRef<number | null>(null);
  const requestSeqRef = useRef(0);
  const popoverOpenRef = useRef(popoverOpen);
  popoverOpenRef.current = popoverOpen;

  const applyStore = useCallback((next: ClaudeModelProfileStoreView) => {
    seedModelProfileStoreCache(next);
    if (popoverOpenRef.current) {
      setStoreInternal(next);
    }
    setEffectiveModels(extractEffectiveModelsFromStore(next));
  }, []);

  const setStore = useCallback(
    (value: React.SetStateAction<ClaudeModelProfileStoreView | null>) => {
      let resolvedNext: ClaudeModelProfileStoreView | null = null;
      setStoreInternal((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        resolvedNext = next;
        if (next) {
          seedModelProfileStoreCache(next);
        }
        return next;
      });
      if (resolvedNext) {
        setEffectiveModels(extractEffectiveModelsFromStore(resolvedNext));
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    const requestId = ++requestSeqRef.current;
    const clearLoadingDelay = () => {
      if (loadingDelayRef.current != null) {
        window.clearTimeout(loadingDelayRef.current);
        loadingDelayRef.current = null;
      }
    };

    if (!popoverOpen) {
      clearLoadingDelay();
      setLoading(false);
      setShowLoading(false);
      try {
        const next = await getModelProfileEffectiveModels();
        if (requestId !== requestSeqRef.current) return;
        setEffectiveModels(next);
      } catch {
        if (requestId !== requestSeqRef.current) return;
        setEffectiveModels(null);
      }
      return;
    }

    setLoading(true);
    setShowLoading(false);
    clearLoadingDelay();
    loadingDelayRef.current = window.setTimeout(() => {
      loadingDelayRef.current = null;
      if (requestId === requestSeqRef.current) {
        setShowLoading(true);
      }
    }, LOADING_INDICATOR_DELAY_MS);

    try {
      const next = await getClaudeModelProfileStore();
      if (requestId !== requestSeqRef.current) return;
      applyStore(next);
    } catch {
      if (requestId !== requestSeqRef.current) return;
      setStoreInternal(null);
    } finally {
      if (requestId !== requestSeqRef.current) return;
      clearLoadingDelay();
      setLoading(false);
      setShowLoading(false);
    }
  }, [applyStore, popoverOpen]);

  useEffect(() => {
    void getClaudeModelProfileStore().catch(() => undefined);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useDebouncedSettingsRefresh(
    () => {
      void refresh();
    },
    applyStore,
    true,
  );

  useEffect(
    () => () => {
      if (loadingDelayRef.current != null) {
        window.clearTimeout(loadingDelayRef.current);
      }
    },
    [],
  );

  return { effectiveModels, store, setStore, loading: showLoading && loading, refresh };
}
