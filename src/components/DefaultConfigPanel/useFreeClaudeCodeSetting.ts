import { Modal, message } from "antd";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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

  const refresh = useCallback(async () => {
    try {
      await refreshFccTracesStoreNow();
    } catch (err) {
      message.error(`读取 Free Claude Code 状态失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

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

  const startServer = useCallback(
    () => runAction("已启动 FCC 代理", startFreeClaudeCodeServer),
    [runAction],
  );

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

  const applyClaudeSettings = useCallback(
    () => runAction("已同步 Claude settings.json", applyFreeClaudeCodeClaudeSettings),
    [runAction],
  );

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
