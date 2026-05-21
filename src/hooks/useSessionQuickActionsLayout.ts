import { message } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT,
  mergeSessionQuickActionsLayout,
  type SessionQuickActionsLayoutV1,
} from "../constants/sessionQuickActionsLayout";
import {
  loadSessionQuickActionsLayout,
  saveSessionQuickActionsLayout,
} from "../services/sessionQuickActionsLayoutStore";

const PERSIST_DEBOUNCE_MS = 480;

function persistErrorText(error: unknown): string {
  return error instanceof Error ? error.message : "快捷操作布局保存失败";
}

export function useSessionQuickActionsLayout() {
  const [layout, setLayoutState] = useState<SessionQuickActionsLayoutV1>(() =>
    mergeSessionQuickActionsLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT),
  );
  const [hydrated, setHydrated] = useState(false);
  const layoutRef = useRef(layout);
  const userEditedRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  layoutRef.current = layout;

  useEffect(() => {
    let cancelled = false;
    void loadSessionQuickActionsLayout()
      .then((loaded) => {
        if (cancelled || userEditedRef.current) return;
        setLayoutState(loaded);
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, []);

  const flushPersist = useCallback(async (target: SessionQuickActionsLayoutV1): Promise<boolean> => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const normalized = mergeSessionQuickActionsLayout(target);
    try {
      await saveSessionQuickActionsLayout(normalized);
      return true;
    } catch (error) {
      message.error(persistErrorText(error));
      return false;
    }
  }, []);

  const schedulePersist = useCallback(
    (target: SessionQuickActionsLayoutV1) => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        void flushPersist(target);
      }, PERSIST_DEBOUNCE_MS);
    },
    [flushPersist],
  );

  const setLayout = useCallback(
    (next: SessionQuickActionsLayoutV1) => {
      userEditedRef.current = true;
      const normalized = mergeSessionQuickActionsLayout(next);
      setLayoutState(normalized);
      schedulePersist(normalized);
    },
    [schedulePersist],
  );

  const persistLayout = useCallback(async (): Promise<boolean> => {
    userEditedRef.current = true;
    return flushPersist(layoutRef.current);
  }, [flushPersist]);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT);
  }, [setLayout]);

  return { layout, setLayout, resetLayout, persistLayout, hydrated };
};
