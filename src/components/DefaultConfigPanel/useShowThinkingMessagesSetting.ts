import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadShowThinkingMessagesFromStore,
  saveShowThinkingMessagesToStore,
  WISE_SHOW_THINKING_MESSAGES_CHANGED,
} from "../../services/wiseDefaultConfigStore";

export function useShowThinkingMessagesSetting() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEnabled(await loadShowThinkingMessagesFromStore());
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
      const detail = (event as CustomEvent<{ showThinkingMessages?: boolean }>).detail;
      if (typeof detail?.showThinkingMessages === "boolean") {
        setEnabled(detail.showThinkingMessages);
      } else {
        void refresh();
      }
    };
    window.addEventListener(WISE_SHOW_THINKING_MESSAGES_CHANGED, onChanged as EventListener);
    return () => {
      window.removeEventListener(WISE_SHOW_THINKING_MESSAGES_CHANGED, onChanged as EventListener);
    };
  }, [refresh]);

  const save = useCallback(async (next: boolean) => {
    if (next === enabled) return;
    setSaving(true);
    try {
      await saveShowThinkingMessagesToStore(next);
      setEnabled(next);
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [enabled]);

  return { enabled, loading, saving, refresh, save };
}
