import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  getAppSetting,
  setAppSetting,
  WISE_OPENCODE_DEFAULT_SETTINGS_KEY,
} from "../../services/appSettingsStore";
import {
  extractOpencodeMode,
  extractOpencodePermissionJson,
  formatPermissionJson,
  isValidPermissionJson,
  serializeOpencodeDefaultSettings,
} from "./opencodeDefaultSettings";

/**
 * opencode 启动默认权限设置。
 *
 * 维护两态：`value`（已持久化）与 `permissionDraft`（编辑中的 permission JSON 文本）。
 * 模式 `Select` 即时切换即落库；permission `TextArea` 绑定 `permissionDraft`，失焦 `commit`
 * 校验并落库，校验失败回滚 `draft`。`mode` 派生自 `value`，null 视为 `auto`（现状）。
 */
export function useOpencodeDefaultSettingsSetting() {
  const [value, setValue] = useState("");
  const [permissionDraft, setPermissionDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const stored = await getAppSetting(WISE_OPENCODE_DEFAULT_SETTINGS_KEY);
      const v = stored ?? "";
      setValue(v);
      setPermissionDraft(extractOpencodePermissionJson(v));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persist = useCallback(async (next: string) => {
    await setAppSetting(WISE_OPENCODE_DEFAULT_SETTINGS_KEY, next);
    setValue(next);
  }, []);

  const saveMode = useCallback(
    async (mode: "auto" | "custom") => {
      setSaving(true);
      try {
        // 切到 custom 保留当前 draft；切到 auto 清空（auto 不使用规则）。
        const pj = mode === "custom" ? permissionDraft : "";
        const next = serializeOpencodeDefaultSettings(mode, pj);
        await persist(next);
        if (mode === "auto") setPermissionDraft("");
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [permissionDraft, persist],
  );

  const commit = useCallback(async () => {
    setSaving(true);
    try {
      if (!isValidPermissionJson(permissionDraft)) {
        message.error("permission JSON 格式无效");
        setPermissionDraft(extractOpencodePermissionJson(value));
        return;
      }
      const formatted = permissionDraft.trim() ? formatPermissionJson(permissionDraft) : "";
      const next = serializeOpencodeDefaultSettings("custom", formatted);
      await persist(next);
      setPermissionDraft(formatted);
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      setPermissionDraft(extractOpencodePermissionJson(value));
    } finally {
      setSaving(false);
    }
  }, [permissionDraft, value, persist]);

  const format = useCallback(async () => {
    setSaving(true);
    try {
      const formatted = formatPermissionJson(permissionDraft);
      setPermissionDraft(formatted);
      const next = serializeOpencodeDefaultSettings("custom", formatted);
      await persist(next);
    } catch (err) {
      message.error(`permission JSON 格式无效：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [permissionDraft, persist]);

  return {
    mode: extractOpencodeMode(value) ?? "auto",
    permissionDraft,
    setPermissionDraft,
    loading,
    saving,
    refresh,
    saveMode,
    commit,
    format,
  };
}
