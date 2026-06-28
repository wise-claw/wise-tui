import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadRightInspectorRepositorySessionVisibleFromStore,
  saveRightInspectorRepositorySessionVisibleToStore,
  WISE_RIGHT_INSPECTOR_REPOSITORY_SESSION_CHANGED,
} from "../../services/wiseDefaultConfigStore";

export function useRightInspectorRepositorySessionSetting() {
  const [visible, setVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setVisible(await loadRightInspectorRepositorySessionVisibleFromStore());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (next: boolean) => {
      if (next === visible) return;
      setSaving(true);
      try {
        await saveRightInspectorRepositorySessionVisibleToStore(next);
        setVisible(next);
        // 同步派发窗口事件，避免 store 内部 diff-dispatch 时序（async load → persist → dispatch）
        // 晚于监听端 useEffect 的 mount 时机，导致运行时 hook 错过首次通知。
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(WISE_RIGHT_INSPECTOR_REPOSITORY_SESSION_CHANGED, {
              detail: { visible: next },
            }),
          );
        }
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [visible],
  );

  return { visible, loading, saving, refresh, save };
}
