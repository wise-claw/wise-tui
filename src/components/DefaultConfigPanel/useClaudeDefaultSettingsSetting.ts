import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  getAppSetting,
  setAppSetting,
  WISE_CLAUDE_DEFAULT_SETTINGS_KEY,
} from "../../services/appSettingsStore";
import {
  formatClaudeDefaultSettings,
  isSandboxDisabledInSettings,
  isUltracodeEnabledInSettings,
  parseClaudeDefaultSettings,
  toggleSandboxDisabledInSettings,
  toggleUltracodeInSettings,
} from "./claudeDefaultSettings";

/**
 * Claude 启动默认 `--settings` 配置项。
 *
 * 维护两态：`value`（已持久化的值）与 `draft`（编辑中的文本）。
 * TextArea 绑定 `draft`，失焦时 `commit` 校验并落库；校验失败回滚 `draft` 到 `value`，
 * 保证非法 JSON 不会持久化、UI 也回到上次合法状态。ultracode 开关基于 `value` 合并，
 * 避免 draft 未提交的脏数据混入。
 */
export function useClaudeDefaultSettingsSetting() {
  const [value, setValue] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const stored = await getAppSetting(WISE_CLAUDE_DEFAULT_SETTINGS_KEY);
      const v = stored ?? "";
      setValue(v);
      setDraft(v);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 校验并持久化。返回是否成功（校验失败返回 false 且已提示）。
  const persist = useCallback(async (next: string): Promise<boolean> => {
    const trimmed = next.trim();
    if (!trimmed) {
      await setAppSetting(WISE_CLAUDE_DEFAULT_SETTINGS_KEY, "");
      setValue("");
      return true;
    }
    const obj = parseClaudeDefaultSettings(trimmed);
    if (!obj) {
      message.error("settings JSON 格式无效：必须是 JSON 对象");
      return false;
    }
    if (Object.keys(obj).length === 0) {
      await setAppSetting(WISE_CLAUDE_DEFAULT_SETTINGS_KEY, "");
      setValue("");
      return true;
    }
    await setAppSetting(WISE_CLAUDE_DEFAULT_SETTINGS_KEY, trimmed);
    setValue(trimmed);
    return true;
  }, []);

  const commit = useCallback(async () => {
    setSaving(true);
    try {
      if (draft.trim() === value.trim()) return;
      const ok = await persist(draft);
      if (!ok) {
        setDraft(value); // 校验失败，回滚编辑态
      }
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }, [draft, value, persist]);

  const format = useCallback(async () => {
    setSaving(true);
    try {
      const formatted = formatClaudeDefaultSettings(draft);
      setDraft(formatted);
      const ok = await persist(formatted);
      if (!ok) setDraft(value);
    } catch (err) {
      message.error(`settings JSON 格式无效：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [draft, value, persist]);

  const saveUltracode = useCallback(
    async (enabled: boolean) => {
      setSaving(true);
      try {
        const next = toggleUltracodeInSettings(value, enabled);
        await setAppSetting(WISE_CLAUDE_DEFAULT_SETTINGS_KEY, next);
        setValue(next);
        setDraft(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [value],
  );

  const saveSandboxDisabled = useCallback(
    async (disabled: boolean) => {
      setSaving(true);
      try {
        const next = toggleSandboxDisabledInSettings(value, disabled);
        await setAppSetting(WISE_CLAUDE_DEFAULT_SETTINGS_KEY, next);
        setValue(next);
        setDraft(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [value],
  );

  return {
    value,
    draft,
    setDraft,
    ultracodeEnabled: isUltracodeEnabledInSettings(value),
    sandboxDisabled: isSandboxDisabledInSettings(value),
    loading,
    saving,
    refresh,
    commit,
    format,
    saveUltracode,
    saveSandboxDisabled,
  };
}
