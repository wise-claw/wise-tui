import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  getAppSetting,
  setAppSetting,
  WISE_CODEX_DEFAULT_SETTINGS_KEY,
} from "../../services/appSettingsStore";
import {
  extractCodexApprovalPolicy,
  extractCodexSandboxMode,
  isFullAccessInCodexSettings,
  resolveCodexPermissionPreset,
  serializeCodexDefaultSettings,
  serializeCodexPermissionPreset,
  toggleFullAccessInCodexSettings,
  type CodexPermissionPreset,
} from "./codexDefaultSettings";

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyCodexDefaultSettingsChange(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.warn("[wise:codex-default-settings] listener threw", err);
    }
  }
}

/** Composer 徽标与配置面板共享：写入后广播，订阅端重读。 */
export function subscribeCodexDefaultSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * codex 启动默认沙箱/审批设置。
 *
 * 与 claude 的 TextArea 编辑态不同，codex 用结构化 Select 即时选择：选完即落库，
 * 无 draft 中间态。`sandboxMode`/`approvalPolicy` 直接派生自已持久化的 `value`；
 * 为 `null` 表示「默认」（后端回退 workspace-write / 不传 `-c`）。
 */
export function useCodexDefaultSettingsSetting() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    try {
      const stored = await getAppSetting(WISE_CODEX_DEFAULT_SETTINGS_KEY);
      setValue(stored ?? "");
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeCodexDefaultSettings(() => {
      void refresh({ quiet: true });
    });
  }, [refresh]);

  const persist = useCallback(async (next: string) => {
    await setAppSetting(WISE_CODEX_DEFAULT_SETTINGS_KEY, next);
    setValue(next);
    notifyCodexDefaultSettingsChange();
  }, []);

  const saveSandboxMode = useCallback(
    async (mode: string | null) => {
      setSaving(true);
      try {
        const next = serializeCodexDefaultSettings(mode, extractCodexApprovalPolicy(value));
        await persist(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [value, persist],
  );

  const saveApprovalPolicy = useCallback(
    async (policy: string | null) => {
      setSaving(true);
      try {
        const next = serializeCodexDefaultSettings(extractCodexSandboxMode(value), policy);
        await persist(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [value, persist],
  );

  const saveFullAccess = useCallback(
    async (enabled: boolean) => {
      setSaving(true);
      try {
        const next = toggleFullAccessInCodexSettings(value, enabled);
        await persist(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [value, persist],
  );

  const savePermissionPreset = useCallback(
    async (preset: CodexPermissionPreset) => {
      setSaving(true);
      try {
        const next = serializeCodexPermissionPreset(preset);
        await persist(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [persist],
  );

  return {
    sandboxMode: extractCodexSandboxMode(value),
    approvalPolicy: extractCodexApprovalPolicy(value),
    fullAccess: isFullAccessInCodexSettings(value),
    permissionPreset: resolveCodexPermissionPreset(value),
    loading,
    saving,
    refresh,
    saveSandboxMode,
    saveApprovalPolicy,
    saveFullAccess,
    savePermissionPreset,
  };
}
