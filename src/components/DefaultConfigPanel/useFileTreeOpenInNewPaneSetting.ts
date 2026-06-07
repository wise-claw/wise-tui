import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadFileTreeOpenInNewPaneFromStore,
  saveFileTreeOpenInNewPaneToStore,
  WISE_FILE_TREE_OPEN_IN_NEW_PANE_CHANGED,
} from "../../services/wiseDefaultConfigStore";

export function useFileTreeOpenInNewPaneSetting() {
  const [openInNewPane, setOpenInNewPane] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setOpenInNewPane(await loadFileTreeOpenInNewPaneFromStore());
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
      const detail = (event as CustomEvent<{ openInNewPane?: boolean }>).detail;
      if (typeof detail?.openInNewPane === "boolean") {
        setOpenInNewPane(detail.openInNewPane);
      } else {
        void refresh();
      }
    };
    window.addEventListener(WISE_FILE_TREE_OPEN_IN_NEW_PANE_CHANGED, onChanged as EventListener);
    return () => {
      window.removeEventListener(WISE_FILE_TREE_OPEN_IN_NEW_PANE_CHANGED, onChanged as EventListener);
    };
  }, [refresh]);

  const save = useCallback(
    async (next: boolean) => {
      if (next === openInNewPane) return;
      setSaving(true);
      try {
        await saveFileTreeOpenInNewPaneToStore(next);
        setOpenInNewPane(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [openInNewPane],
  );

  return { openInNewPane, loading, saving, refresh, save };
}
