import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadTopbarChromeDefaultsFromStore,
  saveTopbarChromeDefaultsToStore,
} from "../../services/wiseDefaultConfigStore";

export function useTopbarChromeDefaultSetting() {
  const [showLlmProxyTopbar, setShowLlmProxyTopbar] = useState(false);
  const [showFccTopbar, setShowFccTopbar] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadTopbarChromeDefaultsFromStore();
      setShowLlmProxyTopbar(loaded.showLlmProxyTopbar);
      setShowFccTopbar(loaded.showFccTopbar);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveLlmProxy = useCallback(
    async (visible: boolean) => {
      if (visible === showLlmProxyTopbar) return;
      setSaving(true);
      try {
        await saveTopbarChromeDefaultsToStore({ showLlmProxyTopbar: visible });
        setShowLlmProxyTopbar(visible);
        message.success(visible ? "已保存：显示 LLM 代理图标" : "已保存：隐藏 LLM 代理图标");
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [showLlmProxyTopbar],
  );

  const saveFcc = useCallback(
    async (visible: boolean) => {
      if (visible === showFccTopbar) return;
      setSaving(true);
      try {
        await saveTopbarChromeDefaultsToStore({ showFccTopbar: visible });
        setShowFccTopbar(visible);
        message.success(visible ? "已保存：显示 FCC 顶栏图标" : "已保存：隐藏 FCC 顶栏图标");
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [showFccTopbar],
  );

  return {
    showLlmProxyTopbar,
    showFccTopbar,
    loading,
    saving,
    refresh,
    saveLlmProxy,
    saveFcc,
  };
}
