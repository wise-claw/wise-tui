import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import {
  loadDefaultExecutionEngineFromStore,
  saveDefaultExecutionEngineToStore,
  WISE_DEFAULT_EXECUTION_ENGINE_CHANGED,
} from "../../services/wiseDefaultConfigStore";

export function useDefaultExecutionEngineSetting() {
  const [engine, setEngine] = useState<SessionExecutionEngine>("claude");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEngine(await loadDefaultExecutionEngineFromStore());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ engine?: SessionExecutionEngine }>).detail;
      if (detail?.engine) setEngine(detail.engine);
    };
    window.addEventListener(WISE_DEFAULT_EXECUTION_ENGINE_CHANGED, onChanged as EventListener);
    return () => {
      window.removeEventListener(WISE_DEFAULT_EXECUTION_ENGINE_CHANGED, onChanged as EventListener);
    };
  }, []);

  const save = useCallback(
    async (next: SessionExecutionEngine) => {
      if (next === engine) return;
      setSaving(true);
      try {
        await saveDefaultExecutionEngineToStore(next);
        setEngine(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [engine],
  );

  return { engine, loading, saving, refresh, save };
}
