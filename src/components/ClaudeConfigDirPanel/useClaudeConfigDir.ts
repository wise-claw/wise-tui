import { message } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ClaudeUserConfigDirInfo,
  getClaudeUserConfigDir,
  setClaudeUserConfigDir,
} from "../../services/claudeConfigDir";

export interface UseClaudeConfigDirResult {
  info: ClaudeUserConfigDirInfo | null;
  loading: boolean;
  saving: boolean;
  refresh: () => Promise<void>;
  save: (rawValue: string | null) => Promise<ClaudeUserConfigDirInfo | null>;
  reset: () => Promise<void>;
}

export function useClaudeConfigDir(): UseClaudeConfigDirResult {
  const [info, setInfo] = useState<ClaudeUserConfigDirInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getClaudeUserConfigDir();
      if (!aliveRef.current) return;
      setInfo(next);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  const save = useCallback(async (rawValue: string | null): Promise<ClaudeUserConfigDirInfo | null> => {
    setSaving(true);
    try {
      const next = await setClaudeUserConfigDir(rawValue);
      if (!aliveRef.current) return null;
      setInfo(next);
      message.success("已保存配置目录，后续 Claude Code 工具会立即按新路径解析。");
      return next;
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }, []);

  const reset = useCallback(async () => {
    setSaving(true);
    try {
      const next = await setClaudeUserConfigDir(null);
      if (!aliveRef.current) return;
      setInfo(next);
      message.success("已恢复为默认 ~/.claude。");
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }, []);

  return { info, loading, saving, refresh, save, reset };
}
