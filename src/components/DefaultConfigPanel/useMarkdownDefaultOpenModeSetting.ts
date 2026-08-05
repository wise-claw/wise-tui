import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadMarkdownDefaultOpenModeFromStore,
  saveMarkdownDefaultOpenModeToStore,
  WISE_MARKDOWN_DEFAULT_OPEN_MODE_CHANGED,
  type MarkdownDefaultOpenMode,
} from "../../services/wiseDefaultConfigStore";

export function useMarkdownDefaultOpenModeSetting() {
  const [mode, setMode] = useState<MarkdownDefaultOpenMode>("edit");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMode(await loadMarkdownDefaultOpenModeFromStore());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: MarkdownDefaultOpenMode }>).detail;
      if (detail?.mode === "edit" || detail?.mode === "preview") {
        setMode(detail.mode);
      } else {
        void refresh();
      }
    };
    window.addEventListener(WISE_MARKDOWN_DEFAULT_OPEN_MODE_CHANGED, onChanged as EventListener);
    return () => {
      window.removeEventListener(WISE_MARKDOWN_DEFAULT_OPEN_MODE_CHANGED, onChanged as EventListener);
    };
  }, [refresh]);

  const save = useCallback(
    async (next: MarkdownDefaultOpenMode) => {
      if (next === mode) return;
      setSaving(true);
      try {
        await saveMarkdownDefaultOpenModeToStore(next);
        setMode(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [mode],
  );

  return { mode, loading, saving, refresh, save };
}
