import { useCallback, useEffect, useState } from "react";
import {
  CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  loadDefaultClaudeConnectionKind,
  WISE_CLAUDE_CONNECTION_KIND_CHANGED,
  type ClaudeSessionConnectionKind,
} from "../constants/claudeConnection";

/** 全局默认连接方式（`app_settings` / `wise.defaultConfig.v1`），供 Composer 芯片等展示。 */
export function useDefaultClaudeConnectionKind(): ClaudeSessionConnectionKind {
  const [kind, setKind] = useState<ClaudeSessionConnectionKind>(CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK);

  const refresh = useCallback(async () => {
    setKind(await loadDefaultClaudeConnectionKind());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadDefaultClaudeConnectionKind().then((loaded) => {
      if (!cancelled) setKind(loaded);
    });
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<{ kind?: ClaudeSessionConnectionKind }>).detail?.kind;
      if (next === "streaming" || next === "oneshot") setKind(next);
    };
    window.addEventListener(WISE_CLAUDE_CONNECTION_KIND_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_CLAUDE_CONNECTION_KIND_CHANGED, onChanged);
    };
  }, [refresh]);

  return kind;
}
