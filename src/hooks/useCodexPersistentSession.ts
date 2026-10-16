import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCodexPersistentSession, publishCodexPersistentSession, subscribeCodexPersistentSession } from "../stores/codexPersistentSessionStore";

export function useCodexPersistentSessionSelected(sessionId: string): boolean {
  return useSyncExternalStore(subscribeCodexPersistentSession,
    () => getCodexPersistentSession(sessionId), () => false);
}

/** 会话级显式选择，默认沿用普通回收策略；后端确认后才更新勾选状态。 */
export function useCodexPersistentSession(sessionId: string, enabled: boolean) {
  const [pending, setPending] = useState(false);
  const persistent = useCodexPersistentSessionSelected(sessionId);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const saved = getCodexPersistentSession(sessionId);
    setPending(true);
    void invoke("set_codex_rpc_persistent", { sessionId, persistent: saved })
      .then(() => { if (!disposed) publishCodexPersistentSession(sessionId, saved, false); })
      .catch(() => { if (!disposed) publishCodexPersistentSession(sessionId, false, false); })
      .finally(() => { if (!disposed) setPending(false); });
    return () => { disposed = true; };
  }, [sessionId, enabled]);

  const setPersistent = useCallback(async (next: boolean) => {
    setPending(true);
    try {
      await invoke("set_codex_rpc_persistent", { sessionId, persistent: next });
      publishCodexPersistentSession(sessionId, next);
    } finally { setPending(false); }
  }, [sessionId]);
  return { persistent, pending, setPersistent };
}
