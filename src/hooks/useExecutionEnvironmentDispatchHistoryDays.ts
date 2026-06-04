import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS,
  type ExecutionEnvironmentDispatchHistoryDays,
} from "../constants/executionEnvironmentDispatch";
import {
  loadExecutionEnvironmentDispatchHistoryDaysFromStore,
  saveExecutionEnvironmentDispatchHistoryDaysToStore,
  WISE_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS_CHANGED,
} from "../services/wiseDefaultConfigStore";

export function useExecutionEnvironmentDispatchHistoryDays() {
  const [days, setDays] = useState<ExecutionEnvironmentDispatchHistoryDays>(
    DEFAULT_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadExecutionEnvironmentDispatchHistoryDaysFromStore();
      setDays(loaded);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ days: ExecutionEnvironmentDispatchHistoryDays }>).detail;
      if (detail?.days) setDays(detail.days);
    };
    window.addEventListener(
      WISE_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS_CHANGED,
      onChanged as EventListener,
    );
    return () => {
      window.removeEventListener(
        WISE_EXECUTION_ENVIRONMENT_DISPATCH_HISTORY_DAYS_CHANGED,
        onChanged as EventListener,
      );
    };
  }, []);

  const save = useCallback(
    async (next: ExecutionEnvironmentDispatchHistoryDays) => {
      if (next === days) return;
      setSaving(true);
      try {
        await saveExecutionEnvironmentDispatchHistoryDaysToStore(next);
        setDays(next);
        message.success(`已保存：任务派发默认展示近 ${next} 天`);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [days],
  );

  return { days, loading, saving, refresh, save };
}
