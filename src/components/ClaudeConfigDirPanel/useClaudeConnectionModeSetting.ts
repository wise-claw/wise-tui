import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { CLAUDE_CONNECTION_KIND_LABELS, loadDefaultClaudeConnectionKind, saveDefaultClaudeConnectionKind } from "../../constants/claudeConnection";
import { CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK, type ClaudeSessionConnectionKind } from "../../services/wiseDefaultConfigStore";

export function useClaudeConnectionModeSetting() {
  const [kind, setKind] = useState<ClaudeSessionConnectionKind>(CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setKind(await loadDefaultClaudeConnectionKind());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (next: ClaudeSessionConnectionKind) => {
    if (next === kind) return;
    setSaving(true);
    try {
      await saveDefaultClaudeConnectionKind(next);
      setKind(next);
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [kind]);

  return { kind, loading, saving, refresh, save, labels: CLAUDE_CONNECTION_KIND_LABELS };
}
