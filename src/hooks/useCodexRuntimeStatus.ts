import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type RuntimeStatus = "running" | "ready" | "resident" | "disconnected";

/** 后端进程连接独立于对话是否生成；切换会话时不沿用上一会话的连接状态。 */
export function useCodexRuntimeStatus(sessionId: string, enabled: boolean, busy: boolean): string {
  const [snapshot, setSnapshot] = useState<{ sessionId: string; status: RuntimeStatus } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const status = await invoke<RuntimeStatus>("get_codex_rpc_runtime_status", { sessionId });
        if (!disposed) setSnapshot({ sessionId, status });
      } catch {
        if (!disposed) setSnapshot({ sessionId, status: "disconnected" });
      }
      if (!disposed) timer = setTimeout(() => void refresh(), 2000);
    };
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [sessionId, enabled, busy]);
  const status = snapshot?.sessionId === sessionId ? snapshot.status : "disconnected";
  if (busy) return status === "running" ? "运行中" : "连接中";
  return status === "resident" ? "常驻待命" : status === "ready" ? "待命" : status === "running" ? "运行中" : "未连接";
}
