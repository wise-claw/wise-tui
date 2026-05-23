import { useCallback, useEffect, useState } from "react";
import { getClaudeModelProfileStore } from "../services/claudeModelProfiles";
import type { ClaudeModelProfileStoreView } from "../types/claudeModelProfile";
import { WISE_CLAUDE_USER_SETTINGS_CHANGED } from "../services/claudeModelProfiles";

/** 顶栏模型切换：读取档案库与当前生效模型。 */
export function useClaudeModelProfileStore(enabled = true) {
  const [store, setStore] = useState<ClaudeModelProfileStoreView | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setStore(null);
      return;
    }
    try {
      const next = await getClaudeModelProfileStore();
      setStore(next);
    } catch {
      setStore(null);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const onChanged = () => {
      void refresh();
    };
    window.addEventListener(WISE_CLAUDE_USER_SETTINGS_CHANGED, onChanged);
    return () => window.removeEventListener(WISE_CLAUDE_USER_SETTINGS_CHANGED, onChanged);
  }, [enabled, refresh]);

  return { store, refresh };
}
