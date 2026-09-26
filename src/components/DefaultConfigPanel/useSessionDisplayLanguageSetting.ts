import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SESSION_DISPLAY_LANGUAGE,
  normalizeSessionDisplayLanguage,
  type SessionDisplayLanguage,
} from "../../constants/sessionDisplayLanguage";
import {
  loadSessionDisplayLanguageFromStore,
  saveSessionDisplayLanguageToStore,
  WISE_SESSION_DISPLAY_LANGUAGE_CHANGED,
} from "../../services/sessionDisplayLanguage";

/** 配置中心「回复语言」：会话助手输出语言，写入 `app_settings`。 */
export function useSessionDisplayLanguageSetting() {
  const [language, setLanguage] = useState<SessionDisplayLanguage>(
    DEFAULT_SESSION_DISPLAY_LANGUAGE,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setLanguage(await loadSessionDisplayLanguageFromStore());
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
      const detail = (event as CustomEvent<{ language?: SessionDisplayLanguage }>).detail;
      if (detail?.language) setLanguage(normalizeSessionDisplayLanguage(detail.language));
    };
    window.addEventListener(WISE_SESSION_DISPLAY_LANGUAGE_CHANGED, onChanged as EventListener);
    return () => {
      window.removeEventListener(
        WISE_SESSION_DISPLAY_LANGUAGE_CHANGED,
        onChanged as EventListener,
      );
    };
  }, []);

  const save = useCallback(
    async (next: SessionDisplayLanguage) => {
      if (next === language) return;
      setSaving(true);
      try {
        await saveSessionDisplayLanguageToStore(next);
        setLanguage(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [language],
  );

  return { language, loading, saving, refresh, save };
}
