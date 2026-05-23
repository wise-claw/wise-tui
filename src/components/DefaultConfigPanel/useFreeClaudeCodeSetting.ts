import { Modal, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  applyFreeClaudeCodeClaudeSettings,
  getFreeClaudeCodeStatus,
  installFreeClaudeCode,
  openFreeClaudeCodeAdmin,
  sanitizeClaudeCredentialsForFcc,
  startFreeClaudeCodeServer,
  stopFreeClaudeCodeServer,
  uninstallFreeClaudeCode,
  type FreeClaudeCodeStatus,
} from "../../services/freeClaudeCode";

export function useFreeClaudeCodeSetting() {
  const [status, setStatus] = useState<FreeClaudeCodeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getFreeClaudeCodeStatus());
    } catch (err) {
      message.error(`读取 Free Claude Code 状态失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void getFreeClaudeCodeStatus()
        .then(setStatus)
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runAction = useCallback(
    async (label: string, fn: () => Promise<FreeClaudeCodeStatus | boolean | string>) => {
      setBusy(true);
      try {
        await fn();
        message.success(label);
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

  const install = useCallback(
    () => runAction("安装完成", installFreeClaudeCode),
    [runAction],
  );

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
      const changed = await sanitizeClaudeCredentialsForFcc();
      message.success(changed ? "已清理 ~/.claude.json 中与 FCC 冲突的认证项" : "无需清理");
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
