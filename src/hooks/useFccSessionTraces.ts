import { useEffect, useState } from "react";
import { getFreeClaudeCodeStatus } from "../services/freeClaudeCode";
import { listFccTraces } from "../services/fccTraces";
import type { FccTraceEntry } from "../types/fccTrace";

export interface UseFccSessionTracesOptions {
  open: boolean;
  sessionHint?: string;
  sinceMs?: number;
  limit?: number;
}

/** 在 Claude 已对齐 FCC 代理时加载 `~/.fcc/traces/` 会话 trace。 */
export function useFccSessionTraces(options: UseFccSessionTracesOptions) {
  const { open, sessionHint, sinceMs, limit = 200 } = options;
  const [fccActive, setFccActive] = useState(false);
  const [traces, setTraces] = useState<FccTraceEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setFccActive(false);
      return;
    }
    let cancelled = false;
    void getFreeClaudeCodeStatus()
      .then((st) => {
        if (!cancelled) {
          setFccActive(st.claudeSettingsAligned || (st.serverRunning && st.installed));
        }
      })
      .catch(() => {
        if (!cancelled) setFccActive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !fccActive) {
      setTraces([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const hint = sessionHint?.trim() || undefined;
    void (async () => {
      try {
        let rows = await listFccTraces({ sinceMs, limit, sessionHint: hint });
        if (rows.length === 0 && hint) {
          rows = await listFccTraces({ sinceMs, limit });
        }
        if (!cancelled) setTraces(rows);
      } catch {
        if (!cancelled) setTraces([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, fccActive, sinceMs, limit, sessionHint]);

  return { fccAligned: fccActive, traces, loading };
}
