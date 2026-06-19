import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadTopbarChromeDefaultsFromStore,
  saveTopbarChromeDefaultsToStore,
} from "../../services/wiseDefaultConfigStore";

export function useTopbarChromeDefaultSetting() {
  const [showLlmProxyTopbar, setShowLlmProxyTopbar] = useState(false);
  const [showFccTopbar, setShowFccTopbar] = useState(false);
  const [showFccTrafficTopbar, setShowFccTrafficTopbar] = useState(false);
  const [showOpencodeProxyTopbar, setShowOpencodeProxyTopbar] = useState(false);
  const [showSessionDataLinkTopbar, setShowSessionDataLinkTopbar] = useState(false);
  const [showSessionFeedbackLoopTopbar, setShowSessionFeedbackLoopTopbar] = useState(false);
  const [showRemoteEntryTopbar, setShowRemoteEntryTopbar] = useState(true);
  const [showTopbarRepositoryName, setShowTopbarRepositoryName] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadTopbarChromeDefaultsFromStore();
      setShowLlmProxyTopbar(loaded.showLlmProxyTopbar);
      setShowFccTopbar(loaded.showFccTopbar);
      setShowFccTrafficTopbar(loaded.showFccTrafficTopbar);
      setShowOpencodeProxyTopbar(loaded.showOpencodeProxyTopbar);
      setShowSessionDataLinkTopbar(loaded.showSessionDataLinkTopbar);
      setShowSessionFeedbackLoopTopbar(loaded.showSessionFeedbackLoopTopbar);
      setShowRemoteEntryTopbar(loaded.showRemoteEntryTopbar);
      setShowTopbarRepositoryName(loaded.showTopbarRepositoryName);
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
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [showFccTopbar],
  );

  const saveFccTraffic = useCallback(
    async (visible: boolean) => {
      if (visible === showFccTrafficTopbar) return;
      setSaving(true);
      try {
        await saveTopbarChromeDefaultsToStore({ showFccTrafficTopbar: visible });
        setShowFccTrafficTopbar(visible);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [showFccTrafficTopbar],
  );

  const saveOpencodeProxy = useCallback(
    async (visible: boolean) => {
      if (visible === showOpencodeProxyTopbar) return;
      setSaving(true);
      try {
        await saveTopbarChromeDefaultsToStore({ showOpencodeProxyTopbar: visible });
        setShowOpencodeProxyTopbar(visible);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [showOpencodeProxyTopbar],
  );

  const saveSessionDataLink = useCallback(
    async (visible: boolean) => {
      if (visible === showSessionDataLinkTopbar) return;
      setSaving(true);
      try {
        await saveTopbarChromeDefaultsToStore({ showSessionDataLinkTopbar: visible });
        setShowSessionDataLinkTopbar(visible);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [showSessionDataLinkTopbar],
  );

  const saveSessionFeedbackLoop = useCallback(
    async (visible: boolean) => {
      if (visible === showSessionFeedbackLoopTopbar) return;
      setSaving(true);
      try {
        await saveTopbarChromeDefaultsToStore({ showSessionFeedbackLoopTopbar: visible });
        setShowSessionFeedbackLoopTopbar(visible);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [showSessionFeedbackLoopTopbar],
  );

  const saveRemoteEntry = useCallback(
    async (visible: boolean) => {
      if (visible === showRemoteEntryTopbar) return;
      setSaving(true);
      try {
        await saveTopbarChromeDefaultsToStore({ showRemoteEntryTopbar: visible });
        setShowRemoteEntryTopbar(visible);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [showRemoteEntryTopbar],
  );

  const saveTopbarRepositoryName = useCallback(
    async (visible: boolean) => {
      if (visible === showTopbarRepositoryName) return;
      setSaving(true);
      try {
        await saveTopbarChromeDefaultsToStore({ showTopbarRepositoryName: visible });
        setShowTopbarRepositoryName(visible);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [showTopbarRepositoryName],
  );

  return {
    showLlmProxyTopbar,
    showFccTopbar,
    showFccTrafficTopbar,
    showOpencodeProxyTopbar,
    showSessionDataLinkTopbar,
    showSessionFeedbackLoopTopbar,
    showRemoteEntryTopbar,
    showTopbarRepositoryName,
    loading,
    saving,
    refresh,
    saveLlmProxy,
    saveFcc,
    saveFccTraffic,
    saveOpencodeProxy,
    saveSessionDataLink,
    saveSessionFeedbackLoop,
    saveRemoteEntry,
    saveTopbarRepositoryName,
  };
}
