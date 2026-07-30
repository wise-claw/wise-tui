import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { TerminalThemeMode } from "../../constants/terminalThemeMode";
import {
  loadTerminalThemeModeFromStore,
  saveTerminalThemeModeToStore,
} from "../../services/wiseDefaultConfigStore";
import { applyTerminalThemeMode } from "../../stores/terminalThemeStore";

export function useTerminalThemeModeSetting() {
  const [mode, setMode] = useState<TerminalThemeMode>("follow");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadTerminalThemeModeFromStore();
      setMode(loaded);
      applyTerminalThemeMode(loaded);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (next: TerminalThemeMode) => {
      if (next === mode) return;
      setSaving(true);
      try {
        const saved = await saveTerminalThemeModeToStore(next);
        setMode(saved);
        applyTerminalThemeMode(saved);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [mode],
  );

  return {
    mode,
    loading,
    saving,
    refresh,
    save,
  };
}
