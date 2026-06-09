import { useEffect, useState } from "react";
import { getOpencodeGoProxyStatus } from "../services/opencodeGoProxy";
import { listOpencodeGoProxyTraces } from "../services/opencodeGoProxyTraces";
import type { OpencodeGoProxyTraceEntry } from "../types/opencodeGoProxyTrace";

export interface UseOpencodeGoSessionTracesOptions {
  open: boolean;
  sinceMs?: number;
  limit?: number;
}

/** Claude 已对齐 OpenCode Go 代理时加载内存 trace。 */
export function useOpencodeGoSessionTraces(options: UseOpencodeGoSessionTracesOptions) {
  const { open, sinceMs, limit = 200 } = options;
  const [proxyAligned, setProxyAligned] = useState(false);
  const [traces, setTraces] = useState<OpencodeGoProxyTraceEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setProxyAligned(false);
      return;
    }
    let cancelled = false;
    void getOpencodeGoProxyStatus()
      .then((st) => {
        if (!cancelled) {
          setProxyAligned(
            st.claudeSettingsAligned || (st.running && st.enabled),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setProxyAligned(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !proxyAligned) {
      setTraces([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void listOpencodeGoProxyTraces({ sinceMs, limit })
      .then((rows) => {
        if (!cancelled) setTraces(rows);
      })
      .catch(() => {
        if (!cancelled) setTraces([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, proxyAligned, sinceMs, limit]);

  return { proxyAligned, traces, loading };
}
