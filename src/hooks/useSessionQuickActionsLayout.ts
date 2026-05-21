import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT,
  mergeSessionQuickActionsLayout,
  parseSessionQuickActionsLayout,
  readSessionQuickActionsLayoutFromLocalStorage,
  SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY,
  writeSessionQuickActionsLayoutToLocalStorage,
  type SessionQuickActionsLayoutV1,
} from "../constants/sessionQuickActionsLayout";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";

export function useSessionQuickActionsLayout() {
  const [layout, setLayoutState] = useState<SessionQuickActionsLayoutV1>(() =>
    readSessionQuickActionsLayoutFromLocalStorage(),
  );

  useEffect(() => {
    let cancelled = false;
    void getAppSetting(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY).then((raw) => {
      if (cancelled || !raw?.trim()) return;
      const merged = parseSessionQuickActionsLayout(raw);
      setLayoutState(merged);
      writeSessionQuickActionsLayoutToLocalStorage(merged);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLayout = useCallback((next: SessionQuickActionsLayoutV1) => {
    const normalized = mergeSessionQuickActionsLayout(next);
    setLayoutState(normalized);
    writeSessionQuickActionsLayoutToLocalStorage(normalized);
    void setAppSetting(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY, JSON.stringify(normalized)).catch(() => {
      /* localStorage already updated */
    });
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT);
  }, [setLayout]);

  return { layout, setLayout, resetLayout };
}
