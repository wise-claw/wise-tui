import { message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT,
  mergeSessionQuickActionsLayout,
  type SessionQuickActionsLayoutV1,
} from "../constants/sessionQuickActionsLayout";
import { listAssistants } from "../services/assistants";
import {
  loadSessionQuickActionsLayout,
  saveSessionQuickActionsLayout,
} from "../services/sessionQuickActionsLayoutStore";
import type { AssistantEntry } from "../types/assistant";
import {
  buildSessionQuickActionCatalog,
  type SessionQuickActionCatalog,
} from "../utils/sessionQuickAssistantCatalog";

const PERSIST_DEBOUNCE_MS = 480;

function persistErrorText(error: unknown): string {
  return error instanceof Error ? error.message : "快捷操作布局保存失败";
}

export function useSessionQuickActionsLayout() {
  const [assistants, setAssistants] = useState<AssistantEntry[]>([]);
  const [layout, setLayoutState] = useState<SessionQuickActionsLayoutV1>(() =>
    mergeSessionQuickActionsLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT),
  );
  const [hydrated, setHydrated] = useState(false);
  const layoutRef = useRef(layout);
  const userEditedRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const catalog = useMemo(
    () => buildSessionQuickActionCatalog(assistants),
    [assistants],
  );

  layoutRef.current = layout;

  const mergeLayout = useCallback(
    (input: SessionQuickActionsLayoutV1 | null | undefined) =>
      mergeSessionQuickActionsLayout(input, catalog),
    [catalog],
  );

  useEffect(() => {
    let cancelled = false;
    void listAssistants()
      .then((rows) => {
        if (!cancelled) setAssistants(rows);
      })
      .catch(() => {
        if (!cancelled) setAssistants([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadSessionQuickActionsLayout()
      .then((loaded) => {
        if (cancelled || userEditedRef.current) return;
        setLayoutState(mergeSessionQuickActionsLayout(loaded));
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

  useEffect(() => {
    if (!hydrated) return;
    setLayoutState((prev) => mergeSessionQuickActionsLayout(prev, catalog));
  }, [catalog, hydrated]);

  const flushPersist = useCallback(
    async (target: SessionQuickActionsLayoutV1): Promise<boolean> => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      const normalized = mergeLayout(target);
      try {
        await saveSessionQuickActionsLayout(normalized);
        return true;
      } catch (error) {
        message.error(persistErrorText(error));
        return false;
      }
    },
    [mergeLayout],
  );

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
      const normalized = mergeLayout(next);
      setLayoutState(normalized);
      schedulePersist(normalized);
    },
    [mergeLayout, schedulePersist],
  );

  const persistLayout = useCallback(async (): Promise<boolean> => {
    userEditedRef.current = true;
    return flushPersist(layoutRef.current);
  }, [flushPersist]);

  const resetLayout = useCallback(() => {
    setLayout(mergeLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT));
  }, [mergeLayout, setLayout]);

  const assistantsById = useMemo(
    () => new Map(assistants.map((assistant) => [assistant.id, assistant])),
    [assistants],
  );

  return {
    layout,
    setLayout,
    resetLayout,
    persistLayout,
    hydrated,
    catalog,
    assistants,
    assistantsById,
  };
}

export type { SessionQuickActionCatalog };
