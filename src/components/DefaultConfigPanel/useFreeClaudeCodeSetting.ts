import { Modal, message } from "antd";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getClaudeLlmProxyStatus } from "../../services/claudeLlmProxy";
import {
  showFccClaudeSettingsGuideModal,
  tryReconcileFccClaudeSettings,
} from "../../services/freeClaudeCodeClaudeAlignment";
import {
  applyFreeClaudeCodeClaudeSettings,
  installFreeClaudeCode,
  listenFreeClaudeCodeInstallStatus,
  openFreeClaudeCodeAdmin,
  sanitizeClaudeCredentialsForFcc,
  startFreeClaudeCodeServer,
  stopFreeClaudeCodeServer,
  uninstallFreeClaudeCode,
  type FreeClaudeCodeStatus,
} from "../../services/freeClaudeCode";
import { getOpencodeGoProxyStatus } from "../../services/opencodeGoProxy";
import {
  anthropicProxyConflictMessage,
  resolveAnthropicProxyConflict,
} from "../../utils/anthropicProxyConflict";
import {
  getFccTracesStoreSnapshot,
  refreshFccTracesStoreNow,
  startFccTracesPolling,
  stopFccTracesPolling,
  subscribeFccTracesStore,
} from "../../stores/fccTracesStore";

export function useFreeClaudeCodeSetting() {
  const snapshot = useSyncExternalStore(
    subscribeFccTracesStore,
    getFccTracesStoreSnapshot,
    getFccTracesStoreSnapshot,
  );
  const status = snapshot.status;
  const loading = snapshot.loading;
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<number | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);

  useEffect(() => {
    startFccTracesPolling();
    return () => stopFccTracesPolling();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenFreeClaudeCodeInstallStatus((payload) => {
      if (payload.phase === "installing") {
        setInstalling(true);
        setInstallMessage(payload.message);
        if (typeof payload.progressPercent === "number") {
          setInstallProgress(payload.progressPercent);
        }
        return;
      }
      setInstalling(false);
      setInstallProgress(null);
      setInstallMessage(null);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const reconcileClaudeSettings = useCallback(
    async (st: FreeClaudeCodeStatus | null): Promise<FreeClaudeCodeStatus | null> => {
      if (!st?.serverRunning || st.claudeSettingsAligned) {
        return st;
      }
      const result = await tryReconcileFccClaudeSettings(st);
      if (result.applied) {
        message.success("已自动同步 Claude settings.json");
        return result.status;
      }
      return st;
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      await refreshFccTracesStoreNow();
      const current = getFccTracesStoreSnapshot().status;
      const reconciled = await reconcileClaudeSettings(current);
      if (reconciled && reconciled !== current) {
        await refreshFccTracesStoreNow();
      }
    } catch (err) {
      message.error(`读取 Free Claude Code 状态失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [reconcileClaudeSettings]);

  const runAction = useCallback(
    async (label: string, fn: () => Promise<FreeClaudeCodeStatus | boolean | string>) => {
      setBusy(true);
      try {
        await fn();
        await refresh();
      } catch (err) {
        message.error(`${label}失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const startServer = useCallback(async () => {
    setBusy(true);
    try {
      const started = await startFreeClaudeCodeServer();
      const [ocgo, llm] = await Promise.all([
        getOpencodeGoProxyStatus(),
        getClaudeLlmProxyStatus(),
      ]);
      const conflictMessage = anthropicProxyConflictMessage(
        resolveAnthropicProxyConflict(ocgo, llm, started),
      );
      if (conflictMessage) {
        message.warning(conflictMessage);
      }

      const alignment = await tryReconcileFccClaudeSettings(started);
      await refreshFccTracesStoreNow();

      if (alignment.applied) {
        message.success("已启动 FCC 代理并同步 Claude settings.json");
      } else if (alignment.needsGuide) {
        message.success("已启动 FCC 代理");
        showFccClaudeSettingsGuideModal(alignment.status);
      } else if (started.claudeSettingsAligned) {
        message.success("已启动 FCC 代理，Claude 配置已对齐");
      } else {
        message.success("已启动 FCC 代理");
      }
    } catch (err) {
      message.error(`启动 FCC 代理失败：${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const stopServer = useCallback(
    () => runAction("已停止 FCC 代理服务", stopFreeClaudeCodeServer),
    [runAction],
  );

  const install = useCallback(async () => {
    setInstalling(true);
    setInstallProgress(0);
    setInstallMessage("正在安装 free-claude-code…");
    setBusy(true);
    try {
      await installFreeClaudeCode();
      await refresh();
      message.success("安装完成");
    } catch (err) {
      message.error(`安装失败：${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setBusy(false);
      setInstalling(false);
      setInstallProgress(null);
      setInstallMessage(null);
    }
  }, [refresh]);

  const uninstall = useCallback(() => {
    Modal.confirm({
      title: "卸载 fcc-server",
      content:
        "将执行 uv tool uninstall free-claude-code，移除本机 fcc-server 可执行文件；~/.fcc/.env 配置会保留。",
      okText: "卸载",
      okType: "danger",
      cancelText: "取消",
      onOk: () => runAction("卸载完成", uninstallFreeClaudeCode),
    });
  }, [runAction]);

  const applyClaudeSettings = useCallback(async () => {
    setBusy(true);
    try {
      await applyFreeClaudeCodeClaudeSettings();
      await sanitizeClaudeCredentialsForFcc();
      await refreshFccTracesStoreNow();
      const current = getFccTracesStoreSnapshot().status;
      if (current?.claudeSettingsAligned) {
        message.success("已同步 Claude settings.json");
        return;
      }
      if (current) {
        showFccClaudeSettingsGuideModal(current);
      }
    } catch (err) {
      message.error(`同步 Claude 设置失败：${err instanceof Error ? err.message : String(err)}`);
      const current = getFccTracesStoreSnapshot().status;
      if (current) {
        showFccClaudeSettingsGuideModal(current);
      }
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const sanitizeCredentials = useCallback(async () => {
    setBusy(true);
    try {
      await sanitizeClaudeCredentialsForFcc();
      await refresh();
    } catch (err) {
      message.error(`清理失败：${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const openAdmin = useCallback(async () => {
    setBusy(true);
    try {
      await openFreeClaudeCodeAdmin();
    } catch (err) {
      message.error(`打开 Admin 失败：${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    loading,
    busy,
    installing,
    installProgress,
    installMessage,
    refresh,
    startServer,
    stopServer,
    install,
    uninstall,
    applyClaudeSettings,
    sanitizeCredentials,
    openAdmin,
  };
}
