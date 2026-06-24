import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadOpenInEditorShortcutFromStore,
  saveOpenInEditorShortcutToStore,
  WISE_OPEN_IN_EDITOR_SHORTCUT_CHANGED,
} from "../../services/wiseDefaultConfigStore";

export function useOpenInEditorShortcutSetting() {
  const [shortcut, setShortcut] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setShortcut(await loadOpenInEditorShortcutFromStore());
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
      const detail = (event as CustomEvent<{ chord: string }>).detail;
      if (typeof detail?.chord === "string") {
        setShortcut(detail.chord);
      } else {
        void refresh();
      }
    };
    window.addEventListener(WISE_OPEN_IN_EDITOR_SHORTCUT_CHANGED, onChanged as EventListener);
    return () => {
      window.removeEventListener(WISE_OPEN_IN_EDITOR_SHORTCUT_CHANGED, onChanged as EventListener);
    };
  }, [refresh]);

  const save = useCallback(
    async (chord: string) => {
      if (chord === shortcut) return;
      setSaving(true);
      try {
        const normalized = await saveOpenInEditorShortcutToStore(chord);
        setShortcut(normalized);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [shortcut],
  );

  return { shortcut, loading, saving, refresh, save };
}
